# Vehicle and asset coverage

Code family does not prove exact derivative, trim, model year, equipment, or feedback scope. Challenge package includes F70, G60, and G70 feedback/customer-study/option-list files; G68 customer-study workbook. The current UI does not parse these files. Default feedback and research remain synthetic. There is no separate comparison workspace.

| Family | Current asset / coverage | Decision |
|---|---|---|
| F70 · 1 Series | One Sketchfab F70-labelled downloadable model (UID `aca5bc34dd014aff89eef647124b485d`), CC BY 4.0 per listing, by `teenlin3`; tagged `ai-generated` / `hunyuan3d`. Thumbnail shows distorted grille/logo/lights; not reliable for accurate presentation. Another F70 record is preview-only (`isDownloadable=false`). | Reject as accurate pitch asset. No verified open model for 116, 120, 123 xDrive, M135 xDrive, 118d, or 120d. Do not substitute F40/F20. |
| G60 · 5 Series / i5 | Current demo uses creator-uploaded [2023 BMW i5 M60](https://sketchfab.com/3d-models/2023-bmw-i5-m60-207fd872d28b4cafa7fefe061ae98e26) by Nazh Design, listing CC BY 4.0; hosted 3D needs network. Bundled exterior preview is fallback. Cabin view uses [BMW 520i G60 photo](https://commons.wikimedia.org/wiki/File:BMW_520i_G60_Oxide_Grey_Metallic_03.jpg) by Ethan Llamas, CC BY-SA 4.0. | Suitable as labeled visual reference only. Photo is not M60 cabin or 3D; model geometry and component mapping are not validated. No GLB is self-hosted. |
| G68 · China long-wheelbase 5 Series / i5 | Study workbook only; no asset established for an exact G68 derivative. | Uncovered. Do not reuse G60 asset as exact G68 without validation. |
| G70 · 7 Series / i7 | Challenge data package; no selected or verified exterior/interior asset in current route. | Uncovered. |

The current case label is i5 M60 / G60; it does not show that synthetic measures belong to this vehicle. Colors encode API-supplied negative-record-volume intensity, not damage or engineering defect. In viewer, color is limited to HTML component list and cabin-photo markers; no verified mesh heat coloring. Creator uploads and licenses are not BMW endorsement. Keep creator/license attribution visible in product.

Sources: asset records and citations above; F70 assessment recorded in [research note](research/F70-ASSETS.md). Recheck public listing and license before reuse. Coverage beyond these public checks remains unknown.


F2 scene-catalog gate uses exact saved vehicle, baseline asset and part-catalog version. The local versioned catalog uses published `contract_version`, `part_catalog_version`, `mesh_refs` and `anchor_ref` keys plus explicit local asset metadata. Parent references, cycles, duplicate IDs, ambiguous mesh references and photo anchors are validated. All current mesh references are empty and geometry anchors null: no mesh picking is claimed. Six frontend component controls provide list/photo navigation; `vehicle` and `cabin` are hierarchy nodes, not spatial controls. Image/model failures retain component lists and explicit retries. Missing or ambiguous cohort-wide aggregates are never added or treated as a vehicle total.

## F5 render-result boundary

The scene capability panel binds the saved vehicle, baseline asset and part catalog version. It lists semantic parts and their declared capabilities; photo coordinates are image annotations, not physical geometry. Unsupported triples receive no replacement model.

Variant previews consume only outcome-referenced assets from the exact application render result. Baseline preview/model and separate cabin reference remain independently addressable. Native previews support loading, failure, a 15-second timeout, retry and authorized-link refresh through render-status GET. Unknown media remain explicit links; unsafe URLs and conflicting duplicate asset IDs are withheld.

`frontend-render-annotation.svg` is a static, labeled synthetic test annotation card. It depicts no vehicle, geometry or generated result and does not visualize edited proposal text. Synthetic fixtures never establish preservation. The published application `RenderResult` has no preservation constraints or validation fields; those guarantees require an external contract addition.
