import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SortOrder,
  toHalf,
  BaseGrid,
  GridSource,
  Grid1D,
  Grid2D,
  TiledGrid,
  SubGrid,
  gridSourceFactories,
  makeGridSource,
  extractGridSourceConfig
} from '../src/grid.js'

// Minimal concrete BaseGrid for testing abstract methods
class TestGrid extends BaseGrid {
  constructor (bbox, dimensions, data, nodata = undefined) {
    super('test', bbox, dimensions, nodata)
    this.data = data
  }

  getValue (ilat, ilon) {
    return this.data[ilat * this.dimensions[1] + ilon]
  }
}

// Helper to create a simple 3x3 grid with values 1..9
const make3x3 = (nodata = undefined) => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  return new TestGrid([0, 0, 2, 2], [3, 3], data, nodata)
}

// ─── toHalf ──────────────────────────────────────────────────────────────────

describe('toHalf', () => {
  it('converts 0 to 0', () => {
    expect(toHalf(0)).toBe(0)
  })

  it('converts 1.0 to the correct half-float bits', () => {
    // 1.0 in half-float is 0x3c00
    expect(toHalf(1.0)).toBe(0x3c00)
  })

  it('converts -1.0 to the correct half-float bits', () => {
    // -1.0 in half-float is 0xbc00
    expect(toHalf(-1.0)).toBe(0xbc00)
  })

  it('converts Infinity to the Inf half-float bits', () => {
    expect(toHalf(Infinity)).toBe(0x7c00)
  })

  it('converts NaN to a NaN half-float', () => {
    // NaN in half-float has exponent 0x7c00 and non-zero mantissa
    const result = toHalf(NaN)
    expect(result & 0x7c00).toBe(0x7c00)
    expect(result & 0x03ff).not.toBe(0)
  })

  it('returns 0 for very small exponent (underflow)', () => {
    // 1e-40 is well below half-float range
    expect(toHalf(1e-40)).toBe(0)
  })
})

// ─── BaseGrid ─────────────────────────────────────────────────────────────────

