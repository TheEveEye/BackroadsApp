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
const MAGMATIC_GAS_TYPE_ID = 81143;
const SUPERIONIC_ICE_TYPE_ID = 81144;

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

function unzipEntry(zipPath, entryName, maxBufferMb = 64) {
  const result = spawnSync('unzip', ['-p', zipPath, entryName], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * maxBufferMb,
  });

  if (result.status !== 0) {
    throw new Error(
      `Failed to read ${entryName} from ${zipPath}: ${String(result.stderr || '').slice(0, 2000)}`,
    );
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

function parseJsonlForKeys(text, entryName, keys) {
  const rows = new Map();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON in ${entryName}:${i + 1}: ${error.message}`);
    }
    const key = Number(row?._key);
    if (keys.has(key)) rows.set(key, row);
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

function plainText(value) {
  return englishName(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getUpgradeMenuMetadata(type) {
  const name = englishName(type.name);
  const tierMatch = name.match(/\s([123])$/);
  const tier = tierMatch ? Number(tierMatch[1]) : undefined;
  if (type.marketGroupID === 1282) return { category: 'Strategic' };
  if (type.marketGroupID === 1283) {
    return {
      category: 'Mining',
      family: name.replace(/\s+Prospecting Array\s+[123]$/, ''),
      ...(tier ? { tier } : {}),
    };
  }
  if (type.marketGroupID === 1284) {
    return {
      category: 'Ratting',
      family: name.replace(/\s+[123]$/, ''),
      ...(tier ? { tier } : {}),
    };
  }
  if (type.marketGroupID === 3736) {
    return {
      category: 'Colony Resources',
      family: name.replace(/\s+[123]$/, ''),
      ...(tier ? { tier } : {}),
    };
  }
  if (type.marketGroupID === 3739) {
    return {
      category: 'Exploration',
      family: 'Exploration Detector',
      ...(tier ? { tier } : {}),
    };
  }
  if (type.marketGroupID === 3741) return { category: 'System Effects' };
  throw new Error(`Unknown sovereignty upgrade market group ${type.marketGroupID} for ${name}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.outDir);
  const zipPath = args.zipPath
    ? resolve(args.zipPath)
    : await downloadSde(args.url, args.cachePath, args.forceDownload);

  const solarSystems = parseJsonl(unzipEntry(zipPath, 'mapSolarSystems.jsonl'), 'mapSolarSystems.jsonl');
  const planetResources = parseJsonl(unzipEntry(zipPath, 'planetResources.jsonl'), 'planetResources.jsonl');
  const stargates = parseJsonl(unzipEntry(zipPath, 'mapStargates.jsonl'), 'mapStargates.jsonl');
  const constellations = parseJsonl(unzipEntry(zipPath, 'mapConstellations.jsonl'), 'mapConstellations.jsonl');
  const regions = parseJsonl(unzipEntry(zipPath, 'mapRegions.jsonl'), 'mapRegions.jsonl');
  const sovereigntyUpgrades = parseJsonl(
    unzipEntry(zipPath, 'sovereigntyUpgrades.jsonl'),
    'sovereigntyUpgrades.jsonl',
  );
  const sovereigntyTypeIds = new Set(sovereigntyUpgrades.map((row) => Number(row._key)));
  const sovereigntyTypes = parseJsonlForKeys(
    unzipEntry(zipPath, 'types.jsonl', 256),
    'types.jsonl',
    sovereigntyTypeIds,
  );
  const sdeMeta = parseJsonl(unzipEntry(zipPath, '_sde.jsonl'), '_sde.jsonl')[0];

  const systems = {};
  const namesById = {};
  const byName = {};
  const regionIds = new Set();
  const constellationIds = new Set();
  const constellationsById = new Map(constellations.map((row) => [Number(row._key), row]));
  const regionsById = new Map(regions.map((row) => [Number(row._key), row]));
  const planetResourcesById = new Map(planetResources.map((row) => [Number(row._key), row]));
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
    let power = 0;
    let workforce = 0;
    let magmaticGas = 0;
    let superionicIce = 0;
    for (const resourceSourceId of [row.starID, ...(row.planetIDs ?? [])]) {
      const resources = planetResourcesById.get(Number(resourceSourceId));
      const sourcePower = Number(resources?.power);
      const sourceWorkforce = Number(resources?.workforce);
      if (Number.isFinite(sourcePower)) power += sourcePower;
      if (Number.isFinite(sourceWorkforce)) workforce += sourceWorkforce;
    }
    for (const planetId of row.planetIDs ?? []) {
      const reagent = planetResourcesById.get(Number(planetId))?.reagent;
      const amountPerCycle = Number(reagent?.amount_per_cycle);
      const cyclePeriodSeconds = Number(reagent?.cycle_period);
      if (
        !Number.isFinite(amountPerCycle)
        || !Number.isFinite(cyclePeriodSeconds)
        || cyclePeriodSeconds <= 0
      ) continue;
      const amountPerHour = amountPerCycle * 3600 / cyclePeriodSeconds;
      if (Number(reagent?.type_id) === MAGMATIC_GAS_TYPE_ID) magmaticGas += amountPerHour;
      if (Number(reagent?.type_id) === SUPERIONIC_ICE_TYPE_ID) superionicIce += amountPerHour;
    }
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
      power,
      workforce,
      magmaticGas,
      superionicIce,
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
  const publishedSovereigntyUpgrades = sovereigntyUpgrades
    .map((upgrade) => {
      const typeId = Number(upgrade._key);
      const type = sovereigntyTypes.get(typeId);
      if (!type?.published) return null;
      return {
        typeId,
        name: englishName(type.name),
        description: plainText(type.description),
        ...getUpgradeMenuMetadata(type),
        ...(upgrade.mutually_exclusive_group
          ? { mutuallyExclusiveGroup: upgrade.mutually_exclusive_group }
          : {}),
        powerAllocation: Number(upgrade.power_allocation ?? 0),
        powerProduction: Number(upgrade.power_production ?? 0),
        workforceAllocation: Number(upgrade.workforce_allocation ?? 0),
        workforceProduction: Number(upgrade.workforce_production ?? 0),
        ...(upgrade.fuel
          ? {
              fuel: {
                typeId: Number(upgrade.fuel.type_id),
                startupCost: Number(upgrade.fuel.startup_cost ?? 0),
                hourlyUpkeep: Number(upgrade.fuel.hourly_upkeep ?? 0),
              },
            }
          : {}),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  writeJson(resolve(outDir, 'systems_index.json'), sortedSystems);
  writeJson(resolve(outDir, 'system_names.json'), { byId: sortedNamesById, byName });
  writeJson(resolve(outDir, 'region_names.json'), { byId: sortedRegionsById });
  writeJson(resolve(outDir, 'constellation_names.json'), { byId: sortedConstellationsById });
  writeJson(resolve(outDir, 'sovereignty_upgrades.json'), publishedSovereigntyUpgrades);

  console.log(`SDE build: ${sdeMeta?.buildNumber ?? 'unknown'}`);
  console.log(`Wrote ${Object.keys(sortedSystems).length} systems to ${outDir}`);
  console.log(`Included schematic 2D positions for ${position2DCount} systems`);
  console.log(`Wrote ${publishedSovereigntyUpgrades.length} published sovereignty upgrades`);
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
