/**
 * Maritime vessel models and harbor craft builder for Shahid Bahonar Port.
 * Browser-safe ESM module (no Node built-ins) producing high-fidelity,
 * PBR-textured, proportion-accurate vessels adhering to 67js.scene MCP budgets.
 *
 * Owned by @fleet-vessels.
 */

import dhowBerthsData from '../../data/geodb/dhow-berths.json';
import shipyardFeaturesData from '../../data/geodb/shipyard-features.json';
import vesselBerthsData from '../../data/geodb/vessel-berths.json';
import gridEnrichedData from '../../data/geodb/grid-enriched-features.json';

const ROT_FLAT_XZ = [-0.7071067811865476, 0, 0, 0.7071067811865476];

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

/**
 * Returns shared 67js geometries for all vessel types (<= 25 total).
 */
export function buildVesselGeometries() {
  return [
    { id: 'vessel-geo-box', type: 'box', bevel: 0, subdivisions: 1 },
    { id: 'vessel-geo-box-bevel', type: 'box', bevel: 0.04, subdivisions: 2 },
    { id: 'vessel-geo-cyl', type: 'cylinder', segments: 18, bevel: 0.02, bevelSegments: 2 },
    { id: 'vessel-geo-cyl-low', type: 'cylinder', segments: 10, bevel: 0, bevelSegments: 1 },
    { id: 'vessel-geo-sphere', type: 'sphere', segments: 14, rings: 10 },

    // Commercial ship hull: flared clipper bow, parallel midbody, rounded transom
    {
      id: 'vessel-geo-hull-commercial',
      type: 'extrude',
      contour: [
        [-0.49, -0.28],
        [-0.47, -0.42],
        [-0.34, -0.50],
        [0.22, -0.50],
        [0.37, -0.42],
        [0.46, -0.24],
        [0.50, 0.0],
        [0.46, 0.24],
        [0.37, 0.42],
        [0.22, 0.50],
        [-0.34, 0.50],
        [-0.47, 0.42],
        [-0.49, 0.28],
        [-0.50, 0.14],
        [-0.50, -0.14],
      ],
      depth: 1,
      bevel: 0.015,
      bevelSegments: 2,
    },

    // High-speed passenger catamaran slender demi-hull with wave-piercing fine bow
    {
      id: 'vessel-geo-catamaran-demi',
      type: 'extrude',
      contour: [
        [-0.48, -0.44],
        [-0.30, -0.50],
        [0.15, -0.48],
        [0.35, -0.34],
        [0.47, -0.16],
        [0.50, 0.0],
        [0.47, 0.16],
        [0.35, 0.34],
        [0.15, 0.48],
        [-0.30, 0.50],
        [-0.48, 0.44],
        [-0.50, 0.20],
        [-0.50, -0.20],
      ],
      depth: 1,
      bevel: 0.02,
      bevelSegments: 2,
    },

    // Catamaran central bridgedeck tunnel structure
    {
      id: 'vessel-geo-bridgedeck',
      type: 'box',
      bevel: 0.03,
      subdivisions: 1,
    },

    // Persian Gulf wooden Lenj cargo dhow: sweeping raked stempost & high transom
    {
      id: 'vessel-geo-dhow-hull',
      type: 'extrude',
      contour: [
        [-0.48, -0.22],
        [-0.32, -0.46],
        [-0.05, -0.50],
        [0.22, -0.44],
        [0.40, -0.26],
        [0.52, 0.0],
        [0.40, 0.26],
        [0.22, 0.44],
        [-0.05, 0.50],
        [-0.32, 0.46],
        [-0.48, 0.22],
        [-0.49, 0.0],
      ],
      depth: 1,
      bevel: 0.015,
      bevelSegments: 2,
    },

    // Damen ASD 2810 style harbor tug: rounded pushing bow & tumblehome lines
    {
      id: 'vessel-geo-tug-hull',
      type: 'extrude',
      contour: [
        [-0.46, -0.38],
        [-0.24, -0.50],
        [0.14, -0.48],
        [0.36, -0.38],
        [0.47, -0.22],
        [0.50, 0.0],
        [0.47, 0.22],
        [0.36, 0.38],
        [0.14, 0.48],
        [-0.24, 0.50],
        [-0.46, 0.38],
        [-0.50, 0.24],
        [-0.50, -0.24],
      ],
      depth: 1,
      bevel: 0.02,
      bevelSegments: 2,
    },

    // Deep-V fast pilot boat & patrol interceptor planing hull
    {
      id: 'vessel-geo-pilot-hull',
      type: 'extrude',
      contour: [
        [-0.48, -0.42],
        [-0.20, -0.48],
        [0.16, -0.44],
        [0.38, -0.28],
        [0.50, 0.0],
        [0.38, 0.28],
        [0.16, 0.44],
        [-0.20, 0.48],
        [-0.48, 0.42],
        [-0.50, 0.20],
        [-0.50, -0.20],
      ],
      depth: 1,
      bevel: 0.02,
      bevelSegments: 2,
    },

    // Hydrodynamic bulbous bow pod for commercial vessels
    {
      id: 'vessel-geo-bulbous-bow',
      type: 'cylinder',
      segments: 16,
      bevel: 0.35,
      bevelSegments: 4,
    },

    // Multi-tier bridge superstructure with extended bridge wings
    {
      id: 'vessel-geo-bridge-wings',
      type: 'box',
      bevel: 0.04,
      subdivisions: 1,
    },

    // Raked company exhaust funnel casing
    {
      id: 'vessel-geo-funnel-raked',
      type: 'cylinder',
      segments: 18,
      bevel: 0.08,
      bevelSegments: 2,
    },

    // Lattice / cross-tree radar mast
    {
      id: 'vessel-geo-radar-mast',
      type: 'box',
      bevel: 0.02,
      subdivisions: 1,
    },

    // SOLAS enclosed high-visibility orange lifeboat
    {
      id: 'vessel-geo-lifeboat',
      type: 'cylinder',
      segments: 14,
      bevel: 0.4,
      bevelSegments: 3,
    },

    // Deck crane slewing pedestal
    {
      id: 'vessel-geo-crane-pedestal',
      type: 'cylinder',
      segments: 16,
      bevel: 0.04,
      bevelSegments: 2,
    },

    // Deck crane operator cab & housing
    {
      id: 'vessel-geo-crane-cab',
      type: 'box',
      bevel: 0.05,
      subdivisions: 1,
    },

    // Deck crane wire-luffing boom jib
    {
      id: 'vessel-geo-crane-jib',
      type: 'box',
      bevel: 0.02,
      subdivisions: 1,
    },

    // Raised cargo hold hatch coaming
    {
      id: 'vessel-geo-hatch-coaming',
      type: 'box',
      bevel: 0.03,
      subdivisions: 1,
    },

    // Canvas/tarpaulin mound for dhow cargo hold
    {
      id: 'vessel-geo-tarp-cargo',
      type: 'cylinder',
      segments: 16,
      bevel: 0.45,
      bevelSegments: 3,
    },

    // Heavy cylindrical rubber bow push fender for tugs
    {
      id: 'vessel-geo-fender-bow',
      type: 'cylinder',
      segments: 18,
      bevel: 0.15,
      bevelSegments: 2,
    },

    // Tapered hydrodynamic wake foam wedge for moving vessels
    {
      id: 'vessel-geo-wake-wedge',
      type: 'extrude',
      contour: [
        [-0.50, -0.50],
        [0.50, -0.05],
        [0.50, 0.05],
        [-0.50, 0.50],
      ],
      depth: 1,
      bevel: 0,
    },

    // 40ft container bay stack tier block
    {
      id: 'vessel-geo-container-bay',
      type: 'box',
      bevel: 0.02,
      subdivisions: 1,
    },
  ];
}

/**
 * Returns refined PBR materials for all vessel classes (<= 24 total).
 */
export function buildVesselMaterials() {
  return [
    { id: 'vessel-mat-boot-red', color: [0.60, 0.12, 0.09], metallic: 0.20, roughness: 0.65 },
    { id: 'vessel-mat-hull-navy', color: [0.10, 0.15, 0.22], metallic: 0.38, roughness: 0.45 },
    { id: 'vessel-mat-hull-black', color: [0.08, 0.08, 0.10], metallic: 0.28, roughness: 0.52 },
    { id: 'vessel-mat-hull-green', color: [0.08, 0.26, 0.17], metallic: 0.32, roughness: 0.46 },
    { id: 'vessel-mat-ship-white', color: [0.94, 0.95, 0.96], metallic: 0.18, roughness: 0.35 },
    { id: 'vessel-mat-deck-grey', color: [0.35, 0.37, 0.39], metallic: 0.32, roughness: 0.72 },
    { id: 'vessel-mat-deck-green', color: [0.15, 0.31, 0.22], metallic: 0.22, roughness: 0.68 },
    {
      id: 'vessel-mat-bridge-glass',
      color: [0.12, 0.24, 0.32],
      metallic: 0.30,
      roughness: 0.10,
      opacity: 0.82,
      alphaMode: 'blend',
    },
    { id: 'vessel-mat-funnel-orange', color: [0.86, 0.36, 0.08], metallic: 0.42, roughness: 0.38 },
    { id: 'vessel-mat-funnel-band', color: [0.96, 0.96, 0.97], metallic: 0.20, roughness: 0.32 },
    { id: 'vessel-mat-mast-steel', color: [0.70, 0.72, 0.75], metallic: 0.78, roughness: 0.38 },
    { id: 'vessel-mat-crane-yellow', color: [0.86, 0.66, 0.08], metallic: 0.45, roughness: 0.42 },
    { id: 'vessel-mat-hatch-oxide', color: [0.52, 0.16, 0.12], metallic: 0.22, roughness: 0.62 },
    { id: 'vessel-mat-lifeboat-orange', color: [0.96, 0.34, 0.05], metallic: 0.12, roughness: 0.32 },
    { id: 'vessel-mat-ferry-blue', color: [0.06, 0.46, 0.66], metallic: 0.28, roughness: 0.34 },
    { id: 'vessel-mat-dhow-wood', color: [0.42, 0.26, 0.14], roughness: 0.78 },
    { id: 'vessel-mat-dhow-trim', color: [0.88, 0.90, 0.88], roughness: 0.58 },
    { id: 'vessel-mat-tarp-olive', color: [0.28, 0.33, 0.20], roughness: 0.88 },
    { id: 'vessel-mat-tarp-tan', color: [0.66, 0.56, 0.42], roughness: 0.85 },
    { id: 'vessel-mat-fender-rubber', color: [0.06, 0.06, 0.07], roughness: 0.94 },
    { id: 'vessel-mat-pilot-orange', color: [0.92, 0.32, 0.06], metallic: 0.26, roughness: 0.34 },
    {
      id: 'vessel-mat-wake-foam',
      color: [0.92, 0.97, 1.0],
      opacity: 0.52,
      alphaMode: 'blend',
      roughness: 0.25,
    },
    { id: 'vessel-mat-container-blue', color: [0.10, 0.28, 0.56], metallic: 0.38, roughness: 0.52 },
    { id: 'vessel-mat-container-red', color: [0.66, 0.16, 0.12], metallic: 0.38, roughness: 0.52 },
    { id: 'vessel-mat-container-green', color: [0.12, 0.42, 0.24], metallic: 0.38, roughness: 0.52 },
    { id: 'vessel-mat-radar-scanner', color: [0.95, 0.96, 0.98], metallic: 0.30, roughness: 0.25 },
  ];
}

