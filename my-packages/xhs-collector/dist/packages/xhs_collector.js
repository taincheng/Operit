/* METADATA
{
    "name": "xhs_collector",
    "display_name": {
        "zh": "小红书采集",
        "en": "Xiaohongshu Collector"
    },
    "description": {
        "zh": "按关键词采集小红书搜索结果的分享链接并上报。逐条进详情取链后落盘到 records.jsonl，再由 outbox 批量上报到服务端。",
        "en": "Collect share links from Xiaohongshu search results for a keyword and upload them. Each link is appended to records.jsonl, and the outbox uploads them in batches."
    },
    "enabledByDefault": true,
    "category": "Automatic",
    "tools": [
        {
            "name": "xhs_collect_share_link",
            "description": {
                "zh": "取出当前打开的笔记的分享链接与真实笔记ID（content_id）。流程是按页型点分享入口、点面板里的「复制链接」，再从评论输入框回读剪贴板内容并清空。必须停在笔记详情页调用，它不会自己导航。",
                "en": "Extract the share link of the note currently open on its detail page: open the share sheet according to the page type, tap the copy-link item, then paste the clipboard into the comment field, read it back and clear it. Must be called on a note detail page; it does not navigate."
            },
            "parameters": []
        },
        {
            "name": "xhs_collect_share_links",
            "description": {
                "zh": "采集小红书搜索结果的分享链接，一次运行只做一片。每条记录带真实笔记ID（content_id，从短链跳转后的分享页解析 noteId），三个采集包统一用它当身份，服务端按 (source, content_id) 认同一篇笔记。用 deep link 打开搜索结果页，读一屏可见的笔记卡片，逐张点进去取链再返回列表，采完一屏往下滚一屏。之所以每条都要回列表，是因为视频笔记详情页下滑进入的是推荐流而不是搜索结果（实测在 142 条结果里找不到下滑到的那条），不能像抖音那样在详情页内把一页取完。商家/广告笔记的底栏是咨询入口、没有评论输入框，分享链接读不出来，这类页面整条跳过并继续下一张；其他版式意外对不上的卡片同样跳过该卡继续下一张，但连着 5 张都采不动就中断本片。每条记录立即追加到 records.jsonl 并建 pending 的 outbox 记录，已在库里的短链跳过。按条数目标或时间上限先到者结束本片，结果集翻到底也会结束，结束原因写进 progress.json。每条记录带 keyword_in_title 与 promo_hint 两个标记（标题是否含关键词、卡片是否有推广角标），只标记不过滤，是否丢弃交由服务端决定。",
                "en": "Collect share links from Xiaohongshu search results, one chunk per run. Every record carries the stable note id (noteId parsed from the share page the short link redirects to), the identity all three collectors share. Opens the result page through a deep link, reads the visible note cards, opens each one to take its link and returns to the list, then scrolls one screen when the visible cards are done. Returning to the list for every note is required because swiping down inside a video note detail page rolls into recommendations rather than the next search result (the swiped-to note was absent from a scan of 142 result titles), so the Douyin approach of finishing a page inside the detail view does not apply. Merchant/ad notes carry a consult button instead of the comment input, so their share link cannot be read back; those pages are skipped entirely and the run moves on to the next card. Cards whose layout does not match are skipped the same way, but five unusable cards in a row abort the chunk. Every record is appended to records.jsonl with a pending outbox entry; links already stored are skipped. The chunk ends on the item target, the time limit, or an exhausted result list, and the reason is written to progress.json. Every record carries keyword_in_title and promo_hint markers (whether the title mentions the keyword, whether the card carries a promo badge); they are markers only, so the server decides what to drop."
            },
            "parameters": [
                {
                    "name": "keyword",
                    "description": { "zh": "搜索关键词", "en": "Search keyword" },
                    "type": "string",
                    "required": true
                },
                {
                    "name": "count",
                    "description": { "zh": "本片最多采集多少条，默认 1", "en": "Maximum items to collect in this chunk, default 1" },
                    "type": "number",
                    "required": false
                },
                {
                    "name": "chunk_minutes",
                    "description": { "zh": "本片时间上限，单位分钟，默认 18，最多 20", "en": "Time limit for this chunk in minutes, default 18, maximum 20" },
                    "type": "number",
                    "required": false
                }
            ]
        },
        {
            "name": "xhs_outbox_flush",
            "description": {
                "zh": "把 outbox 里所有 pending 的记录按每批 20 条上报到配置的服务器。地址与令牌在工具箱的「小红书采集设置」页里配置，与抖音采集共用同一份。200/202 按响应里的 accepted 与 rejected 逐条置状态，429 停止本轮，5xx 与网络错误保持 pending 并累加尝试次数，其他 4xx 置 failed。failed 不自动重发。",
                "en": "Upload all pending outbox records to the configured server in batches of 20. The base URL and token are configured on the Xiaohongshu Collector settings page in the toolbox and are shared with the Douyin collector. On 200/202 each record is set from the response's accepted and rejected lists; 429 stops this round; 5xx and network errors stay pending with an incremented attempt count; other 4xx become failed. Failed records are not retried automatically."
            },
            "parameters": []
        },
        {
            "name": "xhs_upload_config_check",
            "description": {
                "zh": "自检上报配置：地址是否可达、令牌是否被接受。做法是故意发一个空批次，服务端按参数校验拒收它，不会写入任何数据；而拒收之前鉴权已经做完，所以「参数校验类的 400」正好证明配置可用。",
                "en": "Self-check the upload configuration: whether the base URL is reachable and the token is accepted. It deliberately sends an empty batch which the server rejects on parameter validation, so nothing is written; since authentication happens before validation, a parameter-validation 400 is exactly the proof that the configuration works."
            },
            "parameters": []
        },
        {
            "name": "xhs_outbox_status",
            "description": {
                "zh": "统计记录与 outbox 的状态：pending、sent、failed 各多少条，以及文件位置。",
                "en": "Report record and outbox counts: how many are pending, sent and failed, plus the file locations."
            },
            "parameters": []
        },
        {
            "name": "xhs_migrate_upload_config",
            "description": {
                "zh": "把早期版本带 DOUYIN_ 前缀的上报配置键搬到中立键上，然后清空旧键。设置页加载时会自动调用；正常使用不需要手动跑。迁移完成后再调用是空操作。",
                "en": "Move the upload configuration from the legacy DOUYIN_-prefixed keys to the neutral keys, then clear the legacy ones. The settings page calls this on load; there is no need to run it by hand. Calling it again after the migration is a no-op."
            },
            "parameters": []
        }
    ]
}
*/
// 小红书包名。
const XHS_PACKAGE = "com.xingin.xhs";
// deep link 直达搜索结果页。注意 https 分享链接会弹选择器，所以这里必须走 scheme 并显式指定包名。
const XHS_SEARCH_SCHEME = "xhsdiscover://search/result";
// 搜索页要等瀑布流首屏图片加载，固定等待比条件等待更早能用。
const SEARCH_LOAD_WAIT_MS = 6000;
// 搜索结果页的等待上限。首屏图片多，加上 provider 偶发读失败，10 秒不够。
const SEARCH_PAGE_TIMEOUT_MS = 30000;
const STEP_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 500;
// 连续读页面失败时的退避上限
const MAX_READ_BACKOFF_MS = 3000;
const UI_SETTLE_MS = 800;
// 把小红书切到前台的等待上限。含应用切换本身与偶发的读页面失败重试。
const FOREGROUND_WAIT_TIMEOUT_MS = 15000;
const SWIPE_DURATION_MS = 400;
// 分享面板。图文笔记与视频笔记点开的是同一个面板：标题「分享至」，动作行第一项是「复制链接」。
// 点完「复制链接」面板会自行关闭，不需要按返回键（这一点与抖音不同）。
const SHARE_PANEL_COPY_ITEM_TEXT = "复制链接";
const SHARE_PANEL_CLOSE_SETTLE_MS = 1500;
// 详情页有两种，分享入口与评论入口各不相同。
// 页型按节点特征判定，不用 activityName：抖音那边实测过它有时返回根视图类名。
const VIDEO_FEED_SHARE_DESC = "分享"; // 视频笔记右上角，content-desc 恰为「分享」
const NOTE_SHARE_ENTRY_ID_SUFFIX = "moreOperateIV"; // 图文笔记右上角，是页面里少数没被混淆的 id
const NOTE_COMMENT_ENTRY_DESC = "评论框"; // 图文笔记底栏评论入口的 content-desc
const FEED_COMMENT_ENTRY_TEXT = "说点什么..."; // 视频笔记底栏评论入口，没有 content-desc
const VIDEO_AUTHOR_DESC_PREFIX = "作者"; // 视频笔记页作者，形如「作者砍价老李➕装修避坑」
const NOTE_AUTHOR_ID_SUFFIX = "nickNameTV"; // 图文笔记页作者
// 结果列表。搜索页第二行是筛选 chip，吸顶占住 y ∈ [374,497]；卡片会滑到它下面被裁切，
// 此时卡片中心点落在筛选栏上，一点就打开筛选面板。所以只点完整落在下面这一段里的卡片。
// 这两个数值是 1080x2400 上实测的（应用窗口 y ∈ [104,2267]），换分辨率要重测。
const LIST_VIEWPORT_TOP = 497;
const NAV_BAR_HEIGHT = 133;
// 一般节点（分享入口、评论入口）的可见性判据：中心点不能落在顶部栏里，也不能落在导航栏里。
const VISIBLE_TOP_MARGIN = 420;
const APP_BOTTOM_INSET = 150;
// 笔记详情页的底栏高度（应用窗口最下面这一条）。广告/咨询页的咨询入口只出现在这里，
// 正文或评论里出现同样字样不算，所以判据必须限定在这一条带内。
const BOTTOM_BAR_HEIGHT = 160;
// 商家/广告笔记把底栏的评论入口换成了咨询入口。这类页面没有可粘贴的输入框，
// 分享链接读不出来，按约定整条跳过、不做采集。
const AD_CONSULT_BUTTON_TEXT = "立即咨询";
const AD_CONSULT_COUNT_SUFFIX = "人已咨询";
// 卡片判据。卡片容器的 class 不稳定（同一屏里 LinearLayout 与 ViewGroup 都出现过），
// 只能靠结构认：够大的 clickable 容器 + 子树里有长度达标的正文文本 + 不是商品卡。
const CARD_MIN_SIDE = 400;
const CARD_MIN_TEXT_LEN = 15;
// 卡片身份键取正文前若干字符。同一张卡在同一屏里重复出现时靠它去重。
const CARD_KEY_LENGTH = 30;
// 一屏滚动的步长。视口高约 1770、卡片高约 940，600 像素一屏能保证每张卡至少完整可见一次。
const CARD_SCROLL_STEP_PX = 600;
const CARD_SCROLL_SETTLE_MS = 2500;
// 一次滚动没带出任何新卡片就是到了结果集尽头。连续这一次数即结束本片，禁止无判定地一直滚。
const MAX_NO_PROGRESS_SCROLLS = 3;
// 推广标记：卡片上的「广告」角标。只写进记录，不用来决定采不采。
const CARD_PROMO_TEXT = "广告";
// 搜索页就绪的标志：顶部标签行里的「全部」。
// 小红书没有独立的视频/图文标签，采集固定在默认的「全部」标签上，靠卡片分类排除商品卡。
const SEARCH_PAGE_MARKER_TEXT = "全部";
const TAB_ROW_MAX_Y = 400;
// 关掉评论页/退回列表都用返回键，走无障碍的全局动作（GLOBAL_ACTION_BACK），
// 不再用 shell 的 input keyevent 4：采集因此不再需要 Shizuku，权限档「无障碍」即可。
const BACK_KEY_CODE = "KEYCODE_BACK";
// 长按评论输入框后小红书会弹出它自己的工具条，顺序是【常用语】【粘贴】【换行】【自动填充】，
// 「粘贴」是第二个（抖音那边是第一个，两个包的值不能互抄）。
// 工具条不在无障碍节点树里（2026-10-15 实测：树里没有任何含「粘贴」的节点，
// 截图见 docs/TODO/collector_accessibility_only_20261015/shots/02_xhs_longpress.png），
// 所以只能按坐标点它。偏移量以「输入框左上角」为锚点，是小红书 9.22.1 / 1080x2400 上的实测值
// （输入框 [84,1105][996,1204] 时「粘贴」按钮中心在 (337,936)），换版本或换分辨率要重新量。
const PASTE_BUTTON_OFFSET_X = 253;
const PASTE_BUTTON_OFFSET_Y = -169;
// 工具条有弹出动画，长按之后要等它可点。
const PASTE_TOOLBAR_SETTLE_MS = 1200;
// 无障碍档返回的 class 是简名，例如 EditText；shell 的 uiautomator 档返回全名，例如 android.widget.EditText。
// 用简名配合部分匹配，两种档位都能命中。
const EDIT_TEXT_CLASS = "EditText";
// 分享文本形如
// 「装一个很我的家｜房子变成家，家代表了我 之前，装修... https://xhslink.cn/o/85Lns6HOD4i \n把文本复制好，来【小红书】看看这篇笔记吧！」
// 尾句是随机的（同一天实测到五种措辞），所以只抽链接本身。
// 域名是 xhslink.cn（不是 .com），路径形如 /o/<短码>。
const XHS_SHARE_URL_PATTERN = /https?:\/\/xhslink\.(?:cn|com)\/[A-Za-z0-9_\-/]+/;
// 稳定笔记身份：分享页 JSON 里的 noteId（24 位十六进制）。
// 小红书的短码实测是稳定的（321 条历史记录只重复 1 条），但契约要求三个平台统一用
// content_id 当身份，所以这里也解析一次，服务端按 (source, content_id) 认同一篇笔记。
const XHS_CONTENT_ID_PATTERN = /"noteId"\s*:\s*"([0-9a-fA-F]{16,32})"/;
// 分享页对非浏览器 UA 会返回不同的内容，用移动端 Safari 的 UA 实测能拿到含 noteId 的整页。
const SHARE_PAGE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1";
const CONTENT_RESOLVE_CONNECT_TIMEOUT_MS = 10000;
const CONTENT_RESOLVE_READ_TIMEOUT_MS = 15000;
/**
 * 单张卡片采不动时抛这个。
 *
 * 采集循环接住它、跳过这张卡继续下一张；其他错误照旧往上抛、中断整片。
 * 分界线是「问题属于这张卡片的页面形态」还是「属于整轮的环境」：
 * 页面形态不认识、分享入口/面板项/回读落点找不到，都是前者；
 * 小红书切不到前台、搜索结果页打不开、文件写不进去，都是后者。
 */
