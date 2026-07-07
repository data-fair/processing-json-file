import { describe, it } from 'node:test'
import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { detectDelimiter, splitCsvContent, checkConsistentDelimiters, checkConsistentHeaders } from '../lib/parseCsv.ts'

const exampleCsvPath = fileURLToPath(new URL('./resources/example.csv', import.meta.url))

describe('detectDelimiter', () => {
  it('detects a comma-separated header', () => {
    assert.equal(detectDelimiter('name,age,city'), ',')
  })

  it('detects a semicolon-separated header', () => {
    assert.equal(detectDelimiter('name;age;city'), ';')
  })

  it('detects a tab-separated header', () => {
    assert.equal(detectDelimiter('name\tage\tcity'), '\t')
  })
})

describe('splitCsvContent', () => {
  it('splits a header line from the data rows', () => {
    assert.deepEqual(splitCsvContent('name,age\nAlice,30\nBob,25'), {
      header: 'name,age',
      body: 'Alice,30\nBob,25'
    })
  })

  it('handles CRLF newlines and a leading BOM', () => {
    assert.deepEqual(splitCsvContent('﻿name,age\r\nAlice,30'), {
      header: 'name,age',
      body: 'Alice,30'
    })
  })

  it('returns an empty body for a header-only file', () => {
    assert.deepEqual(splitCsvContent('name,age'), { header: 'name,age', body: '' })
  })

  it('splits a real CSV file from disk, keeping its trailing newline in the body', () => {
    const content = fs.readFileSync(exampleCsvPath, 'utf8')
    const { header, body } = splitCsvContent(content)
    assert.equal(header, 'name,age,city')
    assert.equal(body, 'Alice,30,Paris\nBob,25,Lyon\n')
  })
})

describe('checkConsistentHeaders', () => {
  it('does not throw when every file shares the same header', () => {
    assert.doesNotThrow(() => checkConsistentHeaders([
      { file: 'a.csv', header: 'name,age' },
      { file: 'b.csv', header: 'name,age' }
    ]))
  })

  it('throws a clear error when files have different headers', () => {
    assert.throws(
      () => checkConsistentHeaders([
        { file: 'a.csv', header: 'name,age' },
        { file: 'b.csv', header: 'name,city' }
      ]),
      /a\.csv.*b\.csv/
    )
  })
})

describe('checkConsistentDelimiters', () => {
  it('does not throw when every file uses the same delimiter', () => {
    assert.doesNotThrow(() => checkConsistentDelimiters([
      { file: 'a.csv', delimiter: ',' },
      { file: 'b.csv', delimiter: ',' }
    ]))
  })

  it('throws a clear error when files use different delimiters', () => {
    assert.throws(
      () => checkConsistentDelimiters([
        { file: 'a.csv', delimiter: ',' },
        { file: 'b.csv', delimiter: ';' }
      ]),
      /a\.csv.*,.*b\.csv.*;/
    )
  })
})
