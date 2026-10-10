import {cleanup,render,screen,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,expect,it,vi} from "vitest";
import SourceDialog from "./SourceDialog";
import {evidence} from "../api/fixtures";
import type {Api,Evidence} from "../api/contracts";
import * as normalize from "../api/normalize";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("shows complete source identity, cell scope and applicability, then restores opener focus",async()=>{
 const user=userEvent.setup();const opener=document.createElement("button");document.body.append(opener);opener.focus();
 const onClose=vi.fn();const item=normalize.evidence({...evidence[0].wire!,applicability:"mismatch",limitations:["Different equipment"]});
 const {unmount}=render(<SourceDialog api={{mode:"real"} as Api} evidence={item} onClose={onClose}/>);
 const dialog=screen.getByRole("dialog",{name:"Source reference"});
 expect(within(dialog).getByText(item.source_version_id)).toBeInTheDocument();
 expect(within(dialog).getByText(/mismatch/)).toBeInTheDocument();
 expect(within(dialog).getByText("Different equipment")).toBeInTheDocument();
 expect(within(dialog).getByText(/row 12/)).toBeInTheDocument();
 await user.keyboard("{Escape}");expect(onClose).toHaveBeenCalled();unmount();expect(opener).toHaveFocus();opener.remove();
});
it("fetches protected source with application auth and revokes downloaded blob on close",async()=>{
 const create=vi.fn(()=>"blob:authorized-source");const revoke=vi.fn();
 vi.stubGlobal("URL",Object.assign(URL,{createObjectURL:create,revokeObjectURL:revoke}));
 const read=vi.fn(async()=>new Blob(["Original content"],{type:"application/pdf"}));
 const api={mode:"real",canReadSource:()=>true,readSource:read} as unknown as Api;
 const item={...evidence[0],source_url:"/api/v1/sources/opaque/content"};
 const {unmount}=render(<SourceDialog api={api} evidence={item} onClose={()=>{}}/>);
 const link=await screen.findByRole("link",{name:"Open original source"});expect(link).toHaveAttribute("href","blob:authorized-source");
 expect(read).toHaveBeenCalledWith(item.source_url,expect.any(AbortSignal));unmount();expect(revoke).toHaveBeenCalledWith("blob:authorized-source");
});
it("retries protected source access failure while keeping exact locator usable",async()=>{
 const user=userEvent.setup();vi.stubGlobal("URL",Object.assign(URL,{createObjectURL:()=>"blob:recovered",revokeObjectURL:()=>{}}));
 let failed=true;const api={mode:"real",canReadSource:()=>true,readSource:async()=>{if(failed)throw new Error("Source forbidden");return new Blob(["ok"]);}} as unknown as Api;
 render(<SourceDialog api={api} evidence={{...evidence[0],source_url:"/api/v1/sources/s/content"}} onClose={()=>{}}/>);
 expect(await screen.findByRole("alert")).toHaveTextContent("Source forbidden");
 expect(screen.getByText(/row 12/)).toBeInTheDocument();failed=false;await user.click(screen.getByRole("button",{name:"Retry original source"}));
 expect(await screen.findByRole("link",{name:"Open original source"})).toHaveAttribute("href","blob:recovered");
});
it.each(["javascript:alert(1)","data:text/html,test"])("rejects unsafe source URL %s",url=>{
 render(<SourceDialog api={{mode:"real"} as Api} evidence={{...evidence[0],source_url:url}} onClose={()=>{}}/>);
 expect(screen.queryByRole("link",{name:"Open original source"})).not.toBeInTheDocument();
 expect(screen.getByText(/unavailable/)).toBeInTheDocument();
});
it("opens authorized external source without attaching application auth",()=>{
 const read=vi.fn();const api={mode:"real",canReadSource:()=>false,readSource:read} as unknown as Api;
 render(<SourceDialog api={api} evidence={{...evidence[0],source_url:"https://sources.example/signed?id=1"}} onClose={()=>{}}/>);
 expect(screen.getByRole("link",{name:"Open original source"})).toHaveAttribute("href","https://sources.example/signed?id=1");expect(read).not.toHaveBeenCalled();
});
it.each([
 {locator:{type:"pdf" as const,page:4,section:"Comfort",bbox:[0,1,2,3]},expected:"Page 4, Comfort, bounding box 0, 1, 2, 3"},
 {locator:{type:"web" as const,url:"https://sources.example/review",passage_start:10,passage_end:20},expected:"https://sources.example/review, passage 10–20"},
])("preserves full structured locator $expected",({locator,expected})=>{
 const item=normalize.evidence({...evidence[0].wire!,locator,source_url:null});
 render(<SourceDialog api={{mode:"real"} as Api} evidence={item} onClose={()=>{}}/>);
 expect(screen.getByText(expected)).toBeInTheDocument();
});
it("aborts protected source load and discards late body after dialog closes",async()=>{
 let finish!:(blob:Blob)=>void;let signal!:AbortSignal;
 const create=vi.fn(()=>"blob:late");vi.stubGlobal("URL",Object.assign(URL,{createObjectURL:create,revokeObjectURL:vi.fn()}));
 const api={mode:"real",canReadSource:()=>true,readSource:(_url:string,s:AbortSignal)=>{signal=s;return new Promise<Blob>(resolve=>{finish=resolve;});}} as unknown as Api;
 const {unmount}=render(<SourceDialog api={api} evidence={{...evidence[0],source_url:"/api/v1/sources/s/content"}} onClose={()=>{}}/>);
 expect(screen.getByRole("status")).toHaveTextContent(/Loading authorized/);unmount();expect(signal.aborted).toBe(true);finish(new Blob(["late"]));
 await waitFor(()=>expect(create).not.toHaveBeenCalled());
});

