---
repository: https://github.com/AAswordman/Operit
status: planning
For_Agent: 本计划建立在 2026-10-12 的真机实测结论上，动手前先读「实测基线」，不要凭猜测推翻它
---

# 小红书 App 采集

按关键词搜索小红书，逐条进入结果、走 App 的「分享 → 复制链接」取出 xhslink 短链，落盘后上报远端。目标形态与已落地的抖音采集一致。

## 现状

已有：

- 抖音采集器，真机验证可用，见 `my-packages/douyin-collector`。它是**自包含**的 ToolPkg：driver、记录落地、outbox 上报、分片续跑、设置页、工作流模板都在一个包里
- 上报契约已定，见 [采集上报服务端接口](../device_automation_platform_20261008/server_api.md) 与 [记录落地与 outbox 上报](../device_automation_platform_20261008/03_record_store_and_outbox.md)。请求体里的 `items[].source` 明确写着「为将来的其他来源留位」
- 宿主原语齐备：`Tools.UI`（`getPageInfo` / `tap` / `swipe`）、`UINode`、`Tools.System.shell`（走 Shizuku，设备上已装 `moe.shizuku.privileged.api`）、`Tools.Net.http`、`Tools.Files`
  - 2026-10-15 起小红书包 0.2.0 已不再使用 `Tools.System.shell`，权限档「无障碍」即可运行；改动与真机回归见 [collector_accessibility_only_20261015](../collector_accessibility_only_20261015/index.md)

缺失：

- 小红书没有任何 driver。`examples/automatic_xiaohongshu_assistant.ts` 是同构的参考样板，靠 `findById` 定位语义化 id，与小红书现状不符（可见节点的 resource-id 几乎全是 `0_resource_name_obfuscated`）

设备侧：Operit debug 1.12.2、无障碍 provider `com.ai.assistance.operit.provider` 已启用。小红书 9.22.1。

## 实测基线

以下结论来自 2026-10-12 的真机实测。设备 Xiaomi 24094RAD4C，HyperOS，Android 15（API 35），屏幕 1080×2400、密度 450，App 窗口可用区 y ∈ [104, 2267]，小红书 9.22.1。

复现脚本见 [probe_xhs.py](probe_xhs.py)，它对每一步都打印判定依据，改 driver 前可以先用它核对现场。

### 读取通道

- `uiautomator dump` 在**小红书搜索页可用**。这一点与抖音相反：抖音搜索页是单列自动播放信息流，窗口永不 idle，dump 必然失败；小红书搜索页是静态图片瀑布流，实测连续十余次 dump 全部成功
- 但**视频笔记详情页 `DetailFeedActivity` 在播放中会失败**，报 `ERROR: could not get idle state.`，且**不会生成目标文件**。dump 前先删目标文件、dump 后校验文件确实存在，就能把这种情况判成失败而不是读回残留数据
- 视频页在暂停后、或弹出分享面板后可以 dump
- 无障碍档走 provider 的 AIDL 实时读取，不依赖 idle，是 driver 的必需档位。载体与抖音同一条结论，见 [手机端采集自动化平台](../device_automation_platform_20261008/index.md) 的实测基线

### 搜索入口

- deep link `xhsdiscover://search/result?keyword=<urlencoded>` 配合显式包名 `com.xingin.xhs`，直达 `com.xingin.alioth.search.GlobalSearchActivity`，搜索框与结果集都按关键词生效。实测关键词 `装修`
- 搜索页顶部标签横向排列、可左右滚：`全部`、`用户`、`商品`、`图片`、`地点`、`群聊`（`群聊` 是最后一个）。**没有独立的视频或图文页**，所以遍历固定在默认的 `全部`
- 第二行是内容筛选 chip（`综合`、`最新`、`小户型`、`现代轻奢`、`装修风格`、`好物实用`），与内容类型无关，不要当成类型标签用

### 结果列表

- 两列瀑布流。卡片容器的 class **不稳定**，同一屏里同时出现过 `LinearLayout` 与 `ViewGroup`，定位不能依赖 class 名
- 卡片的正文标题是子树里的长文本（实测 ≥15 字），可以作为卡片身份与去重键
- 筛选 chip 栏吸顶，实测占 y ∈ [374, 497]。卡片会滑到它下面被裁切，此时卡片上边坐标小于 497，**点中心会落到筛选栏上**（筛选栏会打开筛选面板）。只点完整落在 y ∈ [497, 2267] 内的卡片
- 视口高约 1770，卡片高约 940。按约 600 像素一屏滚动，可以保证每张卡至少完整可见过一次
- 列表里混着**非笔记卡片**，实测到的是商品/直播卡：子树里有 `直播中`，并且 content-desc 形如 `¥1580.¥2080`。这类卡片走不通分享流程，必须在卡片分类阶段排除
- 推广笔记中标了 `广告` 文本。这是相关性标记，**只写进记录，不用来过滤**，与抖音 `promo_hint` 的处理方式一致

