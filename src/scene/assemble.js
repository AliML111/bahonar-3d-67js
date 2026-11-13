/**
 * Scene assembly, camera preset, lighting, and 67js.scene budget validation
 * for the 3D Shahid Bahonar Port reconstruction.
 *
 * Browser-safe ESM module (no Node built-ins) used by both src/main.js and
 * offline recipe export.
 */

export const LAYER_DEFINITIONS = Object.freeze([
  {
    id: 'layer-sea',
    label: 'Persian Gulf & Seabed',
    group: 'Terrain & Water',
    grounded: true,
    note: 'OSM coastline & bathymetry',
  },
  {
    id: 'layer-land',
    label: 'Coastal Land & Aprons',
    group: 'Terrain & Water',
    grounded: true,
    note: 'OSM landuse & shoreline',
  },
  {
    id: 'layer-breakwaters',
    label: 'Outer Breakwaters',
    group: 'Terrain & Water',
    grounded: true,
    note: 'OSM breakwater polygons',
  },
  {
    id: 'layer-vegetation',
    label: 'Date Palms & Coastal Greenery',
    group: 'Terrain & Water',
    grounded: true,
    note: 'GeoDatabase Persian Gulf date palms',
  },
  {
    id: 'layer-quays',
    label: 'Quays, Piers & Berths',
    group: 'Port Infrastructure',
    grounded: true,
    note: 'OSM quay & pier footprints',
  },
  {
    id: 'layer-buildings',
    label: 'Warehouses & Terminals',
    group: 'Port Infrastructure',
    grounded: true,
    note: 'OSM building footprints',
  },
  {
    id: 'layer-roads-yards',
    label: 'Roads & Cargo Yards',
    group: 'Port Infrastructure',
    grounded: true,
    note: 'OSM highway & yard polygons',
  },
  {
    id: 'layer-equipment',
    label: 'Cranes, Containers & Tanks',
    group: 'Port Operations',
    grounded: false,
    note: 'Procedural & reference-guided',
  },
  {
    id: 'layer-vehicles',
    label: 'Ground Vehicles & Port Traffic',
    group: 'Port Operations',
    grounded: true,
    note: 'Customs queue, yard tractors, ferry parking & traffic',
  },
  {
    id: 'layer-vessels',
    label: 'Docked & Approach Vessels',
    group: 'Port Operations',
    grounded: false,
    note: 'Procedural maritime traffic',
  },
]);

export const MCP_BUDGET_LIMITS = Object.freeze({
  maxGeometries: 256,
  maxMaterials: 256,
  maxPatterns: 16,
  maxNodes: 16384,
  maxRecipeBytes: 8388608,
});

function resolveBounds(bounds, metricData) {
  const b = bounds ?? metricData?.bounds ?? null;
  if (b && Number.isFinite(b.minX) && Number.isFinite(b.maxX) && Number.isFinite(b.minZ) && Number.isFinite(b.maxZ)) {
    const cx = (b.minX + b.maxX) * 0.5;
    const cz = (b.minZ + b.maxZ) * 0.5;
    const spanX = Math.max(200, b.maxX - b.minX);
    const spanZ = Math.max(200, b.maxZ - b.minZ);
    return {
      minX: b.minX,
      maxX: b.maxX,
      minZ: b.minZ,
      maxZ: b.maxZ,
      cx,
      cz,
      spanX,
      spanZ,
      radius: Math.max(spanX, spanZ) * 0.5,
    };
  }
  return {
    minX: -1200,
    maxX: 1200,
    minZ: -1200,
    maxZ: 1200,
    cx: 0,
    cz: 0,
    spanX: 2400,
    spanZ: 2400,
    radius: 1200,
  };
}

/**
 * Returns normalized 67js.scene { environment, effects, shadow } for 'daylight' or 'sunset'.
 */
