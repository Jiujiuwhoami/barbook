# K线复盘工作台 · 前端

## 技术栈
- React + TypeScript + Vite
- KLineChart (`klinecharts`)
- lucide-react 图标
- 已连接 `backend/server.py`（FastAPI，默认 `http://127.0.0.1:8000`），数据来自本地 SQLite

## 启动
先起后端（另开终端）：
```bash
cd backend
python server.py            # 默认 http://127.0.0.1:8000，CORS 已放行 5173/8080
```
再起前端：
```bash
npm install
npm run dev                 # http://localhost:5173，经 vite 代理或直接调 8000
```

构建检查：
```bash
npm run build
```

## 当前包含
- 深色专业终端风格，支持浅色/深色主题切换
- 品种列表、搜索、品种切换
- 单图 / 双图 / 四宫格 / 六宫格布局
- 每个图表独立周期切换和品种菜单
- KLineChart K线、VOL、MACD
- 顶栏日期区间选择：「加载数据」按所选 start/end 向后端抓对应历史段入库，图表按区间过滤显示
- 绘图工具栏 + 右侧样式面板，已接入 KLineChart overlay（趋势线/水平/垂直/射线/线段/矩形/圆/箭头/文字/斐波那契/测量），画线自动保存与恢复
- 同步模式跨图十字光标、时间轴联动（独立模式不联动）
- 复盘笔记：**判断层**（策略 setup / 方向 / 入场 / 目标价 / 失效价 / 时间框架 / 判断依据）+ **结果层**（状态 open/verified/falsified/expired/abandoned、结果备注）+ 自动上下文（品种/周期/日期区间、可一键附加当前品种绘图）
- 历史记录行可点击载入编辑器修改，走 `PUT /api/reviews/{id}`（仅更新客户端实传字段，不动身份）
- 状态筛选 chips（全部 / 各状态 / 已结果）+ 待验证队列（open 且日期窗口已过的高亮提示 + 快速 ✓/✗ 标记）
- 统计条：跨已结果记录的胜率、按 setup 的胜率分布

## 注意
- 内置 overlay 的完成步数不同（如 `straightLine` 需 3 次点击），自定义工具已统一为 2 次点击。
- 画线默认保存在 `backend/data/drawings.json`；右键删除画线即调 `DELETE /api/drawings/{id}`。
