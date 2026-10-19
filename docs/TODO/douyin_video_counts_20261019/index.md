---
repository: https://github.com/AAswordman/Operit
status: planning
For_Agent: 本计划横跨两个仓库（客户端 Operit 与服务端 hotgo）。动手前先读「实测基线」，不要凭猜测重写计数解析规则
---

# 抖音采集：视频互动计数（点赞 / 评论 / 收藏）与同一视频的更新

迭代目标（用户原话）：采集抖音视频时同时拿到点赞数、评论数、收藏数；采集过程中再次遇到同一个视频时，
更新这三个数；数据库需要保留这些数据。

## 已确认的设计决定（2026-10-19）

| 项 | 决定 |
| --- | --- |
| 「更新」在库里的形态 | **一行一视频，直接覆盖三个计数**。不保留观测历史，不建第二张表 |
| 更新频率 | **每次遇到同一个视频就更新一次**，不设最小间隔 |
| 发布状态 | 客户端包（0.2.0）与服务端插件（v1.0.0）**都已上线**，线上已有数据与正在跑的采集 → 一切改动必须向前兼容 |

由此推出的三条硬约束：

1. 线上 `hg_addon_collect_record` 已有数据，**不能重建表、不能改既有列语义**，只能加列 + 加索引
2. 老客户端（0.2.0，不发计数）与小红书/快手包重发时必须**不把已有计数清成 0**
3. 同一视频的重复请求（超时重发）必须**不能把计数回退**成更旧的值

## 现状

### 客户端（本仓库，`my-packages/douyin-collector`）

单文件 driver：`src/packages/douyin_collector.ts`（1663 行）。与本次改动相关的路径：

| 位置 | 作用 |
| --- | --- |
| `douyin_collector.ts:338` `extractShareLinkOnDetailPage` | 详情页上唯一一处「读整页 + 取链」的地方。`:344` 已经为了推广标记额外读了一次整页（`hasPromoHint`），三个计数就挂在这同一次读上，不增加设备往返 |
| `douyin_collector.ts:758` `CollectedRecord` | 落进 `records.jsonl` 的记录模型，当前 10 个字段，没有计数 |
| `douyin_collector.ts:982` `appendRecord` | 追加一行 records.jsonl + 建一条 pending 的 outbox |
| `douyin_collector.ts:1490` | 采集主循环开头：读 records.jsonl、按 `videoIdOf(url)` 建 `storedVideoIds` 去重表 |
| `douyin_collector.ts:1565` | 命中已采集过的视频 → `skippedDuplicates++` 后**直接跳过**，不取链、不读计数 |
| `douyin_collector.ts:507` | `MAX_CONSECUTIVE_SKIPS = 10`，连续跳过 10 条就结束本片（`stopReason="duplicates"`） |
| `douyin_collector.ts:1537` `pageSize` | 本页要处理的条数 = `count - collected.length`，只算新增 |
| `douyin_collector.ts:491` | 结果载荷 `DouyinCollectShareLinksResult`，含 `collected` / `skippedDuplicates` / `stopReason` |
| `douyin_collector.ts:914` `readTextFile` / `:920` `loadRecords` | 全量读 records.jsonl，按行 JSON.parse；坏行直接抛错 |

`dist/` 是入库的编译产物，改完 `src/` 必须重新 `npx tsc`，否则手机上加载的还是旧的。

### 服务端（`/Users/zhangtc/code/hotgo`，`server/addons/collect`）

| 位置 | 作用 |
| --- | --- |
| `model/input/collectin/ingest.go:35` `IngestItem` | 上报契约的入参，当前 8 个字段，没有计数 |
| `logic/sys/ingest.go:41` `Ingest` | 逐条校验 → 按 `(device, idempotency_key)` 预查去重 → `InsertIgnore` 落库。**没有任何更新路径** |
| `logic/sys/ingest.go:24` `pendingRecord` / `:146` `rows` | 落库字段的组装点 |
| `migrate.go:47` `migrateCollectSchema` | 只在**表不存在**时建表（用 `TableFields` 判存在）。列级变更没有迁移路径，这是本插件第一次给这张表加列 |
| `resource/sql/install.sql` | MySQL 建表脚本，与 `migrate.go:95` 的 `columnSpec` 必须一字不差（注释也要对齐，否则 `gf gen dao` 的 entity 描述会无故变化） |
| `internal/{dao,model/do,model/entity}/addon_collect_record.go` | `gf gen dao` 生成物，加列要同步四个文件 |
| `model/input/sysin/collect.go` | 后台列表模型 `RecordListModel`（没有计数） |
| `web/src/views/addons/collect/record/{index.vue,model.ts}` | 后台记录列表与详情抽屉 |
| `main.go:42` `Version: "v1.0.0"` | 插件版本。`Upgrade` 是后台手工点的（`internal/library/addons/install.go:78`），不升版本就没有触发迁移的入口 |
| `hotgo/docs/collect-deploy.md` | 上线手册，开头有一张「本次变更」事实表，本次要把「不改任何既有表」改写成「加 4 列 + 1 个唯一索引」 |

### 实测基线（不要推翻）

`docs/TODO/collector_accessibility_only_20261015/evidence_tier_ax.json:48-52`，
真机 24094RAD4C / 抖音 37.8.0 / 1080×2400，详情页互动条的真实 content-desc：

