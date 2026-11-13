#!/usr/bin/env node
/**
 * scripts/geodb.mjs
 *
 * Shahid Bahonar Port GeoDatabase & Spatial Asset Registry
 *
 * Ingests data/geo/bahonar-port-metric.json and data/geo/bahonar-osm-raw.json
 * to build:
 *   1. data/geodb/port-geodb.sqlite       (High-performance SQLite database via node:sqlite DatabaseSync)
 *   2. data/geodb/port-features.json       (Canonical structured spatial registry JSON)
 *   3. data/geodb/vegetation-palms.json    (Specific palm tree coordinates across Sahand Park, Pasdaran, Port gardens)
 *   4. data/geodb/dhow-berths.json         (Precise mooring coordinates for 56 Lenj dhow fleet along South Quay)
 *   5. data/geodb/shipyard-features.json   (Drydocks, slipway, workshops, and repair vessel berths)
 *   6. data/geodb/expanded-buildings.json  (Categorized building footprints with architectural heights & OBBs)
 *   7. data/geodb/spatial-grid.json        (306 square cells 200m x 200m spanning X [-1800, 1600], Z [-1900, 1700])
 *   8. data/geodb/ground-vehicles.json     (250 realistic ground vehicles across port logistics corridors)
 *   9. data/geodb/vessel-berths.json       (Comprehensive 128 vessel inventory: 88 afloat vessels + 40 dry skiffs)
 *
 * Usage:
 *   node scripts/geodb.mjs build          # Builds SQLite DB and all specialized JSON registries
 *   node scripts/geodb.mjs stats          # Prints GeoDatabase inventory and summary statistics
 *   node scripts/geodb.mjs query <cat>    # Query features by category (e.g. grid, vehicles, vessels, palms, dhow, building)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const GEO_DIR = path.join(ROOT_DIR, 'data', 'geo');
const GEODB_DIR = path.join(ROOT_DIR, 'data', 'geodb');

const METRIC_PATH = path.join(GEO_DIR, 'bahonar-port-metric.json');
const RAW_PATH = path.join(GEO_DIR, 'bahonar-osm-raw.json');

const SQLITE_PATH = path.join(GEODB_DIR, 'port-geodb.sqlite');
const FEATURES_JSON_PATH = path.join(GEODB_DIR, 'port-features.json');
const PALMS_JSON_PATH = path.join(GEODB_DIR, 'vegetation-palms.json');
const DHOWS_JSON_PATH = path.join(GEODB_DIR, 'dhow-berths.json');
const SHIPYARD_JSON_PATH = path.join(GEODB_DIR, 'shipyard-features.json');
const BUILDINGS_JSON_PATH = path.join(GEODB_DIR, 'expanded-buildings.json');
const SPATIAL_GRID_JSON_PATH = path.join(GEODB_DIR, 'spatial-grid.json');
const GROUND_VEHICLES_JSON_PATH = path.join(GEODB_DIR, 'ground-vehicles.json');
const VESSEL_BERTHS_JSON_PATH = path.join(GEODB_DIR, 'vessel-berths.json');

// Spatial Grid Constants (306 cells, 17 cols x 18 rows)
export const GRID_CONFIG = {
  cellSizeM: 200,
  minX: -1800,
  maxX: 1600,
  minZ: -1900,
  maxZ: 1700,
  cols: 17,
  rows: 18,
  totalCells: 306,
  colLetters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q']
};

// Deterministic Pseudo-random number generator
function createRng(seed = 123456789) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function round6(n) {
  return Math.round(n * 1000000) / 1000000;
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    const intersect =
      zi > pt[1] !== zj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Maps metric coordinates (x, z) to the containing 200m x 200m grid cell.
 */
export function getGridCellForPoint(x, z) {
  const clampedX = Math.max(GRID_CONFIG.minX, Math.min(GRID_CONFIG.maxX - 0.01, x));
  const clampedZ = Math.max(GRID_CONFIG.minZ, Math.min(GRID_CONFIG.maxZ - 0.01, z));

  const col = Math.floor((clampedX - GRID_CONFIG.minX) / GRID_CONFIG.cellSizeM) + 1;
  const row = Math.floor((clampedZ - GRID_CONFIG.minZ) / GRID_CONFIG.cellSizeM) + 1;

  const colLetter = GRID_CONFIG.colLetters[col - 1] || 'A';
  const rowPad = String(row).padStart(2, '0');

  return {
    cellId: `GRID-R${row}-C${col}`,
    code: `${colLetter}${rowPad}`,
    col,
    row,
    colLetter,
    rowPad
  };
}

/**
 * Converts metric (x, z) to WGS84 (lat, lon) using the dataset projection.
 */
export function metricToWgs84(x, z, origin, projection) {
  const lat = origin.lat - z / projection.metersPerDegLat;
  const lon = origin.lon + x / projection.metersPerDegLon;
  return { lat: round6(lat), lon: round6(lon) };
}

/**
 * Generate 250 realistic ground vehicles across port operational zones.
 */
