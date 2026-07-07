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
    body: clean.slice(nlIndex).replace(/^\r?\n/, '')
  }
}

export const checkConsistentDelimiters = (files: { file: string, delimiter: string }[]): void => {
  const reference = files[0]
  for (const f of files) {
    if (f.delimiter !== reference.delimiter) {
      throw new Error(`Séparateurs CSV incohérents entre les fichiers : "${reference.file}" utilise "${reference.delimiter}" alors que "${f.file}" utilise "${f.delimiter}"`)
    }
  }
}

export const checkConsistentHeaders = (files: { file: string, header: string }[]): void => {
  const reference = files[0]
  for (const f of files) {
    if (f.header !== reference.header) {
      throw new Error(`En-têtes CSV incohérents entre les fichiers : "${reference.file}" n'a pas les mêmes colonnes que "${f.file}" (les fichiers d'un même dossier doivent partager les mêmes colonnes, dans le même ordre)`)
    }
  }
}
