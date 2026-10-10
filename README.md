# Dither Quest

An image instrument for dithering, pixel processing, layered print effects and
full-resolution exports. Upload, drop or paste a PNG, JPEG or WebP, then compose
an ordered processor stack. Keep stage/parameter locks, explore the existing
randomization tools, and print checkpoints to build on an earlier result.

## Development

Requires Node 24 or newer. Run `npm ci`, then `npm run dev`.

The UI imports the actual private `@sheol/ui@0.2.0` package from the versioned
artifact in `vendor/`. See [provenance](vendor/README.md) and [agent instructions](AGENTS.md).
The canvas stays central; preset, processor and checkpoint tools remain available
on mobile below the workspace and stage controls.

- `npm run lint` — ESLint, including hooks rules.
- `npm run typecheck` — TypeScript.
- `npm test` — deterministic image engine and preset import checks.
- `npm run build` — production GitHub Pages build at `/dither-quest/`.
- `npm run build:itch` — portable static build with relative asset paths.

## Image workflows

The quality selector controls the preview. PNG, JPEG and WebP export and
Print / Commit always use the full source resolution. Copy writes the current
preview as PNG when the browser permits image clipboard access. Before / After
shows the source at its own dimensions. Fit uses the current workspace size.

Named presets are saved in this browser. Export JSON for a portable copy; the
importer accepts both named stage exports and legacy `{ pipeline, seed }` exports.
Malformed files leave the existing stack intact and show an error. A replacement
image resets the checkpoint archive and uses a fresh preview cache identity.

Cmd/Ctrl+Z undoes a stack change; Shift+Cmd/Ctrl+Z redoes. `+`, `-` and `0` control
zoom when focus is outside a field or modal. Preset naming uses Sheol's accessible
native dialog with Escape and focus return.

The existing 32 MP input limit remains. Large full-resolution processing still
runs on the main thread and may pause interaction until the calculation finishes;
preview work normally runs in a worker. If that worker fails, a later edit uses
the local renderer and exports remain available. Loading another image while a
checkpoint is encoding prevents that old checkpoint from attaching to the new
source.

## Deployment

Pushes to main run installation, lint, typecheck, tests and the production build
in `.github/workflows/pages.yml`, then deploy the resulting artifact to GitHub Pages:
https://usselman.github.io/dither-quest/
