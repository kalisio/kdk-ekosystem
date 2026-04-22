import { expect, describe, it, beforeAll, afterAll } from 'vitest'
import _ from 'lodash'
import moment from 'moment'
import path from 'path'
import fs from 'fs-extra'
import { fileURLToPath } from 'url'
import core, { kdk, hooks, permissions } from '../kdk-core-api/src/index.js'
import map, {
  permissions as mapPermissions, createFeaturesService, createCatalogService
} from '../kdk-map-api/src/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('map:services', () => {
  let app, server, port, // baseUrl,
    userService, userObject, catalogService, defaultLayers,
    zones, zonesService, vigicruesStationsService, nbStations, vigicruesObsService,
    adsbObsService, openradiationService, items, eventListeners, eventCount, eventData

  function eventsOn (service) {
    eventListeners = {}
    eventCount = {
      created: 0,
      updated: 0,
      patched: 0,
      removed: 0
    }
    eventData = {}
    _.forOwn(eventCount, (value, key) => {
      eventListeners[key] = countEvents(key)
      service.on(key, eventListeners[key])
    })
  }
  function eventsOff (service) {
    _.forOwn(eventCount, (value, key) => {
      service.off(key, eventListeners[key])
    })
  }
  function countEvents (event) {
    return function (data) {
      eventCount[event]++
      eventData[event] = data
    }
  }
  function getEventCount (event) {
    return eventCount[event]
  }
  function getEventData (event) {
    return eventData[event]
  }

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
  })

  it('is ES module compatible', () => {
    expect(typeof map).toBe('function')
  })

  it('registers the services', async () => {
    await app.configure(core)
    userService = app.getService('users')
    expect(userService).toBeDefined()
    await app.configure(map)
    // Create a global catalog service
    await createCatalogService.call(app)
    catalogService = app.getService('catalog')
    expect(catalogService).toBeDefined()
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
  })

  it('create and feed the zones service', async () => {
    // Create the service
    const zonesLayer = _.find(defaultLayers, { name: 'zones' })
    expect(zonesLayer).toBeDefined()
    expect(zonesLayer.service === 'zones').toBe(true)
    await createFeaturesService.call(app, {
      collection: zonesLayer.service,
      featureId: zonesLayer.featureId
    })
    zonesService = app.getService(zonesLayer.service)
    expect(zonesService).toBeDefined()
    // Ensure the spatial index
    const indexes = await zonesService.options.Model.indexes()
    expect(indexes.find(index => index.key.geometry)).toBeDefined()
    // Check for events
    eventsOn(zonesService)
    // Feed the collection
    zones = fs.readJsonSync(path.join(__dirname, 'data/zones.json')).features
    items = await zonesService.create(zones)
  }, 15000)

  it('upsert data in zones service', async () => {
    const result = await zonesService.patch(null, {
      type: 'Feature',
      id: 100,
      geometry: zones[0].geometry,
      properties: {
        OBJECTID: 100
      }
    }, { query: { id: 100, upsert: true } })
    const feature = result[0]
    expect(feature._id).toBeDefined()
    expect(feature.geometry).toBeDefined()
    expect(feature.properties).toBeDefined()
    expect(feature.properties.OBJECTID).toBe(100)
  }, 15000)

  it('the zones service should skip events and siplify result', async () => {
    // By default multi events are skipped and result simplified
    eventsOff(zonesService)
    expect(getEventCount('created')).toBe(0)
    items.forEach(item => {
      expect(item._id).toBeDefined()
      expect(item.geometry).toBeUndefined()
      expect(item.properties).toBeUndefined()
    })
    // But not on single item
    expect(getEventCount('patched')).toBe(1)
    const payload = getEventData('patched')
    expect(payload._id).toBeDefined()
    expect(payload.geometry).toBeDefined()
    expect(payload.properties).toBeDefined()
    expect(payload.properties.OBJECTID).toBe(100)
  })

  it('performs spatial filtering on zones service', async () => {
    let result = await zonesService.find({
      query: { longitude: 3.56, latitude: 48.53 },
      paginate: false
    })
    expect(result.features.length).toBe(1)
    result = await zonesService.find({
      query: { longitude: 3.50, latitude: 48.54 },
      paginate: false
    })
    expect(result.features.length).toBe(0)
    result = await zonesService.find({
      query: { south: 44, north: 44.9, east: 4.7, west: 1.66 },
      paginate: false
    })
    expect(result.features.length).toBe(2)
    result = await zonesService.find({
      query: { south: 44, north: 44.9, east: 4, west: 2 },
      paginate: false
    })
    expect(result.features.length).toBe(0)
  }, 15000)

  it('create and feed the vigicrues stations service', async () => {
    // Create the service
    const vigicruesStationsLayer = _.find(defaultLayers, { name: 'vigicrues-stations' })
    expect(vigicruesStationsLayer).toBeDefined()
    expect(vigicruesStationsLayer.service === 'vigicrues-stations').toBe(true)
    await createFeaturesService.call(app, {
      collection: vigicruesStationsLayer.service,
      featureId: vigicruesStationsLayer.featureId,
      featureLabel: vigicruesStationsLayer.featureLabel
    })
    vigicruesStationsService = app.getService(vigicruesStationsLayer.service)

    expect(vigicruesStationsService).toBeDefined()
    // Feed the collection
    const stations = fs.readJsonSync(path.join(__dirname, 'data/vigicrues.stations.json')).features
    nbStations = stations.length
    await vigicruesStationsService.create(stations)
  }, 15000)

  it('create and feed the vigicrues observations service', async () => {
    // Create the service
    const vigicruesObsLayer = _.find(defaultLayers, { name: 'vigicrues-observations' })
    expect(vigicruesObsLayer).toBeDefined()
    expect(vigicruesObsLayer.service === 'vigicrues-observations').toBe(true)
    await createFeaturesService.call(app, {
      collection: vigicruesObsLayer.service,
      featureId: vigicruesObsLayer.featureId,
      featureLabel: vigicruesObsLayer.featureLabel,
      variables: vigicruesObsLayer.variables,
      // Raise simplified events
      skipEvents: ['updated'],
      simplifyEvents: ['created', 'patched', 'removed']
    })
    vigicruesObsService = app.getService(vigicruesObsLayer.service)
    expect(vigicruesObsService).toBeDefined()
    // Check for events
    eventsOn(vigicruesObsService)
    // Feed the collection
    const observationsH = fs.readJsonSync(path.join(__dirname, 'data/vigicrues.observations.H.json'))
    await vigicruesObsService.create(observationsH)
    const observationsQ = fs.readJsonSync(path.join(__dirname, 'data/vigicrues.observations.Q.json'))
    await vigicruesObsService.create(observationsQ)
  }, 15000)

  it('search on the vigicrues stations service', async () => {
    // Fuzzy search
    let result = await vigicruesStationsService.find({ query: { 'properties.LbStationH': { $search: 'Châtel' } }, paginate: false })
    expect(result.features).toBeDefined()
    expect(result.features.length).toBe(2)
    // Diacritic search
    result = await vigicruesStationsService.find({ query: { 'properties.LbStationH': { $search: 'Chatel' } }, paginate: false })
    expect(result.features.length).toBe(2)
    // Distinct search
    result = await vigicruesStationsService.find({ query: { $distinct: 'properties.LbStationH' } })
    expect(result.length).toBe(nbStations)
  }, 15000)

  it('the vigicrues observations should send simplified events', async () => {
    const min = moment.utc('2018-10-22T22:00:00.000Z')
    const max = moment.utc('2018-11-23T08:06:00.000Z')
    const start = min
    const end = moment.utc('2018-10-23T00:00:00.000Z')
    await vigicruesObsService.patch(null, { 'properties.ProjCoord': 27 }, { query: { time: { $gte: start, $lte: end }, 'properties.H': { $exists: true } } })
    await vigicruesObsService.remove(null, { query: { 'properties.ProjCoord': 27, 'properties.H': { $exists: true } } })
    // Check for simplified events
    eventsOff(vigicruesObsService)
    expect(getEventCount('created')).toBe(2)
    let payload = getEventData('created')
    expect(payload.data).toBeUndefined()
    expect(payload.total).toBe(1344)
    expect(payload.query).toEqual({})
    expect(payload.startTime).toBeDefined()
    expect(payload.endTime).toBeDefined()
    expect(payload.startTime.format()).toBe(start.format())
    expect(payload.endTime.format()).toBe(max.format())
    expect(payload.bbox).toEqual([7.426402, 48.633727, 7.426402, 48.633727])
    expect(payload.layers).toEqual([])
    expect(getEventCount('patched')).toBe(1)
    payload = getEventData('patched')
    expect(payload.data).toEqual({ 'properties.ProjCoord': 27 })
    expect(payload.total).toBe(3)
    const gte = _.get(payload, 'query.time.$gte')
    expect(gte).toBeDefined()
    expect(gte.format()).toBe(start.format())
    const lte = _.get(payload, 'query.time.$lte')
    expect(lte).toBeDefined()
    expect(lte.format()).toBe(end.format())
    expect(payload.startTime).toBeDefined()
    expect(payload.endTime).toBeDefined()
    expect(payload.startTime.format()).toBe(start.format())
    expect(payload.endTime.format()).toBe(end.format())
    expect(payload.bbox).toEqual([7.426402, 48.633727, 7.426402, 48.633727])
    expect(payload.layers).toEqual([])
    expect(getEventCount('removed')).toBe(1)
    payload = getEventData('removed')
    expect(payload.data).toBeUndefined()
    expect(payload.total).toBe(3)
    expect(payload.query).toEqual({ 'properties.ProjCoord': 27, 'properties.H': { $exists: true } })
    expect(payload.startTime).toBeDefined()
    expect(payload.endTime).toBeDefined()
    expect(payload.startTime.format()).toBe(start.format())
    expect(payload.endTime.format()).toBe(end.format())
    expect(payload.bbox).toEqual([7.426402, 48.633727, 7.426402, 48.633727])
    expect(payload.layers).toEqual([])
  })

  it('create and feed the ADS-B observations service', async () => {
    // Create the service
    const adsbObsLayer = _.find(defaultLayers, { name: 'adsb-observations' })
    expect(adsbObsLayer).toBeDefined()
    expect(adsbObsLayer.service === 'adsb-observations').toBe(true)
    await createFeaturesService.call(app, {
      collection: adsbObsLayer.service,
      featureId: adsbObsLayer.featureId,
      variables: adsbObsLayer.variables
    })
    adsbObsService = app.getService(adsbObsLayer.service)
    expect(adsbObsService).toBeDefined()
    // Feed the collection
    const observations = fs.readJsonSync(path.join(__dirname, 'data/adsb.observations.json'))
    await adsbObsService.create(observations)
    // We duplicate data for the aircraft with another target ID
    observations.forEach(observation => {
      observation.properties.icao = '885103'
    })
    await adsbObsService.create(observations)
  }, 15000)

  it('performs spatial filtering on vigicrues stations service', async () => {
    let result = await vigicruesStationsService.find({
      query: { south: -90, north: 90, east: 180, west: -180 },
      paginate: false
    })
    expect(result.features.length).toBe(nbStations)
    // Split world into two bboxes, this should given the same result when merged
    result = await vigicruesStationsService.find({
      query: { south: -90, north: 0, east: 180, west: -180 },
      paginate: false
    })
    expect(result.features.length).toBeLessThanOrEqual(nbStations)
    const firstHalf = result.features.length
    result = await vigicruesStationsService.find({
      query: { south: 0, north: 90, east: 180, west: -180 },
      paginate: false
    })
    expect(result.features.length).toBeLessThanOrEqual(nbStations)
    const secondHalf = result.features.length
    expect(firstHalf + secondHalf).toBe(nbStations)
    // Split world into two bboxes, this should given the same result
    result = await vigicruesStationsService.find({
      query: { south: [-90, 0], north: [0, 90], east: [180, 180], west: [-180, -180] },
      paginate: false
    })
    expect(result.features.length).toBe(nbStations)
    result = await vigicruesStationsService.find({
      query: { south: 80, north: 85, east: 180, west: -180 },
      paginate: false
    })
    expect(result.features.length).toBe(0)
    result = await vigicruesStationsService.find({
      query: { south: -85, north: -80, east: 180, west: -180 },
      paginate: false
    })
    expect(result.features.length).toBe(0)
    result = await vigicruesStationsService.find({
      query: { south: -20, north: 20, east: 100, west: -100 },
      paginate: false
    })
    expect(result.features.length).toBe(0)
    result = await vigicruesStationsService.find({
      query: {
        geometry: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [6.39, 48.31]
            },
            $maxDistance: 100000 // 100 Kms around
          }
        }
      },
      paginate: false
    })
    expect(result.features.length > 0).toBe(true)
  }, 15000)

  it('performs value filtering on vigicrues observations service', async () => {
    const result = await vigicruesObsService.find({
      query: {
        'properties.H': { $gt: 0.33, $lt: 0.5 }
      }
    })
    expect(result.features.length > 0).toBe(true)
  }, 15000)

  it('performs temporal filtering on vigicrues observations service', async () => {
    const result = await vigicruesObsService.find({
      query: {
        time: {
          $gte: new Date('2018-11-08T18:00:00').toISOString(),
          $lte: new Date('2018-11-08T22:00:00').toISOString()
        }
      }
    })
    expect(result.features.length > 0).toBe(true)
  }, 15000)

  const aggregationQuery = {
    time: {
      $gte: new Date('2018-11-08T18:00:00Z').toISOString(),
      $lte: new Date('2018-11-08T22:00:00Z').toISOString()
    },
    'properties.CdStationH': 'A282000101',
    $groupBy: 'CdStationH',
    $aggregate: ['H']
  }

  it('performs unauthorised element aggregation on vigicrues observations service', async () => {
    try {
      await vigicruesObsService.find({
        query: Object.assign({ $sort: { time: -1 }, $limit: 1, $group: { property: { $accumulator: { lang: 'js' } } } }, aggregationQuery)
      })
    } catch (error) {
      expect(error).toBeDefined()
      expect(error.name).toBe('Forbidden')
    }
    try {
      await vigicruesObsService.find({
        query: Object.assign({ $sort: { time: -1 }, $limit: 1, $group: { property: { $sum: { $function: { lang: 'js' } } } } }, aggregationQuery)
      })
    } catch (error) {
      expect(error).toBeDefined()
      expect(error.name).toBe('Forbidden')
    }
  }, 15000)

  it('performs element aggregation on vigicrues observations service', async () => {
    const result = await vigicruesObsService.find({
      query: Object.assign({}, aggregationQuery)
    })
    expect(result.features.length).toBe(1)
    const feature = result.features[0]
    expect(feature.time).toBeDefined()
    expect(feature.time.H).toBeDefined()
    expect(feature.time.H.length === 5).toBe(true)
    expect(feature.time.H[0].isBefore(feature.time.H[1])).toBe(true)
    expect(feature.properties.H.length === 5).toBe(true)
  }, 15000)

  it('performs sorted element aggregation on vigicrues observations service', async () => {
    const result = await vigicruesObsService.find({
      query: Object.assign({ $sort: { time: -1 } }, aggregationQuery)
    })
    expect(result.features.length).toBe(1)
    const feature = result.features[0]
    expect(feature.time).toBeDefined()
    expect(feature.time.H).toBeDefined()
    expect(feature.time.H.length === 5).toBe(true)
    expect(feature.time.H[0].isAfter(feature.time.H[1])).toBe(true)
    expect(feature.properties.H.length === 5).toBe(true)
  }, 15000)

  it('performs sorted single time element aggregation on vigicrues observations service', async () => {
    const result = await vigicruesObsService.find({
      query: Object.assign({ $sort: { time: -1 }, $limit: 1 }, aggregationQuery)
    })
    expect(result.features.length).toBe(1)
    const feature = result.features[0]
    expect(feature.time).toBeDefined()
    expect(feature.time.H).toBeDefined()
    expect(feature.time.H.isValid()).toBe(true)
    expect(feature.properties.H).toBeDefined()
    expect(typeof feature.properties.H).toBe('number')
    expect(feature.properties.H).toBe(0.38)
  }, 15000)

  it('performs custom element aggregation on vigicrues observations service', async () => {
    const result = await vigicruesObsService.find({
      query: Object.assign({ $sort: { time: -1 }, $limit: 1, $group: { maxH: { $max: '$properties.H' } } }, aggregationQuery)
    })
    expect(result.features.length).toBe(1)
    const feature = result.features[0]
    expect(feature.time).toBeDefined()
    expect(feature.time.H).toBeDefined()
    expect(feature.time.H.isValid()).toBe(true)
    expect(feature.properties.H).toBeDefined()
    expect(typeof feature.properties.H).toBe('number')
    expect(feature.properties.H).toBe(0.38)
    expect(feature.properties.maxH).toBeDefined()
    expect(typeof feature.properties.maxH).toBe('number')
    expect(feature.properties.maxH).toBe(0.39)
  }, 15000)

  it('performs multiple elements aggregation on vigicrues observations service', async () => {
    const result = await vigicruesObsService.find({
      query: Object.assign({}, aggregationQuery, { $aggregate: ['H', 'Q'] })
    })
    expect(result.features.length).toBe(1)
    const feature = result.features[0]
    expect(feature.time).toBeDefined()
    expect(feature.time.H).toBeDefined()
    expect(feature.time.Q).toBeDefined()
    expect(feature.time.H.length === 5).toBe(true)
    expect(feature.time.Q.length === 5).toBe(true)
    expect(feature.time.H[0].isBefore(feature.time.H[1])).toBe(true)
    expect(feature.time.Q[0].isBefore(feature.time.Q[1])).toBe(true)
    expect(feature.properties.H.length === 5).toBe(true)
    expect(feature.properties.Q.length === 5).toBe(true)
  }, 15000)

  it('performs sorted single time multiple elements aggregation on vigicrues observations service', async () => {
    const result = await vigicruesObsService.find({
      query: Object.assign({ $sort: { time: -1 }, $limit: 1 }, aggregationQuery, { $aggregate: ['H', 'Q'] })
    })
    expect(result.features.length).toBe(1)
    const feature = result.features[0]
    expect(feature.time).toBeDefined()
    expect(feature.time.H).toBeDefined()
    expect(feature.time.H.isValid()).toBe(true)
    expect(feature.time.Q).toBeDefined()
    expect(feature.time.Q.isValid()).toBe(true)
    expect(feature.properties.H).toBeDefined()
    expect(feature.properties.Q).toBeDefined()
    expect(typeof feature.properties.H).toBe('number')
    expect(typeof feature.properties.Q).toBe('number')
    expect(feature.properties.H).toBe(0.38)
    expect(feature.properties.Q).toBe(0.40)
  }, 15000)

  it('performs geometry aggregation on ADS-B observations service', async () => {
    const aggregationQuery = {
      time: {
        $lte: new Date('2019-01-04T13:58:54.767Z').toISOString()
      },
      'properties.icao': '885102',
      $groupBy: 'icao',
      $aggregate: ['geometry']
    }
    // Aggregation requires feature ID index to be built so we add some time to do so
    await new Promise(resolve => setTimeout(resolve))
    const result = await adsbObsService.find({ query: Object.assign({}, aggregationQuery) })
    expect(result.features.length).toBe(1)
    const feature = result.features[0]
    expect(feature.time).toBeDefined()
    expect(feature.time.geometry).toBeDefined()
    expect(feature.time.geometry.length === 4).toBe(true)
    expect(feature.time.geometry[0].isBefore(feature.time.geometry[1])).toBe(true)
    expect(feature.geometry.type).toBe('GeometryCollection')
    expect(feature.geometry.geometries).toBeDefined()
    expect(feature.geometry.geometries.length === 4).toBe(true)
  }, 10000)

  it('performs geometry and property aggregation on ADS-B observations service', async () => {
    const aggregationQuery = {
      time: {
        $lte: new Date('2019-01-04T13:58:54.767Z').toISOString()
      },
      $groupBy: 'icao',
      $aggregate: ['geometry', 'altitude']
    }
    // Aggregation requires feature ID index to be built so we add some time to do so
    await new Promise(resolve => setTimeout(resolve))
    const result = await adsbObsService.find({ query: Object.assign({}, aggregationQuery) })
    expect(result.features.length).toBe(2)
    result.features.forEach(feature => {
      expect(feature.time).toBeDefined()
      expect(feature.time.geometry).toBeDefined()
      expect(feature.time.geometry.length === 4).toBe(true)
      expect(feature.time.geometry[0].isBefore(feature.time.geometry[1])).toBe(true)
      expect(feature.geometry.type).toBe('GeometryCollection')
      expect(feature.geometry.geometries).toBeDefined()
      expect(feature.geometry.geometries.length === 4).toBe(true)
      expect(feature.properties).toBeDefined()
      expect(feature.properties.altitude).toBeDefined()
      expect(feature.properties.altitude.length === 4).toBe(true)
    })
  }, 10000)

  it('performs heatmap on ADS-B observations service', async () => {
    let results = await adsbObsService.heatmap({
      query: {
        'properties.icao': '885102',
        time: {
          $gte: new Date('2019-01-04T13:00:00.000Z').toISOString(),
          $lte: new Date('2019-01-04T14:00:00.000Z').toISOString()
        }
      },
      count: 'hour'
    })
    expect(results.length === 1).toBe(true)
    expect(results[0]).toEqual({ hour: 13, count: 4 })
    results = await adsbObsService.heatmap({
      query: {
        'properties.icao': '885102',
        time: {
          $gte: new Date('2019-01-04T13:00:00.000Z').toISOString(),
          $lte: new Date('2019-01-04T14:00:00.000Z').toISOString()
        }
      },
      count: 'hour',
      timezone: '+02:00'
    })
    expect(results.length === 1).toBe(true)
    expect(results[0]).toEqual({ hour: 15, count: 4 })
    results = await adsbObsService.heatmap({
      query: {
        'properties.icao': '885102',
        time: {
          $gte: new Date('2019-01-03T00:00:00.000Z').toISOString(),
          $lte: new Date('2019-01-05T00:00:00.000Z').toISOString()
        }
      },
      count: 'dayOfYear'
    })
    expect(results.length === 1).toBe(true)
    expect(results[0]).toEqual({ dayOfYear: 4, count: 5 })
    results = await adsbObsService.heatmap({
      query: {
        'properties.icao': '885102',
        time: {
          $gte: new Date('2019-01-03T00:00:00.000Z').toISOString(),
          $lte: new Date('2019-01-05T00:00:00.000Z').toISOString()
        }
      },
      count: ['hour', 'dayOfWeek']
    })
    expect(results.length === 2).toBe(true)
    results.forEach(result => {
      if (result.hour === 13) expect(result).toEqual({ hour: 13, dayOfWeek: 6, count: 4 })
      else expect(result).toEqual({ hour: 14, dayOfWeek: 6, count: 1 })
    })
  }, 10000)

  it('create and feed the openradiation service', async () => {
    // Create the service
    const openradiationLayer = _.find(defaultLayers, { name: 'openradiation' })
    expect(openradiationLayer).toBeDefined()
    expect(openradiationLayer.service === 'openradiation').toBe(true)
    await createFeaturesService.call(app, {
      collection: openradiationLayer.service,
      featureId: openradiationLayer.featureId,
      featureLabel: openradiationLayer.featureLabel,
      variables: openradiationLayer.variables,
      // Raise simplified events
      skipEvents: ['updated'],
      simplifyEvents: ['created', 'patched', 'removed']
    })
    openradiationService = app.getService(openradiationLayer.service)
    expect(openradiationService).toBeDefined()
    // Feed the collection
    const observations = fs.readJsonSync(path.join(__dirname, 'data/openradiation.json'))
    await openradiationService.create(observations)
  }, 15000)

  it('performs geometry and value aggregation on openradiation service, similar to gradient path query', async () => {
    const aggregationQuery = {
      'properties.userId': 'Yann29',
      time: {
        $gte: new Date('2025-05-24T12:00:00.00Z').toISOString(),
        $lte: new Date('2025-05-24T18:15:00.00Z').toISOString()
      },
      $groupBy: 'apparatusId',
      $aggregate: ['geometry', 'value'],
      $sort: { time: 1 }
    }
    // Aggregation requires feature ID index to be built so we add some time to do so
    await new Promise(resolve => setTimeout(resolve))
    const result = await openradiationService.find({ query: Object.assign({}, aggregationQuery) })
    expect(result.features.length).toBe(1)
    result.features.forEach(feature => {
      expect(feature.time).toBeDefined()
      expect(feature.time.geometry).toBeDefined()
      expect(feature.time.geometry.length).toBe(82)
      expect(feature.time.geometry[0].isBefore(feature.time.geometry[1])).toBe(true)
      expect(feature.time.value).toBeDefined()
      expect(feature.time.value.length).toBe(82)
      expect(feature.time.value[0].isBefore(feature.time.value[1])).toBe(true)
      expect(feature.time.value[0].isSame(feature.time.geometry[0])).toBe(true)
      expect(feature.geometry.type).toBe('GeometryCollection')
      expect(feature.geometry.geometries).toBeDefined()
      expect(feature.geometry.geometries.length).toBe(82)
      expect(feature.properties).toBeDefined()
      expect(feature.properties.value).toBeDefined()
      expect(feature.properties.value.length).toBe(82)
    })
  }, 10000)

  it('clears the layers', async () => {
    for (let i = 0; i < defaultLayers.length; ++i) {
      await catalogService.remove(defaultLayers[i]._id)
    }
    defaultLayers = await catalogService.find()
    expect(defaultLayers.data.length === 0).toBe(true)
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
    await zonesService.options.Model.drop()
    await vigicruesStationsService.options.Model.drop()
    await vigicruesObsService.options.Model.drop()
    await adsbObsService.options.Model.drop()
    await openradiationService.options.Model.drop()
    await catalogService.options.Model.drop()
    await userService.options.Model.drop()
    await app.db.disconnect()
  })
})
