import type { ReviewExport } from './types'

export type ExportFormat = 'json' | 'jsonl' | 'csv'

/** 展平一条导出记录成训练友好的列（CSV 用） */
function flattenRow(r: ReviewExport): Record<string, string | number | boolean | null> {
  const o = r.outcome
  const m = r.market
  const anchor = r.anchor ?? null
  const anchorBar = m?.after?.length ? m.after[0] : m?.before?.length ? m.before[m.before.length - 1] : null
  return {
    id: r.id,
    symbol: r.symbol,
    timeframe: r.timeframe,
    status: r.status ?? 'open',
    resolvedBy: o?.resolvedBy ?? 'none',
    direction: r.direction ?? '',
    setup: r.setup ?? '',
    rationale: r.rationale ?? '',
    horizon: r.horizon ?? '',
    tags: (r.tags ?? []).join('|'),
    entry: r.entry ?? null,
    targets: (r.targets ?? []).join('|') || null,
    invalidation: r.invalidation ?? null,
    anchorTs: r.anchorTs ?? anchor?.timestamp ?? null,
    anchorPrice: r.anchorPrice ?? anchor?.price ?? null,
    outcomeBasis: o?.basis ?? null,
    finalClose: o?.finalClose ?? null,
    retPct: o?.retPct ?? null,
    mfePct: o?.mfePct ?? null,
    maePct: o?.maePct ?? null,
    hitTarget: o?.hitTarget ?? false,
    hitInvalidation: o?.hitInvalidation ?? false,
    targetHitIndex: o?.targetHitIndex ?? null,
    invalidationHitIndex: o?.invalidationHitIndex ?? null,
    sequence: o?.sequence ?? 'none',
    outcomeNote: r.outcomeNote ?? '',
    content: r.content ?? '',
    // 锚点 K 线附近的行情摘要（供快速特征提取；完整窗口仍在 market 字段/JSONL 中）
    ctxBars: m?.ctx ?? 0,
    nBefore: m?.before?.length ?? 0,
    nAfter: m?.after?.length ?? 0,
    anchorOpen: anchorBar?.open ?? null,
    anchorHigh: anchorBar?.high ?? null,
    anchorLow: anchorBar?.low ?? null,
    anchorClose: anchorBar?.close ?? null,
    anchorVolume: anchorBar?.volume ?? null,
  }
}

/** CSV 列顺序（稳定，首行表头） */
const CSV_COLS = [
  'id', 'symbol', 'timeframe', 'status', 'resolvedBy', 'direction', 'setup', 'rationale',
  'horizon', 'tags', 'entry', 'targets', 'invalidation', 'anchorTs', 'anchorPrice',
  'outcomeBasis', 'finalClose', 'retPct', 'mfePct', 'maePct', 'hitTarget', 'hitInvalidation',
  'targetHitIndex', 'invalidationHitIndex', 'sequence', 'outcomeNote', 'content',
  'ctxBars', 'nBefore', 'nAfter', 'anchorOpen', 'anchorHigh', 'anchorLow', 'anchorClose', 'anchorVolume',
]

function csvCell(v: string | number | boolean | null): string {
  if (v === null || v === undefined || v === '') return ''
  const s = String(v)
  // 含引号/逗号/换行 → 转义
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function toCSV(rows: ReviewExport[]): string {
  const header = CSV_COLS.join(',')
  const lines = rows.map(r => {
    const f = flattenRow(r)
    return CSV_COLS.map(c => csvCell(f[c])).join(',')
  })
  return [header, ...lines].join('\n')
}

function toJSONL(rows: ReviewExport[]): string {
  return rows.map(r => JSON.stringify(r)).join('\n')
}

/** 生成指定格式的文件文本 */
export function exportText(rows: ReviewExport[], format: ExportFormat): string {
  if (format === 'csv') return toCSV(rows)
  if (format === 'jsonl') return toJSONL(rows)
  return JSON.stringify(rows, null, 2)
}

export function exportMime(format: ExportFormat): string {
  if (format === 'csv') return 'text/csv'
  if (format === 'jsonl') return 'text/plain'
  return 'application/json'
}

export function exportExt(format: ExportFormat): string {
  return format === 'csv' ? 'csv' : format === 'jsonl' ? 'jsonl' : 'json'
}

/** 在浏览器中触发下载 */
export function downloadExport(rows: ReviewExport[], format: ExportFormat, stamp?: number): string {
  const body = exportText(rows, format)
  const blob = new Blob([body], { type: exportMime(format) + ';charset=utf-8' })
  const name = `barbook-${new Date(stamp ?? Date.now()).toISOString().slice(0, 10)}.${exportExt(format)}`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return name
}
