import { isReactive, nextTick, watch } from 'vue'
import { Store } from '@kalisio/kdk-core-ui'
import { EngineRegistry, MapManager } from '../src/index.js'

function createEngine () {
  return { destroy: vi.fn() }
}

function deferred () {
  const pending = {}
  pending.promise = new Promise(resolve => { pending.resolve = resolve })
  return pending
}

describe('kdk-map-ui:map-manager', () => {
  const container = { id: 'map-container' }
  let factory

  beforeEach(() => {
    factory = vi.fn(async () => createEngine())
    EngineRegistry.register('fake', factory)
  })

  afterEach(async () => {
    await Promise.allSettled(MapManager.getMaps().map(map => MapManager.removeMap(map.id)))
    EngineRegistry.unregister('fake')
    Store.unset('maps')
  })

  it('creates a map with its declarative state in the store', () => {
    const config = { id: 'main', engine: 'fake', camera: { center: [2.35, 48.85], zoom: 10 }, layers: [] }
    const map = MapManager.createMap(config)
    expect(map.id).toBe('main')
    expect(map.status).toBe('created')
    expect(map.engine).toBeNull()
    expect(factory).not.toHaveBeenCalled()
    expect(Store.get(['maps', 'main'])).toEqual(config)
    expect(map.state).toBe(Store.get(['maps', 'main']))
    expect(isReactive(map.state)).toBe(true)
  })
  it('does not keep a reference to the given configuration', () => {
    const config = { id: 'main', engine: 'fake', camera: { zoom: 10 } }
    const map = MapManager.createMap(config)
    config.camera.zoom = 2
    expect(map.state.camera.zoom).toBe(10)
  })
  it('rejects invalid configurations without touching the store', () => {
    expect(() => MapManager.createMap()).toThrow(/id/)
    expect(() => MapManager.createMap({ engine: 'fake' })).toThrow(/id/)
    expect(() => MapManager.createMap({ id: '  ', engine: 'fake' })).toThrow(/id/)
    expect(() => MapManager.createMap({ id: 'main', engine: ' ' })).toThrow(/engine/)
    expect(() => MapManager.createMap({ id: 'main' })).toThrow(/engine/)
    expect(Store.has(['maps', 'main'])).toBe(false)
    expect(MapManager.getMaps()).toHaveLength(0)
  })
  it('rejects duplicate identifiers', () => {
    const map = MapManager.createMap({ id: 'main', engine: 'fake' })
    expect(() => MapManager.createMap({ id: 'main', engine: 'fake', camera: { zoom: 3 } })).toThrow(/already exists/)
    expect(MapManager.getMap('main')).toBe(map)
    expect(Store.get(['maps', 'main'])).toEqual({ id: 'main', engine: 'fake' })
    Store.set(['maps', 'restored'], { id: 'restored', engine: 'fake' })
    expect(() => MapManager.createMap({ id: 'restored', engine: 'fake' })).toThrow(/already exists/)
    expect(MapManager.getMap('restored')).toBeUndefined()
  })
  it('treats a map identifier containing dots as a literal key', async () => {
    const id = 'area.main'
    const map = MapManager.createMap({ id, engine: 'fake' })
    expect(MapManager.getMap(id)).toBe(map)
    expect(Store.has(['maps', id])).toBe(true)
    expect(Store.has(['maps', 'area', 'main'])).toBe(false)
    await MapManager.removeMap(id)
    expect(Store.has(['maps', id])).toBe(false)
  })
  it('retrieves and lists maps', () => {
    const main = MapManager.createMap({ id: 'main', engine: 'fake' })
    const overview = MapManager.createMap({ id: 'overview', engine: 'fake' })
    expect(MapManager.getMap('main')).toBe(main)
    expect(MapManager.getMap('unknown')).toBeUndefined()
    expect(MapManager.getMaps()).toEqual([main, overview])
    MapManager.getMaps().pop()
    expect(MapManager.getMaps()).toHaveLength(2)
  })
  it('keeps multiple maps independent', async () => {
    const main = MapManager.createMap({ id: 'main', engine: 'fake', camera: { zoom: 10 } })
    const overview = MapManager.createMap({ id: 'overview', engine: 'fake', camera: { zoom: 10 } })
    Store.set(['maps', 'main', 'camera', 'zoom'], 3)
    expect(overview.state.camera.zoom).toBe(10)
    await main.mount(container)
    expect(overview.engine).toBeNull()
    await MapManager.removeMap('main')
    expect(MapManager.getMap('overview')).toBe(overview)
    expect(Store.has(['maps', 'overview'])).toBe(true)
  })
  it('follows store updates, including replaced parent objects', async () => {
    const map = MapManager.createMap({ id: 'main', engine: 'fake', camera: { zoom: 10 } })
    const zooms = []
    const stop = watch(() => map.state?.camera.zoom, zoom => zooms.push(zoom))
    Store.set(['maps', 'main', 'camera', 'zoom'], 11)
    await nextTick()
    map.state.camera.zoom = 12
    await nextTick()
    Store.set(['maps', 'main'], { id: 'main', engine: 'fake', camera: { zoom: 13 } })
    await nextTick()
    Store.set('maps', { main: { id: 'main', engine: 'fake', camera: { zoom: 14 } } })
    await nextTick()
    stop()
    expect(map.state.camera.zoom).toBe(14)
    expect(zooms).toEqual([11, 12, 13, 14])
  })
  it('allows registering an engine after the map is created', async () => {
    EngineRegistry.unregister('fake')
    const map = MapManager.createMap({ id: 'main', engine: 'fake' })
    expect(factory).not.toHaveBeenCalled()
    await expect(map.mount(container)).rejects.toThrow()
    expect(map.status).toBe('created')
    expect(map.engine).toBeNull()
    EngineRegistry.register('fake', factory)
    const engine = await map.mount(container)
    expect(map.status).toBe('mounted')
    expect(map.engine).toBe(engine)
    expect(factory).toHaveBeenCalledOnce()
  })
  it('passes a detached plain snapshot of the state to the engine factory', async () => {
    const map = MapManager.createMap({ id: 'main', engine: 'fake', camera: { zoom: 10 } })
    map.state.camera.zoom = 12
    factory.mockImplementationOnce(async ({ container: engineContainer, state }) => {
      expect(engineContainer).toBe(container)
      expect(isReactive(state)).toBe(false)
      expect(state).toEqual({ id: 'main', engine: 'fake', camera: { zoom: 12 } })
      state.camera.zoom = 99
      return createEngine()
    })
    await map.mount(container)
    expect(map.state.camera.zoom).toBe(12)
  })
  it('can retry mounting after an engine factory rejects', async () => {
    factory.mockRejectedValueOnce(new Error('Initialization failed'))
    const map = MapManager.createMap({ id: 'main', engine: 'fake' })
    await expect(map.mount(container)).rejects.toThrow('Initialization failed')
    expect(map.status).toBe('created')
    expect(map.engine).toBeNull()
    const engine = await map.mount(container)
    expect(map.engine).toBe(engine)
    expect(map.status).toBe('mounted')
    expect(factory).toHaveBeenCalledTimes(2)
  })
  it('rejects mounting without a container without invoking the factory', async () => {
    const map = MapManager.createMap({ id: 'main', engine: 'fake' })
    await expect(map.mount()).rejects.toThrow(/container/)
    expect(map.status).toBe('created')
    expect(factory).not.toHaveBeenCalled()
  })
  it('removes an unmounted map without creating an engine', async () => {
    const map = MapManager.createMap({ id: 'main', engine: 'fake' })
    await expect(MapManager.removeMap('main')).resolves.toBe(true)
    expect(factory).not.toHaveBeenCalled()
    expect(map.status).toBe('destroyed')
    expect(MapManager.getMap('main')).toBeUndefined()
    expect(Store.has(['maps', 'main'])).toBe(false)
  })
  it('removes a map, its engine and its state', async () => {
    const map = MapManager.createMap({ id: 'main', engine: 'fake' })
    const engine = await map.mount(container)
    await expect(MapManager.removeMap('main')).resolves.toBe(true)
    expect(engine.destroy).toHaveBeenCalledOnce()
    expect(map.status).toBe('destroyed')
    expect(MapManager.getMap('main')).toBeUndefined()
    expect(Store.has(['maps', 'main'])).toBe(false)
    await expect(map.mount(container)).rejects.toThrow(/destroyed/)
    await expect(MapManager.removeMap('main')).resolves.toBe(false)
    expect(() => MapManager.createMap({ id: 'main', engine: 'fake' })).not.toThrow()
  })
  it('cleans up a map whose engine fails to be destroyed', async () => {
    const map = MapManager.createMap({ id: 'main', engine: 'fake' })
    const engine = await map.mount(container)
    engine.destroy.mockRejectedValueOnce(new Error('Context lost'))
    await expect(MapManager.removeMap('main')).rejects.toThrow('Context lost')
    expect(map.status).toBe('destroyed')
    expect(MapManager.getMap('main')).toBeUndefined()
    expect(Store.has(['maps', 'main'])).toBe(false)
  })
  it('releases an engine whose initialization completes after removal', async () => {
    const pending = deferred()
    factory.mockReturnValueOnce(pending.promise)
    const map = MapManager.createMap({ id: 'main', engine: 'fake' })
    const mounting = map.mount(container)
    expect(map.status).toBe('mounting')
    await MapManager.removeMap('main')
    const engine = createEngine()
    pending.resolve(engine)
    await expect(mounting).rejects.toThrow(/destroyed while mounting/)
    expect(engine.destroy).toHaveBeenCalledOnce()
    expect(map.engine).toBeNull()
    expect(Store.has(['maps', 'main'])).toBe(false)
  })
})
