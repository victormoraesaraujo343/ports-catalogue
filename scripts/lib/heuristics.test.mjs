import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adgAssetsFor,
  aiFlagField,
  classifyAdgPlatform,
  cleanTitleForSearch,
  generalizeAssetName,
  isCandidate,
  mapPlatform,
  mergeCatalogue,
  pickAssets,
  slugify,
  statusFromPlayability,
} from "./heuristics.mjs";

test("mapPlatform maps known labels case-insensitively", () => {
  assert.equal(mapPlatform("PS4"), "ps4");
  assert.equal(mapPlatform("ps4"), "ps4");
  assert.equal(mapPlatform("Xbox 360"), "xbox360");
  assert.equal(mapPlatform("og xbox"), "xbox");
  assert.equal(mapPlatform("Xbox"), "xbox");
  assert.equal(mapPlatform("Wii U"), "wiiu");
  assert.equal(mapPlatform("Game Boy"), "gb");
  assert.equal(mapPlatform("Game Boy Color"), "gbc");
  assert.equal(mapPlatform("Mega Drive"), "genesis");
  assert.equal(mapPlatform("3DS"), "3ds");
  assert.equal(mapPlatform("Arcade"), "arcade");
});

test("mapPlatform understands the loose labels used in awesome-decomp-games", () => {
  assert.equal(mapPlatform("ps"), "ps1");
  assert.equal(mapPlatform("PlayStation"), "ps1");
  assert.equal(mapPlatform("PlayStation 2"), "ps2");
  assert.equal(mapPlatform("PlayStation 3"), "ps3");
  assert.equal(mapPlatform("PlayStation 4"), "ps4");
  assert.equal(mapPlatform("xbox360"), "xbox360");
  assert.equal(mapPlatform("Xbox360"), "xbox360");
  assert.equal(mapPlatform("og xbox"), "xbox");
  assert.equal(mapPlatform("Nintendo 64"), "n64");
  assert.equal(mapPlatform("GameBoy Color"), "gbc");
  assert.equal(mapPlatform("Game Boy Advance"), "gba");
  assert.equal(mapPlatform("Sega Mega Drive"), "genesis");
});

test("mapPlatform takes the first recognized part of a multi value", () => {
  assert.equal(mapPlatform("N64 / GameCube"), "n64");
  assert.equal(mapPlatform("Master System/Game Gear"), "other");
  assert.equal(mapPlatform("Sega CD/32X"), "other");
});

test("mapPlatform falls back to other", () => {
  assert.equal(mapPlatform("ZX Spectrum"), "other");
  assert.equal(mapPlatform("PS Vita"), "other");
  assert.equal(mapPlatform("Others"), "other");
  assert.equal(mapPlatform(""), "other");
  assert.equal(mapPlatform(undefined), "other");
});

const good = {
  repo: "owner/game",
  release: "1.0.0",
  type: "decompilation",
  platform: "PS4",
  archived: false,
  old: false,
  inactive: false,
  browser_playable: false,
  ai_flag: false,
  ratings: { playability: 4 },
};

test("isCandidate accepts an entry that meets every rule", () => {
  assert.equal(isCandidate(good), true);
  assert.equal(isCandidate({ ...good, type: "source-port", platform: "Switch" }), true);
});

test("isCandidate rejects each excluded case", () => {
  assert.equal(isCandidate({ ...good, repo: undefined }), false);
  assert.equal(isCandidate({ ...good, release: null }), false);
  assert.equal(isCandidate({ ...good, type: "tool" }), false);
  assert.equal(isCandidate({ ...good, type: "disassembly" }), false);
  for (const flag of ["archived", "old", "inactive", "browser_playable"]) {
    assert.equal(isCandidate({ ...good, [flag]: true }), false, flag);
  }
  assert.equal(isCandidate({ ...good, ratings: { playability: 2 } }), false);
  assert.equal(isCandidate({ ...good, ratings: undefined }), false);
});

test("statusFromPlayability", () => {
  assert.equal(statusFromPlayability(5), "playable");
  assert.equal(statusFromPlayability(4), "partial");
  assert.equal(statusFromPlayability(3), "experimental");
});

test("generalizeAssetName turns versions into digit runs and anchors the regex", () => {
  const pattern = new RegExp(generalizeAssetName("gow3-windows-v2.1.7.zip"), "i");
  assert.equal(pattern.test("gow3-windows-v2.1.7.zip"), true);
  assert.equal(pattern.test("gow3-windows-v2.10.0.zip"), true);
  assert.equal(pattern.test("gow3-linux-v2.1.7.zip"), false);
  assert.equal(pattern.test("xgow3-windows-v2.1.7.zip"), false);
  assert.equal(pattern.test("gow3-windows-v2.1.7.zip.bak"), false);
});

