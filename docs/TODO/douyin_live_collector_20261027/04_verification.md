# 04 验证记录

设备：Xiaomi 24094RAD4C / HyperOS / Android 15，1080x2400；抖音 37.8.0；Operit debug `com.ai.assistance.operit.debug` 1.12.2；权限档「调试器（Shizuku）」。

## 已验证

### 编译与安装

- `npx tsc -p my-packages/douyin-live-collector/tsconfig.json` 退出码 0，生成 `dist/main.js`、`dist/packages/douyin_live_collector.js`、`dist/ui/config/index.ui.js`
- `.toolpkg` 推到 `/sdcard/Android/data/com.ai.assistance.operit.debug/files/packages/`，重启后日志：
  `scan candidate finish, phase=external, ... errors=0`、`loadAvailablePackages finish ... containers=16, subpackages=12, errors=0`
- 包管理开关打开，日志 `Successfully enabled toolpkg container: com.taincheng.douyin_live_collector_bundle`

### 配置自检

设置页「测试连接」走 `douyin_live_collector:douyin_live_upload_config_check`：

```
ToolPkg: [douyin_live_collector] 配置自检：HTTP 400，判定 ok，服务端消息 items 条数必须在 1 到 20 之间
```

400 是空批次被服务端拒绝，说明地址、令牌、路径都通。配置与另外三个包共用 `http://<生产IP>:8000`。

### 单条与更新（核心链路）

`douyin_live_collect_rooms` 通过工作流模板「连续采集抖音直播并上报」在真机跑通（`count=5`、`chunk_minutes=5`、关键词 `口腔医院`）：

| 时间 | 事件 | 结果 |
| --- | --- | --- |
| 10-28 11:57 | 首次进房 宠宝圈宠物医院连锁-官方号 | `room_id=7701501837022743332`，本场点赞 5446、在线 13，新增 1 条 |
| 10-28 12:00 | 同一房间再次采到 | 就地更新：点赞 5512、在线 10；records 仍一行 |
| 10-28 12:02 | 同一房间第三次 | 更新：5512 / 13 |
| 10-28 12:15 | 新房间 南宁牙博士口腔(1城6院) | `room_id=7701563810897021747`，0 / 3，新增 1 条 |
| 10-28 12:18 | 同一房间 | 更新：5875 / 39 |
| 10-28 12:19 | 新房间 宠倾心宠物医院直营店 | `room_id=7701552289510181642`，1027 / 2，新增 1 条 |

`records.jsonl` 最终 3 行、3 个不同 `room_id`；更新没有新增行。`collected_at` 保持首次时间，`counts_at` 为最近观测时间。样例行：

```json
{"idempotency_key":"306ce75d-9ef2-454a-96f7-9f3b88ad5d3e","keyword":"口腔医院","url":"https://v.douyin.com/emNtU5Vbi4I/","title":"","author":"宠宝圈宠物医院连锁-官方号","collected_at":"2026-10-28T03:57:27.733Z","source":"douyin_live_app","content_id":"7701501837022743332","content_type":"live","keyword_in_title":false,"promo_hint":true,"like_count":5875,"comment_count":null,"collect_count":null,"viewer_count":39,"interaction_text":"宠宝圈宠物医院连锁-官方号5875本场点赞|39在线观众","counts_at":"2026-10-28T04:18:06.753Z"}
```

### 来源分类复测（10-28 13:51）

直播记录改用自己的 `source=douyin_live_app` 后重新在真机跑了一次，`records.jsonl` 两行都带新值：

| 房间 | content_id | source | 计数 |
| --- | --- | --- | --- |
| 道真米兔口腔 | 7701580234814130994 | `douyin_live_app` | 48 本场点赞 / 1 在线 |
| 蒙恩感恩口腔 | 7701586487879535423 | `douyin_live_app` | 0 / 0 |

这样服务端按 `source` 分表时直播不会落进视频的 `douyin_app`；`content_type=live` 仍保留作记录内标记。

### 分享链路

一次完整流程（12:14）日志：

