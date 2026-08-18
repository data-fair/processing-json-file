import type { AxiosInstance } from 'axios'
import fs from 'fs-extra'
import FormData from 'form-data'

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} o`
  const units = ['ko', 'Mo', 'Go', 'To']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

const getContentLength = (formData: FormData): Promise<number> => {
  return new Promise((resolve, reject) => {
    formData.getLength((err, length) => {
      if (err) reject(err)
      else resolve(length)
    })
  })
}

export interface UploadOptions {
  // absolute path of the file to send
  filePath: string
  // name the file is sent under. data-fair derives the format from its extension,
  // and the dataset title from it when no title is given.
  filename: string
  // id of the dataset to update, or undefined to create a new one
  datasetId?: string
  title?: string
  origin?: string
}

// Load a file dataset: a multipart upload to data-fair, which then detects the
// columns and their types by itself. Creates the dataset when no id is given.
export const uploadFileDataset = async (axios: AxiosInstance, options: UploadOptions) => {
  const formData = new FormData()
  if (options.title) formData.append('title', options.title)
  if (options.origin) formData.append('origin', options.origin)
  formData.append('file', fs.createReadStream(options.filePath), { filename: options.filename })
  const contentLength = await getContentLength(formData)

  const dataset = (await axios({
    method: 'post',
    url: options.datasetId ? `api/v1/datasets/${options.datasetId}` : 'api/v1/datasets',
    data: formData,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: { ...formData.getHeaders(), 'content-length': contentLength }
  })).data

  return { dataset, contentLength }
}
