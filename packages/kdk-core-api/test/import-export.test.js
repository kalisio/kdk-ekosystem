import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import core, { createApplication, hooks } from '../src/index.js'

describe('core:import-export', () => {
  let app, server, port, usersService, storageService, importExportService

  beforeAll(async () => {
    app = createApplication()
    // Register log hook
    app.hooks({ error: { all: hooks.log } })
    port = 3100 + Math.floor(Math.random() * 100)
    await app.db.connect()
    await app.db.instance.dropDatabase()
  })

  it('registers the services', async () => {
    await app.configure(core)
    // Ensure the users service exist
    usersService = app.getService('users')
    expect(usersService).toBeDefined()
    // Ensure the storage service exist
    storageService = app.getService('storage')
    expect(storageService).toBeDefined()
    // Ensure the expoter service exist
    importExportService = app.getService('import-export')
    expect(importExportService).toBeDefined()
    // Now app is configured launch the server
    server = await app.listen(port)
    await new Promise(resolve => server.once('listening', () => resolve()))
  }, 10000)

  it('create a user collection', () => {
    const users = []
    for (let i = 0; i < 5000; i++) {
      users.push({
        email: `kalisio${i}@kalisio.xyz`,
        password: 'Pass;word1',
        description: 'Description for kalisio$[i}',
        name: `user${i}`
      })
    }
    return usersService._create(users, { noVerificationEmail: true })
  }, 50000)

  it('export users collection in json', async () => {
    const response = await importExportService.create({
      method: 'export',
      servicePath: 'api/users',
      transform: {
        omit: ['_id']
      }
    })
    expect(response.SignedUrl).toBeDefined()
    await storageService.remove('import-export/' + response.id)
  }, 30000)

  it('export users collection in csv', async () => {
    const response = await importExportService.create({
      method: 'export',
      servicePath: 'api/users',
      transform: {
        omit: ['_id']
      },
      format: 'csv'
    })
    expect(response.SignedUrl).toBeDefined()
    await storageService.remove('import-export/' + response.id)
  }, 30000)

  // Cleanup
  afterAll(async () => {
    if (server) await server.close()
    await app.db.instance.dropDatabase()
    await app.db.disconnect()
  })
})