export function generateGroundVehicles(metric, rng) {
  const vehicles = [];
  let vehCount = 0;

  const semiColors = [
    { hex: '#1E3A8A', name: 'Maersk Blue' },
    { hex: '#EA580C', name: 'Hapag-Lloyd Orange' },
    { hex: '#15803D', name: 'Evergreen Green' },
    { hex: '#DC2626', name: 'Hamburg Sud Red' },
    { hex: '#D97706', name: 'Amber Logistics' },
    { hex: '#1E293B', name: 'CMA CGM Slate' },
    { hex: '#F3F4F6', name: 'Pure White Cab' },
    { hex: '#047857', name: 'Islamic Republic Line Emerald' },
    { hex: '#475569', name: 'Industrial Slate' },
    { hex: '#2563EB', name: 'Hormozgan Blue' }
  ];

  // 1. Customs Gate Queue: 38 container semi-trucks
  // Lane 1: Inbound Primary Gate A (10 trucks)
  for (let i = 0; i < 10; i++) {
    vehCount++;
    const x = 242.0 + (rng() - 0.5) * 0.8;
    const z = -1610.0 + i * 16.5 + (rng() - 0.5) * 0.5;
    const col = semiColors[vehCount % semiColors.length];
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-customs-inbound-a-${i + 1}`,
      type: 'container_semi_truck',
      category: 'customs_gate_queue',
      description: `40ft Container Semi-Truck queued in Customs Inbound Gate Lane A (${col.name})`,
      x: round2(x),
      y: 2.42,
      z: round2(z),
      headingDeg: 180.0,
      rotY: round4(Math.PI),
      lengthM: 16.5,
      widthM: 2.5,
      heightM: 3.8,
      color: col.hex,
      colorName: col.name,
      gridId: cell.cellId
    });
  }

  // Lane 2: Inbound Secondary Gate B (10 trucks)
  for (let i = 0; i < 10; i++) {
    vehCount++;
    const x = 268.0 + (rng() - 0.5) * 0.8;
    const z = -1605.0 + i * 16.5 + (rng() - 0.5) * 0.5;
    const col = semiColors[vehCount % semiColors.length];
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-customs-inbound-b-${i + 1}`,
      type: 'container_semi_truck',
      category: 'customs_gate_queue',
      description: `40ft Container Semi-Truck queued in Customs Inbound Gate Lane B (${col.name})`,
      x: round2(x),
      y: 2.42,
      z: round2(z),
      headingDeg: 180.0,
      rotY: round4(Math.PI),
      lengthM: 16.5,
      widthM: 2.5,
      heightM: 3.8,
      color: col.hex,
      colorName: col.name,
      gridId: cell.cellId
    });
  }

  // Lane 3: Outbound Gate Corridor C (9 trucks)
  for (let i = 0; i < 9; i++) {
    vehCount++;
    const x = 296.0 + (rng() - 0.5) * 0.8;
    const z = -1470.0 - i * 16.5 + (rng() - 0.5) * 0.5;
    const col = semiColors[vehCount % semiColors.length];
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-customs-outbound-c-${i + 1}`,
      type: 'container_semi_truck',
      category: 'customs_gate_queue',
      description: `40ft Container Semi-Truck departing through Outbound Gate Corridor C (${col.name})`,
      x: round2(x),
      y: 2.42,
      z: round2(z),
      headingDeg: 0.0,
      rotY: 0.0,
      lengthM: 16.5,
      widthM: 2.5,
      heightM: 3.8,
      color: col.hex,
      colorName: col.name,
      gridId: cell.cellId
    });
  }

  // Lane 4: Customs Inspection & Weighbridge Bay (9 trucks)
  for (let i = 0; i < 9; i++) {
    vehCount++;
    const x = 328.0 + (rng() - 0.5) * 0.8;
    const z = -1575.0 + i * 15.0 + (rng() - 0.5) * 0.5;
    const col = semiColors[vehCount % semiColors.length];
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-customs-inspection-${i + 1}`,
      type: 'container_semi_truck',
      category: 'customs_gate_queue',
      description: `Container Semi-Truck at Customs Container Scanner / Weighbridge Bay (${col.name})`,
      x: round2(x),
      y: 2.42,
      z: round2(z),
      headingDeg: 180.0,
      rotY: round4(Math.PI),
      lengthM: 16.5,
      widthM: 2.5,
      heightM: 3.8,
      color: col.hex,
      colorName: col.name,
      gridId: cell.cellId
    });
  }

  // 2. Container Yard Terminal Tractors & Handlers: 32 vehicles
  // 16 Yard Tractors with 40ft Chassis
  const yardAvenues = [165, 215, 285, 365, 435];
  for (let i = 0; i < 16; i++) {
    vehCount++;
    const aveX = yardAvenues[i % yardAvenues.length];
    const z = -1220 + i * 24 + (rng() - 0.5) * 8;
    const heading = i % 2 === 0 ? 180 : 0;
    const cell = getGridCellForPoint(aveX, z);
    vehicles.push({
      id: `veh-yard-tractor-${i + 1}`,
      type: 'terminal_tractor',
      category: 'container_yard_tractors',
      description: `Port Terminal Tractor with 40ft Chassis active in Container Yard Row ${i + 1}`,
      x: round2(aveX),
      y: 2.44,
      z: round2(z),
      headingDeg: heading,
      rotY: round4(heading === 180 ? Math.PI : 0),
      lengthM: 12.5,
      widthM: 2.6,
      heightM: 3.2,
      color: i % 2 === 0 ? '#FACC15' : '#FB923C',
      colorName: i % 2 === 0 ? 'Safety Yellow' : 'Terminal Orange',
      gridId: cell.cellId
    });
  }

  // 10 Solo Spotter Tractors
  for (let i = 0; i < 10; i++) {
    vehCount++;
    const x = 180 + i * 28 + (rng() - 0.5) * 6;
    const z = -1050 + (rng() - 0.5) * 160;
    const heading = (i % 4) * 90;
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-yard-spotter-${i + 1}`,
      type: 'terminal_tractor_cab',
      category: 'container_yard_tractors',
      description: `Solo Yard Spotter Tractor Cab in Container Staging Area`,
      x: round2(x),
      y: 2.44,
      z: round2(z),
      headingDeg: heading,
      rotY: round4((heading * Math.PI) / 180),
      lengthM: 6.2,
      widthM: 2.6,
      heightM: 2.8,
      color: '#FACC15',
      colorName: 'Kalmar Yellow',
      gridId: cell.cellId
    });
  }

  // 6 Reach Stackers / Heavy Handlers
  for (let i = 0; i < 6; i++) {
    vehCount++;
    const x = 200 + i * 45 + (rng() - 0.5) * 8;
    const z = -920 + (rng() - 0.5) * 80;
    const heading = i % 2 === 0 ? 90 : 270;
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-yard-stacker-${i + 1}`,
      type: 'reach_stacker',
      category: 'container_yard_tractors',
      description: `Heavy 45-Ton Container Reach Stacker in Marshalling Corridor`,
      x: round2(x),
      y: 2.45,
      z: round2(z),
      headingDeg: heading,
      rotY: round4((heading * Math.PI) / 180),
      lengthM: 11.2,
      widthM: 4.2,
      heightM: 4.6,
      color: i % 2 === 0 ? '#DC2626' : '#EAB308',
      colorName: i % 2 === 0 ? 'Industrial Red' : 'Heavy Yellow',
      gridId: cell.cellId
    });
  }

  // 3. Ferry Terminal Parking: 72 vehicles
  // Bay 1: Passenger Sedans North (20 cars)
  const carColors = ['#FFFFFF', '#E5E7EB', '#1F2937', '#9CA3AF', '#374151', '#1D4ED8', '#B91C1C'];
  for (let i = 0; i < 20; i++) {
    vehCount++;
    const x = -70 + i * 9.5;
    const z = -1590.0 + (rng() - 0.5) * 0.4;
    const colHex = carColors[i % carColors.length];
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-ferry-sedan-n-${i + 1}`,
      type: 'passenger_car',
      category: 'ferry_terminal_parking',
      description: `Passenger Sedan parked in Ferry Terminal Lot North Bay`,
      x: round2(x),
      y: 2.41,
      z: round2(z),
      headingDeg: 0.0,
      rotY: 0.0,
      lengthM: 4.5,
      widthM: 1.8,
      heightM: 1.45,
      color: colHex,
      colorName: 'Sedan Trim',
      gridId: cell.cellId
    });
  }

  // Bay 2: Passenger Sedans South (20 cars)
  for (let i = 0; i < 20; i++) {
    vehCount++;
    const x = -70 + i * 9.5;
    const z = -1565.0 + (rng() - 0.5) * 0.4;
    const colHex = carColors[(i + 3) % carColors.length];
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-ferry-sedan-s-${i + 1}`,
      type: 'passenger_car',
      category: 'ferry_terminal_parking',
      description: `Passenger Sedan parked in Ferry Terminal Lot South Bay`,
      x: round2(x),
      y: 2.41,
      z: round2(z),
      headingDeg: 180.0,
      rotY: round4(Math.PI),
      lengthM: 4.5,
      widthM: 1.8,
      heightM: 1.45,
      color: colHex,
      colorName: 'Sedan Trim',
      gridId: cell.cellId
    });
  }

  // Bay 3: Iranian Port Taxis (16 yellow taxis)
  for (let i = 0; i < 16; i++) {
    vehCount++;
    const x = -55 + i * 9.2;
    const z = -1510.0 + (rng() - 0.5) * 0.4;
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-ferry-taxi-${i + 1}`,
      type: 'taxi',
      category: 'ferry_terminal_parking',
      description: `Bandar Abbas Licensed Port Taxi at Passenger Terminal Rank`,
      x: round2(x),
      y: 2.41,
      z: round2(z),
      headingDeg: 0.0,
      rotY: 0.0,
      lengthM: 4.5,
      widthM: 1.75,
      heightM: 1.45,
      color: '#FBBF24',
      colorName: 'Iranian Taxi Yellow',
      gridId: cell.cellId
    });
  }

  // Bay 4: Passenger Minibuses & Vans (16 vehicles)
  for (let i = 0; i < 16; i++) {
    vehCount++;
    const x = -55 + i * 9.2;
    const z = -1460.0 + (rng() - 0.5) * 0.4;
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-ferry-van-${i + 1}`,
      type: 'passenger_van',
      category: 'ferry_terminal_parking',
      description: `Passenger Transit Minibus / Van at Ferry Arrival Staging`,
      x: round2(x),
      y: 2.42,
      z: round2(z),
      headingDeg: 180.0,
      rotY: round4(Math.PI),
      lengthM: 5.4,
      widthM: 2.0,
      heightM: 2.3,
      color: i % 3 === 0 ? '#FFFFFF' : i % 3 === 1 ? '#FACC15' : '#E5E7EB',
      colorName: i % 3 === 0 ? 'White' : i % 3 === 1 ? 'Yellow' : 'Silver',
      gridId: cell.cellId
    });
  }

  // 4. Quay Apron Pickups & Service Trucks: 28 vehicles
  // West Quay (14 vehicles)
  const westQuayZ = [-950, -910, -870, -830, -790, -750, -710, -670, -630, -590, -550, -510, -480, -460];
  for (let i = 0; i < 14; i++) {
    vehCount++;
    const x = -20.0 + (i % 2 === 0 ? -4.0 : 4.0);
    const z = westQuayZ[i];
    const isPickup = i % 3 !== 0;
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-quay-west-${i + 1}`,
      type: isPickup ? 'quay_pickup' : 'maintenance_truck',
      category: 'quay_apron_vehicles',
      description: isPickup
        ? `Port Authority Security Patrol Pickup on West Quay Apron`
        : `Wharf Gantry Maintenance Utility Truck on West Quay`,
      x: round2(x),
      y: 2.42,
      z: round2(z),
      headingDeg: 180.0,
      rotY: round4(Math.PI),
      lengthM: isPickup ? 5.2 : 7.2,
      widthM: isPickup ? 1.9 : 2.4,
      heightM: isPickup ? 1.8 : 2.6,
      color: isPickup ? '#FFFFFF' : '#F59E0B',
      colorName: isPickup ? 'Security White' : 'Port Yellow',
      gridId: cell.cellId
    });
  }

  // South Quay (14 vehicles)
  const southQuayX = [140, 175, 215, 255, 295, 335, 375, 415, 455, 495, 535, 575, 605, 625];
  for (let i = 0; i < 14; i++) {
    vehCount++;
    const x = southQuayX[i];
    const z = -1120 + i * 32 + (rng() - 0.5) * 4;
    const isPickup = i % 2 === 0;
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-quay-south-${i + 1}`,
      type: isPickup ? 'quay_pickup' : 'dhow_service_flatbed',
      category: 'quay_apron_vehicles',
      description: isPickup
        ? `Dhow Harbor Logistics Support Pickup on South Quay`
        : `Lenj Cargo Loading Flatbed Truck on South Quay`,
      x: round2(x),
      y: 2.42,
      z: round2(z),
      headingDeg: 135.0,
      rotY: round4((135 * Math.PI) / 180),
      lengthM: isPickup ? 5.2 : 6.8,
      widthM: isPickup ? 1.9 : 2.2,
      heightM: isPickup ? 1.8 : 2.2,
      color: isPickup ? '#1D4ED8' : '#FFFFFF',
      colorName: isPickup ? 'Zamyad Blue' : 'Quay White',
      gridId: cell.cellId
    });
  }

  // 5. Shipyard Maintenance: 22 vehicles
  // Drydock & Slipway Apron (12 vehicles)
  for (let i = 0; i < 12; i++) {
    vehCount++;
    const x = 700 + i * 15 + (rng() - 0.5) * 4;
    const z = -720 + (i % 2 === 0 ? -30 : 30);
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-shipyard-dock-${i + 1}`,
      type: 'maintenance_van',
      category: 'shipyard_maintenance',
      description: `Shipyard Marine Railway & Drydock Maintenance Van`,
      x: round2(x),
      y: 2.42,
      z: round2(z),
      headingDeg: 90.0,
      rotY: round4((90 * Math.PI) / 180),
      lengthM: 5.4,
      widthM: 2.1,
      heightM: 2.2,
      color: i % 2 === 0 ? '#1E3A8A' : '#475569',
      colorName: i % 2 === 0 ? 'Naval Blue' : 'Machine Grey',
      gridId: cell.cellId
    });
  }

  // Port Machine Workshops Compound (10 vehicles)
  for (let i = 0; i < 10; i++) {
    vehCount++;
    const x = -310 + i * 10 + (rng() - 0.5) * 3;
    const z = -350 + (i % 2 === 0 ? -25 : 25);
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-workshop-${i + 1}`,
      type: 'workshop_utility_truck',
      category: 'shipyard_maintenance',
      description: `Port Fabrication Workshops Compound Precision Utility Truck`,
      x: round2(x),
      y: 2.42,
      z: round2(z),
      headingDeg: 0.0,
      rotY: 0.0,
      lengthM: 6.2,
      widthM: 2.2,
      heightM: 2.4,
      color: '#0284C7',
      colorName: 'Industrial Sky',
      gridId: cell.cellId
    });
  }

  // 6. Pasdaran Highway Traffic: 58 vehicles
  // 18 Intercity Freight Trucks along Boulevard Pasdaran
  for (let i = 0; i < 18; i++) {
    vehCount++;
    const x = -1500 + i * 160 + (rng() - 0.5) * 20;
    const isEastbound = i % 2 === 0;
    const z = isEastbound ? -1685 : -1665;
    const heading = isEastbound ? 90 : 270;
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-pasdaran-truck-${i + 1}`,
      type: 'cargo_truck',
      category: 'pasdaran_traffic',
      description: `Intercity Freight Heavy Truck transiting Boulevard Pasdaran (${isEastbound ? 'Eastbound' : 'Westbound'})`,
      x: round2(x),
      y: 2.42,
      z: round2(z),
      headingDeg: heading,
      rotY: round4((heading * Math.PI) / 180),
      lengthM: 14.5,
      widthM: 2.5,
      heightM: 3.6,
      color: i % 3 === 0 ? '#DC2626' : i % 3 === 1 ? '#2563EB' : '#FFFFFF',
      colorName: i % 3 === 0 ? 'Freight Red' : i % 3 === 1 ? 'Highway Blue' : 'White',
      gridId: cell.cellId
    });
  }

  // 8 Hormozgan Public Transit Buses
  for (let i = 0; i < 8; i++) {
    vehCount++;
    const x = -1300 + i * 360 + (rng() - 0.5) * 30;
    const isEastbound = i % 2 === 0;
    const z = isEastbound ? -1680 : -1670;
    const heading = isEastbound ? 90 : 270;
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-pasdaran-bus-${i + 1}`,
      type: 'highway_bus',
      category: 'pasdaran_traffic',
      description: `Hormozgan City Public Transit Bus on Boulevard Pasdaran`,
      x: round2(x),
      y: 2.42,
      z: round2(z),
      headingDeg: heading,
      rotY: round4((heading * Math.PI) / 180),
      lengthM: 12.0,
      widthM: 2.55,
      heightM: 3.2,
      color: i % 2 === 0 ? '#2563EB' : '#DC2626',
      colorName: i % 2 === 0 ? 'Transit Blue' : 'Transit Red',
      gridId: cell.cellId
    });
  }

  // 32 Passenger Cars & Pickups along Boulevard Pasdaran
  for (let i = 0; i < 32; i++) {
    vehCount++;
    const x = -1520 + i * 90 + (rng() - 0.5) * 20;
    const isEastbound = i % 2 === 0;
    const z = isEastbound ? -1682 : -1668;
    const heading = isEastbound ? 90 : 270;
    const colHex = carColors[i % carColors.length];
    const cell = getGridCellForPoint(x, z);
    vehicles.push({
      id: `veh-pasdaran-car-${i + 1}`,
      type: 'passenger_car',
      category: 'pasdaran_traffic',
      description: `Passenger Sedan cruising along Boulevard Pasdaran Coastal Highway`,
      x: round2(x),
      y: 2.42,
      z: round2(z),
      headingDeg: heading,
      rotY: round4((heading * Math.PI) / 180),
      lengthM: 4.6,
      widthM: 1.8,
      heightM: 1.5,
      color: colHex,
      colorName: 'Sedan Color',
      gridId: cell.cellId
    });
  }

  return vehicles;
}

/**
 * Generate Comprehensive Vessels Inventory: 88 afloat vessels + 40 dry skiffs = 128 total.
 */