class CardUnusableError extends Error {
    constructor(message) {
        super(message);
        this.name = "CardUnusableError";
    }
}
async function readRoot() {
    const page = await Tools.UI.getPageInfo();
    return UINode.fromPageInfo(page);
}
/** 超时失败时把当前页面概况写进错误里，便于定位是哪一步的现场不对。 */
async function describeCurrentPage() {
    const page = await Tools.UI.getPageInfo();
    const root = UINode.fromPageInfo(page);
    const texts = root.allTexts(true, true).slice(0, 10);
    const nodes = root.findAll(() => true, true);
    return `包名=${page.packageName} Activity=${page.activityName} 节点数=${nodes.length} 文本=[${texts.join(" | ")}]`;
}
// 读取失败时用于拼错误信息。catch 到的东西本身是未知的，这里只做一次收窄。
function errorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
/**
 * 轮询到条件满足为止。超时直接抛错，不做别的尝试。
 *
 * 读页面本身会偶发失败：宿主读无障碍树时三次重试只隔 300ms，页面动画期间会连续超时，
 * 日志里表现为 Failed to retrieve UI data via accessibility service.
 * 在「等条件出现」这个语义下，这类失败等同于「还没就绪」，继续轮询到超时为止；
 * 超时信息里带上最后一次读取失败的原因，避免掩盖真实问题。
 */
async function waitForNode(match, what, timeoutMs = STEP_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let lastReadError = "";
    let consecutiveReadFailures = 0;
    while (Date.now() < deadline) {
        try {
            const root = await readRoot();
            const found = match(root);
            if (found) {
                return found;
            }
            consecutiveReadFailures = 0;
        }
        catch (error) {
            lastReadError = errorMessage(error);
            consecutiveReadFailures += 1;
            console.log(`读页面失败第 ${consecutiveReadFailures} 次，继续等待「${what}」：${lastReadError}`);
            // 读失败往往是读得太频把无障碍 provider 压住了，退避一下再读，
            // 否则每 500ms 打一次只会让它一直缓不过来。
            const backoffMs = Math.min(POLL_INTERVAL_MS * consecutiveReadFailures, MAX_READ_BACKOFF_MS);
            await Tools.System.sleep(backoffMs);
            continue;
        }
        await Tools.System.sleep(POLL_INTERVAL_MS);
    }
    const readErrorNote = lastReadError ? `最后一次读页面失败：${lastReadError}；` : "";
    let scene = "现场读取失败";
    try {
        scene = await describeCurrentPage();
    }
    catch (error) {
        scene = `现场读取失败：${errorMessage(error)}`;
    }
    throw new Error(`等待「${what}」超时，${timeoutMs}ms 内没有出现。${readErrorNote}${scene}`);
}
/**
 * 等一个「只有当前这张卡片的页面形态才对」的节点。
 *
 * 等不到就抛 CardUnusableError，由采集循环跳过这张卡继续下一张。
 * 只用在节点缺失说明页面形态不认识的地方；搜索结果页、前台应用这类整轮环境仍走 waitForNode。
 */