function addContainerShip(nodes, id, label, x, z, rotY, lengthM, beamM, freeboardM) {
  const draft = 4.0;
  const fb = freeboardM;
  const hullMat = id.includes('inbound') ? 'vessel-mat-hull-green' : 'vessel-mat-hull-navy';

  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },

    // 1. Underwater red boot-topping hull
    {
      id: `${id}-boot`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: 'vessel-mat-boot-red',
      translation: [0, -draft, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.985), round2(beamM * 0.985), draft],
    },
    // Bulbous bow pod
    {
      id: `${id}-bulb`,
      parent: id,
      geometry: 'vessel-geo-bulbous-bow',
      material: 'vessel-mat-boot-red',
      translation: [round2(lengthM * 0.485), round2(-draft * 0.55), 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.08), round2(beamM * 0.22), round2(draft * 0.7)],
    },
    // 2. Freeboard topside hull
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: hullMat,
      translation: [0, 0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [lengthM, beamM, fb],
      receiveShadow: true,
    },
    // 3. Main weather deck
    {
      id: `${id}-deck`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: 'vessel-mat-deck-grey',
      translation: [0, fb, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.97), round2(beamM * 0.93), 0.2],
      receiveShadow: true,
    },
    // 4. Raised forecastle head with anchor windlasses
    {
      id: `${id}-forecastle`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: hullMat,
      translation: [round2(lengthM * 0.41), round2(fb + 1.1), 0],
      scale: [round2(lengthM * 0.14), 2.2, round2(beamM * 0.78)],
    },
    {
      id: `${id}-forecastle-deck`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-deck-green',
      translation: [round2(lengthM * 0.41), round2(fb + 2.22), 0],
      scale: [round2(lengthM * 0.135), 0.15, round2(beamM * 0.74)],
    },
    {
      id: `${id}-windlass-port`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-mast-steel',
      translation: [round2(lengthM * 0.42), round2(fb + 2.6), round2(-beamM * 0.22)],
      scale: [1.2, 0.8, 1.2],
    },
    {
      id: `${id}-windlass-stbd`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-mast-steel',
      translation: [round2(lengthM * 0.42), round2(fb + 2.6), round2(beamM * 0.22)],
      scale: [1.2, 0.8, 1.2],
    },

    // 5. Aft 4-tier white accommodation deckhouse & extended bridge wings
    {
      id: `${id}-bridge-lower`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.33), round2(fb + 2.6), 0],
      scale: [round2(lengthM * 0.16), 5.2, round2(beamM * 0.78)],
      receiveShadow: true,
    },
    {
      id: `${id}-bridge-upper`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.33), round2(fb + 6.4), 0],
      scale: [round2(lengthM * 0.13), 2.6, round2(beamM * 0.76)],
    },
    {
      id: `${id}-bridge-wings`,
      parent: id,
      geometry: 'vessel-geo-bridge-wings',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.32), round2(fb + 9.0), 0],
      scale: [round2(lengthM * 0.10), 2.6, round2(beamM * 0.98)],
    },
    {
      id: `${id}-bridge-glass`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [round2(-lengthM * 0.295), round2(fb + 9.2), 0],
      scale: [round2(lengthM * 0.045), 1.4, round2(beamM * 0.96)],
      castShadow: false,
    },
    {
      id: `${id}-bridge-roof`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-deck-grey',
      translation: [round2(-lengthM * 0.32), round2(fb + 10.4), 0],
      scale: [round2(lengthM * 0.105), 0.2, round2(beamM * 1.0)],
    },

    // 6. SOLAS enclosed lifeboats on davits
    {
      id: `${id}-lifeboat-port`,
      parent: id,
      geometry: 'vessel-geo-lifeboat',
      material: 'vessel-mat-lifeboat-orange',
      translation: [round2(-lengthM * 0.33), round2(fb + 5.5), round2(-beamM * 0.44)],
      rotation: ROT_FLAT_XZ,
      scale: [7.2, 2.4, 2.0],
    },
    {
      id: `${id}-lifeboat-stbd`,
      parent: id,
      geometry: 'vessel-geo-lifeboat',
      material: 'vessel-mat-lifeboat-orange',
      translation: [round2(-lengthM * 0.33), round2(fb + 5.5), round2(beamM * 0.44)],
      rotation: ROT_FLAT_XZ,
      scale: [7.2, 2.4, 2.0],
    },

    // 7. Funnel with company livery band & radar mast with radome
    {
      id: `${id}-funnel`,
      parent: id,
      geometry: 'vessel-geo-funnel-raked',
      material: 'vessel-mat-funnel-orange',
      translation: [round2(-lengthM * 0.395), round2(fb + 10.5), 0],
      scale: [3.4, 6.2, 2.6],
    },
    {
      id: `${id}-funnel-band`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-funnel-band',
      translation: [round2(-lengthM * 0.395), round2(fb + 11.8), 0],
      scale: [3.5, 1.2, 2.7],
    },
    {
      id: `${id}-mast`,
      parent: id,
      geometry: 'vessel-geo-radar-mast',
      material: 'vessel-mat-mast-steel',
      translation: [round2(-lengthM * 0.32), round2(fb + 14.5), 0],
      scale: [1.8, 8.0, 4.2],
    },
    {
      id: `${id}-radome`,
      parent: id,
      geometry: 'vessel-geo-sphere',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.32), round2(fb + 19.0), 0],
      scale: [1.2, 1.4, 1.2],
    },
    {
      id: `${id}-radar-scanner`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-radar-scanner',
      translation: [round2(-lengthM * 0.305), round2(fb + 16.4), 0],
      scale: [0.45, 0.28, 3.6],
    },
    {
      id: `${id}-bulwark-port`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-ship-white',
      translation: [round2(lengthM * 0.04), round2(fb + 0.55), round2(-beamM * 0.455)],
      scale: [round2(lengthM * 0.62), 1.1, 0.28],
    },
    {
      id: `${id}-bulwark-stbd`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-ship-white',
      translation: [round2(lengthM * 0.04), round2(fb + 0.55), round2(beamM * 0.455)],
      scale: [round2(lengthM * 0.62), 1.1, 0.28],
    },
    {
      id: `${id}-radar-scanner-xband`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.31), round2(fb + 16.2), 0],
      scale: [0.4, 0.35, 3.6],
    },
    {
      id: `${id}-bulwark-bow`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: hullMat,
      translation: [round2(lengthM * 0.46), round2(fb + 2.8), 0],
      scale: [round2(lengthM * 0.05), 1.2, round2(beamM * 0.56)],
    },
  );

  // 8. TEU container stack bays with tiered heights & realistic container colors
  const containerMats = [
    'vessel-mat-container-blue',
    'vessel-mat-container-red',
    'vessel-mat-container-green',
    'vessel-mat-funnel-orange',
  ];
  const bayTiers = [3, 4, 3, 2];
  const bayOffsets = [-0.20, -0.06, 0.08, 0.22];

  for (let b = 0; b < 4; b++) {
    const bayX = lengthM * bayOffsets[b];
    const tiers = bayTiers[b];
    const mat = containerMats[b % containerMats.length];
    const h = tiers * 2.6;

    nodes.push({
      id: `${id}-cargo-bay-${b}`,
      parent: id,
      geometry: 'vessel-geo-container-bay',
      material: mat,
      translation: [round2(bayX), round2(fb + 0.1 + h * 0.5), 0],
      scale: [round2(lengthM * 0.11), round2(h), round2(beamM * 0.74)],
      receiveShadow: true,
    });

    // Lashing bridges between container bays
    if (b < 3) {
      const bridgeX = bayX + lengthM * 0.07;
      nodes.push({
        id: `${id}-lashing-bridge-${b}`,
        parent: id,
        geometry: 'vessel-geo-box',
        material: 'vessel-mat-mast-steel',
        translation: [round2(bridgeX), round2(fb + 3.8), 0],
        scale: [1.2, 7.6, round2(beamM * 0.78)],
      });
    }
  }
}