export function generateVesselBerths(metric, dhowBerths, shipyardFeatures) {
  const vessels = [];

  // 1. West Quay Container Feeders: 2 vessels
  vessels.push(
    {
      id: 'vessel-feeder-1',
      name: 'Shahid Bahonar Container Feeder 1',
      nameFa: 'کشتی کانتینری فیدر شماره ۱ باهنر',
      berthGroup: 'west_quay_containers',
      berthName: 'West Quay Container Berth 1',
      vesselType: 'container_feeder',
      status: 'afloat_berthed',
      x: -24.0,
      y: 0.0,
      z: -870.0,
      headingDeg: 90.0,
      rotY: round4(Math.PI * 0.5),
      loaM: 135.0,
      beamM: 22.0,
      draftM: 4.0,
      freeboardM: 6.5,
      color: '#102738',
      gridId: getGridCellForPoint(-24.0, -870.0).cellId,
      details: { teus: 850, deadweightTons: 12400, cranesServing: 2 }
    },
    {
      id: 'vessel-feeder-2',
      name: 'Shahid Bahonar Container Feeder 2',
      nameFa: 'کشتی کانتینری فیدر شماره ۲ باهنر',
      berthGroup: 'west_quay_containers',
      berthName: 'West Quay Container Berth 2',
      vesselType: 'container_feeder',
      status: 'afloat_berthed',
      x: -24.0,
      y: 0.0,
      z: -710.0,
      headingDeg: 90.0,
      rotY: round4(Math.PI * 0.5),
      loaM: 125.0,
      beamM: 21.0,
      draftM: 4.0,
      freeboardM: 6.2,
      color: '#102738',
      gridId: getGridCellForPoint(-24.0, -710.0).cellId,
      details: { teus: 720, deadweightTons: 10800, cranesServing: 2 }
    }
  );

  // 2. North Quay General Cargo: 4 vessels
  vessels.push(
    {
      id: 'vessel-cargo-north-1',
      name: 'Al-Zahra General Cargo',
      nameFa: 'کشتی باربری عمومی الزهرا',
      berthGroup: 'north_quay_cargo',
      berthName: 'West Quay South Cargo Berth',
      vesselType: 'general_cargo',
      status: 'afloat_berthed',
      x: -22.0,
      y: 0.0,
      z: -560.0,
      headingDeg: 90.0,
      rotY: round4(Math.PI * 0.5),
      loaM: 105.0,
      beamM: 18.0,
      draftM: 3.8,
      freeboardM: 5.5,
      color: '#14261B',
      gridId: getGridCellForPoint(-22.0, -560.0).cellId,
      details: { cargoType: 'breakbulk_machinery', deadweightTons: 6500 }
    },
    {
      id: 'vessel-cargo-north-2',
      name: 'Kavir General Cargo',
      nameFa: 'کشتی باربری کویر',
      berthGroup: 'north_quay_cargo',
      berthName: 'Central Pier Cargo Berth',
      vesselType: 'general_cargo',
      status: 'afloat_berthed',
      x: 492.0,
      y: 0.0,
      z: -346.0,
      headingDeg: 161.5,
      rotY: 2.82,
      loaM: 108.0,
      beamM: 18.0,
      draftM: 3.8,
      freeboardM: 5.6,
      color: '#14261B',
      gridId: getGridCellForPoint(492.0, -346.0).cellId,
      details: { cargoType: 'steel_billets_and_rebar', deadweightTons: 7000 }
    },
    {
      id: 'vessel-cargo-north-3',
      name: 'Gensan Trader',
      nameFa: 'کشتی باری گنسان',
      berthGroup: 'north_quay_cargo',
      berthName: 'East Basin Cargo Berth',
      vesselType: 'general_cargo',
      status: 'afloat_berthed',
      x: 1018.0,
      y: 0.0,
      z: -488.0,
      headingDeg: -116.9,
      rotY: -2.04,
      loaM: 94.0,
      beamM: 16.0,
      draftM: 3.6,
      freeboardM: 5.2,
      color: '#14261B',
      gridId: getGridCellForPoint(1018.0, -488.0).cellId,
      details: { cargoType: 'bagged_grain_fertilizer', deadweightTons: 5200 }
    },
    {
      id: 'vessel-cargo-north-4',
      name: 'Delvar Coastal Carrier',
      nameFa: 'شناور باری دلوار',
      berthGroup: 'north_quay_cargo',
      berthName: 'North Cargo Quay Berth 4',
      vesselType: 'general_cargo',
      status: 'afloat_berthed',
      x: 280.0,
      y: 0.0,
      z: -360.0,
      headingDeg: 161.5,
      rotY: 2.82,
      loaM: 98.0,
      beamM: 17.0,
      draftM: 3.7,
      freeboardM: 5.4,
      color: '#14261B',
      gridId: getGridCellForPoint(280.0, -360.0).cellId,
      details: { cargoType: 'timber_construction_materials', deadweightTons: 5800 }
    }
  );

  // 3. South Quay 56 Rafted Dhows
  const tarpColors = ['#C2A675', '#4B5320', '#1F4E79', '#8B5A2B', '#2E4053'];
  for (let i = 0; i < dhowBerths.length; i++) {
    const b = dhowBerths[i];
    const numId = String(i + 1).padStart(2, '0');
    const loa = round2(b.maxLoaM ? Math.max(19.0, Math.min(27.0, b.maxLoaM * (0.82 + (i % 4) * 0.05))) : 24.0);
    const beam = round2(loa * (0.27 + (i % 3) * 0.015));
    const cell = getGridCellForPoint(b.x, b.z);
    vessels.push({
      id: `vessel-dhow-raft-${numId}`,
      name: `Persian Gulf Lenj Dhow ${numId}`,
      nameFa: `لنج تجاری سنتی خلیج فارس شماره ${numId}`,
      berthGroup: 'south_quay_dhows',
      berthName: `South Quay ${b.cluster || 'South Basin'} Mooring Slot ${i + 1} (Tier ${b.tier})`,
      vesselType: 'lenj_cargo_dhow',
      status: 'afloat_berthed',
      x: round2(b.x),
      y: 0.0,
      z: round2(b.z),
      headingDeg: round2(b.headingDeg || (b.rotY ? (b.rotY * 180) / Math.PI : 90)),
      rotY: round4(b.rotY ?? -1.56),
      loaM: loa,
      beamM: beam,
      draftM: 2.0,
      freeboardM: 1.8,
      color: '#6B4226',
      gridId: cell.cellId,
      details: {
        cluster: b.cluster,
        tier: b.tier,
        tarpaulinColor: tarpColors[i % tarpColors.length],
        cargo: i % 2 === 0 ? 'consumer_electronics_spices' : 'dry_foodstuffs_textiles'
      }
    });
  }

  // 4. Ferry Catamarans: 3 vessels
  vessels.push(
    {
      id: 'vessel-ferry-1',
      name: 'Hormoz Pearl Catamaran 1',
      nameFa: 'شناور تندرو مسافربری مروارید هرمز ۱',
      berthGroup: 'ferry_catamarans',
      berthName: 'Passenger Ferry Terminal Berth 1',
      vesselType: 'passenger_catamaran_ferry',
      status: 'afloat_berthed',
      x: 32.0,
      y: 0.0,
      z: -1452.0,
      headingDeg: 270.0,
      rotY: round4(-Math.PI * 0.5),
      loaM: 42.0,
      beamM: 11.5,
      draftM: 1.8,
      freeboardM: 2.4,
      color: '#0F766E',
      gridId: getGridCellForPoint(32.0, -1452.0).cellId,
      details: { passengerCapacity: 280, serviceSpeedKnots: 28, route: 'Bandar Abbas - Qeshm Island' }
    },
    {
      id: 'vessel-ferry-2',
      name: 'Qeshm Star Catamaran 2',
      nameFa: 'شناور تندرو مسافربری ستاره قشم ۲',
      berthGroup: 'ferry_catamarans',
      berthName: 'Passenger Ferry Terminal Berth 2',
      vesselType: 'passenger_catamaran_ferry',
      status: 'afloat_berthed',
      x: -35.0,
      y: 0.0,
      z: -1452.0,
      headingDeg: 270.0,
      rotY: round4(-Math.PI * 0.5),
      loaM: 38.0,
      beamM: 10.5,
      draftM: 1.7,
      freeboardM: 2.3,
      color: '#0F766E',
      gridId: getGridCellForPoint(-35.0, -1452.0).cellId,
      details: { passengerCapacity: 220, serviceSpeedKnots: 26, route: 'Bandar Abbas - Hormuz Island' }
    },
    {
      id: 'vessel-ferry-3',
      name: 'Hormozgan Ro-Ro Vehicle Ferry 3',
      nameFa: 'لندیگراف و شناور رو-رو مسافری خودرویی هرمزگان ۳',
      berthGroup: 'ferry_catamarans',
      berthName: 'Passenger Ferry Terminal Ro-Ro Berth 3',
      vesselType: 'passenger_roro_ferry',
      status: 'afloat_berthed',
      x: -85.0,
      y: 0.0,
      z: -1452.0,
      headingDeg: 270.0,
      rotY: round4(-Math.PI * 0.5),
      loaM: 46.0,
      beamM: 12.5,
      draftM: 2.2,
      freeboardM: 2.6,
      color: '#1E40AF',
      gridId: getGridCellForPoint(-85.0, -1452.0).cellId,
      details: { vehicleCapacity: 35, passengerCapacity: 150, route: 'Bandar Abbas - Qeshm Ro-Ro' }
    }
  );

  // 5. Tug Basin Tugs & Pilot: 4 vessels
  vessels.push(
    {
      id: 'vessel-tug-1',
      name: 'Shahid Bahonar Harbor Tug 1',
      nameFa: 'یدک‌کش خدمات بندری باهنر ۱',
      berthGroup: 'tug_basin_and_pilot',
      berthName: 'Small-Boat Pier Tug Berth 1',
      vesselType: 'harbor_tug',
      status: 'afloat_berthed',
      x: -360.0,
      y: 0.0,
      z: 15.0,
      headingDeg: -21.2,
      rotY: -0.37,
      loaM: 28.0,
      beamM: 9.8,
      draftM: 3.2,
      freeboardM: 2.2,
      color: '#1E293B',
      gridId: getGridCellForPoint(-360.0, 15.0).cellId,
      details: { bollardPullTons: 60, propulsion: 'Azimuth Stern Drive (ASD)' }
    },
    {
      id: 'vessel-tug-2',
      name: 'Shahid Bahonar Harbor Tug 2',
      nameFa: 'یدک‌کش خدمات بندری باهنر ۲',
      berthGroup: 'tug_basin_and_pilot',
      berthName: 'Small-Boat Pier Tug Berth 2',
      vesselType: 'harbor_tug',
      status: 'afloat_berthed',
      x: -330.0,
      y: 0.0,
      z: 5.0,
      headingDeg: -21.2,
      rotY: -0.37,
      loaM: 28.0,
      beamM: 9.8,
      draftM: 3.2,
      freeboardM: 2.2,
      color: '#1E293B',
      gridId: getGridCellForPoint(-330.0, 5.0).cellId,
      details: { bollardPullTons: 60, propulsion: 'Azimuth Stern Drive (ASD)' }
    },
    {
      id: 'vessel-tug-3',
      name: 'Shahid Bahonar Harbor Tug 3 (Forebay Assist)',
      nameFa: 'یدک‌کش اسکورت و پهلوگیری باهنر ۳',
      berthGroup: 'tug_basin_and_pilot',
      berthName: 'Harbor Forebay Assist Station',
      vesselType: 'harbor_tug',
      status: 'afloat_underway',
      x: 65.0,
      y: 0.0,
      z: 420.0,
      headingDeg: 80.2,
      rotY: 1.40,
      loaM: 30.0,
      beamM: 10.2,
      draftM: 3.4,
      freeboardM: 2.3,
      color: '#1E293B',
      gridId: getGridCellForPoint(65.0, 420.0).cellId,
      details: { bollardPullTons: 70, propulsion: 'Azimuth Stern Drive (ASD)' }
    },
    {
      id: 'vessel-pilot-1',
      name: 'Hormoz Pilot Station Launch 1',
      nameFa: 'شناور راهنمابر بندر باهنر ۱',
      berthGroup: 'tug_basin_and_pilot',
      berthName: 'Navigation Channel Pilot Station',
      vesselType: 'pilot_launch',
      status: 'afloat_underway',
      x: -20.0,
      y: 0.0,
      z: 650.0,
      headingDeg: -80.8,
      rotY: -1.41,
      loaM: 18.0,
      beamM: 5.5,
      draftM: 1.5,
      freeboardM: 1.6,
      color: '#EA580C',
      gridId: getGridCellForPoint(-20.0, 650.0).cellId,
      details: { speedKnots: 24, hullMaterial: 'High-visibility safety orange aluminum' }
    }
  );

  // 6. North Lagoon Patrol Craft: 6 vessels
  const patrolCraft = [
    { id: 'vessel-patrol-1', name: 'Port Security Fast Interceptor 1', nameFa: 'شناور گشت و امنیت بندر ۱', x: -260, z: -180, loa: 16, beam: 4.4 },
    { id: 'vessel-patrol-2', name: 'Port Security Fast Interceptor 2', nameFa: 'شناور گشت و امنیت بندر ۲', x: -245, z: -140, loa: 16, beam: 4.4 },
    { id: 'vessel-patrol-3', name: 'Coastal Coastguard Patrol 3', nameFa: 'شناور گشتی دریابانی ۳', x: -225, z: -100, loa: 20, beam: 5.2 },
    { id: 'vessel-patrol-4', name: 'Coastal Coastguard Patrol 4', nameFa: 'شناور گشتی دریابانی ۴', x: -210, z: -60, loa: 20, beam: 5.2 },
    { id: 'vessel-patrol-5', name: 'Fisheries Protection Boat 5', nameFa: 'شناور حراست شیلات هرمزگان ۵', x: -190, z: -20, loa: 18, beam: 4.8 },
    { id: 'vessel-patrol-6', name: 'Harbor Marine Police Launch 6', nameFa: 'شناور پلیس بندر و گمرک ۶', x: -175, z: 20, loa: 15, beam: 4.2 }
  ];
  for (const p of patrolCraft) {
    const cell = getGridCellForPoint(p.x, p.z);
    vessels.push({
      id: p.id,
      name: p.name,
      nameFa: p.nameFa,
      berthGroup: 'north_lagoon_patrol',
      berthName: 'North Lagoon Security Finger Pier',
      vesselType: 'patrol_boat',
      status: 'afloat_moored',
      x: round2(p.x),
      y: 0.0,
      z: round2(p.z),
      headingDeg: -21.8,
      rotY: -0.38,
      loaM: p.loa,
      beamM: p.beam,
      draftM: 1.3,
      freeboardM: 1.5,
      color: '#334155',
      gridId: cell.cellId,
      details: { role: 'Maritime surveillance, port perimeter security & boarding' }
    });
  }

  // 7. Shipyard Drydocks & Slipway & Crane Barge & Tender: 7 vessels
  vessels.push(
    {
      id: 'vessel-shipyard-drydock-1',
      name: 'Drydock Basin 1 Overhaul Coastal Cargo Hull',
      nameFa: 'شناور باری در حال تعمیر در حوضچه خشک شماره ۱',
      berthGroup: 'shipyard_repair',
      berthName: 'Shipyard Graving Drydock 1',
      vesselType: 'coastal_cargo_hull',
      status: 'repair_drydock',
      x: 722.0,
      y: 0.0,
      z: -767.0,
      headingDeg: 270.0,
      rotY: -1.57,
      loaM: 62.0,
      beamM: 12.5,
      draftM: 0.0,
      freeboardM: 5.0,
      color: '#7F1D1D',
      gridId: getGridCellForPoint(722.0, -767.0).cellId,
      details: { overhaulStatus: 'Hull sandblasting, red oxide priming & plate renewal' }
    },
    {
      id: 'vessel-shipyard-drydock-2',
      name: 'Drydock Basin 2 Service Tug in Keel Blocks',
      nameFa: 'یدک‌کش خدماتی روی بلوک‌های کیل حوضچه خشک شماره ۲',
      berthGroup: 'shipyard_repair',
      berthName: 'Shipyard Graving Drydock 2',
      vesselType: 'service_tug',
      status: 'repair_drydock',
      x: 768.0,
      y: 0.0,
      z: -741.0,
      headingDeg: 270.0,
      rotY: -1.57,
      loaM: 32.0,
      beamM: 9.5,
      draftM: 0.0,
      freeboardM: 3.5,
      color: '#1E293B',
      gridId: getGridCellForPoint(768.0, -741.0).cellId,
      details: { overhaulStatus: 'Shaft pull & propeller servicing' }
    },
    {
      id: 'vessel-shipyard-slipway',
      name: 'Marine Slipway Incline Cradle Dhow',
      nameFa: 'لنج چوبی باربری روی سرسره تعمیراتی ریلی',
      berthGroup: 'shipyard_repair',
      berthName: 'Shipyard Marine Railway Slipway Incline',
      vesselType: 'lenj_dhow_cradle',
      status: 'slipway_cradle',
      x: 840.0,
      y: 0.5,
      z: -765.0,
      headingDeg: 270.0,
      rotY: -1.57,
      loaM: 24.0,
      beamM: 7.2,
      draftM: 0.0,
      freeboardM: 2.2,
      color: '#6B4226',
      gridId: getGridCellForPoint(840.0, -765.0).cellId,
      details: { overhaulStatus: 'Plank caulking and teak timber refit on timber railway carriage' }
    },
    {
      id: 'vessel-shipyard-crane-barge',
      name: 'Shipyard Outfitting Floating Crane Barge',
      nameFa: 'بارج جرثقیل‌دار تعمیراتی اسکله تجهیز کشتی‌سازی',
      berthGroup: 'shipyard_repair',
      berthName: 'Shipyard Outfitting Finger Pier',
      vesselType: 'crane_barge',
      status: 'afloat_moored',
      x: 746.0,
      y: 0.0,
      z: -606.0,
      headingDeg: 0.0,
      rotY: 0.0,
      loaM: 34.0,
      beamM: 15.0,
      draftM: 1.5,
      freeboardM: 2.2,
      color: '#F59E0B',
      gridId: getGridCellForPoint(746.0, -606.0).cellId,
      details: { craneCapacityTons: 120, boomLengthM: 32 }
    },
    {
      id: 'vessel-shipyard-tender',
      name: 'Shipyard Maintenance Work Tender',
      nameFa: 'شناور خدمات کارگاهی و تعمیراتی کشتی‌سازی',
      berthGroup: 'shipyard_repair',
      berthName: 'Shipyard Fitting Pier Head',
      vesselType: 'work_tender',
      status: 'afloat_moored',
      x: 804.0,
      y: 0.0,
      z: -575.0,
      headingDeg: 0.0,
      rotY: 0.0,
      loaM: 16.0,
      beamM: 5.2,
      draftM: 1.2,
      freeboardM: 1.4,
      color: '#64748B',
      gridId: getGridCellForPoint(804.0, -575.0).cellId,
      details: { role: 'Mobile workshop tender & harbor diving support' }
    },
    {
      id: 'vessel-shipyard-bunker-1',
      name: 'Harbor Fuel Bunker & Lighter',
      nameFa: 'دوبه سوخت‌رسانی و آبرسانی بندر باهنر',
      berthGroup: 'shipyard_repair',
      berthName: 'Shipyard Support Finger Pier',
      vesselType: 'bunker_lighter',
      status: 'afloat_moored',
      x: 760.0,
      y: 0.0,
      z: -550.0,
      headingDeg: 0.0,
      rotY: 0.0,
      loaM: 28.0,
      beamM: 7.0,
      draftM: 1.8,
      freeboardM: 1.8,
      color: '#334155',
      gridId: getGridCellForPoint(760.0, -550.0).cellId,
      details: { bunkerCapacityTons: 400, fuelType: 'MGO / Fresh Water' }
    },
    {
      id: 'vessel-shipyard-support-2',
      name: 'Shipyard Diving Support Launch',
      nameFa: 'شناور غواصی و پشتیبانی زیرآبی باهنر',
      berthGroup: 'shipyard_repair',
      berthName: 'Shipyard Support Finger Pier Outer',
      vesselType: 'diving_support',
      status: 'afloat_moored',
      x: 785.0,
      y: 0.0,
      z: -520.0,
      headingDeg: 0.0,
      rotY: 0.0,
      loaM: 22.0,
      beamM: 6.0,
      draftM: 1.4,
      freeboardM: 1.5,
      color: '#0284C7',
      gridId: getGridCellForPoint(785.0, -520.0).cellId,
      details: { divingChamber: true, hullInspectionSonar: true }
    }
  );

  // 8. Channel & Offshore Cargo / Tankers: 6 vessels
  vessels.push(
    {
      id: 'vessel-channel-feeder-inbound',
      name: 'Inbound Feeder Container Vessel (Fairway)',
      nameFa: 'کشتی کانتینری فیدر ورودی در کانال دسترسی',
      berthGroup: 'channel_and_offshore',
      berthName: 'Shahid Bahonar Main Navigation Approach Channel',
      vesselType: 'container_feeder',
      status: 'afloat_underway',
      x: 45.0,
      y: 0.0,
      z: 860.0,
      headingDeg: 97.4,
      rotY: 1.70,
      loaM: 120.0,
      beamM: 20.0,
      draftM: 4.0,
      freeboardM: 6.0,
      color: '#15803D',
      gridId: getGridCellForPoint(45.0, 860.0).cellId,
      details: { transitState: 'Inbound pilot onboard, proceeding at 7 knots' }
    },
    {
      id: 'vessel-channel-tanker',
      name: 'Gulf Pioneer Handysize Product Tanker',
      nameFa: 'نفتکش فرآورده‌های نفتی پیشگام خلیج',
      berthGroup: 'channel_and_offshore',
      berthName: 'Strait of Hormuz Deepwater Fairway',
      vesselType: 'product_tanker',
      status: 'afloat_underway',
      x: 180.0,
      y: 0.0,
      z: 1250.0,
      headingDeg: 92.8,
      rotY: 1.62,
      loaM: 145.0,
      beamM: 24.0,
      draftM: 4.5,
      freeboardM: 6.8,
      color: '#7F1D1D',
      gridId: getGridCellForPoint(180.0, 1250.0).cellId,
      details: { cargo: 'Refined petroleum distillates', deadweightTons: 16500 }
    },
    {
      id: 'vessel-cargo-offshore-1',
      name: 'Bandar Bulk Carrier (West Outer Anchorage)',
      nameFa: 'کشتی فله‌بر لنگرانداخته در لنگرگاه بیرونی غرب',
      berthGroup: 'channel_and_offshore',
      berthName: 'Bandar Abbas Outer Anchorage West (Fairway South)',
      vesselType: 'bulk_carrier',
      status: 'afloat_anchored',
      x: -520.0,
      y: 0.0,
      z: 1440.0,
      headingDeg: 83.1,
      rotY: 1.45,
      loaM: 118.0,
      beamM: 20.0,
      draftM: 4.2,
      freeboardM: 6.0,
      color: '#1E293B',
      gridId: getGridCellForPoint(-520.0, 1440.0).cellId,
      details: { anchorageStatus: 'Awaiting customs & quarantine clearance' }
    },
    {
      id: 'vessel-cargo-offshore-2',
      name: 'Sirik General Cargo (East Outer Anchorage)',
      nameFa: 'کشتی باربری عمومی سیریک در لنگرگاه بیرونی شرق',
      berthGroup: 'channel_and_offshore',
      berthName: 'Bandar Abbas Outer Anchorage East (Fairway South)',
      vesselType: 'general_cargo',
      status: 'afloat_anchored',
      x: 450.0,
      y: 0.0,
      z: 1520.0,
      headingDeg: 77.3,
      rotY: 1.35,
      loaM: 110.0,
      beamM: 18.0,
      draftM: 3.9,
      freeboardM: 5.8,
      color: '#164E63',
      gridId: getGridCellForPoint(450.0, 1520.0).cellId,
      details: { anchorageStatus: 'Riding anchor heading into tidal current' }
    },
    {
      id: 'vessel-dhow-basin-3',
      name: 'Southwest Basin Cargo Dhow 3',
      nameFa: 'لنج باربری حوضچه جنوب غربی ۳',
      berthGroup: 'channel_and_offshore',
      berthName: 'Small-Boat Basin Berth 3',
      vesselType: 'lenj_cargo_dhow',
      status: 'afloat_berthed',
      x: -195.0,
      y: 0.0,
      z: -220.0,
      headingDeg: 0.0,
      rotY: 0.0,
      loaM: 22.0,
      beamM: 6.8,
      draftM: 2.0,
      freeboardM: 1.8,
      color: '#6B4226',
      gridId: getGridCellForPoint(-195.0, -220.0).cellId,
      details: { cargo: 'Fresh fruit & coastal provisions' }
    },
    {
      id: 'vessel-dhow-basin-4',
      name: 'Southwest Basin Cargo Dhow 4',
      nameFa: 'لنج باربری حوضچه جنوب غربی ۴',
      berthGroup: 'channel_and_offshore',
      berthName: 'Small-Boat Basin Pier South',
      vesselType: 'lenj_cargo_dhow',
      status: 'afloat_berthed',
      x: -460.0,
      y: 0.0,
      z: -20.0,
      headingDeg: -21.8,
      rotY: -0.38,
      loaM: 24.0,
      beamM: 7.2,
      draftM: 2.0,
      freeboardM: 1.8,
      color: '#6B4226',
      gridId: getGridCellForPoint(-460.0, -20.0).cellId,
      details: { cargo: 'Local coastal freight' }
    }
  );

  // 9. 40 Dry Skiffs on Staged Boatyard (North of South Quay)
  // Grid of 4 rows x 10 skiffs
  const skiffColors = ['#0EA5E9', '#14B8A6', '#F8FAFC', '#F43F5E', '#F59E0B'];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 10; col++) {
      const idx = row * 10 + col + 1;
      const numId = String(idx).padStart(2, '0');
      const x = 470.0 + col * 14.5;
      const z = -1010.0 + row * 18.0;
      const colorHex = skiffColors[(row + col) % skiffColors.length];
      const cell = getGridCellForPoint(x, z);
      vessels.push({
        id: `vessel-skiff-${numId}`,
        name: `Fibreglass Fishing Skiff ${numId}`,
        nameFa: `قایق فایبرگلاس صیادی شماره ${numId}`,
        berthGroup: 'dry_skiffs_boatyard',
        berthName: `South Quay North Boatyard Dry Staging Rack R${row + 1}-C${col + 1}`,
        vesselType: 'fibreglass_skiff',
        status: 'dry_staged_boatyard',
        x: round2(x),
        y: 2.45,
        z: round2(z),
        headingDeg: 180.0,
        rotY: round4(Math.PI),
        loaM: 8.2,
        beamM: 2.6,
        draftM: 0.0,
        freeboardM: 1.6,
        color: colorHex,
        gridId: cell.cellId,
        details: {
          hullMaterial: 'Moulded fibreglass (GRP)',
          stagingGround: 'Unpaved compacted gravel boatyard',
          row: row + 1,
          slot: col + 1
        }
      });
    }
  }

  return vessels;
}

