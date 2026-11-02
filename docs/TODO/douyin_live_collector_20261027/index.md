---
repository: https://github.com/AAswordman/Operit
status: verified
For_Agent: 本计划建立在 2026-10-27 真机实测上（抖音 37.8.0，24094RAD4C，1080x2400）。动手前先读「实测基线」，不要凭猜测推翻它。
---

# 抖音直播间采集器

## 旧状态

`my-packages/` 下已有三个自包含采集包：抖音视频、小红书、快手。都只采**作品/笔记**，没有任何采集直播间的代码。

抖音视频包明确把直播间排除在采集范围之外：

- 固定切「视频」标签，因为「综合」里混着直播与图文
- `my-packages/README.md` 与 `docs/TODO/device_automation_platform_20261008/02_douyin_driver.md` 都写着「直播间既没有分享链接面板，滑动还会直接滑进直播间」

2026-10-27 真机复核：**直播间有分享链接面板**，只是入口在底栏最右的「更多面板 按钮」里，面板项叫「分享链接」。「没有分享链接面板」的旧结论不成立，这一条要改文档。

## 意图

新增第四个自包含采集包 `my-packages/douyin-live-collector`：

1. 按关键词打开抖音搜索
2. 把搜索页顶部标签行往左滑，切到「直播」
3. 点第一张直播卡进直播间
4. 走分享流程取短链：更多面板 → 分享链接 → 关掉「链接已复制成功，去粘贴分享」面板
5. 取回剪贴板里的分享口令，解析出短链，再解析出稳定的直播间身份 `room_id` 与主播抖音号 `author_id`
6. 落盘 `records.jsonl`，建 pending 的 outbox，之后批量上报
7. 返回列表、往下滑一张卡、进下一个直播间，直到条数/时间上限或结果集到底

为什么另开一个包而不是塞进 `douyin-collector`：

- 视频记录与直播记录的内容身份是两套 id 空间（aweme_id 与 room_id），混在一个 `records.jsonl` 里会让「一行一个内容」和去重都说不清
- 直播记录多出 `content_type`、`viewer_count` 两类字段，语义与视频不同
- 视频包已经在跑采集，不动它是零回归；两个包共用同一组上报配置键

## 实测基线（2026-10-27）

设备：Xiaomi 24094RAD4C / HyperOS / Android 15，抖音 37.8.0，1080x2400。证据截图与节点树在 `evidence/`。

### 搜索页与「直播」标签

- 深链 `snssdk1128://search?keyword=口腔医院` 直达搜索结果页，顶部标签行初始可见：综合 / 视频 / 用户 / 团购 / 商品，右侧被单双列图标与筛选按钮压住
- 「直播」在标签行里，初始节点 bounds `[877,258][908,320]`（`text="直播"`，class `Button`，id `android:id/text1`），**被右边缘裁掉**
- 在标签行上从右往左滑一次（`850,285 → 300,285`）后，标签行变成：商品 / 直播 / 音乐 / 话题 / 图文 / 小程序，「直播」bounds `[205,258][289,320]`，中心 `(247,289)`，可点
- 点「直播」后列表加载约 5 秒；首张直播卡的标题在 y≈534，封面从 y≈681 到 y≈1624，点 `(540,1000)` 能进直播间
- 列表底部有明确结束标记文本 `暂时没有更多了`（`evidence/20_longinput.jpg`、`evidence/04_live_list.jpg`）
- 直播列表的预览在持续播放，`uiautomator dump` 报 `ERROR: could not get idle state`，**无法用外部 uiautomator 取证**；采集脚本走无障碍 provider 的实时读取，和视频包读搜索页是同一类通道

### 直播间页面

进房后 Activity 是 `com.ss.android.ugc.aweme/.detail.ui.DetailActivity`，节点树可读（`evidence/07_live_room.xml`）：

| 用途 | 定位 | 实测 bounds / 文案 |
| --- | --- | --- |
| 房间标记 / 本场点赞 | `content-desc` 以「本场点赞」结尾的 Button | `[34,128][463,229]`，`宠宝圈宠物医院连锁-官方号1.2万本场点赞` |
| 主播名 | 同上 desc 去掉末尾计数 | `宠宝圈宠物医院连锁-官方号` |
| 在线观众 | `content-desc` 形如 `6在线观众` 的 Button | `[886,157][959,199]` |
| 更多面板入口 | `content-desc` 以「更多面板」开头 | `[939,2137][1046,2244]`，点中心 `(992,2190)` |
| 分享链接面板项 | `text="分享链接"` 的 Button | 位置随面板内容变化：无联系人行时 `[445,1799][659,1847]`，有联系人行时 `[231,1799][445,1847]`，还有 `[321,1390]` 的更高版式。**必须按文案定位，不能写死坐标** |
| 复制成功后的分享面板 | `text="链接已复制成功，去粘贴分享"` 的 TextView（id `zuf`） | `[45,1644][591,1706]`，另有全屏 `关闭` Button（id `3bs`） |
| 评论输入框 | `EditText`，空态 desc `说点什么...` | `[68,2137][385,2244]`，**最多 50 字** |

