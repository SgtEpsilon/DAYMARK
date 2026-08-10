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

// Heatmap color palettes, keyed by a simplified planet-type classification.
// dark = color at 0% daylight, lit = color at 100% daylight; every pixel is
// a linear blend between the two based on its lit fraction. "default"
// reproduces the app's original teal-gray look exactly, so a run with no
// planet-type data behaves exactly as before.
const PALETTES = {
  default:   { dark:[11,12,11],  lit:[200,217,204] },
  icy:       { dark:[8,14,20],   lit:[214,238,247] },
  rockyIce:  { dark:[10,14,16],  lit:[196,214,214] },
  rocky:     { dark:[18,12,8],   lit:[196,158,120] },
  highMetal: { dark:[14,12,10],  lit:[176,168,158] },
  metalRich: { dark:[16,14,12],  lit:[214,196,150] },
  earthlike: { dark:[6,14,18],   lit:[140,205,180] },
  waterWorld:{ dark:[4,16,24],   lit:[110,196,224] },
  waterGiant:{ dark:[6,18,28],   lit:[120,200,232] },
  ammonia:   { dark:[16,12,4],   lit:[214,188,110] },
  gasGiant:  { dark:[14,10,8],   lit:[224,176,120] }
};

function lerp(a,b,t){ return a+(b-a)*t; }

