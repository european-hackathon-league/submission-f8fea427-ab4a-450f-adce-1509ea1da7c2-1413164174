// Only complete sequences are published. Drawing never starts a network request.
export const frameUrl=(family,index)=>family==='i20'
 ?`/images/bmw/rotation/i20/preview/${String(index).padStart(2,'0')}.webp`
 :`/images/bmw/spin/${family}/${String(index*4).padStart(3,'0')}.webp`;
export async function loadFrames(family,{signal,onProgress=()=>{}}={}) {
 const frames=new Array(36);let next=0,done=0,failure;
 try {
  await Promise.all(Array.from({length:4},async()=>{try{
   while(next<36&&!signal?.aborted&&!failure) {
    const i=next++,response=await fetch(frameUrl(family,i),{signal});
    if(!response.ok)throw new Error(`Could not load ${family} angle ${i}`);
    const bitmap=await createImageBitmap(await response.blob(),{resizeWidth:768,resizeQuality:'high'});
    if(signal?.aborted){bitmap.close();break;}
    frames[i]=bitmap;onProgress(++done);
   }}catch(error){failure=error;}
  }));
  if(failure)throw failure;
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  return frames;
 }catch(error){frames.forEach(frame=>frame?.close());throw error;}
}
export const frameIndex=(angle,family)=>Math.round((((angle-(family==='g68'?40:0))%360+360)%360)/10)%36;
