// DAYMARK compute worker.
//
// All of the heavy numerical work — the full-orbit grid search and the
// heatmap sampling — runs here, off the main thread. That's what actually
// fixes the jank: no matter how long a run takes, the page itself never
// freezes, stays scrollable, and the Cancel button stays clickable.
//
// The physical model itself (declination from axial tilt + true anomaly,
// subsolar longitude from spin phase) is intentionally UNCHANGED from the
// original app, so coordinates you've already found in-game still match.
// What changed is the implementation: redundant recomputation is gone, and
// the Kepler solver is now numerically robust (see solveKepler below).

function rad(d){ return d*Math.PI/180; }
function deg(r){ return r*180/Math.PI; }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

// Solve Kepler's equation E - e*sin(E) = M for E.
//
// The original app used a fixed 12-step plain Newton iteration. That works
// fine for gentle eccentricities, but plain Newton has no safeguard against
// overshooting — and for eccentricities approaching the input's own allowed
// maximum (e = 0.99) it can diverge completely, silently returning garbage
// results with no error.
//
// The root always lies within [M-e, M+e], since |E-M| = |e*sin(E)| <= e.
// This version uses that bracket to guard every Newton step: if a step
// would leave the bracket, it falls back to bisection instead. That
// guarantees convergence for every valid eccentricity (0 to 0.99), while
// still converging in only 3-5 iterations for the gentle orbits most
// planets will actually use.
function solveKepler(M,e){
  let lo=M-e, hi=M+e;
  let E=M+e*Math.sin(M);
  for(let i=0;i<50;i++){
    const f=E-e*Math.sin(E)-M;
    if(f>0) hi=E; else lo=E;
    const fp=1-e*Math.cos(E);
    let step=f/fp;
    let next=E-step;
    if(next<=lo||next>=hi) next=(lo+hi)/2;
    if(Math.abs(next-E)<1e-12){ E=next; break; }
    E=next;
  }
  return E;
}

// The orbital/solar state at a sample time depends only on the planet's
// parameters, never on which surface coordinate is being tested. The
// original app recomputed it (including a Kepler solve) once per
// lat/lon/sample combination — tens of millions of redundant solves per
// run. Building the full set of per-sample states once and reusing them
// for every surface point removes that waste entirely.
function buildStates(p,N){
  const dt=p.P/N;
  const arg=rad(p.arg);
  const tiltSin=Math.sin(rad(p.tilt));
  const delta=new Float64Array(N);
  const subsolarLon=new Float64Array(N);
  for(let i=0;i<N;i++){
    const t=i*dt;
    const M=2*Math.PI*t/p.P;
    const E=solveKepler(M,p.e);
    const nu=2*Math.atan2(Math.sqrt(1+p.e)*Math.sin(E/2),Math.sqrt(1-p.e)*Math.cos(E/2));
    delta[i]=Math.asin(tiltSin*Math.sin(nu+arg));
    const spin=2*Math.PI*t/p.R;
    subsolarLon[i]=deg(spin-(nu+arg));
  }
  return {delta,subsolarLon,dt,N};
}

