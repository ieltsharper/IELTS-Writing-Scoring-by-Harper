# Decisions

Defaults chosen where the spec was ambiguous, and every substitution, with the reason.

## Tooling

- **Single npm package at the repo root.** The front end, Apps Script back end, mock API and tests share one
  `package.json` so shared pure logic in `shared/` is imported by both sides without publishing anything.
- **Back end written in TypeScript and bundled with esbuild.** Apps Script has no module system, so
  `apps-script/build.mjs` bundles `apps-script/src/gas.ts` into one `dist/Code.js` (IIFE) and appends the
  top-level functions Apps Script needs (`doPost`, `doGet`, `setup`, `installTriggers`, `dailyJob`,
  `hourlyJob`). `clasp` pushes `apps-script/dist` (`rootDir: dist`).
- **`.clasp.json` is not committed** (it holds the admin's script ID); `.clasp.json.example` is.
- **Front-end config** is `VITE_API_URL` in `.env.production`. The web app URL is public by design.
- **Hash routing** (`#/essays/…`) so GitHub Pages needs no 404 rewrite tricks, and `base: './'` so the build works
  under `/<repo>/`.
