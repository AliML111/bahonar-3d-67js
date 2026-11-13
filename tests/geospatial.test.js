'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const METRIC_PATH = path.join(ROOT, 'data/geo/bahonar-port-metric.json');
const RAW_PATH = path.join(ROOT, 'data/geo/bahonar-osm-raw.json');
const ATTRIBUTION_PATH = path.join(ROOT, 'data/geo/ATTRIBUTION.md');
const FETCH_SCRIPT_PATH = path.join(ROOT, 'scripts/fetch-osm.mjs');

function assertFiniteNumber(val, label) {
  assert.equal(typeof val, 'number', `${label} must be a number`);
  assert.ok(Number.isFinite(val), `${label} must be finite (got ${val})`);
}

function assertPointXZ(pt, label, bounds) {
  assert.ok(Array.isArray(pt) && pt.length === 2, `${label} must be a [x, z] pair`);
  assertFiniteNumber(pt[0], `${label}[0]`);
  assertFiniteNumber(pt[1], `${label}[1]`);
  if (bounds) {
    const eps = 50; // small tolerance for rounding / endpoint extension
    assert.ok(
      pt[0] >= bounds.minX - eps && pt[0] <= bounds.maxX + eps,
      `${label} X=${pt[0]} out of metricScene bounds [${bounds.minX}, ${bounds.maxX}]`
    );
    assert.ok(
      pt[1] >= bounds.minZ - eps && pt[1] <= bounds.maxZ + eps,
      `${label} Z=${pt[1]} out of metricScene bounds [${bounds.minZ}, ${bounds.maxZ}]`
    );
  }
}

function assertValidBounds(b, label) {
  assert.ok(b && typeof b === 'object', `${label} must be an object`);
  assertFiniteNumber(b.minX, `${label}.minX`);
  assertFiniteNumber(b.maxX, `${label}.maxX`);
  assertFiniteNumber(b.minZ, `${label}.minZ`);
  assertFiniteNumber(b.maxZ, `${label}.maxZ`);
  assert.ok(b.minX <= b.maxX, `${label} minX (${b.minX}) > maxX (${b.maxX})`);
  assert.ok(b.minZ <= b.maxZ, `${label} minZ (${b.minZ}) > maxZ (${b.maxZ})`);
}