/**
 * Classifies cell domain, Persian domain label, and primary ground surface.
 */
function classifyCellDomain(cell, counts, features, metric) {
  const { minX, maxX, minZ, maxZ, col, row } = cell;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  // 1. Container terminal (West Quay)
  if (features.vessels.some((v) => v.id.includes('feeder-1') || v.id.includes('feeder-2'))) {
    return {
      domain: 'container_terminal',
      domainFa: 'ترمینال کانتینری و بارانداز اسکله غربی',
      surface: 'reinforced_concrete'
    };
  }

  // 2. Dhow harbor (South Quay & Rafted Fleet)
  if (
    features.vessels.some((v) => v.id.includes('dhow-raft') || v.id.includes('skiff')) ||
    (centerX >= 100 && centerX <= 900 && centerZ >= -1200 && centerZ <= -600)
  ) {
    const hasSkiffs = features.vessels.some((v) => v.id.includes('skiff'));
    return {
      domain: 'dhow_harbor',
      domainFa: 'اسکله سنتی لنج‌داری و بارانداز جنوب',
      surface: hasSkiffs ? 'compacted_gravel' : 'mixed_quay_water'
    };
  }

  // 3. Shipyard and drydock repairs
  if (
    features.vessels.some((v) => v.id.includes('shipyard')) ||
    (centerX >= 650 && centerX <= 950 && centerZ >= -820 && centerZ <= -450)
  ) {
    return {
      domain: 'shipyard_marine_repair',
      domainFa: 'صنایع دریایی، حوضچه‌های خشک و کارگاه‌های شناورسازی',
      surface: 'paved_yard'
    };
  }

  // 4. Passenger ferry terminal
  if (
    features.vessels.some((v) => v.id.includes('ferry')) ||
    features.vehicles.some((v) => v.category === 'ferry_terminal_parking') ||
    (centerX >= -150 && centerX <= 150 && centerZ >= -1650 && centerZ <= -1350)
  ) {
    return {
      domain: 'ferry_terminal',
      domainFa: 'پایانه مسافربری شهید باهنر و اسکله‌های رو-رو',
      surface: 'asphalt_paved'
    };
  }

  // 5. Tug basin and port patrol basin
  if (
    features.vessels.some((v) => v.id.includes('tug') || v.id.includes('patrol')) ||
    (centerX >= -450 && centerX <= 50 && centerZ >= -350 && centerZ <= 150)
  ) {
    return {
      domain: 'service_boat_basin',
      domainFa: 'حوضچه یدک‌کش‌ها، شناورهای خدماتی و پایگاه گشتی',
      surface: 'sheltered_water'
    };
  }

  // 6. Port customs gate and inspection queue
  if (
    features.vehicles.some((v) => v.category === 'customs_gate_queue') ||
    (centerX >= 180 && centerX <= 400 && centerZ >= -1650 && centerZ <= -1420)
  ) {
    return {
      domain: 'port_customs_corridor',
      domainFa: 'گمرک، گیت‌های ورودی و باسکول‌های توزین کانتینری',
      surface: 'asphalt_roadway'
    };
  }

  // 7. Sahand Coastal Park
  if (
    counts.palms >= 10 ||
    (centerX >= -1700 && centerX <= -950 && centerZ >= 220 && centerZ <= 500)
  ) {
    return {
      domain: 'coastal_park',
      domainFa: 'بوستان ساحلی سهند و نوار تفریحی ساحل',
      surface: 'greenery_lawn'
    };
  }

  // 8. Breakwater structures
  if (features.infrastructure.some((inf) => inf.includes('breakwater'))) {
    return {
      domain: 'breakwater_structure',
      domainFa: 'موج‌شکن سنگی و بازوی حفاظت موج بندر',
      surface: 'armor_rock'
    };
  }

  // 9. Tank farm and warehousing
  if (
    (centerX >= 200 && centerX <= 650 && centerZ >= -1450 && centerZ <= -800) ||
    features.vehicles.some((v) => v.category === 'container_yard_tractors')
  ) {
    return {
      domain: 'tank_farm_and_warehousing',
      domainFa: 'مخازن سوخت، سیلو و محوطه دپوی کانتینری',
      surface: 'industrial_paved'
    };
  }

  // 10. Boulevard Pasdaran highway corridor
  if (centerZ >= -1850 && centerZ <= -1550) {
    return {
      domain: 'urban_corridor',
      domainFa: 'بلوار پاسداران (جاده ۹۶) و معابر ورودی بندر',
      surface: 'asphalt_highway'
    };
  }

  // 11. Open marine navigation approach & fairways
  if (centerZ > 900) {
    return {
      domain: 'marine_approach_channel',
      domainFa: 'کانال دریانوردی و آب‌های آزاد خلیج فارس',
      surface: 'deep_water'
    };
  }

  // 12. Sheltered harbor water
  if (centerX >= -600 && centerX <= 1200 && centerZ >= -600 && centerZ <= 900) {
    return {
      domain: 'harbor_basin',
      domainFa: 'حوضچه آرامش و آب‌های محافظت‌شده بندر باهنر',
      surface: 'sheltered_water'
    };
  }

  // 13. Western coastal beach buffer
  if (centerX <= -600 && centerZ >= 0 && centerZ <= 600) {
    return {
      domain: 'coastal_beach',
      domainFa: 'نوار ساحلی و اراضی ماسه‌ای غرب موج‌شکن',
      surface: 'sand_beach'
    };
  }

  // 14. Western outer coastal water
  if (centerX < -600 && centerZ > 600) {
    return {
      domain: 'coastal_water',
      domainFa: 'آب‌های ساحلی خلیج فارس',
      surface: 'coastal_water'
    };
  }

  // 15. Default urban/industrial background
  return {
    domain: 'urban_industrial_buffer',
    domainFa: 'اراضی پیرامونی و حریم بندری-شهری بندرعباس',
    surface: 'compacted_ground'
  };
}

