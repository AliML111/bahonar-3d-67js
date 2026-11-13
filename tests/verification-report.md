# Verification Report — 3D Shahid Bahonar Port Digital Twin Reconstruction

## Summary
- **Test Suite Status:** All verification suites pass via `node --test` (**17/17 tests passing** across 4 suites, 0 failures, 0 skipped, run duration: 21.4s).
- **Binary glTF Asset:** Full glTF 2.0 binary asset generated via `67js` `exportGlb` (**3,502 parts, 31,059,488 bytes**).
- **Web Application Build:** Interactive WebGL2 application build (`npm.cmd run build` via Vite) completed in 2.41s.
- **Headless Chrome E2E:** Verified via `playwright-core` with WebGL2 at `1280x720` (**0 console errors, 0 page errors, 0 failed network requests, 0 renderer diagnostics**).
- **GeoDatabase Registry:** Persistent SQLite database (`data/geodb/port-geodb.sqlite`, 1.25 MB) and spatial JSON registries storing 306 spatial grid units, 250 ground vehicles, 128 vessel berths, 1,497 buildings, 380 date palms, 56 dhow mooring slots, and shipyard drydocks.
- **Real-World Google Earth Calibration:** Satellite-aligned visual calibration covering 250 ground vehicles, 87 active vessels across all quays, dense rafted dhows, drydocks, slipway, Sahand Coastal Park date palms, and industrial compounds.

---

## 1. Geospatial Data Validation (`tests/geospatial.test.js`)
Validated `data/geo/bahonar-port-metric.json`, `data/geo/bahonar-osm-raw.json`, `scripts/fetch-osm.mjs`, and `data/geo/ATTRIBUTION.md`:
- **Result:** `5/5` tests passed.
- **Origin & Projection:** `27.13991208° N, 56.20372122° E` (Shahid Bahonar Port, Bandar Abbas, Iran), local tangent plane metric coordinates (`+X` East, `+Y` Up, `+Z` South / `-Z` North).
- **Metric Scene Bounds:** `X [-1863.62, 1665.12]` (`3528.74 m`), `Z [-1950, 1650]` (`3600 m`).
- **Validated Non-Empty Grounded Collections:**
  - `coastlines`: `1` (`338` vertices, `way 157394001`)
  - `landPolygons`: `1`
  - `waterFeatures`: `harborWaterPolygon` (`6,715,253.88 m²`) + `3` docks + `5` harbor basins
  - `breakwaters`: `3` (West outer `926.8 m`, West inner spur `425.4 m`, East outer `835.0 m`)
  - `quaysAndPiers`: `27` (`26` piers + `1` slipway)
  - `quayWalls`: `56` straight inner wall segments (`>= 30 m`) with unit `waterNormalXZ`
  - `buildings`: `1,497` total (`368` `core_port` incl. `25` warehouses, `1` ferry terminal, `1` oil depot office, `15` storage tanks; `1,129` `surrounding`)
  - `roads`: `196` (trunk `بلوار پاسداران`, tertiary, service, residential, footways)
  - `yardsAndLanduse`: `60` (oil depot, industrial, parks, recreation)
  - `landmarksAndSeamarks`: `12` (`4` US NGA entrance navigation lights with verified heights and colors)
- **Attribution & Grounding:** `data/geo/ATTRIBUTION.md` documents OpenStreetMap (`ODbL 1.0`), origin, bounding boxes, and clearly differentiates geospatially grounded OSM features from visually approximated equipment and maritime traffic.

---

## 2. GeoDatabase & Spatial Asset Registry (`tests/geospatial.test.js`)
Validated `data/geodb/port-geodb.sqlite` and specialized spatial registries:
- **Result:** `7/7` tests passed.
- **SQLite Database:** Native `DatabaseSync` (`data/geodb/port-geodb.sqlite`, `1.25 MB`) with 8 indexed tables:
  - `metadata`: Schema metadata and generation timestamp.
  - `features`: 42 primary port features.
  - `vegetation_palms`: 380 records across 4 zones.
  - `dhow_berths`: 56 records across 3 clusters and 2 tiers.
  - `building_registry`: 1,497 records with oriented bounding boxes and heights.
  - `spatial_grid_cells`: 306 square unit cells with WGS84/metric bounds, domains, and feature counts.
  - `ground_vehicles`: 250 vehicles across 6 operational sectors.
  - `vessel_berths`: 128 vessel berths and active craft across all quays and basins.
