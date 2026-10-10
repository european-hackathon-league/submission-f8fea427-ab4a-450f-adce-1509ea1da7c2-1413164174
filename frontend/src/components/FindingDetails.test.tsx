import {cleanup,render,screen} from "@testing-library/react";
import {afterEach,expect,it} from "vitest";
import FindingDetails from "./FindingDetails";
import {findings,proposals} from "../api/fixtures";
afterEach(cleanup);
it("keeps server fractional share and coverage without recalculating from record totals",()=>{
 const finding={...findings[0],counts:{...findings[0].counts,negative_share:0.125},provisional:true};
 render(<FindingDetails finding={finding} changes={proposals.variants.flatMap(v=>v.changes)}/>);
 expect(screen.getByText(/12.5% negative/)).toBeInTheDocument();
 expect(screen.getByText("Provisional")).toBeInTheDocument();
 expect(screen.getByText(finding.coverage)).toBeInTheDocument();
 expect(screen.getByText(/Baseline not provided/)).toBeInTheDocument();
});
it("distinguishes unknown share, empty denominator and separately supplied low-evidence aggregate",()=>{
 const finding={...findings[0],counts:{negative_records:0,total_records:0,negative_share:null}};
 render(<FindingDetails finding={finding} aggregates={[{part_id:finding.part_ids[0],counts:{negative_records:0,total_records:0,negative_share:null,intensity_scale_id:"server-scale",intensity_value:0.2,low_evidence:true,provisional:true}}]}/>);
 expect(screen.getByText(/Unknown share/)).toBeInTheDocument();
 expect(screen.getByText(/No feedback records in supplied denominator/)).toBeInTheDocument();
 expect(screen.getByText(/Low evidence/)).toBeInTheDocument();
 expect(screen.getByText(/server-scale/)).toBeInTheDocument();
});
it("keeps overlapping cohort aggregates separate and exposes proposal uncertainty and maturity",()=>{
 const base={part_id:findings[0].part_ids[0],counts:{negative_records:4,total_records:10,negative_share:0.4,intensity_scale_id:"records-v1",intensity_value:0.1,low_evidence:true,provisional:false}};
 const aggregates=[{...base,wire:{part_id:base.part_id,cohort_ids:["Germany"],counts:{negative_records:4,total_records:10,negative_share:0.4,record_ids:[]},intensity_scale_id:"records-v1",intensity_value:0.1,low_evidence:true,provisional:false}},{...base,wire:{part_id:base.part_id,cohort_ids:["Europe"],counts:{negative_records:4,total_records:10,negative_share:0.4,record_ids:[]},intensity_scale_id:"records-v1",intensity_value:0.1,low_evidence:true,provisional:false}}];
 const change={...proposals.variants[0].changes[0],finding_id:findings[0].finding_id,wire:undefined,assumptions:["Validate target with scoped study"],target_maturity:"needs_validation"};
 render(<FindingDetails finding={findings[0]} aggregates={aggregates} changes={[change]}/>);
 expect(screen.getByText(/Part dashboard.*Cohorts: Germany/)).toBeInTheDocument();
 expect(screen.getByText(/Part dashboard.*Cohorts: Europe/)).toBeInTheDocument();
 expect(screen.queryByText(/8 of 20/)).not.toBeInTheDocument();
 expect(screen.getByText("Validate target with scoped study")).toBeInTheDocument();
 expect(screen.getByText(/Target maturity: needs_validation/)).toBeInTheDocument();
});
