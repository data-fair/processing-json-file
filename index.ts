import fs from 'fs-extra'
import path from 'path'
import { fetchHTTP, fetchSFTP, fetchFTP, listFiles, FileNotFoundError, deleteRemoteFile, connectSFTP } from './lib/fetch.ts'
import { convert } from './lib/convert.ts'
import type { ProcessingContext } from '@data-fair/lib-common-types/processings.js'

export const run = async ({ processingConfig, tmpDir, axios, log }: ProcessingContext) => {
  await fs.ensureDir(tmpDir)
  await log.step('Vérification du jeu de données')
  const dataset = (await axios.get(`api/v1/datasets/${processingConfig.dataset.id}`)).data
  if (!dataset) throw new Error(`le jeu de données n'existe pas, id${processingConfig.dataset.id}`)
  await log.info(`le jeu de donnée existe, id="${dataset.id}", title="${dataset.title}"`)

  const protocol = new URL(processingConfig.url).protocol
  // open a single SFTP connection reused for listing, every download and every
  // deletion, instead of paying the SSH handshake cost once per file
  const sftp = protocol === 'sftp:' ? await connectSFTP(processingConfig) : undefined

  let data = []
  try {
    let files = []
    const filePath = decodeURIComponent(path.parse(processingConfig.url).base)
    const baseUrl = decodeURIComponent(path.parse(processingConfig.url).dir)
    if (processingConfig.url.endsWith('.json')) {
      files = [filePath]
    } else if (processingConfig.url.endsWith('/')) {
      const remoteFiles = await listFiles(processingConfig, sftp)
      files = remoteFiles.map(f => filePath + '/' + f.name).filter(f => f.endsWith('.json'))
    } else {
      files = [filePath]
      log.warning('Suspicious path, it should end with \'/\' or \'.json\' ')
    }

    for (const file of files) {
      await log.step('Téléchargement du fichier')
      const tmpFile = path.join(tmpDir, file)
      // creating empty file before streaming seems to fix some weird bugs with NFS
      await fs.ensureFile(tmpFile)

      const url = new URL(baseUrl + '/' + file)
      try {
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          await fetchHTTP(url, processingConfig, tmpFile, axios)
        } else if (url.protocol === 'sftp:') {
          await fetchSFTP(url, processingConfig, tmpFile, sftp)
        } else if (url.protocol === 'ftp:' || url.protocol === 'ftps:') {
          await fetchFTP(url, processingConfig, tmpFile)
        } else {
          throw new Error(`protocole non supporté "${url.protocol}"`)
        }
      } catch (err: any) {
        if (err instanceof FileNotFoundError && processingConfig.processAndDelete) {
          await log.warning(`fichier non trouvé (${file}), exécution ignorée`)
          return { deleteOnComplete: true }
        }
        throw err
      }

      // Try to prevent weird bug with NFS by forcing syncing file before reading it
      const fd = await fs.open(tmpFile, 'r')
      await fs.fsync(fd)
      await fs.close(fd)
      await log.info(`le fichier a été téléchargé (${file})`)
      const json = JSON.parse(fs.readFileSync(tmpFile).toString())
      data = data.concat(convert(json, processingConfig))

      if (processingConfig.processAndDelete) {
        await log.info(`suppression du fichier source (${file})`)
        await deleteRemoteFile(processingConfig, file, sftp)
      }
    }
  } finally {
    if (sftp) await sftp.end()
  }
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