function addGeneralCargoShip(nodes, id, label, x, z, rotY, lengthM, beamM, freeboardM) {
  const draft = 3.8;
  const fb = freeboardM;
  const hullMat = id.includes('cargo-3') ? 'vessel-mat-hull-black' : 'vessel-mat-hull-navy';

  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },

    // 1. Underwater boot-topping & bulbous bow
    {
      id: `${id}-boot`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: 'vessel-mat-boot-red',
      translation: [0, -draft, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.985), round2(beamM * 0.985), draft],
    },
    {
      id: `${id}-bulb`,
      parent: id,
      geometry: 'vessel-geo-bulbous-bow',
      material: 'vessel-mat-boot-red',
      translation: [round2(lengthM * 0.485), round2(-draft * 0.55), 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.075), round2(beamM * 0.20), round2(draft * 0.65)],
    },
    // 2. Topsides & deck
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: hullMat,
      translation: [0, 0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [lengthM, beamM, fb],
      receiveShadow: true,
    },
    {
      id: `${id}-deck`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: 'vessel-mat-deck-grey',
      translation: [0, fb, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.97), round2(beamM * 0.93), 0.2],
      receiveShadow: true,
    },

    // 3. Forecastle head with windlasses
    {
      id: `${id}-forecastle`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: hullMat,
      translation: [round2(lengthM * 0.41), round2(fb + 1.0), 0],
      scale: [round2(lengthM * 0.14), 2.0, round2(beamM * 0.76)],
    },
    {
      id: `${id}-forecastle-deck`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-deck-green',
      translation: [round2(lengthM * 0.41), round2(fb + 2.02), 0],
      scale: [round2(lengthM * 0.135), 0.15, round2(beamM * 0.72)],
    },
    {
      id: `${id}-windlass`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-mast-steel',
      translation: [round2(lengthM * 0.42), round2(fb + 2.4), 0],
      scale: [1.2, 0.7, 2.4],
    },

    // 4. Aft accommodation deckhouse & bridge
    {
      id: `${id}-bridge-lower`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.33), round2(fb + 2.4), 0],
      scale: [round2(lengthM * 0.15), 4.8, round2(beamM * 0.76)],
      receiveShadow: true,
    },
    {
      id: `${id}-bridge-wings`,
      parent: id,
      geometry: 'vessel-geo-bridge-wings',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.32), round2(fb + 6.0), 0],
      scale: [round2(lengthM * 0.09), 2.4, round2(beamM * 0.96)],
    },
    {
      id: `${id}-bridge-glass`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [round2(-lengthM * 0.295), round2(fb + 6.2), 0],
      scale: [round2(lengthM * 0.04), 1.3, round2(beamM * 0.94)],
      castShadow: false,
    },
    {
      id: `${id}-funnel`,
      parent: id,
      geometry: 'vessel-geo-funnel-raked',
      material: 'vessel-mat-funnel-orange',
      translation: [round2(-lengthM * 0.39), round2(fb + 7.8), 0],
      scale: [3.0, 5.2, 2.2],
    },
    {
      id: `${id}-funnel-band`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-funnel-band',
      translation: [round2(-lengthM * 0.39), round2(fb + 8.8), 0],
      scale: [3.1, 1.0, 2.3],
    },
    {
      id: `${id}-mast`,
      parent: id,
      geometry: 'vessel-geo-radar-mast',
      material: 'vessel-mat-mast-steel',
      translation: [round2(-lengthM * 0.32), round2(fb + 10.8), 0],
      scale: [1.6, 7.2, 3.8],
    },
    {
      id: `${id}-radome`,
      parent: id,
      geometry: 'vessel-geo-sphere',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.32), round2(fb + 14.8), 0],
      scale: [1.0, 1.2, 1.0],
    },
    {
      id: `${id}-radar-scanner`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.31), round2(fb + 12.6), 0],
      scale: [0.35, 0.3, 3.2],
    },
    {
      id: `${id}-bulwark-bow`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: hullMat,
      translation: [round2(lengthM * 0.455), round2(fb + 2.5), 0],
      scale: [round2(lengthM * 0.05), 1.1, round2(beamM * 0.54)],
    },
    {
      id: `${id}-lifeboat-port`,
      parent: id,
      geometry: 'vessel-geo-lifeboat',
      material: 'vessel-mat-lifeboat-orange',
      translation: [round2(-lengthM * 0.33), round2(fb + 4.8), round2(-beamM * 0.43)],
      rotation: ROT_FLAT_XZ,
      scale: [6.5, 2.2, 1.8],
    },
    {
      id: `${id}-lifeboat-stbd`,
      parent: id,
      geometry: 'vessel-geo-lifeboat',
      material: 'vessel-mat-lifeboat-orange',
      translation: [round2(-lengthM * 0.33), round2(fb + 4.8), round2(beamM * 0.43)],
      rotation: ROT_FLAT_XZ,
      scale: [6.5, 2.2, 1.8],
    },
  );

  // 5. Raised cargo hatch coamings with folding panel covers
  for (let h = 0; h < 3; h++) {
    const hx = -lengthM * 0.13 + h * lengthM * 0.19;
    nodes.push(
      {
        id: `${id}-hatch-${h}`,
        parent: id,
        geometry: 'vessel-geo-hatch-coaming',
        material: 'vessel-mat-hatch-oxide',
        translation: [round2(hx), round2(fb + 0.9), 0],
        scale: [round2(lengthM * 0.13), 1.8, round2(beamM * 0.58)],
        receiveShadow: true,
      },
      {
        id: `${id}-hatch-cover-${h}`,
        parent: id,
        geometry: 'vessel-geo-box',
        material: 'vessel-mat-hatch-oxide',
        translation: [round2(hx), round2(fb + 1.85), 0],
        scale: [round2(lengthM * 0.125), 0.2, round2(beamM * 0.55)],
      },
    );
  }

  // 6. Centerline electro-hydraulic pedestal deck cranes with operator cab & luffing wire boom
  for (let c = 0; c < 2; c++) {
    const cx = -lengthM * 0.035 + c * lengthM * 0.19;
    nodes.push(
      {
        id: `${id}-crane-pedestal-${c}`,
        parent: id,
        geometry: 'vessel-geo-crane-pedestal',
        material: 'vessel-mat-crane-yellow',
        translation: [round2(cx), round2(fb + 3.2), 0],
        scale: [2.0, 6.4, 2.0],
      },
      {
        id: `${id}-crane-cab-${c}`,
        parent: id,
        geometry: 'vessel-geo-crane-cab',
        material: 'vessel-mat-crane-yellow',
        translation: [round2(cx + 0.8), round2(fb + 6.8), 0.8],
        scale: [2.6, 2.2, 2.0],
      },
      {
        id: `${id}-crane-jib-${c}`,
        parent: id,
        geometry: 'vessel-geo-crane-jib',
        material: 'vessel-mat-crane-yellow',
        translation: [round2(cx + 6.8), round2(fb + 9.8), 0],
        rotation: [0, 0, 0.38, 0.925],
        scale: [16.0, 0.9, 0.9],
      },
      {
        id: `${id}-crane-hook-${c}`,
        parent: id,
        geometry: 'vessel-geo-box',
        material: 'vessel-mat-mast-steel',
        translation: [round2(cx + 12.8), round2(fb + 4.5), 0],
        scale: [0.4, 1.8, 0.4],
      },
    );
  }
}