- **Spatial Grid System (`data/geodb/spatial-grid.json`):**
  - 306 200m x 200m square units covering full port & approach bbox (`X [-1800, 1600]`, `Z [-1900, 1700]`).
  - Valid metric and WGS84 bounding boxes, domain classifications, feature counts (`totalIndexedFeatures: 2,844`), and host-calibrated `visualNotesGoogleEarth`.
- **Ground Vehicles Registry (`data/geodb/ground-vehicles.json`):**
  - 250 realistic ground vehicles across 6 sectors:
    - `customs_gate_queue`: 38 container semi-trailer trucks staged at Port Bahonar customs entrance & weighbridges.
    - `container_yard_tractors`: 32 terminal spotters, 40ft yard chassis, and 45t reach stackers.
    - `ferry_terminal_parking`: 72 vehicles (40 white sedans, 16 blue sedans, 16 Iranian yellow taxis / passenger vans).
    - `quay_apron_vehicles`: 28 security pickups & maintenance flatbeds (14 West Quay, 14 South Quay).
    - `shipyard_maintenance`: 22 workshop utility trucks & repair vans.
    - `pasdaran_traffic`: 58 vehicles along Boulevard Pasdaran (18 freight trucks, 8 transit buses, 32 sedans/pickups).
- **Vessel Berths Registry (`data/geodb/vessel-berths.json`):**
  - 128 total craft (88 afloat vessels + 40 dry-staged boatyard skiffs) spanning West Quay container berths 1-2, North Quay cargo berths 1-3, South Quay dhow basin, ferry terminal pontoons, east basin tugs, north lagoon patrol craft, shipyard drydocks/slipway, and approach fairway tanker.
- **Vegetation Palms (`data/geodb/vegetation-palms.json`):** 380 native Persian Gulf date palms across 4 grounded zones (`sahand_coastal_park`, `boulevard_pasdaran`, `port_entrance_plaza`, `coastal_beach_buffer`).
- **Dhow Mooring Slots (`data/geodb/dhow-berths.json`):** 56 berths along South Quay with 3 clusters and 2 tiers.
- **Shipyard & Maintenance Registry (`data/geodb/shipyard-features.json`):** Drydocks 1 & 2, marine railway slipway, machine workshops, and crane barge.
- **Expanded Real-World Buildings (`data/geodb/expanded-buildings.json`):** 368 `core_port` buildings + top surrounding logistics compounds.

---

## 3. 67js.scene Recipe & MCP Budget Validation (`tests/scene-recipe.test.js`)
Validated against `67js/addons/agent-scene` (`createAgentScene`, `loadAgentSceneModules`, `inspect({ includeBounds: true })`, and `AGENT_SCENE_DEFAULT_LIMITS`):
- **Result:** `3/3` tests passed.

| Recipe | Compact JSON Bytes (<= 1,048,576) | Geometries (<= 256) | Materials (<= 256) | Distinct Patterns (<= 16) | Expanded Nodes (<= 4,096) | Vertices (<= 250,000) | Geometry Bytes (<= 33,554,432) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `data/scene/stage-a-foundation.json` | 69,162 | 56 | 24 | 4 | 201 | 50,370 | 1,813,320 |
| `data/scene/stage-b-infrastructure.json` | 721,500 | 98 | 59 | 6 | 3,499 | 43,514 | 1,566,504 |
| `data/scene/final-recipe.json` | 789,508 | 154 | 83 | 10 | 3,700 | 93,884 | 3,379,824 |

- **Referential, Schema & Spatial Coherence:**
  - Zero duplicate IDs, zero missing parents, zero dangling geometry/material references.
  - `instances: { ..., realize: true }` utilized for high-density palm scatter, gazebos, and 250 ground vehicles to stay strictly under the 4,096 node budget (3,700 total nodes).
  - Water material satisfies `tag: "water"`, `waterPreset: "sea"`, `opacity: 0.85`, `alphaMode: "blend"`.
  - Persian Gulf optical bathymetry gradient: deep seabed `Y = -14.0 m`, dredged approach channel `Y = -12.5 m`, cargo basin terraces `Y = -9.2 m / -5.5 m`, emerald shoals `Y = -2.3 m`, sea surface `Y = 0 m`.
  - Reclaimed port apron sits at `Y = 2.40 m`, breakwaters rise to `Y = 4.3..5.2 m` with seaward wave-wall parapets and inward T-shaped service jetty.
  - All 87 active vessels sit properly grounded in water (`minY <= 0.5`, `maxY > 1.0`).
  - All 250 vehicles sit grounded on pavement (`Y = 2.40..2.45 m`).

