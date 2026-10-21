import { registerOverlay, LineType, type OverlayFigureIgnoreEventType } from 'klinecharts'

export type ToolName =
  | '光标' | '趋势线' | '水平线' | '垂直线' | '射线' | '线段'
  | '矩形' | '圆形' | '箭头' | '文字' | '斐波那契' | '测量工具'

/** 工具 → overlay name（内置 + 自定义） */
export const toolOverlay: Record<ToolName, string> = {
  '光标': '',
  '趋势线': 'straightLine',
  '水平线': 'horizontalStraightLine',
  '垂直线': 'verticalStraightLine',
  '射线': 'rayLine',
  '线段': 'segment',
  '矩形': 'rectTool',
  '圆形': 'circleTool',
  '箭头': 'arrowTool',
  '文字': 'textTool',
  '斐波那契': 'fibonacciLine',
  '测量工具': 'measureTool',
}

type Params = {
  coordinates: Array<{ x: number; y: number }>
  bounding: { width: number; height: number }
  overlay: { extendData?: unknown; points?: Array<{ value?: number }> }
}

/** 图形本体忽略的事件列表(保留 mouseRightClickEvent,使右键可删除) */
const BODY_IGNORE: OverlayFigureIgnoreEventType[] = ['mouseClickEvent', 'tapEvent', 'doubleTapEvent', 'mouseDownEvent', 'touchStartEvent', 'mouseMoveEvent', 'touchMoveEvent', 'mouseDoubleClickEvent']
function registerCustom() {
  // 矩形：点1 角 → 点2 对角
  registerOverlay({
    name: 'rectTool',
    totalStep: 2,
    needDefaultPointFigure: true,
    createPointFigures: (p: unknown) => {
      const { coordinates, bounding } = p as { coordinates: Array<{ x: number; y: number }>; bounding: { width: number; height: number } }
      if (coordinates.length < 2) return []
      const x = Math.min(coordinates[0].x, coordinates[1].x)
      const y = Math.min(coordinates[0].y, coordinates[1].y)
      const w = Math.abs(coordinates[1].x - coordinates[0].x)
      const h = Math.abs(coordinates[1].y - coordinates[0].y)
      return [{ type: 'rect', attrs: { x, y, width: w, height: h }, ignoreEvent: BODY_IGNORE }]
    },
  })

  // 圆形：点1 圆心 → 点2 定半径
  registerOverlay({
    name: 'circleTool',
    totalStep: 2,
    needDefaultPointFigure: true,
    createPointFigures: (p: unknown) => {
      const { coordinates } = p as { coordinates: Array<{ x: number; y: number }> }
      if (coordinates.length < 2) return []
      const r = Math.hypot(coordinates[1].x - coordinates[0].x, coordinates[1].y - coordinates[0].y)
      return [{ type: 'circle', attrs: { x: coordinates[0].x, y: coordinates[0].y, r }, ignoreEvent: BODY_IGNORE }]
    },
  })

  // 箭头：点1 尾 → 点2 头，带三角箭头
  registerOverlay({
    name: 'arrowTool',
    totalStep: 2,
    needDefaultPointFigure: true,
    createPointFigures: (p: unknown) => {
      const { coordinates } = p as { coordinates: Array<{ x: number; y: number }> }
      if (coordinates.length < 2) return []
      const [a, b] = coordinates
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const L = 10, W = 4
      const head = [
        { x: b.x, y: b.y },
        { x: b.x - L * Math.cos(ang - Math.atan(W / L)), y: b.y - L * Math.sin(ang - Math.atan(W / L)) },
        { x: b.x - L * Math.cos(ang + Math.atan(W / L)), y: b.y - L * Math.sin(ang + Math.atan(W / L)) },
      ]
      const tip = Math.max(0, L * 0.8)
      const tail = { x: b.x - tip * Math.cos(ang), y: b.y - tip * Math.sin(ang) }
      return [
        { type: 'line', attrs: { coordinates: [a, tail] }, ignoreEvent: BODY_IGNORE },
        { type: 'polygon', attrs: { coordinates: head }, ignoreEvent: BODY_IGNORE },
      ]
    },
  })

  // 文字标注：单击，文字来自 extendData
  registerOverlay({
    name: 'textTool',
    totalStep: 1,
    needDefaultPointFigure: false,
    createPointFigures: (p: unknown) => {
      const { coordinates, overlay } = p as Params
      if (coordinates.length < 1) return []
      const text = typeof overlay.extendData === 'string' ? overlay.extendData : ''
      return [{ type: 'text', attrs: { x: coordinates[0].x, y: coordinates[0].y - 8, text, align: 'center', baseline: 'bottom' }, ignoreEvent: BODY_IGNORE }]
    },
  })

  // 测量：点1→点2 连线 + 价差标签（extendData 存标签字符串）
  registerOverlay({
    name: 'measureTool',
    totalStep: 2,
    needDefaultPointFigure: true,
    createPointFigures: (p: unknown) => {
      const { coordinates, overlay } = p as Params
      if (coordinates.length < 2) return []
      const [a, b] = coordinates
      const label = typeof overlay.extendData === 'string' ? overlay.extendData : ''
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 14 }
      const v1 = overlay.points?.[0]?.value
      const v2 = overlay.points?.[1]?.value
      const text = label || (v1 != null && v2 != null ? `Δ ${v2 - v1 >= 0 ? '+' : ''}${(v2 - v1).toFixed(2)} (${v1 ? ((v2 - v1) / v1 * 100).toFixed(2) : '0.00'}%)` : '')
      return [
        { type: 'line', attrs: { coordinates: [a, b] }, ignoreEvent: BODY_IGNORE },
        { type: 'text', attrs: { x: mid.x, y: mid.y, text, align: 'center', baseline: 'middle' }, ignoreEvent: BODY_IGNORE },
      ]
    },
  })

  // 锚点旗标：单点，竖直短 tick + 上方文字旗标（extendData: { label, status }）
  registerOverlay({
    name: FLAG_NAME,
    totalStep: 1,
    needDefaultPointFigure: false,
    createPointFigures: (p: unknown) => {
      const { coordinates, overlay } = p as Params
      if (coordinates.length < 1) return []
      const pt = coordinates[0]
      const ed = (overlay.extendData ?? {}) as { label?: string; status?: string }
      const color = flagColor(ed.status ?? 'open')
      const tickH = 14
      return [
        { type: 'line', attrs: { coordinates: [{ x: pt.x, y: pt.y }, { x: pt.x, y: pt.y - tickH }] }, ignoreEvent: BODY_IGNORE, styles: { color } },
        { type: 'text', attrs: { x: pt.x, y: pt.y - tickH - 4, text: ed.label || '', align: 'center', baseline: 'bottom' }, ignoreEvent: BODY_IGNORE, styles: { color, size: 11 } },
      ]
    },
  })
}
let registered = false
export function registerCustomOverlays() {
  if (registered) return
  registered = true
  registerCustom()
}
export type DrawStyle = { color: string; width: number; dashed: boolean }

