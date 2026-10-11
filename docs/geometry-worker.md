# Geometry renderer

This renderer edits a **verified, legally downloaded GLB**, not the Sketchfab iframe or a cabin photograph. See [asset provenance and preparation](../doc/reimagine-assets.md) for the verified vehicle baseline. Until that editable asset and catalog are configured the workspace reports an unavailable capability and jobs fail explicitly. Test cubes are fixtures, not vehicle geometry.

## Run locally

Install Blender separately. In `backend`, run `uv sync --frozen`. Configure the same renderer token in the application and private renderer:

```text
RENDERER_URL=http://localhost:8090
RENDERER_TOKEN=<private shared token>
GEOMETRY_TOKEN=<same token>
GEOMETRY_PUBLIC_URL=http://localhost:8090
GEOMETRY_BASELINE_PATH=<absolute path to verified GLB>
GEOMETRY_CATALOG_PATH=<absolute path to verified catalog JSON>
GEOMETRY_JOBS_PATH=<private persistent job directory>
GEOMETRY_BLENDER=<absolute path to Blender executable>
```

Start the private adapter with `uv run uvicorn app.geometry_renderer:app --host 127.0.0.1 --port 8090 --workers 1`. In another terminal start the worker with `uv run python -m app.geometry_renderer`. Neither process needs database or application authentication secrets. The application retains its existing Temporal submission/polling, immutable manifests, workspace ownership checks, and authorized asset proxy. Keep adapter and worker off public networks; only the application should access them.

Run one adapter and one geometry worker per jobs directory. The adapter atomically persists manifests and results; the worker scans committed manifests and resumes queued or rendering stages after restart. Completed plans, tool audits, measurements, and vision review stages are cached. The same run plus idempotency key cannot be rebound to a different manifest. Keep job storage private: manifests contain selected feedback and customer evidence references. Retention is currently operator managed; remove completed job directories only after their application retention period expires.

Progress reports the committed stage: queued, inspecting, planning, editing, validating, reviewing, or complete. Candidate catalogs retain `baseline_anchor_local` separately from updated `anchor_local`, so original/candidate switching uses the correct coordinates for each model. Design interpretations are persisted alongside each initial/correction plan and restored on retry; unknown change IDs or unbounded interpretation values are rejected.

## Verified catalog

Use `GeometryCatalog` in `app/geometry.py` as the schema. Required identity fields are `contract_version: "1"`, `baseline_asset_id`, `asset_id`, `part_catalog_version`, `units: "m"`, and the original GLB's lowercase SHA256. Each part has `part_id`, exact GLB node `mesh_refs`, `anchor_mesh_ref`, metre-valued mesh-local `anchor_local`, measured local `dimensions_m`, and `operations`. Keep provenance, license, attribution, source archive and preparation notes beside the asset. A catalog with a checksum alone does not establish permission to use the asset.

Both the original and candidate GLB scene extras carry `asset_id` and `part_catalog_version`. The browser rejects mismatched identities or unavailable exact mesh references. The original scene asset identity is the baseline ID; the candidate identity is `candidate`.

Currently supported edits are explicit local mesh resizing around a separately verified `edit_origin_local` point, at 0.5-1.5 times each baseline dimension. The `edit_origin_local` is a measured deformation pivot; it does not establish a certified physical mount. A tag's `anchor_local` is independently retained for feedback placement. Editable parts must have a verified geometry edit origin, be a single independent mesh, have applied unit object scale and no unapplied modifiers. Updated tag anchors follow the deformation. The worker copies mesh data, preserves the source file, independently measures before/after dimensions, and fingerprints unaffected vertex coordinates and transforms. It reports newly introduced world bounding-box overlaps; these are conservative clearance warnings, not an exact surface collision or safety test. Novel shapes, multi-mesh mounting/deformation, manufacturing feasibility, and engineering approval are unsupported. Free-text preservation constraints are also unsupported until an independently measurable policy exists; the editor never silently claims arbitrary prose constraints were met.

## Editing model and vision

The editor is separate from evidence extraction. Optional live planning/review requires explicit opt-in and a project-approved budget:

```text
GEOMETRY_AI_ENABLED=true
GEOMETRY_OPENAI_API_KEY=<server-side editing credential>
GEOMETRY_OPENAI_BASE_URL=https://api.openai.com/v1
GEOMETRY_MODEL=<project configured Responses model>
GEOMETRY_MAX_TOOL_ROUNDS=3
GEOMETRY_MAX_CORRECTION_ROUNDS=2
GEOMETRY_TIMEOUT_SECONDS=180
```

Default AI is disabled; no paid inference occurs without opt-in. Each planning pass is bounded to three Responses calls (configurable 1-4), each with at most 1,200 output tokens and no automatic SDK retry. Each visual review is one structured Responses call, also at most 1,200 output tokens. Corrections stop after at most two rounds or when no distinct compatible plan is offered. Blender subprocesses each have a 180-second deadline (configurable 1-600 seconds). Input views are limited to six images at 2 MiB each. Total dollar cost depends on the configured model's current token/image pricing; establish an allowance before enabling this configuration. There is no automatic price lookup or purchase.

The Responses loop gives the editor selected saved changes, customer wording distinct from design assumptions, the verified catalog, baseline renders, and tools to inspect exact parts and propose validated resizes. Geometry executes in a separate Blender subprocess after the joint plan; candidate measurements and matching original/candidate views feed structured visual review and targeted replanning. Model ID, response IDs, tool requests/results, usage metadata and review results remain in the private job directory. Credentials never enter Blender's environment. No generated Python executes.

There is no novel-mesh provider integration or credential configured. Requests for newly shaped/replacement components remain unsupported instead of receiving a canned replacement. Geometry produced, visual review and engineering validity are separate result fields; review failure retains the measured candidate with `needs_review` and overall `partial` status. `succeeded` requires every requested change to produce geometry, pass visual review and carry no clearance warning. A geometric rendering status does not establish engineering approval or safety. Each corrected candidate stays in its own directory; an atomically written pointer binds its geometry, exact plan, and measurements so later review errors preserve the latest committed candidate. Explicit retry uses the private authenticated `/renderer/v1/jobs/{job_id}/retry` endpoint and a new idempotency key, retaining all committed checkpoints.

## Tests and troubleshooting

```text
uv run pytest tests/test_geometry.py tests/test_blender_geometry.py -q
uv run ruff check app/geometry.py app/geometry_agent.py app/geometry_renderer.py app/blender_geometry.py
uv run mypy app/geometry.py app/geometry_agent.py app/geometry_renderer.py app/blender_geometry.py
```

Set `BLENDER_EXE` to run the real Blender integration test. It creates labelled test boxes, resizes one, checks the source is unchanged, parses actual exported GLB positions independently, verifies the other mesh is unchanged, checks scene identity and requires matching original/candidate renders. Without Blender the test is explicitly skipped. This fixture does not validate an actual vehicle, live provider behavior, interior completeness, or mounting feasibility.

`503` from the private baseline endpoints means no verified configured asset or checksum mismatch. An unavailable Blender executable or exceeded subprocess deadline creates a failed result. Duplicate submissions with another manifest return `409`. Vision/API errors retain measured geometry as unverified. Do not expose the private renderer token to the browser; all model downloads go through owned-run application routes.

Responses tool calling follows the [official OpenAI guide](https://developers.openai.com/api/docs/guides/function-calling). Images are supplied as actual image content, not inferred from text descriptions.
