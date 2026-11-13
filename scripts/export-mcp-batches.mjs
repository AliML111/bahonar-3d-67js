import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const require = createRequire(`${root}/package.json`);
const { createServer } = require('vite');

const MAX_OPS_PER_BATCH = 180;

function topoSortNodes(nodes, existingNodeIds) {
  const remaining = new Map(nodes.map((n) => [n.id, n]));
  const placed = new Set(existingNodeIds);
  const ordered = [];

  while (remaining.size > 0) {
    let progressed = false;
    for (const [id, node] of remaining) {
      if (!node.parent || placed.has(node.parent)) {
        ordered.push(node);
        placed.add(id);
        remaining.delete(id);
        progressed = true;
      }
    }
    if (!progressed) {
      const unresolved = [...remaining.values()].map((n) => `${n.id}->${n.parent}`).slice(0, 10);
      throw new Error(`Unresolvable node parent chain: ${unresolved.join(', ')}`);
    }
  }
  return ordered;
}

function collectSeedNodes(infraNodes, existingIds) {
  const byId = new Map(infraNodes.map((n) => [n.id, n]));
  const neededIds = new Set();

  function addWithAncestors(node) {
    if (!node || existingIds.has(node.id) || neededIds.has(node.id)) return;
    if (node.parent && byId.has(node.parent)) {
      addWithAncestors(byId.get(node.parent));
    }
    neededIds.add(node.id);
  }

  for (const node of infraNodes) {
    if (node.instances || node.id.startsWith('infra-container-stack-')) {
      addWithAncestors(node);
    }
  }

  return infraNodes.filter((n) => neededIds.has(n.id));
}

