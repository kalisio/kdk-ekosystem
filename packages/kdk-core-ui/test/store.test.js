import { computed, effectScope, isRef, markRaw, nextTick } from 'vue'
import { Store, getStore } from '../src/index.js'

// Each test works on its own store, as the registry is shared within the file
let count = 0
function createTestStore (initialState) {
  count += 1
  return getStore(`test-${count}`, initialState)
}

describe('getStore', () => {
  it('returns the same store for the same name', () => {
    expect(getStore('shared')).toBe(getStore('shared'))
  })
  it('exposes the global store as Store', () => {
    expect(getStore('store')).toBe(Store)
  })
  it('creates distinct stores for inherited names', () => {
    const stores = ['toString', 'constructor', '__proto__'].map((name) => getStore(name))
    for (const store of stores) expect(store.set).toBeTypeOf('function')
    expect(new Set(stores).size).toBe(3)
  })
  it('does not mutate the initial state', () => {
    const initialState = { user: { name: 'Ana' } }
    const store = createTestStore(initialState)
    store.user.name = 'Bob'
    store.clear()
    expect(initialState).toEqual({ user: { name: 'Ana' } })
  })
  it('keeps the prototype of class instances in the initial state', () => {
    class Point { constructor (x) { this.x = x } norm () { return Math.abs(this.x) } }
    const store = createTestStore({ point: new Point(-2) })
    expect(store.point.norm()).toBe(2)
  })
  it('rejects reserved keys in the initial state', () => {
    expect(() => getStore('reserved', { on: 'data' })).toThrow('Store: "on" is a reserved key')
  })
})

describe('methods', () => {
  it('are hidden from iteration and serialization', () => {
    const store = createTestStore({ a: 1 })
    expect(Object.keys(store)).toEqual(['a'])
    expect(JSON.stringify(store)).toBe('{"a":1}')
  })
  it('cannot be overwritten', () => {
    const store = createTestStore()
    expect(() => { store.set = null }).toThrow()
    expect(() => store.set('set', 1)).toThrow('Store: "set" is a reserved key')
    expect(() => store.patch('get.x', {})).toThrow('reserved key')
    expect(() => store.unset('on')).toThrow('reserved key')
  })
  it('work when destructured', () => {
    const { set, get } = createTestStore()
    set('a', 1)
    expect(get('a')).toBe(1)
  })
  it('get a value by path, with a default value', () => {
    const store = createTestStore({ user: { name: 'Ana' } })
    expect(store.get('user.name')).toBe('Ana')
    expect(store.get('user.age', 30)).toBe(30)
  })
  it('get the whole store without path, but not with an empty one', () => {
    const store = createTestStore()
    expect(store.get()).toBe(store)
    expect(store.get('')).toBeUndefined()
  })
  it('check a path with has', () => {
    const store = createTestStore({ user: { name: 'Ana' } })
    expect(store.has('user.name')).toBe(true)
    expect(store.has('user.age')).toBe(false)
  })
  it('keeps has reactive when a property is added or removed', () => {
    const store = createTestStore({ user: {} })
    const hasName = computed(() => store.has('user.name'))
    expect(hasName.value).toBe(false)
    store.set('user.name', 'Ana')
    expect(hasName.value).toBe(true)
    store.unset('user.name')
    expect(hasName.value).toBe(false)
  })
  it('keeps has reactive when missing parents are created', () => {
    const store = createTestStore()
    const hasZoom = computed(() => store.has('map.camera.zoom'))
    expect(hasZoom.value).toBe(false)
    store.set('map.camera.zoom', 12)
    expect(hasZoom.value).toBe(true)
    store.unset('map.camera.zoom')
    expect(hasZoom.value).toBe(false)
  })
  it('distinguishes missing, null and undefined values', () => {
    const store = createTestStore({ user: { name: null, age: undefined } })
    expect(store.has('user.name')).toBe(true)
    expect(store.has('user.age')).toBe(true)
    expect(store.get('user.name', 'unknown')).toBeNull()
    expect(store.get('user.age', 30)).toBe(30)
    expect(store.get('user.unknown', 30)).toBe(30)
  })
  it('set a value and create missing intermediates', () => {
    const store = createTestStore()
    store.set('map.camera.zoom', 12)
    store.set('layers.0', 'osm')
    expect(store.map).toEqual({ camera: { zoom: 12 } })
    expect(store.layers).toEqual(['osm'])
  })
  it('unset a value', () => {
    const store = createTestStore({ user: { name: 'Ana', age: 30 } })
    store.unset('user.age')
    expect(store.user).toEqual({ name: 'Ana' })
  })
  it('accepts array and bracket-notation paths', () => {
    const store = createTestStore()
    store.set(['layers', 0, 'name'], 'osm')
    expect(store.get('layers[0].name')).toBe('osm')
    expect(store.has(['layers', 0, 'name'])).toBe(true)
    store.unset('layers[0].name')
    expect(store.has('layers[0].name')).toBe(false)
  })
  it('clear all keys but keep methods', () => {
    const store = createTestStore({ a: 1, b: 2 })
    store.clear()
    expect(Object.keys(store)).toEqual([])
    expect(store.set).toBeTypeOf('function')
  })
})