// A thin atmosphere lightens/hazes both ends of the palette slightly.
function hazePalette(pal,hasAtmosphere){
  if(!hasAtmosphere) return pal;
  const mix=(c)=>c.map(v=>Math.round(lerp(v,255,0.12)));
  return { dark:mix(pal.dark), lit:mix(pal.lit) };
}

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
//
// startDays/spanDays let the sampled window be something other than the
// full orbit (0..P) — e.g. a 24h slice starting "now". t is always an
// absolute time-since-t=0 in days; the orbital/spin phase (M and spin)
// are computed from t directly, so a window that starts partway through
// the orbit still lands on the correct phase rather than restarting at
// periapsis.
function buildStates(p,N,startDays,spanDays){
  const start = startDays||0;
  const span = (spanDays===undefined||spanDays===null) ? p.P : spanDays;
  const dt=span/N;
  const arg=rad(p.arg);
  const tiltSin=Math.sin(rad(p.tilt));
  const delta=new Float64Array(N);
  const subsolarLon=new Float64Array(N);
  for(let i=0;i<N;i++){
    const t=start+i*dt;
    // M is left unwrapped (not reduced mod 2π) — solveKepler's bracket
    // [M-e,M+e] is valid for any real M since the equation is periodic,
    // and keeping t absolute means a window starting mid-orbit still
    // lands on the correct phase instead of restarting at periapsis.
    const M=2*Math.PI*t/p.P;
    const E=solveKepler(M,p.e);
    const nu=2*Math.atan2(Math.sqrt(1+p.e)*Math.sin(E/2),Math.sqrt(1-p.e)*Math.cos(E/2));
    delta[i]=Math.asin(tiltSin*Math.sin(nu+arg));
    const spin=2*Math.PI*t/p.R;
    subsolarLon[i]=deg(spin-(nu+arg));
  }
  return {delta,subsolarLon,dt,N,start};
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

function heatmapRow(y,h,w,quickStates,palette){
  const lat=90-y/(h-1)*180;
  const phi=rad(lat), sinPhi=Math.sin(phi), cosPhi=Math.cos(phi);
  const {delta,subsolarLon,N}=quickStates;
  const {dark,lit}=palette;
  const row=new Uint8ClampedArray(w*4);
  for(let x=0;x<w;x++){
    const lon=x/(w-1)*360-180;
    let count=0;
    for(let i=0;i<N;i++){
      const H=rad(lon-subsolarLon[i]);
      const s=Math.asin(clamp(sinPhi*Math.sin(delta[i])+cosPhi*Math.cos(delta[i])*Math.cos(H),-1,1));
      if(deg(s)>=-0.833) count++;
    }
    const q=count/N;
    const idx=x*4;
    row[idx]  =Math.round(lerp(dark[0],lit[0],q));
    row[idx+1]=Math.round(lerp(dark[1],lit[1],q));
    row[idx+2]=Math.round(lerp(dark[2],lit[2],q));
    row[idx+3]=255;
  }
  return row;
}

// Given per-sample lit states at one fixed lat/lon, find the longest
// continuous day and night runs within the window. Shared by the
// optimizer's row evaluation (evaluateRow, above) and the timeline check.
function trackRuns(dt,N,isLitAt){
  let longestDay=0,longestNight=0,run=0,prevLit=null,lit=0;
  for(let i=0;i<N;i++){
    const isLit=isLitAt(i);
    if(isLit) lit++;
    if(prevLit===null){ run=dt; prevLit=isLit; }
    else if(isLit===prevLit){ run+=dt; }
    else{
      if(prevLit) longestDay=Math.max(longestDay,run); else longestNight=Math.max(longestNight,run);
      run=dt; prevLit=isLit;
    }
  }
  if(prevLit) longestDay=Math.max(longestDay,run); else longestNight=Math.max(longestNight,run);
  return {longestDay,longestNight,daylight:lit/N};
}

let currentRunId=0;

self.onmessage=function(e){
  const msg=e.data;
  if(msg.type==='cancel'){ currentRunId++; return; } // invalidates any in-flight run

  if(msg.type==='timeline'){
    // Single lat/lon, sampled only across the requested window — used by
    // the "Location timeline" panel rather than the full-grid optimizer.
    const runId=++currentRunId;
    const p=msg.params;
    const N=msg.N||400;
    const states=buildStates(p,N,msg.startDays,msg.spanDays);
    const {delta,subsolarLon,dt,start}=states;
    const phi=rad(msg.lat), sinPhi=Math.sin(phi), cosPhi=Math.cos(phi);
    const samples=new Array(N);
    for(let i=0;i<N;i++){
      const H=rad(msg.lon-subsolarLon[i]);
      const s=Math.asin(clamp(sinPhi*Math.sin(delta[i])+cosPhi*Math.cos(delta[i])*Math.cos(H),-1,1));
      const alt=deg(s);
      samples[i]={t:start+i*dt,alt,isLit:alt>=-0.833};
    }
    if(runId!==currentRunId) return;
    const stats=trackRuns(dt,N,i=>samples[i].isLit);
    self.postMessage({type:'timelineResult',runId,samples,lat:msg.lat,lon:msg.lon,
      startDays:msg.startDays,spanDays:msg.spanDays,anchorNow:msg.anchorNow,edStart:msg.edStart,
      ...stats});
    return;
  }

  if(msg.type==='heatmapOnly'){
    // Lightweight heatmap-only pass used by the timebar slider: no grid
    // search over lat/lon for a new "best" point, just the visual daylight
    // render for the requested window. This is what makes the slider feel
    // live — the full optimizer (below) is far too expensive to re-run on
    // every drag tick, but this alone is cheap enough to run continuously.
    //
    // Reuses the same runId scheme as the full run: a new message (another
    // drag tick, or a full run starting) bumps currentRunId, and any
    // in-flight heatmapOnly pass notices at the next row and bails out
    // instead of wasting time finishing a stale frame.
    const runId=++currentRunId;
    const p=msg.params;
    const startDays=msg.startDays||0;
    const spanDays=(msg.spanDays===undefined||msg.spanDays===null) ? p.P : Math.max(msg.spanDays,1/1440);
    const w=msg.w||900, h=msg.h||420;
    const quickN=Math.max(2,Math.min(msg.quickN||240, p.N||240));

    const quickStates=buildStates(p,quickN,startDays,spanDays);
    const basePalette=PALETTES[p.paletteKey]||PALETTES.default;
    const palette=hazePalette(basePalette,!!p.hasAtmosphere);
    const pixels=new Uint8ClampedArray(w*h*4);
    for(let y=0;y<h;y++){
      if(runId!==currentRunId) return;
      const row=heatmapRow(y,h,w,quickStates,palette);
      pixels.set(row,y*w*4);
    }
    if(runId!==currentRunId) return;
    self.postMessage({type:'heatmapOnlyResult',runId,w,h,pixels:pixels.buffer,startDays,spanDays},[pixels.buffer]);
    return;
  }

  if(msg.type!=='run') return;

  const runId=++currentRunId;
  const p=msg.params;

  // A restricted window scans [startOffsetDays, startOffsetDays+durationDays)
  // instead of the full orbit [0,P). Everything downstream (grid search and
  // heatmap) is identical either way — only the sampled span changes.
  const useWindow=!!p.restrictWindow;
  const startDays=useWindow ? (p.startOffsetDays||0) : 0;
  const spanDays=useWindow ? Math.max(p.durationDays||(1/24),1/1440) : p.P;

  const states=buildStates(p,p.N,startDays,spanDays);
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

  self.postMessage({type:'gridResult',runId,best,count,samples:p.N,model,useWindow,startDays,spanDays});

  // Heatmap pass — separate, lower resolution than the optimizer.
  const w=900,h=420;
  const quickN=Math.min(240,p.N);
  const quickStates=buildStates(p,quickN,startDays,spanDays);
  const basePalette=PALETTES[p.paletteKey]||PALETTES.default;
  const palette=hazePalette(basePalette,!!p.hasAtmosphere);
  const pixels=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++){
    if(runId!==currentRunId) return;
    const row=heatmapRow(y,h,w,quickStates,palette);
    pixels.set(row,y*w*4);
    if(y%40===0) self.postMessage({type:'progress',runId,pct:65+Math.round((y/h)*35)});
  }
  if(runId!==currentRunId) return;

  self.postMessage({type:'heatmapResult',runId,w,h,pixels:pixels.buffer,best},[pixels.buffer]);
};
