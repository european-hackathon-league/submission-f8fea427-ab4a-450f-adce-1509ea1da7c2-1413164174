import {afterEach,expect,test,vi} from 'vitest';
import {frameIndex,frameUrl,loadFrames} from './vehicleFrames.js';
afterEach(()=>vi.unstubAllGlobals());
test('camera wraps at the seam and aligns China source offset',()=>{
 expect(frameIndex(360,'f70')).toBe(0);expect(frameIndex(-10,'f70')).toBe(35);expect(frameIndex(40,'g68')).toBe(0);expect(frameIndex(0,'g68')).toBe(32);
 expect(frameUrl('g60',35)).toBe('/images/bmw/spin/g60/140.webp');expect(frameUrl('i20',0)).toBe('/images/bmw/rotation/i20/preview/00.webp');
});
test('publishes only a complete decoded sequence with bounded concurrency',async()=>{
 let active=0,peak=0;vi.stubGlobal('fetch',vi.fn(async()=>{active++;peak=Math.max(peak,active);await Promise.resolve();active--;return {ok:true,blob:async()=>new Blob()};}));
 vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:768,height:432,close:vi.fn()})));
 const progress=vi.fn(),frames=await loadFrames('f70',{onProgress:progress});expect(frames).toHaveLength(36);expect(createImageBitmap).toHaveBeenCalledTimes(36);expect(peak).toBeLessThanOrEqual(4);expect(progress).toHaveBeenLastCalledWith(36);
});
test('failed batches close decoded bitmaps and never publish partial sequences',async()=>{
 let calls=0;const close=vi.fn();vi.stubGlobal('fetch',vi.fn(async()=>({ok:++calls!==7,blob:async()=>new Blob()})));vi.stubGlobal('createImageBitmap',vi.fn(async()=>({close})));
 await expect(loadFrames('g70')).rejects.toThrow('Could not load');expect(close).toHaveBeenCalledTimes(createImageBitmap.mock.calls.length);
});
test('cancelled loads release late decoding results',async()=>{
 const controller=new AbortController(),close=vi.fn();vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,blob:async()=>new Blob()})));vi.stubGlobal('createImageBitmap',vi.fn(async()=>{controller.abort();return {close};}));
 await expect(loadFrames('f70',{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});expect(close).toHaveBeenCalledTimes(createImageBitmap.mock.calls.length);
});
