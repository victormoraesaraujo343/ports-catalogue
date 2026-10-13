#!/usr/bin/env node
// Validates ports-catalogue.json (or the file given as the first argument).
// Usage: node scripts/validate.mjs [path/to/catalogue.json]
// Exits 1 and lists every problem found; exits 0 when the file is valid.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PATH = fileURLToPath(new URL("../ports-catalogue.json", import.meta.url));
const PLATFORMS = ["ps4", "ps3", "ps2", "ps1", "psp", "xbox360", "xbox", "n64", "gamecube", "wii", "switch", "other"];
const STATUSES = ["playable", "partial", "experimental"];
const CHANNELS = ["latest", "prerelease"];
const FORMATS = ["folder", "iso", "folder-or-iso"];
const OSES = ["win32", "linux", "darwin"];
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const path = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PATH;
const errors = [];
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStringList = (v) => Array.isArray(v) && v.every(isNonEmptyString);

function checkLocalized(where, value, { list = false } = {}) {
  if (!isObject(value)) return errors.push(`${where}: must be an object keyed by locale`);
  if (!("en" in value)) return errors.push(`${where}: "en" is required`);
  for (const [locale, text] of Object.entries(value)) {
    const ok = list ? isStringList(text) : isNonEmptyString(text);
    if (!ok) errors.push(`${where}.${locale}: invalid ${list ? "list of strings" : "text"}`);
  }
}

let data;
try {
  data = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {
  console.error(`Cannot read or parse ${path}: ${err.message}`);
  process.exit(1);
}

if (!isObject(data)) errors.push("root: must be an object");
else {
  if (data.version !== 1) errors.push("root.version: must be 1");
  if (!isNonEmptyString(data.updatedAt)) errors.push("root.updatedAt: required");
  if (!Array.isArray(data.ports) || data.ports.length === 0) errors.push("root.ports: must be a non-empty array");
}

const seenIds = new Set();
const ports = isObject(data) && Array.isArray(data.ports) ? data.ports : [];

ports.forEach((port, index) => {
  const label = `ports[${index}]${isNonEmptyString(port?.id) ? ` (${port.id})` : ""}`;
  if (!isObject(port)) return errors.push(`${label}: must be an object`);

  if (!isNonEmptyString(port.id) || !ID_RE.test(port.id)) errors.push(`${label}.id: must be a lowercase slug`);
  else if (seenIds.has(port.id)) errors.push(`${label}.id: duplicate id`);
  else seenIds.add(port.id);

  if (!isNonEmptyString(port.title)) errors.push(`${label}.title: required`);
  if (!PLATFORMS.includes(port.platform)) errors.push(`${label}.platform: unknown platform "${port.platform}"`);
  if (!isNonEmptyString(port.repo) || !REPO_RE.test(port.repo)) errors.push(`${label}.repo: must be "owner/name"`);
  if (port.authors !== undefined && !isStringList(port.authors)) errors.push(`${label}.authors: must be a list of strings`);

  checkLocalized(`${label}.description`, port.description);

  for (const key of ["coverImageUrl", "heroImageUrl"]) {
    const v = port[key];
    if (v !== undefined && v !== null && !(typeof v === "string" && v.startsWith("https://"))) {
      errors.push(`${label}.${key}: must be null or an https URL`);
    }
  }

  if (!STATUSES.includes(port.status)) errors.push(`${label}.status: must be ${STATUSES.join(" | ")}`);
  if (typeof port.tested !== "boolean") errors.push(`${label}.tested: must be true or false`);
  if (!CHANNELS.includes(port.channel)) errors.push(`${label}.channel: must be ${CHANNELS.join(" | ")}`);

  if (!isObject(port.assets)) errors.push(`${label}.assets: must be an object`);
  else {
    for (const [os, asset] of Object.entries(port.assets)) {
      const where = `${label}.assets.${os}`;
      if (!OSES.includes(os)) {
        errors.push(`${where}: unknown OS key (use ${OSES.join(", ")})`);
        continue;
      }
      if (!isObject(asset)) {
        errors.push(`${where}: must be an object`);
        continue;
      }
      if (!isNonEmptyString(asset.executable)) errors.push(`${where}.executable: required`);
      if (!isNonEmptyString(asset.pattern)) {
        errors.push(`${where}.pattern: required`);
        continue;
      }
      try {
        new RegExp(asset.pattern, "i");
      } catch (err) {
        errors.push(`${where}.pattern: does not compile (${err.message})`);
      }
    }
  }

  if (!isObject(port.game)) errors.push(`${label}.game: required`);
  else {
    if (!FORMATS.includes(port.game.format)) errors.push(`${label}.game.format: must be ${FORMATS.join(" | ")}`);
    if (!isStringList(port.game.requiredFiles)) errors.push(`${label}.game.requiredFiles: must be a list of strings`);
    if (port.game.titleIds !== undefined && !isStringList(port.game.titleIds)) {
      errors.push(`${label}.game.titleIds: must be a list of strings`);
    }
    if (port.game.notes !== undefined && port.game.notes !== null) {
      checkLocalized(`${label}.game.notes`, port.game.notes);
    }
  }

  if (port.requirements !== undefined && port.requirements !== null) {
    checkLocalized(`${label}.requirements`, port.requirements, { list: true });
  }
  if (port.setupHint !== undefined && port.setupHint !== null) {
    checkLocalized(`${label}.setupHint`, port.setupHint);
  }

  if (port.stats !== undefined && port.stats !== null) {
    if (!isObject(port.stats) || !Number.isInteger(port.stats.stars) || port.stats.stars < 0) {
      errors.push(`${label}.stats.stars: must be a non-negative integer`);
    }
    if (!isNonEmptyString(port.stats?.pushedAt)) errors.push(`${label}.stats.pushedAt: required`);
  }
});

if (errors.length > 0) {
  console.error(`INVALID: ${path}`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`OK: ${ports.length} ports valid in ${path}`);
