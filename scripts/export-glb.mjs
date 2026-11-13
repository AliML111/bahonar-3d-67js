import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGlb } from '67js';
import { createAgentScene, loadAgentSceneModules } from '67js/addons/agent-scene';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECIPE_PATH = existsSync(resolve(ROOT_DIR, 'data/scene/final-recipe.json'))
  ? resolve(ROOT_DIR, 'data/scene/final-recipe.json')
  : resolve(ROOT_DIR, 'data/scene/mcp-exported-recipe.json');
const OUT_PATH = resolve(ROOT_DIR, 'assets/glb/shahid-bahonar-port.glb');

/**
 * Exports the curated live-MCP port recipe to binary glTF (.glb) via official 67js exportGlb.
 */
async function main() {
  const recipe = JSON.parse(readFileSync(RECIPE_PATH, 'utf8'));
  await loadAgentSceneModules(recipe);
  const handle = createAgentScene(recipe);
  const buffer = exportGlb(handle.parts);
  const bytes = new Uint8Array(buffer);

  const magic = Buffer.from(bytes.slice(0, 4)).toString('ascii');
  const version = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (magic !== 'glTF' || version !== 2) {
    throw new Error(`Invalid GLB header: magic=${magic}, version=${version}`);
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, bytes);

  const stats = {
    sourceRecipe: RECIPE_PATH.replace(ROOT_DIR, '').replace(/^[\\\/]/, ''),
    outputGlb: 'assets/glb/shahid-bahonar-port.glb',
    partCount: handle.parts.length,
    byteLength: bytes.byteLength,
    magic,
    version,
  };
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
