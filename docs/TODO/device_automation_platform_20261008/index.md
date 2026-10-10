---
repository: https://github.com/AAswordman/Operit
status: planning
For_Agent: 本计划建立在真机实测结论上，动手前先读「实测基线」，不要重新凭猜测推翻它
---

# 手机端采集自动化平台

面向 App 侧的采集需求：打开目标 App，按主题搜索，枚举结果，逐条提取载荷，本地留存，上报远端。本计划的范围是抖音的分享链接采集。同一批需求里提到的网页收集场景不在本计划内，它需要自己的 driver 与单独的计划。

## 现状

底层原语仓库里都有，缺的是把它们组织成可重复采集任务的中间层。

已有：

- 设备动作原语 `Tools.UI` 与页面对象模型 `UINode`
- 目标级 UI 子代理 `Tools.UI.runSubAgent`
- 脚本按名字调用任意宿主工具的 `toolCall`
- 出站 `http_request`、`multipart_request` 与 OkHttp 桥
- 定时编排 `WorkflowScheduler` 与 `WorkflowWorker`
- 浮窗 UI 调试器，可以读取底层应用的节点树

缺失：

- driver 契约。每个 App 一份 30 至 50 KB 的单体脚本，而 `examples/automatic_ui_base.ts` 只有 358 行且只是 toolCall 转发样板
- 稳定化内核。脚本唯一的等待原语是 `Tools.System.sleep`，条件等待、滚动查找、页面断言、弹窗处理都没有。`UINode.findAndWait` 调用不存在的 `Tools.UI.combinedOperation`，调用即崩
- 采集运行时。没有记录模型、去重、断点与上报状态
- 上报可靠性。没有 outbox、幂等与状态级重试

## 实测基线

以下结论来自 2026-10-08 的真机实测。设备是 Xiaomi 24094RAD4C，HyperOS 2.0，Android 15，抖音 37.8.0，Operit 1.12.1+6。重写本计划前请先确认这些结论是否仍成立。

读取通道，这是决定性的一条：

- Shizuku 与 root 档读节点走 `uiautomator dump`，见 `app/src/main/java/com/ai/assistance/operit/core/tools/defaultTool/debugger/DebuggerUITools.kt` 与 `app/src/main/java/com/ai/assistance/operit/core/tools/defaultTool/root/RootUITools.kt`
- 该命令在抖音搜索结果页连续 4 次失败，报 `ERROR: could not get idle state`。原因是搜索页是单列自动播放信息流，窗口永不进入 idle。同一台机器上桌面与视频详情页读取正常
- 无障碍档走 provider 的 AIDL 实时读取，见 `app/src/main/java/com/ai/assistance/operit/data/repository/UIHierarchyManager.kt`，不依赖 idle，实测能读到搜索页的文本、边界与可点击区域
- DEBUGGER 档在无障碍服务开启时会优先走无障碍，见 `DebuggerUITools.kt` 的 `getPageInfo` 与 `tap`
- 因此抖音 App 链路必须启用无障碍档，只有 Shizuku 不够

页面结构：

- 抖音搜索页根节点是 `androidx.compose.ui.platform.ComposeView`，文本节点对无障碍可见
- resource-id 大部分被混淆，例如 `zxd`、`enc`、`b47`
- content-desc 内嵌动态计数与状态词，例如 `分享1461，按钮`、`未点赞，喜欢2010，按钮`
- 所以定位必须基于文案的前缀或部分匹配，resource-id 只能作为同一版本内的加速手段

分享链接的获取流程已完整验证：

1. 点击 `content-desc` 以 `分享` 开头的按钮
2. 分享面板中该项在当前版本叫 `分享链接`，点击即复制
3. 复制后弹出 `链接已复制成功，去粘贴分享：`，链接本身不在节点树里
4. 聚焦任意输入框，发送 `KEYCODE_PASTE`，再读取该 `EditText` 的 text
5. 粘贴结果形如 `0.05 复制打开抖音，看看【作者的作品】标题… https://v.douyin.com/xxxx/ aAG:/ H@V.yt 02/23 :3pm`，必须只抽取 URL

启动方式：

