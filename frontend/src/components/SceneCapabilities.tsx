import { useId, useState } from "react";
import type { RunConfig, Vehicle } from "../api/contracts";
import {
  supportedSceneCatalog,
  validateSceneCatalog,
} from "../viewer/modelMapping";
import type { SceneCatalog } from "../viewer/modelMapping";

export interface SceneCapabilitiesProps {
  config: Pick<
    RunConfig,
    "vehicle_id" | "baseline_asset_id" | "part_catalog_version"
  >;
  vehicle?: Vehicle;
  catalog?: SceneCatalog;
}
const capabilityLabels: Record<string, string> = {
  navigation: "Hosted model navigation",
  list_annotation: "Component list annotation",
  photo_annotation: "Separate photo annotation",
  annotation: "Annotation",
  mesh_selection: "Declared mesh selection",
};
export default function SceneCapabilities({
  config,
  vehicle,
  catalog = supportedSceneCatalog,
}: SceneCapabilitiesProps) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  let scene: SceneCatalog | null = null;
  let error = "";
  try {
    scene = validateSceneCatalog(catalog);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Invalid scene catalog.";
  }
  const compatible =
    scene !== null &&
    config.vehicle_id === scene.vehicle_id &&
    config.baseline_asset_id === scene.baseline_asset_id &&
    config.part_catalog_version === scene.part_catalog_version;
  const selectedVehicle =
    vehicle?.vehicle_id === config.vehicle_id ? vehicle : undefined;
  return (
    <section className="scene-capabilities" aria-label="Scene capabilities">
      <h3>Scene capabilities</h3>
      {selectedVehicle && <p>{selectedVehicle.title}</p>}
      <dl>
        <dt>Vehicle ID</dt>
        <dd>{config.vehicle_id || "Not supplied"}</dd>
        <dt>Baseline asset ID</dt>
        <dd>{config.baseline_asset_id || "Not supplied"}</dd>
        <dt>Part catalog version</dt>
        <dd>{config.part_catalog_version || "Not supplied"}</dd>
      </dl>
      <p className="muted">
        Specific preservation verification unavailable: the application
        render-result contract does not supply preservation constraints or their
        validation. Render outcomes and per-change reasons describe the returned
        result; rendering alone does not establish preserved geometry.
      </p>
      {error ? (
        <p role="alert">Scene catalog unavailable: {error}</p>
      ) : !compatible ? (
        <>
          <p>
            No compatible local scene for this exact vehicle, baseline asset and
            part catalog version.
          </p>
          <p>
            Vehicle-wide and unmapped findings remain accessible through finding
            and evidence panels. No substitute model or part mapping is applied.
          </p>
        </>
      ) : (
        scene && (
          <>
            <p>
              Catalog contract {scene.contract_version}. Local visual
              references; exact-trim geometry and physical mappings remain
              unverified.
            </p>
            <div className="asset-reference-links">
              <a
                href={scene.baseline_asset.preview_url}
                target="_blank"
                rel="noreferrer"
              >
                Open baseline preview
              </a>
              <a
                href={`https://sketchfab.com/models/${encodeURIComponent(scene.baseline_asset.model_id)}/embed`}
                target="_blank"
                rel="noreferrer"
              >
                Open hosted baseline model
              </a>
            </div>
            <p>
              Baseline capabilities:{" "}
              {scene.baseline_asset.capabilities
                .map((capability) => capabilityLabels[capability] ?? capability)
                .join(", ") || "None supplied"}
              .
            </p>
            <ul>
              {scene.baseline_asset.limitations.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
            <section aria-label="Separate cabin photo reference">
              <h4>Separate cabin photo reference</h4>
              <p>
                Reference vehicle {scene.interior_reference.vehicle_id} / asset{" "}
                {scene.interior_reference.asset_id}.
              </p>
              <a
                href={scene.interior_reference.url}
                target="_blank"
                rel="noreferrer"
              >
                Open separate cabin reference photo
              </a>
              <ul>
                {scene.interior_reference.limitations.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            </section>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setExpanded((value) => !value)}
            >
              Show part capabilities
            </button>
            <div id={detailsId} hidden={!expanded}>
              <table aria-label="Semantic part capabilities">
                <thead>
                  <tr>
                    <th scope="col">Part ID / parent</th>
                    <th scope="col">Mapping</th>
                    <th scope="col">Capabilities</th>
                  </tr>
                </thead>
                <tbody>
                  {scene.parts.map((part) => (
                    <tr key={part.part_id}>
                      <th scope="row">
                        {part.part_id} / {part.parent_part_id ?? "Root"}
                      </th>
                      <td>
                        <p>
                          {part.mesh_refs.length
                            ? `Declared mesh refs: ${part.mesh_refs.join(", ")}`
                            : "No mesh mapping"}
                        </p>
                        <p>
                          {part.anchor_ref
                            ? `Declared geometry anchor: ${part.anchor_ref}`
                            : "No geometry anchor"}
                        </p>
                        {part.reference_photo_anchor && (
                          <p>
                            Separate photo coordinates:{" "}
                            {part.reference_photo_anchor.join(", ")}. These are
                            image annotations, not physical geometry.
                          </p>
                        )}
                      </td>
                      <td>
                        {part.capabilities
                          .map(
                            (capability) =>
                              capabilityLabels[capability] ?? capability,
                          )
                          .join(", ") || "None supplied"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </section>
  );
}
