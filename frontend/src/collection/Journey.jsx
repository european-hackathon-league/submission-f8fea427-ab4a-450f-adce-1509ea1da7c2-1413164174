import React, { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, Rotate3D } from 'lucide-react';
import { families, models } from './journeyData.js';
import { dampProgress, journeySample, storyProgress } from './journeyMotion.js';
import VehicleStage from './VehicleStage.jsx';
import './journey.css';
import './vehicleViewer.css';

const VehicleViewer = lazy(() => import('./VehicleViewer.jsx'));
const familyNames = ['1 Series', '5 Series', '5 Series Long Wheelbase', '7 Series'];

export default function Journey({ onOpen, initialModel = null }) {
  const initialFamily = Math.max(0, families.findIndex(family => family.id === initialModel?.family));
  const [active, setActive] = useState(initialFamily);
  const [variants, setVariants] = useState(() => Object.fromEntries(families.map(family => [
    family.id, initialModel?.family === family.id ? initialModel.id : models.find(model => model.family === family.id).id,
  ])));
  const [viewer, setViewer] = useState(null);
  const [reduce, setReduce] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const track = useRef(null);
  const progress = useRef(initialFamily);
  const target = useRef(initialFamily);
  const titles = useRef([]);
  const family = families[active];
  const selected = models.find(model => model.id === variants[family.id]);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const change = () => setReduce(query.matches);
    query?.addEventListener('change', change);
    return () => query?.removeEventListener('change', change);
  }, []);

  useLayoutEffect(() => {
    if (!reduce && initialFamily && track.current) {
      window.scrollTo({ top: track.current.offsetTop + (track.current.offsetHeight - window.innerHeight) * initialFamily / 3, behavior: 'instant' });
    }
  }, []);

  useEffect(() => {
    if (reduce) return;
    let frame, last = 0, lastActive = initialFamily, lastPaint = -1;
    const measure = () => {
      if (!track.current) return;
      target.current = storyProgress(-track.current.getBoundingClientRect().top, track.current.offsetHeight - window.innerHeight, 4);
    };
    const tick = time => {
      const dt = Math.min((time - last) / 1000 || 1 / 60, .05);
      last = time;
      progress.current = dampProgress(progress.current, target.current, dt);
      if (Math.abs(target.current - progress.current) < .00005) progress.current = target.current;
      if (lastPaint !== progress.current) {
        lastPaint = progress.current;
        const sample = journeySample(progress.current);
        const index = sample.mix > .5 ? sample.to : sample.from;
        if (index !== lastActive) { lastActive = index; setActive(index); }
        titles.current.forEach((title, i) => {
          if (!title) return;
          const opacity = sample.from === sample.to ? Number(i === sample.from) : i === sample.from ? 1 - sample.mix : i === sample.to ? sample.mix : 0;
          title.style.opacity = String(opacity);
        });
      }
      frame = requestAnimationFrame(tick);
    };
    measure();
    frame = requestAnimationFrame(tick);
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [reduce]);

  function chooseFamily(index) {
    target.current = index;
    progress.current = index;
    setActive(index);
    // Family buttons jump directly; native scrolling retains the rotating showcase.
    if (!reduce && track.current) {
      window.scrollTo({ top: track.current.offsetTop + (track.current.offsetHeight - window.innerHeight) * index / 3, behavior: 'instant' });
    }
  }

  return <div className={`journey-root ${reduce ? 'j-reduced' : ''}`}>
    <a className="j-skip" href="#vehicle-selection">Skip to vehicle selection</a>
    <main className="j-scroll-track" ref={track} aria-label="BMW collection">
      <section className="j-stage" aria-labelledby="collection-title">
        <header className="j-header">
          <span className="j-mark" aria-hidden="true"><i /><i /><i /></span>
          <h1 className="j-sr-only" id="collection-title">Choose your BMW</h1>
          <nav className="j-families" aria-label="Vehicle family">
            {families.map((item, index) => <button key={item.id} aria-pressed={active === index} onClick={() => chooseFamily(index)}>
              {familyNames[index]}
            </button>)}
          </nav>
        </header>
        <div className="j-model-titles" aria-hidden="true">
          {families.map((item, index) => <div key={item.id} ref={element => titles.current[index] = element}
            className="j-model-title" style={{ opacity: (reduce ? active : initialFamily) === index ? 1 : 0 }}>
            <span>{index === 0 ? '1' : index === 3 ? '7' : '5'} SERIES</span>
            {item.id === 'G68' && <small>LONG WHEELBASE</small>}
          </div>)}
        </div>
        {reduce ? <img className="j-still-vehicle" data-family={selected.family} src={selected.image} alt={selected.name} /> : <VehicleStage progress={progress} active={active} selections={variants} />}
        <div className="j-controls">
          <button className="j-view-model" onClick={() => setViewer(selected.id)}><Rotate3D aria-hidden="true" />360° view</button>
          <div className="j-selection" id="vehicle-selection" tabIndex={-1}>
            <div className="j-variant-field">
              <label className="j-sr-only" htmlFor="collection-variant">Variant</label>
              <div className="j-select-wrap">
                <select id="collection-variant" value={selected.id}
                  onChange={event => setVariants(previous => ({ ...previous, [family.id]: event.target.value }))}>
                  {models.filter(model => model.family === family.id).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
                <ChevronDown aria-hidden="true" />
              </div>
            </div>
            <button className="j-explore" onClick={() => onOpen(selected)}>Explore {family.id}<ArrowUpRight aria-hidden="true" /></button>
          </div>
        </div>
      </section>
    </main>
    {viewer && <Suspense fallback={<p className="j-viewer-loading" role="status">Preparing model viewer…</p>}>
      <VehicleViewer initial={viewer} onClose={() => setViewer(null)} />
    </Suspense>}
  </div>;
}
