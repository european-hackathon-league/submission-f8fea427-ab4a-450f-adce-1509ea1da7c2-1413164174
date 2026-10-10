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
    expect(requirementsCsv([],{market:'Europe',period:'2026',baseline:'2025',analysisDate:'2026-10-10'}).split('\r\n')).toHaveLength(1);
    expect(requirementsCsv([],{market:'Europe',period:'2026',baseline:'2025',analysisDate:'2026-10-10'})).toContain('"Evidence status","Market","Period","Baseline","Analysis date"');
  });
  it('exports selected context, exact versions and linked evidence coverage',()=>{
    const csv=requirementsCsv([initialRequirements[0]],{market:'China',period:'2026',baseline:'2025',analysisDate:'2026-10-10'});
    expect(csv).toContain('"REQ-001","1"');
    expect(csv).toContain('"China","2026","2025","2026-10-10"');
    expect(csv).toContain('"2 linked synthetic records (1 supporting, 1 counter)"');
  });
});
