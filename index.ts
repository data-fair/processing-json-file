import fs from 'fs-extra'
import path from 'path'
import { fetchHTTP, fetchSFTP, fetchFTP, listFiles, FileNotFoundError, deleteRemoteFile, moveRemoteFile, connectSFTP, connectFTP } from './lib/fetch.ts'
import { convert } from './lib/convert.ts'
import { detectDelimiter, splitCsvContent, checkCsvConsistency } from './lib/parseCsv.ts'
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
  // open a single connection reused for listing and every download, instead of
  // reconnecting once per file. The move/delete step reopens its own connection
  // after the import (see below).
  const sftp = protocol === 'sftp:' ? await connectSFTP(processingConfig) : undefined
  const ftp = (protocol === 'ftp:' || protocol === 'ftps:') ? await connectFTP(processingConfig) : undefined

  // JSON : tableau d'objets déjà mappé via la configuration, poussé en application/json
  // CSV : on ne parse pas localement, on ré-assemble le texte CSV et on laisse
  // data-fair mapper les en-têtes vers les clés de colonnes lors du push (text/csv)
  let data: any[] = []
  let csvPayload = ''
  let csvDelimiter = ','
  // signature (séparateur + en-tête) du premier fichier CSV traité avec succès :
  // sert de référence pour ignorer les fichiers du dossier dont les colonnes diffèrent
  let csvReference: { file: string, header: string, delimiter: string } | undefined
  // fichiers téléchargés et parsés avec succès. Eux seuls alimentent l'import puis,
  // une fois l'import réussi, sont déplacés/supprimés sur le serveur source. Un
  // fichier ignoré (téléchargement, parsing ou cohérence CSV en échec) n'y figure pas.
  const okFiles: { file: string, pathname: string }[] = []
  let files: string[] = []
  let multiple = false

  try {
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

    multiple = files.length > 1
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
          // fichier unique introuvable avec archivage/suppression : comportement
          // historique, le run est considéré comme "rien à faire" et non en erreur
          if (err instanceof FileNotFoundError && !multiple && (processAndDelete || processAndMove)) {
            await log.warning(`Fichier non trouvé (${file}), exécution ignorée`)
            return { deleteOnComplete: true }
          }
          // sinon on isole le fichier en échec et on poursuit avec les autres
          await log.warning(`Échec du téléchargement de "${file}" depuis ${url.host}, fichier ignoré`, { url: url.href, message: err.message, stack: err.stack })
          continue
        }

        // Try to prevent weird bug with NFS by forcing syncing file before reading it
        let content = ''
        try {
          const fd = await fs.open(tmpFile, 'r')
          await fs.fsync(fd)
          await fs.close(fd)
          content = await fs.readFile(tmpFile, 'utf8')
        } catch (err: any) {
          await log.warning(`Échec de lecture de "${file}", fichier ignoré`, { message: err.message })
          continue
        }

        if (format === 'csv') {
          // ré-assemblage du texte CSV : en-tête du premier fichier puis les
          // lignes de données de tous les fichiers cohérents (mêmes colonnes,
          // même ordre). Un fichier vide ou incohérent est ignoré, pas fatal.
          const { header, body } = splitCsvContent(content)
          if (header.trim() === '') {
            await log.warning(`Fichier CSV vide (${file}), fichier ignoré`)
            continue
          }
          const delimiter = detectDelimiter(header)
          if (csvReference) {
            const inconsistency = checkCsvConsistency({ file, header, delimiter }, csvReference)
            if (inconsistency) {
              await log.warning(`${inconsistency} — "${file}" ignoré`)
              continue
            }
          } else {
            csvReference = { file, header, delimiter }
            csvDelimiter = delimiter
            csvPayload = header
          }
          if (body !== '') csvPayload += '\n' + body
        } else {
          try {
            data = data.concat(convert(JSON.parse(content), processingConfig))
          } catch (err: any) {
            await log.warning(`Échec de lecture du JSON de "${file}", fichier ignoré`, { message: err.message })
            continue
          }
        }

        // fichier traité avec succès : candidat à l'import puis à l'archivage
        okFiles.push({ file, pathname: url.pathname })

        downloaded++
        // multiple files: a single progress bar; single file: one explicit line
        if (multiple) await log.progress(downloadStep, downloaded, files.length)
        else await log.info(`Le fichier a été téléchargé (${file})`)
      }
    }
  } finally {
    if (sftp) await sftp.end()
    if (ftp) ftp.end()
  }

  // tous les fichiers présents ont été ignorés : on n'importe pas (un payload vide
  // avec drop=true viderait le jeu de données) et on ne déplace rien
  if (files.length > 0 && okFiles.length === 0) {
    throw new Error("Aucun fichier n'a pu être traité, tous ont été ignorés : import annulé pour ne pas risquer d'écraser les données existantes")
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

  // déplacement/suppression des sources APRÈS un import réussi, et seulement pour
  // les fichiers réellement traités. Une connexion fraîche est ouverte ici : la
  // précédente a été fermée après les téléchargements et aurait pu expirer pendant
  // l'import. Pour une source HTTP(S) il n'y a rien à déplacer (no-op).
  if (sourceAction !== 'none' && okFiles.length > 0 &&
      (protocol === 'sftp:' || protocol === 'ftp:' || protocol === 'ftps:')) {
    const archiveStep = processAndMove ? 'Déplacement des fichiers source' : 'Suppression des fichiers source'
    await log.step(archiveStep)
    const archiveSftp = protocol === 'sftp:' ? await connectSFTP(processingConfig) : undefined
    const archiveFtp = protocol !== 'sftp:' ? await connectFTP(processingConfig) : undefined
    const archiveClient = archiveSftp ?? archiveFtp
    let archived = 0
    try {
      for (const { file, pathname } of okFiles) {
        try {
          if (processAndMove) {
            if (multiple) await log.info(`Déplacement de "${file}" vers le dossier de sauvegarde sur le serveur`)
            await moveRemoteFile(processingConfig, pathname, archiveClient)
          } else {
            if (multiple) await log.info(`Suppression de "${file}" sur le serveur`)
            await deleteRemoteFile(processingConfig, pathname, archiveClient)
          }
          archived++
        } catch (err: any) {
          // l'import a déjà réussi : un échec de nettoyage ne fait pas échouer le run
          await log.warning(`Échec du ${processAndMove ? 'déplacement' : 'suppression'} de "${file}" sur le serveur, fichier laissé en place`, { message: err.message })
        }
      }
    } finally {
      if (archiveSftp) await archiveSftp.end()
      if (archiveFtp) archiveFtp.end()
    }
    if (archived > 0) {
      const action = processAndMove ? 'déplacé(s) vers le dossier de sauvegarde sur' : 'supprimé(s) du'
      await log.info(archived > 1 ? `${archived} fichiers source ${action} serveur` : `Fichier source ${action} serveur`)
    }
  }
}
