import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'url'
import request from 'superagent'
import { Blob } from 'buffer'
import core, { kdk, hooks } from '../src/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('core:storage', () => {
  let app, server, port, baseUrl, userService, userObject, storageService, storageObject, jwt
  const content = Buffer.from('some buffered data')
  const type = 'text/plain'
  const id = 'buffer.txt'
  const file = 'logo.png'
  const fileType = 'image/png'
  const filePath = path.join(__dirname, 'data', file)
  const fileContent = fs.readFileSync(filePath, 'utf8')
  const blob = new Blob([fileContent], { type: fileType })

  beforeAll(async () => {
    app = kdk()
    // Register log hook
    app.hooks({ error: { all: hooks.log } })
    port = 3100 + Math.floor(Math.random() * 100)
    baseUrl = `http://localhost:${port}${app.get('apiPath')}`
    await app.db.connect()
    await app.db.instance.dropDatabase()
  })

  it('registers the storage service', async () => {
    await app.configure(core)
    userService = app.getService('users')
    expect(userService).toBeDefined()
    storageService = app.getService('storage')
    expect(storageService).toBeDefined()
    // Now app is configured launch the server
    server = await app.listen(port)
    await new Promise(resolve => server.once('listening', () => resolve()))
  }, 5000)

  it('creates and authenticate a user', async () => {
    userObject = await userService.create({ email: 'test@test.org', password: 'Pass;word1', name: 'test-user' })
    const response = await request
      .post(`${baseUrl}/authentication`)
      .send({ email: 'test@test.org', password: 'Pass;word1', strategy: 'local' })
    expect(response.body.accessToken).toBeDefined()
    jwt = response.body.accessToken
  }, 5000)

  it('creates an object in storage', async () => {
    const object = await storageService.putObject({ id, buffer: content, type })
    storageObject = object
    expect(storageObject._id).toBe(`${id}`)
  }, 10000)

  it('gets an object from storage', async () => {
    const object = await storageService.get(id)
    storageObject = object
    expect(storageService.atob(storageObject.buffer).toString()).toBe(content.toString())
  }, 5000)

  it('gets an object from storage with middleware', async () => {
    const response = await request
      .get(`${baseUrl}/storage-objects/${id}`)
      .query({ jwt })
    expect(response.text).toBe(content.toString())
  }, 5000)

  it('removes an object from storage', async () => {
    await storageService.remove(id)
    let error
    try {
      await storageService.get(id)
    } catch (e) {
      error = e
    }
    expect(error).toBeDefined()
  }, 5000)

  it('uploads a file in storage', async () => {
    const { UploadId } = await storageService.createMultipartUpload({ id: file, type: fileType })
    // A single part will be sufficient
    const { ETag } = await storageService.uploadPart({
      id: file,
      buffer: await blob.slice(0, 1024 * 1024 * 5).arrayBuffer(),
      type: blob.type,
      PartNumber: 1,
      UploadId
    })
    await storageService.completeMultipartUpload({ id: file, UploadId, parts: [{ PartNumber: 1, ETag }] })
  }, 10000)

  it('gets a file from storage', async () => {
    const object = await storageService.get(file)
    storageObject = object
    expect(storageService.atob(storageObject.buffer).toString()).toBe(fileContent.toString())
  }, 5000)

  it('gets a file from storage with middleware', async () => {
    const response = await request
      .get(`${baseUrl}/storage-objects/${file}`)
      .query({ jwt })
    expect(response.body.toString()).toBe(fileContent.toString())
  }, 5000)

  it('removes a file from storage', async () => {
    await storageService.remove(file)
    let error
    try {
      await storageService.get(file)
    } catch (e) {
      error = e
    }
    expect(error).toBeDefined()
  }, 5000)

  // Cleanup
  afterAll(async () => {
    await userService.remove(userObject._id)
    if (server) await server.close()
    await app.db.instance.dropDatabase()
    await app.db.disconnect()
  })
})
