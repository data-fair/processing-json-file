# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/public/assets/logo.svg" width="30"> @data-fair/processing-json-file

A plugin that creates and updates a data-fair dataset from one or more remote JSON or CSV files.

## Features

- **Multiple protocols** — download source files over HTTP(S), SFTP or FTP.
- **JSON or CSV** — pick the source format; a JSON file (or folder of files) is flattened through a configurable path mapping, while a CSV file is loaded as-is (its columns become the dataset's columns).
- **Single file or whole folder** — point at a file matching the chosen format or at a folder (URL ending with `/`); every matching file in the folder is downloaded and concatenated.
- **Reused SFTP connection** — a single SFTP connection is opened for the whole batch (listing, downloads and deletions) instead of reconnecting per file.
- **Convert and load** — each file is converted according to the configuration and pushed to the target dataset with `_bulk_lines`.
- **Process and delete** — optionally delete each source file on the remote after a successful import, or move it to a `backup` folder instead (FTP/SFTP only).

## Configuration

| Field | Description |
| ----- | ----------- |
| `dataset` | The target data-fair dataset to fill. |
| `url` | URL of the source. A path ending with `.json`/`.csv` (depending on the chosen format) targets a single file; a path ending with `/` targets every matching file of the folder. |
| `username` / `password` | Optional credentials for the remote (HTTP basic auth, SFTP or FTP). |
| `drop` | Whether to drop the existing lines before loading. |
| `processAndDelete` | Delete each source file on the remote once it has been imported (FTP/SFTP only). |
| `processAndMove` | Move each source file to a `backup` folder after import instead of deleting it — next to the file for a single-file URL, or inside the imported folder for a folder URL. Independent checkbox; takes precedence over `processAndDelete` when both are set (FTP/SFTP only). |
| `format` | `json` (default) or `csv`. JSON files go through the path mapping below; CSV files are loaded as-is, with their delimiter auto-detected (all CSV files of a run must share the same delimiter). |

## Release

Publishing is handled automatically by CI: the plugin is pushed to the data-fair registry (`@data-fair/registry`), not to the public npm registry — there is no manual `npm publish`. A push to `main`/`master` publishes to the staging registry; pushing a `v*` tag publishes to production:

```bash
npm version minor       # version bump + v* tag
git push --follow-tags  # CI publishes to the production registry
```
