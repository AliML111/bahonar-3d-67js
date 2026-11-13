#!/usr/bin/env node
/**
 * Grid-Driven 3D Enrichment & Search/Improve Pipeline for Shahid Bahonar Port
 * Calibrated against Google Earth reference coordinates (27.14520989 N, 56.21186412 E).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const METRIC_PATH = path.join(ROOT_DIR, 'data', 'geo', 'bahonar-port-metric.json');
const RAW_OSM_PATH = path.join(ROOT_DIR, 'data', 'geo', 'bahonar-osm-raw.json');
const GRID_PATH = path.join(ROOT_DIR, 'data', 'geodb', 'spatial-grid.json');
const VESSEL_BERTHS_PATH = path.join(ROOT_DIR, 'data', 'geodb', 'vessel-berths.json');
const DHOW_BERTHS_PATH = path.join(ROOT_DIR, 'data', 'geodb', 'dhow-berths.json');
const OUT_PATH = path.join(ROOT_DIR, 'data', 'geodb', 'grid-enriched-features.json');

const SEARCH_ONLINE = process.argv.includes('--search-online');

const GOOGLE_EARTH_REF = {
  lat: 27.14520989,
  lon: 56.21186412,
  elevationM: 17.48279459,
  rangeM: 8731.79082973,
  fovDeg: 35,
  headingDeg: 0,
  tiltDeg: 0,
};

export const VESSEL_CLASS_STANDARDS = Object.freeze({
  container: { loaM: 130.0, beamM: 21.5, draftM: 4.0, freeboardM: 6.4 },
  cargo: { loaM: 98.0, beamM: 17.2, draftM: 3.8, freeboardM: 5.2 },
  cargo_underway: { loaM: 88.0, beamM: 15.8, draftM: 3.8, freeboardM: 5.0 },
  bulk: { loaM: 96.0, beamM: 17.0, draftM: 3.6, freeboardM: 5.2 },
  tanker: { loaM: 142.0, beamM: 24.0, draftM: 4.2, freeboardM: 6.2 },
  catamaran_ferry: { loaM: 38.0, beamM: 10.5, draftM: 1.4, freeboardM: 2.2 },
  passenger_launch: { loaM: 28.0, beamM: 7.2, draftM: 1.4, freeboardM: 1.8 },
  patrol_ship: { loaM: 70.0, beamM: 11.0, draftM: 3.0, freeboardM: 4.2 },
  patrol: { loaM: 20.0, beamM: 5.2, draftM: 1.3, freeboardM: 1.6 },
  pilot: { loaM: 17.5, beamM: 5.4, draftM: 1.4, freeboardM: 1.6 },
  tug: { loaM: 26.0, beamM: 9.4, draftM: 3.2, freeboardM: 2.0 },
  service_tender: { loaM: 16.0, beamM: 5.2, draftM: 1.3, freeboardM: 1.5 },
  dhow: { loaM: 24.0, beamM: 7.0, draftM: 1.8, freeboardM: 2.0 },
  drydock_hull: { loaM: 62.0, beamM: 12.0, draftM: 0.0, freeboardM: 5.0 },
  drydock_tug: { loaM: 25.0, beamM: 9.0, draftM: 0.0, freeboardM: 2.5 },
  slipway_craft: { loaM: 24.0, beamM: 7.0, draftM: 0.0, freeboardM: 2.2 },
  crane_barge: { loaM: 34.0, beamM: 15.0, draftM: 1.2, freeboardM: 1.8 },
  dry_skiff: { loaM: 8.2, beamM: 2.6, draftM: 0.0, freeboardM: 1.2 },
});

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

function pointInPoly(pt, poly) {
  if (!poly || poly.length < 3) return true;
  const [px, pz] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect =
      zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function wgs84ToMetric(lat, lon, origin, projection) {
  return [
    round2((lon - origin.lon) * projection.metersPerDegLon),
    round2(-(lat - origin.lat) * projection.metersPerDegLat),
  ];
}

function findGridCell(x, z, gridConfig, cellsByCode) {
  const clampedX = Math.max(gridConfig.minX, Math.min(gridConfig.maxX - 0.01, x));
  const clampedZ = Math.max(gridConfig.minZ, Math.min(gridConfig.maxZ - 0.01, z));
  const col = Math.floor((clampedX - gridConfig.minX) / gridConfig.cellSizeM) + 1;
  const row = Math.floor((clampedZ - gridConfig.minZ) / gridConfig.cellSizeM) + 1;
  const colLetter = gridConfig.colLetters[col - 1] || 'I';
  const rowCode = String(row).padStart(2, '0');
  const code = `${colLetter}${rowCode}`;
  return cellsByCode.get(code) || { cellId: `GRID-R${row}-C${col}`, code };
}

function resolveRenderKind(berth) {
  if (berth.renderKind) return berth.renderKind;
  if (berth.status === 'dry_staged_boatyard') return 'dry_skiff';
  const t = String(berth.vesselType || '').toLowerCase();
  const id = String(berth.id || '').toLowerCase();
  if (t === 'container_feeder') return 'container';
  if (t === 'product_tanker') return 'tanker';
  if (t === 'bulk_carrier') return 'bulk';
  if (t === 'passenger_catamaran_ferry') return 'catamaran_ferry';
  if (t === 'passenger_roro_ferry') return 'passenger_launch';
  if (t === 'lenj_cargo_dhow' || id.includes('dhow')) return 'dhow';
  if (t === 'harbor_tug') return 'tug';
  if (t === 'pilot_launch') return 'pilot';
  if (t === 'patrol_boat' || t === 'service_cutter') return 'patrol';
  if (t === 'naval_patrol_ship') return 'patrol_ship';
  if (t === 'coastal_cargo_hull') return 'drydock_hull';
  if (t === 'service_tug' && berth.status === 'repair_drydock') return 'drydock_tug';
  if (t === 'lenj_dhow_cradle' || berth.status === 'slipway_cradle') return 'slipway_craft';
  if (t === 'crane_barge') return 'crane_barge';
  if (t === 'work_tender' || t === 'service_tender') return 'service_tender';
  if (berth.status === 'afloat_underway') return 'cargo_underway';
  return 'cargo';
}

function normalizeVesselDimensions(v) {
  const renderKind = resolveRenderKind(v);
  const std = VESSEL_CLASS_STANDARDS[renderKind] || VESSEL_CLASS_STANDARDS.cargo;
  return {
    ...v,
    renderKind,
    loaM: round2(Number.isFinite(v.loaM) && v.loaM > 0 ? v.loaM : std.loaM),
    beamM: round2(Number.isFinite(v.beamM) && v.beamM > 0 ? v.beamM : std.beamM),
    draftM: round2(Number.isFinite(v.draftM) ? v.draftM : std.draftM),
    freeboardM: round2(Number.isFinite(v.freeboardM) && v.freeboardM > 0 ? v.freeboardM : std.freeboardM),
  };
}

function hasNearbyVessel(vessels, x, z, minClearanceM) {
  for (const v of vessels) {
    if (v.status === 'dry_staged_boatyard') continue;
    const minSep = Math.max(minClearanceM, ((v.beamM || 8) + 8) * 0.55);
    if (Math.hypot(v.x - x, v.z - z) < minSep) return true;
  }
  return false;
}

async function queryOverpassHarborFeatures(wgs84Bounds) {
  if (!SEARCH_ONLINE) {
    return { status: 'local_osm_and_ge_calibrated', elements: [] };
  }
  const query = `[out:json][timeout:10];(way["man_made"~"pier|quay"](${wgs84Bounds.south},${wgs84Bounds.west},${wgs84Bounds.north},${wgs84Bounds.east});node["seamark:type"](${wgs84Bounds.south},${wgs84Bounds.west},${wgs84Bounds.north},${wgs84Bounds.east});node["mooring"](${wgs84Bounds.south},${wgs84Bounds.west},${wgs84Bounds.north},${wgs84Bounds.east}););out center body;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Accept': 'application/json',
        'User-Agent': 'bahonar-3d-grid-enrichment/1.0',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { status: `http_${res.status}_fallback_local`, elements: [] };
    const data = await res.json();
    return { status: 'overpass_ok', elements: data.elements || [] };
  } catch (err) {
    return { status: `fallback_local (${err.name})`, elements: [] };
  }
}

function generateQuayWallAndPierSlots(metric, existingVessels, waterPoly) {
  const generated = [];
  const wallsById = new Map((metric.quayWalls || []).map((w) => [w.id, w]));

  const northSlipWallIds = ['quay-wall-213', 'quay-wall-217', 'quay-wall-221', 'quay-wall-226', 'quay-wall-230'];
  let slipDhowIdx = 0;
  for (const wallId of northSlipWallIds) {
    const w = wallsById.get(wallId);
    if (!w) continue;
    const [sx, sz] = w.startXZ;
    const [ex, ez] = w.endXZ;
    const [nx, nz] = w.waterNormalXZ;
    const dx = ex - sx;
    const dz = ez - sz;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const rotY = round4(Math.atan2(-nz, nx));
    const slots = Math.max(1, Math.floor((len - 8) / 10.5));

    for (let s = 0; s < slots; s++) {
      const distAlong = 6 + (s + 0.5) * ((len - 12) / slots);
      const bx = sx + ux * distAlong;
      const bz = sz + uz * distAlong;
      const x1 = round2(bx + nx * 15.5);
      const z1 = round2(bz + nz * 15.5);
      if (pointInPoly([x1, z1], waterPoly) && !hasNearbyVessel([...existingVessels, ...generated], x1, z1, 9.0)) {
        slipDhowIdx++;
        const std = VESSEL_CLASS_STANDARDS.dhow;
        generated.push({
          id: `vessel-slip-north-dhow-t1-${slipDhowIdx}`,
          name: `Main Cargo Slip North Quay Dhow T1-${slipDhowIdx}`,
          berthGroup: 'main_slip_north_dhows',
          vesselType: 'lenj_cargo_dhow',
          renderKind: 'dhow',
          status: 'afloat_berthed',
          x: x1, y: 0, z: z1, rotY,
          loaM: round2(std.loaM * (0.94 + (slipDhowIdx % 3) * 0.05)),
          beamM: std.beamM, draftM: std.draftM, freeboardM: std.freeboardM,
          source: 'google_earth_grid_calibrated',
        });
      }
      if (len >= 40) {
        const x2 = round2(bx + nx * 41.5);
        const z2 = round2(bz + nz * 41.5);
        if (pointInPoly([x2, z2], waterPoly) && !hasNearbyVessel([...existingVessels, ...generated], x2, z2, 9.5)) {
          slipDhowIdx++;
          const std = VESSEL_CLASS_STANDARDS.dhow;
          generated.push({
            id: `vessel-slip-north-dhow-t2-${slipDhowIdx}`,
            name: `Main Cargo Slip North Quay Rafted Dhow T2-${slipDhowIdx}`,
            berthGroup: 'main_slip_north_dhows',
            vesselType: 'lenj_cargo_dhow',
            renderKind: 'dhow',
            status: 'afloat_berthed',
            x: x2, y: 0, z: z2, rotY: round4(rotY + 0.04),
            loaM: round2(std.loaM * 0.96),
            beamM: std.beamM, draftM: std.draftM, freeboardM: std.freeboardM,
            source: 'google_earth_grid_calibrated',
          });
        }
      }
    }
  }

  const southSlipWallIds = ['quay-wall-266', 'quay-wall-272', 'quay-wall-276', 'quay-wall-285'];
  let southCargoIdx = 0;
  for (const wallId of southSlipWallIds) {
    const w = wallsById.get(wallId);
    if (!w) continue;
    const [sx, sz] = w.startXZ;
    const [ex, ez] = w.endXZ;
    const [nx, nz] = w.waterNormalXZ;
    const mx = round2((sx + ex) * 0.5 + nx * 13.5);
    const mz = round2((sz + ez) * 0.5 + nz * 13.5);
    const rotY = round4(Math.atan2(-(ez - sz), ex - sx));

    if (pointInPoly([mx, mz], waterPoly) && !hasNearbyVessel([...existingVessels, ...generated], mx, mz, 24.0)) {
      southCargoIdx++;
      const isBulk = southCargoIdx % 2 === 0;
      const std = isBulk ? VESSEL_CLASS_STANDARDS.bulk : VESSEL_CLASS_STANDARDS.cargo;
      generated.push({
        id: `vessel-slip-south-cargo-${southCargoIdx}`,
        name: `Main Slip South Quay Coastal Vessel ${southCargoIdx}`,
        berthGroup: 'main_slip_south_cargo',
        vesselType: isBulk ? 'bulk_carrier' : 'general_cargo',
        renderKind: isBulk ? 'bulk' : 'cargo',
        status: 'afloat_berthed',
        x: mx, y: 0, z: mz, rotY,
        loaM: round2(Math.min(w.len * 0.82, std.loaM * 0.92)),
        beamM: std.beamM, draftM: std.draftM, freeboardM: std.freeboardM,
        source: 'google_earth_grid_calibrated',
      });
    }
  }

  const curatedGeVessels = [
    { id: 'vessel-east-pier1-1', name: 'East Basin Pier 1 Patrol Ship 1', berthGroup: 'east_basin_finger_piers', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: 946, y: 0, z: -485, rotY: -2.04, loaM: 68, beamM: 10.8, draftM: 3.0, freeboardM: 4.2 },
    { id: 'vessel-east-pier1-2', name: 'East Basin Pier 1 Patrol Ship 2', berthGroup: 'east_basin_finger_piers', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: 982, y: 0, z: -555, rotY: -2.04, loaM: 64, beamM: 10.4, draftM: 2.9, freeboardM: 4.0 },
    { id: 'vessel-east-pier2-1', name: 'East Basin Pier 2 Support Ship 1', berthGroup: 'east_basin_finger_piers', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: 1054, y: 0, z: -435, rotY: -2.04, loaM: 74, beamM: 11.5, draftM: 3.2, freeboardM: 4.4 },
    { id: 'vessel-east-pier2-2', name: 'East Basin Pier 2 Support Ship 2', berthGroup: 'east_basin_finger_piers', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: 1092, y: 0, z: -505, rotY: -2.04, loaM: 70, beamM: 11.0, draftM: 3.1, freeboardM: 4.2 },
    { id: 'vessel-east-pier3-1', name: 'East Basin Pier 3 Coastal Vessel 1', berthGroup: 'east_basin_finger_piers', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: 1126, y: 0, z: -310, rotY: -2.04, loaM: 78, beamM: 12.0, draftM: 3.3, freeboardM: 4.5 },
    { id: 'vessel-east-pier3-2', name: 'East Basin Pier 3 Coastal Vessel 2', berthGroup: 'east_basin_finger_piers', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: 1168, y: 0, z: -385, rotY: -2.04, loaM: 72, beamM: 11.4, draftM: 3.1, freeboardM: 4.3 },
    { id: 'vessel-east-north-quay-1', name: 'East Basin North Quay Auxiliary 1', berthGroup: 'east_basin_finger_piers', vesselType: 'coastal_auxiliary', renderKind: 'bulk', status: 'afloat_berthed', x: 895, y: 0, z: -610, rotY: -0.46, loaM: 66, beamM: 12.5, draftM: 3.2, freeboardM: 4.4 },
    { id: 'vessel-east-north-quay-2', name: 'East Basin North Quay Auxiliary 2', berthGroup: 'east_basin_finger_piers', vesselType: 'coastal_auxiliary', renderKind: 'tug', status: 'afloat_berthed', x: 840, y: 0, z: -635, rotY: -0.46, loaM: 30, beamM: 9.6, draftM: 3.0, freeboardM: 2.2 },
    { id: 'vessel-bw-tjetty-1', name: 'West Breakwater T-Jetty Service Vessel 1', berthGroup: 'west_breakwater_tjetty', vesselType: 'service_cutter', renderKind: 'patrol', status: 'afloat_berthed', x: -382, y: 0, z: 775, rotY: 1.05, loaM: 28, beamM: 6.4, draftM: 1.6, freeboardM: 2.0 },
    { id: 'vessel-bw-tjetty-2', name: 'West Breakwater T-Jetty Service Vessel 2', berthGroup: 'west_breakwater_tjetty', vesselType: 'service_cutter', renderKind: 'patrol', status: 'afloat_berthed', x: -395, y: 0, z: 805, rotY: 1.05, loaM: 26, beamM: 6.0, draftM: 1.5, freeboardM: 1.9 },
    { id: 'vessel-bw-tjetty-3', name: 'West Breakwater T-Jetty Pilot Cutter', berthGroup: 'west_breakwater_tjetty', vesselType: 'pilot_launch', renderKind: 'pilot', status: 'afloat_berthed', x: -425, y: 0, z: 755, rotY: -0.52, loaM: 20, beamM: 5.5, draftM: 1.4, freeboardM: 1.6 },
    { id: 'vessel-south-pier-1', name: 'East Basin South Pier Workboat 1', berthGroup: 'east_south_piers', vesselType: 'harbor_tug', renderKind: 'tug', status: 'afloat_berthed', x: 626, y: 0, z: -138, rotY: 1.57, loaM: 28, beamM: 9.2, draftM: 3.0, freeboardM: 2.2 },
    { id: 'vessel-south-pier-2', name: 'East Basin South Pier Workboat 2', berthGroup: 'east_south_piers', vesselType: 'service_tender', renderKind: 'service_tender', status: 'afloat_berthed', x: 772, y: 0, z: -125, rotY: 1.57, loaM: 24, beamM: 6.2, draftM: 1.6, freeboardM: 1.8 },
    { id: 'vessel-south-pier-3', name: 'East Basin South Pier Workboat 3', berthGroup: 'east_south_piers', vesselType: 'service_tender', renderKind: 'service_tender', status: 'afloat_berthed', x: 788, y: 0, z: -125, rotY: 1.57, loaM: 24, beamM: 6.2, draftM: 1.6, freeboardM: 1.8 },
    { id: 'vessel-west-basin-dhow-1', name: 'West Basin Pier Dhow 1', berthGroup: 'west_small_boat_basin', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: -332, y: 0, z: -48, rotY: -0.38, loaM: 24, beamM: 7.0, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-west-basin-dhow-2', name: 'West Basin Pier Dhow 2', berthGroup: 'west_small_boat_basin', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: -310, y: 0, z: -38, rotY: -0.38, loaM: 23, beamM: 6.8, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-west-basin-dhow-3', name: 'West Basin Pier Dhow 3', berthGroup: 'west_small_boat_basin', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: -288, y: 0, z: -28, rotY: -0.38, loaM: 22, beamM: 6.6, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-west-basin-dhow-4', name: 'West Basin Pier Dhow 4', berthGroup: 'west_small_boat_basin', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: -266, y: 0, z: -18, rotY: -0.38, loaM: 21, beamM: 6.4, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-west-basin-dhow-5', name: 'West Basin North Dhow 5', berthGroup: 'west_small_boat_basin', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: -215, y: 0, z: -85, rotY: 0.0, loaM: 23, beamM: 6.8, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-west-basin-dhow-6', name: 'West Basin North Dhow 6', berthGroup: 'west_small_boat_basin', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: -215, y: 0, z: -115, rotY: 0.0, loaM: 24, beamM: 7.0, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-west-basin-dhow-7', name: 'West Basin North Dhow 7', berthGroup: 'west_small_boat_basin', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: -215, y: 0, z: -145, rotY: 0.0, loaM: 22, beamM: 6.6, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-south-dhow-ext-1', name: 'South Quay East End Dhow 1', berthGroup: 'south_quay_dhows', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: 158, y: 0, z: -580, rotY: -1.56, loaM: 24, beamM: 7.0, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-south-dhow-ext-2', name: 'South Quay East End Dhow 2', berthGroup: 'south_quay_dhows', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: 158, y: 0, z: -555, rotY: -1.56, loaM: 23, beamM: 6.8, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-south-dhow-ext-3', name: 'South Quay East End Dhow 3', berthGroup: 'south_quay_dhows', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: 158, y: 0, z: -530, rotY: -1.56, loaM: 25, beamM: 7.2, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-south-dhow-ext-4', name: 'South Quay East End Dhow 4', berthGroup: 'south_quay_dhows', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: 158, y: 0, z: -505, rotY: -1.56, loaM: 24, beamM: 7.0, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-south-dhow-ext-5', name: 'South Quay East End Dhow 5', berthGroup: 'south_quay_dhows', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: 144, y: 0, z: -568, rotY: -1.52, loaM: 22, beamM: 6.6, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-south-dhow-ext-6', name: 'South Quay East End Dhow 6', berthGroup: 'south_quay_dhows', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: 144, y: 0, z: -542, rotY: -1.52, loaM: 23, beamM: 6.8, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-east-pier1-3', name: 'East Basin Pier 1 Patrol Craft 3', berthGroup: 'east_basin_finger_piers', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: 920, y: 0, z: -435, rotY: -2.04, loaM: 20, beamM: 5.2, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-east-pier1-4', name: 'East Basin Pier 1 Patrol Craft 4', berthGroup: 'east_basin_finger_piers', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: 902, y: 0, z: -400, rotY: -2.04, loaM: 20, beamM: 5.2, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-east-pier2-3', name: 'East Basin Pier 2 Patrol Craft 3', berthGroup: 'east_basin_finger_piers', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: 1025, y: 0, z: -380, rotY: -2.04, loaM: 20, beamM: 5.2, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-east-pier2-4', name: 'East Basin Pier 2 Patrol Craft 4', berthGroup: 'east_basin_finger_piers', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: 1008, y: 0, z: -348, rotY: -2.04, loaM: 20, beamM: 5.2, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-channel-pilot-2', name: 'Inbound Harbor Pilot Boat 2', berthGroup: 'channel_and_offshore', vesselType: 'pilot_launch', renderKind: 'pilot', status: 'afloat_underway', x: -115, y: 0, z: 980, rotY: 1.92, loaM: 17.5, beamM: 5.4, draftM: 1.4, freeboardM: 1.6 },
    { id: 'vessel-channel-patrol-3', name: 'Outer Forebay Coastguard Patrol', berthGroup: 'channel_and_offshore', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_underway', x: 145, y: 0, z: 620, rotY: -1.45, loaM: 20, beamM: 5.2, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-offshore-cargo-3', name: 'Hormoz Strait Anchorage Freighter 3', berthGroup: 'channel_and_offshore', vesselType: 'general_cargo', renderKind: 'cargo', status: 'afloat_anchored', x: -920, y: 0, z: 1180, rotY: 1.35, loaM: 96, beamM: 17, draftM: 3.8, freeboardM: 5.2 },
    { id: 'vessel-offshore-cargo-4', name: 'Bandar Abbas Outer Anchorage Bulk 4', berthGroup: 'channel_and_offshore', vesselType: 'bulk_carrier', renderKind: 'bulk', status: 'afloat_anchored', x: 760, y: 0, z: 1320, rotY: 1.52, loaM: 102, beamM: 17.5, draftM: 3.6, freeboardM: 5.2 },
    { id: 'vessel-se-headland-pier1-1', name: 'Southeast Headland Pier Boat 1', berthGroup: 'se_headland_piers', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: 432, y: 0, z: 814, rotY: -1.1, loaM: 18, beamM: 5.0, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-se-headland-pier1-2', name: 'Southeast Headland Pier Boat 2', berthGroup: 'se_headland_piers', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: 444, y: 0, z: 818, rotY: -1.1, loaM: 18, beamM: 5.0, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-se-headland-pier1-3', name: 'Southeast Headland Pier Boat 3', berthGroup: 'se_headland_piers', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: 456, y: 0, z: 822, rotY: -1.1, loaM: 18, beamM: 5.0, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-se-headland-pier2-1', name: 'Southeast Headland Outer Pier Vessel', berthGroup: 'se_headland_piers', vesselType: 'service_tender', renderKind: 'service_tender', status: 'afloat_berthed', x: 492, y: 0, z: 1026, rotY: 1.57, loaM: 22, beamM: 5.8, draftM: 1.4, freeboardM: 1.6 },
    { id: 'vessel-se-headland-underway-1', name: 'Southeast Headland Underway Patrol Craft', berthGroup: 'se_headland_piers', vesselType: 'pilot_launch', renderKind: 'pilot', status: 'afloat_underway', x: 220, y: 0, z: 1120, rotY: 2.85, loaM: 18, beamM: 5.4, draftM: 1.4, freeboardM: 1.6 },
    { id: 'vessel-drydock-west-quay-1', name: 'Shipyard West Quay Patrol Ship North', berthGroup: 'shipyard_repair', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: 681, y: 0, z: -615, rotY: 1.57, loaM: 66, beamM: 10.6, draftM: 3.0, freeboardM: 4.2 },
    { id: 'vessel-drydock-west-quay-2', name: 'Shipyard West Quay Patrol Ship South', berthGroup: 'shipyard_repair', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: 681, y: 0, z: -535, rotY: 1.57, loaM: 66, beamM: 10.6, draftM: 3.0, freeboardM: 4.2 },
    { id: 'vessel-drydock-east-pier-1', name: 'Shipyard East Outfitting Pier Auxiliary Ship', berthGroup: 'shipyard_repair', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: 818, y: 0, z: -575, rotY: 1.57, loaM: 84, beamM: 13.5, draftM: 3.4, freeboardM: 4.6 },
    { id: 'vessel-east-pier2-raft-1', name: 'East Basin Pier 2 Rafted Support Ship A', berthGroup: 'east_basin_finger_piers', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: 1042, y: 0, z: -445, rotY: -2.04, loaM: 70, beamM: 11.0, draftM: 3.1, freeboardM: 4.2 },
    { id: 'vessel-east-pier2-raft-2', name: 'East Basin Pier 2 Rafted Support Ship B', berthGroup: 'east_basin_finger_piers', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: 1080, y: 0, z: -515, rotY: -2.04, loaM: 68, beamM: 10.8, draftM: 3.0, freeboardM: 4.2 },
    { id: 'vessel-east-pier2-eastside-1', name: 'East Basin Pier 2 East Side Coastal Vessel', berthGroup: 'east_basin_finger_piers', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: 1108, y: 0, z: -480, rotY: -2.04, loaM: 66, beamM: 10.6, draftM: 3.0, freeboardM: 4.2 },
    { id: 'vessel-slip-headwall-1', name: 'Main Slip East Headwall Coastal Vessel 1', berthGroup: 'main_slip_headwall', vesselType: 'general_cargo', renderKind: 'cargo', status: 'afloat_berthed', x: 655, y: 0, z: -528, rotY: 0.0, loaM: 58, beamM: 11.2, draftM: 3.2, freeboardM: 4.2 },
    { id: 'vessel-slip-headwall-2', name: 'Main Slip East Headwall Coastal Vessel 2', berthGroup: 'main_slip_headwall', vesselType: 'bulk_carrier', renderKind: 'bulk', status: 'afloat_berthed', x: 655, y: 0, z: -548, rotY: 0.0, loaM: 62, beamM: 11.6, draftM: 3.2, freeboardM: 4.2 },
    { id: 'vessel-slip-headwall-3', name: 'Main Slip East Headwall Coastal Vessel 3', berthGroup: 'main_slip_headwall', vesselType: 'general_cargo', renderKind: 'cargo', status: 'afloat_berthed', x: 655, y: 0, z: -568, rotY: 0.0, loaM: 56, beamM: 11.0, draftM: 3.2, freeboardM: 4.2 },
    { id: 'vessel-slip-headwall-4', name: 'Main Slip East Headwall Workboat 4', berthGroup: 'main_slip_headwall', vesselType: 'tug', renderKind: 'tug', status: 'afloat_berthed', x: 668, y: 0, z: -592, rotY: 0.0, loaM: 28, beamM: 9.2, draftM: 3.0, freeboardM: 2.2 },
    { id: 'vessel-slip-headwall-5', name: 'Main Slip East Headwall Dhow 5', berthGroup: 'main_slip_headwall', vesselType: 'lenj_cargo_dhow', renderKind: 'dhow', status: 'afloat_berthed', x: 668, y: 0, z: -618, rotY: 0.0, loaM: 25, beamM: 7.2, draftM: 2.0, freeboardM: 1.8 },
    { id: 'vessel-west-pier-south-1', name: 'West Basin South Finger Pier Boat 1', berthGroup: 'west_small_boat_basin', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: -395, y: 0, z: -65, rotY: 1.57, loaM: 18, beamM: 5.0, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-west-pier-south-2', name: 'West Basin South Finger Pier Boat 2', berthGroup: 'west_small_boat_basin', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: -375, y: 0, z: -58, rotY: 1.57, loaM: 18, beamM: 5.0, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-west-pier-south-3', name: 'West Basin South Finger Pier Boat 3', berthGroup: 'west_small_boat_basin', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: -355, y: 0, z: -50, rotY: 1.57, loaM: 18, beamM: 5.0, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-west-pier-south-4', name: 'West Basin South Finger Pier Boat 4', berthGroup: 'west_small_boat_basin', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: -335, y: 0, z: -42, rotY: 1.57, loaM: 18, beamM: 5.0, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-west-pier-south-5', name: 'West Basin South Finger Pier Boat 5', berthGroup: 'west_small_boat_basin', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: -315, y: 0, z: -34, rotY: 1.57, loaM: 18, beamM: 5.0, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-west-pier-south-6', name: 'West Basin South Finger Pier Boat 6', berthGroup: 'west_small_boat_basin', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: -295, y: 0, z: -26, rotY: 1.57, loaM: 18, beamM: 5.0, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-west-pier-north-1', name: 'West Basin North Finger Pier Boat 1', berthGroup: 'west_small_boat_basin', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: -395, y: 0, z: -158, rotY: 1.57, loaM: 18, beamM: 5.0, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-west-pier-north-2', name: 'West Basin North Finger Pier Boat 2', berthGroup: 'west_small_boat_basin', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: -375, y: 0, z: -150, rotY: 1.57, loaM: 18, beamM: 5.0, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-west-pier-north-3', name: 'West Basin North Finger Pier Boat 3', berthGroup: 'west_small_boat_basin', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: -355, y: 0, z: -142, rotY: 1.57, loaM: 18, beamM: 5.0, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-west-pier-north-4', name: 'West Basin North Finger Pier Boat 4', berthGroup: 'west_small_boat_basin', vesselType: 'patrol_boat', renderKind: 'patrol', status: 'afloat_berthed', x: -335, y: 0, z: -134, rotY: 1.57, loaM: 18, beamM: 5.0, draftM: 1.3, freeboardM: 1.6 },
    { id: 'vessel-west-eastquay-white-1', name: 'West Basin East Quay White Coastal Ship', berthGroup: 'west_small_boat_basin', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: -214, y: 0, z: -195, rotY: 1.57, loaM: 64, beamM: 10.5, draftM: 3.0, freeboardM: 4.2 },
    { id: 'vessel-west-eastquay-cargo-2', name: 'West Basin East Quay Coastal Vessel', berthGroup: 'west_small_boat_basin', vesselType: 'general_cargo', renderKind: 'cargo', status: 'afloat_berthed', x: -214, y: 0, z: -85, rotY: 1.57, loaM: 76, beamM: 13.0, draftM: 3.4, freeboardM: 4.6 },
    { id: 'vessel-west-headland-patrol-1', name: 'West Headland Berthing Patrol Ship', berthGroup: 'west_small_boat_basin', vesselType: 'naval_patrol_ship', renderKind: 'patrol_ship', status: 'afloat_berthed', x: -535, y: 0, z: 75, rotY: -0.40, loaM: 62, beamM: 10.2, draftM: 2.9, freeboardM: 4.0 },
    { id: 'vessel-west-basin-tender-1', name: 'West Basin Pier Service Launch', berthGroup: 'west_small_boat_basin', vesselType: 'service_tender', renderKind: 'service_tender', status: 'afloat_berthed', x: -206, y: 0, z: -175, rotY: 0.0, loaM: 22, beamM: 5.8, draftM: 1.4, freeboardM: 1.6 },
  ];

  for (const v of curatedGeVessels) {
    if (waterPoly.length >= 3 && !pointInPoly([v.x, v.z], waterPoly)) continue;
    if (hasNearbyVessel([...existingVessels, ...generated], v.x, v.z, 6.0)) continue;
    generated.push({ ...v, source: 'google_earth_grid_calibrated' });
  }
  return generated;
}

function improveSparseWaterGridCells(cells, metric, rawOsm, existingVessels, waterPoly) {
  const improved = [];
  const waterDomains = new Set(['harbor_basin', 'dhow_harbor', 'service_boat_basin', 'container_terminal']);
  const occupiedCells = new Set(existingVessels.map((v) => v.gridCode));

  for (const cell of cells) {
    if (!waterDomains.has(cell.domain) || occupiedCells.has(cell.code)) continue;

    const piersInCell = (metric.quaysAndPiers || []).filter(
      (p) =>
        p.centerXZ[0] >= cell.metricBounds.minX &&
        p.centerXZ[0] < cell.metricBounds.maxX &&
        p.centerXZ[1] >= cell.metricBounds.minZ &&
        p.centerXZ[1] < cell.metricBounds.maxZ
    );

    for (const pier of piersInCell) {
      const px = round2(pier.centerXZ[0] + 12);
      const pz = round2(pier.centerXZ[1] + 12);
      if (!pointInPoly([px, pz], waterPoly)) continue;
      if (hasNearbyVessel([...existingVessels, ...improved], px, pz, 12.0)) continue;

      const isLargePier = (pier.lengthM || 0) >= 120;
      const renderKind = isLargePier ? 'cargo' : 'service_tender';
      const std = VESSEL_CLASS_STANDARDS[renderKind];
      improved.push({
        id: `vessel-grid-${cell.code.toLowerCase()}-${pier.id}`,
        name: `Grid ${cell.code} Pier Vessel (${pier.id})`,
        berthGroup: 'grid_search_improved',
        vesselType: isLargePier ? 'general_cargo' : 'service_tender',
        renderKind,
        status: 'afloat_berthed',
        x: px, y: 0, z: pz, rotY: 0.78,
        loaM: std.loaM, beamM: std.beamM, draftM: std.draftM, freeboardM: std.freeboardM,
        gridId: cell.cellId,
        gridCode: cell.code,
        source: 'grid_search_osm_pier',
      });
    }

    const rawMoorings = (rawOsm.elements || []).filter((el) => {
      if (el.type !== 'node' || !Number.isFinite(el.lat) || !Number.isFinite(el.lon)) return false;
      const tags = el.tags || {};
      if (!tags.mooring && !tags['seamark:type']) return false;
      return (
        el.lat >= cell.wgs84Bounds.south &&
        el.lat < cell.wgs84Bounds.north &&
        el.lon >= cell.wgs84Bounds.west &&
        el.lon < cell.wgs84Bounds.east
      );
    });

    if (rawMoorings.length > 0 && !occupiedCells.has(cell.code)) {
      const m = rawMoorings[0];
      const [mx, mz] = wgs84ToMetric(m.lat, m.lon, metric.origin, metric.projection);
      if (pointInPoly([mx, mz], waterPoly) && !hasNearbyVessel([...existingVessels, ...improved], mx, mz, 15.0)) {
        const std = VESSEL_CLASS_STANDARDS.pilot;
        improved.push({
          id: `vessel-grid-${cell.code.toLowerCase()}-mooring-${m.id}`,
          name: `Grid ${cell.code} Mooring Craft (${m.id})`,
          berthGroup: 'grid_search_improved',
          vesselType: 'pilot_launch',
          renderKind: 'pilot',
          status: 'afloat_berthed',
          x: mx, y: 0, z: mz, rotY: 1.1,
          loaM: std.loaM, beamM: std.beamM, draftM: std.draftM, freeboardM: std.freeboardM,
          gridId: cell.cellId,
          gridCode: cell.code,
          source: 'grid_search_osm_mooring',
        });
      }
    }
  }

  return improved;
}

async function runPipeline() {
  const metric = JSON.parse(fs.readFileSync(METRIC_PATH, 'utf8'));
  const rawOsm = fs.existsSync(RAW_OSM_PATH) ? JSON.parse(fs.readFileSync(RAW_OSM_PATH, 'utf8')) : { elements: [] };
  const grid = JSON.parse(fs.readFileSync(GRID_PATH, 'utf8'));
  const vb = JSON.parse(fs.readFileSync(VESSEL_BERTHS_PATH, 'utf8'));
  const dhowData = JSON.parse(fs.readFileSync(DHOW_BERTHS_PATH, 'utf8'));

  const waterPoly = metric.waterFeatures?.harborWaterPolygon?.polygonXZ || [];
  const cellsByCode = new Map(grid.cells.map((c) => [c.code, c]));
  const geMetricCenter = wgs84ToMetric(
    GOOGLE_EARTH_REF.lat,
    GOOGLE_EARTH_REF.lon,
    metric.origin,
    metric.projection
  );

  const calibratedBerths = vb.berths.map((b) => {
    const next = { ...b, source: 'geodb_registry' };

    if (b.id === 'vessel-feeder-1') {
      next.vesselType = 'container_feeder';
      next.renderKind = 'container';
      next.name = 'Shahid Bahonar Container Feeder 1 (West Quay North)';
      next.loaM = 132.0;
      next.beamM = 21.5;
      next.freeboardM = 6.4;
      next.source = 'google_earth_grid_calibrated';
    } else if (b.id === 'vessel-feeder-2') {
      next.vesselType = 'container_feeder';
      next.renderKind = 'container';
      next.name = 'Shahid Bahonar Container Feeder 2 (West Quay Mid)';
      next.loaM = 124.0;
      next.beamM = 20.8;
      next.freeboardM = 6.2;
      next.source = 'google_earth_grid_calibrated';
    } else if (b.id === 'vessel-channel-feeder-inbound') {
      next.vesselType = 'general_cargo';
      next.renderKind = 'cargo_underway';
      next.name = 'Inbound Coastal Vessel (Channel Centerline)';
      next.x = -35.0;
      next.z = 760.0;
      next.rotY = 1.88;
      next.loaM = 84.0;
      next.beamM = 15.0;
      next.freeboardM = 4.8;
      next.source = 'google_earth_grid_calibrated';
    } else if (b.id === 'vessel-cargo-offshore-1') {
      next.x = -660.0;
      next.z = 1360.0;
      next.rotY = 1.45;
      next.source = 'google_earth_grid_calibrated';
    }

    const normalized = normalizeVesselDimensions(next);
    const cell = findGridCell(normalized.x, normalized.z, grid.gridConfig, cellsByCode);
    normalized.gridId = cell.cellId;
    normalized.gridCode = cell.code;
    return normalized;
  });

  const wallAndPierVessels = generateQuayWallAndPierSlots(metric, calibratedBerths, waterPoly).map((v) => {
    const normalized = normalizeVesselDimensions(v);
    const cell = findGridCell(normalized.x, normalized.z, grid.gridConfig, cellsByCode);
    normalized.gridId = cell.cellId;
    normalized.gridCode = cell.code;
    return normalized;
  });

  const combinedPreSearch = [...calibratedBerths, ...wallAndPierVessels];
  const searchImprovedVessels = improveSparseWaterGridCells(
    grid.cells,
    metric,
    rawOsm,
    combinedPreSearch,
    waterPoly
  ).map((v) => normalizeVesselDimensions(v));

  const allVessels = [...combinedPreSearch, ...searchImprovedVessels];

  const vesselsByCell = new Map();
  for (const v of allVessels) {
    const list = vesselsByCell.get(v.gridCode) || [];
    list.push(v);
    vesselsByCell.set(v.gridCode, list);
  }

  let onlineFallbackCheck = { status: 'local_osm_and_ge_calibrated', elements: [] };
  if (SEARCH_ONLINE) {
    const sampleCell = cellsByCode.get('O08') || grid.cells[0];
    onlineFallbackCheck = await queryOverpassHarborFeatures(sampleCell.wgs84Bounds);
  }

  const enrichedCells = grid.cells.map((cell) => {
    const cellVessels = vesselsByCell.get(cell.code) || [];
    const osmPiersInCell = (metric.quaysAndPiers || []).filter(
      (p) =>
        p.centerXZ[0] >= cell.metricBounds.minX &&
        p.centerXZ[0] < cell.metricBounds.maxX &&
        p.centerXZ[1] >= cell.metricBounds.minZ &&
        p.centerXZ[1] < cell.metricBounds.maxZ
    );
    const osmBuildingsInCell = (metric.buildings || []).filter(
      (b) =>
        b.subType !== 'storage_tank' &&
        b.centerXZ &&
        b.centerXZ[0] >= cell.metricBounds.minX &&
        b.centerXZ[0] < cell.metricBounds.maxX &&
        b.centerXZ[1] >= cell.metricBounds.minZ &&
        b.centerXZ[1] < cell.metricBounds.maxZ
    );
    return {
      cellId: cell.cellId,
      code: cell.code,
      metricBounds: cell.metricBounds,
      wgs84Bounds: cell.wgs84Bounds,
      domain: cell.domain,
      cellScaleM: grid.gridConfig.cellSizeM,
      osmPierCount: osmPiersInCell.length,
      osmBuildingCount: osmBuildingsInCell.length,
      osmBuildingIds: osmBuildingsInCell.map((b) => b.id),
      vesselCount: cellVessels.length,
      vesselIds: cellVessels.map((v) => v.id),
      enrichmentSource: cellVessels.some((v) => v.source === 'google_earth_grid_calibrated')
        ? 'osm_plus_google_earth_calibrated'
        : cellVessels.some((v) => v.source?.startsWith('grid_search_'))
          ? 'grid_search_improved'
          : osmPiersInCell.length > 0 || cellVessels.length > 0
            ? 'osm_and_geodb_grounded'
            : 'baseline_terrain_grid',
    };
  });

  const output = {
    schema: 'bahonar-grid-enrichment-v2',
    generatedAt: new Date().toISOString(),
    uniformGridScale: {
      cellSizeM: grid.gridConfig.cellSizeM,
      metersPerSceneUnit: 1.0,
      classStandards: VESSEL_CLASS_STANDARDS,
    },
    googleEarthReference: {
      ...GOOGLE_EARTH_REF,
      metricCenterXZ: geMetricCenter,
    },
    searchFallbackStatus: {
      mode: SEARCH_ONLINE ? 'online_overpass_with_local_fallback' : 'local_osm_plus_google_earth_calibration',
      osmRawElementsIndexed: rawOsm.elements?.length || 0,
      osmMetricPiersIndexed: metric.quaysAndPiers?.length || 0,
      dhowSlotsIndexed: dhowData.berths?.length || 0,
      onlineProbe: onlineFallbackCheck.status,
    },
    counts: {
      totalGridCells: enrichedCells.length,
      populatedVesselGridCells: enrichedCells.filter((c) => c.vesselCount > 0).length,
      totalVessels: allVessels.length,
      afloatVessels: allVessels.filter((v) => v.status !== 'dry_staged_boatyard').length,
      dryStagedSkiffs: allVessels.filter((v) => v.status === 'dry_staged_boatyard').length,
      newlyAddedFromQuayAndPierGrid: wallAndPierVessels.length,
      newlyAddedFromSearchImprove: searchImprovedVessels.length,
    },
    vessels: allVessels,
    cells: enrichedCells,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(output.counts, null, 2));
}

runPipeline().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
