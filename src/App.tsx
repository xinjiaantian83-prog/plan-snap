import { useEffect, useMemo, useRef, useState } from 'react'
import { listDrawings, saveDrawing } from './db'
import { distance, snapPoint } from './geometry'
import type { DrawingDocument, DrawingLine, DrawingRectangle, Point } from './types'

const EMPTY: DrawingDocument = { id: crypto.randomUUID(), name: '名称未設定の図面', updatedAt: Date.now(), lines: [], rectangles: [] }
const COLORS = ['#253331', '#2f6f69', '#bd5a43', '#42658c']
type View = { x: number; y: number; scale: number }
type DrawingState = Pick<DrawingDocument, 'lines' | 'rectangles'>
type Gesture = { kind: 'draw'; start: Point; continuing: boolean } | { kind: 'move'; id: string; origin: Point; start: Point; end: Point } | { kind: 'rectMove'; id: string; origin: Point; points: [Point, Point, Point, Point] } | { kind: 'vertexMove'; id: string; index: number } | { kind: 'pan'; origin: Point; view: View }

const edgeLengths = (points: [Point, Point, Point, Point]): [number, number, number, number] => points.map((point, index) => Math.round(distance(point, points[(index + 1) % 4]) * 10)) as [number, number, number, number]
const rectangleCenter = (points: [Point, Point, Point, Point]): Point => ({ x: points.reduce((sum, point) => sum + point.x, 0) / 4, y: points.reduce((sum, point) => sum + point.y, 0) / 4 })
const normalizeRectangle = (rectangle: DrawingRectangle): DrawingRectangle => {
  if (rectangle.points?.length === 4) return { ...rectangle, edgeLengthsMm: rectangle.edgeLengthsMm ?? edgeLengths(rectangle.points) }
  const center = rectangle.center ?? { x: 0, y: 0 }; const halfWidth = (rectangle.widthMm ?? 3000) / 20; const halfHeight = (rectangle.heightMm ?? 2000) / 20
  const base: [Point, Point, Point, Point] = [{ x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight }, { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight }]
  const angle = (rectangle.rotation ?? 0) * Math.PI / 180
  const points = base.map(point => ({ x: center.x + point.x * Math.cos(angle) - point.y * Math.sin(angle), y: center.y + point.x * Math.sin(angle) + point.y * Math.cos(angle) })) as [Point, Point, Point, Point]
  return { ...rectangle, points, edgeLengthsMm: edgeLengths(points) }
}

