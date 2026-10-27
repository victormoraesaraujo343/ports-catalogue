// Pure helpers for the GitHub sources of the catalogue (no I/O, no dependencies).
// Used by scripts/import-github.mjs. Every rule that decides whether a repo becomes an entry lives here.

import { pickAssets, slugify } from "./heuristics.mjs";

export const SOURCE_FORK = "github-fork";
export const SOURCE_AUTHOR = "github-author";
export const SOURCE_SEARCH = "github-search";

/** R1 keyword searches (repo name and description). Portuguese and Spanish phrasings included. */
export const KEYWORD_QUERIES = [
  '"recomp android" in:name,description',
  '"static recompilation android" in:name,description',
  '"recompiled android" in:name,description',
  '"recompilação estática android" in:name,description',
  '"recompilación estática android" in:name,description',
  '"port nativo android" in:name,description',
];
/** R1 topic searches. */
export const TOPIC_QUERIES = ["topic:recompilation", "topic:static-recompilation"];

/** R2 search for an Android fork of a catalogued port. */
export const forkSearchQuery = (upstreamRepoName) => `"${upstreamRepoName} android" in:name,description`;

/** A repo must mention one of these in its name, description or topics (R1 and R3). */
const KEYWORD_RE =
  /recomp|decomp|static recompil|rexglue|xenon|\bports?\b|remake|recompila(ç|c)ão|recompilación|recompilado|port(e)? nativo|nativamente/i;

/**
 * Tools, launchers, emulators and APK utilities that match the keywords (for example "static recompiler"
 * tools, or launchers that bundle ports). Checked on name, description and topics after stripNegations.
 */
const DENY_RE =
  /decompiler|recompiler|compiler|launcher|front-?end|emulat|toolkit|\btools?\b|\bsdk\b|installer|mod ?manager|modding|patcher|template|reverse[ -]engineer|apk (decompil|analy|inspect|tool|editor)|apk ?tool|spyware|attendance|\bgym\b|battery|shader|framework|\bstudy\b|roblox|discord|chatbox|vibe|proxy|pad fixes|fixes for|universal (pad|controller)|recomp\w* tools?/i;

