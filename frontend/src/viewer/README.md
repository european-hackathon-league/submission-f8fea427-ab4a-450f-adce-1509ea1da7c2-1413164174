# Illustrative vehicle viewer

The default scene is original, procedural geometry created in this repository. It represents a premium sedan design study and does not reproduce or claim to be an exact BMW model. Feedback values come from the local synthetic fixtures.

To replace the illustration, pass `modelUrl` with a local GLB asset. Model node names map through `modelMapping.ts`: `body_panels`/`exterior_body`, `cockpit_steering_wheel`, `cockpit_dashboard`, `seat_front_left`/`seat_front_right`, `charge_port`/`charging_port`, and `headlamps`/`rear_lamps`. Unmapped meshes remain at their asset material. Keep GLB textures and environment assets local; viewer itself downloads no textures or HDR environment. If loading fails, procedural illustration stays available.

The heatmap uses shared `negativeShare` and `heatColor` helpers. Findings supplied by the parent are authoritative for selected market and period. The viewer shows sample counts beside each named component. Keyboard users can select every component through HTML controls, switch exterior/interior, reset the camera, and rotate the canvas with arrow keys. Orbit controls support pointer and wheel input. Reduced-motion preference disables UI transitions; there is no automatic rotation.
