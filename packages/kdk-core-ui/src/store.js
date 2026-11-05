import { get as getAt, has as hasAt, set as setAt, toPath, unset as unsetAt } from 'lodash-es'
import { reactive, computed, watch } from 'vue'
import { is } from '@kalisio/common-core/predicates'
import { object } from '@kalisio/common-core/utilities'

// Registry of named stores: a Map avoids collisions with inherited keys like 'toString' or '__proto__'
const stores = new Map()
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

// Paths never contain the keys giving access to prototypes, nor empty keys
function isSafePath (path) {
  const keys = toPath(path)
  return keys.length > 0 && keys.every((key) => key !== '' && !FORBIDDEN_KEYS.has(key))
}

function checkSafePath (path) {
  if (!isSafePath(path)) throw new Error(`Store: invalid path "${path}"`)
}

function createStore (initialState) {
  // Clone so the caller's object is never mutated
  const state = reactive(object.clone(initialState || {}))
  // Paths that may be written must be safe, must not start with a method name and must only
  // go through own properties, so that inherited values like built-in functions are never modified
  function checkPath (path) {
    checkSafePath(path)
    const keys = toPath(path)
    if (Object.hasOwn(methods, keys[0])) throw new Error(`Store: "${keys[0]}" is a reserved key`)
    let current = state
    for (const key of keys.slice(0, -1)) {
      if (!is.object(current) && !is.function(current)) return
      if (!Object.hasOwn(current, key)) {
        if (key in current) throw new Error(`Store: invalid path "${path}"`)
        return
      }
      current = current[key]
    }
  }
  // Listeners rely on Vue reactivity: they are notified whatever the way the value is written
  // (direct mutation, v-model, set, patch...) and return the function that stops them.
  // Like any Vue watcher, they are batched by default: changes made in the same tick give a single
  // notification with the final state; pass { flush: 'sync' } to be notified of each change
  function listen (path, callback, options) {
    checkPath(path)
    return watch(() => methods.get(path), callback, options)
  }
  const methods = {
    // Without a path, return the whole store; unsafe paths are read as missing
    get (path, defaultValue) {
      if (path === undefined) return state
      return isSafePath(path) ? getAt(state, path, defaultValue) : defaultValue
    },
    // lodash has() relies on hasOwnProperty, which Vue does not track: reading the path first makes
    // has() reactive, otherwise a template or a computed using it would never update
    has (path) {
      if (!isSafePath(path)) return false
      getAt(state, path)
      return hasAt(state, path)
    },
    set (path, value) {
      checkPath(path)
      setAt(state, path, value)
    },
    // Shallow merge of plain objects, keeping the target reference; anything else is replaced,
    // as well as inherited targets that must not be modified
    patch (path, value) {
      checkPath(path)
      // A '__proto__' key, as produced by JSON.parse, would replace the target prototype on merge;
      // checked whether or not the target exists, so that patch accepts the same values in both cases
      if (is.plainObject(value)) {
        for (const key of Object.keys(value)) {
          if (FORBIDDEN_KEYS.has(key)) throw new Error(`Store: invalid key "${key}"`)
        }
      }
      if (!hasAt(state, path)) return methods.set(path, value)
      const target = getAt(state, path)
      if (!is.plainObject(target) || !is.plainObject(value)) return methods.set(path, value)
      Object.assign(target, value)
    },
    unset (path) {
      checkPath(path)
      unsetAt(state, path)
    },
    clear () {
      Object.keys(state).forEach((key) => { delete state[key] })
    },
    // Writable ref bound to the path, survives parent replacement
    getRef (path) {
      checkPath(path)
      return computed({
        get: () => methods.get(path),
        set: (value) => methods.set(path, value)
      })
    },
    // Called with (value, previousValue) when the value at path is replaced; use { deep: true } to also
    // be notified of changes inside it, in which case value and previousValue are the same object
    // when it is mutated in place, so they cannot be compared
    on: (path, callback, options) => listen(path, callback, options),
    once: (path, callback, options) => listen(path, callback, { ...options, once: true }),
    // Called on any change in the store, without telling which path changed
    onAny: (callback, options) => watch(state, () => callback(), { ...options, deep: true })
  }
  // Non-enumerable methods: invisible to Object.keys, for...in, lodash iteration and deep watchers
  for (const [key, fn] of Object.entries(methods)) {
    if (Object.hasOwn(state, key)) throw new Error(`Store: "${key}" is a reserved key`)
    Object.defineProperty(state, key, { value: fn })
  }
  return state
}

// Get the store registered under `name`, creating it on first call
export function getStore (name, initialState) {
  if (!stores.has(name)) stores.set(name, createStore(initialState))
  return stores.get(name)
}

export const Store = getStore('store')
