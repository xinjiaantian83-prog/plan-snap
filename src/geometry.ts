import type { DrawingLine, Point } from './types'

export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)

export function snapPoint(start: Point, raw: Point, lines: DrawingLine[], enabled = true): Point {
  if (!enabled) return raw
  const dx = raw.x - start.x
  const dy = raw.y - start.y
  const angle = Math.atan2(dy, dx)
  const candidates = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
  for (const line of lines) candidates.push(Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x))
  let best = angle
  let delta = Infinity
  for (const candidate of candidates) {
    const d = Math.abs(Math.atan2(Math.sin(angle - candidate), Math.cos(angle - candidate)))
    if (d < delta) { delta = d; best = candidate }
  }
  if (delta > Math.PI / 36) return raw
  const length = Math.hypot(dx, dy)
  return { x: start.x + Math.cos(best) * length, y: start.y + Math.sin(best) * length }
}
