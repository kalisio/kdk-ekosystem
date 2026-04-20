import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import core, { kdk, hooks } from '../src/index.js'

describe('core:tags', () => {
  let app, server, port, usersService, tagsService

  beforeAll(async () => {
    app = kdk()
    // Register log hook
    app.hooks({ error: { all: hooks.log } })
    port = app.get('port')
    await app.db.connect()
  })

  it('registers the services', async () => {
    await app.configure(core)
    usersService = app.getService('users')
    expect(usersService).toBeDefined()
    tagsService = app.getService('tags')
    expect(tagsService).toBeDefined()
    server = await app.listen(port)
    await new Promise(resolve => server.once('listening', () => resolve()))
  }, 10000)

  it('create tag', async () => {
    const style = await tagsService.create({ service: 'styles', property: 'tags', value: 'emissary', description: 'My description', color: '#F05F40' })
    const response = await tagsService.find({ query: { value: 'emissary' } })
    expect(response.data.length > 0).toBe(true)
    expect(response.data[0]._id.toString()).toBe(style._id.toString())
  }, 10000)

  it('update tag', async () => {
    const tag = await tagsService.find({ query: { value: 'emissary' } })
    expect(tag.data.length > 0).toBe(true)
    const updatedTag = await tagsService.patch(tag.data[0]._id, { color: '#FF0000' })
    expect(updatedTag.color).toBe('#FF0000')
  }, 10000)

  it('delete tag', async () => {
    const tag = await tagsService.find({ query: { value: 'emissary' } })
    expect(tag.data.length > 0).toBe(true)
    const deletedTag = await tagsService.remove(tag.data[0]._id)
    expect(deletedTag._id.toString()).toBe(tag.data[0]._id.toString())
    // Need to let some time to proceed some async tasks when updating tags
    await new Promise(resolve => setTimeout(resolve, 2000))
  }, 10000)

  // Cleanup
  afterAll(async () => {
    if (server) await server.close()
    await app.db.instance.dropDatabase()
    await app.db.disconnect()
  })
})