describe('paths', () => {
  it('reject writes through prototypes', () => {
    class Point {}
    const store = createTestStore({ point: new Point() })
    expect(() => store.set('__proto__.polluted', 1)).toThrow('Store: invalid path')
    expect(() => store.set('a.constructor.prototype.polluted', 1)).toThrow('Store: invalid path')
    expect(() => store.patch('point.__proto__', { polluted: true })).toThrow('Store: invalid path')
    expect(() => store.unset('constructor.prototype.toString')).toThrow('Store: invalid path')
    expect(() => store.unset(['constructor', 'prototype', 'toString'])).toThrow('Store: invalid path')
    expect({}.polluted).toBeUndefined()
    expect(Point.prototype.polluted).toBeUndefined()
    expect('toString' in {}).toBe(true)
  })
  it('reject writes through inherited properties', () => {
    class Point { norm () { return 1 } }
    const store = createTestStore({ point: new Point() })
    expect(() => store.set('valueOf.call', null)).toThrow('Store: invalid path')
    expect(() => store.set('toString.x', 1)).toThrow('Store: invalid path')
    expect(() => store.set('point.norm.x', 1)).toThrow('Store: invalid path')
    expect(Object.prototype.valueOf.call).toBeTypeOf('function')
    expect(Object.prototype.toString.x).toBeUndefined()
    expect(Point.prototype.norm.x).toBeUndefined()
  })
  it('allow own keys named like inherited properties', () => {
    const store = createTestStore()
    store.set('toString', 'data')
    expect(store.toString).toBe('data')
    expect(Object.prototype.toString).toBeTypeOf('function')
  })
  it('reject empty paths and empty keys on write', () => {
    const store = createTestStore()
    for (const path of ['', [], 'a..b', '.a', 'a.']) {
      expect(() => store.set(path, 1)).toThrow('Store: invalid path')
    }
  })
  it('read inherited properties like direct access does', () => {
    class Rect { constructor (w, h) { this.w = w; this.h = h } get area () { return this.w * this.h } }
    const store = createTestStore({ shape: new Rect(2, 3), layers: new Map([['osm', {}]]) })
    expect(store.get('shape.area')).toBe(6)
    expect(store.get('layers.size')).toBe(1)
    expect(store.has('shape.area')).toBe(false)
  })
  it('reads inherited built-in properties but does not report them as own', () => {
    const store = createTestStore({ user: {} })
    expect(store.get('user.toString')).toBe(Object.prototype.toString)
    expect(store.has('user.toString')).toBe(false)
  })
  it('read unsafe paths as missing', () => {
    const store = createTestStore({ user: { name: 'Ana' } })
    expect(store.get('constructor')).toBeUndefined()
    expect(store.get('user.__proto__', 'default')).toBe('default')
    expect(store.has('constructor')).toBe(false)
  })
  it('reads unsafe paths as missing even with a default value', () => {
    const store = createTestStore({ user: {} })
    for (const path of ['', [], 'a..b', 'user.__proto__', 'user.constructor']) {
      expect(store.get(path, 'missing')).toBe('missing')
      expect(store.has(path)).toBe(false)
    }
  })
  it('reject unsafe paths for listeners and refs', () => {
    const store = createTestStore()
    expect(() => store.on('__proto__', () => {})).toThrow('Store: invalid path')
    expect(() => store.getRef('constructor.name')).toThrow('Store: invalid path')
  })
  it('reject reserved keys for listeners and refs', () => {
    const store = createTestStore()
    expect(() => store.getRef('set')).toThrow('Store: "set" is a reserved key')
    expect(() => store.on('get.x', () => {})).toThrow('Store: "get" is a reserved key')
    expect(() => store.once('on', () => {})).toThrow('Store: "on" is a reserved key')
  })
})

