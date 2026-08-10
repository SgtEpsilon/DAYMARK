const $ = id => document.getElementById(id);

const paramInputs = ['orbitalPeriod','rotationPeriod','axialTilt','eccentricity','argPeriapsis'];

const PALETTE_LABELS = {
  default:'Default', icy:'Icy body', rockyIce:'Rocky ice body', rocky:'Rocky body',
  highMetal:'High metal content world', metalRich:'Metal-rich body', earthlike:'Earth-like world',
  waterWorld:'Water world', waterGiant:'Water giant', ammonia:'Ammonia world', gasGiant:'Gas giant'
};

let currentPaletteKey = 'default';
let currentHasAtmosphere = false;

function setPalette(key,hasAtmosphere,sourceLabel){
  currentPaletteKey = PALETTE_LABELS[key] ? key : 'default';
  currentHasAtmosphere = !!hasAtmosphere;
  $('planetType').value = currentPaletteKey;
  const suffix = currentHasAtmosphere ? ' + atmosphere haze' : '';
  $('paletteCaption').textContent = `Palette: ${PALETTE_LABELS[currentPaletteKey]}${suffix}${sourceLabel ? ' ('+sourceLabel+')' : ''}`;
}

const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

// The timebar slider's range: +/-5 years either side of "now" (t = 0).
const TIMEBAR_MAX_DAYS = 1826;

// Elite Dangerous is set 1286 years after its 2014 launch year (2014 -> 3300),
// and that offset stays fixed as real time passes. The game exposes no way
// to know a planet's actual orbital phase at a given real moment, so this is
// only used for display and as the "now" anchor's t = 0 reference point.
function edNow(){
  const d = new Date();
  const ed = new Date(d.getTime());
  ed.setUTCFullYear(d.getUTCFullYear()+1286);
  return ed;
}
function fmtEDDateTime(d){
  return d.toISOString().replace('T',' ').replace(/:\d\d\.\d+Z$/,'').concat(' ED');
}
function fmtHours(h){
  const sign = h<0 ? '-' : '';
  h = Math.abs(h);
  const whole = Math.floor(h);
  const mins = Math.round((h-whole)*60);
  return mins===60 ? `${sign}${whole+1}h 0m` : `${sign}${whole}h ${mins}m`;
}

// Formats a day offset as "+2y 34d" / "-146d" / "now" for the timebar readout.
function fmtOffsetDays(days){
  if(days===0) return 'now';
  const sign = days<0 ? '-' : '+';
  const a = Math.abs(days);
  const years = Math.floor(a/365.25);
  const rem = Math.round(a-years*365.25);
  return years>0 ? `${sign}${years}y ${rem}d` : `${sign}${rem}d`;
}

function readInputs(){
  const p = {
    P: +$('orbitalPeriod').value,
    R: +$('rotationPeriod').value,
    tilt: +$('axialTilt').value,
    e: +$('eccentricity').value,
    arg: +$('argPeriapsis').value,
    latStep: +$('latStep').value,
    lonStep: +$('lonStep').value,
    N: +$('samples').value,
    paletteKey: currentPaletteKey,
    hasAtmosphere: currentHasAtmosphere,
    restrictWindow: $('restrictWindow').checked,
    startOffsetDays: $('windowAnchor').value==='custom' ? (+$('windowStartOffset').value || 0) : 0,
    durationDays: Math.max((+$('windowDurationHours').value || 24)/24, 1/1440)
  };
  p.e = Math.max(0, Math.min(0.99, p.e));
  return p;
}

// Validates each field individually and highlights the offending one(s),
// rather than a single generic error for the whole form.
function validateInputs(p){
  const problems = [];
  if(!Number.isFinite(p.P) || p.P<=0){ problems.push('orbitalPeriod'); }
  if(!Number.isFinite(p.R) || p.R<=0){ problems.push('rotationPeriod'); }
  if(!Number.isFinite(p.tilt)){ problems.push('axialTilt'); }
  if(!Number.isFinite(+$('eccentricity').value)){ problems.push('eccentricity'); }
  if(!Number.isFinite(p.arg)){ problems.push('argPeriapsis'); }
  return problems;
}