```
点击「「直播」标签（第一次）」坐标=(760,289)
点击「「直播」标签（第二次）」坐标=(540,289)
第 1 次点击可视直播卡 (540,1208)
已采集第 1 条：https://v.douyin.com/cAKfdsRx3Kk/（room_id=7701563810897021747，主播 南宁牙博士口腔(1城6院)，本场点赞 0、在线 3）
```

- 分享口令从 `service call clipboard` 的 Parcel 里按 UTF-16/UTF-8 解出；直播间评论框 50 字上限的路线已放弃
- 短链每次不同，`fromShareRoomId` 相同：同一房间先后得到 `jJUFWRkp5a0`、`4-qFdq84JCs`、`ud46ucRw29s`、`emNtU5Vbi4I`，`room_id` 都是 `7701501837022743332`

### 列表遍历与结束原因

- 直播列表节点树没有文案、没有 clickable；「直播中」角标是画出来的。改为按布局找封面 `ImageView`（宽约 990、高 ≥ 850）点中心，广告横幅（高约 480）被高度门槛排除
- 标签行惯性会吞掉第一次点击，页面停在「综合」；改为点两次、中间重读节点
- 回列表用 Activity 确认离开 `DetailActivity`，避免分享面板的返回被当成「已回列表」
- 一片日志：`本片结束（直播列表到底）：新增 1 条、更新 1 条`，`progress.json` 的 `last_stop_reason=search_exhausted`

### 上报

`douyin_live_outbox_flush` 日志 `上报结束：批 1，sent 3，failed 0，pending 0`；`outbox.json` 三条均为 `sent`。

## 主播抖音号 author_id（2026-10-30）

### 取数路径复核

| 路径 | 牙贝恩口腔连锁 | 王利梅口腔医院 |
| --- | --- | --- |
| 主播主页 UI：直播间左上角头像 → 简介卡 → 卡内头像 → `UserProfileActivity` | `抖音号：70296714883` | 主页显示「商家认证账号」，整页无「抖音号」节点 |
| 分享短链最终页 `owner.displayId` | `70296714883` | `94974753730`（等于 `shortId`） |

- 主页 UI 路径返回键能回到原直播间（房间标记、更多面板都在），但会漏账号，且每间多约 6 秒，只作为取证，不写进采集流程
- 分享页解析锚点用 `\"displayId\":\"…\",\"withCommercePermission\":`；`withCommercePermission` 只在 owner 对象里出现，全页取第一个 `displayId` 会取到别的用户
- 证据：`evidence/50_profile_douyin_id.png`（主页抖音号）、`evidence/51_live_room_entry.png`（直播间入口）

### 编译与安装

- `npx --no-install tsc -p my-packages/douyin-live-collector/tsconfig.json` 退出码 0
- `python3 tools/toolpkg/debug_toolpkg.py my-packages/douyin-live-collector` 日志：
  `loadAvailablePackages finish ... available=59, containers=16, subpackages=12, errors=0`
- 包清单版本从 0.1.0 升到 0.2.0

### 单间工具（16:38）

在牙贝恩直播间调 `douyin_live_collector:douyin_live_collect_room_link`：

```json
{"success":true,"contentId":"7702353285845224228","authorId":"70296714883","author":"牙贝恩口腔连锁","likeCount":3382,"viewerCount":4}
```

### 批量新增（16:32）

`douyin_live_collect_rooms`（`keyword=口腔医院`、`count=1`、`chunk_minutes=3`）返回
`collected=["https://v.douyin.com/lvcoC6y2y80/"]`、`updated=0`、`stopReason=count`。
`records.jsonl` 新增行：

```json
{"author":"牙贝恩口腔连锁","author_id":"70296714883","content_id":"7702353285845224228","like_count":3382,"viewer_count":3,"content_type":"live","source":"douyin_live_app"}
```

### 老记录补齐（16:34）

把上面这行的 `author_id` 删掉后重跑同一指令：

- 返回 `collected=[]`、`updated=1`、`stopReason=count`，`records.jsonl` 仍是 190 行
- `author_id` 补回 `70296714883`，`collected_at` 保持 `2026-10-30T08:32:00.723Z`，`counts_at` 变为 `2026-10-30T08:34:01.392Z`
- `viewer_count` 从 3 更新到 4，`idempotency_key` 换新