describe('BaseGrid', () => {
  describe('constructor', () => {
    it('computes resolution from bbox and dimensions', () => {
      const grid = make3x3()
      expect(grid.getResolution()).toEqual([1, 1])
    })

    it('throws for invalid bbox (min >= max)', () => {
      expect(() => new TestGrid([2, 0, 0, 2], [3, 3], [])).toThrow(/bbox/)
      expect(() => new TestGrid([0, 2, 2, 0], [3, 3], [])).toThrow(/bbox/)
    })

    it('throws for non-positive dimensions', () => {
      expect(() => new TestGrid([0, 0, 2, 2], [0, 3], [])).toThrow(/dimension/)
      expect(() => new TestGrid([0, 0, 2, 2], [3, 0], [])).toThrow(/dimension/)
    })
  })

  describe('getDimensions / getResolution / getBBox', () => {
    it('returns correct dimensions', () => {
      const grid = make3x3()
      expect(grid.getDimensions()).toEqual([3, 3])
    })

    it('returns correct bbox', () => {
      const grid = make3x3()
      expect(grid.getBBox()).toEqual([0, 0, 2, 2])
    })
  })

  describe('getLat / getLon', () => {
    it('returns correct lat for index', () => {
      const grid = make3x3()
      expect(grid.getLat(0)).toBe(0)
      expect(grid.getLat(1)).toBe(1)
      expect(grid.getLat(2)).toBe(2)
    })

    it('returns correct lon for index', () => {
      const grid = make3x3()
      expect(grid.getLon(0)).toBe(0)
      expect(grid.getLon(2)).toBe(2)
    })
  })

  describe('hasData', () => {
    it('returns true when at least one value is not nodata', () => {
      const grid = make3x3(0)
      expect(grid.hasData()).toBe(true)
    })

    it('returns false when all values equal nodata', () => {
      const grid = new TestGrid([0, 0, 2, 2], [3, 3], new Array(9).fill(0), 0)
      expect(grid.hasData()).toBe(false)
    })
  })

  describe('getDataBounds', () => {
    it('returns [min, max] of non-nodata values', () => {
      const grid = make3x3()
      expect(grid.getDataBounds()).toEqual([1, 9])
    })

    it('excludes nodata values', () => {
      const data = [0, 2, 3, 0, 5, 6, 0, 8, 9]
      const grid = new TestGrid([0, 0, 2, 2], [3, 3], data, 0)
      expect(grid.getDataBounds()).toEqual([2, 9])
    })

    it('caches the result', () => {
      const grid = make3x3()
      const first = grid.getDataBounds()
      const second = grid.getDataBounds()
      expect(first).toBe(second)
    })
  })

  describe('getIndices', () => {
    it('returns indices for a point inside the grid', () => {
      const grid = make3x3()
      const indices = grid.getIndices(1.5, 1.5)
      expect(indices).toEqual([1, 1])
    })

    it('returns null for a point outside the grid', () => {
      const grid = make3x3()
      expect(grid.getIndices(-1, 0)).toBeNull()
      expect(grid.getIndices(0, 5)).toBeNull()
    })
  })

  describe('getValue', () => {
    it('throws when not implemented on BaseGrid directly', () => {
      class NoImpl extends BaseGrid {}
      const g = new NoImpl('k', [0, 0, 2, 2], [3, 3], undefined)
      expect(() => g.getValue(0, 0)).toThrow('Not implemented')
    })
  })

  describe('genValuesBuffer', () => {
    it('returns a Float32Array of correct length', () => {
      const grid = make3x3()
      const buf = grid.genValuesBuffer()
      expect(buf).toBeInstanceOf(Float32Array)
      expect(buf.length).toBe(9)
    })
  })

  describe('genCoordsBuffer', () => {
    it('returns a Uint16Array and correct metadata', () => {
      const grid = make3x3()
      const { coords, minLat, maxLat, minLon, maxLon } = grid.genCoordsBuffer()
      expect(coords).toBeInstanceOf(Uint16Array)
      expect(coords.length).toBe(18) // 2 * 3 * 3
      expect(minLat).toBe(0)
      expect(maxLat).toBe(2)
      expect(minLon).toBe(0)
      expect(maxLon).toBe(2)
    })
  })

  describe('genMeshIndexBuffer', () => {
    it('returns a typed array index buffer', () => {
      const grid = make3x3()
      const index = grid.genMeshIndexBuffer()
      expect(index instanceof Uint16Array || index instanceof Uint32Array).toBe(true)
    })
  })

  describe('genWireframeIndexBuffer', () => {
    it('returns a typed array wireframe buffer', () => {
      const grid = make3x3()
      const index = grid.genWireframeIndexBuffer()
      expect(index instanceof Uint16Array || index instanceof Uint32Array).toBe(true)
    })
  })
})

// ─── Grid1D ───────────────────────────────────────────────────────────────────

describe('Grid1D', () => {
  // latFirst=true, latAsc, lonAsc → data[ilat * lonCount + ilon]
  const makeGrid = (latFirst, latOrder, lonOrder, data = null) => {
    const d = data || [1, 2, 3, 4, 5, 6, 7, 8, 9]
    return new Grid1D('src', [0, 0, 2, 2], [3, 3], d, latFirst, latOrder, lonOrder)
  }

  it('reads values correctly in latFirst/ASC/ASC order', () => {
    const grid = makeGrid(true, SortOrder.ASCENDING, SortOrder.ASCENDING)
    expect(grid.getValue(0, 0)).toBe(1)
    expect(grid.getValue(0, 1)).toBe(2)
    expect(grid.getValue(1, 0)).toBe(4)
  })

  it('reads values correctly in latFirst/ASC/DESC order', () => {
    const grid = makeGrid(true, SortOrder.ASCENDING, SortOrder.DESCENDING)
    // data[ilat * lonCount + (lonCount - ilon - 1)]
    expect(grid.getValue(0, 0)).toBe(3)
    expect(grid.getValue(0, 2)).toBe(1)
  })

  it('reads values correctly in lonFirst/ASC/ASC order', () => {
    const grid = makeGrid(false, SortOrder.ASCENDING, SortOrder.ASCENDING)
    // data[ilon * latCount + ilat]
    expect(grid.getValue(0, 0)).toBe(1)
    expect(grid.getValue(1, 0)).toBe(2)
    expect(grid.getValue(0, 1)).toBe(4)
  })

  it('applies converter on construction', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    const grid = new Grid1D('src', [0, 0, 2, 2], [3, 3], data, true, SortOrder.ASCENDING, SortOrder.ASCENDING, undefined, v => v * 2)
    expect(grid.getValue(0, 0)).toBe(2)
    expect(grid.getValue(0, 1)).toBe(4)
  })
})

