export const clamp=(v,lo=0,hi=1)=>Math.min(hi,Math.max(lo,v));
export const storyProgress=(offset,distance,count)=>clamp(offset/Math.max(1,distance))*(count-1);
export const dampProgress=(current,target,dt)=>current+(target-current)*(1-Math.exp(-12*dt));
const smooth=v=>{const t=clamp(v);return t*t*(3-2*t);};
// All families use the same unwrapped camera angle. A handoff never resets it.
export function journeySample(progress) {
 const p=clamp(progress,0,3), angle=40+p*300;
 for(let boundary=1;boundary<=3;boundary++) {
  if(p<boundary-.40)return {from:boundary-1,to:boundary-1,mix:0,angle};
  if(p<=boundary-.10)return {from:boundary-1,to:boundary,mix:smooth((p-boundary+.40)/.30),angle};
 }
 return {from:3,to:3,mix:0,angle};
}
export function angleFrames(angle,count=36) {
 const frame=((angle%360+360)%360)/360*count, first=Math.floor(frame);
 return {first,second:(first+1)%count,mix:Math.round((frame-first)*1e8)/1e8};
}