实测三次点击 `分享链接` 的结果：

- 点错坐标（点到联系人/其它面板项）时不会复制，只会打开「分享给好友」面板
- 点中时剪贴板被写入分享口令，并弹出「链接已复制成功，去粘贴分享」面板
- 因此**以「复制成功面板是否出现」作为复制成功的判据**，坐标不参与

### 剪贴板与直播间身份

复制的口令原文（从 Parcel 还原）：

```
2- #在抖音，记录美好生活#【宠宝圈宠物医院连锁-官方号】正在直播，来和我一起支持Ta吧。复制下方链接，打开【抖音】，直接观看直播！ https://v.douyin.com/0_wFCWMBhU4/ 4@5.com :2pm
```

- 短链形如 `https://v.douyin.com/0_wFCWMBhU4/`，**每次分享都会变**（同一房间两次分享得到 `0_wFCWMBhU4` 与 `LRiifJrGLeg`）
- 短链 302 到 `https://webcast.amemv.com/douyin/webcast/reflow/<room_id>?...`，两个不同短链都落到 `reflow/7701255266029194047`
- 跟随 302 后的页面里还有 `fromShareRoomId="<room_id>"`，两个样本页都有；`"roomIdStr"` 只在其中一个样本页出现，不能单独依赖
- 结论：`content_id` = `room_id`，解析方式 = `Tools.Net.http` GET 短链（默认跟随 302）拿最终页，取 `fromShareRoomId="(\d+)"`

### 主播抖音号 `author_id`（2026-10-30 真机）

两条路都实测过，最终只保留分享页解析：

1. **主播主页 UI**：直播间左上角头像 → 主播简介卡 → 卡内左上角头像 → `UserProfileActivity`，昵称下面是「抖音号：70296714883」。返回键能回到原直播间（房间标记、更多面板都在）。
   - 但**不是所有账号都露抖音号**：`王利梅口腔医院` 主页在同样位置显示「商家认证账号」，整页没有「抖音号」文本节点。按 UI 采会漏，且每间多约 6 秒、要处理简介卡的展开/收起位置，不采用。
2. **分享页 owner.displayId**（采用）：短链最终页的房间 JSON 里，owner 对象有 `"displayId":"70296714883"`，与主页显示的抖音号**完全一致**；`王利梅口腔医院` 是 `"displayId":"94974753730"`（等于它的 `shortId`）。
   - 解析锚点用紧跟其后的 `"withCommercePermission"`：这个键只在 owner 对象里出现，页面里别的用户也有 `displayId`（空串或他人），不能全页取第一个。
   - 取链本来就要 GET 这个页面，所以 `author_id` 是零额外请求、零额外点击。

**直播间评论输入框最多 50 字**：把 114 字的口令粘进去后 `EditText.text` 恰好是前 50 字，URL 在 50 字之后，因此**不能用直播评论框回读剪贴板**（视频包正是用评论框回读的）。这是本包与视频包最大的实现差异。

### 剪贴板读取方式（本包的关键取舍）

Android 10 起后台应用读不到剪贴板。实测（`run-as` 用 Operit 自己的 UID 调 `service call clipboard`）：

- Operit 在前台：读得到完整口令
- 抖音在前台：返回空 Parcel

而 Operit 自身的 `READ_CLIPBOARD` appop 是 allow，仍然受前台限制。

所以取链时**短暂把 Operit 拉到前台读剪贴板，再切回抖音**。实测直播间在两个 App 之间来回切不会丢：

- 切走前 `DetailActivity`、切回后仍是同一个 `DetailActivity`（同一 task 同一实例）
- 房间画面、主播名、本场点赞都在，能继续正常操作

宿主没提供「当前 App 包名」的接口，子包用 `/proc/self/maps` 里 `base.apk` 的路径推导宿主包名：

```
/data/app/~~xxx/com.ai.assistance.operit.debug-yyy==/base.apk
```

`/proc/self/cmdline` 里也有包名，但含 NUL 字节会被宿主的文本判定挡掉；`maps` 是纯文本，`read_file_full` 能读。

### 节点树里没暴露的东西

- 直播间的「房间标题」不是独立节点：画面上那行大字是主播自己的贴片内容，节点树里没有等价的标题字段。记录里的 `title` 因此留空字符串，`author` 用分享口令里的主播名
- 分享面板里的「微信/朋友圈/微博」是固定目标，不参与取链
- 剪贴板内容不在任何节点里，只能读剪贴板

## 设计

### 包结构

与三个现有包同构、自包含：

```
my-packages/douyin-live-collector/
├── manifest.json
├── tsconfig.json
├── resources/workflow_collect_and_upload.json
├── src/
│   ├── main.ts
│   ├── packages/douyin_live_collector.ts
│   └── ui/config/index.ui.ts
└── dist/                 # 编译产物，manifest 入口指向这里
```

- 包 ID：`com.taincheng.douyin_live_collector_bundle`
- 子包 ID：`douyin_live_collector`
- 配置目录：`/sdcard/Download/Operit/plugins/com.taincheng.douyin_live_collector_bundle/`
- 上报配置键沿用中立的 `COLLECTOR_BASE_URL` / `COLLECTOR_TOKEN`，与另外三个包共用