async function waitForCardNode(match, what, timeoutMs = STEP_TIMEOUT_MS) {
    try {
        return await waitForNode(match, what, timeoutMs);
    }
    catch (error) {
        throw new CardUnusableError(`这张卡片的页面形态采不动：等「${what}」失败：${errorMessage(error)}`);
    }
}
async function tapNode(node, what) {
    const point = node.centerPoint;
    if (!point) {
        throw new Error(`节点「${what}」没有可用坐标`);
    }
    // 点击前把目标节点的身份写进日志，坐标点错时可以直接从日志看出点到了什么
    console.log(`点击「${what}」坐标=(${point.x},${point.y}) class=${node.className ?? ""} desc=${node.contentDesc ?? ""} text=${(node.text ?? "").slice(0, 16)} bounds=${node.bounds ?? ""}`);
    await Tools.UI.tap(point.x, point.y);
}
/**
 * 确保小红书在取链前处于前台。
 *
 * 无障碍服务读的是当前活动窗口，从 Operit 界面调用本工具时前台是 Operit，
 * 不切换就只能读到 Operit 自己的节点树。
 *
 * 读页面会偶发失败：宿主读无障碍树时三次重试只隔 300ms，页面动画期间会连续超时。
 * 在「等到小红书在前台」这个语义下，这类失败等同于「还没就绪」，退避后继续等到超时为止，
 * 超时信息里带上最后一次读失败的原因，不掩盖真实故障。
 */
