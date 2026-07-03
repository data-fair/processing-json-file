import { describe, it } from 'node:test'
import assert from 'assert'
import { computeBackupPath } from '../lib/fetch.ts'

describe('computeBackupPath', () => {
  it('places the backup folder next to a single downloaded file', () => {
    assert.equal(computeBackupPath('/foo/file.json'), '/foo/backup/file.json')
  })

  it('places the backup folder inside the imported folder', () => {
    assert.equal(computeBackupPath('/foo/bar/file1.json'), '/foo/bar/backup/file1.json')
  })
})
