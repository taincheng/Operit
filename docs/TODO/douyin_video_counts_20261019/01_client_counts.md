# 01 客户端：读三个计数 + 同一视频原地更新

作用域：`my-packages/douyin-collector/src/packages/douyin_collector.ts`（与其 `dist/`）。

已确认：**每次遇到同一个视频就更新一次，不设最小间隔**；本地 `records.jsonl` **一个视频一行**。

## 旧实现

- 详情页只读两样东西：分享链接（`extractShareLinkOnDetailPage`，`:338`）与推广标记（`:344`，为了它多读了一次整页）
- 已采集过的视频在 `:1565` 直接跳过，不取链、不读计数，只 `skippedDuplicates++`
- `CollectedRecord`（`:758`）只有 10 个字段，没有任何计数
- `records.jsonl` 是纯追加（`:982` `appendRecord`），一个视频重复采到就会有第二行
- 本片条数预算只算新增：`pageSize = Math.min(pageCards.length, count - collected.length)`（`:1537`），
  连续跳过 10 条就结束本片（`:507` / `:1516`）

## 意图修正

### 1. 计数解析（新增纯函数，放在 `PROMO_HINT_TERMS` 附近）

```ts
// 互动条计数从按钮的 content-desc 里读。真机实测（抖音 37.8.0 / 1080x2400，
// 证据 docs/TODO/collector_accessibility_only_20261015/evidence_tier_ax.json:48-52）：
//   未点赞，喜欢2086，按钮 / 评论39，按钮 / 未选中，收藏347，按钮
// 状态词在前且会变（未点赞/已点赞、未选中/已选中），所以只能按「词 + 数字」捕获，不能整串比较。
const LIKE_COUNT_PATTERN = /喜欢(\d+(?:\.\d+)?万?)/;
const COMMENT_COUNT_PATTERN = /评论(\d+(?:\.\d+)?万?)/;
const COLLECT_COUNT_PATTERN = /收藏(\d+(?:\.\d+)?万?)/;
```

`万` 的处理：`1.2万` → `12000`（四舍五入到整数），同时把命中的原始 desc 一起留着。
这三个正则在 2026-10-19 已按 [04_verification.md](04_verification.md) 第 0 步的真机证据定稿：
`万` 是一位小数（`41.4万`），状态词只出现在标签之前，`评论` 在树里重复出现两次。

取值规则：

- 遍历页面的 `contentDesc`（`UINode.findAll` + `node.contentDesc`）按正则捕获；
  `评论` 在树里会重复出现，取首个匹配
- 命中不到就是**没有这个计数**，写成 `null`，绝不用 0 顶替（0 是合法计数）

### 2. 读数挂在哪一次读页上

`extractShareLinkOnDetailPage` 已经有 `:344` 这一次整页读（为了 `promoHint`），把结果复用：

```ts
const detailRoot = UINode.fromPageInfo(await Tools.UI.getPageInfo());
const promoHint = hasPromoHint(detailRoot);
const counts = readInteractionCounts(detailRoot);
```

不多一次设备往返。读数时机保持在 `waitForDetailShareButton` 之后（互动条已在画面里）、
点分享按钮之前（面板是模态窗口，打开后下层节点读不到）。

### 3. 记录模型扩字段

`CollectedRecord` 增加：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `like_count` | `number \| null` | 点赞数，读不到为 null |
| `comment_count` | `number \| null` | 评论数 |
| `collect_count` | `number \| null` | 收藏数 |
| `interaction_text` | `string` | 命中的原始 desc，按 `喜欢…\|评论…\|收藏…` 拼接；一个都没命中就是空串 |
| `counts_at` | `string` | 这三个计数是哪一刻观测到的（ISO8601） |

三个计数用 `number | null` 而不是 `number`：0 是合法计数，缺失必须能与 0 区分。
TS 侧按仓库规矩不做 `as string` 之类的回退收窄。

`collected_at` **保持「首次采集时间」的语义不变**：更新已有视频时不改它。这也是服务端那一行 `collected_at` 不动的依据。

### 4. 重复视频：跳过改成更新

`storedVideoIds` 那一支（`:1565`）改成：

