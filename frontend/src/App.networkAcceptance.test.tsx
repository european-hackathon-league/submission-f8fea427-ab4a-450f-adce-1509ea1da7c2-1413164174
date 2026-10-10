import {File as NodeFile, Blob as NodeBlob} from 'node:buffer';
import {URL as NodeURL} from 'node:url';
import {cleanup,render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import App from './App';
import {createRealApi} from './api/client';
import {startContractHarness} from '../testing/contractHarness';

afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('completes upload → finding → evidence → edit → Reimagine → numbered explanation → exact-version export over HTTP',async()=>{
 // jsdom supplies browser FormData, while Node fetch requires its native Web API body.
 const nativeForm = await new Response('--empty--\r\n',{headers:{'Content-Type':'multipart/form-data; boundary=empty'}}).formData();
 vi.stubGlobal('FormData',nativeForm.constructor);vi.stubGlobal('File',NodeFile);vi.stubGlobal('Blob',NodeBlob);vi.stubGlobal('URL',NodeURL);
 const harness=await startContractHarness({scenario:'standard_autonomous'});
 try{
  const api=createRealApi(harness.baseUrl,{headers:()=>harness.headers,sessionNamespace:harness.baseUrl});
  const user=userEvent.setup();render(<App api={api}/>);
  await screen.findByRole('option',{name:'BMW i5 M60 / G60'});
  await user.upload(screen.getByLabelText('Upload files'),new NodeFile(['synthetic feedback'],'acceptance.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}) as unknown as File);
  await screen.findByText('ready');await user.click(screen.getByRole('button',{name:'Start run'}));
  await screen.findByText('proposals_ready');
  expect(screen.queryByRole('button',{name:'Continue checkpoint'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('tab',{name:'Evidence'}));
  await user.click(await screen.findByRole('button',{name:'Open source dashboard-E1'}));
  const dialog=screen.getByRole('dialog',{name:'Source reference'});expect(dialog).toHaveTextContent('Feedback, row 12, cells A12');
  await user.click(within(dialog).getByRole('button',{name:'Close source'}));
  await user.click(screen.getByRole('tab',{name:'Proposals'}));
  const text=screen.getByRole('textbox',{name:'Proposal text'});await user.clear(text);await user.type(text,'Keep direct climate access visible.');
  await user.click(screen.getByRole('button',{name:'Save edit'}));
  await screen.findByText(/Waiting for backend recomputation/);await user.click(screen.getByRole('button',{name:'Refresh proposals'}));
  await screen.findByRole('heading',{name:'Proposals / version 2'});
  expect(screen.getByRole('textbox',{name:'Proposal text'})).toHaveValue('Keep direct climate access visible.');
  await user.click(screen.getByRole('button',{name:'Reimagine'}));
  await screen.findByText('partial',{}, {timeout:8000});
  const assets=screen.getByRole('region',{name:'Current render assets'});expect(within(assets).getByRole('img')).toHaveAttribute('src',expect.stringContaining('/vehicles/frontend-render-annotation.svg'));
  await user.click(screen.getByRole('button',{name:'Explain change 1 change-dashboard'}));
  const explanation=await screen.findByRole('region',{name:'Change explanation change-dashboard'});
  expect(explanation).toHaveTextContent('Proposal version 2 / variant variant-digital');expect(explanation).toHaveTextContent('Keep direct climate access visible.');
  await waitFor(()=>expect(explanation.parentElement).toHaveFocus());
  await user.click(screen.getByRole('tab',{name:'History'}));
  await user.selectOptions(screen.getByRole('combobox',{name:'Inspect proposal version'}),'2');
  await screen.findByRole('heading',{name:'Immutable proposal version 2'});
  await user.click(screen.getByRole('button',{name:'Request exact-version export'}));
  const download=await screen.findByRole('link',{name:'Download authorized export'},{timeout:5000});
  const artifact=await fetch(download.getAttribute('href')!).then(r=>{expect(r.ok).toBe(true);return r.json();});
  expect(artifact).toMatchObject({synthetic:true,proposal_set_version:2,variant_ids:['variant-digital'],source_version_ids:['synthetic-source-v1']});
  expect(artifact.proposals.changes.find((c:{change_id:string})=>c.change_id==='change-dashboard').after).toBe('Keep direct climate access visible.');
  expect(harness.validationErrors).toEqual([]);
 }finally{cleanup();await harness.close();}
},25000);

it('labels opt-in HTTP harness before connection and throughout workspace',async()=>{
 vi.stubEnv('VITE_CONTRACT_HARNESS','true');vi.stubEnv('VITE_API_MODE','real');
 const initial=render(<App/>);expect(screen.getByRole('note',{name:'Synthetic contract harness'})).toHaveTextContent(/synthetic/i);
 expect(screen.getByRole('heading',{name:'Connect to application API'})).toBeInTheDocument();
 const {createMockApi}=await import('./api/client');initial.unmount();render(<App api={createMockApi()}/>);
 expect(screen.getByRole('note',{name:'Synthetic contract harness'})).toBeInTheDocument();
});