export function styleFor(s: DrawStyle) {
  const line = { color: s.color, size: s.width, style: s.dashed ? LineType.Dashed : LineType.Solid }
  return {
    line,
    polygon: { ...line },
    rect: line,
    text: { color: s.color, size: 12 },
    point: { color: s.color, borderColor: s.color, borderSize: 1, radius: 3, activeColor: s.color, activeBorderColor: s.color, activeBorderSize: 1, activeRadius: 3 },
  }
}

/** 复盘锚点旗标 overlay 名（非可编辑工具，由 App 在载入记录时按 anchor 渲染） */
export const FLAG_NAME = 'reviewAnchor'

/** 状态 → 旗标颜色 */
export function flagColor(status: string): string {
  switch (status) {
    case 'verified': return '#34d399'
    case 'falsified': return '#f05268'
    case 'expired': return '#94a3b8'
    case 'abandoned': return '#64748b'
    default: return '#f5b54a' // open
  }
}

/** 在某图创建一个复盘锚点旗标（竖 tick + 标题文字），extendData 存 { label, status } 供着色 */
export function createAnchorFlag(
  chart: import('klinecharts').Chart,
  point: { timestamp: number; value: number },
  label: string,
  status: string,
) : string | null {
  const id = chart.createOverlay({
    name: FLAG_NAME,
    points: [{ timestamp: point.timestamp, value: point.value }],
    extendData: { label, status },
    lock: true,
  })
  return Array.isArray(id) ? id[0] : id
}