function clearFieldErrors(){
  paramInputs.forEach(id => $(id).classList.remove('invalid'));
  $('fieldError').hidden = true;
}

function showFieldErrors(problems){
  clearFieldErrors();
  problems.forEach(id => $(id).classList.add('invalid'));
  $('fieldError').hidden = false;
  $('fieldError').textContent = 'Enter a valid number for the highlighted field(s). Orbital and rotational periods must be greater than zero.';
}

let worker = null;
function getWorker(){
  if(!worker){
    worker = new Worker('worker.js');
    worker.onmessage = handleWorkerMessage;
  }
  return worker;
}

function handleWorkerMessage(e){
  const msg = e.data;
  if(msg.type === 'progress'){
    $('progressBar').style.width = msg.pct + '%';
  } else if(msg.type === 'gridResult'){
    showResult(msg.best, msg.count, msg.samples, msg.model, msg.useWindow, msg.startDays, msg.spanDays);
  } else if(msg.type === 'heatmapResult'){
    drawHeatmapImage(msg.w, msg.h, msg.pixels, msg.best);
    $('progressBar').style.width = '100%';
    $('message').textContent = $('message').textContent.replace('Rendering heatmap…','Done.');
    setBusy(false);
  } else if(msg.type === 'timelineResult'){
    renderTimeline(msg);
  } else if(msg.type === 'heatmapOnlyResult'){
    // Live preview from the timebar slider — redraws the heatmap only.
    // The "best location" marker keeps showing wherever the last full
    // analysis found it; it isn't recomputed on every drag tick.
    drawHeatmapImage(msg.w, msg.h, msg.pixels, lastBest);
    timebarInFlight = false;
    if(timebarPending){
      const next = timebarPending;
      timebarPending = null;
      requestHeatmapPreview(next.days, next.live);
    }
  }
}

function setBusy(busy){
  $('calculate').hidden = busy;
  $('cancel').hidden = !busy;
  $('loadExample').disabled = busy;
  $('timebar').disabled = busy;
  $('timebarReset').disabled = busy;
  $('progressWrap').hidden = !busy;
  if(!busy) $('progressBar').style.width = '0%';
}

