/**
 * Interactive camera controller (Orbit/Pan/Zoom + Free-Fly WASD/QE)
 * and maritime HUD controller for the 3D Shahid Bahonar Port web app.
 */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale3(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function len3(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function norm3(a) {
  const l = len3(a);
  return l > 1e-6 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, -1];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function createCameraController(canvas, initialCamera, { onModeChange } = {}) {
  let mode = 'orbit'; // 'orbit' | 'fly'
  let eye = [...(initialCamera?.eye ?? [-900, 420, 850])];
  let target = [...(initialCamera?.target ?? [0, 0, 0])];
  let up = [...(initialCamera?.up ?? [0, 1, 0])];
  let fov = initialCamera?.fov ?? 45;
  const near = initialCamera?.near ?? 1.5;
  const far = initialCamera?.far ?? 20000;

  // Spherical state derived from eye/target for orbit, and yaw/pitch for fly.
  let yaw = 0;
  let pitch = -0.35;
  let distance = 1200;
  let flySpeed = 160; // m/s

  // Smooth preset transition
  let transition = null;

  function syncAnglesFromVectors() {
    const offset = sub3(eye, target);
    const d = Math.max(8, len3(offset));
    distance = d;
    // Direction from target to eye:
    const dir = scale3(offset, 1 / d);
    // Avoid gimbal lock when strictly top-down
    const clampedY = clamp(dir[1], -0.9995, 0.9995);
    const horiz = Math.hypot(dir[0], dir[2]);
    if (horiz > 1e-3) {
      yaw = Math.atan2(dir[0], dir[2]);
    }
    pitch = Math.asin(clampedY);
  }

  function applyOrbitVectors() {
    const cosP = Math.cos(pitch);
    const dirFromTarget = [
      Math.sin(yaw) * cosP,
      Math.sin(pitch),
      Math.cos(yaw) * cosP,
    ];
    eye = add3(target, scale3(dirFromTarget, distance));
    // Keep camera above water floor unless flying low
    if (eye[1] < 2.0) {
      eye[1] = 2.0;
    }
    up = [0, 1, 0];
  }

  function getForwardFromEye() {
    return norm3(sub3(target, eye));
  }

  function setFlyOrientation(lookYaw, lookPitch) {
    // lookYaw/lookPitch describe look direction from eye -> target
    const cosP = Math.cos(lookPitch);
    const fwd = [
      Math.sin(lookYaw) * cosP,
      Math.sin(lookPitch),
      Math.cos(lookYaw) * cosP,
    ];
    target = add3(eye, scale3(fwd, Math.max(50, distance)));
    up = [0, 1, 0];
  }

  syncAnglesFromVectors();

  const keys = new Set();
  let dragging = false;
  let dragButton = 0;
  let lastX = 0;
  let lastY = 0;
  let flyYaw = Math.atan2(target[0] - eye[0], target[2] - eye[2]);
  let flyPitch = Math.asin(clamp(norm3(sub3(target, eye))[1], -0.99, 0.99));

  function syncFlyAngles() {
    const fwd = getForwardFromEye();
    if (Math.hypot(fwd[0], fwd[2]) > 1e-3) {
      flyYaw = Math.atan2(fwd[0], fwd[2]);
    }
    flyPitch = Math.asin(clamp(fwd[1], -1.48, 1.48));
  }

  function onPointerDown(e) {
    if (e.target !== canvas) return;
    transition = null;
    dragging = true;
    dragButton = e.button;
    lastX = e.clientX;
    lastY = e.clientY;
    if (mode === 'fly') syncFlyAngles();
    else syncAnglesFromVectors();
    canvas.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (mode === 'orbit') {
      const isPan = dragButton === 2 || dragButton === 1 || e.shiftKey;
      if (isPan) {
        const fwd = norm3(sub3(target, eye));
        const right = norm3(cross3(fwd, [0, 1, 0]));
        const camUp = norm3(cross3(right, fwd));
        const panScale = distance * 0.0014;
        const delta = add3(
          scale3(right, -dx * panScale),
          scale3(camUp, dy * panScale)
        );
        eye = add3(eye, delta);
        target = add3(target, delta);
      } else {
        yaw -= dx * 0.0055;
        pitch = clamp(pitch + dy * 0.0055, 0.04, Math.PI * 0.495);
        applyOrbitVectors();
      }
    } else {
      flyYaw -= dx * 0.0042;
      flyPitch = clamp(flyPitch - dy * 0.0042, -1.45, 1.45);
      setFlyOrientation(flyYaw, flyPitch);
    }
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    canvas.releasePointerCapture?.(e.pointerId);
  }

  function onWheel(e) {
    if (e.target !== canvas) return;
    e.preventDefault();
    transition = null;
    if (mode === 'orbit') {
      syncAnglesFromVectors();
      distance = clamp(distance * Math.exp(e.deltaY * 0.0011), 12, 12000);
      applyOrbitVectors();
    } else {
      flySpeed = clamp(flySpeed * Math.exp(-e.deltaY * 0.001), 15, 900);
    }
  }

  function onContextMenu(e) {
    if (e.target === canvas) e.preventDefault();
  }

  function onKeyDown(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    keys.add(e.code);
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function onBlur() {
    keys.clear();
    dragging = false;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  function setMode(nextMode) {
    if (nextMode !== 'orbit' && nextMode !== 'fly') return mode;
    if (mode !== nextMode) {
      mode = nextMode;
      if (mode === 'fly') {
        syncFlyAngles();
      } else {
        syncAnglesFromVectors();
        up = [0, 1, 0];
      }
      onModeChange?.(mode);
    }
    return mode;
  }

  function flyTo(presetCamera, durationMs = 700) {
    if (!presetCamera) return;
    if (durationMs <= 0) {
      eye = [...presetCamera.eye];
      target = [...presetCamera.target];
      up = [...(presetCamera.up ?? [0, 1, 0])];
      fov = presetCamera.fov ?? 45;
      transition = null;
      syncAnglesFromVectors();
      syncFlyAngles();
      return;
    }
    transition = {
      startTime: performance.now(),
      durationMs,
      fromEye: [...eye],
      fromTarget: [...target],
      fromUp: [...up],
      fromFov: fov,
      toEye: [...presetCamera.eye],
      toTarget: [...presetCamera.target],
      toUp: [...(presetCamera.up ?? [0, 1, 0])],
      toFov: presetCamera.fov ?? 45,
    };
  }

  function update(dtSeconds) {
    const dt = Math.min(dtSeconds, 0.1);

    if (transition) {
      const elapsed = performance.now() - transition.startTime;
      const rawT = clamp(elapsed / transition.durationMs, 0, 1);
      // Cubic ease in-out
      const t = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
      eye = lerp3(transition.fromEye, transition.toEye, t);
      target = lerp3(transition.fromTarget, transition.toTarget, t);
      up = norm3(lerp3(transition.fromUp, transition.toUp, t));
      fov = lerp(transition.fromFov, transition.toFov, t);
      if (rawT >= 1) {
        eye = [...transition.toEye];
        target = [...transition.toTarget];
        up = [...transition.toUp];
        fov = transition.toFov;
        transition = null;
        syncAnglesFromVectors();
        syncFlyAngles();
      }
      return getCamera();
    }

    // Keyboard movement works in fly mode, and WASD also pans/flies smoothly if pressed
    const moveFwd =
      (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
      (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const moveRight =
      (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
      (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const moveUp =
      (keys.has('KeyE') || keys.has('Space') ? 1 : 0) -
      (keys.has('KeyQ') || keys.has('KeyC') ? 1 : 0);

    if (moveFwd !== 0 || moveRight !== 0 || moveUp !== 0) {
      const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3.2 : 1.0;
      const speed = (mode === 'fly' ? flySpeed : Math.max(80, distance * 0.35)) * boost * dt;
      const fwd = getForwardFromEye();
      const right = norm3(cross3(fwd, [0, 1, 0]));
      let delta = [0, 0, 0];
      if (mode === 'fly') {
        delta = add3(delta, scale3(fwd, moveFwd * speed));
      } else {
        const flatFwd = norm3([fwd[0], 0, fwd[2]]);
        delta = add3(delta, scale3(flatFwd, moveFwd * speed));
      }
      delta = add3(delta, scale3(right, moveRight * speed));
      delta[1] += moveUp * speed;

      eye = add3(eye, delta);
      target = add3(target, delta);
      if (eye[1] < 1.5) eye[1] = 1.5;
    }

    return getCamera();
  }

  function getCamera() {
    return {
      eye: [...eye],
      target: [...target],
      up: [...up],
      fov,
      near,
      far,
    };
  }

  function dispose() {
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  }

  return {
    update,
    flyTo,
    setMode,
    getMode: () => mode,
    getFlySpeed: () => flySpeed,
    getCamera,
    dispose,
  };
}

export function createHudController({
  presets,
  layers,
  initialPresetId,
  initialLighting = 'daylight',
  initialCameraMode = 'orbit',
  metadata = {},
  onPresetSelect,
  onCameraModeChange,
  onLightingChange,
  onLayerToggle,
}) {
  const presetButtons = new Map();
  const layerInputs = new Map();

  const presetBarEl = document.getElementById('preset-bar');
  const layerListEl = document.getElementById('layer-list');
  const modeBtnEl = document.getElementById('btn-camera-mode');
  const lightingBtnEl = document.getElementById('btn-lighting-mode');
  const hudPanelEl = document.getElementById('hud-layers-panel');
  const togglePanelBtnEl = document.getElementById('btn-toggle-panel');
  const telemetryEl = document.getElementById('hud-telemetry');
  const originEl = document.getElementById('hud-origin');

  if (originEl && metadata?.origin) {
    const { lat, lon } = metadata.origin;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      originEl.textContent = `${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E · Bandar Abbas`;
    }
  }

  if (presetBarEl) {
    presetBarEl.innerHTML = '';
    for (const preset of presets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-pill' + (preset.id === initialPresetId ? ' is-active' : '');
      btn.dataset.presetId = preset.id;
      btn.title = preset.description || preset.label;
      btn.innerHTML = `<span class="kbd">${preset.hotkey ?? ''}</span><span>${preset.label}</span>`;
      btn.addEventListener('click', () => {
        setActivePreset(preset.id);
        onPresetSelect?.(preset);
      });
      presetBarEl.appendChild(btn);
      presetButtons.set(preset.id, btn);
    }
  }

  if (layerListEl) {
    layerListEl.innerHTML = '';
    for (const layer of layers) {
      const row = document.createElement('label');
      row.className = 'layer-row';
      row.title = layer.note;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.dataset.layerId = layer.id;
      checkbox.addEventListener('change', () => {
        onLayerToggle?.(layer.id, checkbox.checked);
      });

      const nameSpan = document.createElement('span');
      nameSpan.className = 'layer-name';
      nameSpan.textContent = layer.label;

      const badge = document.createElement('span');
      badge.className = `badge ${layer.grounded ? 'badge-osm' : 'badge-approx'}`;
      badge.textContent = layer.grounded ? 'OSM' : 'Approx';

      row.appendChild(checkbox);
      row.appendChild(nameSpan);
      row.appendChild(badge);
      layerListEl.appendChild(row);
      layerInputs.set(layer.id, checkbox);
    }
  }

  let currentLighting = initialLighting;
  let currentMode = initialCameraMode;

  function renderModeButton() {
    if (!modeBtnEl) return;
    modeBtnEl.textContent = currentMode === 'orbit' ? 'Mode: Orbit (M)' : 'Mode: Free-Fly (M)';
    modeBtnEl.classList.toggle('is-accent', currentMode === 'fly');
  }

  function renderLightingButton() {
    if (!lightingBtnEl) return;
    lightingBtnEl.textContent = currentLighting === 'daylight' ? 'Light: Daylight (L)' : 'Light: Sunset (L)';
    lightingBtnEl.classList.toggle('is-sunset', currentLighting === 'sunset');
  }

  renderModeButton();
  renderLightingButton();

  modeBtnEl?.addEventListener('click', () => {
    const next = currentMode === 'orbit' ? 'fly' : 'orbit';
    setCameraMode(next);
    onCameraModeChange?.(next);
  });

  lightingBtnEl?.addEventListener('click', () => {
    const next = currentLighting === 'daylight' ? 'sunset' : 'daylight';
    setLightingMode(next);
    onLightingChange?.(next);
  });

  togglePanelBtnEl?.addEventListener('click', () => {
    if (!hudPanelEl) return;
    const collapsed = hudPanelEl.classList.toggle('is-collapsed');
    togglePanelBtnEl.textContent = collapsed ? 'Layers ▸' : 'Layers ▾';
  });

  function setActivePreset(presetId) {
    for (const [id, btn] of presetButtons) {
      btn.classList.toggle('is-active', id === presetId);
    }
  }

  function setCameraMode(next) {
    currentMode = next;
    renderModeButton();
  }

  function setLightingMode(next) {
    currentLighting = next;
    renderLightingButton();
  }

  function setLayerCheckbox(layerId, visible) {
    const input = layerInputs.get(layerId);
    if (input) input.checked = Boolean(visible);
  }

  function updateTelemetry({ fps, camera, stats }) {
    if (!telemetryEl) return;
    const alt = Math.round(camera?.eye?.[1] ?? 0);
    const x = Math.round(camera?.eye?.[0] ?? 0);
    const z = Math.round(camera?.eye?.[2] ?? 0);
    const parts = stats?.nodes ?? 0;
    const verts = stats?.vertices ?? 0;
    telemetryEl.textContent = `${fps} FPS · Alt ${alt}m · (${x}, ${z}) · ${parts} parts · ${verts.toLocaleString()} verts`;
  }

  function onHotkeys(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'KeyM') {
      const next = currentMode === 'orbit' ? 'fly' : 'orbit';
      setCameraMode(next);
      onCameraModeChange?.(next);
    } else if (e.code === 'KeyL') {
      const next = currentLighting === 'daylight' ? 'sunset' : 'daylight';
      setLightingMode(next);
      onLightingChange?.(next);
    } else if (e.code === 'KeyH') {
      if (hudPanelEl) {
        const collapsed = hudPanelEl.classList.toggle('is-collapsed');
        if (togglePanelBtnEl) togglePanelBtnEl.textContent = collapsed ? 'Layers ▸' : 'Layers ▾';
      }
    } else if (e.key >= '1' && e.key <= '4') {
      const preset = presets[Number(e.key) - 1];
      if (preset) {
        setActivePreset(preset.id);
        onPresetSelect?.(preset);
      }
    }
  }

  window.addEventListener('keydown', onHotkeys);

  return {
    setActivePreset,
    setCameraMode,
    setLightingMode,
    setLayerCheckbox,
    updateTelemetry,
    dispose: () => window.removeEventListener('keydown', onHotkeys),
  };
}
