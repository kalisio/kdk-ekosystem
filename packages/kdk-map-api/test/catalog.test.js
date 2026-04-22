import { expect, describe, it, beforeAll, afterAll } from 'vitest'
import _ from 'lodash'
import path from 'path'
import fs from 'fs-extra'
import { fileURLToPath } from 'url'
import core, { kdk, hooks, permissions } from '../kdk-core-api/src/index.js'
import map, {
  permissions as mapPermissions, createCatalogService, createProjectsService
} from '../kdk-map-api/src/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('map:catalog', () => {
  let app, server, port, // baseUrl,
    userService, userObject, catalogService, defaultLayers,
    zonesLayer, vigicruesLayer, contextObject, projectService, projectObject

  beforeAll(() => {
    // Register all default hooks for authorisation
    // Default rules for all users
    permissions.defineAbilities.registerHook(permissions.defineUserAbilities)
    // Then rules for maps
    permissions.defineAbilities.registerHook(mapPermissions.defineUserAbilities)

    app = kdk()
    // Register authorisation/log hook
    app.hooks({
      before: { all: [hooks.authorise] },
      error: { all: hooks.log }
    })
    port = app.get('port')
    // baseUrl = `http://localhost:${port}${app.get('apiPath')}`
    return app.db.connect()
  }, 30000)

  it('registers the services', async () => {
    await app.configure(core)
    userService = app.getService('users')
    expect(userService).toBeDefined()
    await app.configure(map)
    // Create a global catalog/project service
    await createCatalogService.call(app)
    catalogService = app.getService('catalog')
    expect(catalogService).toBeDefined()
    await createProjectsService.call(app)
    projectService = app.getService('projects')
    expect(projectService).toBeDefined()
    // Now app is configured launch the server
    server = await app.listen(port)
  }, 15000)

  it('creates a test user', async () => {
    userObject = await userService.create({ email: 'test-user@test.org', name: 'test-user' }, { checkAuthorisation: true })
    const users = await userService.find({ query: { 'profile.name': 'test-user' }, user: userObject, checkAuthorisation: true })
    expect(users.data.length > 0).toBe(true)
  }, 15000)

  it('registers the default layer catalog', async () => {
    const layers = await fs.readJson(path.join(__dirname, 'config/layers.json'))
    expect(layers.length > 0).toBe(true)
    // Create a global catalog service
    defaultLayers = await catalogService.create(layers)
    expect(defaultLayers.length > 0).toBe(true)
    zonesLayer = _.find(defaultLayers, { name: 'zones' })
    vigicruesLayer = _.find(defaultLayers, { name: 'vigicrues-stations' })
  })

  it('manages layers, contexts and categories', async () => {
    const layer = await catalogService.create({ name: 'dummy', type: 'OverlayLayer' })
    // Can't duplicate name
    let doublonLayer
    try {
      doublonLayer = await catalogService.create({ name: 'dummy', type: 'OverlayLayer' })
    } catch (error) {
      expect(error).toBeDefined()
      expect(error.name).toBe('Conflict')
      expect(error.data.translation.key).toBe('OBJECT_ID_ALREADY_TAKEN')
    }
    expect(doublonLayer).toBeUndefined()
    // Can duplicate if we target different types
    let context = await catalogService.create({ name: 'dummy', type: 'Context', layers: ['dummy'] })
    let category = await catalogService.create({ name: 'dummy', type: 'Category', layers: ['dummy'] })
    // Check for context/category filtering by default
    const response = await catalogService.find({ query: {}, paginate: false })
    expect(response.length === defaultLayers.length + 1).toBe(true)
    // Check for automated context/category update whn layer is renamed/removed
    await catalogService.patch(layer._id.toString(), { name: 'oldDummy' })
    context = await catalogService.get(context._id.toString())
    expect(context.layers).toEqual(['oldDummy'])
    category = await catalogService.get(category._id.toString())
    expect(category.layers).toEqual(['oldDummy'])
    await catalogService.remove(layer._id.toString())
    context = await catalogService.get(context._id.toString())
    expect(context.layers).toEqual([])
    await catalogService.remove(context._id.toString())
    category = await catalogService.get(category._id.toString())
    expect(category.layers).toEqual([])
    await catalogService.remove(category._id.toString())
  }, 15000)

  it('creates a context', async () => {
    contextObject = await catalogService.create({ name: 'context', type: 'Context', layers: ['vigicrues-stations', 'zones'] })
    // Rename layer and check it has been updated in context
    zonesLayer = await catalogService.patch(zonesLayer._id, { name: 'new-zones' })
    contextObject = await catalogService.get(contextObject._id)
    expect(contextObject.layers).toEqual(['vigicrues-stations', 'new-zones'])
  })

  it('creates a project', async () => {
    projectObject = await projectService.create({
      name: 'project', views: [{ _id: contextObject._id }], layers: [{ _id: zonesLayer._id }, { name: vigicruesLayer.name }]
    })
    // Remove context and check it has been updated in project
    await catalogService.remove(contextObject._id)
    projectObject = await projectService.get(projectObject._id)
    expect(projectObject.views).toEqual([])
    // Remove layer and check it has been updated in project
    await catalogService.remove(zonesLayer._id)
    projectObject = await projectService.get(projectObject._id, { query: { populate: true } })
    expect(projectObject.layers).toEqual([{
      _id: vigicruesLayer._id,
      name: vigicruesLayer.name,
      service: vigicruesLayer.name
    }])
  })

  it('clears the catalog and projects', async () => {
    await catalogService.remove(null, { query: { } })
    const layers = await catalogService.find({ query: {}, paginate: false })
    expect(layers.length === 0).toBe(true)
    await projectService.remove(projectObject._id)
    const projects = await projectService.find({ query: {}, paginate: false })
    expect(projects.length === 0).toBe(true)
  })

  it('removes the test user', async () => {
    await userService.remove(userObject._id, {
      user: userObject,
      checkAuthorisation: true
    })
    const users = await userService.find({ query: { name: 'test-user' } })
    expect(users.data.length === 0).toBe(true)
  })

  // Cleanup
  afterAll(async () => {
    if (server) await server.close()
    await catalogService.Model.drop()
    await projectService.Model.drop()
    await userService.Model.drop()
    await app.db.disconnect()
  })
})
