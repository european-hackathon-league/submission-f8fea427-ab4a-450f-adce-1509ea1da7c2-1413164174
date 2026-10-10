import {Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode} from 'react';
import {Canvas, useThree} from '@react-three/fiber';
import {Environment, OrbitControls, RoundedBox, useGLTF} from '@react-three/drei';
import {Color, Mesh, MeshStandardMaterial, Shape, ExtrudeGeometry, Vector3} from 'three';
import type {ComponentId, Period, VehicleView, VehicleViewerProps} from '../domain/contracts';
import {componentHeatColor, componentForNodeName} from './modelMapping';
import './vehicle-viewer.css';

const labels: Record<ComponentId, string> = {steering:'Steering wheel',dashboard:'Dashboard',seats:'Seats',charging:'Charging port',body:'Body',lighting:'Lighting'};
const areas: Record<VehicleView, ComponentId[]> = {exterior:['body','lighting','charging'],interior:['steering','dashboard','seats']};
const allComponents: ComponentId[] = ['body','lighting','charging','steering','dashboard','seats'];
const componentAnchors: Record<ComponentId,[number,number,number]> = {body:[.15,1.65,.73],lighting:[1.96,.84,.33],charging:[-1.67,.96,.69],steering:[.47,1.28,-.3],dashboard:[.62,1.28,-.25],seats:[-.72,1.32,.39]};

class SceneBoundary extends Component<{children:ReactNode;onError:()=>void;fallback?:ReactNode},{failed:boolean}> {
  state = {failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(_error:Error,_info:ErrorInfo){this.props.onError();}
  render(){return this.state.failed ? this.props.fallback ?? null : this.props.children;}
}

function Paint({color='#536f8d',metalness=.68,roughness=.25}:{color?:string;metalness?:number;roughness?:number}){
  return <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} envMapIntensity={1.4}/>;
}

function ProfileBody({color,onSelect,opacity=1}:{color:string;onSelect:(id:ComponentId)=>void;opacity?:number}){
  const geometry = useMemo(()=>{
    const shape = new Shape();
    shape.moveTo(-2.25,.47); shape.lineTo(-2.12,.69); shape.quadraticCurveTo(-1.85,.82,-1.22,.86);
    shape.lineTo(-.78,1.36); shape.quadraticCurveTo(-.6,1.52,-.28,1.54); shape.lineTo(.57,1.48);
    shape.quadraticCurveTo(.81,1.43,.99,1.17); shape.lineTo(1.28,.83); shape.quadraticCurveTo(1.72,.77,2.03,.61);
    shape.quadraticCurveTo(2.22,.54,2.23,.35); shape.lineTo(2.1,.2); shape.lineTo(-2.13,.2); shape.closePath();
    return new ExtrudeGeometry(shape,{depth:1.46,bevelEnabled:true,bevelSegments:4,steps:1,bevelSize:.07,bevelThickness:.07,curveSegments:10});
  },[]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <mesh geometry={geometry} position={[0,0,-.73]} castShadow receiveShadow onClick={(e)=>{e.stopPropagation();onSelect('body');}}><meshPhysicalMaterial color={color} metalness={.72} roughness={.22} envMapIntensity={1.4} clearcoat={.75} transparent={opacity<1} opacity={opacity} depthWrite={opacity===1}/></mesh>;
}

function SideGlass({dark=true,opacity=.78}:{dark?:boolean;opacity?:number}){
  const geo=useMemo(()=>{const s=new Shape();s.moveTo(-1.13,.91);s.lineTo(-.65,1.36);s.quadraticCurveTo(-.55,1.43,-.31,1.43);s.lineTo(.49,1.38);s.quadraticCurveTo(.65,1.36,.79,1.16);s.lineTo(.98,.91);s.closePath();return new ExtrudeGeometry(s,{depth:.012,bevelEnabled:true,bevelSegments:1,bevelSize:.012,bevelThickness:.012});},[]);
  useEffect(()=>()=>geo.dispose(),[geo]);
  return <group>{[-.704,.704].map((z)=><mesh key={z} geometry={geo} position={[0,0,z]} castShadow><meshPhysicalMaterial color={dark?'#101b27':'#9bb4c5'} metalness={.55} roughness={.16} transparent opacity={opacity} depthWrite={opacity>.5} clearcoat={1} clearcoatRoughness={.1}/></mesh>)}</group>;
}

function Wheel({x,z}:{x:number;z:number}){
  const side=Math.sign(z);
  return <group position={[x,.48,z]}>
    <mesh castShadow rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.48,.48,.28,40]}/><meshStandardMaterial color="#12161b" roughness={.82}/></mesh>
    <group position={[0,0,side*.151]} rotation={[0,side<0?Math.PI:0,0]}>
      <mesh><torusGeometry args={[.355,.045,12,48]}/><meshStandardMaterial color="#c1c9d1" metalness={.86} roughness={.23}/></mesh>
      <mesh><circleGeometry args={[.31,48]}/><meshStandardMaterial color="#27313c" metalness={.65} roughness={.3}/></mesh>
      {Array.from({length:10},(_,i)=><mesh key={i} position={[0,0,.014*side]} rotation={[0,0,i*Math.PI/5]}><boxGeometry args={[.035,.25,.028]}/><meshStandardMaterial color="#d5dbe2" metalness={.88} roughness={.22}/></mesh>)}
      <mesh position={[0,0,.025*side]}><circleGeometry args={[.095,32]}/><meshStandardMaterial color="#6b7887" metalness={.7} roughness={.25}/></mesh>
    </group>
  </group>;
}

