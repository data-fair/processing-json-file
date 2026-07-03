import { describe, it } from 'node:test'
import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { detectDelimiter, parseCSV, checkConsistentDelimiters } from '../lib/parseCsv.ts'

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

describe('parseCSV', () => {
  it('parses a comma-separated file into row objects', () => {
    const { delimiter, rows } = parseCSV('name,age\nAlice,30\nBob,25')
    assert.equal(delimiter, ',')
    assert.deepEqual(rows, [{ name: 'Alice', age: '30' }, { name: 'Bob', age: '25' }])
  })

  it('parses a semicolon-separated file, respecting quoted values containing commas', () => {
    const { delimiter, rows } = parseCSV('name;bio\n"Doe, John";"Loves CSV, really"')
    assert.equal(delimiter, ';')
    assert.deepEqual(rows, [{ name: 'Doe, John', bio: 'Loves CSV, really' }])
  })

  it('parses a real CSV file from disk, including its trailing newline', () => {
    const content = fs.readFileSync(exampleCsvPath, 'utf8')
    const { delimiter, rows } = parseCSV(content)
    assert.equal(delimiter, ',')
    assert.deepEqual(rows, [
      { name: 'Alice', age: '30', city: 'Paris' },
      { name: 'Bob', age: '25', city: 'Lyon' }
    ])
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
