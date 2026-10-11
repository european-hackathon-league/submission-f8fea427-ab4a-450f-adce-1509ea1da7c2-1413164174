# Reimagine asset and provider prerequisites

Checked 2026-10-11. This records actual authorized source access and geometry
inspection. The downloaded model contains interior geometry; its component
editing support is limited as described below.

## Intended vehicle

The existing viewer references [2023 BMW I5 M60 by Nazh Design](https://sketchfab.com/3d-models/2023-bmw-i5-m60-207fd872d28b4cafa7fefe061ae98e26).
The live [official metadata endpoint](https://api.sketchfab.com/v3/models/207fd872d28b4cafa7fefe061ae98e26)
reported `isDownloadable: true`, 795,020 vertices and 1,477,883 faces, with
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Keep the creator,
source, license and a description of modifications visible with any derivative.
This is a community model, not an official BMW asset.

The documented [Download API](https://sketchfab.com/developers/download-api/downloading-models)
requires authenticated user OAuth access. An unauthenticated request to
`/v3/models/207fd872d28b4cafa7fefe061ae98e26/download` returned HTTP 401 with
`Authentication credentials were not provided.` No download credential was
found in the process environment or the original checkout's root `.env`.

The signed-in user's main browser subsequently downloaded the original GLB
through that source's official Download button. Archive
`2023-bmw-i5-m60.zip` is 28,426,636 bytes, SHA-256
`cb1d565e14a6d9f253f143a5435a9623690509c9e89e9143ea7325c64de66d82`.
It contains `source/BMW i5 M60.glb`, 28,426,496 bytes, SHA-256
`108ae933b9b36c8b4189109458a390f75b8cc6a16f67a1c6abd75b6ade0f5195`.
No protected viewer payloads were extracted. The embedded photo was not used
to infer interior dimensions.

Blender inspection found 33 material-grouped meshes with generic exact names
`Mesh_0` through `Mesh_32`; no texture images were supplied. `Mesh_32` contains
actual seats, dashboard and steering geometry. Original multi-view renders
and isolated interior renders were inspected. Its 74 disconnected components
permit preserving the source while separating front seat geometry.

[The replayable split recipe](bmw-i5-seat-splits.json) is bound to the exact
source checksum and Blender 5.2.2 LTS. It extracts seven whole connected
components per front seat into exact `SeatDriver` and `SeatPassenger` nodes.
Component IDs are minimum vertex indices in the current mesh; steps run in
order, so the second step uses indices after the first removal. The CLI
refuses a split through connected geometry or a different source/version.
[The reviewed mapping](bmw-i5-seat-mapping.json) maps existing semantic `seats`
to the driver seat only; passenger geometry remains read-only. Wider-seat
demonstrations therefore affect one representative front seat, not every seat.

Independent preparation checks verified all 32 unaffected mesh fingerprints
(vertex positions plus transforms) unchanged. The combined remaining interior
and two seat nodes preserve all 46,292 original interior vertices exactly and
the original polygon count. Each separated seat has 1,758 vertices and 3,304
triangles. Vertex colors are explicitly preserved during GLB export.

The driver's local dimensions are approximately 0.799 m length (X), 0.555 m
width (Y), 0.885 m height (Z); existing node rotations make these axes differ
from scene Y-up. A 10% wider-seat operation changes local Y only. The measured
bottom plane at local Z = 0.424462 m defines the geometric edit origin.
It is a design pivot, not a verified physical mount: no certified mounting
rails, engineering clearance, comfort improvement or safety approval is
established. Dashboard/display separation, new shapes and other parts remain
unsupported until independently reviewed.

The real, deterministic Blender wider-seat check exported a complete candidate
GLB and matching labelled cutaway PNGs. Independent parsing of the original
and candidate GLB POSITION buffers confirmed driver width
0.554572597 → 0.610029817 m (+10%), identical length/height, and exact unchanged
positions for the other 34 meshes. Matched renders were visually inspected;
the whole seat, including its headrest, widens. This is a geometric design
assumption rather than a demonstrated comfort benefit. No new bounding-box
overlap was found; exact collision clearance remains unassessed. Artifacts are
in ignored `backend/.local/bmw-i5-optimized-demo`, including
`independent-glb-validation.json` and `measurements.json`. This offline check
does not prove paid-provider generation or the browser/application flow.

The browser baseline is 21,742,800 bytes and this candidate is 21,742,964 bytes,
both below the renderer's 32 MiB delivery limit. Blender initially produced a
129 MB file by inventing normals absent from the source and splitting vertices
at face corners. Export now preserves the source's absence of custom normals
and exports only the active vertex color; supplied custom normals on other
assets remain supported. No mesh simplification or lossy geometry compression
was used. The current verified baseline is in ignored
`backend/.local/bmw-i5-optimized`; its SHA-256 is
`c864033e5284159574181d14f3368c11fa31cc9458e0438016b8cef7ca0bcbcb`.

Before enabling this vehicle for editing, inspect the archive and retain its
original editable source outside Git. Record a checksum and preparation version;
verify units and orientation; render labelled matching interior/exterior views;
confirm exact node identities, independent components, materials, local bounds,
mounts, anchors and supported operations. Export the browser GLB and bind its
checksum and version to the catalog. Keep downloadable source/results in the
existing authorized storage rather than committing a large vehicle binary.

## Free alternative investigated

[Kenney Car Kit](https://kenney.nl/assets/car-kit) is available through its
official free download and is CC0. Its 3.1 archive was legitimately downloaded
to temporary inspection storage (SHA-256
`fac7dacac5c7874348cf19729af3ef205f3d366493edaf0a827d93f4fdf3d0c4`);
no alternative was installed as the BMW.
Actual GLB JSON and the source preview were inspected:

| File | Size | Exact scene nodes | Relevant limitation |
| --- | ---: | --- | --- |
| `sedan.glb` | 172,216 bytes | `body` and four wheels | No separate seats, dashboard, screen or steering nodes |
| `sedan-sports.glb` | 177,676 bytes | `body`, `spoiler` and four wheels | No independently mapped interior components |
| `suv-luxury.glb` | 175,908 bytes | `body` and four wheels | No independently mapped interior components |

The sedan body POSITION accessor bounds are approximately
`[-0.75, 0, -1.275]` to `[0.75, 1.15, 1.275]` in its local coordinates;
these are source geometry values, not verified real vehicle dimensions.
The sedan SHA-256 is
`b532ea7d2c59f7f6b22b138cf1955218a2c1898f1cea932af4d3fd563c3959b7`.
The opaque stylized cabin and merged body make this an inadequate substitute
for the requested interior workflow. It may serve only as a clearly labelled
exterior demo. Synthetic test cabin geometry must likewise remain explicitly
labelled as a fixture, not the real vehicle.

## Novel component generation

Official API documentation was evaluated for generating a component, not an
entire replacement vehicle. No Meshy, Tripo or Rodin credentials or explicit
live-run budget were found. No paid task was submitted and no provider's
geometry quality or latency was measured. These are documented capabilities,
not a quality ranking:

| Provider | Documented fit | Remaining assembly work |
| --- | --- | --- |
| [Meshy Text to 3D](https://docs.meshy.ai/en/api/text-to-3d) | Asynchronous preview/refine tasks; GLB output; remeshing and target polygon controls; task credit accounting | Normalize generated part, verify scale, fit mounts, clean topology and validate clearance locally |
| [Tripo segmentation](https://developers.tripo3d.ai/en/docs/mesh-segment) and [editing](https://platform.tripo3d.ai/docs/editing) | Semantic segmentation and part completion; generation task lifecycle | Segmentation labels need verification against semantic IDs; mounts and engineering dimensions are not established by segmentation |
| [Rodin Gen-2.5](https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5) and [lifecycle](https://docs.hyper3d.ai/en/get-started/features) | Text/image input; GLB output; face controls; asynchronous status/download; reported consumed credits | Fit, identity, collisions and unchanged-neighbor checks remain local responsibilities |

Meshy documentation states `meshy-5` retired on 2026-10-10; avoid pinning that
model. Provider usage terms and pricing must be checked for the configured
account before purchase or paid submission. See [Meshy terms](https://www.meshy.ai/terms-of-use),
[Tripo developer terms](https://developers.tripo3d.com/en/terms), and
[Hyper3D documentation](https://docs.hyper3d.ai/en) for current policies.

The smallest integration decision is to leave novel generation explicitly
unavailable until one provider account and a bounded allowance are supplied.
Do not build three untested adapters or call a stock component newly generated.
A live allowance must specify total money/credits, task count, timeout and at
most two correction rounds. Persist provider task IDs before polling so retry
does not submit another paid task. Download outputs into authorized workspace
storage before signed provider URLs expire. A visually convincing output still
does not establish manufacturing or safety approval.

## Local prerequisites observed

### Offline inspection and preparation

Run from `backend/` with Blender, before configuring the renderer:

```sh
blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python app/prepare_geometry.py -- --source /path/downloaded.glb --output /path/new-inspection
```

`inspection.json` records exact imported mesh names, hierarchy, local/world
Y-up bounds and dimensions, transforms, material names, vertex/triangle counts,
texture image sizes and source checksum. Metre units are the glTF assumption;
verify source scale independently before declaring a mapping verified. The
command preserves the download and refuses nonempty output directories.

Inspect labelled renders and geometry, then write a manual mapping, for example:

```json
{
  "asset_id": "bmw-i5-verified-v1",
  "part_catalog_version": "bmw-i5-parts-v1",
  "geometry_verified": true,
  "parts": [{
    "part_id": "front-seat",
    "mesh_refs": ["EXACT_IMPORTED_NODE"],
    "anchor_mesh_ref": "EXACT_IMPORTED_NODE",
    "anchor_local": [0, 0, 0],
    "edit_origin_local": [0, -0.5, 0],
    "operations": ["resize_local"]
  }]
}
```

The names and zero anchor above illustrate the format; they are not a BMW
mapping. Choose anchors in measured mesh-local browser XYZ coordinates in
metres; document independently verified mounts and limitations with the source
review. No semantic parts are inferred from names. Resize is allowed only for a
single mapped mesh with unit scale, no unapplied modifiers and a separately
verified geometric `edit_origin_local`. This design pivot does not certify a
physical mount. Read-only parts
use an empty operations list. Unknown mounts or incomplete interior geometry
must remain unsupported.

Repeat the command into a new empty directory with `--mapping reviewed.json`.
It writes `baseline.glb`, editable `baseline.blend`, `inspection.json` and
`catalog.json` containing the actual exported GLB checksum and measured local
dimensions. Export adds the asset/catalog identity extras required by the
viewer. Configure the renderer with these matching files. Keep files in
authorized asset storage; the CLI does not upload or publish them.

For this exact authorized BMW source, run from the repository root:

```sh
blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python backend/app/prepare_geometry.py -- --source "/path/BMW i5 M60.glb" --output backend/.local/bmw-i5-prepared --splits doc/bmw-i5-seat-splits.json --mapping doc/bmw-i5-seat-mapping.json
```

The prepared binary files stay in ignored `backend/.local`; keep the downloaded
original archive separately. Render delivery must display attribution:
**2023 BMW I5 M60 by Nazh Design — CC BY 4.0; front seat components separated
and edited for design exploration.** Include the source and license links above.

Preparation and actual BMW editing were verified with Blender 5.2.2 LTS.
Separate clearly labelled fixture tests cover inspection, GLB/Blend export,
checksums, catalog identity and component separation. The actual vehicle and
live browser/provider checks are recorded in [verification](reimagine-verification.md).
Use the configured Blender executable/container and explicit provider budgets;
keep credentials out of geometry processes and logs.
