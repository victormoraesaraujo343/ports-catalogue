import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCatalogue, pickAssets } from "./heuristics.mjs";
import {
  KEYWORD_QUERIES,
  TOPIC_QUERIES,
  androidFromRelease,
  buildGithubEntry,
  cleanTitle,
  detectPlatform,
  forkSearchQuery,
  isRecent,
  ownersOf,
  pickApkRelease,
  isDeniedText,
  repoVerdict,
  sameCoreName,
  stripNegations,
} from "./github-sources.mjs";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const recent = "2026-09-01T00:00:00Z";
const old = "2024-01-01T00:00:00Z";
const meta = (over) => ({ name: "game-android", description: "", topics: [], pushed_at: recent, archived: false, ...over });

test("isRecent accepts a push within 12 months and rejects an older one", () => {
  assert.equal(isRecent(recent, NOW), true);
  assert.equal(isRecent("2025-10-28T00:00:00Z", NOW), true);
  assert.equal(isRecent("2025-10-26T00:00:00Z", NOW), false);
  assert.equal(isRecent(old, NOW), false);
  assert.equal(isRecent("not a date", NOW), false);
});

test("R1 queries include the Portuguese and Spanish phrasings and the two topic searches", () => {
  assert.ok(KEYWORD_QUERIES.includes('"recompilação estática android" in:name,description'));
  assert.ok(KEYWORD_QUERIES.includes('"recompilación estática android" in:name,description'));
  assert.ok(KEYWORD_QUERIES.includes('"port nativo android" in:name,description'));
  assert.deepEqual(TOPIC_QUERIES, ["topic:recompilation", "topic:static-recompilation"]);
});

test("R1 accepts real-looking ports, including Portuguese and Spanish descriptions", () => {
  assert.equal(repoVerdict(meta({ name: "gears-of-war-2-pc-port", description: "Xbox 360 game statically recompiled to x64" }), NOW), "ok");
  assert.equal(repoVerdict(meta({ name: "Recomp-Android", description: "Recompilação estática de um jogo para Android" }), NOW), "ok");
  assert.equal(repoVerdict(meta({ name: "juego", description: "Recompilación estática del juego para Android" }), NOW), "ok");
  assert.equal(repoVerdict(meta({ name: "zelda-x", description: "Port nativo para Android" }), NOW), "ok");
  assert.equal(repoVerdict(meta({ name: "x", description: "Game running natively, rodando nativamente no Android, recompiled" }), NOW), "ok");
});

test("R1 denies tools, launchers, emulators and APK utilities that match the keywords", () => {
  const denied = [
    { name: "n64recomp", description: "Static recompiler for N64 games" },
    { name: "XenonRecomp", description: "Static recompiler for Xbox 360 binaries" },
    { name: "rexglue-sdk", description: "Recompilation SDK for rexglue" },
    { name: "apk-decompiler", description: "Decompile and analyse APK files" },
    { name: "ports-launcher", description: "Launcher for recompiled ports on Android" },
    { name: "recomp-frontend", description: "Frontend for recompiled games" },
    { name: "recomp-toolkit", description: "Recompilation toolkit" },
    { name: "emu-port", description: "An emulator port for Android" },
    { name: "recomp-patcher", description: "Patcher for recompiled builds" },
    { name: "recomp-battery", description: "Battery saver for recomp ports" },
    { name: "mod-manager", description: "Mod manager for recompiled ports" },
    { name: "recomp-template", description: "Template for a recompilation port" },
  ];
  for (const repo of denied) assert.equal(repoVerdict(meta(repo), NOW), "denied", repo.name);
});

test("the deny-list catches emulators, frontends and launchers, in English, Portuguese and Spanish", () => {
  assert.equal(isDeniedText("All in one emulator on Android!"), true);
  assert.equal(isDeniedText("A frontend for ports"), true);
  assert.equal(isDeniedText("Launcher for Android ports"), true);
  assert.equal(isDeniedText("Emulador multiplataforma para Android"), true);
  assert.equal(isDeniedText("Emulación de consolas en Android"), true);
});

