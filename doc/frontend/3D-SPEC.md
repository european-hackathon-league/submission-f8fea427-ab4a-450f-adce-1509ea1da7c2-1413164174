# Vehicle viewer scope and next steps

## Current route

`frontend/src/App.tsx` lazy-loads `BmwAssetViewer` (`frontend/src/viewer/BmwAssetViewer.tsx`) through the shared `VehicleViewerProps` contract. It shows a creator-uploaded **2023 BMW i5 M60** hosted on Sketchfab (model UID `207fd872d28b4cafa7fefe061ae98e26`; listing license CC BY 4.0). Hosted 3D requires network. A bundled exterior image remains as a fallback. No GLB was downloaded or self-hosted.

Interior mode is a static **BMW 520i G60 cabin photograph**, licensed CC BY-SA 4.0 and credited in the view. It is not an i5 M60 cabin and is not 3D. Synthetic component markers overlay the photo.

The viewer accepts selected component, view, period, findings, and heatmap state. Severity is negative-feedback share, not a defect score. Color is shown in the HTML component list and cabin-photo markers; **component-mesh heat recoloring is not verified**. Treat scene selection/hotspots as illustrative unless mapping to named geometry is tested. Attribution stays visible. Asset is creator-uploaded, not official BMW material; BMW does not endorse this prototype.

`frontend/src/viewer/VehicleViewer.tsx` contains a procedural study scene but is not the current pitch route. Do not describe it as a BMW model or current exterior/interior asset.

## Integration gates

Before using a different derivative, confirm source/license and exact model identity; secure both exterior and interior assets; validate proportions, cabin, and component mapping; test attribution, failure fallback, and responsive framing. Unknown mesh names remain neutral. Do not imply an accurate component heatmap before separate semantic meshes are verified.

Keep the network-independent photo and HTML component list usable if hosted content or WebGL fails. Preserve keyboard alternatives, focus states, reduced-motion behavior, reset/zoom/orbit controls, and text/sample equivalents. Self-hosted GLB is a later option only after an authorized download and asset review.

See [MODEL-COVERAGE.md](MODEL-COVERAGE.md) for asset evidence, exclusions, and uncovered families. Browser verification is still pending.