async function ensureXhsForeground() {
    const deadline = Date.now() + FOREGROUND_WAIT_TIMEOUT_MS;
    let switchRequested = false;
    let lastPackage = "";
    let lastReadError = "";
    let consecutiveReadFailures = 0;
    while (Date.now() < deadline) {
        try {
            const current = await Tools.UI.getPageInfo();
            lastPackage = current.packageName;
            if (current.packageName === XHS_PACKAGE) {
                return;
            }
            consecutiveReadFailures = 0;
            if (!switchRequested) {
                await Tools.System.startApp(XHS_PACKAGE);
                switchRequested = true;
            }
        }
        catch (error) {
            lastReadError = errorMessage(error);
            consecutiveReadFailures += 1;
            console.log(`读前台应用失败第 ${consecutiveReadFailures} 次，继续等待小红书就绪：${lastReadError}`);
            await Tools.System.sleep(Math.min(POLL_INTERVAL_MS * consecutiveReadFailures, MAX_READ_BACKOFF_MS));
            continue;
        }
        await Tools.System.sleep(POLL_INTERVAL_MS);
    }
    const readNote = lastReadError ? `最后一次读页面失败：${lastReadError}；` : "";
    throw new Error(`等待小红书切到前台超时，当前前台是 ${lastPackage || "未知"}。${readNote}`);
}
/** 解析一个 ["x1,y1][x2,y2"] 形式的边界。滚出屏幕的节点会给反向边界，交给调用方判 y2<=y1。 */
function parseBounds(bounds) {
    const matched = (bounds ?? "").match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
    if (!matched) {
        return undefined;
    }
    return {
        x1: Number(matched[1]),
        y1: Number(matched[2]),
        x2: Number(matched[3]),
        y2: Number(matched[4]),
    };
}
function parseTopY(bounds) {
    const matched = (bounds ?? "").match(/^\[\d+,(\d+)\]/);
    return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
}
// 网格排序用。结果是两列瀑布流，同一行要按左边界分先后。
function parseLeftX(bounds) {
    const matched = (bounds ?? "").match(/^\[(\d+),/);
    return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
}
/**
 * 判断节点是否真的落在可点击的可视区域内。
 *
 * 两个坑：
 * 1. 被滚出屏幕的节点会给出反向边界，例如 [56,354][723,70]，只比较上边坐标会误判；
 * 2. 中心点落在顶部栏或底部导航栏里时，点击不会传给应用。
 */
function isNodeVisible(node, screenHeight) {
    const box = parseBounds(node.bounds);
    if (!box || box.y2 <= box.y1) {
        return false;
    }
    const point = node.centerPoint;
    if (!point) {
        return false;
    }
    return point.y > VISIBLE_TOP_MARGIN && point.y < screenHeight - APP_BOTTOM_INSET;
}
/**
 * 屏幕高度。走宿主的 device_info（DisplayMetrics），不再用 shell 的 wm size：
 * 无障碍档下 execute_shell 直接不可用，而 device_info 与 wm size 在同一台机器上取值一致。
 */
async function readScreenHeight() {
    const info = await Tools.System.getDeviceInfo();
    const matched = info.screenResolution.match(/(\d+)\s*x\s*(\d+)/);
    if (!matched) {
        throw new Error(`无法从 device_info 的 screenResolution 解析屏幕高度：${info.screenResolution}`);
    }
    return Number(matched[2]);
}
/**
 * 取节点边界的左上角。解析不出来（或落到屏幕外）就报错，
 * 不能让它带着 MAX_SAFE_INTEGER 之类的哨兵值去点击，那会把点击落到别的地方。
 */
function requireTopLeft(node, what) {
    const matched = (node.bounds ?? "").match(/^\[(-?\d+),(-?\d+)\]/);
    if (!matched) {
        throw new Error(`${what}的边界无法解析：${node.bounds ?? "(无边界)"}`);
    }
    const x = Number(matched[1]);
    const y = Number(matched[2]);
    if (x < 0 || y < 0) {
        throw new Error(`${what}的边界落在屏幕外：${node.bounds}`);
    }
    return { x, y };
}
function findEditText(root) {
    return root.findByClass(EDIT_TEXT_CLASS, { exact: false });
}
/** 商品/直播卡的判据：子树里有以 ¥ 开头的 content-desc，形如「¥1580.¥2080」。 */
function isCommercialCard(card) {
    return card.find((node) => (node.contentDesc ?? "").startsWith("¥"), true) !== undefined;
}
/** 卡片的正文文本，也就是笔记标题加摘要。卡片身份键与记录里的 title 都用它。 */
function cardBodyTextOf(card) {
    const node = card.find((candidate) => (candidate.text ?? "").trim().length >= CARD_MIN_TEXT_LEN, true);
    return node ? (node.text ?? "").trim() : "";
}
function cardKeyOf(card) {
    return cardBodyTextOf(card).slice(0, CARD_KEY_LENGTH);
}
/**
 * 一张卡片是不是可采集的笔记卡片。四条判据缺一不可：
 * clickable、边界正常、完整落在列表可视区里、子树里有正文文本且不是商品卡。
 *
 * 第四条用的是「找得到长度达标的文本」而不是「首个文本够长」：卡片的文本节点排布
 * 随卡片类型变化，不能假设正文一定排在最前面。
 */
function isNoteCard(node, screenHeight) {
    if (!node.isClickable) {
        return false;
    }
    const box = parseBounds(node.bounds);
    if (!box || box.y2 <= box.y1 || box.x2 <= box.x1) {
        return false;
    }
    if (box.x2 - box.x1 < CARD_MIN_SIDE || box.y2 - box.y1 < CARD_MIN_SIDE) {
        return false;
    }
    if (box.y1 < LIST_VIEWPORT_TOP || box.y2 > screenHeight - NAV_BAR_HEIGHT) {
        return false;
    }
    if (isCommercialCard(node)) {
        return false;
    }
    return cardBodyTextOf(node).length >= CARD_MIN_TEXT_LEN;
}
/** 当前视口内可见的笔记卡片，按网格顺序返回：先上后下，同一行先左后右。 */
function findNoteCards(root, screenHeight) {
    return root
        .findAll((node) => isNoteCard(node, screenHeight), true)
        .sort((a, b) => {
        const topDiff = parseTopY(a.bounds) - parseTopY(b.bounds);
        return topDiff !== 0 ? topDiff : parseLeftX(a.bounds) - parseLeftX(b.bounds);
    });
}
/** 搜索结果页就绪的标志：顶部标签行里的「全部」。 */
function findSearchPageMarker(root) {
    return root.find((node) => {
        if ((node.text ?? "") !== SEARCH_PAGE_MARKER_TEXT) {
            return false;
        }
        const point = node.centerPoint;
        return point !== undefined && point.y < TAB_ROW_MAX_Y;
    }, true);
}
/**
 * 商家/广告笔记的判据：底栏那一条带里出现了咨询入口。
 *
 * 判据只看底栏，是因为正文与评论里也可能出现「立即咨询」这类字样，
 * 放宽到整棵树会把普通笔记误判成广告页、白白跳过。
 */
function isAdConsultPage(root, screenHeight) {
    const barTop = screenHeight - NAV_BAR_HEIGHT - BOTTOM_BAR_HEIGHT;
    const barBottom = screenHeight - NAV_BAR_HEIGHT;
    return (root.find((node) => {
        const box = parseBounds(node.bounds);
        if (!box || box.y1 < barTop || box.y2 > barBottom) {
            return false;
        }
        const text = (node.text ?? "").trim();
        return text === AD_CONSULT_BUTTON_TEXT || text.endsWith(AD_CONSULT_COUNT_SUFFIX);
    }, true) !== undefined);
}
/**
 * 按页型判定详情页。
 *
 * 顺序是先广告页、再视频、最后图文，不能颠倒：广告页同样有 moreOperateIV，
 * 先判图文就会把它当成可采集的图文笔记，然后在评论入口上超时。
 *
 * 视频笔记详情页有 content-desc 恰为「分享」的节点；图文笔记详情页没有这个节点，
 * 它的分享入口是右上角的 moreOperateIV。
 */
function detectDetailPageType(root, screenHeight) {
    if (isAdConsultPage(root, screenHeight)) {
        return "ad";
    }
    if (root.find((node) => (node.contentDesc ?? "") === VIDEO_FEED_SHARE_DESC, true)) {
        return "video";
    }
    if (root.find((node) => (node.resourceId ?? "").endsWith(NOTE_SHARE_ENTRY_ID_SUFFIX), true)) {
        return "note";
    }
    return undefined;
}
async function waitForDetailPage(screenHeight) {
    const root = await waitForCardNode((page) => detectDetailPageType(page, screenHeight) === undefined ? undefined : page, "笔记详情页");
    const pageType = detectDetailPageType(root, screenHeight);
    if (pageType === undefined) {
        throw new Error("详情页类型判定失败：既没有分享入口也没有 moreOperateIV");
    }
    return { root, pageType };
}
/** 按页型取分享入口。两个页型各只有一个定位器，页型判错会立刻失败而不是点到别的东西。 */
function findShareEntry(root, pageType) {
    if (pageType === "video") {
        return root.find((node) => (node.contentDesc ?? "") === VIDEO_FEED_SHARE_DESC, true);
    }
    return root.find((node) => (node.resourceId ?? "").endsWith(NOTE_SHARE_ENTRY_ID_SUFFIX), true);
}
/** 按页型取底栏的评论入口。可见性并进匹配条件，避免选中被裁掉的同名节点。 */
function findCommentEntry(root, pageType, screenHeight) {
    return root.find((node) => {
        const matched = pageType === "video"
            ? (node.text ?? "").startsWith(FEED_COMMENT_ENTRY_TEXT)
            : (node.contentDesc ?? "") === NOTE_COMMENT_ENTRY_DESC;
        return matched && isNodeVisible(node, screenHeight);
    }, true);
}
/**
 * 按页型取作者。读不到就是空字符串，上报契约允许这个字段为空。
 *
 * 广告/咨询页与图文笔记的顶栏结构相同，作者同样在 nickNameTV 里，
 * 所以这一支不区分两者：作者属于顶栏，与底栏被换掉没有关系。
 */
function readAuthorOf(root, pageType) {
    if (pageType === "video") {
        const node = root.find((candidate) => (candidate.contentDesc ?? "").startsWith(VIDEO_AUTHOR_DESC_PREFIX), true);
        const desc = node ? node.contentDesc ?? "" : "";
        return desc.slice(VIDEO_AUTHOR_DESC_PREFIX.length).trim();
    }
    const node = root.find((candidate) => (candidate.resourceId ?? "").endsWith(NOTE_AUTHOR_ID_SUFFIX), true);
    return node ? (node.text ?? "").trim() : "";
}
async function openSearch(keyword) {
    const uri = `${XHS_SEARCH_SCHEME}?keyword=${encodeURIComponent(keyword)}`;
    console.log(`打开搜索结果页：${uri}`);
    await Tools.System.intent({
        type: "activity",
        action: "android.intent.action.VIEW",
        uri,
        package: XHS_PACKAGE,
    });
    await Tools.System.sleep(SEARCH_LOAD_WAIT_MS);
    await waitForNode(findSearchPageMarker, "搜索结果页", SEARCH_PAGE_TIMEOUT_MS);
}
/** 列表往下滚一屏。步长见 CARD_SCROLL_STEP_PX 的说明。 */
async function scrollList(screenHeight) {
    const fromY = screenHeight - 500;
    await Tools.UI.swipe(540, fromY, 540, fromY - CARD_SCROLL_STEP_PX, SWIPE_DURATION_MS);
    await Tools.System.sleep(CARD_SCROLL_SETTLE_MS);
}
/**
 * 当前是不是停在搜索结果页。读页面偶发失败时按「不是」处理，交给外层再退一层。
 */
async function isOnSearchList() {
    try {
        await waitForNode(findSearchPageMarker, "搜索结果页", STEP_TIMEOUT_MS);
        return true;
    }
    catch (error) {
        console.log(`判断是否在搜索结果页时读页面失败：${errorMessage(error)}`);
        return false;
    }
}
/**
 * 退回搜索结果页。
 *
 * 正常路径是「详情页 → 一层返回 → 列表」，先看一眼再决定要不要退，
 * 避免已经在列表上时多按一次返回把小红书退出到桌面。
 * 卡片中途失败时页面可能停在分享面板或评论页，所以按「退一层、看一次」推进，
 * 最多 MAX_BACK_TO_LIST_ATTEMPTS 层；退不回去说明不是单张卡片的问题，抛错中断本片。
 */
async function returnToSearchList() {
    for (let attempt = 0; attempt <= MAX_BACK_TO_LIST_ATTEMPTS; attempt += 1) {
        if (await isOnSearchList()) {
            return;
        }
        if (attempt === MAX_BACK_TO_LIST_ATTEMPTS) {
            break;
        }
        // 走无障碍全局动作，不用 shell：无障碍档下没有 shell。
        await Tools.UI.pressKey(BACK_KEY_CODE);
        await Tools.System.sleep(UI_SETTLE_MS);
    }
    throw new Error(`连续返回 ${MAX_BACK_TO_LIST_ATTEMPTS} 层都没有回到搜索结果页，中断本片`);
}
/**
 * 读剪贴板里的分享文本并抽出链接。
 *
 * 这里用「粘贴进输入框再读回」而不是 read_clipboard，是实测决定的：
 * Android 10 起只有获得焦点的应用才能读系统剪贴板，采集时前台是小红书，
 * 后台的 Operit 用 read_clipboard 只能读到空字符串；shell 身份直读也被系统拒掉。
 * 粘贴回读不受这条限制。粘贴目标必须是详情页的评论入口，不能是搜索框。
 *
 * 粘贴这一步也让小红书自己做：长按评论框弹出它自己的工具条，再点工具条上的「粘贴」。
 * 于是整条取链链路不需要 shell，权限档「无障碍」就能跑（不再需要 Shizuku）。
 * 工具条不在节点树里、只能按坐标点的原因与重测方法见 PASTE_BUTTON_OFFSET_* 的注释。
 */
async function pasteAndReadShareText(pageType, screenHeight) {
    const entry = await waitForCardNode((page) => findCommentEntry(page, pageType, screenHeight), "评论入口");
    await tapNode(entry, "评论入口");
    // 评论入口点开后是 NoteCommentActivity，里面只有一个 EditText。
    // 占位文案每次都可能不同（实测到「留下你的想法吧」与「有话要说，快来评论」），只能按 class 找。
    const input = await waitForCardNode(findEditText, "评论输入框");
    await tapNode(input, "评论输入框");
    await Tools.System.sleep(UI_SETTLE_MS * 2);
    // 粘上之后无论成败都必须清空。清理一旦放回成功路径，回读超时就会把粘贴内容
    // 留在评论框里成一条草稿，而且下一条会接在它后面。
    try {
        // 点击之后重新读输入框：聚焦/键盘弹出会让布局变化，长按必须用当前坐标。
        const panelInput = await waitForCardNode((page) => {
            const edit = findEditText(page);
            return edit && isNodeVisible(edit, screenHeight) ? edit : undefined;
        }, "评论输入框（聚焦后）");
        // 工具条的按钮集合取决于输入框里有没有文本：空的时候是【常用语】【粘贴】【换行】【自动填充】，
        // 里面有草稿时按钮会变、最左那个就不是「粘贴」了，坐标会点错。所以长按前先置空，
        // 让这一击的前提确定；上一轮的清理在 finally 里，正常情况下本来就是空的。
        await toolCall("set_input_text", { text: "" });
        await Tools.System.sleep(UI_SETTLE_MS);
        const panelPoint = panelInput.centerPoint;
        if (!panelPoint) {
            throw new Error(`评论输入框没有可用坐标：${panelInput.bounds ?? "(无边界)"}`);
        }
        await Tools.UI.longPress(panelPoint.x, panelPoint.y);
        await Tools.System.sleep(PASTE_TOOLBAR_SETTLE_MS);
        const panelTopLeft = requireTopLeft(panelInput, "评论输入框");
        await Tools.UI.tap(panelTopLeft.x + PASTE_BUTTON_OFFSET_X, panelTopLeft.y + PASTE_BUTTON_OFFSET_Y);
        const filled = await waitForCardNode((page) => {
            const edit = findEditText(page);
            const text = edit?.text ?? "";
            return XHS_SHARE_URL_PATTERN.test(text) ? edit : undefined;
        }, "粘贴后的分享文本（长按评论框弹出的工具条上的「粘贴」）");
        const shareText = filled.text ?? "";
        const matched = shareText.match(XHS_SHARE_URL_PATTERN);
        if (!matched) {
            throw new Error(pasteMismatchMessage(shareText));
        }
        return { url: matched[0], shareText };
    }
    finally {
        await clearCommentInput();
    }
}
/**
 * 粘进来的东西不是小红书分享链接时的报错。
 *
 * 最常见的原因是「复制链接」那一步没真正把链接写进剪贴板，于是被粘进来的是剪贴板里
 * 原有的内容。带上开头一小段，出问题时能一眼看出粘到了什么，不用翻节点树。
 */
function pasteMismatchMessage(shareText) {
    const preview = shareText.trim().slice(0, 40);
    return `粘进来的内容里没有小红书分享链接，复制那一步可能没生效。内容开头：${preview || "(空)"}`;
}
/**
 * 清空评论输入框并收起页面与键盘，回到笔记详情页。
 *
 * 清空走宿主的 set_input_text（provider 的 setTextOnNode），不再用 shell 的 Ctrl+A 和 DEL：
 * 无障碍档下没有 shell，而且 setTextOnNode 是整体替换语义，不依赖光标位置。
 * JS 侧目前没有 Tools.UI.setInputText 封装，所以按工具名直接调。
 */
async function clearCommentInput() {
    await toolCall("set_input_text", { text: "" });
    await Tools.System.sleep(UI_SETTLE_MS);
    await Tools.UI.pressKey(BACK_KEY_CODE);
    await Tools.System.sleep(UI_SETTLE_MS);
}
/**
 * 在当前笔记详情页取一次分享链接。
 *
 * 步骤固定为：按页型点分享入口 → 点面板里的「复制链接」→ 面板自行关闭 → 从评论入口粘贴回读。
 * 单条工具与批量采集共用这一段，避免两处逻辑各自漂移。
 *
 * 广告/咨询页在读页面时就认出来并直接返回跳过，连分享入口都不点：
 * 这类页面点了也读不出链接，白白改一次剪贴板。
 */
async function extractShareOnDetailPage(screenHeight) {
    const { root, pageType } = await waitForDetailPage(screenHeight);
    const author = readAuthorOf(root, pageType);
    if (pageType === "ad") {
        return { skipped: true, pageType: "ad", author };
    }
    const entry = findShareEntry(root, pageType);
    if (!entry) {
        throw new CardUnusableError(`详情页上找不到分享入口（页型 ${pageType}）。现场：${await describeCurrentPage()}`);
    }
    await tapNode(entry, "分享入口");
    // 等「复制链接」出现。它只在分享面板里出现，所以它出现就等于面板已经打开。
    // 可见性并进匹配条件：面板高度会随内容变化，落在导航栏里的点击不会传给应用。
    const copyItem = await waitForCardNode((page) => page.find((node) => {
        const label = (node.text ?? "") || (node.contentDesc ?? "");
        return label === SHARE_PANEL_COPY_ITEM_TEXT && isNodeVisible(node, screenHeight);
    }, true), `分享面板里的「${SHARE_PANEL_COPY_ITEM_TEXT}」`);
    await tapNode(copyItem, SHARE_PANEL_COPY_ITEM_TEXT);
    // 点完面板自行关闭，这里只是等关闭动画结束
    await Tools.System.sleep(SHARE_PANEL_CLOSE_SETTLE_MS);
    const { url, shareText } = await pasteAndReadShareText(pageType, screenHeight);
    // 短码实测稳定，但契约要求三个包统一用平台真实 id 当身份，这里跟着解析一次。
    // 这一步只发一个 HTTP 请求，不依赖界面，评论输入框此时也已经清空。
    const contentId = await resolveContentId(url);
    console.log(`笔记身份解析成功：${url} -> content_id=${contentId}`);
    return { skipped: false, pageType, author, url, shareText, contentId };
}
async function xhs_collect_share_link() {
    await ensureXhsForeground();
    const screenHeight = await readScreenHeight();
    const outcome = await extractShareOnDetailPage(screenHeight);
    if (outcome.skipped) {
        // 单条工具是「把当前这条取出来」的语义，遇到广告页没有东西可给，如实报错
        throw new Error(`当前笔记是广告/咨询页（底栏是「${AD_CONSULT_BUTTON_TEXT}」），没有可采集的分享链接`);
    }
    return {
        success: true,
        url: outcome.url,
        shareText: outcome.shareText,
        contentId: outcome.contentId,
    };
}
const DEFAULT_COLLECT_COUNT = 1;
// 连续命中已采集过的笔记到这个数就停，避免结果集已全部采过时还在整条列表上空转。
const MAX_CONSECUTIVE_SKIPS = 10;
// 连续多少张卡片采不动就中断本片。单张版式意外允许跳过，
// 连着这么多张都采不动已经不是版式问题，继续跳只会把数据缺口藏起来。
const MAX_CONSECUTIVE_UNUSABLE = 5;
// 退回搜索结果页时最多退几层。卡片中途失败可能停在分享面板或评论页，一层退不回去。
const MAX_BACK_TO_LIST_ATTEMPTS = 3;
// 单片时间上限。脚本硬超时是 30 分钟，这里留出安全边际，默认 18 分钟，最多允许 20 分钟。
const DEFAULT_CHUNK_MINUTES = 18;
const MAX_CHUNK_MINUTES = 20;
// ===== 记录落地与 outbox 上报 =====
//
// 采集与上报解耦：采集只往 records.jsonl 追加记录，上报由 outbox.json 驱动。
// 脚本被杀或超时都不会丢记录，重放安全。上报契约见
// docs/TODO/device_automation_platform_20261008/03_record_store_and_outbox.md。
const PLUGIN_ID = "xhs_collector";
const CONFIG_DIR = getPluginConfigDir(PLUGIN_ID);
const RECORDS_FILE = `${CONFIG_DIR}/records.jsonl`;
const OUTBOX_FILE = `${CONFIG_DIR}/outbox.json`;
const PROGRESS_FILE = `${CONFIG_DIR}/progress.json`;
// 上报地址与令牌存在宿主的环境变量里，不再落成文件。
// 该存储是全局键值、不按包隔离（EnvPreferences）。服务端只有一个，
// 所以本包与抖音采集包共用同一组中立键，键名不带来源前缀。
// 设置入口是工具箱里的「小红书采集设置」页，读写分别走 UI 模块的 setEnv 与脚本的 getEnv。
const ENV_BASE_URL = "COLLECTOR_BASE_URL";
const ENV_TOKEN = "COLLECTOR_TOKEN";
// 待迁移的键名。这组键是抖音包早期版本留下的：服务端只有一个，两个采集包共用中立键，
// 所以小红书这一侧也要把抖音的旧键搬过来，用户先打开哪个设置页都不影响结果。
// 一次性迁移见 migrateLegacyUploadConfig，迁移跑完旧键即被清空，
// 下个发布周期连同迁移一起删。
const LEGACY_ENV_BASE_URL = "DOUYIN_COLLECTOR_BASE_URL";
const LEGACY_ENV_TOKEN = "DOUYIN_COLLECTOR_TOKEN";
const UPLOAD_PATH = "/api/v1/records";
// 批量条数取自上报契约
const UPLOAD_BATCH_SIZE = 20;
const HTTP_CONNECT_TIMEOUT_MS = 15000;
const HTTP_READ_TIMEOUT_MS = 30000;
// source 固定值，为将来的其他来源留位
const RECORD_SOURCE = "xiaohongshu_app";
/**
 * 幂等键。QuickJS 没有 crypto，用 Math.random 拼 v4；键在采集时生成，
 * 重发时保持不变，服务端按它去重。
 */
function randomId() {
    const digits = "0123456789abcdef";
    const hex = [];
    for (let i = 0; i < 32; i += 1) {
        hex.push(digits.charAt(Math.floor(Math.random() * 16)));
    }
    const variant = "89ab".charAt(Math.floor(Math.random() * 4));
    return (hex.slice(0, 8).join("") +
        "-" +
        hex.slice(8, 12).join("") +
        "-4" +
        hex.slice(13, 16).join("") +
        "-" +
        variant +
        hex.slice(17, 20).join("") +
        "-" +
        hex.slice(20, 32).join(""));
}
function nowIso() {
    // toISOString 带 Z，属于 ISO8601 的时区表示
    return new Date().toISOString();
}
/**
 * 分享短链归一化后的笔记标识，用于本地去重。
 *
 * 实测同一条笔记两次独立取链得到同一个短链（https://xhslink.cn/o/85Lns6HOD4i），
 * 所以短码可以当身份用。标题会被 App 截断，稳定性不如短链。
 */
/**
 * 从分享短链解析出稳定的笔记身份 content_id。
 *
 * 短码（xhslink.cn/o/<短码>）实测是稳定的，但契约要求三个采集包统一用平台真实 id 当身份，
 * 服务端也按 (source, content_id) 认同一篇笔记，所以这里跟着解析。
 * 稳定身份在跳转后的分享页里：\"noteId\":\"6a263ade0000000022024db0\"。
 *
 * 解析失败直接抛错，不退回用短码：身份来源必须三个平台一致，否则服务端的判重会时灵时不灵。
 */
async function resolveContentId(shareUrl) {
    const response = await Tools.Net.http({
        url: shareUrl,
        method: "GET",
        headers: {
            "User-Agent": SHARE_PAGE_USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        connect_timeout: CONTENT_RESOLVE_CONNECT_TIMEOUT_MS,
        read_timeout: CONTENT_RESOLVE_READ_TIMEOUT_MS,
    });
    if (response.statusCode !== 200) {
        throw new Error(`解析笔记身份失败：${shareUrl} 返回 HTTP ${response.statusCode}`);
    }
    const matched = String(response.content ?? "").match(XHS_CONTENT_ID_PATTERN);
    if (!matched) {
        throw new Error(`解析笔记身份失败：${shareUrl} 的分享页里没有 noteId（页面可能改版或被风控）`);
    }
    return matched[1];
}
async function readTextFile(path) {
    const exists = await Tools.Files.exists(path, "android");
    if (!exists.exists) {
        return "";
    }
    const file = await Tools.Files.read(path);
    return file.content;
}
async function loadRecords() {
    const content = await readTextFile(RECORDS_FILE);
    const records = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (!line) {
            continue;
        }
        try {
            records.push(JSON.parse(line));
        }
        catch (error) {
            throw new Error(`records.jsonl 第 ${i + 1} 行不是合法 JSON：${errorMessage(error)}`);
        }
    }
    return records;
}
async function loadOutbox() {
    const content = await readTextFile(OUTBOX_FILE);
    if (!content.trim()) {
        return { entries: {} };
    }
    const parsed = JSON.parse(content);
    if (!parsed.entries) {
        throw new Error(`outbox.json 结构不对，缺少 entries 字段：${OUTBOX_FILE}`);
    }
    return parsed;
}
async function saveOutbox(outbox) {
    await Tools.Files.write(OUTBOX_FILE, JSON.stringify(outbox, null, 2), false, "android");
}
function outboxEntryOf(outbox, key) {
    const entry = outbox.entries[key];
    if (entry) {
        return entry;
    }
    const created = {
        status: "pending",
        attempts: 0,
        last_error: "",
        updated_at: nowIso(),
    };
    outbox.entries[key] = created;
    return created;
}
function markOutbox(outbox, key, status, error) {
    const entry = outboxEntryOf(outbox, key);
    entry.status = status;
    entry.last_error = error;
    entry.updated_at = nowIso();
}
/** 把一条采集结果落进 records.jsonl，并给它建一条 pending 的 outbox 记录。返回是否新增。 */
async function appendRecord(outbox, record) {
    await Tools.Files.write(RECORDS_FILE, `${JSON.stringify(record)}\n`, true, "android");
    markOutbox(outbox, record.idempotency_key, "pending", "");
}
async function loadProgress() {
    const content = await readTextFile(PROGRESS_FILE);
    if (!content.trim()) {
        return undefined;
    }
    return JSON.parse(content);
}
async function saveProgress(progress) {
    progress.updated_at = nowIso();
    await Tools.Files.write(PROGRESS_FILE, JSON.stringify(progress, null, 2), false, "android");
}
/**
 * 取出本轮的进度状态。
 * 同一个关键词的上一轮没结束就续上同一轮，换了关键词就开新一轮。
 */
async function startProgress(keyword) {
    const previous = await loadProgress();
    if (previous && previous.keyword === keyword) {
        console.log(`续上一轮：关键词=${keyword} 第 ${previous.chunk_index} 片已完成，累计 ${previous.collected_total} 条`);
        return previous;
    }
    return {
        keyword,
        round_id: randomId(),
        chunk_index: 0,
        collected_total: 0,
        last_url: "",
        last_item_id: "",
        last_stop_reason: "",
        last_chunk_started_at: "",
        last_chunk_finished_at: "",
        updated_at: nowIso(),
    };
}
/**
 * 一次性迁移：把带来源前缀的旧键搬到中立键上，然后清掉旧键。
 *
 * 上报地址与令牌改成了不带来源前缀的中立键，两个采集包共用同一组键。
 * 迁移放在读配置这条路径上，是因为无人值守的定时任务不经过设置页：
 * 升级后如果没人打开过设置页，旧键还在而新键为空，上报会一直报「未配置」。
 * 迁移跑完旧键即被清掉，之后每次读配置都是空操作。
 * 新键已经有值时以新键为准，不会被旧值覆盖回去。
 *
 * 下一个发布周期连同这个函数与设置页里那次工具调用一起删。
 */
async function migrateLegacyUploadConfig() {
    for (const [legacy, current] of [
        [LEGACY_ENV_BASE_URL, ENV_BASE_URL],
        [LEGACY_ENV_TOKEN, ENV_TOKEN],
    ]) {
        const legacyValue = (getEnv(legacy) ?? "").trim();
        if (legacyValue.length === 0) {
            continue;
        }
        if ((getEnv(current) ?? "").trim().length === 0) {
            await Tools.SoftwareSettings.writeEnvironmentVariable(current, legacyValue);
        }
        // 空值即清空：宿主在 value 为空时走的是 EnvPreferences.removeEnv
        await Tools.SoftwareSettings.writeEnvironmentVariable(legacy, "");
    }
}
/**
 * 迁移工具：设置页加载时调它。
 *
 * 脚本与 UI 模块是两个运行上下文（QuickJS 与 compose_dsl），不共享代码，
 * 所以设置页通过这个工具触发同一次迁移，页面上就能直接看到搬过来的值。
 */
async function xhs_migrate_upload_config() {
    await migrateLegacyUploadConfig();
    return {
        success: true,
        baseUrlConfigured: (getEnv(ENV_BASE_URL) ?? "").trim().length > 0,
        tokenConfigured: (getEnv(ENV_TOKEN) ?? "").trim().length > 0,
    };
}
/**
 * 读上报配置。
 *
 * 配置在宿主的环境变量里，设置入口是工具箱里的「小红书采集设置」页。
 * 这组键与抖音采集包共用，任何一个包的设置页改的都是同一份配置。
 * 这里不做任何兜底：键缺失就报错，并把该去哪填写说清楚，绝不拿空地址去发请求。
 *
 * 读之前先跑一次旧键迁移，保证无人值守路径也不会读到空的配置。
 */
async function readUploadConfig() {
    await migrateLegacyUploadConfig();
    const baseUrl = (getEnv(ENV_BASE_URL) ?? "").trim();
    const token = (getEnv(ENV_TOKEN) ?? "").trim();
    if (!baseUrl || !token) {
        throw new Error(`未配置上报地址或令牌（地址${baseUrl ? "已设置" : "为空"}，令牌${token ? "已设置" : "为空"}）。` +
            `请在 工具箱 → 小红书采集设置 里填写并保存。`);
    }
    return { base_url: baseUrl, token };
}
// 配置里令牌的脱敏形式，用于自检结果与界面回显
function maskToken(token) {
    if (token.length <= 8) {
        return "*".repeat(token.length);
    }
    return `${token.slice(0, 4)}${"*".repeat(token.length - 8)}${token.slice(-4)}`;
}
// 从服务端响应体里取 message，取不到就把原文截断返回，让界面能直接展示原因
function parseServerMessage(content) {
    const trimmed = content.trim();
    if (!trimmed) {
        return "";
    }
    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed.message === "string") {
            return parsed.message;
        }
    }
    catch (error) {
        console.log(`配置自检：响应体不是 JSON，按原文展示：${errorMessage(error)}`);
    }
    return trimmed.slice(0, 200);
}
async function readClientInfo() {
    const info = await Tools.System.getDeviceInfo();
    return {
        device: info.model,
        app_version: info.additionalInfo["appVersion"] ?? "",
    };
}
/**
 * 发一批。宿主对 4xx 与 5xx 都返回 success=true，所以判定只能基于 statusCode；
 * 网络错误会让这个调用直接抛错，这里接住并归到 retryable，绝不静默丢弃。
 */