export function getLightingConfig(mode = 'daylight', bounds = null, metricData = null) {
  const b = resolveBounds(bounds, metricData);
  const shadowExtent = Math.min(2400, Math.max(350, Math.round(b.radius * 0.95)));
  const shadowTarget = [Math.round(b.cx), 0, Math.round(b.cz)];

  if (mode === 'sunset') {
    return {
      environment: {
        setup: 'sunset',
        world: true,
        ground: false,
        daylight: 0.6,
        environmentIntensity: 0.95,
        lightDirection: [-0.88, 0.20, 0.43],
        keyColor: [3.4, 1.6, 0.7],
        keyIntensity: 1.20,
        fillIntensity: 0.25,
        ambientIntensity: 0.7,
        skyTop: [0.10, 0.16, 0.38],
        skyBottom: [0.88, 0.45, 0.22],
        fogColor: [0.62, 0.38, 0.28],
        fogDensity: 0.00018,
        resolveCoplanar: false,
      },
      effects: {
        exposure: 1.08,
        contrast: 1.06,
        saturation: 1.08,
        temperature: 0.12,
        ambientOcclusion: 0.35,
        ambientOcclusionRadius: 1.8,
        bloom: { strength: 0.2, threshold: 1.05, radius: 1.1 },
      },
      shadow: {
        target: shadowTarget,
        extent: shadowExtent,
        distance: 3200,
        near: 50,
        far: 7500,
      },
    };
  }

  return {
    environment: {
      setup: 'daylight',
      world: true,
      ground: false,
      daylight: 1.0,
      environmentIntensity: 1.0,
      lightDirection: [-0.45, 0.74, 0.50],
      keyColor: [2.95, 2.82, 2.55],
      keyIntensity: 1.10,
      fillIntensity: 0.25,
      ambientIntensity: 0.95,
      skyTop: [0.18, 0.42, 0.74],
      skyBottom: [0.68, 0.80, 0.88],
      fogColor: [0.66, 0.77, 0.85],
      fogDensity: 0.00010,
      resolveCoplanar: false,
    },
    effects: {
      exposure: 1.0,
      contrast: 1.04,
      saturation: 1.05,
      temperature: 0.02,
      ambientOcclusion: 0.35,
      ambientOcclusionRadius: 1.8,
      bloom: { strength: 0.1, threshold: 1.1, radius: 1.0 },
    },
    shadow: {
      target: shadowTarget,
      extent: shadowExtent,
      distance: 3200,
      near: 50,
      far: 7500,
    },
  };
}

/**
 * Generates the four cinematic camera presets grounded to the port bounding box
 * (or uses explicit presets supplied by terrain/infrastructure metadata).
 */
export function buildDefaultCameraPresets(bounds = null, metricData = null, customPresets = null) {
  if (Array.isArray(customPresets) && customPresets.length >= 4) {
    return customPresets;
  }

  const b = resolveBounds(bounds, metricData);
  const r = b.radius;
  const cx = b.cx;
  const cz = b.cz;

  const presets = [
    {
      id: 'harbor-overview',
      label: 'Harbor Overview',
      hotkey: '1',
      description: '3/4 aerial sweep across the outer breakwaters, harbor basins, and quays',
      camera: {
        eye: [cx - r * 0.92, Math.max(240, r * 0.46), cz + r * 0.85],
        target: [cx + r * 0.05, 4, cz - r * 0.05],
        up: [0, 1, 0],
        fov: 45,
        near: 1.5,
        far: 20000,
      },
    },
    {
      id: 'top-down',
      label: 'Top-Down Plan',
      hotkey: '2',
      description: 'Orthographic-style nadir view aligned North-up (-Z) for OSM footprint comparison',
      camera: {
        eye: [cx, Math.max(950, r * 1.95), cz + 0.01],
        target: [cx, 0, cz],
        up: [0, 0, -1],
        fov: 45,
        near: 2,
        far: 20000,
      },
    },
    {
      id: 'quay-closeup',
      label: 'Quay & Cranes',
      hotkey: '3',
      description: 'Low-altitude berth perspective along the main cargo slip, warehouses, and cranes',
      camera: {
        eye: [cx - r * 0.22, 42, cz + r * 0.24],
        target: [cx + r * 0.14, 8, cz - r * 0.06],
        up: [0, 1, 0],
        fov: 46,
        near: 0.8,
        far: 20000,
      },
    },
    {
      id: 'breakwater-approach',
      label: 'Breakwater Approach',
      hotkey: '4',
      description: 'Inbound shipping channel view from the NW Persian Gulf entrance between twin breakwaters',
      camera: {
        eye: [cx - r * 1.05, 95, cz - r * 0.82],
        target: [cx + r * 0.05, 6, cz + r * 0.08],
        up: [0, 1, 0],
        fov: 44,
        near: 1.0,
        far: 20000,
      },
    },
  ];

  if (Array.isArray(customPresets) && customPresets.length > 0) {
    const byId = new Map(customPresets.map((p) => [p.id, p]));
    return presets.map((p) => byId.get(p.id) ?? p);
  }

  return presets;
}

