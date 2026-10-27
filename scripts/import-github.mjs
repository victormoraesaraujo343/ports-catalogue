#!/usr/bin/env node
// Adds the GitHub sources to ports-catalogue.json. Run it after import-adg.mjs, which writes the ADG output.
//   R1  keyword and topic searches (github-search)
//   R2  Android forks of catalogued non-Android ports (github-fork)
//   R3  other repos of the owners of catalogued Android entries (github-author)
// Precedence when a repo appears twice: curated > ADG > github-fork > github-author > github-search.
// Usage: GITHUB_TOKEN=... node scripts/import-github.mjs
// Exits 1 and writes nothing when GitHub rate-limits us after one retry. A repo that fails a lookup is skipped.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mergeCatalogue } from "./lib/heuristics.mjs";
import {
  AUTHOR_REPO_CAP,
  KEYWORD_QUERIES,
  SOURCE_AUTHOR,
  SOURCE_FORK,
  SOURCE_SEARCH,
  TOPIC_QUERIES,
  buildGithubEntry,
  cleanTitle,
  detectPlatform,
  forkSearchQuery,
  ownersOf,
  pickApkRelease,
  repoText,
  repoVerdict,
  sameCoreName,
} from "./lib/github-sources.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_PATH = resolve(ROOT, "ports-catalogue.json");
const GENERATED_FROM = "https://github.com/SubmitGame/awesome-decomp-games";
const token = process.env.GITHUB_TOKEN;
// Search API: 30 requests per minute when authenticated, 10 without a token. Stay under both.
const SEARCH_GAP_MS = token ? 2100 : 6500;
const LOOKUP_CONCURRENCY = 4;
const SEARCH_PAGES = 3;
const NOW = Date.now();

const ghHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "ports-catalogue",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

class FatalError extends Error {}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const reasons = new Map();
const count = (key) => reasons.set(key, (reasons.get(key) ?? 0) + 1);

let lastSearchAt = 0;

/** fetch with up to 3 tries on a network error (connection reset, timeout). HTTP errors are returned, not retried here. */
async function fetchWithRetry(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, { headers: ghHeaders, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      if (attempt >= 3) throw new FatalError(`network error after ${attempt} tries on ${new URL(url).pathname}: ${err.message}`);
      await sleep(attempt * 5000);
    }
  }
}

/** GET with the search pace. A 403 or 429 is retried once after the advertised wait, then it is fatal. */
async function ghGet(url, { search = false } = {}) {
  if (search) {
    const wait = lastSearchAt + SEARCH_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastSearchAt = Date.now();
  }
  const send = () => fetchWithRetry(url);
  let res = await send();
  if (res.status === 403 || res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after")) || 60;
    if (retryAfter > 120) throw new FatalError(`GitHub rate limit (HTTP ${res.status}) on ${new URL(url).pathname}`);
    await sleep((retryAfter + 1) * 1000);
    res = await send();
    if (res.status === 403 || res.status === 429) {
      throw new FatalError(`GitHub rate limit (HTTP ${res.status}) on ${new URL(url).pathname}`);
    }
  }
  return res;
}

async function searchRepos(query, { perPage = 100, pages = SEARCH_PAGES } = {}) {
  const items = [];
  for (let page = 1; page <= pages; page += 1) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${perPage}&page=${page}`;
    const res = await ghGet(url, { search: true });
    if (!res.ok) {
      console.error(`  search skipped: "${query}" page ${page} (HTTP ${res.status})`);
      break;
    }
    const batch = (await res.json()).items ?? [];
    items.push(...batch);
    if (batch.length < perPage) break;
  }
  return items;
}

/** Public repos of an owner, one listing call. Null when the owner is not found or has more than the cap. */
async function listOwnerRepos(owner) {
  const res = await ghGet(`https://api.github.com/users/${owner}/repos?per_page=100&sort=pushed`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const repos = await res.json();
  return Array.isArray(repos) && repos.length <= AUTHOR_REPO_CAP ? repos : null;
}