async function sendBatch(config, batch, client) {
    const body = JSON.stringify({
        batch_id: randomId(),
        client,
        items: batch,
    });
    let status = 0;
    let content = "";
    let headers = {};
    try {
        const response = await Tools.Net.http({
            url: `${config.base_url}${UPLOAD_PATH}`,
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                Authorization: `Bearer ${config.token}`,
            },
            body,
            connect_timeout: HTTP_CONNECT_TIMEOUT_MS,
            read_timeout: HTTP_READ_TIMEOUT_MS,
        });
        status = response.statusCode;
        content = response.content;
        headers = response.headers;
    }
    catch (error) {
        return {
            httpStatus: 0,
            kind: "retryable",
            acceptedKeys: [],
            rejectedKeys: [],
            note: `请求失败：${errorMessage(error)}`,
            retryAfterSeconds: 0,
        };
    }
    if (status === 200 || status === 202) {
        let parsed;
        try {
            parsed = JSON.parse(content);
        }
        catch (error) {
            return {
                httpStatus: status,
                kind: "unparseable",
                acceptedKeys: [],
                rejectedKeys: [],
                note: `响应体无法解析：${content.slice(0, 200)}`,
                retryAfterSeconds: 0,
            };
        }
        const rejected = parsed.rejected ?? [];
        return {
            httpStatus: status,
            kind: "accepted",
            acceptedKeys: parsed.accepted ?? [],
            rejectedKeys: rejected.map((item) => item.key),
            note: "",
            retryAfterSeconds: 0,
        };
    }
    if (status === 429) {
        const raw = headers["Retry-After"] ?? headers["retry-after"] ?? "";
        const seconds = Number.parseInt(raw, 10);
        return {
            httpStatus: status,
            kind: "throttled",
            acceptedKeys: [],
            rejectedKeys: [],
            note: `被限流，Retry-After=${raw || "未给出"}`,
            retryAfterSeconds: Number.isNaN(seconds) ? 0 : seconds,
        };
    }
    if (status >= 500) {
        return {
            httpStatus: status,
            kind: "retryable",
            acceptedKeys: [],
            rejectedKeys: [],
            note: `服务端错误 HTTP ${status}：${content.slice(0, 200)}`,
            retryAfterSeconds: 0,
        };
    }
    return {
        httpStatus: status,
        kind: "client_error",
        acceptedKeys: [],
        rejectedKeys: [],
        note: `契约或客户端错误 HTTP ${status}：${content.slice(0, 200)}`,
        retryAfterSeconds: 0,
    };
}
function countRecordsByStatus(records, outbox) {
    let pending = 0;
    let sent = 0;
    let failed = 0;
    for (const record of records) {
        const status = outboxEntryOf(outbox, record.idempotency_key).status;
        if (status === "sent") {
            sent += 1;
        }
        else if (status === "failed") {
            failed += 1;
        }
        else {
            pending += 1;
        }
    }
    return { pending, sent, failed };
}
/** 把 outbox 里所有 pending 记录按批量发出去。failed 不自动重发。 */
async function xhs_outbox_flush() {
    const config = await readUploadConfig();
    const client = await readClientInfo();
    const records = await loadRecords();
    const outbox = await loadOutbox();
    const pendingRecords = records.filter((record) => outboxEntryOf(outbox, record.idempotency_key).status === "pending");
    let batches = 0;
    let note = "";
    for (let offset = 0; offset < pendingRecords.length; offset += UPLOAD_BATCH_SIZE) {
        const batch = pendingRecords.slice(offset, offset + UPLOAD_BATCH_SIZE);
        const outcome = await sendBatch(config, batch, client);
        batches += 1;
        if (outcome.kind === "accepted") {
            for (const record of batch) {
                if (outcome.acceptedKeys.indexOf(record.idempotency_key) >= 0) {
                    markOutbox(outbox, record.idempotency_key, "sent", "");
                    continue;
                }
                if (outcome.rejectedKeys.indexOf(record.idempotency_key) >= 0) {
                    markOutbox(outbox, record.idempotency_key, "failed", "服务端拒绝");
                    continue;
                }
                // 两边都没提到：保持 pending，等下一轮
                outboxEntryOf(outbox, record.idempotency_key).attempts += 1;
            }
        }
        else if (outcome.kind === "throttled") {
            note = outcome.note;
            console.log(`被限流，停止本轮上报：${outcome.note}`);
            break;
        }
        else if (outcome.kind === "retryable") {
            for (const record of batch) {
                const entry = outboxEntryOf(outbox, record.idempotency_key);
                entry.attempts += 1;
                entry.last_error = outcome.note;
                entry.updated_at = nowIso();
            }
            note = outcome.note;
            console.log(`可重试失败，保持 pending：${outcome.note}`);
        }
        else {
            for (const record of batch) {
                const entry = outboxEntryOf(outbox, record.idempotency_key);
                entry.attempts += 1;
                markOutbox(outbox, record.idempotency_key, "failed", outcome.note);
            }
            note = outcome.note;
            console.log(`不可重试失败，置 failed：${outcome.note}`);
        }
    }
    await saveOutbox(outbox);
    const counts = countRecordsByStatus(records, outbox);
    console.log(`上报结束：批 ${batches}，sent ${counts.sent}，failed ${counts.failed}，pending ${counts.pending}`);
    return {
        success: true,
        batches,
        sent: counts.sent,
        failed: counts.failed,
        pending: counts.pending,
        recordsFile: RECORDS_FILE,
        outboxFile: OUTBOX_FILE,
        note,
    };
}
async function xhs_outbox_status() {
    const records = await loadRecords();
    const outbox = await loadOutbox();
    const counts = countRecordsByStatus(records, outbox);
    return {
        success: true,
        pending: counts.pending,
        sent: counts.sent,
        failed: counts.failed,
        records: records.length,
        recordsFile: RECORDS_FILE,
        outboxFile: OUTBOX_FILE,
    };
}
/**
 * 配置自检：地址是否可达、令牌是否被接受。
 *
 * 探针故意发一个空批次。服务端会以参数校验为由拒收 items（条数必须在 1 到 20 之间），
 * 因此不会写入任何数据；而鉴权发生在参数校验之前，所以这个 400 恰好证明令牌有效。
 *
 * 判定依赖服务端「先鉴权后校验」的顺序，本项目的服务端实测如此。为了让顺序假设不会
 * 把别的情况误判成通过，只有响应消息确实指向 items 校验时才判定为可用；其余 400 归到
 * unexpected_status，并把服务端原文一并带出来，交给界面显示。
 */
