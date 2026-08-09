const $ = id => document.getElementById(id);

const paramInputs = ['orbitalPeriod','rotationPeriod','axialTilt','eccentricity','argPeriapsis'];

function readInputs(){
  const p = {
    P: +$('orbitalPeriod').value,
    R: +$('rotationPeriod').value,
    tilt: +$('axialTilt').value,
    e: +$('eccentricity').value,
    arg: +$('argPeriapsis').value,
    latStep: +$('latStep').value,
    lonStep: +$('lonStep').value,
    N: +$('samples').value
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
  calculate();
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
