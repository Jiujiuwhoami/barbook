# BarBook

BarBook：桌面端 K 线复盘与交易训练工具。多周期同步回放、逐 K 揭线回放交易、复盘笔记、画线标注、ML 样本导出。数据全部本地存储（SQLite + JSON），行情离线可用。

> 本仓库是 **BarBook 开源免费版**（功能受限，永久免费）。
> 完整 Pro 功能（回放交易训练、ML 样本导出、无限制复盘/画线、全品种全历史）见 [发行说明](RELEASE.md)。

## 功能分层

| | 开源免费版 | Pro（需激活码） |
|---|---|---|
| 多周期同步回放 | ✅ | ✅ |
| 逐 K 揭线回放交易 | ❌ | ✅ |
| 复盘笔记 | ✅（≤ 50 条） | ✅ 无限制 |
| 画线标注 | ✅（≤ 50 条） | ✅ 无限制 |
| 单品种 | ✅ | ✅ 全部品种 |
| 近 90 天历史抓取 | ✅ | ✅ 全历史 |
| 交易会话报告 / 事件验链 | ❌ | ✅ |
| ML 样本导出 / 导入 | ❌ | ✅ |
| 工作区保存 / 恢复 | ✅ | ✅ |
| 截图导出 | ✅ | ✅ |

> 限额在**服务端强制**，非前端遮罩。触顶时返回 402 并引导升级。

## 目录结构

```
backend/               Python (FastAPI) 后端：行情抓取 / K 线 / 交易 / 复盘 / 画线 / 授权
barbook-frontend/ React + Vite 前端
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

前端通过 `window.__KLINE_BASE__`（默认 `http://127.0.0.1:8000``）连接后端。

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

## 授权说明

BarBook 开源版**不含任何授权/激活逻辑**——所有功能在服务端按免费限额开放，无需激活码。

BarBook Pro（收费完整版）在本仓库基础上增加：
- P-256 ECDSA 离线激活码（`license.py` / `ecdsa_p256.py`）
- 服务端 tier 限额强制（`tiers.py`）
- Cython 防反编译（敏感模块编译为原生扩展）
- Tauri 桌面包（Rust 主程序 + PyInstaller 后端 sidecar）
- 4 平台 CI 自动构建

完整发行流程见 [RELEASE.md](RELEASE.md)。

## License

MIT — 代码开源；BarBook Pro 激活码与完整版发行权归发行方所有。