test("generalizeAssetName escapes regex specials", () => {
  const pattern = new RegExp(generalizeAssetName("a+b (1).zip"), "i");
  assert.equal(pattern.test("a+b (7).zip"), true);
  assert.equal(pattern.test("aab (7).zip"), false);
});

const names = (...list) => list.map((name) => ({ name }));

test("pickAssets picks a windows zip and ignores checksums, debug and source files", () => {
  const picked = pickAssets(
    names("Game-win64-1.2.3.zip", "Game-win64-1.2.3.zip.sha256", "Game-win64-debug-symbols.zip", "Game-source-code.zip", "Game-linux-1.2.3.tar.gz"),
  );
  assert.equal(picked.win32.pattern, generalizeAssetName("Game-win64-1.2.3.zip"));
  assert.equal(picked.win32.executable, null);
  assert.equal(picked.linux.pattern, generalizeAssetName("Game-linux-1.2.3.tar.gz"));
  assert.equal(picked.darwin, undefined);
});

test("pickAssets does not treat a linux or arm64 zip as windows", () => {
  const picked = pickAssets(names("Game-linux-x64.zip", "Game-macos-arm64.zip"));
  assert.equal(picked.win32, undefined);
  assert.equal(picked.linux.pattern, generalizeAssetName("Game-linux-x64.zip"));
  assert.equal(picked.darwin.pattern, generalizeAssetName("Game-macos-arm64.zip"));
});

test("pickAssets prefers an AppImage on linux", () => {
  const picked = pickAssets(names("gow3-x86_64.AppImage", "gow3-linux.tar.gz"));
  assert.equal(picked.linux.pattern, generalizeAssetName("gow3-x86_64.AppImage"));
});

test("pickAssets falls back to a bare non-installer exe, but not a setup", () => {
  assert.equal(pickAssets(names("Game-Setup.exe")).win32, undefined);
  assert.equal(pickAssets(names("Game.exe")).win32.pattern, "^Game\\.exe$");
});

test("pickAssets treats a single unhinted zip as windows and ignores a lone .sha256 check", () => {
  assert.equal(pickAssets(names("MyGame.zip")).win32.pattern, "^MyGame\\.zip$");
  assert.equal(pickAssets(names("MyGame.zip", "MyGame.zip.sha256")).win32.pattern, "^MyGame\\.zip$");
});

test("pickAssets prefers x86-64 builds over ARM and 32-bit ones", () => {
  const picked = pickAssets(
    names("Game-1.0-linux-aarch64.AppImage", "Game-1.0-linux-x86_64.AppImage", "Game-Linux-ARM64.tar.gz", "pd-i686-windows.zip", "pd-x86_64-windows.zip"),
  );
  assert.equal(picked.linux.pattern, generalizeAssetName("Game-1.0-linux-x86_64.AppImage"));
  assert.equal(picked.win32.pattern, generalizeAssetName("pd-x86_64-windows.zip"));
  assert.equal(pickAssets(names("Game-Linux-ARM64.zip")).linux.pattern, generalizeAssetName("Game-Linux-ARM64.zip"));
});

test("pickAssets never takes a Flatpak or AppImage bundle as the windows build", () => {
  const picked = pickAssets(
    names("Game-Flatpak-X64-Release.zip", "Game-AppImage-X64-Release.zip", "Game-Linux-X64-Release.zip", "Game-Windows-RelWithDebInfo.zip"),
  );
  assert.equal(picked.win32.pattern, generalizeAssetName("Game-Windows-RelWithDebInfo.zip"));
  assert.equal(picked.linux.pattern, generalizeAssetName("Game-Linux-X64-Release.zip"));
});

test("pickAssets skips SDKs, servers, editors and add-ons", () => {
  assert.deepEqual(pickAssets(names("sprite-editor-windows-x64.zip", "sprite-editor-linux-x64.tar.gz")), {});
  assert.equal(
    pickAssets(names("rexglue-sdk-0.9.1-win-amd64.zip", "rexglue-sdk-0.9.1-linux-amd64.zip", "SCIV-Recomp.zip")).win32.pattern,
    "^SCIV-Recomp\\.zip$",
  );
  assert.equal(
    pickAssets(names("Road-0.2.3-Windows-x64-DLSS-XeSS-addon.zip", "Road-0.2.3-Windows-x64.zip")).win32.pattern,
    generalizeAssetName("Road-0.2.3-Windows-x64.zip"),
  );
});