---

## 4. Web App Build, Syntax & Headless Chrome E2E (`tests/app-e2e.test.mjs`)
- **Result:** `2/2` tests passed.
- **Syntax & Build:** `node --check` / `node --input-type=module --check` passed across all `src/**/*.js` and `scripts/*.mjs` files; `vite build` completed cleanly in `2.41s` producing `dist/index.html`.
- **Headless Chrome Verification (`playwright-core` + WebGL2 at `1280x720` via `vite preview`):**
  - **Diagnostics & Errors:** `0` console errors, `0` page errors, `0` failed network requests, `0` `Renderer67` diagnostics.
  - **Telemetry:** Verified `3,700` nodes / `3,502` parts / `93,884` vertices rendered in WebGL2 canvas.
  - **Atmospheric Lighting:** Verified `#btn-lighting-mode` toggles `daylight` <-> `sunset`.
  - **Layer Toggles:** Verified all 10 top-level layer groups (`layer-sea`, `layer-land`, `layer-breakwaters`, `layer-quays`, `layer-vegetation`, `layer-buildings`, `layer-roads-yards`, `layer-equipment`, `layer-vehicles`, `layer-vessels`).

---

## 5. Visual Calibration Views (`scripts/capture-views.mjs`)
Captured all 13 high-resolution verification views in `screenshots/`:
1. `screenshots/app-overview.png`: Shahid Bahonar Port Full Harbor Overview (Daylight).
2. `screenshots/app-sunset.png`: Sunset Horizon & Approach Channel.
3. `screenshots/audit-feeder-berth.png`: Feeder Container Ship & STS Gantry Cranes (West Quay).
4. `screenshots/audit-cargo-cranes.png`: General Cargo Coaster, Berth Edge & Cranes.
5. `screenshots/audit-ferry-oil.png`: Hormozgan Ferries, Terminal & Oil Tank Farm.
6. `screenshots/audit-smallboat-dhow-tug.png`: Persian Gulf Wooden Cargo Dhows & Service Berths.
7. `screenshots/audit-warehouses-roads.png`: Central Cargo Sheds, Port Roads & Apron Junction.
8. `screenshots/audit-entrance-breakwater.png`: Harbor Entrance Breakwaters, Channel & Inbound Tanker.
9. `screenshots/audit-satellite-topdown.png`: Top-Down Aerial Satellite Calibration View.
10. `screenshots/audit-shipyard-drydocks.png`: Shipyard Maintenance Basin, Drydock Caissons & Slipway.
11. `screenshots/audit-sahand-park-palms.png`: Sahand Coastal Park Date Palms, Beach & Gazebos.
12. `screenshots/audit-vehicles-gate.png`: Customs Gate Semi-Truck Queue & Ferry Terminal Parking Cars.
13. `screenshots/audit-all-berths-vessels.png`: Broad Basin View Showing Active Vessels Across All Quays.

---

## 6. Binary glTF 2.0 Export (`scripts/export-glb.mjs`)
- **Output Asset:** [assets/glb/shahid-bahonar-port.glb](file:///c:/Users/gamea/OneDrive/Documents/bahonar-3d/assets/glb/shahid-bahonar-port.glb)
- **File Size:** `31,059,488` bytes (~`29.6 MiB`)
- **Parts Exported:** `3,502` parts
- **Header Verification:** Magic `glTF`, Version `2`
- **Matrix Orthogonality:** Clean rotation transforms without non-Y rotation under non-uniform scale, ensuring zero shear warnings during export.

---

## 7. Incremental MCP Batch Replay (`scripts/export-mcp-batches.mjs`)
- **Outputs:**
  - `data/scene/mcp-seed.json`: `73,795` bytes (Stage A foundation + `layer-equipment` + container stacks + palms + ground vehicle realized instances).
  - `data/scene/mcp-batches.json`: `831,683` bytes (`19` batches, `maxBatchOps <= 180`).
- **Replay Verification:** Verified `19` sequential atomic `scene.apply()` revisions in Node; final active counts match `data/scene/final-recipe.json` identically (`3,700` nodes, `3,502` parts, `154` geometries, `83` materials, `93,884` vertices).
