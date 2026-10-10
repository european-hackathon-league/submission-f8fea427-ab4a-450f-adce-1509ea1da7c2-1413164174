# BMW asset viewer provenance

## Exterior model

The interactive exterior loads the creator-uploaded Sketchfab model [2023 BMW i5 M60](https://sketchfab.com/3d-models/2023-bmw-i5-m60-207fd872d28b4cafa7fefe061ae98e26) by Nazh Design. It is published under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Attribution is kept visible beside the viewer. This is a community-created model, not an official BMW asset or endorsement.

The viewer embeds Sketchfab's public viewer through its documented JavaScript API. It requires network access to `static.sketchfab.com` and Sketchfab's hosting; no model file is bundled, downloaded, or rehosted here. Sketchfab's authenticated download API is not used. Node names are inspected through the Viewer API; only exact names recognized by `modelMapping.ts` can map an actual model click to a feedback component. Heat values remain in the accessible HTML component list because the source model has shared materials and cannot safely show component-level recoloring. If embedding fails, a locally served preview remains visible.

`/vehicles/i5-m60-preview.jpg` is the source model's public preview image. Keep its accompanying asset provenance with the primary app assets.

## Cabin reference

The source i5 M60 model has no verified cabin geometry. The interior view therefore uses a separate authentic [BMW 520i G60 cabin photograph](https://commons.wikimedia.org/wiki/File:BMW_520i_G60_Oxide_Grey_Metallic_03.jpg), photographed by Ethan Llamas and licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The UI names it as a G60 520i cabin reference, credits the photographer and license, and identifies the crop and feedback markers as a synthetic overlay. It must not be described as an i5 M60 interior or an interactive 3D cabin.

`/vehicles/g60-interior.jpg` is the locally served photo copy. Preserve the Wikimedia attribution and license links if the image is moved or replaced.

## Limits

Feedback counts and severity colors come from the app's supplied findings and period. They are illustrative product data, not measurements inferred from the model or photograph. Exterior hotspots are not pinned onto the rotating model; click mapping is enabled only when source node names match the component map. No CDN textures, HDR files, or generated geometry are used.
