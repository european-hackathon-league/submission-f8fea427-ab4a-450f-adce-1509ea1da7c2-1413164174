import {afterEach,expect,test,vi} from 'vitest';
import {frameIndex,frameUrl,loadFrames} from './vehicleFrames.js';
afterEach(()=>vi.unstubAllGlobals());
test('camera wraps at the seam and aligns China source offset',()=>{
 expect(frameIndex(360,'f70')).toBe(0);expect(frameIndex(-10,'f70')).toBe(35);expect(frameIndex(40,'g68')).toBe(0);expect(frameIndex(0,'g68')).toBe(32);
 expect(frameUrl('21GE',35)).toBe('/images/bmw/exterior/21GE/35.webp');expect(frameUrl('i20',0)).toBe('/images/bmw/rotation/i20/preview/00.webp');
});
test('fetches a complete sequence with bounded concurrency and decodes only requested angles at native resolution',async()=>{
 let active=0,peak=0;vi.stubGlobal('fetch',vi.fn(async()=>{active++;peak=Math.max(peak,active);await Promise.resolve();active--;return {ok:true,blob:async()=>new Blob()};}));
 vi.stubGlobal('createImageBitmap',vi.fn(async(_blob,options)=>({width:options?.resizeWidth||2560,height:1440,close:vi.fn()})));
 const progress=vi.fn(),sequence=await loadFrames('21GE',{onProgress:progress});
 expect(fetch).toHaveBeenCalledTimes(36);expect(peak).toBeLessThanOrEqual(4);expect(progress).toHaveBeenLastCalledWith(36);
 expect(createImageBitmap).not.toHaveBeenCalled();
 expect((await sequence.get(4)).width).toBe(2560);expect(createImageBitmap).toHaveBeenCalledTimes(1);
 sequence.close();
});
test('reuses decoded angles and closes the least recently used bitmap when the cache fills',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,blob:async()=>new Blob()})));
 vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:2560,height:1440,close:vi.fn()})));
 const sequence=await loadFrames('21GE',{capacity:2});
 const first=await sequence.get(0);const second=await sequence.get(1);
 expect(await sequence.get(0)).toBe(first);
 await sequence.get(2);expect(second.close).toHaveBeenCalledOnce();expect(first.close).not.toHaveBeenCalled();
 sequence.close();expect(first.close).toHaveBeenCalledOnce();
});
test('failed batches never publish partial sequences',async()=>{
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>({ok:++calls!==7,blob:async()=>new Blob()})));vi.stubGlobal('createImageBitmap',vi.fn());
 await expect(loadFrames('21GE')).rejects.toThrow('Could not load');expect(createImageBitmap).not.toHaveBeenCalled();
});
test('cancelled loads release late decoding results and reject further reads',async()=>{
 const controller=new AbortController(),close=vi.fn();
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,blob:async()=>new Blob()})));
 let finish;vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise(resolve=>{finish=resolve;})));
 const sequence=await loadFrames('21GE',{signal:controller.signal});const pending=sequence.get(0);
 controller.abort();finish({close});
 await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(close).toHaveBeenCalledOnce();
 await expect(sequence.get(1)).rejects.toMatchObject({name:'AbortError'});
});

test('exposes cached and nearest frames synchronously without triggering decoding',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,blob:async()=>new Blob()})));
 vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:2560,height:1440,close:vi.fn()})));
 const sequence=await loadFrames('21GE');
 const seam=await sequence.get(35),far=await sequence.get(10);
 expect(sequence.peek(0)).toBeUndefined();
 expect(sequence.peek(0,true)).toBe(seam);
 expect(sequence.peek(9,true)).toBe(far);
 expect(createImageBitmap).toHaveBeenCalledTimes(2);
 sequence.close();expect(sequence.peek(0,true)).toBeUndefined();
});
