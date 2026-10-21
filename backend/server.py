"""K线复盘工作台 · FastAPI backend.

Endpoints (README 规划):
  GET  /api/health
  GET  /api/symbols
  GET  /api/timeframes?symbol=BTCUSDT
  GET  /api/ohlcv?symbol=BTCUSDT&timeframe=15m&start=&end=&limit=
  POST /api/fetch            (后台拉取最近 N 根 K 线入 SQLite)
  GET  /api/fetch/status
  GET/POST /api/drawings , DELETE /api/drawings/{id} , DELETE /api/drawings?symbol=&timeframe=
  GET/POST /api/reviews
  GET/PUT /api/workspaces/{id}

Run: python backend/server.py   (http://127.0.0.1:8000)
"""
import json
import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Optional
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import fetch_binance_data as fb

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "markets.db"
DRAWINGS_PATH = DATA_DIR / "drawings.json"
REVIEWS_PATH = DATA_DIR / "reviews.json"
WORKSPACES_DIR = DATA_DIR / "workspaces"

EXCHANGE = "binance"
INTERVAL_SEC = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600, "8h": 28800,
    "12h": 43200, "1d": 86400, "3d": 259200, "1w": 604800,
}
MAX_FETCH_BARS = 5000  # 单次抓取回看根数上限,防超大区间拖死

COIN_META = {
    "BTCUSDT": ("Bitcoin", "#f7931a"),
    "ETHUSDT": ("Ethereum", "#8297ff"),
    "SOLUSDT": ("Solana", "#a78bfa"),
    "BNBUSDT": ("BNB", "#f3ba2f"),
    "XRPUSDT": ("XRP", "#cbd5e1"),
    "DOGEUSDT": ("Dogecoin", "#d6b85a"),
    "ADAUSDT": ("Cardano", "#3478f6"),
    "LINKUSDT": ("Chainlink", "#4b8bff"),
}

# 启动时若本地数据不足则自动补拉（最近 400 根）
SEED_TASKS = [
    ("BTCUSDT", "15m"), ("BTCUSDT", "1h"), ("BTCUSDT", "4h"), ("BTCUSDT", "1d"),
    ("ETHUSDT", "1h"), ("SOLUSDT", "1h"),
]
SEED_BARS = 400


def norm_tf(tf: str) -> str:
    tf = tf.lower()
    if tf not in INTERVAL_SEC:
        raise HTTPException(400, f"unsupported timeframe: {tf}")
    return tf


# ---------- SQLite ----------