describe('patch', () => {
  it('merges plain objects and keeps the reference', () => {
    const store = createTestStore({ user: { name: 'Ana', age: 30 } })
    const user = store.user
    store.patch('user', { name: 'Bob' })
    expect(store.user).toBe(user)
    expect(user).toEqual({ name: 'Bob', age: 30 })
  })
  it('replaces anything that is not a plain object', () => {
    const store = createTestStore({ list: [1, 2, 3], date: new Date(0), user: { name: 'Ana' } })
    store.patch('list', [4, 5])
    store.patch('date', { x: 1 })
    store.patch('user', null)
    expect(store.list).toEqual([4, 5])
    expect(store.date).toEqual({ x: 1 })
    expect(store.user).toBeNull()
  })
  it('rejects keys giving access to prototypes in merged values', () => {
    const store = createTestStore({ settings: { theme: 'dark' } })
    expect(() => store.patch('settings', JSON.parse('{"__proto__":{"admin":true}}'))).toThrow('Store: invalid key "__proto__"')
    expect(Object.getPrototypeOf(store.settings)).toBe(Object.prototype)
    expect(store.settings.admin).toBeUndefined()
  })
  it('rejects the same keys when the target is missing', () => {
    const store = createTestStore()
    expect(() => store.patch('settings', JSON.parse('{"__proto__":{"admin":true}}'))).toThrow('Store: invalid key "__proto__"')
    expect(store.has('settings')).toBe(false)
  })
  it('rejects constructor and prototype keys in patched objects', () => {
    const store = createTestStore({ settings: {} })
    expect(() => store.patch('settings', JSON.parse('{"constructor":{}}'))).toThrow('Store: invalid key "constructor"')
    expect(() => store.patch('settings', JSON.parse('{"prototype":{}}'))).toThrow('Store: invalid key "prototype"')
    expect(store.settings).toEqual({})
  })
  it('merges only the first level of a plain object', () => {
    const store = createTestStore({ settings: { nested: { first: 1 }, theme: 'light' } })
    const settings = store.settings
    const nested = settings.nested
    store.patch('settings', { nested: { second: 2 } })
    expect(store.settings).toBe(settings)
    expect(store.settings.nested).not.toBe(nested)
    expect(store.settings).toEqual({ nested: { second: 2 }, theme: 'light' })
  })
  it('does not modify an inherited target', () => {
    class Point {}
    Point.prototype.defaults = { x: 0, y: 0 }
    const store = createTestStore({ point: new Point() })
    store.patch('point.defaults', { x: 1 })
    expect(Point.prototype.defaults).toEqual({ x: 0, y: 0 })
    expect(store.point.defaults).toEqual({ x: 1 })
  })
  it('creates the value when the path is missing', () => {
    const store = createTestStore()
    store.patch('settings', { theme: 'dark' })
    expect(store.settings).toEqual({ theme: 'dark' })
  })
})

