import React, {useEffect,useRef,useState} from 'react';
import {families} from './journeyData.js';
import {journeySample} from './journeyMotion.js';
import {loadFrames,frameIndex} from './vehicleFrames.js';
export default function VehicleStage({progress}) {
 const canvas=useRef(null),[ready,setReady]=useState(false),[status,setStatus]=useState('Preparing the perspectives'),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const el=canvas.current,ctx=el.getContext('2d');if(!ctx)return;
  const controller=new AbortController(),sequences=new Map();
  let disposed=false,raf=0,dirty=true,previous='',w=0,h=0,dpr=1;
  const resize=()=>{const r=el.getBoundingClientRect();w=r.width;h=r.height;dpr=Math.min(devicePixelRatio||1,1.5);el.width=Math.round(w*dpr);el.height=Math.round(h*dpr);dirty=true;};
  const observer=new ResizeObserver(resize);observer.observe(el);resize();
  (async()=>{try{for(let i=0;i<families.length;i++){
   const frames=await loadFrames(families[i].asset,{signal:controller.signal,onProgress:n=>{if(!disposed)setStatus(`Preparing ${families[i].id} · ${n}/36`);}});
   if(disposed){frames.forEach(f=>f.close());return;}sequences.set(i,frames);if(i===0)setReady(true);dirty=true;
  }setStatus('');}catch(e){if(e.name!=='AbortError'&&!disposed)setStatus('Some perspectives could not load');}})();
  function draw(index,angle,opacity){
   const frames=sequences.get(index);if(!frames||opacity<=0)return;
   const img=frames[frameIndex(angle,families[index].asset)],mobile=w<760;
   const iw=w*(index===2?(mobile?1.02:.64):(mobile?1.20:.78)),ih=iw*img.height/img.width;
   ctx.globalAlpha=opacity;ctx.drawImage(img,w*(mobile?.50:.67)-iw/2,h*(mobile?.86:.74)-ih*(index===2?.85:.80),iw,ih);
  }
  function tick(){
   const s=journeySample(progress.current),key=`${s.from}:${s.to}:${s.mix.toFixed(3)}:${Math.round(s.angle/10)}`;
   if(!document.hidden&&(dirty||key!==previous)){
    dirty=false;previous=key;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    // Hold the loaded model until the entire next sequence is decoded.
    const from=sequences.has(s.from)?s.from:[...sequences.keys()].at(-1);
    if(from!==undefined){const ready=sequences.has(s.to);draw(from,s.angle,ready&&s.from!==s.to?1-s.mix:1);if(ready&&s.from!==s.to)draw(s.to,s.angle,s.mix);}
    ctx.globalAlpha=1;el.dataset.angle=s.angle.toFixed(2);el.dataset.family=families[s.mix>.5?s.to:s.from].id;el.dataset.loaded=String(sequences.size);
   }raf=requestAnimationFrame(tick);
  }
  raf=requestAnimationFrame(tick);
  return()=>{disposed=true;controller.abort();cancelAnimationFrame(raf);observer.disconnect();sequences.forEach(frames=>frames.forEach(f=>f.close()));};
 },[progress,attempt]);
 return <div className="j-car-scene"><canvas ref={canvas} aria-label="BMW vehicles rotating through front, side and rear views as you scroll" role="img"/>{!ready&&<img className="j-scene-poster" src="/images/bmw/f70.webp" alt="BMW 1 Series"/>}{status&&<div className="j-load-status" role="status">{status}{status.includes('could not')&&<button onClick={()=>{setReady(false);setAttempt(a=>a+1);}}>Retry</button>}</div>}</div>;
}