test("negations keep console ports that merely say they are not an emulator", () => {
  assert.equal(isDeniedText("Port de jogo de N64 sem emulador de CPU"), false);
  assert.equal(isDeniedText("Port nativo do jogo, no emulation"), false);
  assert.equal(isDeniedText("Native port, without emulation, Xbox 360 game"), false);
  assert.equal(isDeniedText("Juego sin emulador, recompilado"), false);
  assert.equal(isDeniedText("Não é um emulador, é um port nativo"), false);
});

test("R1 does not deny a port that says it is not an emulator", () => {
  const text = "Xbox 360 game statically recompiled to x64 (not an emulator). 4K, FSR.";
  assert.equal(repoVerdict(meta({ name: "gow2-recomp", description: text }), NOW), "ok");
  assert.doesNotMatch(stripNegations(text), /emulat/i);
  assert.match(stripNegations("This is an emulator port"), /emulator/);
});

test("R1 rejects VR and Meta Quest builds by name or description", () => {
  assert.equal(repoVerdict(meta({ name: "HaloCE-Quest", description: "recomp port" }), NOW), "vr");
  assert.equal(repoVerdict(meta({ name: "recomp-port", description: "Meta Quest VR build" }), NOW), "vr");
  assert.equal(repoVerdict(meta({ name: "recomp-port", description: "Port for Android" }), NOW), "ok");
});

test("R1 rejects archived, stale and keyword-less repos", () => {
  assert.equal(repoVerdict(meta({ name: "recomp-port", description: "port", archived: true }), NOW), "archived");
  assert.equal(repoVerdict(meta({ name: "recomp-port", description: "port", pushed_at: old }), NOW), "stale");
  assert.equal(repoVerdict(meta({ name: "notes-android", description: "A notes app" }), NOW), "no-keyword");
  assert.equal(repoVerdict(meta({ name: "notes-android", description: "A notes app" }), NOW, { keyword: false }), "ok");
});

const apkAsset = (name) => ({ name });
const rel = (tag, assets, over = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets, ...over });
const ARM = apkAsset("game-arm64-v8a-release.apk");

test("pickApkRelease: an older stable release with an APK is used when the newest has only desktop builds", () => {
  const releases = [rel("v0.4", [apkAsset("Game-Windows.zip")]), rel("v0.2", [ARM])];
  const found = pickApkRelease(releases);
  assert.equal(found.release.tag_name, "v0.2");
  assert.equal(found.name, "game-arm64-v8a-release.apk");
  assert.equal(found.channel, "latest");
});

test("pickApkRelease: a newest release with no assets does not hide an APK in an older one", () => {
  const found = pickApkRelease([rel("v0.6", []), rel("v0.13", [ARM])]);
  assert.equal(found.release.tag_name, "v0.13");
  assert.equal(found.channel, "latest");
});

test("pickApkRelease: a stable release is preferred over a prerelease, a prerelease is the fallback", () => {
  const pre = rel("v1-beta", [ARM], { prerelease: true });
  assert.deepEqual(
    pickApkRelease([pre, rel("v0.9", [ARM])]).release.tag_name,
    "v0.9",
  );
  const only = pickApkRelease([rel("v2-rc", [ARM], { prerelease: true }), rel("v1", [])]);
  assert.equal(only.release.tag_name, "v2-rc");
  assert.equal(only.channel, "prerelease");
});

test("pickApkRelease: VR APKs are picked only when allowVr is set (console and legacy ADG entries)", () => {
  const vr = [rel("v2", [apkAsset("Game-Quest.apk")]), rel("v1", [ARM])];
  assert.equal(pickApkRelease(vr).release.tag_name, "v1");
  assert.equal(pickApkRelease([rel("v2", [apkAsset("Game-Quest.apk")])], { allowVr: true }).release.tag_name, "v2");
});

test("pickApkRelease: drafts, releases beyond the 10 most recent, and VR APKs do not count", () => {
  assert.equal(pickApkRelease([rel("v3", [ARM], { draft: true })]), null);
  const eleven = Array.from({ length: 10 }, (_, i) => rel(`v${i}`, [])).concat([rel("old", [ARM])]);
  assert.equal(pickApkRelease(eleven), null);
  assert.equal(pickApkRelease([rel("v1", [apkAsset("Game-Quest-arm64.apk")])]), null);
  assert.equal(pickApkRelease([]), null);
});

