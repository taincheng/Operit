---
For_Agent: 这一层与抖音、小红书两包逐行同构，差异只有 PLUGIN_ID、source、目录名，以及被拒记录会带上服务端给的 reason。不要在这里发明新东西
---

# 02 记录落地、outbox 与上报

## 旧实现情况

抖音包与小红书包里各有一份完整实现，两份逐行同构：

- 记录落地与 outbox 状态机：`my-packages/douyin-collector/src/packages/douyin_collector.ts` 的「记录落地与 outbox 上报」一节
- 上报契约：[采集上报服务端接口](../device_automation_platform_20261008/server_api.md)
- 逐条验证记录：[记录落地与 outbox 上报](../device_automation_platform_20261008/03_record_store_and_outbox.md)
- 上报配置中立化：[上报配置键名中立化](../xiaohongshu_collector_20261012/04_shared_upload_config_migration.md)

## 意图

快手包自带同一套实现，**不抽公共 kernel**（理由见 [index.md](index.md) 的「已定」）。与两份现有实现的差异只有三处：

| 项 | 快手取值 |
| --- | --- |
| `PLUGIN_ID` | `ks_collector` |
| 配置目录 | `/sdcard/Download/Operit/plugins/com.taincheng.kuaishou_collector_bundle/` |
| `items[].source` | `kuaishou_app` |
| 被拒记录的 `last_error` | 写进服务端给的 `reason`，形如 `服务端拒绝：invalid_url` |

最后一条是三包里唯一的行为差异，理由与影响写在下面。其余全部照搬：

- `records.jsonl` 每行一条记录，`outbox.json` 存每条的状态与尝试次数，`progress.json` 存分片进度
- 上报地址与令牌读宿主环境变量 `COLLECTOR_BASE_URL` / `COLLECTOR_TOKEN`，与抖音、小红书**共用同一组中立键**；键缺失就报错并指明去哪填，绝不拿空地址发请求
- 读配置前先跑一次抖音旧键（`DOUYIN_COLLECTOR_*`）的一次性迁移，保证无人值守路径不会读到空配置
- 状态机：200/202 按 `accepted` / `rejected` 逐条置 `sent` / `failed`；429 停本轮；5xx 与网络错误保持 `pending` 并累加尝试次数；其他 4xx 置 `failed`；`failed` 不自动重发
- 每批 20 条，connect 15s / read 30s，`Authorization: Bearer`
- 每条记录采集时立即落盘并建 pending 的 outbox 记录，中途被杀不丢数据

### 为什么这一包把被拒原因写进 last_error

上报契约里写着「客户端会把 `reason` 写进本地 `last_error` 供排查」，但抖音包与小红书包写的是固定的 `服务端拒绝`，把原因丢了。这次联调正好被它坑到：三条记录全被拒，本地只看到「服务端拒绝」，最后是绕过客户端直接打服务端接口才问出 `reason=invalid_url`（服务端域名白名单没有放行 `v.kuaishou.com`）。

所以快手包把 `reason` 带上了。这让三包在这一处行为不一致：改抖音包或小红书包时不必跟着改，但如果哪天要统一，改的方向应当是往快手这一版靠（回到契约）。

## 记录字段

与契约一致，`title` 与 `author` 的来源换成快手：

```json
{
  "idempotency_key": "…",
  "keyword": "家装",
  "url": "https://v.kuaishou.com/KrR1EKUZ",
  "share_text": "https://v.kuaishou.com/KrR1EKUZ …该作品在快手被播放过5.8万次，点击链接，打开【快手】直接观看！",
  "title": "第一次这么直观的感受到软装的重要性！\"软装 \"快手成长计划 \"家居美学 \"奶油风",
  "author": "朱朱(自装日记)",
  "collected_at": "2026-10-14T03:22:39.432Z",
  "source": "kuaishou_app",
  "keyword_in_title": false,
  "promo_hint": false
}
```

- `title` 取分享文本里短链之后的正文，到 `该作品在快手` 之前为止
- `author` 取详情页 `user_name_text_view`，去掉前导 `@`
- `promo_hint` 取搜索结果卡片上的 `广告` 文本。这是**标记**不是判据，不据此丢弃数据
- 不加快手特有的额外字段（小红书那份加了 `note_type`，快手只有视频一种，没有可加的类型）

## 去重

- 本地去重键是短链里的短码，`videoIdOf` 从 `/v\.kuaishou\.com\/([A-Za-z0-9_-]+)/` 抽
- 跨轮次生效：本片开始时把 `records.jsonl` 里所有短码读进内存
- 命中已采过的短码就跳过并累加 `consecutiveSkips`，连续 10 条即认为结果集里已没有新内容，`stopReason=duplicates`

## 分片与续跑

- `count` 是本片条数目标，`chunk_minutes` 是本片时间上限（默认 18，上限 20），先到者结束
- 结束原因写进 `progress.json` 的 `last_stop_reason`：`count` / `time` / `search_exhausted` / `duplicates`
- 同一个关键词续上一轮，换关键词开新一轮（`round_id` 换新）
- `progress.json` 记的是进度与轮次，不是列表位置：搜索结果首屏会浮动，续跑靠短链去重

## 预期结果

- `ks_outbox_flush` 把 pending 按每批 20 条发出去，`ks_outbox_status` 能看到 pending / sent / failed 与记录总数
- `ks_upload_config_check` 发一个空批次自检：服务端先鉴权后校验，所以「参数校验类的 400」正好证明配置可用，且不会写入任何数据
- `ks_migrate_upload_config` 幂等，把 `DOUYIN_COLLECTOR_*` 旧键搬到 `COLLECTOR_*` 后清空旧键

## 验证

### 落地验证（2026-10-14，真机）

- 代码与抖音、小红书两包的上报层同构，差异只有 `PLUGIN_ID`、目录名、`source` 与上面那条 `last_error` 的改进
- `ks_outbox_flush` 真机跑通：发 1 批 3 条，服务端逐条 `rejected`，本地 `outbox.json` 三条都置 `failed` 且 `last_error=服务端拒绝：invalid_url`；`sent 0 / failed 3 / pending 0` 与契约的「4xx 之外的拒收不影响同批其他记录」一致
- `progress.json` 的 `last_stop_reason`、`collected_total`、`chunk_index` 与实际采集一致；换关键词开新一轮
- `ks_upload_config_check` 未单独跑：它发的是空批次，与本次上报走同一条鉴权 + 校验链路，真正的差别只是服务端的校验分支
