import path from 'path'

// The source URL may carry a query string — an Azure SAS token for instance:
// https://host/container/file.zip?sp=r&st=...&sig=...
// It has to be kept as-is for the download itself, but must be ignored when
// looking at the path, otherwise the extension detection sees ".zip?sp=r&st=..."
// and the file name detection sees "file.zip?sp=r&st=...".
export const stripQuery = (rawUrl: string): string => rawUrl.split('#')[0].split('?')[0]

// Decoded path part of the source URL, without protocol-level noise.
const sourcePath = (rawUrl: string): string => decodeURIComponent(stripQuery(rawUrl))

// Lowercased extension of the source, ".zip" / ".csv" / ".json", or "" for a
// folder URL (ending with a slash) and for an extension-less path.
export const sourceExtension = (rawUrl: string): string => path.posix.extname(sourcePath(rawUrl)).toLowerCase()

// Name of the targeted file, or of the targeted folder for a URL ending with a slash.
export const sourceBase = (rawUrl: string): string => path.posix.basename(sourcePath(rawUrl))

// URL of the parent folder, used to rebuild the URL of each file of an imported
// folder. Decoded like sourceBase, `new URL()` re-encodes it when downloading.
export const sourceDir = (rawUrl: string): string => path.posix.dirname(sourcePath(rawUrl))
