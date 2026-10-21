 import type { Candle, DrawingRecord, Review, ReviewStatus, SymbolInfo, ReviewExport } from './types'

const BASE = 'http://127.0.0.1:8000'

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!r.ok) throw new Error(`${r.status} ${path}`)
  return r.json()
}

export interface Health {
  ok: boolean
  db: string
  klineRows: number
  symbols: number
  lastBar: number
  fetching: boolean
}

export const api = {
  health: () => j<Health>('/api/health'),
  symbols: () => j<SymbolInfo[]>('/api/symbols'),
  timeframes: (symbol: string) => j<string[]>(`/api/timeframes?symbol=${encodeURIComponent(symbol)}`),
  ohlcv: (symbol: string, timeframe: string, limit = 1000, startMs?: number, endMs?: number) => {
    let q = `/api/ohlcv?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`
    if (startMs !== undefined) q += `&start=${startMs}`
    if (endMs !== undefined) q += `&end=${endMs}`
    return j<Candle[]>(q)
  },
  deleteReview: (id: string) =>
    j<{ deleted: string }>(`/api/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  fetchMore: (symbol: string, timeframe = '1h', bars = 1000, startMs?: number, endMs?: number) =>
    j<{ id: string; state: string }>('/api/fetch', { method: 'POST', body: JSON.stringify({ symbol, timeframe, bars, startMs, endMs }) }),
  drawings: (symbol: string, timeframe: string) =>
    j<DrawingRecord[]>(`/api/drawings?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`),
  saveDrawing: (d: Partial<DrawingRecord>) =>
    j<{ id: string }>('/api/drawings', { method: 'POST', body: JSON.stringify(d) }),
  deleteDrawing: (id: string) =>
    j<{ deleted: string }>(`/api/drawings/${id}`, { method: 'DELETE' }),
  sweepDrawings: (symbol: string, timeframe: string) =>
    j<{ deleted: number }>(`/api/drawings?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`, { method: 'DELETE' }),
  reviews: (limit = 20, status?: ReviewStatus | 'resolved', symbol?: string) => {
    let q = `/api/reviews?limit=${limit}`
    if (status) q += `&status=${status}`
    if (symbol) q += `&symbol=${encodeURIComponent(symbol)}`
    return j<Review[]>(q)
  },
  saveReview: (r: Partial<Review>) =>
    j<{ id: string }>('/api/reviews', { method: 'POST', body: JSON.stringify(r) }),
  updateReview: (id: string, r: Partial<Review>) =>
    j<{ id: string }>(`/api/reviews/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(r) }),
  /** 导出复盘为 ML 训练样本：join 锚点 K 线行情窗口 + 自动结果标签 */
  exportReviews: (opts?: { status?: ReviewStatus | 'resolved'; symbol?: string; ctx?: number; limit?: number }) => {
    let q = `/api/reviews/export?ctx=${opts?.ctx ?? 48}&limit=${opts?.limit ?? 500}`
    if (opts?.status) q += `&status=${opts.status}`
    if (opts?.symbol) q += `&symbol=${encodeURIComponent(opts.symbol)}`
    return j<ReviewExport[]>(q)
  },
  /** 批量操作复盘：标记状态或删除 */
  bulkReviews: (ids: string[], action: 'status' | 'delete', status?: ReviewStatus) =>
    j<{ deleted?: number; updated?: number; changed?: number }>('/api/reviews/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, action, status }),
    }),
  getWorkspace: (id: string) => j<{ charts?: { id: string; symbol: string; timeframe: string }[]; layout?: number; sync?: boolean; dark?: boolean; dateStart?: string; dateEnd?: string }>(`/api/workspaces/${encodeURIComponent(id)}`),
  putWorkspace: (id: string, config: unknown) =>
    j(`/api/workspaces/${id}`, { method: 'PUT', body: JSON.stringify(config) }),
  /** 列出所有已保存工作区 */
  listWorkspaces: () => j<{ id: string; savedAt: number; charts: number; layout?: number }[]>('/api/workspaces'),
  /** 删除指定工作区 */
  deleteWorkspace: (id: string) =>
    j<{ deleted: string }>(`/api/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' }),