function countExpandedNodes(nodes) {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    const inst = node.instances;
    if (inst) {
      if (inst.realize) {
        count += 1;
      } else if (inst.grid?.counts) {
        const [nx = 1, ny = 1, nz = 1] = inst.grid.counts;
        count += nx * ny * nz;
      } else if (Number.isFinite(inst.scatter?.count)) {
        count += inst.scatter.count;
      } else if (Number.isFinite(inst.surface?.count)) {
        count += inst.surface.count;
      } else if (Number.isFinite(inst.curve?.count)) {
        count += inst.curve.count;
      }
    }
  }
  return count;
}

/**
 * Validates a 67js.scene recipe against 67js MCP limits and referential integrity.
 */
export function validateRecipeBudgets(recipe) {
  const errors = [];
  const warnings = [];

  if (!recipe || recipe.format !== '67js.scene' || recipe.schemaVersion !== 1) {
    errors.push('Recipe must have format="67js.scene" and schemaVersion=1');
  }

  const geometries = Array.isArray(recipe?.geometries) ? recipe.geometries : [];
  const materials = Array.isArray(recipe?.materials) ? recipe.materials : [];
  const nodes = Array.isArray(recipe?.nodes) ? recipe.nodes : [];

  const geoIds = new Set();
  for (const g of geometries) {
    if (!g?.id) errors.push('Geometry missing id');
    else if (geoIds.has(g.id)) errors.push(`Duplicate geometry id: ${g.id}`);
    else geoIds.add(g.id);
  }

  const matIds = new Set();
  const patternKeys = new Set();
  for (const m of materials) {
    if (!m?.id) errors.push('Material missing id');
    else if (matIds.has(m.id)) errors.push(`Duplicate material id: ${m.id}`);
    else matIds.add(m.id);
    if (m?.pattern) {
      patternKeys.add(JSON.stringify(m.pattern));
    }
  }

  const nodeIds = new Set();
  for (const n of nodes) {
    if (!n?.id) errors.push('Node missing id');
    else if (nodeIds.has(n.id)) errors.push(`Duplicate node id: ${n.id}`);
    else nodeIds.add(n.id);
  }

  for (const n of nodes) {
    if (n.parent && !nodeIds.has(n.parent)) {
      errors.push(`Node "${n.id}" references missing parent "${n.parent}"`);
    }
    if (n.geometry && !geoIds.has(n.geometry)) {
      errors.push(`Node "${n.id}" references missing geometry "${n.geometry}"`);
    }
    if (n.material && !matIds.has(n.material)) {
      errors.push(`Node "${n.id}" references missing material "${n.material}"`);
    }
    if (n.material && !n.geometry) {
      errors.push(`Node "${n.id}" specifies material without geometry`);
    }
  }

  const expandedNodeCount = countExpandedNodes(nodes);
  const jsonBytes = new TextEncoder().encode(JSON.stringify(recipe)).length;

  if (geometries.length > MCP_BUDGET_LIMITS.maxGeometries) {
    errors.push(`Geometry count ${geometries.length} exceeds limit ${MCP_BUDGET_LIMITS.maxGeometries}`);
  }
  if (materials.length > MCP_BUDGET_LIMITS.maxMaterials) {
    errors.push(`Material count ${materials.length} exceeds limit ${MCP_BUDGET_LIMITS.maxMaterials}`);
  }
  if (patternKeys.size > MCP_BUDGET_LIMITS.maxPatterns) {
    errors.push(`Distinct material pattern count ${patternKeys.size} exceeds limit ${MCP_BUDGET_LIMITS.maxPatterns}`);
  }
  if (expandedNodeCount > MCP_BUDGET_LIMITS.maxNodes) {
    errors.push(`Expanded node count ${expandedNodeCount} exceeds limit ${MCP_BUDGET_LIMITS.maxNodes}`);
  }
  if (jsonBytes > MCP_BUDGET_LIMITS.maxRecipeBytes) {
    errors.push(`Serialized recipe size ${jsonBytes} bytes exceeds limit ${MCP_BUDGET_LIMITS.maxRecipeBytes}`);
  }

  if (expandedNodeCount > MCP_BUDGET_LIMITS.maxNodes * 0.90) {
    warnings.push(`Expanded node count (${expandedNodeCount}) is above 90% of 16384 limit`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      geometries: geometries.length,
      materials: materials.length,
      patterns: patternKeys.size,
      authoredNodes: nodes.length,
      expandedNodes: expandedNodeCount,
      recipeBytes: jsonBytes,
    },
  };
}

