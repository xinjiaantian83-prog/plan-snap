import { useEffect, useMemo, useRef, useState } from 'react'
import { listDrawings, saveDrawing } from './db'
import { distance, snapPoint } from './geometry'
import type { DrawingDocument, DrawingLine, Point } from './types'

const EMPTY: DrawingDocument = { id: crypto.randomUUID(), name: '名称未設定の図面', updatedAt: Date.now(), lines: [] }
const COLORS = ['#253331', '#2f6f69', '#bd5a43', '#42658c']
type View = { x: number; y: number; scale: number }
type Gesture = { kind: 'draw'; start: Point } | { kind: 'move'; id: string; origin: Point; start: Point; end: Point } | { kind: 'pan'; origin: Point; view: View }

export default function App() {
  const [doc, setDoc] = useState<DrawingDocument>(EMPTY)
  const [history, setHistory] = useState<DrawingLine[][]>([[]])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [tool, setTool] = useState<'select' | 'line'>('line')
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [draft, setDraft] = useState<{ start: Point; end: Point } | null>(null)
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
  const selectedLine = useMemo(() => doc.lines.find(line => line.id === selected) ?? null, [doc.lines, selected])

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); setSpaceDown(true) } if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() } }
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
  const commit = (lines: DrawingLine[]) => {
    const next = history.slice(0, historyIndex + 1).concat([lines])
    setHistory(next); setHistoryIndex(next.length - 1); setDoc(current => ({ ...current, lines }))
  }
  const undo = () => { if (historyIndex > 0) { const i = historyIndex - 1; setHistoryIndex(i); setDoc(d => ({ ...d, lines: history[i] })); setSelected(null) } }
  const redo = () => { if (historyIndex < history.length - 1) { const i = historyIndex + 1; setHistoryIndex(i); setDoc(d => ({ ...d, lines: history[i] })); setSelected(null) } }
  const updateSelected = (patch: Partial<DrawingLine>, record = true) => {
    if (!selected) return
    const lines = doc.lines.map(line => line.id === selected ? { ...line, ...patch } : line)
    record ? commit(lines) : setDoc(d => ({ ...d, lines }))
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const screen = screenPoint(e); pointers.current.set(e.pointerId, screen)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { distance: distance(a, b), view: { ...view } }; setGesture(null); setDraft(null); return
    }
    const world = worldPoint(screen)
    if (spaceDown || e.button === 1 || tool === 'select' && e.target === e.currentTarget) { setGesture({ kind: 'pan', origin: screen, view: { ...view } }); return }
    if (tool === 'line') { setSelected(null); setGesture({ kind: 'draw', start: world }); setDraft({ start: world, end: world }) }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const screen = screenPoint(e); if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, screen)
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const nextScale = Math.min(4, Math.max(.35, pinch.current.view.scale * distance(a, b) / pinch.current.distance))
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      setView({ x: center.x - (center.x - pinch.current.view.x) * nextScale / pinch.current.view.scale, y: center.y - (center.y - pinch.current.view.y) * nextScale / pinch.current.view.scale, scale: nextScale }); return
    }
    if (!gesture) return
    const world = worldPoint(screen)
    if (gesture.kind === 'draw') setDraft({ start: gesture.start, end: snapPoint(gesture.start, world, doc.lines, snap) })
    if (gesture.kind === 'pan') setView({ ...gesture.view, x: gesture.view.x + screen.x - gesture.origin.x, y: gesture.view.y + screen.y - gesture.origin.y })
    if (gesture.kind === 'move') {
      const delta = { x: world.x - gesture.origin.x, y: world.y - gesture.origin.y }
      setDoc(d => ({ ...d, lines: d.lines.map(line => line.id === gesture.id ? { ...line, start: { x: gesture.start.x + delta.x, y: gesture.start.y + delta.y }, end: { x: gesture.end.x + delta.x, y: gesture.end.y + delta.y } } : line) }))
    }
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null
    if (gesture?.kind === 'draw' && draft && distance(draft.start, draft.end) > 4) {
      const line: DrawingLine = { id: crypto.randomUUID(), start: draft.start, end: draft.end, lengthMm: Math.round(distance(draft.start, draft.end) * 10), color: COLORS[0], width: 3, style: 'solid' }
      commit([...doc.lines, line]); setSelected(line.id); setTool('select')
    } else if (gesture?.kind === 'move') commit(doc.lines)
    setGesture(null); setDraft(null)
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault(); const p = screenPoint(e); const next = Math.min(4, Math.max(.35, view.scale * Math.exp(-e.deltaY * .001)))
    setView({ x: p.x - (p.x - view.x) * next / view.scale, y: p.y - (p.y - view.y) * next / view.scale, scale: next })
  }

  const selectLine = (e: React.PointerEvent, line: DrawingLine) => {
    e.stopPropagation(); setSelected(line.id); setTool('select')
    setGesture({ kind: 'move', id: line.id, origin: worldPoint(screenPoint(e)), start: line.start, end: line.end })
  }

  const save = async () => { const next = { ...doc, updatedAt: Date.now() }; await saveDrawing(next); setDoc(next); flash('この端末に保存しました'); setMenu(false) }
  const openLibrary = async () => { setSavedDocs(await listDrawings()); setLibrary(true); setMenu(false) }
  const load = (next: DrawingDocument) => { setDoc(next); setHistory([next.lines]); setHistoryIndex(0); setSelected(null); setLibrary(false); flash('図面を開きました') }
  const newDrawing = () => { const next = { ...EMPTY, id: crypto.randomUUID(), updatedAt: Date.now() }; setDoc(next); setHistory([[]]); setHistoryIndex(0); setSelected(null); setMenu(false) }
  const deleteSelected = () => { if (selected) { commit(doc.lines.filter(line => line.id !== selected)); setSelected(null) } }
  const changeLength = (mm: number) => {
    if (!selectedLine || !Number.isFinite(mm) || mm <= 0) return
    const current = distance(selectedLine.start, selectedLine.end) || 1; const target = mm / 10
    updateSelected({ end: { x: selectedLine.start.x + (selectedLine.end.x - selectedLine.start.x) * target / current, y: selectedLine.start.y + (selectedLine.end.y - selectedLine.start.y) * target / current }, lengthMm: mm })
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
      <svg ref={svgRef} className={`canvas ${spaceDown ? 'panning' : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}>
        <defs><pattern id="grid" width={24 * view.scale} height={24 * view.scale} patternUnits="userSpaceOnUse" x={view.x % (24 * view.scale)} y={view.y % (24 * view.scale)}><path d={`M ${24 * view.scale} 0 L 0 0 0 ${24 * view.scale}`} fill="none" stroke="#52635c" strokeOpacity=".1" strokeWidth="1" /></pattern></defs>
        {grid && <rect width="100%" height="100%" fill="url(#grid)" pointerEvents="none" />}
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {doc.lines.map(line => <g key={line.id} className={selected === line.id ? 'selected-line' : ''} onPointerDown={e => selectLine(e, line)}>
            <line className="line-hit" x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} />
            <line x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} stroke={line.color} strokeWidth={line.width / view.scale} strokeDasharray={line.style === 'dashed' ? `${12 / view.scale} ${8 / view.scale}` : undefined} vectorEffect="non-scaling-stroke" />
            <text x={(line.start.x + line.end.x) / 2} y={(line.start.y + line.end.y) / 2 - 10 / view.scale} fontSize={12 / view.scale} textAnchor="middle" className="measurement">{line.lengthMm} mm</text>
            {selected === line.id && <><circle cx={line.start.x} cy={line.start.y} r={6 / view.scale} /><circle cx={line.end.x} cy={line.end.y} r={6 / view.scale} /></>}
          </g>)}
          {draft && <line className="draft" x1={draft.start.x} y1={draft.start.y} x2={draft.end.x} y2={draft.end.y} strokeWidth={3 / view.scale} vectorEffect="non-scaling-stroke" />}
        </g>
      </svg>
      {doc.lines.length === 0 && !draft && <div className="empty"><div className="gesture-mark">╱</div><strong>指でなぞって線を引く</strong><span>2本指で拡大・移動できます</span></div>}
      <div className="zoom-chip">{Math.round(view.scale * 100)}%</div>
    </section>

    {selectedLine && <aside className="inspector">
      <div className="inspector-head"><strong>線を編集</strong><button onClick={() => setSelected(null)}>完了</button></div>
      <div className="fields">
        <label className="length-field"><span>長さ</span><div><input type="number" value={selectedLine.lengthMm} onChange={e => changeLength(Number(e.target.value))} /><em>mm</em></div></label>
        <label><span>太さ</span><select value={selectedLine.width} onChange={e => updateSelected({ width: Number(e.target.value) })}><option value="2">細い</option><option value="3">標準</option><option value="5">太い</option></select></label>
        <label><span>線種</span><select value={selectedLine.style} onChange={e => updateSelected({ style: e.target.value as 'solid' | 'dashed' })}><option value="solid">実線</option><option value="dashed">破線</option></select></label>
      </div>
      <div className="color-row">{COLORS.map(color => <button key={color} className={selectedLine.color === color ? 'active' : ''} style={{ background: color }} onClick={() => updateSelected({ color })} aria-label={`色 ${color}`} />)}<button className="delete" onClick={deleteSelected}>削除</button></div>
    </aside>}

    <nav className="toolbar" aria-label="作図ツール">
      <button className={tool === 'line' ? 'active' : ''} onClick={() => { setTool('line'); setSelected(null) }}><span>╱</span>線</button>
      <button onClick={() => flash('図形は次の段階で追加予定です')}><span>□</span>図形</button><button onClick={() => flash('テンプレは次の段階で追加予定です')}><span>▦</span>テンプレ</button><button onClick={() => flash('文字は次の段階で追加予定です')}><span>T</span>文字</button>
      <button disabled={historyIndex === 0} onClick={undo}><span>↶</span>戻る</button>
      <button className="redo" disabled={historyIndex >= history.length - 1} onClick={redo} aria-label="やり直す">↷</button>
    </nav>

    {library && <div className="modal-backdrop" onClick={() => setLibrary(false)}><section className="library" onClick={e => e.stopPropagation()}><header><h2>保存した図面</h2><button onClick={() => setLibrary(false)}>閉じる</button></header>{savedDocs.length ? savedDocs.map(item => <button className="drawing-card" key={item.id} onClick={() => load(item)}><strong>{item.name}</strong><span>{item.lines.length}本の線 · {new Date(item.updatedAt).toLocaleString('ja-JP')}</span></button>) : <p>保存済みの図面はありません。</p>}</section></div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </main>
}
