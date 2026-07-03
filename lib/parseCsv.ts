import { parse } from 'csv-parse/sync'

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

export const checkConsistentDelimiters = (files: { file: string, delimiter: string }[]): void => {
  const reference = files[0]
  for (const f of files) {
    if (f.delimiter !== reference.delimiter) {
      throw new Error(`Séparateurs CSV incohérents entre les fichiers : "${reference.file}" utilise "${reference.delimiter}" alors que "${f.file}" utilise "${f.delimiter}"`)
    }
  }
}

export const parseCSV = (content: string): { delimiter: string, rows: Record<string, string>[] } => {
  const headerLine = content.split(/\r?\n/, 1)[0]
  const delimiter = detectDelimiter(headerLine)
  const rows: Record<string, string>[] = parse(content, {
    columns: true,
    delimiter,
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true
  })
  return { delimiter, rows }
}
