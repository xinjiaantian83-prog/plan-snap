export type Point = { x: number; y: number }
export type LineStyle = 'solid' | 'dashed'
export type DrawingLine = {
  id: string
  start: Point
  end: Point
  lengthMm: number
  color: string
  width: number
  style: LineStyle
}
export type DrawingDocument = {
  id: string
  name: string
  updatedAt: number
  lines: DrawingLine[]
}
