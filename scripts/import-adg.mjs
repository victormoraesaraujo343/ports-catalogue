#!/usr/bin/env node
// Builds ports-catalogue.json from awesome-decomp-games (CC0) plus curated.json.
// Usage: GITHUB_TOKEN=... node scripts/import-adg.mjs
// Exits 1 (and writes nothing) when the source list cannot be read, GitHub rate-limits us,
// too many lookups fail, or the result is empty. Otherwise repos that fail are skipped.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { isDeniedText, isVrText, pickApkRelease } from "./lib/github-sources.mjs";
import {
  adgAssetsFor,
  aiFlagField,
  classifyAdgPlatform,
  isCandidate,
  mergeCatalogue,
  pickAssets,
  slugify,
  statusFromPlayability,
} from "./lib/heuristics.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ADG_URL = "https://raw.githubusercontent.com/SubmitGame/awesome-decomp-games/main/data/games.json";
const GENERATED_FROM = "https://github.com/SubmitGame/awesome-decomp-games";
const OUT_PATH = resolve(ROOT, "ports-catalogue.json");
const CURATED_PATH = resolve(ROOT, "curated.json");
const COVERS_PATH = resolve(ROOT, "covers.json");
const CONCURRENCY = 6;
const MAX_ERROR_RATE = 0.25;
const token = process.env.GITHUB_TOKEN;

const ghHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "ports-catalogue",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

class FatalError extends Error {}

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeGames(source) {
  const games = Array.isArray(source) ? source : source?.games;
  if (Array.isArray(games)) return games;
  if (games && typeof games === "object") {
    return Object.entries(games).map(([key, value]) => ({ id: key, ...value }));
  }
  throw new FatalError("games.json has no games list");
}

async function getJson(url) {
  let res;
  for (let attempt = 1; ; attempt += 1) {
    try {
      res = await fetch(url, { headers: ghHeaders, signal: AbortSignal.timeout(15_000) });
      break;
    } catch (err) {
      if (attempt >= 3) throw new FatalError(`network error after ${attempt} tries: ${err.message}`);
      await new Promise((done) => setTimeout(done, attempt * 5000));
    }
  }
  if (res.status === 403 || res.status === 429) {
    throw new FatalError(`GitHub rate limit or access refused (HTTP ${res.status}) on ${new URL(url).pathname}`);
  }
  return res;
}

/** Latest usable release: /releases/latest, or the first non-draft of the list when only prereleases exist. */
async function fetchRelease(repo) {
  const latest = await getJson(`https://api.github.com/repos/${repo}/releases/latest`);
  if (latest.ok) return { release: await latest.json(), channel: "latest" };
  if (latest.status !== 404) throw new Error(`HTTP ${latest.status}`);

  const list = await getJson(`https://api.github.com/repos/${repo}/releases?per_page=5`);
  if (!list.ok) throw new Error(`HTTP ${list.status}`);
  const release = (await list.json()).find((r) => !r.draft);
  if (!release) return null;
  return { release, channel: release.prerelease ? "prerelease" : "latest" };
}

