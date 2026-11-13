import { Renderer67 } from '67js';
import '67js/addons/replace-textured-parts';
import {
  createAgentScene,
  loadAgentSceneModules,
  resolveAgentShadow,
} from '67js/addons/agent-scene';
import { generateGeometryLods } from '67js/addons/mesh';
import {
  LAYER_DEFINITIONS,
  assemblePortRecipe,
  buildDefaultCameraPresets,
  getLightingConfig,
} from './scene/assemble.js';
import { createCameraController, createHudController } from './ui/controls.js';

const recipeModules = import.meta.glob('../data/scene/final-recipe.json', { eager: true });
const metricModules = import.meta.glob('../data/geo/bahonar-port-metric.json', { eager: true });
const terrainModules = import.meta.glob('./scene/terrain.js', { eager: true });
const infraModules = import.meta.glob('./scene/infrastructure.js', { eager: true });

function detectSoftwareRenderer() {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|Software|Mesa Offscreen/i.test(rendererStr);
  } catch {
    return false;
  }
}

const lodCache = new Map();
const lodPartWrapperCache = new WeakMap();

function buildPartsWithLods(parts) {
  let lodPartCount = 0;
  const wrapped = parts.map((part) => {
    const geom = part.geometry;
    if (!geom || !geom.positions || !geom.indices) return part;
    const triCount = geom.indices.length / 3;
    if (triCount < 36 || part.lods || part.skin || part.morph || part.crowd) return part;
    if (part.material?.tag && part.material.tag !== 'surface') return part;
    if ((part.material?.alphaMode ?? 'opaque') !== 'opaque') return part;

    let lods = lodCache.get(geom);
    if (lods === undefined) {
      try {
        const generated = generateGeometryLods(geom, {
          ratios: triCount >= 200 ? [0.42, 0.16] : [0.48, 0.22],
          smoothAngle: 35,
        });
        if (
          Array.isArray(generated) &&
          generated.length >= 2 &&
          generated[1].triangles < triCount &&
          generated[1].error > 0
        ) {
          let prevErr = 0;
          lods = generated.map((entry, idx) => {
            if (idx === 0) return { geometry: entry.geometry, error: 0 };
            const floor = idx === 1 ? 0.15 : 0.55;
            const err = Math.max(entry.error, prevErr + 0.05, floor);
            prevErr = err;
            return { geometry: entry.geometry, error: err };
          });
        } else {
          lods = null;
        }
      } catch {
        lods = null;
      }
      lodCache.set(geom, lods);
    }

    if (!lods) return part;
    lodPartCount++;
    let nextPart = lodPartWrapperCache.get(part);
    if (!nextPart) {
      nextPart = Object.freeze({ ...part, lods });
      lodPartWrapperCache.set(part, nextPart);
    }
    return nextPart;
  });

  return {
    parts: wrapped,
    stats: {
      lodGeometryCount: [...lodCache.values()].filter(Boolean).length,
      lodPartCount,
    },
  };
}

function loadInitialSceneData() {
  const metricMod = metricModules['../data/geo/bahonar-port-metric.json'];
  const metricData = metricMod?.default ?? metricMod ?? null;
  const terrainMod = terrainModules['./scene/terrain.js'] ?? null;
  const infraMod = infraModules['./scene/infrastructure.js'] ?? null;

  const terrainFragment =
    typeof terrainMod?.buildTerrainFragment === 'function'
      ? terrainMod.buildTerrainFragment(metricData)
      : null;

  const infrastructureFragment =
    typeof infraMod?.buildInfrastructureFragment === 'function'
      ? infraMod.buildInfrastructureFragment(metricData, terrainFragment?.metadata ?? {})
      : null;

  const recipeMod = recipeModules['../data/scene/final-recipe.json'];
  const savedRecipe = recipeMod?.default ?? recipeMod ?? null;

  const assembled = assemblePortRecipe({
    terrainFragment,
    infrastructureFragment,
    metricData,
    lightingMode: 'daylight',
  });

  if (savedRecipe && savedRecipe.format === '67js.scene' && Array.isArray(savedRecipe.nodes) && savedRecipe.nodes.length > 0) {
    const customPresets = [
      ...(terrainFragment?.cameraPresets ?? []),
      ...(infraMod?.cameraPresets ?? []),
    ];
    const bounds = terrainFragment?.metadata?.bounds ?? metricData?.bounds ?? null;
    const cameraPresets = buildDefaultCameraPresets(bounds, metricData, customPresets.length ? customPresets : null);
    return {
      recipe: savedRecipe,
      cameraPresets,
      metadata: {
        ...assembled.metadata,
        bounds: assembled.metadata.bounds,
        origin: metricData?.origin ?? null,
      },
    };
  }

  return assembled;
}