def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def db_init():
    conn = get_conn()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS kline (
                exchange TEXT NOT NULL,
                symbol TEXT NOT NULL,
                interval TEXT NOT NULL,
                time INTEGER NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL,
                close REAL NOT NULL,
                volume REAL NOT NULL,
                funding_rate REAL,
                UNIQUE(exchange, symbol, interval, time)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_kline_lookup
            ON kline(exchange, symbol, interval, time)
        """)
        conn.commit()
    finally:
        conn.close()


def db_stats() -> dict:
    conn = get_conn()
    try:
        row = conn.execute("SELECT COUNT(*) AS n, COUNT(DISTINCT symbol) AS s FROM kline").fetchone()
        last = conn.execute("SELECT MAX(time) AS t FROM kline").fetchone()
        return {"rows": row["n"], "symbols": row["s"], "lastBar": last["t"]}
    finally:
        conn.close()


# 全局 JSON 文件锁:多面板并发 sweep/save 时串行化 load→modify→save,
# 避免 Windows 下 tmp 名冲突与 rename 时的文件占用 (WinError 32)
_json_lock = threading.RLock()

# ---------- JSON file stores ----------

def _load_json(path: Path, key: str) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"items": {}}


def _save_json(path: Path, data: dict):
    with _json_lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            tmp.replace(path)
        except PermissionError:
            # 文件仍被其他进程/句柄占用:短暂等待后重试
            for _ in range(5):
                time.sleep(0.05)
                tmp.replace(path)
        finally:
            if tmp.exists():
                try:
                    tmp.unlink()
                except OSError:
                    pass
def _json_update(path: Path, updater):
    """锁内 读取 → updater(data) → 写回,返回 updater 的返回值。
    多面板并发写同一 store 时按序串行,不会出现旧值覆盖新值。"""
    with _json_lock:
        data = _load_json(path, "items")
        result = updater(data)
        _save_json(path, data)
        return result


# ---------- fetch tasks ----------

_fetch_tasks: list[dict] = []
_fetch_lock = threading.Lock()


def _new_task(
    symbol: str,
    timeframe: str,
    bars: int,
    proxy: Optional[str],
    start_ms: Optional[int] = None,
    end_ms: Optional[int] = None,
) -> dict:
    task = {
        "id": uuid.uuid4().hex[:8],
        "symbol": symbol,
        "timeframe": timeframe,
        "bars": bars,
        "startMs": start_ms,
        "endMs": end_ms,
        "state": "running",
        "message": "",
        "startedAt": int(datetime.now(timezone.utc).timestamp()),
    }
    with _fetch_lock:
        _fetch_tasks.append(task)
        _fetch_tasks[:] = _fetch_tasks[-20:]
    threading.Thread(target=_run_fetch_task, args=(task,), daemon=True).start()
    return task


def _run_fetch_task(task: dict):
    tf = task["timeframe"]
    sec = INTERVAL_SEC[tf]
    end_dt = datetime.now(timezone.utc)
    if task.get("endMs"):
        end_dt = datetime.fromtimestamp(task["endMs"] / 1000, tz=timezone.utc)
    if task.get("startMs"):
        start_dt = datetime.fromtimestamp(task["startMs"] / 1000, tz=timezone.utc)
    else:
        # 未指定起始:默认回看 N 根(上限 MAX_FETCH_BARS 防超大区间)
        start_dt = end_dt - timedelta(seconds=sec * min(task["bars"], MAX_FETCH_BARS))
    try:
        data = fb.fetch_range(task["symbol"], tf, start_dt, end_dt, proxy=task.get("proxy"))
        fb.save_to_db(data, DB_PATH, task["symbol"], tf, EXCHANGE)
        task["state"] = "done"
        task["message"] = f"{len(data)} bars saved"
        task["finishedAt"] = int(datetime.now(timezone.utc).timestamp())
    except Exception as e:  # noqa: BLE001
        task["state"] = "error"
        task["message"] = f"{type(e).__name__}: {e}"
        task["finishedAt"] = int(datetime.now(timezone.utc).timestamp())


def _seed_missing():
    """启动时补齐本地数据：DB 中该 (symbol, tf) 不足 SEED_BARS 根时拉取最近数据。"""
    for symbol, tf in SEED_TASKS:
        conn = get_conn()
        try:
            n = conn.execute(
                "SELECT COUNT(*) AS n FROM kline WHERE exchange=? AND symbol=? AND interval=?",
                (EXCHANGE, symbol, tf),
            ).fetchone()["n"]
        finally:
            conn.close()
        if n >= SEED_BARS:
            continue
        with _fetch_lock:
            already = any(
                t["symbol"] == symbol and t["timeframe"] == tf and t["state"] == "running"
                for t in _fetch_tasks
            )
        if not already:
            _new_task(symbol, tf, SEED_BARS, None)


# ---------- app ----------

app = FastAPI(title="kline-review")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8080", "http://127.0.0.1:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    db_init()
    _seed_missing()


class FetchRequest(BaseModel):
    symbol: str = "BTCUSDT"
    timeframe: str = "1h"
    bars: int = 400
    proxy: Optional[str] = None
    startMs: Optional[int] = None  # 指定抓取起点(ms),与 endMs 一起构成区间
    endMs: Optional[int] = None    # 默认抓取到当前时间


class ReviewIn(BaseModel):
    title: str = ""
    content: str = ""
    symbol: str = ""
    timeframe: str = ""
    tags: list[str] = []
    # 判断层：可证伪的假设
    setup: str = ""
    direction: str = ""
    entry: Optional[float] = None
    targets: list[float] = []
    invalidation: Optional[float] = None
    rationale: str = ""
    horizon: str = ""
    # 结果层：复盘闭环
    status: str = "open"
    resolvedAt: Optional[int] = None
    outcomeNote: str = ""
    # 上下文引用：关联画线 / 时间窗
    refs: list[str] = []
    dateStart: Optional[int] = None
    dateEnd: Optional[int] = None
    # 锚定 K 线：复盘针对哪一根 K 线
    anchor: Optional["ReviewAnchor"] = None


class ReviewAnchor(BaseModel):
    timestamp: int
    price: Optional[float] = None
    side: Optional[str] = None


class DrawingIn(BaseModel):
    id: Optional[str] = None
    symbol: str
    timeframe: str
    type: str
    points: list = []
    color: Optional[str] = None
    width: int = 2
    dashed: bool = False
    label: Optional[str] = None


@app.get("/api/health")
def health():
    stats = db_stats()
    with _fetch_lock:
        tasks = [dict(t) for t in _fetch_tasks if t["state"] == "running"]
    return {
        "ok": True,
        "db": str(DB_PATH.relative_to(DB_PATH.parent.parent)),
        "klineRows": stats["rows"],
        "symbols": stats["symbols"],
        "lastBar": stats["lastBar"],
        "fetching": len(tasks) > 0,
    }


@app.get("/api/symbols")
def symbols():
    conn = get_conn()
    try:
        rows = conn.execute(
            """SELECT DISTINCT symbol FROM kline WHERE exchange=? ORDER BY symbol""",
            (EXCHANGE,),
        ).fetchall()
        out = []
        now = int(datetime.now(timezone.utc).timestamp())
        for r in rows:
            sym = r["symbol"]
            tf_rows = conn.execute(
                "SELECT DISTINCT interval FROM kline WHERE exchange=? AND symbol=? ORDER BY CAST(interval AS TEXT)",
                (EXCHANGE, sym),
            ).fetchall()
            closes = conn.execute(
                "SELECT close FROM kline WHERE exchange=? AND symbol=? ORDER BY time DESC LIMIT 2",
                (EXCHANGE, sym),
            ).fetchall()
            last = closes[0]["close"] if closes else None
            prev = closes[1]["close"] if len(closes) > 1 else None
            if prev:
                change = f"{'+' if last >= prev else ''}{(last - prev) / prev * 100:.2f}%"
            else:
                day = conn.execute(
                    "SELECT close FROM kline WHERE exchange=? AND symbol=? AND time<=? ORDER BY time DESC LIMIT 1",
                    (EXCHANGE, sym, now - 86400),
                ).fetchone()
                change = (
                    f"{'+' if (day and last and last >= day['close']) else ''}24h"
                    if not day or not last else
                    f"{'+' if last >= day['close'] else ''}{(last - day['close']) / day['close'] * 100:.2f}%"
                )
            base = sym.replace("USDT", "").replace("USD", "")
            name, color = COIN_META.get(sym, (base, "#4b8bff"))
            out.append({
                "symbol": sym,
                "name": name,
                "price": f"{last:,.2f}" if last is not None else "—",
                "change": change,
                "color": color,
                "timeframes": [t["interval"] for t in tf_rows],
            })
        return out
    finally:
        conn.close()


@app.get("/api/timeframes")
def timeframes(symbol: str = Query(...)):
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT DISTINCT interval FROM kline WHERE exchange=? AND symbol=?",
            (EXCHANGE, symbol.upper()),
        ).fetchall()
        return [r["interval"] for r in rows]
    finally:
        conn.close()


@app.get("/api/ohlcv")
def ohlcv(
    symbol: str = Query(...),
    timeframe: str = Query(...),
    start: Optional[int] = Query(None, description="start ms"),
    end: Optional[int] = Query(None, description="end ms"),
    limit: int = Query(300, le=5000),
):
    tf = norm_tf(timeframe)
    sym = symbol.upper()
    conn = get_conn()
    try:
        cond = "exchange=? AND symbol=? AND interval=?"
        params: list = [EXCHANGE, sym, tf]
        if start is not None:
            cond += " AND time>=?"
            params.append(start // 1000)
        if end is not None:
            cond += " AND time<=?"
            params.append(end // 1000)
        rows = conn.execute(
            f"SELECT time,open,high,low,close,volume FROM kline WHERE {cond} ORDER BY time DESC LIMIT ?",
            params + [limit],
        ).fetchall()
        rows.reverse()
        return [
            {
                "timestamp": r["time"] * 1000,
                "open": r["open"],
                "high": r["high"],
                "low": r["low"],
                "close": r["close"],
                "volume": r["volume"],
            }
            for r in rows
        ]
    finally:
        conn.close()


@app.post("/api/fetch")
def post_fetch(req: FetchRequest):
    tf = norm_tf(req.timeframe)
    bars = max(1, min(req.bars, MAX_FETCH_BARS))
    sec = INTERVAL_SEC[tf]
    start_ms = req.startMs
    end_ms = req.endMs
    # 区间跨度上限:超过 MAX_FETCH_BARS 根的部分截掉,避免超大历史区间
    if start_ms and end_ms and end_ms - start_ms > sec * MAX_FETCH_BARS * 1000:
        start_ms = end_ms - sec * MAX_FETCH_BARS * 1000
    task = _new_task(req.symbol.upper(), tf, bars, req.proxy, start_ms, end_ms)
    return task


@app.get("/api/fetch/status")
def fetch_status():
    with _fetch_lock:
        return {"tasks": [dict(t) for t in _fetch_tasks]}


# ---- drawings ----

@app.get("/api/drawings")
def drawings_list(symbol: Optional[str] = None, timeframe: Optional[str] = None):
    data = _load_json(DRAWINGS_PATH, "drawings")
    items = list(data["items"].values())
    if symbol:
        items = [d for d in items if d.get("symbol").upper() == symbol.upper()]
    if timeframe:
        items = [d for d in items if d.get("timeframe").lower() == timeframe.lower()]
    items.sort(key=lambda d: d.get("createdAt", 0))
    return items


@app.post("/api/drawings")
def drawings_create(d: DrawingIn):
    def _up(data):
        if not d.id:
            d.id = uuid.uuid4().hex[:12]
        rec = d.model_dump()
        rec["symbol"] = rec["symbol"].upper()
        rec["timeframe"] = norm_tf(rec["timeframe"])
        rec["createdAt"] = int(datetime.now(timezone.utc).timestamp())
        data["items"][rec["id"]] = rec
        return rec["id"]
    return {"id": _json_update(DRAWINGS_PATH, _up)}


@app.delete("/api/drawings/{drawing_id}")
def drawings_delete(drawing_id: str):
    def _up(data):
        if drawing_id not in data["items"]:
            raise HTTPException(404, "drawing not found")
        del data["items"][drawing_id]
        return drawing_id
    return {"deleted": _json_update(DRAWINGS_PATH, _up)}


@app.delete("/api/drawings")
def drawings_sweep(symbol: str, timeframe: str):
    tf = norm_tf(timeframe)
    def _up(data):
        keep = {k: v for k, v in data["items"].items()
                if not (v.get("symbol") == symbol.upper() and v.get("timeframe") == tf)}
        removed = len(data["items"]) - len(keep)
        data["items"] = keep
        return removed
    return {"deleted": _json_update(DRAWINGS_PATH, _up)}


# ---- reviews ----

# 专业复盘记录的状态枚举（结果层闭环）
REVIEW_STATUSES = {"open", "verified", "falsified", "expired", "abandoned"}


def _normalize_anchor(a):
    """规范化锚定 K 线: 接受 dict/ReviewAnchor/None, 返回 dict 或 None。"""
    if a is None:
        return None
    if hasattr(a, "model_dump"):
        a = a.model_dump()
    if not isinstance(a, dict):
        return None
    ts = a.get("timestamp")
    if not isinstance(ts, (int, float)) or ts <= 0:
        return None
    out: dict = {"timestamp": int(ts)}
    price = a.get("price")
    if price is not None and isinstance(price, (int, float)):
        out["price"] = float(price)
    side = a.get("side")
    if side in ("high", "low", "close"):
        out["side"] = side
    return out

def _normalize_review(payload: dict) -> dict:
    """补全专业字段缺省值,兼容旧记录(只有 title/content/tags)。"""
    rec = {
        "title": payload.get("title", ""),
        "content": payload.get("content", ""),
        "symbol": str(payload.get("symbol", "")).upper(),
        "timeframe": norm_tf(payload.get("timeframe", "")) if payload.get("timeframe") else "",
        "tags": [str(t) for t in payload.get("tags", []) if t],
        # 判断层
        "setup": str(payload.get("setup", "")),
        "direction": str(payload.get("direction", "")),
        "entry": payload.get("entry"),
        "targets": [float(t) for t in payload.get("targets", []) if t is not None],
        "invalidation": payload.get("invalidation"),
        "rationale": str(payload.get("rationale", "")),
        "horizon": str(payload.get("horizon", "")),
        # 结果层
        "status": payload.get("status") if payload.get("status") in REVIEW_STATUSES else "open",
        "resolvedAt": payload.get("resolvedAt"),
        "outcomeNote": str(payload.get("outcomeNote", "")),
        # 上下文引用
        "refs": [str(x) for x in payload.get("refs", []) if x],
        "dateStart": payload.get("dateStart"),
        "dateEnd": payload.get("dateEnd"),
        # 锚定 K 线
        "anchor": _normalize_anchor(payload.get("anchor")),
    }
    if rec["entry"] is not None:
        rec["entry"] = float(rec["entry"])
    if rec["invalidation"] is not None:
        rec["invalidation"] = float(rec["invalidation"])
    return rec


@app.get("/api/reviews")
def reviews(limit: int = Query(20, le=500), status: Optional[str] = None, symbol: Optional[str] = None):
    data = _load_json(REVIEWS_PATH, "reviews")
    items = [dict(v) for v in data["items"].values()]
    # 旧记录归一化:按专业模型补齐缺省字段
    normalized = [_normalize_review(i) | {"id": i.get("id"), "createdAt": i.get("createdAt", 0)} for i in items]
    if status:
        if status == "open":
            normalized = [i for i in normalized if i.get("status") == "open"]
        elif status == "resolved":
            normalized = [i for i in normalized if i.get("status") in REVIEW_STATUSES and i.get("status") != "open"]
        else:
            normalized = [i for i in normalized if i.get("status") == status]
    if symbol:
        normalized = [i for i in normalized if i.get("symbol", "").upper() == symbol.upper()]
    normalized.sort(key=lambda r: r.get("createdAt", 0), reverse=True)
    return normalized[:limit]


@app.post("/api/reviews")
def reviews_create(r: ReviewIn):
    def _up(data):
        rid = uuid.uuid4().hex[:12]
        rec = _normalize_review(r.model_dump())
        rec["id"] = rid
        rec["createdAt"] = int(datetime.now(timezone.utc).timestamp())
        data["items"][rid] = rec
        return rid
    return {"id": _json_update(REVIEWS_PATH, _up)}


@app.put("/api/reviews/{review_id}")
def reviews_update(review_id: str, r: ReviewIn):
    def _up(data):
        if review_id not in data["items"]:
            raise HTTPException(404, "review not found")
        rec = data["items"][review_id]
        base = {**rec, "resolvedAt": rec.get("resolvedAt")}
        merged = _normalize_review({**base, **r.model_dump(exclude_unset=True)})
        merged["id"] = review_id
        merged["createdAt"] = rec.get("createdAt", 0)
        # 结果层:由 open 转入已关闭状态时,自动打 resolvedAt
        if rec.get("status", "open") == "open" and merged["status"] != "open" and not rec.get("resolvedAt"):
            merged["resolvedAt"] = int(datetime.now(timezone.utc).timestamp())
        data["items"][review_id] = merged
        return review_id
    return {"id": _json_update(REVIEWS_PATH, _up)}

@app.delete("/api/reviews/{review_id}")
def reviews_delete(review_id: str):
    def _up(data):
        if review_id not in data["items"]:
            raise HTTPException(404, "review not found")
        del data["items"][review_id]
        return review_id
    return {"deleted": _json_update(REVIEWS_PATH, _up)}


# ---- reviews: export (ML training data) + bulk ops ----

def _tf_seconds(tf: str) -> int:
    return INTERVAL_SEC.get(norm_tf(tf or "1h"), 3600)


def _kline_rows(conn: sqlite3.Connection, symbol: str, db_tf: str, t_start: int, t_end: int, limit: int, order: str) -> list:
    if limit <= 0:
        return []
    rows = conn.execute(
        f"SELECT time,open,high,low,close,volume FROM kline "
        f"WHERE exchange=? AND symbol=? AND interval=? AND time>=? AND time<=? ORDER BY time {order} LIMIT ?",
        [EXCHANGE, symbol, db_tf, t_start, t_end, limit],
    ).fetchall()
    return [
        {"timestamp": x["time"] * 1000, "open": x["open"], "high": x["high"], "low": x["low"], "close": x["close"], "volume": x["volume"]}
        for x in rows
    ]


def _compute_outcome(rec: dict, after_bars: list, basis: Optional[float]) -> dict:
    """基于锚点之后的 K 线窗口计算结果标签：MFE/MAE/触目标/触止损/收益率。
    这些是喂给模型做监督信号的关键数值——没有它们,纯文字决策没有结果标签。"""
    o = {
        "basis": basis,
        "finalClose": None, "retPct": None, "mfePct": None, "maePct": None,
        "hitTarget": False, "hitInvalidation": False,
        "targetHitIndex": None, "invalidationHitIndex": None,
        "sequence": "none",  # none | target | invalidation | ambiguous
        "resolvedBy": "user" if rec.get("status") not in (None, "open") else "none",
    }
    if not after_bars or not isinstance(basis, (int, float)) or basis <= 0:
        return o
    direction = (rec.get("direction") or "").lower()
    targets = [t for t in (rec.get("targets") or []) if isinstance(t, (int, float))]
    invalidation = rec.get("invalidation")
    is_long = direction == "long"
    is_short = direction == "short"
    # 有利/不利极值（按方向）
    if is_short:
        mfe_price = min(b["low"] for b in after_bars)
        mae_price = max(b["high"] for b in after_bars)
        o["mfePct"] = round((basis - mfe_price) / basis * 100, 4)
        o["maePct"] = round((mae_price - basis) / basis * 100, 4)
    else:
        mfe_price = max(b["high"] for b in after_bars)
        mae_price = min(b["low"] for b in after_bars)
        o["mfePct"] = round((mfe_price - basis) / basis * 100, 4)
        o["maePct"] = round((mae_price - basis) / basis * 100, 4)
    # 逐 bar 扫描目标/止损先后次序
    target_idx = inv_idx = None
    for i, b in enumerate(after_bars):
        if target_idx is None and targets:
            if is_short:
                if any(b["low"] <= t for t in targets):
                    target_idx = i
            else:
                if any(b["high"] >= t for t in targets):
                    target_idx = i
        if inv_idx is None and isinstance(invalidation, (int, float)):
            if is_short:
                if b["high"] >= invalidation:
                    inv_idx = i
            else:
                if b["low"] <= invalidation:
                    inv_idx = i
        if target_idx is not None and inv_idx is not None:
            break
    o["hitTarget"] = target_idx is not None
    o["hitInvalidation"] = inv_idx is not None
    o["targetHitIndex"] = target_idx
    o["invalidationHitIndex"] = inv_idx
    if target_idx is not None and inv_idx is None:
        o["sequence"] = "target"
    elif inv_idx is not None and target_idx is None:
        o["sequence"] = "invalidation"
    elif target_idx is not None and inv_idx is not None:
        o["sequence"] = "target" if target_idx < inv_idx else ("invalidation" if inv_idx < target_idx else "ambiguous")
    o["finalClose"] = after_bars[-1]["close"]
    o["retPct"] = round((after_bars[-1]["close"] - basis) / basis * 100, 4)
    return o


class BulkReviewIn(BaseModel):
    ids: list = []
    action: str = "status"   # "status" | "delete"
    status: Optional[str] = None


@app.get("/api/reviews/export")
def reviews_export(
    status: Optional[str] = None,
    symbol: Optional[str] = None,
    ctx: int = Query(48, ge=0, le=500, description="锚点前后各取多少根 K 线作为行情上下文"),
    limit: int = Query(500, le=2000),
):
    """导出复盘为 ML 训练样本:每条记录 join 锚点 K 线行情窗口 + 自动计算结果标签。"""
    data = _load_json(REVIEWS_PATH, "reviews")
    items = [dict(v) for v in data["items"].values()]
    recs = [_normalize_review(i) | {"id": i.get("id"), "createdAt": i.get("createdAt", 0)} for i in items]
    if status:
        if status == "resolved":
            recs = [r for r in recs if r.get("status") in REVIEW_STATUSES and r["status"] != "open"]
        else:
            recs = [r for r in recs if r.get("status") == status]
    if symbol:
        recs = [r for r in recs if (r.get("symbol") or "").upper() == symbol.upper()]
    recs.sort(key=lambda r: r.get("createdAt", 0), reverse=True)
    recs = recs[:limit]

    conn = get_conn()
    out = []
    try:
        for r in recs:
            anchor = r.get("anchor")
            db_tf = norm_tf(r.get("timeframe") or "1h")
            tf_sec = _tf_seconds(r.get("timeframe"))
            sym = (r.get("symbol") or "").upper()
            before_bars: list = []
            after_bars: list = []
            anchor_ts = anchor.get("timestamp") if isinstance(anchor, dict) else None
            if isinstance(anchor_ts, (int, float)) and anchor_ts > 0 and sym:
                anchor_sec = int(anchor_ts) // 1000
                if ctx > 0:
                    before_bars = _kline_rows(conn, sym, db_tf, anchor_sec - ctx * tf_sec, anchor_sec - tf_sec, ctx, "DESC")
                    before_bars.reverse()
                    after_bars = _kline_rows(conn, sym, db_tf, anchor_sec + tf_sec, anchor_sec + ctx * tf_sec, ctx, "ASC")
            basis = r.get("entry")
            if not isinstance(basis, (int, float)) and isinstance(anchor, dict) and isinstance(anchor.get("price"), (int, float)):
                basis = anchor["price"]
            outcome = _compute_outcome(r, after_bars, basis if isinstance(basis, (int, float)) else None)
            row = dict(r)
            row["anchorTs"] = anchor_ts if isinstance(anchor_ts, int) else None
            row["anchorPrice"] = anchor.get("price") if isinstance(anchor, dict) else None
            row["market"] = {"ctx": ctx, "before": before_bars, "after": after_bars}
            row["outcome"] = outcome
            out.append(row)
    finally:
        conn.close()
    return out


@app.post("/api/reviews/bulk")
def reviews_bulk(req: BulkReviewIn):
    ids = [i for i in req.ids if i]
    if not ids:
        return {"changed": 0}
    if req.action == "delete":
        def _up(data):
            n = 0
            for i in ids:
                if i in data["items"]:
                    del data["items"][i]
                    n += 1
            return n
        return {"deleted": _json_update(REVIEWS_PATH, _up)}
    # 默认按 status 批量标记
    target = req.status if req.status in REVIEW_STATUSES else None
    if target is None:
        raise HTTPException(400, "批量标记需要合法 status（open/verified/falsified/expired/abandoned）")

    def _up(data):
        n = 0
        now = int(datetime.now(timezone.utc).timestamp())
        for i in ids:
            if i not in data["items"]:
                continue
            rec = data["items"][i]
            merged = _normalize_review({**rec, "status": target})
            merged["id"] = i
            merged["createdAt"] = rec.get("createdAt", 0)
            if rec.get("status", "open") == "open" and target != "open" and not rec.get("resolvedAt"):
                merged["resolvedAt"] = now
            if target == "open":
                merged["resolvedAt"] = None
            data["items"][i] = merged
            n += 1
        return n
    return {"updated": _json_update(REVIEWS_PATH, _up)}



# ---- workspaces ----

@app.get("/api/workspaces/{wid}")
def workspaces_get(wid: str):
    path = WORKSPACES_DIR / f"{wid}.json"
    if not path.exists():
        raise HTTPException(404, "workspace not found")
    return json.loads(path.read_text(encoding="utf-8"))


@app.put("/api/workspaces/{wid}")
def workspaces_put(wid: str, config: dict):
    WORKSPACES_DIR.mkdir(parents=True, exist_ok=True)
    payload = dict(config)
    payload["id"] = wid
    payload["savedAt"] = int(datetime.now(timezone.utc).timestamp())
    (WORKSPACES_DIR / f"{wid}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8000, log_level="info")
