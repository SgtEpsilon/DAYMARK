const $ = id => document.getElementById(id);
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

function readInputs(){
  return {
    P: +$('orbitalPeriod').value,
    R: +$('rotationPeriod').value,
    tilt: +$('axialTilt').value,
    e: clamp(+$('eccentricity').value,0,0.99),
    arg: +$('argPeriapsis').value,
    latStep:+$('latStep').value,
    lonStep:+$('lonStep').value,
    N:+$('samples').value
  };
}

/*
  Coordinate model:
  - Orbit phase is mean anomaly M.
  - Kepler's equation gives eccentric anomaly E, then true anomaly nu.
  - The Sun's declination is generated from orbital longitude and obliquity.
  - The subsolar longitude follows the planet's spin angle.
  - For a complete orbit, every candidate fixed coordinate is sampled at N times.
*/
function solveKepler(M,e){
  let E=M;
  for(let i=0;i<12;i++) E -= (E-e*Math.sin(E)-M)/(1-e*Math.cos(E));
  return E;
}

function orbitState(t,p){
  const M=2*Math.PI*t/p.P;
  const E=solveKepler(M,p.e);
  const nu=2*Math.atan2(Math.sqrt(1+p.e)*Math.sin(E/2),Math.sqrt(1-p.e)*Math.cos(E/2));
  const arg=rad(p.arg);
  // Simplified solar declination. Axial tilt is interpreted literally; equivalent obliquity is <=180.
  const delta=Math.asin(Math.sin(rad(p.tilt))*Math.sin(nu+arg));

  // Spin phase relative to the orbital reference. A 1:1 rotation produces a fixed
  // subsolar longitude in this frame; retrograde values naturally reverse the phase.
  const spin=2*Math.PI*t/p.R;
  const subsolarLon=deg(spin - (nu+arg));
  return {delta,subsolarLon};
}

function solarElevation(lat,lon,state){
  const phi=rad(lat), d=state.delta;
  const H=rad(lon-state.subsolarLon);
  return Math.asin(clamp(Math.sin(phi)*Math.sin(d)+Math.cos(phi)*Math.cos(d)*Math.cos(H),-1,1));
}

function evaluate(lat,lon,p){
  let lit=0, sum=0, min=90, max=-90;
  let longestDay=0,longestNight=0,run=0,prevLit=null;
  const dt=p.P/p.N;
  for(let i=0;i<p.N;i++){
    const s=orbitState(i*dt,p);
    const alt=deg(solarElevation(lat,lon,s));
    const isLit=alt>=-0.833; // approximate visible sunrise/set including refraction
    if(isLit) lit++;
    sum+=alt; min=Math.min(min,alt); max=Math.max(max,alt);

    if(prevLit===null){run=dt;prevLit=isLit}
    else if(isLit===prevLit){run+=dt}
    else{
      if(prevLit) longestDay=Math.max(longestDay,run);
      else longestNight=Math.max(longestNight,run);
      run=dt;prevLit=isLit;
    }
  }
  if(prevLit) longestDay=Math.max(longestDay,run);
  else longestNight=Math.max(longestNight,run);

  // Score favours daylight first, then high average Sun.
  const daylight=lit/p.N;
  const score=daylight*0.60 + ((sum/p.N+90)/180)*0.30 + ((min+90)/180)*0.10;
  return {lat,lon,daylight,sumAlt:sum/p.N,minAlt:min,maxAlt:max,longestDay,longestNight,score};
}

function drawHeatmap(p,best){
  const c=$('heatmap'),ctx=c.getContext('2d'),w=c.width,h=c.height;
  const image=ctx.createImageData(w,h);
  // A fast visual map: sample each pixel as a lat/lon average daylight estimate.
  // This is separate from the higher-resolution optimizer.
  const quickN=Math.min(240,p.N);
  for(let y=0;y<h;y++){
    const lat=90-y/(h-1)*180;
    for(let x=0;x<w;x++){
      const lon=x/(w-1)*360-180;
      let lit=0;
      for(let i=0;i<quickN;i++){
        const s=orbitState(i*p.P/quickN,p);
        if(deg(solarElevation(lat,lon,s))>=-0.833) lit++;
      }
      const q=lit/quickN;
      const idx=(y*w+x)*4;
      // Monochrome tactical scale.
      const v=Math.round(12+q*205);
      image.data[idx]=Math.round(v*.92);
      image.data[idx+1]=Math.round(v);
      image.data[idx+2]=Math.round(v*.94);
      image.data[idx+3]=255;
    }
  }
  ctx.putImageData(image,0,0);
  // grid
  ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1;
  for(let lon=-180;lon<=180;lon+=30){
    const x=(lon+180)/360*w;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();
  }
  for(let lat=-60;lat<=60;lat+=30){
    const y=(90-lat)/180*h;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();
  }
  // best point
  const bx=(best.lon+180)/360*w, by=(90-best.lat)/180*h;
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(bx,by,5,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#fff';ctx.beginPath();ctx.arc(bx,by,10,0,Math.PI*2);ctx.stroke();
}

async function calculate(){
  const p=readInputs();
  if(!(p.P>0&&p.R>0)){ $('message').textContent='Orbital and rotational periods must be greater than zero.'; return; }
  $('message').textContent='Running full-orbit numerical search…';
  await new Promise(requestAnimationFrame);

  let best=null, count=0;
  for(let lat=-90;lat<=90.0001;lat+=p.latStep){
    for(let lon=-180;lon<180;lon+=p.lonStep){
      const r=evaluate(lat,lon,p);
      if(!best||r.score>best.score)best=r;
      count++;
    }
    if(lat%10===0) await new Promise(requestAnimationFrame);
  }

  $('bestLat').textContent=best.lat.toFixed(2)+'°';
  $('bestLon').textContent=best.lon.toFixed(2)+'°';
  $('daylightPct').textContent=(best.daylight*100).toFixed(2)+'%';
  $('longestDay').textContent=best.longestDay.toFixed(2)+' d';
  $('longestNight').textContent=best.longestNight.toFixed(2)+' d';
  $('avgAlt').textContent=best.sumAlt.toFixed(2)+'°';
  $('minAlt').textContent=best.minAlt.toFixed(2)+'°';
  $('maxAlt').textContent=best.maxAlt.toFixed(2)+'°';

  const ratio=p.R/p.P;
  let model='NORMAL ROTATION';
  if(Math.abs(ratio-1)<0.005) model='SYNCHRONOUS / 1:1';
  else if(Math.abs(ratio-0.5)<0.005) model='2:1 SPIN-ORBIT';
  else if(Math.abs(ratio-2)<0.005) model='1:2 SPIN-ORBIT';
  $('rotationModel').textContent=model;

  $('message').textContent=`Analysis complete: ${count.toLocaleString()} surface points × ${p.N.toLocaleString()} orbital samples.`;
  drawHeatmap(p,best);
}

$('calculate').addEventListener('click',calculate);
$('loadExample').addEventListener('click',()=>{
  $('orbitalPeriod').value=16.9;
  $('rotationPeriod').value=16.9;
  $('axialTilt').value=124.74;
  $('eccentricity').value=0.0002;
  $('argPeriapsis').value=191.20;
  calculate();
});

calculate();
