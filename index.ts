import fs from 'fs-extra'
import path from 'path'
import { fetchHTTP, fetchSFTP, fetchFTP, listFiles, FileNotFoundError, deleteRemoteFile, moveRemoteFile, connectSFTP, connectFTP } from './lib/fetch.ts'
import { convert } from './lib/convert.ts'
import { detectDelimiter, splitCsvContent, checkConsistentDelimiters, checkConsistentHeaders } from './lib/parseCsv.ts'
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

  // action sur les fichiers sources après import (FTP/SFTP)
  // rétrocompatibilité : les anciennes configs utilisaient deux booléens
  // processAndMove / processAndDelete au lieu du sélecteur sourceAction
  const sourceAction: 'none' | 'delete' | 'move' = processingConfig.sourceAction ??
    (processingConfig.processAndMove ? 'move' : processingConfig.processAndDelete ? 'delete' : 'none')
  const processAndMove = sourceAction === 'move'
  const processAndDelete = sourceAction === 'delete'

  const protocol = new URL(processingConfig.url).protocol
  // open a single connection reused for listing, every download and every
  // deletion, instead of reconnecting once per file
  const sftp = protocol === 'sftp:' ? await connectSFTP(processingConfig) : undefined
  const ftp = (protocol === 'ftp:' || protocol === 'ftps:') ? await connectFTP(processingConfig) : undefined

  // JSON : tableau d'objets déjà mappé via la configuration, poussé en application/json
  // CSV : on ne parse pas localement, on ré-assemble le texte CSV et on laisse
  // data-fair mapper les en-têtes vers les clés de colonnes lors du push (text/csv)
  let data: any[] = []
  let csvPayload = ''
  let csvDelimiter = ','
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
      const csvFiles: { file: string, header: string, delimiter: string }[] = []
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
          if (err instanceof FileNotFoundError && (processAndDelete || processAndMove)) {
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
          // ré-assemblage du texte CSV : en-tête du premier fichier puis les
          // lignes de données de tous les fichiers (les fichiers d'un dossier
          // doivent partager les mêmes colonnes, dans le même ordre)
          const { header, body } = splitCsvContent(content)
          const delimiter = detectDelimiter(header)
          csvFiles.push({ file, header, delimiter })
          checkConsistentDelimiters(csvFiles)
          checkConsistentHeaders(csvFiles)
          if (csvPayload === '') {
            csvDelimiter = delimiter
            csvPayload = header
          }
          if (body !== '') csvPayload += '\n' + body
        } else {
          data = data.concat(convert(JSON.parse(content), processingConfig))
        }

        // sourceAction : "move" et "delete" sont exclusifs (sélecteur), "none" ne fait rien
        if (processAndMove) {
          if (multiple) await log.info(`Déplacement de "${file}" vers le dossier de sauvegarde sur le serveur`)
          await moveRemoteFile(processingConfig, url.pathname, sftp ?? ftp)
        } else if (processAndDelete) {
          if (multiple) await log.info(`Suppression de "${file}" sur le serveur`)
          await deleteRemoteFile(processingConfig, url.pathname, sftp ?? ftp)
        }

        downloaded++
        // multiple files: a single progress bar; single file: one explicit line
        if (multiple) await log.progress(downloadStep, downloaded, files.length)
        else await log.info(`Le fichier a été téléchargé (${file})`)
      }

      if (processAndMove || processAndDelete) {
        const action = processAndMove ? 'déplacé(s) vers le dossier de sauvegarde sur' : 'supprimé(s) du'
        await log.info(multiple ? `${files.length} fichiers source ${action} serveur` : `Fichier source ${action} serveur`)
      }
    }
  } finally {
    if (sftp) await sftp.end()
    if (ftp) ftp.end()
  }

  await log.step('Chargement des lignes')
  // CSV : on envoie le texte brut (Content-Type text/csv) pour que data-fair
  // normalise lui-même les en-têtes vers les clés de colonnes (escapeKey).
  // JSON (et le cas "aucun fichier", tableau vide) : envoi du tableau d'objets,
  // ce dernier conservant la sémantique du drop même sans nouveau fichier.
  const bulkUrl = `api/v1/datasets/${processingConfig.dataset.id}/_bulk_lines?drop=${processingConfig.drop}`
  const resultBulk = (
    format === 'csv' && csvPayload !== ''
      ? await axios({
        method: 'post',
        url: `${bulkUrl}&sep=${encodeURIComponent(csvDelimiter)}`,
        headers: { 'Content-Type': 'text/csv' },
        data: csvPayload
      })
      : await axios({
        method: 'post',
        url: bulkUrl,
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