function drawHeatmapImage(w,h,pixels,best){
  const c = $('heatmap'), ctx = c.getContext('2d');
  const image = new ImageData(new Uint8ClampedArray(pixels), w, h);
  ctx.putImageData(image, 0, 0);

  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1;
  for(let lon=-180; lon<=180; lon+=30){
    const x = (lon+180)/360*w;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
  }
  for(let lat=-60; lat<=60; lat+=30){
    const y = (90-lat)/180*h;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
  }

  if(best){
    const bx = (best.lon+180)/360*w, by = (90-best.lat)/180*h;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(bx,by,5,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(bx,by,10,0,Math.PI*2); ctx.stroke();
  }
}

let lastBest = null;

function showResult(best,count,samples,model,useWindow,startDays,spanDays){
  lastBest = best;
  $('bestLat').textContent = best.lat.toFixed(2)+'°';
  $('bestLon').textContent = best.lon.toFixed(2)+'°';
  $('daylightPct').textContent = (best.daylight*100).toFixed(2)+'%';
  $('longestDay').textContent = best.longestDay.toFixed(2)+' d';
  $('longestNight').textContent = best.longestNight.toFixed(2)+' d';
  $('avgAlt').textContent = best.sumAlt.toFixed(2)+'°';
  $('minAlt').textContent = best.minAlt.toFixed(2)+'°';
  $('maxAlt').textContent = best.maxAlt.toFixed(2)+'°';
  $('rotationModel').textContent = model;
  const scopeLabel = useWindow
    ? `${fmtHours(spanDays*24)} window starting ${startDays===0 ? 'now' : `+${startDays.toFixed(2)}d`}`
    : 'full orbit';
  $('message').textContent = `Search complete (${scopeLabel}): ${count.toLocaleString()} surface points × ${samples.toLocaleString()} orbital samples. Rendering heatmap…`;
}

// Draws the day/night timeline as a horizontal strip (reusing the same
// lit-fraction-to-color idea as the heatmap, but 1D over time) plus tick
// marks at sensible hour intervals.
function drawTimelineStrip(samples,spanDays){
  const c = $('timelineCanvas'), ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  ctx.clearRect(0,0,w,h);
  const barTop = 10, barH = 30;
  for(let x=0;x<w;x++){
    const i = Math.min(samples.length-1, Math.floor(x/w*samples.length));
    ctx.fillStyle = samples[i].isLit ? '#d2dfb6' : '#141d21';
    ctx.fillRect(x,barTop,1,barH);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 1;
  ctx.strokeRect(0,barTop,w,barH);

  const totalHours = spanDays*24;
  const step = totalHours<=6 ? 1 : totalHours<=48 ? 6 : totalHours<=240 ? 24 : Math.ceil(totalHours/10/24)*24;
  ctx.fillStyle = '#7e8a90'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
  for(let hr=0; hr<=totalHours+0.001; hr+=step){
    const x = clamp(hr/totalHours*w,0,w);
    ctx.beginPath(); ctx.moveTo(x,barTop+barH); ctx.lineTo(x,barTop+barH+5); ctx.strokeStyle='#46545a'; ctx.stroke();
    ctx.fillText(`+${hr}h`, clamp(x,20,w-20), barTop+barH+18);
  }
}

function renderTimeline(msg){
  const { samples, daylight, longestDay, longestNight, startDays, spanDays, anchorNow, edStart } = msg;
  drawTimelineStrip(samples, spanDays);

  const startLabel = anchorNow ? 'now' : `+${startDays.toFixed(2)}d from t=0`;
  const edLabel = anchorNow && edStart ? ` (${fmtEDDateTime(new Date(edStart))})` : '';
  $('timelineInfo').innerHTML =
    `Window: ${fmtHours(spanDays*24)} starting ${startLabel}${edLabel} · `+
    `In daylight ${(daylight*100).toFixed(1)}% of window · `+
    `Longest continuous day ${fmtHours(longestDay*24)} · longest continuous night ${fmtHours(longestNight*24)}`;

  // Build a human-readable list of day/night segments from the sample run.
  const segments = [];
  let segStart = samples[0].t, segLit = samples[0].isLit;
  for(let i=1;i<samples.length;i++){
    if(samples[i].isLit !== segLit){
      segments.push({lit:segLit, start:segStart, end:samples[i].t});
      segStart = samples[i].t; segLit = samples[i].isLit;
    }
  }
  segments.push({lit:segLit, start:segStart, end:samples[samples.length-1].t});

  const list = $('timelineList');
  list.innerHTML = '';
  segments.forEach(seg => {
    const div = document.createElement('div');
    div.className = seg.lit ? 'day' : 'night';
    const s = (seg.start-startDays)*24, e = (seg.end-startDays)*24;
    div.textContent = `${seg.lit ? 'DAY  ' : 'NIGHT'}  +${fmtHours(s)} → +${fmtHours(e)}`;
    list.appendChild(div);
  });
}

// Maps an EDSM body subType string to one of this app's palette keys.
// Checked in order — more specific matches (e.g. "water giant") must be
// tested before their broader relatives (e.g. "water world").
function classifyBody(subType){
  const s = (subType||'').toLowerCase();
  if(s.includes('water giant')) return 'waterGiant';
  if(s.includes('water world')) return 'waterWorld';
  if(s.includes('ammonia')) return 'ammonia';
  if(s.includes('earth')) return 'earthlike';
  if(s.includes('metal-rich') || s.includes('metal rich')) return 'metalRich';
  if(s.includes('high metal content')) return 'highMetal';
  if(s.includes('rocky ice')) return 'rockyIce';
  if(s.includes('icy')) return 'icy';
  if(s.includes('rocky')) return 'rocky';
  if(s.includes('gas giant') || s.includes('giant with')) return 'gasGiant';
  return 'default';
}

function hasAtmosphere(body){
  const a = body.atmosphereType;
  return !!a && a.toLowerCase() !== 'no atmosphere';
}

// Fills the five orbital fields from an EDSM body record. EDSM sometimes
// returns null for eccentricity/tilt on bodies with incomplete scans —
// those fall back to 0 rather than leaving the field invalid.
//
// EDSM's axialTilt field is a known special case: the underlying Elite
// Dangerous journal stores axial tilt in radians (everything else EDSM
// converts to normal in-game units, but this one field is passed through
// unconverted). It has to be turned into degrees here, or a real 23.4°
// tilt like Earth's shows up as "0.4°".
function applyBodyData(body){
  $('orbitalPeriod').value = Number.isFinite(body.orbitalPeriod) ? body.orbitalPeriod : $('orbitalPeriod').value;
  $('rotationPeriod').value = Number.isFinite(body.rotationalPeriod) ? Math.abs(body.rotationalPeriod) : $('rotationPeriod').value;
  $('axialTilt').value = Number.isFinite(body.axialTilt) ? (body.axialTilt * 180 / Math.PI) : 0;
  $('eccentricity').value = Number.isFinite(body.orbitalEccentricity) ? body.orbitalEccentricity : 0;
  $('argPeriapsis').value = Number.isFinite(body.argOfPeriapsis) ? body.argOfPeriapsis : 0;
  paramInputs.forEach(id => $(id).classList.remove('invalid'));

  const key = classifyBody(body.subType);
  setPalette(key, hasAtmosphere(body), body.name);

  const missing = [];
  if(!Number.isFinite(body.orbitalEccentricity)) missing.push('eccentricity');
  if(!Number.isFinite(body.axialTilt)) missing.push('axial tilt');
  const missingNote = missing.length ? ` (EDSM had no ${missing.join(' or ')} data — set to 0)` : '';
  $('edsmStatus').textContent = `Loaded ${body.name} — ${body.subType||'unknown type'}${missingNote}.`;
}

async function edsmFetchBodies(){
  const system = $('edsmSystem').value.trim();
  if(!system){
    $('edsmStatus').textContent = 'Enter a system name first.';
    return;
  }
  $('edsmPickWrap').hidden = true;
  $('edsmStatus').textContent = 'Contacting EDSM…';
  $('edsmFetch').disabled = true;
  try{
    const res = await fetch('https://www.edsm.net/api-system-v1/bodies?systemName='+encodeURIComponent(system));
    if(!res.ok) throw new Error('EDSM request failed ('+res.status+')');
    const data = await res.json();
    const bodies = (data && data.bodies) ? data.bodies.filter(b => b.type === 'Planet') : [];
    if(!bodies.length){
      $('edsmStatus').textContent = data && data.name ? `No planets found in ${data.name} on EDSM.` : 'System not found on EDSM.';
      return;
    }

    const designation = $('edsmBody').value.trim().toLowerCase();
    let match = null;
    if(designation){
      match = bodies.find(b => b.name.toLowerCase() === (system+' '+designation).toLowerCase())
           || bodies.find(b => b.name.toLowerCase().endsWith(designation));
      if(!match){
        $('edsmStatus').textContent = `No planet matching "${$('edsmBody').value.trim()}" in ${data.name}. Showing all planets found instead.`;
      }
    }

    if(match){
      applyBodyData(match);
      return;
    }

    if(bodies.length === 1){
      applyBodyData(bodies[0]);
      return;
    }

    // Ambiguous — let the user pick from what EDSM actually has.
    const sel = $('edsmPick');
    sel.innerHTML = '';
    bodies.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.name;
      opt.textContent = `${b.name} — ${b.subType||'unknown type'}`;
      sel.appendChild(opt);
    });
    $('edsmPickWrap').hidden = false;
    $('edsmPick').dataset.bodies = JSON.stringify(bodies);
    if(!designation) $('edsmStatus').textContent = `${bodies.length} planets found in ${data.name} — pick one below.`;
  }catch(err){
    $('edsmStatus').textContent = 'Could not reach EDSM (' + err.message + '). You can still set the planet type manually below.';
  }finally{
    $('edsmFetch').disabled = false;
  }
}

