# 自己的业务包放这里

这个目录放本项目使用者自己的业务代码，不属于上游仓库的功能。它不参与 APK 打包，所以改这里不需要重新编译 Android 工程，也不影响与上游同步代码。

## 和 examples/ 的区别

`examples/` 是上游的工具包与示例集合，同时被 `tools/example_packages/sync_example_packages.py` 当作 APK 内置包的来源。一旦某个包进了那个白名单，它就会随 APK 出厂，每次改动都要重建 APK。

本目录不登记白名单，因此只作为源码存放与版本管理的位置。

## 目录结构

```text
my-packages/
├── douyin-collector/     抖音采集
│   ├── manifest.json   包清单，声明包 ID、入口与子包
│   ├── tsconfig.json   编译配置，输出到 dist/
│   ├── resources/      工作流模板等资源
│   ├── src/            TypeScript 源码
│   │   ├── main.ts     包入口，导出 registerToolPkg，登记工具箱设置页
│   │   ├── packages/   子包，每个文件用 METADATA 块声明工具
│   │   └── ui/         设置页（compose_dsl）
│   └── dist/           编译产物，manifest 里的入口指向这里
├── douyin-live-collector/ 抖音直播采集，结构与抖音包同构，driver 独立
├── xhs-collector/        小红书采集，结构与抖音包同构
└── kuaishou-collector/   快手采集，结构与抖音包同构（遍历方式与小红书一致）
```

四个包都是**自包含**的：driver、记录落地、outbox 上报、分片续跑、设置页、工作流模板都在各自包里。

出现第三个 driver（快手）时重新评估过「要不要抽公共 kernel」，结论是**仍然不抽**：三包之间同构的只有记录/outbox/上报那一层（约 400 行），driver 部分差异很大，抽出来省不下多少；而抽 kernel 要动到两个已经在跑采集的包，代价是两次回归。理由与差异清单见 `../docs/TODO/kuaishou_collector_20261014/index.md`。

## 包内工具

`douyin-collector` 对外提供 6 个工具。

| 工具 | 作用 |
| --- | --- |
| `douyin_collect_share_link` | 取出当前打开的视频的分享链接、真实内容ID（content_id）与点赞/评论/收藏三个计数，需要在视频详情页调用，不会自己导航 |
| `douyin_collect_share_links` | 采集搜索结果：切到「视频」标签，逐条取链、解析真实内容ID并读三个计数，追加到 records.jsonl。一个视频一行，再次采到同一个视频时就地更新那一行的计数。一次运行只做一片 |
| `douyin_outbox_flush` | 把 pending 记录按每批 20 条上报到服务端，failed 不自动重发 |
| `douyin_outbox_status` | 查看 pending、sent、failed 各多少条 |
| `douyin_upload_config_check` | 自检上报地址与令牌是否可用，不会写入任何数据 |
| `douyin_migrate_upload_config` | 把早期版本的 `DOUYIN_` 前缀旧键搬到中立键并清空旧键。设置页加载时自动调用，幂等 |

`douyin-live-collector` 提供 5 个工具，前缀 `douyin_live_`。

| 工具 | 作用 |
| --- | --- |
| `douyin_live_collect_room_link` | 取出当前打开直播间的分享链接、`room_id`、主播抖音号（`author_id`）、主播名、本场点赞与在线观众，需要在直播间详情页调用，不会自己导航 |
| `douyin_live_collect_rooms` | 采集搜索结果：切到「直播」标签，逐个进房取链并解析 `room_id` 与主播抖音号，追加到 records.jsonl。一个直播间一行；再次采到同一个 `room_id` 时就地更新本场点赞/在线观众并补 `author_id`。一次运行只做一片 |
| `douyin_live_outbox_flush` | 把 pending 记录按每批 20 条上报到服务端，failed 不自动重发 |
| `douyin_live_outbox_status` | 查看 pending、sent、failed 各多少条 |
| `douyin_live_upload_config_check` | 自检上报地址与令牌是否可用，不会写入任何数据（与另外三个包共用 `COLLECTOR_BASE_URL` / `COLLECTOR_TOKEN`） |

