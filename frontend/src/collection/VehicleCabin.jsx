import React,{useEffect,useRef,useState} from 'react';
import {Scene,PerspectiveCamera,WebGLRenderer,CubeTextureLoader,TextureLoader,EquirectangularReflectionMapping,SRGBColorSpace} from 'three';
export default function VehicleCabin({asset}){
 const host=useRef(null),control=useRef(null),[status,setStatus]=useState('Preparing cabin'),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const el=host.current;let disposed=false,texture,renderer,drag=null,yaw=0,pitch=0;
  setStatus('Preparing cabin');
  try{renderer=new WebGLRenderer({antialias:true});}catch{setStatus('Your browser could not start the panorama viewer.');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));el.appendChild(renderer.domElement);
  const scene=new Scene(),camera=new PerspectiveCamera(75,1,.1,10);
  const paint=()=>{if(disposed)return;camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);renderer.render(scene,camera);};
  const resize=()=>{const r=el.getBoundingClientRect();renderer.setSize(r.width,r.height);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();paint();};
  const observer=new ResizeObserver(resize);observer.observe(el);resize();
  // BMW source order: down, front, back, up, right, left.
  const loaded=map=>{if(disposed){map.dispose();return;}if(asset==='g68'){map.mapping=EquirectangularReflectionMapping;map.colorSpace=SRGBColorSpace;yaw=-Math.PI/2;}scene.background=map;setStatus('');paint();};
  const failed=()=>{if(!disposed)setStatus('This cabin could not load. Retry to try again.');};
  texture=asset==='g68'?new TextureLoader().load('/images/bmw/interior/g68-panorama.webp',loaded,undefined,failed):new CubeTextureLoader().load([4,5,3,0,2,1].map(i=>`/images/bmw/interior/${asset}/${i}.webp`),loaded,undefined,failed);
  control.current={turn:(x,y=0)=>{yaw+=x;pitch=Math.max(-1.2,Math.min(1.2,pitch+y));paint();},reset:()=>{yaw=asset==='g68'?-Math.PI/2:0;pitch=0;paint();}};
  const down=e=>{drag={x:e.clientX,y:e.clientY};el.setPointerCapture(e.pointerId);};
  const move=e=>{if(!drag)return;control.current.turn((e.clientX-drag.x)*.004,(e.clientY-drag.y)*.004);drag={x:e.clientX,y:e.clientY};};
  const up=()=>{drag=null;};
  el.addEventListener('pointerdown',down);el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
  return()=>{disposed=true;observer.disconnect();el.removeEventListener('pointerdown',down);el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);texture?.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();control.current=null;};
 },[asset,retry]);
 return <><div className="v-panorama" ref={host} tabIndex={0} role="img" aria-label={`${asset.toUpperCase()} interior panorama. Drag or use arrow keys to look around.`} onKeyDown={e=>{const directions={ArrowLeft:[-.15,0],ArrowRight:[.15,0],ArrowUp:[0,.1],ArrowDown:[0,-.1]};if(directions[e.key]){e.preventDefault();control.current?.turn(...directions[e.key]);}}}/>{status&&<div className="v-loading" role="status">{status}{status.includes('Retry')&&<button onClick={()=>setRetry(n=>n+1)}>Retry cabin</button>}</div>}<div className="v-cabin-controls"><button aria-label="Look left" onClick={()=>control.current?.turn(-.3)}>←</button><button onClick={()=>control.current?.reset()}>Reset view</button><button aria-label="Look right" onClick={()=>control.current?.turn(.3)}>→</button></div></>;
}
