import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {ComponentId, Period, VehicleView, VehicleViewerProps} from '../domain/contracts';
import {heatColor, negativeShare} from '../domain/metrics';
import {componentForNodeName} from './modelMapping';
import './bmw-asset-viewer.css';

export const BMW_I5_MODEL_UID = '207fd872d28b4cafa7fefe061ae98e26';
const SKETCHFAB_API_SRC = 'https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js';
const labels:Record<ComponentId,string>={body:'Body',lighting:'Headlamps',charging:'Charging port',steering:'Steering wheel',dashboard:'Dashboard',seats:'Seats'};
const exteriorComponents:ComponentId[]=['body','lighting','charging'];
const interiorComponents:ComponentId[]=['steering','dashboard','seats'];
const modelAttribution='2023 BMW i5 M60 by Nazh Design';

type CameraState={position:number[];target:number[]};
type SketchfabNode={instanceID:number;name:string};
type SketchfabNodePayload=unknown;
type SketchfabApi={
  start:(callback?:()=>void)=>void;
  stop:(callback?:()=>void)=>void;
  addEventListener:(event:string,callback:(value:any)=>void,options?:Record<string,unknown>)=>void;
  getCameraLookAt:(callback:(error:unknown,camera:CameraState)=>void)=>void;
  setCameraLookAt:(position:number[],target:number[],duration?:number,callback?:(error:unknown)=>void)=>void;
  recenterCamera:(callback?:(error:unknown)=>void)=>void;
  getNodeMap:(callback:(error:unknown,nodes:SketchfabNodePayload)=>void)=>void;
};
type SketchfabClient={init:(uid:string,options:{autostart:number;camera:number;autospin:number;dnt:number;success:(api:SketchfabApi)=>void;error:()=>void})=>void};
type SketchfabConstructor=new (version:string,iframe:HTMLIFrameElement)=>SketchfabClient;
declare global {interface Window {Sketchfab?:SketchfabConstructor}}

let sketchfabScriptPromise:Promise<void>|null=null;
function loadSketchfabApi():Promise<void>{
  if(window.Sketchfab)return Promise.resolve();
  if(sketchfabScriptPromise)return sketchfabScriptPromise;
  const pending=new Promise<void>((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=SKETCHFAB_API_SRC;
    script.async=true;
    script.onload=()=>window.Sketchfab?resolve():reject(new Error('Sketchfab API did not initialize'));
    script.onerror=()=>reject(new Error('Sketchfab API could not load'));
    document.head.appendChild(script);
  });
  sketchfabScriptPromise=pending.catch(error=>{sketchfabScriptPromise=null;throw error;});
  return sketchfabScriptPromise;
}

export function sampleHeatColor(negative:number,total:number):string{
  return heatColor(negativeShare({negative,total}));
}

export function normalizeSketchfabNodeMap(payload:SketchfabNodePayload):SketchfabNode[]{
  const object=payload&&typeof payload==='object'?payload as Record<string,unknown>:null;
  const value=object&&'nodes' in object?object.nodes:payload;
  const entries:Array<[string,unknown]>=Array.isArray(value)?value.map((node,index)=>[String(index),node]):value&&typeof value==='object'?Object.entries(value):[];
  return entries.flatMap(([key,value])=>{
    if(!value||typeof value!=='object')return [];
    const node=value as Record<string,unknown>;
    if(typeof node.name!=='string')return [];
    const rawId=node.instanceID??key;
    const instanceID=typeof rawId==='number'?rawId:typeof rawId==='string'?Number(rawId):NaN;
    return Number.isFinite(instanceID)?[{instanceID,name:node.name}]:[];
  });
}

function reducedMotion():boolean{
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
}

function metricSummary(findings:VehicleViewerProps['findings'],id:ComponentId,period:Period):string{
  const finding=findings.find(item=>item.id===id);
  if(!finding)return 'No sample';
  const sample=period==='2025'?finding.previous:finding.current;
  return sample.total>0?`${sample.negative}/${sample.total} negative mentions`:'No sample';
}

function severityFor(findings:VehicleViewerProps['findings'],id:ComponentId,period:Period):string{
  const finding=findings.find(item=>item.id===id);
  if(!finding)return '#8a909b';
  const sample=period==='2025'?finding.previous:finding.current;
  return heatColor(negativeShare(sample));
}

