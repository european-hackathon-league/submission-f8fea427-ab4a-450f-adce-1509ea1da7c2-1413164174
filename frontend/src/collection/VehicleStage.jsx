import React, { useEffect, useRef, useState } from 'react';
import { families, models } from './journeyData.js';
import { journeySample } from './journeyMotion.js';
import { loadFrames, frameIndex } from './vehicleFrames.js';

const defaults = Object.fromEntries(families.map(family => [family.id, models.find(model => model.family === family.id).id]));

export default function VehicleStage({ progress, active = 0, selections = defaults }) {
  const canvas = useRef(null), sequences = useRef(new Map()), dirty = useRef(true), selection = useRef(selections);
  selection.current = selections;
  const [ready, setReady] = useState(false), [errors, setErrors] = useState({}), [attempt, setAttempt] = useState(0);
  const status = errors[active] || '';
  const selected = models.find(model => model.id === selections[families[active].id]);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    (async () => {
      for (let index = 0; index < families.length; index++) {
        const model = models.find(item => item.id === selections[families[index].id]);
        if (sequences.current.get(index)?.model.id === model.id) continue;
        try {
          const frames = await loadFrames(model.exterior, { signal: controller.signal, feather: true, capacity: 4 });
          await frames.get(frameIndex(journeySample(progress.current).angle, model.exterior));
          if (disposed) { frames.close(); return; }
          frames.detach();
          sequences.current.get(index)?.frames.close();
          sequences.current.set(index, { model, frames }); dirty.current = true;
          setErrors(previous => { const next = { ...previous }; delete next[index]; return next; });
        } catch (error) {
          if (error.name === 'AbortError' || disposed) return;
          setErrors(previous => ({ ...previous, [index]: 'This rotating view could not load.' }));
        }
      }
    })();
    // Published sequences belong to the stage, not to this loading attempt.
    // Abort unfinished requests without closing sequences still on screen.
    return () => { disposed = true; controller.abort(); };
  }, [selections, progress, attempt]);

  useEffect(() => {
    const el = canvas.current, ctx = el.getContext('2d');
    if (!ctx) return () => {
      sequences.current.forEach(({ frames }) => frames.close()); sequences.current.clear();
    };
    let disposed = false, raf, busy = false, previous = '', w = 0, h = 0, dpr = 1;
    const resize = () => {
      const rect = el.getBoundingClientRect();
      w = rect.width; h = rect.height; dpr = Math.min(devicePixelRatio || 1, 2);
      el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); dirty.current = true;
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    function draw(index, image, opacity) {
      const { x, y, width, height } = scenePlacement(index, w, h, image.height / image.width);
      ctx.globalAlpha = opacity; ctx.drawImage(image, x, y, width, height);
    }
    async function paint(sample, key) {
      busy = true;
      const desiredIndex = sample.mix > .5 ? sample.to : sample.from;
      try {
        const from = sequences.current.get(sample.from), to = sequences.current.get(sample.to);
        const desired = sequences.current.get(desiredIndex);
        if (!desired) return;
        const entries = sample.from !== sample.to && from && to
          ? [[sample.from, from, 1 - sample.mix], [sample.to, to, sample.mix]]
          : [[desiredIndex, desired, 1]];
        const images = await Promise.all(entries.map(([familyIndex, entry]) => {
          const index = frameIndex(sample.angle, entry.model.exterior);
          // Keep opacity and layout responsive while a native frame decodes.
          // Only one background decode per model; always catch and scope errors.
          if (!entry.frames.peek) return entry.frames.get(index);
          const exact = entry.frames.peek(index);
          if (!exact && !entry.pending) {
            entry.pending = entry.frames.get(index).then(() => { dirty.current = true; }).catch(error => {
              if (error.name !== 'AbortError' && !disposed && sequences.current.get(familyIndex) === entry)
                setErrors(previous => ({ ...previous, [familyIndex]: 'This rotating view could not load.' }));
            }).finally(() => { entry.pending = null; });
          }
          return exact || entry.frames.peek(index, true);
        }));
        if (disposed || entries.some(([index, entry]) => sequences.current.get(index) !== entry)) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.imageSmoothingQuality = 'high';
        entries.forEach(([index, , opacity], i) => draw(index, images[i], opacity)); ctx.globalAlpha = 1;
        previous = key; setReady(true);
        el.dataset.angle = sample.angle.toFixed(2); el.dataset.family = families[desiredIndex].id;
        el.dataset.model = desired.model.id;
        el.dataset.sourceWidth = String(images[entries.findIndex(([index]) => index === desiredIndex)].width);
        el.dataset.loaded = String(sequences.current.size);
      } catch (error) {
        if (error.name !== 'AbortError' && !disposed) setErrors(previous => ({ ...previous, [desiredIndex]: 'This rotating view could not load.' }));
      } finally { busy = false; }
    }
    function tick() {
      const sample = journeySample(progress.current);
      const key = `${sample.from}:${sample.to}:${sample.mix.toFixed(3)}:${Math.round(sample.angle / 10)}:${Object.values(selection.current).join(':')}`;
      if (!document.hidden && !busy && (dirty.current || key !== previous)) {
        dirty.current = false; void paint(sample, key);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true; cancelAnimationFrame(raf); observer.disconnect();
      sequences.current.forEach(({ frames }) => frames.close()); sequences.current.clear();
    };
  }, [progress]);

  return <div className="j-car-scene">
    <canvas ref={canvas} style={{ visibility: ready ? 'visible' : 'hidden' }} aria-label={`${selected.name}, rotating exterior view`} role="img" />
    {!ready && <img className="j-scene-poster" data-family={selected.family} src={selected.image} alt={selected.name} />}
    {(status || !ready) && <div className={`j-load-status ${status ? '' : 'j-sr-only'}`} role="status">
      {status || 'Loading rotating view…'}
      {status && <button onClick={() => {
        sequences.current.get(active)?.frames.close(); sequences.current.delete(active);
        dirty.current = true; setErrors({}); setAttempt(value => value + 1);
      }}>Retry</button>}
    </div>}
  </div>;
}

// COSY studio images place tyres at 80% of image height; China's transparent
// frames use 85%. Anchor the tyres, not the differently sized image centers.
export function scenePlacement(index, w, h, aspect) {
  const mobile = w <= 600;
  const regularWidth = mobile ? w * 1.40 : Math.min(w * .90, h * 1.6);
  const width = index === 2 ? (mobile ? w * 1.10 : Math.min(w * .80, h * 1.6)) : regularWidth;
  const height = width * aspect;
  const center = mobile ? (h < 600 ? .32 : .43) : (h < 720 ? .43 : .53);
  const ground = h * center + regularWidth * (1440 / 2560) * .30;
  return { x: (w - width) / 2, y: ground - height * (index === 2 ? .85 : .80), width, height };
}
