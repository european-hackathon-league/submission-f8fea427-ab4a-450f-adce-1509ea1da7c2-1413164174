import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Api, Vehicle, Workspace } from "../api/contracts";
import type { ComponentId } from "../domain/contracts";
import type { GeometryCatalog } from "./geometryCatalog";
import GeometryViewer from "./GeometryViewer";
import GeometryAttribution from "./GeometryAttribution";
export default function WorkspaceGeometry({ api, vehicle, workspace, tags, onSelect, onFinding, children }: {
  api: Api; vehicle?: Vehicle; workspace: Workspace | null; tags: boolean; onSelect: (id: ComponentId) => void; onFinding?: (id: string) => void; children: ReactNode;
}) {
  const [catalog, setCatalog] = useState<GeometryCatalog | null>(null), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const runId = workspace?.snapshot.run_id;
  const baselineId = workspace ? workspace.snapshot.config.baseline_asset_id : vehicle?.baseline_asset_id;
  const catalogVersion = workspace ? workspace.snapshot.config.part_catalog_version : vehicle?.part_catalog_version;
  const catalogPath = runId
    ? (workspace?.snapshot.resource_links?.geometry ? `/runs/${encodeURIComponent(runId)}/geometry` : null)
    : (vehicle?.vehicle_id && baselineId && catalogVersion ? `/vehicles/${encodeURIComponent(vehicle.vehicle_id)}/geometry` : null);
  useEffect(() => {
    setCatalog(null); setError("");
    if (!catalogPath) return;
    let active = true; const abort = new AbortController();
    void api.request<GeometryCatalog>(catalogPath, undefined, undefined, abort.signal).then(value => {
      if (!value || value.contract_version !== "1" || value.units !== "m" || !Array.isArray(value.parts) || value.parts.some(part => !part || typeof part.part_id !== "string" || !Array.isArray(part.mesh_refs) || !Array.isArray(part.anchor_local))) throw new Error("Invalid verified geometry catalog.");
      if (value.asset_id !== baselineId || value.baseline_asset_id !== baselineId || value.part_catalog_version !== catalogVersion || !value.baseline_url) throw new Error("Baseline model/catalog identity mismatch.");
      if (active) setCatalog(value);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Catalog retrieval failed."); });
    return () => { active = false; abort.abort(); };
  }, [api, catalogPath, baselineId, catalogVersion, attempt]);
  if (!catalog) return <>{children}{error && <><p role="status">Editable 3D model unavailable: {error}</p><button onClick={() => setAttempt(a => a + 1)}>Retry editable model catalog</button></>}</>;
  const unmapped = (workspace?.findings ?? []).filter(finding => !finding.part_ids.length || finding.part_ids.some(id => !catalog.parts.some(part => part.part_id === id)));
  return <><GeometryViewer api={api} url={catalog.baseline_url!} catalog={catalog} baseline attribution={<GeometryAttribution baselineId={catalog.baseline_asset_id} />}
    markers={tags ? (workspace?.findings ?? []).flatMap(finding => finding.part_ids.filter(id => catalog.parts.some(part => part.part_id === id)).map(partId => ({ id: JSON.stringify([finding.finding_id, partId]), partId, label: finding.title }))) : []}
    onMarker={id => { const [findingId, partId] = JSON.parse(id) as [string, ComponentId]; onSelect(partId); onFinding?.(findingId); }} />
    {unmapped.length > 0 && <div aria-label="Feedback without verified geometry"><p>No verified 3D mapping for these findings:</p>{unmapped.map(finding => <button key={finding.finding_id} onClick={() => onFinding?.(finding.finding_id)}>{finding.title} — view evidence</button>)}</div>}</>;
}
