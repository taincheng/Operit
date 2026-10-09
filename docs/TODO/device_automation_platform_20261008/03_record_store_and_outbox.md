# 记录落地与 outbox 上报

## 旧状态

落地只有文件工具，`Tools.Files.write(path, content, append, 'android')`，见 `app/src/main/java/com/ai/assistance/operit/core/tools/javascript/JsTools.kt`。插件配置目录由 `getPluginConfigDir(id)` 提供，落到 `/sdcard/Download/Operit/plugins/<id>`。

仓库里有可照抄的写后缓存范式，见 `examples/qqbot/src/shared/qqbot_state.ts` 的 dirty 加 flush 结构。

上报走 `Tools.Net.http`，最终到 `http_request`。要注意三点。

- 4xx 与 5xx 仍然返回 `success=true`，必须自查 `statusCode`，见 `app/src/main/java/com/ai/assistance/operit/core/tools/defaultTool/standard/StandardHttpTools.kt`
- 没有状态级重试与退避
- 每次调用新建 OkHttpClient，没有连接复用与并发闸门

仓库没有 outbox、幂等键与去重设施。

## 上报契约

服务端尚未实现，本契约由客户端与服务端共同遵守，两边都按此实现。

交给服务端开发的版本见 [采集上报服务端接口](server_api.md)，内容更完整，包含实现检查清单与联调方法。本文下面的部分是契约的原始出处。

传输：

- 方法 POST，地址 `{base_url}/api/v1/records`
- 请求头 `Content-Type: application/json; charset=utf-8` 与 `Authorization: Bearer <token>`
- `base_url` 与 `token` 存放在插件配置目录，不进代码库
- 超时取 connect 15 秒，read 30 秒，write 30 秒
- 批量条数默认 20

请求体：

```json
{
  "batch_id": "<uuid>",
  "client": { "device": "24094RAD4C", "app_version": "1.12.1+6" },
  "items": [
    {
      "idempotency_key": "<uuid>",
      "keyword": "美食",
      "url": "https://v.douyin.com/xxxx/",
      "share_text": "0.05 复制打开抖音，看看【作者的作品】标题… aAG:/ H@V.yt 02/23 :3pm",
      "title": "在深圳坂田吃到了贵州铁板烧…",
      "author": "梅酱紫吃什么",
      "collected_at": "2026-10-08T15:00:00+08:00",
      "source": "douyin_app"
    }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `batch_id` | 本次批量上报的标识，供服务端做日志关联 |
| `client.device` | 设备型号，用于区分多台设备 |
| `client.app_version` | 客户端版本 |
| `items[].idempotency_key` | 客户端生成的 UUID，服务端的去重键 |
| `items[].keyword` | 采集时使用的搜索主题 |
| `items[].url` | 从分享口令中抽取出的短链 |
| `items[].share_text` | 分享流程产生的原文，含口令文案 |
| `items[].title` | 详情页读到的标题，可能为空 |
| `items[].author` | 详情页读到的作者，可能为空 |
| `items[].collected_at` | ISO8601 带时区 |
| `items[].source` | 固定为 `douyin_app`，为将来的其他来源留位 |

响应体：

```json
{
  "accepted": ["<idempotency_key>"],
  "rejected": [{ "key": "<idempotency_key>", "reason": "duplicate" }]
}
```

一批内允许部分成功，客户端按 key 逐条置状态。

状态判定，宿主对 4xx 与 5xx 都返回 `success=true`，因此判定只能基于 `statusCode`：

| 情况 | 客户端动作 |
| --- | --- |
| 200 或 202 且响应体可解析 | 按 `accepted` 置 `sent`，按 `rejected` 置 `failed` 并记录 `reason` |
| 429 | 保持 `pending`，按 `Retry-After` 或固定间隔退避 |
| 5xx、超时、网络错误 | 保持 `pending`，尝试次数加一，按退避重试 |
| 其他 4xx | 置 `failed`，记录 `statusCode` 与响应体前若干字节。契约或客户端错误，重试无意义 |
| 响应体无法解析 | 置 `failed`，记录原始响应片段 |

幂等：

- 每条的幂等键在采集时生成，重发时保持不变
- 服务端按 `client_id` 与 `idempotency_key` 去重，重复请求计入 `accepted` 或 `rejected` 都可以，但不能重复入库
- 客户端不保证不重发，这是设计前提，不是异常

重试节奏：

- outbox 只对 `pending` 重发，`failed` 不自动重试
- 尝试次数与最后一次错误写入 `outbox.json`，便于排查
- 重发由工作流周期驱动，默认 15 分钟一轮，与 `WorkflowScheduler` 的间隔下限一致

## 意图

记录存储：

- `records.jsonl` 逐行追加，字段与上报请求体中的 `items` 元素一致
- 去重键取分享链接归一化后的视频标识，重复采集直接跳过并计数

上报：

- `outbox.json` 维护每条记录的状态，取值只有 `pending`、`sent`、`failed`
- 批量发送，串行执行，因为 QuickJS 是单线程

不写隐式兜底：不做「失败就换协议」「失败就静默丢弃」。`pending` 就是 `pending`，状态可查可重放。

## 期待结果

采集与上报解耦，脚本被杀或超时都不会丢记录，重放安全。

## 验证

本地起 mock 服务端，按上面的契约实现，逐步验证。mock 服务端脚本是 [mock_server.py](mock_server.py)，行为由 `/tmp/douyin_mock_mode.txt` 切换，取值为 `accepted`、`partial`、`error500`、`error400`、`throttle`。

跑法：

1. `python3 docs/TODO/device_automation_platform_20261008/mock_server.py`，它监听 `127.0.0.1:8765`
2. `adb reverse tcp:8765 tcp:8765`，让手机的 `127.0.0.1:8765` 打到开发机
3. 在插件配置目录写 `config.json`，内容是 `{"base_url": "http://127.0.0.1:8765", "token": "test-token-abc"}`

（本步骤验证当时配置放在插件配置目录的 `config.json`；05 步已把配置迁到 App 内的设置页与环境变量，照本文操作时按 05 步的新位置填。）
4. 从包详情运行 `douyin_outbox_flush` 与 `douyin_outbox_status`，观察 `/tmp/douyin_mock_requests.jsonl` 与设备上的 `outbox.json`

2026-10-08 实测结果，全部通过：

| 用例 | 期望 | 实测 |
| --- | --- | --- |
| 全部 accepted | 置 `sent`，幂等键互不相同 | 3 条全部 `sent`，请求头与请求体字段正确 |
| 服务端 500 | 保持 `pending`，尝试次数递增 | 3 条 `pending`，`attempts=1`，`last_error` 记录 HTTP 500 |
| 服务端 400 | 置 `failed` 并记录 statusCode | 3 条 `failed`，`last_error` 记录 HTTP 400 |
| 部分成功 | 只有 accepted 的置 `sent` | 1 条 `sent`，2 条 `failed`（服务端拒绝） |
| 429 限流 | 保持 `pending`，停止本轮 | 3 条 `pending`，未继续发送后续批次 |
| 重放同一批 | 服务端按幂等键去重 | 客户端重发同一批，mock 判定 3 条全部为重复 |
| 真实采集后上报 | 记录落入 `records.jsonl` 并上报 | 4 条真实记录一批上报成功，全部置 `sent` |

未覆盖：

- 连续命中已采集视频时的跳过计数。搜索首屏结果会浮动，实测两轮采到的是不同视频，`skippedDuplicates` 始终为 0，这条分支只有代码审查没有实测

[DONE]