// ─── Grid2D ───────────────────────────────────────────────────────────────────

describe('Grid2D', () => {
  // latFirst/ASC/ASC → data[ilat][ilon]
  const make2D = (latFirst, latOrder, lonOrder) => {
    const data = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9]
    ]
    return new Grid2D('src', [0, 0, 2, 2], [3, 3], data, latFirst, latOrder, lonOrder)
  }

  it('reads values correctly in latFirst/ASC/ASC order', () => {
    const grid = make2D(true, SortOrder.ASCENDING, SortOrder.ASCENDING)
    expect(grid.getValue(0, 0)).toBe(1)
    expect(grid.getValue(1, 2)).toBe(6)
    expect(grid.getValue(2, 2)).toBe(9)
  })

  it('reads values correctly in latFirst/DESC/ASC order', () => {
    const grid = make2D(true, SortOrder.DESCENDING, SortOrder.ASCENDING)
    // data[latCount - ilat - 1][ilon]
    expect(grid.getValue(0, 0)).toBe(7)
    expect(grid.getValue(2, 0)).toBe(1)
  })

  it('reads values correctly in lonFirst/ASC/ASC order', () => {
    const data = [[1, 4, 7], [2, 5, 8], [3, 6, 9]]
    const grid = new Grid2D('src', [0, 0, 2, 2], [3, 3], data, false, SortOrder.ASCENDING, SortOrder.ASCENDING)
    // data[ilon][ilat]
    expect(grid.getValue(0, 0)).toBe(1)
    expect(grid.getValue(1, 0)).toBe(4)
    expect(grid.getValue(0, 1)).toBe(2)
  })

  it('applies converter on construction', () => {
    const data = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
    const grid = new Grid2D('src', [0, 0, 2, 2], [3, 3], data, true, SortOrder.ASCENDING, SortOrder.ASCENDING, undefined, v => v * 10)
    expect(grid.getValue(0, 0)).toBe(10)
    expect(grid.getValue(2, 2)).toBe(90)
  })
})

// ─── TiledGrid ────────────────────────────────────────────────────────────────

describe('TiledGrid', () => {
  const makeTile = (bbox, values) => new TestGrid(bbox, [2, 2], values)

  it('merges two tiles into a single bbox', () => {
    const t1 = makeTile([0, 0, 1, 1], [1, 2, 3, 4])
    const t2 = makeTile([1, 0, 2, 1], [5, 6, 7, 8])
    const tiled = new TiledGrid('src', [t1, t2])
    const bbox = tiled.getBBox()
    expect(bbox[0]).toBe(0)
    expect(bbox[2]).toBe(2)
  })

  it('computes correct dimensions after merge', () => {
    const t1 = makeTile([0, 0, 1, 1], [1, 2, 3, 4])
    const t2 = makeTile([1, 0, 2, 1], [5, 6, 7, 8])
    const tiled = new TiledGrid('src', [t1, t2])
    expect(tiled.getDimensions()[0]).toBeGreaterThan(0)
  })

  it('throws if tiles have mismatched resolutions', () => {
    const t1 = new TestGrid([0, 0, 2, 2], [3, 3], [])
    const t2 = new TestGrid([2, 0, 4, 4], [2, 2], [])
    expect(() => new TiledGrid('src', [t1, t2])).toThrow(/resolution/i)
  })

  it('returns 0 for points not covered by any tile', () => {
    const t1 = makeTile([0, 0, 1, 1], [1, 2, 3, 4])
    const tiled = new TiledGrid('src', [t1])
    // ilat/ilon out of tile range → returns 0
    expect(tiled.getValue(99, 99)).toBe(0)
  })
})

// ─── SubGrid ──────────────────────────────────────────────────────────────────

