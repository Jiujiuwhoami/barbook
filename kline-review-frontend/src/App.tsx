import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlignJustify, ArrowDownUp, BarChart3, CalendarDays, Check, ChevronDown,
  Database, Download, LayoutGrid, Moon, Pin, Plus, Search, Settings2, SlidersHorizontal,
  Star, Sun, TrendingUp, Waves, X,
} from 'lucide-react'
import ChartPanel from './components/ChartPanel'
import { api, type Health } from './api'
import type { ChartConfig, LayoutMode, SymbolInfo, Review, ReviewStatus, ReviewAnchor, ReviewAnchorTarget } from './types'
import { toolOverlay, type DrawStyle, type ToolName } from './drawings'
import { downloadExport, type ExportFormat } from './export'
import { onCrossMove, getLastCross, getLastCrossClose, getPeerChart } from './sync'


const initialCharts: ChartConfig[] = [
  { id: 'chart-1', symbol: 'BTCUSDT', timeframe: '15m' },
  { id: 'chart-2', symbol: 'BTCUSDT', timeframe: '1h' },
  { id: 'chart-3', symbol: 'BTCUSDT', timeframe: '4h' },
  { id: 'chart-4', symbol: 'BTCUSDT', timeframe: '1D' },
  { id: 'chart-5', symbol: 'ETHUSDT', timeframe: '1h' },
  { id: 'chart-6', symbol: 'SOLUSDT', timeframe: '1h' },
]

const WORKSPACE_ID = 'ws-main'
const FAV_KEY = 'kr-favorites'
const MAJOR_SET = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT'])
const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  open: '待验证', verified: '已验证', falsified: '已证伪', expired: '已过期', abandoned: '已放弃',
}
const REVIEW_STATUS_ORDER: ReviewStatus[] = ['open', 'verified', 'falsified', 'expired', 'abandoned']
const DIRECTIONS = ['long', 'short', 'range', 'breakout'] as const
type ReviewDraft = {
  title: string; content: string; tags: string
  setup: string; direction: string; entry: string; targets: string; invalidation: string; rationale: string; horizon: string
  status: ReviewStatus; outcomeNote: string; refs: string[]; anchor: ReviewAnchor | null
}
const REVIEW_DRAFT_DEFAULT: ReviewDraft = {
  title: '', content: '', tags: '',
  setup: '', direction: '', entry: '', targets: '', invalidation: '', rationale: '', horizon: '',
  status: 'open', outcomeNote: '', refs: [], anchor: null,
}
const parseNum = (s: string) => { const n = Number(s); return s.trim() === '' || Number.isNaN(n) ? null : n }
const parseList = (s: string) => s.split(/[,，]/).map(x => x.trim()).filter(Boolean)



