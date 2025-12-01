import fs from 'fs-extra'
import path from 'path'
import { fetchHTTP, fetchSFTP, fetchFTP } from './lib/fetch.ts'
import { convert } from './lib/convert.ts'
import type { ProcessingContext } from '@data-fair/lib-common-types/processings.js'

export const run = async ({ processingConfig, tmpDir, axios, log }: ProcessingContext) => {
  await fs.ensureDir(tmpDir)
  await log.step('Vérification du jeu de données')
  const dataset = (await axios.get(`api/v1/datasets/${processingConfig.dataset.id}`)).data
  if (!dataset) throw new Error(`le jeu de données n'existe pas, id${processingConfig.dataset.id}`)
  await log.info(`le jeu de donnée existe, id="${dataset.id}", title="${dataset.title}"`)

  await log.step('Téléchargement du fichier')
  const tmpFile = path.join(tmpDir, 'file')
  // creating empty file before streaming seems to fix some weird bugs with NFS
  await fs.ensureFile(tmpFile)

  const url = new URL(processingConfig.url)
  let filename = decodeURIComponent(path.parse(processingConfig.url).base)
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    filename = await fetchHTTP(processingConfig, tmpFile, axios) || filename
  } else if (url.protocol === 'sftp:') {
    await fetchSFTP(processingConfig, tmpFile)
  } else if (url.protocol === 'ftp:' || url.protocol === 'ftps:') {
    await fetchFTP(processingConfig, tmpFile)
  } else {
    throw new Error(`protocole non supporté "${url.protocol}"`)
  }

  // Try to prevent weird bug with NFS by forcing syncing file before reading it
  const fd = await fs.open(tmpFile, 'r')
  await fs.fsync(fd)
  await fs.close(fd)
  await log.info(`le fichier a été téléchargé (${filename})`)
  const json = JSON.parse(fs.readFileSync(tmpFile).toString())
  const data = convert(json, processingConfig)
  const resultBulk = (
    await axios({
      method: 'post',
      url: `api/v1/datasets/${processingConfig.dataset.id}/_bulk_lines?drop=${processingConfig.drop}`,
      data
    })
  ).data

  await log.info(`lignes chargées: ${resultBulk.nbOk.toLocaleString()} ok, ${resultBulk.nbNotModified.toLocaleString()} sans modification, ${resultBulk.nbErrors.toLocaleString()} en erreur`)

  if (resultBulk.nbErrors) {
    await log.error(`${resultBulk.nbErrors} erreurs rencontrées`)
    for (const error of resultBulk.errors) {
      await log.error(JSON.stringify(error))
    }
  }
}