describe('Geospatial Deliverables (data/geo)', () => {
  const metric = JSON.parse(fs.readFileSync(METRIC_PATH, 'utf8'));

  it('has required raw, attribution, and fetch script files', () => {
    assert.ok(fs.existsSync(RAW_PATH), 'data/geo/bahonar-osm-raw.json must exist');
    const rawStat = fs.statSync(RAW_PATH);
    assert.ok(rawStat.size > 1000, 'bahonar-osm-raw.json must be non-trivial');
    const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
    assert.ok(Array.isArray(raw.elements) && raw.elements.length > 100, 'raw OSM elements must be populated');

    assert.ok(fs.existsSync(FETCH_SCRIPT_PATH), 'scripts/fetch-osm.mjs must exist');
    assert.ok(fs.existsSync(ATTRIBUTION_PATH), 'data/geo/ATTRIBUTION.md must exist');
  });

  it('documents ODbL attribution, origin, bbox, and grounded vs approximated features in ATTRIBUTION.md', () => {
    const md = fs.readFileSync(ATTRIBUTION_PATH, 'utf8');
    assert.match(md, /OpenStreetMap/i, 'ATTRIBUTION.md must credit OpenStreetMap');
    assert.match(md, /ODbL/i, 'ATTRIBUTION.md must reference ODbL');
    assert.match(md, /27\.1399/, 'ATTRIBUTION.md must document origin latitude');
    assert.match(md, /56\.2037/, 'ATTRIBUTION.md must document origin longitude');
    assert.match(md, /Grounded/i, 'ATTRIBUTION.md must distinguish grounded features');
    assert.match(md, /Approximated/i, 'ATTRIBUTION.md must distinguish approximated features');
  });

  it('has valid origin, source metadata, and WGS84/metric bounding boxes', () => {
    assert.equal(metric.schema, 'bahonar-port-metric/1.0');
    assert.ok(metric.source && /OpenStreetMap/i.test(metric.source.name));
    assert.ok(/ODbL/i.test(metric.source.license));

    assert.ok(metric.origin, 'origin is required');
    assertFiniteNumber(metric.origin.lat, 'origin.lat');
    assertFiniteNumber(metric.origin.lon, 'origin.lon');
    assert.ok(metric.origin.lat > 27.0 && metric.origin.lat < 27.3, 'origin.lat near Shahid Bahonar Port');
    assert.ok(metric.origin.lon > 56.0 && metric.origin.lon < 56.4, 'origin.lon near Shahid Bahonar Port');

    assert.ok(metric.projection, 'projection is required');
    assertFiniteNumber(metric.projection.metersPerDegLat, 'metersPerDegLat');
    assertFiniteNumber(metric.projection.metersPerDegLon, 'metersPerDegLon');
    assert.ok(metric.projection.metersPerDegLat > 100000 && metric.projection.metersPerDegLat < 115000);
    assert.ok(metric.projection.metersPerDegLon > 90000 && metric.projection.metersPerDegLon < 105000);

    const { wgs84, metricScene, metricCoastline } = metric.bbox;
    assert.ok(wgs84.south < wgs84.north && wgs84.west < wgs84.east, 'valid WGS84 bbox');
    assertValidBounds(metricScene, 'bbox.metricScene');
    assertValidBounds(metricCoastline, 'bbox.metricCoastline');
    assert.ok(metricScene.widthM > 1500 && metricScene.depthM > 1500, 'metricScene spans port scale');
  });

  it('has non-empty coastlines, land/water polygons, breakwaters, quays, buildings, and roads matching summary counts', () => {
    const counts = metric.summary?.counts;
    assert.ok(counts, 'summary.counts is required');

    assert.ok(Array.isArray(metric.coastlines) && metric.coastlines.length > 0, 'coastlines must be non-empty');
    assert.equal(metric.coastlines.length, counts.coastlines);

    assert.ok(Array.isArray(metric.landPolygons) && metric.landPolygons.length > 0, 'landPolygons must be non-empty');
    assert.equal(metric.landPolygons.length, counts.landPolygons);

    assert.ok(metric.waterFeatures?.harborWaterPolygon, 'harborWaterPolygon must exist');
    assert.ok(Array.isArray(metric.waterFeatures.basins) && metric.waterFeatures.basins.length > 0, 'harbor basins must be non-empty');

    assert.ok(Array.isArray(metric.breakwaters) && metric.breakwaters.length >= 2, 'breakwaters must be non-empty');
    assert.equal(metric.breakwaters.length, counts.breakwaters);

    assert.ok(Array.isArray(metric.quaysAndPiers) && metric.quaysAndPiers.length > 0, 'quaysAndPiers must be non-empty');
    assert.equal(metric.quaysAndPiers.length, counts.quaysAndPiers);

    assert.ok(Array.isArray(metric.quayWalls) && metric.quayWalls.length > 0, 'quayWalls must be non-empty');
    assert.equal(metric.quayWalls.length, counts.quayWalls);

    assert.ok(Array.isArray(metric.buildings) && metric.buildings.length > 0, 'buildings must be non-empty');
    assert.equal(metric.buildings.length, counts.buildings);

    assert.ok(Array.isArray(metric.roads) && metric.roads.length > 0, 'roads must be non-empty');
    assert.equal(metric.roads.length, counts.roads);

    assert.ok(Array.isArray(metric.yardsAndLanduse) && metric.yardsAndLanduse.length > 0, 'yardsAndLanduse must be non-empty');
    assert.equal(metric.yardsAndLanduse.length, counts.yardsAndLanduse);

    assert.ok(Array.isArray(metric.landmarksAndSeamarks) && metric.landmarksAndSeamarks.length > 0, 'landmarksAndSeamarks must be non-empty');
    assert.equal(metric.landmarksAndSeamarks.length, counts.landmarksAndSeamarks);
  });

  it('has finite coordinates within scene bounds across all feature geometries', () => {
    const sceneBounds = metric.bbox.metricScene;

    for (const c of metric.coastlines) {
      assertValidBounds(c.bounds, `coastline ${c.id}`);
      assert.ok(c.pointsXZ.length >= 10, `coastline ${c.id} has enough points`);
      c.pointsXZ.forEach((pt, idx) => assertPointXZ(pt, `coastline ${c.id}[${idx}]`, sceneBounds));
    }

    for (const lp of metric.landPolygons) {
      assertValidBounds(lp.bounds, `landPolygon ${lp.id}`);
      assert.ok(lp.areaSqm > 0, `landPolygon ${lp.id} areaSqm > 0`);
      lp.polygonXZ.forEach((pt, idx) => assertPointXZ(pt, `landPolygon ${lp.id}[${idx}]`, sceneBounds));
    }

    const hw = metric.waterFeatures.harborWaterPolygon;
    assertValidBounds(hw.bounds, 'harborWaterPolygon');
    assert.ok(hw.areaSqm > 0, 'harborWaterPolygon areaSqm > 0');
    hw.polygonXZ.forEach((pt, idx) => assertPointXZ(pt, `harborWaterPolygon[${idx}]`, sceneBounds));

    for (const bw of metric.breakwaters) {
      assertValidBounds(bw.bounds, `breakwater ${bw.id}`);
      assertPointXZ(bw.rootXZ, `breakwater ${bw.id}.rootXZ`, sceneBounds);
      assertPointXZ(bw.tipXZ, `breakwater ${bw.id}.tipXZ`, sceneBounds);
      assertFiniteNumber(bw.lengthM, `breakwater ${bw.id}.lengthM`);
      assert.ok(bw.lengthM > 50, `breakwater ${bw.id} lengthM > 50`);
      bw.centerlineXZ.forEach((pt, idx) => assertPointXZ(pt, `breakwater ${bw.id}.centerlineXZ[${idx}]`, sceneBounds));
      bw.polygonXZ.forEach((pt, idx) => assertPointXZ(pt, `breakwater ${bw.id}.polygonXZ[${idx}]`, sceneBounds));
    }

    for (const qp of metric.quaysAndPiers) {
      assertValidBounds(qp.bounds, `quaysAndPiers ${qp.id}`);
      assertPointXZ(qp.centerXZ, `quaysAndPiers ${qp.id}.centerXZ`, sceneBounds);
      assertFiniteNumber(qp.lengthM, `quaysAndPiers ${qp.id}.lengthM`);
      assertFiniteNumber(qp.widthM, `quaysAndPiers ${qp.id}.widthM`);
      assert.ok(qp.lengthM > 0 && qp.widthM > 0, `quaysAndPiers ${qp.id} positive dimensions`);
    }

    for (const qw of metric.quayWalls) {
      assertPointXZ(qw.startXZ, `quayWall ${qw.id}.startXZ`, sceneBounds);
      assertPointXZ(qw.endXZ, `quayWall ${qw.id}.endXZ`, sceneBounds);
      assertPointXZ(qw.midpointXZ, `quayWall ${qw.id}.midpointXZ`, sceneBounds);
      assertPointXZ(qw.waterNormalXZ, `quayWall ${qw.id}.waterNormalXZ`);
      const nLen = Math.hypot(qw.waterNormalXZ[0], qw.waterNormalXZ[1]);
      assert.ok(Math.abs(nLen - 1) < 1e-2, `quayWall ${qw.id} waterNormalXZ is unit vector`);
      assertFiniteNumber(qw.lengthM, `quayWall ${qw.id}.lengthM`);
      assert.ok(qw.lengthM > 0, `quayWall ${qw.id} positive length`);
    }

    for (const b of metric.buildings) {
      assertValidBounds(b.bounds, `building ${b.id}`);
      assertPointXZ(b.centerXZ, `building ${b.id}.centerXZ`, sceneBounds);
      assertFiniteNumber(b.widthM, `building ${b.id}.widthM`);
      assertFiniteNumber(b.depthM, `building ${b.id}.depthM`);
      assertFiniteNumber(b.estimatedHeightM, `building ${b.id}.estimatedHeightM`);
      assert.ok(b.widthM > 0 && b.depthM > 0 && b.estimatedHeightM > 0, `building ${b.id} positive dimensions`);
      assert.ok(Array.isArray(b.footprintXZ) && b.footprintXZ.length >= 3, `building ${b.id} footprintXZ >= 3 pts`);
    }

    for (const r of metric.roads) {
      assertValidBounds(r.bounds, `road ${r.id}`);
      assertFiniteNumber(r.estimatedWidthM, `road ${r.id}.estimatedWidthM`);
      assertFiniteNumber(r.lengthM, `road ${r.id}.lengthM`);
      assert.ok(r.estimatedWidthM > 0 && r.lengthM > 0, `road ${r.id} positive dimensions`);
      assert.ok(Array.isArray(r.pointsXZ) && r.pointsXZ.length >= 2, `road ${r.id} pointsXZ >= 2 pts`);
    }

    for (const lm of metric.landmarksAndSeamarks) {
      assertPointXZ(lm.positionXZ, `landmark ${lm.id}.positionXZ`, sceneBounds);
      if (lm.kind === 'seamark:light_minor') {
        assertFiniteNumber(lm.elevationM, `landmark ${lm.id}.elevationM`);
        assert.ok(lm.elevationM > 0, `seamark ${lm.id} elevationM > 0`);
      } else if (lm.elevationM !== null && lm.elevationM !== undefined) {
        assertFiniteNumber(lm.elevationM, `landmark ${lm.id}.elevationM`);
      }
    }
  });
});