test("pickAssets prefers the plain build over a variant", () => {
  const picked = pickAssets(names("Game-Windows-x64-NoAVX2.zip", "Game-Windows-x64.zip", "Game-widescreen-Linux-x64.tar.gz", "Game-Linux-x64.tar.gz"));
  assert.equal(picked.win32.pattern, generalizeAssetName("Game-Windows-x64.zip"));
  assert.equal(picked.linux.pattern, generalizeAssetName("Game-Linux-x64.tar.gz"));
});

test("pickAssets treats the only unhinted zip next to other OS builds as windows", () => {
  const picked = pickAssets(names("Game-linux-x64-0.7.1.zip", "Game-v0.7.1.zip"));
  assert.equal(picked.win32.pattern, generalizeAssetName("Game-v0.7.1.zip"));
  assert.equal(pickAssets(names("Game1.zip", "Game2.zip")).win32, undefined);
});

test("pickAssets prefers an arm64 APK over x86 and armv7 ones", () => {
  const picked = pickAssets(names("app-x86_64-release.apk", "app-armeabi-v7a-release.apk", "app-arm64-v8a-release.apk"));
  assert.equal(picked.android.pattern, generalizeAssetName("app-arm64-v8a-release.apk"));
  assert.equal(picked.android.executable, null);
  assert.equal(pickAssets(names("game-aarch64.apk", "game-universal.apk")).android.pattern, generalizeAssetName("game-aarch64.apk"));
});

test("pickAssets picks a universal APK over a bare one, and a bare one over x86-only", () => {
  assert.equal(pickAssets(names("game.apk", "game-universal.apk")).android.pattern, generalizeAssetName("game-universal.apk"));
  assert.equal(pickAssets(names("game.apk", "game-x86_64.apk")).android.pattern, generalizeAssetName("game.apk"));
});

test("pickAssets skips debug APKs when a release APK exists", () => {
  assert.equal(
    pickAssets(names("game-arm64-v8a-debug.apk", "game-arm64-v8a-release.apk")).android.pattern,
    generalizeAssetName("game-arm64-v8a-release.apk"),
  );
  assert.equal(
    pickAssets(names("game-universal-debug.apk", "game-universal-release.apk")).android.pattern,
    generalizeAssetName("game-universal-release.apk"),
  );
  assert.equal(pickAssets(names("game-debug.apk")).android.pattern, generalizeAssetName("game-debug.apk"));
});

test("pickAssets never picks an APK for win32, linux or darwin", () => {
  const picked = pickAssets(
    names("game-arm64-v8a-release.apk", "game-universal.apk", "Game-Windows-x64.zip", "Game-Linux-x64.tar.gz", "Game-macOS.zip"),
  );
  assert.equal(picked.win32.pattern, generalizeAssetName("Game-Windows-x64.zip"));
  assert.equal(picked.linux.pattern, generalizeAssetName("Game-Linux-x64.tar.gz"));
  assert.equal(picked.darwin.pattern, generalizeAssetName("Game-macOS.zip"));
  assert.equal(picked.android.pattern, generalizeAssetName("game-arm64-v8a-release.apk"));
  assert.deepEqual(pickAssets(names("game-arm64-v8a-release.apk")).win32, undefined);
  assert.deepEqual(pickAssets(names("game-arm64-v8a-release.apk")).linux, undefined);
  assert.deepEqual(pickAssets(names("game-arm64-v8a-release.apk")).darwin, undefined);
});

test("pickAssets keeps a release that has only an APK, and yields only android", () => {
  assert.deepEqual(pickAssets(names("game-release.apk")), {
    android: { pattern: generalizeAssetName("game-release.apk"), executable: null },
  });
  assert.deepEqual(pickAssets(names("game-x86.apk", "game-armv7.apk")), {});
});

test("pickAssets returns nothing when no asset is usable", () => {
  assert.deepEqual(pickAssets(names("notes.txt", "Game.dmg")), {});
  assert.deepEqual(pickAssets([]), {});
  assert.deepEqual(pickAssets(undefined), {});
});

test("cleanTitleForSearch drops parentheses and scene words", () => {
  assert.equal(cleanTitleForSearch("Forza Horizon (Pinyon Shift)"), "Forza Horizon");
  assert.equal(cleanTitleForSearch("Bloodborne PC Port"), "Bloodborne");
  assert.equal(cleanTitleForSearch("The Legend of Zelda: Ocarina of Time (Ship of Harkinian)"), "The Legend of Zelda: Ocarina of Time");
  assert.equal(cleanTitleForSearch("God   of  War III  Remastered"), "God of War III Remastered");
  assert.equal(cleanTitleForSearch("Ocarina Recompiled Decomp"), "Ocarina");
  assert.equal(cleanTitleForSearch("Portal"), "Portal");
});

