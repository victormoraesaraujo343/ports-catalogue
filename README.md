# Ports catalogue

An open list of unofficial native PC ports of console games. Hydra's Ports tab reads it, and any other launcher may too.

This repository contains **no game data**. Each entry links to a port's own GitHub project. Every port needs your own legal copy of the game.

## Format

`ports-catalogue.json` follows `ports-catalogue.schema.json`. Each entry in `ports` has:

- `id`: stable slug, unique.
- `title`, `platform`, `repo` (`owner/name`), `authors`.
- `description`, `requirements`, `setupHint`, `game.notes`: objects keyed by locale. `en` is required; `pt-BR` is optional.
- `status` (`playable`, `partial`, `experimental`), `tested` (maintainer verified it end to end), `channel` (`latest` or `prerelease`).
- `assets`: per OS (`win32`, `linux`, `darwin`), a `pattern` regex for the release asset name and the `executable` inside it.
- `game`: `format` (`folder`, `iso`, `folder-or-iso`), `requiredFiles`, optional `titleIds`.
- `stats`: stars and last push date. Filled by a daily job, do not edit by hand.

## Adding a port

1. Add an entry to `ports` in `ports-catalogue.json`. Use `"tested": false` unless you have run it end to end.
2. Run `node scripts/validate.mjs`. It must pass.
3. Open a pull request.

## Stats

`.github/workflows/refresh-stats.yml` runs every day. It validates the file, then refreshes `stats` from the GitHub API. To run it yourself:

```sh
GITHUB_TOKEN=... node scripts/refresh-stats.mjs
```

## License

The list is released under the MIT license (see `LICENSE`). Each port keeps its own license.