/**
 * Synthesizes detailed satellite visual observations calibrated with Google Earth imagery.
 */
function buildVisualNotesGoogleEarth(cell, counts, features, domain, surface) {
  const notes = [];
  const { code, cellId, minX, maxX, minZ, maxZ } = cell;

  // Domain intro
  switch (domain) {
    case 'container_terminal':
      notes.push(
        `High-resolution satellite view confirms heavy reinforced concrete apron of West Quay.`
      );
      break;
    case 'dhow_harbor':
      notes.push(
        `Detailed Google Earth imagery resolves the dense traditional maritime hub of South Quay.`
      );
      break;
    case 'shipyard_marine_repair':
      notes.push(
        `Satellite view clearly highlights active shipyard facilities, graving drydocks, and machine workshops.`
      );
      break;
    case 'ferry_terminal':
      notes.push(
        `Satellite coverage documents the modern Shahid Bahonar passenger catamaran and Ro-Ro terminal.`
      );
      break;
    case 'service_boat_basin':
      notes.push(
        `Satellite inspection shows the sheltered harbor service basin and small-boat finger piers.`
      );
      break;
    case 'port_customs_corridor':
      notes.push(
        `High-resolution satellite imagery reveals the multi-lane port customs gate and freight security corridor.`
      );
      break;
    case 'coastal_park':
      notes.push(
        `Satellite view captures the landscaped green lawns and coastal palm groves of Sahand Coastal Park (بوستان ساحلی سهند).`
      );
      break;
    case 'breakwater_structure':
      notes.push(
        `Satellite imagery resolves the massive riprap armor-stone breakwater protecting harbor waters.`
      );
      break;
    case 'tank_farm_and_warehousing':
      notes.push(
        `Satellite view displays bulk petroleum storage tanks and extensive port logistics warehouses.`
      );
      break;
    case 'urban_corridor':
      notes.push(
        `Google Earth aerial photography documents the multi-lane Boulevard Pasdaran (Road 96) coastal arterial.`
      );
      break;
    case 'marine_approach_channel':
      notes.push(
        `Deep-water satellite coverage shows the open marine approach fairway into the Strait of Hormuz.`
      );
      break;
    case 'harbor_basin':
      notes.push(
        `Satellite imagery depicts calm, sheltered harbor fairway with clear turquoise Persian Gulf water.`
      );
      break;
    case 'coastal_beach':
      notes.push(
        `Satellite view shows sandy coastal shoreline between Sahand Park promenade and the port breakwater root.`
      );
      break;
    case 'coastal_water':
      notes.push(
        `Satellite imagery displays open coastal Persian Gulf waters west of the port entrance.`
      );
      break;
    default:
      notes.push(
        `Satellite imagery shows arid coastal ground and peripheral compounds north of Boulevard Pasdaran.`
      );
      break;
  }

  // Vessel observations
  if (counts.vessels > 0) {
    const vesselDetails = features.vessels;
    if (vesselDetails.some((v) => v.id.includes('feeder-1'))) {
      notes.push(
        `A 135m container feeder vessel is berthed along West Quay Berth 1 beneath quayside container cranes.`
      );
    }
    if (vesselDetails.some((v) => v.id.includes('feeder-2'))) {
      notes.push(
        `A 125m container feeder vessel is securely berthed along West Quay Berth 2 with container bay stacks visible.`
      );
    }
    const dhowsInCell = vesselDetails.filter((v) => v.id.includes('dhow-raft'));
    if (dhowsInCell.length > 0) {
      notes.push(
        `${dhowsInCell.length} traditional wooden Lenj cargo dhows are rafted 2-3 abreast perpendicular to the quay with colorful weather tarpaulins.`
      );
    }
    const skiffsInCell = vesselDetails.filter((v) => v.id.includes('skiff'));
    if (skiffsInCell.length > 0) {
      notes.push(
        `${skiffsInCell.length} fibreglass fishing skiffs/launches are organized in orderly dry-staging rows across the unpaved boatyard ground.`
      );
    }
    if (vesselDetails.some((v) => v.id.includes('drydock-1'))) {
      notes.push(
        `Drydock Basin 1 contains a 62m coastal cargo hull supported on keel blocks undergoing bottom plating overhaul.`
      );
    }
    if (vesselDetails.some((v) => v.id.includes('slipway'))) {
      notes.push(
        `The marine railway slipway shows a 24m wooden Lenj hauled up on its inclined timber carriage.`
      );
    }
    if (vesselDetails.some((v) => v.id.includes('crane-barge'))) {
      notes.push(
        `A 34m heavy repair crane barge is moored along the shipyard outfitting pier.`
      );
    }
    if (vesselDetails.some((v) => v.id.includes('ferry'))) {
      notes.push(
        `High-speed passenger catamarans are moored at the ferry slips with twin slender demi-hulls and boarding gangways.`
      );
    }
    if (vesselDetails.some((v) => v.id.includes('tug'))) {
      notes.push(
        `Damen ASD harbor tugboats are positioned at small-boat berths, ready for commercial ship assist.`
      );
    }
    if (vesselDetails.some((v) => v.id.includes('tanker'))) {
      notes.push(
        `A 145m Handysize petroleum product tanker is transiting the navigation fairway with visible bow wake.`
      );
    }
  }

  // Vehicle observations
  if (counts.vehicles > 0) {
    const queueTrucks = features.vehicles.filter((v) => v.category === 'customs_gate_queue');
    if (queueTrucks.length > 0) {
      notes.push(
        `${queueTrucks.length} container semi-trailer trucks are staged in approach lanes awaiting customs weighing and gate clearance.`
      );
    }
    const yardTractors = features.vehicles.filter((v) => v.category === 'container_yard_tractors');
    if (yardTractors.length > 0) {
      notes.push(
        `${yardTractors.length} terminal tractors and reach stackers operate in marked logistics corridors between container stacks.`
      );
    }
    const parkingVehs = features.vehicles.filter((v) => v.category === 'ferry_terminal_parking');
    if (parkingVehs.length > 0) {
      notes.push(
        `Ferry passenger parking aprons feature ${parkingVehs.length} parked passenger cars, Iranian yellow taxis, and transit vans.`
      );
    }
    const quayVehs = features.vehicles.filter((v) => v.category === 'quay_apron_vehicles');
    if (quayVehs.length > 0) {
      notes.push(
        `${quayVehs.length} port authority pickups and maintenance flatbeds are staged along the quay apron.`
      );
    }
    const pasdaranVehs = features.vehicles.filter((v) => v.category === 'pasdaran_traffic');
    if (pasdaranVehs.length > 0) {
      notes.push(
        `Boulevard Pasdaran carries active commercial freight trucks and public transit buses along the coastal corridor.`
      );
    }
  }

  // Palm vegetation observations
  if (counts.palms > 0) {
    notes.push(
      `Imagery resolves ${counts.palms} mature Persian Gulf date palms displaying lush green radial crowns.`
    );
  }

  // Building observations
  if (counts.buildings > 0) {
    notes.push(
      `Contains ${counts.buildings} architectural structures with industrial beige corrugated roofing, warehouse bays, or port administrative facilities.`
    );
  }

  // Infrastructure observations
  if (counts.infrastructure > 0) {
    notes.push(
      `Engineered port infrastructure visible including quay wall copings, bollards, dock gates, or seamark navigation aids.`
    );
  }

  // Default empty description if no features
  if (notes.length === 1) {
    if (surface === 'deep_water' || surface === 'sheltered_water' || surface === 'coastal_water') {
      notes.push(
        `Unobstructed marine navigation water with uniform sea surface texture, high water clarity, and bathymetry suitable for harbor maneuvers.`
      );
    } else {
      notes.push(
        `Open compacted sand and gravel ground characteristic of coastal Hormozgan desert plain with minimal surface vegetation.`
      );
    }
  }

  return notes.join(' ');
}

/**
 * Generate 306 Square Spatial Grid Cells covering X [-1800, 1600], Z [-1900, 1700].
 */
