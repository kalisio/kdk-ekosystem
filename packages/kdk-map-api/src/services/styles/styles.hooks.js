import { fuzzySearch } from '../../hooks/index.js'
import { hooks as kdkCoreHooks } from '../../../../kdk-core-api/src/index.js'

export default {
  before: {
    all: [kdkCoreHooks.marshallHttpQuery],
    find: [
      fuzzySearch,
      kdkCoreHooks.diacriticSearch()
    ],
    get: [],
    create: [
      // Usually conversion of _id to ObjectID is performed by an app level hook, which is not yet setup when creating the service.
      // As we can create features when initializing layer service/data we add it here as well to ensure it will work fine anyway.
      kdkCoreHooks.convertObjectIDs(['_id']),
      kdkCoreHooks.checkUnique({ field: 'name' })
    ],
    update: [kdkCoreHooks.checkUnique({ field: 'name' })],
    patch: [kdkCoreHooks.checkUnique({ field: 'name' })],
    remove: []
  },

  after: {
    all: [],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  },

  error: {
    all: [],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  }
}
