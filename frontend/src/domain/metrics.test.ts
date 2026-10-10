import {describe,it,expect} from 'vitest';
import {negativeShare,compareSamples,heatColor} from './metrics';
describe('feedback metrics',()=>{
 it('uses the sample denominator, not vehicle failure prevalence',()=>{expect(negativeShare({negative:68,total:100})).toBe(68)});
 it('distinguishes percentage points from relative reduction',()=>{expect(compareSamples({negative:68,total:100},{negative:25,total:100})).toEqual({before:68,after:25,points:-43,reduction:63.2})});
 it('leaves an absent baseline unquantified',()=>{expect(compareSamples({negative:0,total:0},{negative:5,total:20})).toBeNull()});
 it('does not divide a zero-percent baseline',()=>{expect(compareSamples({negative:0,total:20},{negative:5,total:20})?.reduction).toBeNull()});
 it('marks unavailable and invalid samples as unknown',()=>{expect(negativeShare({negative:9,total:0})).toBeNull();expect(negativeShare({negative:21,total:20})).toBeNull()});
 it('uses a stable heat scale and a separate unknown color',()=>{expect(heatColor(68)).toBe('#e45454');expect(heatColor(null)).toBe('#8a909b');expect(heatColor(25)).toBe('#e8b75a')});
});
