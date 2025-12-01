import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import path from 'path'
import { promisify } from 'util'
import once from '@tootallnate/once'
import fs from 'fs-extra'
import pump from 'pump'
import SFTPClient from 'ssh2-sftp-client'
import ftp from 'ftp'
const ppump = promisify(pump)

export const fetchHTTP = async (processingConfig, tmpFile, axios: AxiosInstance) => {
  const opts : AxiosRequestConfig = { responseType: 'stream', maxRedirects: 4 }
  if (processingConfig.username && processingConfig.password) {
    opts.auth = {
      username: processingConfig.username,
      password: processingConfig.password
    }
  }
  const res = await axios.get(processingConfig.url, opts)
  await ppump(res.data, fs.createWriteStream(tmpFile))
  if (processingConfig.filename) return processingConfig.filename
  if (res.headers['content-disposition'] && res.headers['content-disposition'].includes('filename=')) {
    if (res.headers['content-disposition'].match(/filename=(.*);/)) return res.headers['content-disposition'].match(/filename=(.*);/)[1]
    if (res.headers['content-disposition'].match(/filename="(.*)"/)) return res.headers['content-disposition'].match(/filename="(.*)"/)[1]
    if (res.headers['content-disposition'].match(/filename=(.*)/)) return res.headers['content-disposition'].match(/filename=(.*)/)[1]
  }
  if (res.request && res.request.res && res.request.res.responseUrl) return decodeURIComponent(path.parse(res.request.res.responseUrl).base)
}

export const fetchSFTP = async (processingConfig, tmpFile) => {
  const url = new URL(processingConfig.url)
  const sftp = new SFTPClient()
  await sftp.connect({ host: url.hostname, port: url.port, username: processingConfig.username, password: processingConfig.password })
  await sftp.get(url.pathname, tmpFile)
  console.log(tmpFile)
  return processingConfig.filename || decodeURIComponent(path.basename(url.pathname))
}

export const fetchFTP = async (processingConfig, tmpFile) => {
  const url = new URL(processingConfig.url)
  const ftp = new FTPClient()
  ftp.connect({ host: url.hostname, port: url.port, user: processingConfig.username, password: processingConfig.password })
  await once(ftp, 'ready')
  ftp.get = promisify(ftp.get)
  const stream = await ftp.get(url.pathname)
  await pump(stream, fs.createWriteStream(tmpFile))
  return processingConfig.filename || decodeURIComponent(path.basename(url.pathname))
}
