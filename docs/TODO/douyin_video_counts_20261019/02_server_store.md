# 02 服务端：一行一视频，覆盖三个计数

作用域：`/Users/zhangtc/code/hotgo` 的 `server/addons/collect/**` 与
`server/internal/{dao,model/do,model/entity}/*addon_collect_record*.go`。

已确认：**一行一视频，直接覆盖**；不保留观测历史；**线上已有数据与正在跑的老客户端**。

## 旧实现

- `collectin.IngestItem`（`model/input/collectin/ingest.go:35`）8 个字段，没有计数
- `logic/sys/ingest.go:41` 的 `Ingest`：逐条校验 → 按 `(device, idempotency_key)` 预查是否已存在 →
  存在的计入 `accepted` 不写库，不存在的 `InsertIgnore` 进 `hg_addon_collect_record`
- **没有任何更新路径**。同一个视频被采两次会落成两行（靠客户端本地去重才没发生）
- `hg_addon_collect_record` 没有计数列；`migrate.go:47` 只在表不存在时建表，没有列级迁移

## 1. 视频身份与行归属

- 视频身份 = **`(source, video_id)`**，`source` 由链接域名反查（`collectin.MatchPlatform`，已有），
  `video_id` 取链接路径最后一段（`collectin.ParseContentUrl`，已有）
- 一行一视频 → 需要给这张表加唯一索引 `uk_collect_record_source_video (source, video_id)`
- 唯一键 `(device, idempotency_key)` **保留不动**：它是「同一条上报重发」的幂等键，与视频身份是两件事
- 行上的 `device` 是**首次采到这个视频的设备**，后续观测不改它（已知取舍：多设备时看不出最近是哪台设备采的，
  本次不为此加列）

## 2. 上报契约入参扩字段

`model/input/collectin/ingest.go` 的 `IngestItem` 增加：

```go
// 互动计数。指针类型是必须的：老客户端（0.2.0）与小红书/快手包根本不发这三个字段，
// 而「没发」与「发了 0」是两件事——0 是合法计数，缺失不能当成 0 写库。
LikeCount       *int64 `json:"like_count"`
CommentCount    *int64 `json:"comment_count"`
CollectCount    *int64 `json:"collect_count"`
// CountsAt 这三个计数是哪一刻观测到的。单调判断要用它，不能用 CollectedAt：
// CollectedAt 是首次采集时间，更新时不变，拿它比较会让更新永远被挡下。
CountsAt        string `json:"counts_at"`
InteractionText string `json:"interaction_text"`
```

`ValidateItem` 增补校验，失败统一进 `rejected`（`reason=invalid_payload`），**不能整批 400**：

- 三个计数若存在必须 `>= 0`
- `counts_at` 允许为空（老客户端与小红书/快手包三个计数都不发，自然也不发它）；
  但**带了任何一个计数就必须带 `counts_at`**，否则这次观测没有任何先后依据，只能拒收。
  非空时必须能按 `ParseCollectedAt` 解析
- `interaction_text` 不校验，允许为空

返回值相应扩成 `(source, contentId string, collectedAt, countsAt *gtime.Time, reason string)`，
调用点只有 `logic/sys/ingest.go` 一处。

## 3. 落库逻辑（`logic/sys/ingest.go`）

`pendingRecord` 加上计数字段。落库分三步，全部在**一个事务**里：

### 3.1 预查两种身份

```go
// 1) 同一条上报重发：按 (device, idempotency_key)
// 2) 同一个视频的新观测：按 (source, video_id)
```

第 1 种命中的，沿用现在的行为：计入 `accepted`，不写库（这就是重发幂等）。
第 2 种命中的，走更新：

```go
// 只有「这次观测比库里那次新」才覆盖计数。
// 依据：契约明确同一个 idempotency_key 可能因超时/5xx 重复到达，
// 一个更早的观测晚到不能把计数回退成旧值。
if countsAt != nil && (row.CountsAt == nil || countsAt.After(row.CountsAt)) {
    写入 like_count / comment_count / collect_count / interaction_text / counts_at
}
```

**只有客户端真的发来了计数的字段才写**：用「按字段有条件地往 `g.Map` 里塞键」实现，
不要写 `gconv.Int64(item.LikeCount)` 这种把 nil 变 0 的写法。
老客户端（0.2.0）重发同一批记录时 `LikeCount == nil`，无条件写库会把已经采到的计数清成 0。

行锁用 GoFrame 的 `LockUpdate()`（本仓库 `dwreport` 已有用例，例如
`server/addons/dwreport/logic/sys/menu.go:476`），避免两个并发批次同时判「不存在」而一个插入失败。

### 3.2 剩下的走插入

不变：`InsertIgnore` + 唯一索引兜底。新增的 4 列加入 `rows`（`:146`）的 `g.Map`。

### 3.3 并发插入撞上视频唯一索引

两个不同 `idempotency_key` 同时插入同一个视频时，一个会被 `uk_collect_record_source_video` 挡下。
现有代码对这种情况只打一条 Debug 日志并按「已入库」处理，那会让这次观测的计数**静默丢失**。
改成：`InsertIgnore` 之后，对没插进去的行按视频身份再查一次并执行 3.1 的更新分支。
覆盖不了再来一轮的极端情况按「已入库」计 accepted 并打 Warning（记录数丢失比让客户端把整条置 failed 好：
契约规定 `failed` 不自动重试）。

