/* METADATA
{
    "name": "ks_collector",
    "display_name": {
        "zh": "快手采集",
        "en": "Kuaishou Collector"
    },
    "description": {
        "zh": "采集快手搜索结果的作品分享链接并上报。逐条取链后落盘到 records.jsonl，再由 outbox 批量上报到服务端。",
        "en": "Collect share links from Kuaishou search results and upload them. Each link is appended to records.jsonl, and the outbox uploads them in batches."
    },
    "enabledByDefault": true,
    "category": "Automatic",
    "tools": [
        {
            "name": "ks_collect_share_link",
            "description": {
                "zh": "取出当前打开的作品的分享链接与真实作品ID（content_id）。流程是点右侧互动条的分享按钮、点面板里的「复制链接」，再从评论输入框回读剪贴板内容并清空。必须在作品详情页调用，它不会自己导航。广告详情页没有分享入口，会如实报错。",
                "en": "Extract the share link and the stable content id of the work currently open on its Kuaishou detail page: open the share sheet, tap the copy-link item, then paste the clipboard into the comment field, read it back and clear it. Must be called on a work detail page; it does not navigate. Ad detail pages have no share entry and fail with a message."
            },
            "parameters": []
        },
        {
            "name": "ks_collect_share_links",
            "description": {
                "zh": "采集快手搜索结果的分享链接，一次运行只做一片。每条记录带真实作品ID（content_id，从短链跳转后的分享页解析 photoId），它就是「同一个作品」的判据——快手每次分享都给新短码，短码不能当身份。先切到「视频」标签（综合标签里混着咨询广告卡与直播间），再按结果页逐张取：读一屏可见的作品卡片，逐张点进详情取链后返回列表，采完一屏往下滚一屏。为什么不像抖音那样在详情页内滑着取完一屏：快手详情页是连续信息流，滑到搜索结果用尽后会接到推荐流，而快手详情页上没有可靠的「我还在结果集里」的标记，逐张点进才能保证每一条都来自显式选中的搜索结果卡片。广告详情页没有分享入口，整条跳过并继续下一张。每条记录立即追加到 records.jsonl 并建 pending 的 outbox 记录，已采集过的作品跳过。按条数目标或时间上限先到者结束本片，结果集翻到底也会结束，结束原因写进 progress.json。每条记录带 keyword_in_title 与 promo_hint 两个标记（标题是否含关键词、卡片上是否有广告角标），只标记不过滤，是否丢弃交由服务端决定。",
                "en": "Collect share links from Kuaishou search results, one chunk per run. Every record carries the stable content id (photoId parsed from the share page the short link redirects to), which is what identifies the same work; Kuaishou hands out a fresh short code on every share, so the code cannot be the identity. Switches to the Video tab (the default tab mixes consult ads and livestreams in), then works card by card: read the visible work cards, open each one, take its link, return to the list, and scroll one screen when the visible cards are done. Unlike Douyin the detail feed is not used to finish a page: Kuaishou's detail page is a continuous feed that rolls into recommendations once the search results run out, and it carries no reliable marker that the current work still came from the result set, so only opening a chosen result card guarantees the item is a search result. Ad detail pages have no share entry and are skipped entirely. Every record is appended to records.jsonl with a pending outbox entry; works already collected are skipped. The chunk ends on the item target, the time limit, or an exhausted result list, and the reason is written to progress.json. Every record carries keyword_in_title and promo_hint markers (whether the title mentions the keyword, whether the card carries an ad badge); they are markers only, so the server decides what to drop."
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
            "name": "ks_outbox_flush",
            "description": {
                "zh": "把 outbox 里所有 pending 的记录按每批 20 条上报到配置的服务器。地址与令牌在工具箱的「快手采集设置」页里配置。200/202 按响应里的 accepted 与 rejected 逐条置状态，429 停止本轮，5xx 与网络错误保持 pending 并累加尝试次数，其他 4xx 置 failed。failed 不自动重发。",
                "en": "Upload all pending outbox records to the configured server in batches of 20. The base URL and token are configured on the Kuaishou Collector settings page in the toolbox. On 200/202 each record is set from the response's accepted and rejected lists; 429 stops this round; 5xx and network errors stay pending with an incremented attempt count; other 4xx become failed. Failed records are not retried automatically."
            },
            "parameters": []
        },
        {
            "name": "ks_upload_config_check",
            "description": {
                "zh": "自检上报配置：地址是否可达、令牌是否被接受。做法是故意发一个空批次，服务端按参数校验拒收它，不会写入任何数据；而拒收之前鉴权已经做完，所以「参数校验类的 400」正好证明配置可用。",
                "en": "Self-check the upload configuration: whether the base URL is reachable and the token is accepted. It deliberately sends an empty batch which the server rejects on parameter validation, so nothing is written; since authentication happens before validation, a parameter-validation 400 is exactly the proof that the configuration works."
            },
            "parameters": []
        },
        {
            "name": "ks_outbox_status",
            "description": {
                "zh": "统计记录与 outbox 的状态：pending、sent、failed 各多少条，以及文件位置。",
                "en": "Report record and outbox counts: how many are pending, sent and failed, plus the file locations."
            },
            "parameters": []
        },
        {
            "name": "ks_migrate_upload_config",
            "description": {
                "zh": "把抖音采集包早期版本带 DOUYIN_ 前缀的上报配置键搬到中立键上，然后清空旧键。设置页加载时会自动调用；正常使用不需要手动跑。迁移完成后再调用是空操作。",
                "en": "Move the upload configuration from the legacy DOUYIN_-prefixed keys left by the Douyin collector to the neutral keys, then clear the legacy ones. The settings page calls this on load; there is no need to run it by hand. Calling it again after the migration is a no-op."
            },
            "parameters": []
        },
    ]
}
*/
// 快手国内版包名。
const KS_PACKAGE = "com.smile.gifmaker";
// deep link 直达搜索页。实测无法直达「视频」标签（试过 &tab=2、&tab=video、
// kwai://search/video、&type=video 都落在默认的综合），标签只能在页内点。
const KS_SEARCH_SCHEME = "kwai://search";
// 搜索页加载需要时间，固定等待比条件等待更早能用。
const SEARCH_LOAD_WAIT_MS = 6000;
// 搜索结果页与标签切换的等待上限。
const SEARCH_PAGE_TIMEOUT_MS = 30000;
const STEP_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 500;
// 连续读页面失败时的退避上限
const MAX_READ_BACKOFF_MS = 3000;
const UI_SETTLE_MS = 800;
// 把快手切到前台的等待上限。
const FOREGROUND_WAIT_TIMEOUT_MS = 15000;
const SWIPE_DURATION_MS = 400;
// ===== 搜索结果页定位 =====
// 搜索框，内容等于本次关键词。这是「搜索结果页就绪」的判据。
const SEARCH_BOX_ID_SUFFIX = "search_result_text";
// 顶层标签行容器。它子树里的 7 个可点击 View 依次是
// 综合 / 直播 / 视频 / 用户 / 智能 / 商品 / 图集。
const TABS_ID_SUFFIX = ":id/tabs";
// 「视频」是第 3 个（下标 2）。这一行是自绘的：text 与 content-desc 都为空，
// 也没有 resource-id，只能按「容器 + 顺序」定位。
const VIDEO_TAB_INDEX = 2;
// 「综合」标签下的内容筛选 chip 行。切到「视频」后这个容器消失，用它判标签是否真的切过去了。
const APP_BAR_ID_SUFFIX = ":id/appbar";
// 作品卡片的 content-desc 形如「朱朱(自装日记)的作品」。
const CARD_DESC_SUFFIX = "的作品";
// 卡片渲染完成的标志：子树里有形如 01:02 的时长文本。
// 没渲染完的卡片子树里只有 content-desc，读不到时长/日期/点赞。
const CARD_DURATION_PATTERN = /^\d{2}:\d{2}$/;
// 卡片上的广告角标。命中只写进记录，不用来决定采不采。
const CARD_PROMO_TEXT = "广告";
// 列表可视区上沿：顶层标签行下沿（实测 351/352），卡片从 363 起。
// 中心点落在这条线以上的卡片点下去会点到标签行。
const LIST_TOP = 352;
// App 窗口底部会被导航栏占掉，落在那里的点击不会传给应用。
// 卡片 bounds 会伸到 2400（贴到导航栏下），所以可用性判据用中心点而不是 bounds 下沿。
const APP_BOTTOM_INSET = 150;
// 一次往下滚多少像素。卡片高约 1000 到 1200，小步滚保证不漏卡，
// 重叠的那部分由卡片身份键跳过，代价只是一次读页面。
const CARD_SCROLL_STEP_PX = 600;
const CARD_SCROLL_SETTLE_MS = 2500;
// 滚动后可见卡片没有变化就记一次，连续到这个数即认为结果集到底。
const MAX_NO_PROGRESS_SCROLLS = 3;
// ===== 详情页定位 =====
// 右侧互动条的分享按钮，content-desc 形如「分享926」，计数会变。
const DETAIL_SHARE_ENTRY_ID_SUFFIX = "forward_button";
// 分享面板标题「一键分享至」下的动作项。
const SHARE_PANEL_COPY_ITEM_TEXT = "复制链接";
// 点完「复制链接」面板自行关闭，这里只是等关闭动画结束。
const SHARE_PANEL_CLOSE_SETTLE_MS = 1500;
// 底栏评论入口，content-desc 形如「评论框发条有爱评论~」，占位文案会变，按前缀匹配。
const COMMENT_ENTRY_DESC_PREFIX = "评论框";
// 评论区在原 Activity 内联展开，里面是这个 EditText。
const EDITOR_ID_SUFFIX = "editor";
// 详情页作者，形如「@朱朱(自装日记)」。分享文本里没有作者，只能从页面读。
const AUTHOR_ID_SUFFIX = "user_name_text_view";
// 广告详情页的标志。这类页面右侧互动条整条不在，没有分享入口。
const AD_PAGE_ID_SUFFIX = "ad_card_container_root";
// 快手分享文本形如
// 「https://v.kuaishou.com/KrR1EKUZ 正文… 该作品在快手被播放过5.8万次，点击链接，打开【快手】直接观看！」，
// 短链在最前面，尾部固定句里带会变的播放次数，所以只能按短链正则与这个前缀切。
const KS_SHARE_URL_PATTERN = /https?:\/\/v\.kuaishou\.com\/[^\s]+/;
// 稳定作品身份：分享页 JSON 里的 photoId。短码每次都变，不能当身份（见 resolveContentId）。
const KS_CONTENT_ID_PATTERN = /"photoId"\s*:\s*"([A-Za-z0-9_-]+)"/;
// 分享页对非浏览器 UA 会返回不同的内容，用移动端 Safari 的 UA 实测能拿到含 photoId 的整页。
const SHARE_PAGE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1";
const CONTENT_RESOLVE_CONNECT_TIMEOUT_MS = 10000;
const CONTENT_RESOLVE_READ_TIMEOUT_MS = 15000;
const SHARE_TITLE_TAIL_MARKER = "该作品在快手";
// 关掉评论面板/退回列表都用返回键，走无障碍的全局动作（GLOBAL_ACTION_BACK），
// 不再用 shell 的 input keyevent 4：采集因此不再需要 Shizuku，权限档「无障碍」即可。
const BACK_KEY_CODE = "KEYCODE_BACK";
// 长按评论编辑器后快手会弹出它自己的工具条，顺序是【粘贴】【常用语】【自动填充】，
// 「粘贴」在第一个（小红书是【常用语】【粘贴】【换行】【自动填充】，粘贴是第二个，值不能互抄）。
// 工具条不在无障碍节点树里（2026-10-15 实测：树里没有含「粘贴」的节点，
// 截图见 docs/TODO/collector_accessibility_only_20261015/shots/04_ks_longpress.png），
// 只能按坐标点。偏移量以「编辑器左上角」为锚点，是快手 14.1.10.46550 / 1080x2400 上的实测值
// （编辑器 [31,1080][1049,1243] 时「粘贴」按钮中心在 (166,935)），换版本或换分辨率要重新量。
const PASTE_BUTTON_OFFSET_X = 135;
const PASTE_BUTTON_OFFSET_Y = -145;
// 工具条有弹出动画，长按之后要等它可点。
const PASTE_TOOLBAR_SETTLE_MS = 1200;
const MAX_CONSECUTIVE_SKIPS = 10;
const MAX_CONSECUTIVE_UNUSABLE = 5;
const MAX_BACK_TO_LIST_ATTEMPTS = 3;
// 分享面板内容需要往上带的次数上限。
const MAX_SHEET_LIFT_ATTEMPTS = 3;
/**
 * 这张卡片的页面形态采不动。采集循环接住它，跳过这张卡继续下一张。
 *
 * 与广告页不同：广告页是「这条数据本来就没有分享链接」，用不上这个；
 * 这里是「定位器没命中，多半是版式变了」，所以按次跳过、连着几张就中断本片。
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
 * 读页面本身会偶发失败：宿主读无障碍树时三次重试只隔 300ms，页面动画期间会连续超时。
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
            // 读失败往往是读得太频把无障碍 provider 压住了，退避一下再读。
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
 * 等定位器命中。超时归为 CardUnusableError，由采集循环跳过这张卡继续下一张。
 *
 * 与 waitForNode 的区别只在超时后的归类：等「这张卡片的某一层页面」失败是版式问题，
 * 等「搜索结果页」失败不是。
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
 * 确保快手在取链前处于前台。
 *
 * 无障碍服务读的是当前活动窗口，从 Operit 界面调用本工具时前台是 Operit，
 * 不切换就只能读到 Operit 自己的节点树。
 */
