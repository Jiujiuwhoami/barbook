export type LayoutMode = 1 | 2 | 4 | 6
export type ChartConfig = {
  id: string
  symbol: string
  timeframe: string
}
export type Candle = {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
export type SymbolInfo = {
  symbol: string
  name: string
  price: string
  change: string
  color: string
  timeframes: string[]
}
export type DrawingRecord = {
  id: string
  symbol: string
  timeframe: string
  type: string
  points: unknown[]
  color?: string
  width?: number
  dashed?: boolean
  label?: string
  createdAt?: number
}
export type ReviewStatus = 'open' | 'verified' | 'falsified' | 'expired' | 'abandoned'
export type ReviewAnchor = {
  /** 锚定 K 线的时间戳（毫秒，与 klinecharts 一致） */
  timestamp: number
  /** 锚点价格（可选）；缺省时旗标贴在 K 线上方 */
  price?: number
  /** 无 price 时旗标贴在 K 线的哪个位置 */
  side?: 'high' | 'low' | 'close'
}

/** App 传给各 ChartPanel 的锚点联动目标；仅与自身 symbol+timeframe 匹配的面板滚动并画旗标 */
export type ReviewAnchorTarget = {
  symbol: string
  timeframe: string
  ts: number
  title: string
  status: string
  /** 锚点价格；缺省时按 side 取 K 线的 high/low/close */
  price?: number
  side?: 'high' | 'low' | 'close'
  /** 每次载入记录都自增，确保同记录重复载入也能重新联动 */
  nonce: number
}
export type Review = {
  id: string
  title: string
  content: string
  symbol: string
  timeframe: string
  tags: string[]
  createdAt: number
  // 判断层
  setup?: string
  direction?: string
  entry?: number | null
  targets?: number[]
  invalidation?: number | null
  rationale?: string
  horizon?: string
  // 结果层
  status?: ReviewStatus
  resolvedAt?: number | null
  outcomeNote?: string
  // 锚定 K 线：复盘针对哪一根 K 线
  anchor?: ReviewAnchor | null
  // 上下文引用
  refs?: string[]
  dateStart?: number | null
  dateEnd?: number | null
}

/** 导出的 ML 训练样本：复盘记录 + 锚点 K 线行情窗口 + 自动结果标签 */
export type ReviewOutcome = {
  basis: number | null
  finalClose: number | null
  retPct: number | null
  mfePct: number | null
  maePct: number | null
  hitTarget: boolean
  hitInvalidation: boolean
  targetHitIndex: number | null
  invalidationHitIndex: number | null
  sequence: 'none' | 'target' | 'invalidation' | 'ambiguous'
  resolvedBy: string
}

export type ReviewExport = Review & {
  anchorTs: number | null
  anchorPrice: number | null
  market: {
    ctx: number
    before: Candle[]
    after: Candle[]
  }
  outcome: ReviewOutcome
}
