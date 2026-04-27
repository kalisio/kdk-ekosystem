import makeDebug from 'debug'
import services from './services/index.js'
import * as hooks from './hooks/index.js'
import kdkMapApiLayersLoader from './config/layers.cjs'

export * from './services/index.js'
export { hooks }
export { kdkMapApiLayersLoader }
export { kdkMapApiLayersLoader as layersLoader }
export * from './marshall.js'
export * from '@kalisio/kdk-map-common'

const debug = makeDebug('kdk:map')

export default async function init () {
  const app = this

  debug('Initializing KDK map')

  await app.configure(services)
}