function Exterior({colors,onSelect,interior=false}:{colors:Record<ComponentId,string>;onSelect:(id:ComponentId)=>void;interior?:boolean}){
  const sideStripe = useMemo(()=>{
    const s=new Shape(); s.moveTo(-1.95,.67); s.quadraticCurveTo(-.4,.76,1.85,.53); s.lineTo(1.72,.48); s.quadraticCurveTo(-.4,.67,-1.95,.61); s.closePath(); return new ExtrudeGeometry(s,{depth:.008,bevelEnabled:false});
  },[]);
  useEffect(()=>()=>sideStripe.dispose(),[sideStripe]);
  return <group>
    <ProfileBody color={colors.body} onSelect={onSelect} opacity={interior ? .27 : 1}/>
    <SideGlass opacity={interior ? .24 : .78}/>
    {[-.56,.56].map(z=><mesh key={z} geometry={sideStripe} position={[0,0,z]}><meshStandardMaterial color="#9cb5c7" metalness={.8} roughness={.28} transparent opacity={.55}/></mesh>)}
    <RoundedBox args={[.33,.17,.08]} radius={.065} smoothness={5} position={[2.16,.56,-.37]} rotation={[0,0,-.1]} onClick={(e)=>{e.stopPropagation();onSelect('lighting');}}><meshPhysicalMaterial color={colors.lighting} emissive={colors.lighting} emissiveIntensity={.38} roughness={.18} clearcoat={1}/></RoundedBox>
    <RoundedBox args={[.33,.17,.08]} radius={.065} smoothness={5} position={[2.16,.56,.37]} rotation={[0,0,-.1]} onClick={(e)=>{e.stopPropagation();onSelect('lighting');}}><meshPhysicalMaterial color={colors.lighting} emissive={colors.lighting} emissiveIntensity={.38} roughness={.18} clearcoat={1}/></RoundedBox>
    <RoundedBox args={[.24,.14,.09]} radius={.055} smoothness={5} position={[-2.17,.58,-.36]} rotation={[0,0,.1]} onClick={(e)=>{e.stopPropagation();onSelect('lighting');}}><meshStandardMaterial color="#b84348" emissive="#981d28" emissiveIntensity={.34}/></RoundedBox>
    <RoundedBox args={[.24,.14,.09]} radius={.055} smoothness={5} position={[-2.17,.58,.36]} rotation={[0,0,.1]} onClick={(e)=>{e.stopPropagation();onSelect('lighting');}}><meshStandardMaterial color="#b84348" emissive="#981d28" emissiveIntensity={.34}/></RoundedBox>
    {/* sculpted front fascia */}
    <RoundedBox args={[.15,.34,.92]} radius={.11} smoothness={6} position={[2.18,.31,0]} rotation={[0,0,-.05]} onClick={(e)=>{e.stopPropagation();onSelect('body');}}><meshStandardMaterial color="#1b2530" metalness={.58} roughness={.34}/></RoundedBox>
    {Array.from({length:7},(_,i)=><mesh key={i} position={[2.265,.23+i*.04,0]}><boxGeometry args={[.022,.009,.75]}/><meshStandardMaterial color="#aebac5" metalness={.9} roughness={.25}/></mesh>)}
    <mesh position={[2.27,.36,0]}><torusGeometry args={[.09,.009,6,32]}/><meshStandardMaterial color="#9cb3c6" metalness={.9}/></mesh>
    {/* mirrors, handles, charging door */}
    {[-.84,.84].map(z=><group key={z}><mesh position={[.7,.93,z*1.02]} rotation={[0,0,.2]}><boxGeometry args={[.24,.1,.14]}/><Paint color="#526a82"/></mesh><mesh position={[-.6,.72,z*.74]}><boxGeometry args={[.22,.025,.025]}/><meshStandardMaterial color="#cbd3dc" metalness={.92}/></mesh></group>)}
    <RoundedBox args={[.055,.14,.022]} radius={.022} smoothness={3} position={[-1.67,.81,.69]} rotation={[0,0,-.15]} onClick={(e)=>{e.stopPropagation();onSelect('charging');}}><meshStandardMaterial color={colors.charging} metalness={.65}/></RoundedBox>
    <Wheel x={-1.24} z={-.81}/><Wheel x={1.22} z={-.81}/><Wheel x={-1.24} z={.81}/><Wheel x={1.22} z={.81}/>
  </group>;
}

