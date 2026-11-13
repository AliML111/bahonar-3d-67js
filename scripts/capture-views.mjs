import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const require = createRequire(`${root}/package.json`);
const { chromium } = require('playwright-core');

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 4195;
      srv.close((err) => (err ? reject(err) : resolvePort(port)));
    });
  });
}

const PORT = await getFreePort();
const SCREENSHOT_DIR = resolve(root, 'screenshots');
if (!existsSync(SCREENSHOT_DIR)) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const VIEWS = [
  {
    id: 'app-overview',
    filename: 'app-overview.png',
    title: 'Shahid Bahonar Port Full Harbor Overview (Daylight)',
    cam: '-1350,880,1850,100,10,-450',
    light: 'daylight',
    hud: '1',
  },
  {
    id: 'app-sunset',
    filename: 'app-sunset.png',
    title: 'Shahid Bahonar Port Sunset Horizon & Approach Channel',
    cam: '-1350,880,1850,100,10,-450',
    light: 'sunset',
    hud: '1',
  },
  {
    id: 'audit-feeder-berth',
    filename: 'audit-feeder-berth.png',
    title: 'Feeder Container Ship & STS Gantry Cranes (West Quay)',
    cam: '-160,42,-760,-24,14,-870',
    light: 'daylight',
    hud: '0',
  },
  {
    id: 'audit-cargo-cranes',
    filename: 'audit-cargo-cranes.png',
    title: 'General Cargo Coaster, Berth Edge & Cranes',
    cam: '-140,36,-460,-22,10,-560',
    light: 'daylight',
    hud: '0',
  },
  {
    id: 'audit-ferry-oil',
    filename: 'audit-ferry-oil.png',
    title: 'Hormozgan Ferries, Terminal & Oil Tank Farm',
    cam: '-170,90,-1320,280,15,-1510',
    light: 'daylight',
    hud: '0',
  },
  {
    id: 'audit-smallboat-dhow-tug',
    filename: 'audit-smallboat-dhow-tug.png',
    title: 'Persian Gulf Wooden Cargo Dhows & Service Berths',
    cam: '35,30,-940,112,6,-1060',
    light: 'daylight',
    hud: '0',
  },
  {
    id: 'audit-warehouses-roads',
    filename: 'audit-warehouses-roads.png',
    title: 'Central Cargo Sheds, Port Roads & Apron Junction',
    cam: '-270,85,-670,-40,12,-830',
    light: 'daylight',
    hud: '0',
  },
  {
    id: 'audit-entrance-breakwater',
    filename: 'audit-entrance-breakwater.png',
    title: 'Harbor Entrance Breakwaters, Channel & Inbound Vessel',
    cam: '-120,140,1450,45,12,860',
    light: 'daylight',
    hud: '0',
  },
  {
    id: 'audit-satellite-topdown',
    filename: 'audit-satellite-topdown.png',
    title: 'Top-Down Aerial Satellite Calibration View',
    cam: '-250,2800,-650,-250,0,-651',
    light: 'daylight',
    hud: '0',
  },
  {
    id: 'audit-shipyard-drydocks',
    filename: 'audit-shipyard-drydocks.png',
    title: 'Shipyard Maintenance Basin, Drydock Caissons & Slipway',
    cam: '-550,110,-420,-240,8,-520',
    light: 'daylight',
    hud: '0',
  },
  {
    id: 'audit-sahand-park-palms',
    filename: 'audit-sahand-park-palms.png',
    title: 'Sahand Coastal Park Date Palms, Beach & Gazebos',
    cam: '-1450,90,480,-1150,8,360',
    light: 'daylight',
    hud: '0',
  },
  {
    id: 'audit-vehicles-gate',
    filename: 'audit-vehicles-gate.png',
    title: 'Customs Gate Truck Queue & Ferry Terminal Parking Cars',
    cam: '240,75,-1360,85,10,-1560',
    light: 'daylight',
    hud: '0',
  },
  {
    id: 'audit-all-berths-vessels',
    filename: 'audit-all-berths-vessels.png',
    title: 'Broad Basin View of Active Vessels Across All Quays',
    cam: '-650,480,550,250,10,-650',
    light: 'daylight',
    hud: '0',
  },
];

async function waitForServer(url, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

const srv = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  {
    cwd: root,
    stdio: 'inherit',
  }
);

let browser;
try {
  await waitForServer(`http://127.0.0.1:${PORT}/`);

  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'],
  });

  const savedFiles = [];

  for (const view of VIEWS) {
    const page = await browser.newPage({
      viewport: { width: 1024, height: 640 },
      deviceScaleFactor: 1,
    });
    page.on('pageerror', (err) => console.error('[browser pageerror]', err.message));

    try {
      const url = `http://127.0.0.1:${PORT}/?cam=${view.cam}&light=${view.light}&hud=${view.hud || '0'}`;
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(
        () => Boolean(window.__BAHONAR_APP__) || Boolean(window.__BAHONAR_ERROR__),
        null,
        { timeout: 60000 }
      );

      const appErr = await page.evaluate(() => window.__BAHONAR_ERROR__);
      if (appErr) {
        throw new Error(`Renderer initialization error: ${appErr}`);
      }

      // Wait for frame render and shadow pass
      await new Promise((r) => setTimeout(r, 600));

      const outPath = resolve(SCREENSHOT_DIR, view.filename);
      await page.screenshot({ path: outPath });
      savedFiles.push({ filename: view.filename, title: view.title, path: outPath });
      console.log(`[captured] ${view.filename} (${view.title})`);
    } catch (err) {
      console.error(`[capture error] on ${view.filename}:`, err);
      throw err;
    } finally {
      await page.close();
    }
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        count: savedFiles.length,
        savedFiles,
      },
      null,
      2
    )
  );
} finally {
  if (browser) await browser.close();
  srv.kill();
}