export default function App() {
  const [doc, setDoc] = useState<DrawingDocument>(EMPTY)
  const [history, setHistory] = useState<DrawingState[]>([{ lines: [], rectangles: [] }])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [tool, setTool] = useState<'select' | 'line' | 'rectangle'>('line')
  const [rectangleSize, setRectangleSize] = useState({ widthMm: '3000', heightMm: '2000' })
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [draft, setDraft] = useState<{ start: Point; end: Point } | null>(null)
  const [drawingStart, setDrawingStart] = useState<Point | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [grid, setGrid] = useState(true)
  const [snap, setSnap] = useState(true)
  const [menu, setMenu] = useState(false)
  const [library, setLibrary] = useState(false)
  const [savedDocs, setSavedDocs] = useState<DrawingDocument[]>([])
  const [toast, setToast] = useState('')
  const [spaceDown, setSpaceDown] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ distance: number; view: View } | null>(null)
  const touchMoved = useRef(false)
  const selectedLine = useMemo(() => doc.lines.find(line => line.id === selected) ?? null, [doc.lines, selected])
  const selectedRectangle = useMemo(() => (doc.rectangles ?? []).find(rectangle => rectangle.id === selected) ?? null, [doc.rectangles, selected])
  const rectangleWidth = Number(rectangleSize.widthMm)
  const rectangleHeight = Number(rectangleSize.heightMm)
  const rectangleSizeValid = rectangleSize.widthMm.trim() !== '' && rectangleSize.heightMm.trim() !== '' && Number.isFinite(rectangleWidth) && Number.isFinite(rectangleHeight) && rectangleWidth > 0 && rectangleHeight > 0

  const cancelDrawing = () => {
    setDrawingStart(null); setDraft(null)
    setGesture(current => current?.kind === 'draw' ? null : current)
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); cancelDrawing() } if (e.code === 'Space') { e.preventDefault(); setSpaceDown(true) } if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() } }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false) }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  })

  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 1600) }
  const screenPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const worldPoint = (point: Point): Point => ({ x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale })
  const commit = (state: DrawingState) => {
    const next = history.slice(0, historyIndex + 1).concat([state])
    setHistory(next); setHistoryIndex(next.length - 1); setDoc(current => ({ ...current, ...state }))
  }
  const undo = () => { if (historyIndex > 0) { const i = historyIndex - 1; setHistoryIndex(i); setDoc(d => ({ ...d, ...history[i] })); setSelected(null) } }
  const redo = () => { if (historyIndex < history.length - 1) { const i = historyIndex + 1; setHistoryIndex(i); setDoc(d => ({ ...d, ...history[i] })); setSelected(null) } }
  const updateSelected = (patch: Partial<DrawingLine>, record = true) => {
    if (!selected) return
    const lines = doc.lines.map(line => line.id === selected ? { ...line, ...patch } : line)
    record ? commit({ lines, rectangles: doc.rectangles ?? [] }) : setDoc(d => ({ ...d, lines }))
  }
  const updateSelectedRectangle = (patch: Partial<DrawingRectangle>) => {
    if (!selectedRectangle) return
    commit({ lines: doc.lines, rectangles: (doc.rectangles ?? []).map(rectangle => rectangle.id === selectedRectangle.id ? { ...rectangle, ...patch } : rectangle) })
  }
  const shapeSnapLines = (activeId: string): DrawingLine[] => {
    const sides = (doc.rectangles ?? []).filter(rectangle => rectangle.id !== activeId).flatMap(rectangle => rectangle.points.map((point, index) => ({ id: '', start: point, end: rectangle.points[(index + 1) % 4], lengthMm: 0, color: '', width: 0, style: 'solid' as const })))
    const perpendiculars = [...doc.lines, ...sides].map(line => ({ ...line, end: { x: line.start.x - (line.end.y - line.start.y), y: line.start.y + (line.end.x - line.start.x) } }))
    return [...doc.lines, ...sides, ...perpendiculars]
  }

  const finishLine = (start: Point, end: Point) => {
    if (distance(start, end) <= 4) return false
    const line: DrawingLine = { id: crypto.randomUUID(), start, end, lengthMm: Math.round(distance(start, end) * 10), color: COLORS[0], width: 3, style: 'solid' }
    commit({ lines: [...doc.lines, line], rectangles: doc.rectangles ?? [] }); setSelected(line.id); setTool('select'); cancelDrawing()
    return true
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) { e.preventDefault(); cancelDrawing(); return }
    e.currentTarget.setPointerCapture(e.pointerId)
    const screen = screenPoint(e); pointers.current.set(e.pointerId, screen)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { distance: distance(a, b), view: { ...view } }; setGesture(null); setDrawingStart(null); setDraft(null); return
    }
    const world = worldPoint(screen)
    if (spaceDown || e.button === 1 || tool === 'select' && e.target === e.currentTarget) { setGesture({ kind: 'pan', origin: screen, view: { ...view } }); return }
    if (tool === 'line') {
      setSelected(null)
      if (e.pointerType === 'mouse') {
        if (drawingStart) finishLine(drawingStart, snapPoint(drawingStart, world, doc.lines, snap))
        else { setDrawingStart(world); setDraft({ start: world, end: world }) }
      } else {
        const start = drawingStart ?? world
        touchMoved.current = false
        setGesture({ kind: 'draw', start, continuing: drawingStart !== null })
        setDraft({ start, end: snapPoint(start, world, doc.lines, snap) })
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const screen = screenPoint(e); if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, screen)
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const nextScale = Math.min(4, Math.max(.35, pinch.current.view.scale * distance(a, b) / pinch.current.distance))
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      setView({ x: center.x - (center.x - pinch.current.view.x) * nextScale / pinch.current.view.scale, y: center.y - (center.y - pinch.current.view.y) * nextScale / pinch.current.view.scale, scale: nextScale }); return
    }
    const world = worldPoint(screen)
    if (drawingStart && e.pointerType === 'mouse' && !gesture) setDraft({ start: drawingStart, end: snapPoint(drawingStart, world, doc.lines, snap) })
    if (!gesture) return
    if (gesture.kind === 'draw') {
      if (distance(gesture.start, world) > 4) touchMoved.current = true
      setDraft({ start: gesture.start, end: snapPoint(gesture.start, world, doc.lines, snap) })
    }
    if (gesture.kind === 'pan') setView({ ...gesture.view, x: gesture.view.x + screen.x - gesture.origin.x, y: gesture.view.y + screen.y - gesture.origin.y })
    if (gesture.kind === 'move') {
      const delta = { x: world.x - gesture.origin.x, y: world.y - gesture.origin.y }
      setDoc(d => ({ ...d, lines: d.lines.map(line => line.id === gesture.id ? { ...line, start: { x: gesture.start.x + delta.x, y: gesture.start.y + delta.y }, end: { x: gesture.end.x + delta.x, y: gesture.end.y + delta.y } } : line) }))
    }
    if (gesture.kind === 'rectMove') {
      const delta = { x: world.x - gesture.origin.x, y: world.y - gesture.origin.y }
      setDoc(d => ({ ...d, rectangles: d.rectangles.map(rectangle => rectangle.id === gesture.id ? { ...rectangle, points: gesture.points.map(point => ({ x: point.x + delta.x, y: point.y + delta.y })) as [Point, Point, Point, Point] } : rectangle) }))
    }
    if (gesture.kind === 'vertexMove') {
      setDoc(d => ({ ...d, rectangles: d.rectangles.map(rectangle => {
        if (rectangle.id !== gesture.id) return rectangle
        const points = [...rectangle.points] as [Point, Point, Point, Point]
        const previous = points[(gesture.index + 3) % 4]
        points[gesture.index] = snapPoint(previous, world, shapeSnapLines(rectangle.id), snap)
        return { ...rectangle, points, edgeLengthsMm: edgeLengths(points) }
      }) }))
    }
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null
    if (gesture?.kind === 'draw' && draft) {
      if (touchMoved.current || gesture.continuing) {
        if (!finishLine(draft.start, draft.end)) { setDrawingStart(draft.start); setDraft({ start: draft.start, end: draft.start }) }
      } else {
        setDrawingStart(gesture.start); setDraft({ start: gesture.start, end: gesture.start })
      }
    } else if (gesture?.kind === 'move' || gesture?.kind === 'rectMove' || gesture?.kind === 'vertexMove') commit({ lines: doc.lines, rectangles: doc.rectangles ?? [] })
    setGesture(null)
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault(); const p = screenPoint(e); const next = Math.min(4, Math.max(.35, view.scale * Math.exp(-e.deltaY * .001)))
    setView({ x: p.x - (p.x - view.x) * next / view.scale, y: p.y - (p.y - view.y) * next / view.scale, scale: next })
  }

  const selectLine = (e: React.PointerEvent, line: DrawingLine) => {
    if (tool === 'line') return
    e.stopPropagation(); setSelected(line.id); setTool('select')
    setGesture({ kind: 'move', id: line.id, origin: worldPoint(screenPoint(e)), start: line.start, end: line.end })
  }
  const selectRectangle = (e: React.PointerEvent, rectangle: DrawingRectangle) => {
    if (tool === 'line') return
    e.stopPropagation(); setSelected(rectangle.id); setTool('select')
    setGesture({ kind: 'rectMove', id: rectangle.id, origin: worldPoint(screenPoint(e)), points: rectangle.points })
  }
  const moveVertex = (e: React.PointerEvent, rectangle: DrawingRectangle, index: number) => {
    e.stopPropagation(); setSelected(rectangle.id); setTool('select')
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, screenPoint(e)); setGesture({ kind: 'vertexMove', id: rectangle.id, index })
  }

  const createRectangle = () => {
    if (!rectangleSizeValid) return
    const bounds = svgRef.current!.getBoundingClientRect()
    const center = worldPoint({ x: bounds.width / 2, y: bounds.height / 2 })
    const halfWidth = rectangleWidth / 20; const halfHeight = rectangleHeight / 20
    const points: [Point, Point, Point, Point] = [{ x: center.x - halfWidth, y: center.y - halfHeight }, { x: center.x + halfWidth, y: center.y - halfHeight }, { x: center.x + halfWidth, y: center.y + halfHeight }, { x: center.x - halfWidth, y: center.y + halfHeight }]
    const rectangle: DrawingRectangle = { id: crypto.randomUUID(), points, edgeLengthsMm: [rectangleWidth, rectangleHeight, rectangleWidth, rectangleHeight], rotation: 0, color: COLORS[0], width: 3 }
    commit({ lines: doc.lines, rectangles: [...(doc.rectangles ?? []), rectangle] }); setSelected(rectangle.id); setTool('select')
  }

  const save = async () => { const next = { ...doc, updatedAt: Date.now() }; await saveDrawing(next); setDoc(next); flash('この端末に保存しました'); setMenu(false) }
  const openLibrary = async () => { setSavedDocs(await listDrawings()); setLibrary(true); setMenu(false) }
  const load = (next: DrawingDocument) => { cancelDrawing(); const normalized = { ...next, rectangles: (next.rectangles ?? []).map(normalizeRectangle) }; setDoc(normalized); setHistory([{ lines: normalized.lines, rectangles: normalized.rectangles }]); setHistoryIndex(0); setSelected(null); setLibrary(false); flash('図面を開きました') }
  const newDrawing = () => { cancelDrawing(); const next = { ...EMPTY, id: crypto.randomUUID(), updatedAt: Date.now(), lines: [], rectangles: [] }; setDoc(next); setHistory([{ lines: [], rectangles: [] }]); setHistoryIndex(0); setSelected(null); setMenu(false) }
  const deleteSelected = () => { if (selected) { commit({ lines: doc.lines.filter(line => line.id !== selected), rectangles: (doc.rectangles ?? []).filter(rectangle => rectangle.id !== selected) }); setSelected(null) } }
  const changeLength = (mm: number) => {
    if (!selectedLine || !Number.isFinite(mm) || mm <= 0) return
    const current = distance(selectedLine.start, selectedLine.end) || 1; const target = mm / 10
    updateSelected({ end: { x: selectedLine.start.x + (selectedLine.end.x - selectedLine.start.x) * target / current, y: selectedLine.start.y + (selectedLine.end.y - selectedLine.start.y) * target / current }, lengthMm: mm })
  }
  const changeRectangleEdge = (index: number, mm: number) => {
    if (!selectedRectangle || !Number.isFinite(mm) || mm <= 0) return
    const points = [...selectedRectangle.points] as [Point, Point, Point, Point]
    const start = points[index]; const endIndex = (index + 1) % 4; const end = points[endIndex]
    const current = distance(start, end) || 1; const target = mm / 10
    points[endIndex] = { x: start.x + (end.x - start.x) * target / current, y: start.y + (end.y - start.y) * target / current }
    const lengths = edgeLengths(points); lengths[index] = mm
    updateSelectedRectangle({ points, edgeLengthsMm: lengths })
  }
  const rotateRectangle = (rotation: number) => {
    if (!selectedRectangle || !Number.isFinite(rotation)) return
    const center = rectangleCenter(selectedRectangle.points); const delta = (rotation - selectedRectangle.rotation) * Math.PI / 180
    const points = selectedRectangle.points.map(point => { const x = point.x - center.x; const y = point.y - center.y; return { x: center.x + x * Math.cos(delta) - y * Math.sin(delta), y: center.y + x * Math.sin(delta) + y * Math.cos(delta) } }) as [Point, Point, Point, Point]
    updateSelectedRectangle({ points, rotation })
  }

  return <main className="app">
    <header className="topbar">
      <button className="brand" onClick={() => setSelected(null)} aria-label="PlanSnap ホーム"><span className="logo">⌗</span><span>PlanSnap</span></button>
      <input className="doc-name" value={doc.name} onChange={e => setDoc({ ...doc, name: e.target.value })} aria-label="図面名" />
      <button className="icon-button" onClick={() => setMenu(!menu)} aria-label="メニュー">•••</button>
      {menu && <div className="menu popover">
        <button onClick={newDrawing}>＋ 新しい図面</button><button onClick={save}>✓ この端末に保存</button><button onClick={openLibrary}>▱ 保存済みを開く</button>
        <div className="separator" /><label><span>グリッド表示</span><input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)} /></label><label><span>スナップ補助</span><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /></label>
      </div>}
    </header>

    <section className="workspace">
      <svg ref={svgRef} className={`canvas ${spaceDown ? 'panning' : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onContextMenu={e => { e.preventDefault(); cancelDrawing() }} onWheel={onWheel}>
        <defs><pattern id="grid" width={24 * view.scale} height={24 * view.scale} patternUnits="userSpaceOnUse" x={view.x % (24 * view.scale)} y={view.y % (24 * view.scale)}><path d={`M ${24 * view.scale} 0 L 0 0 0 ${24 * view.scale}`} fill="none" stroke="#52635c" strokeOpacity=".1" strokeWidth="1" /></pattern></defs>
        {grid && <rect width="100%" height="100%" fill="url(#grid)" pointerEvents="none" />}
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {doc.lines.map(line => <g key={line.id} className={selected === line.id ? 'selected-line' : ''} onPointerDown={e => selectLine(e, line)}>
            <line className="line-hit" x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} />
            <line x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} stroke={line.color} strokeWidth={line.width / view.scale} strokeDasharray={line.style === 'dashed' ? `${12 / view.scale} ${8 / view.scale}` : undefined} vectorEffect="non-scaling-stroke" />
            <text x={(line.start.x + line.end.x) / 2} y={(line.start.y + line.end.y) / 2 - 10 / view.scale} fontSize={12 / view.scale} textAnchor="middle" className="measurement">{line.lengthMm} mm</text>
            {selected === line.id && <><circle cx={line.start.x} cy={line.start.y} r={6 / view.scale} /><circle cx={line.end.x} cy={line.end.y} r={6 / view.scale} /></>}
          </g>)}
          {(doc.rectangles ?? []).map(rectangle => <g key={rectangle.id} className={selected === rectangle.id ? 'selected-rectangle' : ''} onPointerDown={e => selectRectangle(e, rectangle)}>
            <polygon className="rectangle-hit" points={rectangle.points.map(point => `${point.x},${point.y}`).join(' ')} />
            <polygon className="rectangle-shape" points={rectangle.points.map(point => `${point.x},${point.y}`).join(' ')} fill="rgba(255,255,255,.2)" stroke={rectangle.color} strokeWidth={rectangle.width / view.scale} vectorEffect="non-scaling-stroke" />
            <text x={rectangleCenter(rectangle.points).x} y={rectangleCenter(rectangle.points).y} fontSize={12 / view.scale} textAnchor="middle" className="measurement">{rectangle.edgeLengthsMm.map(value => Math.round(value)).join(' / ')} mm</text>
            {selected === rectangle.id && rectangle.points.map((point, index) => <circle key={index} className="vertex-handle" cx={point.x} cy={point.y} r={8 / view.scale} onPointerDown={e => moveVertex(e, rectangle, index)} />)}
          </g>)}
          {draft && <line className="draft" x1={draft.start.x} y1={draft.start.y} x2={draft.end.x} y2={draft.end.y} strokeWidth={3 / view.scale} vectorEffect="non-scaling-stroke" />}
        </g>
      </svg>
      {doc.lines.length === 0 && (doc.rectangles ?? []).length === 0 && !draft && tool !== 'rectangle' && <div className="empty"><div className="gesture-mark">╱</div><strong>クリックまたはタップで始点を指定</strong><span>ドラッグ操作にも対応しています</span></div>}
      {drawingStart && <div className="draw-hint">終点をクリック · Esc / 右クリックでキャンセル</div>}
      <div className="zoom-chip">{Math.round(view.scale * 100)}%</div>
    </section>

    {tool === 'rectangle' && <aside className="shape-creator">
      <div className="inspector-head"><strong>四角形を作成</strong><button onClick={() => setTool('select')}>閉じる</button></div>
      <div className="shape-size-fields">
        <label><span>横寸法</span><div><input type="number" inputMode="numeric" min="1" value={rectangleSize.widthMm} onFocus={e => e.currentTarget.select()} onChange={e => setRectangleSize({ ...rectangleSize, widthMm: e.target.value })} /><em>mm</em></div></label>
        <label><span>縦寸法</span><div><input type="number" inputMode="numeric" min="1" value={rectangleSize.heightMm} onFocus={e => e.currentTarget.select()} onChange={e => setRectangleSize({ ...rectangleSize, heightMm: e.target.value })} /><em>mm</em></div></label>
      </div>
      {!rectangleSizeValid && <p className="size-error">1以上の寸法を入力してください</p>}
      <button className="create-shape" disabled={!rectangleSizeValid} onClick={createRectangle}>中央に作成</button>
    </aside>}

    {selectedLine && <aside className="inspector">
      <div className="inspector-head"><strong>線を編集</strong><button onClick={() => setSelected(null)}>完了</button></div>
      <div className="fields">
        <label className="length-field"><span>長さ</span><div><input type="number" value={selectedLine.lengthMm} onChange={e => changeLength(Number(e.target.value))} /><em>mm</em></div></label>
        <label><span>太さ</span><select value={selectedLine.width} onChange={e => updateSelected({ width: Number(e.target.value) })}><option value="2">細い</option><option value="3">標準</option><option value="5">太い</option></select></label>
        <label><span>線種</span><select value={selectedLine.style} onChange={e => updateSelected({ style: e.target.value as 'solid' | 'dashed' })}><option value="solid">実線</option><option value="dashed">破線</option></select></label>
      </div>
      <div className="color-row">{COLORS.map(color => <button key={color} className={selectedLine.color === color ? 'active' : ''} style={{ background: color }} onClick={() => updateSelected({ color })} aria-label={`色 ${color}`} />)}<button className="delete" onClick={deleteSelected}>削除</button></div>
    </aside>}

    {selectedRectangle && <aside className="inspector">
      <div className="inspector-head"><strong>四辺形を編集</strong><button onClick={() => setSelected(null)}>完了</button></div>
      <div className="edge-fields">
        {selectedRectangle.edgeLengthsMm.map((length, index) => <label key={index}><span>辺 {index + 1}</span><div><input type="number" inputMode="numeric" min="1" value={Math.round(length)} onChange={e => changeRectangleEdge(index, Number(e.target.value))} /><em>mm</em></div></label>)}
      </div>
      <label className="rotation-field"><span>全体を回転</span><div><input type="range" min="-180" max="180" value={selectedRectangle.rotation} onChange={e => rotateRectangle(Number(e.target.value))} /><input type="number" inputMode="decimal" min="-180" max="180" value={selectedRectangle.rotation} onChange={e => rotateRectangle(Number(e.target.value))} /><em>°</em></div></label>
      <div className="color-row">{COLORS.map(color => <button key={color} className={selectedRectangle.color === color ? 'active' : ''} style={{ background: color }} onClick={() => updateSelectedRectangle({ color })} aria-label={`色 ${color}`} />)}<button className="delete" onClick={deleteSelected}>削除</button></div>
    </aside>}

    <nav className="toolbar" aria-label="作図ツール">
      <button className={tool === 'line' ? 'active' : ''} onClick={() => { cancelDrawing(); setTool('line'); setSelected(null) }}><span>╱</span>線</button>
      <button className={tool === 'rectangle' ? 'active' : ''} onClick={() => { cancelDrawing(); setSelected(null); setTool('rectangle') }}><span>□</span>図形</button><button onClick={() => flash('テンプレは次の段階で追加予定です')}><span>▦</span>テンプレ</button><button onClick={() => flash('文字は次の段階で追加予定です')}><span>T</span>文字</button>
      <button disabled={historyIndex === 0} onClick={undo}><span>↶</span>戻る</button>
      <button className="redo" disabled={historyIndex >= history.length - 1} onClick={redo} aria-label="やり直す">↷</button>
    </nav>

    {library && <div className="modal-backdrop" onClick={() => setLibrary(false)}><section className="library" onClick={e => e.stopPropagation()}><header><h2>保存した図面</h2><button onClick={() => setLibrary(false)}>閉じる</button></header>{savedDocs.length ? savedDocs.map(item => <button className="drawing-card" key={item.id} onClick={() => load(item)}><strong>{item.name}</strong><span>{item.lines.length}本の線・{item.rectangles?.length ?? 0}個の図形 · {new Date(item.updatedAt).toLocaleString('ja-JP')}</span></button>) : <p>保存済みの図面はありません。</p>}</section></div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </main>
}