function calculate(){
  const p = readInputs();
  const problems = validateInputs(p);
  if(problems.length){
    showFieldErrors(problems);
    return;
  }
  clearFieldErrors();

  setBusy(true);
  $('message').textContent = p.restrictWindow ? 'Running windowed numerical search…' : 'Running full-orbit numerical search…';

  getWorker().postMessage({ type:'run', params:p });
}

function checkTimeline(){
  const p = readInputs();
  const problems = validateInputs(p);
  if(problems.length){
    showFieldErrors(problems);
    return;
  }
  clearFieldErrors();

  const lat = clamp(+$('tlLat').value || 0, -90, 90);
  const lon = clamp(+$('tlLon').value || 0, -180, 180);
  const anchorNow = $('windowAnchor').value === 'now';
  const startDays = anchorNow ? 0 : p.startOffsetDays;
  const spanDays = p.durationDays;

  $('timelineInfo').textContent = 'Computing…';
  getWorker().postMessage({
    type:'timeline',
    params: p,
    lat, lon, startDays, spanDays,
    N: 500,
    anchorNow,
    edStart: anchorNow ? edNow().toISOString() : null
  });
}

function cancelCalculation(){
  if(worker) worker.postMessage({ type:'cancel' });
  setBusy(false);
  $('message').textContent = 'Analysis cancelled.';
}