## 4. 建表、加列与加索引

### 4.1 新增列

| 列 | 类型 | 注释 |
| --- | --- | --- |
| `like_count` | `BIGINT NULL` | 点赞数，客户端读不到时为 NULL |
| `comment_count` | `BIGINT NULL` | 评论数 |
| `collect_count` | `BIGINT NULL` | 收藏数 |
| `interaction_text` | `VARCHAR(255) NOT NULL DEFAULT ''` | 命中的原始 desc 文本 |
| `counts_at` | `DATETIME NULL` | 这三个计数是哪一刻观测到的 |

`counts_at` 与 `collected_at` 并存：`collected_at` 是首次采集时间（更新时不动），
`counts_at` 是计数的时间戳，也是单调判断的依据。

### 4.2 列迁移必须走 ALTER

`migrate.go:47` 的 `migrateCollectSchema` 只判表存在。**MySQL 的 `ADD COLUMN` 不支持 `IF NOT EXISTS`**，
所以按 `dwreport` 的现成写法（`server/addons/dwreport/main.go:610` 起）：

```go
fields, err := g.DB().TableFields(ctx, dao.AddonCollectRecord.Table())
if err != nil { return err }
for _, column := range recordCountColumns {      // {name, ddl}
    if _, ok := fields[column.name]; ok { continue }
    g.DB().Exec(ctx, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column.name, column.ddl))
}
```

只改 `collectRecordCreateSQL`（`migrate.go:95`）的 `columnSpec` 是不够的：那只对新装生效，
已经在跑的生产库不会补列。

### 4.3 唯一索引：线上库有建不起来的可能

`ALTER TABLE ... ADD UNIQUE KEY uk_collect_record_source_video (source, video_id)` 在存在重复
`(source, video_id)` 的历史数据时会**直接失败**。所以：

- `migrate.go` 里用 `information_schema.statistics`（或 `TableFields` 之后单独判索引）确认索引不存在再建
- 建索引失败时**返回明确错误**，把预检 SQL 写进错误信息，不要静默跳过（静默跳过的后果是
  「一行一视频」在库里根本不成立，而且一直到数据长歪了才会被发现）
- 上线手册给预检 SQL：

```sql
SELECT source, video_id, COUNT(*) c FROM hg_addon_collect_record
GROUP BY source, video_id HAVING c > 1;
```

历史重复行由使用者决定怎么合并（客户端本地去重过，预计为空）。**本次不写自动合并**：
自动合并要挑哪一行的计数、删哪些行，是数据决策不是代码决策。

### 4.4 三处列定义必须一字不差

1. `migrate.go` 的 `collectRecordCreateSQL`（`columnSpec`，注释也参与比对）
2. `resource/sql/install.sql`（MySQL）
3. `resource/sql/install-pg.sql`（PostgreSQL）

注释不一致会让后续 `gf gen dao` 的 entity 描述无故变化，这种噪声很容易被当成真实差异提交。

### 4.5 生成物与版本

- `server/internal/dao/internal/addon_collect_record.go`、`dao/addon_collect_record.go`、
  `model/do/addon_collect_record.go`、`model/entity/addon_collect_record.go` 四个文件同步加列
  （有库就用 `gf gen dao`；没有就按现有格式手改，字段顺序与建表顺序一致）
- `server/addons/collect/main.go:42` 插件 `Version` `v1.0.0` → `v1.1.0`：
  `Upgrade` 是后台手工点的（`internal/library/addons/install.go:78`），不升版本没有入口触发迁移

## 5. 响应契约不变

`IngestRes` 仍是裸的 `{"accepted":[...],"rejected":[...]}`，不加字段。
客户端的判定只看这两个数组与状态码，本次改动不触碰这条链路。

## 6. 单元测试

`model/input/collectin/ingest_test.go` 与新增的 `logic/sys/ingest_test.go` 至少覆盖：

1. 带计数的记录：`ValidateItem` 通过；计数为负 → `rejected`（`invalid_payload`）
2. 不带计数的记录（老客户端形状）：`ValidateItem` 通过
3. g.Map 组装：`nil` 计数不进 map（**这条是「不清零」的实现保证，必须有**）
4. 同一视频二次观测：不新增行，三个计数与 `counts_at` 被覆盖，`collected_at` / `device` / `idempotency_key` 不变
5. 乱序重发：先落 `counts_at=12:00` 的观测，再落 `counts_at=11:00` 的观测 → 计数保持 12:00 的值
6. 老客户端重发同一条（同 `idempotency_key`）：走重发分支，计数不变
7. 同一批里出现同一视频的两条：不撞唯一索引，最终值是较新的那条

## 期待的新实现

`POST /api/v1/records` 接受三个可选计数与 `counts_at`；新视频插入一行带计数的记录；
同一视频再次观测时更新那一行的计数与 `counts_at`，不新增行、不覆盖首次采集信息；
不带计数的记录（老包、小红书、快手）既不被拒也不影响已有计数。

[DONE]
