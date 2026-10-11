import { useEffect, useRef, useState } from "react";
import { Maximize, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import type { ReactNode } from "react";
import type { Api, Finding } from "../api/contracts";
import type { GeometryCatalog } from "./geometryCatalog";
import { originalGeometryCatalog } from "./geometryCatalog";
import { mountGeometry, parseGeometry, disposeGeometry } from "./geometryScene.js";
import { placeRegionLabels } from "./RegionTags";
import { feedbackColor, partLabel } from "../components/WorkshopSummary";
import "./geometry-viewer.css";

export type GeometryMarker = {
  id: string; partId: string; label: string; number?: number;
  counts?: Finding["counts"]; cohortIds?: string[]; provisional?: boolean;
};
type Camera = { position: number[]; target: number[] };
export default function GeometryViewer({ api, url, catalog, markers, onMarker, originalUrl, baseline = false, attribution, selectedPart, onSelectPart, fallback, referenceAction }: {
  api: Api; url: string; catalog: GeometryCatalog | null; markers: GeometryMarker[];
  onMarker: (id: string) => void; originalUrl?: string | null; baseline?: boolean;
  attribution?: ReactNode; selectedPart?: string | null; onSelectPart?: (id: string) => void;
  fallback?: ReactNode; referenceAction?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const control = useRef<ReturnType<typeof mountGeometry> | null>(null);
  const camera = useRef<Camera | null>(null);
  const cameraKey = JSON.stringify(["geometry-camera", api.sessionNamespace ?? api.mode, catalog?.baseline_asset_id, catalog?.part_catalog_version]);
  const [original, setOriginal] = useState(false), [attempt, setAttempt] = useState(0);
  const [inspectParts, setInspectParts] = useState(false);
  const inspectRef = useRef(false);
  const [status, setStatus] = useState("Loading 3D model…"), [error, setError] = useState("");
  const [layout, setLayout] = useState<ReturnType<typeof placeRegionLabels>>([]);
  const [focusedPart, setFocusedPart] = useState<string | null>(null);
  const activePart = selectedPart === undefined ? focusedPart : selectedPart;
  const activePartRef = useRef(activePart); activePartRef.current = activePart;
  // A shared part may contain overlapping findings; never add their counts together.
  const displayedMarkers = baseline ? [...new Set(markers.map(marker => marker.partId))].map(partId => {
    const matches = markers.filter(marker => marker.partId === partId);
    return { ...matches[0], label: partLabel(partId), counts: matches.length === 1 ? matches[0].counts : undefined };
  }) : markers;
  const markerRef = useRef(displayedMarkers); markerRef.current = displayedMarkers;
  const markerKey = JSON.stringify(displayedMarkers);
  const onMarkerRef = useRef(onMarker); onMarkerRef.current = onMarker;
  const onSelectRef = useRef(onSelectPart); onSelectRef.current = onSelectPart;
  function rememberCamera(value: Camera) {
    camera.current = value;
    try { sessionStorage.setItem(cameraKey, JSON.stringify(value)); } catch { /* Camera controls work without storage. */ }
  }
  function selectPart(id: string) {
    setFocusedPart(id); control.current?.focus(id); onSelectRef.current?.(id);
  }
  useEffect(() => {
    if (!catalog) { setError("A verified part catalog is required to display the model and attached tags."); setStatus(""); return; }
    try {
      const saved = JSON.parse(sessionStorage.getItem(cameraKey) ?? "null") as Camera | null;
      camera.current = saved && [saved.position, saved.target].every(vector => Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite)) && saved.position.some((value, index) => value !== saved.target[index]) ? saved : null;
    } catch { camera.current = null; }
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
          setFocusedPart(partId); control.current?.focus(partId);
          if (onSelectRef.current) onSelectRef.current(partId);
          else { const marker = markerRef.current.find(item => item.partId === partId); if (marker) onMarkerRef.current(marker.id); }
        }, (points: Parameters<typeof placeRegionLabels>[0], width: number, height: number) => setLayout(placeRegionLabels(points, width, height)), camera.current, rememberCamera);
        if (camera.current) control.current.focus(activePartRef.current ?? null, false);
        else control.current.focus(activePartRef.current ?? null);
        if (inspectRef.current) control.current.inspect();
        clearTimeout(timeout); setStatus(original || baseline ? "Original model loaded." : "Reimagined model loaded.");
      } catch (cause) { if (active && !abort.signal.aborted) { clearTimeout(timeout); setError(cause instanceof Error ? cause.message : "3D rendering unavailable."); setStatus(""); } }
    })();
    return () => { active = false; abort.abort(); clearTimeout(timeout); if (control.current) { rememberCamera(control.current.camera()); control.current.dispose(); control.current = null; } if (model) disposeGeometry(model.scene); };
  }, [api, url, originalUrl, catalog, original, attempt, baseline, cameraKey]);
  useEffect(() => { control.current?.setMarkers(markerRef.current); }, [markerKey]);
  useEffect(() => { control.current?.focus(activePart ?? null); }, [activePart]);
  function select(marker: GeometryMarker) { setFocusedPart(marker.partId); control.current?.focus(marker.partId); onMarker(marker.id); }
  function action(value: string) { control.current?.action(value); if (control.current) rememberCamera(control.current.camera()); }
  const failed = <><p role="alert">{error}</p>{catalog && <button onClick={() => setAttempt(a => a + 1)}>Retry model</button>}</>;
  if (error && fallback) return <div className="geometry-fallback">{fallback}<details open><summary>Editable model unavailable</summary>{failed}</details></div>;
  return <section className="geometry-viewer" aria-label="Editable vehicle model">
    <div className="geometry-view-switch" role="group" aria-label="Vehicle view">
      {originalUrl ? <>
        <button aria-pressed={original} onClick={() => setOriginal(true)}>Original</button>
        <button aria-pressed={!original} onClick={() => setOriginal(false)}>Reimagined</button>
      </> : <button aria-pressed="true">Exterior 3D</button>}
      {referenceAction}
      <button disabled={!control.current || !!error} onClick={() => action("frame")}>Reset view</button>
    </div>
    <div className="geometry-stage">
      <div ref={host} className="geometry-canvas" tabIndex={0} aria-label="Vehicle camera" onKeyDown={event => {
        const keyAction = ({ ArrowLeft: "left", ArrowRight: "right", "+": "in", "=": "in", "-": "out", Home: "frame" } as Record<string, string>)[event.key];
        if (keyAction) { event.preventDefault(); action(keyAction); }
      }} />
      <svg className="geometry-lines" aria-hidden="true">{layout.map(item => <line key={item.id} x1={item.anchorX} y1={item.anchorY} x2={item.x + item.width / 2} y2={item.y + item.height / 2} />)}</svg>
      {layout.map(item => { const marker = displayedMarkers.find(m => m.id === item.id); return marker && <button key={item.id} className="geometry-tag" style={{ left: item.x, top: item.y, width: item.width }} aria-pressed={activePart === marker.partId} onClick={() => onSelectPart ? selectPart(marker.partId) : select(marker)}>
        {marker.number ? <span>{marker.number}.</span> : <i style={{ background: feedbackColor(marker.counts?.negative_share ?? null) }} />}
        {baseline ? partLabel(marker.partId) : marker.number ? partLabel(marker.partId) : marker.label}
      </button>; })}
      <div className="geometry-camera" role="group" aria-label="Model camera">{[
        { value: "left", label: "Rotate left", Icon: RotateCcw }, { value: "right", label: "Rotate right", Icon: RotateCw },
        { value: "out", label: "Zoom out", Icon: ZoomOut }, { value: "in", label: "Zoom in", Icon: ZoomIn }, { value: "frame", label: "Frame vehicle", Icon: Maximize },
      ].map(({ value, label, Icon }) => <button key={value} aria-label={label} title={label} disabled={!control.current || !!error} onClick={() => action(value)}><Icon size={16} aria-hidden="true" /></button>)}</div>
    </div>
    {status && <p className="geometry-status" role="status">{status}</p>}
    {error && failed}
    {baseline && <div className="geometry-parts" role="group" aria-label="Verified part selection">{catalog?.parts.filter(part => partLabel(part.part_id) !== part.part_id).map(part => <button key={part.part_id} aria-label={`Select ${partLabel(part.part_id)}`} aria-pressed={activePart === part.part_id} disabled={!control.current || !!error} onClick={() => selectPart(part.part_id)}>{partLabel(part.part_id)}</button>)}</div>}
    {markers.length > 0 && <details className="geometry-feedback" open={!baseline}>
      <summary>{baseline ? `Feedback by finding (${markers.length})` : "Change explanations"}</summary>
      <div className="geometry-findings" role="group" aria-label="Model feedback and change explanations">{markers.map(marker => <button key={marker.id} onClick={() => select(marker)} aria-label={`${marker.number ? marker.number + ". " : ""}${marker.label}${marker.counts ? `. ${marker.counts.negative_records} of ${marker.counts.total_records} negative feedback records` : ""}${marker.cohortIds?.length ? `. Cohorts: ${marker.cohortIds.join(", ")}` : ""}${marker.provisional || marker.counts?.provisional ? ". Provisional" : ""}${marker.counts?.low_evidence ? ". Low evidence" : ""}`}>
        <span>{marker.number ? `${marker.number}. ` : ""}{marker.label}</span>
        {marker.counts && <small>{marker.counts.negative_records}/{marker.counts.total_records} negative · {marker.counts.negative_share === null ? "Share unknown" : `${Math.round(marker.counts.negative_share * 100)}%`}{marker.cohortIds?.length ? ` · ${marker.cohortIds.join(", ")}` : ""}{marker.provisional || marker.counts.provisional ? " · Provisional" : ""}{marker.counts.low_evidence ? " · Low evidence" : ""}</small>}
      </button>)}</div>
    </details>}
    <details className="geometry-tools"><summary>Model tools &amp; limitations</summary>
      <div className="geometry-parts">{catalog?.parts.filter(part => !baseline || partLabel(part.part_id) === part.part_id).map(part => <button key={part.part_id} disabled={!control.current || !!error} onClick={() => control.current?.focus(part.part_id)}>Focus {part.part_id === "seat-passenger" ? "Passenger seat (read-only)" : partLabel(part.part_id).replaceAll("-", " ")}</button>)}</div>
      <button disabled={!control.current || !!error} aria-pressed={inspectParts} onClick={() => { inspectRef.current = control.current?.inspect() ?? false; setInspectParts(inspectRef.current); }}>Inspect mapped parts</button>
      {inspectParts && <p>Other geometry is hidden for inspection. The model asset remains unchanged.</p>}
      <p>Hidden or overlapping markers remain available in the finding and change controls. Geometry previews do not establish engineering or safety approval.</p>
    </details>
    {attribution}
  </section>;
}