- `snssdk1128://search?keyword=<urlencoded>` 直达 `search.activity.SearchResultActivity`
- `snssdk1128://aweme/detail/<id>` 唯一解析到 `DeepLinkHandlerActivity`
- 直接转发 https 分享链接会弹选择器，必须显式指定包名 `com.ss.android.ugc.aweme`

脚本执行约束：

- 硬超时 30 分钟，见 `app/src/main/java/com/ai/assistance/operit/core/tools/javascript/JsTimeoutConfig.kt`
- QuickJS 单线程，脚本串行执行，`Promise.all` 不会真正并行
- 脚本调用工具不经过权限闸门，权限检查只在 `app/src/main/java/com/ai/assistance/operit/api/chat/enhance/ToolExecutionManager.kt` 的模型工具循环里

编排与环境：

- 外部 adb 广播触发在本机被 HyperOS 拦截，`ScriptExecutionReceiver` 收不到广播，所以无人值守只能依赖应用内 `WorkflowScheduler`
- 工作流有定时触发器但没有循环节点，循环必须放在脚本内
- 按钮文案随版本变化，当前是 `分享链接` 而不是 `复制链接`

宿主参数校验：

- 工具的声明参数会按类型做严格转换。包详情里的运行对话框会把所有声明过的参数一起提交，未填的数值参数变成空字符串，于是被拒绝，报 `Invalid parameter ... expected number`
- 模型调用只提交它决定使用的参数，不受这条影响
- 结论：可选数值参数在自查界面里必须填值才能运行；给这类参数配一个可省略的默认值没有意义，因为缺失值根本到不了脚本

页面读取与交互，2026-10-08 在抖音 37.8.0 上实测：

- 无障碍档返回的 class 是简名，例如 `EditText`；shell 的 uiautomator 档返回全名，例如 `android.widget.EditText`。class 定位要用简名配合部分匹配，两种档位才都能命中
- `activityName` 不可靠，同一页面有时返回真正的 Activity 名，有时返回根视图类名 `androidx.compose.ui.platform.ComposeView`。判断页面要用节点特征，不要用它
- 两种读法各有覆盖范围，不能互相替代。搜索结果页只有无障碍档能读，uiautomator 报 could not get idle state；详情页在画面静止时两种都能读，视频播放中 uiautomator 会失败
- 在视频详情页内滑动可以切到下一个视频，切换后无障碍树的互动条 content-desc **依然完整**。曾经误判为「切换后 desc 丢失」，实际是定位代码的问题：树里存在边界被裁掉的同名节点，先取首个匹配再判断可见性会先选中那种节点再把它否掉，日志又打成了同一句话。定位时可见性必须并进匹配条件
- 搜索结果页顶部有标签行，依次是综合、视频、用户、图文、团购、商品、直播、音乐。**综合标签里混着直播与图文**：直播间没有分享链接面板，滑动还会直接滑进直播间，整条采集流程会被带偏。采集固定先切「视频」标签
- 「视频」标签是两列网格，卡片封面没有 content-desc，只有「综合」标签下才有「视频封面」。视频标签用卡片右下角的时长角标定位，形如 00:50
- 取链时点过评论输入框，返回键有时只收起了键盘，页面仍停在评论区或推荐区，此时互动条不在画面里，继续滑动就变成滚页面而不是切视频。切视频前要先把页面恢复到视频画面（再按返回键关评论面板），恢复不了要如实报错
- 分享面板是模态窗口。不关闭它时，下层页面的节点不在节点树里，读到的只有面板本身；关闭方式用返回键
- 分享面板的高度随内容变化，有联系人行时「分享链接」会被推到导航栏下面。应用窗口底部被导航栏占用，落在那里 的点击不会传给应用，所以点击前必须判断目标是否在可视区域内
- 抖音搜索结果页每张卡片自带一个 `content-desc` 恰为 `分享` 的按钮，而详情页的分享按钮是 `分享1461，按钮` 这种带计数与「按钮」后缀的形式，可据此区分列表与详情。图文作品的后缀又不一样，只按前缀匹配更稳
- 被滚出屏幕的节点会给出反向边界，例如 `[56,354][723,70]`。只比较上边坐标会把这种节点当成可见，算出的中心点可能落在顶部搜索栏上，一点就打开了搜索面板
- 详情页评论区输入框的占位文案每次都可能不同，例如「爱评论的人，运气不会差」「发条评论，说说你的感受」「期待你的评论」，定位输入框只能用 class，不能靠占位文案
- 滚动推进必须有进度判定：如果滚动后目标没有变化仍然继续滚动，就会形成死循环。实测中这一点确实发生过

