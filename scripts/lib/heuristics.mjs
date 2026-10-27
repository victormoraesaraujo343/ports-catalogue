// Pure helpers for the self-feeding catalogue (no I/O, no dependencies).
// Used by scripts/import-adg.mjs and scripts/fetch-covers.mjs.

// Keys are labels lowercased with spaces, dots and dashes removed ("Xbox 360" -> "xbox360").
const PLATFORM_ALIASES = {
  ps4: ["ps4", "playstation4"],
  ps3: ["ps3", "playstation3"],
  ps2: ["ps2", "playstation2"],
  ps1: ["ps1", "ps", "psx", "psone", "playstation", "playstation1"],
  psp: ["psp", "playstationportable"],
  xbox360: ["xbox360", "x360"],
  xbox: ["xbox", "ogxbox", "originalxbox"],
  n64: ["n64", "nintendo64"],
  gamecube: ["gamecube", "gc", "ngc", "nintendogamecube"],
  wii: ["wii", "nintendowii"],
  wiiu: ["wiiu", "nintendowiiu"],
  switch: ["switch", "nintendoswitch"],
  nes: ["nes", "famicom"],
  snes: ["snes", "superfamicom", "supernintendo", "sfc"],
  gb: ["gameboy", "gb"],
  gbc: ["gameboycolor", "gameboycolour", "gbc"],
  gba: ["gba", "gameboyadvance"],
  ds: ["ds", "nds", "nintendods"],
  "3ds": ["3ds", "nintendo3ds"],
  genesis: ["genesis", "megadrive", "segagenesis", "segamegadrive"],
  saturn: ["saturn", "segasaturn"],
  dreamcast: ["dreamcast", "segadreamcast"],
  arcade: ["arcade"],
};
const PLATFORM_MAP = new Map(
  Object.entries(PLATFORM_ALIASES).flatMap(([platform, keys]) => keys.map((key) => [key, platform])),
);
const platformKey = (label) => label.toLowerCase().replace(/[\s.-]+/g, "");

const CANDIDATE_TYPES = new Set(["static-recomp", "source-port", "decompilation", "engine-remake"]);
// Labels of original computer games (DOS, Mac, Amiga, ...). They become platform "pc".
const COMPUTER_LABELS = new Set([
  "pc", "dos", "msdos", "pc98", "windows", "linux", "appleii", "apple2", "zxspectrum", "spectrum", "msx",
]);
// Labels whose entries stay as they were (platform "other", desktop assets kept, no APK needed).
const LEGACY_LABELS = new Set(["mac", "macos", "osx", "amiga", "commodore64", "c64", "others", "other", "unknown"]);
// Labels of non-console, non-computer games (mobile, browser, unknown). They become platform "other".
const NON_CONSOLE_LABELS = new Set(["", "mobile", "android", "ios", "androidios", "browser", "web"]);
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const IGNORED_EXTENSIONS = /\.(sha256|sha512|sig|asc|txt|json|pdb|dbg|sym|md)$/i;
const IGNORED_NAMES = /source code|debug|symbols|src|source/i;
// Side downloads that are not the game itself (SDKs, servers, editors, add-ons, ROM builders, ...).
const AUXILIARY_NAMES = /sdk|\b(server|relay|lobby|addon|add-on|dlc|tools?|toolchain|editor|migrator|builder|cheats|lsp|pdb)\b/i;
const ARCHIVE_RE = /\.(zip|7z)$/i;
const WINDOWS_HINT = /win|windows|x64|x86_64|win64|msvc/i;
const ARM_RE = /arm64|aarch64|armhf|armv\d|\barm\b/i;
const NOT_WINDOWS = /linux|mac|osx|darwin|android|\bios\b|flatpak|appimage|steamos|arm64|aarch64|armhf|\barm\b/i;
const ANY_OS_HINT = /win|linux|mac|osx|darwin|android|\bios\b|flatpak|appimage|steamos|arm64|aarch64|x64|x86|msvc/i;
const BITS_32_RE = /i[3-6]86|x86(?![_-]?64)/i;
const BITS_64_RE = /x64|x86[_-]64|amd64|win64|windows64|64-?bit/i;

/**
 * Maps an Awesome Decomp Games platform label to a catalogue platform. Spacing and case are ignored;
 * multi values ("N64 / GameCube") take the first recognized part. Unknown labels become "other".
 */
export function mapPlatform(adgPlatform) {
  if (typeof adgPlatform !== "string") return "other";
  for (const part of adgPlatform.split(/[/,&+|]/)) {
    const platform = PLATFORM_MAP.get(platformKey(part));
    if (platform) return platform;
  }
  return "other";
}

/**
 * Classifies an Awesome Decomp Games platform label.
 * Returns { platform, gated }. Console labels (and other consoles such as "Virtual Boy") are not gated.
 * Gated entries are non-console games: they are imported only with an Android APK (see adgAssetsFor),
 * with platform "pc" for original computer games and "other" for everything else.
 */
export function classifyAdgPlatform(label) {
  const parts = String(label ?? "")
    .split(/[/,&+|]/)
    .map(platformKey)
    .filter(Boolean);
  for (const part of parts) {
    if (PLATFORM_MAP.has(part)) return { platform: PLATFORM_MAP.get(part), gated: false };
  }
  if (parts.some((part) => LEGACY_LABELS.has(part))) return { platform: "other", gated: false };
  if (parts.some((part) => COMPUTER_LABELS.has(part))) return { platform: "pc", gated: true };
  if (parts.every((part) => NON_CONSOLE_LABELS.has(part))) return { platform: "other", gated: true };
  return { platform: "other", gated: false };
}

