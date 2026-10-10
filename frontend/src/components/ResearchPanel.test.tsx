import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import ResearchPanel from "./ResearchPanel";
import { evidence, findings, research } from "../api/fixtures";
import * as normalize from "../api/normalize";
import type { Api, Research } from "../api/contracts";
import type * as Wire from "../api/wire";
afterEach(cleanup);
const api={request:async(path:string)=>{const found=evidence.find(e=>path.endsWith(encodeURIComponent(e.evidence_id)));if(!found)throw new Error("Citation unavailable");return found;}} as unknown as Api;
const props={api,runId:"r",finding:findings[0],onRetry:async()=>{},onOpen:()=>{}};
const bundle=(status:Research["status"])=>(normalize.research({...research[0].wire!,status,recommendation:null}));
it.each([
 ["queued","Research queued"],
 ["searching","Searching competitor"],
 ["checking","Checking source"],
 ["ready","Research ready"],
 ["partial","Partial research"],
 ["unavailable","Research unavailable"],
] as const)("explains %s state while preserving supplied findings",(status,message)=>{
 render(<ResearchPanel {...props} bundles={[bundle(status)]}/>);
 expect(screen.getByText(status,{exact:true})).toBeInTheDocument();
 expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
 expect(screen.getByText(findings[0].customer_need)).toBeInTheDocument();
 expect(screen.getByText(/Date not supplied by research contract/)).toBeInTheDocument();
});
it("keeps facts, public opinions and inferences distinct with stable citations and limitations",async()=>{
 const user=userEvent.setup();const onOpen=vi.fn();
 const claims:Wire.Claim[]=[
  {claim_id:"capability-fact",type:"fact",text:"Published capability claim",evidence_ids:[evidence[0].evidence_id],limitations:["Equipment applicability unknown"]},
  {claim_id:"owner-opinion",type:"opinion",text:"Sampled owner preference",evidence_ids:[evidence[1].evidence_id],limitations:["Small public sample"]},
  {claim_id:"system-inference",type:"inference",text:"Hypothesis requires validation",evidence_ids:[],limitations:["No causal test"]},
 ];
 const data=normalize.research({...research[0].wire!,status:"ready",claims,competitor_scope:{vehicle_ids:["competitor-opaque"],markets:["DE"],cohort_ids:["sampled-owners"],year:2025,software:"v2",equipment:["optional-package"]}});
 const {rerender}=render(<ResearchPanel {...props} bundles={[data]} onOpen={onOpen}/>);
 const fact=screen.getByRole("article",{name:"Fact claim capability-fact"});
 expect(fact).toHaveTextContent("Equipment applicability unknown");
 expect(screen.getByRole("article",{name:"Public opinion owner-opinion"})).toHaveTextContent("Small public sample");
 expect(screen.getByRole("article",{name:"System inference system-inference"})).toHaveTextContent("No causal test");
 expect(screen.getByText("competitor-opaque")).toBeInTheDocument();expect(screen.getByText("optional-package")).toBeInTheDocument();
 await user.click(await within(fact).findByRole("button",{name:`Open source ${evidence[0].evidence_id}`}));expect(onOpen).toHaveBeenCalledWith(evidence[0]);
 rerender(<ResearchPanel {...props} bundles={[normalize.research({...data.wire!,claims:[...claims].reverse()})]} onOpen={onOpen}/>);
 expect(screen.getByRole("article",{name:"Fact claim capability-fact"})).toHaveTextContent("Published capability claim");
});
it("opens counterevidence IDs as sources and preserves partial gaps without inventing recommendation",async()=>{
 const user=userEvent.setup();const open=vi.fn();
 const data=normalize.research({...research[0].wire!,status:"partial",claims:[],recommendation:null,counterevidence_ids:[evidence[1].evidence_id],candidate_approaches:["Physical alternative"],gaps:["Retrieval budget exhausted"]});
 render(<ResearchPanel {...props} bundles={[data]} onOpen={open}/>);
 expect(screen.getByText("No recommendation supplied.")).toBeInTheDocument();expect(screen.getByText("Physical alternative")).toBeInTheDocument();expect(screen.getByText("Retrieval budget exhausted")).toBeInTheDocument();
 const counter=screen.getByRole("region",{name:"Counterevidence"});
 await user.click(await within(counter).findByRole("button",{name:`Open source ${evidence[1].evidence_id}`}));expect(open).toHaveBeenCalledWith(evidence[1]);
});
it("keeps prior research usable while retrieval fails and allows one retrieval retry",async()=>{
 const user=userEvent.setup();let finish!:(value:unknown)=>void;
 const retry=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 render(<ResearchPanel {...props} bundles={[bundle("partial")]} error="Research network interrupted" onRetry={retry}/>);
 expect(screen.getByRole("alert")).toHaveTextContent("Research network interrupted");
 expect(screen.getByText(research[0].claims[0].text)).toBeInTheDocument();
 const button=screen.getByRole("button",{name:"Retry research retrieval"});await user.click(button);fireEvent.click(button);expect(retry).toHaveBeenCalledTimes(1);expect(button).toBeDisabled();
 await act(async()=>{finish(undefined);});expect(button).toBeEnabled();
});
it("reports retry failure inline without removing findings or prior research",async()=>{
 const user=userEvent.setup();render(<ResearchPanel {...props} bundles={[bundle("partial")]} error="Initial fetch failed" onRetry={async()=>{throw new Error("Access denied to research");}}/>);
 await user.click(screen.getByRole("button",{name:"Retry research retrieval"}));
 expect(await screen.findByText("Access denied to research")).toBeInTheDocument();expect(screen.getByText(findings[0].customer_need)).toBeInTheDocument();
});
it("drops previous finding's claims immediately and ignores old retry failure after selection changes",async()=>{
 const user=userEvent.setup();let fail!:(reason:Error)=>void;
 const {rerender}=render(<ResearchPanel {...props} bundles={[bundle("partial")]} error="Retry available" onRetry={()=>new Promise((_resolve,reject)=>{fail=reject;})}/>);
 await user.click(screen.getByRole("button",{name:"Retry research retrieval"}));
 const other={...findings[0],finding_id:"other",customer_need:"Other customer need"};
 rerender(<ResearchPanel {...props} finding={other} bundles={[bundle("partial")]} onRetry={async()=>{}}/>);
 expect(screen.queryByText(research[0].claims[0].text)).not.toBeInTheDocument();expect(screen.getByText(/No research bundle available/)).toBeInTheDocument();
 await act(async()=>{fail(new Error("Old selection error"));});expect(screen.queryByText("Old selection error")).not.toBeInTheDocument();
});
it("updates queued research through checking to ready without changing customer counts",()=>{
 const data=bundle("queued");const {rerender}=render(<ResearchPanel {...props} bundles={[data]}/>);
 rerender(<ResearchPanel {...props} bundles={[bundle("checking")]}/>);expect(screen.getByText("checking")).toBeInTheDocument();
 rerender(<ResearchPanel {...props} bundles={[bundle("ready")]}/>);expect(screen.getByText("ready")).toBeInTheDocument();
 expect(screen.getByText(/172 of 400 negative feedback records/)).toBeInTheDocument();
});