async function xhs_upload_config_check() {
    const config = await readUploadConfig();
    const body = JSON.stringify({
        batch_id: randomId(),
        client: await readClientInfo(),
        items: [],
    });
    let status = 0;
    let content = "";
    try {
        const response = await Tools.Net.http({
            url: `${config.base_url}${UPLOAD_PATH}`,
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                Authorization: `Bearer ${config.token}`,
            },
            body,
            connect_timeout: HTTP_CONNECT_TIMEOUT_MS,
            read_timeout: HTTP_READ_TIMEOUT_MS,
        });
        status = response.statusCode;
        content = response.content;
    }
    catch (error) {
        const message = errorMessage(error);
        console.log(`配置自检：请求失败：${message}`);
        return {
            success: false,
            verdict: "unreachable",
            reachable: false,
            httpStatus: 0,
            serverMessage: message,
            baseUrl: config.base_url,
            tokenMasked: maskToken(config.token),
        };
    }
    const serverMessage = parseServerMessage(content);
    let verdict;
    if (status === 400 && serverMessage.includes("items")) {
        verdict = "ok";
    }
    else if (status === 401 || status === 403) {
        verdict = "token_rejected";
    }
    else if (status === 404 || status === 405) {
        verdict = "path_not_found";
    }
    else if (status >= 500) {
        verdict = "server_error";
    }
    else {
        verdict = "unexpected_status";
    }
    console.log(`配置自检：HTTP ${status}，判定 ${verdict}，服务端消息 ${serverMessage || "无"}`);
    return {
        success: verdict === "ok",
        verdict,
        reachable: true,
        httpStatus: status,
        serverMessage,
        baseUrl: config.base_url,
        tokenMasked: maskToken(config.token),
    };
}
const STOP_REASON_TEXT = {
    count: "达到条数目标",
    time: "时间到",
    search_exhausted: "结果集到底",
    duplicates: "结果集里已没有新笔记",
};
/**
 * 采集一片搜索结果。
 *
 * 遍历按「搜索结果页」驱动：读一屏可见卡片 → 逐张点进详情取链 → 每取一条回列表 →
 * 这一屏处理完往下滚一屏。为什么每条都要回列表：视频笔记详情页下滑进入的是推荐流，
 * 不是搜索结果（实测下滑到的那条在该关键词 142 条结果标题里找不到），
 * 页内滑动会把采集范围带出结果集，这一点与抖音相反。
 */
