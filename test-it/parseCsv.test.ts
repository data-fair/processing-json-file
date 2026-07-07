import { describe, it } from 'node:test'
import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { detectDelimiter, splitCsvContent, checkCsvConsistency } from '../lib/parseCsv.ts'

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

describe('checkCsvConsistency', () => {
  const reference = { file: 'a.csv', header: 'name,age', delimiter: ',' }

  it('returns null when the candidate matches the reference', () => {
    assert.equal(
      checkCsvConsistency({ file: 'b.csv', header: 'name,age', delimiter: ',' }, reference),
      null
    )
  })

  it('returns a clear delimiter message when delimiters differ', () => {
    const message = checkCsvConsistency({ file: 'b.csv', header: 'name;age', delimiter: ';' }, reference)
    assert.match(String(message), /[Ss]éparateur/)
    assert.match(String(message), /a\.csv.*,.*b\.csv.*;/)
  })

  it('returns a clear header message when only the headers differ', () => {
    const message = checkCsvConsistency({ file: 'b.csv', header: 'name,city', delimiter: ',' }, reference)
    assert.match(String(message), /[Ee]n-tête/)
    assert.match(String(message), /a\.csv.*b\.csv/)
  })
})