`xhs-collector` 提供 6 个工具，前缀换成 `xhs_`。

| 工具 | 作用 |
| --- | --- |
| `xhs_collect_share_link` | 取出当前打开的笔记的分享链接、content_id 与点赞/评论/收藏三个计数，需要在笔记详情页调用，不会自己导航 |
| `xhs_collect_share_links` | 采集搜索结果：读一屏可见的笔记卡片，逐张点进详情取链、解析计数再返回列表，采完一屏往下滚一屏；同一篇笔记再次遇到时刷新那一行的计数 |
| `xhs_outbox_flush` | 同抖音 |
| `xhs_outbox_status` | 同抖音 |
| `xhs_upload_config_check` | 同抖音 |
| `xhs_migrate_upload_config` | 同抖音（待迁移的键同样是抖音包留下的 `DOUYIN_` 前缀键） |

`kuaishou-collector` 同样 6 个工具，前缀换成 `ks_`。

| 工具 | 作用 |
| --- | --- |
| `ks_collect_share_link` | 取出当前打开的作品的分享链接，需要在作品详情页调用，不会自己导航；广告详情页没有分享入口，如实报错 |
| `ks_collect_share_links` | 采集搜索结果：切到「视频」标签，逐张点进详情取链再返回列表，采完一屏往下滚一屏 |
| `ks_outbox_flush` | 同抖音，但被拒记录的 `last_error` 会带上服务端给的 `reason` |
| `ks_outbox_status` | 同抖音 |
| `ks_upload_config_check` | 同抖音 |
| `ks_migrate_upload_config` | 同抖音（待迁移的键同样是抖音包留下的 `DOUYIN_` 前缀键） |

记录、状态与进度存在插件的配置目录里：

- 抖音：`/sdcard/Download/Operit/plugins/com.taincheng.douyin_collector_bundle/`
- 抖音直播：`/sdcard/Download/Operit/plugins/com.taincheng.douyin_live_collector_bundle/`
- 小红书：`/sdcard/Download/Operit/plugins/com.taincheng.xhs_collector_bundle/`
- 快手：`/sdcard/Download/Operit/plugins/com.taincheng.kuaishou_collector_bundle/`

`records.jsonl` 是采集结果，**一个内容一行**；`outbox.json` 是每条的上报状态与尝试次数；`progress.json` 是分片进度。

抖音 0.5.0、快手 0.3.0、小红书 0.3.0 起，每一行都带 `content_id`（内容在该平台上的真实身份，见下）。
抖音包另外还带三个互动计数（`like_count` / `comment_count` / `collect_count`，页面没显示时为 `null`，与 0 不同）、
计数是哪一刻观测到的 `counts_at`，以及命中的互动条原文 `interaction_text`。
`collected_at` 是**首次**采到这个内容的时间，更新计数时不变。

小红书包从 **0.4.0** 起也带这三个计数与 `counts_at` / `interaction_text`，但来源与抖音不同：
计数取自解析 `content_id` 的那一次分享页请求里的 `interactInfo`（`likedCount` / `collectedCount` / `commentCount`），
不依赖详情页 UI，也不额外发请求。两点数据口径要注意：

- 页面在计数 ≥ 10 万时只写「10万+」，折算成整数只能当下限（100000）；`interaction_text` 保留原文。
- 页面用空串表示 0（实测某条 `commentCount=""`，同页 `commentData.commentCount` 为 0），所以空串写成 0，不是 `null`。

0.4.0 之前的记录没有计数字段。它们**不会被主动重取**，与抖音一致：等正常采集再次遇到同一篇笔记时，
就地补上三个计数并重新置为 pending，服务端按 `(source, content_id)` 更新同一行（老行没有 `content_id` 时
靠短链的 `video_id` 唯一键认出来）。不做一次性批量回填。

快手包暂时没有这三个字段（没有需求），记录结构与 outbox 机制与抖音相同。

## 三个 driver 的关键差异

采集流程的差异都在各自子包脚本的注释里写清楚了，这里只列要点：

