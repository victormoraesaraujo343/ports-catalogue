# Ports catalogue

An open list of unofficial native PC ports of console games. Hydra's Ports tab reads it, and any other launcher may too.

This repository contains **no game data**. Each entry links to a port's own GitHub project. Every port needs your own legal copy of the game.

## How the file is made

`ports-catalogue.json` is **generated** every day by `.github/workflows/update-catalogue.yml`. Do not edit it by hand; the next run overwrites it.

It is built from two sources:

- **Automatic entries** come from [awesome-decomp-games](https://github.com/SubmitGame/awesome-decomp-games) (CC0). The script keeps active static recompilations, source ports, decompilations and engine remakes with a playability rating of 3 or more, for PC-free platforms. For each one it reads the latest GitHub release and derives the download pattern for each OS. Entries have `"source": "auto"`, `"tested": false` and a `null` executable, so the client finds the executable itself.
- **Curated entries** live in `curated.json`. They are reviewed by hand and carry the details the automatic entries lack: `tested`, requirements, setup hints and game notes. A curated entry replaces an automatic entry with the same GitHub repo.

Cover and hero images come from [SteamGridDB](https://www.steamgriddb.com/) when the repository has the `STEAMGRIDDB_API_KEY` secret. Results are cached in `covers.json`. `stats` (stars, last push) are refreshed daily from the GitHub API.

## Format

`ports-catalogue.json` follows `ports-catalogue.schema.json`. `curated.json` uses the same entry shape without `updatedAt`. Each entry in `ports` has:

- `id`: stable slug, unique.
- `title`, `platform`, `repo` (`owner/name`), `authors`.
- `source`: `curated` or `auto`.
- `description`, `requirements`, `setupHint`, `game.notes`: objects keyed by locale. `en` is required; `pt-BR` is optional.
- `status` (`playable`, `partial`, `experimental`), `tested` (maintainer verified it end to end), `channel` (`latest` or `prerelease`).
- `assets`: per OS (`win32`, `linux`, `darwin`), a `pattern` regex for the release asset name and an `executable` inside it. `executable` may be `null`, which means "detect it after extraction".
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
| `scripts/fetch-covers.mjs` | Fills cover and hero URLs from SteamGridDB. Does nothing without `STEAMGRIDDB_API_KEY`. |
| `scripts/refresh-stats.mjs` | Refreshes `stats` from the GitHub API. |
| `scripts/validate.mjs` | Checks both JSON files. Pass a path to check one file. |
| `scripts/lib/heuristics.mjs` | Pure helpers (platform map, candidate rules, asset patterns, merge). Tested in `scripts/lib/heuristics.test.mjs`. |

To run the daily steps yourself:

```sh
GITHUB_TOKEN=... node scripts/import-adg.mjs
STEAMGRIDDB_API_KEY=... node scripts/fetch-covers.mjs
GITHUB_TOKEN=... node scripts/refresh-stats.mjs
node scripts/validate.mjs
node --test scripts/lib/heuristics.test.mjs
```

## License

The list is released under the MIT license (see `LICENSE`). Each port keeps its own license. Automatic entries come from awesome-decomp-games, which is released under CC0.