### 详情页有两种，分享入口不同

| 页面 | Activity | 分享入口 |
| --- | --- | --- |
| 图文笔记 | `com.xingin.matrix.notedetail.NoteDetailActivity` | 右上角 `moreOperateIV`（这个 resource-id **没有**被混淆，是页面里少数语义化 id 之一） |
| 视频笔记 | `com.xingin.matrix.detail.activity.DetailFeedActivity` | 右上角 content-desc 恰为 `分享` 的按钮 |

- 图文笔记页**底栏没有分享按钮**：底栏只有 `说点什么…`（content-desc 是 `评论框`）、点赞、收藏、评论
- 视频笔记页底栏同样没有分享按钮：`说点什么…` 这个 TextView **没有 content-desc**，点赞/收藏/评论是 Button
- 两种页面点开的是**同一个分享面板**：标题 `分享至`，动作行第一项是 `复制链接`
- 面板里承载文案的 Button 与内层真正的 clickable ViewGroup 的 bounds 相同，两边的 clickable 都是 false。定位按 `text` 或 `content-desc` 相等取节点，再点它 bounds 的中心
- `复制链接` 落在 `[42,1986][216,2239]`，在可视区内。**点完面板自动关闭**，不需要按返回键

### 剪贴板回读

- 唯一可行通道是「把剪贴板粘进输入框再读回」。小红书详情页底栏的评论入口点开后是 `com.xingin.comment.input.ui.NoteCommentActivity`，里面有一个 class 简名为 `EditText` 的输入框
- 输入框的占位文案**会变**，实测到 `留下你的想法吧` 与 `有话要说，快来评论` 两种，所以只能按 class 定位，不能按占位文案
- 焦点限制实测：Android 10 起只有持有焦点的应用能读剪贴板。本机 `service call clipboard` 以 shell 身份直读被拒，返回 `Package … does not belong to 2000`；宿主的 `read_clipboard` 在目标应用处于前台时读到空字符串。所以不走直读
- 粘贴用 `input keyevent 279`；清空用 `input keycombination 113 29` 加 `input keyevent 67`
- 分享文本里**尾句是随机的**，同一天反复取同一条笔记就会换措辞。实测到五种：`把文本复制好，来【小红书】看看这篇笔记吧！`、`内容复制后，前往【小红书】直接打开笔记。`、`这篇内容在【小红书】候着你~`、`复制文字，打开【小红书】，笔记立刻呈现~`、`复制口令，打开【小红书】即可畅读全文。`。所以只能从整段里按 URL 正则抽链接，不能按固定尾句切
- 短链域名是 **`xhslink.cn`**（不是 `.com`），路径形如 `/o/85Lns6HOD4i`

实测分享文本两例：

```text
装一个很我的家｜房子变成家，家代表了我 之前，装修... https://xhslink.cn/o/85Lns6HOD4i
把文本复制好，来【小红书】看看这篇笔记吧！
```

```text
装修砍价砍什么？砍套路 装修砍价方法 https://xhslink.cn/o/g1lutXN4tH
这篇内容在【小红书】候着你~
```

### 链接是稳定的，可作去重键

同一条笔记两次独立取链得到同一个 `https://xhslink.cn/o/85Lns6HOD4i`。因此去重可以用链接本身，标题只作为卡片身份键。

### 视频流不能用来遍历，每条必须回列表

这是本计划最关键的一条，它决定了 driver 的形状：

- `DetailFeedActivity` 支持上下滑切换笔记，单看这一点很像抖音的详情页内滑动遍历
- 但**下滑进入的是推荐流，不是搜索结果**。实测：从搜索结果第一条视频进入后下滑一条，得到 `原木 + 大白墙，干净清爽的家装#原木风#家的...`；随后回到列表，用 30 屏、142 条标题把该关键词的搜索结果扫了一遍，**找不到这条**。换一条视频复测，同样找不到
- 图文笔记详情页上下滑是滚正文并进入评论区，也不切换笔记
- 结论：**不能像抖音那样在详情页内滑着把一页取完**。每条笔记都要「进详情 → 取链 → 返回列表」，回到列表后滚动位置保持

这与抖音计划里「综合标签混着直播、滑进去就跑偏」是同一类问题：**遍历路径必须证明它落在结果集里**。抖音靠「按页约束」解决，小红书只能靠「每条回列表」。

### 单条闭环实测

顺序：点卡片 → 等详情页 → 点分享入口 → 等 `分享至` → 点 `复制链接` → 点评论入口 → 等 `NoteCommentActivity` → 点 EditText → 粘贴 → 读回 → 清空 → 返回 → 返回列表。

