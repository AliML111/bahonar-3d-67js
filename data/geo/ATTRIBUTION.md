# Geospatial Data Attribution & Provenance — Shahid Bahonar Port

## OpenStreetMap License & Attribution
All geospatial vector data in [`data/geo/bahonar-osm-raw.json`](./bahonar-osm-raw.json) and [`data/geo/bahonar-port-metric.json`](./bahonar-port-metric.json) is derived from **OpenStreetMap** via the Overpass API (`https://maps.mail.ru/osm/tools/overpass/api/interpreter`, OSM base timestamp `2026-11-12T15:07:51Z`) and Nominatim (`https://nominatim.openstreetmap.org/`).

- **Attribution:** © OpenStreetMap contributors
- **License:** Open Database License (**ODbL 1.0**) — [https://www.openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)
- **Additional OSM Tag Sources:**
  - Maritime navigation lights (`seamark:type=light_minor`): `US NGA Pub. 112. 2009-11-12.` (nodes `1293791566`, `1293791575`, `1293791614`, `1293791620`)
  - Storage tanks and port buildings: traced by OSM contributors from `DigitalGlobal Premium Image` and `Yahoo` aerial imagery.
- **Visual Reference Calibration:** `references/port-reference.png` (satellite view of Shahid Bahonar Port) is used strictly for material palette, water depth contrast, and visual detail calibration; all 2D footprints and coordinates remain grounded to OSM.

---

## Coordinate Reference & Bounding Box

- **Origin (`0, 0, 0` in local metric space):**
  - Latitude: `27.13991208° N`
  - Longitude: `56.20372122° E`
  - Label: Shahid Bahonar Port (`اسکله شهید باهنر`), Bandar Abbas, Hormozgan, Iran
  - Nominatim Administrative Match: Relation `8687621` (`اسکله باهنر` / `eskeleh bahonar`)
- **Local Tangent Plane Projection (WGS84 Ellipsoid at Origin):**
  - `+X` = East (meters) — `99,131.7567 m / deg lon`
  - `+Y` = Up / Elevation (meters; `Y = 0` is mean sea level)
  - `+Z` = South (meters, so `-Z` = North) — `110,805.7253 m / deg lat`
- **WGS84 Query Bounding Box:**
  - South: `27.126° N` | West: `56.186° E` | North: `27.157° N` | East: `56.220° E`
- **Metric Scene Bounds:**
  - `X`: `-1863.62 m` to `+1665.12 m` (width `3528.74 m`)
  - `Z`: `-1950.00 m` to `+1650.00 m` (depth `3600.00 m`)
  - Coastline span (`way 157394001`): `X` `-1863.62 m` to `+1665.12 m`, `Z` `-1501.54 m` to `+1254.53 m`

---

## Feature Grounding Classification

### 1. Geospatially Grounded Features (Directly from OSM)
| Category | Count | Source / OSM Tags | Notes |
| --- | ---: | --- | --- |
| Coastline | 1 | `way 157394001` (`natural=coastline`) | Continuous shoreline polyline across port (`338` vertices) |
| Land & Harbor Water Polygons | 1 + 1 | Derived directly from `way 157394001` | Closed at northern (`Z = -1950 m`) and southern (`Z = +1650 m`) scene bounds |
| Outer Breakwaters & Spur | 3 | `way 157394001` peninsula geometry | West outer (`926.8 m`), West inner spur (`425.4 m`), East outer (`835.0 m`) |
| Quays, Piers & Slipway | 27 | `man_made=pier` (26), `leisure=slipway` (1) | Includes 3 floating ferry piers, 3 SE finger piers, 3 north-slip finger piers |
| Inner Quay Wall Segments | 56 | `way 157394001` straight inner segments (`>= 30 m`) | Exact start/end positions and water-facing normals |
| Docks & Water Reservoirs | 3 | `waterway=dock` (`dock=drydock`, 2), `natural=water` (1) | Exact footprints in East basin & Oil Depot |
| Buildings, Warehouses & Tanks | 1,497 | `building=*`, `man_made=storage_tank` | `368` in `core_port` (incl. `25` warehouses `>= 2500 m²`, `1` ferry terminal, `1` oil depot office, `15` fuel storage tanks), `1,129` in `surrounding` neighborhoods |
| Road Network | 196 | `highway=trunk|tertiary|service|residential|footway|track` | Includes `بلوار پاسداران` (Road 96) and `میدان شهید باهنر` roundabout |
| Yards, Landuse & Vegetation | 60 | `landuse=*`, `leisure=*`, `natural=scrub` | Includes `انبار نفت شهید باهنر` oil depot, naval base area, parks, scrub |
| Navigation Seamarks & Landmarks | 12 | `seamark:type=light_minor` (4), `man_made=tower` (1), `amenity`, `place`, named buildings | Exact red/green entrance light coordinates & heights (`3 m` / `6 m`) |

### 2. Visually Approximated Features (Synthesized in 3D)
These features are **not** explicitly mapped with 3D geometry in OpenStreetMap (`osmMappedCranes = 0`) and are procedurally approximated in 3D for realism and scale, guided by `references/port-reference.png` and standard port engineering proportions:
- **Terrain Elevation & Bathymetry:** Coastal terrain grade, harbor basin depth contours (shallow turquoise forebay vs deeper dredged shipping channel), and breakwater rock-armor slope/crest height (`~2.5–3.5 m` above sea level).
- **Quay Engineering Details:** Quay cap height above water (`~2.2 m`), rubber fenders, mooring bollards, and berth safety markings along the grounded quay walls.
- **Building Heights & Roof Styles:** Estimated from OSM footprints, `building:levels`, and `roof:shape` where tagged (`10–12 m` for warehouses/tanks, `4.5–7.5 m` for sheds/support buildings).
- **Port Handling Equipment:** Rail-mounted gantry cranes, mobile harbor cranes, reach-stackers, shipping container stacks, and high-mast floodlight towers placed on grounded cargo aprons/quays.
- **Vessels:** Civilian cargo ships, feeder container vessels, tugboats, and pilot boats positioned along grounded berths and the approach channel.
- **Unmapped Surface Zones:** Paved port aprons, container staging yards, and the SE coastal beach/park continuation (`بوستان ساحلی سهند`) where OSM lacks explicit `landuse=port` polygons.
