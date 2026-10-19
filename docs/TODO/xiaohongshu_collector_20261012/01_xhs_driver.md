# 小红书 driver 与定位规则

## 旧状态

仓库里没有小红书 driver。`examples/automatic_xiaohongshu_assistant.ts` 是同构样板脚本，靠 `findById` 找语义化 id；小红书 9.22.1 的可见节点 resource-id 几乎全是 `com.xingin.xhs:id/0_resource_name_obfuscated`，这套写法不成立，只能作为结构参考。

抖音 driver 是同类实现，见 `my-packages/douyin-collector/src/packages/douyin_collector.ts`。内核部分（`readRoot`、`waitForNode`、`tapNode`、`isNodeVisible`、`readScreenHeight`、`parseTopY`、`parseLeftX`、`errorMessage`）可以直接照搬，定位部分必须重写。

## 意图

实现小红书采集，`requiredTier` 为 accessibility。依据见 [index.md](index.md) 的实测基线：视频笔记详情页播放中 uiautomator 必然 idle 失败。

## 常量与文案表

按版本维护，当前版本 9.22.1。

```ts
const XHS_PACKAGE = "com.xingin.xhs";
const XHS_SEARCH_SCHEME = "xhsdiscover://search/result";

const SHARE_PANEL_TITLE_TEXT = "分享至";
const SHARE_PANEL_COPY_ITEM_TEXT = "复制链接";

const VIDEO_FEED_SHARE_DESC = "分享";          // 视频笔记详情页右上角
const NOTE_SHARE_ENTRY_ID_SUFFIX = "moreOperateIV"; // 图文笔记详情页右上角
const NOTE_COMMENT_ENTRY_DESC = "评论框";       // 图文笔记底栏评论入口
const FEED_COMMENT_ENTRY_TEXT = "说点什么...";  // 视频笔记底栏评论入口，没有 content-desc

const EDIT_TEXT_CLASS = "EditText";            // 无障碍档给简名，用部分匹配两种档位都能命中

const KEYCODE_BACK = 4;
const KEYCODE_PASTE = 279;
const KEYCODE_DEL = 67;
const CTRL_A_KEYCODES = "113 29";

// 分享文本的尾句随机，只抽链接；域名是 xhslink.cn
const XHS_SHARE_URL_PATTERN = /https?:\/\/xhslink\.(?:cn|com)\/[^\s]+/;
```

## 页面判定与分发

页面类型按**节点特征**判定，不用 `activityName`（抖音那边实测过它有时返回根视图类名）。

- 广告/咨询页：底栏那一条带里出现咨询入口（`立即咨询` 或 `…人已咨询`）。**先判这一条**
- 视频笔记详情页：存在 content-desc 恰为 `分享` 的节点
- 图文笔记详情页：不存在上述节点，分享入口是 resource-id 以 `moreOperateIV` 结尾的节点

顺序不能颠倒：广告页同样有 `moreOperateIV`，先判图文就会把它当成可采集的图文笔记，然后在评论入口上超时。

分发写成显式的两分支，各自只有一个定位器：

```ts
const isVideoFeed = findByContentDesc(root, VIDEO_FEED_SHARE_DESC) !== undefined;
```

之所以不写成「先找 desc 再退回 id」，是因为这条路径必须能在页型判断错误时立刻失败，而不是悄悄点到别的东西。

分享入口与评论入口都按页型各取一个定位器：

| 页型 | 分享入口 | 评论入口 |
| --- | --- | --- |
| 图文笔记 | `moreOperateIV` | content-desc `评论框` |
| 视频笔记 | content-desc `分享` | text `说点什么...` |
| 广告/咨询页 | 不点 | 不存在，整条跳过 |

广告/咨询页的判据只看底栏那一条带（应用窗口最下面约 160px）。放宽到整棵树会把正文或评论里出现同样字样的普通笔记误判成广告页、白白跳过。

## 采集流程

单条：

