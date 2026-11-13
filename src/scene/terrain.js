/**
 * Terrain & bathymetry builder for the 3D Shahid Bahonar Port reconstruction.
 * Browser-safe ESM module: produces both the canonical 67js.scene fragment
 * (for assembly with infrastructure & MCP verification) and the standalone Stage A recipe.
 */

const ROT_FLAT_XZ = [-0.7071067811865476, 0, 0, 0.7071067811865476];

export const TERRAIN_ELEVATIONS = Object.freeze({
  waterLevelY: 0,
  deckElevationY: 2.4,
  breakwaterTopY: 4.3,
  deepSeabedY: -14.0,
  harborFloorY: -12.5,
  basinEastNorthY: -9.2,
  basinSmallBoatY: -5.5,
  shoalY: -2.3,
  landBaseY: -10.0,
  landTopY: 2.36,
});

function toExtrudeContour(pointsXZ) {
  const pts = pointsXZ.map(([x, z]) => [round2(x), round2(-z)]);
  if (pts.length > 2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-4 && Math.abs(first[1] - last[1]) < 1e-4) {
      pts.pop();
    }
  }
  return dedupeSequential(pts, 0.05);
}

function dedupeSequential(pts, minDist = 0.05) {
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

function simplifyPolyline(pts, minDist = 24) {
  if (!pts || pts.length <= 2) return pts || [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1];
    if (Math.hypot(pts[i][0] - prev[0], pts[i][1] - prev[1]) >= minDist) {
      out.push(pts[i]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function buildRibbonPolygonXZ(pts, halfWidth, offsetLat = 0) {
  const clean = dedupeSequential(pts, 1.5);
  const left = [];
  const right = [];
  for (let i = 0; i < clean.length; i++) {
    const prev = clean[Math.max(0, i - 1)];
    const curr = clean[i];
    const next = clean[Math.min(clean.length - 1, i + 1)];
    const d1x = curr[0] - prev[0];
    const d1z = curr[1] - prev[1];
    const l1 = Math.hypot(d1x, d1z);
    const d2x = next[0] - curr[0];
    const d2z = next[1] - curr[1];
    const l2 = Math.hypot(d2x, d2z);

    let nx = 0;
    let nz = 0;
    if (l1 > 1e-4) {
      nx += -d1z / l1;
      nz += d1x / l1;
    }
    if (l2 > 1e-4) {
      nx += -d2z / l2;
      nz += d2x / l2;
    }
    const nLen = Math.hypot(nx, nz) || 1;
    nx /= nLen;
    nz /= nLen;
    const miter = Math.min(1.35, 1 / Math.max(0.74, nLen * 0.5 || 1));
    const cx = curr[0] + nx * offsetLat * miter;
    const cz = curr[1] + nz * offsetLat * miter;
    left.push([round2(cx + nx * halfWidth * miter), round2(cz + nz * halfWidth * miter)]);
    right.push([round2(cx - nx * halfWidth * miter), round2(cz - nz * halfWidth * miter)]);
  }
  return [...left, ...right.reverse()];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function quatFromAxisY(radians) {
  const half = radians * 0.5;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function pointInPolygonXZ(pt, poly) {
  const [px, pz] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect = (zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isInsideBounds(bounds, sceneBounds) {
  return (
    bounds.minX >= sceneBounds.minX - 20 &&
    bounds.maxX <= sceneBounds.maxX + 20 &&
    bounds.minZ >= sceneBounds.minZ - 20 &&
    bounds.maxZ <= sceneBounds.maxZ + 20
  );
}

function buildTerrainMaterials() {
  // Share 4 distinct pattern definitions across Terrain (<= 6 budget, leaving 12 for Infrastructure).
  const concretePattern = {
    type: 'concrete',
    colors: [
      [0.56, 0.54, 0.50],
      [0.72, 0.70, 0.66],
    ],
    size: 18,
    count: 10,
    bump: 0.45,
    seed: 22,
  };

  const earthPattern = {
    type: 'noise',
    colors: [
      [0.56, 0.47, 0.34],
      [0.74, 0.63, 0.46],
    ],
    size: 40,
    count: 16,
    bump: 0.55,
    seed: 11,
  };

  const rockPattern = {
    type: 'stone',
    colors: [
      [0.20, 0.19, 0.17],
      [0.38, 0.35, 0.31],
    ],
    size: 10,
    count: 10,
    bump: 2.2,
    seed: 33,
  };

  const parkPattern = {
    type: 'noise',
    colors: [
      [0.37, 0.39, 0.26],
      [0.50, 0.49, 0.34],
    ],
    size: 24,
    count: 16,
    bump: 0.55,
    seed: 55,
  };

  return [
    {
      id: 'terrain-mat-sea-water',
      tag: 'water',
      color: [0.03, 0.14, 0.22],
      metallic: 0,
      roughness: 0.16,
      emission: 0,
      opacity: 0.85,
      alphaMode: 'blend',
      doubleSided: false,
      waterPreset: 'sea',
      absorption: [0.45, 0.08, 0.02],
      turbidity: 0.10,
    },
    {
      id: 'terrain-mat-seabed-deep',
      tag: 'surface',
      color: [0.015, 0.08, 0.13],
      metallic: 0,
      roughness: 0.96,
    },
    {
      id: 'terrain-mat-seabed-channel',
      tag: 'surface',
      color: [0.022, 0.10, 0.16],
      metallic: 0,
      roughness: 0.95,
    },
    {
      id: 'terrain-mat-seabed-basin',
      tag: 'surface',
      color: [0.032, 0.14, 0.19],
      metallic: 0,
      roughness: 0.92,
    },
    {
      id: 'terrain-mat-seabed-shoal',
      tag: 'surface',
      color: [0.16, 0.52, 0.44],
      metallic: 0,
      roughness: 0.88,
    },
    {
      id: 'terrain-mat-seabed-lagoon',
      tag: 'surface',
      color: [0.28, 0.68, 0.58],
      metallic: 0,
      roughness: 0.86,
    },
    {
      id: 'terrain-mat-beach-sand',
      tag: 'surface',
      color: [0.82, 0.74, 0.58],
      metallic: 0,
      roughness: 0.92,
    },
    {
      id: 'terrain-mat-coastal-earth',
      tag: 'surface',
      color: [0.82, 0.72, 0.54],
      metallic: 0,
      roughness: 0.98,
      pattern: earthPattern,
    },
    {
      id: 'terrain-mat-port-apron',
      tag: 'surface',
      color: [0.86, 0.76, 0.58],
      metallic: 0,
      roughness: 0.92,
      pattern: concretePattern,
    },
    {
      id: 'terrain-mat-pier-concrete',
      tag: 'surface',
      color: [0.90, 0.88, 0.84],
      metallic: 0,
      roughness: 0.90,
      pattern: concretePattern,
    },
    {
      id: 'terrain-mat-breakwater-cap',
      tag: 'surface',
      color: [0.94, 0.93, 0.90],
      metallic: 0,
      roughness: 0.86,
      pattern: concretePattern,
    },
    {
      id: 'terrain-mat-breakwater-parapet',
      tag: 'surface',
      color: [0.88, 0.86, 0.82],
      metallic: 0,
      roughness: 0.84,
      pattern: concretePattern,
    },
    {
      id: 'terrain-mat-breakwater-rock',
      tag: 'surface',
      color: [0.85, 0.83, 0.80],
      metallic: 0,
      roughness: 0.96,
      pattern: rockPattern,
    },
    {
      id: 'terrain-mat-wet-riprap',
      tag: 'surface',
      color: [0.22, 0.21, 0.20],
      metallic: 0.08,
      roughness: 0.42,
      pattern: rockPattern,
    },
    {
      id: 'terrain-mat-park-green',
      tag: 'surface',
      color: [1, 1, 1],
      metallic: 0,
      roughness: 1,
      pattern: parkPattern,
    },
    {
      id: 'terrain-mat-scrub',
      tag: 'surface',
      color: [0.58, 0.52, 0.38],
      metallic: 0,
      roughness: 0.93,
    },
    {
      id: 'terrain-mat-industrial-pad',
      tag: 'surface',
      color: [0.46, 0.43, 0.39],
      metallic: 0,
      roughness: 0.88,
    },
    {
      id: 'terrain-mat-residential-pad',
      tag: 'surface',
      color: [0.58, 0.53, 0.44],
      metallic: 0,
      roughness: 0.90,
    },
    {
      id: 'terrain-mat-salt-pan',
      tag: 'surface',
      color: [0.58, 0.62, 0.59],
      metallic: 0,
      roughness: 0.92,
    },
    {
      id: 'terrain-mat-dock-water',
      tag: 'surface',
      color: [0.11, 0.18, 0.21],
      metallic: 0.05,
      roughness: 0.16,
    },
    {
      id: 'terrain-mat-beacon-white',
      tag: 'surface',
      color: [0.95, 0.95, 0.93],
      metallic: 0.05,
      roughness: 0.35,
    },
    {
      id: 'terrain-mat-beacon-green',
      tag: 'surface',
      color: [0.12, 0.92, 0.42],
      metallic: 0.10,
      roughness: 0.15,
      emission: 4.8,
      emissiveColor: [0.12, 0.92, 0.42],
    },
    {
      id: 'terrain-mat-beacon-red',
      tag: 'surface',
      color: [0.95, 0.18, 0.12],
      metallic: 0.10,
      roughness: 0.15,
      emission: 4.8,
      emissiveColor: [0.95, 0.18, 0.12],
    },
    {
      id: 'terrain-mat-palm-trunk',
      tag: 'surface',
      color: [0.31, 0.21, 0.16],
      metallic: 0,
      roughness: 0.95,
    },
    {
      id: 'terrain-mat-palm-frond',
      tag: 'surface',
      color: [0.14, 0.35, 0.15],
      metallic: 0,
      roughness: 0.82,
    },
  ];
}

export function buildCameraPresets() {
  return [
    {
      id: 'harbor-overview',
      label: 'Harbor Overview',
      hotkey: '1',
      description: '3/4 aerial sweep across the outer breakwaters, harbor basins, and quays',
      camera: {
        eye: [-1350, 880, 1850],
        target: [100, 10, -450],
        up: [0, 1, 0],
        fov: 45,
        near: 5,
        far: 12000,
      },
    },
    {
      id: 'top-down',
      label: 'Top-Down Aerial',
      hotkey: '2',
      description: 'Nadir North-up (-Z) aerial framing the entire Shahid Bahonar Port',
      camera: {
        eye: [-80, 3550, -160],
        target: [-80, 0, -165],
        up: [0, 0, -1],
        fov: 50,
        near: 5,
        far: 12000,
      },
    },
    {
      id: 'quay-closeup',
      label: 'Quay & Cargo Slip',
      hotkey: '3',
      description: 'Low-altitude view along the North Ferry & Cargo Slip, warehouses, and finger piers',
      camera: {
        eye: [-220, 170, -320],
        target: [95, 6, -980],
        up: [0, 1, 0],
        fov: 45,
        near: 1,
        far: 8000,
      },
    },
    {
      id: 'breakwater-approach',
      label: 'Breakwater & Approach',
      hotkey: '4',
      description: 'Inbound Persian Gulf approach channel between the twin curved outer breakwaters',
      camera: {
        eye: [120, 290, 1850],
        target: [40, 4, 480],
        up: [0, 1, 0],
        fov: 45,
        near: 2,
        far: 10000,
      },
    },
  ];
}

/**
 * Builds the 67js.scene fragment for Shahid Bahonar Port terrain, sea, bathymetry,
 * breakwaters, coastal landuse, and pier/quay foundations.
 */
export function buildTerrainFragment(metricData) {
  if (!metricData || !metricData.landPolygons?.length || !metricData.waterFeatures?.harborWaterPolygon) {
    throw new Error('buildTerrainFragment requires metricData with landPolygons and waterFeatures.');
  }

  const E = TERRAIN_ELEVATIONS;
  const seaHalfX = 3400;
  const seaHalfZ = 2800;
  const seaRect = [
    [-seaHalfX, -seaHalfZ],
    [seaHalfX, -seaHalfZ],
    [seaHalfX, seaHalfZ],
    [-seaHalfX, seaHalfZ],
  ];
  const geometries = [
    { id: 'terrain-geo-sea-sheet', type: 'extrude', contour: seaRect, depth: 0.05, bevel: 0 },
    { id: 'terrain-geo-seabed-deep', type: 'extrude', contour: seaRect, depth: 1.0, bevel: 0 },
    { id: 'terrain-geo-unit-box', type: 'box', bevel: 0 },
    { id: 'terrain-geo-bw-head', type: 'cylinder', segments: 24, bevel: 0.05 },
    { id: 'terrain-geo-armor-rock', type: 'icoSphere', subdivisions: 1 },
    { id: 'terrain-geo-beacon-cone', type: 'cone', segments: 16 },
    {
      id: 'terrain-geo-palm-trunk',
      type: 'lathe',
      profile: [
        [0.35, 0],
        [0.32, 2.5],
        [0.28, 5.5],
        [0.24, 8.0],
        [0, 8.0],
      ],
      segments: 8,
    },
    {
      id: 'terrain-geo-palm-crown',
      type: 'lathe',
      profile: [
        [0, 8.5],
        [1.6, 8.4],
        [2.8, 8.0],
        [3.2, 7.5],
        [0, 7.3],
      ],
      segments: 8,
    },
  ];
  const materials = buildTerrainMaterials();
  const nodes = [
    { id: 'layer-sea', label: 'Sea & Bathymetry', parent: null },
    { id: 'layer-land', label: 'Port Landmass & Quay Foundations', parent: null },
    { id: 'layer-breakwaters', label: 'Protective Breakwaters', parent: null },
    { id: 'layer-vegetation', label: 'Date Palms & Coastal Greenery', parent: null },
  ];

  const groundedFeatures = [];
  const approximatedFeatures = [];

  const sceneBounds = metricData.bbox?.metricScene || {
    minX: -1863.62,
    maxX: 1665.12,
    minZ: -1950,
    maxZ: 1650,
  };
  const seaCenterX = round2((sceneBounds.minX + sceneBounds.maxX) * 0.5);
  const seaCenterZ = round2((sceneBounds.minZ + sceneBounds.maxZ) * 0.5 + 350);

  // ---------------------------------------------------------------------------
  // 1. LAYER-SEA: Persian Gulf surface, deep seabed, dredged channel & shoals
  // ---------------------------------------------------------------------------
  nodes.push(
    {
      id: 'terrain-sea-surface',
      label: 'Persian Gulf Sea Surface',
      parent: 'layer-sea',
      geometry: 'terrain-geo-sea-sheet',
      material: 'terrain-mat-sea-water',
      translation: [seaCenterX, E.waterLevelY - 0.05, seaCenterZ],
      rotation: ROT_FLAT_XZ,
      castShadow: false,
      receiveShadow: true,
    },
    {
      id: 'terrain-seabed-deep',
      label: 'Deep Offshore Seabed',
      parent: 'layer-sea',
      geometry: 'terrain-geo-seabed-deep',
      material: 'terrain-mat-seabed-deep',
      translation: [seaCenterX, E.deepSeabedY - 1.0, seaCenterZ],
      rotation: ROT_FLAT_XZ,
      castShadow: false,
      receiveShadow: true,
    },
  );

  // Dredged harbor water polygon base floor at -12.5m (channel depth)
  const harborWater = metricData.waterFeatures.harborWaterPolygon;
  geometries.push({
    id: 'terrain-geo-harbor-floor',
    type: 'extrude',
    contour: toExtrudeContour(harborWater.polygonXZ),
    depth: 0.4,
    bevel: 0,
  });
  nodes.push({
    id: 'terrain-seabed-harbor-floor',
    label: 'Dredged Harbor Channel Floor',
    parent: 'layer-sea',
    geometry: 'terrain-geo-harbor-floor',
    material: 'terrain-mat-seabed-channel',
    translation: [0, E.harborFloorY - 0.4, 0],
    rotation: ROT_FLAT_XZ,
    castShadow: false,
    receiveShadow: true,
  });

  // Basin bathymetry terraces derived from metricData.waterFeatures.basins
  for (const basin of metricData.waterFeatures.basins || []) {
    if (basin.id === 'basin-approach-channel' || basin.id === 'basin-outer-forebay') continue;
    const b = basin.bounds;
    const w = round2(b.maxX - b.minX);
    const d = round2(b.maxZ - b.minZ);
    const cx = round2((b.minX + b.maxX) * 0.5);
    const cz = round2((b.minZ + b.maxZ) * 0.5);
    const topY = -Math.abs(basin.nominalDepthM || 9);
    const slabH = 2.0;
    nodes.push({
      id: `terrain-${basin.id}-bed`,
      label: basin.name,
      parent: 'layer-sea',
      geometry: 'terrain-geo-unit-box',
      material: 'terrain-mat-seabed-basin',
      translation: [cx, topY - slabH * 0.5, cz],
      scale: [w, slabH, d],
      castShadow: false,
      receiveShadow: true,
    });
  }

  // Shallow turquoise coastal shelves & outer forebay shoals flanking the dredged channel
  const shoalPolygons = [
    {
      id: 'west-beach',
      label: 'West Beach Shallow Shelf',
      material: 'terrain-mat-seabed-shoal',
      poly: [
        [-1950, -1550],
        [-1440, -1420],
        [-1440, 380],
        [-660, 445],
        [-500, 740],
        [-470, 1450],
        [-1950, 1450],
      ],
    },
    {
      id: 'west-forebay',
      label: 'West Forebay Shallow Lagoon',
      material: 'terrain-mat-seabed-lagoon',
      poly: [
        [-540, 460],
        [-180, 405],
        [-180, 1175],
        [-360, 1175],
        [-430, 1020],
        [-485, 740],
      ],
    },
    {
      id: 'east-forebay',
      label: 'East Forebay Shallow Lagoon',
      material: 'terrain-mat-seabed-lagoon',
      poly: [
        [225, 210],
        [420, 245],
        [585, 465],
        [525, 770],
        [445, 1015],
        [260, 1115],
        [225, 1115],
      ],
    },
    {
      id: 'east-coast',
      label: 'East Coastal Shallow Shelf',
      material: 'terrain-mat-seabed-shoal',
      poly: [
        [585, 300],
        [630, -85],
        [1220, -110],
        [1760, -140],
        [1760, 1050],
        [555, 1050],
      ],
    },
  ];

  for (const shoal of shoalPolygons) {
    const geoId = `terrain-geo-shoal-${shoal.id}`;
    geometries.push({
      id: geoId,
      type: 'extrude',
      contour: toExtrudeContour(shoal.poly),
      depth: 0.5,
      bevel: 0,
    });
    nodes.push({
      id: `terrain-shoal-${shoal.id}`,
      label: shoal.label,
      parent: 'layer-sea',
      geometry: geoId,
      material: shoal.material || 'terrain-mat-seabed-shoal',
      translation: [0, E.shoalY - 0.5, 0],
      rotation: ROT_FLAT_XZ,
      castShadow: false,
      receiveShadow: true,
    });
  }
  approximatedFeatures.push('bathymetry-shoals-and-channel (derived from OSM basins & satellite depth contrast)');

  // ---------------------------------------------------------------------------
  // 2. LAYER-LAND: OSM Mainland, Reclaimed Port Apron, Beach, Landuse & Piers
  // ---------------------------------------------------------------------------
  const mainlandPoly = metricData.landPolygons[0].polygonXZ;
  geometries.push({
    id: 'terrain-geo-mainland',
    type: 'extrude',
    contour: toExtrudeContour(mainlandPoly),
    depth: round2(E.landTopY - E.landBaseY),
    bevel: 0,
  });
  nodes.push({
    id: 'terrain-land-mainland',
    label: 'Bandar Abbas Coastal Mainland',
    parent: 'layer-land',
    geometry: 'terrain-geo-mainland',
    material: 'terrain-mat-coastal-earth',
    translation: [0, E.landBaseY, 0],
    rotation: ROT_FLAT_XZ,
    receiveShadow: true,
  });
  groundedFeatures.push(`mainland-coastline (${mainlandPoly.length} vertices from OSM way 157394001)`);

  // Core port operational apron traced directly along inner harbor coastline vertices (145..253)
  const coastlinePts = metricData.coastlines?.[0]?.pointsXZ || [];
  if (coastlinePts.length >= 254) {
    const innerQuayShore = coastlinePts.slice(145, 254);
    const apronPoly = [...innerQuayShore, [1249.35, -1630], [-781.0, -1630]];
    geometries.push({
      id: 'terrain-geo-port-apron',
      type: 'extrude',
      contour: toExtrudeContour(apronPoly),
      depth: round2(E.deckElevationY - E.landTopY),
      bevel: 0,
    });
    nodes.push({
      id: 'terrain-port-apron',
      label: 'Core Reclaimed Port Apron',
      parent: 'layer-land',
      geometry: 'terrain-geo-port-apron',
      material: 'terrain-mat-port-apron',
      translation: [0, E.landTopY, 0],
      rotation: ROT_FLAT_XZ,
      receiveShadow: true,
    });
  }

  // Western sandy beach & foreshore terrace south of coastal park
  const beachPoly = [
    [-1660, 410],
    [-1080, 420],
    [-700, 465],
    [-640, 505],
    [-710, 515],
    [-1080, 465],
    [-1660, 460],
  ];
  geometries.push({
    id: 'terrain-geo-beach-west',
    type: 'extrude',
    contour: toExtrudeContour(beachPoly),
    depth: 1.5,
    bevel: 0,
  });
  nodes.push({
    id: 'terrain-beach-west',
    label: 'Western Sandy Beach Shoreline',
    parent: 'layer-land',
    geometry: 'terrain-geo-beach-west',
    material: 'terrain-mat-beach-sand',
    translation: [0, 0.88, 0],
    rotation: ROT_FLAT_XZ,
    receiveShadow: true,
  });

  // Western sandy beach riprap shoreline trim
  const riprapLine = [
    [-1660, 405],
    [-1080, 418],
    [-700, 462],
    [-640, 505],
  ];
  const riprapPoly = buildRibbonPolygonXZ(riprapLine, 3.5);
  geometries.push({
    id: 'terrain-geo-beach-riprap',
    type: 'extrude',
    contour: toExtrudeContour(riprapPoly),
    depth: 0.5,
    bevel: 0,
  });
  nodes.push({
    id: 'terrain-beach-riprap',
    label: 'Western Beach Armor Riprap Shoreline',
    parent: 'layer-land',
    geometry: 'terrain-geo-beach-riprap',
    material: 'terrain-mat-wet-riprap',
    translation: [0, -0.2, 0],
    rotation: ROT_FLAT_XZ,
    receiveShadow: true,
  });

  // Signature OSM Landuse overlays (parks, oil depot, residential zones, larger grass/scrub)
  const yards = metricData.yardsAndLanduse || [];
  let landuseExtrudeCount = 0;
  let landuseBoxCount = 0;
  for (const yard of yards) {
    if (!yard.bounds || !isInsideBounds(yard.bounds, sceneBounds)) continue;
    // Skip oversized enclosing military polygon that overlaps water
    if (yard.category === 'military' || yard.areaSqm > 1000000) continue;

    if (
      yard.category === 'park' ||
      yard.category === 'recreation_ground' ||
      (yard.category === 'pitch' && yard.id !== 'yard-1549876203') ||
      yard.id === 'yard-1549876202' ||
      (yard.category === 'residential' && yard.areaSqm >= 30000)
    ) {
      const matMap = {
        park: 'terrain-mat-park-green',
        recreation_ground: 'terrain-mat-park-green',
        pitch: 'terrain-mat-park-green',
        industrial: 'terrain-mat-industrial-pad',
        residential: 'terrain-mat-residential-pad',
      };
      const material = matMap[yard.category] || 'terrain-mat-coastal-earth';
      const baseY = (yard.id === 'yard-1549876202' ? E.deckElevationY : E.landTopY) + 0.02;

      // Consolidate simple 4/5-point rectangular yards to box geometry to conserve geometry slots
      if (yard.footprintXZ.length <= 5 && yard.widthM && yard.depthM) {
        nodes.push({
          id: `terrain-${yard.id}`,
          label: yard.name || `${yard.category} (${yard.id})`,
          parent: 'layer-land',
          geometry: 'terrain-geo-unit-box',
          material,
          translation: [yard.centerXZ[0], round2(baseY + 0.05 * 0.5), yard.centerXZ[1]],
          rotation: quatFromAxisY(yard.rotationY || 0),
          scale: [yard.widthM, 0.05, yard.depthM],
          receiveShadow: true,
        });
        landuseBoxCount++;
      } else {
        const geoId = `terrain-geo-${yard.id}`;
        geometries.push({
          id: geoId,
          type: 'extrude',
          contour: toExtrudeContour(yard.footprintXZ),
          depth: 0.05,
          bevel: 0,
        });
        nodes.push({
          id: `terrain-${yard.id}`,
          label: yard.name || `${yard.category} (${yard.id})`,
          parent: 'layer-land',
          geometry: geoId,
          material,
          translation: [0, baseY, 0],
          rotation: ROT_FLAT_XZ,
          receiveShadow: true,
        });
        landuseExtrudeCount++;
      }
    } else if ((yard.category === 'grass' || yard.category === 'scrub') && yard.areaSqm >= 1200) {
      if (!pointInPolygonXZ(yard.centerXZ, mainlandPoly)) continue;
      const material = (yard.category === 'grass' && yard.centerXZ[1] > 150) ? 'terrain-mat-park-green' : 'terrain-mat-scrub';
      const baseY = (yard.centerXZ[0] > -780 && yard.centerXZ[1] > -1630 ? E.deckElevationY : E.landTopY) + 0.015;
      const sx = Math.max(1, yard.widthM * 0.85);
      const sz = Math.max(1, yard.depthM * 0.85);
      const sy = round2(Math.max(0.25, Math.max(sx, sz) * 0.004));
      nodes.push({
        id: `terrain-${yard.id}`,
        label: yard.category,
        parent: 'layer-land',
        geometry: 'terrain-geo-unit-box',
        material,
        translation: [yard.centerXZ[0], round2(baseY + 0.05 - sy * 0.5), yard.centerXZ[1]],
        rotation: quatFromAxisY(yard.rotationY || 0),
        scale: [sx, sy, sz],
        receiveShadow: true,
      });
      landuseBoxCount++;
    }
  }
  groundedFeatures.push(`landuse-zones (${landuseExtrudeCount} polygon overlays + ${landuseBoxCount} scrub/grass pads)`);

  // Evaporation salt-pan flat strictly north of Boulevard Pasdaran (Z <= -1725, away from oil depot tanks)
  const neBasinPoly = [
    [165, -1935],
    [545, -1935],
    [555, -1735],
    [165, -1725],
  ];
  geometries.push({
    id: 'terrain-geo-ne-settling-basin',
    type: 'extrude',
    contour: toExtrudeContour(neBasinPoly),
    depth: 0.12,
    bevel: 0,
  });
  nodes.push({
    id: 'terrain-ne-settling-basin',
    label: 'North Coastal Evaporation Salt Flat',
    parent: 'layer-land',
    geometry: 'terrain-geo-ne-settling-basin',
    material: 'terrain-mat-salt-pan',
    translation: [0, round2(E.landTopY + 0.015), 0],
    rotation: ROT_FLAT_XZ,
    receiveShadow: true,
  });

  // Drydocks & emergency water reservoir
  for (const dock of metricData.waterFeatures.docks || []) {
    const isReservoir = dock.subType === 'reservoir';
    const baseY = E.deckElevationY;
    const rimH = 0.4;
    const waterH = 0.4;
    nodes.push({
      id: `terrain-${dock.id}-rim`,
      label: isReservoir ? 'Emergency Water Reservoir Rim' : 'Drydock Concrete Coping',
      parent: 'layer-land',
      geometry: 'terrain-geo-unit-box',
      material: 'terrain-mat-pier-concrete',
      translation: [dock.centerXZ[0], round2(baseY + 0.28 - rimH * 0.5), dock.centerXZ[1]],
      rotation: quatFromAxisY(dock.rotationY || 0),
      scale: [dock.widthM + 4, rimH, dock.depthM + 4],
      receiveShadow: true,
    });
    nodes.push({
      id: `terrain-${dock.id}-water`,
      label: isReservoir ? 'Emergency Water Reservoir' : 'Drydock Basin Water',
      parent: 'layer-land',
      geometry: 'terrain-geo-unit-box',
      material: 'terrain-mat-dock-water',
      translation: [dock.centerXZ[0], round2(baseY + 0.31 - waterH * 0.5), dock.centerXZ[1]],
      rotation: quatFromAxisY(dock.rotationY || 0),
      scale: [dock.widthM, waterH, dock.depthM],
      receiveShadow: true,
    });
  }
  groundedFeatures.push(`water-docks (${(metricData.waterFeatures.docks || []).length} drydocks & reservoir)`);

  // Fixed & floating pier foundations from OSM quaysAndPiers
  let pierFoundationsCount = 0;
  for (const pier of metricData.quaysAndPiers || []) {
    if (!pier.isArea || !pier.pointsXZ?.length) continue;

    if (pier.floating) {
      nodes.push({
        id: `terrain-foundation-${pier.id}`,
        label: `Floating Pontoon Foundation (${pier.id})`,
        parent: 'layer-land',
        geometry: 'terrain-geo-unit-box',
        material: 'terrain-mat-pier-concrete',
        translation: [pier.centerXZ[0], 0.15, pier.centerXZ[1]],
        rotation: quatFromAxisY(pier.rotationY || 0),
        scale: [pier.lengthM, 0.9, pier.widthM],
        receiveShadow: true,
      });
      pierFoundationsCount++;
      continue;
    }

    if (pier.kind === 'slipway') {
      nodes.push({
        id: `terrain-foundation-${pier.id}`,
        label: 'Marine Slipway Ramp Foundation',
        parent: 'layer-land',
        geometry: 'terrain-geo-unit-box',
        material: 'terrain-mat-pier-concrete',
        translation: [pier.centerXZ[0], -0.2, pier.centerXZ[1]],
        rotation: quatFromAxisY(pier.rotationY || 0),
        scale: [pier.lengthM, 2.8, pier.widthM],
        receiveShadow: true,
      });
      pierFoundationsCount++;
      continue;
    }

    // Rectangular 5-point finger piers reuse unit-box; multi-point piers extrude exact OSM shape
    if (pier.pointsXZ.length <= 5) {
      const p0 = pier.pointsXZ[0];
      const p1 = pier.pointsXZ[1];
      const p2 = pier.pointsXZ[2];
      const e01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const e12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const angle = Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]);
      const baseDepth = 10.4;
      nodes.push({
        id: `terrain-foundation-${pier.id}`,
        label: `Pier Foundation (${pier.id})`,
        parent: 'layer-land',
        geometry: 'terrain-geo-unit-box',
        material: 'terrain-mat-pier-concrete',
        translation: [pier.centerXZ[0], round2(E.deckElevationY - baseDepth * 0.5), pier.centerXZ[1]],
        rotation: quatFromAxisY(angle),
        scale: [round2(e01), baseDepth, round2(e12)],
        receiveShadow: true,
      });
      pierFoundationsCount++;
      continue;
    }

    const geoId = `terrain-geo-${pier.id}`;
    const depth = round2(E.deckElevationY - -8.0);
    geometries.push({
      id: geoId,
      type: 'extrude',
      contour: toExtrudeContour(pier.pointsXZ),
      depth,
      bevel: 0,
    });
    nodes.push({
      id: `terrain-foundation-${pier.id}`,
      label: `Pier Foundation (${pier.id})`,
      parent: 'layer-land',
      geometry: geoId,
      material: 'terrain-mat-pier-concrete',
      translation: [0, -8.0, 0],
      rotation: ROT_FLAT_XZ,
      receiveShadow: true,
    });
    pierFoundationsCount++;
  }
  groundedFeatures.push(`pier-foundations (${pierFoundationsCount} OSM area piers & slipways)`);

  // ---------------------------------------------------------------------------
  // 3. LAYER-BREAKWATERS: Exact OSM footprints, smooth crown walls & anchored T-jetty
  // ---------------------------------------------------------------------------
  let bwCount = 0;
  for (const bw of metricData.breakwaters || []) {
    const fineLine = simplifyPolyline(bw.centerlineXZ, 3.0);
    const isInnerSpur = bw.id === 'breakwater-west-inner-spur';
    const rockPoly = Array.isArray(bw.polygonXZ) && bw.polygonXZ.length >= 4
      ? bw.polygonXZ
      : buildRibbonPolygonXZ(fineLine, 14.0);
    const capPoly = isInnerSpur
      ? bw.polygonXZ
      : buildRibbonPolygonXZ(fineLine, 4.8);

    const rockGeoId = `terrain-geo-${bw.id}-rock`;
    const capGeoId = `terrain-geo-${bw.id}-cap`;

    geometries.push(
      { id: rockGeoId, type: 'extrude', contour: toExtrudeContour(rockPoly), depth: 11.1, bevel: 0 },
      { id: capGeoId, type: 'extrude', contour: toExtrudeContour(capPoly), depth: round2(E.breakwaterTopY - 3.1), bevel: 0 },
    );

    nodes.push(
      {
        id: `terrain-${bw.id}-rock`,
        label: `${bw.name} Armor Rock Mound`,
        parent: 'layer-breakwaters',
        geometry: rockGeoId,
        material: 'terrain-mat-breakwater-rock',
        translation: [0, isInnerSpur ? -8.06 : -8.0, 0],
        rotation: ROT_FLAT_XZ,
        receiveShadow: true,
      },
      {
        id: `terrain-${bw.id}-cap`,
        label: `${bw.name} Concrete Crown Wall`,
        parent: 'layer-breakwaters',
        geometry: capGeoId,
        material: 'terrain-mat-breakwater-cap',
        translation: [0, 3.1, 0],
        rotation: ROT_FLAT_XZ,
        receiveShadow: true,
      },
    );

    if (!isInnerSpur) {
      const offsetLat = bw.id === 'breakwater-west-outer' ? -2.2 : 2.2;
      const parapetPoly = buildRibbonPolygonXZ(fineLine, 0.65, offsetLat);
      const parapetGeoId = `terrain-geo-${bw.id}-parapet`;
      geometries.push({ id: parapetGeoId, type: 'extrude', contour: toExtrudeContour(parapetPoly), depth: 0.9, bevel: 0 });
      nodes.push({
        id: `terrain-${bw.id}-parapet`,
        label: `${bw.name} Wave-Wall Parapet`,
        parent: 'layer-breakwaters',
        geometry: parapetGeoId,
        material: 'terrain-mat-breakwater-parapet',
        translation: [0, 4.3, 0],
        rotation: ROT_FLAT_XZ,
        receiveShadow: true,
      });

      const tip = bw.tipXZ || fineLine[fineLine.length - 1];
      nodes.push({
        id: `terrain-${bw.id}-head`,
        label: `${bw.name} Head Bastion`,
        parent: 'layer-breakwaters',
        geometry: 'terrain-geo-bw-head',
        material: 'terrain-mat-breakwater-cap',
        translation: [round2(tip[0]), -1.8, round2(tip[1])],
        scale: [18, 12.6, 18],
        receiveShadow: true,
      });
    }

    const shoulderLine = buildRibbonSideLine(fineLine, bw.id === 'breakwater-west-outer' ? -8.5 : 8.5);
    const boulderCount = Math.max(8, Math.round((bw.lengthM || 500) / 26));
    nodes.push({
      id: `terrain-${bw.id}-armor-boulders`,
      label: `${bw.name} Armor Boulders`,
      parent: 'layer-breakwaters',
      geometry: 'terrain-geo-armor-rock',
      material: 'terrain-mat-breakwater-rock',
      instances: {
        curve: { points: shoulderLine.map(([x, z]) => [round2(x), 1.9, round2(z)]), count: boulderCount },
        seed: 7 + bwCount * 13,
        yaw: true,
        scale: [3.8, 6.2],
      },
    });
    bwCount++;
  }
  groundedFeatures.push(`breakwaters (${bwCount} OSM breakwaters with exact footprints, rock mounds & concrete crown walls)`);
  approximatedFeatures.push('breakwater-armor-boulders (procedurally instanced along OSM breakwater shoulders)');

  const jettyRot = -0.277;
  nodes.push(
    { id: 'terrain-service-jetty-stem-rock', label: 'West Breakwater T-Jetty Stem Rock Base', parent: 'layer-breakwaters', geometry: 'terrain-geo-unit-box', material: 'terrain-mat-breakwater-rock', translation: [-422.5, 0.4, 778.5], rotation: quatFromAxisY(jettyRot), scale: [102, 3.2, 13], receiveShadow: true },
    { id: 'terrain-service-jetty-stem-deck', label: 'West Breakwater T-Jetty Stem Concrete Deck', parent: 'layer-breakwaters', geometry: 'terrain-geo-unit-box', material: 'terrain-mat-pier-concrete', translation: [-422.5, 2.4, 778.5], rotation: quatFromAxisY(jettyRot), scale: [98, 0.45, 7.2], receiveShadow: true },
    { id: 'terrain-service-jetty-head-rock', label: 'West Breakwater T-Jetty Head Rock Base', parent: 'layer-breakwaters', geometry: 'terrain-geo-unit-box', material: 'terrain-mat-breakwater-rock', translation: [-375, 0.4, 792], rotation: quatFromAxisY(jettyRot), scale: [16, 3.2, 68], receiveShadow: true },
    { id: 'terrain-service-jetty-head-deck', label: 'West Breakwater T-Jetty Head Concrete Deck', parent: 'layer-breakwaters', geometry: 'terrain-geo-unit-box', material: 'terrain-mat-pier-concrete', translation: [-375, 2.4, 792], rotation: quatFromAxisY(jettyRot), scale: [10.5, 0.45, 62], receiveShadow: true },
  );
  groundedFeatures.push('south-service-jetty (T-shaped service jetty anchored to West Outer Breakwater at [x:-468, z:765])');

  const beacons = [
    { id: 'west-outer', name: 'West Outer Starboard Beacon', pos: [-163.1, 1253.7], baseY: 4.3, matColor: 'terrain-mat-beacon-green' },
    { id: 'east-outer', name: 'East Outer Port Beacon', pos: [252.4, 1149.7], baseY: 4.3, matColor: 'terrain-mat-beacon-red' },
    { id: 'west-inner', name: 'West Inner Spur Starboard Beacon', pos: [-81.0, 194.5], baseY: 4.3, matColor: 'terrain-mat-beacon-green' },
    { id: 'east-inner', name: 'East Inner Basin Port Beacon', pos: [170.9, 201.4], baseY: 2.4, matColor: 'terrain-mat-beacon-red' },
  ];
  for (const beacon of beacons) {
    const [bx, bz] = beacon.pos;
    const y0 = beacon.baseY;
    nodes.push(
      { id: `terrain-beacon-${beacon.id}-pedestal`, label: `${beacon.name} Pedestal`, parent: 'layer-breakwaters', geometry: 'terrain-geo-unit-box', material: 'terrain-mat-pier-concrete', translation: [bx, round2(y0 + 0.6), bz], scale: [4.0, 1.2, 4.0], receiveShadow: true },
      { id: `terrain-beacon-${beacon.id}-shaft`, label: `${beacon.name} Tower Shaft`, parent: 'layer-breakwaters', geometry: 'terrain-geo-bw-head', material: 'terrain-mat-beacon-white', translation: [bx, round2(y0 + 1.2), bz], scale: [2.2, 5.0, 2.2], receiveShadow: true },
      { id: `terrain-beacon-${beacon.id}-band`, label: `${beacon.name} Colored Band`, parent: 'layer-breakwaters', geometry: 'terrain-geo-bw-head', material: beacon.matColor, translation: [bx, round2(y0 + 3.0), bz], scale: [2.3, 1.4, 2.3], receiveShadow: true },
      { id: `terrain-beacon-${beacon.id}-gallery`, label: `${beacon.name} Gallery Deck`, parent: 'layer-breakwaters', geometry: 'terrain-geo-unit-box', material: 'terrain-mat-pier-concrete', translation: [bx, round2(y0 + 6.2 + 0.125), bz], scale: [3.0, 0.25, 3.0], receiveShadow: true },
      { id: `terrain-beacon-${beacon.id}-lantern`, label: `${beacon.name} Lantern Light`, parent: 'layer-breakwaters', geometry: 'terrain-geo-beacon-cone', material: beacon.matColor, translation: [bx, round2(y0 + 6.45 + 0.9), bz], scale: [1.6, 1.8, 1.6], receiveShadow: true },
    );
  }
  groundedFeatures.push(`entrance-beacons (${beacons.length} IALA Region A navigational beacons)`);

  // ---------------------------------------------------------------------------
  // 4. LAYER-VEGETATION: Collision-Checked OSM Road Median & Park Date Palms
  // ---------------------------------------------------------------------------
  const allBuildings = metricData.buildings || [];
  const allRoads = (metricData.roads || []).filter((r) => r.highway !== 'footway');

  function isBlocked(x, z, padM = 3.2) {
    if (x < sceneBounds.minX + 15 || x > sceneBounds.maxX - 15 || z < sceneBounds.minZ + 15 || z > sceneBounds.maxZ - 15) return true;
    if (pointInPolygonXZ([x, z], harborWater.polygonXZ)) return true;
    for (const b of allBuildings) {
      if (b.bounds && x >= b.bounds.minX - padM && x <= b.bounds.maxX + padM && z >= b.bounds.minZ - padM && z <= b.bounds.maxZ + padM) return true;
    }
    for (const r of allRoads) {
      const pts = r.pointsXZ || [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
        const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz;
        if (l2 < 1e-4) continue;
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2));
        if (Math.hypot(x - (x1 + t * dx), z - (z1 + t * dz)) < 2.8) return true;
      }
    }
    return false;
  }

  function sampleRoadMedian(pts, spacingM, offsetM, baseY, seed = 0) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 10) continue;
      const nx = -(z2 - z1) / len, nz = (x2 - x1) / len;
      const steps = Math.max(1, Math.floor(len / spacingM));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        const px = round2(x1 + (x2 - x1) * t + nx * offsetM);
        const pz = round2(z1 + (z2 - z1) * t + nz * offsetM);
        if (isBlocked(px, pz, 3.0)) continue;
        const sc = round2(0.88 + ((s + seed) % 5) * 0.06);
        out.push({ translation: [px, baseY, pz], rotation: quatFromAxisY((s * 1.7 + seed) % 6.28), scale: [sc, sc, sc] });
      }
    }
    return out;
  }

  const sahandPoly = yards.find((y) => y.id === 'yard-1488367842')?.footprintXZ || [[-1089.66, 347.03], [-1076.76, 426.40], [-1634.54, 443.24], [-1636.96, 399.94], [-1411.26, 340.62]];
  const sahandTrunks = [];
  for (let gx = -1615; gx <= -1100; gx += 25) {
    for (let gz = 348; gz <= 434; gz += 21) {
      const jx = round2(gx + ((Math.abs(gx * 7 + gz * 13) % 9) - 4) * 1.3);
      const jz = round2(gz + ((Math.abs(gx * 11 + gz * 5) % 7) - 3) * 1.1);
      if (pointInPolygonXZ([jx, jz], sahandPoly) && !isBlocked(jx, jz, 2.5)) {
        const s = round2(0.88 + (sahandTrunks.length % 5) * 0.07);
        sahandTrunks.push({ translation: [jx, 2.38, jz], rotation: quatFromAxisY((sahandTrunks.length * 1.17) % 6.28), scale: [s, s, s] });
      }
    }
  }
  const gazeboPlace = [];
  for (let gx = -1560; gx <= -1120; gx += 48) {
    for (let gz = 362; gz <= 422; gz += 28) {
      if (pointInPolygonXZ([gx, gz], sahandPoly)) gazeboPlace.push({ translation: [gx, 3.8, gz], scale: [3.8, 0.25, 3.8] });
    }
  }

  const roadById = new Map(allRoads.map((r) => [r.id, r]));
  const medianPalms = [
    ...sampleRoadMedian(roadById.get('road-26401342')?.pointsXZ || [], 26, -11.5, 2.42, 11),
    ...sampleRoadMedian(roadById.get('road-900954912')?.pointsXZ || [], 24, -10.5, 2.42, 23),
    ...sampleRoadMedian(roadById.get('road-900954881')?.pointsXZ || [], 24, -8.5, 2.40, 37),
    ...sampleRoadMedian(roadById.get('road-900954885')?.pointsXZ || [], 24, -8.5, 2.42, 41),
  ];

  const courtyardPalms = [
    ...Array.from({ length: 18 }, (_, i) => [round2(328 + (i % 3) * 7), 2.42, round2(-1570 + Math.floor(i / 3) * 7)]),
    ...Array.from({ length: 16 }, (_, i) => [round2(-462 + (i % 4) * 11), 2.40, round2(-195 + Math.floor(i / 4) * 9)]),
  ]
    .filter(([x, , z]) => !isBlocked(x, z, 2.5))
    .map(([x, y, z], i) => {
      const s = round2(0.84 + (i % 4) * 0.06);
      return { translation: [x, y, z], rotation: quatFromAxisY((i * 1.4) % 6.28), scale: [s, s, s] };
    });

  const allCleanPalms = [...sahandTrunks, ...medianPalms, ...courtyardPalms];
  allCleanPalms.forEach((p, idx) => {
    nodes.push(
      { id: `terrain-palm-trunk-${idx}`, parent: 'layer-vegetation', geometry: 'terrain-geo-palm-trunk', material: 'terrain-mat-palm-trunk', translation: p.translation, rotation: p.rotation, scale: p.scale },
      { id: `terrain-palm-crown-${idx}`, parent: 'layer-vegetation', geometry: 'terrain-geo-palm-crown', material: 'terrain-mat-palm-frond', translation: p.translation, rotation: p.rotation, scale: p.scale },
    );
  });
  gazeboPlace.forEach((g, idx) => {
    nodes.push({ id: `terrain-sahand-gazebo-${idx}`, parent: 'layer-vegetation', geometry: 'terrain-geo-unit-box', material: 'terrain-mat-pier-concrete', translation: g.translation, scale: g.scale });
  });
  nodes.push(
    { id: 'terrain-shipyard-central-jetty', label: 'Shipyard Drydock Dividing Jetty', parent: 'layer-land', geometry: 'terrain-geo-unit-box', material: 'terrain-mat-pier-concrete', translation: [745, 1.2, -620], scale: [6.5, 2.8, 125], receiveShadow: true },
    { id: 'terrain-shipyard-central-dolphin', label: 'Shipyard Central Hammerhead Dolphin', parent: 'layer-land', geometry: 'terrain-geo-bw-head', material: 'terrain-mat-pier-concrete', translation: [745, 1.2, -556], scale: [14, 2.8, 14], receiveShadow: true },
  );

  const totalPalms = sahandTrunks.length + medianPalms.length + courtyardPalms.length;
  groundedFeatures.push(`palm-vegetation-groves (${totalPalms} collision-checked date palms along OSM boulevard medians, Sahand Park & port courtyards)`);
  groundedFeatures.push(`sahand-park-gazebos (${gazeboPlace.length} shade pavilions inside Sahand Coastal Park)`);

  return {
    geometries,
    materials,
    nodes,
    metadata: {
      waterLevelY: E.waterLevelY,
      deckElevationY: E.deckElevationY,
      breakwaterTopY: E.breakwaterTopY,
      bounds: {
        minX: sceneBounds.minX,
        maxX: sceneBounds.maxX,
        minZ: sceneBounds.minZ,
        maxZ: sceneBounds.maxZ,
        minY: E.deepSeabedY,
        maxY: E.breakwaterTopY + 0.3,
      },
      groundedFeatures,
      approximatedFeatures,
    },
    cameraPresets: buildCameraPresets(),
  };
}