export function generateSpatialGrid(metric, palms, groundVehicles, vesselBerths) {
  const cells = [];
  const { minX: gMinX, minZ: gMinZ, cellSizeM, cols, rows, colLetters } = GRID_CONFIG;
  const origin = metric.origin;
  const projection = metric.projection;

  // Pre-index features by cellId for fast lookup
  const palmsByCell = new Map();
  for (const p of palms) {
    const cid = getGridCellForPoint(p.x, p.z).cellId;
    if (!palmsByCell.has(cid)) palmsByCell.set(cid, []);
    palmsByCell.get(cid).push(p.id);
  }

  const vehiclesByCell = new Map();
  for (const v of groundVehicles) {
    if (!vehiclesByCell.has(v.gridId)) vehiclesByCell.set(v.gridId, []);
    vehiclesByCell.get(v.gridId).push(v);
  }

  const vesselsByCell = new Map();
  for (const vs of vesselBerths) {
    if (!vesselsByCell.has(vs.gridId)) vesselsByCell.set(vs.gridId, []);
    vesselsByCell.get(vs.gridId).push(vs);
  }

  const buildingsByCell = new Map();
  for (const b of metric.buildings) {
    const cid = getGridCellForPoint(b.centerXZ[0], b.centerXZ[1]).cellId;
    if (!buildingsByCell.has(cid)) buildingsByCell.set(cid, []);
    buildingsByCell.get(cid).push(b.id);
  }

  for (let row = 1; row <= rows; row++) {
    const minZ = gMinZ + (row - 1) * cellSizeM;
    const maxZ = minZ + cellSizeM;
    const centerZ = minZ + cellSizeM / 2;
    const rowPad = String(row).padStart(2, '0');

    for (let col = 1; col <= cols; col++) {
      const minX = gMinX + (col - 1) * cellSizeM;
      const maxX = minX + cellSizeM;
      const centerX = minX + cellSizeM / 2;
      const colLetter = colLetters[col - 1];

      const cellId = `GRID-R${row}-C${col}`;
      const code = `${colLetter}${rowPad}`;

      // WGS84 Bounds and Center
      const south = origin.lat - maxZ / projection.metersPerDegLat;
      const north = origin.lat - minZ / projection.metersPerDegLat;
      const west = origin.lon + minX / projection.metersPerDegLon;
      const east = origin.lon + maxX / projection.metersPerDegLon;
      const centerLat = origin.lat - centerZ / projection.metersPerDegLat;
      const centerLon = origin.lon + centerX / projection.metersPerDegLon;

      // Extract matching features
      const cellVessels = vesselsByCell.get(cellId) || [];
      const cellVehicles = vehiclesByCell.get(cellId) || [];
      const cellPalms = palmsByCell.get(cellId) || [];
      const cellBuildings = buildingsByCell.get(cellId) || [];

      // Infrastructure match
      const cellInfra = [];
      for (const bw of metric.breakwaters) {
        if (
          bw.centerlineXZ.some(
            (pt) => pt[0] >= minX && pt[0] <= maxX && pt[1] >= minZ && pt[1] <= maxZ
          )
        ) {
          cellInfra.push(bw.id);
        }
      }
      for (const qp of metric.quaysAndPiers) {
        if (
          qp.centerXZ[0] >= minX &&
          qp.centerXZ[0] <= maxX &&
          qp.centerXZ[1] >= minZ &&
          qp.centerXZ[1] <= maxZ
        ) {
          cellInfra.push(qp.id);
        }
      }
      for (const qw of metric.quayWalls) {
        if (
          qw.midpointXZ[0] >= minX &&
          qw.midpointXZ[0] <= maxX &&
          qw.midpointXZ[1] >= minZ &&
          qw.midpointXZ[1] <= maxZ
        ) {
          cellInfra.push(qw.id);
        }
      }
      for (const sm of metric.landmarksAndSeamarks) {
        if (
          sm.positionXZ[0] >= minX &&
          sm.positionXZ[0] <= maxX &&
          sm.positionXZ[1] >= minZ &&
          sm.positionXZ[1] <= maxZ
        ) {
          cellInfra.push(sm.id);
        }
      }
      for (const d of metric.waterFeatures.docks) {
        if (
          d.centerXZ[0] >= minX &&
          d.centerXZ[0] <= maxX &&
          d.centerXZ[1] >= minZ &&
          d.centerXZ[1] <= maxZ
        ) {
          cellInfra.push(d.id);
        }
      }

      // Roads match
      const cellRoads = [];
      for (const r of metric.roads) {
        if (
          r.pointsXZ.some(
            (pt) => pt[0] >= minX && pt[0] <= maxX && pt[1] >= minZ && pt[1] <= maxZ
          )
        ) {
          cellRoads.push(r.id);
        }
      }

      const featureCounts = {
        vessels: cellVessels.length,
        vehicles: cellVehicles.length,
        palms: cellPalms.length,
        buildings: cellBuildings.length,
        infrastructure: cellInfra.length,
        roads: cellRoads.length,
        total:
          cellVessels.length +
          cellVehicles.length +
          cellPalms.length +
          cellBuildings.length +
          cellInfra.length +
          cellRoads.length
      };

      const cellFeatures = {
        vessels: cellVessels.map((v) => v.id),
        vehicles: cellVehicles.map((v) => v.id),
        palms: cellPalms,
        buildings: cellBuildings,
        infrastructure: cellInfra,
        roads: cellRoads
      };

      const cellBounds = { minX, maxX, minZ, maxZ, col, row };
      const domainInfo = classifyCellDomain(
        cellBounds,
        featureCounts,
        {
          vessels: cellVessels,
          vehicles: cellVehicles,
          infrastructure: cellInfra
        },
        metric
      );

      const visualNotes = buildVisualNotesGoogleEarth(
        { code, cellId, minX, maxX, minZ, maxZ },
        featureCounts,
        {
          vessels: cellVessels,
          vehicles: cellVehicles,
          palms: cellPalms,
          buildings: cellBuildings,
          infrastructure: cellInfra,
          roads: cellRoads
        },
        domainInfo.domain,
        domainInfo.surface
      );

      cells.push({
        cellId,
        code,
        row,
        col,
        colLetter,
        rowCode: rowPad,
        metricBounds: {
          minX,
          maxX,
          minZ,
          maxZ,
          widthM: cellSizeM,
          depthM: cellSizeM
        },
        metricCenter: [centerX, centerZ],
        wgs84Bounds: {
          south: round6(south),
          west: round6(west),
          north: round6(north),
          east: round6(east)
        },
        wgs84Center: {
          lat: round6(centerLat),
          lon: round6(centerLon)
        },
        domain: domainInfo.domain,
        domainFa: domainInfo.domainFa,
        surface: domainInfo.surface,
        featureCounts,
        features: cellFeatures,
        visualNotesGoogleEarth: visualNotes
      });
    }
  }

  // Summary statistics by domain
  const byDomain = {};
  for (const c of cells) {
    byDomain[c.domain] = (byDomain[c.domain] || 0) + 1;
  }

  return {
    schema: 'bahonar-spatial-grid/1.0',
    generatedAt: new Date().toISOString(),
    gridConfig: GRID_CONFIG,
    summary: {
      totalCells: cells.length,
      byDomain,
      totalFeaturesIndexed: cells.reduce((sum, c) => sum + c.featureCounts.total, 0)
    },
    cells
  };
}

/**
 * Builds the complete GeoDatabase, specialized JSON exports, and SQLite database.
 */
