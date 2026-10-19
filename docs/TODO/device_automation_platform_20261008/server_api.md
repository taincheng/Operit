---
For_Agent: 这是给服务端开发的接口契约文档，实现方是外部服务端，客户端固定
---

# 采集上报服务端接口

这份文档是客户端与服务端之间的唯一契约。客户端已经实现并按本文验证通过，服务端按本文实现即可对接。

- 客户端：Operit 的抖音采集包，源码在 `my-packages/douyin-collector/src/packages/douyin_collector.ts`
- 契约原始出处与逐条验证记录：[03_record_store_and_outbox.md](03_record_store_and_outbox.md)
- 参考实现：[mock_server.py](mock_server.py)，五种响应行为的可运行样例

## 传输

| 项 | 值 |
| --- | --- |
| 方法 | POST |
| 路径 | `{base_url}/api/v1/records` |
| Content-Type | `application/json; charset=utf-8` |
| 鉴权 | `Authorization: Bearer <token>` |
| 请求体编码 | UTF-8 |
| 客户端超时 | connect 15 秒，read 30 秒 |
| 批量条数 | 默认每批 20 条，客户端按此切批 |
| 响应体编码 | UTF-8 |

`base_url` 与 `token` 在客户端 App 里配置，入口是

```
工具箱 → 抖音采集设置
```

两个值存在宿主的环境变量里（App 私有存储），键名是 `COLLECTOR_BASE_URL` 与 `COLLECTOR_TOKEN`（三个采集包共用这一组中立键），不落外部存储文件。

服务端不需要提供配置文件下载或注册接口，令牌由使用者手工填入。服务端可以提供一个无副作用的探测响应：客户端自检会故意发一个空批次，期望被参数校验拒绝（例如 400 且消息指向 items 条数），以此证明鉴权已通过。

## 请求体

```json
{
  "batch_id": "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
  "client": {
    "device": "24094RAD4C",
    "app_version": "1.12.2"
  },
  "items": [
    {
      "idempotency_key": "1aae5ff1-7c2b-4d3e-9f10-2b3c4d5e6f70",
      "keyword": "food",
      "url": "https://v.douyin.com/en5gCdCXuLw/",
      "share_text": "5.30 复制打开抖音，看看【前进要暴富的作品】沉浸式体验｜深圳很火的need韩国料理 https://v.douyin.com/en5gCdCXuLw/ abc:/ 02/23",
      "title": "沉浸式体验｜深圳很火的need韩国料理📝",
      "author": "前进要暴富",
      "collected_at": "2026-10-09T01:22:52.474Z",
      "source": "douyin_app",
      "keyword_in_title": true,
      "promo_hint": false,
      "like_count": 414000,
      "comment_count": 7353,
      "collect_count": 71000,
      "content_id": "7672977497508440818",
      "counts_at": "2026-10-19T03:30:00.000Z",
      "interaction_text": "未点赞，喜欢41.4万，按钮|评论7353，按钮|未选中，收藏7.1万，按钮"
    }
  ]
}
```

字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `batch_id` | string | 是 | 本批的 UUID，只用于日志关联。重发时是新值，不要用它去重 |
| `client.device` | string | 是 | 设备型号，多设备区分靠它 |
| `client.app_version` | string | 是 | 客户端版本。当前可能为空字符串，服务端要容忍 |
| `items` | array | 是 | 本批记录，1 到 20 条，客户端不发送空数组 |
| `items[].idempotency_key` | string | 是 | UUID，**这一条上报**的去重键。同一条上报重发时保持不变；同一个视频再次被采到时它是**新的**，见「同一视频的多次观测」 |
| `items[].keyword` | string | 是 | 采集时使用的搜索主题 |
| `items[].url` | string | 是 | 从分享口令中抽出的抖音短链 |
| `items[].share_text` | string | 是 | 分享面板产生的原文，含口令文案 |
| `items[].title` | string | 是 | 由客户端从分享口令解析，可能为空字符串 |
| `items[].author` | string | 是 | 同上，可能为空字符串 |
| `items[].collected_at` | string | 是 | ISO8601，当前是 UTC，以 Z 结尾。**首次采集到这个视频的时间**，同一个视频再次被采到时不变 |
| `items[].source` | string | 是 | 客户端自报的来源。服务端不必采信，来源以 `url` 域名反查为准 |
| `items[].keyword_in_title` | boolean | 是 | 标题或话题里是否出现本次搜索关键词。**只作标记**：实测主题相符的视频里只有约一半标题含关键词，不要用它单独丢弃数据 |
| `items[].promo_hint` | boolean | 是 | 详情页上是否出现推广类标记词（广告、团购、优惠券、立即购买、门店、直播中等）。同样是标记而非判据，评论区出现这些词也会命中 |
| `items[].like_count` | number \| null | 否 | 点赞数。**可选**：老客户端与小红书/快手包不发送。缺失或 `null` 表示这次没有观测到该计数，**不等于 0** |
| `items[].comment_count` | number \| null | 否 | 评论数，同上 |
| `items[].collect_count` | number \| null | 否 | 收藏数，同上 |
| `items[].content_id` | string | 否 | **内容在该平台上的真实身份**，各来源自己去解析（抖音 `aweme_id`、快手 `photoId`、小红书 `noteId`）。客户端从分享短链跳转后的页面里取，`[A-Za-z0-9_-]{1,64}`。**可选**：老客户端不发；缺失时服务端不做同内容判定（按新行插入） |
| `items[].counts_at` | string | 条件必填 | 这三个计数是哪一刻观测到的，ISO8601。**带了任何一个计数就必须带它**；一个计数都不带时可以不带 |
| `items[].interaction_text` | string | 否 | 命中的互动条原始 `content-desc` 文本（形如 `未点赞，喜欢41.4万，按钮|评论7353，按钮`）。计数在页面上会被缩写成「41.4万」，折成整数有损，留一份原文供回查 |