function buildRibbonSideLine(pts, offset) {
  return pts.map((p, i) => {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[Math.min(pts.length - 1, i + 1)];
    const dx = p1[0] - p0[0];
    const dz = p1[1] - p0[1];
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    return [p[0] + nx * offset, p[1] + nz * offset];
  });
}

/**
 * Builds the complete standalone Stage A 67js.scene recipe from metric geospatial data.
 */
export function buildStageARecipe(metricData, options = {}) {
  const fragment = buildTerrainFragment(metricData);
  const presets = fragment.cameraPresets;
  const cameraName = options.cameraPreset || 'top-down';
  const preset = presets.find((p) => p.id === cameraName) || presets[0];

  return {
    format: '67js.scene',
    schemaVersion: 1,
    geometries: fragment.geometries,
    materials: fragment.materials,
    nodes: fragment.nodes,
    camera: preset.camera,
    environment: {
      world: true,
      setup: options.setup || 'daylight',
      ground: false,
      fogDensity: 0.00010,
    },
    effects: {
      exposure: 1.0,
      contrast: 1.04,
      saturation: 1.05,
      ambientOcclusion: 0.35,
      ambientOcclusionRadius: 1.8,
      bloom: { strength: 0.08, threshold: 1.1, radius: 1.0 },
    },
    shadow: {
      target: [-90, 2, -150],
      extent: 1850,
      distance: 3200,
      near: 100,
      far: 7000,
    },
  };
}