export default function App() {
  const [layout, setLayout] = useState<LayoutMode>(4)
  const [charts, setCharts] = useState(initialCharts)
  const [activeId, setActiveId] = useState('chart-1')
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT')
  const [query, setQuery] = useState('')
  const [sync, setSync] = useState(true)
  const [dark, setDark] = useState(true)
  const [tool, setTool] = useState<ToolName>('光标')
  const [drawStyle, setDrawStyle] = useState<DrawStyle>({ color: '#3b82f6', width: 2, dashed: false })
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [draft, setDraft] = useState<ReviewDraft>(REVIEW_DRAFT_DEFAULT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [noteStatus, setNoteStatus] = useState('未保存')
  const [reviewStatusFilter, setReviewStatusFilter] = useState<ReviewStatus | 'resolved' | 'all'>('all')
  const patchDraft = (p: Partial<ReviewDraft>) => setDraft(d => ({ ...d, ...p }))
  const editingSrcRef = useRef<Review | null>(null)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [clearSignal, setClearSignal] = useState(0)
  const [symbols, setSymbols] = useState<SymbolInfo[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [anchorTarget, setAnchorTarget] = useState<ReviewAnchorTarget | null>(null)
  const [liveCross, setLiveCross] = useState<{ id: string; ts: number; close: number } | null>(null)
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const [lineWidth, setLineWidth] = useState(2)
  const [lineType, setLineType] = useState<'实线' | '虚线' | '点线'>('实线')
  const [fullId, setFullId] = useState<string | null>(null)
  const [showVol, setShowVol] = useState(true)
  const [showMacd, setShowMacd] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [favTab, setFavTab] = useState<'all' | 'major' | 'fav'>('all')
  const [favs, setFavs] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]') as string[] } catch { return [] }
  })
  const [showAllReviews, setShowAllReviews] = useState(false)
  const [showTopSettings, setShowTopSettings] = useState(false)
  const [showWatchMenu, setShowWatchMenu] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exportBusy, setExportBusy] = useState(false)

  const visibleCharts = useMemo(() => {
    if (layout === 1 && fullId) {
      const f = charts.find(c => c.id === fullId)
      if (f) return [f]
    }
    return charts.slice(0, layout)
  }, [charts, layout, fullId])
  const dateStartMs = dateStart ? Date.parse(dateStart) : undefined
  const dateEndMs = dateEnd ? Date.parse(dateEnd) + 86_399_000 : undefined
  const filteredSymbols = symbols
    .filter(s => favTab === 'major' ? MAJOR_SET.has(s.symbol) : favTab === 'fav' ? favs.includes(s.symbol) : true)
    .filter(s => `${s.symbol} ${s.name}`.toLowerCase().includes(query.toLowerCase()))

  function toggleFavorite(symbol: string) {
    setFavs(prev => {
      const next = prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]
      localStorage.setItem(FAV_KEY, JSON.stringify(next))
      return next
    })
  }
  function updateChart(id: string, patch: Partial<ChartConfig>) {
    setCharts(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }
  function addChart() {
    const id = `chart-${Date.now()}`
    setCharts(prev => [...prev, { id, symbol: selectedSymbol, timeframe: '15m' }])
    setLayout(4)
    setFullId(null)
    setActiveId(id)
  }
  function removeChart(id: string) {
    const remaining = charts.filter(c => c.id !== id)
    const next = remaining.length ? remaining : [{ id: 'chart-1', symbol: selectedSymbol, timeframe: '15m' }]
    setCharts(next)
    if (activeId === id) setActiveId(next[0].id)
    if (fullId === id) setFullId(null)
  }

  // poll health + symbols + reviews
  useEffect(() => {
    let alive = true
    async function tick() {
      try {
        const h = await api.health()
        if (!alive) return
        setHealth(h)
        setSymbols(await api.symbols())
        setReviews(await api.reviews(200))
      } catch { /* backend offline */ }
    }
    tick()
    const t = setInterval(tick, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [refreshSignal])

  // 实时锚点条：仅活动面板的十字 K 线驱动；切换活动面板时重置为该面板已有记录
  useEffect(() => {
    const off = onCrossMove(e => {
      if (e.id !== activeIdRef.current) return
      setLiveCross({ id: e.id, ts: e.ts, close: e.close })
    })
    // 切到某面板即显示它的最后十字 K 线
    setLiveCross({ id: activeId, ts: getLastCross(activeId), close: getLastCrossClose(activeId) })
    return off
  }, [activeId])

  const visibleReviews = useMemo(() => {
    if (reviewStatusFilter === 'all') return reviews
    if (reviewStatusFilter === 'resolved') return reviews.filter(r => r.status && r.status !== 'open')
    return reviews.filter(r => r.status === reviewStatusFilter)
  }, [reviews, reviewStatusFilter])

  // 结果层统计：按 setup / 方向 / 标签 统计已验证 vs 已证伪
  const reviewStats = useMemo(() => {
    const resolved = reviews.filter(r => r.status && r.status !== 'open')
    const by = (key: (r: Review) => string | undefined) => {
      const m = new Map<string, { w: number; l: number }>()
      for (const r of resolved) {
        const k = key(r)
        if (!k) continue
        const slot = m.get(k) ?? { w: 0, l: 0 }
        if (r.status === 'verified') slot.w += 1
        else if (r.status === 'falsified') slot.l += 1
        m.set(k, slot)
      }
      return [...m.entries()]
        .map(([label, v]) => ({ label, w: v.w, l: v.l, rate: v.w + v.l ? Math.round((v.w / (v.w + v.l)) * 100) : 0 }))
        .filter(x => x.w + x.l > 0)
        .sort((a, b) => (b.w + b.l) - (a.w + a.l))
        .slice(0, 6)
    }
    const totalResolved = resolved.length
    const verified = resolved.filter(r => r.status === 'verified').length
    return {
      total: reviews.length,
      open: reviews.filter(r => !r.status || r.status === 'open').length,
      totalResolved,
      winRate: totalResolved ? Math.round((verified / totalResolved) * 100) : 0,
      bySetup: by(r => r.setup),
      byDirection: by(r => r.direction),
      byTag: by(r => r.tags?.[0]),
    }
  }, [reviews])

  // 待验证队列：open 且时间窗口已过
  const isWindowPassed = (r: Review) => !!(r.dateEnd && Date.now() / 1000 > r.dateEnd)
  const openQueue = useMemo(() => reviews.filter(r => (!r.status || r.status === 'open') && isWindowPassed(r)), [reviews])

  async function attachActiveDrawings() {
    const active = charts.find(c => c.id === activeId)
    if (!active) return
    try {
      const ds = await api.drawings(active.symbol, active.timeframe)
      const ids = ds.map(d => d.id).filter(Boolean)
      setDraft(d => ({ ...d, refs: [...new Set([...d.refs, ...ids])] }))
      setNoteStatus(`附加 ${ids.length} 条绘图`)
    } catch { setNoteStatus('附加绘图失败') }
  }


  // 加载数据：为可见图表涉及的 symbol/tf 补拉最近数据，再刷新
  const sleep = (ms: number) => {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, ms)
    return promise
  }
  async function loadMore() {
    setRefreshSignal(0)
    const seen = new Set<string>()
    for (const c of visibleCharts) {
      const key = `${c.symbol}/${c.timeframe}`
      if (seen.has(key)) continue
      seen.add(key)
      try { await api.fetchMore(c.symbol, c.timeframe, 1000, dateStartMs, dateEndMs) } catch { /* ignore */ }
    }
    // wait for fetch tasks to settle
    for (let i = 0; i < 20; i++) {
      await sleep(500)
      try {
        const h = await api.health()
        if (!h.fetching) break
      } catch { break }
    }
    setRefreshSignal(s => s + 1)
  }

  function buildReviewPayload(): Partial<Review> {
    const src = editingSrcRef.current
    const activeTf = charts.find(c => c.id === activeId)?.timeframe ?? '15m'
    const p: Partial<Review> = {
      title: draft.title || '复盘笔记',
      content: draft.content,
      symbol: src ? src.symbol : selectedSymbol,
      timeframe: src ? src.timeframe : activeTf,
      tags: parseList(draft.tags),
      setup: draft.setup || undefined,
      direction: draft.direction || undefined,
      entry: parseNum(draft.entry),
      targets: parseList(draft.targets).map(Number).filter(n => !Number.isNaN(n)),
      invalidation: parseNum(draft.invalidation),
      rationale: draft.rationale || undefined,
      horizon: draft.horizon || undefined,
      status: draft.status,
      outcomeNote: draft.outcomeNote || undefined,
      refs: draft.refs,
      dateStart: src?.dateStart ?? (dateStart ? new Date(dateStart + 'T00:00:00').getTime() / 1000 : null),
      dateEnd: src?.dateEnd ?? (dateEnd ? new Date(dateEnd + 'T00:00:00').getTime() / 1000 : null),
      anchor: draft.anchor,
    }
    p.content = [draft.content.trim(), draft.rationale ? `【逻辑】${draft.rationale.trim()}` : '', draft.setup ? `【策略】${draft.setup}` : '', p.refs?.length ? `【附图】${p.refs.join('、')}` : ''].filter(Boolean).join('\n')
    return p
  }

  async function saveNote() {
    try {
      if (editingId) await api.updateReview(editingId, buildReviewPayload())
      else await api.saveReview(buildReviewPayload())
      setNoteStatus(editingId ? '已更新' : '已保存')
      resetDraft()
      setRefreshSignal(s => s + 1)
    } catch { setNoteStatus('保存失败') }
  }

  function resetDraft() {
    setDraft(REVIEW_DRAFT_DEFAULT)
    setEditingId(null)
    editingSrcRef.current = null
    setAnchorTarget(null)
  }

  /** 把复盘记录载入编辑器，并联动图表跳到其锚定 K 线 */
  function loadReviewIntoEditor(r: Review) {
    setEditingId(r.id)
    editingSrcRef.current = r
    setDraft({
      title: r.title,
      content: r.content,
      tags: (r.tags || []).join(','),
      setup: r.setup ?? '',
      direction: r.direction ?? '',
      entry: r.entry != null ? String(r.entry) : '',
      targets: (r.targets || []).join(','),
      invalidation: r.invalidation != null ? String(r.invalidation) : '',
      rationale: r.rationale ?? '',
      horizon: r.horizon ?? '',
      status: r.status ?? 'open',
      outcomeNote: r.outcomeNote ?? '',
      refs: r.refs ?? [],
      anchor: r.anchor ?? null,
    })
    // 联动图表：找到与记录 品种+周期 匹配的面板，否则把活跃面板改成记录的 品种+周期
    const a = r.anchor
    if (a) {
      const match = charts.find(c => c.symbol === r.symbol && c.timeframe === r.timeframe)
      if (match) setActiveId(match.id)
      else updateChart(activeId, { symbol: r.symbol, timeframe: r.timeframe })
      setAnchorTarget({ symbol: r.symbol, timeframe: r.timeframe, ts: a.timestamp, price: a.price, side: a.side, title: r.title, status: r.status ?? 'open', nonce: Date.now() })
    } else {
      setAnchorTarget(null)
    }
    setShowAllReviews(false)
    setNoteStatus(`编辑 ${r.id.slice(0,8)}…`)
  }

  async function resolveReview(r: Review, status: ReviewStatus, outcomeNote = '') {
    try {
      await api.updateReview(r.id, { status, outcomeNote: outcomeNote || undefined })
      setNoteStatus(`已标记 ${REVIEW_STATUS_LABEL[status]}`)
      setRefreshSignal(s => s + 1)
    } catch { setNoteStatus('标记失败') }
  }

  /** 把当前活跃图十字 K 线（带收盘价）钉成复盘锚点 */
  function pinAnchor() {
    const active = charts.find(c => c.id === activeId)
    if (!active) return
    let ts = liveCross && liveCross.id === activeId ? liveCross.ts : getLastCross(activeId)
    let price = liveCross && liveCross.id === activeId ? liveCross.close : 0
    // 无十字记录时兜底最后一根 K 线
    if (!ts) {
      const list = getPeerChart(activeId)?.getDataList()
      const last = list && list.length ? list[list.length - 1] : null
      ts = last?.timestamp ?? 0
      price = last?.close ?? 0
    }
    if (!ts) { setNoteStatus('图表无数据，无法钉锚点'); return }
    patchDraft({ anchor: price > 0 ? { timestamp: ts, price } : { timestamp: ts } })
    // 编辑态且活跃图与记录 品种+周期 一致时，顺带联动画旗标
    const src = editingSrcRef.current
    if (src && active.symbol === src.symbol && active.timeframe === src.timeframe) {
      setAnchorTarget({ symbol: active.symbol, timeframe: active.timeframe, ts, price: price > 0 ? price : undefined, side: price > 0 ? undefined : 'close', title: src.title, status: src.status ?? 'open', nonce: Date.now() })
    }
    setNoteStatus('已钉当前 K 线为锚点')
  }

  function clearAnchor() {
    patchDraft({ anchor: null })
    setAnchorTarget(null)
    setNoteStatus('已清除锚点')
  }

  /** 直接点某根 K 线体 -> 一次点击钉为该复盘锚点（无 hover 漂移）；并切到该面板作为上下文 */
  function pinKLineFromChart(panelId: string, ts: number, price: number) {
    const panel = charts.find(c => c.id === panelId)
    if (!panel || !ts) return
    setActiveId(panelId)
    patchDraft({ anchor: price > 0 ? { timestamp: ts, price } : { timestamp: ts } })
    const src = editingSrcRef.current
    if (src && panel.symbol === src.symbol && panel.timeframe === src.timeframe) {
      setAnchorTarget({ symbol: panel.symbol, timeframe: panel.timeframe, ts, price: price > 0 ? price : undefined, side: price > 0 ? undefined : 'close', title: src.title, status: src.status ?? 'open', nonce: Date.now() })
    }
    setNoteStatus('已点该 K 线钉为锚点')
  }

  async function saveWorkspace() {
    try {
      await api.putWorkspace(WORKSPACE_ID, { charts, layout, sync, dark, dateStart, dateEnd })
      setNoteStatus(`工作区已存 ${WORKSPACE_ID}`)
    } catch { setNoteStatus('工作区保存失败') }
  }

  async function restoreWorkspace() {
    try {
      const ws = await api.getWorkspace(WORKSPACE_ID)
      if (ws.charts?.length) setCharts(ws.charts as ChartConfig[])
      if (typeof ws.layout === 'number') setLayout(ws.layout as LayoutMode)
      if (typeof ws.sync === 'boolean') setSync(ws.sync)
      if (typeof ws.dark === 'boolean') setDark(ws.dark)
      if (typeof ws.dateStart === 'string') setDateStart(ws.dateStart)
      if (typeof ws.dateEnd === 'string') setDateEnd(ws.dateEnd)
      setNoteStatus(`已恢复工作区 ${WORKSPACE_ID}`)
    } catch { setNoteStatus('无已存工作区') }
  }

  function deleteReview(id: string) {
    api.deleteReview(id)
      .then(() => setReviews(prev => prev.filter(r => r.id !== id)))
      .catch(() => setNoteStatus('删除失败'))
  }

  // ---- 批量操作 ----
  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectAllVisible() {
    setSelected(new Set(visibleReviews.map(r => r.id)))
  }
  function clearSelection() { setSelected(new Set()) }

  function exportSelection(format: ExportFormat, opts?: { status?: ReviewStatus | 'resolved'; ctx?: number }) {
    const ids = [...selected]
    if (ids.length === 0) { setNoteStatus('未选择记录，无法导出'); return }
    setExportBusy(true)
    api.exportReviews({ status: opts?.status, ctx: opts?.ctx })
      .then(rows => {
        const picked = rows.filter(r => ids.includes(r.id))
        const name = downloadExport(picked, format)
        setNoteStatus(`已导出 ${picked.length} 条 → ${name}`)
      })
      .catch(() => setNoteStatus('导出失败'))
      .finally(() => setExportBusy(false))
  }

  async function bulkSetStatus(status: ReviewStatus) {
    const ids = [...selected]
    if (ids.length === 0) return
    try {
      const res = await api.bulkReviews(ids, 'status', status)
      setNoteStatus(`已批量标记 ${res.updated ?? ids.length} 条为「${REVIEW_STATUS_LABEL[status]}」`)
      clearSelection()
      setRefreshSignal(s => s + 1)
    } catch { setNoteStatus('批量标记失败') }
  }

  async function bulkDelete() {
    const ids = [...selected]
    if (ids.length === 0) return
    if (!confirm(`删除选中的 ${ids.length} 条复盘记录？此操作不可撤销。`)) return
    try {
      const res = await api.bulkReviews(ids, 'delete')
      setNoteStatus(`已删除 ${res.deleted ?? ids.length} 条记录`)
      clearSelection()
      setRefreshSignal(s => s + 1)
    } catch { setNoteStatus('批量删除失败') }
  }

  /** 导出当前筛选（状态）下的全部复盘，无需勾选 */
  function exportCurrentFilter(format: ExportFormat) {
    setExportBusy(true)
    api.exportReviews({ status: reviewStatusFilter === 'all' ? undefined : reviewStatusFilter, ctx: 48 })
      .then(rows => {
        const name = downloadExport(rows, format)
        setNoteStatus(`已导出当前筛选 ${rows.length} 条 → ${name}`)
      })
      .catch(() => setNoteStatus('导出失败'))
      .finally(() => setExportBusy(false))
  }

  function exportScreenshot() {
    const chart = getPeerChart(activeId)
    if (!chart) { setNoteStatus('图表未就绪'); return }
    const url = chart.getConvertPictureUrl(true, 'image/png')
    if (!url) { setNoteStatus('截图失败'); return }
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeId}-${Date.now()}.png`
    a.click()
    setNoteStatus('截图已导出')
  }

  const dashed = lineType !== '实线'

  return (
    <main className={dark ? 'app-shell' : 'app-shell light-theme'}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Activity size={19} strokeWidth={2.7} /></div>
          <div><strong>K线复盘工作台</strong><span>CHART REVIEW STUDIO</span></div>
        </div>
        <div className="topbar-center"><span className="status-pill"><span className="status-dot" />本地工作区</span><span className="topbar-subtitle">专业行情分析与复盘工具</span></div>
        <div className="topbar-actions">
          <span className={`database-status ${health ? '' : 'offline'}`}>
            <Database size={14} />
            {health ? `SQLite ${health.klineRows} 行${health.fetching ? ' · 拉取中…' : ''}` : '后端离线'}
          </span>
          <div style={{ position: 'relative' }}>
            <button className="icon-button" title="设置" onClick={() => setShowTopSettings(v => !v)}><Settings2 size={17} /></button>
            {showTopSettings && <div className="chart-menu">
              <div style={{ padding: '6px 8px', fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>
                <div>数据源：Binance Futures · SQLite</div>
                <div>状态：{health ? `在线 · ${health.klineRows} 行 K 线` : '后端离线'}</div>
                <div>最后更新：{health ? new Date(health.lastBar * 1000).toLocaleString() : '—'}</div>
              </div>
              <button onClick={() => { loadMore(); setShowTopSettings(false) }}>重新加载数据</button>
              <button onClick={() => { setClearSignal(s => s + 1); setShowTopSettings(false) }}>清除绘图</button>
            </div>}
          </div>
          <button className="icon-button" title="切换主题" onClick={() => setDark(v => !v)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
        </div>
      </header>

      <div className="app-body">
        <aside className="watchlist sidebar">
          <div className="section-title"><span>自选行情</span>
            <div style={{ position: 'relative' }}>
              <button className="icon-button" onClick={() => setShowWatchMenu(v => !v)}><SlidersHorizontal size={15} /></button>
              {showWatchMenu && <div className="chart-menu" style={{ top: 40, right: 0 }}>
                <button onClick={() => { setQuery(''); setShowWatchMenu(false) }}>清空搜索</button>
                <button onClick={() => { setFavTab('all'); setShowWatchMenu(false) }}>切到「全部」</button>
                <button onClick={() => { setFavs([]); localStorage.setItem(FAV_KEY, '[]'); setShowWatchMenu(false) }}>清空自选</button>
              </div>}
            </div>
          </div>
          <label className="search-box"><Search size={15} /><input placeholder="搜索品种..." value={query} onChange={e => setQuery(e.target.value)} /><kbd>/</kbd></label>
          <div className="watchlist-tabs">{([['all', '全部'], ['major', '主流币'], ['fav', '自选']] as const).map(([k, label]) => <button key={k} className={favTab === k ? 'selected' : ''} onClick={() => setFavTab(k)}>{label}</button>)}</div>
          <div className="symbol-list">
            {filteredSymbols.map(s => <div key={s.symbol} className={`symbol-row ${selectedSymbol === s.symbol ? 'selected' : ''}`} onClick={() => { setSelectedSymbol(s.symbol); updateChart(activeId, { symbol: s.symbol }) }}>
              <span className="coin-icon" style={{ '--coin-color': s.color } as React.CSSProperties}>{s.symbol.slice(0, 1)}</span>
              <span className="coin-details"><strong>{s.symbol}</strong><small>{s.name}</small></span>
              <span className="coin-quote"><strong>{s.price}</strong><small>{s.change}</small></span>
              <button className={`symbol-fav ${favs.includes(s.symbol) ? 'on' : ''}`} title={favs.includes(s.symbol) ? '取消自选' : '加入自选'} onClick={e => { e.stopPropagation(); toggleFavorite(s.symbol) }}><Star size={12} fill={favs.includes(s.symbol) ? 'currentColor' : 'none'} /></button>
            </div>)}
            {symbols.length === 0 && <div className="symbol-empty">本地暂无数据，先点「加载数据」</div>}
          </div>
          <div className="sidebar-footer"><span className="status-dot" />行情源：Binance Futures · SQLite 本地</div>
        </aside>

        <section className="workspace">
          <div className="controlbar">
            <div className="select-wrap"><select value={selectedSymbol} onChange={e => { setSelectedSymbol(e.target.value); updateChart(activeId, { symbol: e.target.value }) }}>{symbols.map(s => <option key={s.symbol}>{s.symbol}</option>)}</select><ChevronDown size={14} /></div>
            <div className="date-range"><CalendarDays size={14} /><input aria-label="开始日期" type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} onClick={e => { const el = e.currentTarget; try { if (typeof el.showPicker === 'function') el.showPicker() } catch { /* 非用户手势或 picker 打开中,忽略 */ } }} /><span>→</span><input aria-label="结束日期" type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} onClick={e => { const el = e.currentTarget; try { if (typeof el.showPicker === 'function') el.showPicker() } catch { /* ignore */ } }} /></div>
            <button className="primary-button" onClick={loadMore}><Activity size={14} />加载数据</button>
            <div className="controlbar-spacer" />
            <div className="layout-switcher" aria-label="图表布局">
              {([{ value: 1, icon: <AlignJustify size={16} />, label: '单图' }, { value: 2, icon: <span className="layout-icon two" />, label: '双图' }, { value: 4, icon: <LayoutGrid size={16} />, label: '四宫格' }, { value: 6, icon: <span className="layout-icon six" />, label: '六宫格' }] as {value: LayoutMode; icon: React.ReactNode; label: string}[]).map(item =>
                <button key={item.value} title={item.label} className={layout === item.value ? 'active' : ''} onClick={() => { setLayout(item.value); setFullId(item.value === 1 ? activeId : null) }}>{item.icon}</button>)}
            </div>
            <button className={`sync-button ${sync ? 'on' : ''}`} onClick={() => setSync(v => !v)}><ArrowDownUp size={14} />{sync ? '同步' : '独立'}</button>
          </div>

          <div className="workspace-toolbar">
            <div className="toolbar-left"><span className="toolbar-caption">绘图工具</span>
              {(Object.keys(toolOverlay) as ToolName[]).map(name => {
                const icons: Record<ToolName, React.ReactNode> = {
                  '光标': <Activity size={15} />, '趋势线': <TrendingUp size={15} />, '水平线': <AlignJustify size={15} />,
                  '垂直线': <ArrowDownUp size={15} />, '射线': <TrendingUp size={15} />, '线段': <AlignJustify size={15} />,
                  '矩形': <span className="rectangle-icon" />, '圆形': <span className="circle-icon" />,
                  '箭头': <ArrowDownUp size={15} />, '文字': <span className="text-icon">T</span>,
                  '斐波那契': <Waves size={15} />, '测量工具': <BarChart3 size={15} />,
                }
                return <button key={name} className={`tool-button ${tool === name ? 'active' : ''}`} onClick={() => setTool(name)} title={name}>{icons[name]}<span>{name}</span></button>
              })}
            </div>
            <div className="toolbar-right"><button className={`subtle-button ${showMacd ? 'active' : ''}`} onClick={() => setShowMacd(v => !v)}><Waves size={15} />指标</button><button className={`subtle-button ${showVol ? 'active' : ''}`} onClick={() => setShowVol(v => !v)}><BarChart3 size={15} />成交量</button><button className="subtle-button" onClick={() => setClearSignal(s => s + 1)}><Download size={15} />清除绘图</button></div>
          </div>

          <div className={`chart-grid layout-${layout}`}>
            {visibleCharts.map((config, i) => <ChartPanel
              key={config.id}
              config={config}
              active={activeId === config.id}
              syncCrosshair={sync}
              onActivate={() => setActiveId(config.id)}
              onRemove={layout > 1 ? () => removeChart(config.id) : undefined}
              onConfigChange={patch => updateChart(config.id, patch)}
              onFullscreen={() => { setActiveId(config.id); setLayout(1); setFullId(config.id) }}
              tool={tool}
              drawStyle={drawStyle}
              clearSignal={clearSignal}
              refreshSignal={refreshSignal}
              symbols={symbols}
              showVol={showVol}
              showMacd={showMacd}
              showLabels={showLabels}
              dateStartMs={dateStartMs}
              dateEndMs={dateEndMs}
              anchor={anchorTarget}
              onKLineClick={(ts, price) => pinKLineFromChart(config.id, ts, price)}
            />)}
            {layout > visibleCharts.length && <button className="add-chart-card" onClick={addChart}><Plus size={22}/><span>添加图表</span></button>}
          </div>

          <section className="review-dock">
            <div className="review-panel notes-panel">
              <div className="panel-heading">
                <div><strong>{editingId ? '编辑复盘' : '复盘笔记'}</strong><span className="panel-count">{noteStatus}</span></div>
                <button className="text-action" onClick={() => { resetDraft(); setNoteStatus('未保存') }}><Plus size={14}/>{editingId ? '改为新建' : '新建笔记'}</button>
              </div>
              <input className="note-title" placeholder="笔记标题" value={draft.title} onChange={e => patchDraft({ title: e.target.value })} />
              {liveCross && liveCross.ts > 0 && (() => {
                const ac = charts.find(c => c.id === liveCross.id)
                const d = new Date(liveCross.ts)
                const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
                return (
                  <div className="anchor-live">
                    <span className="anchor-live-icon"><Pin size={12} /></span>
                    <span className="anchor-live-label" title="活动图十字光标所在 K 线，点「钉」写为复盘锚点">十字 {ac?.symbol} {ac?.timeframe} @ {hh}{liveCross.close > 0 ? ` · ${liveCross.close}` : ''}</span>
                    <button className="anchor-live-btn" title="钉为复盘锚点" onClick={pinAnchor}>钉</button>
                    {draft.anchor && <button className="anchor-live-btn clear" title="清除已钉锚点" onClick={clearAnchor}>清除</button>}
                  </div>
                )
              })()}
              <div className="review-grid">
                <label className="rg-field"><span>策略 Setup</span><input value={draft.setup} onChange={e => patchDraft({ setup: e.target.value })} placeholder="如：支撑回踩/突破" /></label>
                <label className="rg-field"><span>方向</span><select value={draft.direction} onChange={e => patchDraft({ direction: e.target.value })}><option value="">未定</option>{DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}</select></label>
                <label className="rg-field"><span>入场价</span><input value={draft.entry} onChange={e => patchDraft({ entry: e.target.value })} placeholder="如 64000" /></label>
                <label className="rg-field"><span>目标价</span><input value={draft.targets} onChange={e => patchDraft({ targets: e.target.value })} placeholder="逗号分隔" /></label>
                <label className="rg-field"><span>失效价</span><input value={draft.invalidation} onChange={e => patchDraft({ invalidation: e.target.value })} placeholder="止损" /></label>
                <label className="rg-field"><span>时间框架</span><input value={draft.horizon} onChange={e => patchDraft({ horizon: e.target.value })} placeholder="如 3天/本周" /></label>
              </div>
              <label className="rg-field full"><span>判断依据</span><input value={draft.rationale} onChange={e => patchDraft({ rationale: e.target.value })} placeholder="量价/资金/结构" /></label>
              <label className="rg-field full"><span>结果状态</span>
                <select value={draft.status} onChange={e => patchDraft({ status: e.target.value as ReviewStatus })}>
                  {REVIEW_STATUS_ORDER.map(s => <option key={s} value={s}>{REVIEW_STATUS_LABEL[s]}</option>)}
                </select>
              </label>
              {draft.status !== 'open' && <label className="rg-field full"><span>结果备注</span><input value={draft.outcomeNote} onChange={e => patchDraft({ outcomeNote: e.target.value })} placeholder="如：3天后突破65000达标" /></label>}
              <textarea value={draft.content} onChange={e => patchDraft({ content: e.target.value })} placeholder="复盘正文" />
              <div className="note-footer">
                <div className="tag-list"><input className="tag-input" placeholder="标签，逗号分隔" value={draft.tags} onChange={e => patchDraft({ tags: e.target.value })} /></div>
                {draft.anchor
                  ? <button className="save-button anchor-on" title="清除锚点" onClick={clearAnchor}><Pin size={13} />锚定中 · 清除</button>
                  : <button className="save-button" title="直接在任意 K 线体上点一下即钉为该复盘锚点（或钉当前活跃图十字 K 线）" onClick={pinAnchor}><Pin size={13} />点 K 线钉锚点</button>}
                <button className="save-button" title="附加当前品种绘图" onClick={attachActiveDrawings}>附图 {draft.refs.length}</button>
                <button className="save-button" onClick={saveNote}><Check size={13}/>{editingId ? '保存修改' : '保存笔记'}</button>
              </div>
            </div>
            <div className="review-panel history-panel">
              <div className="review-stats">
                <div className="rs-item"><span>{reviewStats.winRate}%</span>胜率</div>
                <div className="rs-item"><span>{reviewStats.open}</span>待验证</div>
                <div className="rs-item"><span>{reviewStats.total}</span>全部</div>
                {reviewStats.bySetup.slice(0, 2).map(s => <div key={s.label} className="rs-item"><span>{s.rate}%</span>{s.label}</div>)}
              </div>
              <div className="review-chips">
                <button className={`chip ${reviewStatusFilter === 'all' ? 'on' : ''}`} onClick={() => setReviewStatusFilter('all')}>全部</button>
                {REVIEW_STATUS_ORDER.map(s => <button key={s} className={`chip ${reviewStatusFilter === s ? 'on' : ''}`} onClick={() => setReviewStatusFilter(s)}>{REVIEW_STATUS_LABEL[s]}</button>)}
                <button className={`chip ${reviewStatusFilter === 'resolved' ? 'on' : ''}`} onClick={() => setReviewStatusFilter('resolved')}>已结果</button>
              </div>
              {openQueue.length > 0 && reviewStatusFilter === 'all' && (
                <div className="review-queue">
                  <span className="rq-title">⏳ 窗口已过待验证</span>
                  {openQueue.slice(0, 3).map(r => (
                    <button key={r.id} className="rq-item" onClick={() => loadReviewIntoEditor(r)} title={`${r.title}\n标记已验证/证伪`}>
                      <span className="rq-dot" />{r.symbol} {r.timeframe} · {r.setup || r.title}
                    </button>
                  ))}
                </div>
              )}
              <div className="panel-heading"><div><strong>最近复盘</strong><span className="panel-count">{visibleReviews.length} 条</span></div><button className="text-action" onClick={() => setShowAllReviews(v => !v)}>{showAllReviews ? '收起' : '查看全部'}</button></div>
              {selected.size > 0 && (
                <div className="bulk-bar">
                  <span className="bulk-count">已选 {selected.size} 条</span>
                  <div className="bulk-actions">
                    <select className="bulk-select" value="" onChange={e => { if (e.target.value) bulkSetStatus(e.target.value as ReviewStatus); }}>
                      <option value="" disabled>批量标记…</option>
                      {REVIEW_STATUS_ORDER.map(s => <option key={s} value={s}>{REVIEW_STATUS_LABEL[s]}</option>)}
                    </select>
                    <button className="bulk-btn" onClick={() => exportSelection('jsonl')} disabled={exportBusy} title="JSONL 训练样本（含 K 线窗口）">导出 JSONL</button>
                    <button className="bulk-btn" onClick={() => exportSelection('csv')} disabled={exportBusy}>导出 CSV</button>
                    <button className="bulk-btn" onClick={() => exportSelection('json')} disabled={exportBusy}>JSON</button>
                    <button className="bulk-btn danger" onClick={bulkDelete}><X size={12}/>删除</button>
                    <button className="bulk-btn" onClick={clearSelection}>取消</button>
                  </div>
                </div>
              )}
              <div className="history-row history-header">
                <input type="checkbox" className="hist-check" checked={visibleReviews.length > 0 && selected.size === visibleReviews.length} onChange={e => e.target.checked ? selectAllVisible() : clearSelection()} title="全选/取消" />
                <span>时间</span><span>品种</span><span>周期</span><span>记录</span><span />
              </div>
              {(showAllReviews ? visibleReviews : visibleReviews.slice(0, 8)).map(r => {
                const d = new Date(r.createdAt * 1000)
                const ts = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                const isOpen = !r.status || r.status === 'open'
                const passed = isWindowPassed(r)
                const st = r.status ? REVIEW_STATUS_LABEL[r.status] : '待验证'
                const isSel = selected.has(r.id)
                return (
                  <div className={`history-row ${isOpen && passed ? 'is-passed' : ''} ${editingId === r.id ? 'is-editing' : ''} ${isSel ? 'is-selected' : ''}`} key={r.id} onClick={() => loadReviewIntoEditor(r)} title="点击编辑">
                    <input type="checkbox" className="hist-check" checked={isSel} onClick={e => e.stopPropagation()} onChange={() => toggleSelect(r.id)} title="勾选" />
                    <span>{ts}</span>
                    <span>{r.symbol}</span>
                    <span>{r.timeframe}</span>
                    <span><em className={`status-chip st-${r.status ?? 'open'}`}>{st}</em> {r.title || r.content}</span>
                    <span className="history-actions">
                      {isOpen && <button className="quick-resolve" title="标记已验证" onClick={e => { e.stopPropagation(); resolveReview(r, 'verified') }}>✓</button>}
                      {isOpen && <button className="quick-resolve" title="标记已证伪" onClick={e => { e.stopPropagation(); resolveReview(r, 'falsified') }}>✗</button>}
                      <button className="history-del" title="删除记录" onClick={e => { e.stopPropagation(); deleteReview(r.id) }}><X size={12} /></button>
                    </span>
                  </div>
                )
              })}
              {visibleReviews.length === 0 && <div className="history-row"><span className="history-empty">暂无记录</span></div>}
            </div>
          </section>
          <footer className="workspace-footer"><span><span className="status-dot" />前端已连接 API</span><span>Binance 期货行情 · 本地 SQLite</span><span>K线复盘工作台 <b>v0.2.0</b></span></footer>
        </section>

        <aside className="drawing-sidebar sidebar">
          <div className="section-title"><span>图表设置</span><button className="icon-button"><Settings2 size={15}/></button></div>
          <div className="drawing-card">
            <div className="drawing-heading">绘图工具 <span className="tiny-kbd">D</span></div>
            {(Object.keys(toolOverlay) as ToolName[]).filter(n => n !== '光标').map((name, i) => <button key={name} className={`drawing-row ${tool === name ? 'active' : ''}`} onClick={() => setTool(name)}><span className="drawing-symbol">{['╱','━','↕','↗','─','□','○','➤','T','⌁','◱'][i]}</span>{name}</button>)}
            <button className="clear-drawings" onClick={() => setClearSignal(s => s + 1)}>× 清除当前品种绘图</button>
          </div>
          <div className="drawing-card style-card">
            <div className="drawing-heading">样式设置</div>
            <label className="field-label">线条颜色</label>
            <div className="color-swatches">{['#3b82f6','#14b8a6','#fbbf24','#f05268','#8b5cf6','#e2e8f0'].map(c => <button key={c} style={{ background: c, outline: drawStyle.color === c ? '2px solid #fff' : 'none', outlineOffset: 1 }} title={c} onClick={() => setDrawStyle(s => ({ ...s, color: c }))} />)}</div>
            <label className="field-label">线宽 <span>{lineWidth}px</span></label><input type="range" min="1" max="5" value={lineWidth} onChange={e => { const w = Number(e.target.value); setLineWidth(w); setDrawStyle(s => ({ ...s, width: w })) }} />
            <label className="field-label">线型</label><select className="dark-select" value={lineType} onChange={e => { const v = e.target.value as '实线' | '虚线' | '点线'; setLineType(v); setDrawStyle(s => ({ ...s, dashed: v !== '实线' })) }}><option>实线</option><option>虚线</option><option>点线</option></select>
            <label className="toggle-row"><span>显示标签</span><input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} /></label>
          </div>
          <div className="drawing-card quick-card"><div className="drawing-heading">工作区操作</div><button onClick={addChart}><Plus size={14}/>添加图表</button><button onClick={saveWorkspace}><Star size={14}/>保存工作区</button><button onClick={restoreWorkspace}><Download size={14}/>恢复工作区</button><button onClick={exportScreenshot}><Download size={14}/>导出截图</button></div>
          <div className="drawing-card quick-card"><div className="drawing-heading">导出复盘 <span className="tiny-kbd">当前筛选</span></div>
            <button onClick={() => exportCurrentFilter('jsonl')} disabled={exportBusy} title="JSONL 训练样本（含 K 线窗口）">导出 JSONL</button>
            <button onClick={() => exportCurrentFilter('csv')} disabled={exportBusy} title="CSV 展平列">导出 CSV</button>
            <button onClick={() => exportCurrentFilter('json')} disabled={exportBusy} title="JSON 数组">导出 JSON</button>
          </div>
        </aside>
      </div>
    </main>
  )
}
