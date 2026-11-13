import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import zlib from 'node:zlib';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 4179;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHttpReady(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

function listFilesRecursive(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Decodes raw decompressed IDAT bytes from a Playwright PNG screenshot to verify
 * the clipped 3D viewport is not a single flat/blank color.
 */
function measurePngByteVariance(pngBuffer) {
  assert.equal(pngBuffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'valid PNG header');
  const idatChunks = [];
  let offset = 8;
  while (offset + 8 <= pngBuffer.length) {
    const len = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = pngBuffer.subarray(offset + 8, offset + 8 + len);
    if (type === 'IDAT') idatChunks.push(data);
    offset += 12 + len;
    if (type === 'IEND') break;
  }
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const uniqueSampleBytes = new Set();
  const step = Math.max(1, Math.floor(inflated.length / 4000));
  for (let i = 0; i < inflated.length; i += step) {
    uniqueSampleBytes.add(inflated[i]);
  }
  return { inflatedBytes: inflated.length, uniqueSampleBytes: uniqueSampleBytes.size };
}

describe('Web App Build, Syntax & Headless Chrome E2E', () => {
  it('passes Node syntax checks across src/ and scripts/ and builds cleanly with Vite', async () => {
    const files = [
      ...listFilesRecursive(path.join(ROOT, 'src'), ['.js', '.mjs']),
      ...listFilesRecursive(path.join(ROOT, 'scripts'), ['.js', '.mjs']),
    ];
    assert.ok(files.length >= 4, 'expected source and script files to check');

    for (const file of files) {
      if (file.endsWith('.mjs') || file.includes(`${path.sep}src${path.sep}`)) {
        const source = fs.readFileSync(file, 'utf8');
        await new Promise((resolve, reject) => {
          const proc = spawn(process.execPath, ['--input-type=module', '--check'], {
            cwd: ROOT,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          let stderr = '';
          proc.stderr.on('data', (d) => {
            stderr += d.toString();
          });
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Syntax check failed for ${file}:\n${stderr}`));
          });
          proc.stdin.end(source);
        });
      } else {
        await execFileAsync(process.execPath, ['--check', file], { cwd: ROOT });
      }
    }

    const { stdout, stderr } = await execFileAsync(process.execPath, [VITE_BIN, 'build'], {
      cwd: ROOT,
      timeout: 60000,
    });
    assert.ok(fs.existsSync(path.join(ROOT, 'dist', 'index.html')), 'dist/index.html must exist after vite build');
    assert.ok(!/error/i.test(stderr), `unexpected build stderr: ${stderr}`);
    assert.ok(stdout.length > 0, 'vite build produced output');
  });

  it('renders in headless Chrome with zero console/page errors, working presets, lighting toggle, camera mode, and layer toggles', { timeout: 120000 }, async () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'dist', 'index.html')), 'dist/index.html must be built before preview');
    assert.ok(
      fs.existsSync(path.join(ROOT, 'data', 'scene', 'final-recipe.json')),
      'data/scene/final-recipe.json must exist for full app E2E verification'
    );

    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}/`;
    const serverProc = spawn(
      process.execPath,
      [VITE_BIN, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let browser;
    try {
      await waitForHttpReady(baseUrl);

      browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'],
      });

      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      page.on('pageerror', (err) => {
        pageErrors.push(err?.message ?? String(err));
      });
      page.on('requestfailed', (req) => {
        failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? 'failed'})`);
      });

      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => Boolean(window.__BAHONAR_APP__) || Boolean(window.__BAHONAR_ERROR__),
        null,
        { timeout: 60000 }
      );

      const bootError = await page.evaluate(() => window.__BAHONAR_ERROR__ ?? null);
      assert.equal(bootError, null, `App boot error: ${bootError}`);

      await page.waitForSelector('#hud-status.is-hidden', { state: 'attached', timeout: 10000 });

      const appInfo = await page.evaluate(() => ({
        presets: window.__BAHONAR_APP__.getCameraPresets(),
        layers: window.__BAHONAR_APP__.getLayerIds(),
        stats: window.__BAHONAR_APP__.getStats(),
        diagnostics: window.__BAHONAR_APP__.getDiagnostics(),
        lighting: window.__BAHONAR_APP__.getLightingMode(),
        cameraMode: window.__BAHONAR_APP__.getCameraMode(),
        canvasRect: document.getElementById('viewport')?.getBoundingClientRect().toJSON(),
      }));

      assert.equal(appInfo.diagnostics.length, 0, `Renderer diagnostics: ${JSON.stringify(appInfo.diagnostics)}`);
      assert.ok(appInfo.canvasRect.width >= 1200 && appInfo.canvasRect.height >= 700, 'canvas fills viewport');
      assert.ok(appInfo.stats.nodes > 150 && appInfo.stats.vertices > 10000, 'full port scene loaded');
      assert.ok(appInfo.layers.length >= 8 && appInfo.layers.length <= 10, `expected at least 8 layer groups, got ${JSON.stringify(appInfo.layers)}`);
      assert.equal(appInfo.presets.length, 4, `expected 4 camera presets, got ${JSON.stringify(appInfo.presets)}`);

      // Wait 2 animation frames so scene is rendered
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

      const screenshotsDir = path.join(ROOT, 'screenshots');
      fs.mkdirSync(screenshotsDir, { recursive: true });
      const overviewShotPath = path.join(screenshotsDir, 'app-overview.png');
      const sunsetShotPath = path.join(screenshotsDir, 'app-sunset.png');

      // Capture daylight overview screenshot & center canvas region (away from HUD overlays)
      await page.screenshot({ path: overviewShotPath });
      const clip = { x: 420, y: 120, width: 440, height: 420 };
      const daylightPng = await page.screenshot({ clip });
      const variance = measurePngByteVariance(daylightPng);
      assert.ok(
        variance.uniqueSampleBytes >= 16,
        `daylight canvas appears flat/blank (uniqueSampleBytes=${variance.uniqueSampleBytes})`
      );

      // Test camera presets via UI buttons
      const seenEyes = [];
      for (const preset of appInfo.presets) {
        const btn = page.locator(`#preset-bar button[data-preset-id="${preset.id}"]`);
        await btn.click();
        await page.waitForTimeout(750);
        const cam = await page.evaluate(() => window.__BAHONAR_APP__.getCamera());
        assert.ok(cam.eye.every(Number.isFinite), `preset ${preset.id} eye must be finite`);
        seenEyes.push(cam.eye.map((v) => Math.round(v)).join(','));
      }
      assert.ok(new Set(seenEyes).size >= 3, `camera presets should move camera to distinct viewpoints: ${seenEyes.join(' | ')}`);

      // Return to Harbor Overview before sunset screenshot
      await page.locator('#preset-bar button[data-preset-id="harbor-overview"]').click();
      await page.waitForTimeout(750);

      // Test daylight <-> sunset lighting toggle
      assert.equal(await page.evaluate(() => window.__BAHONAR_APP__.getLightingMode()), 'daylight');
      await page.click('#btn-lighting-mode');
      await page.waitForFunction(() => window.__BAHONAR_APP__.getLightingMode() === 'sunset');
      const sunsetBtnText = await page.textContent('#btn-lighting-mode');
      assert.match(sunsetBtnText, /Sunset/i);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: sunsetShotPath });
      const sunsetPng = await page.screenshot({ clip });
      assert.ok(!daylightPng.equals(sunsetPng), 'sunset lighting toggle must visibly change rendered canvas');
      assert.ok(fs.statSync(overviewShotPath).size > 10000, 'screenshots/app-overview.png saved');
      assert.ok(fs.statSync(sunsetShotPath).size > 10000, 'screenshots/app-sunset.png saved');

      await page.click('#btn-lighting-mode');
      await page.waitForFunction(() => window.__BAHONAR_APP__.getLightingMode() === 'daylight');

      // Test orbit <-> free-fly camera mode toggle & WASD movement
      await page.click('#btn-camera-mode');
      await page.waitForFunction(() => window.__BAHONAR_APP__.getCameraMode() === 'fly');
      const beforeFly = await page.evaluate(() => window.__BAHONAR_APP__.getCamera().eye);
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(250);
      await page.keyboard.up('KeyW');
      const afterFly = await page.evaluate(() => window.__BAHONAR_APP__.getCamera().eye);
      const movedDist = Math.hypot(
        afterFly[0] - beforeFly[0],
        afterFly[1] - beforeFly[1],
        afterFly[2] - beforeFly[2]
      );
      assert.ok(movedDist > 1, `free-fly WASD should move camera (moved ${movedDist}m)`);
      await page.click('#btn-camera-mode');
      await page.waitForFunction(() => window.__BAHONAR_APP__.getCameraMode() === 'orbit');

      // Test layer visibility toggle
      const firstCheckbox = page.locator('#layer-list input[type="checkbox"]').first();
      await firstCheckbox.uncheck();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      await firstCheckbox.check();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));

      assert.deepEqual(consoleErrors, [], `Console errors: ${consoleErrors.join('; ')}`);
      assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join('; ')}`);
      assert.deepEqual(failedRequests, [], `Failed requests: ${failedRequests.join('; ')}`);
    } finally {
      if (browser) await browser.close();
      serverProc.kill('SIGTERM');
    }
  });
});