| 项 | 抖音 | 小红书 | 快手 |
| --- | --- | --- | --- |
| 搜索入口 | `snssdk1128://search?keyword=` | `xhsdiscover://search/result?keyword=` | `kwai://search?keyword=` |
| 列表 | 先切「视频」标签，避开综合标签里的直播 | 没有类型标签，固定在「全部」，靠卡片分类排除商品/直播卡 | 切「视频」标签；该标签**自绘、无文案**，只能按标签容器里第 3 个可点击 View 定位 |
| 遍历 | 详情页内上下滑，按页约束 | **每条回列表**：视频笔记详情页下滑进的是推荐流，不是搜索结果 | **每条回列表**：详情页是连续信息流，滑到结果用尽会接推荐流，而详情页没有可靠的「还在结果集里」标记 |
| 分享入口 | 底栏分享按钮 | 图文=右上角 `moreOperateIV`；视频=右上角 desc `分享` | 右侧互动条 `forward_button`，desc 前缀 `分享` |
| 广告/咨询页 | —— | 商家号笔记底栏是「立即咨询」，没有评论输入框，链接读不出来：整条跳过并继续下一张，计入 `skippedAds` | 树里出现 `ad_card_container_root`、右侧互动条整条不在：整条跳过，计入 `skippedAds` |
| 版式对不上的卡片 | —— | 详情页形态认不出来、分享入口/面板项/回读落点找不到：跳过该卡继续下一张，计入 `skippedUnusable`；连着 5 张都这样则中断本片 | 同小红书 |
| 面板项 | `分享链接` | `复制链接`（点完面板自行关闭） | `复制链接`（点完面板自行关闭；面板项顺序会变，且有时被推到屏幕外，需要按文案定位 + 把面板往上带） |
| 剪贴板回读 | 详情页评论输入框 | 评论入口 → `NoteCommentActivity` 的 `EditText` | 评论入口 → **原 Activity 内联展开**的 `EditText id=editor` |
| 短链 | `v.douyin.com` | `xhslink.cn` | `v.kuaishou.com` |
| 推广标记 | 页面上的推广词 | 卡片上的 `广告` 角标 | 卡片上的 `广告` 角标 |
| 上报 source | `douyin_app` | `xiaohongshu_app` | `kuaishou_app` |

定位规则、实测基线与失败处理分别见 `../docs/TODO/xiaohongshu_collector_20261012/` 与 `../docs/TODO/kuaishou_collector_20261014/`。

快手那一侧还有一条通用坑，改任何快手 driver 都要知道：**无障碍 provider 的树会把上一页（「综合」）的节点留着，`bounds` 退化成 `x2 < x1`**。所有按 `resource-id` / `content-desc` 取节点的定位器都必须过一遍边界有效性，否则会把「已经切过去了」判成「没切过去」。

## 抖音直播 driver

直播与视频共用搜索入口与上报链路，但页面结构完全不同，单独一个包：

