#!/usr/bin/env node
// Fills coverImageUrl / heroImageUrl in ports-catalogue.json from SteamGridDB.
// Needs the STEAMGRIDDB_API_KEY env var; without it this does nothing and exits 0.
// Results (including misses) are cached in covers.json; a miss is retried after 7 days.
// Usage: STEAMGRIDDB_API_KEY=... node scripts/fetch-covers.mjs

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { cleanTitleForSearch } from "./lib/heuristics.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CATALOGUE_PATH = resolve(ROOT, "ports-catalogue.json");
const COVERS_PATH = resolve(ROOT, "covers.json");
const API = "https://www.steamgriddb.com/api/v2";
const CONCURRENCY = 3;
const SPACING_MS = 250;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const key = process.env.STEAMGRIDDB_API_KEY;
if (!key) {
  console.log("no key, skipping");
  process.exit(0);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Shared request spacing: each request reserves the next free slot, so concurrent workers stay 250 ms apart.
let nextSlot = 0;
async function spaced(fn) {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + SPACING_MS;
  if (start > now) await sleep(start - now);
  return fn();
}

class AuthError extends Error {}
let authFailed = false;

/** GET on the SteamGridDB v2 API. Returns the `data` field ({ success, data }), or null when nothing was found. */
async function sgGet(path) {
  if (authFailed) throw new AuthError();
  const res = await spaced(() =>
    fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "User-Agent": "ports-catalogue" },
      signal: AbortSignal.timeout(15_000),
    }),
  );
  if (res.status === 401 || res.status === 403) {
    authFailed = true;
    throw new AuthError();
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path.split("/").slice(0, 3).join("/")}`);
  const body = await res.json();
  if (!body?.success || !Array.isArray(body.data)) return null;
  return body.data;
}

async function lookup(port) {
  const term = cleanTitleForSearch(port.title);
  const checkedAt = new Date().toISOString();
  if (!term) return { gameId: null, cover: null, hero: null, checkedAt };

  const search = await sgGet(`/search/autocomplete/${encodeURIComponent(term)}`);
  const gameId = search?.[0]?.id ?? null;
  if (gameId === null) return { gameId: null, cover: null, hero: null, checkedAt };

  const grids = await sgGet(`/grids/game/${gameId}?dimensions=600x900&types=static`);
  const heroes = await sgGet(`/heroes/game/${gameId}`);
  return {
    gameId,
    cover: grids?.[0]?.url ?? null,
    hero: heroes?.[0]?.url ?? null,
    checkedAt,
  };
}

const catalogueText = readFileSync(CATALOGUE_PATH, "utf8");
const catalogue = JSON.parse(catalogueText);
const covers = existsSync(COVERS_PATH) ? JSON.parse(readFileSync(COVERS_PATH, "utf8")) : {};
const isFresh = (entry) => entry?.checkedAt && Date.now() - Date.parse(entry.checkedAt) < WEEK_MS;

const todo = catalogue.ports.filter((port) => !port.coverImageUrl && !isFresh(covers[port.id]));
console.log(`looking up covers for ${todo.length} of ${catalogue.ports.length} ports`);

let found = 0;
let failed = 0;
let looked = 0;
let next = 0;
const worker = async () => {
  while (next < todo.length && !authFailed) {
    const port = todo[next];
    next += 1;
    try {
      covers[port.id] = await lookup(port);
      looked += 1;
      if (covers[port.id].cover) found += 1;
    } catch (err) {
      if (err instanceof AuthError) break;
      failed += 1; // not cached: retried on the next run
      console.error(`${port.id}: ${err.message}`);
    }
  }
};
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
if (authFailed) {
  // Covers are optional: stop looking them up, but let the rest of the daily update run.
  console.error(
    "::warning::SteamGridDB refused the API key (HTTP 401/403). Cover lookups stopped; check the STEAMGRIDDB_API_KEY secret.",
  );
}

for (const port of catalogue.ports) {
  const entry = covers[port.id];
  if (!entry) continue;
  if (!port.coverImageUrl && entry.cover) port.coverImageUrl = entry.cover;
  if (!port.heroImageUrl && entry.hero) port.heroImageUrl = entry.hero;
}

const coversText = `${JSON.stringify(covers, null, 2)}\n`;
if (looked > 0) writeFileSync(COVERS_PATH, coversText);

const nextCatalogueText = `${JSON.stringify(catalogue, null, 2)}\n`;
if (nextCatalogueText !== catalogueText) {
  writeFileSync(CATALOGUE_PATH, nextCatalogueText);
  console.log("updated ports-catalogue.json");
}
console.log(`covers found: ${found}, lookups failed: ${failed}`);