// Evaluate every longitude at one latitude. sin(lat)/cos(lat) depend only
// on the latitude, not the longitude or sample — the original app
// recomputed them for every longitude at a given latitude too, which for
// the default grid is another 360x redundant trig call per row. Hoisting
// them out here is a further, purely mechanical speedup.
function evaluateRow(lat,lonStep,lonCount,states,best){
  const phi=rad(lat);
  const sinPhi=Math.sin(phi), cosPhi=Math.cos(phi);
  const {delta,subsolarLon,dt,N}=states;
  for(let li=0; li<lonCount; li++){
    const lon=-180+li*lonStep;
    let lit=0,sum=0,min=90,max=-90;
    let longestDay=0,longestNight=0,run=0,prevLit=null;
    for(let i=0;i<N;i++){
      const H=rad(lon-subsolarLon[i]);
      const s=Math.asin(clamp(sinPhi*Math.sin(delta[i])+cosPhi*Math.cos(delta[i])*Math.cos(H),-1,1));
      const alt=deg(s);
      const isLit=alt>=-0.833; // approximate visible sunrise/set including refraction
      if(isLit) lit++;
      sum+=alt; if(alt<min)min=alt; if(alt>max)max=alt;
      if(prevLit===null){ run=dt; prevLit=isLit; }
      else if(isLit===prevLit){ run+=dt; }
      else{
        if(prevLit) longestDay=Math.max(longestDay,run); else longestNight=Math.max(longestNight,run);
        run=dt; prevLit=isLit;
      }
    }
    if(prevLit) longestDay=Math.max(longestDay,run); else longestNight=Math.max(longestNight,run);

    const daylight=lit/N;
    const score=daylight*0.60 + ((sum/N+90)/180)*0.30 + ((min+90)/180)*0.10;
    if(!best||score>best.score){
      best={lat,lon,daylight,sumAlt:sum/N,minAlt:min,maxAlt:max,longestDay,longestNight,score};
    }
  }
  return best;
}

function heatmapRow(y,h,w,quickStates,best){
  const lat=90-y/(h-1)*180;
  const phi=rad(lat), sinPhi=Math.sin(phi), cosPhi=Math.cos(phi);
  const {delta,subsolarLon,N}=quickStates;
  const row=new Uint8ClampedArray(w*4);
  for(let x=0;x<w;x++){
    const lon=x/(w-1)*360-180;
    let lit=0;
    for(let i=0;i<N;i++){
      const H=rad(lon-subsolarLon[i]);
      const s=Math.asin(clamp(sinPhi*Math.sin(delta[i])+cosPhi*Math.cos(delta[i])*Math.cos(H),-1,1));
      if(deg(s)>=-0.833) lit++;
    }
    const q=lit/N;
    const idx=x*4;
    const v=Math.round(12+q*205);
    row[idx]=Math.round(v*.92);
    row[idx+1]=Math.round(v);
    row[idx+2]=Math.round(v*.94);
    row[idx+3]=255;
  }
  return row;
}

let currentRunId=0;

self.onmessage=function(e){
  const msg=e.data;
  if(msg.type==='cancel'){ currentRunId++; return; } // invalidates any in-flight run
  if(msg.type!=='run') return;

  const runId=++currentRunId;
  const p=msg.params;

  const states=buildStates(p,p.N);
  const latCount=Math.floor(180/p.latStep)+1;
  const lonCount=Math.round(360/p.lonStep);

  let best=null, count=0;
  for(let li=0; li<latCount; li++){
    if(runId!==currentRunId) return; // a newer run superseded this one
    const lat=-90+li*p.latStep;
    best=evaluateRow(lat,p.lonStep,lonCount,states,best);
    count+=lonCount;
    if(li%3===0) self.postMessage({type:'progress',runId,pct:Math.round((li/latCount)*65)});
  }
  if(runId!==currentRunId) return;
  self.postMessage({type:'progress',runId,pct:65});

  const ratio=p.R/p.P;
  let model='NORMAL ROTATION';
  if(Math.abs(ratio-1)<0.005) model='SYNCHRONOUS / 1:1';
  else if(Math.abs(ratio-0.5)<0.005) model='2:1 SPIN-ORBIT';
  else if(Math.abs(ratio-2)<0.005) model='1:2 SPIN-ORBIT';

  self.postMessage({type:'gridResult',runId,best,count,samples:p.N,model});

  // Heatmap pass — separate, lower resolution than the optimizer.
  const w=900,h=420;
  const quickN=Math.min(240,p.N);
  const quickStates=buildStates(p,quickN);
  const pixels=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++){
    if(runId!==currentRunId) return;
    const row=heatmapRow(y,h,w,quickStates,best);
    pixels.set(row,y*w*4);
    if(y%40===0) self.postMessage({type:'progress',runId,pct:65+Math.round((y/h)*35)});
  }
  if(runId!==currentRunId) return;

  self.postMessage({type:'heatmapResult',runId,w,h,pixels:pixels.buffer,best},[pixels.buffer]);
};
