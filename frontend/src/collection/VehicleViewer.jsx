import React,{useEffect,useRef,useState,lazy,Suspense} from 'react';
import {families,models} from './journeyData.js';
import {loadFrames,frameIndex} from './vehicleFrames.js';
import './vehicleViewer.css';
const Cabin=lazy(()=>import('./VehicleCabin.jsx'));
export default function VehicleViewer({initial,onClose}){
 const dialog=useRef(null),canvas=useRef(null),drag=useRef(null);
 const [selected,setSelected]=useState(initial),[mode,setMode]=useState('exterior'),[angle,setAngle]=useState(40),[status,setStatus]=useState('Loading perspectives'),[retry,setRetry]=useState(0),[zoom,setZoom]=useState(1);
 const asset=selected==='I20'?'i20':models.find(m=>m.id===selected)?.family.toLowerCase()||initial.toLowerCase();
 const model=models.find(m=>m.id===selected),family=families.find(f=>f.asset===asset);
 const exterior=model?.exterior||asset;
 const name=model?.name||family?.name||'BMW iX xDrive45';
 useEffect(()=>{const el=dialog.current,focus=document.activeElement,overflow=document.body.style.overflow;el.showModal();document.body.style.overflow='hidden';return()=>{document.body.style.overflow=overflow;focus?.focus();};},[]);
 const frames=useRef(null);
 useEffect(()=>{
  if(mode!=='exterior')return;
  const controller=new AbortController();frames.current=null;setStatus('Loading perspectives');
  loadFrames(exterior,{signal:controller.signal,onProgress:n=>setStatus(`Preparing all angles · ${n}/36`)}).then(async images=>{await images.get(frameIndex(40,exterior));if(controller.signal.aborted)return;frames.current=images;setStatus('');}).catch(e=>{if(e.name!=='AbortError')setStatus('Unable to load this view. Please retry.');});
  return()=>{controller.abort();frames.current=null;};
 },[exterior,mode,retry]);
 const angleRef=useRef(angle),zoomRef=useRef(zoom);angleRef.current=angle;zoomRef.current=zoom;
 const changeZoom=value=>setZoom(current=>Math.max(1,Math.min(3,Math.round((current+value)*100)/100)));
 const reset=()=>{setAngle(40);setZoom(1);};
 useEffect(()=>{
  const el=canvas.current;if(mode!=='exterior'||!el)return;
  const wheel=e=>{e.preventDefault();if(!status)changeZoom(-e.deltaY*.002);};
  el.addEventListener('wheel',wheel,{passive:false});
  return()=>el.removeEventListener('wheel',wheel);
 },[mode,status]);
 useEffect(()=>{
  if(mode!=='exterior'||!frames.current||!canvas.current)return;
  const el=canvas.current,ctx=el.getContext('2d');if(!ctx)return;
  let disposed=false,raf,busy=false,previous='',dirty=true;
  const resize=()=>{const rect=el.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);el.width=Math.round(rect.width*dpr);el.height=Math.round(rect.height*dpr);dirty=true;};
  const observer=new ResizeObserver(resize);observer.observe(el);resize();
  async function paint(value,magnification){
   busy=true;const sequence=frames.current;
   try{const image=await sequence.get(frameIndex(value,exterior));if(disposed||sequence!==frames.current)return;
    ctx.clearRect(0,0,el.width,el.height);ctx.imageSmoothingQuality='high';
    const scale=Math.min(el.width/image.width,el.height/image.height),width=image.width*scale,height=image.height*scale;
    const dw=width*magnification,dh=height*magnification,anchor=exterior==='g68'?.5:.65;
    ctx.drawImage(image,(el.width-dw)/2,(el.height-height)/2+height*anchor-dh*anchor,dw,dh);el.dataset.zoom=String(magnification);el.dataset.angle=String(value);el.dataset.model=selected;el.dataset.sourceWidth=String(image.width);previous=`${value}:${magnification}`;
   }catch(e){if(e.name!=='AbortError'&&!disposed)setStatus('Unable to load this view. Please retry.');}finally{busy=false;}
  }
  function tick(){if(!busy&&(dirty||previous!==`${angleRef.current}:${zoomRef.current}`)){dirty=false;void paint(angleRef.current,zoomRef.current);}raf=requestAnimationFrame(tick);}
  raf=requestAnimationFrame(tick);
  return()=>{disposed=true;cancelAnimationFrame(raf);observer.disconnect();};
 },[status,exterior,mode,selected]);
 const step=(value)=>setAngle(a=>(a+value+360)%360);
 return <dialog ref={dialog} className="v-dialog" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===dialog.current)onClose();}} aria-labelledby="v-title">
  <div className="v-shell"><header className="v-header"><div><span className="v-kicker">A closer perspective / {asset.toUpperCase()}</span><h2 id="v-title">{name}</h2></div><button className="v-close" onClick={onClose} aria-label="Close 360 viewer">×</button></header>
  <div className="v-toolbar"><label>Model<select value={selected} onChange={e=>{setSelected(e.target.value);reset();}}>{families.map(f=><optgroup key={f.id} label={f.name}>{models.filter(m=>m.family===f.id).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>)}<optgroup label="Additional perspective"><option value="I20">BMW iX xDrive45</option></optgroup></select></label><div className="v-modes" role="group" aria-label="View mode"><button aria-pressed={mode==='exterior'} onClick={()=>setMode('exterior')}>Exterior 360°</button><button aria-pressed={mode==='interior'} onClick={()=>setMode('interior')}>Interior</button></div></div>
  <div className={`v-stage ${mode==='interior'?'v-cabin':''}`}>
   {mode==='exterior'?<><canvas ref={canvas} width="960" height="540" tabIndex={0} role="img" aria-label={`${name} exterior. Drag or use left and right arrows to rotate. Scroll or use plus and minus to zoom.`} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','+','=','-'].includes(e.key)){e.preventDefault();if(e.key==='Home')reset();else if(['+','=','-'].includes(e.key))changeZoom(e.key==='-'?-.25:.25);else step(e.key==='ArrowLeft'?-10:10);}}} onPointerDown={e=>{if(status)return;drag.current={x:e.clientX,angle};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current)setAngle((drag.current.angle+Math.round((e.clientX-drag.current.x)/8)*10+3600)%360);}} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null}/>{status&&<div className="v-loading" role="status">{status}{status.includes('retry')&&<button onClick={()=>setRetry(n=>n+1)}>Retry loading</button>}</div>}</>:<Suspense fallback={<p className="v-loading">Preparing cabin…</p>}><Cabin key={asset} asset={asset}/></Suspense>}
  </div>
  {mode==='exterior'&&<div className="v-controls"><button disabled={!!status} aria-label="Previous angle" onClick={()=>step(-10)}>←</button><label><span>Drag to explore <output>{angle}°</output></span><input aria-label="Exterior angle" type="range" min="0" max="350" step="10" value={angle} disabled={!!status} onChange={e=>setAngle(Number(e.target.value))}/></label><button disabled={!!status} aria-label="Next angle" onClick={()=>step(10)}>→</button><button disabled={!!status} onClick={reset}>Reset view</button></div>}
  {mode==='exterior'&&<div className="v-zoom" role="group" aria-label="Exterior zoom"><button aria-label="Zoom out" disabled={!!status||zoom<=1} onClick={()=>changeZoom(-.25)}>−</button><output aria-label="Zoom level">{Math.round(zoom*100)}%</output><button aria-label="Zoom in" disabled={!!status||zoom>=3} onClick={()=>changeZoom(.25)}>+</button></div>}
  <footer className="v-footer">{asset==='i20'?'BMW iX xDrive45 · Arctic Race Blue':mode==='interior'?'Representative family cabin':'BMW configurator exterior'}<span>{mode==='exterior'?'36 original camera angles':'Drag to look around · arrow keys to turn'}</span></footer></div>
 </dialog>;
}
