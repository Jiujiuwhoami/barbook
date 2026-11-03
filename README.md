# BarBook

BarBook：桌面端 K 线复盘与交易训练工具。多周期同步回放、逐 K 揭线回放交易、复盘笔记、画线标注、ML 样本导出。数据全部本地存储（SQLite + JSON），行情离线可用。

> 发行版：https://barbook.dpdns.org/
>
> 本仓库为 **开源版**，MIT 协议，功能有限额，永久免费。

## 功能简介

- **多周期同步回放**：主/副周期 K 线联动回放，逐 K 揭线还原交易过程
- **复盘笔记**：逐 K 标记旗标、分类标签、备注，按交易日归档
- **画线标注**：趋势线、水平线、矩形、文字等图形标注，随回放同步显现
- **交易记录**：开/平仓记录回放，自动计算盈亏与统计
- **工作区保存 / 恢复**：笔记、画线、交易整体保存为工作区快照
- **截图导出**：图表截图（PNG）导出
- **CSV 导入**：自定义 K 线数据导入本地库
- **行情抓取**：Binance 离线抓取（开源版限近 90 天，单品种）

## 使用限额（服务端强制，触顶返回 402）

- 复盘笔记 ≤ 50 条
- 画线标注 ≤ 50 条
- 单品种、近 90 天历史

## 目录结构

```
backend/               Python (FastAPI) 后端：行情抓取 / K 线 / 交易 / 复盘 / 画线
barbook-frontend/      React + Vite 前端
data/                  运行时数据目录（K 线 SQLite、复盘/交易 JSON、截图），gitignored
```

## 安装与运行

### 前置

- Python 3.11+
- Node.js 18+（构建前端用）
- 网络（首次抓取 Binance 行情数据）

### 后端

```bash
cd backend
pip install fastapi "uvicorn[standard]" python-multipart requests
python server.py
# 默认监听 8000，端口可用 KLINE_PORT 覆盖
```

### 前端

```bash
cd barbook-frontend
npm install
npm run dev          # 开发服务器，默认 5173
npm run build        # 生产构建
```

前端通过 `window.__KLINE_BASE__`（默认 `http://127.0.0.1:8000`）连接后端。

## 抓取行情数据

```bash
cd backend
python fetch_binance_data.py --symbol BTCUSDT --interval 1m --days 30
# 支持: 1m/5m/15m/30m/1h/4h/1d 等，数据写入 data/markets.db
```

## 测试

```bash
cd barbook-frontend
npm run build
# 端到端测试清单见 test.md（约 250 项，覆盖接口/UI/多视图/笔记/工作区）
# 已执行子集见 test-results.md
```

## 技术栈

| 层 | 实现 |
|---|---|
| 前端 | React 18 + TypeScript + Vite + klinecharts |
| 后端 | FastAPI + SQLite |
| 数据 | 本地存储，无后端服务依赖 |
| 构建 | Vite 生产构建 |

## License

MIT — 代码开源。