| 项 | 做法 |
| --- | --- |
| 搜索标签 | 同 `snssdk1128://search?keyword=`；标签行左滑到「直播」可点，**点两次**（第一次常被惯性滚动吞掉） |
| 直播列表 | 外部 `uiautomator dump` 读不到；卡片的节点形态会随抖音下发的版式变（2026-10-28 全空 text、`clickable=false`；2026-11-02 同一台机器上「直播中」角标与卡片 desc 又出现在树里，卡片容器 `clickable=true`）。不能依赖任一版式的文案：按布局找封面，**按与内容区的交集**判定可点（封面横向 ≥ 85% 屏宽且不贴左边、交集高 ≥ 30% 屏高），点交集中心。不能要求整张封面都在屏内——上滑后卡片常停在标签行下沿或被底部裁掉，那样会误判成「列表到底」 |
| 进房 | 出现 `content-desc` 以 `本场点赞` 结尾的 Button；等 20 秒 |
| 回列表 | 返回键后用**页面内容**确认：搜索标签行在、且房间标记不在，才算回到列表。不能读 `page.activityName`——抖音上报的是窗口根类名（直播间实测 `com.lynx.tasm.behavior.KeyboardMonitor`，搜索页实测 `androidx.compose.ui.platform.ComposeView`），拿它判断会一次返回键都不按 |
| 分享 | 底栏「更多面板」→ 面板项按文案「分享链接」；面板高度变化，不能写坐标 |
| 剪贴板 | 直播间评论框上限 50 字，口令里的 URL 在第 80 字后，**不能**像视频那样粘贴回读。改用 `Tools.System.shell` 调 `service call clipboard`，解 Parcel 的 UTF-16/UTF-8 文本；因此本包需要**调试器（Shizuku）**权限档，另外三个包仍只需无障碍 |
| 身份 | 短码每次分享都变；GET 短链跟 302 到 `webcast.amemv.com/douyin/webcast/reflow/<room_id>`，取页面里的 `fromShareRoomId="<id>"` 作为 `content_id`。同一房间两次分享短码不同、`room_id` 相同。同页 owner 里的 `displayId` 就是主播抖音号，存进 `author_id`，解析锚点是紧跟其后的 `withCommercePermission` |
| 更新 | 已入库的 `room_id` 就地更新本场点赞/在线观众并覆盖 `author_id`（老记录因此补齐）；没读到的计数保持原值，抖音号没变且计数都没读到则跳过不写。`count` 是新增 + 更新的总预算 |
| 到底 | 列表出现「暂时没有更多了」；直播结果会随时间变化，同一关键词不同轮次看到的房间数可能不同 |
| 上报 source | `douyin_live_app`，与视频包的 `douyin_app` 分开；hotgo 采集插件 v1.4.1 起在抖音域名下保留这个声明（此前会被域名反查覆盖成 `douyin_app`）。`content_type=live` 只是记录内辅助标记 |

实测记录、设备基线与失败复盘见 `../docs/TODO/douyin_live_collector_20261027/`。

## 分片与续跑

脚本硬超时 30 分钟且被杀时没有保存机会，所以一次运行只做一片：`count` 是本片的**处理目标（新增 + 更新）**，`chunk_minutes` 是本片时间上限，默认 18 分钟、最多 20 分钟，两者先到者结束本片。结束时会写 `progress.json`。

抖音包里「更新一条已见过的视频」与「采一条新视频」是同一个 35–40 秒的取链流程（视频标识只能从分享链接里取），
所以两者共用一个条数预算，`count` 从 0.3.0 起是「本片最多处理多少条视频」而不是「最多新增多少条」。

`progress.json` 记录的是进度与轮次，不是列表位置。搜索结果首屏会浮动，按位置续跑不可靠；续跑靠的是 records.jsonl 里的 `content_id` 去重。所以下一片照常从头进列表，不会被重复采集，也不会从头重来一遍已完成的量。

## 内容身份 `content_id`

**短链码不能当身份**。抖音与快手每次「分享链接」都会生成一个新的短码，同一个内容采两次就是两个「内容」。
2026-10-19 真机实测：

| 平台 | 短码稳定性 | 修复前的重复行 |
| --- | --- | --- |
| 抖音 | 同一视频 27 分钟内 5 个不同短码 | 470 条里 372 条重复（79%）|
| 快手 | 同一作品 3 个短码都指向同一个 photoId | 562 条里 409 条重复（72%）|
| 小红书 | 短码稳定（321 条只重复 1 条，且是同秒重复写）| 1 条 |

所以三个包（抖音 0.5.0、快手 0.3.0、小红书 0.3.0）都在取到分享链接后再解析一次平台真实 id，存进 `content_id`：

| 平台 | 解析来源 | 规则 |
| --- | --- | --- |
| 抖音 | 跳转后页面的 `<link rel="canonical" href="https://www.douyin.com/video/<id>"/>` | 纯数字 |
| 抖音直播 | 短链 302 后的 `webcast.amemv.com` 页面里的 `fromShareRoomId="<id>"` | 纯数字 `room_id` |
| 快手 | 跳转后页面 JSON 的 `"photoId":"<id>"` | 数字 |
| 小红书 | 跳转后页面 JSON 的 `"noteId":"<id>"` | 24 位十六进制 |

实现方式都是 `Tools.Net.http` GET 一次分享短链（实测会自动跟随 302），多花约 1 秒。

