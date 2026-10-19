# 03 验证：三层证据

[DONE]

## 第一层：解析规则（编译产物级，可重跑）

```bash
node docs/TODO/collector_content_identity_20261019/verify_content_identity.mjs
```

脚本从**编译产物**（`dist/packages/*.js`）里正则取出三个 `*_CONTENT_ID_PATTERN`，拿真实分享页 fixture 断言：

```
抖音：CONTENT_ID_PATTERN -> 7672977497508440818 ✔
快手：KS_CONTENT_ID_PATTERN -> 5238531002599057662 ✔
小红书：XHS_CONTENT_ID_PATTERN -> 6a263ade0000000022024db0 ✔
三个包的 content_id 解析规则都从编译产物里取到，并与真实分享页一致。
```

同时静态检查编译产物里没有旧名残留：

| 产物 | `awemeId` | `aweme_id` | `videoIdOf` | `itemIdOf` |
| --- | --- | --- | --- | --- |
| 抖音 | 0 | 0 | 0 | 0 |
| 快手 | 0 | 0 | 0 | — |
| 小红书 | 0 | 0 | — | 0 |

## 第二层：服务端（v1.3.0 + 真实 MySQL，克隆库 + 独立端口）

在克隆库上按 `migrate.go` 里**抽出来的 DDL 原文**建列建索引（顺带验证 DDL 合法）：
`content_id varchar(64) NULL` + `uk_collect_record_source_content`。

起了 v1.3.0 的独立实例（8011，不动开发服务器），按来源+身份分组的结果：

| 场景 | 期望 | 实测 |
| --- | --- | --- |
| 抖音同内容、换短码、更晚观测 | 1 行，计数更新 | ✔ 1 行，`like_count=200`，短码仍是首次那个 |
| 快手同作品、3 个不同短码 | 1 行 | ✔ 1 行 |
| 小红书同笔记、2 个不同短码 | 1 行 | ✔ 1 行 |
| 没有 `content_id` 的两条（老客户端）| 各占一行 | ✔ 2 行 |
| `content_id` 非数字/带斜杠/整条 URL/超长 | `rejected: invalid_payload` | ✔ |

## 第三层：真机（设备 24094RAD4C）

装 0.3.0/0.5.0 后逐个跑工作流（用宿主 `enable_workflow`/`disable_workflow` 工具开关，不碰界面）：

**快手**（日志 tag `[kuaishou_collector]`）

```
作品身份解析成功：https://v.kuaishou.com/JKZq7ot1 -> content_id=5245567864801682578
已采集第 1 条：https://v.kuaishou.com/JKZq7ot1（content_id=5245567864801682578）
…（下一片，同一个作品换了短码）
作品身份解析成功：https://v.kuaishou.com/nv97kcXY -> content_id=5245567864801682578
已在库里，跳过：https://v.kuaishou.com/nv97kcXY（content_id=5245567864801682578）
```

**小红书**

```
笔记身份解析成功：https://xhslink.cn/o/27kYsBC1b8D -> content_id=6978aee7000000001a01fc38
已采集第 1 条：https://xhslink.cn/o/27kYsBC1b8D（content_id=6978aee7000000001a01fc38）
…（下一片，同一篇笔记）
已在库里，跳过：https://xhslink.cn/o/27kYsBC1b8D（content_id=6978aee7000000001a01fc38）
```

**抖音 0.5.0**（改名后的回归）

第一次跑暴露了一个必须处理的中间态问题：设备上 0.4.0 那版写下的 11 行用的是 `aweme_id` 字段名，
0.5.0 读 `content_id`，于是这些行变成「没有身份」，那些视频又被当成新的采了一遍：

```
17:11:16 视频身份解析成功：https://v.douyin.com/NPE3-JvUqdI/ -> content_id=7672977497508440818
17:11:17 已采集第 1 条：https://v.douyin.com/NPE3-JvUqdI（content_id=7672977497508440818…）   ← 应该是「已更新」
```

于是把设备上的抖音 `records.jsonl` 规整了一次（只动我自己中间态测试产生的行）：

- 11 行 `aweme_id` → `content_id`（值都是同一套 canonical 规则解析出来的，等价改写）
- 6 个内容各有两行（一行旧字段、一行新字段），按 `counts_at` 保留较新的那一行，丢掉旧的 6 行
  （丢的都是 outbox 里 `sent` 的，同时删掉对应 outbox 条目；没有丢掉任何未上报的记录）
- 规整后 481 行，每行都有 outbox 条目，状态数 475 sent + 6 pending 与行数一致

再跑一片，同样的四个视频全部变成**更新**：

```
17:18:09 已更新第 1 条：https://v.douyin.com/PaVckRxh8PY/（content_id=7671666153245107621，赞 3495…）
17:19:02 已更新第 2 条：https://v.douyin.com/GMVFieoE2os/（content_id=7679754311622069519，赞 551…）
17:19:42 已更新第 3 条：https://v.douyin.com/N9z9QQn3CBo/（content_id=7682435785719567220，赞 128…）
17:20:23 已更新第 4 条：https://v.douyin.com/s7qvK8LXRg4/（content_id=7689681614016250555，赞 2044…）
```

0.5.0 之前的行（470 条老记录）没有身份，仍不参与去重 —— 这是设计如此，不是遗留 bug。

## 过程中发现的两件与本次改动无关的事

1. **小红书采集在连续运行数小时后会卡在取链**：`JS ERROR: No focused editable field found.`
   来自宿主的 `AccessibilityUITools.setInputText`（`findFocusedNodeId` 返回空），
   也就是点完评论输入框后无障碍树里没有焦点节点。
   **重启 App 即恢复**（实测重启后同一流程连采 6 条无失败）。不是包内代码的问题，
   但连续采集的长跑任务需要知道这一条。
2. **快手有 31 条 `failed`（`invalid_url`）**，全部是 2026-10-14 的，`attempts=0` ——
   那时服务端还没登记快手来源。这类失败是终态、永不重发的，所以这 31 条数据没进库。
   要补的话得把这 31 条 outbox 条目的状态改回 `pending` 再跑一次上报（数据回填，需人工决定）。