约定

- 除三个计数与 `interaction_text` 标了可选外，其余字段都会出现，不会缺失，空值以空字符串表示
- 三个计数是**数值**而不是字符串。客户端读不到时该字段缺失或为 `null`，服务端必须当成「没有观测到」，
  **不能当成 0**：0 是「确实一个赞都没有」，两者在库里必须能区分（建议存可空列）
- 服务端应忽略不认识的字段，便于客户端前向演进
- 客户端不再根据内容做过滤，相关性与推广判断都由服务端决定。建议先用这两个标记统计分布（例如商业标记命中率），确认判据准确后再决定是否丢弃
- 同一条记录重发时除 `batch_id` 外的内容不变

## 响应体

```json
{
  "accepted": ["1aae5ff1-7c2b-4d3e-9f10-2b3c4d5e6f70"],
  "rejected": [
    { "key": "2b3c4d5e-6f70-4a1b-8c2d-3e4f5a6b7c80", "reason": "duplicate" }
  ]
}
```

规则

- 两个数组都是幂等键的列表，`rejected` 的元素带 `reason`
- 允许一批内部分成功，这正是设计目的
- 每个请求里的键都应当落在两个数组之一。两边都没提到时客户端会保持 `pending` 并在下一轮重发，服务端若是漏写就等于制造重复请求
- 200 与 202 都表示已处理，两者对客户端等价
- `reason` 建议取值：`duplicate`、`invalid_url`、`invalid_payload`、`storage_unavailable`。客户端会把 `reason` 写进本地 `last_error` 供排查，取值本身不影响状态判定

## 状态码语义

客户端只看 `statusCode` 决定状态，服务端返回什么，客户端就做什么。

| 服务端返回 | 客户端行为 |
| --- | --- |
| 200 或 202 且响应体可解析 | 按 `accepted` 置 `sent`，按 `rejected` 置 `failed` |
| 200 或 202 但响应体无法解析 | 整批置 `failed` 并记录原始响应片段 |
| 429 | 整批保持 `pending`，本轮停止发送后续批次，读取 `Retry-After` |
| 5xx | 整批保持 `pending`，尝试次数加一，下一轮重发 |
| 其他 4xx | 整批置 `failed`，不再自动重试 |
| 无响应，连接失败或超时 | 整批保持 `pending`，尝试次数加一，下一轮重发 |

因此有两条硬约束

- 服务端自身的故障只能返回 5xx，不要用 4xx。4xx 会让整批记录永久置为失败
- 业务校验失败不要返回 4xx，而是把该条放进 `rejected` 并给出 `reason`。返回 4xx 会连累同批的其他记录

## 幂等与去重

这是服务端唯一不能省的逻辑。

- 服务端必须按 `idempotency_key` 去重，重复请求不得重复入库
- 建议加唯一索引，键取 `(device, idempotency_key)`
- 重复时返回 `accepted` 或 `rejected` 都可以，客户端两种都能正确处理。推荐返回 `accepted`，语义是「该记录已在库中」
- 客户端不保证不重发，这是设计前提而不是异常。同一个 `idempotency_key` 可能因为超时、5xx、限流而重复到达
- 整批重发时 `batch_id` 会变，同一批内容会再现
- **`idempotency_key` 是「这一条上报」的身份，不是「这个视频」的身份**。同一视频再次被采到时它是新的，
  服务端要靠 `content_id` 认出它并更新那一行，见下一节

## 同一视频的多次观测

抖音视频的点赞/评论/收藏一直在变，客户端再次采到同一个视频时会重新读数并上报一条**新 `idempotency_key`** 的记录。
服务端要按视频身份把计数更新到同一行，而不是新增一行。