adb 探针口径下约 **28 秒/条**，含固定 sleep。宿主内用 `Tools.UI` 做条件等待会比探针里的固定等待更快。

## 意图

新增一个自包含的 ToolPkg `my-packages/xhs-collector`，形态与 `my-packages/douyin-collector` 对齐：一套 driver、记录落地、outbox 上报、分片续跑、设置页与工作流模板。

工具名用 `xhs_` 前缀，与 `douyin_` 不冲突。

## 与抖音的差异

| 项 | 抖音 | 小红书 |
| --- | --- | --- |
| 搜索入口 | `snssdk1128://search?keyword=` | `xhsdiscover://search/result?keyword=` |
| 列表类型区分 | 有「视频」标签，先切过去 | 没有类型标签，全部类型混在 `全部` 里，靠卡片分类排除商品卡 |
| 遍历方式 | 详情页内上下滑，按页约束 | 每条回列表，滚动推进 |
| 分享入口 | 底栏分享按钮，desc 前缀 `分享` | 图文=右上角 `moreOperateIV`；视频=右上角 desc `分享` |
| 面板项文案 | `分享链接` | `复制链接` |
| 剪贴板回读 | 详情页评论输入框 | 评论入口 → `NoteCommentActivity` 的 `EditText` |
| 短链域名 | `v.douyin.com` | `xhslink.cn` |
| 推广标记 | 页面上的推广词 | 卡片上的 `广告` 文本 |
| 上报 source | `douyin_app` | `xiaohongshu_app` |
| 上报配置 | 键名带 `DOUYIN_` 前缀 | 两个包共用中立键 `COLLECTOR_*`，抖音包旧键做一次性迁移，见 [04](04_shared_upload_config_migration.md) |

## 直接复用的部分

- 分片与续跑的口径：`count` 是本片条数目标，`chunk_minutes` 是本片时间上限（默认 18，上限 20，宿主硬超时 30 分钟），先到者结束，结束原因写进 `progress.json`
- 续跑靠已采记录去重：小红书用抽出的短链
- outbox 状态机与上报契约，只把 `source` 换成 `xiaohongshu_app`
- 上报地址与令牌：与抖音包共用同一组中立键，不各存一份
- 设置页与工作流模板的形态
- 失败即抛错并落现场，不做任何兜底；滑动与面板操作带次数上限**并判定是否真的前进**

## 作用域

- 新增 `my-packages/xhs-collector`，不改宿主 Kotlin
- 改 `my-packages/douyin-collector` 的上报配置键名，并加一次性迁移；除此之外不动它的 driver 逻辑
- 改 `my-packages/README.md` 里记录键名的那一段
- 不改 `examples/`，不登记 APK 白名单
- 不改上报契约：`source` 字段与批量结构都不变

## 已定

- **上报配置统一成一份**：服务端只有一个，地址与令牌两个包共用。键名中立化为 `COLLECTOR_BASE_URL` / `COLLECTOR_TOKEN`，不再带来源前缀；抖音包现有的 `DOUYIN_COLLECTOR_*` 键做一次性迁移，见 [04](04_shared_upload_config_migration.md)
- **包保持自包含**：不抽公共 kernel。抽 kernel 会动到已经在跑采集的抖音包，收益是省掉约 300 行重复代码，代价是两次回归；出现第三个 driver 时再抽

## 步骤

顺序上 04 先做：它是独立的一次性迁移，做完之后两个包才有同一份配置可读。四步都已在真机验证，各自的验证记录写在步骤文档里。

- [04 上报配置键名中立化与迁移](04_shared_upload_config_migration.md) —— 已完成，设置页与脚本两条路径都在真机验证
- [01 小红书 driver 与定位规则](01_xhs_driver.md) —— 已完成，两类页型都采到，4 条无重复
- [02 记录落地、outbox 与上报](02_record_store_and_outbox.md) —— 客户端已完成；上报被服务端的 URL 校验挡下（`invalid_url`），见该文档的验证段
- [03 设置页、工作流模板与装载](03_settings_and_workflow.md) —— 已完成，模板导入后三段链路在真机跑通

## 服务端要跟的一件事

服务端目前不接受 `xhslink.cn` 域名，客户端上报的每条都被 `rejected`，原因是 `invalid_url`。客户端产出的短链是从 App 分享流程原样抽出来的，没有改写。服务端放行这个域名之后，还需要把 `outbox.json` 里那几条 failed 状态手工改回 `pending`（failed 按设计不自动重发）。细节见 [02](02_record_store_and_outbox.md) 的验证段。

## 验证

遵循仓库约定，本计划不主动运行构建与测试。每个步骤在真机上的验证方式写在该步骤文档内。
