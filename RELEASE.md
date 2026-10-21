# 发行说明（开源引流版 → Pro 完整版）

本仓库是 **BarBook** 的**开源引流版**，功能受限但永久免费，用于获取用户、收集反馈、建立社区。

## 两版关系

| | 开源引流版（本仓库） | Pro 完整版（发行方私有） |
|---|---|---|
| 代码 | 公开，MIT | 基于本仓库追加授权 + 桌面化 |
| 功能 | 免费限额内 | 全功能 |
| 激活 | 无 | P-256 ECDSA 离线激活码 |
| 分发 | 源码 + npm 构建 | 4 平台安装包 + 裸 exe |
| 收入 | 无 | Pro 激活码 |

**两者共享核心代码**：本仓库的 `backend/server.py`、`barbook-frontend/src/` 是 Pro 版的直接前身。Pro 版在此基础上增加授权体系（`license.py` / `ecdsa_p256.py` / `tiers.py`）、Cython 防反编译、Tauri 桌面包。

## Pro 版新增能力

- **P-256 ECDSA 离线激活**：码格式 `KLX2-<payload>.<sig>`，机器指纹绑定，全程离线验签。
- **服务端 tier 强制**：免费版触顶返回 402 + 升级引导，非前端遮罩，无法本地绕过。
- **防反编译**：敏感模块（签名/验签/限额）编译为原生 `.pyd`/`.so`。
- **桌面化**：Tauri Rust 主程序 + PyInstaller 后端 sidecar，4 平台 CI 自动构建。
- **后门关闭**：发行版 `release_flags.RELEASE_BUILD=True`，`KLINE_NO_TIER_ENFORCE` 失效。

## 如何从开源版升级到 Pro

1. 安装本仓库开源版，使用免费功能。
2. 触顶时服务端返回 402，弹出升级引导。
3. 向发行方购买 Pro 激活码（`KLX2-…`）。
4. 粘贴激活码 → P-256 验签通过 → 全功能解锁。

## 开发者：如何基于本仓库构建 Pro 版

见主仓库 `RELEASE.md` 的完整发行流程，包括：
- 密钥管理（`KLINE_LIC_PRIVKEY` GitHub Secret）
- 激活码签发（`backend/keygen.py`）
- Cython 编译（`backend/_cythonize.py`）
- PyInstaller spec（`backend/kline-backend.spec`）
- Tauri 构建 + 4 平台 CI（`.github/workflows/build-desktop.yml`）