/** Up to the 10 most recent releases, for the Android APK search (see pickApkRelease). */
async function fetchReleaseList(repo) {
  const list = await getJson(`https://api.github.com/repos/${repo}/releases?per_page=10`);
  if (list.status === 404) return [];
  if (!list.ok) throw new Error(`HTTP ${list.status}`);
  return list.json();
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function buildAutoEntry(game, channel, covers, classification, assets) {
  const [owner, name] = game.repo.split("/");
  const title = clean(game.title) || name;
  const id = slugify(game.id) || slugify(title) || slugify(name) || "port";
  const description = clean(game.description);
  const cover = covers[id] ?? {};

  return {
    id,
    title,
    platform: classification.platform,
    repo: game.repo,
    authors: [owner],
    description: {
      en: description
        ? description.length > 300 ? `${description.slice(0, 299).trimEnd()}…` : description
        : `Community project. Requires your own copy of the game.`,
    },
    coverImageUrl: cover.cover ?? null,
    heroImageUrl: cover.hero ?? null,
    status: statusFromPlayability(Number(game.ratings?.playability)),
    tested: false,
    channel,
    source: "auto",
    ...aiFlagField(game),
    assets,
    game: { format: "folder-or-iso", requiredFiles: [], titleIds: [], notes: null },
    requirements: null,
    setupHint: null,
    stats:
      Number.isInteger(game.stars) && typeof game.last_commit === "string"
        ? { stars: game.stars, pushedAt: game.last_commit }
        : null,
  };
}

async function main() {
  const source = await getJson(ADG_URL).then((res) => {
    if (!res.ok) throw new FatalError(`cannot download games.json (HTTP ${res.status})`);
    return res.json();
  });
  const games = normalizeGames(source);

  const curated = readJson(CURATED_PATH, { ports: [] }).ports ?? [];
  const curatedRepos = new Set(curated.map((p) => p.repo.toLowerCase()));
  const covers = readJson(COVERS_PATH, {});

  const candidatesAll = games.filter(isCandidate);
  const byRepo = new Map();
  for (const game of candidatesAll) {
    const key = game.repo.toLowerCase();
    if (!byRepo.has(key)) byRepo.set(key, game);
  }
  const candidates = [...byRepo.values()];
  const toFetch = candidates.filter((g) => !curatedRepos.has(g.repo.toLowerCase()));

  const stats = { candidates: candidates.length, curatedOverlap: candidates.length - toFetch.length, withAssets: 0, skippedNoRelease: 0, skippedNoAsset: 0, skippedErrors: 0, skippedDenied: 0, androidOtherRelease: 0 };
  const errorSamples = [];

  const auto = [];
  await mapLimit(toFetch, CONCURRENCY, async (game) => {
    let found;
    try {
      found = await fetchRelease(game.repo);
    } catch (err) {
      if (err instanceof FatalError) throw err;
      stats.skippedErrors += 1;
      if (errorSamples.length < 5) errorSamples.push(`${game.repo}: ${err.message}`);
      return;
    }
    if (!found) {
      stats.skippedNoRelease += 1;
      return;
    }
    const classification = classifyAdgPlatform(game.platform);
    // Android build: the most recent release (among 10) with an APK. Desktop picks stay as before, from the latest release.
    let apk;
    try {
      apk = pickApkRelease(await fetchReleaseList(game.repo));
    } catch (err) {
      if (err instanceof FatalError) throw err;
      stats.skippedErrors += 1;
      if (errorSamples.length < 5) errorSamples.push(`${game.repo}: ${err.message}`);
      return;
    }
    const desktop = pickAssets(found.release.assets);
    const assets = {};
    for (const os of ["win32", "linux", "darwin"]) if (desktop[os]) assets[os] = desktop[os];
    if (apk) assets.android = apk.android;
    // Non-console games (gated) must not be VR builds or emulators/frontends/launchers.
    if (classification.gated && isVrText(`${game.title} ${game.description}`)) {
      stats.skippedNoAsset += 1;
      return;
    }
    if (classification.gated && isDeniedText(`${game.repo} ${game.title} ${game.description}`)) {
      stats.skippedDenied += 1;
      return;
    }
    const kept = adgAssetsFor(classification, assets);
    if (!kept) {
      stats.skippedNoAsset += 1;
      return;
    }
    const keepsDesktop = Object.keys(kept).some((os) => os !== "android");
    if (keepsDesktop && apk && apk.release.tag_name !== found.release.tag_name) stats.androidOtherRelease += 1;
    stats.withAssets += 1;
    auto.push(buildAutoEntry(game, keepsDesktop ? found.channel : apk.channel, covers, classification, kept));
  });

  if (toFetch.length > 0 && stats.skippedErrors / toFetch.length > MAX_ERROR_RATE) {
    throw new FatalError(`too many failed lookups (${stats.skippedErrors} of ${toFetch.length}); keeping the previous catalogue`);
  }

  const ports = mergeCatalogue(curated, auto);
  if (ports.length === 0) throw new FatalError("result would be empty; keeping the previous catalogue");

  const previous = readJson(OUT_PATH, null);
  const unchanged = previous && JSON.stringify(previous.ports) === JSON.stringify(ports) && previous.generatedFrom === GENERATED_FROM;
  const output = {
    $schema: "./ports-catalogue.schema.json",
    version: 1,
    updatedAt: unchanged ? previous.updatedAt : new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    generatedFrom: GENERATED_FROM,
    ports,
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);

  const skipped = stats.skippedNoRelease + stats.skippedNoAsset + stats.skippedErrors;
  console.log(`candidates: ${stats.candidates} (already curated, not fetched: ${stats.curatedOverlap})`);
  console.log(`with assets: ${stats.withAssets}`);
  console.log(`denied non-console (emulators, frontends, launchers): ${stats.skippedDenied}`);
  console.log(`Android APK from a release other than the desktop one: ${stats.androidOtherRelease}`);
  console.log(`skipped: ${skipped} (no release: ${stats.skippedNoRelease}, no usable asset: ${stats.skippedNoAsset}, lookup errors: ${stats.skippedErrors})`);
  for (const sample of errorSamples) console.log(`  error sample: ${sample}`);
  console.log(`curated: ${curated.length}, auto: ${auto.length}, final total: ${ports.length}`);
  console.log(unchanged ? "catalogue unchanged" : `wrote ${OUT_PATH}`);
}

try {
  await main();
} catch (err) {
  console.error(`import failed: ${err.message}`);
  process.exit(1);
}
