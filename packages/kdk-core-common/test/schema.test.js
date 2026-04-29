import { describe, it, expect, beforeEach } from 'vitest'
import { Schema } from '../src/schema.js'

describe('Schema', () => {
  beforeEach(() => {
    Schema.initialize()
  })

  describe('initialize', () => {
    it('should initialize with default options', () => {
      expect(Schema.ajv).toBeDefined()
    })

    it('should initialize with custom options', () => {
      Schema.initialize({ allErrors: false, strict: false })
      expect(Schema.ajv).toBeDefined()
    })

    it('should reinitialize when called again', () => {
      const first = Schema.ajv
      Schema.initialize()
      expect(Schema.ajv).not.toBe(first)
    })
  })

  describe('register', () => {
    it('should compile and return a validate function', () => {
      const validate = Schema.register({ $id: 'test/string', type: 'string' })
      expect(typeof validate).toBe('function')
    })

    it('should return the same validate function when called twice with the same $id', () => {
      const schema = { $id: 'test/same', type: 'string' }
      const first = Schema.register(schema)
      const second = Schema.register(schema)
      expect(first).toBe(second)
    })

    it('should validate data against registered schema', () => {
      const validate = Schema.register({ $id: 'test/number', type: 'number' })
      expect(validate(42)).toBe(true)
      expect(validate('not a number')).toBe(false)
    })

    it('should support allErrors — collect all errors at once', () => {
      const validate = Schema.register({
        $id: 'test/allErrors',
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'number' }
        },
        required: ['a', 'b']
      })
      validate({ a: 123, b: 'wrong' })
      expect(validate.errors.length).toBeGreaterThan(1)
    })

    it('should throw if not initialized', () => {
      Schema.ajv = null
      expect(() => Schema.register({ $id: 'test/noinit', type: 'string' })).toThrow('Schema must be initialized first')
    })

    it('should throw if schema has no $id', () => {
      expect(() => Schema.register({ type: 'string' })).toThrow('$id')
    })
  })

  describe('addKeyword', () => {
    it('should add a custom keyword', () => {
      Schema.addKeyword({ keyword: 'myKeyword', type: 'string', validate: () => true })
      expect(Schema.ajv.getKeyword('myKeyword')).toBeTruthy()
    })

    it('should throw if not initialized', () => {
      Schema.ajv = null
      expect(() => Schema.addKeyword({ keyword: 'test' })).toThrow('Schema must be initialized first')
    })
  })

  describe('getKeyword', () => {
    it('should return a registered keyword', () => {
      Schema.addKeyword({ keyword: 'myGetKeyword', type: 'string', validate: () => true })
      const kw = Schema.getKeyword('myGetKeyword')
      expect(kw).toBeTruthy()
    })

    it('should return false for an unknown keyword', () => {
      const kw = Schema.getKeyword('nonExistent')
      expect(kw).toBe(false)
    })

    it('should throw if not initialized', () => {
      Schema.ajv = null
      expect(() => Schema.getKeyword('test')).toThrow('Schema must be initialized first')
    })
  })

  describe('removeKeyword', () => {
    it('should remove a registered keyword', () => {
      Schema.addKeyword({ keyword: 'myRemoveKeyword', type: 'string', validate: () => true })
      Schema.removeKeyword('myRemoveKeyword')
      expect(Schema.ajv.getKeyword('myRemoveKeyword')).toBe(false)
    })

    it('should throw if not initialized', () => {
      Schema.ajv = null
      expect(() => Schema.removeKeyword('test')).toThrow('Schema must be initialized first')
    })
  })
})
