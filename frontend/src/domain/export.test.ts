import {describe,it,expect} from 'vitest';
import {requirementsCsv} from './export';
import {initialRequirements} from './fixtures';

describe('requirement CSV export',()=>{
  it('preserves quotes, commas and multiline rationale as one quoted field',()=>{
    const result=requirementsCsv([{...initialRequirements[0],rationale:'Customer said "clearer",\nthen approved.'}]);
    expect(result).toContain('"Customer said ""clearer"",\nthen approved."');
    expect(result).toContain('"Steering-wheel controls"');
    expect(result).toContain('"steering-E1;steering-E2"');
    expect(result.split('\r\n')).toHaveLength(2);
  });
  it('exports text as text rather than spreadsheet formulas',()=>{
    const result=requirementsCsv([{...initialRequirements[0],title:'=1+1',rationale:'  @SUM(1,2)'}]);
    expect(result).toContain('"\'=1+1"');
    expect(result).toContain('"\'  @SUM(1,2)"');
  });
  it('keeps an empty filtered export as headers only',()=>{
    expect(requirementsCsv([])).toBe('"ID","Version","Title","Component","Priority","Status","Rationale","Evidence IDs"');
  });
});
