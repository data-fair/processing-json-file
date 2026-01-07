import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import path from 'path'
import { promisify } from 'util'
import once from '@tootallnate/once'
import fs from 'fs-extra'
import pump from 'pump'
import SFTPClient from 'ssh2-sftp-client'
import * as FTPClient from 'ftp'
const ppump = promisify(pump)

export const fetchHTTP = async (url, processingConfig, tmpFile, axios: AxiosInstance) => {
  const opts : AxiosRequestConfig = { responseType: 'stream', maxRedirects: 4 }
  if (processingConfig.username && processingConfig.password) {
    opts.auth = {
      username: processingConfig.username,
      password: processingConfig.password
    }
  }
  const res = await axios.get(url.href, opts)
  await ppump(res.data, fs.createWriteStream(tmpFile))
  if (processingConfig.filename) return processingConfig.filename
  if (res.headers['content-disposition'] && res.headers['content-disposition'].includes('filename=')) {
    if (res.headers['content-disposition'].match(/filename=(.*);/)) return res.headers['content-disposition'].match(/filename=(.*);/)[1]
    if (res.headers['content-disposition'].match(/filename="(.*)"/)) return res.headers['content-disposition'].match(/filename="(.*)"/)[1]
    if (res.headers['content-disposition'].match(/filename=(.*)/)) return res.headers['content-disposition'].match(/filename=(.*)/)[1]
  }
  if (res.request && res.request.res && res.request.res.responseUrl) return decodeURIComponent(path.parse(res.request.res.responseUrl).base)
}

export const fetchSFTP = async (url, processingConfig, tmpFile) => {
  const sftp = new SFTPClient()
  await sftp.connect({ host: url.hostname, port: url.port, username: processingConfig.username, password: processingConfig.password })
  await sftp.get(url.pathname, tmpFile)
  return processingConfig.filename || decodeURIComponent(path.basename(url.pathname))
}

export const fetchFTP = async (url, processingConfig, tmpFile) => {
  const ftp = new FTPClient()
  ftp.connect({ host: url.hostname, port: url.port, user: processingConfig.username, password: processingConfig.password })
  await once(ftp, 'ready')
  ftp.get = promisify(ftp.get)
  const stream = await ftp.get(url.pathname)
  await pump(stream, fs.createWriteStream(tmpFile))
  return processingConfig.filename || decodeURIComponent(path.basename(url.pathname))
}

export const listFiles = async (processingConfig) => {
  const url = new URL(processingConfig.url)
  // if (url.protocol === 'http:' || url.protocol === 'https:') {
  //   await fetchHTTP(url, processingConfig, tmpFile, axios)
  // } else
  if (url.protocol === 'sftp:') {
    const sftp = new SFTPClient()
    await sftp.connect({ host: url.hostname, port: url.port, username: processingConfig.username, password: processingConfig.password })
    return await sftp.list(url.pathname)
    // } else if (url.protocol === 'ftp:' || url.protocol === 'ftps:') {
    //   await fetchFTP(url, processingConfig, tmpFile)
  } else {
    throw new Error(`protocole non supporté pour la récupération de tout le répertoire"${url.protocol}"`)
  }
}
