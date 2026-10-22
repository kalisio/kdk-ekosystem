export default async function (app, options) {
  const db = options.db || app.db
  options.Model = db.collection(options.collection)
  await options.Model.createIndex({ geometry: '2dsphere' })
  await options.Model.createIndex({ layer: 1 })
  let baseIndex = {}
  if (options.featureId) {
    // Support compound index
    const featureIds = Array.isArray(options.featureId)
      ? options.featureId
      : [options.featureId]

    baseIndex = featureIds.reduce((result, id) => {
      result[`properties.${id}`] = 1
      return result
    }, {})

    if (featureIds.length) {
      await options.Model.createIndex(baseIndex)

      // Create indexes notably used for time-based geometry aggregation
      if (options.featureId) {
        await options.Model.createIndex({
          geometry: '2dsphere',
          ...baseIndex,
          time: 1
        })

        await options.Model.createIndex({
          geometry: '2dsphere',
          ...baseIndex,
          time: -1
        })
      }
    }
  }
  // Create indexes notably used for timeseries aggregation
  if (options.variables) {
    for (const variable of options.variables) {
      const name = variable.name || variable

      await options.Model.createIndex({
        ...baseIndex,
        [`properties.${name}`]: 1,
        time: 1
      })

      await options.Model.createIndex({
        ...baseIndex,
        [`properties.${name}`]: 1,
        time: -1
      })
    }
  }
  // Wildcard index
  try {
    await options.Model.createIndex({ 'properties.$**': 1 })
  } catch (_) {
    // Fail silently as it might not be supported under v4
  }
  // TTL index
  const ttl = options.expireAfter ?? options.ttl
  if (ttl != null) {
    await options.Model.createIndex(
      { time: 1 },
      { expireAfterSeconds: ttl }
    )
  }
}
