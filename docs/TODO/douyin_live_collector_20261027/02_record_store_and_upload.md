# 02 记录、身份与上报

## 记录模型

一行一个直播间会话，追加到：

```
/sdcard/Download/Operit/plugins/com.taincheng.douyin_live_collector_bundle/records.jsonl
```

字段与视频包同一套上报契约（`docs/TODO/device_automation_platform_20261008/server_api.md`），直播专属字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `content_id` | string | **直播间身份**，`room_id`，纯数字；来自短链最终页 `fromShareRoomId` |
| `content_type` | string | 固定 `"live"`；服务端可忽略，也可据此与视频分表 |
| `room_url` | string | 不单独加；`url` 就是分享短链，`content_id` 是房间 id |
| `title` | string | 固定空字符串：直播间没有可读的房间标题节点 |
| `author` | string | 分享口令里的主播名，取不到时用页面上的主播名 |
| `author_id` | string | **主播抖音号**，来自短链最终页 owner 对象的 `displayId`；2026-10-30 真机与主播主页显示的抖音号一致（牙贝恩 `70296714883`）。0.2.0 起新增，老记录没有这个字段 |
| `like_count` | number \| null | **本场点赞**（页面上「N本场点赞」）。与视频的点赞是不同口径，字段复用 |
| `comment_count` | number \| null | 直播间没有可读的评论总数，固定 `null` |
| `collect_count` | number \| null | 同上，固定 `null` |
| `viewer_count` | number \| null | 在线观众数（「N在线观众」），读不到为 `null` |
| `interaction_text` | string | 命中的原始文案，形如 `艾齿嘉口腔5735本场点赞|15在线观众` |
| `counts_at` | string | 本场点赞/在线观众的观测时间 |
| `keyword_in_title` | boolean | 主播名里是否含本次关键词 |
| `promo_hint` | boolean | 直播间页面是否出现推广类标记词，沿用视频包词表 |

`collected_at`、`idempotency_key`、`keyword`、`url`、`share_text` 与视频包一致。`source` 固定为 `douyin_live_app`：**直播必须与视频分开分类**，不能沿用视频包的 `douyin_app`；`content_type=live` 只是记录内标记，服务端按 `source` 分表时它不生效。hotgo 采集插件 v1.4.1 起在抖音域名下保留客户端声明的 `douyin_live_app`（`ResolveSource`），更早版本会按域名反查覆盖成 `douyin_app`。

## 身份与去重

- 身份 = `source` + `content_id`（服务端口径）。短码每次分享都变，不能当身份。
- 本地已在 `records.jsonl` 里的 `room_id`：**就地更新这一行**，不新增行。
  - 只有这次真的读到了 `like_count` / `viewer_count` 才覆盖对应字段；没读到的项保持原值，不能把上一次的数字清掉。
  - `author_id` 每次都会读到，直接覆盖：0.1.x 的老记录会在再次采到同一个 `room_id` 时补上，账号改了抖音号也能跟着更新。
  - 抖音号没变、两个计数也都没读到：`skippedUnusable += 1`，这一行不写、不建 outbox，避免把「什么都没看到」当成新观测上报（2026-10-28 真机确认：同一 `room_id=7701501837022743332` 第二次采到 5512 本场点赞 / 10 在线观众后，`records.jsonl` 仍是一行，`like_count` 从 5446 更新到 5512，`collected_at` 不变、`counts_at` 更新）。
  - 更新时必须换新的 `idempotency_key`：服务端按 `(device, idempotency_key)` 去重，沿用旧键会被判「已入库」而不更新；旧的 outbox 条目同步删除，避免孤儿。
- `count` 是**新增 + 更新**的总预算，不是「只算新增」；`progress.collected_total` 只累加新增。
- `stopReason` 取值 `count` / `time` / `search_exhausted`。
- 0.1.0 起就带 `content_id`，没有历史记录要迁移；0.2.0 起带 `author_id`，老记录由下一次观测补上。

## outbox

与视频包同构，只是文件目录与工具前缀不同：

- `outbox.json`：`idempotency_key → {status, attempts, last_error, updated_at}`
- 追加记录时同步建 `pending`
- flush 每批 20 条，200/202 按 `accepted`/`rejected` 逐条置状态；429 停止本轮；5xx/网络错误保持 pending 并累加尝试次数；其他 4xx 置 failed
- 状态取值 `pending` / `sent` / `failed`，failed 不自动重发

## 分片进度

`progress.json`：

```json
{
  "keyword": "口腔医院",
  "round_id": "…",
  "chunk_index": 3,
  "collected_total": 12,
  "last_url": "https://v.douyin.com/…/",
  "last_room_id": "7701255266029194047",
  "last_host": "艾齿嘉口腔",
  "last_stop_reason": "count",
  "last_chunk_started_at": "…",
  "last_chunk_finished_at": "…",
  "updated_at": "…"
}
```

`collected_total` 只统计新增（更新不计入）。换关键词开新一轮；同关键词续上一轮。

## 上报服务的注意事项

- 直播短链仍然在 `v.douyin.com`，服务端的域名白名单不用改
- 服务端按 `url` 反查出来源仍是抖音；直播记录靠 `content_type` 区分
- `like_count` 对直播是本场点赞，不是作品点赞。若服务端要做统计，建议把 `content_type` 一起入库
- `title` 为空字符串是预期值，不要按「缺字段」拒收
- `viewer_count` / `content_type` 是新增可选字段，服务端按契约应忽略不认识的字段
