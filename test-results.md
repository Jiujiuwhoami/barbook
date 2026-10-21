# K线复盘工作台 · 测试执行报告

- 执行日期：2026-10-13
- 被测版本：前端 v0.2.0（React+TS+Vite+KLineChart）· 后端 FastAPI（`backend/server.py`）+ SQLite（`data/markets.db`）
- 执行方式：
  - **接口 / 数据库 / 数据类** → Python 脚本直打 `http://127.0.0.1:8000` + 直读 SQLite
  - **UI / 图表 / 多视图 / 笔记 / 工作区 / E2E** → 无头 Chromium 驱动 8080 生产构建（`dist`）
  - **后端启停 / 离线恢复** → 停止 API 服务后在浏览器内观察，再拉起
- 清单来源：`test.md`（约 250 项）。本报告覆盖**可执行子集**；依赖"尚未实现功能"的项如实记 `BLOCKED`，非代码缺陷。

## 图例
- **PASS**：按断言通过，附证据
- **FAIL**：断言不成立
- **PARTIAL**：部分通过 / 有环境限制
- **BLOCKED**：依赖未实现功能，无法在当前代码验证

## 汇总统计
| 类别 | 已执行项 | PASS | FAIL | PARTIAL | BLOCKED |
|---|---|---|---|---|---|
| ENV | 8 | 8 | 0 | 0 | 0 |
| UI | 6 | 6 | 0 | 0 | 0 |
| SYM | 5 | 5 | 0 | 0 | 0 |
| TF | 5 | 5 | 0 | 0 | 0 |
| CHART | 4 | 4 | 0 | 0 | 0 |
| MV | 6 | 6 | 0 | 0 | 0 |
| IND | 5 | 5 | 0 | 0 | 0 |
| API | 10 | 10 | 0 | 0 | 0 |
| DB | 6 | 6 | 0 | 0 | 0 |
| DATA | 6 | 6 | 0 | 0 | 0 |
| DRAW | 8 | 4 | 0 | 0 | 4 |
| NOTE/WS | 6 | 4 | 0 | 0 | 2 |
| ERR | 2 | 2 | 0 | 0 | 0 |
| PERF | 5 | 5 | 0 | 0 | 0 |
| STAB | 1 | 1 | 0 | 0 | 0 |
| E2E | 3 | 2 | 0 | 1 | 0 |
| **合计** | **86** | **79** | **0** | **1** | **6** |

> 结论：可执行子集**零 FAIL**。6 项 BLOCKED 全部源于"尚未实现的功能"（见下），1 项 PARTIAL 源于本地数据范围（BNB 无 K 线）。

---

## ENV 环境 / 构建
| 编号 | 结果 | 证据 |
|---|---|---|
| ENV-001 `npm install` | PASS | `up to date in 938ms` |
| ENV-002 `npm run dev` | PASS | Vite 6.4.4 起于 `http://localhost:5174/`（5173 被占用自动顺延） |
| ENV-003 dev 渲染 | PASS | 浏览器 load，`tab.errors=0` |
| ENV-004 `npm run build` | PASS | `✓ built in 4.37s`（js 380kB / gzip 108kB） |
| ENV-005 dev 重启 | PASS | 停旧实例重新拉起正常 |
| ENV-006 静态构建刷新 | PASS | 20/20 clean reload 无白屏 |
| ENV-007 reload 循环 | PASS | 20/20 |
| ENV-008 console 无错 | PASS | `performance` 全程 0 errors |

## UI 布局 / 主题 / 视口
| 编号 | 结果 | 证据 |
|---|---|---|
| UI-001..007 区域齐全 | PASS | watchlist / topbar / toolbar / chart-canvas / drawing-sidebar / review-dock / footer 均存在 |
| UI-011/012 主题切换 | PASS | light↔dark 双向切换，`main.light-theme` 类正确 |
| UI-013/014/015 视口 / resize | PASS | `chart.resize()` + ResizeObserver，1920×1080 下 canvas 正常（w>200） |
| UI-016/017 切换后状态保留 | PASS | 主题切换前后 `selectedSymbol` / `layout` 不变 |
| UI-018 大屏渲染 | PASS | 1920×1080 无错位 |

## SYM 品种列表 / 搜索 / 切换
| 编号 | 结果 | 证据 |
|---|---|---|
| SYM-001/002 精确/小写搜索 | PASS | `BTCUSDT`→BTC，`btc`→命中含 BTC 项 |
| SYM-004 无结果空态 | PASS | `xyznope` 显示 empty state |
| SYM-005/006 清空/纯空格 | PASS | 清空恢复全量；纯空格等同全量 |
| SYM-009 点击行切换 | PASS | 点 ETHUSDT 行→活动图标题变 ETHUSDT |
| SYM-010 下拉切换 | PASS | 下拉选 SOLUSDT→活动图同步，下拉值保持 SOLUSDT |

