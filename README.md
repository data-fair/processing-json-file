# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/public/assets/logo.svg" width="30"> @data-fair/processing-json-file

A plugin that creates and updates a data-fair dataset from one or more remote JSON files.

## Features

- **Multiple protocols** — download source files over HTTP(S), SFTP or FTP.
- **Single file or whole folder** — point at a `.json` file or at a folder (URL ending with `/`); every `.json` file in the folder is downloaded and concatenated.
- **Reused SFTP connection** — a single SFTP connection is opened for the whole batch (listing, downloads and deletions) instead of reconnecting per file.
- **Convert and load** — each file is converted according to the configuration and pushed to the target dataset with `_bulk_lines`.
- **Process and delete** — optionally delete each source file on the remote after a successful import.

## Configuration

| Field | Description |
| ----- | ----------- |
| `dataset` | The target data-fair dataset to fill. |
| `url` | URL of the source. A path ending with `.json` targets a single file; a path ending with `/` targets every `.json` file of the folder. |
| `username` / `password` | Optional credentials for the remote (HTTP basic auth, SFTP or FTP). |
| `drop` | Whether to drop the existing lines before loading. |
| `processAndDelete` | Delete each source file on the remote once it has been imported. |

## Release

Publishing is handled automatically by CI: the plugin is pushed to the data-fair registry (`@data-fair/registry`), not to the public npm registry — there is no manual `npm publish`. A push to `main`/`master` publishes to the staging registry; pushing a `v*` tag publishes to production:

```bash
npm version minor       # version bump + v* tag
git push --follow-tags  # CI publishes to the production registry
```
