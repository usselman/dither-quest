# Dither Quest

Read `node_modules/@sheol/ui/docs/style-guide.md`, `usage.md`, and `integration.md`
before UI changes. Use the actual `@sheol/ui` public React exports and scoped CSS,
with the package's shared tokens. This app pins the unmodified private Sheol 0.2.0
package from commit `371d22443abe4393bd2be1a4521a267692688749`; provenance is in
`vendor/README.md`. Do not copy or recreate library components.

Keep image processing, presets, randomness, stage ordering/locks, undo/redo,
checkpoints and full-resolution exports in this consumer. The artwork workspace
is central. All tools must remain accessible on narrow screens. Preserve native
labels, visible focus, status feedback and the library's dialog behavior.

Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and
`npm run build:itch`. Validate real browser image/import/export interactions and
responsive layout. Default builds use `/dither-quest/`; itch builds use `./`.
GitHub Pages publishes main through `.github/workflows/pages.yml`.
