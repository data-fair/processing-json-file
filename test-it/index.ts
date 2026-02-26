import { describe, it } from 'node:test'
import assert from 'assert'
import config from '../lib/config.ts'
import { run } from '../index.ts'
import { convert } from '../lib/convert.ts'

import testUtils from '@data-fair/lib-processing-dev/tests-utils.js'
import example from './resources/example.json' with { type: 'json' }
import processingConfig from './resources/processing-config.json' with { type: 'json' }

import processingConfigSchema from '../plugin-config-schema.json' with { type: 'json' }
import pluginConfigSchema from '../plugin-config-schema.json' with { type: 'json' }

describe('JSON file processing', () => {
  it('should expose a plugin config schema for super admins', async () => {
    assert.ok(pluginConfigSchema)
  })

  it('should expose a processing config schema for users', async () => {
    assert.equal(processingConfigSchema.type, 'object')
  })

  it('should get values by path', async () => {
    const data = convert(example, processingConfig)
    console.log(data)
  })

  it('should process remote file', async () => {
    processingConfig.username = config.username
    processingConfig.password = config.password
    processingConfig.dataset = config.dataset
    processingConfig.url = config.url
    const context = testUtils.context({
      pluginConfig: {},
      processingConfig,
      tmpDir: 'data'
    }, config, true)
    try {
      await run(context)
    } catch (err) {
      console.log(err)
    }
  })

  // it('should process remote file', async () => {
  //   // processingConfig.dataset = config.dataset
  //   processingConfig.url = 'https://www.data.gouv.fr/api/1/datasets/r/a4aeb850-e41d-420d-8124-c7dfdc160410'
  //   delete processingConfig.block.expand
  //   processingConfig.block.mapping = [{ key: 'adresse', path: 'adresse' }]
  //   const testsUtils = await import('@data-fair/lib-processing-dev/tests-utils.js')
  //   const context = testsUtils.context({
  //     pluginConfig: {},
  //     processingConfig,
  //     tmpDir: 'data'
  //   }, config, true)
  //   try {
  //     await run(context)
  //   } catch (err) {
  //     console.log(err)
  //   }
  // })
})