function Interior({colors,onSelect}:{colors:Record<ComponentId,string>;onSelect:(id:ComponentId)=>void}){
  return <group>
    <RoundedBox args={[1.92,.18,1.06]} radius={.08} smoothness={5} position={[-.08,.92,0]} rotation={[0,0,-.08]} onClick={(e)=>{e.stopPropagation();onSelect('dashboard');}}><meshStandardMaterial color={colors.dashboard} metalness={.36} roughness={.3}/></RoundedBox>
    <RoundedBox args={[.56,.09,.16]} radius={.035} smoothness={4} position={[.62,1.055,-.24]} rotation={[0,0,-.08]}><meshStandardMaterial color="#111c28" metalness={.2} roughness={.18}/></RoundedBox>
    <RoundedBox args={[.36,.075,.15]} radius={.025} smoothness={4} position={[.72,1.055,.25]} rotation={[0,0,-.08]}><meshStandardMaterial color="#172536" emissive="#193b61" emissiveIntensity={.6} metalness={.2}/></RoundedBox>
    {/* split center console, satin trim and controls */}
    <RoundedBox args={[1.25,.12,.28]} radius={.1} smoothness={5} position={[.08,.77,0]} rotation={[0,0,.05]}><meshStandardMaterial color="#222b34" metalness={.48} roughness={.28}/></RoundedBox>
    <RoundedBox args={[.42,.08,.2]} radius={.05} smoothness={4} position={[.05,.84,0]}><meshStandardMaterial color="#34404a" metalness={.68} roughness={.2}/></RoundedBox>
    {[-.09,.09].map(z=><mesh key={z} position={[.09,.89,z]}><cylinderGeometry args={[.026,.026,.012,24]}/><meshStandardMaterial color="#d3dae0" metalness={.82} roughness={.24}/></mesh>)}
    {/* sculpted bolstered seats */}
    {[-.39,.39].map((z,i)=><group key={z} position={[-.72,.68,z]} onClick={(e)=>{e.stopPropagation();onSelect('seats');}}>
      <RoundedBox args={[.48,.18,.48]} radius={.1} smoothness={5} position={[0,0,0]}><meshStandardMaterial color={colors.seats} roughness={.67}/></RoundedBox>
      <RoundedBox args={[.22,.64,.42]} radius={.11} smoothness={6} position={[-.15,.34,0]} rotation={[0,0,-.12]}><meshStandardMaterial color={colors.seats} roughness={.68}/></RoundedBox>
      <RoundedBox args={[.1,.52,.07]} radius={.035} smoothness={4} position={[-.15,.34,-.2]}><meshStandardMaterial color="#36424c" roughness={.73}/></RoundedBox>
      <RoundedBox args={[.1,.52,.07]} radius={.035} smoothness={4} position={[-.15,.34,.2]}><meshStandardMaterial color="#36424c" roughness={.73}/></RoundedBox>
      <RoundedBox args={[.36,.13,.08]} radius={.05} smoothness={4} position={[.03,.59,0]}><meshStandardMaterial color="#46535e" roughness={.58}/></RoundedBox>
    </group>)}
    {/* recognizable steering wheel */}
    <group position={[.47,1.0,-.3]} rotation={[0,0,-.18]} onClick={(e)=>{e.stopPropagation();onSelect('steering');}}>
      <mesh><torusGeometry args={[.205,.036,14,48]}/><meshStandardMaterial color={colors.steering} roughness={.35} metalness={.18}/></mesh>
      <RoundedBox args={[.26,.075,.065]} radius={.035} smoothness={4} position={[0,0,0]}><meshStandardMaterial color="#252d35" roughness={.48}/></RoundedBox>
      <RoundedBox args={[.045,.2,.042]} radius={.018} smoothness={3} position={[0,0,0]}><meshStandardMaterial color="#252d35" roughness={.48}/></RoundedBox>
      {[-.14,.14].map(x=><mesh key={x} position={[x,.01,.04]}><circleGeometry args={[.018,16]}/><meshStandardMaterial color="#e4eaf0" metalness={.55}/></mesh>)}
    </group>
    {/* door cards and brushed aluminum sill */}
    {[-.64,.64].map(z=><RoundedBox key={z} args={[1.62,.28,.12]} radius={.06} smoothness={4} position={[-.05,.79,z]}><meshStandardMaterial color="#202931" roughness={.48}/></RoundedBox>)}
  </group>;
}