- **内容身份 = `source` + `content_id`**（`source` 由域名反查得到，不看客户端填的 `source`）。
  身份里**不含 `device`**：三个计数是视频的属性而不是设备的属性，换台设备采到同一个视频也应当更新同一行；
  行上的 `device` 保留首次采到它的那台设备
- **不要拿 `url` 里的短码当内容身份**：抖音与快手每次「分享链接」都会生成一个新的短码，
  同一个视频采两次就是两个不同的短码（2026-10-19 实测：同一视频 27 分钟内 5 个不同短码，
  470 条记录里只有 98 个不同的视频；快手 562 条里只有 153 个）。`content_id` 才是稳定的那个
- 客户端**没有**给 `content_id` 时（老客户端），服务端无法判断是不是同一个内容，
  按新行插入，不做任何猜测
- **首次观测**：插入一行，带上三个计数与 `counts_at`
- **再次观测**：更新那一行的三个计数、`counts_at` 与 `interaction_text`，**不新增行**。
  首次采集信息（`collected_at`、`device`、`idempotency_key`、`keyword`、`batch_id`、`title`、`author`）保持不变
- **计数单调**：只接受比库里 `counts_at` 更新的观测。契约明确同一条上报可能因超时重复到达，
  一个更早的观测晚到时**不得**把计数改回旧值。用一条带条件的 UPDATE
  （`WHERE counts_at IS NULL OR counts_at < ?`）实现最省事，也不需要事务与行锁
- **缺失的计数不写**：某次观测里某个计数缺失（老客户端、或页面没显示）时，不要写这一列，
  否则会把已经采到的计数清成 0
- 响应与普通上报完全一致：更新成功也返回 `accepted`。客户端不区分「新增」与「更新」


## 服务端校验

建议逐条校验，失败进 `rejected`

| 校验 | 失败 reason |
| --- | --- |
| `idempotency_key` 非空 | `invalid_payload` |
| `url` 能被解析且域名属于 `v.douyin.com` | `invalid_url` |
| `collected_at` 可解析为时间 | `invalid_payload` |
| 计数若存在必须 `>= 0` | `invalid_payload` |
| `content_id` 若存在必须匹配 `[A-Za-z0-9_-]{1,64}` | `invalid_payload` |
| 带了任一计数时必须带可解析的 `counts_at` | `invalid_payload` |
| 落库失败 | `storage_unavailable` |

`share_text`、`title`、`author` 允许为空，不要因为空值拒绝整条记录。
三个计数与 `counts_at` 都是可选字段：老客户端与小红书/快手包根本不发，**缺失不是错误**。

## 重试与节奏

- 客户端只重发 `pending`，`failed` 不自动重试
- 重发由客户端的工作流周期驱动，建议 15 分钟一轮
- 尝试次数与最后一次错误由客户端记录在本地 `outbox.json`，服务端不需要维护
- 服务端不需要实现推送、长连接或回调

## 存储建议

字段与请求体一一对应即可，另加两列

| 列 | 说明 |
| --- | --- |
| `received_at` | 服务端接收时间，便于排查时序 |
| `batch_id` | 记录本批标识，便于按批回溯 |

建议

- 唯一索引 `(device, idempotency_key)`：同一条上报重发只入库一次
- 唯一索引 `(source, content_id)`：**一个内容只有一行，靠的是这一条**
- 唯一索引 `(source, video_id)`：短链层面的重复（可留可不留）。注意它约束的是短码，不是视频
- `content_id` 列必须**可空**：没有权威身份的记录要落 NULL。若落成空串，
  唯一索引会把它们互相判成重复，这类记录只能入库一条（SQL 的唯一索引允许并列多个 NULL）
- 从 `url` 的路径段抽出短链码另存一列，例如 `en5gCdCXuLw`
- 三个计数存**可空**列；另加一列 `counts_at`（计数的观测时间），与 `collected_at`（首次采集时间）区分开
- 按 `collected_at` 建索引，便于按采集时间取数

加 `(source, video_id)` 唯一索引之前先预检历史数据（有重复行时索引建不起来）：

```sql
SELECT source, video_id, COUNT(*) c FROM hg_addon_collect_record
GROUP BY source, video_id HAVING c > 1;
```

## 实现检查清单

- [ ] 校验 `Authorization: Bearer <token>`，失败返回 401
- [ ] 请求体解析失败返回 400，这属于客户端契约错误，可以整批失败
- [ ] 逐条校验，失败进 `rejected`，不要整批 4xx
- [ ] 按 `(device, idempotency_key)` 去重
- [ ] 按 `(source, content_id)` 认出同一个内容：再次观测更新计数，不新增行；
      没有 `content_id` 的记录按新行插入（不要用短码代替身份）
