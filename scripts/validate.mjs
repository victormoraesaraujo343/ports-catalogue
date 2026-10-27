#!/usr/bin/env node
// Validates the catalogue files. With no argument it checks ports-catalogue.json and curated.json.
// With a path it checks only that file (a file named curated.json is checked as the curated list).
// Usage: node scripts/validate.mjs [path/to/file.json]
// Exits 1 and lists every problem found; exits 0 when every file is valid.

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_PATHS = [resolve(ROOT, "ports-catalogue.json"), resolve(ROOT, "curated.json")];
const PLATFORMS = [
  "ps4", "ps3", "ps2", "ps1", "psp", "xbox360", "xbox", "n64", "gamecube", "wii", "switch",
  "nes", "snes", "gb", "gbc", "gba", "ds", "3ds", "wiiu", "genesis", "saturn", "dreamcast", "arcade",
  "pc", "other",
];
const STATUSES = ["playable", "partial", "experimental"];
const CHANNELS = ["latest", "prerelease"];
const FORMATS = ["folder", "iso", "folder-or-iso"];
const SOURCES = ["curated", "auto", "github-search", "github-fork", "github-author"];
const OSES = ["win32", "linux", "darwin", "android"];
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStringList = (v) => Array.isArray(v) && v.every(isNonEmptyString);

function validateFile(path) {
  const errors = [];
  const isCurated = basename(path) === "curated.json";
  const checkLocalized = (where, value, { list = false } = {}) => {
    if (!isObject(value)) return errors.push(`${where}: must be an object keyed by locale`);
    if (!("en" in value)) return errors.push(`${where}: "en" is required`);
    for (const [locale, text] of Object.entries(value)) {
      const ok = list ? isStringList(text) : isNonEmptyString(text);
      if (!ok) errors.push(`${where}.${locale}: invalid ${list ? "list of strings" : "text"}`);
    }
  };

  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { errors: [`cannot read or parse: ${err.message}`], count: 0 };
  }

  if (!isObject(data)) errors.push("root: must be an object");
  else {
    if (data.version !== 1) errors.push("root.version: must be 1");
    if (!isCurated && !isNonEmptyString(data.updatedAt)) errors.push("root.updatedAt: required");
    if (data.generatedFrom !== undefined && !isNonEmptyString(data.generatedFrom)) errors.push("root.generatedFrom: must be a string");
    if (!Array.isArray(data.ports) || data.ports.length === 0) errors.push("root.ports: must be a non-empty array");
  }

  const seenIds = new Set();
  const seenRepos = new Set();
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
    else if (seenRepos.has(port.repo.toLowerCase())) errors.push(`${label}.repo: repo listed twice`);
    else seenRepos.add(port.repo.toLowerCase());

    if (!SOURCES.includes(port.source)) errors.push(`${label}.source: must be ${SOURCES.join(" | ")}`);
    else if (isCurated && port.source !== "curated") errors.push(`${label}.source: curated.json entries must be "curated"`);

    if (port.authors !== undefined && !isStringList(port.authors)) errors.push(`${label}.authors: must be a list of strings`);
    if (port.aiFlag !== undefined && typeof port.aiFlag !== "boolean") errors.push(`${label}.aiFlag: must be true or false`);

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
        if (asset.executable !== null && !isNonEmptyString(asset.executable)) {
          errors.push(`${where}.executable: must be a non-empty string or null`);
        }
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

  return { errors, count: ports.length };
}

const paths = process.argv[2] ? [resolve(process.argv[2])] : DEFAULT_PATHS;
let failed = false;
for (const path of paths) {
  const { errors, count } = validateFile(path);
  if (errors.length > 0) {
    failed = true;
    console.error(`INVALID: ${path}`);
    for (const error of errors) console.error(`  - ${error}`);
  } else {
    console.log(`OK: ${count} ports valid in ${path}`);
  }
}
process.exit(failed ? 1 : 0);
