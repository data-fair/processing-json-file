import fs from 'fs-extra'
import path from 'path'
import { fetchHTTP, fetchSFTP, fetchFTP, listFiles, FileNotFoundError, deleteRemoteFile, moveRemoteFile, connectSFTP, connectFTP } from './lib/fetch.ts'
import { convert } from './lib/convert.ts'
import { detectDelimiter, splitCsvContent, checkCsvConsistency, missingColumns } from './lib/parseCsv.ts'
import { extractZip } from './lib/unzip.ts'
import { stripQuery, sourceBase, sourceDir, sourceExtension } from './lib/sourceUrl.ts'
import { uploadFileDataset, formatBytes } from './lib/upload.ts'
import type { ProcessingContext } from '@data-fair/lib-common-types/processings.js'

// un fichier à récupérer sur la source. Une archive compte pour un seul fichier
// source (c'est elle qui sera supprimée/déplacée après import) mais fournit
// plusieurs fichiers de contenu une fois décompressée.
interface SourceFile { name: string, href: string, pathname: string }

export const run = async ({ processingConfig, tmpDir, axios, log, patchConfig }: ProcessingContext) => {
  await fs.ensureDir(tmpDir)
  await log.step('Initialisation')

  // les configurations enregistrées avant l'ajout des modes n'ont pas ce champ :
  // elles mettent à jour un jeu de données éditable existant
  const datasetMode: 'create' | 'update' = processingConfig.datasetMode ?? 'update'

  // en mise à jour c'est le type du jeu de données cible qui décide de la façon
  // de charger les données : lignes en masse pour un jeu éditable, remplacement
  // du fichier pour un jeu fichier. La création ne produit que des jeux fichier.
  let targetDataset: any
  let editable = false
  if (datasetMode === 'update') {
    targetDataset = (await axios.get(`api/v1/datasets/${processingConfig.dataset.id}`)).data
    if (!targetDataset) throw new Error(`Le jeu de données n'existe pas, id=${processingConfig.dataset.id}`)
    editable = !!targetDataset.isRest
    await log.info(`Le jeu de données existe, id="${targetDataset.id}", title="${targetDataset.title}" (jeu de données ${editable ? 'éditable' : 'fichier'})`)
  } else {
    await log.info('Un jeu de données fichier sera créé à partir des données importées')
  }

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

  // JSON : tableau d'objets déjà mappé via la configuration
  // CSV : on ne parse pas localement, on ré-assemble le texte CSV et on laisse
  // data-fair mapper les en-têtes vers les clés de colonnes
  let data: any[] = []
  let csvPayload = ''
  let csvDelimiter = ','
  // signature (séparateur + en-tête) du premier fichier CSV traité avec succès :
  // sert de référence pour ignorer les fichiers dont les colonnes diffèrent
  let csvReference: { file: string, header: string, delimiter: string } | undefined
  // fichiers sources dont au moins un fichier de contenu a été traité avec succès.
  // Eux seuls alimentent l'import puis, une fois l'import réussi, sont
  // déplacés/supprimés sur le serveur source.
  const okFiles: { file: string, pathname: string }[] = []
  let sources: SourceFile[] = []
  let multiple = false

  try {
    const rawUrl = processingConfig.url
    const base = sourceBase(rawUrl)
    const dirUrl = sourceDir(rawUrl)
    const urlExtension = sourceExtension(rawUrl)
    const makeSource = (name: string, href: string): SourceFile => ({ name, href, pathname: new URL(href).pathname })

    if (urlExtension === extension || urlExtension === '.zip') {
      // l'URL d'origine est conservée telle quelle : sa query string peut porter
      // un jeton d'accès (SAS Azure par exemple) nécessaire au téléchargement
      sources = [makeSource(base, rawUrl)]
    } else if (stripQuery(rawUrl).endsWith('/')) {
      // seules les archives explicitement visées par l'URL sont décompressées :
      // ramasser aussi les .zip d'un dossier importerait, sur les traitements
      // existants, des données jusqu'ici ignorées et supprimerait/déplacerait
      // sur le serveur des archives auxquelles on ne touchait pas
      const remoteFiles = await listFiles(processingConfig, sftp)
      sources = remoteFiles
        .map(f => f.name)
        .filter(name => name.toLowerCase().endsWith(extension))
        .map(name => makeSource(base + '/' + name, dirUrl + '/' + base + '/' + name))
    } else {
      sources = [makeSource(base, rawUrl)]
      await log.warning(`Chemin suspect, il devrait se terminer par '/', '${extension}' ou '.zip'`)
    }

    multiple = sources.length > 1
    if (sources.length === 0) {
      await log.warning(`Aucun fichier ${extension} à télécharger`)
    } else if (multiple) {
      await log.info(`${sources.length} fichiers à télécharger`)
    } else {
      await log.info(`1 fichier à télécharger (${sources[0].name})`)
    }

    if (sources.length > 0) {
      const downloadStep = multiple ? 'Téléchargement des fichiers' : 'Téléchargement du fichier'
      await log.step(downloadStep)
      if (multiple) await log.task(downloadStep)

      let downloaded = 0
      for (const source of sources) {
        if (multiple) await log.info(`Téléchargement de "${source.name}"`)
        const tmpFile = path.join(tmpDir, source.name)
        // creating empty file before streaming seems to fix some weird bugs with NFS
        await fs.ensureFile(tmpFile)

        const url = new URL(source.href)
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
            await log.warning(`Fichier non trouvé (${source.name}), exécution ignorée`)
            return { deleteOnComplete: true }
          }
          // sinon on isole le fichier en échec et on poursuit avec les autres
          await log.warning(`Échec du téléchargement de "${source.name}" depuis ${url.host}, fichier ignoré`, { url: url.href, message: err.message, stack: err.stack })
          continue
        }

        // une archive est décompressée et fournit tous les fichiers du format
        // choisi qu'elle contient ; un fichier simple ne fournit que lui-même
        const unzipDir = tmpFile + '-unzip'
        let contentFiles = [tmpFile]
        if (source.name.toLowerCase().endsWith('.zip')) {
          try {
            contentFiles = await extractZip(tmpFile, unzipDir, extension)
          } catch (err: any) {
            await log.warning(`Échec de la décompression de "${source.name}", archive ignorée`, { message: err.message })
            continue
          }
          if (contentFiles.length === 0) {
            await log.warning(`Aucun fichier ${extension} dans l'archive "${source.name}", archive ignorée`)
            continue
          }
          await log.info(`${contentFiles.length} fichier(s) ${extension} extrait(s) de "${source.name}"`)
        }

        // une archive dont un seul fichier interne est illisible reste un import
        // partiel valide : on n'abandonne la source que si rien n'a pu être lu
        let anyOk = false
        for (const contentFile of contentFiles) {
          const label = contentFile === tmpFile ? source.name : `${source.name}/${path.relative(unzipDir, contentFile)}`

          // Try to prevent weird bug with NFS by forcing syncing file before reading it
          let content = ''
          try {
            const fd = await fs.open(contentFile, 'r')
            await fs.fsync(fd)
            await fs.close(fd)
            content = await fs.readFile(contentFile, 'utf8')
          } catch (err: any) {
            await log.warning(`Échec de lecture de "${label}", fichier ignoré`, { message: err.message })
            continue
          }

          if (format === 'csv') {
            // ré-assemblage du texte CSV : en-tête du premier fichier puis les
            // lignes de données de tous les fichiers cohérents (mêmes colonnes,
            // même ordre). Un fichier vide ou incohérent est ignoré, pas fatal.
            const { header, body } = splitCsvContent(content)
            if (header.trim() === '') {
              await log.warning(`Fichier CSV vide (${label}), fichier ignoré`)
              continue
            }
            const delimiter = detectDelimiter(header)
            if (csvReference) {
              const inconsistency = checkCsvConsistency({ file: label, header, delimiter }, csvReference)
              if (inconsistency) {
                await log.warning(`${inconsistency} — "${label}" ignoré`)
                continue
              }
            } else {
              csvReference = { file: label, header, delimiter }
              csvDelimiter = delimiter
              csvPayload = header
            }
            if (body !== '') csvPayload += '\n' + body
          } else {
            try {
              data = data.concat(convert(JSON.parse(content), processingConfig))
            } catch (err: any) {
              await log.warning(`Échec de lecture du JSON de "${label}", fichier ignoré`, { message: err.message })
              continue
            }
          }
          anyOk = true
        }

        if (!anyOk) continue

        // source traitée avec succès : candidate à l'import puis à l'archivage
        okFiles.push({ file: source.name, pathname: source.pathname })

        downloaded++
        // multiple files: a single progress bar; single file: one explicit line
        if (multiple) await log.progress(downloadStep, downloaded, sources.length)
        else await log.info(`Le fichier a été téléchargé (${source.name})`)
      }
    }
  } finally {
    if (sftp) await sftp.end()
    if (ftp) ftp.end()
  }

  // tous les fichiers présents ont été ignorés : on n'importe pas (un payload vide
  // avec drop=true viderait le jeu de données) et on ne déplace rien
  if (sources.length > 0 && okFiles.length === 0) {
    throw new Error("Aucun fichier n'a pu être traité, tous ont été ignorés : import annulé pour ne pas risquer d'écraser les données existantes")
  }

  if (editable) {
    await log.step('Chargement des lignes')

    // data-fair ne crée jamais de colonne lors d'un chargement de lignes : une
    // colonne absente du schéma fait rejeter la requête entière. On prévient
    // avec la clé attendue plutôt que de laisser un "400 Colonnes inconnues".
    if (format === 'csv' && csvReference) {
      const missing = missingColumns(csvReference.header, csvDelimiter, targetDataset.schema ?? [])
      if (missing.length > 0) {
        await log.warning(`${missing.length} colonne(s) du fichier source sont absentes du schéma du jeu de données éditable, l'import sera probablement rejeté : ${missing.map(c => `"${c.name}" (clé attendue : ${c.key})`).join(', ')}`)
      }
    }

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
  } else {
    await log.step(datasetMode === 'create' ? 'Création du jeu de données' : 'Chargement du fichier')

    // un jeu de données fichier est intégralement remplacé par le fichier envoyé :
    // charger un fichier vide le viderait, on préfère ne rien faire
    if (format === 'csv' ? csvPayload === '' : data.length === 0) {
      await log.warning("Aucune donnée à charger, le jeu de données n'est pas modifié")
      return
    }

    // le nom du fichier envoyé sert à data-fair pour détecter le format, et pour
    // titrer le jeu de données créé quand aucun titre n'est configuré
    const uploadName = (path.parse(sourceBase(processingConfig.url)).name || 'data') + extension
    const uploadPath = path.join(tmpDir, 'upload-' + uploadName)
    await fs.writeFile(uploadPath, format === 'csv' ? csvPayload : JSON.stringify(data))

    const { dataset, contentLength } = await uploadFileDataset(axios, {
      filePath: uploadPath,
      filename: uploadName,
      datasetId: datasetMode === 'update' ? processingConfig.dataset.id : undefined,
      title: datasetMode === 'create' ? (processingConfig.datasetTitle || undefined) : undefined,
      // la query string de l'URL source peut porter un jeton d'accès, on ne la publie pas
      origin: stripQuery(processingConfig.url)
    })

    await log.info(`${formatBytes(contentLength)} chargés dans le jeu de données "${dataset.title}" (${dataset.id})`)
    await log.info('Les colonnes et leurs types sont déduits du fichier par data-fair')

    if (datasetMode === 'create') {
      await patchConfig({ datasetMode: 'update', dataset: { id: dataset.id, title: dataset.title } } as any)
      await log.info('Le traitement met désormais à jour ce jeu de données lors des prochaines exécutions')
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