function addBulkCoaster(nodes, id, label, x, z, rotY, lengthM = 96, beamM = 17, freeboardM = 5.2) {
  const draft = 3.6;
  const fb = freeboardM;
  const hullMat = 'vessel-mat-hull-black';

  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },

    // 1. Underwater red boot-topping & bulbous bow
    {
      id: `${id}-boot`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: 'vessel-mat-boot-red',
      translation: [0, -draft, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.985), round2(beamM * 0.985), draft],
    },
    {
      id: `${id}-bulb`,
      parent: id,
      geometry: 'vessel-geo-bulbous-bow',
      material: 'vessel-mat-boot-red',
      translation: [round2(lengthM * 0.485), round2(-draft * 0.55), 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.075), round2(beamM * 0.20), round2(draft * 0.65)],
    },
    // 2. Topsides & deck
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: hullMat,
      translation: [0, 0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [lengthM, beamM, fb],
      receiveShadow: true,
    },
    {
      id: `${id}-deck`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: 'vessel-mat-deck-grey',
      translation: [0, fb, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.97), round2(beamM * 0.93), 0.2],
      receiveShadow: true,
    },

    // 3. Forecastle head with windlass
    {
      id: `${id}-forecastle`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: hullMat,
      translation: [round2(lengthM * 0.41), round2(fb + 1.0), 0],
      scale: [round2(lengthM * 0.14), 2.0, round2(beamM * 0.76)],
    },
    {
      id: `${id}-forecastle-deck`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-deck-green',
      translation: [round2(lengthM * 0.41), round2(fb + 2.02), 0],
      scale: [round2(lengthM * 0.135), 0.15, round2(beamM * 0.72)],
    },
    {
      id: `${id}-windlass`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-mast-steel',
      translation: [round2(lengthM * 0.42), round2(fb + 2.4), 0],
      scale: [1.2, 0.7, 2.2],
    },

    // 4. Aft accommodation deckhouse & bridge
    {
      id: `${id}-bridge-lower`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.33), round2(fb + 2.4), 0],
      scale: [round2(lengthM * 0.15), 4.8, round2(beamM * 0.76)],
      receiveShadow: true,
    },
    {
      id: `${id}-bridge-wings`,
      parent: id,
      geometry: 'vessel-geo-bridge-wings',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.32), round2(fb + 6.0), 0],
      scale: [round2(lengthM * 0.09), 2.4, round2(beamM * 0.96)],
    },
    {
      id: `${id}-bridge-glass`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [round2(-lengthM * 0.295), round2(fb + 6.2), 0],
      scale: [round2(lengthM * 0.04), 1.3, round2(beamM * 0.94)],
      castShadow: false,
    },
    {
      id: `${id}-funnel`,
      parent: id,
      geometry: 'vessel-geo-funnel-raked',
      material: 'vessel-mat-funnel-orange',
      translation: [round2(-lengthM * 0.39), round2(fb + 7.8), 0],
      scale: [2.8, 5.0, 2.2],
    },
    {
      id: `${id}-funnel-band`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-funnel-band',
      translation: [round2(-lengthM * 0.39), round2(fb + 8.8), 0],
      scale: [2.9, 1.0, 2.3],
    },
    {
      id: `${id}-mast`,
      parent: id,
      geometry: 'vessel-geo-radar-mast',
      material: 'vessel-mat-mast-steel',
      translation: [round2(-lengthM * 0.32), round2(fb + 10.8), 0],
      scale: [1.6, 6.8, 3.6],
    },
    {
      id: `${id}-radome`,
      parent: id,
      geometry: 'vessel-geo-sphere',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.32), round2(fb + 14.6), 0],
      scale: [1.0, 1.1, 1.0],
    },
    {
      id: `${id}-lifeboat-port`,
      parent: id,
      geometry: 'vessel-geo-lifeboat',
      material: 'vessel-mat-lifeboat-orange',
      translation: [round2(-lengthM * 0.33), round2(fb + 4.8), round2(-beamM * 0.43)],
      rotation: ROT_FLAT_XZ,
      scale: [6.0, 2.0, 1.8],
    },
    {
      id: `${id}-lifeboat-stbd`,
      parent: id,
      geometry: 'vessel-geo-lifeboat',
      material: 'vessel-mat-lifeboat-orange',
      translation: [round2(-lengthM * 0.33), round2(fb + 4.8), round2(beamM * 0.43)],
      rotation: ROT_FLAT_XZ,
      scale: [6.0, 2.0, 1.8],
    },
  );

  // 5. Two prominent deep bulk cargo holds with raised coamings
  for (let h = 0; h < 2; h++) {
    const hx = -lengthM * 0.08 + h * lengthM * 0.24;
    nodes.push(
      {
        id: `${id}-hatch-${h}`,
        parent: id,
        geometry: 'vessel-geo-hatch-coaming',
        material: 'vessel-mat-hatch-oxide',
        translation: [round2(hx), round2(fb + 0.9), 0],
        scale: [round2(lengthM * 0.17), 1.8, round2(beamM * 0.62)],
        receiveShadow: true,
      },
      {
        id: `${id}-hatch-cover-${h}`,
        parent: id,
        geometry: 'vessel-geo-box',
        material: 'vessel-mat-hatch-oxide',
        translation: [round2(hx), round2(fb + 1.85), 0],
        scale: [round2(lengthM * 0.165), 0.2, round2(beamM * 0.58)],
      },
    );
  }

  // 6. Centerline Twin Electro-Hydraulic Deck Cranes
  for (let c = 0; c < 2; c++) {
    const cx = -lengthM * 0.19 + c * lengthM * 0.25;
    nodes.push(
      {
        id: `${id}-crane-pedestal-${c}`,
        parent: id,
        geometry: 'vessel-geo-crane-pedestal',
        material: 'vessel-mat-crane-yellow',
        translation: [round2(cx), round2(fb + 3.2), 0],
        scale: [2.2, 6.4, 2.2],
      },
      {
        id: `${id}-crane-cab-${c}`,
        parent: id,
        geometry: 'vessel-geo-crane-cab',
        material: 'vessel-mat-crane-yellow',
        translation: [round2(cx + 0.9), round2(fb + 6.8), 0.8],
        scale: [2.6, 2.2, 2.0],
      },
      {
        id: `${id}-crane-jib-${c}`,
        parent: id,
        geometry: 'vessel-geo-crane-jib',
        material: 'vessel-mat-crane-yellow',
        translation: [round2(cx + 6.8), round2(fb + 9.8), 0],
        rotation: [0, 0, 0.40, 0.916],
        scale: [16.0, 1.0, 1.0],
      },
      {
        id: `${id}-crane-hook-${c}`,
        parent: id,
        geometry: 'vessel-geo-box',
        material: 'vessel-mat-mast-steel',
        translation: [round2(cx + 12.8), round2(fb + 4.5), 0],
        scale: [0.4, 1.8, 0.4],
      },
    );
  }
}

function addProductTanker(nodes, id, label, x, z, rotY, lengthM = 142, beamM = 24, freeboardM = 6.2) {
  const draft = 4.2;
  const fb = freeboardM;
  const hullMat = 'vessel-mat-hull-black';

  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },

    // 1. Underwater red boot-topping & bulbous bow
    {
      id: `${id}-boot`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: 'vessel-mat-boot-red',
      translation: [0, -draft, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.985), round2(beamM * 0.985), draft],
    },
    {
      id: `${id}-bulb`,
      parent: id,
      geometry: 'vessel-geo-bulbous-bow',
      material: 'vessel-mat-boot-red',
      translation: [round2(lengthM * 0.485), round2(-draft * 0.55), 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.08), round2(beamM * 0.22), round2(draft * 0.7)],
    },
    // 2. Topsides & weather deck
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: hullMat,
      translation: [0, 0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [lengthM, beamM, fb],
      receiveShadow: true,
    },
    {
      id: `${id}-deck`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: 'vessel-mat-deck-grey',
      translation: [0, fb, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.97), round2(beamM * 0.93), 0.2],
      receiveShadow: true,
    },

    // 3. Forecastle head with anchor windlasses
    {
      id: `${id}-forecastle`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: hullMat,
      translation: [round2(lengthM * 0.41), round2(fb + 1.1), 0],
      scale: [round2(lengthM * 0.14), 2.2, round2(beamM * 0.78)],
    },
    {
      id: `${id}-forecastle-deck`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-deck-green',
      translation: [round2(lengthM * 0.41), round2(fb + 2.22), 0],
      scale: [round2(lengthM * 0.135), 0.15, round2(beamM * 0.74)],
    },
    {
      id: `${id}-windlass-port`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-mast-steel',
      translation: [round2(lengthM * 0.42), round2(fb + 2.6), round2(-beamM * 0.22)],
      scale: [1.2, 0.8, 1.2],
    },
    {
      id: `${id}-windlass-stbd`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-mast-steel',
      translation: [round2(lengthM * 0.42), round2(fb + 2.6), round2(beamM * 0.22)],
      scale: [1.2, 0.8, 1.2],
    },

    // 4. Centerline cargo pipe trunking walkway & midships manifold
    {
      id: `${id}-pipe-trunk`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-mast-steel',
      translation: [round2(lengthM * 0.05), round2(fb + 0.8), 0],
      scale: [round2(lengthM * 0.58), 1.4, 2.4],
      receiveShadow: true,
    },
    {
      id: `${id}-manifold-platform`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-deck-grey',
      translation: [round2(lengthM * 0.04), round2(fb + 0.9), 0],
      scale: [12.0, 1.6, round2(beamM * 0.82)],
    },
    {
      id: `${id}-manifold-crane-pedestal`,
      parent: id,
      geometry: 'vessel-geo-crane-pedestal',
      material: 'vessel-mat-crane-yellow',
      translation: [round2(lengthM * 0.04), round2(fb + 2.8), round2(beamM * 0.28)],
      scale: [1.6, 4.0, 1.6],
    },
    {
      id: `${id}-manifold-crane-jib`,
      parent: id,
      geometry: 'vessel-geo-crane-jib',
      material: 'vessel-mat-crane-yellow',
      translation: [round2(lengthM * 0.04 - 3.0), round2(fb + 5.2), round2(beamM * 0.28)],
      rotation: [0, 0, 0.35, 0.937],
      scale: [10.0, 0.7, 0.7],
    },

    // 5. Aft 4-tier white accommodation deckhouse & extended bridge wings
    {
      id: `${id}-bridge-lower`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.33), round2(fb + 2.6), 0],
      scale: [round2(lengthM * 0.16), 5.2, round2(beamM * 0.78)],
      receiveShadow: true,
    },
    {
      id: `${id}-bridge-upper`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.33), round2(fb + 6.4), 0],
      scale: [round2(lengthM * 0.13), 2.6, round2(beamM * 0.76)],
    },
    {
      id: `${id}-bridge-wings`,
      parent: id,
      geometry: 'vessel-geo-bridge-wings',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.32), round2(fb + 9.0), 0],
      scale: [round2(lengthM * 0.10), 2.6, round2(beamM * 0.98)],
    },
    {
      id: `${id}-bridge-glass`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [round2(-lengthM * 0.295), round2(fb + 9.2), 0],
      scale: [round2(lengthM * 0.045), 1.4, round2(beamM * 0.96)],
      castShadow: false,
    },
    {
      id: `${id}-bridge-roof`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-deck-grey',
      translation: [round2(-lengthM * 0.32), round2(fb + 10.4), 0],
      scale: [round2(lengthM * 0.105), 0.2, round2(beamM * 1.0)],
    },

    // 6. Lifeboats on davits
    {
      id: `${id}-lifeboat-port`,
      parent: id,
      geometry: 'vessel-geo-lifeboat',
      material: 'vessel-mat-lifeboat-orange',
      translation: [round2(-lengthM * 0.33), round2(fb + 5.5), round2(-beamM * 0.44)],
      rotation: ROT_FLAT_XZ,
      scale: [7.2, 2.4, 2.0],
    },
    {
      id: `${id}-lifeboat-stbd`,
      parent: id,
      geometry: 'vessel-geo-lifeboat',
      material: 'vessel-mat-lifeboat-orange',
      translation: [round2(-lengthM * 0.33), round2(fb + 5.5), round2(beamM * 0.44)],
      rotation: ROT_FLAT_XZ,
      scale: [7.2, 2.4, 2.0],
    },

    // 7. Funnel with company livery band & radar mast with radome
    {
      id: `${id}-funnel`,
      parent: id,
      geometry: 'vessel-geo-funnel-raked',
      material: 'vessel-mat-funnel-orange',
      translation: [round2(-lengthM * 0.395), round2(fb + 10.5), 0],
      scale: [3.4, 6.2, 2.6],
    },
    {
      id: `${id}-funnel-band`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-funnel-band',
      translation: [round2(-lengthM * 0.395), round2(fb + 11.8), 0],
      scale: [3.5, 1.2, 2.7],
    },
    {
      id: `${id}-mast`,
      parent: id,
      geometry: 'vessel-geo-radar-mast',
      material: 'vessel-mat-mast-steel',
      translation: [round2(-lengthM * 0.32), round2(fb + 14.5), 0],
      scale: [1.8, 8.0, 4.2],
    },
    {
      id: `${id}-radome`,
      parent: id,
      geometry: 'vessel-geo-sphere',
      material: 'vessel-mat-ship-white',
      translation: [round2(-lengthM * 0.32), round2(fb + 19.0), 0],
      scale: [1.2, 1.4, 1.2],
    },

    // 8. Hydrodynamic Wake Wedge (trailing foam wake wedges stretching astern)
    {
      id: `${id}-wake-port`,
      parent: id,
      geometry: 'vessel-geo-wake-wedge',
      material: 'vessel-mat-wake-foam',
      translation: [round2(-lengthM * 0.9), 0.05, round2(-beamM * 0.4)],
      rotation: [0, 0.09, 0, 0.996],
      scale: [round2(lengthM * 0.9), 0.08, 12],
      castShadow: false,
    },
    {
      id: `${id}-wake-stbd`,
      parent: id,
      geometry: 'vessel-geo-wake-wedge',
      material: 'vessel-mat-wake-foam',
      translation: [round2(-lengthM * 0.9), 0.05, round2(beamM * 0.4)],
      rotation: [0, -0.09, 0, 0.996],
      scale: [round2(lengthM * 0.9), 0.08, 12],
      castShadow: false,
    },
    {
      id: `${id}-wake-center`,
      parent: id,
      geometry: 'vessel-geo-wake-wedge',
      material: 'vessel-mat-wake-foam',
      translation: [round2(-lengthM * 0.65), 0.06, 0],
      scale: [round2(lengthM * 0.55), 0.09, 9],
      castShadow: false,
    },
  );
}

