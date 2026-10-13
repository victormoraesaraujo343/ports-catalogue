#!/usr/bin/env node
// Refreshes "stats" (stars, pushedAt) of every port from the GitHub API.
// Usage: GITHUB_TOKEN=... node scripts/refresh-stats.mjs [path/to/catalogue.json]
// A repo that fails keeps its previous stats. updatedAt is bumped only when stats changed,
// so the daily job makes a commit only when there is something new.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PATH = fileURLToPath(new URL("../ports-catalogue.json", import.meta.url));
const path = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PATH;
const raw = readFileSync(path, "utf8");
const catalogue = JSON.parse(raw);
const token = process.env.GITHUB_TOKEN;

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "ports-catalogue",
  "X-GitHub-Api-Version": "2022-11-28",
};
if (token) headers.Authorization = `Bearer ${token}`;

let changed = false;

for (const port of catalogue.ports) {
  try {
    const res = await fetch(`https://api.github.com/repos/${port.repo}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const repo = await res.json();
    const next = { stars: repo.stargazers_count, pushedAt: repo.pushed_at };
    if (JSON.stringify(port.stats) !== JSON.stringify(next)) {
      port.stats = next;
      changed = true;
    }
    console.log(`${port.id}: ${next.stars} stars, last push ${next.pushedAt}`);
  } catch (err) {
    console.error(`${port.id}: kept previous stats (${err.message})`);
  }
}

if (changed) {
  catalogue.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  writeFileSync(path, `${JSON.stringify(catalogue, null, 2)}\n`);
  console.log(`Wrote ${path}`);
} else {
  console.log("No stats changed");
}
