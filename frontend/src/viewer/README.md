# Vehicle viewer

The baseline viewer belongs to the single workspace in [frontend_plan.md](../../../frontend_plan.md). The published catalog is [scene-catalog-v1.json](../../public/vehicles/scene-catalog-v1.json); it identifies the matching vehicle/asset, stable part IDs, parent relationships, explicit verified mesh references (currently empty) and reference-photo anchors.

Feedback counts and negative-volume intensity are supplied by the application adapter. The viewer does not calculate customer counts, negative shares or scores. HTML part controls provide the keyboard path for the same selected finding.

Exterior: attributed hosted i5 M60 model, local preview fallback and camera controls. Interior: separately attributed G60 520i reference photograph. Exterior surface anchors and mesh recoloring are unverified; no generated geometry is claimed. See [provenance](README-bmw.md) for licenses and limitations.


F2 mapping gate: `scene-catalog-v1.json` publishes `contract_version` and `part_catalog_version`, validated parent references and explicit `mesh_refs`/`anchor_ref`. Current mesh references are empty; no candidate/normalized-name aliases are accepted. List navigation and separately labeled reference-photo annotations provide fallback. Multiple cohort aggregates are displayed independently with cohort labels; ambiguous scopes use neutral heat coloring rather than selecting the first scope. Image failures keep component controls available and expose explicit retry with focus recovery.