function addCatamaranFerry(nodes, id, label, x, z, rotY) {
  const len = 38.0;
  const beam = 10.5;
  const demiBeam = 2.4;
  const demiOffsetZ = 3.8;

  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },

    // 1. Port demi-hull (underwater boot + topside)
    {
      id: `${id}-boot-port`,
      parent: id,
      geometry: 'vessel-geo-catamaran-demi',
      material: 'vessel-mat-boot-red',
      translation: [0, -1.4, -demiOffsetZ],
      rotation: ROT_FLAT_XZ,
      scale: [len * 0.98, demiBeam * 0.98, 0.9],
    },
    {
      id: `${id}-hull-port`,
      parent: id,
      geometry: 'vessel-geo-catamaran-demi',
      material: 'vessel-mat-ship-white',
      translation: [0, -0.5, -demiOffsetZ],
      rotation: ROT_FLAT_XZ,
      scale: [len, demiBeam, 2.2],
      receiveShadow: true,
    },

    // 2. Starboard demi-hull (underwater boot + topside)
    {
      id: `${id}-boot-stbd`,
      parent: id,
      geometry: 'vessel-geo-catamaran-demi',
      material: 'vessel-mat-boot-red',
      translation: [0, -1.4, demiOffsetZ],
      rotation: ROT_FLAT_XZ,
      scale: [len * 0.98, demiBeam * 0.98, 0.9],
    },
    {
      id: `${id}-hull-stbd`,
      parent: id,
      geometry: 'vessel-geo-catamaran-demi',
      material: 'vessel-mat-ship-white',
      translation: [0, -0.5, demiOffsetZ],
      rotation: ROT_FLAT_XZ,
      scale: [len, demiBeam, 2.2],
      receiveShadow: true,
    },

    // 3. Central bridgedeck tunnel spanning between hulls
    {
      id: `${id}-bridgedeck`,
      parent: id,
      geometry: 'vessel-geo-bridgedeck',
      material: 'vessel-mat-ship-white',
      translation: [-1.0, 1.2, 0],
      scale: [30, 0.6, round2(beam * 0.85)],
    },

    // 4. Main Passenger Saloon with panoramic window ribbons & Hormozgan sheer stripe
    {
      id: `${id}-saloon`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [-1.0, 2.5, 0],
      scale: [26, 2.2, round2(beam * 0.92)],
      receiveShadow: true,
    },
    {
      id: `${id}-stripe`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-ferry-blue',
      translation: [-0.5, 1.6, 0],
      scale: [26.4, 0.45, round2(beam * 0.93)],
    },
    {
      id: `${id}-saloon-glass-port`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [-1.0, 2.6, round2(-beam * 0.465)],
      scale: [22, 1.0, 0.15],
      castShadow: false,
    },
    {
      id: `${id}-saloon-glass-stbd`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [-1.0, 2.6, round2(beam * 0.465)],
      scale: [22, 1.0, 0.15],
      castShadow: false,
    },

    // 5. Upper Deck Observation Lounge & Navigation Bridge
    {
      id: `${id}-upper-saloon`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [-3.0, 4.3, 0],
      scale: [18, 1.8, round2(beam * 0.82)],
    },
    {
      id: `${id}-bridge`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [5.2, 4.5, 0],
      scale: [6.5, 1.9, 7.2],
    },
    {
      id: `${id}-bridge-glass`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [6.8, 4.6, 0],
      scale: [3.4, 1.1, 7.3],
      castShadow: false,
    },

    // 6. Twin Aft Engine Exhaust stacks & Stern Passenger Embarkation Gangway
    {
      id: `${id}-exhaust-port`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-mast-steel',
      translation: [-13.0, 4.2, -3.2],
      scale: [0.8, 2.4, 0.8],
    },
    {
      id: `${id}-exhaust-stbd`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-mast-steel',
      translation: [-13.0, 4.2, 3.2],
      scale: [0.8, 2.4, 0.8],
    },
    {
      id: `${id}-gangway`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-deck-grey',
      translation: [-15.5, 1.4, 0],
      scale: [2.5, 0.3, 6.0],
    },
    {
      id: `${id}-mast`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-mast-steel',
      translation: [3.2, 6.4, 0],
      scale: [0.3, 2.2, 0.3],
    },
    {
      id: `${id}-radome`,
      parent: id,
      geometry: 'vessel-geo-sphere',
      material: 'vessel-mat-ship-white',
      translation: [3.2, 7.5, 0],
      scale: [0.75, 0.75, 0.75],
    },
    {
      id: `${id}-radar-bar`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-radar-scanner',
      translation: [3.5, 6.8, 0],
      scale: [0.32, 0.22, 2.4],
    },
    {
      id: `${id}-liferaft-port`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-ship-white',
      translation: [-8.0, 3.8, round2(-beam * 0.44)],
      rotation: ROT_FLAT_XZ,
      scale: [1.6, 0.9, 0.9],
    },
    {
      id: `${id}-liferaft-stbd`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-ship-white',
      translation: [-8.0, 3.8, round2(beam * 0.44)],
      rotation: ROT_FLAT_XZ,
      scale: [1.6, 0.9, 0.9],
    },

  );
}

function addPassengerLaunch(nodes, id, label, x, z, rotY) {
  const len = 28.0;
  const beam = 7.2;

  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },

    // 1. Underwater boot & white planing hull
    {
      id: `${id}-boot`,
      parent: id,
      geometry: 'vessel-geo-pilot-hull',
      material: 'vessel-mat-boot-red',
      translation: [0, -1.4, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(len * 0.98), round2(beam * 0.98), 1.4],
    },
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-pilot-hull',
      material: 'vessel-mat-ship-white',
      translation: [0, 0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [len, beam, 1.8],
      receiveShadow: true,
    },
    {
      id: `${id}-deck`,
      parent: id,
      geometry: 'vessel-geo-pilot-hull',
      material: 'vessel-mat-deck-grey',
      translation: [0, 1.8, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(len * 0.96), round2(beam * 0.92), 0.15],
    },

    // 2. Passenger Saloon with Hormozgan blue sheer stripe and panoramic windows
    {
      id: `${id}-saloon`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [-1.2, 2.9, 0],
      scale: [18.0, 2.0, round2(beam * 0.85)],
      receiveShadow: true,
    },
    {
      id: `${id}-stripe`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-ferry-blue',
      translation: [-1.0, 2.1, 0],
      scale: [18.4, 0.35, round2(beam * 0.86)],
    },
    {
      id: `${id}-saloon-glass-port`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [-1.2, 3.0, round2(-beam * 0.43)],
      scale: [15.0, 0.9, 0.15],
      castShadow: false,
    },
    {
      id: `${id}-saloon-glass-stbd`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [-1.2, 3.0, round2(beam * 0.43)],
      scale: [15.0, 0.9, 0.15],
      castShadow: false,
    },

    // 3. Forward Navigation Bridge
    {
      id: `${id}-bridge`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [5.8, 3.2, 0],
      scale: [4.8, 1.8, 5.0],
    },
    {
      id: `${id}-bridge-glass`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [7.2, 3.3, 0],
      scale: [2.2, 0.95, 5.05],
      castShadow: false,
    },

    // 4. Radar mast & radome
    {
      id: `${id}-mast`,
      parent: id,
      geometry: 'vessel-geo-cyl-low',
      material: 'vessel-mat-mast-steel',
      translation: [3.8, 4.6, 0],
      scale: [0.25, 1.6, 0.25],
    },
    {
      id: `${id}-radome`,
      parent: id,
      geometry: 'vessel-geo-sphere',
      material: 'vessel-mat-ship-white',
      translation: [3.8, 5.5, 0],
      scale: [0.65, 0.55, 0.65],
    },

    // 5. Stern embarkation gangway
    {
      id: `${id}-gangway`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-deck-grey',
      translation: [-11.2, 1.6, 0],
      scale: [2.0, 0.25, 4.2],
    },
  );
}

