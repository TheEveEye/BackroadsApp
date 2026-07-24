#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

const DEFAULT_SDE_URL = 'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip';
const DEFAULT_CACHE_PATH = '.cache/eve-online-static-data-latest-jsonl.zip';
const DEFAULT_OUT_DIR = 'public/data';
const NEW_EDEN_MIN_SYSTEM_ID = 30000000;
const NEW_EDEN_MAX_SYSTEM_ID = 30999999;

function usage() {
  console.log(`Usage: node scripts/build-sde-data.mjs [options]

Options:
  --url <url>              SDE JSONL ZIP URL. Defaults to CCP's latest JSONL redirect.
  --zip <path>             Use an existing ZIP instead of downloading.
  --cache <path>           Download cache path. Default: ${DEFAULT_CACHE_PATH}
  --out <dir>              Output directory. Default: ${DEFAULT_OUT_DIR}
  --observatories <path>   Optional JSON or text list of Jove Observatory system IDs/names.
  --no-preserve            Do not preserve hasObservatory flags from existing output.
  --force-download         Re-download even when the cache file exists.
  --help                   Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    url: DEFAULT_SDE_URL,
    cachePath: DEFAULT_CACHE_PATH,
    outDir: DEFAULT_OUT_DIR,
    zipPath: null,
    observatoriesPath: null,
    preserveExisting: true,
    forceDownload: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--url') {
      args.url = next();
    } else if (arg === '--zip') {
      args.zipPath = next();
    } else if (arg === '--cache') {
      args.cachePath = next();
    } else if (arg === '--out') {
      args.outDir = next();
    } else if (arg === '--observatories') {
      args.observatoriesPath = next();
    } else if (arg === '--no-preserve') {
      args.preserveExisting = false;
    } else if (arg === '--force-download') {
      args.forceDownload = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

async function downloadSde(url, cachePath, forceDownload) {
  const outputPath = resolve(cachePath);
  if (!forceDownload && existsSync(outputPath)) {
    console.log(`Using cached SDE ZIP: ${outputPath}`);
    return outputPath;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp`;
  rmSync(tmpPath, { force: true });

  console.log(`Downloading SDE JSONL ZIP: ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download SDE ZIP: HTTP ${response.status} ${response.statusText}`);
  }

  const file = createWriteStream(tmpPath);
  await finished(Readable.fromWeb(response.body).pipe(file));
  renameSync(tmpPath, outputPath);
  return outputPath;
}

function unzipEntry(zipPath, entryName) {
  const result = spawnSync('unzip', ['-p', zipPath, entryName], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });

  if (result.status !== 0) {
    throw new Error(`Failed to read ${entryName} from ${zipPath}: ${result.stderr || result.stdout}`);
  }

  return result.stdout;
}

