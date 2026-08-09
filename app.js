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
    hasAtmosphere: currentHasAtmosphere
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
  if(!worker) worker = new Worker('worker.js');
  return worker;
}

function setBusy(busy){
  $('calculate').hidden = busy;
  $('cancel').hidden = !busy;
  $('loadExample').disabled = busy;
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

  const bx = (best.lon+180)/360*w, by = (90-best.lat)/180*h;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(bx,by,5,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.beginPath(); ctx.arc(bx,by,10,0,Math.PI*2); ctx.stroke();
}

function showResult(best,count,samples,model){
  $('bestLat').textContent = best.lat.toFixed(2)+'°';
  $('bestLon').textContent = best.lon.toFixed(2)+'°';
  $('daylightPct').textContent = (best.daylight*100).toFixed(2)+'%';
  $('longestDay').textContent = best.longestDay.toFixed(2)+' d';
  $('longestNight').textContent = best.longestNight.toFixed(2)+' d';
  $('avgAlt').textContent = best.sumAlt.toFixed(2)+'°';
  $('minAlt').textContent = best.minAlt.toFixed(2)+'°';
  $('maxAlt').textContent = best.maxAlt.toFixed(2)+'°';
  $('rotationModel').textContent = model;
  $('message').textContent = `Full-orbit search complete: ${count.toLocaleString()} surface points × ${samples.toLocaleString()} orbital samples. Rendering heatmap…`;
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
  $('message').textContent = 'Running full-orbit numerical search…';

  const w = getWorker();
  w.onmessage = (e) => {
    const msg = e.data;
    if(msg.type === 'progress'){
      $('progressBar').style.width = msg.pct + '%';
    } else if(msg.type === 'gridResult'){
      showResult(msg.best, msg.count, msg.samples, msg.model);
    } else if(msg.type === 'heatmapResult'){
      drawHeatmapImage(msg.w, msg.h, msg.pixels, msg.best);
      $('progressBar').style.width = '100%';
      $('message').textContent = $('message').textContent.replace('Rendering heatmap…','Done.');
      setBusy(false);
    }
  };
  w.postMessage({ type:'run', params:p });
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

calculate();
