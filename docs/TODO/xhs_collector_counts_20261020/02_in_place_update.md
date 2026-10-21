# 02 再次遇到同一篇：就地更新（A 方案）

## 决定

用户确认：存量记录按 **A 方案**处理——**不做一次性批量回填**，不主动重取旧记录。
旧记录等正常采集再次遇到同一篇笔记时补上计数，与抖音 0.5.0 的行为一致。

之前实现过的 `xhs_backfill_counts(limit)` 已删除：它要逐条重取几百个短链，在手机上串行跑很慢，
而且与抖音的补数方式不一致。

## 更新逻辑

`xhs_collect_share_links` 主循环里，取链并解析出 `content_id` 之后：

| 情况 | 动作 |
| --- | --- |
| `content_id` 不在库里 | 新增一行，写三个计数、`counts_at`、`interaction_text` |
| `content_id` 已在库里 | `updateRecordCounts` 就地改那一行，不新增 |

`updateRecordCounts(outbox, records, index, identity)`：

| 字段 | 动作 |
| --- | --- |
| `like_count` / `comment_count` / `collect_count` | 换成这次观测值 |
| `interaction_text` / `counts_at` | 换成这次的 |
| `idempotency_key` | **换新**；沿用旧键会被服务端 `(device, idempotency_key)` 判成已入库，计数完全不更新 |
| `collected_at` | 不动（首次采集时间） |
| `content_id` | 为空时补上（0.3.0 之前的行） |
| outbox | 删掉旧键条目，新键置 `pending` |

写 records 用「同目录临时文件 + `Tools.Files.move` 原子替换」：直接覆盖可能留下半截文件，
而 `loadRecords` 遇到坏行直接抛错，整个采集会瘫掉。

## 对存量数据的影响

- 0.4.0 之前的记录没有三个字段，**不会**自动补；只有再次采到同一篇时才会带上计数
- 这类老行大多也没有 `content_id`，它们本身不参与去重，所以不会被「认出」；实际能补上的，
  是 0.3.0 之后带 `content_id` 的行再次被采到时
- 不提供任何「按 url 遍历历史记录」的入口，避免在手机上串行重取几百个短链

## 服务端

`hotgo` v1.3.0 已支持：

- 收三个计数、`counts_at`、`interaction_text`（都可选）
- 按 `(source, content_id)` 找同一行，`counts_at` 单调更新
- 老行没有 `content_id` 时，`(source, video_id)` 唯一键还能靠短链认到同一行

客户端换新 `idempotency_key` 后，服务端把它当成同一内容的新观测，更新计数而不新增行。
