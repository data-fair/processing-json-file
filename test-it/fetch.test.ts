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

  it('uses the configured absolute archive folder when provided', () => {
    assert.equal(computeBackupPath('/foo/file.json', '/archives/ds1'), '/archives/ds1/file.json')
  })

  it('accepts a full URL as the archive folder', () => {
    assert.equal(computeBackupPath('/foo/file.json', 'sftp://host/archives/ds1/'), '/archives/ds1/file.json')
  })

  it('falls back to the relative backup folder when the archive path is blank', () => {
    assert.equal(computeBackupPath('/foo/file.json', '   '), '/foo/backup/file.json')
  })
})
