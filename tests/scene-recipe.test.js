'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const STAGE_A_PATH = path.join(ROOT, 'data/scene/stage-a-foundation.json');
const STAGE_B_PATH = path.join(ROOT, 'data/scene/stage-b-infrastructure.json');
const FINAL_PATH = path.join(ROOT, 'data/scene/final-recipe.json');

let agentSceneMod;

function isValidId(id) {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && id.trim().length > 0;
}

function validateRecipeStructure(recipe, label, limits) {
  assert.equal(recipe.format, '67js.scene', `${label}: format must be 67js.scene`);
  assert.equal(recipe.schemaVersion, 1, `${label}: schemaVersion must be 1`);
  assert.ok(Array.isArray(recipe.geometries), `${label}: geometries must be an array`);
  assert.ok(Array.isArray(recipe.materials), `${label}: materials must be an array`);
  assert.ok(Array.isArray(recipe.nodes), `${label}: nodes must be an array`);

  const rawBytes = Buffer.byteLength(JSON.stringify(recipe), 'utf8');
  assert.ok(
    rawBytes <= limits.maxRecipeBytes,
    `${label}: recipe JSON size (${rawBytes} bytes) exceeds maxRecipeBytes (${limits.maxRecipeBytes})`
  );

  assert.ok(
    recipe.geometries.length <= limits.maxGeometries,
    `${label}: geometries (${recipe.geometries.length}) > ${limits.maxGeometries}`
  );
  assert.ok(
    recipe.materials.length <= limits.maxMaterials,
    `${label}: materials (${recipe.materials.length}) > ${limits.maxMaterials}`
  );
  assert.ok(
    recipe.nodes.length <= limits.maxNodes,
    `${label}: raw nodes (${recipe.nodes.length}) > ${limits.maxNodes}`
  );

  const geoIds = new Set();
  for (const g of recipe.geometries) {
    assert.ok(isValidId(g.id), `${label}: invalid geometry id "${g.id}"`);
    assert.ok(!geoIds.has(g.id), `${label}: duplicate geometry id "${g.id}"`);
    geoIds.add(g.id);
  }

  const matIds = new Set();
  const patternKeys = new Set();
  for (const m of recipe.materials) {
    assert.ok(isValidId(m.id), `${label}: invalid material id "${m.id}"`);
    assert.ok(!matIds.has(m.id), `${label}: duplicate material id "${m.id}"`);
    matIds.add(m.id);
    if (m.pattern) {
      patternKeys.add(JSON.stringify(m.pattern));
    }
  }
  assert.ok(
    patternKeys.size <= 16,
    `${label}: distinct material patterns (${patternKeys.size}) exceeds 67js limit (16)`
  );

  const nodeIds = new Set();
  for (const n of recipe.nodes) {
    assert.ok(isValidId(n.id), `${label}: invalid node id "${n.id}"`);
    assert.ok(!nodeIds.has(n.id), `${label}: duplicate node id "${n.id}"`);
    nodeIds.add(n.id);
  }

  for (const n of recipe.nodes) {
    if (n.parent !== undefined && n.parent !== null) {
      assert.ok(nodeIds.has(n.parent), `${label}: node "${n.id}" references missing parent "${n.parent}"`);
    }
    if (n.geometry !== undefined) {
      assert.ok(geoIds.has(n.geometry), `${label}: node "${n.id}" references missing geometry "${n.geometry}"`);
      if (!n.instances?.variants) {
        assert.ok(
          n.material === undefined || matIds.has(n.material),
          `${label}: node "${n.id}" references missing material "${n.material}"`
        );
      }
    }
    if (n.instances?.curve) {
      assert.equal(
        n.instances.curve.length,
        undefined,
        `${label}: node "${n.id}" uses instances.curve.length which is rejected by 67js-scene MCP; use count`
      );
      assert.ok(
        Number.isInteger(n.instances.curve.count) && n.instances.curve.count >= 2,
        `${label}: node "${n.id}" instances.curve.count must be an integer >= 2`
      );
    }
  }
}

