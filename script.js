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
  const CENTER = { x: W / 2, y: 330 };

  // 指より上に針先を表示する距離
  const NEEDLE_OFFSET = 84;

  let stageIndex = 0;
  let drawing = false;
  let failed = false;
  let cleared = false;
  let pointerPoint = null;
  let needlePoint = null;
  let snappedPoint = null;
  let samples = [];
  let visited = new Set();
  let trace = [];
  let totalMovement = 0;
  let badMovement = 0;
  let lastNeedle = null;
  let soundOn = true;
  let audioCtx = null;
  let needleState = "idle";

  const stages = [
    {
      name: "日の丸",
      emoji: "🇯🇵",
      good: 13,
      warning: 22,
      fail: 34,
      snap: 18,
      minCoverage: 0.90,
      minAccuracy: 0.88,
      path(t) {
        const a = -Math.PI / 2 + t * Math.PI * 2;
        return { x: CENTER.x + Math.cos(a) * 185, y: CENTER.y + Math.sin(a) * 185 };
      }
    },
    {
      name: "ハート",
      emoji: "❤️",
      good: 12,
      warning: 21,
      fail: 32,
      snap: 17,
      minCoverage: 0.88,
      minAccuracy: 0.85,
      path(t) {
        const a = t * Math.PI * 2;
        const x = 16 * Math.sin(a) ** 3;
        const y = 13 * Math.cos(a) - 5 * Math.cos(2*a) - 2 * Math.cos(3*a) - Math.cos(4*a);
        return { x: CENTER.x + x * 11.8, y: CENTER.y - y * 11.8 + 8 };
      }
    },
    {
      name: "星",
      emoji: "⭐",
      good: 11,
      warning: 19,
      fail: 29,
      snap: 16,
      minCoverage: 0.86,
      minAccuracy: 0.82,
      path(t) {
        const points = [];
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + i * Math.PI / 5;
          const r = i % 2 === 0 ? 202 : 88;
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
    const n = 420;
    for (let i = 0; i < n; i++) samples.push(stages[stageIndex].path(i / n));
  }

  function nearestSample(point) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const dx = point.x - samples[i].x;
      const dy = point.y - samples[i].y;
      const d = Math.hypot(dx, dy);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    return { index: bestIndex, distance: bestDistance, point: samples[bestIndex] };
  }

  function getPointer(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (W / rect.width),
      y: (event.clientY - rect.top) * (H / rect.height)
    };
  }

  function pointerToNeedle(pointer) {
    return {
      x: pointer.x,
      y: pointer.y - NEEDLE_OFFSET
    };
  }

  function applySnap(rawNeedle, nearest) {
    const st = stages[stageIndex];
    if (nearest.distance > st.snap) return rawNeedle;

    // 完全吸着ではなく、溝へ軽く寄る
    const strength = 0.72;
    return {
      x: rawNeedle.x + (nearest.point.x - rawNeedle.x) * strength,
      y: rawNeedle.y + (nearest.point.y - rawNeedle.y) * strength
    };
  }

  function resetStage() {
    drawing = false;
    failed = false;
    cleared = false;
    pointerPoint = null;
    needlePoint = null;
    snappedPoint = null;
    visited = new Set();
    trace = [];
    totalMovement = 0;
    badMovement = 0;
    lastNeedle = null;
    needleState = "idle";

    buildSamples();

    nextButton.disabled = true;
    nextButton.textContent = stageIndex === stages.length - 1 ? "最初から" : "次のステージ";
    stageLabel.textContent = `${stageIndex + 1} / ${stages.length}　${stages[stageIndex].name}`;
    message.classList.remove("hidden");
    message.innerHTML = "<strong>黄色い点に針先を合わせよう</strong><span>指は針より下。緑のまま点線を削ってね</span>";

    updateStats();
    draw();
  }

  function onStart(event) {
    if (cleared) return;
    event.preventDefault();

    pointerPoint = getPointer(event);
    needlePoint = pointerToNeedle(pointerPoint);

    const nearest = nearestSample(needlePoint);
    const start = samples[0];

    if (Math.hypot(needlePoint.x - start.x, needlePoint.y - start.y) > 38) {
      flashMessage("針先を黄色い点へ", "指ではなく、針の先端を合わせてね");
      buzz(false);
      draw();
      return;
    }

    drawing = true;
    failed = false;
    visited = new Set();
    trace = [];
    totalMovement = 0;
    badMovement = 0;
    lastNeedle = null;
    needleState = "good";

    snappedPoint = applySnap(needlePoint, nearest);
    visit(nearest.index);
    trace.push(snappedPoint);

    message.classList.add("hidden");
    canvas.setPointerCapture?.(event.pointerId);
    tone(440, 0.04);
    draw();
  }

  function onMove(event) {
    if (!drawing || failed || cleared) return;
    event.preventDefault();

    pointerPoint = getPointer(event);
    needlePoint = pointerToNeedle(pointerPoint);

    const nearestRaw = nearestSample(needlePoint);
    snappedPoint = applySnap(needlePoint, nearestRaw);
    const nearestSnapped = nearestSample(snappedPoint);
    const d = nearestRaw.distance;
    const st = stages[stageIndex];

    if (lastNeedle) {
      totalMovement += Math.hypot(snappedPoint.x - lastNeedle.x, snappedPoint.y - lastNeedle.y);
    }

    if (d <= st.good) {
      needleState = "good";
      visit(nearestSnapped.index);
      trace.push({ ...snappedPoint, state: "good" });
      softTick();
    } else if (d <= st.warning) {
      needleState = "warning";
      badMovement += lastNeedle ? Math.hypot(snappedPoint.x - lastNeedle.x, snappedPoint.y - lastNeedle.y) : 0;
      trace.push({ ...snappedPoint, state: "warning" });
    } else if (d <= st.fail) {
      needleState = "danger";
      badMovement += lastNeedle ? Math.hypot(snappedPoint.x - lastNeedle.x, snappedPoint.y - lastNeedle.y) : 0;
      trace.push({ ...snappedPoint, state: "danger" });
    } else {
      fail("針先が溝から外れました");
      return;
    }

    lastNeedle = { ...snappedPoint };
    updateStats();
    draw();
  }

  function onEnd(event) {
    if (!drawing || cleared) return;
    event.preventDefault();
    drawing = false;

    const progress = visited.size / samples.length;
    const accuracy = totalMovement > 0 ? Math.max(0, 1 - badMovement / totalMovement) : 0;
    const start = samples[0];
    const end = snappedPoint || { x: 0, y: 0 };
    const closed = Math.hypot(end.x - start.x, end.y - start.y) < 30;
    const st = stages[stageIndex];

    if (!failed && progress >= st.minCoverage && accuracy >= st.minAccuracy && closed) {
      clearStage(progress, accuracy);
    } else if (!failed) {
      let reason = "点線をもっと削ろう";
      if (!closed) reason = "黄色い点まで戻ろう";
      else if (accuracy < st.minAccuracy) reason = "緑のまま沿う時間を増やそう";
      fail(reason);
    }
  }

  function visit(index) {
    const radius = 3;
    for (let i = -radius; i <= radius; i++) {
      const idx = (index + i + samples.length) % samples.length;
      visited.add(idx);
    }
  }

  function fail(text) {
    drawing = false;
    failed = true;
    needleState = "danger";
    rankEl.textContent = "MISS";
    flashMessage("失敗…", text);
    buzz(false);
    tone(140, 0.16);
    draw();
  }

  function clearStage(progress, accuracy) {
    cleared = true;
    needleState = "good";

    const excellent = progress >= 0.97 && accuracy >= 0.95;
    rankEl.textContent = excellent ? "EXCELLENT" : "CLEAR";
    nextButton.disabled = false;

    buzz(true);
    fanfare(excellent);

    resultIcon.textContent = excellent ? "🌟" : stages[stageIndex].emoji;
    resultKicker.textContent = excellent ? "EXCELLENT CLEAR!" : "CLEAR!";
    resultTitle.textContent = excellent ? "針さばき、完璧！" : "型抜き成功！";
    resultText.textContent = `精度 ${Math.round(accuracy * 100)}%・進行 ${Math.round(progress * 100)}%。`;
    resultButton.textContent = stageIndex === stages.length - 1 ? "最初から遊ぶ" : "次のステージ";

    setTimeout(() => resultDialog.showModal(), 260);
    draw();
  }

  function updateStats() {
    const progress = samples.length ? visited.size / samples.length : 0;
    const accuracy = totalMovement > 0 ? Math.max(0, 1 - badMovement / totalMovement) : 0;

    meter.style.width = `${Math.round(progress * 100)}%`;
    progressEl.textContent = `${Math.round(progress * 100)}%`;
    accuracyEl.textContent = `${Math.round(accuracy * 100)}%`;

    if (!failed && !cleared) {
      if (needleState === "good") rankEl.textContent = "GREEN";
      else if (needleState === "warning") rankEl.textContent = "CAUTION";
      else if (needleState === "danger") rankEl.textContent = "DANGER";
      else rankEl.textContent = "---";
    }
  }

  function drawPaper() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#e9c889";
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = "#76522f";
    ctx.lineWidth = 2;
    for (let i = -H; i < W + H; i += 22) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i - H, H);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTarget() {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    samples.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();

    ctx.strokeStyle = "rgba(76,47,22,.24)";
    ctx.lineWidth = 25;
    ctx.stroke();

    ctx.strokeStyle = "#f5e6c2";
    ctx.lineWidth = 12;
    ctx.stroke();

    ctx.setLineDash([5, 10]);
    ctx.strokeStyle = "#6f5639";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);

    // 削れた部分を緑で表示
    if (visited.size > 0) {
      ctx.lineWidth = 7;
      ctx.strokeStyle = "#2f9b64";
      ctx.setLineDash([]);
      for (let i = 0; i < samples.length; i++) {
        if (!visited.has(i)) continue;
        const p = samples[i];
        const p2 = samples[(i + 1) % samples.length];
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }

    const start = samples[0];
    ctx.fillStyle = "#f2b93e";
    ctx.beginPath();
    ctx.arc(start.x, start.y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff8e8";
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.fillStyle = "rgba(45,36,29,.72)";
    ctx.font = "900 22px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(stages[stageIndex].name, CENTER.x, 54);

    ctx.restore();
  }

  function drawTrace() {
    if (trace.length < 2) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 1; i < trace.length; i++) {
      const a = trace[i - 1];
      const b = trace[i];
      const state = b.state || "good";

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);

      if (state === "good") ctx.strokeStyle = "rgba(47,155,100,.95)";
      else if (state === "warning") ctx.strokeStyle = "rgba(232,177,47,.95)";
      else ctx.strokeStyle = "rgba(217,74,58,.95)";

      ctx.lineWidth = 6;
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawNeedle() {
    if (!pointerPoint || !needlePoint) return;

    const tip = snappedPoint || needlePoint;
    const handle = { x: tip.x, y: tip.y + 70 };

    let color = "#7d8791";
    if (needleState === "good") color = "#2f9b64";
    else if (needleState === "warning") color = "#e8b12f";
    else if (needleState === "danger") color = "#d94a3a";

    ctx.save();

    // 指と針先の関係を示す薄いガイド
    ctx.strokeStyle = "rgba(255,255,255,.5)";
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 7]);
    ctx.beginPath();
    ctx.moveTo(pointerPoint.x, pointerPoint.y - 12);
    ctx.lineTo(handle.x, handle.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 針本体
    ctx.strokeStyle = "#444b52";
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(handle.x, handle.y);
    ctx.lineTo(tip.x, tip.y + 8);
    ctx.stroke();

    // 金属ハイライト
    ctx.strokeStyle = "#d9e0e6";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(handle.x - 2, handle.y - 2);
    ctx.lineTo(tip.x - 2, tip.y + 10);
    ctx.stroke();

    // 針先の状態リング
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function draw() {
    drawPaper();
    drawTarget();
    drawTrace();
    drawNeedle();

    if (cleared) {
      ctx.save();
      ctx.fillStyle = "rgba(255,250,236,.76)";
      ctx.fillRect(0, 0, W, H);
      ctx.font = "900 54px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#d94a3a";
      ctx.fillText(rankEl.textContent, CENTER.x, CENTER.y + 18);
      ctx.restore();
    }
  }

  function flashMessage(title, sub) {
    message.innerHTML = `<strong>${title}</strong><span>${sub}</span>`;
    message.classList.remove("hidden");
  }

  function nextStage() {
    if (!cleared) return;
    stageIndex = (stageIndex + 1) % stages.length;
    resetStage();
  }

  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function tone(freq, duration, delay = 0, volume = 0.08) {
    if (!soundOn) return;
    try {
      ensureAudio();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = "triangle";
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(volume, audioCtx.currentTime + delay + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + delay + duration);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + delay);
      osc.stop(audioCtx.currentTime + delay + duration + 0.03);
    } catch (_) {}
  }

  let lastTick = 0;
  function softTick() {
    const now = performance.now();
    if (now - lastTick < 85) return;
    lastTick = now;
    tone(720 + Math.random() * 80, 0.018, 0, 0.022);
    if (navigator.vibrate) navigator.vibrate(4);
  }

  function fanfare(excellent) {
    const notes = excellent ? [523,659,784,1047] : [523,659,784];
    notes.forEach((n, i) => tone(n, 0.18, i * 0.11, 0.1));
  }

  function buzz(success) {
    if (navigator.vibrate) navigator.vibrate(success ? [25,35,25] : [70]);
  }

  canvas.addEventListener("pointerdown", onStart, { passive:false });
  canvas.addEventListener("pointermove", onMove, { passive:false });
  canvas.addEventListener("pointerup", onEnd, { passive:false });
  canvas.addEventListener("pointercancel", onEnd, { passive:false });

  resetButton.addEventListener("click", resetStage);
  nextButton.addEventListener("click", nextStage);

  resultButton.addEventListener("click", () => {
    resultDialog.close();
    nextStage();
  });

  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    soundButton.textContent = soundOn ? "🔊" : "🔇";
    if (soundOn) tone(660, 0.08);
  });

  resultDialog.addEventListener("cancel", e => e.preventDefault());

  resetStage();
})();
