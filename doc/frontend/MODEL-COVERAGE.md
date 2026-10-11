# BMW source model audit — 11 October 2026

The landing collection covers **all four challenge families** and **all 23 derivatives in the supplied German option lists**. It also includes one family-level G68 long-wheelbase entry: **24 collection choices total**. The additional iX inside the viewer is outside challenge scope.

| Source | Document location | Collection coverage |
|---|---|---|
| `BMW_Hackathon_Briefing_Short.pdf` | Page 1, “Your mission”: 1 Series, 5 Series, 7 Series; Europe, China, US | All three lines; 5 Series split into G60 and China G68 |
| `F70_G60_G68_G70_customer_studies.xlsx` | `CN_EU_2025`, row 3; `US_2025`, row 1 | F70, G60, G68, G70 — 4/4 |
| `F70_OptionList.PDF` | Page 4, vehicle prices | 116, 120, 123 xDrive, M135 xDrive, 118d, 120d — 6/6 |
| `G60_OptionList.PDF` | Pages 4–5, vehicle prices | 520i, 520d, 520d xDrive, 540d xDrive, 530e, 530e xDrive, 550e xDrive, i5 eDrive40, i5 xDrive40, i5 M60 xDrive — 10/10 |
| `G70_OptionList.PDF` | Pages 4–5, vehicle prices | 740 xDrive, 740d xDrive, 750e xDrive, M760e xDrive, i7 50xDrive, i7 60xDrive, i7 M70 xDrive — 7/7 |
| Three feedback workbooks | `Feedback_Explorer`, `Derivate (e-code)` column | F70, G60, G70 represented |
| `sales_volumes.xlsx` | Sheets `F70`, `G60_G68`, `G70` | All family groups represented |

The keynote describes product-management process; it adds no model catalogue. The annual group report discusses the wider BMW portfolio, which is outside the briefing's 1/5/7 Series scope.

## Limits of “all models”

- **G68 is family-level only.** Supplied customer study identifies “BMW 5 Series G68”; no G68 option-list or named trim breakdown was provided. Do not infer 520Li/530Li coverage from one exterior.
- **Regional free-text mentions are not all selectable derivatives.** Feedback includes, for example, 530i, 740i and 760i, alongside historic cars, comparisons and other brands. These US/regional labels are not separate choices in the supplied German option-list catalogue. Full regional derivative coverage is therefore **not established**. Do not relabel a European exterior to pretend exact regional coverage.
- **Collection coverage is not workflow data coverage.** Exact saved baseline/part-catalog support remains independently validated by the workshop. Selecting a collection trim does not establish a matching engineering baseline or trim-specific feedback. The study and feedback files are predominantly family-level.
- G70 price-list notes mark some derivatives as available from November; a selectable visual preview does not establish current market availability.

Local implementation reference: `frontend/src/collection/journeyData.js`. Exterior provenance and native dimensions: `frontend/public/images/bmw/exterior-sources.json`.

---

# Historical workshop asset assessment (before collection import)

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
