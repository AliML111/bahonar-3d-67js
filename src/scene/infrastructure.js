/**
 * Port infrastructure, equipment, buildings, roads, and maritime vessels builder
 * for the 3D Shahid Bahonar Port reconstruction.
 *
 * Browser-safe ESM module producing a canonical 67js.scene fragment
 * compatible with src/scene/assemble.js and 67js-scene MCP budgets.
 */

import {
  buildVesselGeometries,
  buildVesselMaterials,
  buildVesselsLayer,
} from './vessels.js';

import expandedBuildingsData from '../../data/geodb/expanded-buildings.json' with { type: 'json' };
import shipyardFeaturesData from '../../data/geodb/shipyard-features.json' with { type: 'json' };
import groundVehiclesData from '../../data/geodb/ground-vehicles.json' with { type: 'json' };

const ROT_FLAT_XZ = [-0.7071067811865476, 0, 0, 0.7071067811865476];
const ROT_Y_90 = [0, 0.7071067811865476, 0, 0.7071067811865476];

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function quatFromAxisY(radians) {
  const half = radians * 0.5;
  return [0, round3(Math.sin(half)), 0, round3(Math.cos(half))];
}

function dedupeSequential(pts, minDist = 0.08) {
  const out = [];
  for (const p of pts) {
    if (out.length === 0) {
      out.push(p);
      continue;
    }
    const prev = out[out.length - 1];
    if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= minDist) {
      out.push(p);
    }
  }
  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < minDist) {
      out.pop();
    }
  }
  return out;
}

function toExtrudeContour(pointsXZ) {
  const pts = pointsXZ.map(([x, z]) => [round2(x), round2(-z)]);
  if (pts.length > 2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-4 && Math.abs(first[1] - last[1]) < 1e-4) {
      pts.pop();
    }
  }
  return dedupeSequential(pts, 0.08);
}

function polygonArea2D(pts) {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(area) * 0.5;
}