1. `search(keyword)`：`Tools.System.intent({ action: "android.intent.action.VIEW", uri: "xhsdiscover://search/result?keyword=" + encodeURIComponent(keyword), package: XHS_PACKAGE })`，然后 `waitForNode` 到搜索页特征（顶部标签行有 `全部` 且结果区有卡片）出现，超时上限比抖音放宽到 30 秒，因为要等瀑布流首屏图片加载
2. 读一屏卡片，按网格顺序（先上后下，同一行先左后右）取第一张未采集的
3. 点它，`waitForNode` 到详情页特征：出现 `复制链接` 的入口页特征，即「`分享` 或 `moreOperateIV` 至少一个在树里」，同时 `NoteDetailActivity` / `DetailFeedActivity` 两者之一成为前台
4. 按页型点分享入口 → `waitForNode` 到 `分享至` → 点 `复制链接` 节点 bounds 的中心（节点本身 clickable 为 false，按文案取节点即可）→ 面板自行关闭
5. 按页型点评论入口 → 等 `NoteCommentActivity` → 找 `EditText` → 点它 → `input keyevent 279` → 轮询到 `EditText` 的 text 与占位文案不同 → 按正则抽链接
6. 清空输入框（`input keycombination 113 29` + `input keyevent 67`），`input keyevent 4` 退回详情页
7. 记一条到 `records.jsonl`，立即建 pending 的 outbox 记录
8. `input keyevent 4` 退回搜索结果页，`waitForNode` 到搜索页特征

一屏内：

- 反复取「当前完整可见且未采集」的卡片，直到这一屏没有剩余
- 然后按约 600 像素滚动一屏，`waitForNode` 到卡片集合发生变化
- **滚动必须带前进判定**：卡片的标题键集合没有变化就是没前进，连续 3 次没前进即认定结果集到底，本片结束，原因写进 `progress.json`。抖音那边因为没有这个判定出现过死循环，小红书同样是无限瀑布流，不能省

## 卡片分类

笔记卡片与商品/直播卡片的判据，必须同时满足才算一张笔记卡：

- clickable 为 true
- 完整落在可视区内：y1 ≥ 497（筛选 chip 栏下沿）且 y2 ≤ 2267（导航栏上沿），并且 y2 > y1。被裁切的卡片中心点会落到筛选栏上，点开筛选面板，必须排除
- 宽度 ≥ 400 且高度 ≥ 400
- 子树里有长度 ≥ 15 的 `text` 节点，这个节点就是卡片的正文标题，同时作为卡片身份键
- 子树里**没有**以 `¥` 开头的 `content-desc`。商品/直播卡带 `¥1580.¥2080` 这种 desc，`直播中` 也只在商品卡上出现

卡片容器的 class 不稳定（同屏出现过 `LinearLayout` 与 `ViewGroup`），不得用 class 收窄。

卡片上的 `广告` 文本是推广标记，命中就写进记录的 `promo_hint`，**不参与过滤**，与抖音的处理一致。

## 失败处理

失败分两级，分界线是「问题属于这张卡片的页面形态」还是「属于整轮的环境」。

**卡片级：跳过这张卡，继续下一张**（抛 `CardUnusableError`，循环接住）

- 详情页形态认不出来、分享入口找不到、分享面板里的「复制链接」找不到、评论入口找不到、粘贴回读等不到链接
- 跳过时记一条日志，带卡片标题与失败原因，返回体里计入 `skippedUnusable`
- **连着 5 张都采不动就抛错中断本片**（`MAX_CONSECUTIVE_UNUSABLE`）。单张版式意外可以容忍，连着这么多张已经不是版式问题，继续跳只会把数据缺口藏起来

**整轮级：直接抛错中断本片**

- 小红书切不到前台、搜索结果页打不开、读页面持续失败、文件写不进去、退不回搜索结果页
- 这些不是单张卡片的问题，中断并把现场写进错误信息

其他约定：

- 错误信息里带上当前包名、Activity、节点数与前十段文本，便于定位是哪一步的现场不对。`Activity` 有时返回的是根视图类名（实测出现过 `android.widget.TextView`、`android.widget.FrameLayout`），所以它只作参考，判断页面一律用节点特征
- 广告/咨询页**不算失败**：它是「认出来的、约定可跳过的页面」，单独计入 `skippedAds`，不占本片条数目标，也不计入「采不动」的连续计数
- 退回搜索结果页按「先看一眼、再退一层」推进，最多 3 层。先看一眼是为了避免已经在列表上时多按一次返回、把小红书退到桌面；卡片中途失败时页面可能停在分享面板或评论页，所以需要能退多层
- 取链后立即清空评论输入框，不留下草稿，也不把新内容接在旧内容后面