async function fetchReleases(repo) {
  const res = await ghGet(`https://api.github.com/repos/${repo}/releases?per_page=10`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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

/**
 * Turns a repo search result into an entry, or null (with the reason counted). Needs an Android APK in the
 * latest usable release. `inherit` gives the title and platform of an upstream port (R2 only).
 */
async function entryFor(meta, { source, keyword, inherit }) {
  const verdict = repoVerdict(meta, NOW, { keyword });
  if (verdict !== "ok") return count(`${source}: ${verdict}`), null;
  let releases;
  try {
    releases = await fetchReleases(meta.full_name);
  } catch (err) {
    if (err instanceof FatalError) throw err;
    return count(`${source}: lookup error`), null;
  }
  if (releases.length === 0) return count(`${source}: no release`), null;
  const apk = pickApkRelease(releases);
  if (!apk) return count(`${source}: no APK`), null;
  return buildGithubEntry({
    owner: meta.owner.login,
    name: meta.name,
    description: meta.description,
    stars: meta.stargazers_count,
    pushedAt: meta.pushed_at,
    title: inherit?.title ?? cleanTitle({ name: meta.name, description: meta.description }),
    platform: inherit?.platform ?? detectPlatform(meta),
    source,
    channel: apk.channel,
    android: apk.android,
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The catalogue as committed (HEAD), used to keep updatedAt when nothing changed. Null when unavailable. */
function readCommitted() {
  try {
    const text = execFileSync("git", ["-C", ROOT, "show", "HEAD:ports-catalogue.json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  const adg = readJson(OUT_PATH);
  const base = adg.ports ?? [];
  if (base.length === 0) throw new Error("ports-catalogue.json has no ports; run import-adg.mjs first");
  const claimed = new Set(base.map((p) => p.repo.toLowerCase()));

  // R2: Android forks of catalogued ports that have no Android build yet.
  const forkCandidates = [];
  for (const upstream of base.filter((p) => !p.assets?.android)) {
    const upstreamName = upstream.repo.split("/")[1];
    const items = await searchRepos(forkSearchQuery(upstreamName), { perPage: 15, pages: 1 });
    for (const meta of items) {
      const key = meta.full_name.toLowerCase();
      if (claimed.has(key)) continue;
      if (!sameCoreName(meta.name, upstreamName) || !/android/i.test(repoText(meta))) {
        count(`${SOURCE_FORK}: name or android mismatch`);
        continue;
      }
      claimed.add(key);
      forkCandidates.push({ meta, upstream });
    }
  }
  const forks = (
    await mapLimit(forkCandidates, LOOKUP_CONCURRENCY, ({ meta, upstream }) =>
      entryFor(meta, { source: SOURCE_FORK, keyword: false, inherit: { title: upstream.title, platform: upstream.platform } }),
    )
  ).filter(Boolean);

  // R1: keyword and topic searches.
  const searchMetas = new Map();
  for (const query of [...KEYWORD_QUERIES, ...TOPIC_QUERIES]) {
    for (const meta of await searchRepos(query)) {
      const key = meta.full_name.toLowerCase();
      if (!claimed.has(key) && !searchMetas.has(key)) searchMetas.set(key, meta);
    }
  }
  for (const key of searchMetas.keys()) claimed.add(key);
  const searches = (
    await mapLimit([...searchMetas.values()], LOOKUP_CONCURRENCY, (meta) =>
      entryFor(meta, { source: SOURCE_SEARCH, keyword: true }),
    )
  ).filter(Boolean);

  // R3: other repos of the owners of accepted Android entries (one listing call per owner, capped).
  const accepted = [...base, ...forks, ...searches];
  const owners = ownersOf(accepted);
  let ownersSkipped = 0;
  const authorMetas = [];
  for (const owner of owners) {
    const repos = await listOwnerRepos(owner);
    if (!repos) {
      ownersSkipped += 1;
      continue;
    }
    for (const meta of repos) {
      const key = meta.full_name.toLowerCase();
      if (claimed.has(key)) continue;
      claimed.add(key);
      authorMetas.push(meta);
    }
  }
  const authors = (
    await mapLimit(authorMetas, LOOKUP_CONCURRENCY, (meta) => entryFor(meta, { source: SOURCE_AUTHOR, keyword: true }))
  ).filter(Boolean);

  // Dedupe by repo with the precedence above (base first), then ids and sort.
  const ports = mergeCatalogue(base, [...forks, ...authors, ...searches]);

  const committed = readCommitted();
  const unchanged =
    committed && committed.generatedFrom === GENERATED_FROM && JSON.stringify(committed.ports) === JSON.stringify(ports);
  const output = {
    $schema: "./ports-catalogue.schema.json",
    version: 1,
    updatedAt: unchanged ? committed.updatedAt : new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    generatedFrom: GENERATED_FROM,
    ports,
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);

  const bySource = {};
  for (const port of ports) bySource[port.source] = (bySource[port.source] ?? 0) + 1;
  console.log(`base (curated + ADG): ${base.length}`);
  console.log(`R2 forks searched: ${base.filter((p) => !p.assets?.android).length}, accepted candidates: ${forks.length}`);
  console.log(`R1 search repos: ${searchMetas.size}, accepted: ${searches.length}`);
  console.log(`R3 owners: ${owners.length} (over cap or not found: ${ownersSkipped}), repos checked: ${authorMetas.length}, accepted: ${authors.length}`);
  console.log(`dropped before the final merge: ${[...reasons.entries()].map(([k, v]) => `${k} ${v}`).join("; ") || "none"}`);
  console.log(`sources in final catalogue: ${JSON.stringify(bySource)}`);
  console.log(`final total: ${ports.length}`);
  console.log(unchanged ? "catalogue unchanged" : `wrote ${OUT_PATH}`);
}

try {
  await main();
} catch (err) {
  console.error(`import failed: ${err.message}`);
  process.exit(1);
}
