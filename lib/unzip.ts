import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'fs-extra'
import path from 'path'

const execFile = promisify(execFileCb)

// Archives built on macOS carry a __MACOSX folder full of "._name" resource
// forks; they have the right extension but are not data files.
const isJunk = (filePath: string): boolean => {
  const parts = filePath.split(path.sep)
  return parts.includes('__MACOSX') || path.basename(filePath).startsWith('._')
}

const listFilesRecursive = async (dir: string): Promise<string[]> => {
  const files: string[] = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await listFilesRecursive(full))
    else files.push(full)
  }
  return files
}

// Extract an archive and return the paths of the extracted files matching the
// wanted extension, sorted so a run is reproducible (the concatenation order of
// a folder of CSV files ends up in the dataset).
// The archive tree is preserved on purpose (no `unzip -j`): flattening would
// silently overwrite two same-named files living in different archive folders.
export const extractZip = async (zipFile: string, destDir: string, extension: string): Promise<string[]> => {
  await fs.ensureDir(destDir)
  await execFile('unzip', ['-o', '-q', zipFile, '-d', destDir])
  const files = await listFilesRecursive(destDir)
  return files
    .filter(f => !isJunk(f) && f.toLowerCase().endsWith(extension))
    .sort()
}
