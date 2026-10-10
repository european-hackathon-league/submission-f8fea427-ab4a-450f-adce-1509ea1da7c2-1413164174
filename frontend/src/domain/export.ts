import type {Requirement} from './contracts';
import {findings} from './fixtures';

function csvCell(value:string):string {
  const text=/^[\s]*[=+\-@]/.test(value)?`'${value}`:value;
  return `"${text.replaceAll('"','""')}"`;
}

export function requirementsCsv(requirements:Requirement[]):string {
  const rows=[['ID','Version','Title','Component','Priority','Status','Rationale','Evidence IDs'],...requirements.map(r=>[
    r.id,String(r.version),r.title,findings.find(f=>f.id===r.componentId)?.name??r.componentId,r.priority===null?'Unscored':String(r.priority),r.status,r.rationale,r.evidenceIds.join(';'),
  ])];
  return rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