宿主侧待修的缺陷：

- shell 档读页面依赖 `uiautomator dump /sdcard/window_dump.xml`，但 `uiautomator` 在无法进入 idle 时只打印 `ERROR: could not get idle state.` 并以退出码 0 结束，于是被判定为成功，接着 `cat` 到一个**残留的旧文件**。2026-10-08 实测这台机器上残留的是 2026-07-17 的文件，属于别的应用，返回值是一棵与当前屏幕完全无关的节点树
- 修法：dump 前先删除目标文件，dump 后校验文件确实被重新写入，否则返回失败而不是旧数据
- 无障碍档读页面会偶发失败：`AccessibilityUITools` 重试三次，但三次只隔约 300ms，页面动画期间会连续超时，最终报 `Failed to retrieve UI data via accessibility service.`。2026-10-08 实测一次 20 条的采集因此在第 4 条被打断
- 脚本侧的应对：在「等条件出现」的语义下，读页面失败等同于「还没就绪」，继续轮询到超时为止，超时信息里带上最后一次读取失败的原因。宿主侧的重试间隔偏短仍然值得单独修

宿主新增能力：

- 新增内建工具 `read_clipboard`。抖音只把分享链接写进系统剪贴板，节点树里读不到；此前的替代做法是把内容粘进输入框再读回，那会动到搜索框并触发重新搜索，把采集流程搞乱
- 涉及的位置按 `docs/doc-src/architecture/DEFAULT_TOOLS_ARCH.md` 的清单执行：实现、注册、双语提示词、JS 封装、类型声明、文档与字符串资源
- 剪贴板读取受 Android 10 起的焦点限制：目标应用在前台时，后台的 Operit 读到的是空字符串。2026-10-08 实测，探针在 Operit 处于前台时能读到 120 字符的完整分享文本，同一份代码在抖音处于前台时读到 0 字符。这台机器上 `READ_CLIPBOARD` appop 显示 allow，但限制依然生效
- 结论：要在目标应用前台时读取剪贴板，只能走 shell UID（Shizuku 或 root），或者回到「把内容粘进输入框再读回」的做法

## 意图

建立一层可复用的采集运行时，使新增一个采集目标只需实现一个 driver，而不是重写一份单体脚本。

分层与职责：

- L1 稳定化内核，脚本侧。条件等待、滚动查找、页面断言、失败现场快照
- L2 driver 契约，脚本侧。声明所需权限档位，实现搜索、枚举、进入、提取与翻页
- L3 采集运行时。按条数与时间分片，断点续跑，去重
- L4 落地与上报。JSONL 追加写入与 outbox 上报
- L5 编排。应用内工作流定时触发，分片续跑
- L6 观测。进度上报与失败快照

## 数据契约

抖音采集的载荷是 App 分享流程的产物，即 `v.douyin.com` 短链加口令文案。网页版地址 `www.douyin.com/video/<id>` 不是同一种数据，不能替代它。因此抖音采集只能走 App GUI，不存在可替换的网页路径。

本计划只覆盖 App 侧。用户需求集合里的网页收集场景需要独立的 driver 与独立的计划，不并入这里，也不作为抖音路线的备选。

## 作用域

- 新增脚本侧工具包，承载内核、driver 契约、采集运行时与 outbox
- 新增抖音 driver
- 复用现有 `Tools.UI`、`UINode`、`Tools.Files`、`Tools.Net`
- 默认不改宿主 Kotlin。只有确认缺少必要原语时才动，并遵循 `docs/doc-src/architecture/DEFAULT_TOOLS_ARCH.md` 的完整清单

## 包形态与落地位置

不新建 Gradle 模块。本仓库的 Gradle 模块都是原生或宿主组件，而 driver 是运行在 QuickJS 上的 TypeScript，不属于这一层。

不放进 `examples/`。该目录的定义是工具包与脚本示例集合，同时同步脚本 `tools/example_packages/sync_example_packages.py` 把它当作 APK 内置包的来源。一旦放进去并进白名单，业务包就变成随 APK 出厂，每次改业务代码都要重建 APK，业务代码也会持续出现在 fork 的差异里。