### 对外工具

| 工具 | 作用 |
| --- | --- |
| `douyin_live_collect_room_link` | 取当前打开直播间的分享短链、`room_id`、主播抖音号 `author_id`、主播名、本场点赞、在线观众、推广标记。必须在直播间页面调用，不自己导航 |
| `douyin_live_collect_rooms` | 按关键词进「直播」标签，从第一张卡开始逐个进房取链；新 `room_id` 追加一行，已知 `room_id` 就地更新本场点赞/在线观众并补 `author_id`；按条数/时间/结果集到底结束本片 |
| `douyin_live_outbox_flush` | 把 pending 记录按每批 20 条上报 |
| `douyin_live_outbox_status` | 统计 pending/sent/failed 与文件位置 |
| `douyin_live_upload_config_check` | 空批次自检上报地址与令牌 |

### 逐条流程

```
ensureDouyinForeground
→ 深链搜索，等「综合」
→ 标签行左滑，点「直播」，等列表
→ 点第一张卡进房
→ 读主播名/本场点赞/在线观众/推广标记
→ 点「更多面板」→ 按文案点「分享链接」
→ 等「链接已复制成功，去粘贴分享」→ 返回键关面板
→ shell 读剪贴板（service call clipboard，不切前台，直播间不丢）
→ 解析短链 → GET 短链跟随 302 → fromShareRoomId → room_id，owner.displayId → author_id
→ room_id 已在 records.jsonl：补 author_id，有观测到本场点赞/在线观众就一并更新；否则跳过
→ 新 room_id：追加记录 + pending outbox
→ 返回键回搜索列表 → 检查「暂时没有更多了」
→ 列表上滑一张卡 → 按布局找可视封面 → 点中心 → 房间标记出现 → 下一条
```

### 去重与更新语义

2026-10-27 初稿写的是「已存在就跳过」，2026-10-28 用户明确要求改为**有数据就更新**：已采集过的直播间再次遇到时，更新本场点赞/在线观众，让服务端看到同一 `room_id` 的最新计数。落地规则：

- 只有这次真的读到 `like_count` / `viewer_count` 才覆盖对应字段；没读到的项保持原值，不能把上次的数字清掉
- `author_id` 每次一定能读到，直接覆盖；0.1.x 的老记录靠再次采到同一个 `room_id` 补上
- 抖音号没变、两个计数也都没读到：不写、不建 outbox，计入 `skippedUnusable`
- 更新时换新的 `idempotency_key`（服务端按 `device + idempotency_key` 去重，沿用旧键会被判「已入库」而不更新），并删掉旧 outbox 条目
- `collected_at` 保持首次采集时间，`counts_at` 换成这次观测时间
- 不做时间序列：每次更新只留最新值，历史值由服务端按 `content_id` 自己决定是否归档

失败时如实报错，不写半条记录。

### 分片与续跑

与三个现有包一致：脚本硬超时 30 分钟，一次运行只做一片；`count` 是**新增 + 更新**的总预算（与视频包 0.3.0 起一致），`chunk_minutes` 默认 18、最多 20，先到者结束；结束写 `progress.json`。

续跑靠 `records.jsonl` 里的 `content_id`，不靠列表位置：搜索列表的排序会变，按位置续跑不可靠（视频包已有同样的结论）。

### 结束原因

| stopReason | 条件 |
| --- | --- |
| `count` | 本片处理（新增 + 更新）达到 `count` |
| `time` | 到 `chunk_minutes` |
| `search_exhausted` | 列表出现「暂时没有更多了」，或连续多次滑不出下一个可进房的卡片 |

## 验证计划

1. TypeScript 编译通过（`npx tsc -p my-packages/douyin-live-collector/tsconfig.json`）
2. 装到真机，在直播间里单跑 `douyin_live_collect_room_link`，返回的短链、`room_id`、主播名与本文件「实测基线」一致
3. 同一房间连跑两次，短链不同、`room_id` 相同
4. 跑一次 `douyin_live_collect_rooms`（`count=1`），`records.jsonl` 多一行，outbox 多一条 pending
5. 再跑一次同一个房间，`records.jsonl` 仍是一行，`like_count` / `viewer_count` 更新、`collected_at` 不变、`counts_at` 变
6. 跑 `douyin_live_outbox_flush`，服务端接受后状态为 sent
7. 验证列表到底时 `stopReason=search_exhausted`
8. 验证列表上滑一张卡后能进到不同的房间（`room_id` 不同）

结果写入 [04_verification.md](04_verification.md)。未验证的项不要标 DONE。

## 分步文件

- [01_driver.md](01_driver.md)：驱动、定位规则、失败处理
- [02_record_store_and_upload.md](02_record_store_and_upload.md)：记录模型、身份、outbox
- [03_package_and_docs.md](03_package_and_docs.md)：包脚手架、设置页、工作流模板、文档改动
- [04_verification.md](04_verification.md)：验证记录
