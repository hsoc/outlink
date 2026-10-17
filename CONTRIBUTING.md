# Contributing to Outlink

Outlink is a mobile-only Bitchat messenger. Read AGENTS.md, docs/DESIGN.md, and
https://docs.expo.dev/versions/v57.0.0/ before changing UI or native configuration.

Install Node.js 24 and dependencies with `npm ci`. Run `npm test`,
`npx tsc --noEmit`, `npm run lint`, `npm run check:mobile`, and
`npm run licenses:check`. Export both platforms with `npm run export:mobile`.
A native development build is required for BLE and foreground location tests.

Keep core services platform-free and use `src/platform` ports for OS access.
Preserve the MIT license and original third-party notices. Run
`npm run licenses:refresh` after dependency changes; this fetches integrity-checked
archives and retains original notice text. Review generated mobile notices.

Protocol code is independently implemented from wire specifications. Do not
copy upstream Bitchat source into this MIT repository. Keep tests for signatures,
malformed inputs, stale callbacks, bounded queues, timer/connection cleanup,
and cross-device compatibility assumptions.