/** "not an emulator" and similar negations are not an emulator. Removed before the deny check. */
const NEGATED_EMULATOR_RE = /\b(not|no|isn'?t|without|non)[- ](an? |the )?emulat\w*/gi;

/** VR and Meta Quest builds are not the phone build. Checked on name, description and the picked APK name. */
const VR_RE = /(^|[^a-z])vr(?![a-z])|quest|oculus|\bpico\b|\bvive\b|\bpsvr\b|openxr/i;

/** Words that describe a port but are not part of the game title (Portuguese and Spanish included). */
const NOISE_WORDS = new Set([
  "recomp", "recompiled", "recompilation", "recompilacao", "recompilação", "recompilada", "recompilado",
  "recompilación", "recompilacion", "decomp", "decompiled", "android", "apk", "port", "ports", "ported", "porting",
  "nativo", "nativa", "native", "natively", "nativamente", "rodando", "arm64", "aarch64", "arm", "x64", "x86",
  "release", "beta", "alpha", "static", "fork", "unofficial", "mobile", "pc",
]);
/** Generic lead-in of a description sentence ("A port of", "Native static recompilation of"). */
const DESCRIPTION_LEAD = /^(an?\s+|the\s+)?((unofficial|native|static|open[- ]source|android|pc|mobile|recompiled|recompilation|decompilation|reimplementation|remake|port\s+nativo|port|nativo|fan)\s+)+(of\s+)?/i;
/** Generic tail of a description head ("... Decompilation Project"). */
const DESCRIPTION_TAIL = /\s+(decompilation|recompilation|reimplementation)(\s+project)?$/i;
/** Multi-word filler removed before splitting into words. */
const NOISE_PHRASES =
  /\b(rodando nativamente (no|em|on) android|rodando nativamente|para android|for android|on android|no android|em android|port nativo|porte nativo|native port|pc port|nativamente|static recompilation|recompilação estática|recompilación estática)\b/gi;
const SMALL_WORDS = new Set(["of", "the", "and", "a", "an", "for", "in", "on", "to", "at", "vs", "or"]);

/** Platform tokens, first match wins. Generic platform names only, no game-specific terms. */
const PLATFORM_TOKENS = [
  ["xbox360", /xbox ?360|\bx360\b|xenon|rexglue/i],
  ["xbox", /\bxbox\b/i],
  ["ps4", /\bps ?4\b|playstation ?4/i],
  ["ps3", /\bps ?3\b|playstation ?3/i],
  ["ps2", /\bps ?2\b|playstation ?2/i],
  ["psp", /\bpsp\b|playstation ?portable/i],
  ["ps1", /\bps ?1\b|\bpsx\b|playstation ?1\b|psone/i],
  ["n64", /\bn64|nintendo ?64/i],
  ["gamecube", /game ?cube|\bngc\b/i],
  ["wiiu", /\bwii ?u\b/i],
  ["wii", /\bwii\b/i],
  ["switch", /nintendo ?switch/i],
  ["3ds", /\b3ds\b/i],
  ["ds", /\bnds\b|nintendo ?ds\b/i],
  ["gba", /\bgba\b|game ?boy ?advance/i],
  ["gbc", /\bgbc\b|game ?boy ?colou?r/i],
  ["gb", /game ?boy/i],
  ["snes", /\bsnes\b|super ?nintendo|super ?famicom/i],
  ["nes", /\bnes\b|famicom/i],
  ["genesis", /\bgenesis\b|mega ?drive/i],
  ["saturn", /\bsaturn\b/i],
  ["dreamcast", /dreamcast/i],
  ["arcade", /\barcade\b/i],
];
const PC_TOKEN_RE = /\bpc\b|windows|\bsteam\b|\bdos\b|pc-?98|\blinux\b|\bmac(os)?\b/i;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Text of a repo search result, used for every keyword and platform check. */
export function repoText(meta) {
  return [meta?.name, meta?.description, ...(Array.isArray(meta?.topics) ? meta.topics : [])]
    .filter((part) => typeof part === "string")
    .join(" ");
}

/** Removes "not an emulator" style phrases so a port that says it is not an emulator is not denied. */
export function stripNegations(text) {
  return String(text ?? "").replace(NEGATED_EMULATOR_RE, " ");
}

/** True when the pushed date is within the last 12 months of `nowMs`. */
export function isRecent(pushedAt, nowMs = Date.now()) {
  const pushed = Date.parse(pushedAt);
  if (Number.isNaN(pushed)) return false;
  const cutoff = new Date(nowMs);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return pushed >= cutoff.getTime();
}

/** True for a VR or Meta Quest build name (also used on the picked APK file name). */
export function isVrText(text) {
  return VR_RE.test(String(text ?? ""));
}

/**
 * Accept/deny verdict for a repo search result, before any release lookup. Returns "ok" or one of:
 * "archived", "stale", "no-keyword", "denied", "vr". The keyword check is skipped with { keyword: false } (R2).
 */
export function repoVerdict(meta, nowMs = Date.now(), { keyword = true } = {}) {
  if (meta?.archived) return "archived";
  if (!isRecent(meta?.pushed_at ?? meta?.pushedAt, nowMs)) return "stale";
  const text = repoText({ name: meta?.name, description: meta?.description, topics: meta?.topics });
  if (keyword && !KEYWORD_RE.test(text)) return "no-keyword";
  if (DENY_RE.test(stripNegations(text))) return "denied";
  if (isVrText(`${meta?.name ?? ""} ${meta?.description ?? ""}`)) return "vr";
  return "ok";
}

/**
 * Latest usable release, mirroring the importer: among the 5 most recent non-draft releases, the first
 * stable one, else the first prerelease. Returns { release, channel } or null.
 */
export function pickRelease(releases) {
  const recent = (Array.isArray(releases) ? releases : []).slice(0, 5).filter((r) => r && !r.draft);
  const stable = recent.find((r) => !r.prerelease);
  if (stable) return { release: stable, channel: "latest" };
  if (recent[0]) return { release: recent[0], channel: "prerelease" };
  return null;
}

/**
 * The Android APK a release would be downloaded as, or null. Returns { name, android } where android is
 * the pickAssets entry ({ pattern, executable }) and name is the matching asset name. The caller applies
 * the VR check to name.
 */
export function androidFromRelease(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const android = pickAssets(assets).android;
  if (!android) return null;
  const pattern = new RegExp(android.pattern, "i");
  const name = assets.map((a) => a?.name).find((n) => typeof n === "string" && pattern.test(n)) ?? "";
  return { name, android };
}

/** Title from a sentence with no separator: drop filler words and phrases, Title Case. */
function cleanWords(raw) {
  const spaced = clean(
    String(raw)
      .replace(NOISE_PHRASES, " ")
      .replace(/\.(apk|zip)$/i, "")
      .replace(/\bv?\d+(\.\d+)+[a-z0-9.-]*/gi, " ")
      .replace(/\bv\d+\b/gi, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([A-Za-z]+)(\d+)(?=[\s\-_.+,:]|$)/g, "$1 $2")
      .replace(/[-_.+:,]+/g, " "),
  );
  const words = spaced
    .split(" ")
    .filter((w) => w.length > 0)
    .filter((w) => !NOISE_WORDS.has(w.toLowerCase()))

  return words
    .map((w, i) => {
      if (/^[A-Z0-9]{2,}$/.test(w)) return w;
      if (i > 0 && SMALL_WORDS.has(w.toLowerCase())) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ")
    .trim();
}

/**
 * Title for an entry from a repo. Prefers the game name at the start of the description when it is
 * followed by " - " or " (" (for example "Gears of War 2 - native PC port"). Otherwise the cleaned repo name.
 * Filler words (recomp, port, Android, "port nativo", "rodando nativamente", versions) are dropped.
 */
export function cleanTitle({ name, description }) {
  const head = clean(description).split(/ - | – | — | \(/)[0];
  if (head !== clean(description) && head.length >= 2 && head.length <= 60) {
    const fromHead = cleanWords(head.replace(DESCRIPTION_LEAD, "").replace(DESCRIPTION_TAIL, ""));
    if (fromHead.length >= 2) return fromHead;
  }
  const fromName = cleanWords(name ?? "");
  return fromName.length >= 2 ? fromName : clean(name);
}

/** Platform of a repo from its name, description and topics. Console tokens first, then "pc", else "other". */
export function detectPlatform(meta) {
  const text = repoText(meta);
  for (const [platform, re] of PLATFORM_TOKENS) if (re.test(text)) return platform;
  const withoutPcPort = text.replace(/\bpc[- ]port\b/gi, " ");
  if (PC_TOKEN_RE.test(withoutPcPort)) return "pc";
  return "other";
}

/** Core name for R2: camel case split, lowercase, no separators, without android/port/apk/arm64/mobile words. */
const FORK_NOISE = new Set(["android", "port", "ports", "apk", "arm64", "aarch64", "mobile", "unofficial"]);
export function coreName(repoName) {
  const words = String(repoName ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !FORK_NOISE.has(w));
  return words.join("");
}

/** True when an Android fork's core name equals the upstream repo name, ignoring case and separators. */
export function sameCoreName(forkRepoName, upstreamRepoName) {
  const upstream = String(upstreamRepoName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return upstream.length > 0 && coreName(forkRepoName) === upstream;
}

/** Entry for the GitHub sources. Android only, status experimental, not tested. */
export function buildGithubEntry({ owner, name, description, stars, pushedAt, title, platform, source, channel, android }) {
  const desc = clean(description);
  return {
    id: slugify(title) || slugify(name) || "port",
    title,
    platform,
    repo: `${owner}/${name}`,
    authors: [owner],
    description: {
      en: desc
        ? desc.length > 300 ? `${desc.slice(0, 299).trimEnd()}…` : desc
        : "Community project. Requires your own copy of the game.",
    },
    coverImageUrl: null,
    heroImageUrl: null,
    status: "experimental",
    tested: false,
    channel,
    source,
    assets: { android: { pattern: android.pattern, executable: null } },
    game: { format: "folder-or-iso", requiredFiles: [], titleIds: [], notes: null },
    requirements: null,
    setupHint: null,
    stats: Number.isInteger(stars) && typeof pushedAt === "string" ? { stars, pushedAt } : null,
  };
}

/** Owners to expand in R3: every distinct owner of a catalogued Android entry, lowercased once. */
export function ownersOf(ports) {
  const owners = new Map();
  for (const port of ports) {
    if (!port?.assets?.android || typeof port.repo !== "string") continue;
    const owner = port.repo.split("/")[0];
    if (!owners.has(owner.toLowerCase())) owners.set(owner.toLowerCase(), owner);
  }
  return [...owners.values()];
}

/** R3 cap: only owners with at most this many public repos are expanded (one listing call each). */
export const AUTHOR_REPO_CAP = 60;
