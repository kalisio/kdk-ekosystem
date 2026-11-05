import { is } from '@kalisio/common-core/predicates'
import { object } from '@kalisio/common-core/utilities'
import { Store } from '@kalisio/kdk-core-ui'
import { KMap } from './map.js'

const MAPS_PATH = 'maps'

// Runtime registry, deliberately kept out of the Store: it holds instances, not declarative data
const maps = new Map()

export const MapManager = {
  // Declares the map in the Store and registers its runtime instance. The engine type is only
  // resolved by map.mount(container), so it can be registered after the map is created.
  createMap (config) {
    const { id, engine } = config ?? {}
    if (!is.nonEmptyString(id)) throw new Error('Map configuration requires a non-empty string id')
    if (!is.nonEmptyString(engine)) throw new Error(`Map '${id}' configuration requires an engine type`)
    const path = [MAPS_PATH, id]
    if (maps.has(id) || Store.has(path)) throw new Error(`Map '${id}' already exists`)
    // Instance first: if its construction fails, nothing has been written to the Store
    const map = new KMap(id, { path })
    // Detaches the stored state from the caller's object
    Store.set(path, object.clone(config))
    maps.set(id, map)
    return map
  },

  getMap (id) {
    return maps.get(id)
  },

  getMaps () {
    return [...maps.values()]
  },

  // Unregistered first so the map is unreachable while its engine is released;
  // its state is removed even if the engine fails to be destroyed, then the error is rethrown.
  async removeMap (id) {
    const map = maps.get(id)
    if (!map) return false
    maps.delete(id)
    try {
      await map.destroy()
    } finally {
      Store.unset([MAPS_PATH, id])
    }
    return true
  }
}
