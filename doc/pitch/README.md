# BMW pitch deck

The current presentation follows the supplied 11-slide PDF and incorporates the requested content and layout revisions.

- [Animated presentation](../../output/pptx/FWD_BMW_Pitch_G60_Animated_v1.pptx)
- [Standalone opening film](../../output/video/FWD_BMW_1Series_Intro.mp4)
- [Original 11-slide reference](FWD_BMW_Pitch_Clean.pdf)
- [Presentation and motion sources](../../scripts/pitch-deck)

![Current cover](cover-preview.png)

## Presentation changes

The challenge slide now focuses on checking feedback against study, equipment, and market evidence. The solution and G60 feedback slides use simpler layouts, and the product screenshot excludes its recommendation sidebar. The pipeline describes ingestion, normalization, analysis, proposals, and PM review, including optional Deep Dive and Reimagine stages. Sources and qualifications remain in speaker notes.

The cover uses the original 2560 × 1440 BMW 1 Series viewer image rather than a page screenshot. The large “1 SERIES” label sits behind the car, with the pitch title aligned on the left. The five-second, silent H.264 opening film uses the repository’s 36 vehicle angles at 1920 × 1080 and 30 fps. It rotates once, holds the cover for two seconds, and starts automatically in PowerPoint Slide Show mode.

The video sits above the editable cover layers. To edit the static cover directly in PowerPoint, remove the video object; to change text inside the film, edit `cover_scene.mjs` and rebuild it. Static previews show the cover poster. Playback was checked in Microsoft PowerPoint for macOS; other presentation viewers may display only the poster.

## Evidence and assets

The presentation uses these repository materials:

- `doc/googledrive/G60_feedback_hackathon.xlsx`
- `doc/googledrive/F70_G60_G68_G70_customer_studies.xlsx`
- `doc/googledrive/G60_OptionList.PDF`
- `doc/more.md`, `plan.md`, and `backend_plan.md`
- `backend/app/workflows.py` and `backend/TESTING_HANDOFF.md`
- `doc/frontend/MODEL-COVERAGE.md`

The G60 option list is not a validated US equipment baseline. The product interface screenshot contains prototype fixture content. Those distinctions are retained in the relevant notes; proposed design changes are not presented as validated customer solutions.

Cover angles come from `frontend/public/images/bmw/exterior/31GE/00.webp` through `35.webp`; they are representative viewer imagery, without a claim about trim equipment or BMW approval. The cropped product interface image is saved in `assets/workshop-ui-viewer.jpg`.

## Rebuild

Use the Codex bundled Node runtime, `@oai/artifact-tool`, Python runtime, and presentation skill returned by `load_workspace_dependencies`. Set `RUNTIME_NODE`, `RUNTIME_NODE_MODULES`, `RUNTIME_PYTHON`, and `PRESENTATIONS_SKILL_DIR` to those returned paths. A Python environment with the packages in `scripts/pitch-deck/requirements.txt` also supports the image and video stages. Keep additional dependencies in a local environment, outside the bundled runtime.

From the repository root, link the artifact packages beside the source modules:

```sh
ln -s "$RUNTIME_NODE_MODULES" scripts/pitch-deck/node_modules
```

Skip that command if the link already exists. Generate source-resolution image layers, the editable deck, and the film:

```sh
"$RUNTIME_PYTHON" scripts/pitch-deck/motion/prepare_assets.py
"$RUNTIME_NODE" scripts/pitch-deck/build_deck.mjs
"$RUNTIME_NODE" scripts/pitch-deck/motion/render_angles.mjs
"$RUNTIME_PYTHON" scripts/pitch-deck/motion/encode_intro.py
"$RUNTIME_PYTHON" scripts/pitch-deck/motion/review_intro.py
"$RUNTIME_PYTHON" scripts/pitch-deck/motion/embed_video.py
"$RUNTIME_NODE" scripts/pitch-deck/finalize_deck.mjs output/pptx/FWD_BMW_Pitch_G60_Animated_v2.pptx
"$RUNTIME_NODE" scripts/pitch-deck/render_final.mjs output/pptx/FWD_BMW_Pitch_G60_Animated_v2.pptx
```

Choose a new output filename for each revision; the finalizer refuses to overwrite a delivered deck. Edit `scripts/pitch-deck/motion/timeline.json` for timing. The native PowerPoint autoplay template is in `motion/autoplay-timing.xml`; the embed step binds its targets to the generated movie object.

The finalizer checks all 11 slides, package relationships, geometry, Calibri usage, and artifact-tool import. Rendered slides, video beat sheets, dependency caches, and validation records stay in the ignored `.codex/presentation-build` directory. Inspect the current rendered cover and motion sheet, then check slideshow autoplay in PowerPoint before delivering a new revision.

## Earlier revisions

The prior `Updated`, `Refined`, and `CoverUpdate` presentations remain in `output/pptx` for comparison. `Animated_v1` is the current version.