function addCargoDhow(nodes, id, label, x, z, rotY, len = 26) {
  const beam = 7.4;
  const tarpMat = id.includes('2') || id.includes('4') ? 'vessel-mat-tarp-tan' : 'vessel-mat-tarp-olive';

  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },

    // 1. Bituminous black antifouling underwater hull
    {
      id: `${id}-boot`,
      parent: id,
      geometry: 'vessel-geo-dhow-hull',
      material: 'vessel-mat-hull-black',
      translation: [0, -1.8, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(len * 0.98), round2(beam * 0.98), 1.8],
    },
    // 2. Aged teak wooden planked hull with sheer curve
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-dhow-hull',
      material: 'vessel-mat-dhow-wood',
      translation: [0, 0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [len, beam, 2.2],
      receiveShadow: true,
    },
    // 3. Crisp white sheer strake rub rail
    {
      id: `${id}-sheer-trim`,
      parent: id,
      geometry: 'vessel-geo-dhow-hull',
      material: 'vessel-mat-dhow-trim',
      translation: [0, 1.8, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(len * 1.01), round2(beam * 1.01), 0.35],
    },
    // 4. Swept clipper stempost timber protruding forward of the prow
    {
      id: `${id}-stempost`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-dhow-wood',
      translation: [round2(len * 0.51), 2.4, 0],
      rotation: [0, 0, 0.35, 0.937],
      scale: [0.6, 3.2, 0.5],
    },
    // 5. Main wooden deck
    {
      id: `${id}-deck`,
      parent: id,
      geometry: 'vessel-geo-dhow-hull',
      material: 'vessel-mat-dhow-wood',
      translation: [0, 2.0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(len * 0.96), round2(beam * 0.92), 0.2],
    },
    // 6. Raised poop deck aft with traditional wooden deckhouse / wheelhouse
    {
      id: `${id}-poop-deck`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-dhow-wood',
      translation: [round2(-len * 0.28), 2.7, 0],
      scale: [round2(len * 0.32), 1.4, round2(beam * 0.82)],
    },
    {
      id: `${id}-cabin`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [round2(-len * 0.26), 4.3, 0],
      scale: [5.2, 2.2, 4.4],
    },
    {
      id: `${id}-cabin-roof`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-dhow-wood',
      translation: [round2(-len * 0.26), 5.45, 0],
      scale: [5.6, 0.2, 4.8],
    },
    {
      id: `${id}-cabin-glass`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [round2(-len * 0.16), 4.4, 0],
      scale: [0.3, 1.0, 3.8],
      castShadow: false,
    },
    // 7. Canvas tarpaulin mound covering deck cargo waist
    {
      id: `${id}-cargo-tarp`,
      parent: id,
      geometry: 'vessel-geo-tarp-cargo',
      material: tarpMat,
      translation: [round2(len * 0.05), 2.8, 0],
      scale: [round2(len * 0.42), 2.0, round2(beam * 0.68)],
      receiveShadow: true,
    },
    // 8. Raked forward wooden mast with rigged derrick / cargo boom
    {
      id: `${id}-mast`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-dhow-wood',
      translation: [round2(len * 0.10), 6.5, 0],
      rotation: [0, 0, -0.08, 0.997],
      scale: [0.4, 9.0, 0.4],
    },
    {
      id: `${id}-boom`,
      parent: id,
      geometry: 'vessel-geo-cyl-low',
      material: 'vessel-mat-dhow-wood',
      translation: [round2(len * 0.15), 6.0, 0],
      rotation: [0, 0, 0.42, 0.908],
      scale: [0.25, 8.5, 0.25],
    },
    {
      id: `${id}-crow-nest`,
      parent: id,
      geometry: 'vessel-geo-cyl-low',
      material: 'vessel-mat-dhow-wood',
      translation: [round2(len * 0.09), 10.8, 0],
      scale: [0.9, 0.6, 0.9],
    },
    {
      id: `${id}-poop-rail`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-dhow-trim',
      translation: [round2(-len * 0.43), 3.65, 0],
      scale: [0.45, 0.55, round2(beam * 0.78)],
    },
    {
      id: `${id}-bulwark-cap`,
      parent: id,
      geometry: 'vessel-geo-dhow-hull',
      material: 'vessel-mat-dhow-trim',
      translation: [0, 2.22, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(len * 0.99), round2(beam * 0.99), 0.16],
    },
  );
}

function addHarborTug(nodes, id, label, x, z, rotY) {
  const len = 26.0;
  const beam = 9.4;

  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },

    // 1. Underwater red boot-topping & topside hull
    {
      id: `${id}-boot`,
      parent: id,
      geometry: 'vessel-geo-tug-hull',
      material: 'vessel-mat-boot-red',
      translation: [0, -3.2, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(len * 0.98), round2(beam * 0.98), 3.2],
    },
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-tug-hull',
      material: 'vessel-mat-boot-red',
      translation: [0, 0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [len, beam, 2.0],
      receiveShadow: true,
    },
    {
      id: `${id}-deck`,
      parent: id,
      geometry: 'vessel-geo-tug-hull',
      material: 'vessel-mat-deck-grey',
      translation: [0, 2.0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(len * 0.96), round2(beam * 0.93), 0.2],
    },

    // 2. Heavy cylindrical rubber bow push fender & side D-fenders
    {
      id: `${id}-fender-bow`,
      parent: id,
      geometry: 'vessel-geo-fender-bow',
      material: 'vessel-mat-fender-rubber',
      translation: [round2(len * 0.48), 1.5, 0],
      rotation: ROT_FLAT_XZ,
      scale: [2.2, round2(beam * 0.86), 1.4],
    },
    {
      id: `${id}-fender-port`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-fender-rubber',
      translation: [0, 1.8, round2(-beam * 0.505)],
      scale: [round2(len * 0.85), 0.6, 0.4],
    },
    {
      id: `${id}-fender-stbd`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-fender-rubber',
      translation: [0, 1.8, round2(beam * 0.505)],
      scale: [round2(len * 0.85), 0.6, 0.4],
    },

    // 3. Deckhouse & elevated 360° wheelhouse
    {
      id: `${id}-deckhouse`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [1.5, 3.2, 0],
      scale: [10.5, 2.4, round2(beam * 0.66)],
    },
    {
      id: `${id}-wheelhouse`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [1.8, 5.2, 0],
      scale: [5.2, 2.0, 5.0],
    },
    {
      id: `${id}-wheelhouse-glass`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [2.0, 5.3, 0],
      scale: [5.3, 1.1, 5.1],
      castShadow: false,
    },

    // 4. Twin Aft Exhaust Funnels
    {
      id: `${id}-funnel-port`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-hull-black',
      translation: [-2.8, 5.2, -1.8],
      scale: [0.9, 3.2, 0.7],
    },
    {
      id: `${id}-funnel-stbd`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-hull-black',
      translation: [-2.8, 5.2, 1.8],
      scale: [0.9, 3.2, 0.7],
    },

    // 5. Firefighting monitor & mast
    {
      id: `${id}-mast`,
      parent: id,
      geometry: 'vessel-geo-cyl-low',
      material: 'vessel-mat-mast-steel',
      translation: [1.0, 7.2, 0],
      scale: [0.35, 2.8, 0.35],
    },
    {
      id: `${id}-fifi-monitor`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-boot-red',
      translation: [1.0, 8.4, 0],
      scale: [0.8, 0.6, 0.6],
    },

    // 6. Aft Towing Winch & Heavy H-Bitt
    {
      id: `${id}-tow-winch`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-mast-steel',
      translation: [-6.5, 2.8, 0],
      rotation: [0, 0, 0.7071, 0.7071],
      scale: [1.2, 2.2, 1.2],
    },
    {
      id: `${id}-tow-bitt`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-hull-black',
      translation: [-9.5, 2.8, 0],
      scale: [1.0, 1.4, 2.6],
    },
  );
}

function addPilotLaunch(nodes, id, label, x, z, rotY) {
  const len = 17.5;
  const beam = 5.4;

  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },

    // 1. Underwater boot & high-vis safety orange deep-V hull
    {
      id: `${id}-boot`,
      parent: id,
      geometry: 'vessel-geo-pilot-hull',
      material: 'vessel-mat-boot-red',
      translation: [0, -1.4, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(len * 0.98), round2(beam * 0.98), 1.4],
    },
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-pilot-hull',
      material: 'vessel-mat-pilot-orange',
      translation: [0, 0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [len, beam, 1.6],
      receiveShadow: true,
    },
    {
      id: `${id}-deck`,
      parent: id,
      geometry: 'vessel-geo-pilot-hull',
      material: 'vessel-mat-deck-grey',
      translation: [0, 1.6, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(len * 0.96), round2(beam * 0.92), 0.15],
    },

    // 2. Wheelhouse with angled windscreen & safety orange roof
    {
      id: `${id}-cabin`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [-1.2, 2.8, 0],
      scale: [6.8, 2.2, 3.6],
    },
    {
      id: `${id}-glass`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [0.6, 2.9, 0],
      scale: [2.8, 1.0, 3.65],
      castShadow: false,
    },
    {
      id: `${id}-roof-orange`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-pilot-orange',
      translation: [-1.2, 3.95, 0],
      scale: [7.0, 0.2, 3.8],
    },

    // 3. Radar mast & searchlight
    {
      id: `${id}-radar-mast`,
      parent: id,
      geometry: 'vessel-geo-cyl-low',
      material: 'vessel-mat-mast-steel',
      translation: [-0.5, 4.6, 0],
      scale: [0.2, 1.2, 0.2],
    },
    {
      id: `${id}-radome`,
      parent: id,
      geometry: 'vessel-geo-sphere',
      material: 'vessel-mat-ship-white',
      translation: [-0.5, 5.2, 0],
      scale: [0.6, 0.5, 0.6],
    },

    // 4. Safety boarding handrails
    {
      id: `${id}-handrail-bow`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-mast-steel',
      translation: [4.8, 2.2, 0],
      scale: [4.5, 0.8, 2.8],
    },

    // 5. Realistic spreading stern foam wake wedge
    {
      id: `${id}-wake-port`,
      parent: id,
      geometry: 'vessel-geo-wake-wedge',
      material: 'vessel-mat-wake-foam',
      translation: [-20.0, 0.04, -3.2],
      rotation: [0, 0.08, 0, 0.997],
      scale: [32, 0.05, 5.5],
      castShadow: false,
    },
    {
      id: `${id}-wake-stbd`,
      parent: id,
      geometry: 'vessel-geo-wake-wedge',
      material: 'vessel-mat-wake-foam',
      translation: [-20.0, 0.04, 3.2],
      rotation: [0, -0.08, 0, 0.997],
      scale: [32, 0.05, 5.5],
      castShadow: false,
    },
    {
      id: `${id}-wake-center`,
      parent: id,
      geometry: 'vessel-geo-wake-wedge',
      material: 'vessel-mat-wake-foam',
      translation: [-12.0, 0.05, 0],
      scale: [22, 0.06, 3.8],
      castShadow: false,
    },
  );
}

