import fs from 'fs-extra'
import path from 'path'
import { fetchHTTP, fetchSFTP, fetchFTP, listFiles, FileNotFoundError, deleteRemoteFile, moveRemoteFile, connectSFTP, connectFTP } from './lib/fetch.ts'
import { convert } from './lib/convert.ts'
import { parseCSV, checkConsistentDelimiters } from './lib/parseCsv.ts'
import type { ProcessingContext } from '@data-fair/lib-common-types/processings.js'

export const run = async ({ processingConfig, tmpDir, axios, log }: ProcessingContext) => {
  await fs.ensureDir(tmpDir)
  await log.step('Initialisation')
  const dataset = (await axios.get(`api/v1/datasets/${processingConfig.dataset.id}`)).data
  if (!dataset) throw new Error(`Le jeu de données n'existe pas, id=${processingConfig.dataset.id}`)
  await log.info(`Le jeu de données existe, id="${dataset.id}", title="${dataset.title}"`)

  // les configurations enregistrées avant l'ajout du support CSV n'ont pas ce champ, elles doivent rester en JSON
  const format = processingConfig.format === 'csv' ? 'csv' : 'json'
  const extension = format === 'csv' ? '.csv' : '.json'

  const protocol = new URL(processingConfig.url).protocol
  // open a single connection reused for listing, every download and every
  // deletion, instead of reconnecting once per file
  const sftp = protocol === 'sftp:' ? await connectSFTP(processingConfig) : undefined
  const ftp = (protocol === 'ftp:' || protocol === 'ftps:') ? await connectFTP(processingConfig) : undefined

  let data: any[] = []
  try {
    let files = []
    const filePath = decodeURIComponent(path.parse(processingConfig.url).base)
    const baseUrl = decodeURIComponent(path.parse(processingConfig.url).dir)
    if (processingConfig.url.toLowerCase().endsWith(extension)) {
      files = [filePath]
    } else if (processingConfig.url.endsWith('/')) {
      const remoteFiles = await listFiles(processingConfig, sftp)
      files = remoteFiles.map(f => filePath + '/' + f.name).filter(f => f.toLowerCase().endsWith(extension))
    } else {
      files = [filePath]
      await log.warning(`Chemin suspect, il devrait se terminer par '/' ou '${extension}'`)
    }

    const multiple = files.length > 1
    if (files.length === 0) {
      await log.warning(`Aucun fichier ${extension} à télécharger`)
    } else if (multiple) {
      await log.info(`${files.length} fichiers à télécharger`)
    } else {
      await log.info(`1 fichier à télécharger (${files[0]})`)
    }

    if (files.length > 0) {
      const downloadStep = multiple ? 'Téléchargement des fichiers' : 'Téléchargement du fichier'
      await log.step(downloadStep)
      if (multiple) await log.task(downloadStep)

      let downloaded = 0
      const csvDelimiters: { file: string, delimiter: string }[] = []
      for (const file of files) {
        if (multiple) await log.info(`Téléchargement de "${file}"`)
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
            await fetchFTP(url, processingConfig, tmpFile, ftp)
          } else {
            throw new Error(`protocole non supporté "${url.protocol}"`)
          }
        } catch (err: any) {
          if (err instanceof FileNotFoundError && (processingConfig.processAndDelete || processingConfig.processAndMove)) {
            await log.warning(`Fichier non trouvé (${file}), exécution ignorée`)
            return { deleteOnComplete: true }
          }
          // message clair pour l'utilisateur, détail technique du serveur distant en extra (superadmins)
          await log.info(`Échec du téléchargement de "${file}" depuis ${url.host}, vérifiez l'URL source (elle doit pointer vers un fichier ${extension} ou un dossier se terminant par "/")`, { url: url.href, message: err.message, stack: err.stack })
          throw new Error(`Échec du téléchargement de "${file}"`)
        }

        // Try to prevent weird bug with NFS by forcing syncing file before reading it
        const fd = await fs.open(tmpFile, 'r')
        await fs.fsync(fd)
        await fs.close(fd)
        const content = await fs.readFile(tmpFile, 'utf8')
        if (format === 'csv') {
          const { delimiter, rows } = parseCSV(content)
          csvDelimiters.push({ file, delimiter })
          checkConsistentDelimiters(csvDelimiters)
          data = data.concat(rows)
        } else {
          data = data.concat(convert(JSON.parse(content), processingConfig))
        }

        // move takes precedence over delete: "Déplacer" is framed as an
        // alternative to "Supprimer", so when both are checked we keep a backup
        if (processingConfig.processAndMove) {
          if (multiple) await log.info(`Déplacement de "${file}" vers le dossier de sauvegarde sur le serveur`)
          await moveRemoteFile(processingConfig, url.pathname, sftp ?? ftp)
        } else if (processingConfig.processAndDelete) {
          if (multiple) await log.info(`Suppression de "${file}" sur le serveur`)
          await deleteRemoteFile(processingConfig, url.pathname, sftp ?? ftp)
        }

        downloaded++
        // multiple files: a single progress bar; single file: one explicit line
        if (multiple) await log.progress(downloadStep, downloaded, files.length)
        else await log.info(`Le fichier a été téléchargé (${file})`)
      }

      if (processingConfig.processAndMove || processingConfig.processAndDelete) {
        const action = processingConfig.processAndMove ? 'déplacé(s) vers le dossier de sauvegarde sur' : 'supprimé(s) du'
        await log.info(multiple ? `${files.length} fichiers source ${action} serveur` : `Fichier source ${action} serveur`)
      }
    }
  } finally {
    if (sftp) await sftp.end()
    if (ftp) ftp.end()
  }

  await log.step('Chargement des lignes')
  const resultBulk = (
    await axios({
      method: 'post',
      url: `api/v1/datasets/${processingConfig.dataset.id}/_bulk_lines?drop=${processingConfig.drop}`,
      data
    })
  ).data

  await log.info(`Lignes chargées: ${resultBulk.nbOk.toLocaleString()} ok, ${resultBulk.nbNotModified.toLocaleString()} sans modification, ${resultBulk.nbErrors.toLocaleString()} en erreur`)
  await log.info(processingConfig.drop
    ? 'Les données existantes ont été supprimées avant import (option « Supprimer les données avant import »)'
    : 'Les lignes ont été ajoutées aux données existantes')

  if (resultBulk.nbErrors) {
    await log.error(`${resultBulk.nbErrors} erreurs rencontrées`)
    for (const error of resultBulk.errors) {
      await log.error(JSON.stringify(error))
    }
  }
}
