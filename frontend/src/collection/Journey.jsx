import React,{useEffect,useRef,useState,lazy,Suspense} from 'react';
import {ArrowDown,ArrowUpRight,ArrowRight,UserRound} from 'lucide-react';
import {chapters,models,families} from './journeyData.js';
import {clamp,storyProgress,dampProgress,journeySample} from './journeyMotion.js';
import VehicleStage from './VehicleStage.jsx';
const VehicleViewer=lazy(()=>import('./VehicleViewer.jsx'));
import './journey.css';
import './vehicleViewer.css';
export default function Journey({onOpen}){
 const [viewer,setViewer]=useState(null);
 const track=useRef(null),progress=useRef(0),copies=useRef([]),line=useRef(null);
 const [active,setActive]=useState(0),[filter,setFilter]=useState('All'),[inCollection,setInCollection]=useState(false);
 const [reduce,setReduce]=useState(()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false);
 useEffect(()=>{const q=window.matchMedia?.('(prefers-reduced-motion: reduce)');const change=()=>setReduce(q.matches);q?.addEventListener('change',change);return()=>q?.removeEventListener('change',change);},[]);
 useEffect(()=>{
  if(reduce)return;
  let frame=0,last=0,lastActive=-1,target=0,lastPaint=-1;
  const measure=()=>{if(!track.current)return;const r=track.current.getBoundingClientRect();target=storyProgress(-r.top,track.current.offsetHeight-window.innerHeight,4);setInCollection(r.bottom<window.innerHeight*.6);};
  const tick=time=>{
   const dt=Math.min((time-last)/1000||1/60,.05);last=time;
   progress.current=dampProgress(progress.current,target,dt);
   if(Math.abs(target-progress.current)<.00005)progress.current=target;
   if(lastPaint===progress.current){frame=requestAnimationFrame(tick);return;}lastPaint=progress.current;
   const sample=journeySample(progress.current),p=progress.current,chapter=clamp(Math.floor(p+.25),0,3);
   if(chapter!==lastActive){lastActive=chapter;setActive(chapter);}
   copies.current.forEach((el,i)=>{if(!el)return;const distance=p-i;const opacity=sample.from===sample.to?(i===sample.from?1:0):i===sample.from?1-sample.mix:i===sample.to?sample.mix:0;el.style.opacity=String(opacity);el.style.transform=`translate3d(0,${clamp(distance,-1,1)*-24}px,0)`;el.style.visibility=opacity>.005?'visible':'hidden';el.inert=i!==chapter;});
   if(line.current)line.current.style.transform=`scaleX(${p/3})`;
   frame=requestAnimationFrame(tick);
  };
  measure();frame=requestAnimationFrame(tick);window.addEventListener('scroll',measure,{passive:true});window.addEventListener('resize',measure);
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',measure);window.removeEventListener('resize',measure);};
 },[reduce]);
 function jump(i){if(reduce){document.getElementById(`static-${chapters[i].id}`)?.scrollIntoView({behavior:'instant'});return;}const el=track.current;if(el)window.scrollTo({top:window.scrollY+el.getBoundingClientRect().top+(el.offsetHeight-window.innerHeight)*i/3,behavior:'smooth'});}
 const current=chapters[active],visible=models.filter(m=>filter==='All'||m.family===filter);
 const copy=(c,i)=>{const Heading=i===0?'h1':'h2';return <><span className="j-eyebrow">{c.eyebrow}</span><Heading className="j-title">{c.title.map(t=><span key={t}>{t}</span>)}</Heading><p className="j-description">{c.description}</p><div className="j-copy-details"><span>{c.id}</span><span>{c.count===1?'Standard model · China':`${c.count} variants · One perspective`}</span></div>{i===0?<button className="j-discover" onClick={()=>jump(1)}><span className="j-round-arrow"><ArrowDown/></span>Scroll to discover</button>:<a className="j-model-link" href="#lineup" onClick={()=>setFilter(c.id)}>Explore {c.id}<ArrowUpRight/></a>}</>};
 return <div className={`journey-root ${inCollection?'j-in-collection':''}`}>
  <a className="j-skip" href="#lineup">Skip animation and explore models</a>
  <header className="j-header"><a className="j-brand" href="#" onClick={e=>{e.preventDefault();jump(0);}}><span className="j-mark" aria-hidden="true"><i/><i/><i/></span><b>FORM</b><span>BMW perspectives</span></a><nav aria-label="Experience navigation"><button onClick={()=>jump(0)}>The journey</button><a href="#lineup">The collection</a></nav><button className="j-workspace-button" onClick={()=>onOpen(null)}>Open workspace<ArrowUpRight/></button></header>
  <main>{reduce?<div className="j-static-story">{chapters.map((c,i)=><section id={`static-${c.id}`} className="j-static-chapter" key={c.id}><div className="j-static-copy">{copy(c,i)}</div><img src={`/images/bmw/${c.asset}.webp`} alt={c.name}/></section>)}</div>:<section ref={track} className="j-scroll-track" aria-label="BMW scroll journey"><div className="j-stage">
   <VehicleStage progress={progress}/><div className="j-scene-shade" aria-hidden="true"/>
   <div className="j-giant-model" aria-hidden="true">{current.id}</div>
   {chapters.map((c,i)=><article ref={el=>copies.current[i]=el} className="j-copy j-copy-left" key={c.id} style={{opacity:i===0?1:0,visibility:i===0?'visible':'hidden'}} aria-hidden={active!==i}>{copy(c,i)}</article>)}
   <div className="j-family-caption"><span>THE {current.id==='F70'?'1':current.id==='G70'?'7':'5'}</span><span>{current.name}<small>{current.id==='G68'?'Long wheelbase · China':'360° perspective'}</small></span></div>
   <button className="j-inspect" onClick={()=>setViewer(current.model)}>Explore in 360° <ArrowUpRight size={12}/></button>
   <nav className="j-chapter-rail" aria-label="Journey chapters">{chapters.map((c,i)=><button key={c.id} aria-label={`Go to ${c.label}`} aria-current={active===i?'step':undefined} className={active===i?'is-current':''} onClick={()=>jump(i)}><span className="j-rail-label">{c.id}</span><span className="j-rail-dot"/></button>)}</nav>
   <div className="j-stage-footer"><span><UserRound/>{current.person}</span><div className="j-scroll-status"><span>0{active+1}</span><div className="j-progress-track"><i ref={line}/></div><span>04</span></div><span className="j-scroll-hint">{active===3?'Keep scrolling for all 24 variants':'Scroll to turn the perspective'}<ArrowDown/></span></div>
  </div></section>}
  <section className="j-lineup" id="lineup" aria-labelledby="lineup-title"><div className="j-lineup-heading"><div><span className="j-eyebrow">Four families. Every requested perspective.</span><h2 id="lineup-title">ONE PERSON.<br/>24 POSSIBILITIES.</h2></div><p>Choose your starting point. Every variant opens the same requirements workspace, with your selected model in context.</p></div>
  <div className="j-viewer-entry"><button className="j-viewer-link" onClick={()=>setViewer(visible[0].id)}>Explore the collection in 360° ↗</button><button className="j-viewer-link" onClick={()=>setViewer('I20')}>Explore the BMW iX ↗</button></div>
  <div className="j-filters" role="group" aria-label="Filter BMW collection">{['All',...families.map(f=>f.id)].map(item=><button key={item} aria-pressed={filter===item} className={filter===item?'selected':''} onClick={()=>setFilter(item)}>{item}<span>{item==='All'?24:models.filter(m=>m.family===item).length}</span></button>)}</div>
  <p className="j-collection-count" aria-live="polite">{visible.length} {visible.length===1?'model':'variants'} · {filter==='All'?'F70 / G60 / G68 / G70':families.find(f=>f.id===filter).name}</p>
  <div className="j-model-grid">{visible.map(m=><button key={m.id} className="j-model-card" onClick={()=>onOpen(m)} aria-label={`Explore ${m.name}`}><div className="j-card-top"><span>{m.family} / {m.powertrain}</span><ArrowUpRight/></div><div className="j-card-visual"><img src={m.image} alt="" loading="lazy"/></div><div className="j-card-caption"><h3>{m.name}</h3><p>{m.theme}</p></div></button>)}</div>
  <p className="j-imagery-note">Representative family imagery. Variant names follow the requested dataset; G68 is the standard China long-wheelbase entry.</p>
  <div className="j-customer-note"><UserRound/><p><strong>Every drive starts with a person.</strong>Bring the driver's routines, passenger needs and customer evidence into the next decision.</p><button onClick={()=>onOpen(null)}>Explore the workspace<ArrowRight/></button></div></section></main>
  <footer className="j-footer"><span>FORM / BMW perspectives</span><span>Independent product concept · <a href="https://www.bmw.de/de/neufahrzeuge.html" target="_blank" rel="noreferrer">BMW model imagery</a></span><button onClick={()=>jump(0)}>Back to the beginning<ArrowUpRight/></button></footer>
  {viewer&&<Suspense fallback={<p role="status">Preparing model viewer…</p>}><VehicleViewer initial={viewer} onClose={()=>setViewer(null)}/></Suspense>}
 </div>;
}