test("pickApkRelease: picks from the APK-bearing release, not from desktop-only ones", () => {
  const found = pickApkRelease([rel("v5", [apkAsset("Game-Linux.tar.gz")]), rel("v4", [apkAsset("Game-Windows.zip")]), rel("v3", [ARM])]);
  assert.equal(found.release.tag_name, "v3");
});

test("androidFromRelease finds the APK and its asset name, and ignores releases without one", () => {
  const release = { assets: [{ name: "game-x86_64.apk" }, { name: "game-arm64-v8a-release.apk" }, { name: "Game.zip" }] };
  const found = androidFromRelease(release);
  assert.equal(found.name, "game-arm64-v8a-release.apk");
  assert.equal(found.android.executable, null);
  assert.equal(androidFromRelease({ assets: [{ name: "Game-Windows.zip" }] }), null);
});

test("R2 exact name match: same core name accepted, different game rejected (Tooie case)", () => {
  assert.equal(sameCoreName("perfect-dark-android", "perfect_dark"), true);
  assert.equal(sameCoreName("UnleashedRecomp-Android", "UnleashedRecomp"), true);
  assert.equal(sameCoreName("2ship2harkinian-Android", "2ship2harkinian"), true);
  assert.equal(sameCoreName("snowboardkids2-recomp-Android", "snowboardkids2-recomp"), true);
  assert.equal(sameCoreName("MegaMan64Recompiled-Mobile", "MegaMan64Recompiled"), true);
  assert.equal(sameCoreName("Tooie-Recompiled", "BanjoRecomp"), false);
  assert.equal(sameCoreName("gow-recomp-Android", "gow2-recomp"), false);
  assert.equal(sameCoreName("Lighthouse", "Starship"), false);
});

test("R2 search query shape", () => {
  assert.equal(forkSearchQuery("perfect_dark"), '"perfect_dark android" in:name,description');
});

test("cleanTitle prefers the game name before a separator in the description", () => {
  assert.equal(cleanTitle({ name: "gears-of-war-2-pc-port", description: "Gears of War 2 - native PC port" }), "Gears of War 2");
  assert.equal(cleanTitle({ name: "zelda-x", description: "Ocarina of Time (port nativo para Android)" }), "Ocarina of Time");
});

test("cleanTitle drops filler words and versions and applies Title Case", () => {
  assert.equal(cleanTitle({ name: "naruto-storm-generations-port-nativo", description: "" }), "Naruto Storm Generations");
  assert.equal(cleanTitle({ name: "ShaolinMonks-Android", description: "" }), "Shaolin Monks");
  assert.equal(cleanTitle({ name: "Game-Recomp-v1.2.3-arm64", description: "" }), "Game");
  assert.equal(cleanTitle({ name: "Skate3-Mobile", description: "" }), "Skate 3");
  assert.equal(cleanTitle({ name: "BOTWRecompAndroid", description: "Breath of the Wild rodando nativamente no Android" }), "BOTW");
  assert.equal(cleanTitle({ name: "Yakumo", description: "Static recompilation of a PSP game" }), "Yakumo");
});

test("detectPlatform finds console tokens, then pc, else other", () => {
  assert.equal(detectPlatform({ name: "x", description: "Xbox 360 port" }), "xbox360");
  assert.equal(detectPlatform({ name: "x", description: "N64 recompiled" }), "n64");
  assert.equal(detectPlatform({ name: "x", description: "Wii U game" }), "wiiu");
  assert.equal(detectPlatform({ name: "x", description: "Game Boy Color classic" }), "gbc");
  assert.equal(detectPlatform({ name: "x", description: "Game Boy Advance remake" }), "gba");
  assert.equal(detectPlatform({ name: "x", description: "PS2 classic" }), "ps2");
  assert.equal(detectPlatform({ name: "x", description: "Windows and Linux port" }), "pc");
  assert.equal(detectPlatform({ name: "x", description: "PC port for Android" }), "other");
  assert.equal(detectPlatform({ name: "x", description: "something else" }), "other");
});

