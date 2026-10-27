# Ports catalogue

An open list of unofficial native PC ports of console games. Hydra's Ports tab reads it, and any other launcher may too.

This repository contains **no game data**. Each entry links to a port's own GitHub project. Every port needs your own legal copy of the game.

## How the file is made

`ports-catalogue.json` is **generated** every day by `.github/workflows/update-catalogue.yml`. Do not edit it by hand; the next run overwrites it.

The Android APK comes from the newest of the 10 latest releases that has one: porters often ship Android and desktop builds in separate releases, so the newest release may not have it.

It is built from these sources, in precedence order (curated first):

- **Curated entries** live in `curated.json` (see below).
- **Automatic entries** come from [awesome-decomp-games](https://github.com/SubmitGame/awesome-decomp-games) (CC0). The script keeps active static recompilations, source ports, decompilations and engine remakes with a playability rating of 3 or more. For each one it reads the latest GitHub release and derives the download pattern for each OS. Entries have `"source": "auto"`, `"tested": false` and a `null` executable, so the client finds the executable itself. Entries flagged by awesome-decomp-games as AI-generated are kept with `"aiFlag": true`.
- **GitHub entries** (`github-search`, `github-fork`, `github-author`) are Android ports found by GitHub search: repos whose name, description or topics mention a recompilation or port, with an Android APK in the latest release, pushed within 12 months and not archived. Android forks of catalogued ports and other repos of the same authors are added too. They carry only the `android` asset.
- Non-console games (PC, DOS, Mac, mobile, unknown) are kept only when they have an Android APK. Their platform is `pc` for original computer games and `other` for everything else. Their desktop assets are dropped, so the desktop list does not change for them.
- **Curated entries** live in `curated.json`. They are reviewed by hand and carry the details the automatic entries lack: `tested`, requirements, setup hints and game notes. A curated entry replaces an automatic entry with the same GitHub repo, and any source's entry is replaced by a higher-precedence one with the same repo.

Cover and hero images come from [SteamGridDB](https://www.steamgriddb.com/) when the repository has the `STEAMGRIDDB_API_KEY` secret. Results are cached in `covers.json`. `stats` (stars, last push) are refreshed daily from the GitHub API.

## Format

`ports-catalogue.json` follows `ports-catalogue.schema.json`. `curated.json` uses the same entry shape without `updatedAt`. Each entry in `ports` has:

- `id`: stable slug, unique.
- `title`, `platform` (a console, `pc` or `other`), `repo` (`owner/name`), `authors`.
- `source`: `curated`, `auto`, `github-search`, `github-fork` or `github-author`.
- `aiFlag`: `true` when awesome-decomp-games marks the project as AI-generated. Absent otherwise.
- `description`, `requirements`, `setupHint`, `game.notes`: objects keyed by locale. `en` is required; `pt-BR` is optional.
- `status` (`playable`, `partial`, `experimental`), `tested` (maintainer verified it end to end), `channel` (`latest` or `prerelease`).
- `assets`: per OS (`win32`, `linux`, `darwin`, and `android` for an APK, detected automatically), a `pattern` regex for the release asset name and an `executable` inside it. `executable` may be `null`, which means "detect it after extraction".
- `game`: `format` (`folder`, `iso`, `folder-or-iso`), `requiredFiles`, optional `titleIds`.
- `stats`: stars and last push date, or `null`.

## Adding or curating a port

1. Edit `curated.json` and add an entry with `"source": "curated"`. To correct an automatic entry, add a curated entry with the same `repo`; it replaces the automatic one.
2. Set `"tested": false` unless you have run the port end to end.
3. Run `node scripts/validate.mjs curated.json`. It must pass.
4. Open a pull request.

## Scripts

| Script | What it does |
|---|---|
| `scripts/import-adg.mjs` | Builds `ports-catalogue.json` from awesome-decomp-games and `curated.json`. |
| `scripts/import-github.mjs` | Adds the GitHub entries (search, forks of catalogued ports, other repos of their authors) to `ports-catalogue.json`. Needs `GITHUB_TOKEN`. |
| `scripts/fetch-covers.mjs` | Fills cover and hero URLs from SteamGridDB. Does nothing without `STEAMGRIDDB_API_KEY`. |
| `scripts/refresh-stats.mjs` | Refreshes `stats` from the GitHub API. |
| `scripts/validate.mjs` | Checks both JSON files. Pass a path to check one file. |
| `scripts/lib/heuristics.mjs` | Pure helpers (platform map, candidate rules, asset patterns, merge). Tested in `scripts/lib/heuristics.test.mjs`. |
| `scripts/lib/github-sources.mjs` | Pure helpers for the GitHub sources (accept and deny rules, release pick, titles, platform tokens). Tested in `scripts/lib/github-sources.test.mjs`. |

To run the daily steps yourself:

```sh
GITHUB_TOKEN=... node scripts/import-adg.mjs
GITHUB_TOKEN=... node scripts/import-github.mjs
STEAMGRIDDB_API_KEY=... node scripts/fetch-covers.mjs
GITHUB_TOKEN=... node scripts/refresh-stats.mjs
node scripts/validate.mjs
node --test scripts/lib/*.test.mjs
```

## License

The list is released under the MIT license (see `LICENSE`). Each port keeps its own license. Automatic entries come from awesome-decomp-games, which is released under CC0.