$('calculate').addEventListener('click', calculate);
$('cancel').addEventListener('click', cancelCalculation);
$('loadExample').addEventListener('click', () => {
  $('orbitalPeriod').value = 16.9;
  $('rotationPeriod').value = 16.9;
  $('axialTilt').value = 124.74;
  $('eccentricity').value = 0.0002;
  $('argPeriapsis').value = 191.20;
  setPalette('default', false, null);
  calculate();
});

$('edsmFetch').addEventListener('click', edsmFetchBodies);
['edsmSystem','edsmBody'].forEach(id => {
  $(id).addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); edsmFetchBodies(); }
  });
});
$('edsmPick').addEventListener('change', () => {
  const bodies = JSON.parse($('edsmPick').dataset.bodies || '[]');
  const body = bodies.find(b => b.name === $('edsmPick').value);
  if(body) applyBodyData(body);
});
$('planetType').addEventListener('change', () => {
  setPalette($('planetType').value, false, 'manual');
});

paramInputs.forEach(id => {
  const input = $(id);
  input.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); calculate(); }
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => input.classList.remove('invalid'));
});

$('windowAnchor').addEventListener('change', () => {
  $('windowStartWrap').hidden = $('windowAnchor').value !== 'custom';
  if($('windowAnchor').value === 'now'){
    $('timebar').value = 0;
    updateTimebarReadout(0);
    requestHeatmapPreview(0, false);
  }
});

