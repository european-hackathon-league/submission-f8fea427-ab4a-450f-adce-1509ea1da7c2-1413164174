import type {Finding,Market,Period,Requirement} from './contracts';
import {sampleFor} from './fixtures';
import {compareSamples,negativeShare} from './metrics';

export interface OverviewSummary {
  feedbackRecords:number;
  negativeRecords:number;
  negativeShare:number|null;
  largestChange:{componentId:Finding['id'];name:string;points:number;before:number;after:number}|null;
  awaitingDecision:number;
}

/** Counts component-period feedback records. It does not estimate unique customers. */
export function overviewSummary(findings:Finding[],requirements:Requirement[],market:Market,period:Period,baseline:Period):OverviewSummary{
  let feedbackRecords=0,negativeRecords=0;
  for(const finding of findings){const sample=sampleFor(finding,period,market);feedbackRecords+=sample.total;negativeRecords+=sample.negative;}
  let largestChange:OverviewSummary['largestChange']=null;
  for(const finding of findings){
    const comparison=compareSamples(sampleFor(finding,baseline,market),sampleFor(finding,period,market));
    if(comparison&&(!largestChange||Math.abs(comparison.points)>Math.abs(largestChange.points)))largestChange={componentId:finding.id,name:finding.name,points:comparison.points,before:comparison.before,after:comparison.after};
  }
  return {feedbackRecords,negativeRecords,negativeShare:negativeShare({negative:negativeRecords,total:feedbackRecords}),largestChange,awaitingDecision:requirements.filter(r=>r.status==='Draft'||r.status==='Deferred').length};
}