function useSketchfabViewer(
  iframe:HTMLIFrameElement|null,
  onReady:()=>void,
  onFailure:()=>void,
  onPick:(component:ComponentId)=>void,
){
  const apiRef=useRef<SketchfabApi|null>(null);
  const initialCameraRef=useRef<CameraState|null>(null);
  const [sceneReady,setSceneReady]=useState(false);
  const callbacksRef=useRef({onReady,onFailure,onPick});
  callbacksRef.current={onReady,onFailure,onPick};

  useEffect(()=>{
    if(!iframe)return;
    setSceneReady(false);
    let disposed=false;
    let viewerIsReady=false;
    const loadTimeout=window.setTimeout(()=>{if(!disposed&&!viewerIsReady)callbacksRef.current.onFailure();},20000);
    void loadSketchfabApi().then(()=>{
      if(disposed||!iframe||!window.Sketchfab)return;
      const client=new window.Sketchfab('1.12.1',iframe);
      client.init(BMW_I5_MODEL_UID,{
        autostart:1,
        camera:0,
        autospin:0,
        dnt:1,
        success(api){
          if(disposed){api.stop();return;}
          apiRef.current=api;
          api.start();
          api.addEventListener('viewerready',()=>{
            if(disposed)return;
            window.clearTimeout(loadTimeout);
            viewerIsReady=true;
            setSceneReady(true);
            callbacksRef.current.onReady();
            api.getCameraLookAt((error,camera)=>{if(!error&&!disposed)initialCameraRef.current=camera;});
            api.getNodeMap((error,payload)=>{
              if(error||disposed)return;
              const nodes=normalizeSketchfabNodeMap(payload);
              const mapped=nodes.flatMap(node=>{
                const component=componentForNodeName(node.name);
                return component?[[node.instanceID,component] as const]:[];
              });
              const componentById=new Map(mapped);
              api.addEventListener('click',info=>{
                const component=info?.instanceID===undefined?undefined:componentById.get(Number(info.instanceID));
                if(component)callbacksRef.current.onPick(component);
              },{pick:'fast'});
            });
          });
        },
        error(){if(!disposed){window.clearTimeout(loadTimeout);callbacksRef.current.onFailure();}},
      });
    }).catch(()=>{if(!disposed){window.clearTimeout(loadTimeout);callbacksRef.current.onFailure();}});

    return ()=>{
      disposed=true;
      window.clearTimeout(loadTimeout);
      apiRef.current?.stop();
      apiRef.current=null;
    };
  },[iframe]);

  const resetCamera=useCallback(()=>{
    const api=apiRef.current;
    if(!api)return false;
    const camera=initialCameraRef.current;
    if(camera)api.setCameraLookAt(camera.position,camera.target,reducedMotion()?0:.45);
    else api.recenterCamera();
    return true;
  },[]);

  const zoom=useCallback((direction:-1|1)=>{
    const api=apiRef.current;
    if(!api)return false;
    api.getCameraLookAt((error,camera)=>{
      if(error)return;
      const factor=direction < 0 ? 0.8 : 1.25;
      const position=camera.position.map((coordinate,index)=>camera.target[index]+(coordinate-camera.target[index])*factor);
      api.setCameraLookAt(position,camera.target,reducedMotion()?0:.22);
    });
    return true;
  },[]);

  const orbit=useCallback((direction:-1|1)=>{
    const api=apiRef.current;
    if(!api)return false;
    api.getCameraLookAt((error,camera)=>{
      if(error)return;
      const [x,y,z]=camera.position.map((coordinate,index)=>coordinate-camera.target[index]);
      const angle=direction*Math.PI/12;
      const position=[camera.target[0]+x*Math.cos(angle)-z*Math.sin(angle),camera.target[1]+y,camera.target[2]+x*Math.sin(angle)+z*Math.cos(angle)];
      api.setCameraLookAt(position,camera.target,reducedMotion()?0:.22);
    });
    return true;
  },[]);

  const pause=useCallback(()=>apiRef.current?.stop(),[]);
  const resume=useCallback(()=>apiRef.current?.start(),[]);
  return {resetCamera,zoom,orbit,pause,resume,sceneReady};
}

