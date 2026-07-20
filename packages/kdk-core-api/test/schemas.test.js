import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { memory } from '@feathersjs/memory'
import core, { createApplication, hooks, declareService } from '../src/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('core:schemas', () => {
  let app, service
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'schema.json'), 'utf8'))
  const invalidObjects = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'invalid-objects.json'), 'utf8'))
  const validObjects = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'valid-objects.json'), 'utf8'))

  beforeAll(async () => {
    app = createApplication()
    // Register log hook
    app.hooks({ error: { all: hooks.log } })
    await app.db.connect()
    await app.db.instance.dropDatabase()
  })

  it('registers the services', async () => {
    await app.configure(core)
    // Create default service to store data
    service = declareService('service', app, memory({ multi: true, operators: ['$exists'] }))
    service.hooks({
      before: {
        create: (hook) => hooks.validateData(schema)(hook)
      }
    })
  }, 10000)

  it('feed invalid objects', async () => {
    for (let i = 0; i < invalidObjects.length; i++) {
      const object = invalidObjects[i]
      let error
      try {
        await service.create(object)
      } catch (e) {
        error = e
      }
      expect(error).toBeDefined()
      expect(error.name).toBe('BadRequest')
    }
    const result = await service.find({ query: {}, paginate: false })
    expect(result.length === 0).toBe(true)
  }, 5000)

  it('feed valid objects', async () => {
    let error
    try {
      await service.create(validObjects)
    } catch (e) {
      error = e
    }
    expect(error).toBeUndefined()
    const result = await service.find({ query: {}, paginate: false })
    expect(result.length === 2).toBe(true)
  }, 5000)

  // Cleanup
  afterAll(async () => {
    await app.db.instance.dropDatabase()
    await sleep(100)
    await app.db.disconnect()
  })
})
