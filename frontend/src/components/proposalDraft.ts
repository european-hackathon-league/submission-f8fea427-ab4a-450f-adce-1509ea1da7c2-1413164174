import type {Accepted,Instruction} from '../api/wire';
export type EditDraft={baseVersion:number;text:string;target:string};
export type VariantDraft={baseVersion:number;groupBaseVersion:number;idea:string;cohorts:string[];needsReview?:boolean};
export type PendingInstruction={key:string;body:Instruction};
export type AcceptedInstruction={result:Accepted;request:PendingInstruction};
export type ProposalDrafts={changes:Record<string,EditDraft>;variants:Record<string,VariantDraft>;command:PendingInstruction|null;accepted:AcceptedInstruction|null;staleBaseVersion:number|null};
export function emptyProposalDrafts():ProposalDrafts{return {changes:{},variants:{},command:null,accepted:null,staleBaseVersion:null};}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const version=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=1;
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(text)&&new Set(value).size===value.length;
function validCommand(value:unknown):value is PendingInstruction{
 if(!record(value)||!text(value.key)||value.key.length>200||!record(value.body))return false;
 const body=value.body;
 return Object.keys(body).every(key=>['operation','base_proposal_set_version','target_ids','changed_fields','intent'].includes(key))&&
 ['edit_change','remove_change','add_change','edit_target','regroup_variants'].includes(String(body.operation))&&version(body.base_proposal_set_version)&&strings(body.target_ids)&&body.target_ids.length>0&&
 (body.intent===undefined||body.intent===null||typeof body.intent==='string')&&record(body.changed_fields)&&Object.values(body.changed_fields).every(field=>field===null||typeof field==='string'||typeof field==='number'&&Number.isFinite(field)||Array.isArray(field)&&field.every(item=>typeof item==='string'));
}
export function readProposalDrafts(key:string|null):ProposalDrafts|null{
 if(!key)return null;
 try{
  const value:unknown=JSON.parse(sessionStorage.getItem(key)??'null');
  if(!record(value)||!record(value.changes)||!record(value.variants)||!(value.staleBaseVersion===null||version(value.staleBaseVersion)))return null;
  if(!Object.values(value.changes).every(draft=>record(draft)&&version(draft.baseVersion)&&typeof draft.text==='string'&&typeof draft.target==='string'))return null;
  if(!Object.values(value.variants).every(draft=>record(draft)&&version(draft.baseVersion)&&version(draft.groupBaseVersion)&&typeof draft.idea==='string'&&strings(draft.cohorts)&&(draft.needsReview===undefined||typeof draft.needsReview==='boolean')))return null;
  if(value.command!==null&&!validCommand(value.command))return null;
  if(value.accepted!==null){
   const accepted=value.accepted;
   if(value.command!==null||!record(accepted)||!validCommand(accepted.request)||!record(accepted.result))return null;
   const result=accepted.result;if(!['command_id','resource_id','resource_url'].every(key=>text(result[key])))return null;
  }
  return value as ProposalDrafts;
 }catch{return null;}
}
export function saveProposalDrafts(key:string|null,value:ProposalDrafts){
 if(!key)return;
 try{sessionStorage.setItem(key,JSON.stringify(value));}catch{/* Storage disabled: in-memory drafts remain usable. */}
}
