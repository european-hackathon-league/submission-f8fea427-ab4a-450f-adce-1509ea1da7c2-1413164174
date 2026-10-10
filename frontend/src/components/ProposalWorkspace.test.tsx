import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import ProposalWorkspace from './ProposalWorkspace';
import {ApiError} from '../api/client';
import type {Api,Workspace} from '../api/contracts';
import type * as Wire from '../api/wire';
import * as normalize from '../api/normalize';
import scenarios from '../../fixtures/scenarios.json';
afterEach(()=>{cleanup();sessionStorage.clear();});
const accepted={command_id:'command-1',resource_id:'proposals',resource_url:'/api/v1/runs/run_demo/proposals'};
function workspace():Workspace{
 const p=structuredClone(scenarios.standard_autonomous.payloads);const w:Workspace={snapshot:normalize.snapshot(p.Snapshot as Wire.Snapshot),proposals:normalize.proposals(p.Proposals as unknown as Wire.Proposals),findings:p.FindingsPage.items.map(f=>normalize.finding(f as unknown as Wire.Finding)),checkpoint:null,research:[],history:[],graph:{nodes:[],edges:[]}};
 w.snapshot.available_actions=['edit'];return w;
}
function setup(request=vi.fn(async(..._args:unknown[])=>accepted),w=workspace()){
 const props={api:{mode:'real',request} as unknown as Api,workspace:w,variantId:w.proposals.variants[0].variant_id,onVariantChange:vi.fn(),onRefresh:vi.fn(async()=>w),onEvidence:vi.fn(),sessionNamespace:'real:api:workspace'};
 return {props,request,...render(<ProposalWorkspace {...props}/>)};
}
it('sends canonical text edits against displayed exact proposal version and change identity',async()=>{
 const user=userEvent.setup();const {props,request}=setup();const field=screen.getByLabelText('Proposal text');await user.clear(field);await user.type(field,'Edited proposal');await user.click(screen.getByRole('button',{name:'Save edit'}));
 expect(request).toHaveBeenCalledWith('/runs/run_demo/instructions',{operation:'edit_change',base_proposal_set_version:1,target_ids:[props.workspace.proposals.variants[0].changes[0].change_id],changed_fields:{after:'Edited proposal'}},expect.any(String));
 expect(screen.getByText(/Instruction accepted.*command-1/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Save edit'})).toBeDisabled();
 expect(screen.getByText(/Waiting for backend recomputation/)).toBeInTheDocument();
});
it('allows numeric target editing and clearing to null while invalid text never crosses API boundary',async()=>{
 const user=userEvent.setup();const {request}=setup(vi.fn(async()=>{throw new ApiError('invalid_input','Fix target',null,422)}));const target=screen.getByLabelText('Target');await user.clear(target);await user.type(target,'not numeric');expect(screen.getByRole('button',{name:'Save target'})).toBeDisabled();await user.clear(target);await user.type(target,'2.5');await user.click(screen.getByRole('button',{name:'Save target'}));expect(request.mock.calls[0][1]).toMatchObject({operation:'edit_target',changed_fields:{target:2.5}});await user.clear(target);await user.click(screen.getByRole('button',{name:'Save target'}));expect(request.mock.calls[1][1]).toMatchObject({changed_fields:{target:null}});
});
it('retains stale text and target drafts until explicit current-version reconciliation',async()=>{
 const user=userEvent.setup();const {props,rerender,request}=setup();await user.clear(screen.getByLabelText('Proposal text'));await user.type(screen.getByLabelText('Proposal text'),'Unsaved draft');const updated=structuredClone(props.workspace);updated.proposals.proposal_set_version=2;updated.proposals.variants[0].changes[0].after='Other user edit';rerender(<ProposalWorkspace {...props} workspace={updated}/>);expect(screen.getByLabelText('Proposal text')).toHaveValue('Unsaved draft');expect(screen.getByRole('button',{name:'Save edit'})).toBeDisabled();await user.click(screen.getByRole('button',{name:'Use current version with my draft'}));await user.click(screen.getByRole('button',{name:'Save edit'}));expect(request.mock.calls[0][1]).toMatchObject({base_proposal_set_version:2,changed_fields:{after:'Unsaved draft'}});
});
it('preserves add draft base version across reload and variant switching',async()=>{
 const user=userEvent.setup();const {props,unmount}=setup();await user.type(screen.getByLabelText('PM instruction'),'New idea');unmount();const w=structuredClone(props.workspace);w.proposals.proposal_set_version=2;render(<ProposalWorkspace {...props} workspace={w}/>);expect(screen.getByLabelText('PM instruction')).toHaveValue('New idea');expect(screen.getByRole('button',{name:'Add proposal'})).toBeDisabled();await user.click(screen.getByRole('button',{name:'Use current version with my PM idea'}));await user.click(screen.getByRole('button',{name:'Add proposal'}));expect(props.api.request).toHaveBeenCalledWith(expect.any(String),{operation:'add_change',base_proposal_set_version:2,target_ids:[props.variantId],changed_fields:{after:'New idea'}},expect.any(String));
});
it('regroups only backend cohort identities, supports empty scope and preserves drafts on version changes',async()=>{
 const user=userEvent.setup();const {props,request}=setup();await user.click(screen.getByText('Regroup variant scope'));const cohort=props.workspace.proposals.variants[0].cohort_scope[0];await user.click(screen.getByLabelText(cohort));await user.click(screen.getByRole('button',{name:'Save grouping'}));expect(request.mock.calls[0][1]).toEqual({operation:'regroup_variants',base_proposal_set_version:1,target_ids:[props.variantId],changed_fields:{cohort_ids:[]}});expect(screen.queryByRole('textbox',{name:'Cohort scope'})).not.toBeInTheDocument();
});
it('keeps uncertain command frozen and retries original key and body after reload',async()=>{
 const user=userEvent.setup();const request=vi.fn(async()=>{throw new ApiError('network_error','Connection lost',null,null,true)});const {props,unmount}=setup(request);await user.type(screen.getByLabelText('Proposal text'),' local');await user.click(screen.getByRole('button',{name:'Save edit'}));expect(screen.getByLabelText('Proposal text')).toBeDisabled();const first=request.mock.calls[0];unmount();render(<ProposalWorkspace {...props} api={{...props.api}}/>);await user.click(screen.getByRole('button',{name:'Retry same instruction'}));expect(request.mock.calls[1]).toEqual(first);
});
it('refreshes stale rejection without rebasing the retained draft automatically',async()=>{
 const user=userEvent.setup();const request=vi.fn(async()=>{throw new ApiError('stale_version','Changed elsewhere',2,409)});const {props}=setup(request);await user.type(screen.getByLabelText('Proposal text'),' retained');await user.click(screen.getByRole('button',{name:'Save edit'}));expect(props.onRefresh).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:'Save edit'})).toBeDisabled();expect((screen.getByLabelText('Proposal text') as HTMLTextAreaElement).value).toContain('retained');
});
it('does not resend accepted instruction when refresh fails; acceptance survives reload',async()=>{
 const user=userEvent.setup();const w=workspace();const request=vi.fn(async()=>accepted);const props={api:{mode:'real',request} as unknown as Api,workspace:w,variantId:w.proposals.variants[0].variant_id,onVariantChange:vi.fn(),onEvidence:vi.fn(),onRefresh:vi.fn(async()=>{throw new Error('Refresh offline')}),sessionNamespace:'real:api:workspace'};const view=render(<ProposalWorkspace {...props}/>);await user.click(screen.getByRole('button',{name:'Save edit'}));expect(screen.getByRole('alert')).toHaveTextContent('Refresh offline');view.unmount();render(<ProposalWorkspace {...props} api={{...props.api}}/>);expect(screen.getByText(/Instruction accepted/)).toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Refresh proposals'}));expect(request).toHaveBeenCalledOnce();
});
it('shows recomputed version without clearing unrelated unsaved target draft',async()=>{
 const user=userEvent.setup();const {props,rerender}=setup();await user.clear(screen.getByLabelText('Target'));await user.type(screen.getByLabelText('Target'),'9');await user.click(screen.getByRole('button',{name:'Save edit'}));const w=structuredClone(props.workspace);w.proposals.proposal_set_version=2;w.snapshot.analysis_status='proposals_ready';rerender(<ProposalWorkspace {...props} workspace={w}/>);expect(screen.getByText(/Backend returned proposal version 2/)).toBeInTheDocument();expect(screen.getByLabelText('Target')).toHaveValue('9');
});
it('prevents duplicate submissions and ignores accepted results after unmount',async()=>{
 let resolve!:(value:Wire.Accepted)=>void;const request=vi.fn(()=>new Promise<Wire.Accepted>(r=>resolve=r));const {props,unmount}=setup(request);const button=screen.getByRole('button',{name:'Save edit'});fireEvent.click(button);fireEvent.click(button);expect(request).toHaveBeenCalledOnce();unmount();await act(async()=>resolve(accepted));expect(props.onRefresh).not.toHaveBeenCalled();
});
it('migrates legacy edit draft but requires explicit review of unversioned legacy idea',async()=>{
 const w=workspace();const change=w.proposals.variants[0].changes[0];const props={api:{mode:'real',request:vi.fn(async()=>accepted)} as unknown as Api,workspace:w,variantId:w.proposals.variants[0].variant_id,onVariantChange:vi.fn(),onRefresh:async()=>w,onEvidence:vi.fn(),sessionNamespace:'migration',legacyDrafts:[[`${w.proposals.variants[0].variant_id}:${change.change_id}`,{text:'Saved legacy edit',target:'4',baseVersion:1}]] as Array<[string,{text:string;target:string;baseVersion:number}]>,legacyIdea:'Legacy idea'};render(<ProposalWorkspace {...props}/>);expect(screen.getByLabelText('Proposal text')).toHaveValue('Saved legacy edit');expect(screen.getByLabelText('PM instruction')).toHaveValue('Legacy idea');expect(screen.getByRole('button',{name:'Add proposal'})).toBeDisabled();expect(screen.getByText(/Legacy PM draft needs explicit review/)).toBeInTheDocument();
});
it('separates proposal decision state, target validation and selected alternative without creating approval controls',()=>{
 const {props}=setup();expect(screen.getByText(/PM selection is an alternative/)).toBeInTheDocument();expect(screen.getByText(/Decision state: proposed/)).toBeInTheDocument();expect(screen.queryByRole('button',{name:/approve/i})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'View evidence'}));expect(props.onEvidence).toHaveBeenCalledWith(props.workspace.proposals.variants[0].changes[0]);
});
it('reconciling PM idea does not rebase grouping draft implicitly',async()=>{
 const user=userEvent.setup();const {props,rerender}=setup();const w=structuredClone(props.workspace);w.proposals.proposal_set_version=2;rerender(<ProposalWorkspace {...props} workspace={w}/>);await user.click(screen.getByRole('button',{name:'Use current version with my PM idea'}));await user.click(screen.getByText('Regroup variant scope'));expect(screen.getByRole('button',{name:'Save grouping'})).toBeDisabled();expect(screen.getByRole('button',{name:'Use current version with my grouping'})).toBeInTheDocument();
});
it('keeps unavailable change drafts visible and never binds them to replacement identities',async()=>{
 const user=userEvent.setup();const {props,rerender}=setup();await user.type(screen.getByLabelText('Proposal text'),' archived draft');const w=structuredClone(props.workspace);w.proposals.proposal_set_version=2;w.proposals.variants[0].changes=[];rerender(<ProposalWorkspace {...props} workspace={w}/>);expect(screen.getByText(/Retained draft for unavailable change/)).toBeInTheDocument();expect(screen.getByText(/archived draft/)).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Save edit'})).not.toBeInTheDocument();
});
it('retains explicitly missing variant selection and exposes drafts without fallback mutation',()=>{
 const {props,rerender}=setup();rerender(<ProposalWorkspace {...props} variantId='removed-variant'/>);expect(screen.getByText(/Selected variant unavailable/)).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Add proposal'})).not.toBeInTheDocument();expect(screen.getByRole('combobox',{name:'Variant'})).toHaveValue('');
});
it('unlocks accepted recomputation when authoritative new proposals await a real PM checkpoint',async()=>{
 const user=userEvent.setup();const {props,rerender}=setup();await user.click(screen.getByRole('button',{name:'Save edit'}));const w=structuredClone(props.workspace);w.proposals.proposal_set_version=2;w.snapshot.analysis_status='waiting_for_pm';rerender(<ProposalWorkspace {...props} workspace={w}/>);expect(screen.getByText(/Backend returned proposal version 2/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Use current version with my draft'})).toBeEnabled();
});
it('replays uncertain command even when backend processing temporarily removes edit action',async()=>{
 const user=userEvent.setup();const request=vi.fn(async()=>{throw new ApiError('network_error','Response lost',null,null,true)});const {props,rerender}=setup(request);await user.click(screen.getByRole('button',{name:'Save edit'}));const w=structuredClone(props.workspace);w.snapshot.available_actions=[];w.snapshot.analysis_status='processing';rerender(<ProposalWorkspace {...props} workspace={w}/>);await user.click(screen.getByRole('button',{name:'Retry same instruction'}));expect(request).toHaveBeenCalledTimes(2);expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
});
it('binds removal to stable change identity and exact version',async()=>{
 const user=userEvent.setup();const {props,request}=setup();await user.click(screen.getByRole('button',{name:'Remove change 1'}));expect(request.mock.calls[0][1]).toEqual({operation:'remove_change',base_proposal_set_version:1,target_ids:[props.workspace.proposals.variants[0].changes[0].change_id],changed_fields:{}});
});
it('isolates edits and PM idea drafts by variant identity and API session namespace',async()=>{
 const user=userEvent.setup();const w=workspace();w.proposals.variants.push({...structuredClone(w.proposals.variants[0]),variant_id:'second',title:'Second alternative'});const {props,rerender}=setup(undefined,w);await user.type(screen.getByLabelText('PM instruction'),'First idea');await user.type(screen.getByLabelText('Proposal text'),' first edit');rerender(<ProposalWorkspace {...props} variantId='second'/>);expect(screen.getByLabelText('PM instruction')).toHaveValue('');expect((screen.getByLabelText('Proposal text') as HTMLTextAreaElement).value).not.toContain('first edit');await user.type(screen.getByLabelText('PM instruction'),'Second idea');rerender(<ProposalWorkspace {...props}/>);expect(screen.getByLabelText('PM instruction')).toHaveValue('First idea');rerender(<ProposalWorkspace {...props} sessionNamespace='other workspace'/>);expect(screen.getByLabelText('PM instruction')).toHaveValue('');
});
it('retains editable draft and shows field details after definitive access or validation rejection',async()=>{
 const user=userEvent.setup();const {props}=setup(vi.fn(async()=>{throw new ApiError('forbidden','Workspace denied',null,403,false,[{field:'after',message:'Denied'}])}));await user.type(screen.getByLabelText('Proposal text'),' retained');await user.click(screen.getByRole('button',{name:'Save edit'}));expect(screen.getByRole('alert')).toHaveTextContent('Workspace denied');expect(screen.getByRole('alert')).toHaveTextContent('after');expect(screen.getByLabelText('Proposal text')).toBeEnabled();expect(props.onRefresh).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Retry same instruction'})).not.toBeInTheDocument();
});
it('retains accepted failed recomputation without blindly resubmitting',async()=>{
 const user=userEvent.setup();const {props,rerender,request}=setup();await user.click(screen.getByRole('button',{name:'Save edit'}));const w=structuredClone(props.workspace);w.snapshot.analysis_status='failed';rerender(<ProposalWorkspace {...props} workspace={w}/>);expect(screen.getByRole('alert')).toHaveTextContent('Backend recomputation failed');await user.click(screen.getByRole('button',{name:'Refresh proposals'}));expect(request).toHaveBeenCalledOnce();expect(screen.getByLabelText('Proposal text')).toBeDisabled();
});
it('treats malformed acceptance as uncertain and does not erase draft',async()=>{
 const user=userEvent.setup();const {request}=setup(vi.fn(async()=>({resource_id:'missing-command'} as typeof accepted)));await user.click(screen.getByRole('button',{name:'Save edit'}));expect(screen.getByRole('alert')).toHaveTextContent('outcome uncertain');expect(screen.getByRole('button',{name:'Retry same instruction'})).toBeInTheDocument();expect(request).toHaveBeenCalledOnce();
});
it('returns focus to proposal heading when focused change disappears after server update',async()=>{
 const {props,rerender}=setup();screen.getByRole('button',{name:'Remove change 1'}).focus();const w=structuredClone(props.workspace);w.proposals.variants[0].changes=[];w.proposals.proposal_set_version=2;rerender(<ProposalWorkspace {...props} workspace={w}/>);await waitFor(()=>expect(screen.getByRole('heading',{name:'Proposals / version 2'})).toHaveFocus());
});
it('keeps mock-mode unsaved draft when evidence navigation unmounts and returns without browser storage',async()=>{
 const user=userEvent.setup();const w=workspace();const props={api:{mode:'mock',request:vi.fn()} as unknown as Api,workspace:w,variantId:w.proposals.variants[0].variant_id,onVariantChange:vi.fn(),onRefresh:async()=>w,onEvidence:vi.fn(),sessionNamespace:'mock'};const view=render(<ProposalWorkspace {...props}/>);await user.clear(screen.getByLabelText('Proposal text'));await user.type(screen.getByLabelText('Proposal text'),'Mock unsaved draft');view.unmount();render(<ProposalWorkspace {...props}/>);expect(screen.getByLabelText('Proposal text')).toHaveValue('Mock unsaved draft');expect(sessionStorage.length).toBe(0);
});