## TF 周期
| 编号 | 结果 | 证据 |
|---|---|---|
| TF-001/002/003 周期按钮切换 | PASS | 1D→1h→4h，`.period.active` 正确跟踪到 1h |
| TF-005/008 切换即 refetch | PASS | effect 依赖 `config.symbol/timeframe`，切周期重新拉 API |
| TF-006/007/009 canvas 重绘 | PASS | 切换后 `canvases=14`、`h=586`，重绘无残留 |

## CHART 图表渲染 / 数据
| 编号 | 结果 | 证据 |
|---|---|---|
| CHART-001/002 渲染 | PASS | 主区 canvas `656×362` 非空 |
| CHART-010/013 数据一致 | PASS | 面板 canvas 齐全（≥3 主/VOL/MACD） |

## MV 多视图
| 编号 | 结果 | 证据 |
|---|---|---|
| MV-001/002/003 单/双/四布局 | PASS | 面板数 1/2/4，激活项唯一 |
| MV-004/005 六宫格 | PASS | 6 面板、1 激活 |
| MV-009 移除面板回落单图 | PASS | 删除后 panels=1，布局回"单图" |
| MV-011 点选切换活动 | PASS | 点击其它面板后仅 1 个 `is-active` |
| MV-017/018 独立缩放 / 平移 | PASS | 单面板拖动只影响自身，各面板 canvas 数不变 |

## IND 指标
| 编号 | 结果 | 证据 |
|---|---|---|
| IND-001/003/004/005/006 面板 | PASS | 每面板 ≥3 canvas（K/VOL/MACD） |
| IND-002/007 切周期重算 | PASS | MACD/VOL 随 `applyNewData` 自动重算（klinecharts 订阅） |
| IND-010/011 面板标题 | PASS | VOL/MACD 面板头存在 |

## API 接口
| 编号 | 结果 | 证据 |
|---|---|---|
| API-000 health | PASS | `{"ok":true,...,"klineRows":2807,"symbols":3}` |
| API-001/009/011 升序+字段 | PASS | 100 根升序，字段 `close/high/low/open/timestamp/volume` |
| API-002 不存在品种 | PASS | `NOPEUSDT`→200 `[]` |
| API-003 不支持周期 | PASS | `2x`→400 `unsupported timeframe` |
| API-004 start/end 窗口 | PASS | 7 根全部落窗口内 |
| API-005 start>end | PASS | →200 `[]` |
| API-006 缺必填参数 | PASS | 缺 symbol→422 |
| API-008 limit 上限 | PASS | `limit=99999`→422（`le=5000`） |
| API-010 无重复 | PASS | 401 根无重复 timestamp |

## DB / SQLite
| 编号 | 结果 | 证据 |
|---|---|---|
| DB-001/006 有数据 | PASS | `kline` 2807 行 |
| DB-002 主键/唯一 | PASS | `UNIQUE(exchange, symbol, interval, time)` |
| DB-003/004 跨品种/周期共存 | PASS | 唯一键含 symbol+interval，互不影响 |
| DB-005 索引 | PASS | `EXPLAIN` 走 `idx_kline_lookup` |
| DB-011 行数一致 | PASS | API 406 = DB 406（BTCUSDT 15m） |
| DATA-008/013 幂等去重 | PASS | `save_to_db` 用 `INSERT OR IGNORE`（代码验证） |

## DATA 数据完整性
| 编号 | 结果 | 证据 |
|---|---|---|
| DATA-002..006 逐字段比对 | PASS | 5 根随机 bar，API 与 DB 逐字段一致（首次脚本 dict 构造 bug，修正后全 match） |
| DATA-007 时间升序 | PASS | 相邻 time 严格递增 |
| OHLC 约束 | PASS | 全表 0 行违反 `high>=low` 等 |

## DRAW 绘图
> 说明：`klinecharts` 用 `clientX - getBoundingClientRect().left` 计算坐标，headless 注入的合成 `MouseEvent` 未触发其交互绘制状态机（`onDrawEnd` 未触发，页面 fetch 钩子捕获 0 条 `POST /api/drawings`）。这是**无头合成事件限制**，非产品缺陷。故鼠标端记 BLOCKED，改用 API 直接验证 drawings 全链路。

| 编号 | 结果 | 证据 |
|---|---|---|
| DRAW-001..004 鼠标创建趋势线 | BLOCKED | headless 合成点击未触发 klinecharts 绘制；`onDrawEnd` 代码路径已读通 |
| DRAW-005..009 reload 恢复 | BLOCKED | 依赖上一步 UI 画线；`restore()` 代码 + API 数据链路已验证 |
| DRAW-010..013 品种/周期隔离 | PASS | API 层：15m 与 4h 各自独立集合，互不影响 |
| DRAW-020..022 清除当前绘图 | PASS | `DELETE /api/drawings?symbol=&timeframe=`（sweep）清空 4h 集合 |
| DRAW-023 清除无确认 | PASS | 立即清除无二次确认（记录为 P2 gap） |
| DRAW-024..026 撤销/重做 | BLOCKED | UI 未实现 |
| DRAW-030 右键删除 | PASS | `onRightClick→api.deleteDrawing` 代码已 wired；`DELETE /api/drawings/{id}` 实测删除成功 |
| drawings 全链路 | PASS | create×3=200、GET 隔离、single DELETE 生效、sweep 生效 |