```text
未点赞，喜欢2086，按钮
评论39，按钮
评论39，按钮      ← 同一个计数在树里出现两次
未选中，收藏347，按钮
分享1763，按钮
```

结论：

- 三个计数都在按钮的 `content-desc` 里，文案前缀分别是 `喜欢` / `评论` / `收藏`，状态词（`未点赞`、`未选中`）在前
- `评论` 节点会重复出现，取值必须去重或取首个匹配
- 计数被状态词包住，**不能整串比较**，只能取前缀/正则捕获组

### 尚未实测、必须先用探针确认的三件事

1. **万位缩写**：抖音对 ≥10000 的计数显示成 `1.2万`。这三个 desc 是否也缩写、格式是 `1.2万` 还是 `12000`，没有证据
2. **选中态**：`已点赞，喜欢2086，按钮` / `已选中，收藏347，按钮` 的准确写法（影响正则是否要吃掉状态词）
3. **是否存在别的稳定标识**：如果详情页节点树里有一个稳定的视频标识（可能性低，resource-id 已混淆），
   重复视频的更新就不必再走 35–40 秒的取链流程。探针顺带 dump 一次详情页全树即可判定

## 意图

1. 客户端在详情页读整页的那一次里，把点赞/评论/收藏三个计数一并取出，写进记录并随 outbox 上报
2. 采集过程中再次遇到已采集过的视频时，不再直接跳过，而是同样取链 + 读计数，产生一条针对同一视频的**新观测**上报
3. 服务端按视频（来源 + 视频标识）认同一行，把三个计数覆盖成最新值；该行的首次采集信息保持不变
4. 契约文档、后台列表、上线手册同步更新

## 期待结果

- 客户端 `records.jsonl` 里**一个视频一行**，字段多出 `like_count` / `comment_count` / `collect_count`
  （读不到为 null）、`interaction_text` 与 `counts_at`
- 服务端表里**一个视频一行**，三个计数是最新一次观测到的值；重复上报不产生新行
- 老客户端（0.2.0）、小红书包、快手包的上报照常被接受，且不影响已存的计数
- 后台能直接看到每行的三个计数，不需要按 video_id 聚合

## 作用域

本仓库（Operit）：

- `my-packages/douyin-collector/src/packages/douyin_collector.ts` 与其 `dist/`
- `my-packages/douyin-collector/manifest.json`（版本号 0.2.0 → 0.3.0）
- `my-packages/README.md`（包内工具与行为说明）
- `docs/TODO/device_automation_platform_20261008/server_api.md`（上报契约）与 `mock_server.py`
- `docs/TODO/collector_accessibility_only_20261015/probe_ax_only.js`（加计数探针）
- 本计划目录

服务端仓库（hotgo）：

- `server/addons/collect/**`、`server/internal/{dao,model/do,model/entity}/*addon_collect_record*.go`
- `web/src/views/addons/collect/record/**`
- `hotgo/docs/collect-deploy.md`

**不动**：小红书（`xhs-collector`）与快手（`kuaishou-collector`）两个包。它们的记录结构与 outbox 同构但独立，
本次不给它们加计数（没有需求）。服务端的改动对它们是「加可选字段、它们不发」，互不影响。

## 风险与成本

- **吞吐会变慢**：视频标识只能从分享链接里取，所以「更新一条已见过的视频」和「采一条新视频」是同一个
  35–40 秒的流程。「重复即跳过」这个优化会消失，本片预算要按「新增 + 更新」一起算。
  模板里 `count=6` / `chunk_minutes=5` 刚好够 6 条，仍然够用
- **列迁移是本插件第一次动已存在的表**：`migrate.go` 没有列级迁移路径，必须新写幂等 ALTER，
  并且要区分 MySQL（`ADD COLUMN` 不支持 `IF NOT EXISTS`，先 `TableFields` 判存在）与 PostgreSQL。
  `dwreport` 插件里有现成写法可抄（`server/addons/dwreport/main.go:610` 起）
- **唯一索引加在已有数据上**：`(source, video_id)` 的唯一索引在线上库可能建不起来——如果历史数据里
  同一视频已经有多行。上线手册必须给一条预检 SQL，`migrate.go` 也必须把失败原因讲清楚
- **老客户端清零**：服务端更新时，没带计数的记录（老包、小红书、快手）不能把已有计数写成 0
- **超时重发把计数回退**：契约明确同一个 `idempotency_key` 可能因超时/5xx 重复到达。
  必须按采集时间做单调判断，只接受更新的观测
- **万位缩写不可逆**：`1.2万` 折成 12000 是有损的。所以除三个整数外，另存一份原始 desc 文本

## 验证

分五段，详见 [04_verification.md](04_verification.md)。

1. 探针取证：真机 dump 详情页互动条 desc（含高计数视频与两种选中态）
2. 客户端：单条工具在详情页跑一次，确认记录里三个计数与页面一致
3. 服务端：Go 单测覆盖「带计数新增」「老客户端重发不清零」「同视频二次观测覆盖」「乱序重发不回退」
4. 迁移：开发库上跑一遍「旧二进制 → 新二进制 → 更新插件」，含负向验证与幂等验证
5. 端到端：工作流连跑两轮，第二轮应在库里看到同一行的计数被更新，且不新增行
