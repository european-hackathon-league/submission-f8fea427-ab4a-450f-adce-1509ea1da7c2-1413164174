import {afterEach,expect,it} from 'vitest';
import {readProposalDrafts,saveProposalDrafts,emptyProposalDrafts} from './proposalDraft';
afterEach(()=>sessionStorage.clear());
it('round trips version-bound edits, add and cohort drafts with exact uncertain command',()=>{
 const state=emptyProposalDrafts();state.changes['variant/change']={baseVersion:2,text:'Draft',target:''};state.variants.variant={baseVersion:2,groupBaseVersion:2,idea:'Idea',cohorts:[]};state.command={key:'same-key',body:{operation:'edit_target',base_proposal_set_version:2,target_ids:['change'],changed_fields:{target:null}}};
 saveProposalDrafts('scope',state);expect(readProposalDrafts('scope')).toEqual(state);expect(readProposalDrafts('other')).toBeNull();
});
it.each([
 {changes:{a:{baseVersion:0,text:'x',target:''}}},
 {variants:{v:{baseVersion:1,idea:'x',cohorts:['a','a']}}},
 {command:{key:'x',body:{operation:'approve',base_proposal_set_version:1,target_ids:['x'],changed_fields:{}}}},
 {command:{key:'x',body:{operation:'edit_target',base_proposal_set_version:1,target_ids:['x'],changed_fields:{target:{bad:true}}}}},
 {command:{key:'x',body:{operation:'edit_change',base_proposal_set_version:1,target_ids:['x'],changed_fields:{after:'x'},actor:'injected'}}},
 {accepted:{command_id:'x',resource_id:'x',resource_url:'/proposals'}},
])('rejects malformed stored drafts or commands %#',patch=>{
 sessionStorage.setItem('scope',JSON.stringify({...emptyProposalDrafts(),...patch}));expect(readProposalDrafts('scope')).toBeNull();
});
it('keeps storage disabled nonfatal',()=>{
 const old=Object.getOwnPropertyDescriptor(window,'sessionStorage');Object.defineProperty(window,'sessionStorage',{get(){throw new Error('disabled')},configurable:true});
 expect(readProposalDrafts('scope')).toBeNull();expect(()=>saveProposalDrafts('scope',emptyProposalDrafts())).not.toThrow();Object.defineProperty(window,'sessionStorage',old!);
});
