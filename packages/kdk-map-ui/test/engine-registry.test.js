import { EngineRegistry } from '../src/index.js'

describe('kdk-map-ui:engine-registry', () => {
  const factory = () => ({ destroy () {} })

  afterEach(() => {
    EngineRegistry.unregister('fake')
  })

  it('registers and retrieves an engine factory', () => {
    expect(EngineRegistry.has('fake')).toBe(false)
    expect(EngineRegistry.get('fake')).toBeUndefined()
    EngineRegistry.register('fake', factory)
    expect(EngineRegistry.has('fake')).toBe(true)
    expect(EngineRegistry.get('fake')).toBe(factory)
  })
  it('rejects duplicate types', () => {
    EngineRegistry.register('fake', factory)
    expect(() => EngineRegistry.register('fake', () => ({ destroy () {} }))).toThrow(/already registered/)
    expect(EngineRegistry.get('fake')).toBe(factory)
  })
  it('rejects invalid factories', () => {
    expect(() => EngineRegistry.register('fake', {})).toThrow(/Invalid engine factory/)
    expect(EngineRegistry.has('fake')).toBe(false)
  })
  it('unregisters an engine factory', () => {
    EngineRegistry.register('fake', factory)
    expect(EngineRegistry.unregister('fake')).toBe(true)
    expect(EngineRegistry.has('fake')).toBe(false)
    expect(EngineRegistry.unregister('fake')).toBe(false)
  })
})
