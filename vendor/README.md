# Sheol package provenance

`sheol-ui-0.2.0.tgz` is the actual private `@sheol/ui` package, built without
source modifications from https://github.com/usselman/sheol at commit
`371d22443abe4393bd2be1a4521a267692688749`.

SHA-256: `e4338988c53700154bb88bc77ed99d29dbcdf98f9c7789ea117d3d4bab7dd9a6`

Produced with `npm ci`, `npm run check`, `npm test` (6 passing tests), and
`npm pack`. The package contains compiled ESM, declarations, scoped CSS and
its design/usage/integration guides. It has React/react-dom `^19.2.0` peers.
It is deliberately not published to the npm registry.

Install through the root lockfile with `npm ci`. For an upgrade, follow the
library's integration guide, verify the new source, replace this versioned
tarball, reinstall it and update this provenance. Keep the tarball in the
consumer repository so deployment builds need no second repository credential.