抖音直播包从 **0.2.0** 起额外带 `author_id`（主播抖音号），取自同一份分享页 owner 对象的 `displayId`，不额外发请求、不额外点页面。2026-10-30 真机：牙贝恩的 `displayId=70296714883` 与主播主页显示的抖音号一致；`王利梅口腔医院` 这类账号主页只显示「商家认证账号」、没有抖音号节点，按主页 UI 采会漏，所以只走分享页。

解析失败时**如实报错、不写这条记录**，不回退用短码当身份——退回去等于继续往库里写重复行。
解析规则的取证与可重跑断言见 `../docs/TODO/collector_content_identity_20261019/`。

抖音包从 **0.3.0** 起，命中库里已有的视频**不再跳过**：重新取一次链与三个计数，就地更新那一行（`counts_at` 换成这次的时间，`idempotency_key` 换新，`collected_at` 不动），服务端按视频身份更新同一行。
只有**本片内已经处理过**的视频才跳过（翻页重叠时会遇到），`skippedDuplicates` 统计的是这一种。
跳过会造成「连续 10 条都处理过」时结束本片，结束原因是 `duplicates`。
小红书包从 **0.4.0** 起与抖音一致：再次遇到同一篇笔记就地更新计数（`updated` 统计更新条数）；快手包仍旧是「库里已有就跳过」。

运行期间要保持应用在前台、屏幕常亮。仓库没有锁屏与息屏下的注入处理，息屏后能否继续操作没有代码保障，不要假设可以息屏无人值守。

## 设备前提

视频、小红书、快手三个采集包从 **0.2.0** 起都只需要权限档「**无障碍**」：不需要 Shizuku、不需要 root、不需要电脑。**抖音直播包例外**：直播间评论框 50 字上限让「目标 App 自己粘贴」这条路读不全口令，改用 `Tools.System.shell` 调 `service call clipboard`，需要「**调试器**」权限档（Shizuku）。驱动里的返回键、清空输入框走 `Tools.UI`；屏幕尺寸取自**无障碍根节点的 bounds**，不用 `Tools.System.getDeviceInfo()`——后者是宿主窗口的 displayMetrics，会跟着 insets 变（这台机器上取到过 1080×2163），与节点坐标不是一套空间。视频、小红书、快手三个包内已无任何 `Tools.System.shell` 调用，直播包只有剪贴板这一处用 shell。

唯一一处不是标准原语的是**粘贴**：Android 10 起只有获得焦点的应用能读系统剪贴板，而采集时前台是目标 App，所以只能「让目标 App 自己粘」。做法是长按评论输入框，弹出目标 App 自己的粘贴工具条，再点工具条上的「粘贴」。**那个工具条不在无障碍节点树里**（实测：截图可见、同一时刻的树里没有含「粘贴」的节点，证据见 `../docs/TODO/collector_accessibility_only_20261015/`），所以只能按坐标点。坐标以「输入框左上角」为锚点，三个 App 实测值如下：

| 包 | 常量位置 | 工具条顺序 | 偏移（X / Y） | 实测环境 |
| --- | --- | --- | --- | --- |
| 抖音 | `douyin-collector/src/packages/douyin_collector.ts` | 粘贴·常用语·自动填充 | `+139 / -139` | 抖音 37.8.0，1080×2400 |
| 小红书 | `xhs-collector/src/packages/xhs_collector.ts` | 常用语·**粘贴**·换行·自动填充 | `+253 / -169` | 小红书 9.22.1，1080×2400 |
| 快手 | `kuaishou-collector/src/packages/ks_collector.ts` | 粘贴·常用语·自动填充 | `+135 / -145` | 快手 14.1.10.46550，1080×2400 |

**换 App 版本或换分辨率都要重新量**，三个值不能互抄（小红书那个「粘贴」是第二个按钮，X 偏移明显更大）。量法：用 `../docs/TODO/collector_accessibility_only_20261015/run_probe.sh` 跑同目录探针的 `pasteByToolbarProbe`（把 `offsetX` / `offsetY` 当参数试，能回读到对应短链即正确），或直接按上面三张截图重算，截图就在 `../docs/TODO/collector_accessibility_only_20261015/shots/`。