export default function BmwAssetViewer({selectedComponent,onSelectComponent,view,onViewChange,heatmap,period,findings,className,onStatusChange}:VehicleViewerProps){
  const [iframe,setIframe]=useState<HTMLIFrameElement|null>(null);
  const [apiFailed,setApiFailed]=useState(false);
  const [liveMessage,setLiveMessage]=useState('');
  const [resetMessage,setResetMessage]=useState('');
  const [retryVersion,setRetryVersion]=useState(0);
  const reportReady=useCallback(()=>{setApiFailed(false);setLiveMessage('3D model ready. Drag to orbit; use Sketchfab viewer keyboard controls.');onStatusChange?.('ready');},[onStatusChange]);
  const reportFailure=useCallback(()=>{setApiFailed(true);setLiveMessage('3D model unavailable. Showing verified preview image.');onStatusChange?.('fallback');},[onStatusChange]);
  const {resetCamera,zoom,orbit,pause,resume,sceneReady}=useSketchfabViewer(iframe,reportReady,reportFailure,onSelectComponent);

  useEffect(()=>{if(view==='interior')pause();else resume();},[view,pause,resume]);

  const components=useMemo(()=>view==='exterior'?exteriorComponents:interiorComponents,[view]);
  const heatLabel=heatmap?`Negative feedback · ${period}`:'Feedback heat off';
  const currentSample=metricSummary(findings,selectedComponent,period);

  const handleReset=()=>{
    if(resetCamera())setResetMessage('Exterior camera reset.');
    else setResetMessage('Camera controls available after the 3D model loads.');
  };

  const retryModel=()=>{
    setApiFailed(false);
    setRetryVersion(version=>version+1);
    setLiveMessage('Retrying hosted 3D model.');
  };

  const handleZoom=(direction:-1|1)=>{
    if(!zoom(direction))setResetMessage('Camera controls available after the 3D model loads.');
  };

  const handleOrbit=(direction:-1|1)=>{
    if(!orbit(direction))setResetMessage('Camera controls available after the 3D model loads.');
  };

  return <section className={`bmw-asset-viewer ${className??''}`} aria-label="BMW i5 M60 vehicle viewer">
    <header className="bmw-asset-viewer__header">
      <div className="bmw-asset-viewer__identity">
        <h2>BMW i5 M60</h2>
        <p>Exterior · 2023 model · cabin photo reference</p>
      </div>
      <div className="bmw-asset-viewer__controls" role="group" aria-label="Vehicle view">
        <button type="button" aria-pressed={view==='exterior'} onClick={()=>onViewChange('exterior')}>Exterior 3D</button>
        <button type="button" aria-pressed={view==='interior'} onClick={()=>onViewChange('interior')}>Interior photo</button>
        <button type="button" className="bmw-asset-viewer__reset" onClick={handleReset} disabled={view!=='exterior'}>Reset view</button>
      </div>
    </header>

    <div className="bmw-asset-viewer__layout" data-view={view}>
      <div className="bmw-asset-viewer__stage">
        {view==='exterior'?<>
          <img className="bmw-asset-viewer__preview" src="/vehicles/i5-m60-preview.jpg" alt="BMW i5 M60 three-quarter exterior preview"/>
          {!apiFailed&&<iframe
            key={retryVersion}
            ref={setIframe}
            className={`bmw-asset-viewer__frame ${sceneReady?'is-ready':''}`}
            title="Interactive 3D model of the 2023 BMW i5 M60"
            allow="autoplay; fullscreen; xr-spatial-tracking"
            allowFullScreen
            aria-label="Interactive BMW i5 M60 exterior model. Drag to orbit and use controls to zoom."
          />}
          {!sceneReady&&!apiFailed&&<div className="bmw-asset-viewer__loading" role="status"><span className="bmw-asset-viewer__spinner"/>Loading hosted BMW i5 M60 model…</div>}
          {apiFailed&&<div className="bmw-asset-viewer__failure" role="alert"><strong>3D model could not load.</strong><span>Verified preview stays available. Check your connection and try again.</span><button type="button" onClick={retryModel}>Retry 3D model</button></div>}
          <div className="bmw-asset-viewer__camera-controls" role="group" aria-label="3D camera controls">
            <button type="button" aria-label="Orbit model left" title="Orbit left" onClick={()=>handleOrbit(-1)} disabled={!sceneReady}>↶</button>
            <button type="button" aria-label="Orbit model right" title="Orbit right" onClick={()=>handleOrbit(1)} disabled={!sceneReady}>↷</button>
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={()=>handleZoom(1)} disabled={!sceneReady}>−</button>
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={()=>handleZoom(-1)} disabled={!sceneReady}>+</button>
          </div>
          <div className="bmw-asset-viewer__stage-caption"><span>Exterior · interactive 3D</span><span>{sceneReady?'Sketchfab model connected':apiFailed?'Preview image':'Connecting'}</span></div>
        </>:<div className="bmw-asset-viewer__photo-wrap">
          <img className="bmw-asset-viewer__interior-photo" src="/vehicles/g60-interior.jpg" alt="BMW 5 Series G60 cabin reference photo, photographed by Ethan Llamas"/>
          <div className="bmw-asset-viewer__photo-badge">G60 520i cabin reference · photograph</div>
          {heatmap&&<div className="bmw-asset-viewer__photo-markers" aria-label="Feedback overlay on cabin photograph">
            {([{id:'steering',x:'34%',y:'55%'},{id:'dashboard',x:'60%',y:'45%'},{id:'seats',x:'82%',y:'88%'}] as const).map(({id,x,y})=>{
              const active=selectedComponent===id;
              const severity=severityFor(findings,id,period);
              return <button key={id} type="button" className={`bmw-asset-viewer__photo-marker ${active?'is-selected':''}`} style={{left:x,top:y,'--heat':severity} as React.CSSProperties} aria-label={`${labels[id]} feedback marker · ${metricSummary(findings,id,period)}`} aria-pressed={active} onClick={()=>onSelectComponent(id)}><span/><small>{labels[id]}</small></button>;
            })}
          </div>}
          <div className="bmw-asset-viewer__stage-caption"><span>Interior · static photo reference</span><span>Not a 3D cabin view</span></div>
        </div>}
      </div>

      <aside className="bmw-asset-viewer__inspector" aria-label="Vehicle component feedback">
        <div className="bmw-asset-viewer__inspector-top"><span>{view==='exterior'?'Exterior components':'Cabin components'}</span><span className="bmw-asset-viewer__heat-label"><i/> {heatLabel}</span></div>
        <p className="bmw-asset-viewer__instruction">Feedback colors indicate negative share. Colors appear in this list and cabin photo only.</p>
        {heatmap&&<div className="bmw-asset-viewer__legend" role="img" aria-label="Negative feedback share: teal below 25 percent, amber 25 to 49 percent, red 50 percent or more; gray means no sample.">
          <span><i style={{'--heat':'#57b6a0'} as React.CSSProperties}/>0–24%</span>
          <span><i style={{'--heat':'#e8b75a'} as React.CSSProperties}/>25–49%</span>
          <span><i style={{'--heat':'#e45454'} as React.CSSProperties}/>50%+</span>
          <span><i style={{'--heat':'#8a909b'} as React.CSSProperties}/>No sample</span>
        </div>}
        <div className="bmw-asset-viewer__parts" role="group" aria-label={`${view} components`}>
          {components.map(id=>{
            const color=heatmap?severityFor(findings,id,period):'#a7adb4';
            return <button key={id} type="button" className={`bmw-asset-viewer__part ${selectedComponent===id?'is-selected':''}`} aria-pressed={selectedComponent===id} onClick={()=>onSelectComponent(id)}>
              <span className="bmw-asset-viewer__part-dot" style={{'--heat':color} as React.CSSProperties}/>
              <span className="bmw-asset-viewer__part-copy"><strong>{labels[id]}</strong><small>{metricSummary(findings,id,period)}</small></span>
              <span className="bmw-asset-viewer__part-arrow" aria-hidden="true">↗</span>
            </button>;
          })}
        </div>
        <div className="bmw-asset-viewer__selection" aria-live="polite"><span className="bmw-asset-viewer__selection-label">Selected component</span><strong>{labels[selectedComponent]}</strong><span>{currentSample}</span></div>
        {view==='interior'&&<p className="bmw-asset-viewer__photo-note">Detailed 3D cabin not verified in source asset. This is a separate G60 520i cabin reference.</p>}
      </aside>
    </div>

    {view==='interior'&&<div className="bmw-asset-viewer__credits" aria-label="Interior photo attribution">
      <span>Photo: <a href="https://commons.wikimedia.org/wiki/File:BMW_520i_G60_Oxide_Grey_Metallic_03.jpg" target="_blank" rel="noreferrer">Ethan Llamas · BMW 520i G60</a></span>
      <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>
      <span>Displayed with crop · synthetic feedback overlay</span>
    </div>}

    <footer className="bmw-asset-viewer__provenance">
      <div><strong>3D exterior</strong><span><a href="https://sketchfab.com/3d-models/2023-bmw-i5-m60-207fd872d28b4cafa7fefe061ae98e26" target="_blank" rel="noreferrer">{modelAttribution}</a></span></div>
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>
      <span>Creator-uploaded model · not an official BMW asset</span>
    </footer>
    <div className="bmw-asset-viewer__sr-only" aria-live="polite">{liveMessage} {resetMessage}</div>
  </section>;
}
