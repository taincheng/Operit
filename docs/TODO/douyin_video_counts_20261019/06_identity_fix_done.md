# 06 视频身份修复：实现与验证记录（2026-10-19）

> **字段已改名**：这份记录写的时候用的字段名是抖音专用的 `aweme_id`。
> 后来按「三个采集包统一身份」的要求改成了平台中立的 `content_id`
> （抖音 aweme_id / 快手 photoId / 小红书 noteId），服务端也从 v1.2.0 中间态升到 v1.3.0。
> **现行方案与验证以 [../collector_content_identity_20261019/](../collector_content_identity_20261019/index.md) 为准**；
> 本文保留当时的过程与真机证据。

按 [05_video_identity.md](05_video_identity.md) 的方案实施完成。

## 改了什么

**客户端（`my-packages/douyin-collector`，0.3.0 → 0.4.0）**

| 改动 | 位置 |
| --- | --- |
| 新增 `resolveAwemeId`：GET 分享短链（`Tools.Net.http` 自动跟随 302），从最终页的 `rel="canonical"` 取 `aweme_id` | `douyin_collector.ts` |
| 记录新增 `aweme_id` 字段；取链后立刻解析，解析失败**如实抛错**（不退回用短码当身份） | `extractShareLinkOnDetailPage` |
| 本地去重与「更新」改成认 `aweme_id`；翻页内重复也用 `aweme_id` 判（短码每次都变，比不了） | 采集主循环 |
| 删掉 `videoIdOf`（短码身份的遗留实现） | — |

短码仍保留在 `url` / `video_id` 里当参考，只是不再当身份。

**服务端（hotgo，v1.1.0 → v1.2.0）**

| 改动 | 位置 |
| --- | --- |
| 契约新增 `aweme_id`（可选，纯数字） | `collectin/ingest.go` |
| 视频身份从 `(source, video_id)` 换成 `(source, aweme_id)`；没有 aweme_id 的记录按新行插入 | `logic/sys/ingest.go` |
| 加列 `aweme_id VARCHAR(32) NULL` + 唯一索引 `uk_collect_record_source_aweme (source, aweme_id)` | `migrate.go` / `install.sql` / `install-pg.sql` |
| **空身份必须落 NULL**：`awemeIdOrNil`，否则唯一索引会把小红书/快手的记录互相判成重复，只能入库一条 | `logic/sys/ingest.go` |
| 后台列表/详情显示「视频ID（稳定）」，支持按它筛选 | `sysin/collect.go`、`record.go`、web |

`aweme_id` 列定义只在 `collectRecordExtraColumns` 里出现一次，建表与升级补列共用，避免两条路径漂移。

## 验证

### 客户端（真机，设备 24094RAD4C）

装 0.4.0 后由工作流连跑，日志里可以直接看到解析与更新：

```
视频身份解析成功：https://v.douyin.com/7IF_bJUQyzU/ -> aweme_id=7672977497508440818
已采集第 1 条：……（aweme_id=7672977497508440818，赞 2138、评 43、藏 359）
……
已更新第 1 条：https://v.douyin.com/S2gNDLo7QVk/（aweme_id=7672977497508440818，赞 2138、评 43、藏 359）
```

同一个视频（`7672977497508440818`，就是 05 文里那个 5 短码视频）换了短码再遇到时，
**走的是「更新」而不是新增** —— 这正是 05 里的缺陷被修掉的直接证据。

### 服务端（v1.2.0 逻辑 + 真实 MySQL）

本机 Docker 里的 MySQL 起了一份**克隆库 + 独立端口（8011）**的实例来验，不动正在跑的开发服务器：

| 场景 | 期望 | 实测 |
| --- | --- | --- |
| ① 首次观测 | 插入 1 行 | ✔ |
| ② 同 `aweme_id`、换短码、更晚的观测 | 仍 1 行，计数更新 | ✔ 1 行，`like_count=200`，`video_id` 仍是首次那个 |
| ③ 更早的观测晚到（乱序） | 计数不回退 | ✔ 保持 200 / 08:00 |
| ④ 两条没有 `aweme_id` 的记录（小红书式） | 各占一行 | ✔ 2 行 |
| ⑤ `aweme_id` 非数字 | `rejected: invalid_payload` | ✔ |

### 迁移的 DDL 语义（临时库内验证后删除）

| 断言 | 实测 |
| --- | --- |
| 多行 `aweme_id = NULL` 可以并存 | ✔ 3 行 |
| 同 `(source, aweme_id)` 被挡下 | ✔ `Duplicate entry ... for key uk_collect_record_source_aweme` |
| 条件更新拒绝更早的观测 | ✔ |

**v1.2.0 的迁移不需要预检重复行**：新列对既有数据全是 NULL，而 SQL 唯一索引不约束并列的 NULL，
所以线上重复数据再多也不会让 `(source, aweme_id)` 建不起来。

## 遗留：正在跑的开发服务器是旧构建

验证过程中发现 `gf run`（pid 36675）当前跑的进程**没有** v1.2.0 的 ingest：
同一个 `aweme_id` 落了两行、且 `aweme_id` 列写成 NULL。同一次升级里 `migrate.go` 的
建列建索引却生效了（15:34 的日志），所以那个进程只带了部分改动。

需要做的：**重新构建并重启开发服务器**（`gf run` 会热重载，但这次没生效），
再让客户端跑一轮即可端到端闭环。客户端侧不需要再改。

在这之前，设备往这个服务器上报的记录里 `aweme_id` 会落 NULL —— 那批记录按「没有身份」处理，
会产生重复行（不丢数据，但要在服务端重启后按 05 文的说明合并）。

## 设备与环境的当前状态

- 工作流「抖音采集与上报（连续采集测试）」**已禁用**（用宿主 `disable_workflow` 工具停的，不依赖界面）
- 设备的 `COLLECTOR_BASE_URL` 是 `http://localhost:8001`（你自己改的本地联调地址），
  我补了 `adb reverse tcp:8001 tcp:8001` 让设备能连到本机的 vite 代理
- 屏幕常亮设置已恢复默认
- `records.jsonl` 现在是「旧行（无 `aweme_id`）+ 新行（有 `aweme_id`）」混合：
  旧行不参与去重（拿不到身份就不猜），新行从下一次遇到开始走更新
