import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanTitleForSearch,
  generalizeAssetName,
  isCandidate,
  mapPlatform,
  mergeCatalogue,
  pickAssets,
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

test("mapPlatform falls back to other", () => {
  assert.equal(mapPlatform("ZX Spectrum"), "other");
  assert.equal(mapPlatform("N64 / GameCube"), "other");
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
  for (const platform of ["PC", "pc", "DOS", "Mobile", "", undefined]) {
    assert.equal(isCandidate({ ...good, platform }), false, `platform ${platform}`);
  }
  for (const flag of ["archived", "old", "inactive", "browser_playable", "ai_flag"]) {
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
