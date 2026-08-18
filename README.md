# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/public/assets/logo.svg" width="30"> @data-fair/processing-json-file

A plugin that creates and updates a data-fair dataset from one or more remote JSON or CSV files.

## Features

- **Multiple protocols** — download source files over HTTP(S), SFTP or FTP.
- **JSON or CSV** — pick the source format; a JSON file (or folder of files) is flattened through a configurable path mapping, while a CSV file is loaded as-is (its columns become the dataset's columns).
- **Single file, whole folder or zip archive** — point at a file matching the chosen format, at a folder (URL ending with `/`), or at a `.zip`; every matching file found is downloaded and concatenated.
- **Query strings preserved** — an access token carried by the URL (an Azure SAS token for instance) is kept for the download and ignored everywhere the path matters (extension detection, file name, `origin` of the dataset).
- **Reused SFTP connection** — a single SFTP connection is opened for the whole batch (listing, downloads and deletions) instead of reconnecting per file.
- **Create or update** — create a new file dataset, or update an existing dataset, editable or file.
- **Post-import source action** — for FTP/SFTP sources, optionally delete each source file on the remote after a successful import, or move it to a `backup` folder instead.

## Dataset modes

| Mode | Behaviour |
| ---- | --------- |
| `create` | Creates a **file dataset**: the imported data is uploaded as a single file and data-fair detects the columns and their types by itself. Once created, the processing switches itself to `update` on that dataset (via `patchConfig`), so the following runs update it instead of creating a new one. |
| `update` | Updates an existing dataset. The dataset type decides how: an **editable** dataset (`isRest`) is filled with `_bulk_lines` (honouring the `drop` option), a **file** dataset has its file replaced. |

Configurations saved before dataset modes existed have no `datasetMode`; they are read as `update`, which is exactly what they used to do. Nothing changes for them at run time — the mode only has to be confirmed the next time their form is saved.

Note on editable datasets: data-fair never creates a column during a `_bulk_lines` load. A CSV column missing from the dataset schema makes it reject the whole request with `400 Colonnes inconnues`, so the processing warns beforehand, listing each missing column with the key data-fair expects for it.

## Zip archives

A `.zip` **the URL points at** is decompressed and every file of the chosen format it contains — including in its sub-folders — is imported and concatenated. The archive tree is preserved during extraction (no `unzip -j`), so two same-named files living in different folders of the archive do not overwrite each other. `__MACOSX` entries and `._*` resource forks are ignored.

Archives sitting **inside an imported folder are ignored**, on purpose. Picking them up would silently change what an existing processing imports, and would delete or move — through `sourceAction` — archives that used to be left untouched on the remote. Importing a folder of archives is a separate feature, to be added explicitly if the need shows up.

The post-import source action applies to the archive itself, not to the files it contains.

## Configuration

| Field | Description |
| ----- | ----------- |
| `datasetMode` | `create` (create a file dataset) or `update` (update an existing dataset). Defaults to `update` for configurations predating this field. |
| `dataset` | In `update` mode, the target dataset. In `create` mode, only an optional `title` (the source file name is used when left empty). |
| `url` | URL of the source. Must start with `http://`, `https://`, `ftp://`, `ftps://` or `sftp://`. A path ending with `.json`/`.csv` (depending on the chosen format) targets a single file, a path ending with `.zip` targets an archive, and a path ending with `/` targets every matching file of the folder. A query string is kept for the download only. |
| `username` / `password` | Optional credentials for the remote (HTTP basic auth, SFTP or FTP). |
| `drop` | Whether to drop the existing lines before loading. Only meaningful for an editable dataset — a file dataset has its content replaced anyway. |
| `sourceAction` | What to do with each source file on the remote after a successful import (only shown for FTP/SFTP URLs): `none` (default, leave the files untouched), `delete` (remove each imported file from the remote), or `move` (move each imported file to the archive folder). Old configs using the `processAndDelete` / `processAndMove` booleans are still honoured. |
| `backupDir` | Absolute path of the archive folder used by `sourceAction: move` (created if missing; a same-named file already there is overwritten). Left empty, files fall back to a `backup` folder next to the file, or inside the imported folder. |
| `format` | `json` (default) or `csv`. JSON files go through the path mapping below; CSV files are loaded as-is, with their delimiter auto-detected (all CSV files of a run must share the same delimiter and the same header). |

## Not supported yet

Kept out on purpose, to be addressed when this plugin and `processing-transfer-file` are reconciled: source file encoding (the concatenation reads UTF-8), ignoring the first N lines, overriding the uploaded file name, ciphered secrets for the credentials, folder listing over plain FTP (SFTP only), and streaming instead of building the payload in memory.

## Release

Publishing is handled automatically by CI: the plugin is pushed to the data-fair registry (`@data-fair/registry`), not to the public npm registry — there is no manual `npm publish`. A push to `main`/`master` publishes to the staging registry; pushing a `v*` tag publishes to production:

```bash
npm version minor       # version bump + v* tag
git push --follow-tags  # CI publishes to the production registry
```

The registry artefact id is `<package name with / replaced by ->-<major version>`, so a major version bump publishes a *separate* artefact that existing processings do not follow. The title and description shown in the processings UI belong to the registry artefact, not to `package.json`, and are edited there.
