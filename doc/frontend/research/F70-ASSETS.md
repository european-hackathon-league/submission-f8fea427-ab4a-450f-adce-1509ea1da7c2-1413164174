# BMW 1 Series F70 3D asset research

Checked 2026-10-10. Scope: 2024+ BMW 1 Series F70, including 116, 120, 123 xDrive, M135 xDrive, 118d, and 120d. Goal: downloadable model with an explicit open license and credible current-generation/trim fit.

## Finding

No candidate currently meets the requested accuracy bar. One public Sketchfab record is downloadable under CC BY 4.0 and identifies itself as a 2025 F70, but it is tagged `ai-generated` and `hunyuan3d`. Primary visual review found distorted exterior details; no full interior or exact production trim was verified. Reject it for the accurate-car pitch.

## Candidate: provisional only

**Bmw-1-series 2025** — [Sketchfab model](https://sketchfab.com/3d-models/bmw-1-series-2025-aca5bc34dd014aff89eef647124b485d) · [public Data API record](https://api.sketchfab.com/v3/models/aca5bc34dd014aff89eef647124b485d)

- Author: [teenlin3](https://sketchfab.com/teenlin3); Sketchfab account tier shown as `basic`.
- Model UID: `aca5bc34dd014aff89eef647124b485d`.
- API `isDownloadable`: `true`.
- License: **Creative Commons Attribution 4.0 (CC BY 4.0)**. Author credit and source link required; commercial use allowed per Sketchfab license metadata. [License text](https://creativecommons.org/licenses/by/4.0/).
- Download access: not an anonymous direct file URL. Sketchfab says model downloads require authenticated Sketchfab account and Download API OAuth; API returns temporary archive links after authenticated request. No login was attempted. [Sketchfab Download API docs](https://sketchfab.com/developers/download-api/downloading-models) · [auth guidelines](https://sketchfab.com/developers/download-api/guidelines).
- Formats reported in public API archives: GLB (49.1 MB), glTF archive (41.1 MB), USDZ (14.3 MB), and source archive (77.3 MB). GLB/glTF report 499,999 faces, 325,142 vertices, 3 textures, max texture resolution 4096. USDZ/source topology and texture counts are not reported. Counts differ from the model-level API values (499,999 faces / 249,962 vertices); use archive metrics as export-specific metadata, not a validated mesh audit.
- Model description claims a 2025 fourth-generation BMW 1 Series/F70 and describes M-Sport styling. It does not identify an exact trim or say it represents a production M135 xDrive. Tags include `m135`, `f70`, `curved-display`, `digital-cockpit`, `ai-generated`, and `hunyuan3d`; tags are not proof that those details exist in the mesh.
- Interior evidence: insufficient. Description mentions digital-first interior; tags mention curved display/digital cockpit. No API field proves cabin completeness or fidelity.
- Thumbnail: API exposes a 1920×1080 [preview](https://media.sketchfab.com/models/aca5bc34dd014aff89eef647124b485d/thumbnails/7f1b85cee88f4f489495e9621f756004/0f929cc248134ecaa86f71b108cc8366.jpeg). Primary reviewer inspected it directly after the delegated catalog search. Grille, logo, lamps and surfaces have visibly distorted details. No detailed cabin can be validated from this view.
- Fit decision: **reject for the accurate-car pitch**. Downloadable with attribution after sign-in, but AI-generated provenance, distorted exterior and missing interior/trim validation fail the requested quality bar.

## Excluded result: preview only

**BMW F70 PayoDesings** — [Sketchfab model](https://sketchfab.com/3d-models/bmw-f70-payodesings-5e5371e856ef4496b0185704b325704a) · [public Data API record](https://api.sketchfab.com/v3/models/5e5371e856ef4496b0185704b325704a)

- Author: `payodesings14`; published 2024-12-02.
- API `isDownloadable`: `false`; license object empty; archives null. No public model-file URL found. This is a view-only preview, so it does **not** qualify as an open/downloadable asset.
- API reports 395,528 faces / 211,023 vertices. Empty description and no tags provide no F70 generation, trim, or interior validation. Preview counters do not establish quality.

## Trim coverage

Sketchfab Data API search (`type=models`, `downloadable=true`, `count=24`) for `BMW F70` returned only the provisional record above. Exact downloadable searches returned no results for `BMW F70 116`, `BMW F70 120`, `BMW F70 123 xDrive`, `BMW F70 M135 xDrive`, `BMW F70 118d`, or `BMW F70 120d`. `BMW F70 interior` and `BMW 1 Series 2025 F70` returned the same generic record. Therefore, **none of six requested trims has a verified trim-specific open model**. M135 tags/descriptive M-Sport language are not enough to count M135 xDrive.

Generation safeguard: accept only records explicitly tied to 2024+ F70 evidence. Do not relabel F40 or F20 models as F70; API search returned no F70 trim result that warrants such a substitution.

## Non-open leads

Search surfaced commercial 2025 1 Series listings, including [Superhive model by Zifir3d](https://superhivemarket.com/products/car---bmw-1-series-2025) ($59 at time checked; listing says Blender 2.79+, textures, HDRI; tagged F70/M135) and a [3D-Baza listing](https://3d-baza.com/bmw-1series-2025-car-386085) ($18.13; lists 3ds Max/FBX/OBJ/3DS, 3,396,054 polygons, 1,788,265 vertices). They are paid marketplace assets, not open-license downloads; not counted as matches. Listings do not establish a complete interior or engineering-grade trim accuracy.

## Sources and model identity

- BMW’s [June 2024 new 1 Series press release](https://www.press.bmwgroup.com/united-kingdom/article/detail/T0442821EN_GB/the-all-new-bmw-1-series) calls it the fourth generation and provides current body-design details and measurements. It lists 120, 123 xDrive, and M135 xDrive for the UK launch; market-specific trim availability varies.
- BMW official 2025 [F70 price-list result](https://www.bmw.it/content/dam/bmw/marketIT/bmw_it/Topics/Business/2025/aprile/BMW_Nuova_Serie_1_F70_da_prod_01.05.2025.pdf.coredownload.pdf) explicitly labels the lineup F70. This helps distinguish target generation from F40/F20, but does not certify third-party model geometry.
- Sketchfab [Data API v3](https://sketchfab.com/developers/data-api/v3) is read-only metadata source used for search/record checks. Public download availability flag is distinct from no-login access; [Download API docs](https://sketchfab.com/developers/download-api/downloading-models) require sign-in/OAuth.

## Search coverage and limits

Checked Sketchfab Data API exact terms: `BMW F70`, `BMW F70 116`, `BMW F70 120`, `BMW F70 123 xDrive`, `BMW F70 M135 xDrive`, `BMW F70 118d`, `BMW F70 120d`, `BMW F70 interior`, `BMW 1 Series 2025 F70`, `BMW 1 series F70`, `F70 BMW hatchback`, and `BMW M135 xDrive 2025`; trim searches used `downloadable=true`. Broader web searches covered GitHub, Sketchfab, and marketplace listings. Sketchfab viewer pages returned 403 through available preview tools, so no protected files or downloads were attempted.

This is a public-catalog search, not proof that no asset exists elsewhere or in private/licensed manufacturer libraries. Recheck exact models, provenance and licenses before integration.
