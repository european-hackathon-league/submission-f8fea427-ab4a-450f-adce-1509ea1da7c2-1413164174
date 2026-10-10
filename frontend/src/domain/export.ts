import type {Market,Period,Requirement} from './contracts';
import {findings,sampleFor} from './fixtures';
import {negativeShare} from './metrics';

export interface RequirementExportContext {market:Market;period:Period;baseline:Period;analysisDate:string;filter?:string;search?:string}

function csvCell(value:string):string {
  const text=/^[\s]*[=+\-@]/.test(value)?`'${value}`:value;
  return `"${text.replaceAll('"','""')}"`;
}

export function requirementsCsv(requirements:Requirement[],context:RequirementExportContext={market:'Europe',period:'2026',baseline:'2025',analysisDate:'not supplied'}):string {
  const rows=[['ID','Version','Title','Component','Priority (negative share)','Status','Rationale','Evidence IDs','Evidence status','Market','Period','Baseline','Analysis date','Applied status filter','Applied search'],...requirements.map(r=>{
    const finding=findings.find(f=>f.id===r.componentId);
    const linked=r.evidenceIds.flatMap(id=>finding?.evidence.filter(e=>e.id===id)??[]);
    const supportCount=linked.filter(e=>e.stance==='supports-friction').length,counterCount=linked.filter(e=>e.stance==='counter-signal').length;
    const evidenceStatus=linked.length===0?'No evidence linked':linked.length===r.evidenceIds.length?`${linked.length} linked synthetic records (${supportCount} supporting, ${counterCount} counter)`: `${linked.length} of ${r.evidenceIds.length} evidence links resolved`;
    const priority=finding?negativeShare(sampleFor(finding,context.period,context.market)):null;
    return [r.id,String(r.version),r.title,finding?.name??r.componentId,priority===null?'Unscored':String(priority),r.status,r.rationale,r.evidenceIds.join(';'),evidenceStatus,context.market,context.period,context.baseline,context.analysisDate,context.filter??'All',context.search??''];
  })];
  return rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