### 工具链修复（宿主侧）

`tools/adb/execute_js.sh` 与 `tools/toolpkg/debug_toolpkg.py` 原来用 applicationId 拼 `.core.tools…` 组件名。
debug 包的 applicationId 带 `.debug` 后缀，但 receiver 类名按 manifest package（`com.ai.assistance.operit`）注册，
广播匹配不到任何 receiver：`am broadcast` 返回成功、脚本不执行、包不安装。已改成完整类名
`com.ai.assistance.operit.core.tools…`，安装 action 改为 `com.ai.assistance.operit.DEBUG_INSTALL_TOOLPKG`，
真机验证可安装、可执行。

## 2026-11-02 直播卡点击修复（抖音改版后的回归）

现象：搜索「投资理财」→ 切「直播」后画面持续上滑，一张卡都不点；3 次后抛
「连续 3 次点击可视直播卡都没有进入直播间」，`describeCurrentPage` 只打印出搜索页顶部
（`投资理财 | 搜索 | 综合 | 视频 | 直播 | …`）。同一台设备、同一抖音版本 37.8.0，
2026-10-30 还能采，说明排版是服务端下发的，跟着账号/批次变。

四条根因，都有真机节点树取证：

| # | 根因 | 证据 | 修法 |
| --- | --- | --- | --- |
| 1 | 卡片封面节点比原来窄 1px，被写死的门槛整类排除 | 封面 `[46,606][1035,1925]` → 宽 **989**，旧条件 `width < 990` 直接跳过；同屏唯一的卡片容器从 `x=0` 开始，被 `x1 < 30` 排除 | 门槛改屏幕比例：宽 ≥ 85% 屏宽、左边距 ≥ 2% 屏宽 |
| 2 | 屏幕高度取错坐标系 | `getDeviceInfo().screenResolution` 给 `1080x2163`（宿主窗口扣掉状态栏 104 + 导航栏 133），节点 `bounds` 是整屏 `1080x2400`；「更多面板 按钮」`[939,2137][1046,2244]` 中心 y≈2190 被判成屏幕外 | 屏幕尺寸改从**无障碍根节点 bounds** 取（`[0,0][1080,2400]`），与所有被比较的节点同一套坐标 |
| 3 | 回列表用 `page.activityName` 判断，拿到的不是 Activity 名 | 直播间里是 `com.lynx.tasm.behavior.KeyboardMonitor`，搜索页是 `androidx.compose.ui.platform.ComposeView`；`includes("DetailActivity")` 永远为假，一次返回键都不按，接着等搜索页 30 秒超时 | 改页面内容判定：搜索标签行在、且房间标记不在，才算回到列表 |
| 4 | 单次读页面失败终止整片 | `Failed to retrieve UI data via accessibility service`（宿主内部只重试三次、间隔 300ms） | `readRoot` 按次数重试（0.5s/1s 退避），用尽才抛 |

补的一条（同次验证中发现）：上滑后卡片常停在 `y=354`（标签行下沿）或被底部裁掉，
旧规则要求整张封面在屏内，会把它们全排除，误报「列表到底」。改成按**与内容区的交集**
判定（交集高 ≥ 30% 屏高）并点交集中心。

验证（真机 24094RAD4C，抖音 37.8.0，Operit debug 1.12.2，关键词 `投资理财`）：

```text
11:19:19 第 1 次点击可视直播卡 (540,1265)
11:19:29 点击卡片后没进直播间，按返回键回列表        ← 首下没进房，按页内容判断后重试
11:19:33 第 2 次点击可视直播卡 (540,933)
11:19:57 已更新第 1 条：…（本场点赞 193000、在线 1217）
11:20:05 第 1 次点击可视直播卡 (540,862)
11:20:37 已更新第 2 条：…（本场点赞 197000、在线 50000）
…
11:22:15 本片结束（达到条数目标）：新增 1 条、更新 4 条，本轮累计新增 7 条
11:22:16 上报结束：批 1，sent 193，failed 4，pending 0
```

同一轮里 `读页面失败第 1/2 次` 出现过两次，重试后继续，没有再中断整片。
10:56–10:58 的另一片是「新增 4 条、更新 1 条」，两片都跑满了 `count=5`。