describe('getRef', () => {
  it('reads and writes through the path', () => {
    const store = createTestStore({ user: { name: 'Ana' } })
    const name = store.getRef('user.name')
    expect(isRef(name)).toBe(true)
    name.value = 'Bob'
    expect(store.user.name).toBe('Bob')
  })
  it('survives parent replacement', () => {
    const store = createTestStore({ user: { name: 'Ana' } })
    const name = store.getRef('user.name')
    store.set('user', { name: 'Bob' })
    expect(name.value).toBe('Bob')
  })
  it('reads a property that is created after the ref', () => {
    const store = createTestStore()
    const name = store.getRef('user.name')
    expect(name.value).toBeUndefined()
    store.set('user.name', 'Ana')
    expect(name.value).toBe('Ana')
  })
  it('reads inherited computed getters and tracks their dependencies', () => {
    class Rect { constructor (w, h) { this.w = w; this.h = h } get area () { return this.w * this.h } }
    const store = createTestStore({ shape: new Rect(2, 3) })
    const area = store.getRef('shape.area')
    expect(area.value).toBe(6)
    store.shape.w = 4
    expect(area.value).toBe(12)
  })
  it('creates missing intermediates on write', () => {
    const store = createTestStore()
    store.getRef('user.name').value = 'Ana'
    expect(store.user).toEqual({ name: 'Ana' })
  })
})