test("mergeCatalogue keeps curated over auto by repo, case-insensitively", () => {
  const curated = [{ id: "gow3", repo: "FelipePrado0/gow3_pc", source: "curated" }];
  const auto = [
    { id: "gow3-auto", repo: "felipeprado0/GOW3_PC", source: "auto" },
    { id: "other", repo: "a/b", source: "auto" },
  ];
  const merged = mergeCatalogue(curated, auto);
  assert.deepEqual(merged.map((p) => p.id), ["gow3", "other"]);
  assert.equal(merged[0].source, "curated");
});

test("mergeCatalogue sorts by id and suffixes colliding ids", () => {
  const curated = [{ id: "zelda", repo: "c/z", source: "curated" }];
  const auto = [
    { id: "alpha", repo: "d/a", source: "auto" },
    { id: "zelda", repo: "e/z", source: "auto" },
    { id: "zelda", repo: "f/z", source: "auto" },
  ];
  const merged = mergeCatalogue(curated, auto);
  assert.deepEqual(merged.map((p) => [p.id, p.repo]), [
    ["alpha", "d/a"],
    ["zelda", "c/z"],
    ["zelda-2", "e/z"],
    ["zelda-3", "f/z"],
  ]);
});

test("isCandidate keeps AI-flagged and non-console entries (they are gated later, not here)", () => {
  assert.equal(isCandidate({ ...good, ai_flag: true }), true);
  for (const platform of ["PC", "DOS", "Mobile", "Android / iOS", "", undefined]) {
    assert.equal(isCandidate({ ...good, platform }), true, `platform ${platform}`);
  }
});

test("aiFlagField tags AI-flagged ADG entries and omits the key otherwise", () => {
  assert.deepEqual(aiFlagField({ ai_flag: true }), { aiFlag: true });
  assert.deepEqual(aiFlagField({ ai_flag: false }), {});
  assert.deepEqual(aiFlagField({}), {});
  assert.deepEqual(aiFlagField(undefined), {});
});

test("classifyAdgPlatform keeps console labels ungated", () => {
  assert.deepEqual(classifyAdgPlatform("N64"), { platform: "n64", gated: false });
  assert.deepEqual(classifyAdgPlatform("N64 / GameCube"), { platform: "n64", gated: false });
  assert.deepEqual(classifyAdgPlatform("Xbox 360"), { platform: "xbox360", gated: false });
  assert.deepEqual(classifyAdgPlatform("Virtual Boy"), { platform: "other", gated: false });
  assert.deepEqual(classifyAdgPlatform("Sega CD/32X"), { platform: "other", gated: false });
});

test("classifyAdgPlatform gates PC and DOS (platform pc) and Mobile, Android / iOS and blank (platform other)", () => {
  for (const label of ["PC", "DOS"]) {
    assert.deepEqual(classifyAdgPlatform(label), { platform: "pc", gated: true }, label);
  }
  for (const label of ["Mobile", "Android / iOS", "", undefined]) {
    assert.deepEqual(classifyAdgPlatform(label), { platform: "other", gated: true }, String(label));
  }
});

test("classifyAdgPlatform keeps every other non-console label as today: platform other, not gated", () => {
  for (const label of ["Mac", "Others", "Other", "Amiga", "Commodore 64/8-bit", "unknown", "Apple II", "PC-98", "Browser", "MS-DOS"]) {
    assert.deepEqual(classifyAdgPlatform(label), { platform: "other", gated: false }, label);
  }
});

test("adgAssetsFor skips non-console entries without an APK and keeps only the APK for those with one", () => {
  const gated = classifyAdgPlatform("PC");
  const desktopOnly = pickAssets([{ name: "Game-Windows-x64.zip" }, { name: "Game-Linux-x64.tar.gz" }]);
  assert.equal(adgAssetsFor(gated, desktopOnly), null);
  const withApk = pickAssets([{ name: "Game-Windows-x64.zip" }, { name: "game-arm64-v8a-release.apk" }]);
  assert.deepEqual(Object.keys(adgAssetsFor(gated, withApk)), ["android"]);
  assert.deepEqual(adgAssetsFor(gated, withApk).android, withApk.android);
});

test("adgAssetsFor keeps desktop assets of console entries and skips entries with none", () => {
  const console = classifyAdgPlatform("PS1");
  const picked = pickAssets([{ name: "Game-Windows-x64.zip" }]);
  assert.deepEqual(adgAssetsFor(console, picked), picked);
  assert.equal(adgAssetsFor(console, {}), null);
});

test("slugify makes lowercase slugs of at most 64 characters", () => {
  assert.equal(slugify("Ocarina of Time: 3D!"), "ocarina-of-time-3d");
  assert.equal(slugify(""), "");
  assert.equal(slugify("a".repeat(80)).length, 64);
});
