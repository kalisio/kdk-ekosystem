const engines = new Map()

export const EngineRegistry = {
  register (type, factory) {
    if (engines.has(type)) {
      throw new Error(`Engine '${type}' already registered`)
    }
    if (typeof factory !== 'function') {
      throw new Error(`Invalid engine factory: ${type}`)
    }
    engines.set(type, factory)
  },

  get (type) {
    return engines.get(type)
  },

  has (type) {
    return engines.has(type)
  },

  unregister (type) {
    return engines.delete(type)
  }
}
