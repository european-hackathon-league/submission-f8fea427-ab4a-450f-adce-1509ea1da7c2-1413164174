# BMW 3D asset research

Checked **10 October 2026**. Scope: F70, G60, G68, G70 and the 23 derivatives in the supplied option lists. G68 has no supplied trim list. Evidence: public model records, downloadable-search export metadata, thumbnails and an interactive i7 M70 exterior preview. **No authenticated mesh archives downloaded; no complete cabin or component topology verified.**

Follow-up: [exact G60 i5 M60 cabin research](G60-INTERIOR-ASSETS.md) identifies a detailed paid ARKVIZ candidate with inspected cockpit/rear-cabin renders. Commercial web/conversion rights remain unresolved. The supplied BlendSwap catalog has no exact G60/i5 match.

## Result

**Two families have promising free exterior assets. No complete, high-quality, open asset set covers all four families or all 23 trims.** These are artist representations of actual BMW designs, not manufacturer CAD or certified digital twins. Exterior previews are credible starting points, but their current materials and presentation need work for the pitch.

| Family | Best free candidate | Evidence and decision |
|---|---|---|
| G60 | [2023 BMW i5 M60 — Nazh Design](https://sketchfab.com/3d-models/2023-bmw-i5-m60-207fd872d28b4cafa7fefe061ae98e26) | CC BY 4.0, downloadable; GLB **43.0 MB**, ~1.48M triangles. Detailed exterior preview; heavy geometry, only two reported materials. Shortlist for exterior after mesh/material audit and optimization. |
| G70 | [2023 BMW i7 G70 — Nazh Design](https://sketchfab.com/3d-models/2023-bmw-i7-g70-07937cca69864dfe9f4b4ed235fc32f7) | CC BY 4.0, downloadable; GLB **9.36 MB**, ~210K triangles. Recognizable exterior; one reported material, no textures. Strong family-level starting point, exact derivative unspecified. |
| G70 | [BMW i7 M70 — akyolefe319](https://sketchfab.com/3d-models/bmw-i7-m70-5ef18af79916408ababa187fb0428429) | CC BY 4.0, downloadable; GLB **14.2 MB**, ~358K triangles. Description identifies 2024 M70 xDrive; interactive orbit verified, rear badging visible. Exterior usable as a starting point; opaque windows and basic finish do not establish detailed interior. Eleven reported materials. |
| F70 | [Bmw-1-series 2025 — teenlin3](https://sketchfab.com/3d-models/bmw-1-series-2025-aca5bc34dd014aff89eef647124b485d) | CC BY 4.0, downloadable; GLB **49.1 MB**, ~500K triangles. Tagged `ai-generated` and `hunyuan3d`; inspected preview has distorted details. **Reject for the accurate-car pitch**, no exact trim or cabin verified. |
| G68 | No qualifying asset verified | Separate China long-wheelbase body. G60 must not be relabeled or stretched and presented as verified G68. See [G68 research](G68-ASSETS.md). |

MB are decimal. Sizes, formats and triangles above come from Sketchfab search archive metadata; they are not measured local downloads. All shortlisted records list GLB, glTF and USDZ exports. Source archive metadata exists, but its native file format was not established. Details and 34 primary-agent search queries are recorded in [BMW-3D-ASSETS.json](BMW-3D-ASSETS.json).

## Exact derivative coverage

**Two of 23 derivatives have credible explicitly named free candidates:** G60 i5 M60 xDrive and G70 i7 M70 xDrive. This means a matching listing and plausible exterior, not a fully validated trim model.

No credible exact open match verified for:

- **F70:** 116, 120, 123 xDrive, M135 xDrive, 118d, 120d.
- **G60:** 520i, 520d, 520d xDrive, 540d xDrive, 530e, 530e xDrive, 550e xDrive, i5 eDrive40, i5 xDrive40.
- **G70:** 740 xDrive, 740d xDrive, 750e xDrive, M760e xDrive, i7 50 xDrive, i7 60 xDrive.

Shared body architecture does not make wheels, bumpers, charging/fuel ports, badging, or interior options interchangeable. Generic i7 is not proof of either 50 or 60 xDrive coverage.

## Rejected and reserve leads

- [Bmw-520d](https://sketchfab.com/3d-models/bmw-520d-6b60ebea0cba431fbf0eb024c8869a8f) claims G60, but the inspected preview resembles the older generation and has scan-like distortions. Generation unresolved; do not count as G60 520d.
- [Merc_TV G70/G73](https://sketchfab.com/3d-models/bmw-7-series-mk7-g70g73-2022-dc7cb373178a4572a506f8d4886a5d3c): CC BY, 8.70 MB GLB, ~200K triangles and 50 materials. Reserve only: blank description, exact derivative and cabin unverified.
- Generic [i5](https://sketchfab.com/3d-models/i5-1e52b6b8821040c2aea037b7c029a20d) says “all belongs to BMW AG”; usable provenance not established. One textured i7 explicitly says “Free REUPLOAD”; hold rather than assume uploader owns it.
- A listing titled M5 “G60” depicts a different derivative/family; exclude. F40/F20 models, Genesis G70 results and printable single-shell STLs do not satisfy the scope.
- Freecreat i5 download requires VIP access and does not supply a clear open reuse license. GreatCatalog's “free with Premium” is paid access. BlenderKit/Blendkit i5 and detailed i7 leads require Full Plan. A CGTrader free i7 M70 search result could not be reopened (HTTP 410); license is proprietary royalty-free, not CC/open. None counted as verified free/open assets.
- Game-mod and mirror downloads lacked clear web redistribution rights and creator provenance; not counted.

## Frontend implications

Download the three shortlisted assets through the normal authenticated flow, then inspect cabin geometry, object hierarchy, UVs, normals and materials in Blender/glTF tooling. Keep attribution, record changes, optimize geometry and textures, and export tested GLBs. Only then approve pitch quality.

For red feedback regions, map actual named meshes to body, lamps, charging port, dashboard, steering and seats. Material counts do **not** prove those regions are separate. If topology is merged, create verified part masks or split geometry. Until then use clearly labeled feedback controls; do not imply red labels are a spatial 3D heatmap. Paint selection and issue severity must remain separate.

No verified detailed open 3D cabin was found in this search. Authentic licensed cabin photographs can support the pitch, explicitly labeled as photographs and with exact vehicle identity. Full interactive cabin needs a better licensed asset or a commissioned/modeling pass.

## Access, license and search limits

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits sharing and adaptation, including commercial use, with author credit, license link and indication of changes. It does not certify model accuracy or make these official BMW assets. Use “open-licensed 3D assets” rather than imply an open-source BMW CAD library.

[Sketchfab downloads require an authenticated account](https://sketchfab.com/developers/download-api); public preview and `isDownloadable=true` are not anonymous mesh-file access. Sign-in was not attempted; no protected files scraped. After legitimate download, a locally hosted GLB viewer can serve project managers without making them sign in to Sketchfab.

Search covered Sketchfab public APIs by family and exact trim, plus web-indexed GitHub, CGTrader, TurboSquid, Free3D, BlenderKit/Blendkit, 3DExport, GreatCatalog and related listings. Family-specific evidence: [F70](F70-ASSETS.md), [G68](G68-ASSETS.md). Negative results mean **not verified in the searched public sources**, not proof that no model exists anywhere.