function assertFiniteBounds3(bounds, label) {
  assert.ok(bounds && Array.isArray(bounds.min) && Array.isArray(bounds.max), `${label}: missing bounds`);
  for (let i = 0; i < 3; i++) {
    assert.ok(Number.isFinite(bounds.min[i]), `${label}: bounds.min[${i}] not finite`);
    assert.ok(Number.isFinite(bounds.max[i]), `${label}: bounds.max[${i}] not finite`);
    assert.ok(bounds.min[i] <= bounds.max[i] + 1e-5, `${label}: bounds.min[${i}] > bounds.max[${i}]`);
  }
}

async function validateWithAgentScene(recipe, label, limits) {
  await agentSceneMod.loadAgentSceneModules(recipe);
  const scene = agentSceneMod.createAgentScene(recipe);
  const info = scene.inspect({ includeBounds: true, limit: limits.maxNodes });

  assert.equal(info.truncated, false, `${label}: inspect truncated`);
  assert.ok(info.counts.nodes <= limits.maxNodes, `${label}: expanded nodes (${info.counts.nodes}) > ${limits.maxNodes}`);
  assert.ok(info.counts.geometries <= limits.maxGeometries, `${label}: geometries (${info.counts.geometries}) > ${limits.maxGeometries}`);
  assert.ok(info.counts.materials <= limits.maxMaterials, `${label}: materials (${info.counts.materials}) > ${limits.maxMaterials}`);
  assert.ok(info.counts.vertices <= limits.maxVertices, `${label}: vertices (${info.counts.vertices}) > ${limits.maxVertices}`);
  assert.ok(info.geometryBytes <= limits.maxGeometryBytes, `${label}: geometryBytes (${info.geometryBytes}) > ${limits.maxGeometryBytes}`);

  for (const n of info.nodes) {
    if (n.geometry) {
      assertFiniteBounds3(n.bounds, `${label} node "${n.id}"`);
    }
  }
  return { scene, info };
}