describe('SubGrid', () => {
  it('exposes a sub-region of a parent grid', () => {
    const parent = make3x3()
    // subBbox covering the middle area
    const sub = new SubGrid('src', parent, [0.5, 0.5, 1.5, 1.5])
    expect(sub.getDimensions()[0]).toBeGreaterThan(0)
    expect(sub.getDimensions()[1]).toBeGreaterThan(0)
  })

  it('returns the same value as the parent at overlapping indices', () => {
    const parent = make3x3()
    const sub = new SubGrid('src', parent, [0.5, 0.5, 1.5, 1.5])
    // First cell of sub should equal the corresponding parent cell
    const parentVal = parent.getValue(sub.latOffset, sub.lonOffset)
    expect(sub.getValue(0, 0)).toBe(parentVal)
  })
})

// ─── GridSource ───────────────────────────────────────────────────────────────

describe('GridSource', () => {
  let source

  beforeEach(() => {
    source = new GridSource()
  })

  it('getBBox returns null by default', () => {
    expect(source.getBBox()).toBeNull()
  })

  it('setup throws Not implemented', async () => {
    await expect(source.setup({})).rejects.toThrow('Not implemented')
  })

  it('fetch throws Not implemented', async () => {
    await expect(source.fetch(null, [], [])).rejects.toThrow('Not implemented')
  })

  it('getDataBounds throws Not implemented', () => {
    expect(() => source.getDataBounds()).toThrow('Not implemented')
  })

  describe('on / emit / off', () => {
    it('calls registered callback on emit', () => {
      const cb = vi.fn()
      source.on('data-changed', cb)
      source.emit('data-changed')
      expect(cb).toHaveBeenCalledOnce()
    })

    it('passes context with source and event to callback', () => {
      const cb = vi.fn()
      source.on('data-changed', cb)
      source.emit('data-changed')
      expect(cb).toHaveBeenCalledWith({ source, event: 'data-changed' })
    })

    it('dataChanged emits data-changed event', () => {
      const cb = vi.fn()
      source.on('data-changed', cb)
      source.dataChanged()
      expect(cb).toHaveBeenCalledOnce()
    })

    it('does not call removed callback', () => {
      const cb = vi.fn()
      source.on('data-changed', cb)
      source.off('data-changed', cb)
      source.emit('data-changed')
      expect(cb).not.toHaveBeenCalled()
    })

    it('does not throw when emitting an event with no listeners', () => {
      expect(() => source.emit('no-listeners')).not.toThrow()
    })
  })

  describe('wrapLongitude', () => {
    it('wraps lon > 180 when bounds start < 0', () => {
      expect(source.wrapLongitude(190, [-180, -90, 180, 90])).toBe(-170)
    })

    it('wraps lon < 0 when bounds end > 180', () => {
      expect(source.wrapLongitude(-10, [0, -90, 360, 90])).toBe(350)
    })

    it('returns lon unchanged when no wrapping needed', () => {
      expect(source.wrapLongitude(10, [0, -90, 180, 90])).toBe(10)
    })
  })
})

// ─── makeGridSource / extractGridSourceConfig ─────────────────────────────────

describe('makeGridSource', () => {
  it('returns null for unknown key', () => {
    expect(makeGridSource('unknown')).toBeNull()
  })

  it('calls the registered factory with options', () => {
    const factory = vi.fn(() => ({ type: 'mock' }))
    gridSourceFactories.mock = factory
    const result = makeGridSource('mock', { foo: 'bar' })
    expect(factory).toHaveBeenCalledWith({ foo: 'bar' })
    expect(result).toEqual({ type: 'mock' })
    delete gridSourceFactories.mock
  })
})

describe('extractGridSourceConfig', () => {
  it('returns [null, null] when no registered key matches', () => {
    const [key, config] = extractGridSourceConfig({ unknown: {} })
    expect(key).toBeNull()
    expect(config).toBeNull()
  })

  it('returns the matching key and config', () => {
    gridSourceFactories.mySource = () => {}
    const [key, config] = extractGridSourceConfig({ mySource: { url: 'http://example.com' }, other: {} })
    expect(key).toBe('mySource')
    expect(config).toEqual({ url: 'http://example.com' })
    delete gridSourceFactories.mySource
  })
})
