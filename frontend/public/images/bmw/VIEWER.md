# BMW viewer assets

The landing collection retains all 24 variants. Each variant now has its own official BMW configurator exterior, selected by model code and the configurator's complete default equipment configuration. These are configurator renders, not physical vehicle scans.

`exterior-sources.json` records each model code, source page, equipment options, published effect date, dimensions and the URLs of all 36 source angles. `exterior/<model-code>/00.webp` through `35.webp` are unmodified native images. Refresh them with `python3 frontend/scripts/sync-bmw-exteriors.py` from the repository root. The script reads public configurator service settings at runtime; credentials are never saved in the repository. Use the vehicle-tree snapshot's `closestEffectDate`: URLs generated for future production dates or unpublished current dates can fail at individual angles.

- F70, G60 and G70: 23 separate trim sequences, all 2560×1440, the largest image size advertised by the official configurator response.
- G68: the original China 525Li luxury configuration, 1200×500. Its source sequence begins at 40 degrees; the offset is preserved. No artificial upscaling is applied.
- I20: the additional iX xDrive45 perspective retains its supplied Arctic Race Blue exterior preview sequence at native 960×540. It is separate from the 24 collection variants.

The loader fetches compressed frames with four concurrent requests, then decodes requested angles at source resolution. Stage sequences keep at most four decoded bitmaps; inspection sequences keep three. Evicted bitmaps are closed. The stage holds one sequence per family, replacing and closing it when the chosen trim changes; the inspection viewer owns a separate cache and releases it on close or model change. Sixteen full-size stage bitmaps occupy at most 225 MiB (G68 is smaller); the viewer adds at most three (~42 MiB), plus temporary decode/compositing surfaces. This avoids retaining 144 native bitmaps (about 2 GiB).

The scroll stage feathers the studio edges during rendering, without resizing source images. It holds the painted canvas through family and variant handoffs, so a separate, differently scaled poster cannot flash at the active-family boundary. Initial loading and reduced-motion views use the chosen model's native poster. Both exterior canvases follow their displayed size and screen density, capped at 2×. Rotation remains 36 original angles at 10-degree intervals; family transitions retain the original aligned crossfade and damped scroll motion.

Interior sources captured 2026-10-10 remain in `interior/*-source.json`. F70, G60, G70 and I20 use six 2000×2000 cube faces. G68 uses a 4000×2000 equirectangular panorama. These remain representative family cabins. No cabin has been synthesized or changed in this refinement.

Interior Three.js code loads only when selected. Rendering occurs on resize or interaction, with screen density capped at 1.5×, and GPU resources are disposed on replacement. The workshop viewer and workflow remain unchanged except removal of the “Synthetic workspace” header label.


## Zoom and scroll continuity (11 October 2026)

Exterior viewer supports 100–300% zoom with buttons, mouse wheel/trackpad, and `+`/`-` keys. Home / Reset view restores 40° and 100%; switching models also resets. Zoom changes canvas drawing scale without reloading or reducing the native source. China transparent frames zoom around their own center; studio renders zoom around the vehicle's lower center.

The collection uses four cached native bitmaps per family (about 225 MiB worst case across four 2560px families; actual G68 is smaller), plus three in the open viewer. It synchronously draws the nearest cached angle while one new angle per family decodes in the background. Opacity no longer waits for decoding. Transparent G68 frames bypass studio feathering.

Ground placement uses a shared viewport anchor: tyre baseline at 80% of studio images and 85% of G68's differently cropped images. This prevents family image aspect ratios from shifting the car vertically at handoff.
