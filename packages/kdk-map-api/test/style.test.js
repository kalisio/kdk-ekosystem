import { expect, describe, it, beforeAll, afterAll } from 'vitest'
import core, { kdk, hooks as coreHooks } from '@kalisio/kdk-core-api'
import map from '../kdk-map-api/src/index.js'

describe('map:styles', () => {
  let app, server, port, usersService, stylesService, tagsService

  beforeAll(async () => {
    app = kdk()
    // Register log hook
    app.hooks({ error: { all: coreHooks.log } })
    port = app.get('port')
    await app.db.connect()
  })

  it('registers the services', async () => {
    await app.configure(core)
    usersService = app.getService('users')
    expect(usersService).toBeDefined()
    tagsService = app.getService('tags')
    expect(tagsService).toBeDefined()
    await app.configure(map)
    stylesService = app.getService('styles')
    expect(stylesService).toBeDefined()
    server = await app.listen(port)
    await new Promise(resolve => server.once('listening', () => resolve()))
  }, 10000)

  it('create style', async () => {
    const style = await stylesService.create({ name: 'style' })
    const response = await stylesService.find({ query: { name: 'style' } })
    expect(response.data.length > 0).toBe(true)
    expect(response.data[0]._id.toString()).toBe(style._id.toString())
  }, 10000)

  it('ensure style name uniqueness', async () => {
    // Can't create name
    let doublonStyle
    try {
      doublonStyle = await stylesService.create({ name: 'style' })
    } catch (error) {
      expect(error).toBeDefined()
      // expect(error.name).toBe('Conflict')
      // expect(error.data.translation.key).toBe('OBJECT_ID_ALREADY_TAKEN')
    }
    expect(doublonStyle).toBeUndefined()
  }, 10000)

  it('create and update tag', async () => {
    const tag = await tagsService.create({ service: 'styles', property: 'tags', name: 'emissary', description: 'My description', color: '#F05F40' })
    const style = await stylesService.create({ name: 'style2', tags: [{ name: 'emissary', description: 'My description', color: '#F05F40' }] })
    const response = await stylesService.find({ query: { name: 'style2' } })
    expect(response.data.length > 0).toBe(true)
    expect(response.data[0]._id.toString()).toBe(style._id.toString())
    expect(response.data[0].tags.length).toBe(1)
    expect(response.data[0].tags[0].name).toBe('emissary')

    // Update tag
    const updatedTag = await tagsService.patch(tag._id, { color: '#FF0000' })
    expect(updatedTag.color).toBe('#FF0000')
    const updatedStyle = await stylesService.get(style._id)
    expect(updatedStyle.tags.length).toBe(1)
    expect(updatedStyle.tags[0].color).toBe('#FF0000')
  })

  it('delete tag', async () => {
    const tag = await tagsService.find({ query: { name: 'emissary' } })
    expect(tag.data.length > 0).toBe(true)
    const deletedTag = await tagsService.remove(tag.data[0]._id)
    expect(deletedTag._id.toString()).toBe(tag.data[0]._id.toString())
    const style = await stylesService.find({ query: { name: 'style2' } })
    expect(style.data.length > 0).toBe(true)
    expect(style.data[0].tags.length).toBe(0)
  })

  // Cleanup
  afterAll(async () => {
    if (server) await server.close()
    await app.db.instance.dropDatabase()
    await new Promise(resolve => setTimeout(resolve, 500))
    await app.db.disconnect()
  })
})
