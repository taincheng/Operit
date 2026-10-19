# 05 真机测试结论：视频身份用错了，必须先修这个

> **字段已改名**：这份记录写的时候用的字段名是抖音专用的 `aweme_id`。
> 后来按「三个采集包统一身份」的要求改成了平台中立的 `content_id`
> （抖音 aweme_id / 快手 photoId / 小红书 noteId），服务端也从 v1.2.0 中间态升到 v1.3.0。
> **现行方案与验证以 [../collector_content_identity_20261019/](../collector_content_identity_20261019/index.md) 为准**；
> 本文保留当时的过程与真机证据。

2026-10-19 真机跑通了工作流，这次迭代的**计数采集部分是成功的**，但暴露了一个会架空「更新」功能的前提性缺陷。

## 真机测试做了什么

- 在设备上打开（启用）工作流「抖音采集与上报（连续采集测试）」，连续触发按 30–120 秒点火
- 跑了 3 片（chunk 23 / 24 / 25），共新增 17 条记录，全部带三个计数
- 两次上报都成功：`sent 470, failed 0, pending 0`（服务端接受了带新字段的记录）

计数采集本身完全正确，日志里可以直接看到：

```
[douyin_collector] 已采集第 2 条：https://v.douyin.com/FU8VP-6gUK4/（赞 19000、评 410、藏 7375）
```

页面上是 `1.9万`，折算成 `19000`，`interaction_text` 里留着原文。

## 缺陷：短链码不是视频身份

**抖音每次「分享链接」都会生成一个新的短码。** 同一个视频（梅酱紫吃什么｜贵州铁板烧）在 27 分钟内被采到 5 次，
短链码 5 个都不一样，计数完全相同：

```
XWzooKgwlfw  2026-10-19T05:53:59  (2138, 43, 359)
7wVSXsJZQYY  2026-10-19T05:59:50  (2138, 43, 359)
Db8WAF-vPEE  2026-10-19T06:10:52  (2138, 43, 359)
bWeB0vUxlbc  2026-10-19T06:16:39  (2138, 43, 359)
qm7Da46o_LI  2026-10-19T06:20:53  (2138, 43, 359)
```

跑完后的 `records.jsonl`（证据：[evidence_records_after_run.jsonl](evidence_records_after_run.jsonl)）：

| 指标 | 值 |
| --- | --- |
| 记录总数 | 470 |
| 不同的（作者，标题） | **98** |
| 重复行 | **372（79%）** |

后果：

1. **「已采集过的视频跳过」从来没有生效过**（原包 10-09 上线以来一直如此），`collected_total` 数是重复的
2. **本次做的「更新」分支永远走不到**：`videoIdOf(url)` 取自短码，永远匹配不上
3. 服务端按 `(source, video_id)` 认视频的身份**没有意义** —— 短码不复用，每次观测都是「新视频」，
   那条唯一索引约束的是「同一个短码」，等于没约束住同一个视频
4. 线上库里同一个真实视频已经有多行（与本地同源），需要在修好身份之后合并

## 修复依据（已取证）

短链会 302 到含真实 id 的地址，三个不同的短码都落到同一个视频：

```
https://v.douyin.com/XWzooKgwlfw/  ->  .../share/video/7672977497508440818/
https://v.douyin.com/qm7Da46o_LI/  ->  .../share/video/7672977497508440818/
https://v.douyin.com/bWeB0vUxlbc/  ->  .../share/video/7672977497508440818/
```

最终页 HTML 里有干净的可解析标记：

```html
<link data-react-helmet="true" rel="canonical" href="https://www.douyin.com/video/7672977497508440818"/>
```

仓库里已有可用的解析实现：`examples/douyin_download.ts:85` 的 `resolveDouyinUrl`
（OkHttp GET → 解析 `window._ROUTER_DATA` 的 `aweme_id`）。
完整取证见 [evidence_shortlink_redirects.txt](evidence_shortlink_redirects.txt)。

## 怎么修的（已实施，见 06）

1. **客户端**：取到分享链接后，再发一次 HTTP GET 跟随跳转，从最终页的 `rel="canonical"` 里取 `aweme_id`，
   作为记录的新字段 `aweme_id`。单条成本约 1 秒（相比每条 35–40 秒的取链可以忽略）
2. **客户端去重与更新**：`videoIdOf` 改成用 `aweme_id`；`records.jsonl` 里同一个 `aweme_id` 只保留一行
3. **服务端**：视频身份改成 `(source, aweme_id)`，唯一索引跟着换；`video_id` 列保留短码原义不动（加列而不是改语义）
4. **历史数据清理**：本地 `records.jsonl` 按 `aweme_id` 去重（保留最新计数）；
   线上库按合并 SQL 去重后再建 `(source, aweme_id)` 唯一索引
5. 解析失败的记录**不写盘**并如实报错，不能用短码兜底（否则重复行会继续产生）

第 1 步还有一个待验证点：宿主的 `Tools.Net.http` 是否跟随跳转并把最终页 HTML 交回来。
若不跟随，则要用 `examples/douyin_download.ts` 里那套 OkHttp 桥（`client.newRequest()`）。
这一点在动手前先用一个 2 秒的探针脚本确认，不要凭猜。

## 附：怎么在不碰界面的情况下停掉工作流

真机测试期间踩到一条运维经验：无人值守的采集工作流会不断把抖音拉到前台，用 adb 点界面时坐标随时会被抢走
（实测连续几次点到了抖音里）。可靠的停法是调宿主的 `disable_workflow` 工具：

```bash
adb push stop_douyin_workflow.js /sdcard/Android/data/com.ai.assistance.operit.debug/js_temp/stop_wf.js
printf '{}' > /tmp/p.json
adb push /tmp/p.json /sdcard/Android/data/com.ai.assistance.operit.debug/js_temp/p.json
adb shell "am broadcast -a com.ai.assistance.operit.EXECUTE_JS \
  -n com.ai.assistance.operit.debug/com.ai.assistance.operit.core.tools.javascript.ScriptExecutionReceiver \
  --es file_path '<js_temp>/stop_wf.js' --es function_name 'disableDouyinWorkflow' \
  --es params_file_path '<js_temp>/p.json' --es result_file_path '<js_temp>/result.json' \
  --ez temp_file true --ez temp_params_file true"
```

脚本就是本目录的 [stop_douyin_workflow.js](stop_douyin_workflow.js)：列工作流 → 挑名字含「抖音」的 →
`disable_workflow` → 再读一次确认 `enabled=false`。

两个坑：`temp_file` / `temp_params_file` 传 true 时宿主**用完就把文件删掉**，所以每次调用前都要重新 push
两个文件；脚本全程不到 1 秒，不会撞上后台广播的 60 秒 ANR 上限（这一点与采集脚本不同）。

[DONE]（实施与验证记录见 [06_identity_fix_done.md](06_identity_fix_done.md)）
