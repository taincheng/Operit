---
repository: https://github.com/AAswordman/Operit
status: implemented (server migration pending)
For_Agent: 小红书采集补点赞/评论/收藏三个计数。存量按用户确认的 A 方案处理：不批量回填，只在正常采集再次遇到同一篇时就地更新
---

# 小红书采集：点赞 / 评论 / 收藏计数

用户反馈：生产环境的小红书采集没有点赞、评论、收藏数据。代码核对结论是小红书包**从未实现过**这三个字段
（抖音 0.5.0 有），不是回归。本次补上计数与「再次遇到就更新」。

## 旧状态

- `my-packages/xhs-collector/src/packages/xhs_collector.ts` 的 `CollectedRecord` 没有计数字段
- 详情页取链只取 `author` / `url` / `shareText` / `contentId`
- 唯一一次 HTTP 取短链分享页只解析 `noteId`，同一份响应里的 `interactInfo` 被丢掉
- 命中已采过的 `content_id` 直接 `continue`，不取链也不刷新计数

## 已确认的决定

| 项 | 决定 |
| --- | --- |
| 计数来源 | 解析 `content_id` 的那一次分享页请求里的 `interactInfo`，不抓详情页底栏 |
| 存量记录 | **A 方案**：不批量回填、不主动重取；等正常采集再次遇到同一篇时就地更新（与抖音一致） |
| 更新形态 | 一行一篇，直接覆盖三个计数与 `counts_at`，换新 `idempotency_key`，`collected_at` 不变 |
| 版本 | 包 `0.3.0` → `0.4.0`；新增字段对老服务端是可选字段，向前兼容 |

曾经实现过一个 `xhs_backfill_counts` 批量回填工具，按用户确认的 A 方案**已删除**。

## 作用域

- `my-packages/xhs-collector/src/packages/xhs_collector.ts`
- `my-packages/xhs-collector/manifest.json`
- `my-packages/README.md`
- 服务端无需改动：`hotgo` v1.3.0 已支持计数列、`counts_at` 单调更新与 `(source, content_id)` 唯一索引

## 步骤

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [01_counts_from_share_page.md](01_counts_from_share_page.md) | 分享页实测、解析规则、记录字段 | [DONE] |
| [02_in_place_update.md](02_in_place_update.md) | 再次遇到同一篇时的就地更新（A 方案） | [DONE] |
| [03_verification.md](03_verification.md) | 编译产物与真机验证记录；上报被本地服务端 v1.2.0 迁移挡住 | [DONE]（上报待迁移） |