实际形态是两个普通 ToolPkg，放在独立仓库：

```text
your-operit-ext/
├── automation_kernel/   内核、driver 契约、采集运行时、outbox
└── douyin_collector/    抖音 driver，requires 引用 automation_kernel
```

设备侧的装载与调试走应用内的 `dev_package` 流程，开发目录是 `/sdcard/Download/Operit/dev_package/{packageId}/`，宿主类型放同级 `types/`，改完在应用内重载，不需要重建 APK。

另有一条已经验证可用的装载路径，适合把包一次装到设备上做真机验证：

1. 把包目录打成 `.toolpkg`，即一个 zip，根目录放 `manifest.json`，其余文件按包内相对路径存放。`tools/example_packages/sync_example_packages.py` 的 `_pack_toolpkg_folder` 就是这个约定，可以直接复用
2. 推送到 `/sdcard/Android/data/com.ai.assistance.operit.debug/files/packages/`
3. 重启应用。启动日志会给出扫描结果，形如 `scan candidate finish, phase=external, type=toolpkg, errors=0`，随后 `loadAvailablePackages finish` 中的计数会增加

这条路径不依赖广播，因此在被 HyperOS 拦截广播的设备上仍然可用。注意应用只扫描该目录下的文件而不是目录，所以必须打包成 `.toolpkg`。

`tools/toolpkg/debug_toolpkg.py` 走的是广播 `DEBUG_INSTALL_TOOLPKG`，与本机被拦截的 `EXECUTE_JS` 同一机制，在本机不可用。

只有确实缺少宿主原语时才回主仓修改 `:app` 的内建工具，并按 `docs/doc-src/architecture/DEFAULT_TOOLS_ARCH.md` 的完整清单执行。

## 不做的事

- 不做视觉定位。当前 OCR 只返回文本列表，没有消费者使用 bounding box
- 不做多 agent 并行。虚拟显示需要 Shizuku 或 root，每个 agent 独占一套虚拟屏与悬浮窗，官方标注为实验特性
- 不写兜底路径。定位不到元素即失败，并把现场落盘
- 不用网页地址替代 App 分享链接，也不把 LLM 子代理当脚本失败后的接管者，路线在任务定义时就选定

## 待定

- 编排位置。手机自主，还是由服务端通过 `ExternalChatHttpServer` 与 A2A 下发
- 是否保留已安装的无障碍 provider

上报契约已经确定，服务端尚未实现，契约内容见 [03 记录落地与 outbox 上报](03_record_store_and_outbox.md)，服务端按同一份契约实现即可。

## 步骤

- [01 内核与 driver 契约](01_kernel_and_driver_contract.md) —— 已归档，未按原方案实施；目标由 02 至 07 直接完成，文末记了一条仍未处理的宿主缺陷
- [02 抖音 driver](02_douyin_driver.md) —— 已完成并在真机验证
- [03 记录落地与 outbox 上报](03_record_store_and_outbox.md) —— 已完成，状态机按契约用 mock 服务端逐条验证
- [04 无人值守与分片续跑](04_unattended_chunked_runs.md) —— 已完成，分片与续跑在真机验证，工作流模板已注册
- [05 设置界面与环境变量配置](05_settings_ui_and_env_config.md) —— 已完成，配置迁到 App 内设置页与环境变量，config.json 已废弃
- [06 搜索结果集边界与遍历方式](06_search_result_boundary.md) —— 已完成，遍历改成分页驱动，推荐流不再被当成搜索结果
- [07 记录的相关性与推广标记](07_record_relevance_markers.md) —— 已完成，客户端只打标记不过滤，判断权交给服务端
- [08 自动化状态浮窗与采集期间保亮](08_automation_status_overlay_and_keepawake.md) —— 暂缓，未实施；结论与分层方案已记录

## 交给服务端开发的文档

- [采集上报服务端接口](server_api.md) —— 传输、请求响应格式、状态码语义、去重硬要求、实现检查清单与联调方法
- [mock_server.py](mock_server.py) —— 按契约实现五种响应行为的参考服务端

## 验证

遵循仓库约定，本计划不主动运行构建与测试。每个步骤在真机上的验证方式写在该步骤文档内。
