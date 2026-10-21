import type { Chart } from 'klinecharts'

/** 面板间时间窗口/十字光标联动 + 截图共用的图表注册表 */
export type Peer = {
  id: string
  chart: Chart
  timeframe: string
  /** 应用联动时置位，短暂阻止回声 */
  guardedUntil: number
  /** 该图最近一次十字光标所在的 K 线时间戳（毫秒），用于「钉当前 K 线」 */
  lastCrossTs: number
  /** 该十字 K 线的收盘价，锚点旗标定位用 */
  lastCrossClose: number
}

const peers = new Map<string, Peer>()

export const TF_SEC: Record<string, number> = {
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800,
  '12h': 43200, '1D': 86400, '1W': 604800,
}

export function tfSeconds(tf: string): number {
  return TF_SEC[tf] ?? TF_SEC[tf.toLowerCase()] ?? 3600
}

export function registerPeer(id: string, chart: Chart, timeframe: string) {
  peers.set(id, { id, chart, timeframe, guardedUntil: 0, lastCrossTs: 0, lastCrossClose: 0 })
}

export function unregisterPeer(id: string) {
  peers.delete(id)
}

/** 记录某图最近一次十字光标所在 K 线时刻（毫秒）；ts 变化时广播 cross-move */
export function recordLastCross(id: string, ts: number, close?: number) {
  const p = peers.get(id)
  if (!p || ts <= 0) return
  const changed = p.lastCrossTs !== ts
  p.lastCrossTs = ts
  if (close !== undefined && close !== 0) p.lastCrossClose = close
  if (changed) {
    for (const cb of crossMoveSubs) {
      try { cb({ id, ts, close: p.lastCrossClose }) } catch { /* 订阅者异常不中断其它订阅者 */ }
    }
  }
}

/** 取某图最近一次十字 K 线时刻；无记录返回 0 */
export function getLastCross(id: string): number {
  return peers.get(id)?.lastCrossTs ?? 0
}

/** 取某图最近一次十字 K 线的收盘价；无记录返回 0 */
export function getLastCrossClose(id: string): number {
  return peers.get(id)?.lastCrossClose ?? 0
}

type CrossMoveEvent = { id: string; ts: number; close: number }
const crossMoveSubs = new Set<(e: CrossMoveEvent) => void>()
/** 订阅某图十字 K 线变化（ts 变化才触发）；返回取消函数 */
export function onCrossMove(cb: (e: CrossMoveEvent) => void): () => void {
  crossMoveSubs.add(cb)
  return () => { crossMoveSubs.delete(cb) }
}

/** 其它所有已注册面板（不含 selfId），且未处于 guarded 窗口 */
export function livePeers(selfId: string, guardMs = 200): Peer[] {
  const now = Date.now()
  const out: Peer[] = []
  for (const p of peers.values()) {
    if (p.id === selfId || p.guardedUntil > now) continue
    out.push(p)
  }
  return out
}

export function guardPeer(id: string, ms = 200) {
  const p = peers.get(id)
  if (p) p.guardedUntil = Date.now() + ms
}

/** 程序化联动 peer 的可见窗口期间置位，让 peer 的 onVisibleRangeChange 不反弹 */
let applyingVisible = false
export function beginApplyVisible() { applyingVisible = true }
export function endApplyVisible() { applyingVisible = false }
export function isApplyingVisible() { return applyingVisible }

export function isGuarded(id: string): boolean {
  const p = peers.get(id)
  return !!p && p.guardedUntil > Date.now()
}

export function getPeerChart(id: string): Chart | null {
  return peers.get(id)?.chart ?? null
}

/** 把源面板的可见时间窗口 [t0,t1] 应用到目标面板：同跨度缩放 + 右端对齐 t1 */
export function applyTimeWindow(src: Peer, t0: number, t1: number, target: Peer) {
  // t0/t1 为毫秒时间戳，tfSeconds 为秒：先换算目标周期该显示多少根 K 线
  const spanSec = (t1 - t0) / 1000
  const count = Math.max(2, Math.round(spanSec / tfSeconds(target.timeframe)))
  const width = target.chart.getSize('candle_pane')?.width ?? 800
  const barSpace = Math.max(1, width / count)
  beginApplyVisible()
  try {
    target.chart.setBarSpace(barSpace)
    const data = target.chart.getDataList()
    if (data.length === 0) return
    // 右对齐到源窗口右端 t1：把目标数据里时间戳 <= t1 的最后一根放最右
    const rightIdx = lowerBoundIndex(data, t1)
    if (rightIdx >= 0) target.chart.scrollToDataIndex(rightIdx)
  } finally {
    endApplyVisible()
  }
}

/** 返回时间戳 <= ts 的最后一根 K 线在升序数据中的下标；找不到返回 -1 */
function lowerBoundIndex(data: { timestamp: number }[], ts: number): number {
  let lo = 0
  let hi = data.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (data[mid].timestamp <= ts) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** 把源面板十字光标所在时刻对齐到目标面板（按时间戳，跨周期/品种都落在同一时点） */
export function applyCrossTimestamp(srcTs: number, target: Peer) {
  const px = target.chart.convertToPixel({ timestamp: srcTs }, { paneId: 'candle_pane' }) as Partial<{ x: number }>
  if (typeof px?.x !== 'number') return
  target.chart.executeAction('onCrosshairChange' as never, { x: px.x })
  guardPeer(target.id, 150)
}

export function getVisibleTimestamps(chart: Chart): { t0: number; t1: number } {
  const vr = chart.getVisibleRange()
  const data = chart.getDataList()
  const from = Math.max(0, Math.min(vr.realFrom, data.length - 1))
  const to = Math.max(0, Math.min(vr.realTo, data.length - 1))
  const t0 = data[from]?.timestamp ?? 0
  const t1 = data[to]?.timestamp ?? t0
  return { t0, t1 }
}
