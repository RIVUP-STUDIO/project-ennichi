(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const stageLabel = document.getElementById("stageLabel");
  const meter = document.getElementById("meter");
  const accuracyEl = document.getElementById("accuracy");
  const progressEl = document.getElementById("progress");
  const rankEl = document.getElementById("rank");
  const message = document.getElementById("message");
  const resetButton = document.getElementById("resetButton");
  const nextButton = document.getElementById("nextButton");
  const soundButton = document.getElementById("soundButton");
  const resultDialog = document.getElementById("resultDialog");
  const resultIcon = document.getElementById("resultIcon");
  const resultKicker = document.getElementById("resultKicker");
  const resultTitle = document.getElementById("resultTitle");
  const resultText = document.getElementById("resultText");
  const resultButton = document.getElementById("resultButton");

  const W = canvas.width;
  const H = canvas.height;
  const CENTER = { x: W / 2, y: H / 2 };

  let stageIndex = 0;
  let drawing = false;
  let failed = false;
  let cleared = false;
  let trace = [];
  let samples = [];
  let visited = new Set();
  let totalDistance = 0;
  let offDistance = 0;
  let lastPoint = null;
  let soundOn = true;
  let audioCtx = null;

  const stages = [
    {
      name: "日の丸",
      emoji: "🇯🇵",
      tolerance: 34,
      minCoverage: 0.86,
      minAccuracy: 0.80,
      path(t) {
        const a = -Math.PI / 2 + t * Math.PI * 2;
        return { x: CENTER.x + Math.cos(a) * 188, y: CENTER.y + Math.sin(a) * 188 };
      }
    },
    {
      name: "ハート",
      emoji: "❤️",
      tolerance: 38,
      minCoverage: 0.84,
      minAccuracy: 0.76,
      path(t) {
        const a = t * Math.PI * 2;
        const x = 16 * Math.sin(a) ** 3;
        const y = 13 * Math.cos(a) - 5 * Math.cos(2*a) - 2 * Math.cos(3*a) - Math.cos(4*a);
        return { x: CENTER.x + x * 12.2, y: CENTER.y - y * 12.2 + 14 };
      }
    },
    {
      name: "星",
      emoji: "⭐",
      tolerance: 42,
      minCoverage: 0.82,
      minAccuracy: 0.72,
      path(t) {
        const points = [];
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + i * Math.PI / 5;
          const r = i % 2 === 0 ? 205 : 88;
          points.push({ x: CENTER.x + Math.cos(a) * r, y: CENTER.y + Math.sin(a) * r });
        }
        const seg = t * 10;
        const i = Math.floor(seg) % 10;
        const u = seg - Math.floor(seg);
        const p1 = points[i];
        const p2 = points[(i + 1) % 10];
        return { x: p1.x + (p2.x - p1.x) * u, y: p1.y + (p2.y - p1.y) * u };
      }
    }
  ];

  function buildSamples() {
    samples = [];
    const n = 260;
    for (let i = 0; i < n; i++) {
      samples.push(stages[stageIndex].path(i / n));
    }
  }

  function nearestSample(point) {
    let best = { index: -1, distance: Infinity };
    for (let i = 0; i < samples.length; i++) {
      const dx = point.x - samples[i].x;
      const dy = point.y - samples[i].y;
      const d = Math.hypot(dx, dy);
      if (d < best.distance) best = { index: i, distance: d };
    }
    return best;
  }

  function resetStage() {
    drawing = false;
    failed = false;
    cleared = false;
    trace = [];
    visited = new Set();
    totalDistance = 0;
    offDistance = 0;
    lastPoint = null;
    buildSamples();
    nextButton.disabled = true;
    nextButton.textContent = stageIndex === stages.length - 1 ? "最初から" : "次のステージ";
    stageLabel.textContent = `${stageIndex + 1} / ${stages.length}　${stages[stageIndex].name}`;
    message.classList.remove("hidden");
    message.innerHTML = "<strong>線の上を一筆でなぞろう</strong><span>指を離さず、スタート地点まで戻ってね</span>";
    updateStats();
    draw();
  }

  function getPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function onStart(event) {
    if (cleared) return;
    event.preventDefault();
    const p = getPoint(event);
    const start = samples[0];
    if (Math.hypot(p.x - start.x, p.y - start.y) > 58) {
      flashMessage("黄色い点からスタート！", "まずスタート地点に指を置いてね");
      buzz(false);
      return;
    }
    resetTraceOnly();
    drawing = true;
    trace.push(p);
    lastPoint = p;
    message.classList.add("hidden");
    canvas.setPointerCapture?.(event.pointerId);
    visitPoint(p);
    tone(420, .04);
    draw();
  }

  function onMove(event) {
    if (!drawing || failed || cleared) return;
    event.preventDefault();
    const p = getPoint(event);
    const step = lastPoint ? Math.hypot(p.x - lastPoint.x, p.y - lastPoint.y) : 0;
    totalDistance += step;
    const near = nearestSample(p);
    if (near.distance <= stages[stageIndex].tolerance) {
      visited.add(near.index);
    } else {
      offDistance += step;
      if (near.distance > stages[stageIndex].tolerance * 2.2) {
        fail("線から外れました");
        return;
      }
    }
    trace.push(p);
    lastPoint = p;
    updateStats();
    draw();
  }

  function onEnd(event) {
    if (!drawing || cleared) return;
    event.preventDefault();
    drawing = false;

    const progress = visited.size / samples.length;
    const accuracy = totalDistance ? 1 - offDistance / totalDistance : 0;
    const start = samples[0];
    const end = trace[trace.length - 1] || { x: 0, y: 0 };
    const closed = Math.hypot(end.x - start.x, end.y - start.y) < 62;

    if (!failed && progress >= stages[stageIndex].minCoverage &&
        accuracy >= stages[stageIndex].minAccuracy && closed) {
      clearStage(progress, accuracy);
    } else if (!failed) {
      let reason = "もう少し線をなぞろう";
      if (!closed) reason = "スタート地点まで戻ろう";
      else if (accuracy < stages[stageIndex].minAccuracy) reason = "線の上を丁寧になぞろう";
      fail(reason);
    }
  }

  function resetTraceOnly() {
    failed = false;
    trace = [];
    visited = new Set();
    totalDistance = 0;
    offDistance = 0;
    lastPoint = null;
    updateStats();
  }

  function visitPoint(p) {
    const near = nearestSample(p);
    if (near.distance <= stages[stageIndex].tolerance) visited.add(near.index);
  }

  function fail(text) {
    drawing = false;
    failed = true;
    buzz(false);
    flashMessage("失敗…", text);
    rankEl.textContent = "MISS";
    draw();
  }

  function clearStage(progress, accuracy) {
    cleared = true;
    const excellent = progress >= .96 && accuracy >= .94;
    rankEl.textContent = excellent ? "EXCELLENT" : "CLEAR";
    nextButton.disabled = false;
    buzz(true);
    fanfare(excellent);

    resultIcon.textContent = excellent ? "🌟" : stages[stageIndex].emoji;
    resultKicker.textContent = excellent ? "EXCELLENT CLEAR!" : "CLEAR!";
    resultTitle.textContent = excellent ? "一筆、完璧！" : "型抜き成功！";
    resultText.textContent = `精度 ${Math.round(accuracy * 100)}%・進行 ${Math.round(progress * 100)}%。`;
    resultButton.textContent = stageIndex === stages.length - 1 ? "最初から遊ぶ" : "次のステージ";
    setTimeout(() => resultDialog.showModal(), 280);
    draw();
  }

  function flashMessage(title, sub) {
    message.innerHTML = `<strong>${title}</strong><span>${sub}</span>`;
    message.classList.remove("hidden");
  }

  function updateStats() {
    const progress = samples.length ? visited.size / samples.length : 0;
    const accuracy = totalDistance ? Math.max(0, 1 - offDistance / totalDistance) : 0;
    meter.style.width = `${Math.round(progress * 100)}%`;
    progressEl.textContent = `${Math.round(progress * 100)}%`;
    accuracyEl.textContent = `${Math.round(accuracy * 100)}%`;
    if (!failed && !cleared) rankEl.textContent = drawing ? "TRACE" : "---";
  }

  function drawPaper() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#e9c889";
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = .09;
    ctx.strokeStyle = "#76522f";
    ctx.lineWidth = 2;
    for (let i = -H; i < W + H; i += 22) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i - H, H);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,.22)";
    ctx.beginPath();
    ctx.arc(CENTER.x - 90, CENTER.y - 120, 210, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTarget() {
    const stage = stages[stageIndex];

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    samples.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    ctx.strokeStyle = "rgba(75,48,23,.22)";
    ctx.lineWidth = 34;
    ctx.stroke();

    ctx.strokeStyle = "#fff4d8";
    ctx.lineWidth = 18;
    ctx.stroke();

    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = "#6c5438";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.setLineDash([]);

    const start = samples[0];
    ctx.fillStyle = "#f2b93e";
    ctx.beginPath();
    ctx.arc(start.x, start.y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff8e8";
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.fillStyle = "rgba(45,36,29,.72)";
    ctx.font = "900 24px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(stage.name, CENTER.x, 78);
    ctx.restore();
  }

  function drawTrace() {
    if (trace.length < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    trace.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.strokeStyle = failed ? "rgba(196,50,42,.76)" : "rgba(33,135,96,.88)";
    ctx.lineWidth = 13;
    ctx.stroke();

    if (!failed) {
      ctx.strokeStyle = "rgba(255,255,255,.65)";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    drawPaper();
    drawTarget();
    drawTrace();

    if (cleared) {
      ctx.save();
      ctx.fillStyle = "rgba(255,250,236,.76)";
      ctx.fillRect(0, 0, W, H);
      ctx.font = "900 58px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#d94a3a";
      ctx.fillText(rankEl.textContent, CENTER.x, CENTER.y + 18);
      ctx.restore();
    }
  }

  function nextStage() {
    if (!cleared) return;
    stageIndex = (stageIndex + 1) % stages.length;
    resetStage();
  }

  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function tone(freq, duration, delay = 0) {
    if (!soundOn) return;
    try {
      ensureAudio();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(.0001, audioCtx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(.12, audioCtx.currentTime + delay + .01);
      gain.gain.exponentialRampToValueAtTime(.0001, audioCtx.currentTime + delay + duration);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + delay);
      osc.stop(audioCtx.currentTime + delay + duration + .03);
    } catch (_) {}
  }

  function fanfare(excellent) {
    const notes = excellent ? [523,659,784,1047] : [523,659,784];
    notes.forEach((n, i) => tone(n, .18, i * .11));
  }

  function buzz(success) {
    if (navigator.vibrate) navigator.vibrate(success ? [25,35,25] : [60]);
  }

  canvas.addEventListener("pointerdown", onStart, { passive: false });
  canvas.addEventListener("pointermove", onMove, { passive: false });
  canvas.addEventListener("pointerup", onEnd, { passive: false });
  canvas.addEventListener("pointercancel", onEnd, { passive: false });

  resetButton.addEventListener("click", resetStage);
  nextButton.addEventListener("click", nextStage);
  resultButton.addEventListener("click", () => {
    resultDialog.close();
    nextStage();
  });

  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    soundButton.textContent = soundOn ? "🔊" : "🔇";
    if (soundOn) tone(660, .08);
  });

  resultDialog.addEventListener("cancel", (e) => e.preventDefault());

  resetStage();
})();
