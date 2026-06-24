import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import path from 'path'
import { promisify } from 'util'
import once from '@tootallnate/once'
import fs from 'fs-extra'
import pump from 'pump'
import SFTPClient from 'ssh2-sftp-client'
import * as FTPClient from 'ftp'
const ppump = promisify(pump)

export class FileNotFoundError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'FileNotFoundError'
  }
}

export const fetchHTTP = async (url, processingConfig, tmpFile, axios: AxiosInstance) => {
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
export const connectSFTP = async (processingConfig): Promise<SFTPClient> => {
  const url = new URL(processingConfig.url)
  const sftp = new SFTPClient()
  await sftp.connect({ host: url.hostname, port: url.port, username: processingConfig.username, password: processingConfig.password })
  return sftp
}

export const fetchSFTP = async (url, processingConfig, tmpFile, sftpClient?: SFTPClient) => {
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
export const connectFTP = async (processingConfig): Promise<any> => {
  const url = new URL(processingConfig.url)
  const ftp = new FTPClient()
  ftp.connect({ host: url.hostname, port: url.port, user: processingConfig.username, password: processingConfig.password })
  await once(ftp, 'ready')
  return ftp
}

export const fetchFTP = async (url, processingConfig, tmpFile, ftpClient?: any) => {
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

export const listFiles = async (processingConfig, sftpClient?: SFTPClient) => {
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

export const deleteRemoteFile = async (processingConfig, filePath: string, client?: any) => {
  const url = new URL(processingConfig.url)
  const remotePath = new URL(filePath, processingConfig.url).pathname

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