async function boot() {
  const statusEl = document.getElementById('hud-status');
  const canvas = document.getElementById('viewport');
  const urlParams = new URLSearchParams(window.location.search);
  const camParam = urlParams.get('cam');
  const lightParam = urlParams.get('light');
  const hudParam = urlParams.get('hud');

  if (hudParam === '0' || hudParam === 'false') {
    document.getElementById('hud-header')?.style.setProperty('display', 'none');
    document.getElementById('hud-layers-panel')?.style.setProperty('display', 'none');
    document.getElementById('hud-bottom')?.style.setProperty('display', 'none');
  }

  try {
    const { recipe, cameraPresets, metadata } = loadInitialSceneData();
    const isSoftwareGpu = detectSoftwareRenderer();

    let initialCamera = cameraPresets[0].camera;
    if (camParam) {
      const parts = camParam.split(',').map((s) => Number(s.trim()));
      if (parts.length >= 6 && parts.every((n) => Number.isFinite(n))) {
        initialCamera = {
          eye: [parts[0], parts[1], parts[2]],
          target: [parts[3], parts[4], parts[5]],
          up: [0, 1, 0],
          fov: parts[6] && Number.isFinite(parts[6]) ? parts[6] : 45,
          near: 1.0,
          far: 20000,
        };
      }
    }

    let initialLighting =
      lightParam === 'sunset' || lightParam === 'daylight'
        ? lightParam
        : recipe.environment?.setup === 'sunset'
          ? 'sunset'
          : 'daylight';

    if (initialLighting !== recipe.environment?.setup) {
      const look = getLightingConfig(initialLighting, metadata?.bounds, { origin: metadata?.origin });
      recipe.environment = look.environment;
      recipe.effects = look.effects;
      recipe.shadow = look.shadow;
    }

    recipe.environment = { ...recipe.environment, resolveCoplanar: false };
    if (isSoftwareGpu && recipe.effects) {
      recipe.effects = {
        ...recipe.effects,
        ambientOcclusion: 0,
        bloom: { ...(recipe.effects.bloom ?? {}), strength: 0 },
      };
    }

    await loadAgentSceneModules(recipe);
    const scene = createAgentScene(recipe);
    let lodPack = buildPartsWithLods(scene.parts);
    let lodStats = lodPack.stats;

    const existingNodeIds = new Set(recipe.nodes.map((n) => n.id));
    const activeLayers = LAYER_DEFINITIONS.filter((l) => existingNodeIds.has(l.id));

    let renderer;
    const baseOptions = {
      ground: false,
      hdr: true,
      depth: true,
      culling: true,
      lodPixelError: isSoftwareGpu ? 2.2 : 1.1,
      world: scene.environment.world,
      environment: scene.environment,
      shadowBounds: resolveAgentShadow(scene.shadow, scene.environment.lightDirection),
      pixelRatio: isSoftwareGpu ? 1 : Math.min(window.devicePixelRatio || 1, 2),
      memoryBudgetMiB: 1024,
    };

    try {
      renderer = new Renderer67(canvas, lodPack.parts, { ...baseOptions, samples: isSoftwareGpu ? 1 : 4 });
    } catch {
      renderer = new Renderer67(canvas, lodPack.parts, { ...baseOptions, samples: 1 });
    }

    let currentTopologyRevision = scene.topologyRevision;
    let currentLighting = initialLighting;
    let lastShadowKey = JSON.stringify([scene.environment.lightDirection, scene.shadow]);

    function syncRendererFromScene() {
      lodPack = buildPartsWithLods(scene.parts);
      lodStats = lodPack.stats;
      if (scene.topologyRevision !== currentTopologyRevision) {
        renderer.replaceParts(lodPack.parts, { retainedUnchanged: true });
        currentTopologyRevision = scene.topologyRevision;
      } else {
        renderer.updateParts(lodPack.parts);
      }

      renderer.world = scene.environment.world;
      const nextShadowKey = JSON.stringify([scene.environment.lightDirection, scene.shadow]);
      if (nextShadowKey !== lastShadowKey) {
        renderer.shadowBounds = resolveAgentShadow(scene.shadow, scene.environment.lightDirection);
        renderer.shadowsDirty = true;
        lastShadowKey = nextShadowKey;
      }
    }

    function setLightingMode(mode) {
      if (mode !== 'daylight' && mode !== 'sunset') return;
      currentLighting = mode;
      const nextLook = getLightingConfig(mode, metadata?.bounds, { origin: metadata?.origin });
      const nextEffects = isSoftwareGpu
        ? { ...nextLook.effects, ambientOcclusion: 0, bloom: { ...(nextLook.effects.bloom ?? {}), strength: 0 } }
        : nextLook.effects;
      scene.apply(
        [
          { type: 'set-environment', environment: { ...nextLook.environment, resolveCoplanar: false } },
          { type: 'set-effects', effects: nextEffects },
          { type: 'set-shadow', shadow: nextLook.shadow },
        ],
        { expectedRevision: scene.revision }
      );
      syncRendererFromScene();
      hud.setLightingMode(mode);
    }

    function setLayerVisible(layerId, visible) {
      if (!existingNodeIds.has(layerId)) return false;
      scene.apply([{ type: 'set-node', id: layerId, visible: Boolean(visible) }], { expectedRevision: scene.revision });
      syncRendererFromScene();
      hud.setLayerCheckbox(layerId, visible);
      return true;
    }

    const initialPreset = cameraPresets[0];
    const cameraController = createCameraController(canvas, initialCamera, {
      onModeChange: (mode) => hud.setCameraMode(mode),
    });

    const hud = createHudController({
      presets: cameraPresets,
      layers: activeLayers,
      initialPresetId: initialPreset.id,
      initialLighting: currentLighting,
      initialCameraMode: cameraController.getMode(),
      metadata,
      onPresetSelect: (preset) => cameraController.flyTo(preset.camera, 700),
      onCameraModeChange: (mode) => cameraController.setMode(mode),
      onLightingChange: (mode) => setLightingMode(mode),
      onLayerToggle: (layerId, visible) => setLayerVisible(layerId, visible),
    });

    const inspectInfo = scene.inspect({ limit: 1 });
    let frameCount = 0;
    let fpsTimer = performance.now();
    let currentFps = 60;
    let lastTime = performance.now();
    let rafId = 0;

    function handleResize() {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      if (canvas.clientWidth !== width || canvas.clientHeight !== height) {
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      renderer.resize();
    }

    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(document.body);
    handleResize();

    const framePayload = {
      eye: initialCamera.eye,
      target: initialCamera.target,
      up: initialCamera.up,
      fov: initialCamera.fov,
      near: initialCamera.near,
      far: initialCamera.far,
      environment: scene.environment,
      effects: scene.effects,
      exposure: scene.effects.exposure,
      time: 0,
    };

    function renderFrame(now) {
      const dt = Math.max(0.001, (now - lastTime) / 1000);
      lastTime = now;

      const cam = cameraController.update(dt);
      framePayload.eye = cam.eye;
      framePayload.target = cam.target;
      framePayload.up = cam.up;
      framePayload.fov = cam.fov;
      framePayload.near = cam.near;
      framePayload.far = cam.far;
      framePayload.environment = scene.environment;
      framePayload.effects = scene.effects;
      framePayload.exposure = scene.effects.exposure;

      renderer.render(framePayload);

      frameCount += 1;
      if (now - fpsTimer >= 500) {
        currentFps = Math.round((frameCount * 1000) / (now - fpsTimer));
        frameCount = 0;
        fpsTimer = now;
        hud.updateTelemetry({ fps: currentFps, camera: cam, stats: inspectInfo.counts });
      }

      rafId = requestAnimationFrame(renderFrame);
    }

    const startCam = cameraController.getCamera();
    renderer.render({
      ...startCam,
      environment: scene.environment,
      effects: scene.effects,
      exposure: scene.effects.exposure,
      time: 0,
    });
    hud.updateTelemetry({ fps: currentFps, camera: startCam, stats: inspectInfo.counts });

    statusEl?.classList.add('is-hidden');
    rafId = requestAnimationFrame(renderFrame);

    window.__BAHONAR_APP__ = {
      getCameraPresets: () => cameraPresets.map((p) => ({ id: p.id, label: p.label })),
      setCameraPreset: (id, immediate = false) => {
        const preset = cameraPresets.find((p) => p.id === id);
        if (!preset) return false;
        hud.setActivePreset(preset.id);
        cameraController.flyTo(preset.camera, immediate ? 0 : 600);
        return true;
      },
      setLightingMode,
      getLightingMode: () => currentLighting,
      setCameraMode: (mode) => {
        const next = cameraController.setMode(mode);
        hud.setCameraMode(next);
        return next;
      },
      getCameraMode: () => cameraController.getMode(),
      setLayerVisible,
      getLayerIds: () => activeLayers.map((l) => l.id),
      getStats: () => scene.inspect({ limit: 1 }).counts,
      getOptimizationStats: () => ({
        isSoftwareGpu,
        batches: renderer.batches?.length ?? 0,
        ...lodStats,
        memoryReport: typeof renderer.memoryReport === 'function' ? renderer.memoryReport() : null,
      }),
      getDiagnostics: () => renderer.diagnostics ?? [],
      getCamera: () => cameraController.getCamera(),
    };

    window.addEventListener('beforeunload', () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      cameraController.dispose();
      hud.dispose();
      renderer.dispose();
    });
  } catch (err) {
    console.error('[bahonar-3d] Failed to initialize renderer:', err);
    if (statusEl) {
      statusEl.classList.remove('is-hidden');
      statusEl.textContent = `Renderer error: ${err?.message ?? String(err)}`;
    }
    window.__BAHONAR_ERROR__ = err?.message ?? String(err);
  }
}

boot();