describe('listeners', () => {
  it('are notified whatever the way the value is written', async () => {
    const store = createTestStore({ user: { name: 'a' } })
    const callback = vi.fn()
    store.on('user.name', callback)
    store.user.name = 'b'
    await nextTick()
    store.set('user.name', 'c')
    await nextTick()
    store.patch('user', { name: 'd' })
    await nextTick()
    store.getRef('user.name').value = 'e'
    await nextTick()
    expect(callback.mock.calls.map(([value, previousValue]) => [previousValue, value]))
      .toEqual([['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']])
  })
  it('are notified when a previously missing path is created', async () => {
    const store = createTestStore()
    const callback = vi.fn()
    store.on('user.name', callback)
    store.set('user.name', 'Ana')
    await nextTick()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0].slice(0, 2)).toEqual(['Ana', undefined])
  })
  it('are notified when an inherited computed property changes', async () => {
    class Rect { constructor (w, h) { this.w = w; this.h = h } get area () { return this.w * this.h } }
    const store = createTestStore({ shape: new Rect(2, 3) })
    const callback = vi.fn()
    store.on('shape.area', callback)
    store.shape.w = 4
    await nextTick()
    expect(callback.mock.calls.map(([value, previousValue]) => [previousValue, value])).toEqual([[6, 12]])
  })
  it('are notified when a parent is replaced', async () => {
    const store = createTestStore({ user: { name: 'Ana' } })
    const callback = vi.fn()
    store.on('user.name', callback)
    store.set('user', { name: 'Bob' })
    await nextTick()
    expect(callback).toHaveBeenCalledWith('Bob', 'Ana', expect.anything())
  })
  it('are notified when a property is removed and recreated', async () => {
    const store = createTestStore({ user: { name: 'Ana' } })
    const callback = vi.fn()
    store.on('user.name', callback)
    store.unset('user.name')
    await nextTick()
    store.set('user.name', 'Bob')
    await nextTick()
    expect(callback.mock.calls.map(([value, previousValue]) => [previousValue, value]))
      .toEqual([['Ana', undefined], [undefined, 'Bob']])
  })
  it('are notified when clear removes observed properties', async () => {
    const store = createTestStore({ zoom: 10 })
    const callback = vi.fn()
    store.on('zoom', callback)
    store.clear()
    await nextTick()
    expect(callback.mock.calls.map(([value, previousValue]) => [previousValue, value]))
      .toEqual([[10, undefined]])
    store.set('zoom', 12)
    await nextTick()
    expect(callback.mock.calls[1].slice(0, 2)).toEqual([12, undefined])
  })
  it('are notified once per tick with the final value', async () => {
    const store = createTestStore({ zoom: 10 })
    const callback = vi.fn()
    store.on('zoom', callback)
    store.zoom = 11
    store.zoom = 12
    expect(callback).not.toHaveBeenCalled()
    await nextTick()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(12, 10, expect.anything())
  })
  it('are notified of each change with flush sync', () => {
    const store = createTestStore({ camera: { zoom: 10, pitch: 0, bearing: 0 } })
    const callback = vi.fn()
    store.onAny(callback, { flush: 'sync' })
    store.patch('camera', { zoom: 12, pitch: 45, bearing: 90 })
    expect(callback).toHaveBeenCalledTimes(3)
  })
  it('are not notified of inner changes unless deep', async () => {
    const store = createTestStore({ user: { name: 'Ana' }, layers: [] })
    const shallow = vi.fn()
    const deep = vi.fn()
    store.on('user', shallow)
    store.on('user', deep, { deep: true })
    store.on('layers', deep, { deep: true })
    store.user.name = 'Bob'
    store.layers.push('osm')
    await nextTick()
    expect(shallow).not.toHaveBeenCalled()
    expect(deep).toHaveBeenCalledTimes(2)
  })
  it('receive the same object as value and previous value when deep', async () => {
    const store = createTestStore({ camera: { zoom: 10 } })
    const callback = vi.fn()
    store.on('camera', callback, { deep: true })
    store.camera.zoom = 12
    await nextTick()
    const [value, previousValue] = callback.mock.calls[0]
    expect(value).toBe(previousValue)
  })
  it('are notified only once when using an immediate once listener', async () => {
    const store = createTestStore({ zoom: 10 })
    const callback = vi.fn()
    store.once('zoom', callback, { immediate: true })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0].slice(0, 2)).toEqual([10, undefined])
    store.zoom = 12
    await nextTick()
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('are notified only once with once', async () => {
    const store = createTestStore({ zoom: 10 })
    const callback = vi.fn()
    store.once('zoom', callback)
    store.zoom = 11
    await nextTick()
    store.zoom = 12
    await nextTick()
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('are notified of any change with onAny', async () => {
    const store = createTestStore({ map: { camera: { zoom: 10 } } })
    const callback = vi.fn()
    store.onAny(callback)
    store.map.camera.zoom = 12
    await nextTick()
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('keep observing after the store is cleared and populated again', async () => {
    const store = createTestStore({ zoom: 10 })
    const callback = vi.fn()
    store.onAny(callback)
    store.clear()
    await nextTick()
    store.set('zoom', 12)
    await nextTick()
    expect(callback).toHaveBeenCalledTimes(2)
  })
  it('are not notified of changes inside raw objects', async () => {
    const store = createTestStore()
    store.set('features', markRaw({ items: [] }))
    const callback = vi.fn()
    store.on('features', callback, { deep: true })
    store.features.items.push({})
    await nextTick()
    expect(callback).not.toHaveBeenCalled()
    store.set('features', markRaw({ items: [] }))
    await nextTick()
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('stop when the returned function is called', async () => {
    const store = createTestStore({ zoom: 10 })
    const callback = vi.fn()
    const stop = store.on('zoom', callback)
    stop()
    store.zoom = 11
    await nextTick()
    expect(callback).not.toHaveBeenCalled()
  })
  it('stop with the effect scope that created them', async () => {
    const store = createTestStore({ zoom: 10 })
    const callback = vi.fn()
    const scope = effectScope()
    scope.run(() => store.on('zoom', callback))
    scope.stop()
    store.zoom = 11
    await nextTick()
    expect(callback).not.toHaveBeenCalled()
  })
})
