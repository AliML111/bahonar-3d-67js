#!/usr/bin/env node
/**
 * fetch-osm.mjs
 *
 * Queries OpenStreetMap (Nominatim + Overpass API) for Shahid Bahonar Port
 * (Bandar Abbas, Hormozgan, Iran), saves raw OSM JSON to data/geo/bahonar-osm-raw.json,
 * and converts all WGS84 coordinates into a local metric coordinate system
 * (origin = port center; +X = East, +Y = Up, +Z = South so -Z = North)
 * written to data/geo/bahonar-port-metric.json.
 *
 * Usage:
 *   node scripts/fetch-osm.mjs            # Idempotent: uses cached raw file if present
 *   node scripts/fetch-osm.mjs --refresh  # Forces fresh Nominatim + Overpass fetch
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const GEO_DIR = path.join(ROOT_DIR, 'data', 'geo');
const RAW_PATH = path.join(GEO_DIR, 'bahonar-osm-raw.json');
const METRIC_PATH = path.join(GEO_DIR, 'bahonar-port-metric.json');

export const ORIGIN = {
  lat: 27.13991208,
  lon: 56.20372122,
  elevationM: 0,
  label: 'Shahid Bahonar Port (اسکله شهید باهنر), Bandar Abbas, Hormozgan, Iran'
};

export const BBOX = {
  south: 27.126,
  west: 56.186,
  north: 27.157,
  east: 56.220
};

const USER_AGENT = 'bahonar-3d-geospatial/1.0 (Shahid Bahonar Port 3D reconstruction)';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

// WGS84 ellipsoid local tangent plane scaling at ORIGIN.lat
function computeWgs84Scales(latDeg) {
  const latRad = (latDeg * Math.PI) / 180;
  const a = 6378137.0;
  const e2 = 0.00669437999014;
  const sinLat = Math.sin(latRad);
  const denom = 1 - e2 * sinLat * sinLat;
  const meridionalRadius = (a * (1 - e2)) / Math.pow(denom, 1.5);
  const primeVerticalRadius = a / Math.sqrt(denom);
  return {
    metersPerDegLat: (Math.PI / 180) * meridionalRadius,
    metersPerDegLon: (Math.PI / 180) * primeVerticalRadius * Math.cos(latRad)
  };
}

const SCALES = computeWgs84Scales(ORIGIN.lat);

export function wgs84ToMetric(lat, lon) {
  return [
    +((lon - ORIGIN.lon) * SCALES.metersPerDegLon).toFixed(3),
    +(-(lat - ORIGIN.lat) * SCALES.metersPerDegLat).toFixed(3) // +Z = South, -Z = North
  ];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function polylineLength(pts) {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return round2(len);
}

function polygonSignedArea(ring) {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    sum += x1 * z2 - x2 * z1;
  }
  return sum / 2;
}

function centroidOfPoints(pts) {
  if (!pts.length) return [0, 0];
  const unique =
    pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]
      ? pts.slice(0, -1)
      : pts;
  let sx = 0;
  let sz = 0;
  for (const [x, z] of unique) {
    sx += x;
    sz += z;
  }
  return [round2(sx / unique.length), round2(sz / unique.length)];
}

function boundsOfPoints(pts) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    minX: round2(minX),
    maxX: round2(maxX),
    minZ: round2(minZ),
    maxZ: round2(maxZ)
  };
}

function computeOBB(ring) {
  const pts =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  if (pts.length < 2) {
    return { centerXZ: pts[0] || [0, 0], widthM: 0, depthM: 0, rotationY: 0 };
  }
  let bestAngle = 0;
  let bestLen = -1;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len > bestLen) {
      bestLen = len;
      bestAngle = Math.atan2(z2 - z1, x2 - x1);
    }
  }
  const cosA = Math.cos(-bestAngle);
  const sinA = Math.sin(-bestAngle);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [x, z] of pts) {
    const u = x * cosA - z * sinA;
    const v = x * sinA + z * cosA;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  const cx = cu * Math.cos(bestAngle) - cv * Math.sin(bestAngle);
  const cz = cu * Math.sin(bestAngle) + cv * Math.cos(bestAngle);
  return {
    centerXZ: [round2(cx), round2(cz)],
    widthM: round2(maxU - minU),
    depthM: round2(maxV - minV),
    rotationY: Number((-bestAngle).toFixed(5))
  };
}

function pointInCorePort([x, z]) {
  return x >= -700 && x <= 1450 && z >= -1720 && z <= 1300;
}

function inBboxLatLon(lat, lon) {
  return lat >= BBOX.south && lat <= BBOX.north && lon >= BBOX.west && lon <= BBOX.east;
}

async function fetchNominatim() {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&bounded=1&viewbox=56.15,27.18,56.26,27.11&q=' +
    encodeURIComponent('اسکله باهنر');
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  return res.json();
}

async function fetchOverpass() {
  const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const query = `[out:json][timeout:60];
(
  node(${b});
  way(${b});
  relation(${b});
);
out body;
>;
out skel qt;`;

  for (let round = 0; round < 3; round++) {
    for (const ep of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT
          },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(60000)
        });
        const text = await res.text();
        if (!res.ok || !text.trim().startsWith('{')) {
          console.warn(`[overpass] ${ep} HTTP ${res.status}`);
          continue;
        }
        return { endpoint: ep, query, data: JSON.parse(text) };
      } catch (err) {
        console.warn(`[overpass] ${ep} error: ${err.message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 3000 * (round + 1)));
  }
  throw new Error('All Overpass API endpoints failed');
}

function filterRawToPortScope(rawData, nominatim, overpassEndpoint, query) {
  const nodeMap = new Map();
  for (const el of rawData.elements) {
    if (el.type === 'node') nodeMap.set(el.id, el);
  }
  const keptWays = [];
  const neededNodeIds = new Set();
  for (const el of rawData.elements) {
    if (el.type === 'way' && el.nodes?.some((id) => {
      const n = nodeMap.get(id);
      return n && inBboxLatLon(n.lat, n.lon);
    })) {
      keptWays.push(el);
      for (const id of el.nodes) neededNodeIds.add(id);
    }
  }
  const keptNodes = [];
  for (const el of rawData.elements) {
    if (el.type === 'node') {
      const hasTags = el.tags && Object.keys(el.tags).length > 0;
      if ((hasTags && inBboxLatLon(el.lat, el.lon)) || neededNodeIds.has(el.id)) {
        keptNodes.push(el);
      }
    }
  }
  const keptRelations = rawData.elements.filter(
    (el) => el.type === 'relation' && (el.id === 8687621 || el.id === 9086881)
  );
  return {
    version: rawData.version,
    generator: rawData.generator,
    osm3s: rawData.osm3s,
    queryMetadata: {
      fetchedAt: rawData.osm3s?.timestamp_osm_base || new Date().toISOString(),
      overpassEndpoint,
      bbox: BBOX,
      origin: ORIGIN,
      query,
      nominatim
    },
    elements: [...keptNodes, ...keptWays, ...keptRelations]
  };
}

function extractBreakwaterFromCoast(coastNodes, startIdx, endIdx, id, name) {
  const slice = coastNodes.slice(startIdx, endIdx + 1);
  const polygonXZ = slice.map((n) => wgs84ToMetric(n.lat, n.lon));
  if (
    polygonXZ.length > 1 &&
    (polygonXZ[0][0] !== polygonXZ[polygonXZ.length - 1][0] ||
      polygonXZ[0][1] !== polygonXZ[polygonXZ.length - 1][1])
  ) {
    polygonXZ.push([...polygonXZ[0]]);
  }
  // Find furthest point from root midpoint as tip
  const rootXZ = [
    round2((polygonXZ[0][0] + polygonXZ[polygonXZ.length - 2][0]) / 2),
    round2((polygonXZ[0][1] + polygonXZ[polygonXZ.length - 2][1]) / 2)
  ];
  let tipIdx = 0;
  let maxDist = -1;
  for (let i = 0; i < polygonXZ.length - 1; i++) {
    const d = Math.hypot(polygonXZ[i][0] - rootXZ[0], polygonXZ[i][1] - rootXZ[1]);
    if (d > maxDist) {
      maxDist = d;
      tipIdx = i;
    }
  }
  // Build approximate centerline by averaging opposite sides from root toward tip
  const sideA = polygonXZ.slice(0, tipIdx + 1);
  const sideB = polygonXZ.slice(tipIdx, polygonXZ.length - 1).reverse();
  const steps = Math.max(sideA.length, sideB.length, 2);
  const centerlineXZ = [];
  for (let s = 0; s < steps; s++) {
    const t = s / (steps - 1);
    const ia = Math.min(sideA.length - 1, Math.round(t * (sideA.length - 1)));
    const ib = Math.min(sideB.length - 1, Math.round(t * (sideB.length - 1)));
    centerlineXZ.push([
      round2((sideA[ia][0] + sideB[ib][0]) / 2),
      round2((sideA[ia][1] + sideB[ib][1]) / 2)
    ]);
  }
  const areaSqm = Math.abs(polygonSignedArea(polygonXZ));
  const lengthM = polylineLength(centerlineXZ);
  const avgWidthM = lengthM > 0 ? round2(areaSqm / lengthM) : 0;
  return {
    id,
    name,
    osmId: 157394001,
    grounded: true,
    rootXZ,
    tipXZ: polygonXZ[tipIdx],
    lengthM,
    avgWidthM,
    areaSqm: round2(areaSqm),
    bounds: boundsOfPoints(polygonXZ),
    centerlineXZ,
    polygonXZ
  };
}

function classifyBuilding(tags, areaSqm) {
  if (tags.man_made === 'storage_tank' || tags.man_made === 'gasometer') {
    return { subType: 'storage_tank', estimatedHeightM: 12 };
  }
  if (tags.amenity === 'ferry_terminal') {
    return { subType: 'ferry_terminal', estimatedHeightM: 10 };
  }
  if (tags.office === 'government' || (tags.name && tags.name.includes('نفت'))) {
    return { subType: 'port_office', estimatedHeightM: 11 };
  }
  if (tags.building === 'bunker') {
    return { subType: 'bunker', estimatedHeightM: 4.5 };
  }
  if (tags.building === 'industrial') {
    return { subType: 'industrial', estimatedHeightM: 9 };
  }
  if (tags.building === 'house') {
    return { subType: 'house', estimatedHeightM: 5 };
  }
  if (tags.building === 'shed') {
    return { subType: 'shed', estimatedHeightM: 4.5 };
  }
  const levels = Number(tags['building:levels']);
  if (areaSqm >= 2500) {
    return {
      subType: 'warehouse',
      estimatedHeightM: Number.isFinite(levels) && levels > 0 ? levels * 5 : 10
    };
  }
  if (areaSqm >= 600) {
    return {
      subType: 'port_building',
      estimatedHeightM: Number.isFinite(levels) && levels > 0 ? levels * 4.2 : 7.5
    };
  }
  return {
    subType: 'building',
    estimatedHeightM: Number.isFinite(levels) && levels > 0 ? levels * 3.8 : 5.5
  };
}

function estimateRoadWidth(tags) {
  switch (tags.highway) {
    case 'trunk':
      return 14;
    case 'primary':
      return 12;
    case 'secondary':
      return 10;
    case 'tertiary':
      return 8.5;
    case 'service':
      return 6;
    case 'residential':
      return 6;
    case 'track':
      return 4;
    case 'footway':
      return 2.5;
    default:
      return 6;
  }
}

function buildMetricDataset(raw) {
  const nodes = new Map();
  const ways = new Map();
  for (const el of raw.elements) {
    if (el.type === 'node') nodes.set(el.id, el);
    if (el.type === 'way') ways.set(el.id, el);
  }

  // 1. Coastline & Land/Water polygons from way 157394001 (West -> East slice 140..483)
  const coastWay = ways.get(157394001);
  if (!coastWay) throw new Error('Coastline way 157394001 not found in raw OSM data');
  const coastNodesFull = coastWay.nodes.map((id) => nodes.get(id)).filter(Boolean);
  // Find contiguous port coastline slice spanning BBOX.west to BBOX.east (before NE tidal creek at lon > 56.221)
  let cStart = 0;
  let cEnd = coastNodesFull.length - 1;
  for (let i = 0; i < coastNodesFull.length; i++) {
    if (coastNodesFull[i].lon >= BBOX.west) {
      cStart = Math.max(0, i - 1);
      break;
    }
  }
  for (let i = cStart; i < coastNodesFull.length; i++) {
    if (coastNodesFull[i].lon >= BBOX.east && i > 400) {
      cEnd = i;
      break;
    }
  }
  const portCoastNodes = coastNodesFull.slice(cStart, cEnd + 1);
  const coastPointsXZ = portCoastNodes.map((n) => wgs84ToMetric(n.lat, n.lon));
  const coastBounds = boundsOfPoints(coastPointsXZ);

  const coastlines = [
    {
      id: 'coastline-bahonar-main',
      osmId: 157394001,
      grounded: true,
      lengthM: polylineLength(coastPointsXZ),
      bounds: coastBounds,
      pointsXZ: coastPointsXZ,
      tags: coastWay.tags || { natural: 'coastline' }
    }
  ];

  // Land polygon closed along north scene edge (Z = northBoundaryZ)
  const northBoundaryZ = -1950;
  const southBoundaryZ = 1650;
  const landRing = [
    ...coastPointsXZ,
    [coastPointsXZ[coastPointsXZ.length - 1][0], northBoundaryZ],
    [coastPointsXZ[0][0], northBoundaryZ],
    [...coastPointsXZ[0]]
  ];
  const landPolygons = [
    {
      id: 'land-port-mainland',
      osmId: 157394001,
      grounded: true,
      areaSqm: round2(Math.abs(polygonSignedArea(landRing))),
      bounds: boundsOfPoints(landRing),
      polygonXZ: landRing
    }
  ];

  // Harbor/sea water polygon closed along south ocean boundary (Z = southBoundaryZ)
  const waterRing = [
    ...coastPointsXZ,
    [coastPointsXZ[coastPointsXZ.length - 1][0], southBoundaryZ],
    [coastPointsXZ[0][0], southBoundaryZ],
    [...coastPointsXZ[0]]
  ];

  // 2. Breakwaters extracted from coastline peninsulas
  // Find West & East breakwater slices dynamically by matching tip landmarks in coastNodesFull
  const findClosestIdx = (targetLat, targetLon, from = 0, to = coastNodesFull.length - 1) => {
    let bestI = from;
    let bestD = Infinity;
    for (let i = from; i <= to; i++) {
      const d = Math.hypot(coastNodesFull[i].lat - targetLat, coastNodesFull[i].lon - targetLon);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    return bestI;
  };
  const westTipIdx = findClosestIdx(27.128598, 56.202076, 150, 300);
  const westSpurTipIdx = findClosestIdx(27.138156, 56.202904, 240, 300);
  const eastTipIdx = findClosestIdx(27.129631, 56.206256, 420, 500);

  const breakwaters = [
    extractBreakwaterFromCoast(
      coastNodesFull,
      westTipIdx - 9,
      westTipIdx + 9,
      'breakwater-west-outer',
      'West Outer Breakwater'
    ),
    extractBreakwaterFromCoast(
      coastNodesFull,
      westSpurTipIdx - 7,
      westSpurTipIdx + 8,
      'breakwater-west-inner-spur',
      'West Inner Entrance Spur'
    ),
    extractBreakwaterFromCoast(
      coastNodesFull,
      eastTipIdx - 17,
      eastTipIdx + 12,
      'breakwater-east-outer',
      'East Outer Breakwater'
    )
  ];

  // 3. Water features: basin polygon + drydocks/reservoirs + named harbor basins
  const docks = [];
  for (const el of raw.elements) {
    if (el.type !== 'way') continue;
    const t = el.tags || {};
    if (t.waterway === 'dock' || t.natural === 'water') {
      const pts = el.nodes.map((id) => nodes.get(id)).filter(Boolean).map((n) => wgs84ToMetric(n.lat, n.lon));
      if (pts.length < 3) continue;
      const areaSqm = round2(Math.abs(polygonSignedArea(pts)));
      const obb = computeOBB(pts);
      docks.push({
        id: `water-${el.id}`,
        osmId: el.id,
        subType: t.dock || t.water || 'water',
        grounded: true,
        ...obb,
        areaSqm,
        bounds: boundsOfPoints(pts),
        footprintXZ: pts,
        tags: t
      });
    }
  }

  const basins = [
    {
      id: 'basin-west-small-boat',
      name: 'West Small-Boat Basin',
      grounded: 'derived-from-osm-coastline',
      centerXZ: [-430, -180],
      bounds: { minX: -850, maxX: -140, minZ: -440, maxZ: 120 },
      nominalDepthM: 5.5
    },
    {
      id: 'basin-north-ferry-cargo-slip',
      name: 'North Ferry & Main Cargo Slip',
      grounded: 'derived-from-osm-coastline',
      centerXZ: [70, -960],
      bounds: { minX: -60, maxX: 185, minZ: -1495, maxZ: -380 },
      nominalDepthM: 9.5
    },
    {
      id: 'basin-east-cargo-drydock',
      name: 'East Cargo & Drydock Basin',
      grounded: 'derived-from-osm-coastline',
      centerXZ: [680, -420],
      bounds: { minX: 165, maxX: 1255, minZ: -735, maxZ: -65 },
      nominalDepthM: 9.0
    },
    {
      id: 'basin-outer-forebay',
      name: 'Outer Harbor Forebay & Turning Basin',
      grounded: 'derived-from-osm-coastline',
      centerXZ: [70, 560],
      bounds: { minX: -480, maxX: 540, minZ: 120, maxZ: 1180 },
      nominalDepthM: 11.0
    },
    {
      id: 'basin-approach-channel',
      name: 'Dredged Approach Channel',
      grounded: 'derived-from-osm-seamarks',
      centerXZ: [50, 1220],
      bounds: { minX: -165, maxX: 255, minZ: 190, maxZ: 1650 },
      nominalDepthM: 12.5
    }
  ];

  const waterFeatures = {
    harborWaterPolygon: {
      id: 'water-harbor-sea',
      osmId: 157394001,
      grounded: true,
      areaSqm: round2(Math.abs(polygonSignedArea(waterRing))),
      bounds: boundsOfPoints(waterRing),
      polygonXZ: waterRing
    },
    docks,
    basins
  };

  // 4. Quays, Piers, Slipways, and Coastline Quay Walls
  const quaysAndPiers = [];
  for (const el of raw.elements) {
    if (el.type !== 'way') continue;
    const t = el.tags || {};
    if (t.man_made !== 'pier' && t.leisure !== 'slipway') continue;
    const pts = el.nodes.map((id) => nodes.get(id)).filter(Boolean).map((n) => wgs84ToMetric(n.lat, n.lon));
    if (pts.length < 2) continue;
    const isClosed =
      pts.length >= 4 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    const isArea = t.area === 'yes' || isClosed;
    const obb = computeOBB(pts);
    quaysAndPiers.push({
      id: `${t.leisure === 'slipway' ? 'slipway' : 'pier'}-${el.id}`,
      osmId: el.id,
      kind: t.leisure === 'slipway' ? 'slipway' : 'pier',
      isArea,
      floating: t.floating === 'yes',
      grounded: true,
      centerXZ: obb.centerXZ,
      lengthM: isArea ? Math.max(obb.widthM, obb.depthM) : polylineLength(pts),
      widthM: isArea ? Math.min(obb.widthM, obb.depthM) : 4.0,
      rotationY: obb.rotationY,
      areaSqm: isArea ? round2(Math.abs(polygonSignedArea(pts))) : 0,
      bounds: boundsOfPoints(pts),
      pointsXZ: pts,
      tags: t
    });
  }

  // Extract straight quay wall segments inside the inner harbor from portCoastNodes
  // Note: coastline runs West -> East with LAND on the LEFT and WATER on the RIGHT.
  // In (X East, Z South), vector d=(dx, dz) has LEFT=(-dz, dx)? Wait:
  // If heading East (+1, 0), North is -Z (0, -1), Water/South is +Z (0, +1).
  // So RIGHT (Water normal) of (dx, dz) is (-dz, dx) normalized? Wait: (-0, 1) = (0, +1) South! YES!
  const quayWalls = [];
  for (let i = 0; i < coastPointsXZ.length - 1; i++) {
    const [x1, z1] = coastPointsXZ[i];
    const [x2, z2] = coastPointsXZ[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 30) continue;
    const midX = (x1 + x2) / 2;
    const midZ = (z1 + z2) / 2;
    // Filter to inner harbor quays (excluding far open beaches and outer breakwater flanks)
    if (midX < -650 || midX > 1300 || midZ < -1550 || midZ > 220) continue;
    const dx = (x2 - x1) / len;
    const dz = (z2 - z1) / len;
    quayWalls.push({
      id: `quay-wall-${i}`,
      osmId: 157394001,
      grounded: true,
      startXZ: [x1, z1],
      endXZ: [x2, z2],
      midpointXZ: [round2(midX), round2(midZ)],
      lengthM: round2(len),
      rotationY: Number((-Math.atan2(dz, dx)).toFixed(5)),
      waterNormalXZ: [Number((-dz).toFixed(4)), Number(dx.toFixed(4))]
    });
  }

  // 5. Buildings, Warehouses & Storage Tanks
  const buildings = [];
  for (const el of raw.elements) {
    if (el.type !== 'way') continue;
    const t = el.tags || {};
    if (!t.building && t.man_made !== 'storage_tank' && t.man_made !== 'gasometer') continue;
    const pts = el.nodes.map((id) => nodes.get(id)).filter(Boolean).map((n) => wgs84ToMetric(n.lat, n.lon));
    if (pts.length < 3) continue;
    const areaSqm = round2(Math.abs(polygonSignedArea(pts)));
    const obb = computeOBB(pts);
    const { subType, estimatedHeightM } = classifyBuilding(t, areaSqm);
    const zone = pointInCorePort(obb.centerXZ) && subType !== 'house' ? 'core_port' : 'surrounding';
    buildings.push({
      id: `bldg-${el.id}`,
      osmId: el.id,
      subType,
      zone,
      name: t['name:en'] || t.name || null,
      nameFa: t['name:fa'] || t.name || null,
      grounded: true,
      ...obb,
      areaSqm,
      estimatedHeightM,
      levels: t['building:levels'] ? Number(t['building:levels']) : null,
      roofShape: t['roof:shape'] || (subType === 'storage_tank' ? 'dome' : 'flat'),
      material: t['building:material'] || null,
      bounds: boundsOfPoints(pts),
      footprintXZ: pts,
      tags: t
    });
  }

  // 6. Roads
  const roads = [];
  for (const el of raw.elements) {
    if (el.type !== 'way') continue;
    const t = el.tags || {};
    if (!t.highway) continue;
    const pts = el.nodes.map((id) => nodes.get(id)).filter(Boolean).map((n) => wgs84ToMetric(n.lat, n.lon));
    if (pts.length < 2) continue;
    const center = centroidOfPoints(pts);
    const zone =
      t.highway === 'trunk' || t.highway === 'tertiary'
        ? 'arterial'
        : pointInCorePort(center)
        ? 'core_port'
        : 'surrounding';
    roads.push({
      id: `road-${el.id}`,
      osmId: el.id,
      highway: t.highway,
      zone,
      name: t['name:en'] || t.name || null,
      nameFa: t['name:fa'] || t.name || null,
      ref: t.ref || null,
      oneway: t.oneway === 'yes',
      junction: t.junction || null,
      surface: t.surface || null,
      estimatedWidthM: estimateRoadWidth(t),
      lengthM: polylineLength(pts),
      grounded: true,
      bounds: boundsOfPoints(pts),
      pointsXZ: pts,
      tags: t
    });
  }

  // 7. Industrial / Storage Yards, Parks, Military, Scrub & Grass
  const yardsAndLanduse = [];
  for (const el of raw.elements) {
    if (el.type !== 'way') continue;
    const t = el.tags || {};
    const category =
      t.landuse ||
      (t.leisure && t.leisure !== 'slipway' ? t.leisure : null) ||
      (t.natural === 'scrub' ? 'scrub' : null);
    if (!category) continue;
    const pts = el.nodes.map((id) => nodes.get(id)).filter(Boolean).map((n) => wgs84ToMetric(n.lat, n.lon));
    if (pts.length < 3) continue;
    const areaSqm = round2(Math.abs(polygonSignedArea(pts)));
    const obb = computeOBB(pts);
    yardsAndLanduse.push({
      id: `yard-${el.id}`,
      osmId: el.id,
      category,
      industrialType: t.industrial || null,
      name: t['name:en'] || t.name || null,
      nameFa: t['name:fa'] || t.name || null,
      grounded: true,
      ...obb,
      areaSqm,
      bounds: boundsOfPoints(pts),
      footprintXZ: pts,
      tags: t
    });
  }

  // 8. Port Landmarks, Seamarks & Cranes
  const landmarksAndSeamarks = [];
  for (const el of raw.elements) {
    if (el.type !== 'node') continue;
    const t = el.tags || {};
    if (!t['seamark:type'] && !t.man_made && !t.amenity && !t.place && !t.harbour) continue;
    const posXZ = wgs84ToMetric(el.lat, el.lon);
    let kind = 'landmark';
    if (t['seamark:type']) kind = `seamark:${t['seamark:type']}`;
    else if (t.man_made) kind = t.man_made;
    else if (t.amenity) kind = t.amenity;
    else if (t.place) kind = `place:${t.place}`;

    landmarksAndSeamarks.push({
      id: `landmark-${el.id}`,
      osmId: el.id,
      kind,
      name: t['name:en'] || t.name || t['seamark:name'] || null,
      nameFa: t['name:fa'] || t.name || null,
      grounded: true,
      positionXZ: posXZ,
      elevationM: t['seamark:light:height'] ? Number(t['seamark:light:height']) : null,
      seamark: t['seamark:type']
        ? {
            type: t['seamark:type'],
            colour: t['seamark:light:colour'] || null,
            character: t['seamark:light:character'] || null,
            periodSec: t['seamark:light:period'] ? Number(t['seamark:light:period']) : null,
            rangeNM: t['seamark:light:range'] ? Number(t['seamark:light:range']) : null,
            heightM: t['seamark:light:height'] ? Number(t['seamark:light:height']) : null,
            reference: t['seamark:light:reference'] || null
          }
        : null,
      tags: t
    });
  }

  // Add notable named polygon landmarks (ferry terminal, oil depot) to landmarks list for quick lookup
  for (const b of buildings) {
    if (b.subType === 'ferry_terminal' || b.subType === 'port_office') {
      landmarksAndSeamarks.push({
        id: `landmark-way-${b.osmId}`,
        osmId: b.osmId,
        kind: b.subType,
        name: b.name,
        nameFa: b.nameFa,
        grounded: true,
        positionXZ: b.centerXZ,
        elevationM: b.estimatedHeightM,
        seamark: null,
        tags: b.tags
      });
    }
  }

  const allMetricPoints = [
    ...coastPointsXZ,
    ...quaysAndPiers.flatMap((p) => p.pointsXZ),
    ...buildings.filter((b) => b.zone === 'core_port').map((b) => b.centerXZ)
  ];
  const coreBounds = boundsOfPoints(allMetricPoints);
  const fullBounds = {
    minX: Math.min(coastBounds.minX, coreBounds.minX),
    maxX: Math.max(coastBounds.maxX, coreBounds.maxX),
    minZ: Math.min(northBoundaryZ, coastBounds.minZ),
    maxZ: Math.max(southBoundaryZ, coastBounds.maxZ)
  };

  const buildingsBySubType = {};
  const buildingsByZone = {};
  for (const b of buildings) {
    buildingsBySubType[b.subType] = (buildingsBySubType[b.subType] || 0) + 1;
    buildingsByZone[b.zone] = (buildingsByZone[b.zone] || 0) + 1;
  }
  const roadsByHighway = {};
  for (const r of roads) {
    roadsByHighway[r.highway] = (roadsByHighway[r.highway] || 0) + 1;
  }

  return {
    schema: 'bahonar-port-metric/1.0',
    generatedAt: raw.queryMetadata?.fetchedAt || raw.osm3s?.timestamp_osm_base || new Date().toISOString(),
    source: {
      name: 'OpenStreetMap',
      license: 'ODbL 1.0',
      osmBaseTimestamp: raw.osm3s?.timestamp_osm_base || null,
      overpassGenerator: raw.generator || null,
      nominatimMatches: (raw.queryMetadata?.nominatim || []).map((n) => ({
        osmType: n.osm_type,
        osmId: n.osm_id,
        lat: Number(n.lat),
        lon: Number(n.lon),
        displayName: n.display_name
      }))
    },
    origin: ORIGIN,
    projection: {
      type: 'local-tangent-plane-wgs84',
      axes: {
        x: '+East (meters)',
        y: '+Up (meters)',
        z: '+South (meters); -Z = North'
      },
      metersPerDegLat: Number(SCALES.metersPerDegLat.toFixed(4)),
      metersPerDegLon: Number(SCALES.metersPerDegLon.toFixed(4))
    },
    bbox: {
      wgs84: BBOX,
      metricScene: {
        ...fullBounds,
        widthM: round2(fullBounds.maxX - fullBounds.minX),
        depthM: round2(fullBounds.maxZ - fullBounds.minZ)
      },
      metricCoastline: coastBounds
    },
    summary: {
      counts: {
        coastlines: coastlines.length,
        landPolygons: landPolygons.length,
        waterDocks: docks.length,
        harborBasins: basins.length,
        breakwaters: breakwaters.length,
        quaysAndPiers: quaysAndPiers.length,
        quayWalls: quayWalls.length,
        buildings: buildings.length,
        buildingsBySubType,
        buildingsByZone,
        roads: roads.length,
        roadsByHighway,
        yardsAndLanduse: yardsAndLanduse.length,
        landmarksAndSeamarks: landmarksAndSeamarks.length,
        osmMappedCranes: 0
      },
      notes: [
        'All coordinates in XZ plane are local metric meters relative to origin (0, 0).',
        'osmMappedCranes is 0: gantry/mobile harbor cranes, container stacks, and vessels are not mapped in OSM and are visually approximated in 3D.'
      ]
    },
    coastlines,
    landPolygons,
    waterFeatures,
    breakwaters,
    quaysAndPiers,
    quayWalls,
    buildings,
    roads,
    yardsAndLanduse,
    landmarksAndSeamarks
  };
}

export async function run({ refresh = false } = {}) {
  fs.mkdirSync(GEO_DIR, { recursive: true });

  let raw;
  if (!refresh && fs.existsSync(RAW_PATH)) {
    raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
    console.log(`[fetch-osm] Using existing raw OSM cache: ${path.relative(ROOT_DIR, RAW_PATH)}`);
  } else {
    console.log('[fetch-osm] Querying Nominatim & Overpass API for Shahid Bahonar Port...');
    let nominatim = [];
    try {
      nominatim = await fetchNominatim();
    } catch (err) {
      console.warn(`[fetch-osm] Nominatim lookup failed (continuing with Overpass): ${err.message}`);
    }
    const { endpoint, query, data } = await fetchOverpass();
    raw = filterRawToPortScope(data, nominatim, endpoint, query);
    fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2));
    console.log(`[fetch-osm] Saved raw OSM data to ${path.relative(ROOT_DIR, RAW_PATH)}`);
  }

  const metric = buildMetricDataset(raw);
  fs.writeFileSync(METRIC_PATH, JSON.stringify(metric, null, 2));
  console.log(`[fetch-osm] Wrote metric dataset to ${path.relative(ROOT_DIR, METRIC_PATH)}`);
  console.log('[fetch-osm] Summary counts:', JSON.stringify(metric.summary.counts));
  return metric;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const refresh = process.argv.includes('--refresh');
  run({ refresh }).catch((err) => {
    console.error('[fetch-osm] Fatal error:', err);
    process.exit(1);
  });
}
