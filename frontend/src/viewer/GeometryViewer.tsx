import { useEffect, useRef, useState } from "react";
import type { Api } from "../api/contracts";
import type { GeometryCatalog } from "./geometryCatalog";
import { originalGeometryCatalog } from "./geometryCatalog";
import { mountGeometry, parseGeometry, disposeGeometry } from "./geometryScene.js";
import { placeRegionLabels } from "./RegionTags";
import "./geometry-viewer.css";
import type { ReactNode } from "react";
export type GeometryMarker = { id: string; partId: string; label: string; number?: number };
export default function GeometryViewer({ api, url, catalog, markers, onMarker, originalUrl, baseline = false, attribution }: {
  api: Api; url: string; catalog: GeometryCatalog | null; markers: GeometryMarker[];
  onMarker: (id: string) => void; originalUrl?: string | null;
  baseline?: boolean;
  attribution?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const control = useRef<ReturnType<typeof mountGeometry> | null>(null);
  const camera = useRef<{ position: number[]; target: number[] } | null>(null);
  const [original, setOriginal] = useState(false), [attempt, setAttempt] = useState(0);
  const [inspectParts, setInspectParts] = useState(false);
  const inspectRef = useRef(false);
  const [status, setStatus] = useState("Loading 3D model…"), [error, setError] = useState("");
  const [layout, setLayout] = useState<ReturnType<typeof placeRegionLabels>>([]);
  const markerRef = useRef(markers); markerRef.current = markers;
  const markerKey = JSON.stringify(markers);
  const onMarkerRef = useRef(onMarker); onMarkerRef.current = onMarker;
  useEffect(() => {
    if (!catalog) { setError("A verified part catalog is required to display the model and attached tags."); return; }
    const abort = new AbortController(); let active = true; let model: Awaited<ReturnType<typeof parseGeometry>> | undefined;
    setError(""); setStatus("Loading 3D model…"); setLayout([]);
    const timeout = setTimeout(() => { abort.abort(); if (active) { setError("Model loading timed out. Retry model."); setStatus(""); } }, 30000);
    void (async () => {
      try {
        const source = original ? originalUrl : url;
        const resolved = source && (api.linkUrl ? api.linkUrl(source) : source);
        if (!resolved) throw new Error("Authorized model link unavailable.");
        const parsedUrl = new URL(resolved, window.location.href);
        if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) throw new Error("Invalid model link.");
        const blob = api.canReadAsset?.(parsedUrl.href)
          ? await api.readAsset!(parsedUrl.href, abort.signal)
          : await fetch(parsedUrl.href, { signal: abort.signal, credentials: "omit" }).then(response => { if (!response.ok) throw new Error("Model retrieval failed."); return response.blob(); });
        if (blob.size > 100 * 1024 * 1024) throw new Error("Model exceeds the 100 MB viewer limit.");
        model = await parseGeometry(await blob.arrayBuffer(), original ? originalGeometryCatalog(catalog) : catalog);
        if (!active || abort.signal.aborted) { disposeGeometry(model.scene); model = undefined; return; }
        control.current = mountGeometry(host.current!, model, markerRef.current, (partId: string) => {
          const marker = markerRef.current.find(item => item.partId === partId);
          control.current?.focus(partId); if (marker) onMarkerRef.current(marker.id);
        }, (points: Parameters<typeof placeRegionLabels>[0], width: number, height: number) => setLayout(placeRegionLabels(points, width, height)), camera.current);
        if (inspectRef.current) control.current.inspect();
        clearTimeout(timeout); setStatus(original || baseline ? "Original model loaded." : "Reimagined model loaded.");
      } catch (cause) { if (active && !abort.signal.aborted) { clearTimeout(timeout); setError(cause instanceof Error ? cause.message : "3D rendering unavailable."); setStatus(""); } }
    })();
    return () => { active = false; abort.abort(); clearTimeout(timeout); if (control.current) { camera.current = control.current.camera(); control.current.dispose(); control.current = null; } if (model) disposeGeometry(model.scene); };
  }, [api, url, originalUrl, catalog, original, attempt, baseline]);
  useEffect(() => { control.current?.setMarkers(markerRef.current); }, [markerKey]);
  function select(marker: GeometryMarker) { control.current?.focus(marker.partId); onMarker(marker.id); }
  return <section className="geometry-viewer" aria-label="Editable vehicle model">
    {originalUrl && <div className="geometry-controls" role="group" aria-label="Model version">
      <button aria-pressed={original} onClick={() => setOriginal(true)}>Original</button>
      <button aria-pressed={!original} onClick={() => setOriginal(false)}>Reimagined</button>
    </div>}
    <div className="geometry-stage"><div ref={host} className="geometry-canvas" />
      <svg className="geometry-lines" aria-hidden="true">{layout.map(item => <line key={item.id} x1={item.anchorX} y1={item.anchorY} x2={item.x + item.width / 2} y2={item.y + item.height / 2} />)}</svg>
      {layout.map(item => { const marker = markers.find(m => m.id === item.id); return marker && <button key={item.id} className="geometry-tag" style={{ left: item.x, top: item.y }} aria-label={`${marker.number ?? "Feedback"}. ${marker.label}`} onClick={() => select(marker)}>{marker.number ?? "•"}</button>; })}
    </div>
    <div className="geometry-controls" role="group" aria-label="Model camera">{[["left", "Rotate left"], ["right", "Rotate right"], ["in", "Zoom in"], ["out", "Zoom out"], ["frame", "Frame vehicle"]].map(([action, label]) => <button key={action} disabled={!control.current || !!error} onClick={() => control.current?.action(action)}>{label}</button>)}</div>
    <div className="geometry-controls" role="group" aria-label="Verified part selection">{catalog?.parts.map(part => <button key={part.part_id} disabled={!control.current || !!error} onClick={() => control.current?.focus(part.part_id)}>Focus {part.part_id.replaceAll("-", " ")}</button>)}</div>
    <button disabled={!control.current || !!error} aria-pressed={inspectParts} onClick={() => { inspectRef.current = control.current?.inspect() ?? false; setInspectParts(inspectRef.current); }}>Inspect mapped parts</button>
    {inspectParts && <p>Other geometry is hidden for inspection. The model asset remains unchanged.</p>}
    {status && <p role="status">{status}</p>}
    {error && <><p role="alert">{error}</p>{catalog && <button onClick={() => setAttempt(a => a + 1)}>Retry model</button>}</>}
    <div className="geometry-controls" role="group" aria-label="Model feedback and change explanations">{markers.map(marker => <button key={marker.id} onClick={() => select(marker)}>{marker.number ? `${marker.number}. ` : ""}{marker.label}</button>)}</div>
    <p>Hidden or overlapping markers remain available in the controls above. Geometry previews do not establish engineering or safety approval.</p>
    {attribution}
  </section>;
}
