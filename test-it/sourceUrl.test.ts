import { describe, it } from 'node:test'
import assert from 'assert'
import { stripQuery, sourceExtension, sourceBase, sourceDir } from '../lib/sourceUrl.ts'

// URL with an Azure SAS token, the case that used to break extension detection
const sasUrl = 'https://account.blob.core.windows.net/opendata/CONSO/conso-mensuel-ci-nat.zip?sp=r&st=2026-08-17T12:58:13Z&sig=zFqF%2BQ2c'

describe('stripQuery', () => {
  it('leaves a plain URL untouched', () => {
    assert.equal(stripQuery('sftp://host/folder/file.csv'), 'sftp://host/folder/file.csv')
  })

  it('drops the query string', () => {
    assert.equal(stripQuery(sasUrl), 'https://account.blob.core.windows.net/opendata/CONSO/conso-mensuel-ci-nat.zip')
  })

  it('drops the fragment', () => {
    assert.equal(stripQuery('https://host/file.csv#part'), 'https://host/file.csv')
  })
})

describe('sourceExtension', () => {
  it('detects the extension of a plain file URL', () => {
    assert.equal(sourceExtension('sftp://host/folder/file.csv'), '.csv')
  })

  it('detects the extension despite a query string', () => {
    assert.equal(sourceExtension(sasUrl), '.zip')
  })

  it('lowercases the extension', () => {
    assert.equal(sourceExtension('https://host/FILE.JSON'), '.json')
  })

  it('returns an empty extension for a folder URL', () => {
    assert.equal(sourceExtension('sftp://host/folder/'), '')
  })

  it('decodes a percent-encoded file name', () => {
    assert.equal(sourceExtension('https://host/mon%20fichier.csv'), '.csv')
  })
})

describe('sourceBase', () => {
  it('returns the file name without the query string', () => {
    assert.equal(sourceBase(sasUrl), 'conso-mensuel-ci-nat.zip')
  })

  it('returns the folder name for a URL ending with a slash', () => {
    assert.equal(sourceBase('sftp://host/parent/folder/'), 'folder')
  })

  it('decodes a percent-encoded file name', () => {
    assert.equal(sourceBase('https://host/mon%20fichier.csv'), 'mon fichier.csv')
  })
})

describe('sourceDir', () => {
  it('returns the parent URL of a file', () => {
    assert.equal(sourceDir('sftp://host/parent/file.csv'), 'sftp://host/parent')
  })

  it('returns the parent URL of a folder', () => {
    assert.equal(sourceDir('sftp://host/parent/folder/'), 'sftp://host/parent')
  })

  it('ignores the query string', () => {
    assert.equal(sourceDir(sasUrl), 'https://account.blob.core.windows.net/opendata/CONSO')
  })
})
