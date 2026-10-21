import { useEffect, useRef, useState } from 'react'
import { init, dispose, LineType, TooltipShowRule, type Chart, type Point } from 'klinecharts'
import { Maximize2, MoreHorizontal, X } from 'lucide-react'
import type { ChartConfig, DrawingRecord, SymbolInfo, ReviewAnchorTarget } from '../types'
import { api } from '../api'
import { toolOverlay, styleFor, registerCustomOverlays, createAnchorFlag, type DrawStyle, type ToolName } from '../drawings'
 import { registerPeer, unregisterPeer, livePeers, isGuarded, applyTimeWindow, applyCrossTimestamp, getVisibleTimestamps, isApplyingVisible, recordLastCross, getLastCross, getLastCrossClose, type Peer } from '../sync'


type Props = {
  config: ChartConfig
  active: boolean
  syncCrosshair: boolean
  onActivate: () => void
  onRemove?: () => void
  onConfigChange: (patch: Partial<ChartConfig>) => void
  onFullscreen: () => void
  tool: ToolName
  drawStyle: DrawStyle
  clearSignal: number
  refreshSignal: number
  symbols: SymbolInfo[]
  showVol: boolean
  showMacd: boolean
  showLabels: boolean
  dateStartMs?: number
  dateEndMs?: number
  anchor?: ReviewAnchorTarget | null
  onKLineClick?: (ts: number, close: number) => void
}

const periods = ['1m', '5m', '15m', '1h', '4h', '1D', '1W']

