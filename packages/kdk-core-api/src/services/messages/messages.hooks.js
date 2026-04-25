import { setNow, discard } from 'feathers-hooks-common'
import fuzzySearch from 'feathers-mongodb-fuzzy-search'
import { diacriticSearch, marshallComparisonQuery } from '../../hooks/index.js'

export default {
  before: {
    all: [],
    find: [
      fuzzySearch({ fields: ['title', 'body', 'author'] }),
      diacriticSearch(),
      marshallComparisonQuery
    ],
    get: [],
    create: [setNow('createdAt', 'updatedAt')],
    update: [
      discard('createdAt', 'updatedAt'),
      setNow('updatedAt')
    ],
    patch: [
      discard('createdAt', 'updatedAt'),
      setNow('updatedAt')
    ],
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