/**
 * Assets to keep for an Awesome Decomp Games entry, or null when the entry must be skipped.
 * Gated (non-console) entries need an Android APK and keep only that asset, so the desktop
 * catalogue does not change for them. Other entries keep their desktop assets as before.
 */
export function adgAssetsFor(classification, assets) {
  if (classification.gated) return assets.android ? { android: assets.android } : null;
  return Object.keys(assets).length > 0 ? assets : null;
}

/** Only the Android asset, for the entries that come from the GitHub sources. */
export function androidOnly(assets) {
  return assets?.android ? { android: assets.android } : {};
}

/** Extra catalogue fields for an Awesome Decomp Games entry: { aiFlag: true } when ADG marks it AI-generated, else {}. */
export function aiFlagField(entry) {
  return entry?.ai_flag ? { aiFlag: true } : {};
}

/**
 * True when an Awesome Decomp Games entry is worth importing (section 10 rules).
 * Platform is not checked here: non-console entries are gated later by classifyAdgPlatform and adgAssetsFor.
 * AI-flagged entries are kept and tagged with aiFlagField.
 */
export function isCandidate(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (typeof entry.repo !== "string" || !REPO_RE.test(entry.repo)) return false;
  if (!entry.release) return false;
  if (!CANDIDATE_TYPES.has(entry.type)) return false;
  if (entry.archived || entry.old || entry.inactive || entry.browser_playable) return false;
  return Number(entry.ratings?.playability) >= 3;
}

/** Lowercase slug: letters and digits, dashes between words, at most 64 characters. */
export function slugify(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
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
    .filter((name) => !IGNORED_EXTENSIONS.test(name) && !IGNORED_NAMES.test(name) && !AUXILIARY_NAMES.test(name));
}

/**
 * Best name by preference: x86-64 builds before ARM and 32-bit ones, then (optionally) AppImages,
 * then the shortest name (the plain build rather than a "-widescreen" or "-NoAVX2" variant).
 */
function best(candidates, { preferAppImage = false } = {}) {
  const rank = (n) => [
    ARM_RE.test(n) ? 1 : 0,
    BITS_32_RE.test(n) ? 1 : 0,
    BITS_64_RE.test(n) ? 0 : 1,
    preferAppImage && !/\.appimage$/i.test(n) ? 1 : 0,
    n.length,
  ];
  const compare = (a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  };
  return [...candidates].sort(compare)[0];
}

const APK_RE = /\.apk$/i;
const APK_ARM64_RE = /arm64|aarch64|arm64-v8a/i;
const APK_UNIVERSAL_RE = /universal/i;
const APK_BAD_ABI_RE = /x86|amd64|i[3-6]86|armeabi|armv7|arm32|armhf/i;
const APK_DEBUG_RE = /debug/i;

/**
 * Picks one Android APK. Order: arm64 builds, then universal, then names with no ABI hint.
 * x86-only and 32-bit ARM builds are never picked. Debug builds are used only when no release build fits.
 */
function pickApk(assets) {
  const compatible = (Array.isArray(assets) ? assets : [])
    .map((asset) => asset?.name)
    .filter((name) => typeof name === "string" && APK_RE.test(name) && !AUXILIARY_NAMES.test(name))
    .filter((name) => APK_ARM64_RE.test(name) || APK_UNIVERSAL_RE.test(name) || !APK_BAD_ABI_RE.test(name));
  const release = compatible.filter((name) => !APK_DEBUG_RE.test(name));
  const pool = release.length > 0 ? release : compatible;
  const tier = (name) => (APK_ARM64_RE.test(name) ? 0 : APK_UNIVERSAL_RE.test(name) ? 1 : 2);
  return [...pool].sort((a, b) => tier(a) - tier(b) || a.length - b.length)[0];
}

/**
 * Picks one asset per OS from a GitHub release's assets ([{ name }]).
 * Returns e.g. { win32: { pattern, executable: null }, linux: { ... }, android: { ... } }; OSes with no match are absent.
 * Android (key "android") is an APK; no other OS rule can match an .apk, so those picks are unchanged by it.
 */
export function pickAssets(assets) {
  const names = usableAssetNames(assets);
  const result = {};

  let win = best(names.filter((n) => ARCHIVE_RE.test(n) && WINDOWS_HINT.test(n) && !NOT_WINDOWS.test(n)));
  if (!win) win = best(names.filter((n) => /\.exe$/i.test(n) && !/setup|install/i.test(n) && !ARM_RE.test(n)));
  if (!win) {
    const unhinted = names.filter((n) => ARCHIVE_RE.test(n) && !ANY_OS_HINT.test(n));
    if (unhinted.length === 1) win = unhinted[0];
  }
  if (win) result.win32 = { pattern: generalizeAssetName(win), executable: null };

  const linux = best(
    names.filter(
      (n) => /\.appimage$/i.test(n) || (/(\.tar\.gz|\.tar\.xz|\.tgz|\.zip)$/i.test(n) && /linux/i.test(n) && !/flatpak/i.test(n)),
    ),
    { preferAppImage: true },
  );
  if (linux) result.linux = { pattern: generalizeAssetName(linux), executable: null };

  const darwin = names.find((n) => /\.zip$/i.test(n) && /mac|macos|osx|darwin/i.test(n));
  if (darwin) result.darwin = { pattern: generalizeAssetName(darwin), executable: null };

  const apk = pickApk(assets);
  if (apk) result.android = { pattern: generalizeAssetName(apk), executable: null };

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