三个 driver 在长按之前都会先 `set_input_text("")` 把输入框置空：工具条的按钮集合取决于框里有没有文本，有草稿时最左那个不是「粘贴」，坐标会点错。

彻底去掉这份坐标表的方案见 `../docs/TODO/collector_accessibility_only_20261015/02_provider_action_paste.md`（provider 增加 `ACTION_PASTE`，需要 provider 项目同步发版）。

实测单条耗时：抖音约 35 到 40 秒，小红书约 20 到 25 秒，快手约 30 到 45 秒（1080×2400 设备，含详情页动画等待；快手那一片 3 条约 2 分 20 秒，其中含一次广告页跳过）。

自检提示：包详情页的对话框会把所有声明过的参数一起提交，空着的数值参数会变成空字符串并被宿主严格转换拒绝。手工在对话框里跑 `*_collect_share_links` 时，`count` 与 `chunk_minutes` 都要填值；`keyword` 是中文的话，对话框里没法用 `adb shell input text` 输入，需要先复制到剪贴板再粘。

## 配置上报地址与令牌

配置在 App 里改，不碰文件，三个包各有一个设置页：

```
工具箱 → 抖音采集设置
工具箱 → 小红书采集设置
工具箱 → 快手采集设置
```

页面里可以直接填地址与令牌，也可以把一段配置文本粘进「粘贴配置文本」框再点「解析并填入」，还可以点「从剪贴板导入」直接从剪贴板取。保存后页面会自动跑一次自检。

两个值存在宿主的环境变量里（`EnvPreferences`，App 私有存储），键名是 `COLLECTOR_BASE_URL` 与 `COLLECTOR_TOKEN`。这段存储是全局键值、不按包隔离，服务端只有一个，所以这两个中立键由三个采集包**共用**，改键名时三个包的子包脚本与设置页必须一起改。

抖音包早期版本用的是带 `DOUYIN_` 前缀的键名。升级后子包脚本在每次读配置前、设置页在每次加载时都会跑一次迁移，把旧键的值搬到中立键上再清空旧键，已经填好的配置不需要重新填。迁移完成后旧键不再存在，这段迁移代码在下一个发布周期删除。

设置页的 `onLoad` 必须把 promise 返回给宿主（`onLoad: () => migrateOnLoad()`）。写成 `() => { void migrateOnLoad(); }` 的话宿主按同步动作处理，动作一结束就注销状态变化监听，`await` 之后的 `setState` 不触发重渲染，首访会停在迁移前的空值上。原因与实测见 `../docs/TODO/xiaohongshu_collector_20261012/04_shared_upload_config_migration.md`。

自检工具 `*_upload_config_check` 会故意发一个空批次：服务端按参数校验拒收它，不会写入数据；而鉴权在参数校验之前，所以「参数校验类的 400」恰好证明配置可用。

上报契约与逐条验证记录见 `../docs/TODO/device_automation_platform_20261008/server_api.md`。**服务端要为快手放行 `v.kuaishou.com` 域名**，否则上报的每条都会以 `reason=invalid_url` 被拒（与小红书当初 `xhslink.cn` 的情况相同，实测见 `../docs/TODO/kuaishou_collector_20261014/index.md`）。

## 编译

```bash
npx tsc -p my-packages/douyin-collector/tsconfig.json
npx tsc -p my-packages/xhs-collector/tsconfig.json
npx tsc -p my-packages/kuaishou-collector/tsconfig.json
```

改动 `src/` 之后必须重新编译，否则手机上加载的还是旧的 `dist/`。

## 装到手机

推荐用应用内的开发流程，改完即重载，不用重建 APK。

1. 在 Operit 里装并运行 `SandboxPackage_DEV` 技能，入口是 `/sdcard/Download/Operit/skills/SandboxPackage_DEV/scripts/install_or_update.js`
2. 开发目录是 `/sdcard/Download/Operit/dev_package/{packageId}/`
3. 宿主类型放在同级的 `/sdcard/Download/Operit/dev_package/types/`，不要放进包目录内部
4. 包内的 `tsconfig.json` 让 `typeRoots` 与 `include` 指向 `../types`