function Hotspot({id,label,color,position,onSelect,selected=false}:{id:ComponentId;label:string;color:string;position:[number,number,number];onSelect:(id:ComponentId)=>void;selected?:boolean}){
  return <group position={position} onClick={(e)=>{e.stopPropagation();onSelect(id);}}>
    <mesh><sphereGeometry args={[.075,16,16]}/><meshBasicMaterial color={color}/></mesh>
    <mesh scale={1.6}><sphereGeometry args={[.075,16,16]}/><meshBasicMaterial color={color} transparent opacity={.22}/></mesh>
    {selected?<mesh><torusGeometry args={[.16,.018,8,28]}/><meshBasicMaterial color="#66a8ff"/></mesh>:null}
  </group>;
}

function ImportedModel({url,onLoaded,onSelect,colors}:{url:string;onLoaded:()=>void;onSelect:(id:ComponentId)=>void;colors:Record<ComponentId,string>}){
  const {scene}=useGLTF(url); const cloned=useMemo(()=>{
    const copy=scene.clone(true);
    copy.traverse(obj=>{if(obj instanceof Mesh){obj.castShadow=true;obj.receiveShadow=true;const existing=Array.isArray(obj.material)?obj.material:[obj.material];obj.material=existing.map(mat=>mat.clone());obj.userData.componentId=componentForNodeName(obj.name);}});
    return copy;
  },[scene]);
  useEffect(()=>onLoaded(),[onLoaded]);
  useEffect(()=>{cloned.traverse(obj=>{if(obj instanceof Mesh){const id=obj.userData.componentId as ComponentId|undefined;if(id){const mats=Array.isArray(obj.material)?obj.material:[obj.material];mats.forEach(mat=>{if('color' in mat)(mat as MeshStandardMaterial).color=new Color(colors[id]);});}}});},[cloned,colors]);
  useEffect(()=>()=>{cloned.traverse(obj=>{if(obj instanceof Mesh){const mats=Array.isArray(obj.material)?obj.material:[obj.material];mats.forEach(mat=>mat.dispose());}});},[cloned]);
  return <primitive object={cloned} scale={1} onClick={(event:any)=>{event.stopPropagation();const o=event.object as Mesh;const id=o.userData.componentId as ComponentId|undefined;if(id)onSelect(id);}}/>;
}