test("buildGithubEntry writes an Android-only, experimental, untested entry", () => {
  const entry = buildGithubEntry({
    owner: "someone",
    name: "Game-Android",
    description: "A port",
    stars: 3,
    pushedAt: recent,
    title: "Game",
    platform: "n64",
    source: "github-search",
    channel: "latest",
    android: { pattern: "^g\\.apk$", executable: "ignored" },
  });
  assert.equal(entry.id, "game");
  assert.equal(entry.repo, "someone/Game-Android");
  assert.deepEqual(entry.assets, { android: { pattern: "^g\\.apk$", executable: null } });
  assert.equal(entry.status, "experimental");
  assert.equal(entry.tested, false);
  assert.deepEqual(entry.game, { format: "folder-or-iso", requiredFiles: [], titleIds: [], notes: null });
  assert.deepEqual(entry.stats, { stars: 3, pushedAt: recent });
});

test("dedupe precedence: curated > ADG > github-fork > github-author > github-search", () => {
  const curated = [{ id: "a", repo: "o/Port", source: "curated" }];
  const adg = [{ id: "b", repo: "o/port2", source: "auto" }];
  const forks = [{ id: "c", repo: "O/PORT2", source: "github-fork" }];
  const authors = [{ id: "d", repo: "o/port3", source: "github-author" }, { id: "e", repo: "O/PORT", source: "github-author" }];
  const searches = [{ id: "f", repo: "o/port3", source: "github-search" }];
  const merged = mergeCatalogue(curated.concat(adg), [...forks, ...authors, ...searches]);
  assert.deepEqual(merged.map((p) => [p.repo, p.source]), [
    ["o/Port", "curated"],
    ["o/port2", "auto"],
    ["o/port3", "github-author"],
  ]);
});

test("ownersOf lists each owner of an Android entry once, case-insensitively", () => {
  const ports = [
    { repo: "Foo/a", assets: { android: {} } },
    { repo: "foo/b", assets: { android: {} } },
    { repo: "bar/c", assets: { win32: {} } },
    { repo: "baz/d", assets: { android: {} } },
  ];
  assert.deepEqual(ownersOf(ports), ["Foo", "baz"]);
});

test("pickAssets still gives an APK to the github helpers' tests", () => {
  assert.ok(pickAssets([{ name: "g-arm64.apk" }]).android);
});

test("detectPlatform does not read a PC port target as PC origin", () => {
  const naruto = "Naruto Shippuden: Ultimate Ninja Storm 2 - port nativo para Android (ARM64) e PC";
  assert.notEqual(detectPlatform({ name: "naruto-storm-2-port-nativo", description: naruto }), "pc");
  assert.equal(detectPlatform({ name: "x", description: "port for Android and PC" }), "other");
  assert.equal(detectPlatform({ name: "x", description: "pc e android" }), "other");
  assert.equal(detectPlatform({ name: "x", description: "android/pc build" }), "other");
  assert.equal(detectPlatform({ name: "x", description: "Android and PC, Xbox 360 game" }), "xbox360");
  assert.equal(detectPlatform({ name: "x", description: "Windows and Linux port" }), "pc");
});

test("cleanTitle drops a generic lead-in from the description head", () => {
  assert.equal(cleanTitle({ name: "ctr-native-android", description: "A port of LEGO Marvel Superheroes - Android build" }), "LEGO Marvel Superheroes");
  assert.equal(cleanTitle({ name: "x", description: "Recompilation of Halo - for phones" }), "Halo");
});

test("R1 rejects VR builds with glued names and VR headset names", () => {
  assert.equal(repoVerdict(meta({ name: "Doom3Quest", description: "port for VR headsets" }), NOW), "vr");
  assert.equal(repoVerdict(meta({ name: "QuakeQuest", description: "recomp port" }), NOW), "vr");
  assert.equal(repoVerdict(meta({ name: "Lambda1VR", description: "recomp port" }), NOW), "vr");
  assert.equal(repoVerdict(meta({ name: "quake3pico", description: "recomp port for Pico 4" }), NOW), "vr");
  assert.equal(repoVerdict(meta({ name: "vrcade-recomp", description: "recomp port" }), NOW), "ok");
});
