// Pure helpers for the self-feeding catalogue (no I/O, no dependencies).
// Used by scripts/import-adg.mjs and scripts/fetch-covers.mjs.

const PLATFORM_MAP = new Map([
  ["ps4", "ps4"],
  ["ps3", "ps3"],
  ["ps2", "ps2"],
  ["ps1", "ps1"],
  ["psp", "psp"],
  ["xbox 360", "xbox360"],
  ["xbox", "xbox"],
  ["og xbox", "xbox"],
  ["n64", "n64"],
  ["gamecube", "gamecube"],
  ["wii", "wii"],
  ["wii u", "wiiu"],
  ["switch", "switch"],
  ["nes", "nes"],
  ["snes", "snes"],
  ["game boy", "gb"],
  ["game boy color", "gbc"],
  ["gba", "gba"],
  ["ds", "ds"],
  ["3ds", "3ds"],
  ["genesis", "genesis"],
  ["mega drive", "genesis"],
  ["saturn", "saturn"],
  ["dreamcast", "dreamcast"],
  ["arcade", "arcade"],
]);

const CANDIDATE_TYPES = new Set(["static-recomp", "source-port", "decompilation", "engine-remake"]);
const EXCLUDED_PLATFORMS = new Set(["pc", "dos", "mobile", ""]);
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const IGNORED_EXTENSIONS = /\.(sha256|sha512|sig|asc|txt|json|pdb|dbg|sym|md)$/i;
const IGNORED_NAMES = /source code|debug|symbols|src|source/i;
const ARCHIVE_RE = /\.(zip|7z)$/i;
const WINDOWS_HINT = /win|windows|x64|x86_64|win64|msvc/i;
const NOT_WINDOWS = /linux|mac|osx|darwin|android|arm64/i;
const ANY_OS_HINT = /win|linux|mac|osx|darwin|android|arm64|x64|x86|msvc/i;

/** Maps an Awesome Decomp Games platform label to a catalogue platform. Unknown labels become "other". */
export function mapPlatform(adgPlatform) {
  if (typeof adgPlatform !== "string") return "other";
  return PLATFORM_MAP.get(adgPlatform.trim().toLowerCase()) ?? "other";
}

/** True when an Awesome Decomp Games entry is worth importing (section 10 rules). */
export function isCandidate(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (typeof entry.repo !== "string" || !REPO_RE.test(entry.repo)) return false;
  if (!entry.release) return false;
  if (!CANDIDATE_TYPES.has(entry.type)) return false;
  const platform = String(entry.platform ?? "").trim().toLowerCase();
  if (EXCLUDED_PLATFORMS.has(platform)) return false;
  if (entry.archived || entry.old || entry.inactive || entry.browser_playable || entry.ai_flag) return false;
  return Number(entry.ratings?.playability) >= 3;
}

/** Playability rating (1-5) to catalogue status. */
export function statusFromPlayability(playability) {
  if (playability === 5) return "playable";
  if (playability === 4) return "partial";
  return "experimental";
}

/**
 * Turns a concrete asset name into a regex that matches the same asset in later
 * releases: regex specials are escaped and every run of digits becomes \d+.
 */
export function generalizeAssetName(name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escaped.replace(/\d+/g, "\\d+")}$`;
}

function usableAssetNames(assets) {
  return (Array.isArray(assets) ? assets : [])
    .map((asset) => asset?.name)
    .filter((name) => typeof name === "string" && name.length > 0)
    .filter((name) => !IGNORED_EXTENSIONS.test(name) && !IGNORED_NAMES.test(name));
}

/**
 * Picks one asset per OS from a GitHub release's assets ([{ name }]).
 * Returns e.g. { win32: { pattern, executable: null }, linux: { ... } }; OSes with no match are absent.
 */
export function pickAssets(assets) {
  const names = usableAssetNames(assets);
  const result = {};

  let win = names.find((n) => ARCHIVE_RE.test(n) && WINDOWS_HINT.test(n) && !NOT_WINDOWS.test(n));
  if (!win) win = names.find((n) => /\.exe$/i.test(n) && !/setup|install/i.test(n));
  if (!win && names.length === 1 && ARCHIVE_RE.test(names[0]) && !ANY_OS_HINT.test(names[0])) win = names[0];
  if (win) result.win32 = { pattern: generalizeAssetName(win), executable: null };

  const linux =
    names.find((n) => /\.appimage$/i.test(n)) ??
    names.find((n) => /(\.tar\.gz|\.tar\.xz|\.tgz|\.zip)$/i.test(n) && /linux/i.test(n));
  if (linux) result.linux = { pattern: generalizeAssetName(linux), executable: null };

  const darwin = names.find((n) => /\.zip$/i.test(n) && /mac|macos|osx|darwin/i.test(n));
  if (darwin) result.darwin = { pattern: generalizeAssetName(darwin), executable: null };

  return result;
}

const SEARCH_NOISE = /\b(recomp|recompiled|recompilation|decomp|decompilation|port|pc|native|remake|project)\b/gi;

/** Title prepared for a cover search: no parenthetical parts, no scene words. */
export function cleanTitleForSearch(title) {
  return String(title ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(SEARCH_NOISE, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s:\-–—,]+$/, "")
    .trim();
}

/**
 * Merges curated and auto entries. Curated wins over auto when the repo matches
 * (case-insensitive). Colliding ids get -2, -3, ... in input order (curated first).
 * Output is sorted by id.
 */
export function mergeCatalogue(curated = [], auto = []) {
  const seenRepos = new Set();
  const merged = [];
  for (const port of curated) {
    seenRepos.add(port.repo.toLowerCase());
    merged.push(port);
  }
  for (const port of auto) {
    const key = port.repo.toLowerCase();
    if (seenRepos.has(key)) continue;
    seenRepos.add(key);
    merged.push(port);
  }

  const usedIds = new Set();
  const withIds = merged.map((port) => {
    let id = port.id;
    for (let n = 2; usedIds.has(id); n += 1) id = `${port.id}-${n}`;
    usedIds.add(id);
    return id === port.id ? port : { ...port, id };
  });

  return withIds.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
