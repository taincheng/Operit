# 记录落地、outbox 与上报

## 旧状态

抖音采集器已经把这一层做完了，实现见 `my-packages/douyin-collector/src/packages/douyin_collector.ts` 的「记录落地与 outbox 上报」段落。契约出处是 [记录落地与 outbox 上报](../device_automation_platform_20261008/03_record_store_and_outbox.md)，服务端口径见 [采集上报服务端接口](../device_automation_platform_20261008/server_api.md)。

小红书这一层没有新的技术问题，只有标识不同。

## 意图

把抖音那一层照搬过来，只改两处包标识，加一个来源特有的字段。

```ts
const PLUGIN_ID = "xhs_collector";
const RECORD_SOURCE = "xiaohongshu_app";
```

上报地址与令牌**不自带键名**：服务端只有一个，两个包共用中立键 `COLLECTOR_BASE_URL` 与 `COLLECTOR_TOKEN`。键名的由来与抖音包旧键的迁移见 [04 上报配置键名中立化与迁移](04_shared_upload_config_migration.md)。

落地目录：`/sdcard/Download/Operit/plugins/com.taincheng.xhs_collector_bundle/`，三个文件：

- `records.jsonl`：每行一条采集结果，追加写
- `outbox.json`：`idempotency_key → { status, attempts, last_error, updated_at }`
- `progress.json`：本片进度与结束原因。**记的是进度与轮次，不是列表位置**——列表首屏会浮动，按位置续跑不可靠

## 记录结构

在契约字段之外只加一个来源特有字段。服务端契约明确写了「服务端应忽略不认识的字段，便于客户端前向演进」，见 server_api.md 第 84 与 229 行，所以加字段是安全的。

```ts
type CollectedRecord = {
    idempotency_key: string;   // UUID，服务端去重键
    keyword: string;           // 采集时使用的搜索主题
    url: string;               // 抽出的 xhslink 短链
    share_text: string;        // 分享流程原文，含随机尾句
    title: string;             // 详情页读到的标题，可能为空
    author: string;            // 详情页读到的作者，可能为空
    collected_at: string;      // ISO8601 带时区
    source: string;            // 固定 xiaohongshu_app
    keyword_in_title: boolean; // 标题里是否出现本次关键词，只标记不过滤
    promo_hint: boolean;       // 卡片上是否出现「广告」，只标记不过滤
    note_type: "note" | "video"; // 新增：图文笔记还是视频笔记
};
```

`note_type` 按详情页的页型直接得出（见 [01](01_xhs_driver.md) 的页面判定），不需要额外读取。

标题与作者取自详情页：

- 图文笔记：标题是详情页里第一段长度 ≥ 15 的文本，作者是 resource-id 为 `nickNameTV` 的节点
- 视频笔记：标题是卡片上的正文长文本，作者是 content-desc 以 `作者` 开头的按钮的剩余部分

两处都允许为空字符串，不为空而失败。

## 去重

去重键是 `url`。实测同一条笔记两次独立取链得到同一个短链（`https://xhslink.cn/o/85Lns6HOD4i`），所以短链可以当身份用，不必依赖标题——标题会在 App 侧被截断，稳定性不如短链。

续跑口径与抖音一致：下一片照常从列表头部开始，已经采过的短链直接跳过。列表首屏浮动不会造成重复采集，也不会重来一遍已完成的量。

## 上报

完全按契约，不新增任何判定：

- `POST {base_url}/api/v1/records`，`Content-Type: application/json; charset=utf-8`，`Authorization: Bearer <token>`
- 每批 20 条，`connect 15s / read 30s / write 30s`
- 宿主对 4xx 与 5xx 都返回 `success=true`，判定只能基于 `statusCode`
- 200/202 按响应里的 `accepted` 与 `rejected` 逐条置状态；429 停止本轮；5xx 与网络错误保持 pending 并累加尝试次数；其他 4xx 置 failed，failed 不自动重发

## 工具

与抖音一一对应，只换前缀：

| 工具 | 作用 |
| --- | --- |
| `xhs_outbox_flush` | 把 pending 记录按每批 20 条上报 |
| `xhs_outbox_status` | 查看 pending、sent、failed 各多少条与文件位置 |
| `xhs_upload_config_check` | 自检上报配置；故意发空批次，服务端按参数校验拒收它，而鉴权在参数校验之前，所以「参数校验类的 400」恰好证明配置可用 |

## 验证

2026-10-12 在真机上实测，落盘与状态机部分：

1. 每条采集成功即写 `records.jsonl`，并建 pending 的 outbox 记录 ✓ 4 条记录、4 条 outbox 条目一一对应
2. `progress.json` 的 `chunk_index`、`collected_total`、`last_stop_reason`、`last_item_id` 都按预期更新 ✓
3. 同一短链不重复入库 ✓ 第二片第一条命中已采短链被跳过，没有产生第二条记录

上报部分**没有走通**，原因在服务端：

- 首次上报（1 条）与第二次上报（4 条）都返回 200，但响应体把每条都放进 `rejected`，`reason` 是 `invalid_url`
- 客户端按契约把它判成 failed，`outbox.json` 里 4 条 `last_error` 都是「服务端拒绝」
- 用同一条记录、同一个 `idempotency_key` 直接问服务端，得到同样的 `{"accepted":[],"rejected":[{"key":"…","reason":"invalid_url"}]}`

所以服务端的 URL 校验目前不接受 `xhslink.cn` 这个域名（抖音那边是 `v.douyin.com`）。客户端产出的短链是从 App 分享流程原样抽出来的，没有做任何改写。**这是服务端要修的一条**，客户端不做兜底。

另外两点记录在案：

- `failed` 按设计不自动重发，所以这 4 条要等服务端放行后手工把 outbox 里对应条目的状态改回 `pending`，或删掉 outbox.json 让它重建
- 服务端返回的 `rejected[].reason` 目前只被用来判状态，没有落到 `last_error` 里（写死成「服务端拒绝」）。这次排查是靠直接问服务端才拿到 `invalid_url`，`last_error` 带上服务端给的原因会更好用。这一条与抖音包的行为一致，属于两个包共同的待改进项

未做：mock server 六种响应的逐条验证、断网重发、自检工具的空批次探测。前两项沿用抖音包已经逐条验证过的同一套代码（这一层是从它复制过来只改标识的），第三项因为真实服务端可达而没有单独跑。

[DONE]