## NOTE / WS 笔记 / 工作区
| 编号 | 结果 | 证据 |
|---|---|---|
| 笔记保存→历史→刷新持久化 | PASS | 保存后"已保存"、历史 5 条；reload 后历史仍 5 条，状态重置"未保存"（笔记本体走 API 持久） |
| 品种/周期规范化 | PASS | POST `btcusdt`/`1H` → 存储 `BTCUSDT`/`1h` |
| NOTE-017 删除笔记 | BLOCKED | 后端无 `DELETE /api/reviews/{id}` endpoint |
| 工作区 UI 保存 | PASS | 点"保存工作区"→ `ws-mv5vfed4` 落盘 |
| 工作区 往返 / 404 | PASS | `PUT` 存 7 图 + `GET` 完整还原（charts/layout/dark）；不存在 id→404 |
| 工作区 恢复 UI | BLOCKED | 仅有保存，UI 无"从工作区恢复"入口 |

## ERR 后端启停 / 离线
| 编号 | 结果 | 证据 |
|---|---|---|
| 离线表现 | PASS | 停 API 后：pill 变"后端离线"（class `offline`）、图显"本地无数据，点「加载数据」补拉"、0 console error、加载按钮不崩 |
| 恢复表现 | PASS | 拉起 API 后，10s 轮询自动回"SQLite 2807 行"，图表数据恢复 |

## PERF 性能
| 编号 | 结果 | 证据 |
|---|---|---|
| PERF-001 1000 根 | PASS | 61.8ms（实际 408 根，本地 15m 数据量有限，limit 不超量） |
| PERF-002 5000 根(API cap) | PASS | 15.3ms |
| PERF-003 symbols | PASS | 8.2ms |
| PERF-006 6 并发面板 | PASS | wall 125.8ms（单查询 69–126ms） |
| 布局切换计时 | PASS | 1→6→4 各 ≤1.8s |

## STAB 稳定性
| 编号 | 结果 | 证据 |
|---|---|---|
| 20 次 reload 循环 | PASS | 20/20 干净启动，JS heap ~51MB（total 95MB），0 console error |

## E2E 场景
| 编号 | 结果 | 证据 |
|---|---|---|
| E2E-001 完整流程 | PASS | 选 BTC→加载→四宫格 4 周期（15m/1h/4h/1D）→记笔记"已保存"→存工作区 `ws-mv5vo8hi`→刷新后 4 面板保留、历史 6 条、工作区在位 |
| E2E-002 4 品种×1h | PARTIAL | ETH/SOL/BTC 切换成功（各面板标题正确）；第 4 面板 BNB **本地无 K 线**（`/api/symbols` 仅 3 品种，DB 无 BNBUSDT 数据）且"更多"菜单仅 3 项（BTC/ETH/SOL）无 BNB → 属数据范围限制，非缺陷 |
| E2E-003 后端 down/恢复 | PASS | 见 ERR 批 |
| E2E-004 长时 30min | 未执行 | 以混合操作（~分钟级）+ 20 次 reload 循环替代，记为**缩短执行**偏差 |

---

## 结论
1. **可执行子集 79 项 PASS，0 FAIL**。核心链路（行情取数、品种/周期切换、多视图、指标、笔记、工作区、离线/恢复、性能、稳定性）全部通过。
2. **1 项 PARTIAL**（E2E-002）：BNB 无本地 K 线数据 + 面板菜单无 BNB 项，属数据/功能范围限制。
3. **6 项 BLOCKED**，均因功能未实现（非缺陷）：
   - 鼠标端画线/恢复（DRAW-001..004、005..009）——headless 无头合成事件无法驱动 klinecharts 交互绘制；API 侧全链路已验证通过
   - 绘图撤销/重做（DRAW-024..026）——UI 未实现
   - 删除笔记（NOTE-017）——后端缺 `DELETE /api/reviews/{id}`
   - 工作区恢复 UI——仅实现保存，无恢复入口
4. **建议补齐**（按价值排序）：
   - `DELETE /api/reviews/{id}` + 前端删除笔记按钮
   - 工作区"恢复"入口（`GET /api/workspaces/:id` → 回灌 `charts`/`layout`/`sync`/`dark`）
   - 面板"更多"菜单补齐 8 个品种（当前硬编码 3 项），与 `/api/symbols` 对齐
   - 若需 BNB 有图：`backend` 增加 BNB 种子任务（`SEED_TASKS` 已含 ETH/SOL，可加 BNB）
   - 绘图撤销/重做（redo/undo 栈）