// --- Timebar: scrubs the heatmap across +/-5 years without touching the
// optimizer. The worker runs one message to completion at a time — the
// runId check in worker.js can only abort a frame *between* messages, not
// mid-frame — so simply firing a request per drag tick would queue up a
// backlog that keeps rendering (visibly flickering through old frames)
// long after the slider stops moving.
//
// Instead, only one heatmapOnly request is ever in flight. Anything that
// comes in while the worker is busy just overwrites a single "pending"
// slot; the moment the worker replies, that latest pending request (and
// only that one) gets sent. Intermediate slider positions are dropped
// rather than queued, so there's nothing left to drain once you stop.
let timebarInFlight = false;
let timebarPending = null;
function requestHeatmapPreview(days, live){
  const p = readInputs();
  if(validateInputs(p).length) return; // don't preview with invalid params
  if(timebarInFlight){
    timebarPending = { days, live };
    return;
  }
  timebarInFlight = true;
  const spanDays = Math.max((+$('windowDurationHours').value || 24)/24, 1/1440);
  const quickN = live ? Math.min(60, p.N) : Math.min(240, p.N);
  getWorker().postMessage({ type:'heatmapOnly', params:p, startDays:days, spanDays, quickN });
}

function updateTimebarReadout(days){
  const edDate = new Date(edNow().getTime() + days*86400000);
  const durLabel = fmtHours(+$('windowDurationHours').value || 24);
  $('timebarReadout').textContent =
    `Previewing ${fmtOffsetDays(days)} (${fmtEDDateTime(edDate)}) · ${durLabel} window`;
}

// Keeps the existing "Start / Custom offset" controls in sync with the
// slider, so a subsequent "Restrict analysis to this window" run lines up
// with whatever moment was last scrubbed to.
function syncWindowFieldsFromTimebar(days){
  if(days === 0){
    $('windowAnchor').value = 'now';
    $('windowStartWrap').hidden = true;
  } else {
    $('windowAnchor').value = 'custom';
    $('windowStartWrap').hidden = false;
    $('windowStartOffset').value = days;
  }
}

let timebarPreviewQueued = false;
function scheduleLivePreview(days){
  if(timebarPreviewQueued) return;
  timebarPreviewQueued = true;
  requestAnimationFrame(() => {
    timebarPreviewQueued = false;
    requestHeatmapPreview(days, true);
  });
}

$('timebar').addEventListener('input', () => {
  const days = +$('timebar').value;
  syncWindowFieldsFromTimebar(days);
  updateTimebarReadout(days);
  scheduleLivePreview(days);
});
$('timebar').addEventListener('change', () => {
  // Slider released (or moved via keyboard) — follow up with a
  // full-quality render instead of the cheap live-drag preview.
  requestHeatmapPreview(+$('timebar').value, false);
});
$('timebarReset').addEventListener('click', () => {
  $('timebar').value = 0;
  syncWindowFieldsFromTimebar(0);
  updateTimebarReadout(0);
  requestHeatmapPreview(0, false);
});
$('windowStartOffset').addEventListener('input', () => {
  if($('windowAnchor').value !== 'custom') return;
  const days = clamp(+$('windowStartOffset').value || 0, -TIMEBAR_MAX_DAYS, TIMEBAR_MAX_DAYS);
  $('timebar').value = days;
  updateTimebarReadout(days);
  scheduleLivePreview(days);
});
$('windowDurationHours').addEventListener('input', () => {
  const days = +$('timebar').value;
  updateTimebarReadout(days);
  scheduleLivePreview(days);
});
$('windowDurationHours').addEventListener('change', () => {
  requestHeatmapPreview(+$('timebar').value, false);
});
updateTimebarReadout(0);

$('tlCheck').addEventListener('click', checkTimeline);
$('tlUseBest').addEventListener('click', () => {
  if(!lastBest){ $('timelineInfo').textContent = 'Run the full analysis first to get optimal coordinates.'; return; }
  $('tlLat').value = lastBest.lat.toFixed(2);
  $('tlLon').value = lastBest.lon.toFixed(2);
  checkTimeline();
});
['tlLat','tlLon','windowStartOffset','windowDurationHours'].forEach(id => {
  $(id).addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); checkTimeline(); }
  });
});

function tickEDClock(){
  $('edClock').textContent = `Current ED time: ${fmtEDDateTime(edNow())}`;
}
tickEDClock();
setInterval(tickEDClock, 30000);

calculate();
