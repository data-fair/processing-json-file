const getValueByPath = function (obj : any, path : string): any {
  if (!path) return obj
  const keys = path.split('.')
  const processed : any = []
  for (const key of keys) {
    processed.push(key)
    if (key.includes('[]')) {
      const k = key.split('[]')[0]
      if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) {
        return obj[k].map((o: any) => getValueByPath(o, path.replace(processed.join('.') + '.', ''))).filter((o: any) => o != null)
      }
    } else if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null) {
      obj = obj[key]
    } else {
      return null
    }
  }
  if (obj.constructor === Object) return Object.values(obj)
  else return obj
}

const process = function (data: any, block, separator: string, common = {}): Array<any> {
  let base = {}
  if (block?.mapping?.length) {
    base = Object.assign({}, ...block.mapping.map(m => {
      const values = getValueByPath(data, m.path)
      if (values == null) return {}
      return { [m.key]: (values.constructor === Array) ? values.join(separator) : getValueByPath(data, m.path) }
    }))
  }
  if (block?.expand?.path) {
    return [].concat(...getValueByPath(data, block.expand.path).map((d: any) => process(d, block.expand.block, separator, { ...base, ...common })))
  } else return [{ ...base, ...common }]
}

export const convert = (data: any, processingConfig): Array<any> => {
  const dataAsArray = (Array.isArray(data) ? data : [data])
  const processedData : Array<Array<any>> = dataAsArray.map(d => process(d, processingConfig.block, processingConfig.separator))
  return [].concat(...processedData)
}