function CameraPreset({view,resetSignal,turn}:{view:VehicleView;resetSignal:number;turn:number}){
  const {camera,size}=useThree();
  const controls=useRef<any>(null);
  useEffect(()=>{
    const narrow=size.width<560;const scale=narrow?1.32:1;
    const target=view==='exterior'?new Vector3(0,.72,0):new Vector3(0,.98,0);
    const offset=(view==='exterior'?new Vector3(4.1,2.6,4.8):new Vector3(1.15,1.35,3.25)).multiplyScalar(scale).applyAxisAngle(new Vector3(0,1,0),turn*.14);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    if(controls.current){controls.current.target.copy(target);controls.current.minDistance=view==='interior'?2.7:4.2;controls.current.maxDistance=view==='interior'?7.5:10.5;controls.current.update();}
  },[camera,size.width,view,resetSignal,turn]);
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={.085} minDistance={view==='interior'?2.7:4.2} maxDistance={view==='interior'?7.5:10.5} minPolarAngle={.22} maxPolarAngle={Math.PI/2.05} enablePan={false} />;
}

function VehicleScene({view,selected,heatmap,period,findings,onSelect,resetSignal,modelUrl,onModelStatus,keyboardTurn}:{view:VehicleView;selected:ComponentId;heatmap:boolean;period:Period;findings:VehicleViewerProps['findings'];onSelect:(id:ComponentId)=>void;resetSignal:number;modelUrl?:string;onModelStatus:(status:'ready'|'fallback')=>void;keyboardTurn:number}){
  const [modelLoaded,setModelLoaded]=useState(false);const [assetError,setAssetError]=useState(false);
  const find=(id:ComponentId)=>findings.find(f=>f.id===id);
  const colors=useMemo(()=>Object.fromEntries(allComponents.map(id=>[id,heatmap?componentHeatColor(find(id),period):id==='body'?'#536f8d':id==='seats'?'#4b5863':'#82909c'])) as Record<ComponentId,string>,[findings,heatmap,period]);
  const modelReady=useCallback(()=>{setModelLoaded(true);onModelStatus('ready');},[onModelStatus]);
  const modelFailed=useCallback(()=>{setAssetError(true);setModelLoaded(false);onModelStatus('fallback');},[onModelStatus]);
  const click=(id:ComponentId)=>onSelect(id);
  const firstHotspot:ComponentId=view==='exterior'?'body':'dashboard';
  const secondHotspot:ComponentId=view==='exterior'?'lighting':'steering';
  return <>
    <color attach="background" args={['#151a21']}/><fog attach="fog" args={['#151a21',12,21]}/>
    <ambientLight intensity={.9}/><hemisphereLight args={['#dce8f5','#303945',1.25]}/>
    <directionalLight position={[4,8,5]} intensity={3.1} castShadow shadow-mapSize={[1024,1024]} shadow-bias={-.00025}/>
    <directionalLight position={[-5,4,-4]} intensity={2.3} color="#83a9d3"/>
    <spotLight position={[1,5,-5]} intensity={65} angle={.48} penumbra={.85} distance={16} color="#dcecff"/>
    <pointLight position={[3,1.6,0]} intensity={22} distance={6} color="#f5f8ff"/>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.12,0]} receiveShadow><planeGeometry args={[200,200]}/><meshStandardMaterial color="#191e25" roughness={.34} metalness={.28}/></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.105,0]}><ringGeometry args={[3.5,5.2,64]}/><meshBasicMaterial color="#303842" transparent opacity={.32}/></mesh>
    <group>
      {!modelUrl||assetError||!modelLoaded?<Exterior colors={colors} onSelect={click} interior={view==='interior'}/>:null}
      {!modelUrl||assetError||!modelLoaded?<Interior colors={colors} onSelect={click}/>:null}
      {modelUrl&&!assetError?<SceneBoundary key={modelUrl} onError={modelFailed}><Suspense fallback={null}><ImportedModel url={modelUrl} onLoaded={modelReady} onSelect={click} colors={colors}/></Suspense></SceneBoundary>:null}
    </group>
    <Hotspot id={firstHotspot} label={labels[firstHotspot]} color={colors[firstHotspot]} selected={selected===firstHotspot} position={view==='exterior'?[.15,1.65,.73]:[.62,1.28,-.25]} onSelect={click}/>
    <Hotspot id={secondHotspot} label={labels[secondHotspot]} color={colors[secondHotspot]} selected={selected===secondHotspot} position={view==='exterior'?[1.96,.84,.33]:[.47,1.28,-.3]} onSelect={click}/>
    {selected!==firstHotspot&&selected!==secondHotspot?<Hotspot id={selected} label={labels[selected]} color="#1c69d4" selected position={componentAnchors[selected]} onSelect={click}/>:null}
    <CameraPreset view={view} resetSignal={resetSignal} turn={keyboardTurn}/>
  </>;
}