async function xhs_collect_share_links(params) {
    const keyword = (params.keyword ?? "").trim();
    if (!keyword) {
        throw new Error("xhs_collect_share_links 需要 keyword");
    }
    const count = params.count === undefined ? DEFAULT_COLLECT_COUNT : Math.floor(params.count);
    if (count < 1) {
        throw new Error("count 必须大于等于 1");
    }
    const chunkMinutes = params.chunk_minutes === undefined ? DEFAULT_CHUNK_MINUTES : params.chunk_minutes;
    if (chunkMinutes <= 0) {
        throw new Error("chunk_minutes 必须大于 0");
    }
    if (chunkMinutes > MAX_CHUNK_MINUTES) {
        throw new Error(`chunk_minutes 最多 ${MAX_CHUNK_MINUTES} 分钟。脚本硬超时是 30 分钟，单片留出安全边际`);
    }
    const chunkDeadline = Date.now() + chunkMinutes * 60 * 1000;
    const progress = await startProgress(keyword);
    progress.chunk_index += 1;
    progress.last_chunk_started_at = nowIso();
    progress.last_stop_reason = "";
    await saveProgress(progress);
    console.log(`本轮第 ${progress.chunk_index} 片开始，本片目标 ${count} 条，时间上限 ${chunkMinutes} 分钟`);
    await ensureXhsForeground();
    const screenHeight = await readScreenHeight();
    const outbox = await loadOutbox();
    const storedRecords = await loadRecords();
    // 本地去重按分享短链的短码，跨轮次生效。实测同一条笔记两次独立取链得到同一个短链。
    // 本地去重按笔记真实身份 content_id，跨轮次生效。
    // 0.3.0 之前写下的记录没有 content_id，跳过它们：拿不到身份就不猜（硬猜会串笔记）。
    const storedContentIds = Object.create(null);
    for (const record of storedRecords) {
        if (record.content_id) {
            storedContentIds[record.content_id] = true;
        }
    }
    await openSearch(keyword);
    const collected = [];
    // 已处理过的卡片身份键。列表首屏会浮动，按位置续跑不可靠，认卡片本身。
    const seenCardKeys = Object.create(null);
    let skippedDuplicates = 0;
    let skippedAds = 0;
    let skippedUnusable = 0;
    let unusableInARow = 0;
    let consecutiveSkips = 0;
    let noProgressScrolls = 0;
    let stopReason = "count";
    while (true) {
        if (Date.now() >= chunkDeadline) {
            stopReason = "time";
            break;
        }
        if (collected.length >= count) {
            stopReason = "count";
            break;
        }
        if (consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) {
            stopReason = "duplicates";
            console.log(`连续 ${consecutiveSkips} 条都已在库里，本片提前结束`);
            break;
        }
        const page = await readRoot();
        const cards = findNoteCards(page, screenHeight);
        let card;
        for (const candidate of cards) {
            const key = cardKeyOf(candidate);
            if (!key || seenCardKeys[key]) {
                continue;
            }
            card = candidate;
            break;
        }
        if (!card) {
            // 这一屏的卡片都处理过了，往下滚一屏。滚动必须带前进判定：
            // 没有判定就一直滚会变成死循环，抖音那边已经踩过一次。
            const beforeKeys = cards.map((item) => cardKeyOf(item)).join("|");
            await scrollList(screenHeight);
            const nextKeys = findNoteCards(await readRoot(), screenHeight)
                .map((item) => cardKeyOf(item))
                .join("|");
            if (nextKeys === beforeKeys) {
                noProgressScrolls += 1;
                console.log(`滚动后可见卡片没有变化（第 ${noProgressScrolls} 次），连续 ${MAX_NO_PROGRESS_SCROLLS} 次即认为结果集到底`);
                if (noProgressScrolls >= MAX_NO_PROGRESS_SCROLLS) {
                    stopReason = "search_exhausted";
                    break;
                }
            }
            else {
                noProgressScrolls = 0;
            }
            continue;
        }
        const cardKey = cardKeyOf(card);
        const cardTitle = cardBodyTextOf(card);
        // 卡片上的「广告」角标。只做标记，不据此丢弃数据，判断权交给服务端。
        const promoHint = card.textContent(" ").includes(CARD_PROMO_TEXT);
        seenCardKeys[cardKey] = true;
        await tapNode(card, "结果卡片");
        let outcome;
        try {
            outcome = await extractShareOnDetailPage(screenHeight);
        }
        catch (error) {
            if (!(error instanceof CardUnusableError)) {
                throw error;
            }
            // 这张卡片的页面形态采不动：跳过它继续下一张，但先退回列表。
            // 连着 MAX_CONSECUTIVE_UNUSABLE 张都这样就不再是版式问题，抛错中断本片。
            unusableInARow += 1;
            skippedUnusable += 1;
            console.log(`卡片采不动，跳过（连续第 ${unusableInARow} 张）：${cardTitle.slice(0, 24)} —— ${errorMessage(error)}`);
            await returnToSearchList();
            if (unusableInARow >= MAX_CONSECUTIVE_UNUSABLE) {
                throw new Error(`连续 ${unusableInARow} 张卡片都采不动，已经不是单张卡片的版式问题，中断本片`);
            }
            continue;
        }
        // 取链时进过评论页，这里退回搜索结果页再处理下一条
        await returnToSearchList();
        unusableInARow = 0;
        if (outcome.skipped) {
            // 广告/咨询页：底栏是咨询入口，没有可粘贴的输入框，读不出分享链接。
            // 按用户决定整条跳过并继续下一张，不当作失败，也不占本片的条数目标。
            skippedAds += 1;
            unusableInARow = 0;
            console.log(`广告/咨询页，整条跳过：${cardTitle.slice(0, 24)}`);
            continue;
        }
        const contentId = outcome.contentId;
        if (storedContentIds[contentId]) {
            skippedDuplicates += 1;
            consecutiveSkips += 1;
            console.log(`已在库里，跳过：${outcome.url}（content_id=${contentId}）`);
            continue;
        }
        const record = {
            idempotency_key: randomId(),
            keyword,
            url: outcome.url,
            share_text: outcome.shareText,
            title: cardTitle,
            author: outcome.author,
            collected_at: nowIso(),
            source: RECORD_SOURCE,
            content_id: contentId,
            keyword_in_title: cardTitle.includes(keyword),
            promo_hint: promoHint,
            note_type: outcome.pageType,
        };
        // 每条立即落盘并建 pending 的 outbox 记录，中途被杀也不会丢
        await appendRecord(outbox, record);
        await saveOutbox(outbox);
        storedContentIds[contentId] = true;
        consecutiveSkips = 0;
        collected.push(outcome.url);
        progress.collected_total += 1;
        progress.last_url = outcome.url;
        progress.last_item_id = contentId;
        await saveProgress(progress);
        console.log(`已采集第 ${collected.length} 条：${outcome.url}（content_id=${contentId}）`);
        // 让界面能看到分片进展，长任务不至于看起来像卡住
        sendIntermediateResult({
            keyword,
            chunkIndex: progress.chunk_index,
            collectedInChunk: collected.length,
            chunkTarget: count,
            collectedTotal: progress.collected_total,
            url: outcome.url,
            noteType: outcome.pageType,
        });
    }
    progress.last_stop_reason = stopReason;
    progress.last_chunk_finished_at = nowIso();
    await saveProgress(progress);
    const payload = {
        success: true,
        keyword,
        requested: count,
        collected,
        skippedDuplicates,
        skippedAds,
        skippedUnusable,
        stopReason,
        chunkIndex: progress.chunk_index,
        collectedTotal: progress.collected_total,
        recordsFile: RECORDS_FILE,
        outboxFile: OUTBOX_FILE,
        progressFile: PROGRESS_FILE,
    };
    console.log(`本片结束（${STOP_REASON_TEXT[stopReason]}）：新增 ${collected.length} 条，跳过广告页 ${skippedAds} 条、采不动的卡片 ${skippedUnusable} 条，本轮累计 ${progress.collected_total} 条`);
    return payload;
}
exports.xhs_collect_share_link = xhs_collect_share_link;
exports.xhs_collect_share_links = xhs_collect_share_links;
exports.xhs_outbox_flush = xhs_outbox_flush;
exports.xhs_outbox_status = xhs_outbox_status;
exports.xhs_upload_config_check = xhs_upload_config_check;
exports.xhs_migrate_upload_config = xhs_migrate_upload_config;
