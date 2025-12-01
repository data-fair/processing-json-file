import { describe, it } from 'node:test'
import config from '../lib/config.js'
import { run } from '../index.js'
import assert from 'assert'
import { convert } from '../lib/convert.ts'
import example from './example.json' assert { type: 'json' };
import processingConfig from './processing-config.json' assert { type: 'json' };

import processingConfigSchema from '../plugin-config-schema.json' assert { type: 'json' }
import pluginConfigSchema from '../plugin-config-schema.json' assert { type: 'json' }

describe('JSON file processing', () => {
  it('should expose a plugin config schema for super admins', async () => {
    assert.ok(pluginConfigSchema)
  })

  it('should expose a processing config schema for users', async () => {
    assert.equal(processingConfigSchema.type, 'object')
  })

// it('should get values by path', async () => {
//    let data = convert(example, processingConfig)
//     console.log(data)
//   })

// it('should process remote file', async () => {
//   processingConfig.username = config.username
//   processingConfig.password = config.password
//   processingConfig.dataset = config.dataset
//   processingConfig.url = config.url
//   const testsUtils = await import('@data-fair/lib-processing-dev/tests-utils.js')
//     const context = testsUtils.context({
//       pluginConfig: {},
//       processingConfig,
//       tmpDir: 'data'
//     }, config, true)
//     await run(context)
//   })

  // it('should process remote file', async () => {
  // // processingConfig.dataset = config.dataset
  // processingConfig.url = 'https://www.data.gouv.fr/api/1/datasets/r/a4aeb850-e41d-420d-8124-c7dfdc160410'
  // delete processingConfig.block.expand
  // processingConfig.block.mapping = [{ "key": "adresse", "path": "adresse" }]
  // const testsUtils = await import('@data-fair/lib-processing-dev/tests-utils.js')
  //   const context = testsUtils.context({
  //     pluginConfig: {},
  //     processingConfig,
  //     tmpDir: 'data'
  //   }, config, true)
  //   await run(context)
  // })

})