function addPatrolInterceptorCraft(nodes, id, label, x, z, rotY) {
  const len = 20.0;
  const beam = 5.2;

  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },

    // 1. Underwater boot & naval grey deep-V hull
    {
      id: `${id}-boot`,
      parent: id,
      geometry: 'vessel-geo-pilot-hull',
      material: 'vessel-mat-boot-red',
      translation: [0, -1.3, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(len * 0.98), round2(beam * 0.98), 1.3],
    },
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-pilot-hull',
      material: 'vessel-mat-deck-grey',
      translation: [0, 0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [len, beam, 1.6],
      receiveShadow: true,
    },
    {
      id: `${id}-deck`,
      parent: id,
      geometry: 'vessel-geo-pilot-hull',
      material: 'vessel-mat-deck-grey',
      translation: [0, 1.6, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(len * 0.96), round2(beam * 0.92), 0.15],
    },

    // 2. Heavy rubber collar fender along sheer line
    {
      id: `${id}-fender-port`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-fender-rubber',
      translation: [0, 1.6, round2(-beam * 0.49)],
      scale: [round2(len * 0.88), 0.4, 0.35],
    },
    {
      id: `${id}-fender-stbd`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-fender-rubber',
      translation: [0, 1.6, round2(beam * 0.49)],
      scale: [round2(len * 0.88), 0.4, 0.35],
    },

    // 3. Low-profile stealth wheelhouse & angled tinted windows
    {
      id: `${id}-cabin`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [-1.0, 2.7, 0],
      scale: [8.5, 2.0, round2(beam * 0.72)],
      receiveShadow: true,
    },
    {
      id: `${id}-glass`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [1.8, 2.8, 0],
      scale: [3.2, 0.9, round2(beam * 0.73)],
      castShadow: false,
    },

    // 4. Forward FLIR electro-optical sensor dome & radar mast
    {
      id: `${id}-flir-turret`,
      parent: id,
      geometry: 'vessel-geo-sphere',
      material: 'vessel-mat-ship-white',
      translation: [4.5, 2.4, 0],
      scale: [0.65, 0.75, 0.65],
    },
    {
      id: `${id}-radar-mast`,
      parent: id,
      geometry: 'vessel-geo-radar-mast',
      material: 'vessel-mat-mast-steel',
      translation: [-0.6, 4.3, 0],
      scale: [0.4, 1.6, 1.8],
    },
    {
      id: `${id}-radome`,
      parent: id,
      geometry: 'vessel-geo-sphere',
      material: 'vessel-mat-ship-white',
      translation: [-0.6, 5.2, 0],
      scale: [0.55, 0.45, 0.55],
    },
  );
}

function addClusteredDhow(nodes, id, label, x, z, rotY, len, beam, tarpMatIdx) {
  const tarpMats = ['vessel-mat-tarp-tan', 'vessel-mat-tarp-olive', 'vessel-mat-container-blue'];
  const tarpMat = tarpMats[tarpMatIdx % tarpMats.length];
  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },
    { id: `${id}-hull`, parent: id, geometry: 'vessel-geo-dhow-hull', material: 'vessel-mat-dhow-wood', translation: [0, -1.2, 0], rotation: ROT_FLAT_XZ, scale: [len, beam, 3.2] },
    { id: `${id}-tarp`, parent: id, geometry: 'vessel-geo-tarp-cargo', material: tarpMat, translation: [round2(len * 0.06), 2.4, 0], scale: [round2(len * 0.48), 1.65, round2(beam * 0.72)] },
  );
}

function addShipyardDrydockHull(nodes, id, label, x, z, rotY) {
  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },
    // Keel blocks in drydock
    {
      id: `${id}-blocks`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-deck-grey',
      translation: [0, -0.4, 0],
      scale: [52, 0.8, 2.4],
    },
    // Coastal cargo ship hull undergoing overhaul (oxide red primer)
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: 'vessel-mat-boot-red',
      translation: [0, 0.2, 0],
      rotation: ROT_FLAT_XZ,
      scale: [62, 12, 4.8],
      receiveShadow: true,
    },
    // Main deck
    {
      id: `${id}-deck`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: 'vessel-mat-deck-grey',
      translation: [0, 5.0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [60, 11, 0.2],
    },
    // Aft deckhouse
    {
      id: `${id}-bridge`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [-18, 7.0, 0],
      scale: [10, 3.8, 8.5],
    },
    // Hatch coaming
    {
      id: `${id}-hatch`,
      parent: id,
      geometry: 'vessel-geo-hatch-coaming',
      material: 'vessel-mat-hatch-oxide',
      translation: [6, 5.8, 0],
      scale: [20, 1.4, 6.8],
    },
  );
}

function addShipyardDrydockTug(nodes, id, label, x, z, rotY) {
  const len = 25.0;
  const beam = 9.0;

  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },

    // 1. Keel blocks on drydock floor
    {
      id: `${id}-keel-blocks`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-deck-grey',
      translation: [0, -0.3, 0],
      scale: [22.0, 0.6, 2.0],
    },
    // Bilge shoring props
    {
      id: `${id}-shore-port`,
      parent: id,
      geometry: 'vessel-geo-cyl-low',
      material: 'vessel-mat-dhow-wood',
      translation: [0, 0.1, -3.2],
      rotation: [0, 0, 0.25, 0.968],
      scale: [0.4, 1.8, 0.4],
    },
    {
      id: `${id}-shore-stbd`,
      parent: id,
      geometry: 'vessel-geo-cyl-low',
      material: 'vessel-mat-dhow-wood',
      translation: [0, 0.1, 3.2],
      rotation: [0, 0, -0.25, 0.968],
      scale: [0.4, 1.8, 0.4],
    },

    // 2. ASD Tug hull raised on keel blocks
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-tug-hull',
      material: 'vessel-mat-boot-red',
      translation: [0, 0.3, 0],
      rotation: ROT_FLAT_XZ,
      scale: [len, beam, 2.2],
      receiveShadow: true,
    },
    {
      id: `${id}-deck`,
      parent: id,
      geometry: 'vessel-geo-tug-hull',
      material: 'vessel-mat-deck-grey',
      translation: [0, 2.5, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(len * 0.96), round2(beam * 0.93), 0.2],
    },

    // 3. Heavy rubber push fender
    {
      id: `${id}-fender-bow`,
      parent: id,
      geometry: 'vessel-geo-fender-bow',
      material: 'vessel-mat-fender-rubber',
      translation: [round2(len * 0.48), 2.0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [2.0, round2(beam * 0.86), 1.4],
    },

    // 4. Deckhouse & wheelhouse
    {
      id: `${id}-deckhouse`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [1.5, 3.7, 0],
      scale: [10.0, 2.2, round2(beam * 0.66)],
    },
    {
      id: `${id}-wheelhouse`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [1.8, 5.6, 0],
      scale: [5.0, 1.8, 4.8],
    },
    {
      id: `${id}-wheelhouse-glass`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [2.0, 5.7, 0],
      scale: [5.1, 1.0, 4.9],
      castShadow: false,
    },

    // 5. Twin funnels & mast
    {
      id: `${id}-funnel-port`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-hull-black',
      translation: [-2.6, 5.5, -1.7],
      scale: [0.85, 2.8, 0.65],
    },
    {
      id: `${id}-funnel-stbd`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-hull-black',
      translation: [-2.6, 5.5, 1.7],
      scale: [0.85, 2.8, 0.65],
    },
    {
      id: `${id}-mast`,
      parent: id,
      geometry: 'vessel-geo-cyl-low',
      material: 'vessel-mat-mast-steel',
      translation: [1.0, 7.2, 0],
      scale: [0.3, 2.2, 0.3],
    },
  );
}

function addShipyardSlipwayCraft(nodes, id, label, x, z, rotY) {
  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },
    // Timber slipway cradle chocks
    {
      id: `${id}-cradle`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-dhow-wood',
      translation: [0, 0.1, 0],
      scale: [22, 0.4, 8.8],
    },
    // Lenj dhow hull on cradle
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-dhow-hull',
      material: 'vessel-mat-dhow-wood',
      translation: [0, 0.5, 0],
      rotation: ROT_FLAT_XZ,
      scale: [24, 7.0, 2.2],
      receiveShadow: true,
    },
    // Aft cabin
    {
      id: `${id}-cabin`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [-6.2, 3.6, 0],
      scale: [5.0, 1.9, 4.2],
    },
    // Cargo tarp
    {
      id: `${id}-tarp`,
      parent: id,
      geometry: 'vessel-geo-tarp-cargo',
      material: 'vessel-mat-tarp-tan',
      translation: [1.2, 2.9, 0],
      scale: [10.5, 1.5, 4.8],
    },
    // Mast
    {
      id: `${id}-mast`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-dhow-wood',
      translation: [2.8, 6.6, 0],
      scale: [0.35, 7.5, 0.35],
    },
  );
}