function metricText(finding:VehicleViewerProps['findings'][number]|undefined,period:Period){
  if(!finding)return 'No sample';const sample=period==='2025'?finding.previous:finding.current;
  return sample.total?`${sample.negative}/${sample.total} mentions`:'No sample';
}

export default function VehicleViewer({selectedComponent,onSelectComponent,view,onViewChange,heatmap,period,findings,className,modelUrl,onStatusChange}:VehicleViewerProps){
  const [resetSignal,setResetSignal]=useState(0);
  const [webglFailed,setWebglFailed]=useState(false);
  const [keyboardTurn,setKeyboardTurn]=useState(0);
  const root=useRef<HTMLElement>(null);
  const report=useCallback((status:'ready'|'fallback')=>onStatusChange?.(status),[onStatusChange]);
  useEffect(()=>{if(!root.current)return;const canvas=root.current.querySelector('canvas');if(!canvas)return;const key=(event:KeyboardEvent)=>{if(event.target instanceof HTMLElement&&event.target.closest('button'))return;const delta=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0;if(delta){event.preventDefault();setKeyboardTurn(v=>v+delta);}};canvas.addEventListener('keydown',key);return()=>canvas.removeEventListener('keydown',key);},[]);
  const currentFinding=findings.find(f=>f.id===selectedComponent);
  const failed=useCallback(()=>{setWebglFailed(true);report('fallback');},[report]);
  return <section className={`vehicle-viewer ${className??''}`} ref={root} aria-label="Illustrative vehicle viewer">
    <header className="vehicle-viewer__toolbar">
      <div><span className="vehicle-viewer__eyebrow">DESIGN STUDY · LOCAL SYNTHETIC DATA</span><div className="vehicle-viewer__title">Illustrative vehicle <span>G60 case</span></div></div>
      <div className="vehicle-viewer__view-toggle" role="group" aria-label="Vehicle view">
        {(['exterior','interior'] as const).map(option=><button key={option} type="button" aria-pressed={view===option} onClick={()=>onViewChange(option)}>{option==='exterior'?'Exterior':'Interior'}</button>)}
      </div>
      <button type="button" className="vehicle-viewer__reset" onClick={()=>{setKeyboardTurn(0);setResetSignal(v=>v+1);}} aria-label="Reset camera view">Reset view</button>
    </header>
    <div className="vehicle-viewer__stage" data-view={view}>
      {!webglFailed?<SceneBoundary onError={failed} fallback={<div className="vehicle-viewer__fallback" role="img" aria-label="3D view unavailable. Use component controls below."><div className="vehicle-viewer__fallback-car"><div className="vehicle-viewer__fallback-roof"/><div className="vehicle-viewer__fallback-body"/><i/><i/></div><p>3D view unavailable</p><span>Use component controls below to explore the study.</span></div>}>
        <Canvas dpr={[1,1.5]} shadows frameloop="demand" camera={{position:[4.1,2.6,4.8],fov:34,near:.1,far:100}} gl={{antialias:true,alpha:false,powerPreference:'high-performance'}} onCreated={({gl})=>{gl.domElement.tabIndex=0;gl.domElement.setAttribute('aria-label','3D vehicle view. Use arrow keys to rotate.');report('ready');}} fallback={<div className="vehicle-viewer__fallback">3D view unavailable. Use component controls below.</div>}>
          <VehicleScene view={view} selected={selectedComponent} heatmap={heatmap} period={period} findings={findings} onSelect={onSelectComponent} resetSignal={resetSignal} modelUrl={modelUrl} onModelStatus={report} keyboardTurn={keyboardTurn}/>
        </Canvas>
      </SceneBoundary>:<div className="vehicle-viewer__fallback" role="img" aria-label="3D view unavailable. Use component controls below."><div className="vehicle-viewer__fallback-car"><div className="vehicle-viewer__fallback-roof"/><div className="vehicle-viewer__fallback-body"/><i/><i/></div><p>3D view unavailable</p><span>Use component controls below to explore the study.</span></div>}
      <div className="vehicle-viewer__stage-label"><span className="vehicle-viewer__live-dot"/> {view==='exterior'?'Exterior study':'Cockpit study'}<span className="vehicle-viewer__separator">/</span> {period} data</div>
      <div className="vehicle-viewer__stage-note">Illustrative vehicle · no production model</div>
    </div>
    <div className="vehicle-viewer__lower">
      <div className="vehicle-viewer__parts" role="group" aria-label={`${view} components`}>
        {allComponents.filter(id=>areas[view].includes(id)).map(id=>{
          const finding=findings.find(f=>f.id===id);const color=heatmap?componentHeatColor(finding,period):'#87909a';return <button type="button" key={id} aria-pressed={selectedComponent===id} onClick={()=>onSelectComponent(id)} className={selectedComponent===id?'is-selected':''} style={{'--part-color':selectedComponent===id?'#1c69d4':color} as React.CSSProperties}><span className="vehicle-viewer__part-dot"/><span>{labels[id]}</span><small>{metricText(finding,period)}</small></button>;
        })}
      </div>
      <div className="vehicle-viewer__legend" aria-label="Negative feedback legend"><span className="vehicle-viewer__legend-title">{heatmap?`Negative share · ${period}`:'Heatmap off'}</span>{heatmap?<><span><i style={{background:'#e45454'}}/> ≥50%</span><span><i style={{background:'#e8b75a'}}/> ≥25%</span><span><i style={{background:'#57b6a0'}}/> &lt;25%</span><span><i style={{background:'#8a909b'}}/> no sample</span></>:null}<span className="vehicle-viewer__selected-key"><i style={{background:'#1c69d4'}}/> Selected · {labels[selectedComponent]}</span></div>
    </div>
    <div className="vehicle-viewer__sr-status" aria-live="polite">{labels[selectedComponent]} selected. {metricText(currentFinding,period)}.</div>
    <div className="vehicle-viewer__selected-summary"><span className="vehicle-viewer__summary-swatch"/><strong>{labels[selectedComponent]}</strong><span>{metricText(currentFinding,period)}</span><span className="vehicle-viewer__summary-help">Drag to orbit · scroll to zoom · arrow keys to rotate</span></div>
  </section>;
}