function pointInPolygonXZ(pt, poly) {
  if (!poly || poly.length < 3) return false;
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

function simplifyDouglasPeucker(pts, epsilon = 3.5) {
  if (!pts || pts.length <= 2) return pts || [];
  let maxDist = 0;
  let splitIdx = 0;
  const [x1, z1] = pts[0];
  const [x2, z2] = pts[pts.length - 1];
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);

  for (let i = 1; i < pts.length - 1; i++) {
    const [px, pz] = pts[i];
    const dist =
      len < 1e-6
        ? Math.hypot(px - x1, pz - z1)
        : Math.abs(dz * px - dx * pz + x2 * z1 - z2 * x1) / len;
    if (dist > maxDist) {
      maxDist = dist;
      splitIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyDouglasPeucker(pts.slice(0, splitIdx + 1), epsilon);
    const right = simplifyDouglasPeucker(pts.slice(splitIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [pts[0], pts[pts.length - 1]];
}

function clampSegmentToBounds(p0, p1, bounds) {
  const in0 =
    p0[0] >= bounds.minX &&
    p0[0] <= bounds.maxX &&
    p0[1] >= bounds.minZ &&
    p0[1] <= bounds.maxZ;
  const in1 =
    p1[0] >= bounds.minX &&
    p1[0] <= bounds.maxX &&
    p1[1] >= bounds.minZ &&
    p1[1] <= bounds.maxZ;
  if (!in0 && !in1) return null;
  const clampPt = ([x, z]) => [
    Math.min(bounds.maxX, Math.max(bounds.minX, x)),
    Math.min(bounds.maxZ, Math.max(bounds.minZ, z)),
  ];
  return [clampPt(p0), clampPt(p1)];
}

/**
 * Shared procedural patterns (6 distinct definitions; Terrain uses 4, total 10 <= 16 limit).
 */
function buildInfrastructureMaterials() {
  const concreteQuayPattern = {
    type: 'concrete',
    colors: [
      [0.48, 0.46, 0.42],
      [0.68, 0.65, 0.60],
    ],
    size: 8,
    count: 10,
    bump: 0.5,
    seed: 101,
  };

  const asphaltPattern = {
    type: 'noise',
    colors: [
      [0.14, 0.14, 0.15],
      [0.23, 0.23, 0.25],
    ],
    size: 12,
    count: 24,
    bump: 0.35,
    seed: 102,
  };

  const corrugatedMetalPattern = {
    type: 'planks',
    colors: [
      [0.64, 0.67, 0.71],
      [0.86, 0.89, 0.92],
    ],
    size: 4,
    count: 16,
    bump: 0.55,
    seed: 103,
    axis: 'x',
  };

  const paintedSteelPattern = {
    type: 'metal',
    colors: [
      [0.58, 0.60, 0.63],
      [0.82, 0.84, 0.87],
    ],
    size: 6,
    count: 12,
    bump: 0.3,
    seed: 104,
  };

  const weatheredHullPattern = {
    type: 'rust',
    colors: [
      [0.25, 0.16, 0.12],
      [0.48, 0.37, 0.31],
    ],
    size: 8,
    count: 12,
    bump: 0.48,
    seed: 105,
  };

  const plasterBuildingPattern = {
    type: 'concrete',
    colors: [
      [0.56, 0.50, 0.41],
      [0.77, 0.70, 0.59],
    ],
    size: 10,
    count: 8,
    bump: 0.35,
    seed: 106,
  };

  const baseMaterials = [
    { id: 'infra-mat-quay-concrete', pattern: concreteQuayPattern, color: [0.86, 0.84, 0.79], roughness: 0.9 },
    { id: 'infra-mat-pier-deck', pattern: concreteQuayPattern, color: [0.76, 0.74, 0.69], roughness: 0.88 },
    { id: 'infra-mat-pontoon-deck', pattern: paintedSteelPattern, color: [0.34, 0.42, 0.48], metallic: 0.25, roughness: 0.75 },
    { id: 'infra-mat-berth-yellow', color: [0.88, 0.66, 0.08], roughness: 0.62 },
    { id: 'infra-mat-road-marking', color: [0.90, 0.90, 0.88], roughness: 0.68 },
    { id: 'infra-mat-fender-rubber', color: [0.07, 0.07, 0.08], roughness: 0.92 },
    { id: 'infra-mat-bollard-steel', pattern: weatheredHullPattern, color: [0.24, 0.24, 0.26], metallic: 0.8, roughness: 0.55 },
    { id: 'infra-mat-beacon-white', color: [0.92, 0.92, 0.90], roughness: 0.45 },
    { id: 'infra-mat-beacon-red', color: [0.95, 0.12, 0.10], emission: 3.5, emissiveColor: [1.0, 0.12, 0.08], roughness: 0.2 },
    { id: 'infra-mat-beacon-green', color: [0.10, 0.92, 0.30], emission: 3.5, emissiveColor: [0.08, 1.0, 0.28], roughness: 0.2 },

    { id: 'infra-mat-asphalt', pattern: asphaltPattern, color: [0.85, 0.85, 0.88], roughness: 0.95 },
    { id: 'infra-mat-yard-paved', pattern: asphaltPattern, color: [0.96, 0.92, 0.84], roughness: 0.9 },
    { id: 'infra-mat-oil-pad', pattern: concreteQuayPattern, color: [0.78, 0.75, 0.70], roughness: 0.9 },

    { id: 'infra-mat-warehouse-wall', pattern: plasterBuildingPattern, color: [0.88, 0.84, 0.77], roughness: 0.85 },
    { id: 'infra-mat-warehouse-roof-blue', pattern: corrugatedMetalPattern, color: [0.20, 0.37, 0.56], metallic: 0.55, roughness: 0.48 },
    { id: 'infra-mat-warehouse-roof-grey', pattern: corrugatedMetalPattern, color: [0.64, 0.67, 0.70], metallic: 0.6, roughness: 0.48 },
    { id: 'infra-mat-terminal-facade', pattern: plasterBuildingPattern, color: [0.93, 0.90, 0.84], roughness: 0.74 },
    { id: 'infra-mat-terminal-glass', color: [0.14, 0.28, 0.39], metallic: 0.25, roughness: 0.12, opacity: 0.78, alphaMode: 'blend' },
    { id: 'infra-mat-port-building', pattern: plasterBuildingPattern, color: [0.82, 0.76, 0.66], roughness: 0.85 },
    { id: 'infra-mat-urban-building', pattern: plasterBuildingPattern, color: [0.78, 0.71, 0.60], roughness: 0.9 },

    { id: 'infra-mat-crane-orange', pattern: paintedSteelPattern, color: [0.82, 0.24, 0.09], metallic: 0.55, roughness: 0.42 },
    { id: 'infra-mat-crane-yellow', pattern: paintedSteelPattern, color: [0.88, 0.64, 0.08], metallic: 0.5, roughness: 0.45 },
    { id: 'infra-mat-steel-dark', pattern: paintedSteelPattern, color: [0.22, 0.24, 0.27], metallic: 0.78, roughness: 0.48 },
    { id: 'infra-mat-tank-white', pattern: paintedSteelPattern, color: [0.92, 0.93, 0.94], metallic: 0.35, roughness: 0.38 },
    { id: 'infra-mat-mast-steel', pattern: paintedSteelPattern, color: [0.72, 0.74, 0.77], metallic: 0.8, roughness: 0.4 },
    { id: 'infra-mat-floodlight-lamp', color: [1.0, 0.95, 0.82], emission: 4.0, emissiveColor: [1.0, 0.92, 0.75], roughness: 0.15 },

    { id: 'infra-mat-container-blue', pattern: corrugatedMetalPattern, color: [0.12, 0.30, 0.58], metallic: 0.45, roughness: 0.55 },
    { id: 'infra-mat-container-red', pattern: corrugatedMetalPattern, color: [0.65, 0.16, 0.14], metallic: 0.45, roughness: 0.55 },
    { id: 'infra-mat-container-green', pattern: corrugatedMetalPattern, color: [0.14, 0.42, 0.24], metallic: 0.45, roughness: 0.55 },
    { id: 'infra-mat-container-orange', pattern: corrugatedMetalPattern, color: [0.80, 0.36, 0.10], metallic: 0.45, roughness: 0.55 },

    { id: 'infra-mat-vehicle-white', color: [0.94, 0.94, 0.95], roughness: 0.35, metallic: 0.15 },
    { id: 'infra-mat-vehicle-blue', color: [0.12, 0.35, 0.72], roughness: 0.35, metallic: 0.2 },
    { id: 'infra-mat-vehicle-red', color: [0.78, 0.14, 0.12], roughness: 0.38, metallic: 0.18 },
    { id: 'infra-mat-vehicle-dark', color: [0.18, 0.20, 0.22], roughness: 0.45, metallic: 0.3 },
    { id: 'infra-mat-vehicle-yellow', color: [0.92, 0.72, 0.08], roughness: 0.4, metallic: 0.1 },
  ];

  return [...baseMaterials, ...buildVesselMaterials()];
}

function buildSharedGeometries() {
  const baseGeometries = [
    { id: 'infra-geo-box', type: 'box', bevel: 0, subdivisions: 1 },
    { id: 'infra-geo-box-bevel', type: 'box', bevel: 0.04, subdivisions: 2 },
    { id: 'infra-geo-cyl', type: 'cylinder', segments: 24, bevel: 0.02, bevelSegments: 2 },
    { id: 'infra-geo-cyl-low', type: 'cylinder', segments: 10, bevel: 0, bevelSegments: 1 },
    { id: 'infra-geo-cone-low', type: 'cone', segments: 20 },
    { id: 'infra-geo-sphere-low', type: 'sphere', segments: 12, rings: 8 },
    {
      id: 'infra-geo-gable-roof',
      type: 'extrude',
      contour: [
        [-0.5, 0],
        [0.5, 0],
        [0, 1],
      ],
      depth: 1,
      bevel: 0,
    },
    { id: 'infra-geo-vehicle-cab', type: 'box', bevel: 0.05, subdivisions: 1 },
    { id: 'infra-geo-vehicle-trailer', type: 'box', bevel: 0.02, subdivisions: 1 },
    { id: 'infra-geo-vehicle-container', type: 'box', bevel: 0.02, subdivisions: 1 },
    { id: 'infra-geo-vehicle-car', type: 'box', bevel: 0.06, subdivisions: 1 },
    { id: 'infra-geo-vehicle-van', type: 'box', bevel: 0.05, subdivisions: 1 },
  ];

  return [...baseGeometries, ...buildVesselGeometries()];
}

function getGroundElevation(x, z, elevations) {
  const { deckElevationY = 2.4, landTopY = 2.36 } = elevations;
  // Oil depot tank farm pad (terrain-yard-1549876202)
  if (x >= 420 && x <= 770 && z >= -1620 && z <= -1440) {
    return 2.45;
  }
  // Core reclaimed port apron
  if (x >= -680 && x <= 1260 && z >= -1645 && z <= 480) {
    return deckElevationY;
  }
  return landTopY;
}

function buildQuaysLayer(metricData, elevations, geometries, nodes, groundedFeatures, approximatedFeatures) {
  const { waterLevelY, deckElevationY, breakwaterTopY } = elevations;
  nodes.push({ id: 'layer-quays', label: 'Quays, Piers & Seamarks', parent: null, visible: true });

  const quayWalls = metricData?.quayWalls || [];
  let wallCount = 0;
  let fenderCount = 0;
  let bollardCount = 0;

  for (const wall of quayWalls) {
    const [sx, sz] = wall.startXZ;
    const [ex, ez] = wall.endXZ;
    const [nx, nz] = wall.waterNormalXZ || [0, 1];
    const len = wall.lengthM || Math.hypot(ex - sx, ez - sz);
    const rotY = wall.rotationY ?? Math.atan2(-(ez - sz), ex - sx);
    const mx = (sx + ex) * 0.5;
    const mz = (sz + ez) * 0.5;

    // Concrete quay wall coping & main face (shifted landward by 1.20m, providing a 0.05m seaward coping overhang and avoiding coplanar overlap with terrain boundaries)
    const wallBottom = waterLevelY - 1.5;
    const wallTop = deckElevationY + 0.25;
    const wallH = round2(wallTop - wallBottom);
    nodes.push({
      id: `infra-${wall.id}`,
      label: `Quay Wall & Coping Beam ${wall.id}`,
      parent: 'layer-quays',
      geometry: 'infra-geo-box',
      material: 'infra-mat-quay-concrete',
      translation: [round2(mx - nx * 1.20), round2(wallBottom + wallH * 0.5), round2(mz - nz * 1.20)],
      rotation: quatFromAxisY(rotY),
      scale: [round2(len), wallH, 2.5],
      receiveShadow: true,
    });
    wallCount++;

    // Yellow safety berth edge marking on quays >= 40m (chunked <= 90m)
    if (len >= 40) {
      const stripeCount = Math.max(1, Math.ceil(len / 90));
      const segLen = round2((len / stripeCount) * 0.92);
      for (let sIdx = 0; sIdx < stripeCount; sIdx++) {
        const t = (sIdx + 0.5) / stripeCount;
        const px = sx + (ex - sx) * t;
        const pz = sz + (ez - sz) * t;
        nodes.push({
          id: `infra-${wall.id}-stripe-${sIdx}`,
          label: `Berth Safety Stripe ${wall.id}`,
          parent: 'layer-quays',
          geometry: 'infra-geo-box',
          material: 'infra-mat-berth-yellow',
          translation: [round2(px - nx * 0.35), round2(wallTop + 0.02), round2(pz - nz * 0.35)],
          rotation: quatFromAxisY(rotY),
          scale: [segLen, 0.14, 0.45],
          castShadow: false,
        });
      }
    }

    // Regular cylindrical rubber fenders & twin-bitt mooring bollards along operational berths (>= 70m)
    if (len >= 100) {
      const spacing = 55;
      const count = Math.min(12, Math.max(2, Math.floor(len / spacing)));
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const px = sx + (ex - sx) * t;
        const pz = sz + (ez - sz) * t;

        // Vertical cylindrical rubber dock fender (top at Y = 2.2m, 0.2m below deck)
        nodes.push({
          id: `infra-${wall.id}-fender-${i}`,
          parent: 'layer-quays',
          geometry: 'infra-geo-cyl',
          material: 'infra-mat-fender-rubber',
          translation: [round2(px + nx * 0.28), round2(waterLevelY + 1.4), round2(pz + nz * 0.28)],
          scale: [0.75, 1.6, 0.75],
          castShadow: false,
        });
        fenderCount++;

        // Cast-steel mooring bollard (setback 1.1m from water line)
        const bId = `infra-${wall.id}-bollard-${i}`;
        const bx = round2(px - nx * 1.1);
        const bz = round2(pz - nz * 1.1);
        nodes.push({
          id: bId,
          parent: 'layer-quays',
          geometry: 'infra-geo-cyl-low',
          material: 'infra-mat-bollard-steel',
          translation: [bx, round2(wallTop + 0.38), bz],
          scale: [0.55, 0.76, 0.55],
        });
        bollardCount++;
      }
    }
  }

  // Quays, piers, floating ferry pontoons, gangway ramps & slipway decks
  const piers = metricData?.quaysAndPiers || [];
  let pierDeckCount = 0;
  for (const pier of piers) {
    if (pier.floating) {
      nodes.push({
        id: `infra-${pier.id}-deck`,
        label: `Floating Ferry Pontoon (${pier.id})`,
        parent: 'layer-quays',
        geometry: 'infra-geo-box',
        material: 'infra-mat-pontoon-deck',
        translation: [round2(pier.centerXZ[0]), 0.66, round2(pier.centerXZ[1])],
        rotation: quatFromAxisY(pier.rotationY || 0),
        scale: [round2(pier.lengthM), 0.14, round2(pier.widthM)],
        receiveShadow: true,
      });
      pierDeckCount++;
      continue;
    }

    if (pier.kind === 'slipway') {
      nodes.push(
        {
          id: `infra-${pier.id}-ramp`,
          label: `Slipway Ramp (${pier.id})`,
          parent: 'layer-quays',
          geometry: 'infra-geo-box',
          material: 'infra-mat-pier-deck',
          translation: [round2(pier.centerXZ[0]), round2(deckElevationY - 0.8), round2(pier.centerXZ[1])],
          rotation: quatFromAxisY(pier.rotationY || 0),
          scale: [round2(pier.lengthM), 1.6, round2(pier.widthM)],
          receiveShadow: true,
        },
        // Twin guide curbs along slipway edges
        {
          id: `infra-${pier.id}-curb-l`,
          parent: 'layer-quays',
          geometry: 'infra-geo-box',
          material: 'infra-mat-quay-concrete',
          translation: [round2(pier.centerXZ[0]), round2(deckElevationY + 0.18), round2(pier.centerXZ[1] - pier.widthM * 0.48)],
          rotation: quatFromAxisY(pier.rotationY || 0),
          scale: [round2(pier.lengthM), 0.45, 0.55],
        },
        {
          id: `infra-${pier.id}-curb-r`,
          parent: 'layer-quays',
          geometry: 'infra-geo-box',
          material: 'infra-mat-quay-concrete',
          translation: [round2(pier.centerXZ[0]), round2(deckElevationY + 0.18), round2(pier.centerXZ[1] + pier.widthM * 0.48)],
          rotation: quatFromAxisY(pier.rotationY || 0),
          scale: [round2(pier.lengthM), 0.45, 0.55],
        },
        // Steel winch rails down slipway ramp
        {
          id: `infra-${pier.id}-rail-l`,
          parent: 'layer-quays',
          geometry: 'infra-geo-box',
          material: 'infra-mat-steel-dark',
          translation: [round2(pier.centerXZ[0] - 1.8), round2(deckElevationY + 0.04), round2(pier.centerXZ[1])],
          rotation: quatFromAxisY(pier.rotationY || 0),
          scale: [round2(pier.lengthM * 0.94), 0.14, 0.22],
        },
        {
          id: `infra-${pier.id}-rail-r`,
          parent: 'layer-quays',
          geometry: 'infra-geo-box',
          material: 'infra-mat-steel-dark',
          translation: [round2(pier.centerXZ[0] + 1.8), round2(deckElevationY + 0.04), round2(pier.centerXZ[1])],
          rotation: quatFromAxisY(pier.rotationY || 0),
          scale: [round2(pier.lengthM * 0.94), 0.14, 0.22],
        },
        // Haulage cradle sled sitting on the rails
        {
          id: `infra-${pier.id}-cradle`,
          label: `Slipway Haulage Cradle (${pier.id})`,
          parent: 'layer-quays',
          geometry: 'infra-geo-box',
          material: 'infra-mat-crane-orange',
          translation: [round2(pier.centerXZ[0]), round2(deckElevationY + 0.45), round2(pier.centerXZ[1] - 8.0)],
          rotation: quatFromAxisY(pier.rotationY || 0),
          scale: [18.0, 0.65, 5.4],
          receiveShadow: true,
        },
      );
      pierDeckCount++;
      continue;
    }

    if (pier.isArea && pier.pointsXZ && pier.pointsXZ.length <= 5) {
      const p0 = pier.pointsXZ[0];
      const p1 = pier.pointsXZ[1];
      const p2 = pier.pointsXZ[2];
      const e01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const e12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const angle = Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]);
      nodes.push({
        id: `infra-${pier.id}-deck`,
        label: `Pier Deck (${pier.id})`,
        parent: 'layer-quays',
        geometry: 'infra-geo-box',
        material: 'infra-mat-pier-deck',
        translation: [round2(pier.centerXZ[0]), round2(deckElevationY - 0.1), round2(pier.centerXZ[1])],
        rotation: quatFromAxisY(angle),
        scale: [round2(e01), 0.42, round2(e12)],
        receiveShadow: true,
      });
      pierDeckCount++;
      continue;
    }

    if (pier.isArea && pier.pointsXZ && pier.pointsXZ.length > 5) {
      const geoId = `infra-geo-${pier.id}-cap`;
      geometries.push({
        id: geoId,
        type: 'extrude',
        contour: toExtrudeContour(pier.pointsXZ),
        depth: 0.12,
        bevel: 0,
      });
      nodes.push({
        id: `infra-${pier.id}-deck`,
        label: `Pier Apron Cap (${pier.id})`,
        parent: 'layer-quays',
        geometry: geoId,
        material: 'infra-mat-pier-deck',
        translation: [0, deckElevationY, 0],
        rotation: ROT_FLAT_XZ,
        receiveShadow: true,
      });
      pierDeckCount++;
      continue;
    }

    // Linear non-area service jetties/walkways
    nodes.push({
      id: `infra-${pier.id}-walkway`,
      label: `Service Jetty (${pier.id})`,
      parent: 'layer-quays',
      geometry: 'infra-geo-box',
      material: 'infra-mat-pier-deck',
      translation: [round2(pier.centerXZ[0]), round2(deckElevationY - 0.15), round2(pier.centerXZ[1])],
      rotation: quatFromAxisY(pier.rotationY || 0),
      scale: [round2(pier.lengthM), 1.4, round2(pier.widthM || 4)],
      receiveShadow: true,
    });
    pierDeckCount++;
  }

  // Articulated passenger gangway bridges connecting mainland coping to floating pontoons
  const pontoonCenters = [
    [31.6, -1481.0],
    [-3.8, -1480.4],
    [-35.3, -1479.8],
  ];
  pontoonCenters.forEach(([px, pz], gIdx) => {
    const rampLen = 8.4;
    nodes.push(
      {
        id: `infra-ferry-gangway-${gIdx + 1}`,
        label: `Ferry Boarding Gangway ${gIdx + 1}`,
        parent: 'layer-quays',
        geometry: 'infra-geo-box',
        material: 'infra-mat-pontoon-deck',
        translation: [px, 1.55, round2(pz - 4.1)],
        rotation: [0.122, 0, 0, 0.992],
        scale: [3.4, 0.24, rampLen],
        receiveShadow: true,
      },
      {
        id: `infra-ferry-gangway-${gIdx + 1}-rail-l`,
        parent: 'layer-quays',
        geometry: 'infra-geo-box',
        material: 'infra-mat-mast-steel',
        translation: [px - 1.6, 2.15, round2(pz - 4.1)],
        rotation: [0.122, 0, 0, 0.992],
        scale: [0.14, 1.0, rampLen],
      },
      {
        id: `infra-ferry-gangway-${gIdx + 1}-rail-r`,
        parent: 'layer-quays',
        geometry: 'infra-geo-box',
        material: 'infra-mat-mast-steel',
        translation: [px + 1.6, 2.15, round2(pz - 4.1)],
        rotation: [0.122, 0, 0, 0.992],
        scale: [0.14, 1.0, rampLen],
      },
    );
  });

  // 4 US NGA Seamark navigation light beacons from OSM landmarksAndSeamarks
  const seamarks = (metricData?.landmarksAndSeamarks || []).filter((l) => l.kind === 'seamark:light_minor');
  for (const sm of seamarks) {
    const [sx, sz] = sm.positionXZ;
    const isBreakwaterTip = sz > 500 || sx < 0;
    const baseY = isBreakwaterTip ? breakwaterTopY + 0.2 : deckElevationY;
    const towerH = sm.seamark?.heightM || 5;
    const isRed = sm.seamark?.colour === 'red';
    const gid = `infra-${sm.id}`;
    nodes.push(
      { id: gid, label: `Navigation Light (${sm.seamark?.reference || sm.id})`, parent: 'layer-quays', translation: [round2(sx), round2(baseY), round2(sz)] },
      { id: `${gid}-base`, parent: gid, geometry: 'infra-geo-cyl-low', material: 'infra-mat-beacon-white', translation: [0, 0.5, 0], scale: [2.2, 1.0, 2.2] },
      { id: `${gid}-mast`, parent: gid, geometry: 'infra-geo-cyl-low', material: 'infra-mat-beacon-white', translation: [0, round2(1.0 + towerH * 0.5), 0], scale: [0.85, towerH, 0.85] },
      {
        id: `${gid}-lantern`,
        parent: gid,
        geometry: 'infra-geo-sphere-low',
        material: isRed ? 'infra-mat-beacon-red' : 'infra-mat-beacon-green',
        translation: [0, round2(1.1 + towerH), 0],
        scale: [1.1, 1.1, 1.1],
        castShadow: false,
      },
    );
  }

  // Shipyard drydock concrete caisson gates, apron walls & keel blocks
  const drydocks = shipyardFeaturesData?.drydocks || [];
  let drydockCount = 0;
  for (let dIdx = 0; dIdx < drydocks.length; dIdx++) {
    const dd = drydocks[dIdx];
    if (dd.subType !== 'drydock') continue;
    const [cx, cz] = dd.centerXZ;
    const lenZ = dd.widthM || 180;
    const widthX = dd.depthM || 28;
    const entranceZ = dd.footprintXZ ? Math.max(...dd.footprintXZ.map((p) => p[1])) : cz + lenZ * 0.5;
    const headZ = dd.footprintXZ ? Math.min(...dd.footprintXZ.map((p) => p[1])) : cz - lenZ * 0.5;
    const minX = dd.footprintXZ ? Math.min(...dd.footprintXZ.map((p) => p[0])) : cx - widthX * 0.5;
    const maxX = dd.footprintXZ ? Math.max(...dd.footprintXZ.map((p) => p[0])) : cx + widthX * 0.5;
    const actualWidth = maxX - minX;
    const actualLen = entranceZ - headZ;

    // Concrete caisson gate sill across basin entrance
    nodes.push({
      id: `infra-drydock-${dIdx + 1}-caisson`,
      label: `Shipyard Drydock ${dIdx + 1} Caisson Gate`,
      parent: 'layer-quays',
      geometry: 'infra-geo-box',
      material: 'infra-mat-quay-concrete',
      translation: [round2((minX + maxX) * 0.5), round2(waterLevelY + 1.2), round2(entranceZ)],
      scale: [round2(actualWidth + 1.2), 3.8, 3.8],
      receiveShadow: true,
    });

    // West rim coping apron wall
    nodes.push({
      id: `infra-drydock-${dIdx + 1}-wall-west`,
      label: `Drydock ${dIdx + 1} West Coping Wall`,
      parent: 'layer-quays',
      geometry: 'infra-geo-box',
      material: 'infra-mat-quay-concrete',
      translation: [round2(minX - 0.5), round2(deckElevationY + 0.1), round2((headZ + entranceZ) * 0.5)],
      scale: [2.0, 0.8, round2(actualLen)],
      receiveShadow: true,
    });

    // East rim coping apron wall
    nodes.push({
      id: `infra-drydock-${dIdx + 1}-wall-east`,
      label: `Drydock ${dIdx + 1} East Coping Wall`,
      parent: 'layer-quays',
      geometry: 'infra-geo-box',
      material: 'infra-mat-quay-concrete',
      translation: [round2(maxX + 0.5), round2(deckElevationY + 0.1), round2((headZ + entranceZ) * 0.5)],
      scale: [2.0, 0.8, round2(actualLen)],
      receiveShadow: true,
    });

    // Head wall (South end)
    nodes.push({
      id: `infra-drydock-${dIdx + 1}-wall-head`,
      label: `Drydock ${dIdx + 1} Head Wall`,
      parent: 'layer-quays',
      geometry: 'infra-geo-box',
      material: 'infra-mat-quay-concrete',
      translation: [round2((minX + maxX) * 0.5), round2(deckElevationY + 0.1), round2(headZ - 0.5)],
      scale: [round2(actualWidth + 2.0), 0.8, 2.0],
      receiveShadow: true,
    });

    // Centerline docking keel blocks
    const blockCount = dIdx === 0 ? 10 : 8;
    const startZ = headZ + 20;
    const endZ = entranceZ - 20;
    const stepZ = (endZ - startZ) / (blockCount - 1);
    for (let k = 0; k < blockCount; k++) {
      const kz = startZ + k * stepZ;
      nodes.push({
        id: `infra-drydock-${dIdx + 1}-keel-${k}`,
        parent: 'layer-quays',
        geometry: 'infra-geo-box',
        material: 'infra-mat-quay-concrete',
        translation: [round2((minX + maxX) * 0.5), round2(waterLevelY - 0.2), round2(kz)],
        scale: [2.2, 0.8, 1.4],
      });
    }
    drydockCount++;
  }

  groundedFeatures.push(`quay-walls (${wallCount} OSM berth walls with concrete coping & safety markings)`);
  groundedFeatures.push(`piers-and-pontoons (${pierDeckCount} OSM piers, slipway & ferry pontoons with articulated gangways)`);
  groundedFeatures.push(`shipyard-drydocks (${drydockCount} concrete drydock caisson basins & marine slipway with rails & cradle)`);
  groundedFeatures.push(`seamark-lights (${seamarks.length} US NGA harbor entrance light beacons)`);
}

function buildBuildingsLayer(metricData, elevations, geometries, nodes, groundedFeatures) {
  nodes.push({ id: 'layer-buildings', label: 'Warehouses, Terminals & Port Buildings', parent: null, visible: true });

  const allBuildings = metricData?.buildings || [];
  const coreBuildings = (expandedBuildingsData?.corePortBuildings || allBuildings.filter((b) => b.zone === 'core_port')).filter((b) => b.subType !== 'storage_tank');
  const surroundingBuildings = allBuildings.filter(
    (b) =>
      b.zone !== 'core_port' &&
      b.subType !== 'storage_tank' &&
      b.centerXZ &&
      b.centerXZ[0] >= -1860 &&
      b.centerXZ[0] <= 1660 &&
      b.centerXZ[1] >= -1945 &&
      b.centerXZ[1] <= 1645
  );

  const workshopIds = new Set(shipyardFeaturesData?.workshopsCompound?.buildings || []);

  let warehouseCount = 0;
  let extrudedComplexCount = 0;
  let boxCount = 0;

  for (const b of coreBuildings) {
    const [cx, cz] = b.centerXZ;
    const baseY = getGroundElevation(cx, cz, elevations);
    const height = Math.max(3.0, b.estimatedHeightM || 6.0);

    // Major port warehouses get architectural walls, loading docks, rolling doors, roof vents & gable roof
    if (b.subType === 'warehouse') {
      const wallH = round2(height * 0.72);
      const roofH = round2(height * 0.34);
      const w = round2(Math.max(4, b.widthM || 40));
      const d = round2(Math.max(4, b.depthM || 25));
      const rotY = b.rotationY || 0;
      const gid = `infra-${b.id}`;
      const roofMat = warehouseCount % 3 === 0 ? 'infra-mat-warehouse-roof-grey' : 'infra-mat-warehouse-roof-blue';

      nodes.push(
        {
          id: gid,
          label: b.name || `Warehouse ${b.id}`,
          parent: 'layer-buildings',
          translation: [round2(cx), round2(baseY), round2(cz)],
          rotation: quatFromAxisY(rotY),
        },
        // Warehouse main exterior walls
        {
          id: `${gid}-walls`,
          parent: gid,
          geometry: 'infra-geo-box',
          material: 'infra-mat-warehouse-wall',
          translation: [0, round2(wallH * 0.5), 0],
          scale: [w, wallH, d],
          receiveShadow: true,
        },
        // Corrugated metal gable roof
        {
          id: `${gid}-roof`,
          parent: gid,
          geometry: 'infra-geo-gable-roof',
          material: roofMat,
          translation: [round2(-(w + 0.8) * 0.5), wallH, 0],
          rotation: ROT_Y_90,
          scale: [round2(d + 0.8), roofH, round2(w + 0.8)],
          receiveShadow: true,
        },
        // Continuous raised concrete loading dock platform along apron loading side (+Z)
        {
          id: `${gid}-dock`,
          parent: gid,
          geometry: 'infra-geo-box',
          material: 'infra-mat-quay-concrete',
          translation: [0, 0.55, round2(d * 0.5 + 1.8)],
          scale: [round2(w * 0.94), 1.1, 3.6],
          receiveShadow: true,
        },
        // Rolling shutter cargo doors
        {
          id: `${gid}-door-1`,
          parent: gid,
          geometry: 'infra-geo-box',
          material: 'infra-mat-steel-dark',
          translation: [round2(-w * 0.22), round2(1.1 + 2.0), round2(d * 0.5 + 0.05)],
          scale: [4.8, 4.0, 0.35],
        },
        {
          id: `${gid}-door-2`,
          parent: gid,
          geometry: 'infra-geo-box',
          material: 'infra-mat-steel-dark',
          translation: [round2(w * 0.22), round2(1.1 + 2.0), round2(d * 0.5 + 0.05)],
          scale: [4.8, 4.0, 0.35],
        },
        // Industrial ridge ventilation monitor (raised louvered clerestory)
        {
          id: `${gid}-vent`,
          parent: gid,
          geometry: 'infra-geo-box',
          material: 'infra-mat-steel-dark',
          translation: [0, round2(wallH + roofH + 0.35), 0],
          scale: [round2(w * 0.72), 0.75, 2.6],
        },
        // Symmetrical rooftop HVAC condenser units
        {
          id: `${gid}-hvac-1`,
          parent: gid,
          geometry: 'infra-geo-box',
          material: 'infra-mat-steel-dark',
          translation: [round2(-w * 0.25), round2(wallH + roofH * 0.5 + 0.45), round2(d * 0.22)],
          scale: [2.4, 1.3, 1.8],
        },
        {
          id: `${gid}-hvac-2`,
          parent: gid,
          geometry: 'infra-geo-box',
          material: 'infra-mat-steel-dark',
          translation: [round2(w * 0.25), round2(wallH + roofH * 0.5 + 0.45), round2(d * 0.22)],
          scale: [2.4, 1.3, 1.8],
        },
      );
      if (w >= 50) {
        nodes.push(
          {
            id: `${gid}-door-3`,
            parent: gid,
            geometry: 'infra-geo-box',
            material: 'infra-mat-steel-dark',
            translation: [0, round2(1.1 + 2.0), round2(d * 0.5 + 0.05)],
            scale: [4.8, 4.0, 0.35],
          },
          {
            id: `${gid}-hvac-3`,
            parent: gid,
            geometry: 'infra-geo-box',
            material: 'infra-mat-steel-dark',
            translation: [round2(-w * 0.25), round2(wallH + roofH * 0.5 + 0.45), round2(-d * 0.22)],
            scale: [2.4, 1.3, 1.8],
          },
          {
            id: `${gid}-hvac-4`,
            parent: gid,
            geometry: 'infra-geo-box',
            material: 'infra-mat-steel-dark',
            translation: [round2(w * 0.25), round2(wallH + roofH * 0.5 + 0.45), round2(-d * 0.22)],
            scale: [2.4, 1.3, 1.8],
          },
        );
      }
      warehouseCount++;
      continue;
    }

    // Shahid Bahonar Ferry Terminal: extruded footprint, entrance canopy, concourse glazing & boarding walkway
    if (b.subType === 'ferry_terminal') {
      const contour = toExtrudeContour(b.footprintXZ);
      if (contour.length >= 3 && polygonArea2D(contour) > 10) {
        const geoId = `infra-geo-${b.id}`;
        geometries.push({ id: geoId, type: 'extrude', contour, depth: round2(height), bevel: 0 });
        const gid = `infra-${b.id}`;
        nodes.push(
          {
            id: gid,
            label: b.name || 'Shahid Bahonar Ferry Terminal',
            parent: 'layer-buildings',
            geometry: geoId,
            material: 'infra-mat-terminal-facade',
            translation: [0, round2(baseY), 0],
            rotation: ROT_FLAT_XZ,
            receiveShadow: true,
          },
          // Glazed waterfront promenade band facing the floating pontoons (+Z)
          {
            id: `${gid}-glazing`,
            parent: 'layer-buildings',
            geometry: 'infra-geo-box',
            material: 'infra-mat-terminal-glass',
            translation: [round2(cx), round2(baseY + height * 0.45), round2(cz + (b.depthM || 28) * 0.46)],
            rotation: quatFromAxisY(b.rotationY || 0),
            scale: [round2((b.widthM || 70) * 0.86), round2(height * 0.42), 2.2],
            castShadow: false,
          },
          // Sweeping passenger entrance canopy on landward (-Z) access road side
          {
            id: `${gid}-canopy`,
            parent: 'layer-buildings',
            geometry: 'infra-geo-box',
            material: 'infra-mat-crane-orange',
            translation: [round2(cx), round2(baseY + height * 0.55), round2(cz - (b.depthM || 28) * 0.48 - 4.5)],
            rotation: quatFromAxisY(b.rotationY || 0),
            scale: [round2((b.widthM || 70) * 0.6), 0.45, 9.0],
            receiveShadow: true,
          },
          // Covered elevated pedestrian boarding corridor leading toward the floating pontoons
          {
            id: `${gid}-walkway`,
            parent: 'layer-buildings',
            geometry: 'infra-geo-box',
            material: 'infra-mat-terminal-facade',
            translation: [round2(cx - 24), round2(baseY + 2.2), round2(cz + (b.depthM || 28) * 0.5 + 16)],
            scale: [5.2, 4.4, 32.0],
            receiveShadow: true,
          },
          // Rooftop HVAC chiller units
          {
            id: `${gid}-hvac-1`,
            parent: 'layer-buildings',
            geometry: 'infra-geo-box',
            material: 'infra-mat-steel-dark',
            translation: [round2(cx - 16), round2(baseY + height + 0.75), round2(cz)],
            scale: [3.8, 1.5, 2.5],
          },
          {
            id: `${gid}-hvac-2`,
            parent: 'layer-buildings',
            geometry: 'infra-geo-box',
            material: 'infra-mat-steel-dark',
            translation: [round2(cx + 16), round2(baseY + height + 0.75), round2(cz)],
            scale: [3.8, 1.5, 2.5],
          },
        );
        extrudedComplexCount++;
        continue;
      }
    }

    // Complex non-rectangular core port buildings >= 320 sqm get exact extruded footprints
    if (b.footprintXZ && b.footprintXZ.length > 5 && b.areaSqm >= 320) {
      const contour = toExtrudeContour(b.footprintXZ);
      if (contour.length >= 3 && polygonArea2D(contour) > 10) {
        const geoId = `infra-geo-${b.id}`;
        geometries.push({ id: geoId, type: 'extrude', contour, depth: round2(height), bevel: 0 });
        nodes.push({
          id: `infra-${b.id}`,
          label: b.name || (workshopIds.has(b.id) ? `Port Machine Workshop (${b.id})` : `Port Building ${b.id}`),
          parent: 'layer-buildings',
          geometry: geoId,
          material: workshopIds.has(b.id)
            ? 'infra-mat-warehouse-wall'
            : b.subType === 'port_office'
              ? 'infra-mat-terminal-facade'
              : 'infra-mat-port-building',
          translation: [0, round2(baseY), 0],
          rotation: ROT_FLAT_XZ,
          receiveShadow: true,
        });
        if (workshopIds.has(b.id)) {
          nodes.push({
            id: `infra-${b.id}-rollup-door`,
            label: `Workshop ${b.id} Roll-Up Door`,
            parent: 'layer-buildings',
            geometry: 'infra-geo-box',
            material: 'infra-mat-steel-dark',
            translation: [round2(cx), round2(baseY + 1.8), round2(cz + (b.depthM || 18) * 0.48)],
            rotation: quatFromAxisY(b.rotationY || 0),
            scale: [4.8, 3.6, 0.35],
          });
        }
        extrudedComplexCount++;
        continue;
      }
    }

    // Rectangular / compact port buildings share infra-geo-box
    const w = round2(Math.max(2.5, b.widthM || 8));
    const d = round2(Math.max(2.5, b.depthM || 8));
    nodes.push({
      id: `infra-${b.id}`,
      label: b.name || (workshopIds.has(b.id) ? `Port Machine Workshop (${b.id})` : `Port Building ${b.id}`),
      parent: 'layer-buildings',
      geometry: 'infra-geo-box',
      material: workshopIds.has(b.id)
        ? 'infra-mat-warehouse-wall'
        : b.subType === 'port_office'
          ? 'infra-mat-terminal-facade'
          : 'infra-mat-port-building',
      translation: [round2(cx), round2(baseY + height * 0.5), round2(cz)],
      rotation: quatFromAxisY(b.rotationY || 0),
      scale: [w, round2(height), d],
      receiveShadow: true,
    });
    if (workshopIds.has(b.id)) {
      nodes.push({
        id: `infra-${b.id}-rollup-door`,
        label: `Workshop ${b.id} Roll-Up Door`,
        parent: 'layer-buildings',
        geometry: 'infra-geo-box',
        material: 'infra-mat-steel-dark',
        translation: [round2(cx), round2(baseY + 1.8), round2(cz + d * 0.5 + 0.05)],
        rotation: quatFromAxisY(b.rotationY || 0),
        scale: [round2(Math.min(4.8, w * 0.5)), 3.6, 0.3],
      });
    }
    boxCount++;
  }

  for (const b of surroundingBuildings) {
    const [cx, cz] = b.centerXZ;
    const baseY = getGroundElevation(cx, cz, elevations);
    const height = Math.max(3.2, b.estimatedHeightM || 5.5);
    const w = round2(Math.max(3, b.widthM || 10));
    const d = round2(Math.max(3, b.depthM || 10));
    const node = {
      id: `infra-${b.id}`,
      parent: 'layer-buildings',
      geometry: 'infra-geo-box',
      material: b.areaSqm >= 500 ? 'infra-mat-port-building' : 'infra-mat-urban-building',
      translation: [round2(cx), round2(baseY + height * 0.5), round2(cz)],
      rotation: quatFromAxisY(b.rotationY || 0),
      scale: [w, round2(height), d],
    };
    if (b.name) node.label = b.name;
    nodes.push(node);
  }

  groundedFeatures.push(
    `osm-buildings (${warehouseCount} architecturally detailed warehouses, ${extrudedComplexCount} terminals/complexes, ${boxCount} core port buildings, ${surroundingBuildings.length} major surrounding logistics/admin compounds)`,
  );
}

function buildRoadsAndYardsLayer(metricData, elevations, waterPoly, nodes, groundedFeatures, approximatedFeatures) {
  nodes.push({ id: 'layer-roads-yards', label: 'Port Road Network & Cargo Yards', parent: null, visible: true });

  const sceneBounds = metricData?.bbox?.metricScene || {
    minX: -1863,
    maxX: 1665,
    minZ: -1950,
    maxZ: 1650,
  };

  const roads = (metricData?.roads || []).filter(
    (r) => r.highway !== 'footway',
  );

  let roadSegCount = 0;
  for (const road of roads) {
    const eps = road.zone === 'arterial' ? 5.5 : road.zone === 'core_port' ? 6.5 : 9.5;
    const simplified = simplifyDouglasPeucker(road.pointsXZ || [], eps);
    const width = Math.max(4.5, road.estimatedWidthM || (road.highway === 'trunk' ? 14 : 6.5));

    for (let i = 0; i < simplified.length - 1; i++) {
      const clipped = clampSegmentToBounds(simplified[i], simplified[i + 1], sceneBounds);
      if (!clipped) continue;
      const [p0, p1] = clipped;
      const dx = p1[0] - p0[0];
      const dz = p1[1] - p0[1];
      const len = Math.hypot(dx, dz);
      if (len < 1.5) continue;

      const mx = (p0[0] + p1[0]) * 0.5;
      const mz = (p0[1] + p1[1]) * 0.5;
      const rotY = Math.atan2(-dz, dx);
      const baseY = getGroundElevation(mx, mz, elevations);
      const roadTop = baseY + 0.05;
      const roadLen = round2(len + width * 0.25);
      const roadH = round2(Math.max(0.18, roadLen * 0.0014));

      nodes.push({
        id: `infra-${road.id}-seg-${i}`,
        parent: 'layer-roads-yards',
        geometry: 'infra-geo-box',
        material: 'infra-mat-asphalt',
        translation: [round2(mx), round2(roadTop - roadH * 0.5), round2(mz)],
        rotation: quatFromAxisY(rotY),
        scale: [roadLen, roadH, round2(width)],
        castShadow: false,
        receiveShadow: true,
      });
      roadSegCount++;

      // Centerline marking on main arterial trunk highway
      if (road.highway === 'trunk' && len >= 18) {
        const dashLen = round2(Math.min(28, len * 0.68));
        nodes.push({
          id: `infra-${road.id}-line-${i}`,
          parent: 'layer-roads-yards',
          geometry: 'infra-geo-box',
          material: 'infra-mat-road-marking',
          translation: [round2(mx), round2(roadTop - 0.01), round2(mz)],
          rotation: quatFromAxisY(rotY),
          scale: [dashLen, 0.06, 0.35],
          castShadow: false,
        });
      }
    }
  }

  // Roundabout center markings on میدان شهید باهنر (around x: 327.7, z: -1674.8)
  const roundCenter = [327.7, -1674.8];
  for (let rIdx = 0; rIdx < 8; rIdx++) {
    const ang = (rIdx / 8) * Math.PI * 2;
    const rx = roundCenter[0] + Math.cos(ang) * 22;
    const rz = roundCenter[1] + Math.sin(ang) * 22;
    nodes.push({
      id: `infra-roundabout-marking-${rIdx}`,
      parent: 'layer-roads-yards',
      geometry: 'infra-geo-box',
      material: 'infra-mat-road-marking',
      translation: [round2(rx), 2.45, round2(rz)],
      rotation: quatFromAxisY(-ang + Math.PI * 0.5),
      scale: [6.2, 0.05, 0.45],
      castShadow: false,
    });
  }

  // Port Security Entrance Gatehouse, Inspection Booths & Weighbridge off بلوار پاسداران (x: 335, z: -1620)
  nodes.push(
    {
      id: 'infra-security-gatehouse',
      label: 'Port Main Security Checkpoint Gatehouse',
      parent: 'layer-roads-yards',
      geometry: 'infra-geo-box',
      material: 'infra-mat-terminal-facade',
      translation: [335, 4.4, -1620],
      scale: [9.6, 4.0, 4.8],
      receiveShadow: true,
    },
    {
      id: 'infra-security-gate-canopy',
      parent: 'layer-roads-yards',
      geometry: 'infra-geo-box',
      material: 'infra-mat-crane-orange',
      translation: [335, 6.6, -1620],
      scale: [24.0, 0.45, 9.0],
      receiveShadow: true,
    },
    {
      id: 'infra-security-barrier-in',
      parent: 'layer-roads-yards',
      geometry: 'infra-geo-box',
      material: 'infra-mat-beacon-red',
      translation: [326, 3.2, -1620],
      scale: [7.5, 0.22, 0.22],
    },
    {
      id: 'infra-security-barrier-out',
      parent: 'layer-roads-yards',
      geometry: 'infra-geo-box',
      material: 'infra-mat-beacon-red',
      translation: [344, 3.2, -1620],
      scale: [7.5, 0.22, 0.22],
    },
    // Bahonar security gate inspection booths
    {
      id: 'infra-security-booth-in',
      label: 'Security Gate Inbound Commercial Inspection Booth',
      parent: 'layer-roads-yards',
      geometry: 'infra-geo-box',
      material: 'infra-mat-terminal-facade',
      translation: [324, 3.8, -1620],
      scale: [2.4, 2.8, 3.4],
      receiveShadow: true,
    },
    {
      id: 'infra-security-booth-in-glazing',
      parent: 'layer-roads-yards',
      geometry: 'infra-geo-box',
      material: 'infra-mat-terminal-glass',
      translation: [324, 4.3, -1620],
      scale: [2.44, 1.2, 2.4],
    },
    {
      id: 'infra-security-booth-out',
      label: 'Security Gate Outbound Traffic Inspection Booth',
      parent: 'layer-roads-yards',
      geometry: 'infra-geo-box',
      material: 'infra-mat-terminal-facade',
      translation: [346, 3.8, -1620],
      scale: [2.4, 2.8, 3.4],
      receiveShadow: true,
    },
    {
      id: 'infra-security-booth-out-glazing',
      parent: 'layer-roads-yards',
      geometry: 'infra-geo-box',
      material: 'infra-mat-terminal-glass',
      translation: [346, 4.3, -1620],
      scale: [2.44, 1.2, 2.4],
    },
    {
      id: 'infra-security-customs-booth',
      label: 'Bahonar Customs Secondary Gate Inspection Booth',
      parent: 'layer-roads-yards',
      geometry: 'infra-geo-box',
      material: 'infra-mat-terminal-facade',
      translation: [335, 3.8, -1606],
      scale: [3.2, 2.8, 3.2],
      receiveShadow: true,
    },
    {
      id: 'infra-security-weighbridge-platform',
      label: 'Bahonar Gate Truck Weighbridge Platform',
      parent: 'layer-roads-yards',
      geometry: 'infra-geo-box',
      material: 'infra-mat-steel-dark',
      translation: [316, 2.52, -1624],
      scale: [4.2, 0.16, 18.0],
    },
    {
      id: 'infra-security-weighbridge-booth',
      label: 'Weighbridge Scale Operator Booth',
      parent: 'layer-roads-yards',
      geometry: 'infra-geo-box',
      material: 'infra-mat-terminal-facade',
      translation: [312, 3.8, -1624],
      scale: [2.5, 2.8, 4.0],
      receiveShadow: true,
    },
  );

  // Oil Depot concrete containment bund perimeter around yard-1549876202 (430..765, -1615..-1448)
  const oilBundSegments = [
    [597, -1612, 335, 0],
    [597, -1448, 335, 0],
    [430, -1530, 164, Math.PI * 0.5],
    [765, -1530, 164, Math.PI * 0.5],
    // Interior dividing safety bund wall
    [575, -1530, 164, Math.PI * 0.5],
  ];
  oilBundSegments.forEach(([x, z, len, rot], idx) => {
    nodes.push({
      id: `infra-oil-depot-bund-${idx}`,
      label: 'Oil Depot Containment Bund Wall',
      parent: 'layer-roads-yards',
      geometry: 'infra-geo-box',
      material: 'infra-mat-oil-pad',
      translation: [x, 3.15, z],
      rotation: quatFromAxisY(rot),
      scale: [len, 1.4, 1.4],
      receiveShadow: true,
    });
  });

  // Paved container & cargo staging yard pads verified on open port land (no water/building overlap)
  const stagingYards = [
    { id: 'west-north', label: 'West Container Staging Yard North', x: -415, z: -1280, w: 120, d: 210 },
    { id: 'west-mid', label: 'West Container Staging Yard Mid', x: -415, z: -900, w: 120, d: 220 },
    { id: 'west-south', label: 'West Container Staging Yard South', x: -415, z: -540, w: 120, d: 200 },
    { id: 'central-cargo', label: 'Central Cargo Staging Apron', x: 245, z: -760, w: 92, d: 170 },
    { id: 'se-peninsula', label: 'South-East Cargo Berth Yard', x: 410, z: -15, w: 150, d: 96 },
    { id: 'east-apron', label: 'East Terminal Staging Apron', x: 715, z: -1160, w: 115, d: 220 },
  ];

  let yardCount = 0;
  for (const y of stagingYards) {
    if (pointInPolygonXZ([y.x, y.z], waterPoly)) continue;
    const baseY = getGroundElevation(y.x, y.z, elevations);
    const yardH = round2(Math.max(0.28, Math.max(y.w, y.d) * 0.0014));
    const borderLen = round2(y.w - 3);
    const borderH = round2(Math.max(0.18, borderLen * 0.0014));
    nodes.push(
      {
        id: `infra-yard-${y.id}`,
        label: y.label,
        parent: 'layer-roads-yards',
        geometry: 'infra-geo-box',
        material: 'infra-mat-yard-paved',
        translation: [y.x, round2(baseY + 0.04 - yardH * 0.5), y.z],
        scale: [y.w, yardH, y.d],
        castShadow: false,
        receiveShadow: true,
      },
      {
        id: `infra-yard-${y.id}-border`,
        parent: 'layer-roads-yards',
        geometry: 'infra-geo-box',
        material: 'infra-mat-berth-yellow',
        translation: [y.x, round2(baseY + 0.06 - borderH * 0.5), y.z],
        scale: [borderLen, borderH, 0.45],
        castShadow: false,
      },
    );
    yardCount++;
  }

  groundedFeatures.push(`osm-roads (${roads.length} arterial & port service roads simplified to ${roadSegCount} segments)`);
  groundedFeatures.push('oil-depot-bund (Shahid Bahonar Oil Depot perimeter & dividing containment walls)');
  approximatedFeatures.push('port-security-gatehouse (Main entrance checkpoint, canopy & boom barriers off Blvd Pasdaran)');
  approximatedFeatures.push(`cargo-staging-yards (${yardCount} paved container & cargo yard pads with lane striping)`);
}

function addGantryCrane(nodes, id, label, x, baseY, z, rotY) {
  // Heavy rail-mounted quay gantry crane (double portal legs, bracing, machinery house, cab, stays & spreader)
  nodes.push(
    { id, label, parent: 'layer-equipment', translation: [round2(x), round2(baseY), round2(z)], rotation: quatFromAxisY(rotY) },
    // 4 vertical portal column legs (gauge 12m along X, span 14m along Z)
    { id: `${id}-leg-fl`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-orange', translation: [6, 11, -7], scale: [1.3, 22, 1.3] },
    { id: `${id}-leg-fr`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-orange', translation: [6, 11, 7], scale: [1.3, 22, 1.3] },
    { id: `${id}-leg-bl`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-orange', translation: [-6, 11, -7], scale: [1.3, 22, 1.3] },
    { id: `${id}-leg-br`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-orange', translation: [-6, 11, 7], scale: [1.3, 22, 1.3] },
    // Lower wheel bogies
    { id: `${id}-sill-l`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-steel-dark', translation: [0, 1.1, -7], scale: [14.4, 1.4, 1.6] },
    { id: `${id}-sill-r`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-steel-dark', translation: [0, 1.1, 7], scale: [14.4, 1.4, 1.6] },
    // Portal horizontal tie beams at Y = 11m
    { id: `${id}-tie-l`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-orange', translation: [0, 11, -7], scale: [12, 1.1, 1.1] },
    { id: `${id}-tie-r`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-orange', translation: [0, 11, 7], scale: [12, 1.1, 1.1] },
    // Main upper portal girder deck
    { id: `${id}-girder`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-orange', translation: [0, 22.5, 0], scale: [14.5, 2.2, 16.0] },
    // Machinery house on portal deck
    { id: `${id}-machinery`, parent: id, geometry: 'infra-geo-box-bevel', material: 'infra-mat-tank-white', translation: [-5.2, 25.5, 0], scale: [8.5, 3.8, 5.5] },
    // Upper A-frame tower apex rising to Y = 38m
    { id: `${id}-aframe-l`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-orange', translation: [-3, 31.5, -4], scale: [1.4, 16, 1.4] },
    { id: `${id}-aframe-r`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-orange', translation: [-3, 31.5, 4], scale: [1.4, 16, 1.4] },
    // Waterside outreach boom (extends 48m along +X over the vessel berth)
    { id: `${id}-boom`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-orange', translation: [16, 24.5, 0], scale: [48, 1.8, 3.4] },
    // Backreach boom with heavy counterweight slab
    { id: `${id}-backreach`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-orange', translation: [-14, 24.5, 0], scale: [16, 1.8, 3.4] },
    { id: `${id}-counterweight`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-steel-dark', translation: [-20, 24.5, 0], scale: [4.5, 3.2, 4.2] },
    // Diagonal boom suspension stays
    { id: `${id}-stay-mid`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-steel-dark', translation: [12, 31, 0], scale: [32, 0.25, 0.25] },
    // Movable trolley with glass operator cab
    { id: `${id}-trolley`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-yellow', translation: [24, 23.2, 0], scale: [4.2, 0.9, 3.0] },
    { id: `${id}-cab`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-terminal-glass', translation: [24, 21.4, 1.2], scale: [2.2, 2.0, 1.8], castShadow: false },
    // Telescopic container spreader headblock with twistlocks
    { id: `${id}-spreader`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-yellow', translation: [24, 14.5, 0], scale: [2.6, 0.85, 12.2] },
  );
}

function addMobileHarborCrane(nodes, id, label, x, baseY, z, rotY) {
  // Mobile harbor crane (slewing ring, multi-axle chassis, operator cab, lattice boom & hook)
  nodes.push(
    { id, label, parent: 'layer-equipment', translation: [round2(x), round2(baseY), round2(z)], rotation: quatFromAxisY(rotY) },
    // Chassis & outrigger pads
    { id: `${id}-chassis`, parent: id, geometry: 'infra-geo-box-bevel', material: 'infra-mat-steel-dark', translation: [0, 1.2, 0], scale: [12.0, 2.0, 5.6] },
    { id: `${id}-outrigger-f`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-steel-dark', translation: [5.2, 0.6, 0], scale: [1.6, 0.6, 7.8] },
    { id: `${id}-outrigger-b`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-steel-dark', translation: [-5.2, 0.6, 0], scale: [1.6, 0.6, 7.8] },
    // Slewing ring turntable base
    { id: `${id}-turntable`, parent: id, geometry: 'infra-geo-cyl-low', material: 'infra-mat-steel-dark', translation: [0, 2.5, 0], scale: [3.8, 0.8, 3.8] },
    // Tower pillar
    { id: `${id}-tower`, parent: id, geometry: 'infra-geo-cyl-low', material: 'infra-mat-crane-yellow', translation: [0, 8.5, 0], scale: [3.2, 11.5, 3.2] },
    // Elevated 360° panoramic operator cab with glass
    { id: `${id}-cab`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-terminal-glass', translation: [1.8, 12.0, 2.0], scale: [3.2, 2.6, 2.2], castShadow: false },
    // Aft counterweight block
    { id: `${id}-ballast`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-steel-dark', translation: [-3.2, 9.5, 0], scale: [4.2, 3.4, 4.4] },
    // Lattice derrick boom
    {
      id: `${id}-jib`,
      parent: id,
      geometry: 'infra-geo-box',
      material: 'infra-mat-crane-yellow',
      translation: [12.0, 22.0, 0],
      scale: [26, 1.4, 1.6],
    },
    // Hoist line & hook block
    { id: `${id}-hook`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-steel-dark', translation: [24.0, 10.0, 0], scale: [1.2, 1.8, 1.2] },
  );
}

function addReachStacker(nodes, id, x, baseY, z, rotY) {
  nodes.push(
    { id, label: `Reach Stacker ${id}`, parent: 'layer-equipment', translation: [round2(x), round2(baseY), round2(z)], rotation: quatFromAxisY(rotY) },
    { id: `${id}-body`, parent: id, geometry: 'infra-geo-box-bevel', material: 'infra-mat-crane-yellow', translation: [0, 1.4, 0], scale: [7.8, 2.2, 3.6] },
    { id: `${id}-cab`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-terminal-glass', translation: [1.4, 3.2, 0], scale: [2.4, 1.8, 2.2], castShadow: false },
    { id: `${id}-boom`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-steel-dark', translation: [2.6, 4.6, 0], scale: [8.2, 0.8, 1.0] },
    { id: `${id}-spreader`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-crane-orange', translation: [6.8, 3.8, 0], scale: [2.4, 0.7, 12.2] },
  );
}

function addFloodlightTower(nodes, id, x, baseY, z) {
  nodes.push(
    { id, label: `High-Mast Floodlight ${id}`, parent: 'layer-equipment', translation: [round2(x), round2(baseY), round2(z)] },
    { id: `${id}-pole`, parent: id, geometry: 'infra-geo-cyl-low', material: 'infra-mat-mast-steel', translation: [0, 13, 0], scale: [0.65, 26, 0.65] },
    { id: `${id}-head`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-steel-dark', translation: [0, 26.2, 0], scale: [3.4, 0.45, 1.2] },
    { id: `${id}-lamp`, parent: id, geometry: 'infra-geo-box', material: 'infra-mat-floodlight-lamp', translation: [0, 25.85, 0], scale: [3.0, 0.35, 1.0], castShadow: false },
  );
}

function buildEquipmentLayer(metricData, elevations, nodes, groundedFeatures, approximatedFeatures) {
  nodes.push({ id: 'layer-equipment', label: 'Cranes, Containers, Tanks & Masts', parent: null, visible: true });

  // 1. Mobile Harbor Cranes on Operational Cargo Quays & Finger Piers (calibrated to Google Earth)
  const mhcSpecs = [
    { id: 'infra-mhc-1', label: 'Mobile Harbor Crane 1', x: 148, z: -1219, rotY: Math.PI },
    { id: 'infra-mhc-2', label: 'Mobile Harbor Crane 2', x: 148, z: -1069, rotY: Math.PI },
    { id: 'infra-mhc-3', label: 'Mobile Harbor Crane 3', x: 430, z: -395, rotY: -1.25 },
    { id: 'infra-mhc-4', label: 'Mobile Harbor Crane 4', x: 585, z: -446, rotY: -1.25 },
  ];
  for (const m of mhcSpecs) {
    const baseY = getGroundElevation(m.x, m.z, elevations);
    addMobileHarborCrane(nodes, m.id, m.label, m.x, baseY, m.z, m.rotY);
  }

  // 2. Grounded OSM Storage Tanks with Conical Roofs & Roof Hatches
  const tanks = (metricData?.buildings || []).filter((b) => b.subType === 'storage_tank');
  for (const t of tanks) {
    const [tx, tz] = t.centerXZ;
    const baseY = getGroundElevation(tx, tz, elevations);
    const dia = round2(((t.widthM || 20) + (t.depthM || 20)) * 0.5);
    const rad = round2(dia * 0.5);
    const h = round2(t.estimatedHeightM || 12);
    const coneH = round2(Math.min(2.5, rad * 0.22));

    nodes.push(
      {
        id: `infra-${t.id}`,
        label: `Oil Storage Tank (${t.id})`,
        parent: 'layer-equipment',
        geometry: 'infra-geo-cyl',
        material: 'infra-mat-tank-white',
        translation: [round2(tx), round2(baseY + h * 0.5), round2(tz)],
        scale: [rad, h, rad],
        receiveShadow: true,
      },
      {
        id: `infra-${t.id}-cone`,
        parent: 'layer-equipment',
        geometry: 'infra-geo-cone-low',
        material: 'infra-mat-tank-white',
        translation: [round2(tx), round2(baseY + h + coneH * 0.5), round2(tz)],
        scale: [rad, coneH, rad],
      },
      {
        id: `infra-${t.id}-vent`,
        parent: 'layer-equipment',
        geometry: 'infra-geo-cyl-low',
        material: 'infra-mat-steel-dark',
        translation: [round2(tx), round2(baseY + h + coneH + 0.25), round2(tz)],
        scale: [0.9, 0.5, 0.9],
        castShadow: false,
      },
      {
        id: `infra-${t.id}-rim`,
        parent: 'layer-equipment',
        geometry: 'infra-geo-cyl',
        material: 'infra-mat-steel-dark',
        translation: [round2(tx), round2(baseY + h + 0.15), round2(tz)],
        scale: [round2(rad * 0.98), 0.3, round2(rad * 0.98)],
        castShadow: false,
      },
    );
  }

  // Elevated Manifold Pipe Racks connecting the Oil Depot bund toward the wharf
  const pipeTrestleZ = [-1570, -1530, -1490, -1450, -1410];
  pipeTrestleZ.forEach((pz, pIdx) => {
    nodes.push(
      {
        id: `infra-piperack-trestle-${pIdx + 1}`,
        label: `Pipe Rack Trestle ${pIdx + 1}`,
        parent: 'layer-equipment',
        geometry: 'infra-geo-box',
        material: 'infra-mat-mast-steel',
        translation: [450, 4.2, pz],
        scale: [0.4, 3.5, 3.8],
      },
      {
        id: `infra-pipe-1-${pIdx + 1}`,
        parent: 'layer-equipment',
        geometry: 'infra-geo-cyl-low',
        material: 'infra-mat-steel-dark',
        translation: [450, 5.2, pz],
        rotation: [0.707, 0, 0, 0.707],
        scale: [0.4, 40, 0.4],
      },
      {
        id: `infra-pipe-2-${pIdx + 1}`,
        parent: 'layer-equipment',
        geometry: 'infra-geo-cyl-low',
        material: 'infra-mat-steel-dark',
        translation: [450, 4.4, pz],
        rotation: [0.707, 0, 0, 0.707],
        scale: [0.4, 40, 0.4],
      },
    );
  });

  // 3. Grounded OSM Lattice Radio/Comms Tower
  const commsTower = (metricData?.landmarksAndSeamarks || []).find((l) => l.kind === 'tower');
  if (commsTower) {
    const [tx, tz] = commsTower.positionXZ;
    const baseY = getGroundElevation(tx, tz, elevations);
    nodes.push(
      { id: `infra-${commsTower.id}`, label: 'Port Lattice Comms Tower', parent: 'layer-equipment', translation: [round2(tx), round2(baseY), round2(tz)] },
      { id: `infra-${commsTower.id}-mast`, parent: `infra-${commsTower.id}`, geometry: 'infra-geo-cyl-low', material: 'infra-mat-mast-steel', translation: [0, 14, 0], scale: [1.4, 28, 1.4] },
      { id: `infra-${commsTower.id}-beacon`, parent: `infra-${commsTower.id}`, geometry: 'infra-geo-sphere-low', material: 'infra-mat-beacon-red', translation: [0, 28.4, 0], scale: [0.9, 0.9, 0.9], castShadow: false },
    );
  }

  // 4. Yard Cargo Handlers / Reach-Stackers in staging yards
  const stackerCoords = [
    [-370, -1240, 0.2],
    [-370, -860, 0.05],
    [245, -720, -0.3],
    [425, -20, -1.2],
  ];
  stackerCoords.forEach(([x, z, rot], idx) => {
    addReachStacker(nodes, `infra-reach-stacker-${idx + 1}`, x, getGroundElevation(x, z, elevations), z, rot);
  });

  // 8. High-Mast Floodlight Towers
  const lightMastCoords = [
    [-58, -1420],
    [-58, -1140],
    [-58, -800],
    [-58, -460],
    [-350, -1350],
    [-350, -900],
    [-350, -520],
    [168, -1350],
    [168, -900],
    [182, -460],
    [390, -370],
    [600, -455],
    [435, -60],
    [72, -1535],
  ];
  lightMastCoords.forEach(([x, z], idx) => {
    addFloodlightTower(nodes, `infra-floodlight-${idx + 1}`, x, getGroundElevation(x, z, elevations), z);
  });

  groundedFeatures.push(`storage-tanks (${tanks.length} OSM oil depot cylindrical tanks with conical roofs \u0026 pipe manifold racks)`);
  if (commsTower) groundedFeatures.push('comms-tower (OSM lattice radio tower)');
  approximatedFeatures.push(
    `port-cranes (${mhcSpecs.length} mobile harbor cranes, ${stackerCoords.length} reach-stackers)`,
  );
  approximatedFeatures.push(`floodlight-masts (${lightMastCoords.length} high-mast yard lighting towers)`);
}

/**
 * Realizes ~250 ground vehicles across customs, container yard, ferry parking,
 * apron, shipyard, and Blvd Pasdaran using batched instance nodes with realize: true.
 * Consumes under 20 realized nodes total in the scene graph.
 */
function buildVehiclesLayer(metricData, elevations, nodes, groundedFeatures) {
  nodes.push({
    id: 'layer-vehicles',
    label: 'Ground Vehicles & Port Traffic',
    parent: null,
    visible: true,
  });

  const vehicles = groundVehiclesData?.vehicles || [];
  const deckY = elevations.deckElevationY ?? 2.4;

  // 1. Customs Gate Semi-Truck Queue (38 container semi-trucks queued at customs entrance)
  // Cabs
  nodes.push({
    id: 'infra-vehicles-customs-truck-cabs',
    label: 'Customs Gate Semi-Truck Cabs (38)',
    parent: 'layer-vehicles',
    geometry: 'infra-geo-vehicle-cab',
    material: 'infra-mat-vehicle-white',
    scale: [2.5, 3.2, 3.8],
    instances: {
      scatter: {
        count: 38,
        min: [241, round2(deckY + 1.6), -1610],
        max: [329, round2(deckY + 1.6), -1455],
      },
      yaw: true,
      seed: 101,
      realize: true,
    },
  });

  // Flatbed chassis trailers
  nodes.push({
    id: 'infra-vehicles-customs-truck-trailers',
    label: 'Customs Gate Semi-Truck Chassis Trailers (38)',
    parent: 'layer-vehicles',
    geometry: 'infra-geo-vehicle-trailer',
    material: 'infra-mat-vehicle-dark',
    scale: [2.5, 1.2, 12.2],
    instances: {
      scatter: {
        count: 38,
        min: [241, round2(deckY + 0.6), -1610],
        max: [329, round2(deckY + 0.6), -1455],
      },
      yaw: true,
      seed: 101,
      realize: true,
    },
  });

  // 40ft Shipping containers loaded on trailers
  nodes.push({
    id: 'infra-vehicles-customs-truck-containers',
    label: 'Customs Gate Semi-Truck Shipping Containers (38)',
    parent: 'layer-vehicles',
    geometry: 'infra-geo-vehicle-container',
    material: 'infra-mat-vehicle-blue',
    scale: [2.44, 2.6, 12.2],
    instances: {
      scatter: {
        count: 38,
        min: [241, round2(deckY + 2.5), -1610],
        max: [329, round2(deckY + 2.5), -1455],
      },
      yaw: true,
      seed: 101,
      realize: true,
    },
  });

  // 2. Container Yard Terminal Tractors & Stackers (32 units)
  nodes.push({
    id: 'infra-vehicles-yard-tractors',
    label: 'Container Yard Terminal Tractors & Stackers (32)',
    parent: 'layer-vehicles',
    geometry: 'infra-geo-vehicle-cab',
    material: 'infra-mat-vehicle-yellow',
    scale: [2.6, 3.0, 4.2],
    instances: {
      scatter: {
        count: 32,
        min: [165, round2(deckY + 1.5), -1220],
        max: [435, round2(deckY + 1.5), -859],
      },
      yaw: true,
      seed: 202,
      realize: true,
    },
  });

  // 3. Ferry Terminal Parking Lot (72 cars, taxis, vans)
  nodes.push({
    id: 'infra-vehicles-ferry-cars-white',
    label: 'Ferry Terminal Parking Passenger Cars White (40)',
    parent: 'layer-vehicles',
    geometry: 'infra-geo-vehicle-car',
    material: 'infra-mat-vehicle-white',
    scale: [1.8, 1.5, 4.6],
    instances: {
      scatter: {
        count: 40,
        min: [-70, round2(deckY + 0.75), -1590],
        max: [110, round2(deckY + 0.75), -1460],
      },
      yaw: true,
      seed: 301,
      realize: true,
    },
  });

  nodes.push({
    id: 'infra-vehicles-ferry-cars-blue',
    label: 'Ferry Terminal Parking Passenger Cars Blue (16)',
    parent: 'layer-vehicles',
    geometry: 'infra-geo-vehicle-car',
    material: 'infra-mat-vehicle-blue',
    scale: [1.8, 1.5, 4.6],
    instances: {
      scatter: {
        count: 16,
        min: [-70, round2(deckY + 0.75), -1590],
        max: [110, round2(deckY + 0.75), -1460],
      },
      yaw: true,
      seed: 302,
      realize: true,
    },
  });

  nodes.push({
    id: 'infra-vehicles-ferry-taxis-vans',
    label: 'Ferry Terminal Taxi Queue & Passenger Vans (16)',
    parent: 'layer-vehicles',
    geometry: 'infra-geo-vehicle-van',
    material: 'infra-mat-vehicle-yellow',
    scale: [2.1, 2.2, 5.4],
    instances: {
      scatter: {
        count: 16,
        min: [-70, round2(deckY + 1.1), -1590],
        max: [110, round2(deckY + 1.1), -1460],
      },
      yaw: true,
      seed: 303,
      realize: true,
    },
  });

  // 4. Working Berth & Quay Apron Utility Pickups (28 vehicles)
  nodes.push({
    id: 'infra-vehicles-apron-pickups',
    label: 'Quay Apron Security Pickups & Maintenance Flatbeds (28)',
    parent: 'layer-vehicles',
    geometry: 'infra-geo-vehicle-van',
    material: 'infra-mat-vehicle-white',
    scale: [2.0, 1.9, 5.0],
    instances: {
      scatter: {
        count: 28,
        min: [-24, round2(deckY + 1.0), -1120],
        max: [625, round2(deckY + 1.0), -460],
      },
      yaw: true,
      seed: 404,
      realize: true,
    },
  });

  // 5. West Shipyard Maintenance Vans (22 vehicles)
  nodes.push({
    id: 'infra-vehicles-shipyard-vans',
    label: 'Shipyard Repair & Maintenance Vans (22)',
    parent: 'layer-vehicles',
    geometry: 'infra-geo-vehicle-van',
    material: 'infra-mat-vehicle-dark',
    scale: [2.1, 2.2, 5.2],
    instances: {
      scatter: {
        count: 22,
        min: [-310, round2(deckY + 1.1), -750],
        max: [863, round2(deckY + 1.1), -325],
      },
      yaw: true,
      seed: 505,
      realize: true,
    },
  });

  // 6. Boulevard Pasdaran Traffic (58 vehicles)
  nodes.push({
    id: 'infra-vehicles-pasdaran-traffic-east',
    label: 'Boulevard Pasdaran Eastbound Highway Traffic (29)',
    parent: 'layer-vehicles',
    geometry: 'infra-geo-vehicle-car',
    material: 'infra-mat-vehicle-red',
    scale: [1.8, 1.5, 4.6],
    instances: {
      scatter: {
        count: 29,
        min: [-1512, round2(deckY + 0.75), -1675],
        max: [1266, round2(deckY + 0.75), -1665],
      },
      yaw: true,
      seed: 606,
      realize: true,
    },
  });

  nodes.push({
    id: 'infra-vehicles-pasdaran-traffic-west',
    label: 'Boulevard Pasdaran Westbound Highway Traffic (29)',
    parent: 'layer-vehicles',
    geometry: 'infra-geo-vehicle-van',
    material: 'infra-mat-vehicle-white',
    scale: [2.0, 2.0, 5.0],
    instances: {
      scatter: {
        count: 29,
        min: [-1512, round2(deckY + 1.1), -1685],
        max: [1266, round2(deckY + 1.1), -1675],
      },
      yaw: true,
      seed: 607,
      realize: true,
    },
  });

  groundedFeatures.push(
    `ground-vehicles (${vehicles.length || 250} vehicles across 6 operational sectors: customs queue, yard tractors, ferry parking, quay aprons, shipyard, and Blvd Pasdaran traffic)`,
  );
}

/**
 * Builds the Stage B infrastructure fragment for Shahid Bahonar Port.
 */
export function buildInfrastructureFragment(metricData, options = {}) {
  const elevations = {
    waterLevelY: options.waterLevelY ?? 0,
    deckElevationY: options.deckElevationY ?? 2.4,
    breakwaterTopY: options.breakwaterTopY ?? 4.3,
    landTopY: options.landTopY ?? 2.36,
  };

  const geometries = buildSharedGeometries();
  const materials = buildInfrastructureMaterials();
  const nodes = [];
  const groundedFeatures = [];
  const approximatedFeatures = [];

  const waterPoly = metricData?.waterFeatures?.harborWaterPolygon?.polygonXZ || [];

  buildQuaysLayer(metricData, elevations, geometries, nodes, groundedFeatures, approximatedFeatures);
  buildBuildingsLayer(metricData, elevations, geometries, nodes, groundedFeatures);
  buildRoadsAndYardsLayer(metricData, elevations, waterPoly, nodes, groundedFeatures, approximatedFeatures);
  buildEquipmentLayer(metricData, elevations, nodes, groundedFeatures, approximatedFeatures);
  buildVehiclesLayer(metricData, elevations, nodes, groundedFeatures);
  buildVesselsLayer(waterPoly, nodes, approximatedFeatures, options);

  return {
    geometries,
    materials,
    nodes,
    metadata: {
      groundedFeatures,
      approximatedFeatures,
    },
  };
}

/**
 * Builds a complete standalone Stage B 67js.scene recipe for isolated verification or preview.
 */
export function buildStageBRecipe(metricData, options = {}) {
  const fragment = buildInfrastructureFragment(metricData, options);
  return {
    format: '67js.scene',
    schemaVersion: 1,
    geometries: fragment.geometries,
    materials: fragment.materials,
    nodes: fragment.nodes,
    camera: options.camera || {
      eye: [-650, 320, 420],
      target: [120, 6, -680],
      up: [0, 1, 0],
      fov: 45,
      near: 1.5,
      far: 20000,
    },
    environment: {
      world: true,
      setup: options.setup || 'daylight',
      ground: false,
      fogDensity: 0.00012,
    },
    effects: {
      exposure: 1.0,
      bloom: { strength: 0.1, threshold: 1.1, radius: 1.0 },
    },
    shadow: {
      target: [100, 5, -600],
      extent: 1850,
      distance: 3200,
      near: 50,
      far: 7500,
    },
  };
}