function addShipyardCraneBarge(nodes, id, label, x, z, rotY) {
  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },
    // Pontoon barge hull
    {
      id: `${id}-pontoon`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-deck-grey',
      translation: [0, 0.4, 0],
      scale: [34, 1.8, 15],
      receiveShadow: true,
    },
    // Heavy rubber bumper along bow
    {
      id: `${id}-fender`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-fender-rubber',
      translation: [17.2, 0.6, 0],
      scale: [0.6, 0.8, 15.2],
    },
    // Slewing crane pedestal
    {
      id: `${id}-pedestal`,
      parent: id,
      geometry: 'vessel-geo-crane-pedestal',
      material: 'vessel-mat-crane-yellow',
      translation: [5, 2.6, 0],
      scale: [2.8, 2.6, 2.8],
    },
    // Crane cab
    {
      id: `${id}-cab`,
      parent: id,
      geometry: 'vessel-geo-crane-cab',
      material: 'vessel-mat-crane-yellow',
      translation: [5.8, 4.4, 1.0],
      scale: [2.6, 2.0, 2.0],
    },
    // Lattice crane boom
    {
      id: `${id}-jib`,
      parent: id,
      geometry: 'vessel-geo-crane-jib',
      material: 'vessel-mat-crane-yellow',
      translation: [13.2, 7.2, 0],
      rotation: [0, 0, 0.40, 0.916],
      scale: [17, 1.1, 1.1],
    },
    // Deck container / machinery shed
    {
      id: `${id}-machinery`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-funnel-orange',
      translation: [-9, 2.3, 0],
      scale: [7.5, 2.0, 5.5],
    },
  );
}

function addShipyardServiceTender(nodes, id, label, x, z, rotY) {
  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },
    // Hull
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-pilot-hull',
      material: 'vessel-mat-deck-grey',
      translation: [0, 0.2, 0],
      rotation: ROT_FLAT_XZ,
      scale: [16, 5.2, 1.5],
      receiveShadow: true,
    },
    // Cabin
    {
      id: `${id}-cabin`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-ship-white',
      translation: [-1.0, 2.2, 0],
      scale: [6.0, 1.8, 3.4],
    },
    // Cabin roof
    {
      id: `${id}-roof`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-deck-grey',
      translation: [-1.0, 3.2, 0],
      scale: [6.2, 0.2, 3.6],
    },
    // Mast
    {
      id: `${id}-mast`,
      parent: id,
      geometry: 'vessel-geo-cyl-low',
      material: 'vessel-mat-mast-steel',
      translation: [-0.4, 4.4, 0],
      scale: [0.2, 2.2, 0.2],
    },
  );
}

/**
 * Builds the complete layer-vessels node hierarchy and populates all 28 major commercial/patrol ships,
 * all 56 dense dhow raft clusters along South Quay, and 5 shipyard repair craft.
 */
function addNavalPatrolShip(nodes, id, label, x, z, rotY, lengthM = 70, beamM = 11.0, freeboardM = 4.2) {
  const draft = 3.0;
  const fb = freeboardM;
  nodes.push(
    { id, label, parent: 'layer-vessels', translation: [round2(x), 0, round2(z)], rotation: quatFromAxisY(rotY) },
    {
      id: `${id}-boot`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: 'vessel-mat-boot-red',
      translation: [0, -draft, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.985), round2(beamM * 0.98), draft],
    },
    {
      id: `${id}-hull`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: 'vessel-mat-deck-grey',
      translation: [0, 0, 0],
      rotation: ROT_FLAT_XZ,
      scale: [lengthM, beamM, fb],
      receiveShadow: true,
    },
    {
      id: `${id}-deck`,
      parent: id,
      geometry: 'vessel-geo-hull-commercial',
      material: 'vessel-mat-hull-navy',
      translation: [0, fb, 0],
      rotation: ROT_FLAT_XZ,
      scale: [round2(lengthM * 0.96), round2(beamM * 0.92), 0.18],
    },
    {
      id: `${id}-superstructure`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-deck-grey',
      translation: [round2(lengthM * 0.04), round2(fb + 1.8), 0],
      scale: [round2(lengthM * 0.34), 3.6, round2(beamM * 0.72)],
      receiveShadow: true,
    },
    {
      id: `${id}-bridge`,
      parent: id,
      geometry: 'vessel-geo-box-bevel',
      material: 'vessel-mat-deck-grey',
      translation: [round2(lengthM * 0.12), round2(fb + 4.4), 0],
      scale: [round2(lengthM * 0.14), 2.0, round2(beamM * 0.76)],
    },
    {
      id: `${id}-bridge-glass`,
      parent: id,
      geometry: 'vessel-geo-box',
      material: 'vessel-mat-bridge-glass',
      translation: [round2(lengthM * 0.17), round2(fb + 4.6), 0],
      scale: [round2(lengthM * 0.05), 0.95, round2(beamM * 0.77)],
      castShadow: false,
    },
    {
      id: `${id}-mast`,
      parent: id,
      geometry: 'vessel-geo-radar-mast',
      material: 'vessel-mat-mast-steel',
      translation: [round2(lengthM * 0.08), round2(fb + 7.2), 0],
      scale: [1.2, 4.2, 2.6],
    },
    {
      id: `${id}-radome`,
      parent: id,
      geometry: 'vessel-geo-sphere',
      material: 'vessel-mat-ship-white',
      translation: [round2(lengthM * 0.08), round2(fb + 9.6), 0],
      scale: [0.85, 0.85, 0.85],
    },
    {
      id: `${id}-foredeck-mount`,
      parent: id,
      geometry: 'vessel-geo-cyl',
      material: 'vessel-mat-deck-grey',
      translation: [round2(lengthM * 0.34), round2(fb + 0.9), 0],
      scale: [1.5, 1.4, 1.5],
    },
  );
}

export function buildVesselsLayer(waterPoly, nodes, approximatedFeatures, options = {}) {
  nodes.push({ id: 'layer-vessels', label: 'Civilian Vessels & Harbor Craft', parent: null, visible: true });

  const vbData = options.vesselBerths || vesselBerthsData || null;
  const enrichedList = options.enrichedVessels || gridEnrichedData?.vessels || [];

  const nonWaterStatuses = new Set(['dry_staged_boatyard', 'repair_drydock', 'slipway_cradle']);
  let placedEnriched = 0;
  let dhowCount = 0;

  for (const v of enrichedList) {
    if (waterPoly.length >= 3 && !nonWaterStatuses.has(v.status) && !pointInPolygonXZ([v.x, v.z], waterPoly)) {
      continue;
    }
    placedEnriched++;
    const vId = `infra-${v.id}`;
    const label = v.name;
    const px = v.x;
    const pz = v.z;
    const protY = v.rotY ?? -1.56;
    const len = v.loaM || 24;
    const beam = v.beamM || 7;
    const pfb = v.freeboardM || 2;
    const kind = v.renderKind || 'cargo';

    if (v.status === 'dry_staged_boatyard' || kind === 'dry_skiff') {
      nodes.push({
        id: vId,
        label,
        parent: 'layer-equipment',
        geometry: 'vessel-geo-pilot-hull',
        material: 'vessel-mat-ferry-blue',
        translation: [round2(px), 2.45, round2(pz)],
        rotation: quatFromAxisY(protY),
        scale: [len, beam, 1.8],
        receiveShadow: true,
      });
    } else if (kind === 'container') {
      addContainerShip(nodes, vId, label, px, pz, protY, len, beam, pfb);
    } else if (kind === 'bulk') {
      addBulkCoaster(nodes, vId, label, px, pz, protY, len, beam, pfb);
    } else if (kind === 'tanker') {
      addProductTanker(nodes, vId, label, px, pz, protY, len, beam, pfb);
    } else if (kind === 'catamaran_ferry') {
      addCatamaranFerry(nodes, vId, label, px, pz, protY);
    } else if (kind === 'passenger_launch') {
      addPassengerLaunch(nodes, vId, label, px, pz, protY);
    } else if (kind === 'patrol_ship') {
      addNavalPatrolShip(nodes, vId, label, px, pz, protY, len, beam, pfb);
    } else if (kind === 'patrol') {
      addPatrolInterceptorCraft(nodes, vId, label, px, pz, protY);
    } else if (kind === 'tug') {
      addHarborTug(nodes, vId, label, px, pz, protY);
    } else if (kind === 'pilot') {
      addPilotLaunch(nodes, vId, label, px, pz, protY);
    } else if (kind === 'service_tender') {
      addShipyardServiceTender(nodes, vId, label, px, pz, protY);
    } else if (kind === 'drydock_hull') {
      addShipyardDrydockHull(nodes, vId, label, px, pz, protY);
    } else if (kind === 'drydock_tug') {
      addShipyardDrydockTug(nodes, vId, label, px, pz, protY);
    } else if (kind === 'slipway_craft') {
      addShipyardSlipwayCraft(nodes, vId, label, px, pz, protY);
    } else if (kind === 'crane_barge') {
      addShipyardCraneBarge(nodes, vId, label, px, pz, protY);
    } else if (kind === 'dhow') {
      dhowCount++;
      addClusteredDhow(nodes, vId, label, px, pz, protY, len, beam, dhowCount);
    } else {
      addGeneralCargoShip(nodes, vId, label, px, pz, protY, len, beam, pfb);
    }
  }

  // Fallback only if enrichedList had no dhows (e.g., custom options.dhowBerths override)
  if (dhowCount === 0 && Array.isArray(options.dhowBerths)) {
    for (let i = 0; i < options.dhowBerths.length; i++) {
      const b = options.dhowBerths[i];
      if (waterPoly.length >= 3 && !pointInPolygonXZ([b.x, b.z], waterPoly)) continue;
      dhowCount++;
      const numId = b.id ? b.id.replace('vessel-dhow-raft-', '').replace('dhow-berth-', '') : i + 1;
      addClusteredDhow(nodes, `infra-vessel-dhow-cluster-${numId}`, `Cargo Dhow Cluster ${numId}`, b.x, b.z, b.rotY ?? -1.56, b.loaM || 24, b.beamM || 7, i);
    }
  }

  approximatedFeatures.push(
    `grid-enriched-vessels (${placedEnriched} uniform-scale grid vessels across 40 grid cells, including ${dhowCount} Lenj dhows)`,
  );
}
