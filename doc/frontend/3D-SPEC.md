# 3D viewer specification

## Deliverable
React Three Fiber viewer, original illustrative premium sedan exterior and cockpit interior. Geometry must read as a car: sculpted hood, roof/glass, wheels, lighting, grille; cockpit includes dashboard, wheel and seats. No claim of exact BMW geometry. Label “Illustrative vehicle”; model provenance stays explicit.

## Shared interface
Export default `VehicleViewer` from `frontend/src/viewer/VehicleViewer.tsx`; props defined in shared contracts. Stable IDs: steering, dashboard, seats, charging, body, lighting. External `view`, `period`, `selectedComponent`, and `heatmap` drive display; changes use callbacks. Keep styling scoped to viewer. UI agent treats viewer as opaque.

## Interaction and overlays
Exterior/interior buttons, constrained orbit and zoom, reset camera, named clickable hotspots with accessible HTML equivalents. Exterior focuses body/lighting/charging; interior focuses steering/dashboard/seats. Selected part gets distinct blue outline/anchor independent of heat color. Negative-share scale: ≥50 red #e45454; ≥25 amber #e8b75a; lower teal #57b6a0; unknown gray #8a909b. Label and counts accompany color. Use shared metric helpers. Heat overlays follow period. Camera preset transitions respect reduced motion. No continuous idle motion by default.

## Model replacement and resilience
Optional `modelUrl` loads GLB through error boundary; scope materials per instance. Stable node-name mapping identifies supported parts; unmapped mesh remains neutral. Original procedural car remains bundled default and fallback on model failure. WebGL failure provides annotated static fallback and component buttons. No remote HDR/environment assets; generate lights/reflections locally. Lazy-load viewer; cap DPR at 1.5–2; use demand rendering when idle; dispose owned resources.

## Acceptance
Exterior/interior and rapid switches work; clickable selection updates parent; red heat changes by period and can be disabled; reset frames correctly; asset failure and no-WebGL remain usable. Focus/keyboard equivalence and small-width framing required. Document asset mapping/provenance and replacement steps in viewer README. Unit-test heat/mapping behaviors; integrator performs visual/browser verification.