本目录里的 `tsconfig.json` 指向仓库中的 `examples/types`，是为在电脑上编译准备的，两边不要互相覆盖。

另一条已验证可用的路径是打成 `.toolpkg`（zip，根目录放 `manifest.json`），文件名用 `包ID.toolpkg`，推到 `/sdcard/Android/data/com.ai.assistance.operit.debug/files/packages/` 后重启应用。启动日志里会给出扫描结果，形如 `scan candidate finish, phase=external, type=toolpkg, file=com.taincheng.kuaishou_collector_bundle.toolpkg, errors=0`。造包可以用仓库里的 `python3 tools/toolpkg/debug_toolpkg.py <包目录>`。

**注意**：`debug_toolpkg.py`（以及 `tools/adb/execute_js.sh`）走的是给 App 发广播的路子，在本项目常用的那台 MIUI 设备（24094RAD4C / HyperOS）上**广播不会被投递**——AMR 日志只有 `Enqueued broadcast` 与 `Broadcast completed: result=0`，receiver 一次都没跑，包也不会安装。此时改用「推文件 + 重启应用」即可：重启时宿主会扫 `files/packages/` 并加载。

用 `.toolpkg` 装的话，装完还要去包管理里把包打开：外部包不会自动启用，清单里的 `enabled_by_default` 只对内置包生效。开关是包行右侧那个**没有文案**的 checkable 控件（节点树里只有 `checkable=true`/`checked`，没有 text / content-desc / resource-id）。没打开的包，工具箱里不会出现它的设置页，工作流的模板选择器也不会列出它（模板列表按容器是否启用筛选）；启用成功的日志是 `Successfully enabled toolpkg container: <包ID>`。

## 导入工作流模板

入口是「工作流」页右下角按钮展开后的「从模板新建」。模板列表里内置模板占了前几屏，插件模板在**最下面**，分区标题是「插件模板」。点一下就会生成一条可编辑的正式工作流，之后与包无关。

四个包各带一个模板：「连续采集抖音并上报」「连续采集抖音直播并上报」「连续采集小红书并上报」「连续采集快手并上报」。模板里的关键词是静态参数（抖音 `美食`、抖音直播 `口腔医院`、小红书 `家装`、快手 `家装`），导入后可以直接改。

模板里有连续触发与手动触发两个节点：连续触发用于无人值守，手动触发用于随时试跑，在编辑器右下的操作菜单里点「触发工作流」即可。只能连续触发的话，手动触发会直接空跑，日志里记 `没有手动触发类型的触发节点`。

连续触发的 `triggerConfig` 是 `{"schedule_type":"continuous","min_gap_ms":"30000","max_gap_ms":"120000","enabled":"true"}`：一轮工作流整轮返回之后才开始计时，等随机 30–120 秒接着跑下一轮，间隔从上一轮结束时刻起算，不是固定节拍。一轮时长由采集节点的 `count` 与 `chunk_minutes` 决定，模板里是 5 分钟上限。

导入后宿主会立刻点火一轮（首环不等待），之后的间隔才随机。

旧版模板生成的是「每 15 分钟定时触发」，连续触发上线后不做迁移：把工作流页里旧的那两条删掉（或至少停用），再重新导入新模板。**新旧两条不要同时存在**，否则两轮采集会抢同一个界面。

抖音、小红书与快手的采集都要把各自的目标 App 拉到前台，所以**任意两个采集工作流不能同时启用**：要采哪个就只开哪个，另外两个停用。真机实测同时启用会互相抢界面（2026-10-13，见 `docs/TODO/continuous_workflow_trigger_20261012/04-verification.md`）。

工作流跑起来之后，**不要用 adb 把 Operit 拉到前台**（`am start`、`input tap` 都算）：前台一旦被抢走，采集脚本读到的是 Operit 自己的页面，本片会以读页面超时收尾。实测踩过一次（快手那条工作流第 2 轮），看着像「连续触发把上一轮掐了」，其实是测试手法的干扰。

## 注意

不要在 `my-packages/` 下新建 Gradle 模块。这个仓库的 Gradle 模块都是原生或宿主组件，业务代码是跑在 QuickJS 上的脚本包，不属于那一层。