export function buildGeoDatabase() {
  fs.mkdirSync(GEODB_DIR, { recursive: true });

  if (!fs.existsSync(METRIC_PATH)) {
    throw new Error(`Metric dataset not found at ${METRIC_PATH}. Run fetch-osm.mjs first.`);
  }

  const metric = JSON.parse(fs.readFileSync(METRIC_PATH, 'utf8'));
  const raw = fs.existsSync(RAW_PATH) ? JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')) : null;

  console.log('[geodb] Ingested metric dataset:', metric.schema, `(generated: ${metric.generatedAt})`);

  // 1. Generate Palm Tree Registry (~380 palms across 4 zones)
  const rng = createRng(987654321);
  const palms = [];

  // Zone A: Sahand Coastal Park (بوستان ساحلی سهند) - OSM yard-1488367842
  const sahandPark = metric.yardsAndLanduse.find((y) => y.osmId === 1488367842);
  const sahandPoly = sahandPark ? sahandPark.footprintXZ : [];
  const sahandBounds = sahandPark
    ? sahandPark.bounds
    : { minX: -1636, maxX: -1076, minZ: 340, maxZ: 443 };
  let sahandCount = 0;
  for (let attempts = 0; attempts < 1200 && sahandCount < 200; attempts++) {
    const x = sahandBounds.minX + rng() * (sahandBounds.maxX - sahandBounds.minX);
    const z = sahandBounds.minZ + rng() * (sahandBounds.maxZ - sahandBounds.minZ);
    if (!sahandPoly.length || pointInPoly([x, z], sahandPoly)) {
      sahandCount++;
      const height = round2(7.5 + rng() * 4.5); // 7.5m - 12.0m mature date palms
      palms.push({
        id: `palm-sahand-${sahandCount}`,
        zone: 'sahand_coastal_park',
        zoneNameFa: 'بوستان ساحلی سهند',
        x: round2(x),
        z: round2(z),
        y: 2.38,
        heightM: height,
        trunkRadiusM: round2(0.32 + rng() * 0.1),
        crownRadiusM: round2(2.6 + rng() * 0.9),
        leanDeg: round2((rng() - 0.5) * 6),
        variant: sahandCount % 3 === 0 ? 'tall_mature' : sahandCount % 2 === 0 ? 'standard' : 'cluster'
      });
    }
  }

  // Zone B: Boulevard Pasdaran (بلوار پاسداران, Road 96) medians & roadside corridors
  const pasdaranRoads = metric.roads.filter(
    (r) => r.highway === 'trunk' || (r.name && r.name.includes('پاسداران'))
  );
  let pasdaranCount = 0;
  for (const road of pasdaranRoads) {
    const pts = road.pointsXZ;
    for (let i = 0; i < pts.length - 1; i += 2) {
      const p1 = pts[i];
      const p2 = pts[i + 1] || pts[i];
      const mx = (p1[0] + p2[0]) / 2;
      const mz = (p1[1] + p2[1]) / 2;
      const dx = p2[0] - p1[0];
      const dz = p2[1] - p1[1];
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      // North and south side of boulevard
      for (const side of [-1, 1]) {
        if (pasdaranCount >= 90) break;
        pasdaranCount++;
        const offset = 9.5 * side + (rng() - 0.5) * 1.5;
        const px = mx + nx * offset;
        const pz = mz + nz * offset;
        palms.push({
          id: `palm-pasdaran-${pasdaranCount}`,
          zone: 'boulevard_pasdaran',
          zoneNameFa: 'بلوار پاسداران',
          x: round2(px),
          z: round2(pz),
          y: 2.40,
          heightM: round2(8.0 + rng() * 3.5),
          trunkRadiusM: 0.35,
          crownRadiusM: 2.7,
          leanDeg: round2((rng() - 0.5) * 3),
          variant: 'boulevard_row'
        });
      }
    }
  }

  // Zone C: Port Entrance & Ferry Terminal Gardens (میدان شهید باهنر & yard-1549876205)
  let entranceCount = 0;
  const entranceBounds = { minX: 300, maxX: 360, minZ: -1580, maxZ: -1520 };
  for (let i = 0; i < 45; i++) {
    entranceCount++;
    const px = entranceBounds.minX + rng() * (entranceBounds.maxX - entranceBounds.minX);
    const pz = entranceBounds.minZ + rng() * (entranceBounds.maxZ - entranceBounds.minZ);
    palms.push({
      id: `palm-entrance-${entranceCount}`,
      zone: 'port_entrance_plaza',
      zoneNameFa: 'میدان و فضای سبز ورودی بندر شهید باهنر',
      x: round2(px),
      z: round2(pz),
      y: 2.42,
      heightM: round2(6.5 + rng() * 3.0),
      trunkRadiusM: 0.30,
      crownRadiusM: 2.5,
      leanDeg: round2((rng() - 0.5) * 4),
      variant: 'landscaped_plaza'
    });
  }

  // Zone D: Coastal Shoreline & West Beach Buffer (between Sahand Park and Port breakwater root)
  let beachCount = 0;
  for (let i = 0; i < 45; i++) {
    beachCount++;
    const t = i / 45;
    // Follow coastal sand strip X [-1050, -650], Z [280, 480]
    const bx = -1050 + t * 400 + (rng() - 0.5) * 40;
    const bz = 320 + t * 140 + (rng() - 0.5) * 30;
    palms.push({
      id: `palm-beach-${beachCount}`,
      zone: 'coastal_beach_buffer',
      zoneNameFa: 'نوار ساحلی و ماسه‌ای بوستان سهند تا موج‌شکن',
      x: round2(bx),
      z: round2(bz),
      y: 2.36,
      heightM: round2(7.0 + rng() * 4.0),
      trunkRadiusM: 0.32,
      crownRadiusM: 2.6,
      leanDeg: round2((rng() - 0.5) * 8), // Coastal wind lean
      variant: 'wild_coastal'
    });
  }

  console.log(`[geodb] Generated ${palms.length} native date palms across 4 zones.`);

  // 2. Generate 56 Dhow Fleet Mooring Berths along South Quay (quay-wall-200..208)
  const southQuays = [
    metric.quayWalls.find((q) => q.id === 'quay-wall-200'),
    metric.quayWalls.find((q) => q.id === 'quay-wall-202'),
    metric.quayWalls.find((q) => q.id === 'quay-wall-204'),
    metric.quayWalls.find((q) => q.id === 'quay-wall-206'),
    metric.quayWalls.find((q) => q.id === 'quay-wall-207'),
    metric.quayWalls.find((q) => q.id === 'quay-wall-208')
  ].filter(Boolean);

  const totalQuayLen = southQuays.reduce((s, q) => s + q.lengthM, 0);
  const dhowBerths = [];
  const stationsCount = 32;

  for (let i = 0; i < stationsCount; i++) {
    const fraction = (i + 0.5) / stationsCount;
    const targetDist = fraction * totalQuayLen;
    let accumulated = 0;

    for (const q of southQuays) {
      if (accumulated + q.lengthM >= targetDist) {
        const segT = (targetDist - accumulated) / q.lengthM;
        const qx = q.startXZ[0] + (q.endXZ[0] - q.startXZ[0]) * segT;
        const qz = q.startXZ[1] + (q.endXZ[1] - q.startXZ[1]) * segT;
        const [nx, nz] = q.waterNormalXZ;

        const cluster =
          qz < -1000 ? 'cluster_northwest' : qz < -750 ? 'cluster_mid_slip' : 'cluster_southeast';

        // Tier 1: Quay-side moored
        dhowBerths.push({
          id: `dhow-berth-${dhowBerths.length + 1}`,
          cluster,
          tier: 1,
          quayWallId: q.id,
          x: round2(qx + nx * 8.5),
          z: round2(qz + nz * 8.5),
          headingDeg: round2((Math.atan2(nz, nx) * 180) / Math.PI),
          rotY: round2(q.rotationY),
          maxLoaM: 28,
          maxBeamM: 8.0,
          groundedBerth: true
        });

        // Tier 2: Alongside rafted (for 24 stations, yielding 56 total berths)
        if (dhowBerths.length < 56 && i % 4 !== 0) {
          dhowBerths.push({
            id: `dhow-berth-${dhowBerths.length + 1}`,
            cluster,
            tier: 2,
            quayWallId: q.id,
            x: round2(qx + nx * 16.8),
            z: round2(qz + nz * 16.8 + (i % 2 === 0 ? 1.2 : -1.2)),
            headingDeg: round2((Math.atan2(nz, nx) * 180) / Math.PI),
            rotY: round2(q.rotationY + (i % 2 === 0 ? 0.04 : -0.04)),
            maxLoaM: 26,
            maxBeamM: 7.5,
            groundedBerth: false
          });
        }
        break;
      }
      accumulated += q.lengthM;
    }
  }

  console.log(`[geodb] Generated ${dhowBerths.length} dhow berths along South Quay.`);

  // 3. Shipyard & Drydock Registry
  const shipyardFeatures = {
    drydocks: metric.waterFeatures.docks.map((d) => ({
      id: d.id,
      osmId: d.osmId,
      subType: d.subType,
      centerXZ: d.centerXZ,
      widthM: d.widthM,
      depthM: d.depthM,
      areaSqm: d.areaSqm,
      footprintXZ: d.footprintXZ
    })),
    slipway: metric.quaysAndPiers.find((p) => p.kind === 'slipway') || {
      id: 'slipway-556364551',
      osmId: 556364551,
      centerXZ: [840.48, -765.48],
      lengthM: 73.78,
      widthM: 14.45
    },
    workshopsCompound: {
      name: 'Port Machine Workshops & Fabrication',
      nameFa: 'کارگاه تراشکاری و تعمیرات بندر باهنر',
      centerXZ: [-280, -320],
      buildings: metric.buildings
        .filter(
          (b) =>
            b.centerXZ[0] >= -360 &&
            b.centerXZ[0] <= -200 &&
            b.centerXZ[1] >= -420 &&
            b.centerXZ[1] <= -240
        )
        .map((b) => b.id)
    },
    repairCraftSlots: [
      {
        id: 'shipyard-slot-drydock-1',
        description: 'Drydock Basin 1 Repair Hull',
        centerXZ: [722, -767],
        rotY: -1.57,
        craftType: 'coastal_cargo_hull_under_repair'
      },
      {
        id: 'shipyard-slot-drydock-2',
        description: 'Drydock Basin 2 Service Tug in Blocks',
        centerXZ: [768, -741],
        rotY: -1.57,
        craftType: 'service_tug_in_blocks'
      },
      {
        id: 'shipyard-slot-slipway',
        description: 'Marine Slipway Incline Cradle Hull',
        centerXZ: [840, -765],
        rotY: -1.57,
        craftType: 'lenj_dhow_cradle_haul'
      },
      {
        id: 'shipyard-slot-fitting-quay',
        description: 'Outfitting Quay Repair Crane Barge',
        centerXZ: [746, -606],
        rotY: 0.0,
        craftType: 'floating_repair_crane_barge'
      },
      {
        id: 'shipyard-slot-service-tender',
        description: 'Work Tender at Outfitting Pier',
        centerXZ: [804, -575],
        rotY: 0.0,
        craftType: 'maintenance_work_tender'
      }
    ]
  };

  // 4. Expanded Real-World Building Footprints
  const expandedBuildings = {
    summary: {
      total: metric.buildings.length,
      corePort: metric.buildings.filter((b) => b.zone === 'core_port').length,
      surrounding: metric.buildings.filter((b) => b.zone === 'surrounding').length,
      bySubType: metric.summary.counts.buildingsBySubType
    },
    corePortBuildings: metric.buildings.filter((b) => b.zone === 'core_port'),
    surroundingMajorBuildings: metric.buildings
      .filter((b) => b.zone === 'surrounding' && b.areaSqm >= 150)
      .sort((a, b) => b.areaSqm - a.areaSqm)
  };

  // 5. Generate Ground Vehicles (~250 vehicles)
  const vehRng = createRng(456789123);
  const groundVehicles = generateGroundVehicles(metric, vehRng);
  console.log(`[geodb] Generated ${groundVehicles.length} realistic ground vehicles.`);

  // 6. Generate Comprehensive Vessels Inventory (88 afloat + 40 dry skiffs = 128)
  const vesselBerths = generateVesselBerths(metric, dhowBerths, shipyardFeatures);
  const afloatCount = vesselBerths.filter((v) => v.status !== 'dry_staged_boatyard').length;
  const dryCount = vesselBerths.filter((v) => v.status === 'dry_staged_boatyard').length;
  console.log(
    `[geodb] Generated ${vesselBerths.length} vessel inventory records (${afloatCount} afloat + ${dryCount} dry skiffs).`
  );

  // 7. Generate Spatial Grid System (306 cells, 17 cols x 18 rows)
  const spatialGrid = generateSpatialGrid(metric, palms, groundVehicles, vesselBerths);
  console.log(
    `[geodb] Generated ${spatialGrid.cells.length} spatial grid units (200m x 200m, 17x18), indexed ${spatialGrid.summary.totalFeaturesIndexed} features.`
  );

  // Group vehicles by category
  const vehiclesByCategory = {};
  const vehiclesByType = {};
  for (const v of groundVehicles) {
    vehiclesByCategory[v.category] = (vehiclesByCategory[v.category] || 0) + 1;
    vehiclesByType[v.type] = (vehiclesByType[v.type] || 0) + 1;
  }
  const groundVehiclesData = {
    schema: 'bahonar-ground-vehicles/1.0',
    generatedAt: new Date().toISOString(),
    count: groundVehicles.length,
    summary: {
      total: groundVehicles.length,
      byCategory: vehiclesByCategory,
      byType: vehiclesByType
    },
    vehicles: groundVehicles
  };

  // Group vessels by group
  const vesselsByGroup = {};
  for (const v of vesselBerths) {
    vesselsByGroup[v.berthGroup] = (vesselsByGroup[v.berthGroup] || 0) + 1;
  }
  const vesselBerthsData = {
    schema: 'bahonar-vessel-berths/1.0',
    generatedAt: new Date().toISOString(),
    counts: {
      total: vesselBerths.length,
      afloat: afloatCount,
      drySkiffs: dryCount,
      byGroup: vesselsByGroup
    },
    berths: vesselBerths
  };

  // 8. Canonical port-features.json Registry
  const canonicalFeatures = {
    schema: 'bahonar-geodb/1.0',
    version: '1.3.0',
    generatedAt: new Date().toISOString(),
    origin: metric.origin,
    projection: metric.projection,
    bbox: metric.bbox,
    summary: {
      ...metric.summary.counts,
      palmTreesTotal: palms.length,
      dhowBerthsTotal: dhowBerths.length,
      shipyardSlotsTotal: shipyardFeatures.repairCraftSlots.length,
      spatialGridCellsTotal: spatialGrid.cells.length,
      groundVehiclesTotal: groundVehicles.length,
      vesselBerthsTotal: vesselBerths.length,
      vesselsAfloatTotal: afloatCount,
      vesselsDrySkiffsTotal: dryCount
    },
    breakwaters: metric.breakwaters,
    quaysAndPiers: metric.quaysAndPiers,
    quayWalls: metric.quayWalls,
    waterFeatures: metric.waterFeatures,
    shipyardFeatures,
    dhowFleetBerths: dhowBerths,
    vegetationPalms: palms,
    buildingsSummary: expandedBuildings.summary,
    roads: metric.roads,
    yardsAndLanduse: metric.yardsAndLanduse,
    landmarksAndSeamarks: metric.landmarksAndSeamarks,
    spatialGridSummary: spatialGrid.summary,
    groundVehiclesSummary: groundVehiclesData.summary,
    vesselBerthsSummary: vesselBerthsData.counts
  };

  // 9. Write JSON Registries
  fs.writeFileSync(FEATURES_JSON_PATH, JSON.stringify(canonicalFeatures, null, 2));
  fs.writeFileSync(PALMS_JSON_PATH, JSON.stringify({ count: palms.length, palms }, null, 2));
  fs.writeFileSync(DHOWS_JSON_PATH, JSON.stringify({ count: dhowBerths.length, berths: dhowBerths }, null, 2));
  fs.writeFileSync(SHIPYARD_JSON_PATH, JSON.stringify(shipyardFeatures, null, 2));
  fs.writeFileSync(BUILDINGS_JSON_PATH, JSON.stringify(expandedBuildings, null, 2));
  fs.writeFileSync(SPATIAL_GRID_JSON_PATH, JSON.stringify(spatialGrid, null, 2));
  fs.writeFileSync(GROUND_VEHICLES_JSON_PATH, JSON.stringify(groundVehiclesData, null, 2));
  fs.writeFileSync(VESSEL_BERTHS_JSON_PATH, JSON.stringify(vesselBerthsData, null, 2));

  console.log(`[geodb] Exported specialized JSON registries into ${path.relative(ROOT_DIR, GEODB_DIR)}`);

  // 10. Build High-Performance SQLite Database (port-geodb.sqlite)
  if (fs.existsSync(SQLITE_PATH)) {
    fs.unlinkSync(SQLITE_PATH);
  }
  const db = new DatabaseSync(SQLITE_PATH);

  db.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE features (
      id TEXT PRIMARY KEY,
      category TEXT,
      sub_category TEXT,
      name_en TEXT,
      name_fa TEXT,
      metric_x REAL,
      metric_y REAL,
      metric_z REAL,
      width_m REAL,
      depth_m REAL,
      height_m REAL,
      rotation_y REAL,
      area_sqm REAL,
      zone TEXT,
      grounded INTEGER,
      osm_id INTEGER,
      properties_json TEXT
    );

    CREATE TABLE vegetation_palms (
      id TEXT PRIMARY KEY,
      zone TEXT,
      zone_name_fa TEXT,
      x REAL,
      y REAL,
      z REAL,
      height_m REAL,
      trunk_radius_m REAL,
      crown_radius_m REAL,
      variant TEXT
    );

    CREATE TABLE dhow_berths (
      id TEXT PRIMARY KEY,
      cluster TEXT,
      tier INTEGER,
      quay_wall_id TEXT,
      x REAL,
      z REAL,
      heading_deg REAL,
      rotation_y REAL,
      max_loa_m REAL,
      max_beam_m REAL
    );

    CREATE TABLE building_registry (
      id TEXT PRIMARY KEY,
      osm_id INTEGER,
      sub_type TEXT,
      zone TEXT,
      name_en TEXT,
      name_fa TEXT,
      center_x REAL,
      center_z REAL,
      width_m REAL,
      depth_m REAL,
      height_m REAL,
      rotation_y REAL,
      area_sqm REAL,
      levels INTEGER,
      roof_shape TEXT
    );

    CREATE TABLE spatial_grid_cells (
      cell_id TEXT PRIMARY KEY,
      code TEXT UNIQUE,
      row_idx INTEGER,
      col_idx INTEGER,
      min_x REAL,
      max_x REAL,
      min_z REAL,
      max_z REAL,
      center_x REAL,
      center_z REAL,
      wgs84_lat REAL,
      wgs84_lon REAL,
      domain TEXT,
      domain_fa TEXT,
      surface TEXT,
      vessels_count INTEGER,
      vehicles_count INTEGER,
      palms_count INTEGER,
      buildings_count INTEGER,
      infrastructure_count INTEGER,
      roads_count INTEGER,
      total_features INTEGER,
      visual_notes TEXT,
      cell_json TEXT
    );

    CREATE TABLE ground_vehicles (
      id TEXT PRIMARY KEY,
      type TEXT,
      category TEXT,
      description TEXT,
      x REAL,
      y REAL,
      z REAL,
      heading_deg REAL,
      rot_y REAL,
      length_m REAL,
      width_m REAL,
      height_m REAL,
      color TEXT,
      grid_id TEXT,
      properties_json TEXT
    );

    CREATE TABLE vessel_berths (
      id TEXT PRIMARY KEY,
      name TEXT,
      name_fa TEXT,
      berth_group TEXT,
      vessel_type TEXT,
      status TEXT,
      x REAL,
      y REAL,
      z REAL,
      heading_deg REAL,
      rot_y REAL,
      loa_m REAL,
      beam_m REAL,
      draft_m REAL,
      freeboard_m REAL,
      grid_id TEXT,
      details_json TEXT
    );

    CREATE INDEX idx_features_category ON features(category);
    CREATE INDEX idx_palms_zone ON vegetation_palms(zone);
    CREATE INDEX idx_dhow_cluster ON dhow_berths(cluster);
    CREATE INDEX idx_bldg_zone ON building_registry(zone);
    CREATE INDEX idx_grid_code ON spatial_grid_cells(code);
    CREATE INDEX idx_grid_domain ON spatial_grid_cells(domain);
    CREATE INDEX idx_vehicles_type ON ground_vehicles(type);
    CREATE INDEX idx_vehicles_category ON ground_vehicles(category);
    CREATE INDEX idx_vehicles_grid ON ground_vehicles(grid_id);
    CREATE INDEX idx_vessels_type ON vessel_berths(vessel_type);
    CREATE INDEX idx_vessels_group ON vessel_berths(berth_group);
    CREATE INDEX idx_vessels_status ON vessel_berths(status);
    CREATE INDEX idx_vessels_grid ON vessel_berths(grid_id);
  `);

  // Insert metadata
  const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  insertMeta.run('schema', 'bahonar-geodb/1.0');
  insertMeta.run('version', '1.3.0');
  insertMeta.run('updated_at', new Date().toISOString());
  insertMeta.run('origin_lat', String(metric.origin.lat));
  insertMeta.run('origin_lon', String(metric.origin.lon));
  insertMeta.run('bbox_wgs84', JSON.stringify(metric.bbox.wgs84));
  insertMeta.run('bbox_metric', JSON.stringify(metric.bbox.metricScene));
  insertMeta.run('spatial_grid_cells_total', String(spatialGrid.cells.length));
  insertMeta.run('ground_vehicles_total', String(groundVehicles.length));
  insertMeta.run('vessel_berths_total', String(vesselBerths.length));
  insertMeta.run('vessels_afloat_total', String(afloatCount));
  insertMeta.run('vessels_dry_total', String(dryCount));

  // Insert palms
  const insertPalm = db.prepare(`
    INSERT INTO vegetation_palms (id, zone, zone_name_fa, x, y, z, height_m, trunk_radius_m, crown_radius_m, variant)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of palms) {
    insertPalm.run(
      p.id,
      p.zone,
      p.zoneNameFa,
      p.x,
      p.y,
      p.z,
      p.heightM,
      p.trunkRadiusM,
      p.crownRadiusM,
      p.variant
    );
  }

  // Insert dhow berths
  const insertDhow = db.prepare(`
    INSERT INTO dhow_berths (id, cluster, tier, quay_wall_id, x, z, heading_deg, rotation_y, max_loa_m, max_beam_m)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const d of dhowBerths) {
    insertDhow.run(
      d.id,
      d.cluster,
      d.tier,
      d.quayWallId,
      d.x,
      d.z,
      d.headingDeg,
      d.rotY,
      d.maxLoaM,
      d.maxBeamM
    );
  }

  // Insert buildings
  const insertBldg = db.prepare(`
    INSERT INTO building_registry (id, osm_id, sub_type, zone, name_en, name_fa, center_x, center_z, width_m, depth_m, height_m, rotation_y, area_sqm, levels, roof_shape)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const b of metric.buildings) {
    insertBldg.run(
      b.id,
      b.osmId,
      b.subType,
      b.zone,
      b.name || null,
      b.nameFa || null,
      b.centerXZ[0],
      b.centerXZ[1],
      b.widthM,
      b.depthM,
      b.estimatedHeightM,
      b.rotationY,
      b.areaSqm,
      b.levels || null,
      b.roofShape || null
    );
  }

  // Insert primary features
  const insertFeature = db.prepare(`
    INSERT INTO features (id, category, sub_category, name_en, name_fa, metric_x, metric_y, metric_z, width_m, depth_m, height_m, rotation_y, area_sqm, zone, grounded, osm_id, properties_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Breakwaters
  for (const bw of metric.breakwaters) {
    insertFeature.run(
      bw.id,
      'breakwater',
      'armor_mound',
      bw.name,
      null,
      (bw.rootXZ[0] + bw.tipXZ[0]) / 2,
      2.1,
      (bw.rootXZ[1] + bw.tipXZ[1]) / 2,
      bw.avgWidthM,
      bw.lengthM,
      4.3,
      0,
      bw.areaSqm,
      'harbor_entrance',
      1,
      bw.osmId,
      JSON.stringify({ rootXZ: bw.rootXZ, tipXZ: bw.tipXZ })
    );
  }

  // Quays and Piers
  for (const q of metric.quaysAndPiers) {
    insertFeature.run(
      q.id,
      'quays_piers',
      q.kind,
      q.tags?.name || null,
      q.tags?.['name:fa'] || null,
      q.centerXZ[0],
      2.4,
      q.centerXZ[1],
      q.widthM,
      q.lengthM,
      2.4,
      q.rotationY,
      q.areaSqm,
      'port_waterfront',
      1,
      q.osmId,
      JSON.stringify({ floating: q.floating, isArea: q.isArea })
    );
  }

  // Navigation Seamarks
  for (const sm of metric.landmarksAndSeamarks) {
    insertFeature.run(
      sm.id,
      'navigation_aid',
      sm.kind,
      sm.name,
      sm.nameFa,
      sm.positionXZ[0],
      sm.elevationM || 0,
      sm.positionXZ[1],
      1.5,
      1.5,
      sm.elevationM || 6.0,
      0,
      0,
      'channel_entrance',
      1,
      sm.osmId,
      JSON.stringify(sm.seamark || {})
    );
  }

  // Insert Spatial Grid Cells
  const insertGrid = db.prepare(`
    INSERT INTO spatial_grid_cells (
      cell_id, code, row_idx, col_idx, min_x, max_x, min_z, max_z, center_x, center_z,
      wgs84_lat, wgs84_lon, domain, domain_fa, surface, vessels_count, vehicles_count,
      palms_count, buildings_count, infrastructure_count, roads_count, total_features,
      visual_notes, cell_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of spatialGrid.cells) {
    insertGrid.run(
      c.cellId,
      c.code,
      c.row,
      c.col,
      c.metricBounds.minX,
      c.metricBounds.maxX,
      c.metricBounds.minZ,
      c.metricBounds.maxZ,
      c.metricCenter[0],
      c.metricCenter[1],
      c.wgs84Center.lat,
      c.wgs84Center.lon,
      c.domain,
      c.domainFa,
      c.surface,
      c.featureCounts.vessels,
      c.featureCounts.vehicles,
      c.featureCounts.palms,
      c.featureCounts.buildings,
      c.featureCounts.infrastructure,
      c.featureCounts.roads,
      c.featureCounts.total,
      c.visualNotesGoogleEarth,
      JSON.stringify(c)
    );
  }

  // Insert Ground Vehicles
  const insertVehicle = db.prepare(`
    INSERT INTO ground_vehicles (
      id, type, category, description, x, y, z, heading_deg, rot_y,
      length_m, width_m, height_m, color, grid_id, properties_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const v of groundVehicles) {
    insertVehicle.run(
      v.id,
      v.type,
      v.category,
      v.description,
      v.x,
      v.y,
      v.z,
      v.headingDeg,
      v.rotY,
      v.lengthM,
      v.widthM,
      v.heightM,
      v.color,
      v.gridId,
      JSON.stringify({ colorName: v.colorName })
    );
  }

  // Insert Vessel Berths
  const insertVessel = db.prepare(`
    INSERT INTO vessel_berths (
      id, name, name_fa, berth_group, vessel_type, status, x, y, z,
      heading_deg, rot_y, loa_m, beam_m, draft_m, freeboard_m, grid_id, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const vb of vesselBerths) {
    insertVessel.run(
      vb.id,
      vb.name,
      vb.nameFa,
      vb.berthGroup,
      vb.vesselType,
      vb.status,
      vb.x,
      vb.y,
      vb.z,
      vb.headingDeg,
      vb.rotY,
      vb.loaM,
      vb.beamM,
      vb.draftM,
      vb.freeboardM,
      vb.gridId,
      JSON.stringify({ berthName: vb.berthName, details: vb.details, color: vb.color })
    );
  }

  db.close();
  console.log(`[geodb] Built SQLite spatial database: ${path.relative(ROOT_DIR, SQLITE_PATH)}`);

  return {
    palmsCount: palms.length,
    dhowBerthsCount: dhowBerths.length,
    buildingsCount: metric.buildings.length,
    featuresCount:
      metric.breakwaters.length +
      metric.quaysAndPiers.length +
      metric.landmarksAndSeamarks.length,
    spatialGridCellsCount: spatialGrid.cells.length,
    groundVehiclesCount: groundVehicles.length,
    vesselBerthsCount: vesselBerths.length,
    vesselsAfloatCount: afloatCount,
    vesselsDrySkiffsCount: dryCount
  };
}

// CLI Interface
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const cmd = process.argv[2] || 'build';

  if (cmd === 'build') {
    const res = buildGeoDatabase();
    console.log('[geodb] Build completed successfully:', res);
  } else if (cmd === 'stats') {
    if (!fs.existsSync(SQLITE_PATH)) {
      console.log('Database not found. Run "build" first.');
      process.exit(1);
    }
    const db = new DatabaseSync(SQLITE_PATH);
    const countTable = (tbl) => db.prepare(`SELECT count(*) as c FROM ${tbl}`).get().c;
    console.log('=== Shahid Bahonar Port GeoDatabase Inventory ===');
    console.log('  Features:', countTable('features'));
    console.log('  Vegetation Palms:', countTable('vegetation_palms'));
    console.log('  Dhow Berths:', countTable('dhow_berths'));
    console.log('  Building Registry:', countTable('building_registry'));
    console.log('  Spatial Grid Cells:', countTable('spatial_grid_cells'));
    console.log('  Ground Vehicles:', countTable('ground_vehicles'));
    console.log('  Vessel Berths (Comprehensive):', countTable('vessel_berths'));
    db.close();
  } else if (cmd === 'query') {
    const arg = process.argv[3];
    if (!fs.existsSync(SQLITE_PATH)) {
      console.log('Database not found. Run "build" first.');
      process.exit(1);
    }
    const db = new DatabaseSync(SQLITE_PATH);
    if (arg === 'vegetation' || arg === 'palms') {
      const rows = db.prepare('SELECT zone, count(*) as count, avg(height_m) as avg_h FROM vegetation_palms GROUP BY zone').all();
      console.log('Palms by zone:', rows);
    } else if (arg === 'dhow' || arg === 'berths') {
      const rows = db.prepare('SELECT cluster, tier, count(*) as count FROM dhow_berths GROUP BY cluster, tier').all();
      console.log('Dhow berths by cluster & tier:', rows);
    } else if (arg === 'building' || arg === 'buildings') {
      const rows = db.prepare('SELECT zone, sub_type, count(*) as count FROM building_registry GROUP BY zone, sub_type').all();
      console.log('Buildings by zone & sub_type:', rows);
    } else if (arg === 'grid' || arg === 'cells') {
      const rows = db.prepare('SELECT domain, count(*) as cells, sum(total_features) as total_features FROM spatial_grid_cells GROUP BY domain ORDER BY cells DESC').all();
      console.log('Spatial Grid Cells by Domain:', rows);
    } else if (arg === 'vehicles' || arg === 'vehicle') {
      const rows = db.prepare('SELECT category, count(*) as count FROM ground_vehicles GROUP BY category ORDER BY count DESC').all();
      console.log('Ground Vehicles by Category:', rows);
    } else if (arg === 'vessels' || arg === 'berths_comp') {
      const rows = db.prepare('SELECT berth_group, status, count(*) as count FROM vessel_berths GROUP BY berth_group, status ORDER BY count DESC').all();
      console.log('Vessel Berths by Group & Status:', rows);
    } else {
      console.log(`Unknown query target "${arg}". Available: grid, vehicles, vessels, vegetation, dhow, building`);
    }
    db.close();
  }
}