describe('GeoDatabase & Spatial Asset Registry (data/geodb)', () => {
  const GEODB_DIR = path.join(ROOT, 'data/geodb');
  const SQLITE_PATH = path.join(GEODB_DIR, 'port-geodb.sqlite');
  const PORT_FEATURES_PATH = path.join(GEODB_DIR, 'port-features.json');
  const PALMS_PATH = path.join(GEODB_DIR, 'vegetation-palms.json');
  const BERTHS_PATH = path.join(GEODB_DIR, 'dhow-berths.json');
  const SHIPYARD_PATH = path.join(GEODB_DIR, 'shipyard-features.json');
  const EXP_BLDGS_PATH = path.join(GEODB_DIR, 'expanded-buildings.json');
  const SPATIAL_GRID_PATH = path.join(GEODB_DIR, 'spatial-grid.json');
  const GROUND_VEHICLES_PATH = path.join(GEODB_DIR, 'ground-vehicles.json');
  const VESSEL_BERTHS_PATH = path.join(GEODB_DIR, 'vessel-berths.json');

  it('has SQLite database with indexed tables and populated records', () => {
    assert.ok(fs.existsSync(SQLITE_PATH), 'port-geodb.sqlite must exist');
    assert.ok(fs.statSync(SQLITE_PATH).size > 100000, 'port-geodb.sqlite must be non-trivial');

    let DatabaseSync;
    try {
      ({ DatabaseSync } = require('node:sqlite'));
    } catch {
      // If node:sqlite is unavailable on some runner, skip sqlite query
    }

    if (DatabaseSync) {
      const db = new DatabaseSync(SQLITE_PATH);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const tableNames = new Set(tables.map((t) => t.name));
      for (const req of [
        'metadata',
        'features',
        'vegetation_palms',
        'dhow_berths',
        'building_registry',
        'spatial_grid_cells',
        'ground_vehicles',
        'vessel_berths',
      ]) {
        assert.ok(tableNames.has(req), `SQLite DB missing table "${req}"`);
      }

      const palmsCount = db.prepare('SELECT count(*) as count FROM vegetation_palms').get().count;
      assert.ok(palmsCount >= 300, `vegetation_palms count (${palmsCount}) >= 300`);

      const berthsCount = db.prepare('SELECT count(*) as count FROM dhow_berths').get().count;
      assert.ok(berthsCount >= 40, `dhow_berths count (${berthsCount}) >= 40`);

      const bldgCount = db.prepare('SELECT count(*) as count FROM building_registry').get().count;
      assert.ok(bldgCount >= 1000, `building_registry count (${bldgCount}) >= 1000`);

      const gridCellsCount = db.prepare('SELECT count(*) as count FROM spatial_grid_cells').get().count;
      assert.ok(gridCellsCount >= 300, `spatial_grid_cells count (${gridCellsCount}) >= 300`);

      const groundVehCount = db.prepare('SELECT count(*) as count FROM ground_vehicles').get().count;
      assert.ok(groundVehCount >= 200, `ground_vehicles count (${groundVehCount}) >= 200`);

      const vesselBerthsCount = db.prepare('SELECT count(*) as count FROM vessel_berths').get().count;
      assert.ok(vesselBerthsCount >= 50, `vessel_berths count (${vesselBerthsCount}) >= 50`);

      db.close();
    }
  });

  it('validates vegetation-palms.json across 4 grounded zones with finite coordinates and physical dimensions', () => {
    assert.ok(fs.existsSync(PALMS_PATH), 'vegetation-palms.json must exist');
    const data = JSON.parse(fs.readFileSync(PALMS_PATH, 'utf8'));
    const palms = data.palms ?? data;
    assert.ok(Array.isArray(palms) && palms.length >= 350, `palms count (${palms.length}) >= 350`);

    const zones = new Set();
    for (const p of palms) {
      assert.ok(p.id && typeof p.id === 'string', 'palm id required');
      zones.add(p.zone);
      assertFiniteNumber(p.x, `${p.id}.x`);
      assertFiniteNumber(p.y, `${p.id}.y`);
      assertFiniteNumber(p.z, `${p.id}.z`);
      assert.ok(p.y >= 1.5 && p.y <= 3.5, `${p.id}.y sits on land`);
      assertFiniteNumber(p.heightM, `${p.id}.heightM`);
      assert.ok(p.heightM >= 4.0 && p.heightM <= 20.0, `${p.id}.heightM in palm range`);
      assertFiniteNumber(p.trunkRadiusM, `${p.id}.trunkRadiusM`);
      assertFiniteNumber(p.crownRadiusM, `${p.id}.crownRadiusM`);
      assert.ok(p.trunkRadiusM > 0.1 && p.crownRadiusM > 0.8, `${p.id} positive radii`);
    }

    assert.ok(zones.has('sahand_coastal_park'), 'must contain sahand_coastal_park palms');
    assert.ok(zones.has('boulevard_pasdaran'), 'must contain boulevard_pasdaran palms');
    assert.ok(zones.has('port_entrance_plaza'), 'must contain port_entrance_plaza palms');
    assert.ok(zones.has('coastal_beach_buffer'), 'must contain coastal_beach_buffer palms');
  });

  it('validates dhow-berths.json mooring slots along South Quay with valid cluster and tier partitions', () => {
    assert.ok(fs.existsSync(BERTHS_PATH), 'dhow-berths.json must exist');
    const data = JSON.parse(fs.readFileSync(BERTHS_PATH, 'utf8'));
    const berths = data.berths ?? data;
    assert.ok(Array.isArray(berths) && berths.length >= 50, `berths count (${berths.length}) >= 50`);

    const clusters = new Set();
    const tiers = new Set();
    for (const b of berths) {
      assert.ok(b.id && typeof b.id === 'string', 'berth id required');
      clusters.add(b.cluster);
      tiers.add(b.tier);
      assertFiniteNumber(b.x, `${b.id}.x`);
      assertFiniteNumber(b.z, `${b.id}.z`);
      assertFiniteNumber(b.rotY, `${b.id}.rotY`);
      assertFiniteNumber(b.maxLoaM, `${b.id}.maxLoaM`);
      assertFiniteNumber(b.maxBeamM, `${b.id}.maxBeamM`);
      assert.ok(b.maxLoaM > 15 && b.maxBeamM > 4, `${b.id} realistic dhow dimensions`);
    }

    assert.ok(clusters.has('cluster_northwest'), 'must contain cluster_northwest');
    assert.ok(clusters.has('cluster_mid_slip'), 'must contain cluster_mid_slip');
    assert.ok(clusters.has('cluster_southeast'), 'must contain cluster_southeast');
    assert.ok(tiers.has(1), 'must contain tier 1 berths');
    assert.ok(tiers.has(2), 'must contain tier 2 rafted berths');
  });

  it('validates shipyard-features.json and expanded-buildings.json registries', () => {
    assert.ok(fs.existsSync(SHIPYARD_PATH), 'shipyard-features.json must exist');
    const shipyard = JSON.parse(fs.readFileSync(SHIPYARD_PATH, 'utf8'));
    assert.ok(Array.isArray(shipyard.drydocks) && shipyard.drydocks.length >= 2, 'drydocks >= 2');
    assert.ok(shipyard.slipway && shipyard.slipway.lengthM > 40, 'marine slipway required');
    const repairSlots = shipyard.repairCraftSlots ?? shipyard.repairCraftPositions ?? [];
    assert.ok(Array.isArray(repairSlots) && repairSlots.length >= 4, 'repair craft slots >= 4');

    assert.ok(fs.existsSync(EXP_BLDGS_PATH), 'expanded-buildings.json must exist');
    const expBldgs = JSON.parse(fs.readFileSync(EXP_BLDGS_PATH, 'utf8'));
    assert.ok(expBldgs.summary && expBldgs.summary.total >= 1000, 'expanded buildings total >= 1000');
    const corePort = expBldgs.corePortBuildings ?? expBldgs.corePort ?? [];
    const surrounding = expBldgs.surroundingMajorBuildings ?? expBldgs.surroundingMajor ?? [];
    assert.ok(Array.isArray(corePort) && corePort.length >= 300, 'core port buildings >= 300');
    assert.ok(Array.isArray(surrounding) && surrounding.length >= 100, 'surrounding major >= 100');
  });

  it('validates spatial-grid.json across >= 300 square units with metric/WGS84 bounds, domains, featureCounts, and visualNotesGoogleEarth', () => {
    assert.ok(fs.existsSync(SPATIAL_GRID_PATH), 'spatial-grid.json must exist');
    const data = JSON.parse(fs.readFileSync(SPATIAL_GRID_PATH, 'utf8'));
    assert.equal(data.schema, 'bahonar-spatial-grid/1.0', 'schema must be bahonar-spatial-grid/1.0');
    assert.ok(data.gridConfig, 'gridConfig is required');
    assertFiniteNumber(data.gridConfig.cellSizeM, 'gridConfig.cellSizeM');
    assert.ok(data.gridConfig.cellSizeM >= 50, 'gridConfig.cellSizeM >= 50');

    const cells = data.cells ?? data.grid;
    assert.ok(Array.isArray(cells) && cells.length >= 300, `cells count (${cells?.length}) must be >= 300`);

    const domains = new Set();
    const cellIds = new Set();
    let totalIndexedFeatures = 0;

    for (const cell of cells) {
      assert.ok(cell.cellId && typeof cell.cellId === 'string', 'cell.cellId is required');
      assert.ok(!cellIds.has(cell.cellId), `duplicate cellId: ${cell.cellId}`);
      cellIds.add(cell.cellId);

      assert.ok(cell.code && typeof cell.code === 'string', `${cell.cellId}.code is required`);

      // Validate square metric bounds
      const mb = cell.metricBounds;
      assertValidBounds(mb, `${cell.cellId}.metricBounds`);
      assert.ok(
        Math.abs(mb.widthM - mb.depthM) < 1e-3,
        `${cell.cellId} must be a square unit (width=${mb.widthM}, depth=${mb.depthM})`
      );

      // Validate WGS84 bounds
      const wb = cell.wgs84Bounds;
      assert.ok(wb && typeof wb === 'object', `${cell.cellId}.wgs84Bounds is required`);
      assertFiniteNumber(wb.south, `${cell.cellId}.wgs84Bounds.south`);
      assertFiniteNumber(wb.north, `${cell.cellId}.wgs84Bounds.north`);
      assertFiniteNumber(wb.west, `${cell.cellId}.wgs84Bounds.west`);
      assertFiniteNumber(wb.east, `${cell.cellId}.wgs84Bounds.east`);
      assert.ok(wb.south < wb.north, `${cell.cellId}.wgs84Bounds south < north`);
      assert.ok(wb.west < wb.east, `${cell.cellId}.wgs84Bounds west < east`);
      assert.ok(wb.south > 27.0 && wb.north < 27.3, `${cell.cellId} latitude near Bahonar`);
      assert.ok(wb.west > 56.0 && wb.east < 56.4, `${cell.cellId} longitude near Bahonar`);

      // Domain
      assert.ok(cell.domain && typeof cell.domain === 'string', `${cell.cellId}.domain is required`);
      domains.add(cell.domain);

      // Feature counts
      assert.ok(cell.featureCounts && typeof cell.featureCounts === 'object', `${cell.cellId}.featureCounts is required`);
      assertFiniteNumber(cell.featureCounts.total, `${cell.cellId}.featureCounts.total`);
      assert.ok(cell.featureCounts.total >= 0, `${cell.cellId}.featureCounts.total >= 0`);
      totalIndexedFeatures += cell.featureCounts.total;

      // Google Earth visual notes
      assert.ok(
        typeof cell.visualNotesGoogleEarth === 'string' && cell.visualNotesGoogleEarth.length > 20,
        `${cell.cellId}.visualNotesGoogleEarth must contain descriptive text from Google Earth calibration`
      );
    }

    assert.ok(domains.size >= 5, `expected at least 5 distinct domains across port, got ${domains.size}`);
    assert.ok(totalIndexedFeatures > 500, `total indexed features across grid (${totalIndexedFeatures}) > 500`);
  });

  it('validates ground-vehicles.json with >= 200 vehicles, finite coordinates, headings, and grid assignments', () => {
    assert.ok(fs.existsSync(GROUND_VEHICLES_PATH), 'ground-vehicles.json must exist');
    const data = JSON.parse(fs.readFileSync(GROUND_VEHICLES_PATH, 'utf8'));
    assert.equal(data.schema, 'bahonar-ground-vehicles/1.0', 'schema must be bahonar-ground-vehicles/1.0');

    const vehicles = data.vehicles;
    assert.ok(Array.isArray(vehicles) && vehicles.length >= 200, `vehicles count (${vehicles.length}) must be >= 200`);

    const vehicleIds = new Set();
    const categories = new Set();
    const vehicleTypes = new Set();

    for (const v of vehicles) {
      assert.ok(v.id && typeof v.id === 'string', 'vehicle.id is required');
      assert.ok(!vehicleIds.has(v.id), `duplicate vehicle id: ${v.id}`);
      vehicleIds.add(v.id);

      assert.ok(v.type && typeof v.type === 'string', `${v.id}.type is required`);
      vehicleTypes.add(v.type);

      assert.ok(v.category && typeof v.category === 'string', `${v.id}.category is required`);
      categories.add(v.category);

      assertFiniteNumber(v.x, `${v.id}.x`);
      assertFiniteNumber(v.y, `${v.id}.y`);
      assertFiniteNumber(v.z, `${v.id}.z`);
      assert.ok(v.y >= 1.5 && v.y <= 10.0, `${v.id}.y (${v.y}) sits realistically on ground`);

      assertFiniteNumber(v.headingDeg, `${v.id}.headingDeg`);
      assertFiniteNumber(v.rotY, `${v.id}.rotY`);

      assertFiniteNumber(v.lengthM, `${v.id}.lengthM`);
      assertFiniteNumber(v.widthM, `${v.id}.widthM`);
      assertFiniteNumber(v.heightM, `${v.id}.heightM`);
      assert.ok(v.lengthM > 1 && v.widthM > 0.8 && v.heightM > 0.8, `${v.id} physical dimensions`);

      assert.ok(v.gridId && typeof v.gridId === 'string', `${v.id}.gridId is required`);
      assert.match(v.gridId, /^GRID-R\d+-C\d+$/, `${v.id}.gridId format GRID-R{row}-C{col}`);
    }

    assert.ok(categories.has('customs_gate_queue'), 'must contain customs_gate_queue');
    assert.ok(categories.has('ferry_terminal_parking'), 'must contain ferry_terminal_parking');
    assert.ok(categories.has('container_yard_tractors'), 'must contain container_yard_tractors');
    assert.ok(categories.has('quay_apron_vehicles'), 'must contain quay_apron_vehicles');
    assert.ok(vehicleTypes.size >= 5, `expected diverse vehicle types (>= 5), got ${vehicleTypes.size}`);
  });

  it('validates vessel-berths.json with >= 50 vessels across all quays and basins', () => {
    assert.ok(fs.existsSync(VESSEL_BERTHS_PATH), 'vessel-berths.json must exist');
    const data = JSON.parse(fs.readFileSync(VESSEL_BERTHS_PATH, 'utf8'));
    assert.equal(data.schema, 'bahonar-vessel-berths/1.0', 'schema must be bahonar-vessel-berths/1.0');

    const vessels = data.berths ?? data.vessels;
    assert.ok(Array.isArray(vessels) && vessels.length >= 50, `vessels count (${vessels?.length}) must be >= 50`);

    const sectors = new Set();
    for (const v of vessels) {
      assert.ok(v.id && typeof v.id === 'string', 'vessel.id is required');
      sectors.add(v.berthGroup ?? v.sector);
      assertFiniteNumber(v.x, `${v.id}.x`);
      assertFiniteNumber(v.y, `${v.id}.y`);
      assertFiniteNumber(v.z, `${v.id}.z`);
      assertFiniteNumber(v.headingDeg, `${v.id}.headingDeg`);
      assertFiniteNumber(v.rotY, `${v.id}.rotY`);
      assertFiniteNumber(v.loaM, `${v.id}.loaM`);
      assertFiniteNumber(v.beamM, `${v.id}.beamM`);
      assert.ok(v.loaM > 5 && v.beamM > 1.5, `${v.id} valid maritime dimensions`);
    }

    assert.ok(sectors.has('west_quay_containers'), 'must contain west_quay_containers');
    assert.ok(sectors.has('north_quay_cargo'), 'must contain north_quay_cargo');
    assert.ok(sectors.has('south_quay_dhows'), 'must contain south_quay_dhows');
    assert.ok(sectors.has('ferry_catamarans'), 'must contain ferry_catamarans');
  });
});
