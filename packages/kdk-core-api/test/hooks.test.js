import { describe, it, expect } from 'vitest'
import { memory } from '@feathersjs/memory'
import assert from 'node:assert'
import fuzzySearch from 'feathers-mongodb-fuzzy-search'
import { kdk, hooks } from '../src/index.js'
import { ObjectId } from 'mongodb'

describe('core:hooks', () => {
  it('sets expiry date', () => {
    const hook = {
      type: 'before',
      data: {},
      params: {}
    }
    hooks.setExpireAfter(7000)(hook)
    // Allow a difference of 1s due to execution time
    expect(Math.abs(hook.data.expireAt.getTime() - Date.now() - 7000000)).toBeLessThan(1000)
  })

  it('sets as deleted', () => {
    const hook = {
      type: 'before',
      data: {},
      params: {}
    }
    hooks.setAsDeleted(hook)
    expect(hook.data.deleted).toBe(true)
  })

  it('converts dates', () => {
    const now = new Date()
    const hook = {
      type: 'before',
      data: { date: now.toISOString() },
      params: {}
    }
    hooks.convertDates(['date'])(hook)
    expect(typeof hook.data.date).toBe('object')
    expect(hook.data.date.getTime()).toBe(now.getTime())
  })

  it('converts object IDs', () => {
    const id = new ObjectId()
    const hook = {
      type: 'before',
      data: { id: id.toString() },
      params: { query: { id: id.toString() } }
    }
    hooks.convertObjectIDs(['id'])(hook)
    expect(ObjectId.isValid(hook.data.id)).toBe(true)
    expect(hook.data.id.toString()).toBe(id.toString())
    expect(ObjectId.isValid(hook.params.query.id)).toBe(true)
    expect(hook.params.query.id.toString()).toBe(id.toString())
  })

  it('process object IDs', () => {
    const id = new ObjectId()
    const anotherId = new ObjectId()
    const hook = {
      type: 'before',
      data: {
        'field._id': id.toString(),
        objects: [{
          _id: id.toString(), date: new Date(), string: 'transmission'
        }, {
          _id: anotherId, date: new Date()
        }],
        date: new Date()
      },
      params: {
        query: {
          _id: { $in: [id.toString()] },
          id: anotherId,
          tags: { $in: ['transmission'] },
          array: [new Date(), new Date()]
        }
      }
    }
    hooks.processObjectIDs(hook)
    // Ensure we do not destructure objects
    expect(Object.keys(hook.data)).toEqual(['field._id', 'objects', 'date'])
    expect(hook.data.date instanceof Date).toBe(true)
    expect(ObjectId.isValid(hook.data['field._id'])).toBe(true)
    expect(hook.data['field._id'].toString()).toBe(id.toString())
    expect(Array.isArray(hook.data.objects)).toBe(true)
    expect(hook.data.objects.length).toBe(2)
    let object = hook.data.objects[0]
    expect(Object.keys(object)).toEqual(['_id', 'date', 'string'])
    expect(ObjectId.isValid(object._id)).toBe(true)
    expect(object._id.toString()).toBe(id.toString())
    expect(object.date instanceof Date).toBe(true)
    expect(typeof object.string === 'string').toBe(true)
    object = hook.data.objects[1]
    expect(Object.keys(object)).toEqual(['_id', 'date'])
    expect(ObjectId.isValid(object._id)).toBe(true)
    expect(object._id.toString()).toBe(anotherId.toString())
    expect(object.date instanceof Date).toBe(true)
    expect(Object.keys(hook.params.query)).toEqual(['_id', 'id', 'tags', 'array'])
    expect(Array.isArray(hook.params.query.array)).toBe(true)
    expect(hook.params.query.array.length).toBe(2)
    hook.params.query.array.forEach(value => {
      expect(value instanceof Date).toBe(true)
    })
    expect(ObjectId.isValid(hook.params.query._id.$in[0])).toBe(true)
    expect(hook.params.query._id.$in[0].toString()).toBe(id.toString())
    expect(ObjectId.isValid(hook.params.query.id)).toBe(true)
    expect(hook.params.query.id.toString()).toBe(anotherId.toString())
    expect(typeof hook.params.query.tags.$in[0] === 'string').toBe(true)
  })

  it('check uniqueness', async () => {
    const service = memory({
      store: {
        0: { name: 'xxx' },
        1: { name: 'yyy' }
      },
      paginate: { default: 5, max: 5 }
    })
    const hook = {
      type: 'before',
      method: 'create',
      data: { name: 'xxx' },
      service
    }
    await hooks.checkUnique({ field: 'dummy' })(hook)
    let error
    try {
      await hooks.checkUnique({ field: 'name' })(hook)
    } catch (err) {
      error = err
    }
    expect(error).toBeDefined()
    hook.method = 'patch'
    hook.id = 0
    await hooks.checkUnique({ field: 'dummy' })(hook)
    hook.id = 1
    try {
      await hooks.checkUnique({ field: 'name' })(hook)
    } catch (err) {
      error = err
    }
    expect(error).toBeDefined()
  })

  it('prevent changes', async () => {
    const hook = {
      type: 'before',
      method: 'patch',
      data: {
        name: 'zzz',
        secret: 'xxx',
        anotherSecret: 'yyy'
      }
    }
    let error
    try {
      await hooks.preventChanges(true, ['secret'])(hook)
      assert.fail('preventChanges should raise on error')
    } catch (e) {
      error = e
    }
    expect(error).toBeDefined()
    expect(error.name).toBe('BadRequest')

    try {
      await hooks.preventChanges(false, ['secret', 'anotherSecret'])(hook)
      expect(hook.data.name).toBe('zzz')
      expect(hook.data.secret).toBeUndefined()
      expect(hook.data.anotherSecret).toBeUndefined()
    } catch (e) {
      assert.fail('preventChanges should not raise on error')
    }

    // Check with dot notation
    hook.data['secret.value'] = 'xxx'
    try {
      await hooks.preventChanges(false, ['secret'])(hook)
      expect(hook.data.name).toBe('zzz')
      expect(hook.data.secret).toBeUndefined()
      expect(hook.data['secret.value']).toBeUndefined()
    } catch (e) {
      assert.fail('preventChanges should not raise on error')
    }
  })

  it('marshalls comparison queries', () => {
    const now = new Date()
    const hook = {
      type: 'before',
      params: {
        query: {
          number: { $gt: '0', $lt: '10' },
          date: { $gte: now.toISOString(), $lte: now.toISOString() }
        }
      }
    }
    hooks.marshallComparisonQuery(hook)
    expect(typeof hook.params.query.number.$gt).toBe('number')
    expect(typeof hook.params.query.number.$lt).toBe('number')
    expect(hook.params.query.number.$gt).toBe(0)
    expect(hook.params.query.number.$lt).toBe(10)
    expect(typeof hook.params.query.date.$gte).toBe('object')
    expect(typeof hook.params.query.date.$lte).toBe('object')
    expect(hook.params.query.date.$gte.getTime()).toBe(now.getTime())
    expect(hook.params.query.date.$lte.getTime()).toBe(now.getTime())
  })

  it('marshalls collation queries', () => {
    const hook = {
      type: 'before',
      params: { query: { $locale: 'fr' } }
    }
    hooks.marshallCollationQuery(hook)
    expect(hook.params.collation).toBeDefined()
    expect(hook.params.query.$locale).toBeUndefined()
    expect(typeof hook.params.collation).toBe('object')
    expect(hook.params.collation.locale).toBe('fr')
  })

  it('marshalls HTTP queries', () => {
    const now = new Date()
    const datetime = now.toISOString()
    const notADateTime = datetime.replace('T', 'Z')
    const query = {
      booleanTrue: 'true',
      booleanFalse: 'false',
      notABoolean: 'falsy',
      number: '223',
      notANumber: '22E',
      datetime,
      notADateTime
    }
    const hook = {
      type: 'before',
      params: { provider: 'socketio', query }
    }
    // Nothing should happen with websocket provider
    hooks.marshallHttpQuery(hook)
    expect(hook.params.query).toEqual(query)
    hook.params.provider = 'rest'
    hooks.marshallHttpQuery(hook)
    expect(hook.params.query.booleanTrue).toBe(true)
    expect(hook.params.query.booleanFalse).toBe(false)
    expect(hook.params.query.notABoolean).toBe('falsy')
    expect(hook.params.query.number).toBe(223)
    expect(hook.params.query.notANumber).toBe('22E')
    expect(hook.params.query.datetime.valueOf()).toBe(now.valueOf())
    expect(hook.params.query.notADateTime).toBe(notADateTime)
  })

  it('diacristic search', () => {
    const hook = {
      type: 'before',
      params: {
        query: { name: { $search: 'are' } }
      }
    }
    fuzzySearch({ fields: ['name'] })(hook)
    expect(hook.params.query.name.$regex).toBeDefined()
    expect(hook.params.query.name.$regex.source).toBe('are')
    hooks.diacriticSearch()(hook)
    // Non-diacritic items are changed
    expect(hook.params.query.name.$regex.source).toBe('[a,á,à,ä,â,ã]r[e,é,ë,è,ê]')
    // But not the other way araound by default
    hook.params.query.name = { $search: 'árë' }
    fuzzySearch({ fields: ['name'] })(hook)
    hooks.diacriticSearch()(hook)
    expect(hook.params.query.name.$regex.source).toBe('árë')
    // Ensure it works on complex queries
    hook.params.query = { $or: [{ name: { $search: 'are' } }, { name: { $search: 'árë' } }] }
    fuzzySearch({ fields: ['name'] })(hook)
    hooks.diacriticSearch()(hook)
    expect(hook.params.query.$or[0].name.$regex.source).toBe('[a,á,à,ä,â,ã]r[e,é,ë,è,ê]')
    expect(hook.params.query.$or[1].name.$regex.source).toBe('árë')
  })

  it('rate limiting', () => {
    const limiter = hooks.rateLimit({ tokensPerInterval: 2, interval: 60 * 1000, method: 'create', service: 'service' }) // 2 per minute
    const hook = {
      type: 'before',
      method: 'create',
      data: {},
      params: {},
      service: { name: 'service' }
    }
    let caught
    try {
      limiter(hook)
      hook.n = 1
      limiter(hook)
      hook.n = 2
      // Should rise after 2 calls
      limiter(hook)
      hook.n = 3
    } catch (error) {
      caught = error
    }
    expect(caught).toBeDefined()
    expect(caught.name).toBe('TooManyRequests')
    expect(hook.n).toBe(2)
  })

  it('count limiting', async () => {
    const limiter = hooks.countLimit({ count: (hook) => hook.n, max: 1 })
    const hook = {
      type: 'before',
      method: 'create',
      data: {},
      params: {},
      service: { name: 'service' },
      n: 0
    }
    let caught
    try {
      await limiter(hook)
      hook.n = 1
      await limiter(hook)
      hook.n = 2
      // Should rise after 2 calls
      await limiter(hook)
      hook.n = 3
    } catch (error) {
      caught = error
    }
    expect(caught).toBeDefined()
    expect(caught.name).toBe('Forbidden')
    expect(hook.n).toBe(2)
  })

  it('generate JWT', async () => {
    const app = kdk()
    const config = app.get('authentication')
    const hook = {
      type: 'before',
      app,
      data: {},
      params: { user: { _id: 'toto' } }
    }
    await hooks.createJWT()(hook)
    expect(typeof hook.data.accessToken).toBe('string')
    const payload = await app.getService('authentication').verifyAccessToken(hook.data.accessToken, config.jwtOptions)
    expect(payload.userId).toBeUndefined()
  })

  it('generate custom JWT', async () => {
    const app = kdk()
    const config = app.get('authentication')
    const hook = {
      type: 'before',
      app,
      data: {},
      params: { user: { _id: 'toto' } }
    }
    await hooks.createJWT({
      name: 'accessToken',
      jwt: user => ({ subject: user._id }),
      payload: user => ({ userId: user._id })
    })(hook)
    expect(typeof hook.data.accessToken).toBe('string')
    const payload = await app.getService('authentication').verifyAccessToken(hook.data.accessToken, config.jwtOptions)
    expect(payload.sub).toBe('toto')
    expect(payload.userId).toBe('toto')
  })
})
