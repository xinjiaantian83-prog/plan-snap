import { describe, expect, it } from 'vitest'
import { distance, snapPoint } from './geometry'
describe('geometry', () => {
  it('calculates distance', () => expect(distance({x: 0, y: 0}, {x: 3, y: 4})).toBe(5))
  it('snaps near-horizontal lines', () => expect(snapPoint({x: 0, y: 0}, {x: 100, y: 3}, [])).toEqual({x: Math.hypot(100,3), y: 0}))
  it('keeps free angles outside tolerance', () => expect(snapPoint({x: 0, y: 0}, {x: 100, y: 30}, [])).toEqual({x: 100, y: 30}))
})