describe('67js.scene Recipe Validation (Stage A, Stage B, Final)', () => {
  before(async () => {
    agentSceneMod = await import('67js/addons/agent-scene');
  });

  it('Stage A (data/scene/stage-a-foundation.json) passes 67js limits, references, and terrain/water bounding boxes', async () => {
    assert.ok(fs.existsSync(STAGE_A_PATH), 'data/scene/stage-a-foundation.json must exist');
    const recipe = JSON.parse(fs.readFileSync(STAGE_A_PATH, 'utf8'));
    const limits = agentSceneMod.AGENT_SCENE_DEFAULT_LIMITS;

    validateRecipeStructure(recipe, 'Stage A', limits);

    const waterMat = recipe.materials.find((m) => m.tag === 'water');
    assert.ok(waterMat, 'Stage A must include a water material');
    assert.ok(waterMat.opacity < 1, 'water material must have opacity < 1');
    assert.equal(waterMat.alphaMode, 'blend', 'water material must have alphaMode: blend');
    assert.equal(waterMat.waterPreset, 'sea', 'water material must have waterPreset: sea');

    const { info } = await validateWithAgentScene(recipe, 'Stage A', limits);
    const byId = new Map(info.nodes.map((n) => [n.id, n]));

    for (const grp of ['layer-sea', 'layer-land', 'layer-breakwaters']) {
      assert.ok(byId.has(grp), `Stage A must contain group ${grp}`);
    }

    const sea = byId.get('terrain-sea-surface');
    assert.ok(sea, 'Stage A must contain terrain-sea-surface');
    assert.ok(sea.bounds.min[1] <= 0.01 && sea.bounds.max[1] >= -0.05 && sea.bounds.max[1] <= 0.1, 'sea surface sits at y ≈ 0');

    const apron = byId.get('terrain-port-apron');
    assert.ok(apron, 'Stage A must contain terrain-port-apron');
    assert.ok(apron.bounds.max[1] > 1.5 && apron.bounds.max[1] < 4.5, `port apron top Y (${apron.bounds.max[1]}) sits above water`);

    const bwNodes = info.nodes.filter((n) => n.parent === 'layer-breakwaters' && n.bounds);
    assert.ok(bwNodes.length >= 3, 'Stage A must have breakwater meshes');
    for (const bw of bwNodes) {
      assert.ok(bw.bounds.max[1] > 2.0, `breakwater ${bw.id} top Y (${bw.bounds.max[1]}) rises above water`);
    }
  });

  it('Stage B (data/scene/stage-b-infrastructure.json) passes 67js limits, valid IDs, and grounded height alignment', async () => {
    assert.ok(fs.existsSync(STAGE_B_PATH), 'data/scene/stage-b-infrastructure.json must exist');
    const rawStageB = JSON.parse(fs.readFileSync(STAGE_B_PATH, 'utf8'));
    const limits = agentSceneMod.AGENT_SCENE_DEFAULT_LIMITS;

    // Stage B may be a standalone recipe OR a fragment { geometries, materials, nodes }
    const recipe =
      rawStageB.format === '67js.scene'
        ? rawStageB
        : {
            format: '67js.scene',
            schemaVersion: 1,
            geometries: rawStageB.geometries ?? [],
            materials: rawStageB.materials ?? [],
            nodes: rawStageB.nodes ?? [],
          };

    validateRecipeStructure(recipe, 'Stage B', limits);
    const { info } = await validateWithAgentScene(recipe, 'Stage B', limits);
    const nodeIds = new Set(info.nodes.map((n) => n.id));

    for (const grp of ['layer-quays', 'layer-buildings', 'layer-roads-yards', 'layer-equipment', 'layer-vessels']) {
      assert.ok(nodeIds.has(grp), `Stage B must contain layer group ${grp}`);
    }

    // Check quay walls sit on/near water level (0..4m) and buildings sit on port land (>= 1.5m)
    const quayMeshes = info.nodes.filter(
      (n) => n.bounds && (n.parent === 'layer-quays' || /quay/i.test(n.id))
    );
    assert.ok(quayMeshes.length > 0, 'Stage B must contain quay meshes');
    for (const q of quayMeshes) {
      assert.ok(q.bounds.min[1] <= 3.5 && q.bounds.max[1] >= 0.0, `quay ${q.id} Y=[${q.bounds.min[1]}, ${q.bounds.max[1]}] near water/deck`);
    }

    const buildingMeshes = info.nodes.filter(
      (n) => n.bounds && (n.parent === 'layer-buildings' || /building|warehouse|terminal|shed/i.test(n.id))
    );
    assert.ok(buildingMeshes.length > 0, 'Stage B must contain building meshes');
    const baseBuildings = buildingMeshes.filter(
      (b) => /(bldg|warehouse|terminal|shed)-\d+$/.test(b.id) || b.id.endsWith('-walls')
    );
    assert.ok(baseBuildings.length > 100, 'Stage B must contain grounded base building meshes');
    for (const b of baseBuildings) {
      assert.ok(b.bounds.min[1] >= 1.5 && b.bounds.min[1] <= 3.5, `building ${b.id} base Y (${b.bounds.min[1]}) sits on port land`);
      assert.ok(b.bounds.max[1] > b.bounds.min[1] + 1.0, `building ${b.id} has positive height`);
    }
    for (const b of buildingMeshes) {
      assert.ok(b.bounds.min[1] >= 1.5 && b.bounds.max[1] <= 45.0, `building part ${b.id} Y=[${b.bounds.min[1]}, ${b.bounds.max[1]}]`);
    }
  });

  it('Final Recipe (data/scene/final-recipe.json) merges Terrain + Infrastructure within 67js MCP limits and coherent bounds', async () => {
    assert.ok(fs.existsSync(FINAL_PATH), 'data/scene/final-recipe.json must exist');
    const recipe = JSON.parse(fs.readFileSync(FINAL_PATH, 'utf8'));
    const limits = agentSceneMod.AGENT_SCENE_DEFAULT_LIMITS;

    validateRecipeStructure(recipe, 'Final Recipe', limits);
    const { info } = await validateWithAgentScene(recipe, 'Final Recipe', limits);
    const byId = new Map(info.nodes.map((n) => [n.id, n]));

    const expectedLayers = [
      'layer-sea',
      'layer-land',
      'layer-breakwaters',
      'layer-quays',
      'layer-buildings',
      'layer-roads-yards',
      'layer-equipment',
      'layer-vessels',
    ];
    for (const grp of expectedLayers) {
      assert.ok(byId.has(grp), `Final Recipe must contain layer group ${grp}`);
    }

    const sea = byId.get('terrain-sea-surface');
    assert.ok(sea, 'Final Recipe must contain terrain-sea-surface');
    const waterY = sea.bounds.max[1];
    assert.ok(Math.abs(waterY) <= 0.1, `Final water level Y=${waterY} should be ~0`);

    const apron = byId.get('terrain-port-apron');
    assert.ok(apron, 'Final Recipe must contain terrain-port-apron');
    const deckY = apron.bounds.max[1];
    assert.ok(deckY > waterY + 1.5 && deckY < waterY + 4.5, `deckY=${deckY} above waterY=${waterY}`);

    // Collect descendants per layer
    const childrenByParent = new Map();
    for (const n of info.nodes) {
      const p = n.parent ?? '__root__';
      if (!childrenByParent.has(p)) childrenByParent.set(p, []);
      childrenByParent.get(p).push(n);
    }
    function collectLayerMeshes(layerId) {
      const out = [];
      const queue = [...(childrenByParent.get(layerId) ?? [])];
      while (queue.length > 0) {
        const cur = queue.shift();
        if (cur.bounds) out.push(cur);
        const kids = childrenByParent.get(cur.id);
        if (kids) queue.push(...kids);
      }
      return out;
    }

    const quayLayerMeshes = collectLayerMeshes('layer-quays');
    const quayMeshes = quayLayerMeshes.filter((q) => !q.id.startsWith('infra-landmark-'));
    assert.ok(quayMeshes.length > 0, 'Final Recipe has quay meshes');
    for (const q of quayMeshes) {
      assert.ok(
        q.bounds.min[1] <= deckY + 0.5 && q.bounds.max[1] >= waterY,
        `Final quay ${q.id} bounds Y=[${q.bounds.min[1]}, ${q.bounds.max[1]}] sit on/near water level`
      );
    }
    const seamarkMeshes = quayLayerMeshes.filter((q) => q.id.startsWith('infra-landmark-'));
    assert.ok(seamarkMeshes.length > 0, 'Final Recipe has navigation seamark beacons');
    for (const s of seamarkMeshes) {
      assert.ok(
        s.bounds.min[1] >= deckY - 0.1 && s.bounds.max[1] <= 35.0,
        `Seamark ${s.id} Y=[${s.bounds.min[1]}, ${s.bounds.max[1]}] sits on quay deck (${deckY}) or breakwater crest`
      );
    }

    const buildingMeshes = collectLayerMeshes('layer-buildings');
    assert.ok(buildingMeshes.length > 0, 'Final Recipe has building meshes');
    const baseBuildings = buildingMeshes.filter(
      (b) => /(bldg|warehouse|terminal|shed)-\d+$/.test(b.id) || b.id.endsWith('-walls')
    );
    assert.ok(baseBuildings.length > 100, 'Final Recipe has grounded base buildings');
    for (const b of baseBuildings) {
      assert.ok(
        b.bounds.min[1] >= deckY - 0.8 && b.bounds.min[1] <= deckY + 1.0,
        `Final building ${b.id} base Y=${b.bounds.min[1]} sits on port land/apron (${deckY})`
      );
    }
    for (const b of buildingMeshes) {
      assert.ok(
        b.bounds.min[1] >= deckY - 0.9 && b.bounds.max[1] <= 45.0,
        `Final building part ${b.id} Y=[${b.bounds.min[1]}, ${b.bounds.max[1]}]`
      );
    }

    const vesselGroups = childrenByParent.get('layer-vessels') ?? [];
    assert.ok(vesselGroups.length > 0, 'Final Recipe has vessel groups/nodes');
    for (const vg of vesselGroups) {
      const parts = vg.bounds ? [vg] : collectLayerMeshes(vg.id);
      assert.ok(parts.length > 0, `Final vessel ${vg.id} has geometry`);
      const minY = Math.min(...parts.map((p) => p.bounds.min[1]));
      const maxY = Math.max(...parts.map((p) => p.bounds.max[1]));
      assert.ok(
        minY <= waterY + 0.5 && maxY > waterY + 1.0,
        `Final vessel ${vg.id} aggregate Y=[${minY}, ${maxY}] sits in/on water (${waterY})`
      );
    }

    if (byId.has('layer-vegetation')) {
      const vegMeshes = collectLayerMeshes('layer-vegetation');
      assert.ok(vegMeshes.length > 0, 'Final Recipe layer-vegetation has geometry');
      for (const v of vegMeshes) {
        assert.ok(v.bounds.min[1] >= deckY - 1.0, `vegetation ${v.id} sits on land`);
      }
    }
  });
});