it("opens published web locator as public citation when original source link is unavailable",()=>{
 const read=vi.fn();const api={mode:"real",readSource:read} as unknown as Api;
 const item=normalize.evidence({...evidence[0].wire!,source_kind:"external",source_url:null,locator:{type:"web",url:"https://citations.example/review",passage_start:12,passage_end:30}});
 render(<SourceDialog api={api} evidence={item} onClose={()=>{}}/>);
 expect(screen.getByRole("link",{name:"Open cited page"})).toHaveAttribute("href","https://citations.example/review");
 expect(screen.queryByRole("link",{name:"Open original source"})).not.toBeInTheDocument();expect(read).not.toHaveBeenCalled();
});
it("does not open unsafe URL from a published web locator",()=>{
 const item=normalize.evidence({...evidence[0].wire!,source_url:null,locator:{type:"web",url:"javascript:alert(1)",passage_start:0,passage_end:1}});
 render(<SourceDialog api={{mode:"real"} as Api} evidence={item} onClose={()=>{}}/>);
 expect(screen.queryByRole("link",{name:"Open cited page"})).not.toBeInTheDocument();
});
it("ends native modal inertness before restoring opener focus on removal",()=>{
 const opener=document.createElement("button");document.body.append(opener);opener.focus();
 let modalOpen=false;
 const showDescriptor=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"showModal");
 const closeDescriptor=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"close");
 const focus=opener.focus.bind(opener);
 vi.spyOn(opener,"focus").mockImplementation(()=>{if(!modalOpen)focus();});
 Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){modalOpen=true;this.setAttribute("open","");}});
 Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){modalOpen=false;this.removeAttribute("open");}});
 try {
  const {unmount}=render(<SourceDialog api={{mode:"real"} as Api} evidence={evidence[0]} onClose={()=>{}}/>);
  expect(screen.getByRole("button",{name:"Close source"})).toHaveFocus();unmount();expect(opener).toHaveFocus();
 } finally {
  if(showDescriptor)Object.defineProperty(HTMLDialogElement.prototype,"showModal",showDescriptor);else delete (HTMLDialogElement.prototype as unknown as Record<string,unknown>).showModal;
  if(closeDescriptor)Object.defineProperty(HTMLDialogElement.prototype,"close",closeDescriptor);else delete (HTMLDialogElement.prototype as unknown as Record<string,unknown>).close;
  vi.restoreAllMocks();opener.remove();
 }
});