const vite = await createServer({
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { createAgentScene, loadAgentSceneModules } = await vite.ssrLoadModule(
    '/node_modules/67js/build/agent-scene.js'
  );
  const { buildTerrainFragment } = await vite.ssrLoadModule('/src/scene/terrain.js');
  const { buildInfrastructureFragment } = await vite.ssrLoadModule('/src/scene/infrastructure.js');
  const { assemblePortRecipe } = await vite.ssrLoadModule('/src/scene/assemble.js');

  const metricData = JSON.parse(readFileSync(`${root}/data/geo/bahonar-port-metric.json`, 'utf8'));
  const terrainFragment = buildTerrainFragment(metricData);
  const infrastructureFragment = buildInfrastructureFragment(metricData, terrainFragment.metadata);

  const assembled = assemblePortRecipe({
    terrainFragment,
    infrastructureFragment,
    metricData,
    lightingMode: 'daylight',
  });

  if (!assembled.validation.valid) {
    throw new Error(`Assembled recipe invalid: ${assembled.validation.errors.join('; ')}`);
  }

  // Write canonical final-recipe.json
  const finalRecipePath = `${root}/data/scene/final-recipe.json`;
  mkdirSync(dirname(finalRecipePath), { recursive: true });
  writeFileSync(finalRecipePath, JSON.stringify(assembled.recipe, null, 2) + '\n', 'utf8');

  // Build mcp-seed.json: Stage A + Stage B instanced nodes & their dependencies
  const terrainGeoIds = new Set(terrainFragment.geometries.map((g) => g.id));
  const terrainMatIds = new Set(terrainFragment.materials.map((m) => m.id));
  const terrainNodeIds = new Set(terrainFragment.nodes.map((n) => n.id));

  const seedInfraNodes = collectSeedNodes(infrastructureFragment.nodes, terrainNodeIds);
  const seedInfraNodeIds = new Set(seedInfraNodes.map((n) => n.id));

  const seedGeoIds = new Set(terrainGeoIds);
  const seedMatIds = new Set(terrainMatIds);
  for (const n of seedInfraNodes) {
    if (n.geometry) seedGeoIds.add(n.geometry);
    if (n.material) seedMatIds.add(n.material);
  }

  const seedGeometries = assembled.recipe.geometries.filter((g) => seedGeoIds.has(g.id));
  const seedMaterials = assembled.recipe.materials.filter((m) => seedMatIds.has(m.id));
  const seedNodes = assembled.recipe.nodes.filter(
    (n) => terrainNodeIds.has(n.id) || seedInfraNodeIds.has(n.id)
  );

  const mcpSeed = {
    format: '67js.scene',
    schemaVersion: 1,
    camera: assembled.recipe.camera,
    environment: assembled.recipe.environment,
    effects: assembled.recipe.effects,
    shadow: assembled.recipe.shadow,
    geometries: seedGeometries,
    materials: seedMaterials,
    nodes: seedNodes,
  };

  // Remaining Stage B geometries, materials, and non-instance nodes for scene_apply batches
  const remGeometries = assembled.recipe.geometries.filter((g) => !seedGeoIds.has(g.id));
  const remMaterials = assembled.recipe.materials.filter((m) => !seedMatIds.has(m.id));
  const placedNodeIds = new Set(seedNodes.map((n) => n.id));
  const remNodes = topoSortNodes(
    assembled.recipe.nodes.filter((n) => !placedNodeIds.has(n.id)),
    placedNodeIds
  );

  for (const n of remNodes) {
    if (n.instances) {
      throw new Error(`Node "${n.id}" has instances and must belong in mcp-seed.json, not scene_apply.`);
    }
  }

  const allOps = [
    ...remGeometries.map((geometry) => ({ type: 'add-geometry', geometry })),
    ...remMaterials.map((material) => ({ type: 'add-material', material })),
    ...remNodes.map((node) => ({ type: 'add-node', node })),
  ];

  const mcpBatches = [];
  for (let i = 0; i < allOps.length; i += MAX_OPS_PER_BATCH) {
    mcpBatches.push(allOps.slice(i, i + MAX_OPS_PER_BATCH));
  }

  // Verify incremental scene_create + scene_apply replay matches final-recipe counts
  await loadAgentSceneModules(assembled.recipe);
  const seedScene = createAgentScene(mcpSeed);
  for (let idx = 0; idx < mcpBatches.length; idx++) {
    const batch = mcpBatches[idx];
    seedScene.apply(batch, { expectedRevision: seedScene.revision });
  }

  const finalScene = createAgentScene(assembled.recipe);
  const seedInspected = seedScene.inspect({ limit: 1 });
  const finalInspected = finalScene.inspect({ limit: 1 });

  if (
    seedInspected.counts.nodes !== finalInspected.counts.nodes ||
    seedInspected.counts.parts !== finalInspected.counts.parts ||
    seedInspected.counts.geometries !== finalInspected.counts.geometries ||
    seedInspected.counts.materials !== finalInspected.counts.materials ||
    seedInspected.counts.vertices !== finalInspected.counts.vertices
  ) {
    throw new Error(
      `Incremental replay mismatch! seed+batches=${JSON.stringify(seedInspected.counts)} vs final=${JSON.stringify(finalInspected.counts)}`
    );
  }

  const mcpSeedPath = `${root}/data/scene/mcp-seed.json`;
  const mcpBatchesPath = `${root}/data/scene/mcp-batches.json`;
  writeFileSync(mcpSeedPath, JSON.stringify(mcpSeed), 'utf8');
  writeFileSync(mcpBatchesPath, JSON.stringify(mcpBatches), 'utf8');

  console.log(
    JSON.stringify(
      {
        finalRecipeBytes: readFileSync(finalRecipePath).length,
        mcpSeedBytes: readFileSync(mcpSeedPath).length,
        mcpBatchesBytes: readFileSync(mcpBatchesPath).length,
        batchCount: mcpBatches.length,
        maxBatchOps: Math.max(...mcpBatches.map((b) => b.length)),
        counts: finalInspected.counts,
        revisionsAfterBatches: seedScene.revision,
      },
      null,
      2
    )
  );
} finally {
  await vite.close();
}