- 取链 + 读计数，与新增走**同一段** `extractShareLinkOnDetailPage`，不复制一份逻辑
- 该视频已在 `records.jsonl` 里 → 用同一行的位置**原地重写**这一行：三个计数、`interaction_text`、
  `counts_at` 换成这次的，`idempotency_key` 换成新的，`collected_at` 保持不变
- 该视频是新的 → 追加一行（与旧行为一致）
- 两条路径都走 outbox 上报，上报代码不分叉

`idempotency_key` 每次观测都要换新：服务端按 `(device, idempotency_key)` 去重，沿用旧键会被判成
「已入库」而完全不更新。换键之后，服务端的同视频判定负责把它落到同一行（见 02 文档）。

### 5. `records.jsonl` 的原地重写与 outbox 清理

- 新增 `saveRecords(records)`：拼好全文，写 `records.jsonl.tmp`，再 `Tools.Files.move(tmp, RECORDS_FILE)`。
  宿主的 `move` 走的是 `renameTo`（`StandardFileSystemTools.kt:2314`），是同目录下的原子替换，
  中途被杀不会留下半截文件。**不接受**「直接覆盖写 records.jsonl」：那样一旦被硬超时杀掉，
  文件会残缺，而 `loadRecords`（`:920`）遇到坏行是直接抛错的，整个采集会瘫掉
- 更新时**立即**重写并保存（不攒到本片结束）：更新后的那一行随时可能因为脚本被杀而丢，
  攒到最后等于把这一片采到的计数押在收尾能不能跑到。文件是一个视频一行、量级是几百行，
  重写几次的代价可以忽略
- 换掉 `idempotency_key` 的同时删掉被覆盖那一行的旧 outbox 条目：那条观测已经被这次覆盖，
  留着只会长成孤儿。**不做**全量清扫（不做「扫描所有键、删掉不在 records 里的条目」），
  只精准删这一条，规则简单且不会误伤别的状态
- 内存里的记录表（`records` 数组）就是磁盘上那份，新增走 `appendRecord`（追加，崩溃安全），
  更新走 `saveRecords`（整文件原子替换）

### 6. 本片收尾条件的调整

- 预算改成 `processed = collected.length + updated`，循环条件 `processed < count`，
  `pageSize = count - processed`（更新与新增的取链成本一样，按同一个预算算才准）
- 新增 `processedVideoIds`（本片内已处理过的视频）。本片内第二次遇到同一个视频**不再取链**，
  计入 `skippedDuplicates` 并累加 `consecutiveSkips`；到 `MAX_CONSECUTIVE_SKIPS` 结束本片
  （`stopReason="duplicates"`）。原来的「库里已有就跳过」不再是跳过理由，这个守卫改成守本片内的重复
- 结果载荷**加字段**：新增 `updated`；`skippedDuplicates` / `stopReason` / `collected` 的语义不变
- `progress.json` 增加 `updated_total`（累计更新次数），`collected_total` 仍然只数新增的视频
- `sendIntermediateResult` 带上 `updated`，界面能看出本片在「新增」还是在「更新」

### 7. 版本与产物

- `manifest.json`：`0.2.0` → `0.3.0`
- 改完 `src/` 必须 `npx tsc -p my-packages/douyin-collector/tsconfig.json` 重新产出 `dist/`
  （`dist/` 入库，手机加载的是它）
- `METADATA` 里 `douyin_collect_share_links` 的中英文描述要补上「同时读并更新互动计数」；
  `douyin_collect_share_link` 的返回值多出三个计数，描述一并补充
- `count` 参数的语义从「本片最多采集多少条」变成「本片最多处理多少条视频（新增 + 更新）」，
  中英文描述必须一起改：不改的话模型与用户会按「新增条数」理解，实际每片要久得多

## 期待的新实现

单条工具与批量采集共用同一条取数路径，两者的返回里都带三个计数与原始文本；
批量采集遇到库里已有的视频时重新取链取数并更新库里的那一行，本片内重复遇到同一视频才跳过。

## 不做什么

- 不给计数做任何默认值填充：读不到就是 null
- 不为「万位缩写」去别处还原精确值：页面本身就只显示缩写
- 不保留观测历史：一个视频一行，旧的计数被覆盖

[DONE]
