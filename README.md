# Shahid Bahonar Port — 3D Reconstruction (`67js`)

Interactive 3D reconstruction of **Shahid Bahonar Port** (Bandar Abbas, Iran — centered near `27.1399° N, 56.2037° E`) powered by [`67js`](https://github.com/codepawl/67.js) (`@codepawlhq/67js`) and constructed incrementally via the `67js-scene` MCP server.

## Quick Start

```bash
npm install
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/` in a WebGL2-capable browser, or run the development server with `npm run dev`.

## Controls

- **Orbit mode (`M` toggle)**: Left-drag orbit, Right-drag / Shift-drag pan, Scroll zoom
- **Free-fly mode (`M` toggle)**: `WASD` horizontal movement, `Q`/`E` descend/ascend, `Shift` boost
- **Camera presets (`1`–`4`)**: Harbor Overview, Top-Down Aerial, Quay & Cargo Slip, Breakwater & Approach
- **Lighting (`L` toggle)**: Daylight / Sunset
- **Layer visibility**: Right-side layer panel toggles geospatial vs. approximated feature groups

## Verification & Exports

- **Tests**: `node --test` (runs `tests/geospatial.test.js`, `tests/scene-recipe.test.js`, and headless Chrome WebGL2 E2E in `tests/app-e2e.test.mjs`)
- **Scene recipes**: `data/scene/final-recipe.json` (app bundle) and `data/scene/mcp-exported-recipe.json` (exported from the live `67js-scene` MCP session)
- **GLB asset**: `node scripts/export-glb.mjs` exports `assets/glb/shahid-bahonar-port.glb` via `67js` `exportGlb`
- **Attribution**: See `data/geo/ATTRIBUTION.md` for OpenStreetMap (`ODbL-1.0`) sourcing and grounded vs. approximated feature classification
