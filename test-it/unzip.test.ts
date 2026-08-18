import { describe, it, after } from 'node:test'
import assert from 'assert'
import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import { extractZip } from '../lib/unzip.ts'

const exampleZipPath = fileURLToPath(new URL('./resources/example.zip', import.meta.url))
const tmpDirs: string[] = []

const makeTmpDir = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'json-file-unzip-'))
  tmpDirs.push(dir)
  return dir
}

after(async () => {
  for (const dir of tmpDirs) await fs.remove(dir)
})

describe('extractZip', () => {
  it('returns the extracted files matching the wanted extension', async () => {
    const destDir = await makeTmpDir()
    const files = await extractZip(exampleZipPath, destDir, '.csv')
    assert.deepEqual(files.map(f => path.relative(destDir, f)), ['a.csv', 'sub/b.csv'])
  })

  it('keeps the archive tree instead of flattening it', async () => {
    const destDir = await makeTmpDir()
    await extractZip(exampleZipPath, destDir, '.csv')
    assert.ok(await fs.pathExists(path.join(destDir, 'sub', 'b.csv')))
  })

  it('extracts readable content', async () => {
    const destDir = await makeTmpDir()
    const files = await extractZip(exampleZipPath, destDir, '.csv')
    assert.equal(await fs.readFile(files[0], 'utf8'), 'name,age\nAlice,30\n')
  })

  it('ignores files of other formats', async () => {
    const destDir = await makeTmpDir()
    const files = await extractZip(exampleZipPath, destDir, '.json')
    assert.deepEqual(files, [])
  })
})
