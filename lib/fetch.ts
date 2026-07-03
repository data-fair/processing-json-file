import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import type { Readable, Writable } from 'stream'
import path from 'path'
import { promisify } from 'util'
import once from '@tootallnate/once'
import fs from 'fs-extra'
import pump from 'pump'
import SFTPClient from 'ssh2-sftp-client'
import FTPClient from 'ftp'
const ppump = promisify(pump as (source: Readable, dest: Writable, cb: (err?: Error) => void) => void)

export class FileNotFoundError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'FileNotFoundError'
  }
}

export const fetchHTTP = async (url: URL, processingConfig: any, tmpFile: string, axios: AxiosInstance) => {
  const opts : AxiosRequestConfig = { responseType: 'stream', maxRedirects: 4 }
  if (processingConfig.username && processingConfig.password) {
    opts.auth = {
      username: processingConfig.username,
      password: processingConfig.password
    }
  }
  let res
  try {
    res = await axios.get(url.href, opts)
    await ppump(res.data, fs.createWriteStream(tmpFile))
  } catch (err: any) {
    if (err.response?.status === 404) throw new FileNotFoundError(`File not found: ${url.href}`)
    throw err
  }
  if (processingConfig.filename) return processingConfig.filename
  if (res.headers['content-disposition'] && res.headers['content-disposition'].includes('filename=')) {
    if (res.headers['content-disposition'].match(/filename=(.*);/)) return res.headers['content-disposition'].match(/filename=(.*);/)[1]
    if (res.headers['content-disposition'].match(/filename="(.*)"/)) return res.headers['content-disposition'].match(/filename="(.*)"/)[1]
    if (res.headers['content-disposition'].match(/filename=(.*)/)) return res.headers['content-disposition'].match(/filename=(.*)/)[1]
  }
  if (res.request && res.request.res && res.request.res.responseUrl) return decodeURIComponent(path.parse(res.request.res.responseUrl).base)
}

// open a single SFTP connection, meant to be reused across many operations
// (listing, downloading, deleting) to avoid paying the SSH handshake cost per file
export const connectSFTP = async (processingConfig: any): Promise<SFTPClient> => {
  const url = new URL(processingConfig.url)
  const sftp = new SFTPClient()
  await sftp.connect({ host: url.hostname, port: url.port ? Number(url.port) : undefined, username: processingConfig.username, password: processingConfig.password })
  return sftp
}

export const fetchSFTP = async (url: URL, processingConfig: any, tmpFile: string, sftpClient?: SFTPClient) => {
  const sftp = sftpClient ?? await connectSFTP(processingConfig)
  try {
    await sftp.get(url.pathname, tmpFile)
  } catch (err: any) {
    if (err.message?.includes('no such file') || err.code === 'ENOENT') {
      throw new FileNotFoundError(`File not found: ${url.pathname}`)
    }
    throw err
  } finally {
    if (!sftpClient) await sftp.end()
  }
  return processingConfig.filename || decodeURIComponent(path.basename(url.pathname))
}

// open a single FTP connection, meant to be reused across many operations
// (downloading, deleting) to avoid reconnecting per file
export const connectFTP = async (processingConfig: any): Promise<any> => {
  const url = new URL(processingConfig.url)
  const ftp = new FTPClient()
  ftp.connect({ host: url.hostname, port: url.port ? Number(url.port) : undefined, user: processingConfig.username, password: processingConfig.password })
  await once(ftp, 'ready')
  return ftp
}

export const fetchFTP = async (url: URL, processingConfig: any, tmpFile: string, ftpClient?: any) => {
  const ftp = ftpClient ?? await connectFTP(processingConfig)
  try {
    // promisify into a local to avoid mutating (and double-wrapping) a reused client
    const get = promisify(ftp.get.bind(ftp))
    const stream = await get(url.pathname)
    await ppump(stream, fs.createWriteStream(tmpFile))
  } catch (err: any) {
    if (err.message?.includes('no such file') || err.message?.includes('Not found')) {
      throw new FileNotFoundError(`File not found: ${url.pathname}`)
    }
    throw err
  } finally {
    if (!ftpClient) ftp.end()
  }
  return processingConfig.filename || decodeURIComponent(path.basename(url.pathname))
}

export const listFiles = async (processingConfig: any, sftpClient?: SFTPClient) => {
  const url = new URL(processingConfig.url)
  // if (url.protocol === 'http:' || url.protocol === 'https:') {
  //   await fetchHTTP(url, processingConfig, tmpFile, axios)
  // } else
  if (url.protocol === 'sftp:') {
    const sftp = sftpClient ?? await connectSFTP(processingConfig)
    try {
      return await sftp.list(url.pathname)
    } finally {
      if (!sftpClient) await sftp.end()
    }
    // } else if (url.protocol === 'ftp:' || url.protocol === 'ftps:') {
    //   await fetchFTP(url, processingConfig, tmpFile)
  } else {
    throw new Error(`protocole non supporté pour la récupération de tout le répertoire"${url.protocol}"`)
  }
}

export const deleteRemoteFile = async (processingConfig: any, remotePath: string, client?: any) => {
  const url = new URL(processingConfig.url)

  if (url.protocol === 'sftp:') {
    const sftp: SFTPClient = client ?? await connectSFTP(processingConfig)
    try {
      await sftp.delete(remotePath)
    } finally {
      if (!client) await sftp.end()
    }
  } else if (url.protocol === 'ftp:' || url.protocol === 'ftps:') {
    const ftp = client ?? await connectFTP(processingConfig)
    try {
      // promisify into a local to avoid mutating (and double-wrapping) a reused client
      const del = promisify(ftp.delete.bind(ftp))
      await del(remotePath)
    } finally {
      if (!client) ftp.end()
    }
  }
}

// a single downloaded file gets a "backup" folder next to it; every file of an
// imported folder shares one "backup" folder inside that same imported folder
export const computeBackupPath = (remotePath: string): string => {
  const dir = path.posix.dirname(remotePath)
  const base = path.posix.basename(remotePath)
  return path.posix.join(dir, 'backup', base)
}

export const moveRemoteFile = async (processingConfig: any, remotePath: string, client?: any) => {
  const url = new URL(processingConfig.url)
  const backupPath = computeBackupPath(remotePath)
  const backupDir = path.posix.dirname(backupPath)

  if (url.protocol === 'sftp:') {
    const sftp: SFTPClient = client ?? await connectSFTP(processingConfig)
    try {
      await sftp.mkdir(backupDir, true)
      await sftp.rename(remotePath, backupPath)
    } finally {
      if (!client) await sftp.end()
    }
  } else if (url.protocol === 'ftp:' || url.protocol === 'ftps:') {
    const ftp = client ?? await connectFTP(processingConfig)
    try {
      const mkdir = promisify(ftp.mkdir.bind(ftp)) as (path: string, recursive: boolean) => Promise<void>
      const rename = promisify(ftp.rename.bind(ftp)) as (from: string, to: string) => Promise<void>
      await mkdir(backupDir, true)
      await rename(remotePath, backupPath)
    } finally {
      if (!client) ftp.end()
    }
  }
}
