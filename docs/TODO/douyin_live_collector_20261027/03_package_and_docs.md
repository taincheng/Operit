# 03 包脚手架、设置页与工作流

## 包文件

从 `my-packages/douyin-collector` 同构复制，逐个改：

| 文件 | 改动 |
| --- | --- |
| `manifest.json` | 新包 ID、版本 0.1.0、子包 `douyin_live_collector`、工作流模板 |
| `tsconfig.json` | `rootDir ./src`、`outDir ./dist`、typeRoots 指向 `../../examples/types`，与视频包一致 |
| `src/main.ts` | 注册工具箱设置页「抖音直播采集设置」 |
| `src/packages/douyin_live_collector.ts` | 驱动 + 记录 + outbox，见 01/02 |
| `src/ui/config/index.ui.ts` | 上报配置页，去掉旧键迁移（新包没有历史键） |
| `resources/workflow_collect_and_upload.json` | 连续触发 → 清积压 → 采一片 → 上报 |

## 设置页

- 复用中立键 `COLLECTOR_BASE_URL` / `COLLECTOR_TOKEN`
- 页面标题「抖音直播采集设置」，自检工具改成 `douyin_live_collector:douyin_live_upload_config_check`
- 没有 `DOUYIN_` 前缀旧键可迁移，因此**不调迁移工具**，也不注册 migrate 工具
- 「从剪贴板导入」「解析并填入」逻辑与视频包一致

## 工作流模板

「连续采集抖音直播并上报」：

- 连续触发：整轮结束等 30–120 秒
- 手动触发：编辑器里「触发工作流」
- 节点：先 `douyin_live_outbox_flush` 清积压 → `douyin_live_collect_rooms`（关键词 `口腔医院`，`count=5`，`chunk_minutes=5`）→ `douyin_live_outbox_flush`
- 模板关键词是静态参数，导入后可改

## 文档改动

- `my-packages/README.md`：
  - 目录结构加第四个包
  - 工具表加 5 个 `douyin_live_*` 工具
  - 配置目录、上报配置共用键
  - 新增「直播间采集」小节：进入路径、分享入口、shell 剪贴板、50 字限制、`room_id` 身份、有观测才更新、列表到底标记
  - 修正旧结论「直播间没有分享链接面板」——2026-10-27 实测有，入口在更多面板
- `docs/TODO/device_automation_platform_20261008/02_douyin_driver.md`：在旧结论处加一条指向本计划的更正说明
- `docs/TODO/device_automation_platform_20261008/server_api.md`：补直播记录的可选字段（`content_type`、`viewer_count`）与 `like_count` 口径说明

## 不动的部分

- 不新增 Gradle 模块
- 不改宿主 App 代码
- 不改另外三个采集包

## 实现后的偏差（2026-10-28）

与初稿不同的两处，都以真机为准：

1. **剪贴板改为 shell 读取**。直播间评论框上限 50 字，口令里的 URL 在第 80 字后，粘进评论框读不全；切 Operit 读剪贴板再切回抖音会丢 `DetailActivity`（回到推荐流）。改成 `Tools.System.shell` 调 `service call clipboard`，在抖音前台直接解 Parcel 文本，不切 App。代价是本包需要「调试器（Shizuku）」权限档，另外三个包仍只需无障碍。
2. **列表遍历按布局找卡**。无障碍树里直播卡全是空 text、`clickable=false`，「直播中」角标是画出来的；初稿按角标定位的做法在真机上找不到任何卡。改成按封面 `ImageView` 的宽高（约 990 × ≥850）定位，广告横幅高度不够被排除。标签行有惯性，第一次点「直播」可能只止住滚动，改为点两次。

## 完成状态

- [x] 包脚手架、manifest、tsconfig、main.ts、设置页
- [x] 驱动：搜索 → 直播标签 → 进房 → 分享 → shell 剪贴板 → `room_id`
- [x] 记录/outbox/上传、更新语义（有观测才更新）
- [x] 工作流模板导入并真机跑通
- [x] 配置自检、批量采集、更新、列表到底、flush
- [ ] 单房间工具独立入口调用（批量已覆盖同一段代码）
- [ ] `count` / `time` 结束原因的专门验证

详见 [04_verification.md](04_verification.md)。