export default function ChartPanel({
  config, active, syncCrosshair, onActivate, onRemove, onConfigChange, onFullscreen,
  tool, drawStyle, clearSignal, refreshSignal,
  symbols, showVol, showMacd, showLabels, dateStartMs, dateEndMs, anchor, onKLineClick,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<Chart | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [loading, setLoading] = useState(false)
  const [noData, setNoData] = useState(false)

  // refs to read latest values inside stable callbacks
  const toolRef = useRef(tool); toolRef.current = tool
  const styleRef = useRef(drawStyle); styleRef.current = drawStyle
  const symRef = useRef(config.symbol); symRef.current = config.symbol
  const tfRef = useRef(config.timeframe); tfRef.current = config.timeframe
  const progressRef = useRef<string | null>(null)
  const volPaneRef = useRef<string | null>(null)
  const macdPaneRef = useRef<string | null>(null)
  const syncStateRef = useRef({ sync: syncCrosshair, syncTimer: 0 })
  syncStateRef.current.sync = syncCrosshair

  const anchorRef = useRef(anchor); anchorRef.current = anchor
  const onKLineClickRef = useRef(onKLineClick); onKLineClickRef.current = onKLineClick
  const flagOverlayIdRef = useRef<string | null>(null)
  function createFresh() {
    const chart = chartRef.current
    const t = toolRef.current
    if (!chart || !t || t === '光标' || !toolOverlay[t]) return
    let extendData: unknown
    if (t === '文字') extendData = window.prompt('标注文字', '') ?? ''
    const id = chart.createOverlay({
      name: toolOverlay[t],
      points: [] as Point[],
      styles: styleFor(styleRef.current),
      onDrawEnd: (ev: { overlay: { id: string; points: Point[]; extendData?: string } }) => {
        progressRef.current = null
        api.saveDrawing({
          id: ev.overlay.id,
          symbol: symRef.current,
          timeframe: tfRef.current,
          type: t,
          points: ev.overlay.points,
          color: styleRef.current.color,
          width: styleRef.current.width,
          dashed: styleRef.current.dashed,
          label: t === '文字' ? (ev.overlay.extendData as string | undefined) : undefined,
        }).catch(e => console.error('save drawing failed', e))
        createFresh()
      },
      onRightClick: (ev: { overlay: { id: string } }) => {
        api.deleteDrawing(ev.overlay.id).catch(() => {})
        chart.removeOverlay(ev.overlay.id)
        return true
      },
    } as never)
    const first = Array.isArray(id) ? id[0] : id
    if (first) progressRef.current = first
  }

  /** 按 anchor 在图上看锚点旗标并滚动到位；目标与自身 symbol+timeframe 匹配时生效 */
  function applyAnchorFlag() {
    const chart = chartRef.current
    if (!chart) return
    const t = anchorRef.current
    const matches = !!t && t.symbol === symRef.current && t.timeframe === tfRef.current
    // 本面板不再是锚点目标 → 清掉旧旗标
    if (!matches) {
      if (flagOverlayIdRef.current) {
        chart.removeOverlay(flagOverlayIdRef.current)
        flagOverlayIdRef.current = null
      }
      return
    }
    // 取数据；无数据则放弃
    const data = chart.getDataList()
    if (!data.length) return
    // 找最接近 anchor ts 的 K 线
    let idx = 0
    let best = Infinity
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(data[i].timestamp - t.ts)
      if (d < best) { best = d; idx = i }
    }
    const bar = data[idx]
    // 定位旗标 y 值：优先 price，其次 side
    let value: number
    if (t.price != null && t.price > 0) value = t.price
    else {
      const side = t.side ?? 'high'
      value = side === 'low' ? bar.low : side === 'close' ? bar.close : bar.high
    }
    // 移除旧旗标
    if (flagOverlayIdRef.current) {
      chart.removeOverlay(flagOverlayIdRef.current)
      flagOverlayIdRef.current = null
    }
    const id = createAnchorFlag(chart, { timestamp: bar.timestamp, value }, t.title, t.status)
    if (id) flagOverlayIdRef.current = id
    // 滚动到锚点
    chart.scrollToTimestamp(bar.timestamp, 300)
  }

  useEffect(() => {
    if (!hostRef.current) return
    registerCustomOverlays()
    const chart = init(hostRef.current)
    if (!chart) return
    chartRef.current = chart
    chart.setStyles({
      grid: { horizontal: { color: '#17263a', size: 1, style: LineType.Dashed }, vertical: { color: '#17263a', size: 1, style: LineType.Dashed } },
      candle: {
        bar: {
          upColor: '#13b8a6', downColor: '#f05d73', noChangeColor: '#9aa8ba',
          upBorderColor: '#13b8a6', downBorderColor: '#f05d73', noChangeBorderColor: '#9aa8ba',
          upWickColor: '#13b8a6', downWickColor: '#f05d73', noChangeWickColor: '#9aa8ba',
        },
      },
      xAxis: { axisLine: { color: '#26374d' }, tickLine: { color: '#26374d' }, tickText: { color: '#8394aa', size: 10 } },
      yAxis: { axisLine: { color: '#26374d' }, tickLine: { color: '#26374d' }, tickText: { color: '#8394aa', size: 10 } },
      separator: { color: '#26374d', size: 1, fill: true, activeBackgroundColor: '#17263a' },
      crosshair: {
        horizontal: { line: { color: '#6b829e', size: 1, style: LineType.Dashed }, text: { color: '#e5edf7', backgroundColor: '#23344b' } },
        vertical: { line: { color: '#6b829e', size: 1, style: LineType.Dashed }, text: { color: '#e5edf7', backgroundColor: '#23344b' } },
      },
    })
    // 指标只建一次：klinecharts 不带 pane id 的 createIndicator 每次都会新建 pane，
    // 而指标实例已订阅数据变化，applyNewData 时自动重算，无需每次切周期重建
    const volPane = chart.createIndicator('VOL')
    const macdPane = chart.createIndicator('MACD')
    volPaneRef.current = volPane
    macdPaneRef.current = macdPane

    // 联动：可见窗口 + 十字光标同步到其它面板
    const onVisibleRange = () => {
      if (!syncStateRef.current.sync) return
      if (isApplyingVisible()) return // 程序化联动期间不回弹，消除缩放回声
      const me: Peer = { id: config.id, chart, timeframe: tfRef.current, guardedUntil: 0, lastCrossTs: 0, lastCrossClose: 0 }
      const { t0, t1 } = getVisibleTimestamps(chart)
      if (t0 === 0) return
      for (const peer of livePeers(config.id)) {
        applyTimeWindow(me, t0, t1, peer)
      }
    }
    const onCrosshair = (data: { dataIndex?: number } | undefined) => {
      if (typeof data?.dataIndex !== 'number') return
      const bar = chart.getDataList()[data.dataIndex]
      if (typeof bar?.timestamp !== 'number') return
      const srcTs = bar.timestamp
      recordLastCross(config.id, srcTs, bar.close)
      if (!syncStateRef.current.sync) return
      for (const peer of livePeers(config.id)) {
        if (isGuarded(peer.id)) continue
        applyCrossTimestamp(srcTs, peer)
      }
    }
    chart.subscribeAction('onVisibleRangeChange' as never, onVisibleRange)
    chart.subscribeAction('onCrosshairChange' as never, onCrosshair)
    registerPeer(config.id, chart, config.timeframe)
    // 点 K 线所在竖列钉锚点：原生 click。十字已随 mousemove 停在目标 K 线上，
    // 取该 K 线（getLastCross / getLastCrossClose）即点的那根。
    // 记录 mousedown 位置，位移 > 5px 视为拖拽/滚动/画线，不触发。
    let downPos: { x: number; y: number } | null = null
    const onMouseDown = (e: MouseEvent) => { downPos = { x: e.clientX, y: e.clientY } }
    const onClick = (e: MouseEvent) => {
      if (toolRef.current !== '光标') { downPos = null; return }
      const d = downPos
      downPos = null
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return
      const ts = getLastCross(config.id)
      if (!ts) return
      onKLineClickRef.current?.(ts, getLastCrossClose(config.id))
    }
    hostRef.current.addEventListener('mousedown', onMouseDown)
    hostRef.current.addEventListener('click', onClick)

    const resize = new ResizeObserver(() => chart.resize())
    resize.observe(hostRef.current)
    return () => {
      chart.unsubscribeAction('onVisibleRangeChange' as never, onVisibleRange)
      chart.unsubscribeAction('onCrosshairChange' as never, onCrosshair)
      hostRef.current?.removeEventListener('mousedown', onMouseDown)
      hostRef.current?.removeEventListener('click', onClick)
      unregisterPeer(config.id)
      resize.disconnect()
      dispose(hostRef.current!)
      chartRef.current = null
      progressRef.current = null
    }
  }, [])

  // load OHLCV + restore drawings when symbol/timeframe/refresh changes
  useEffect(() => {
    let cancelled = false
    setLoading(true); setNoData(false)
    async function load() {
      try {
        const chart = chartRef.current
        if (!chart) return
        chart.removeOverlay()
        progressRef.current = null
        flagOverlayIdRef.current = null
        const candles = await api.ohlcv(config.symbol, config.timeframe, 1000, dateStartMs, dateEndMs)
        if (cancelled || !chartRef.current) return
        if (candles.length === 0) { setNoData(true); setLoading(false); return }
        setNoData(false)
        chart.applyNewData(candles as never)

        const list = await api.drawings(config.symbol, config.timeframe)
        if (cancelled || !chartRef.current) return
        for (const d of list) restore(d)
        setLoading(false)
        applyAnchorFlag()
      } catch (e) {
        if (!cancelled) { setNoData(true); setLoading(false); console.error('load ohlcv failed', e) }
      }
    }
    function restore(d: DrawingRecord) {
      const chart = chartRef.current
      if (!chart) return
      chart.createOverlay({
        id: d.id,
        name: toolOverlay[d.type as ToolName] || 'straightLine',
        points: (d.points as Point[]) || [],
        styles: styleFor({ color: d.color ?? '#3b82f6', width: d.width ?? 2, dashed: !!d.dashed }),
        extendData: d.label,
        onRightClick: (ev: { overlay: { id: string } }) => {
          api.deleteDrawing(d.id).catch(() => {})
          chart.removeOverlay(d.id)
          return true
        },
      } as never)
    }
    load()
    return () => { cancelled = true }
  }, [config.symbol, config.timeframe, refreshSignal, dateStartMs, dateEndMs])

  // anchor 变化（数据已加载后）时重画旗标 / 滚动
  useEffect(() => {
    if (loading || noData) return
    applyAnchorFlag()
  }, [anchor])

  // 指标开关：VOL / MACD pane 按状态创建或移除
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (showVol) {
      if (!volPaneRef.current) volPaneRef.current = chart.createIndicator('VOL') ?? null
    } else if (volPaneRef.current) {
      chart.removeIndicator(volPaneRef.current, 'VOL')
      volPaneRef.current = null
    }
    if (showMacd) {
      if (!macdPaneRef.current) macdPaneRef.current = chart.createIndicator('MACD') ?? null
    } else if (macdPaneRef.current) {
      chart.removeIndicator(macdPaneRef.current, 'MACD')
      macdPaneRef.current = null
    }
  }, [showVol, showMacd])

  // 标签显隐：指标 tooltip 的 showRule
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setStyles({ indicator: { tooltip: { showRule: showLabels ? TooltipShowRule.FollowCross : TooltipShowRule.None } } as never })
  }, [showLabels])

  // tool activation -> only the active panel starts a draft; others cancel theirs
  useEffect(() => {
    toolRef.current = tool
    const chart = chartRef.current
    if (!chart) return
    const canDraw = active && tool !== '光标' && !!toolOverlay[tool]
    if (progressRef.current) { chart.removeOverlay(progressRef.current); progressRef.current = null }
    if (canDraw) createFresh()
  }, [tool, active])

  // clear all drawings on this chart
  useEffect(() => {
    if (clearSignal === 0) return
    const chart = chartRef.current
    if (!chart) return
    chart.removeOverlay()
    progressRef.current = null
    api.sweepDrawings(config.symbol, config.timeframe).catch(() => {})
  }, [clearSignal])

  const loadingOrEmpty = loading || noData

  return (
    <section className={`chart-panel ${active ? 'is-active' : ''}`} onMouseDown={onActivate}>
      <header className="chart-panel-head">
        <div className="chart-title-group">
          <span className="live-dot" />
          <strong>{config.symbol}</strong>
          <span className="chart-market-meta">{config.timeframe} · Binance 期货</span>
        </div>
        <div className="chart-head-actions">
          <button className="icon-button" title="放大视图" onClick={e => { e.stopPropagation(); onFullscreen() }}><Maximize2 size={14} /></button>
          {onRemove && <button className="icon-button danger-hover" title="移除此视图" onClick={e => { e.stopPropagation(); onRemove() }}><X size={14} /></button>}
          <button className="icon-button" title="更多" onClick={e => { e.stopPropagation(); setShowMenu(v => !v) }}><MoreHorizontal size={16} /></button>
        </div>
        {showMenu && <div className="chart-menu">
          {symbols.map(s => <button key={s.symbol} onClick={() => { onConfigChange({ symbol: s.symbol }); setShowMenu(false) }}>切换到 {s.symbol}</button>)}
          {symbols.length === 0 && <button disabled>本地暂无数据</button>}
        </div>}
      </header>
      <div className="period-strip">
        {periods.map(p => <button key={p} className={config.timeframe === p ? 'period active' : 'period'} onClick={e => { e.stopPropagation(); onConfigChange({ timeframe: p }) }}>{p}</button>)}
        <span className="chart-value">{tool !== '光标' ? `画线 · ${tool}` : (syncCrosshair ? '联动已开启' : '独立视图')}</span>
      </div>
      <div className="chart-canvas" ref={hostRef} />
      {loadingOrEmpty && <div className="chart-status">{loading ? '加载行情…' : '本地无数据，点「加载数据」补拉'}</div>}
      <footer className="chart-panel-foot">
        <span>Binance 期货 · SQLite</span>
        <span>OHLCV · 右键删线 · 点 K 线体钉锚点</span>
      </footer>
    </section>
  )
}
