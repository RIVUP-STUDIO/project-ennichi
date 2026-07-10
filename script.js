(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const stageName = document.getElementById("stageName");
  const progressBar = document.getElementById("progressBar");
  const progressText = document.getElementById("progressText");
  const timerEl = document.getElementById("timer");
  const stateText = document.getElementById("stateText");
  const guide = document.getElementById("guide");
  const resetBtn = document.getElementById("resetBtn");
  const nextBtn = document.getElementById("nextBtn");
  const soundBtn = document.getElementById("soundBtn");
  const resultDialog = document.getElementById("resultDialog");
  const resultIcon = document.getElementById("resultIcon");
  const resultTitle = document.getElementById("resultTitle");
  const resultBody = document.getElementById("resultBody");
  const resultNext = document.getElementById("resultNext");

  const W = canvas.width, H = canvas.height;
  const C = {x:W/2,y:330};
  const N = 720;
  const NEEDLE_LEN = 96;
  const GRAB_R = 38;

  let stageIndex = 0;
  let shape = [];
  let traced = new Array(N).fill(false);
  let tracedCount = 0;

  let needle = {tip:{x:115,y:500},handle:{x:115,y:596}};
  let dragging = false;
  let started = false;
  let failed = false;
  let cleared = false;
  let pointerId = null;
  let state = "ready";
  let startTime = null;
  let elapsed = 0;
  let raf = null;
  let soundOn = true;
  let audioCtx = null;

  function heartPoint(t){
    const a=t*Math.PI*2;
    const x=16*Math.sin(a)**3;
    const y=13*Math.cos(a)-5*Math.cos(2*a)-2*Math.cos(3*a)-Math.cos(4*a);
    return {x:C.x+x*11.7,y:C.y-y*11.7+8};
  }

  function starPoint(t){
    const pts=[];
    for(let i=0;i<10;i++){
      const a=-Math.PI/2+i*Math.PI/5;
      const r=i%2===0?202:88;
      pts.push({x:C.x+Math.cos(a)*r,y:C.y+Math.sin(a)*r});
    }
    const seg=t*10, i=Math.floor(seg)%10, u=seg-Math.floor(seg);
    const a=pts[i],b=pts[(i+1)%10];
    return {x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u};
  }

  const STAGES=[
    {name:"日の丸",emoji:"🇯🇵",point:t=>({x:C.x+Math.cos(-Math.PI/2+t*Math.PI*2)*185,y:C.y+Math.sin(-Math.PI/2+t*Math.PI*2)*185})},
    {name:"ハート",emoji:"❤️",point:heartPoint},
    {name:"星",emoji:"⭐",point:starPoint}
  ];

  function buildShape(){
    shape=[];
    for(let i=0;i<N;i++) shape.push(STAGES[stageIndex].point(i/N));
  }

  function nearest(p){
    let best={i:-1,d:Infinity,p:null};
    for(let i=0;i<N;i++){
      const q=shape[i],d=Math.hypot(p.x-q.x,p.y-q.y);
      if(d<best.d) best={i,d,p:q};
    }
    return best;
  }

  function pointInPolygon(p){
    let inside=false;
    for(let i=0,j=N-1;i<N;j=i++){
      const a=shape[i],b=shape[j];
      const hit=((a.y>p.y)!==(b.y>p.y)) &&
        (p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y+1e-9)+a.x);
      if(hit) inside=!inside;
    }
    return inside;
  }

  function reset(){
    buildShape();
    traced=new Array(N).fill(false);
    tracedCount=0;
    needle={tip:{x:115,y:500},handle:{x:115,y:596}};
    dragging=false;started=false;failed=false;cleared=false;pointerId=null;
    state="ready";startTime=null;elapsed=0;
    nextBtn.disabled=true;
    nextBtn.textContent=stageIndex===STAGES.length-1?"最初から":"次のステージ";
    stageName.textContent=`${stageIndex+1} / ${STAGES.length}　${STAGES[stageIndex].name}`;
    guide.classList.remove("hidden");
    guide.innerHTML="<strong>針をつかんで黄色い点へ</strong><span>内側に入ると即アウト。外側は戻ればセーフ。</span>";
    updateUI();
    draw();
  }

  function setNeedleFromHandle(h){
    needle.handle={...h};
    needle.tip={x:h.x,y:h.y-NEEDLE_LEN};
  }

  function pointer(e){
    const r=canvas.getBoundingClientRect();
    return {x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height};
  }

  function onShaft(p){
    return distanceSegment(p,needle.tip,needle.handle)<=28;
  }

  function onDown(e){
    if(cleared)return;
    e.preventDefault();
    const p=pointer(e);
    if(Math.hypot(p.x-needle.handle.x,p.y-needle.handle.y)>GRAB_R*1.3 && !onShaft(p)){
      guide.classList.remove("hidden");
      guide.innerHTML="<strong>針をつかんでね</strong><span>左下の棒または丸い持ち手を押さえます。</span>";
      return;
    }
    dragging=true;pointerId=e.pointerId;
    canvas.setPointerCapture?.(e.pointerId);
    guide.classList.add("hidden");
  }

  function onMove(e){
    if(!dragging||failed||cleared||e.pointerId!==pointerId)return;
    e.preventDefault();

    setNeedleFromHandle(pointer(e));
    const n=nearest(needle.tip);
    const start=shape[0];

    if(!started){
      state="ready";
      if(Math.hypot(needle.tip.x-start.x,needle.tip.y-start.y)<=18){
        started=true;state="green";startTime=performance.now();
        mark(n.i);tick(480,.05);vibrate([20,20,20]);
      }
      updateUI();draw();return;
    }

    const inside=pointInPolygon(needle.tip);
    const safe=10;
    const warning=18;

    // 重要: 内側は即アウト、外側は警告のみ
    if(inside && n.d>safe){
      state="red";
      fail();
      return;
    }

    if(n.d<=safe){
      state="green";
      mark(n.i);
      scratch();
    }else if(!inside){
      state="white";
    }else if(n.d<=warning){
      state="yellow";
    }

    updateUI();draw();

    if(tracedCount>=N){
      clear();
    }
  }

  function onUp(e){
    if(e.pointerId!==pointerId)return;
    dragging=false;pointerId=null;
    if(started&&!failed&&!cleared){
      guide.classList.remove("hidden");
      guide.innerHTML="<strong>針はその場にあります</strong><span>もう一度つかんで続きから削れます。</span>";
    }
  }

  function mark(i){
    for(let k=-3;k<=3;k++){
      const idx=(i+k+N)%N;
      if(!traced[idx]){traced[idx]=true;tracedCount++}
    }
  }

  function fail(){
    failed=true;dragging=false;pointerId=null;
    stateText.textContent="MISS";
    guide.classList.remove("hidden");
    guide.innerHTML="<strong>割れた…</strong><span>内側へ針先が入ると即アウトです。</span>";
    vibrate([60,30,90]);tick(130,.2);
    draw();
  }

  function clear(){
    cleared=true;dragging=false;pointerId=null;
    elapsed=(performance.now()-startTime)/1000;
    nextBtn.disabled=false;
    vibrate([25,30,25,30,60]);
    [523,659,784].forEach((f,i)=>tick(f,.16,i*.1));
    resultIcon.textContent=STAGES[stageIndex].emoji;
    resultTitle.textContent="抜けた！";
    resultBody.textContent=`クリアタイム ${elapsed.toFixed(2)}秒`;
    resultNext.textContent=stageIndex===STAGES.length-1?"最初から遊ぶ":"次のステージ";
    setTimeout(()=>resultDialog.showModal(),220);
  }

  function updateUI(){
    const pct=tracedCount/N*100;
    progressBar.style.width=pct+"%";
    progressText.textContent=Math.round(pct)+"%";
    stateText.textContent=
      state==="green"?"GREEN":
      state==="white"?"OUTSIDE":
      state==="yellow"?"CAUTION":
      state==="red"?"MISS":"READY";
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle="#e8c783";ctx.fillRect(0,0,W,H);

    ctx.save();
    ctx.globalAlpha=.07;ctx.strokeStyle="#76522f";ctx.lineWidth=2;
    for(let i=-H;i<W+H;i+=22){
      ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i-H,H);ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    shape.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.closePath();
    ctx.fillStyle="rgba(255,248,226,.28)";
    ctx.fill();

    ctx.strokeStyle="rgba(76,47,22,.24)";ctx.lineWidth=25;ctx.stroke();
    ctx.strokeStyle="#f5e6c2";ctx.lineWidth=12;ctx.stroke();
    ctx.setLineDash([5,10]);ctx.strokeStyle="#6f5639";ctx.lineWidth=3;ctx.stroke();
    ctx.setLineDash([]);

    ctx.lineWidth=7;ctx.strokeStyle="#2fa36b";
    for(let i=0;i<N;i++){
      if(!traced[i])continue;
      const a=shape[i],b=shape[(i+1)%N];
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }

    const s=shape[0];
    ctx.fillStyle="#efb936";ctx.beginPath();ctx.arc(s.x,s.y,15,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#fff8e8";ctx.lineWidth=5;ctx.stroke();

    ctx.fillStyle="rgba(45,36,29,.72)";
    ctx.font="900 22px -apple-system,sans-serif";
    ctx.textAlign="center";
    ctx.fillText(STAGES[stageIndex].name,C.x,54);
    ctx.restore();

    drawNeedle();
  }

  function drawNeedle(){
    let col="#8a939c";
    if(state==="green")col="#2fa36b";
    else if(state==="white"||state==="yellow")col="#efcf73";
    else if(state==="red")col="#d94a3a";

    ctx.save();
    ctx.fillStyle=dragging?"rgba(255,255,255,.78)":"rgba(255,255,255,.46)";
    ctx.beginPath();ctx.arc(needle.handle.x,needle.handle.y,GRAB_R,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="rgba(64,54,45,.35)";ctx.lineWidth=3;ctx.stroke();

    ctx.strokeStyle="#41484f";ctx.lineWidth=10;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(needle.handle.x,needle.handle.y-8);ctx.lineTo(needle.tip.x,needle.tip.y+8);ctx.stroke();
    ctx.strokeStyle="#dce3e8";ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(needle.handle.x-2,needle.handle.y-12);ctx.lineTo(needle.tip.x-2,needle.tip.y+11);ctx.stroke();

    ctx.fillStyle=col;ctx.beginPath();ctx.arc(needle.tip.x,needle.tip.y,9,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(needle.tip.x,needle.tip.y,3.5,0,Math.PI*2);ctx.fill();

    if(!started&&!dragging){
      ctx.fillStyle="rgba(45,36,29,.75)";
      ctx.font="800 16px -apple-system,sans-serif";
      ctx.textAlign="center";
      ctx.fillText("ここをつかむ",needle.handle.x,needle.handle.y+55);
    }
    ctx.restore();
  }

  function distanceSegment(p,a,b){
    const dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
  }

  function loop(){
    if(started&&!failed&&!cleared){
      elapsed=(performance.now()-startTime)/1000;
      timerEl.textContent=elapsed.toFixed(1)+"s";
    }
    raf=requestAnimationFrame(loop);
  }

  function vibrate(p){if(navigator.vibrate)navigator.vibrate(p)}
  function ensureAudio(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)()}
  function tick(freq,duration,delay=0){
    if(!soundOn)return;
    try{
      ensureAudio();
      const o=audioCtx.createOscillator(),g=audioCtx.createGain();
      o.frequency.value=freq;o.type="triangle";
      g.gain.setValueAtTime(.0001,audioCtx.currentTime+delay);
      g.gain.exponentialRampToValueAtTime(.07,audioCtx.currentTime+delay+.008);
      g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+delay+duration);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime+delay);o.stop(audioCtx.currentTime+delay+duration+.02);
    }catch(_){}
  }
  let lastScratch=0;
  function scratch(){
    const now=performance.now();
    if(now-lastScratch<90)return;
    lastScratch=now;tick(720+Math.random()*90,.018);vibrate(4);
  }

  canvas.addEventListener("pointerdown",onDown,{passive:false});
  canvas.addEventListener("pointermove",onMove,{passive:false});
  canvas.addEventListener("pointerup",onUp,{passive:false});
  canvas.addEventListener("pointercancel",onUp,{passive:false});

  resetBtn.addEventListener("click",reset);
  nextBtn.addEventListener("click",()=>{
    if(!cleared)return;
    stageIndex=(stageIndex+1)%STAGES.length;reset();
  });
  resultNext.addEventListener("click",()=>{
    resultDialog.close();
    stageIndex=(stageIndex+1)%STAGES.length;reset();
  });
  soundBtn.addEventListener("click",()=>{
    soundOn=!soundOn;soundBtn.textContent=soundOn?"🔊":"🔇";
  });
  resultDialog.addEventListener("cancel",e=>e.preventDefault());

  reset();loop();
})();