房间在取链途中结束时（页面变成「直播已结束 / 1.7万人看过 / 去直播频道…」，
房间标记再也不出现），关面板后的等待现在同时接受「直播已结束」面板：
口令已经复制、房间信息在开面板前已读，取链仍然成立。

## 2026-11-02 生产接入事故：base_url 少了端口，21 条记录被判 failed

现象：hotgo 部署到生产、客户端把上报地址改成生产后，后台采集记录里一条直播数据都没有。

取证：

| 请求 | 结果 |
| --- | --- |
| `POST http://<生产IP>/api/v1/records`（客户端实际配置） | **405**，响应体是 `nginx/1.22.1` 的 HTML 页面 |
| `POST http://<生产IP>:8000/api/v1/records`（同一令牌） | **400** `items 条数必须在 1 到 20 之间` |
| `POST http://<生产IP>:8000/...`（不带令牌） | 401 |

结论：生产 nginx 只托管后台页面（80），没有把 `/api` 反向代理给 hotgo（8000）；客户端把
**后台页面地址**当成了 API 地址。请求根本没到 Go 服务，405 是 nginx 直接回的。

放大伤害的是客户端的分类：405 属于 4xx，`sendBatch` 把它归进 `client_error` → 记录被置
`failed`，而契约规定 `failed` 不自动重发。于是整批已采数据被一个**配置错误**永久钉死
（outbox 里 21 条 `failed`，`last_error` 全是 405）。

恢复：

1. `COLLECTOR_BASE_URL` 改为 `http://<生产IP>:8000`（在设备上用脚本 API 写入，
   `getEnv` 确认已生效）；
2. 把 21 条 405 的 `failed` 改回 `pending`（备份后改 outbox.json，推回设备）；
3. `douyin_live_outbox_flush`：`批 2，sent 212，failed 0，pending 0`，服务端全部 accepted。

代码修正（防止同类事故再伤人）：

- `sendBatch`：**401/403/404/405 不再置 failed**，改为 `retryable` 保持 `pending`，并在
  `last_error` 里写明排查方向。配置错误改好之后，积压能自己补发出去；记录不会再因为
  「地址/令牌填错」而永久丢失。其他 4xx 仍是 `failed`（那是记录/契约问题，重发也没用）。
- 设置页自检文案：`path_not_found` 直接点明「base_url 要指向 hotgo API（默认 :8000），
  用 nginx 托管后台时要确认 /api 已转发」，不再只说「没有这个接口路径」。
- 契约文档补上 `base_url` 的定义与 405 的成因（见 `server_api.md`）。

回归验证（真机）：

```text
# base_url 故意改回 http://<生产IP>（坏地址）
发出 1 条 pending → note=上报地址不是 hotgo API（HTTP 405）…
outbox: status=pending attempts=1 last_error=上报地址不是 hotgo API（HTTP 405）…
# 改回 http://<生产IP>:8000
发出同一批 → sent 212，failed 0，pending 0
```

## 未验证

- `stopReason=time` 没有专门跑出来（`count` 已验证：2026-10-30 两次 `count=1` 都返回 `count`；`search_exhausted` 见上）
- 服务端是否真的按 `content_id` 更新了同一行，没有读接口可查；只验证到上报返回 accepted
- 未观测到「两个计数都读不到」的 `skippedUnusable` 分支
- 「直播间在取链途中结束」的新分支只做了节点树取证（「直播已结束」面板在树里），没有在改完之后再撞上一次完整结束流程

## 宿主侧问题（不是包内容错误）

App 重启后，包详情弹窗有时不显示子包/工具/工作流小节（`toolPkgDetails` 为空），但包已启用、工具能通过工作流和设置页正常执行；打开一次「抖音直播采集设置」后运行时初始化。这个问题另开 issue 跟踪，不在本包内修。

## 测试副作用清理

测试用的工作流实例 `62509348-6de9-4683-b5fa-b1f2bb9ca922` 会连续自动点火，验证完后已删除 `Operit/workflow/62509348-...json` 并重启，未再自动运行。包里的模板仍在，用户需要时从「从模板新建」导入。
