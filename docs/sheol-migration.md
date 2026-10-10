# Sheol migration validation

The migration starts from Dither Quest `90d43d32313d11719f08bcdf8c7c89f9f8913c06`
and adopts the unchanged private Sheol package documented in `vendor/README.md`.
The image processors, preset catalogue and randomness behavior remain in the app.

The app uses real Sheol Button, TextField, Panel, Badge and Dialog imports, plus
its documented native select, switch and range CSS primitives. Consumer CSS owns
page composition. The 1px rules, square corners and orange/blue/yellow/white/black
palette follow the packed style and integration guides.

Local checks on the user's Mac: clean dependency installation, lint, typecheck,
16 unit tests, Pages build and relative-path itch build. A full dependency audit
reports zero vulnerabilities after compatible build/test dependency updates.

Chrome browser QA covers desktop 1440px, tablet 768px and mobile 390px layouts;
image upload/replace, source comparison, locked randomization, preset search and
replace/append, stage edit/order/duplicate/delete, keyboard undo/redo, modal focus
containment/Escape/focus return, local preset save, JSON export/import and invalid
file retry, PNG/JPEG/WebP export, print/root checkpoint selection and deletion,
and rapid repeated actions. Separate failure checks cover clipboard permissions,
source replacement during checkpoint encoding, out-of-order image decoding,
slider interruption, worker failure/recovery, drag/drop, clipboard paste and all
built-in presets. Test fixtures are synthetic images, not user image files.

Screenshots, machine-readable results, exported sample files and QA scripts are
kept in the task workspace's `evidence/` directory. Run the same browser suite
against the production build and the deployed Pages URL before sign-off. Remote
CI and live validation are verified separately from local checks.

Limits: this is Chrome QA, not Safari/Firefox validation or a manual screen-reader
audit. The existing 32 MP limit is retained; full-resolution processing remains
synchronous on the main thread. Clipboard support/permission varies by browser.
