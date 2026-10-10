import {describe,it,expect} from 'vitest';
import {findings,initialRequirements} from './fixtures';
import {overviewSummary} from './summary';

describe('prepared overview metrics',()=>{
  it('aggregates component-record mentions without implying unique customers',()=>{
    const summary=overviewSummary(findings,initialRequirements,'Europe','2026','2025');
    expect(summary.feedbackRecords).toBe(2400);
    expect(summary.negativeRecords).toBe(640);
    expect(summary.negativeShare).toBeCloseTo(26.7);
    expect(summary.awaitingDecision).toBe(3);
  });
  it('leaves the largest comparable change unavailable without a baseline',()=>{
    const summary=overviewSummary(findings,initialRequirements,'China','2026','2025');
    expect(summary.feedbackRecords).toBe(1200);
    expect(summary.largestChange).toBeNull();
  });
});