async function ensureKsForeground() {
    const deadline = Date.now() + FOREGROUND_WAIT_TIMEOUT_MS;
    let switchRequested = false;
    let lastPackage = "";
    let lastReadError = "";
    let consecutiveReadFailures = 0;
    while (Date.now() < deadline) {
        try {
            const current = await Tools.UI.getPageInfo();
            lastPackage = current.packageName;
            if (current.packageName === KS_PACKAGE) {
                return;
            }
            consecutiveReadFailures = 0;
            if (!switchRequested) {
                await Tools.System.startApp(KS_PACKAGE);
                switchRequested = true;
            }
        }
        catch (error) {
            lastReadError = errorMessage(error);
            consecutiveReadFailures += 1;
            console.log(`读前台应用失败第 ${consecutiveReadFailures} 次，继续等待快手就绪：${lastReadError}`);
            await Tools.System.sleep(Math.min(POLL_INTERVAL_MS * consecutiveReadFailures, MAX_READ_BACKOFF_MS));
            continue;
        }
        await Tools.System.sleep(POLL_INTERVAL_MS);
    }
    const readNote = lastReadError ? `最后一次读页面失败：${lastReadError}；` : "";
    throw new Error(`等待快手切到前台超时，当前前台是 ${lastPackage || "未知"}。${readNote}`);
}
function parseBounds(bounds) {
    const matched = (bounds ?? "").match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    if (!matched) {
        return undefined;
    }
    const box = {
        x1: Number(matched[1]),
        y1: Number(matched[2]),
        x2: Number(matched[3]),
        y2: Number(matched[4]),
    };
    // 滚出屏幕的节点会给出反向边界，例如 [56,354][723,70]，这类要剔掉
    if (box.x2 <= box.x1 || box.y2 <= box.y1) {
        return undefined;
    }
    return box;
}
function parseTopY(bounds) {
    const matched = (bounds ?? "").match(/^\[\d+,(\d+)\]/);
    return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
}
function parseLeftX(bounds) {
    const matched = (bounds ?? "").match(/^\[(\d+),/);
    return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
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
/** 搜索结果页就绪的判据：搜索框里的文本等于本次关键词。 */
function findSearchPageMarker(root, keyword) {
    return root.find((node) => {
        if (!(node.resourceId ?? "").endsWith(SEARCH_BOX_ID_SUFFIX)) {
            return false;
        }
        return (node.text ?? "").trim() === keyword;
    }, true);
}
/**
 * 顶层标签行里的自绘标签，按左边界排序。
 *
 * 这 7 个标签 text 与 content-desc 都为空、也没有 resource-id，只有 bounds 与 clickable，
 * 所以只能「先找容器、再按顺序取」。实测无障碍 provider 会返回这类无文案节点：
 * 同一台设备上留下的抖音树快照里有 30 个只有 class 与 bounds 的可点击节点。
 */
function findTopTabs(root) {
    const container = root.find((node) => (node.resourceId ?? "").endsWith(TABS_ID_SUFFIX), true);
    if (!container) {
        return [];
    }
    return container
        .findAll((node) => node.className === "View" && node.isClickable, true)
        .filter((node) => parseBounds(node.bounds) !== undefined)
        .sort((a, b) => parseLeftX(a.bounds) - parseLeftX(b.bounds));
}
/**
 * 切到「视频」后仍在树里的「综合」筛选 chip 行，判据带边界有效性。
 *
 * 无障碍 provider 的树会把「综合」那一页的节点留在树里，即使界面已经切到「视频」：
 * 实测切过去之后 `appbar` 仍在，但它与它下面所有 chip 的 bounds 都退化了
 * （形如 `[0,352][-1080,491]`、`[0,385][-1996,469]`，x2 < x1），而「视频」的真实卡片
 * bounds 正常。这与抖音回收视图里混进退化节点是同一类现象，所以判据必须经过 parseBounds。
 *
 * 少了这一层过滤，切换明明成功也会被判成「没切过去」，采集会一直等到超时。
 */
function findVisibleAppBar(root) {
    return root.find((node) => {
        if (!(node.resourceId ?? "").endsWith(APP_BAR_ID_SUFFIX)) {
            return false;
        }
        return parseBounds(node.bounds) !== undefined;
    }, true);
}
/** 「视频」标签是否已经生效：内容筛选 chip 行不可见，且出现了作品卡片。 */
function isVideoTabReady(root, screenHeight) {
    if (findVisibleAppBar(root)) {
        return false;
    }
    return findCards(root, screenHeight).length > 0;
}
/**
 * 当前视口内的作品卡片，按先上后下、同一行先左后右返回。
 *
 * 可用性按中心点判：卡片的 bounds 会被裁切（顶部被标签行挡住时会只剩几十像素高），
 * 裁切后的中心点仍落在卡片自身范围内，实测按中心点点下去打开的就是那一张；
 * 而贴在导航栏下的卡片中心点会落在导航栏上，点了不会传给应用。
 */
function findCards(root, screenHeight) {
    const bottom = screenHeight - APP_BOTTOM_INSET;
    return root
        .findAll((node) => {
        if (!node.isClickable) {
            return false;
        }
        if (!(node.contentDesc ?? "").endsWith(CARD_DESC_SUFFIX)) {
            return false;
        }
        const box = parseBounds(node.bounds);
        if (!box) {
            return false;
        }
        const centerY = Math.floor((box.y1 + box.y2) / 2);
        return centerY > LIST_TOP && centerY < bottom;
    }, true)
        .sort((a, b) => {
        const topDiff = parseTopY(a.bounds) - parseTopY(b.bounds);
        return topDiff !== 0 ? topDiff : parseLeftX(a.bounds) - parseLeftX(b.bounds);
    });
}
/** 卡片子树里某个 resource-id 后缀对应的文本，取不到就是空字符串。 */
function textOfIdInCard(card, idSuffix) {
    const node = card.find((candidate) => (candidate.resourceId ?? "").endsWith(idSuffix), true);
    return node ? (node.text ?? "").trim() : "";
}
/** 卡片的时长角标文本，形如 01:02。空字符串表示这张卡还没渲染完。 */
function cardDurationTextOf(card) {
    const node = card.find((candidate) => CARD_DURATION_PATTERN.test((candidate.text ?? "").trim()), true);
    return node ? (node.text ?? "").trim() : "";
}
/**
 * 只有渲染完成的卡片才进候选：没渲染完的卡片子树里只有「作者的作品」这一条 desc，
 * 身份键会退化成「左边界 + 作者」，同一作者在同一列有两张卡时会撞键、其中一张被静默跳过。
 *
 * 不要为了让未渲染的卡也能采而去掉这条限制：往下滚之后卡片会渲染出来，那时再采不会漏；
 * 放宽限制反而会引入真的漏采。代价是卡片的时长/日期/点赞补齐后身份键会变，
 * 同一张卡会被再走一次取链流程，最后由短链去重挡下。
 */
function isRenderedCard(card) {
    return cardDurationTextOf(card).length > 0;
}
/**
 * 卡片身份键，用于本片内避免重复处理同一张卡。
 *
 * 不能用 content-desc 单独当键：实测同一屏里能出现两张同作者的卡（都是「欧派家居团购的作品」）。
 * 左边界是滚动无关的（只有纵向滚动），加上时长/日期/点赞/标题之后足以区分同屏卡片。
 */
function cardKeyOf(card) {
    return [
        String(parseLeftX(card.bounds)),
        (card.contentDesc ?? "").trim(),
        cardDurationTextOf(card),
        textOfIdInCard(card, "bottom_created_time"),
        textOfIdInCard(card, "feed_card_op_like_tv"),
        textOfIdInCard(card, "search_item_card_title_view"),
    ].join("|");
}
/** 卡片是否带广告角标。只做标记，不据此丢弃数据，判断权交给服务端。 */
function cardPromoHintOf(card) {
    return card.textContent(" ").includes(CARD_PROMO_TEXT);
}
/** 详情页右侧互动条的分享按钮。 */
function findShareEntry(root) {
    return root.find((node) => (node.resourceId ?? "").endsWith(DETAIL_SHARE_ENTRY_ID_SUFFIX) &&
        parseBounds(node.bounds) !== undefined, true);
}
/** 广告详情页的标志。这类页面右侧互动条整条不在，没有可点的分享入口。 */
function findAdPageMarker(root) {
    return root.find((node) => (node.resourceId ?? "").endsWith(AD_PAGE_ID_SUFFIX) &&
        parseBounds(node.bounds) !== undefined, true);
}
/**
 * 判详情页类型。先判广告页再判正常页：广告页同样有底栏评论入口，
 * 先判正常页会把它当成可采集的作品，然后在分享入口上超时。
 */
function detectDetailPageKind(root) {
    if (findAdPageMarker(root)) {
        return "ad";
    }
    if (findShareEntry(root)) {
        return "work";
    }
    return undefined;
}
async function waitForDetailPage() {
    const root = await waitForCardNode((page) => (detectDetailPageKind(page) === undefined ? undefined : page), "作品详情页");
    const kind = detectDetailPageKind(root);
    if (kind === undefined) {
        throw new Error("详情页类型判定失败：既没有分享入口也不是广告页");
    }
    return { root, kind };
}
/** 详情页作者。读不到就是空字符串，上报契约允许这个字段为空。 */
function readAuthorOf(root) {
    const node = root.find((candidate) => (candidate.resourceId ?? "").endsWith(AUTHOR_ID_SUFFIX) &&
        parseBounds(candidate.bounds) !== undefined, true);
    const text = (node?.text ?? "").trim();
    return text.startsWith("@") ? text.slice(1) : text;
}
function findEditText(root) {
    return root.find((node) => (node.resourceId ?? "").endsWith(EDITOR_ID_SUFFIX) &&
        parseBounds(node.bounds) !== undefined, true);
}
/** 底栏评论入口。可见性并进匹配条件，避免选中被裁掉的同名节点。 */
function findCommentEntry(root, screenHeight) {
    const bottom = screenHeight - APP_BOTTOM_INSET;
    return root.find((node) => {
        if (!(node.contentDesc ?? "").startsWith(COMMENT_ENTRY_DESC_PREFIX)) {
            return false;
        }
        const box = parseBounds(node.bounds);
        return box !== undefined && box.y1 > LIST_TOP && box.y1 < bottom;
    }, true);
}
async function openSearch(keyword) {
    const uri = `${KS_SEARCH_SCHEME}?keyword=${encodeURIComponent(keyword)}`;
    console.log(`打开搜索结果页：${uri}`);
    await Tools.System.intent({
        type: "activity",
        action: "android.intent.action.VIEW",
        uri,
        package: KS_PACKAGE,
    });
    await Tools.System.sleep(SEARCH_LOAD_WAIT_MS);
    await waitForNode((root) => findSearchPageMarker(root, keyword), "搜索结果页", SEARCH_PAGE_TIMEOUT_MS);
}
/**
 * 切到「视频」标签。
 *
 * 默认的综合标签里混着咨询广告卡与直播间：前者没有分享链接面板，后者点进去不是作品。
 * 标签行的文案读不到，只能按容器里的第 3 个可点击 View 点，点完用「chip 行消失 + 出现卡片」验证。
 */
async function switchToVideoTab(screenHeight) {
    const tabs = findTopTabs(await readRoot());
    if (tabs.length <= VIDEO_TAB_INDEX) {
        throw new Error(`顶层标签行只有 ${tabs.length} 个可点击节点，取不到第 ${VIDEO_TAB_INDEX + 1} 个「视频」。现场：${await describeCurrentPage()}`);
    }
    await tapNode(tabs[VIDEO_TAB_INDEX], "「视频」标签");
    await Tools.System.sleep(SEARCH_LOAD_WAIT_MS);
    await waitForNode((root) => (isVideoTabReady(root, screenHeight) ? root : undefined), "「视频」标签的结果列表", SEARCH_PAGE_TIMEOUT_MS);
}
/** 列表往下滚一屏。 */
async function scrollList(screenHeight) {
    const fromY = screenHeight - 500;
    await Tools.UI.swipe(540, fromY, 540, fromY - CARD_SCROLL_STEP_PX, SWIPE_DURATION_MS);
    await Tools.System.sleep(CARD_SCROLL_SETTLE_MS);
}
/**
 * 当前是不是停在搜索结果页。读页面偶发失败时按「不是」处理，交给外层再退一层。
 */
async function isOnSearchList(keyword) {
    try {
        await waitForNode((root) => findSearchPageMarker(root, keyword), "搜索结果页", STEP_TIMEOUT_MS);
        return true;
    }
    catch (error) {
        console.log(`当前不在搜索结果页（等「搜索结果页」失败）：${errorMessage(error)}`);
        return false;
    }
}
/**
 * 退回搜索结果页。
 *
 * 正常路径是「详情页 → 一层返回 → 列表」，先看一眼再决定要不要退，
 * 避免已经在列表上时多按一次返回把快手退出到桌面。
 * 取链时会进评论区，卡片中途失败时页面可能停在分享面板或评论区，
 * 所以按「退一层、看一次」推进，最多 MAX_BACK_TO_LIST_ATTEMPTS 层；
 * 退不回去说明不是单张卡片的问题，抛错中断本片。
 */
async function returnToSearchList(keyword) {
    for (let attempt = 0; attempt <= MAX_BACK_TO_LIST_ATTEMPTS; attempt += 1) {
        if (await isOnSearchList(keyword)) {
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
 * Android 10 起只有获得焦点的应用才能读系统剪贴板，采集时前台是快手，
 * 后台的 Operit 用 read_clipboard 只能读到空字符串。粘贴回读不受这条限制。
 * 粘贴目标必须是详情页的评论编辑器，不能是搜索框，否则会触发重新搜索。
 *
 * 粘贴这一步也让快手自己做：长按评论编辑器弹出它自己的工具条，再点工具条上的「粘贴」。
 * 于是整条取链链路不需要 shell，权限档「无障碍」就能跑（不再需要 Shizuku）。
 * 工具条不在节点树里、只能按坐标点的原因与重测方法见 PASTE_BUTTON_OFFSET_* 的注释。
 */
async function pasteAndReadShareText(screenHeight) {
    const entry = await waitForCardNode((page) => findCommentEntry(page, screenHeight), "评论入口");
    await tapNode(entry, "评论入口");
    const input = await waitForCardNode(findEditText, "评论输入框");
    await tapNode(input, "评论输入框");
    await Tools.System.sleep(UI_SETTLE_MS * 2);
    // 粘上之后无论成败都必须清空。清理一旦放回成功路径，回读超时就会把粘贴内容
    // 留在评论框里成一条草稿，而且下一条会接在它后面。
    try {
        // 点击之后重新读编辑器：聚焦/键盘弹出会让布局变化，长按必须用当前坐标。
        const editor = await waitForCardNode((page) => {
            const edit = findEditText(page);
            return edit && isNodeVisible(edit, screenHeight) ? edit : undefined;
        }, "评论编辑器（聚焦后）");
        // 工具条的按钮集合取决于编辑器里有没有文本：空的时候是【粘贴】【常用语】【自动填充】，
        // 里面有草稿时按钮会变，最左那个就不是「粘贴」了，坐标会点错。所以长按前先置空，
        // 让这一击的前提确定；上一轮的清理在 finally 里，正常情况下本来就是空的。
        await toolCall("set_input_text", { text: "" });
        await Tools.System.sleep(UI_SETTLE_MS);
        const editorPoint = editor.centerPoint;
        if (!editorPoint) {
            throw new Error(`评论编辑器没有可用坐标：${editor.bounds ?? "(无边界)"}`);
        }
        await Tools.UI.longPress(editorPoint.x, editorPoint.y);
        await Tools.System.sleep(PASTE_TOOLBAR_SETTLE_MS);
        const editorTopLeft = requireTopLeft(editor, "评论编辑器");
        await Tools.UI.tap(editorTopLeft.x + PASTE_BUTTON_OFFSET_X, editorTopLeft.y + PASTE_BUTTON_OFFSET_Y);
        const filled = await waitForCardNode((page) => {
            const editorNode = findEditText(page);
            const text = editorNode?.text ?? "";
            return KS_SHARE_URL_PATTERN.test(text) ? editorNode : undefined;
        }, "粘贴后的分享文本（长按编辑器弹出的工具条上的「粘贴」）");
        const shareText = filled.text ?? "";
        const matched = shareText.match(KS_SHARE_URL_PATTERN);
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
 * 粘进来的东西不是快手分享链接时的报错。
 *
 * 最常见的原因是「复制链接」那一步没真正把链接写进剪贴板，于是被粘进来的是剪贴板里
 * 原有的内容。带上开头一小段，出问题时能一眼看出粘到了什么，不用翻节点树。
 */
function pasteMismatchMessage(shareText) {
    const preview = shareText.trim().slice(0, 40);
    return `粘进来的内容里没有快手分享链接，复制那一步可能没生效。内容开头：${preview || "(空)"}`;
}
/**
 * 清空评论编辑器并收起评论面板，回到作品详情页。
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
 * 从分享文本里取标题：短链之后、`该作品在快手` 之前的正文。
 *
 * 不能取详情页的 element_caption_label：那是被截断的（尾部带 `… 展开`），
 * 分享文本里才是完整正文。尾部固定句里带会变的播放次数，所以按前缀切。
 */
function parseTitleFromShareText(shareText, url) {
    const afterUrl = shareText.slice(shareText.indexOf(url) + url.length);
    return afterUrl.split(SHARE_TITLE_TAIL_MARKER)[0].trim();
}
/**
 * 点分享面板里的「复制链接」。
 *
 * 面板高度会随作品变化（多一行联系人时更高），这一项有时会被推到屏幕下面：
 * 实测过两次，一次是整行在屏幕外（`[455,2924][624,3227]`），另一次是**文案节点自己可见、
 * 而它的可点击祖先在屏幕外**（祖先 `[455,4336][624,4617]`，文案在可见区内）。
 * 所以判据必须落在「真正要被点的那一层」上：先解析出可点击祖先，再看它的中心点在不在可视区；
 * 查询的是文案节点、点击的是祖先节点，两者 bounds 不保证一致。
 *
 * 不这样做的话，屏幕外的祖先照样会被点一次（点了不生效），随后评论入口超时，
 * 这张卡被判成「采不动」白白丢掉。
 *
 * 必须按文案定位：面板项的顺序会随作品变化，按坐标点会点到「作品举报」（实测踩过）。
 */
async function tapSharePanelItem(screenHeight) {
    const finder = (page) => page.find((node) => (node.text ?? "") === SHARE_PANEL_COPY_ITEM_TEXT, true);
    for (let attempt = 0; attempt <= MAX_SHEET_LIFT_ATTEMPTS; attempt += 1) {
        const item = await waitForCardNode(finder, `分享面板里的「${SHARE_PANEL_COPY_ITEM_TEXT}」`);
        // 「复制链接」自身 clickable 为 false，真正吃点击的是它外面那层 share_to_layout
        const target = clickableSelfOrAncestor(item);
        if (isNodeVisible(target, screenHeight)) {
            await tapNode(target, SHARE_PANEL_COPY_ITEM_TEXT);
            return;
        }
        const point = target.centerPoint;
        console.log(`「${SHARE_PANEL_COPY_ITEM_TEXT}」的可点击祖先落在可视区外（bounds=${target.bounds ?? ""} y=${point ? point.y : -1}，可视下沿 ${screenHeight - APP_BOTTOM_INSET}），把面板内容往上带`);
        await Tools.UI.swipe(540, 2100, 540, 1800, SWIPE_DURATION_MS);
        await Tools.System.sleep(UI_SETTLE_MS);
    }
    throw new CardUnusableError(`「${SHARE_PANEL_COPY_ITEM_TEXT}」始终处于可视区外，无法点击`);
}
/**
 * 在当前作品详情页取一次分享链接。
 *
 * 步骤固定为：点右侧互动条的分享按钮 → 点面板里的「复制链接」→ 面板自行关闭 →
 * 从评论入口粘贴回读。单条工具与批量采集共用这一段，避免两处逻辑各自漂移。
 *
 * 广告页在读页面时就认出来并直接返回跳过，连分享按钮都不点：这类页面没有分享入口。
 */
async function extractShareOnDetailPage(screenHeight) {
    const { root, kind } = await waitForDetailPage();
    const author = readAuthorOf(root);
    if (kind === "ad") {
        return { skipped: true, author };
    }
    const entry = findShareEntry(root);
    if (!entry) {
        throw new CardUnusableError(`详情页上找不到分享入口。现场：${await describeCurrentPage()}`);
    }
    await tapNode(entry, "分享入口");
    // 等「复制链接」出现并点它：它只在分享面板里出现，所以它出现就等于面板已经打开。
    await tapSharePanelItem(screenHeight);
    // 点完面板自行关闭，这里只是等关闭动画结束
    await Tools.System.sleep(SHARE_PANEL_CLOSE_SETTLE_MS);
    const { url, shareText } = await pasteAndReadShareText(screenHeight);
    // 短码不是身份，必须再解析一次真实 photoId（见 resolveContentId 的说明）。
    // 这一步只发一个 HTTP 请求，不依赖界面，评论输入框此时也已经清空。
    const contentId = await resolveContentId(url);
    console.log(`作品身份解析成功：${url} -> content_id=${contentId}`);
    return { skipped: false, author, url, shareText, contentId };
}
/** 节点是否真的落在可点击的可视区域内。 */
function isNodeVisible(node, screenHeight) {
    const box = parseBounds(node.bounds);
    if (!box) {
        return false;
    }
    const point = node.centerPoint;
    if (!point) {
        return false;
    }
    return point.y > LIST_TOP && point.y < screenHeight - APP_BOTTOM_INSET;
}
/** 节点自身不吃点击时，往上找真正吃点击的那一层。 */
function clickableSelfOrAncestor(node) {
    let current = node;
    while (current !== undefined) {
        if (current.isClickable) {
            return current;
        }
        current = current.parent;
    }
    return node;
}
async function ks_collect_share_link() {
    await ensureKsForeground();
    const screenHeight = await readScreenHeight();
    const outcome = await extractShareOnDetailPage(screenHeight);
    if (outcome.skipped) {
        // 单条工具是「把当前这条取出来」的语义，遇到广告页没有东西可给，如实报错
        throw new Error("当前作品是广告详情页，没有可采集的分享链接");
    }
    return {
        success: true,
        url: outcome.url,
        shareText: outcome.shareText,
        contentId: outcome.contentId,
    };
}
// ===== 记录落地与 outbox 上报 =====
//
// 采集与上报解耦：采集只往 records.jsonl 追加记录，上报由 outbox.json 驱动。
// 脚本被杀或超时都不会丢记录，重放安全。上报契约见
// docs/TODO/device_automation_platform_20261008/03_record_store_and_outbox.md。
const PLUGIN_ID = "ks_collector";
const CONFIG_DIR = getPluginConfigDir(PLUGIN_ID);
const RECORDS_FILE = `${CONFIG_DIR}/records.jsonl`;
const OUTBOX_FILE = `${CONFIG_DIR}/outbox.json`;
const PROGRESS_FILE = `${CONFIG_DIR}/progress.json`;
// 上报地址与令牌存在宿主的环境变量里，不再落成文件。
// 该存储是全局键值、不按包隔离（EnvPreferences）。服务端只有一个，
// 所以本包与抖音、小红书两个采集包共用同一组中立键，键名不带来源前缀。
// 设置入口是工具箱里的「快手采集设置」页，读写分别走 UI 模块的 setEnv 与脚本的 getEnv。
const ENV_BASE_URL = "COLLECTOR_BASE_URL";
const ENV_TOKEN = "COLLECTOR_TOKEN";
// 待迁移的键名。这组键是抖音包早期版本留下的：服务端只有一个，三个采集包共用中立键，
// 所以快手这一侧也要把抖音的旧键搬过来，用户先打开哪个设置页都不影响结果。
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
const RECORD_SOURCE = "kuaishou_app";
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
 * 从分享短链解析出稳定的作品身份 content_id。
 *
 * **短码不能当身份**：快手每次「分享链接」都会生成一个新的 v.kuaishou.com 短码。
 * 2026-10-19 真机实测：同一个作品（小陈家装｜这风格老铁们喜欢吗）的 4 个不同短码
 * （JMr9Ziyt / KlSb2UEZ / JW1dhvtt / 7IFbHrYb）都跳到同一个分享页，
 * 562 条历史记录里只有 153 个不同的作品，72% 是重复行。
 *
 * 稳定身份在跳转后的分享页 JSON 里：\"photoId\":\"5238531002599057662\"（三个短码实测一致）。
 * 解析失败直接抛错，绝不退回用短码当身份——短码每次都变，退回去等于继续写重复行。
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
        throw new Error(`解析作品身份失败：${shareUrl} 返回 HTTP ${response.statusCode}`);
    }
    const matched = String(response.content ?? "").match(KS_CONTENT_ID_PATTERN);
    if (!matched) {
        throw new Error(`解析作品身份失败：${shareUrl} 的分享页里没有 photoId（页面可能改版或被风控）`);
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
        last_video_id: "",
        last_stop_reason: "",
        last_chunk_started_at: "",
        last_chunk_finished_at: "",
        updated_at: nowIso(),
    };
}
/**
 * 一次性迁移：把带来源前缀的旧键搬到中立键上，然后清掉旧键。
 *
 * 上报地址与令牌改成了不带来源前缀的中立键，三个采集包共用同一组键。
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
async function ks_migrate_upload_config() {
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
 * 配置在宿主的环境变量里，设置入口是工具箱里的「快手采集设置」页。
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
            `请在 工具箱 → 快手采集设置 里填写并保存。`);
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
            rejectedReasons: {},
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
                rejectedReasons: {},
                note: `响应体无法解析：${content.slice(0, 200)}`,
                retryAfterSeconds: 0,
            };
        }
        const rejected = parsed.rejected ?? [];
        const rejectedReasons = Object.create(null);
        for (const item of rejected) {
            rejectedReasons[item.key] = item.reason;
        }
        return {
            httpStatus: status,
            kind: "accepted",
            acceptedKeys: parsed.accepted ?? [],
            rejectedKeys: rejected.map((item) => item.key),
            rejectedReasons,
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
            rejectedReasons: {},
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
            rejectedReasons: {},
            note: `服务端错误 HTTP ${status}：${content.slice(0, 200)}`,
            retryAfterSeconds: 0,
        };
    }
    return {
        httpStatus: status,
        kind: "client_error",
        acceptedKeys: [],
        rejectedKeys: [],
        rejectedReasons: {},
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
async function ks_outbox_flush() {
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
                    const reason = outcome.rejectedReasons[record.idempotency_key] ?? "";
                    markOutbox(outbox, record.idempotency_key, "failed", reason ? `服务端拒绝：${reason}` : "服务端拒绝");
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
async function ks_outbox_status() {
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
async function ks_upload_config_check() {
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
const DEFAULT_COLLECT_COUNT = 1;
// 单片时间上限。脚本硬超时是 30 分钟，这里留出安全边际，默认 18 分钟，最多允许 20 分钟。
const DEFAULT_CHUNK_MINUTES = 18;
const MAX_CHUNK_MINUTES = 20;
const STOP_REASON_TEXT = {
    count: "达到条数目标",
    time: "时间到",
    search_exhausted: "结果集到底",
    duplicates: "结果集里已没有新作品",
};
/**
 * 采集一片搜索结果。
 *
 * 遍历按「搜索结果页」驱动：切到「视频」标签 → 读一屏可见卡片 → 逐张点进详情取链 → 每取一条回列表 →
 * 这一屏处理完往下滚一屏。为什么每条都要回列表：快手详情页是连续信息流，滑到搜索结果用尽后
 * 会接到推荐流，而详情页上没有可靠的「我还在结果集里」的标记（实测过 `相关搜索` 模块，
 * 12 次连续滑动里时有时无，不能当判据），逐张点进才能保证每一条都来自显式选中的搜索结果卡片。
 */
async function ks_collect_share_links(params) {
    const keyword = (params.keyword ?? "").trim();
    if (!keyword) {
        throw new Error("ks_collect_share_links 需要 keyword");
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
    await ensureKsForeground();
    const screenHeight = await readScreenHeight();
    const outbox = await loadOutbox();
    const storedRecords = await loadRecords();
    // 本地去重按内容真实身份 content_id，跨轮次生效。
    // 0.3.0 之前写下的记录没有 content_id，跳过它们：拿不到身份就不猜（硬猜会串内容）。
    const storedContentIds = Object.create(null);
    for (const record of storedRecords) {
        if (record.content_id) {
            storedContentIds[record.content_id] = true;
        }
    }
    await openSearch(keyword);
    await switchToVideoTab(screenHeight);
    const collected = [];
    // 本片内已处理过的卡片身份键：往下滚之后同一张卡会再次可见，靠它跳过
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
        const cards = findCards(page, screenHeight);
        let card;
        for (const candidate of cards) {
            // 未渲染完的卡片身份键不可靠（会退化成「左边界 + 作者」），跳过它，等它渲染出来再采
            if (!isRenderedCard(candidate)) {
                continue;
            }
            if (seenCardKeys[cardKeyOf(candidate)]) {
                continue;
            }
            card = candidate;
            break;
        }
        if (!card) {
            // 这一屏能采的卡片都处理过了，往下滚一屏。滚动必须带前进判定：
            // 没有判定就一直滚会变成死循环，抖音那边已经踩过一次。
            const beforeKeys = cards.map((item) => cardKeyOf(item)).join("|");
            await scrollList(screenHeight);
            const nextKeys = findCards(await readRoot(), screenHeight)
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
        // 卡片上的「广告」角标。只做标记，不据此丢弃数据，判断权交给服务端。
        const promoHint = cardPromoHintOf(card);
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
            console.log(`卡片采不动，跳过（连续第 ${unusableInARow} 张）：${cardKey} —— ${errorMessage(error)}`);
            await returnToSearchList(keyword);
            if (unusableInARow >= MAX_CONSECUTIVE_UNUSABLE) {
                throw new Error(`连续 ${unusableInARow} 张卡片都采不动，已经不是单张卡片的版式问题，中断本片`);
            }
            continue;
        }
        // 取链时进过评论区，这里退回搜索结果页再处理下一条
        await returnToSearchList(keyword);
        unusableInARow = 0;
        if (outcome.skipped) {
            // 广告详情页：右侧互动条整条不在，没有分享入口，分享链接读不出来。
            // 按用户决定整条跳过并继续下一张，不当作失败，也不占本片的条数目标。
            skippedAds += 1;
            console.log(`广告详情页，整条跳过：${outcome.author || cardKey}`);
            continue;
        }
        const contentId = outcome.contentId;
        if (storedContentIds[contentId]) {
            skippedDuplicates += 1;
            consecutiveSkips += 1;
            console.log(`已在库里，跳过：${outcome.url}（content_id=${contentId}）`);
            continue;
        }
        // 标题取分享文本里短链之后的完整正文：详情页的 element_caption_label 是被截断的
        const title = parseTitleFromShareText(outcome.shareText, outcome.url);
        const record = {
            idempotency_key: randomId(),
            keyword,
            url: outcome.url,
            share_text: outcome.shareText,
            title,
            author: outcome.author,
            collected_at: nowIso(),
            source: RECORD_SOURCE,
            content_id: contentId,
            keyword_in_title: title.includes(keyword),
            promo_hint: promoHint,
        };
        // 每条立即落盘并建 pending 的 outbox 记录，中途被杀也不会丢
        await appendRecord(outbox, record);
        await saveOutbox(outbox);
        storedContentIds[contentId] = true;
        consecutiveSkips = 0;
        collected.push(outcome.url);
        progress.collected_total += 1;
        progress.last_url = outcome.url;
        progress.last_video_id = contentId;
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
exports.ks_collect_share_link = ks_collect_share_link;
exports.ks_collect_share_links = ks_collect_share_links;
exports.ks_outbox_flush = ks_outbox_flush;
exports.ks_outbox_status = ks_outbox_status;
exports.ks_upload_config_check = ks_upload_config_check;
exports.ks_migrate_upload_config = ks_migrate_upload_config;
