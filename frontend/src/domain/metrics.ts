import type {Sample} from './contracts';
const round=(value:number)=>Math.round(value*10)/10;
export function negativeShare(sample:Sample):number|null{
 if(!Number.isFinite(sample.total)||!Number.isFinite(sample.negative)||sample.total<=0||sample.negative<0||sample.negative>sample.total)return null;
 return round(sample.negative/sample.total*100);
}
export function compareSamples(previous:Sample,current:Sample):{before:number;after:number;points:number;reduction:number|null}|null{
 const before=negativeShare(previous),after=negativeShare(current);
 if(before===null||after===null)return null;
 return {before,after,points:round(after-before),reduction:before===0?null:round((before-after)/before*100)};
}
export function heatColor(share:number|null):string{
 return share===null?'#8a909b':share>=50?'#e45454':share>=25?'#e8b75a':'#57b6a0';
}