function parseJsonl(text, entryName) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid JSON in ${entryName}:${i + 1}: ${error.message}`);
    }
  }
  return rows;
}

function englishName(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value.en ?? value['en-us'] ?? '';
  return '';
}

function roundSecurity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 10) / 10;
}

function readPosition2D(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function sortedNumericEntries(record) {
  return Object.entries(record).sort(([a], [b]) => Number(a) - Number(b));
}

function readExistingObservatoryIds(outDir) {
  const systemsPath = resolve(outDir, 'systems_index.json');
  if (!existsSync(systemsPath)) return new Set();

  const data = JSON.parse(readFileSync(systemsPath, 'utf8'));
  const ids = new Set();
  for (const [id, system] of Object.entries(data)) {
    if (system?.hasObservatory) ids.add(Number(id));
  }
  return ids;
}

function readObservatoryIds(path, namesById) {
  if (!path) return new Set();

  const text = readFileSync(resolve(path), 'utf8').trim();
  if (!text) return new Set();

  const ids = new Set();
  const addToken = (token) => {
    const value = String(token).trim();
    if (!value) return;

    const id = Number(value);
    if (Number.isInteger(id)) {
      ids.add(id);
      return;
    }

    const match = Object.entries(namesById).find(([, name]) => name.toLowerCase() === value.toLowerCase());
    if (match) ids.add(Number(match[0]));
  };

  if (path.endsWith('.json')) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      for (const value of parsed) addToken(value);
    } else if (parsed && typeof parsed === 'object') {
      for (const value of Object.values(parsed)) addToken(value);
    }
    return ids;
  }

  for (const line of text.split(/\r?\n/)) addToken(line);
  return ids;
}

function writeJson(path, value) {
  const outputPath = resolve(path);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.outDir);
  const zipPath = args.zipPath
    ? resolve(args.zipPath)
    : await downloadSde(args.url, args.cachePath, args.forceDownload);

  const solarSystems = parseJsonl(unzipEntry(zipPath, 'mapSolarSystems.jsonl'), 'mapSolarSystems.jsonl');
  const stargates = parseJsonl(unzipEntry(zipPath, 'mapStargates.jsonl'), 'mapStargates.jsonl');
  const constellations = parseJsonl(unzipEntry(zipPath, 'mapConstellations.jsonl'), 'mapConstellations.jsonl');
  const regions = parseJsonl(unzipEntry(zipPath, 'mapRegions.jsonl'), 'mapRegions.jsonl');
  const sdeMeta = parseJsonl(unzipEntry(zipPath, '_sde.jsonl'), '_sde.jsonl')[0];

  const systems = {};
  const namesById = {};
  const byName = {};
  const regionIds = new Set();
  const constellationIds = new Set();
  const constellationsById = new Map(constellations.map((row) => [Number(row._key), row]));
  const regionsById = new Map(regions.map((row) => [Number(row._key), row]));
  let position2DCount = 0;
  let sovereigntyEligibleCount = 0;
  let npcNullsecCount = 0;

  for (const row of solarSystems) {
    const id = Number(row._key);
    if (!Number.isInteger(id) || id < NEW_EDEN_MIN_SYSTEM_ID || id > NEW_EDEN_MAX_SYSTEM_ID) continue;

    const name = englishName(row.name);
    const regionId = Number(row.regionID);
    const constellationId = Number(row.constellationID);
    const securityStatus = Number(row.securityStatus);
    const position2D = readPosition2D(row.position2D);
    const inheritedFactionId = row.factionID
      ?? constellationsById.get(constellationId)?.factionID
      ?? regionsById.get(regionId)?.factionID;
    const npcFactionId = Number(inheritedFactionId);
    const hasNpcFaction = Number.isInteger(npcFactionId) && npcFactionId > 0;
    const isNullsec = Number.isFinite(securityStatus) && securityStatus <= 0;
    const isSovereigntyEligible = isNullsec && !hasNpcFaction;
    if (position2D) position2DCount += 1;
    if (isSovereigntyEligible) sovereigntyEligibleCount += 1;
    else if (isNullsec && hasNpcFaction) npcNullsecCount += 1;
    systems[String(id)] = {
      systemId: id,
      constellationId,
      regionId,
      position: {
        x: Number(row.position?.x ?? 0),
        y: Number(row.position?.y ?? 0),
        z: Number(row.position?.z ?? 0),
      },
      ...(position2D ? { position2D } : {}),
      security: roundSecurity(securityStatus),
      ...(hasNpcFaction ? { npcFactionId } : {}),
      isSovereigntyEligible,
      adjacentSystems: [],
      hasObservatory: false,
      isRegional: false,
    };

    regionIds.add(regionId);
    constellationIds.add(constellationId);
    if (name) {
      namesById[String(id)] = name;
      byName[name.toLowerCase()] = id;
    }
  }

  const adjacency = new Map();
  const addEdge = (from, to) => {
    if (!systems[String(from)] || !systems[String(to)] || from === to) return;
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  };

  for (const row of stargates) {
    const from = Number(row.solarSystemID);
    const to = Number(row.destination?.solarSystemID);
    if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
    addEdge(from, to);
    addEdge(to, from);
  }

  for (const [id, neighbors] of adjacency.entries()) {
    const system = systems[String(id)];
    if (!system) continue;
    system.adjacentSystems = [...neighbors].sort((a, b) => a - b);
  }

  const preservedObservatoryIds = args.preserveExisting ? readExistingObservatoryIds(outDir) : new Set();
  const explicitObservatoryIds = readObservatoryIds(args.observatoriesPath, namesById);
  const observatoryIds = new Set([...preservedObservatoryIds, ...explicitObservatoryIds]);

  for (const [idString, system] of Object.entries(systems)) {
    const id = Number(idString);
    system.hasObservatory = observatoryIds.has(id);
    system.isRegional = system.adjacentSystems.some((neighborId) => {
      const neighbor = systems[String(neighborId)];
      return neighbor && neighbor.regionId !== system.regionId;
    });
  }

  const regionNamesById = {};
  for (const row of regions) {
    const id = Number(row._key);
    if (regionIds.has(id)) regionNamesById[String(id)] = englishName(row.name);
  }

  const constellationNamesById = {};
  for (const row of constellations) {
    const id = Number(row._key);
    if (constellationIds.has(id)) constellationNamesById[String(id)] = englishName(row.name);
  }

  const sortedSystems = Object.fromEntries(sortedNumericEntries(systems));
  const sortedNamesById = Object.fromEntries(sortedNumericEntries(namesById));
  const sortedRegionsById = Object.fromEntries(sortedNumericEntries(regionNamesById));
  const sortedConstellationsById = Object.fromEntries(sortedNumericEntries(constellationNamesById));

  writeJson(resolve(outDir, 'systems_index.json'), sortedSystems);
  writeJson(resolve(outDir, 'system_names.json'), { byId: sortedNamesById, byName });
  writeJson(resolve(outDir, 'region_names.json'), { byId: sortedRegionsById });
  writeJson(resolve(outDir, 'constellation_names.json'), { byId: sortedConstellationsById });

  console.log(`SDE build: ${sdeMeta?.buildNumber ?? 'unknown'}`);
  console.log(`Wrote ${Object.keys(sortedSystems).length} systems to ${outDir}`);
  console.log(`Included schematic 2D positions for ${position2DCount} systems`);
  if (position2DCount !== Object.keys(sortedSystems).length) {
    console.warn(`Missing schematic 2D positions for ${Object.keys(sortedSystems).length - position2DCount} systems`);
  }
  console.log(`Marked ${sovereigntyEligibleCount} systems as sovereignty eligible`);
  console.log(`Excluded ${npcNullsecCount} NPC-controlled nullsec systems`);
  console.log(`Preserved/loaded ${observatoryIds.size} Jove Observatory system flags`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
