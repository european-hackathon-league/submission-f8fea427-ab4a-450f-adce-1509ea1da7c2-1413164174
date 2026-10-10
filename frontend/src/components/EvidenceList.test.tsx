import {cleanup,render,screen,waitFor,fireEvent} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,expect,it,vi} from "vitest";
import EvidenceList from "./EvidenceList";
import SourceDialog from "./SourceDialog";
import {useState} from "react";
import * as normalize from "../api/normalize";
import {evidence} from "../api/fixtures";
import type {Api,Evidence} from "../api/contracts";
afterEach(cleanup);
it("retains successful observations when another source fails and retries only failed source",async()=>{
 const user=userEvent.setup();let failed=true;
 const api={request:vi.fn(async(path:string)=>{if(path.endsWith("bad")){if(failed)throw new Error("Source access expired");return {...evidence[0],evidence_id:"bad",excerpt:"Recovered source"};}return evidence[0];})} as unknown as Api;
 const open=vi.fn();render(<EvidenceList api={api} runId="run/a" ids={[evidence[0].evidence_id,"bad"]} title="Supporting observations" onOpen={open}/>);
 expect(await screen.findByText(evidence[0].excerpt)).toBeInTheDocument();
 expect(await screen.findByRole("alert")).toHaveTextContent("Source access expired");
 await user.click(screen.getByRole("button",{name:`Open source ${evidence[0].evidence_id}`}));expect(open).toHaveBeenCalledWith(evidence[0]);
 failed=false;await user.click(screen.getByRole("button",{name:"Retry source bad"}));
 expect(await screen.findByText("Recovered source")).toBeInTheDocument();
 expect(api.request).toHaveBeenCalledWith(`/runs/run%2Fa/evidence/${encodeURIComponent(evidence[0].evidence_id)}`);
 expect(vi.mocked(api.request).mock.calls.filter(([p])=>p.endsWith(evidence[0].evidence_id))).toHaveLength(1);
});
it("does not replace new finding evidence with late requests from old selection",async()=>{
 let resolve!:(value:Evidence)=>void;
 const api={request:(path:string)=>path.endsWith("old")?new Promise<Evidence>(r=>{resolve=r;}):Promise.resolve({...evidence[0],evidence_id:"new",excerpt:"Current selection"})} as unknown as Api;
 const {rerender}=render(<EvidenceList api={api} runId="r" ids={["old"]} title="Sources" onOpen={()=>{}}/>);
 expect(screen.getByRole("status")).toHaveTextContent(/Loading/);
 rerender(<EvidenceList api={api} runId="r" ids={["new"]} title="Sources" onOpen={()=>{}}/>);
 await screen.findByText("Current selection");resolve({...evidence[0],evidence_id:"old",excerpt:"Old selection"});
 await waitFor(()=>expect(screen.queryByText("Old selection")).not.toBeInTheDocument());
});
it("rejects mismatched evidence IDs without showing another source",async()=>{
 const api={request:async()=>({...evidence[0],evidence_id:"wrong"})} as unknown as Api;
 render(<EvidenceList api={api} runId="r" ids={["expected"]} title="Sources" onOpen={()=>{}}/>);
 expect(await screen.findByRole("alert")).toHaveTextContent(/identity/i);
 expect(screen.queryByText(evidence[0].excerpt)).not.toBeInTheDocument();
});

it("restores source opener focus when pointer click does not focus button",async()=>{
 const api={mode:"mock",request:async()=>evidence[0]} as unknown as Api;
 function Sources(){const [item,setItem]=useState<Evidence|null>(null);return <><EvidenceList api={api} runId="r" ids={[evidence[0].evidence_id]} title="Sources" onOpen={setItem}/>{item&&<SourceDialog api={api} evidence={item} onClose={()=>setItem(null)}/>}</>;}
 render(<Sources/>);const opener=await screen.findByRole("button",{name:`Open source ${evidence[0].evidence_id}`});
 expect(opener).not.toHaveFocus();fireEvent.click(opener);fireEvent.click(screen.getByRole("button",{name:"Close source"}));expect(opener).toHaveFocus();
});

it.each([
 ["feedback","Customer evidence / feedback"],
 ["study","Uploaded evidence / study"],
 ["sales","Uploaded evidence / sales"],
 ["equipment","Uploaded evidence / equipment"],
 ["strategy","Uploaded evidence / strategy"],
 ["external","External evidence / external"],
] as const)("distinguishes uploaded %s records from customer feedback",async(source_kind,label)=>{
 const item=normalize.evidence({...evidence[0].wire!,source_kind});
 render(<EvidenceList api={{request:async()=>item} as unknown as Api} runId="r" ids={[item.evidence_id]} title="Sources" onOpen={()=>{}}/>);
 expect(await screen.findByText(label)).toBeInTheDocument();
});
