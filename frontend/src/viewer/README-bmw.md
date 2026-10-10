# BMW asset viewer provenance

## Exterior model

The interactive exterior loads the creator-uploaded Sketchfab model [2023 BMW i5 M60](https://sketchfab.com/3d-models/2023-bmw-i5-m60-207fd872d28b4cafa7fefe061ae98e26) by Nazh Design. It is published under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Attribution is kept visible beside the viewer. This is a community-created model, not an official BMW asset or endorsement.

The viewer embeds Sketchfab's public viewer through its [documented JavaScript API](https://sketchfab.com/developers/viewer/functions). It requires network access to `static.sketchfab.com` and Sketchfab's hosting; no model file is bundled, downloaded, or rehosted here. Sketchfab's authenticated download API is not used. `getNodeMap` is read at runtime and normalized from its documented flattened node array, with object-map support for API payload variants. A click maps only when a node's exact normalized name matches an entry in `modelMapping.ts`; this is selection wiring, not verified physical heatmap mapping. No component feedback is painted onto model surfaces. Heat colors appear only in the HTML component list and the separate cabin photo markers. Camera controls call the documented `getCameraLookAt`/`setCameraLookAt` API; resets and camera moves honor reduced-motion preference. If embedding fails, a locally served preview remains visible and a retry control is available.

`/vehicles/i5-m60-preview.jpg` is the source model's public preview image. Keep its accompanying asset provenance with the primary app assets.

## Cabin reference

The source i5 M60 model has no verified cabin geometry. The interior view therefore uses a separate authentic [BMW 520i G60 cabin photograph](https://commons.wikimedia.org/wiki/File:BMW_520i_G60_Oxide_Grey_Metallic_03.jpg), photographed by Ethan Llamas and licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The UI names it as a G60 520i cabin reference, credits the photographer and license, and identifies the fitted photo and feedback markers as a synthetic overlay. It must not be described as an i5 M60 interior or an interactive 3D cabin.

`/vehicles/g60-interior.jpg` is the locally served photo copy. Preserve the Wikimedia attribution and license links if the image is moved or replaced.

## Limits

Feedback counts and severity colors come from the app's supplied findings and period. They are illustrative product data, not measurements inferred from the model or photograph. Exterior hotspots are not pinned onto the rotating model. No mapped-body heat or per-part model recoloring is claimed. No CDN textures, HDR files, or generated geometry are used.
