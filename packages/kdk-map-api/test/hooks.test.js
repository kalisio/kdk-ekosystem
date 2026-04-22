import { expect, describe, it, beforeAll, afterAll } from 'vitest'
import _ from 'lodash'
import { hooks } from '../kdk-map-api/src/index.js'

describe('map:hooks', () => {
  beforeAll(() => {
  })

  it('marshalls geometry queries', () => {
    const hook = {
      type: 'before',
      params: {
        query: {
          geometry: { $near: { $geometry: { type: 'Point', coordinates: ['56', '0.3'] }, $maxDistance: '1000.50' } }
        }
      }
    }
    hooks.marshallGeometryQuery(hook)
    expect(typeof hook.params.query.geometry.$near.$geometry.coordinates[0]).toBe('number')
    expect(typeof hook.params.query.geometry.$near.$geometry.coordinates[1]).toBe('number')
    expect(hook.params.query.geometry.$near.$geometry.coordinates[0]).toBe(56)
    expect(hook.params.query.geometry.$near.$geometry.coordinates[1]).toBe(0.3)
    expect(typeof hook.params.query.geometry.$near.$maxDistance).toBe('number')
    expect(hook.params.query.geometry.$near.$maxDistance).toBe(1000.5)
    hook.params.query.geometry = {
      $geoWithin: {
        $centerSphere: [['56', '0.3'], (1000.50 / 6378137.0).toString()] // Earth radius as in radians
      }
    }
    hooks.marshallGeometryQuery(hook)
    expect(typeof hook.params.query.geometry.$geoWithin.$centerSphere[0][0]).toBe('number')
    expect(typeof hook.params.query.geometry.$geoWithin.$centerSphere[0][1]).toBe('number')
    expect(hook.params.query.geometry.$geoWithin.$centerSphere[0][0]).toBe(56)
    expect(hook.params.query.geometry.$geoWithin.$centerSphere[0][1]).toBe(0.3)
    expect(typeof hook.params.query.geometry.$geoWithin.$centerSphere[1]).toBe('number')
    expect(hook.params.query.geometry.$geoWithin.$centerSphere[1]).toBe(1000.50 / 6378137.0) // Earth radius as in radians
  })

  it('marshalls geometry queries using shortcuts', () => {
    const hook = {
      type: 'before',
      params: {
        query: {
          longitude: '56', latitude: '0.3', distance: '1000.50'
        }
      }
    }
    hooks.marshallSpatialQuery(hook)
    expect(typeof hook.params.query.geometry.$geoWithin.$centerSphere[0][0]).toBe('number')
    expect(typeof hook.params.query.geometry.$geoWithin.$centerSphere[0][1]).toBe('number')
    expect(hook.params.query.geometry.$geoWithin.$centerSphere[0][0]).toBe(56)
    expect(hook.params.query.geometry.$geoWithin.$centerSphere[0][1]).toBe(0.3)
    expect(typeof hook.params.query.geometry.$geoWithin.$centerSphere[1]).toBe('number')
    expect(hook.params.query.geometry.$geoWithin.$centerSphere[1]).toBe(1000.5 / 6378137.0) // Earth radius as in radians
    // From proximity to location query
    hook.params.query = { longitude: '56', latitude: '0.3' }
    hooks.marshallSpatialQuery(hook)
    expect(typeof hook.params.query.geometry.$geoIntersects.$geometry.coordinates[0]).toBe('number')
    expect(typeof hook.params.query.geometry.$geoIntersects.$geometry.coordinates[1]).toBe('number')
    expect(hook.params.query.geometry.$geoIntersects.$geometry.coordinates[0]).toBe(56)
    expect(hook.params.query.geometry.$geoIntersects.$geometry.coordinates[1]).toBe(0.3)
  })

  it('convert results as GeoJson', () => {
    const json = [{
      location: { lat: -4, lon: 33 },
      pickedProperty: '1',
      omittedProperty: '1'
    }, {
      location: { lat: 47, lon: -96 },
      pickedProperty: '2',
      omittedProperty: '2'
    }, {
      location: null,
      pickedProperty: '3',
      omittedProperty: '3'
    }]
    const hook = {
      type: 'after',
      params: {
        query: {
          geoJson: true
        }
      },
      result: _.cloneDeep(json)
    }
    hooks.marshallSpatialQuery(hook)
    hooks.asGeoJson({
      longitudeProperty: 'location.lon',
      latitudeProperty: 'location.lat',
      pick: ['pickedProperty'],
      properties: true
    })(hook)
    expect(hook.result.type).toBeDefined()
    expect(hook.result.type).toBe('FeatureCollection')
    expect(hook.result.features).toBeDefined()
    expect(hook.result.features.length).toBe(2)
    hook.result.features.forEach((feature, index) => {
      expect(feature.type).toBe('Feature')
      expect(feature.properties).toBeDefined()
      expect(feature.properties.pickedProperty).toBeDefined()
      expect(feature.properties.omittedProperty).toBeUndefined()
      expect(feature.geometry).toBeDefined()
      expect(feature.geometry.type).toBe('Point')
      expect(feature.geometry.coordinates).toBeDefined()
      if (index === 0) expect(feature.geometry.coordinates).toEqual([33, -4])
      if (index === 1) expect(feature.geometry.coordinates).toEqual([-96, 47])
    })
    hook.result = _.cloneDeep(json)
    hooks.asGeoJson({
      longitudeProperty: 'location.lon',
      latitudeProperty: 'location.lat',
      omit: ['omittedProperty', 'location'],
      properties: true,
      allowNullGeometries: true,
      asFeatureCollection: false
    })(hook)
    expect(Array.isArray(hook.result)).toBe(true)
    expect(hook.result.length).toBe(3)
    hook.result.forEach((feature, index) => {
      expect(feature.type).toBe('Feature')
      expect(feature.properties).toBeDefined()
      expect(feature.properties.pickedProperty).toBeDefined()
      expect(feature.properties.omittedProperty).toBeUndefined()
      if (index === 2) {
        expect(feature.geometry).toBeNull()
      } else {
        expect(feature.geometry).toBeDefined()
        expect(feature.geometry.type).toBe('Point')
        expect(feature.geometry.coordinates).toBeDefined()
        if (index === 0) expect(feature.geometry.coordinates).toEqual([33, -4])
        if (index === 1) expect(feature.geometry.coordinates).toEqual([-96, 47])
      }
    })
  })

  // Cleanup
  afterAll(() => {
  })
})