/**
 * Merges terrain + infrastructure recipe fragments into one canonical 67js.scene recipe
 * plus UI metadata (cameraPresets, layer info).
 */
export function assemblePortRecipe({
  terrainFragment = null,
  infrastructureFragment = null,
  metricData = null,
  lightingMode = 'daylight',
} = {}) {
  const geometries = [];
  const materials = [];
  const nodes = [];
  const seenGeo = new Set();
  const seenMat = new Set();
  const seenNode = new Set();

  const pushUnique = (target, seen, item) => {
    if (!item?.id || seen.has(item.id)) return;
    seen.add(item.id);
    target.push(item);
  };

  for (const frag of [terrainFragment, infrastructureFragment]) {
    if (!frag) continue;
    for (const g of frag.geometries ?? []) pushUnique(geometries, seenGeo, g);
    for (const m of frag.materials ?? []) pushUnique(materials, seenMat, m);
    for (const n of frag.nodes ?? []) pushUnique(nodes, seenNode, n);
  }

  // Ensure every standard layer group exists and carries explicit `visible` so
  // interactive HUD visibility toggles never trigger topology rebuilds.
  const layerIds = new Set(LAYER_DEFINITIONS.map((l) => l.id));
  for (const n of nodes) {
    if (layerIds.has(n.id) && n.visible === undefined) {
      n.visible = true;
    }
  }
  for (const layer of LAYER_DEFINITIONS) {
    if (!seenNode.has(layer.id)) {
      seenNode.add(layer.id);
      nodes.push({ id: layer.id, parent: null, label: layer.label, visible: true });
    }
  }

  const bounds = terrainFragment?.metadata?.bounds ?? metricData?.bounds ?? null;
  const customPresets = [
    ...(terrainFragment?.cameraPresets ?? []),
    ...(infrastructureFragment?.cameraPresets ?? []),
  ];
  const cameraPresets = buildDefaultCameraPresets(bounds, metricData, customPresets.length ? customPresets : null);
  const look = getLightingConfig(lightingMode, bounds, metricData);

  const recipe = {
    format: '67js.scene',
    schemaVersion: 1,
    camera: cameraPresets[0].camera,
    environment: look.environment,
    effects: look.effects,
    shadow: look.shadow,
    geometries,
    materials,
    nodes,
  };

  const validation = validateRecipeBudgets(recipe);

  return {
    recipe,
    cameraPresets,
    validation,
    metadata: {
      origin: metricData?.origin ?? null,
      bounds: resolveBounds(bounds, metricData),
      waterLevelY: terrainFragment?.metadata?.waterLevelY ?? 0,
      deckElevationY: terrainFragment?.metadata?.deckElevationY ?? 2.6,
      groundedFeatures: [
        ...(terrainFragment?.metadata?.groundedFeatures ?? []),
        ...(infrastructureFragment?.metadata?.groundedFeatures ?? []),
      ],
      approximatedFeatures: [
        ...(terrainFragment?.metadata?.approximatedFeatures ?? []),
        ...(infrastructureFragment?.metadata?.approximatedFeatures ?? []),
      ],
    },
  };
}