- [ ] 计数缺失时不写该列，绝不当成 0
- [ ] 只接受比库里 `counts_at` 更新的观测，避免超时重发把计数改回旧值
- [ ] 返回 `accepted` 与 `rejected` 两个数组
- [ ] 限流返回 429 并带 `Retry-After`，单位秒
- [ ] 只在真正故障时返回 5xx
- [ ] 日志记录 `batch_id`、`device`、接收条数、去重条数

## 联调方法

用仓库里的参考实现对齐行为

```bash
python3 docs/TODO/device_automation_platform_20261008/mock_server.py
adb reverse tcp:8765 tcp:8765
```

然后在「工具箱 → 抖音采集设置」里把地址填成 `http://127.0.0.1:8765` 并保存，再从包详情运行 `douyin_outbox_flush`。行为切换靠 `/tmp/douyin_mock_mode.txt`，取值 `accepted`、`partial`、`error500`、`error400`、`throttle`。

客户端侧观察

- `/sdcard/Download/Operit/plugins/com.taincheng.douyin_collector_bundle/records.jsonl`，采集到的记录
- 同目录 `outbox.json`，每条的状态与尝试次数

## curl 示例

全部接受

```bash
curl -X POST https://your-server.example.com/api/v1/records \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "Authorization: Bearer 你的令牌" \
  -d '{"batch_id":"b1","client":{"device":"24094RAD4C","app_version":"1.12.2"},"items":[{"idempotency_key":"k1","keyword":"food","url":"https://v.douyin.com/en5gCdCXuLw/","share_text":"...","title":"标题","author":"作者","collected_at":"2026-10-09T01:22:52.474Z","source":"douyin_app","content_id":"7672977497508440818","like_count":414000,"comment_count":7353,"collect_count":71000,"counts_at":"2026-10-19T03:30:00Z","interaction_text":"未点赞，喜欢41.4万，按钮"}]}'
```

期望响应

```json
{"accepted":["k1"],"rejected":[]}
```

同一个视频的第二次观测（换一条链接的查询参数、换新的幂等键）：仍然返回 `accepted`，但库里那一行不增加，
只有三个计数与 `counts_at` 被更新。

```bash
curl -X POST https://your-server.example.com/api/v1/records \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "Authorization: Bearer 你的令牌" \
  -d '{"batch_id":"b2","client":{"device":"24094RAD4C","app_version":"1.12.2"},"items":[{"idempotency_key":"k2","keyword":"food","url":"https://v.douyin.com/en5gCdCXuLw/","share_text":"...","title":"标题","author":"作者","collected_at":"2026-10-09T01:22:52.474Z","source":"douyin_app","content_id":"7672977497508440818","like_count":415100,"comment_count":7410,"collect_count":71200,"counts_at":"2026-10-19T09:30:00Z","interaction_text":"未点赞，喜欢41.5万，按钮"}]}'
```

部分拒绝

```json
{"accepted":["k1"],"rejected":[{"key":"k2","reason":"invalid_url"}]}
```

限流

```
HTTP/1.1 429 Too Many Requests
Retry-After: 120
```

## 兼容性与演进

- 新增字段时，服务端应忽略未知字段
- 三个计数与 `counts_at` 就是一次这样的加字段变更：**不需要换路径版本**，
  老服务端收到它们会直接忽略（数据丢计数但入库正常），新服务端收到老客户端的记录也不会报错
- `source` 未来可能出现 `douyin_app` 之外的值
- 破坏性变更需要换路径版本，例如 `/api/v2/records`，客户端按设置页里配的 `base_url` 拼接固定路径，改动要同步改客户端
- 不要在响应里依赖 `batch_id` 做去重，它每批都变

## 已知缺口

- `client.app_version` 当前是空字符串。宿主的设备信息接口里没有应用版本字段，需要客户端补一行才能填上，服务端先按 `client.device` 区分设备
- `title` 与 `author` 由客户端从分享口令解析，偶尔会为空，且与详情页显示可能有细微差异
- 三个计数由客户端从互动条的 `content-desc` 里解析。页面对 ≥ 10000 的计数只显示一位小数的「万」
  （`41.4万`），所以 41.4 万这类数最多有 ±500 的误差；原始文本放在 `interaction_text` 里可回查
- 页面上的计数是**采集那一刻**的值，客户端不做停留观测，两次观测之间的增长靠多条记录的时间序列还原
- `content_id` 要客户端多发一次 HTTP 请求（跟随短链跳转到分享页）才能拿到；解析失败时客户端如实报错，
  不会退回用短码当身份（退回去等于把重复行继续写进库）
- 三个采集包（抖音 0.5.0 / 快手 0.3.0 / 小红书 0.3.0）都发 `content_id`；
  抖音的 `content_id` 是 canonical 里的 aweme_id，快手是分享页 JSON 里的 photoId，小红书是 noteId
