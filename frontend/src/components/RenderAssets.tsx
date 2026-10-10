import {useEffect,useRef,useState} from 'react';
import type {Api} from '../api/contracts';
import type {Asset,RenderResult} from '../api/wire';
export interface RenderAssetsProps{api:Api;assets:RenderResult['assets'];identity:string;onRefreshLinks?:()=>void;}
const previewMedia=new Set(['image/png','image/jpeg','image/webp','image/gif','image/avif','image/svg+xml']);
function authorizedUrl(api:Api,value:string):string|null{
 try{
  if(typeof value!=='string'||!value.trim())return null;
  const resolved=api.linkUrl?api.linkUrl(value):value;
  if(!resolved)return null;
  const url=new URL(resolved,window.location.href);
  return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;
 }catch{return null;}
}
function Preview({asset,url,onRefreshLinks}:{asset:Asset;url:string;onRefreshLinks?:()=>void}){
 const [status,setStatus]=useState<'loading'|'ready'|'error'|'timeout'>('loading');
 const [attempt,setAttempt]=useState(0);
 const currentAttempt=useRef(attempt);currentAttempt.current=attempt;
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const figure=useRef<HTMLElement>(null);
 useEffect(()=>{
  timer.current=setTimeout(()=>setStatus('timeout'),15000);
  if(attempt>0)figure.current?.focus();
  return()=>{clearTimeout(timer.current);};
 },[attempt]);
 function finish(next:'ready'|'error'){
  if(currentAttempt.current!==attempt)return;
  clearTimeout(timer.current);setStatus(next);
 }
 const failed=status==='error'||status==='timeout';
 return <figure ref={figure} tabIndex={-1} aria-label={`Variant asset ${asset.asset_id}`}>
  <figcaption>Asset {asset.asset_id} / {asset.media_type}</figcaption>
  {!failed&&<img key={attempt} src={url} alt={`Variant asset ${asset.asset_id} preview`} referrerPolicy="no-referrer" decoding="async" onLoad={()=>finish('ready')} onError={()=>finish('error')} style={{display:'block',maxWidth:'100%',height:'auto'}}/>}
  {status==='loading'&&<p role="status">Loading asset {asset.asset_id}…</p>}
  {status==='ready'&&<p role="status">Asset {asset.asset_id} loaded.</p>}
  {failed&&<>
   <p role="alert">Asset {asset.asset_id} preview unavailable{status==='timeout'?': loading timed out.':'.'}</p>
   <p>Baseline and numbered explanations remain available. Preview retry uses the returned authorized link.</p>
   <button onClick={()=>{setStatus('loading');setAttempt(old=>old+1);}}>Retry asset {asset.asset_id} preview</button>
   {onRefreshLinks&&<button onClick={onRefreshLinks}>Refresh asset links</button>}
  </>}
  <a href={url} target="_blank" rel="noreferrer">Open variant asset {asset.asset_id}</a>
 </figure>;
}
export default function RenderAssets({api,assets,identity,onRefreshLinks}:RenderAssetsProps){
 const unique=new Map<string,{asset:Asset;conflict:boolean}>();
 let invalid=false;
 for(const asset of assets){
  if(typeof asset?.asset_id!=='string'||!asset.asset_id||typeof asset.media_type!=='string'||!asset.media_type){invalid=true;continue;}
  const previous=unique.get(asset.asset_id);
  if(previous){if(previous.asset.url!==asset.url||previous.asset.media_type!==asset.media_type)previous.conflict=true;}
  else unique.set(asset.asset_id,{asset,conflict:false});
 }
 return <>
  {!assets.length&&<p>No bound asset supplied for this variant. Baseline remains independently available.</p>}
  {invalid&&<p role="alert">Asset identity or media type unavailable. Preview withheld.</p>}
  {[...unique.values()].map(({asset,conflict})=>{
   const url=authorizedUrl(api,asset.url);
   const key=JSON.stringify([identity,asset.asset_id,asset.url,url,asset.media_type]);
   if(conflict)return <p key={key} role="alert">Conflicting asset identity {asset.asset_id}. Preview and link withheld.</p>;
   if(!url)return <p key={key} role="alert">Asset {asset.asset_id}: authorized web link unavailable. Baseline and numbered explanations remain available.</p>;
   if(!previewMedia.has(asset.media_type.toLowerCase()))return <figure key={key}><figcaption>Asset {asset.asset_id} / {asset.media_type}</figcaption><p>Inline preview unavailable for {asset.media_type}. Geometry and semantic mappings are not inferred.</p><a href={url} target="_blank" rel="noreferrer">Open variant asset {asset.asset_id}</a></figure>;
   return <Preview key={key} asset={asset} url={url} onRefreshLinks={onRefreshLinks}/>;
  })}
 </>;
}