## 期待结果

`xhs_collect_share_links(keyword, count, chunk_minutes)` 产出形如 `{url, shareText, title, author, keyword, collectedAt}` 的记录，每条采集成功即写盘，中途失败不丢已采结果。记录与 outbox 的处理见 [02](02_record_store_and_outbox.md)。

另提供一个 `xhs_collect_share_link()`：取当前已打开笔记的分享链接，不自己导航，用于单条调试。

## 验证

2026-10-12 在 24094RAD4C / 小红书 9.22.1 上实测（adb 探针与包内运行各一轮）：

1. deep link 触发后停在 `com.xingin.alioth.search.GlobalSearchActivity`，搜索框文本等于关键词 ✓
2. 单条采集返回 `https://xhslink.cn/o/A823cOAFiCS`，日志里五步点击的坐标与节点身份都对得上 ✓
3. 同一条笔记两次独立取链得到同一个短链 ✓（基线见 [index.md](index.md)）
4. 两类页型都采到了：`note_type` 分别是 `video` 与 `note`，标题取自卡片、作者分别取自 `作者…` desc 与 `nickNameTV` ✓
5. 连采 4 条（手动 1 条 + 工作流一片 3 条）无重复：第二片第一条命中已采短链被跳过，其余 3 条互不重复 ✓
6. 同屏商品卡没有被当成笔记卡，4 条里没有一次点到商品卡 ✓
7. 评论输入框占位文案实测到三种（`留下你的想法吧`、`有话要说，快来评论`、`爱评论的人运气都不差`），按 class 定位没有受影响 ✓
8. 广告/咨询页跳过：商家号笔记「在深圳·最懂你生活的设计团队」（作者 十二墅空间设计）的详情页底栏是 `立即咨询` / `198人已咨询`，页面上 EditText 数量为 0、没有 `评论框` 这个 desc。加判据前它在评论入口上超时并**中断整片**（14:13:58 那片目标 10 条只采到 1 条就整体失败）✓

   加判据后（包版本 0.1.1）同一张卡片被跳过，本片继续跑到目标：

   ```
   14:35:05 广告/咨询页，整条跳过：「在深圳·最懂你生活的设计团队」 毛坯、精装、二
   14:37:48 本片结束（达到条数目标）：新增 10 条，跳过广告页 1 条，本轮累计 21 条
   14:37:49 上报结束：批 1，sent 21，failed 0，pending 0
   ```

   核对记录：标题含「最懂你生活」的条目在库里是 0 条；同一作者另有一条**视频**笔记 `8aTHQTIfz78` 是 13:41 那轮正常采到的（作者名相同，不是同一条）✓

9. 卡片级跳过与上限：用**故障注入**验证（临时把两个评论入口的文案改坏，模拟版式变化），注入版实测逐张跳过并最终中断：

   ```
   14:54:36 卡片采不动，跳过（连续第 1 张）：理想➕的样子NO.10 客厅把窗边空间利用起来 —— 这张卡片的页面形态采不动：等「评论入口」失败：…
   14:56:32 卡片采不动，跳过（连续第 5 张）：普通一楼小院，装出别墅既视感 …
   14:56:43 JS ERROR: 连续 5 张卡片都采不动，已经不是单张卡片的版式问题，中断本片
   ```

   验证完已撤销注入、重新编译部署，恢复后的构建在同一关键词下正常采集 ✓

10. 正式构建（0.1.2）回归：`本片结束（达到条数目标）：新增 10 条，跳过广告页 1 条、采不动的卡片 0 条，本轮累计 31 条`，随后 `上报结束：批 1，sent 31，failed 0，pending 0` ✓

未覆盖：

- 滚动推进的前进判定没有走到：两片都在到达条数目标时结束，`search_exhausted` 路径未实测
- 连续重复 10 条的 `duplicates` 路径未实测
- 连采 10 条未做，实测规模是 4 条

单条耗时实测 20 到 25 秒（含 6 秒搜索页固定等待），比抖音的 35 到 40 秒快。

[DONE]
