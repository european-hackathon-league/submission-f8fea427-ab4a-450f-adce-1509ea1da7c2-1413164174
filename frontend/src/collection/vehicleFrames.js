export const frameUrl = (asset, index) => asset === 'i20'
  ? `/images/bmw/rotation/i20/preview/${String(index).padStart(2, '0')}.webp`
  : `/images/bmw/exterior/${asset}/${String(index).padStart(2, '0')}.webp`;

const aborted = () => new DOMException('Aborted', 'AbortError');

// Fetch compressed angles once. Decode only the current few angles, at source
// resolution: retaining all 36 native 2560px bitmaps costs ~506 MiB per model.
export async function loadFrames(asset, { signal, onProgress = () => {}, capacity = 3, feather = false } = {}) {
  const blobs = new Array(36), cache = new Map(), pending = new Map();
  let next = 0, done = 0, failure, closed = false;
  await Promise.all(Array.from({ length: 4 }, async () => {
    try {
      while (next < 36 && !signal?.aborted && !failure) {
        const index = next++, response = await fetch(frameUrl(asset, index), { signal });
        if (!response.ok) throw new Error(`Could not load ${asset} angle ${index}`);
        blobs[index] = await response.blob(); onProgress(++done);
      }
    } catch (error) { failure = error; }
  }));
  if (failure) throw failure;
  if (signal?.aborted) throw aborted();
  const close = () => {
    closed = true; cache.forEach(bitmap => bitmap.close()); cache.clear();
    blobs.fill(null); signal?.removeEventListener('abort', close);
  };
  signal?.addEventListener('abort', close, { once: true });
  return {
    close,
    detach: () => signal?.removeEventListener('abort', close),
    // A cached angle can be drawn immediately while a new angle decodes.
    // Circular distance also handles rotation across the 350° / 0° seam.
    peek(index, nearest = false) {
      if (closed || !cache.size) return undefined;
      let chosen = index;
      if (!cache.has(chosen)) {
        if (!nearest) return undefined;
        const distance = value => Math.min(Math.abs(value - index), 36 - Math.abs(value - index));
        chosen = [...cache.keys()].reduce((best, value) => distance(value) < distance(best) ? value : best);
      }
      const bitmap = cache.get(chosen); cache.delete(chosen); cache.set(chosen, bitmap); return bitmap;
    },
    async get(index) {
      if (closed) throw aborted();
      if (cache.has(index)) {
        const bitmap = cache.get(index); cache.delete(index); cache.set(index, bitmap); return bitmap;
      }
      if (pending.has(index)) return pending.get(index);
      const task = (async () => {
        let bitmap = await createImageBitmap(blobs[index]);
        if (closed) { bitmap.close(); throw aborted(); }
        // Feather only studio edges; China's already transparent frames need no mask.
        if (feather && asset !== 'g68' && typeof OffscreenCanvas !== 'undefined') {
          const layer = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = layer.getContext('2d');
          ctx.drawImage(bitmap, 0, 0); ctx.globalCompositeOperation = 'destination-in';
          for (const vertical of [false, true]) {
            const gradient = ctx.createLinearGradient(0, 0, vertical ? 0 : layer.width, vertical ? layer.height : 0);
            gradient.addColorStop(0, 'transparent'); gradient.addColorStop(vertical ? .32 : .12, '#000');
            gradient.addColorStop(vertical ? .90 : .88, '#000'); gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient; ctx.fillRect(0, 0, layer.width, layer.height);
          }
          bitmap.close(); bitmap = layer.transferToImageBitmap();
          layer.width = layer.height = 0;
        }
        cache.set(index, bitmap);
        while (cache.size > capacity) {
          const oldest = cache.keys().next().value; cache.get(oldest).close(); cache.delete(oldest);
        }
        return bitmap;
      })();
      pending.set(index, task);
      try { return await task; } finally { pending.delete(index); }
    },
  };
}
export const frameIndex = (angle, asset) => Math.round((((angle - (asset === 'g68' ? 40 : 0)) % 360 + 360) % 360) / 10) % 36;
