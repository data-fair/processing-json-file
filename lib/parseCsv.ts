import slugify from 'slugify'

const CANDIDATE_DELIMITERS = [',', ';', '\t']

export const detectDelimiter = (headerLine: string): string => {
  let best = CANDIDATE_DELIMITERS[0]
  let bestCount = 0
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const count = headerLine.split(delimiter).length - 1
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return best
}

// Split a CSV file into its first line (header) and the remaining data rows.
// A leading BOM is stripped so it does not end up glued to the first column name.
export const splitCsvContent = (content: string): { header: string, body: string } => {
  const clean = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
  const nlIndex = clean.search(/\r?\n/)
  if (nlIndex === -1) return { header: clean, body: '' }
  return {
    header: clean.slice(0, nlIndex),
    // trailing newlines are dropped: concatenating several files appends
    // '\n' + body, so a body keeping its own final newline would insert a
    // blank line between each pair of files
    body: clean.slice(nlIndex).replace(/^\r?\n/, '').replace(/(\r?\n)+$/, '')
  }
}

export interface CsvSignature { file: string, header: string, delimiter: string }

// Compare a candidate CSV file to the reference file (the first successfully
// parsed file of the folder). Returns a clear, user-facing message when the
// candidate is inconsistent (so the caller can warn and skip just that file),
// or null when it is consistent. Delimiter mismatch is reported before header
// mismatch since a wrong delimiter also makes the header look different.
export const checkCsvConsistency = (candidate: CsvSignature, reference: CsvSignature): string | null => {
  if (candidate.delimiter !== reference.delimiter) {
    return `Séparateurs CSV incohérents entre les fichiers : "${reference.file}" utilise "${reference.delimiter}" alors que "${candidate.file}" utilise "${candidate.delimiter}"`
  }
  if (candidate.header !== reference.header) {
    return `En-têtes CSV incohérents entre les fichiers : "${reference.file}" n'a pas les mêmes colonnes que "${candidate.file}" (les fichiers d'un même dossier doivent partager les mêmes colonnes, dans le même ordre)`
  }
  return null
}

// data-fair turns a CSV header into a dataset column key with
// slug(header, { lower: true, strict: true, replacement: '_' })
// see escapeKey in data-fair api/src/datasets/utils/operations.ts
export const escapeKey = (header: string): string => slugify(header, { lower: true, strict: true, replacement: '_' })

// Columns of a CSV header that match no property of an editable dataset schema.
// Pushing them makes data-fair reject the whole request with "400 Colonnes
// inconnues", so we warn beforehand with the key it expects for each of them.
// The header is split naively on the delimiter: a column name containing the
// delimiter between quotes would be mis-read, which only degrades the warning.
export const missingColumns = (header: string, delimiter: string, schema: { key?: string, 'x-originalName'?: string }[]): { name: string, key: string }[] => {
  return header.split(delimiter)
    .map(name => name.trim().replace(/^"(.*)"$/, '$1'))
    .filter(name => name !== '')
    .map(name => ({ name, key: escapeKey(name) }))
    .filter(({ name, key }) => !schema.some(prop => prop['x-originalName'] === name || prop.key === name || prop.key === key))
}
