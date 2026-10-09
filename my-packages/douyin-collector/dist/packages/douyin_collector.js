/* METADATA
{
    "name": "douyin_collector",
    "display_name": {
        "zh": "抖音采集",
        "en": "Douyin Collector"
    },
    "description": {
        "zh": "采集抖音搜索结果的分享链接并上报。逐条取链后落盘到 records.jsonl，再由 outbox 批量上报到服务端。",
        "en": "Collect share links from Douyin search results and upload them. Each link is appended to records.jsonl, and the outbox uploads them in batches."
    },
    "enabledByDefault": true,
    "category": "Automatic",
    "tools": [
        {
            "name": "douyin_collect_share_link",
            "description": {
                "zh": "取出当前打开的视频的分享链接。流程是点分享按钮、点面板里的「分享链接」，再从评论输入框回读剪贴板内容并清空。必须在视频详情页调用，它不会自己导航。",
                "en": "Extract the share link of the video currently open on its Douyin detail page: open the share sheet, tap the copy-link item, then paste the clipboard into the comment field, read it back and clear it. Must be called on a video detail page; it does not navigate."
            },
            "parameters": []
        },
        {
            "name": "douyin_collect_share_links",
            "description": {
                "zh": "采集抖音搜索结果的分享链接，一次运行只做一片。自动切到「视频」标签，按结果页逐页取：读一页可见的卡片，点第一张进详情，在详情页内滑着把这一页取完，再回列表下滑取下一页。之所以不回列表逐张点，是为了省掉每条一次返回定位；之所以要按页约束，是因为详情页滑到结果集尽头会接到推荐流，实测把一批广告当成了关键词结果。每条记录立即追加到 records.jsonl 并建 pending 的 outbox 记录，已采集过的视频跳过。按条数目标或时间上限先到者结束本片，结果页翻到底也会结束，结束原因写进 progress.json。每条记录带 keyword_in_title 与 promo_hint 两个标记（标题是否含关键词、页面是否有推广标记），只标记不过滤，是否丢弃交由服务端决定。",
                "en": "Collect share links from Douyin search results, one chunk per run. Switches to the Video tab and works page by page through the result grid: read the visible cards, open the first one, swipe within its detail feed to take the rest of that page, then go back and scroll to the next page. Staying bounded by pages matters because the detail feed rolls into recommendations once the search results run out, which in testing pulled a run of ads in as if they were results. Every record is appended to records.jsonl with a pending outbox entry; videos already collected are skipped. The chunk ends on the item target, the time limit, or an exhausted result list, and the reason is written to progress.json. Every record carries keyword_in_title and promo_hint markers (whether the title mentions the keyword, whether the page shows promo markers); they are markers only, so the server decides what to drop."
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
            "name": "douyin_outbox_flush",
            "description": {
                "zh": "把 outbox 里所有 pending 的记录按每批 20 条上报到配置的服务器。地址与令牌在工具箱的「抖音采集设置」页里配置。200/202 按响应里的 accepted 与 rejected 逐条置状态，429 停止本轮，5xx 与网络错误保持 pending 并累加尝试次数，其他 4xx 置 failed。failed 不自动重发。",
                "en": "Upload all pending outbox records to the configured server in batches of 20. The base URL and token are configured on the Douyin Collector settings page in the toolbox. On 200/202 each record is set from the response's accepted and rejected lists; 429 stops this round; 5xx and network errors stay pending with an incremented attempt count; other 4xx become failed. Failed records are not retried automatically."
            },
            "parameters": []
        },
        {
            "name": "douyin_upload_config_check",
            "description": {
                "zh": "自检上报配置：地址是否可达、令牌是否被接受。做法是故意发一个空批次，服务端按参数校验拒收它，不会写入任何数据；而拒收之前鉴权已经做完，所以「参数校验类的 400」正好证明配置可用。",
                "en": "Self-check the upload configuration: whether the base URL is reachable and the token is accepted. It deliberately sends an empty batch which the server rejects on parameter validation, so nothing is written; since authentication happens before validation, a parameter-validation 400 is exactly the proof that the configuration works."
            },
            "parameters": []
        },
        {
            "name": "douyin_outbox_status",
            "description": {
                "zh": "统计记录与 outbox 的状态：pending、sent、failed 各多少条，以及文件位置。",
                "en": "Report record and outbox counts: how many are pending, sent and failed, plus the file locations."
            },
            "parameters": []
        }
    ]
}
*/
// 抖音国内版包名。海外版是 com.zhiliaoapp.musically，需要时另开一个常量。
const DOUYIN_PACKAGE = "com.ss.android.ugc.aweme";
// deep link 直达搜索页。注意 https 分享链接会弹选择器，所以这里必须走 scheme 并显式指定包名。
const DOUYIN_SEARCH_SCHEME = "snssdk1128://search";
// 搜索页加载需要时间，抖音页面会持续自动播放，固定等待比条件等待更早能用。
const SEARCH_LOAD_WAIT_MS = 6000;
// 分享按钮的 content-desc 形如「分享1461，按钮」，计数会变，所以按前缀匹配。
const SHARE_BUTTON_DESC_PREFIX = "分享";
// 当前版本的分享面板里这一项叫「分享链接」，点它就是复制链接。
const SHARE_PANEL_ITEM_TEXT = "分享链接";
// 复制成功后弹出的提示层文案。
const COPIED_HINT_TEXT = "链接已复制成功";
// 关掉分享面板用返回键；面板是模态窗口，不关掉后面的节点都读不到。
const KEYCODE_BACK = 4;
const KEYCODE_PASTE = 279;
const KEYCODE_DEL = 67;
const CTRL_A_KEYCODES = "113 29";
// 无障碍档返回的 class 是简名，例如 EditText；shell 的 uiautomator 档返回全名，例如 android.widget.EditText。
// 用简名配合部分匹配，两种档位都能命中。
const EDIT_TEXT_CLASS = "EditText";
const STEP_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 500;
// 连续读页面失败时的退避上限
const MAX_READ_BACKOFF_MS = 3000;
// 搜索结果页的等待上限。抖音搜索页要加载封面与自动播放，加上 provider 偶发读失败，10 秒不够用。
const SEARCH_PAGE_TIMEOUT_MS = 30000;
const UI_SETTLE_MS = 800;
// 把抖音切到前台的等待上限。含应用切换本身与偶发的读页面失败重试。
const FOREGROUND_WAIT_TIMEOUT_MS = 15000;
// 抖音分享文本形如「0.05 复制打开抖音，看看【作者的作品】标题… https://v.douyin.com/xxxx/ aAG:/ …」，
// 尾部还有噪声，所以只抽链接本身。
const DOUYIN_SHARE_URL_PATTERN = /https?:\/\/v\.douyin\.com\/[^\s]+/;
// 详情页上的推广/商业标记词。命中就把 promo_hint 置真，交由服务端决定是否过滤。
// 注意这是"标记"不是"判据"：评论区里出现这些词也会命中，所以不据此丢弃。
const PROMO_HINT_TERMS = [
    "广告",
    "赞助",
    "推广",
    "团购",
    "优惠券",
    "新人券",
    "立即购买",
    "了解更多",
    "查看详情",
    "抢购",
    "下单",
    "门店",
    "直播中",
];
/** 详情页上有没有推广/商业标记。命中只写进记录，不用来决定采不采。 */
function hasPromoHint(root) {
    const texts = root.allTexts(true, true);
    return texts.some((text) => PROMO_HINT_TERMS.some((term) => text.includes(term)));
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
 * 确保抖音在剪贴板取链前处于前台。
 *
 * 无障碍服务读的是当前活动窗口，从 Operit 界面调用本工具时前台是 Operit，
 * 不切换就只能读到 Operit 自己的节点树。
 *
 * 读页面会偶发失败：宿主读无障碍树时三次重试只隔 300ms，页面动画期间会连续超时。
 * 在「等到抖音在前台」这个语义下，这类失败等同于「还没就绪」，退避后继续等到超时为止，
 * 超时信息里带上最后一次读取失败的原因，不掩盖真实故障。
 */
async function ensureDouyinForeground() {
    const deadline = Date.now() + FOREGROUND_WAIT_TIMEOUT_MS;
    let switchRequested = false;
    let lastPackage = "";
    let lastReadError = "";
    let consecutiveReadFailures = 0;
    while (Date.now() < deadline) {
        try {
            const current = await Tools.UI.getPageInfo();
            lastPackage = current.packageName;
            if (current.packageName === DOUYIN_PACKAGE) {
                return;
            }
            consecutiveReadFailures = 0;
            if (!switchRequested) {
                await Tools.System.startApp(DOUYIN_PACKAGE);
                switchRequested = true;
            }
        }
        catch (error) {
            lastReadError = errorMessage(error);
            consecutiveReadFailures += 1;
            console.log(`读前台应用失败第 ${consecutiveReadFailures} 次，继续等待抖音就绪：${lastReadError}`);
            await Tools.System.sleep(Math.min(POLL_INTERVAL_MS * consecutiveReadFailures, MAX_READ_BACKOFF_MS));
            continue;
        }
        await Tools.System.sleep(POLL_INTERVAL_MS);
    }
    const readNote = lastReadError ? `最后一次读页面失败：${lastReadError}；` : "";
    throw new Error(`等待抖音切到前台超时，当前前台是 ${lastPackage || "未知"}。${readNote}`);
}
/**
 * 点分享面板里的「分享链接」。
 * 面板高度会随内容变化（有联系人那一行时更高），这一项有时会被推到导航栏下面，
 * 落在那里 的点击不会传给应用，所以先判断是否在可视区，不在就把面板内容往上带一点。
 */
async function tapShareLinkItem(screenHeight) {
    const finder = (root) => root.findByText(SHARE_PANEL_ITEM_TEXT, { exact: false });
    for (let attempt = 0; attempt <= MAX_SHEET_LIFT_ATTEMPTS; attempt += 1) {
        const item = await waitForNode(finder, SHARE_PANEL_ITEM_TEXT);
        if (isNodeVisible(item, screenHeight)) {
            await tapNode(item, SHARE_PANEL_ITEM_TEXT);
            return;
        }
        const point = item.centerPoint;
        console.log(`「${SHARE_PANEL_ITEM_TEXT}」落在可视区外（y=${point ? point.y : -1}，屏幕 ${screenHeight}），把面板内容往上带`);
        await Tools.UI.swipe(540, 2150, 540, 1850, SWIPE_DURATION_MS);
        await Tools.System.sleep(UI_SETTLE_MS);
    }
    throw new Error(`「${SHARE_PANEL_ITEM_TEXT}」始终处于可视区外，无法点击`);
}
/**
 * 在当前视频详情页取一次分享链接。
 *
 * 步骤固定为：点分享按钮 → 点面板里的「分享链接」→ 等复制成功提示 → 关掉面板 → 从评论输入框回读。
 * 单条工具与批量采集共用这一段，避免两处逻辑各自漂移。
 *
 * 分享按钮用带可见性判断的定位，并把它当时的 content-desc 一并返回：
 * 批量采集靠这个 desc 里的计数变化判断是否真的切到了下一个视频。
 */
async function extractShareLinkOnDetailPage(screenHeight) {
    const shareButton = await waitForDetailShareButton(screenHeight);
    const shareDesc = shareButton.contentDesc ?? "";
    // 详情页此刻是最完整的，先把推广标记读出来
    const promoHint = hasPromoHint(UINode.fromPageInfo(await Tools.UI.getPageInfo()));
    await tapNode(shareButton, "分享按钮");
    await tapShareLinkItem(screenHeight);
    await waitForNode((root) => root.findByText(COPIED_HINT_TEXT, { exact: false }), COPIED_HINT_TEXT);
    // 分享面板是模态窗口，用返回键关掉之后详情页的节点才回到节点树里
    await Tools.System.shell(`input keyevent ${KEYCODE_BACK}`);
    await Tools.System.sleep(UI_SETTLE_MS);
    const { url, shareText } = await pasteAndReadShareText();
    return { url, shareText, shareDesc, promoHint };
}
async function douyin_collect_share_link() {
    await ensureDouyinForeground();
    const screenHeight = await readScreenHeight();
    const { url, shareText } = await extractShareLinkOnDetailPage(screenHeight);
    return {
        success: true,
        url,
        shareText,
    };
}
/**
 * 读取剪贴板里的分享文本并抽出链接。
 *
 * 这里用「粘贴进输入框再读回」而不是 read_clipboard，是实测决定的：
 * Android 10 起只有获得焦点的应用才能读系统剪贴板，采集时前台是抖音，
 * 后台的 Operit 用 read_clipboard 只能读到空字符串。粘贴回读不受这条限制。
 * 粘贴目标必须是详情页的评论输入框，不能是搜索框，否则会触发重新搜索。
 */
async function pasteAndReadShareText() {
    const input = await waitForNode(findEditText, "输入框");
    await tapNode(input, "输入框");
    await Tools.System.sleep(UI_SETTLE_MS);
    // 粘上之后无论成败都必须清空。清理一旦放回成功路径，回读超时就会把粘贴内容
    // 留在评论框里成一条草稿，而且下一条会接在它后面。
    try {
        await Tools.System.shell(`input keyevent ${KEYCODE_PASTE}`);
        const filled = await waitForNode((root) => {
            const edit = findEditText(root);
            const text = edit?.text ?? "";
            return DOUYIN_SHARE_URL_PATTERN.test(text) ? edit : undefined;
        }, "粘贴后的分享文本");
        const shareText = filled.text ?? "";
        const matched = shareText.match(DOUYIN_SHARE_URL_PATTERN);
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
 * 粘进来的东西不是抖音分享链接时的报错。
 *
 * 最常见的原因是「分享链接」那一步没真正把链接写进剪贴板，于是被粘进来的是剪贴板里
 * 原有的内容。带上开头一小段，出问题时能一眼看出粘到了什么，不用翻节点树。
 */
function pasteMismatchMessage(shareText) {
    const preview = shareText.trim().slice(0, 40);
    return `粘进来的内容里没有抖音分享链接，复制那一步可能没生效。内容开头：${preview || "(空)"}`;
}
/** 清空评论输入框并收起面板与键盘，回到视频详情页。 */
async function clearCommentInput() {
    await Tools.System.shell(`input keycombination ${CTRL_A_KEYCODES}`);
    await Tools.System.shell(`input keyevent ${KEYCODE_DEL}`);
    await Tools.System.sleep(UI_SETTLE_MS);
    await Tools.System.shell(`input keyevent ${KEYCODE_BACK}`);
    await Tools.System.sleep(UI_SETTLE_MS);
}
const DEFAULT_COLLECT_COUNT = 1;
// 连续命中已采集过的视频到这个数就停，避免在同一个列表里空转
const MAX_CONSECUTIVE_SKIPS = 10;
// 单片时间上限。脚本硬超时是 30 分钟，这里留出安全边际，默认 18 分钟，最多允许 20 分钟。
const DEFAULT_CHUNK_MINUTES = 18;
const MAX_CHUNK_MINUTES = 20;
// 「视频」标签是两列网格，卡片封面没有 content-desc，但右下角有时间角标，形如 00:50，用它定位卡片。
const DURATION_TEXT_PATTERN = /^\d{2}:\d{2}$/;
// 搜索页就绪的标志：顶部出现「综合」标签。
const SEARCH_PAGE_MARKER = "综合";
// 应用窗口底部会被导航栏占掉，落在那里的点击不会传给应用。
const APP_BOTTOM_INSET = 150;
// 分享面板内容需要往上带的次数上限。
const MAX_SHEET_LIFT_ATTEMPTS = 3;
// 详情页内切换到下一个视频：连续滑动上限与切换后的稳定等待。
const MAX_NEXT_VIDEO_ATTEMPTS = 3;
const VIDEO_SWITCH_SETTLE_MS = 2500;
const SWIPE_DURATION_MS = 400;
// 把详情页从评论区恢复到视频画面：允许的返回键次数上限。
const MAX_BACK_TO_VIDEO_ATTEMPTS = 2;
// 无障碍树里屏幕外的节点也会带着坐标，所以要点之前先确认目标已经进入可视区域。
// 顶部搜索栏与筛选标签占掉的高度，中心点落在这条线以上会点到搜索区。
const VISIBLE_TOP_MARGIN = 420;
/**
 * 判断节点是否真的落在可点击的可视区域内。
 *
 * 有两个坑：
 * 1. 被滚出屏幕的节点会给出反向边界，例如 [56,354][723,70]，只比较上边坐标会误判；
 * 2. 中心点如果落在顶部搜索栏高度内，点击会打开搜索面板而不是卡片。
 */
function isNodeVisible(node, screenHeight) {
    const matched = (node.bounds ?? "").match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    if (!matched) {
        return false;
    }
    const y1 = Number(matched[2]);
    const y2 = Number(matched[4]);
    if (y2 <= y1) {
        return false;
    }
    const point = node.centerPoint;
    if (!point) {
        return false;
    }
    return point.y > VISIBLE_TOP_MARGIN && point.y < screenHeight - APP_BOTTOM_INSET;
}
async function readScreenHeight() {
    const result = await Tools.System.shell("wm size");
    const matched = result.output.match(/(\d+)\s*x\s*(\d+)/);
    if (!matched) {
        throw new Error(`无法从 wm size 解析屏幕高度：${result.output.trim()}`);
    }
    return Number(matched[2]);
}
function parseTopY(bounds) {
    const matched = (bounds ?? "").match(/^\[\d+,(\d+)\]/);
    return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
}
// 网格排序用。视频标签是两列，同一行要按左边界分先后。
function parseLeftX(bounds) {
    const matched = (bounds ?? "").match(/^\[(\d+),/);
    return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
}
function findEditText(root) {
    return root.findByClass(EDIT_TEXT_CLASS, { exact: false });
}
/** 搜索页顶部的标签行高度上限，用来把标签行的节点和正文里的同名文字区分开。 */
const TAB_ROW_MAX_Y = 400;
// 采集固定走这个标签，避开综合标签里的直播与图文。
const VIDEO_TAB_TEXT = "视频";
/**
 * 搜索页顶部标签行里的某个标签。
 * 默认落在「综合」，那里混着直播、图文、用户等条目：直播间没有分享链接面板，
 * 滑动还会直接滑进直播间，所以固定先切到「视频」标签，让列表里只有视频。
 */
function findSearchTab(root, label) {
    return root.find((node) => {
        if ((node.text ?? "") !== label) {
            return false;
        }
        const point = node.centerPoint;
        return point !== undefined && point.y < TAB_ROW_MAX_Y;
    }, true);
}
/**
 * 取当前视口内最上面那张视频卡片的时长角标，点它进入视频详情页。
 *
 * 「视频」标签下卡片封面没有 content-desc，「综合」标签下才有「视频封面」。
 * 采集固定走「视频」标签，所以这里按时长角标定位：角标落在卡片封面上，点它就会打开该视频。
 */
/**
 * 当前视口内可见的卡片角标，按网格顺序返回：先上后下，同一行先左后右。
 *
 * 分页驱动遍历要的就是"这一页有哪几张卡、从哪张开始"，所以这里返回数组而不是单张。
 * 退化边界（y2<=y1）由 isNodeVisible 剔除，实测抖音的回收视图里会混进这类节点。
 */
function findVisibleVideoCards(root, screenHeight) {
    return root
        .findAll((node) => DURATION_TEXT_PATTERN.test((node.text ?? "").trim()), true)
        .filter((node) => isNodeVisible(node, screenHeight))
        .sort((a, b) => {
        const topDiff = parseTopY(a.bounds) - parseTopY(b.bounds);
        return topDiff !== 0 ? topDiff : parseLeftX(a.bounds) - parseLeftX(b.bounds);
    });
}
function findVisibleVideoCard(root, screenHeight) {
    const cards = findVisibleVideoCards(root, screenHeight);
    return cards.length > 0 ? cards[0] : undefined;
}
/**
 * 详情页上可见、可点击的分享按钮。
 *
 * 视频作品是「分享1461，按钮」这种带计数与后缀的形式，图文作品不带「，按钮」后缀，
 * 所以只按「以分享开头」匹配。进入详情页之后不会再有搜索结果页的卡片，放宽不会误伤。
 *
 * 可见性必须并进匹配条件：树里可能存在边界被裁掉的同名节点，分成两步会先选中那种节点
 * 再把它否掉，结果误报成找不到分享按钮。
 */
function findVisibleShareButton(root, screenHeight) {
    return root.find((node) => {
        const desc = node.contentDesc ?? "";
        return desc.startsWith(SHARE_BUTTON_DESC_PREFIX) && isNodeVisible(node, screenHeight);
    }, true);
}
/**
 * 等详情页的分享按钮进入可点击状态。
 * 视频切换动画期间节点已经存在但边界还算不出来，只等「存在」会拿到没有坐标的节点。
 */
async function waitForDetailShareButton(screenHeight) {
    return await waitForNode((root) => findVisibleShareButton(root, screenHeight), "视频详情页的分享按钮");
}
/**
 * 把详情页恢复到「能看到视频与互动条」的状态。
 *
 * 取链时点过评论输入框，返回键有时只收起了键盘，页面仍停在评论区或推荐区，
 * 这时互动条不在画面里，继续滑动就变成滚页面而不是切视频。恢复方式是再按返回键关掉评论面板。
 * 恢复不了就报错，不带病继续滑动。
 */
async function ensureVideoVisible(screenHeight) {
    for (let attempt = 0; attempt <= MAX_BACK_TO_VIDEO_ATTEMPTS; attempt += 1) {
        const root = await readRoot();
        const button = findVisibleShareButton(root, screenHeight);
        if (button) {
            return button;
        }
        console.log(`第 ${attempt + 1} 次检查：互动条不在画面里，按返回键关评论面板`);
        await Tools.System.shell(`input keyevent ${KEYCODE_BACK}`);
        await Tools.System.sleep(VIDEO_SWITCH_SETTLE_MS);
    }
    const root = await readRoot();
    throw new Error(`详情页没能恢复到视频画面。现场：${root.allTexts(true, true).slice(0, 8).join(" | ")}`);
}
/**
 * 在视频详情页内向上滑，切到下一个视频。
 *
 * 起点必须落在视频画面上。落在底部互动条（赞/评论/分享那一行，y 约 1663 到 1850）
 * 会被当成按钮拖拽，切不动视频。
 *
 * 滑动后只读一次节点树判断结果，读不到可点击的分享按钮就再滑，最多 MAX_NEXT_VIDEO_ATTEMPTS 次。
 */
async function swipeToNextVideo(previousShareDesc, screenHeight) {
    // 评论面板刚收起时页面还在动画，先等稳再滑，否则手势可能被面板吃掉
    await Tools.System.sleep(VIDEO_SWITCH_SETTLE_MS);
    await ensureVideoVisible(screenHeight);
    for (let attempt = 1; attempt <= MAX_NEXT_VIDEO_ATTEMPTS; attempt += 1) {
        await Tools.UI.swipe(540, 1300, 540, 300, SWIPE_DURATION_MS);
        await Tools.System.sleep(VIDEO_SWITCH_SETTLE_MS);
        const root = await readRoot();
        const button = findVisibleShareButton(root, screenHeight);
        if (!button) {
            console.log(`第 ${attempt} 次滑动后没有读到可点击的分享按钮，现场：${root.allTexts(true, true).slice(0, 6).join(" | ")}`);
            continue;
        }
        const desc = button.contentDesc ?? "";
        if (desc !== previousShareDesc) {
            console.log(`已切到下一个视频（${previousShareDesc} -> ${desc}）`);
            return desc;
        }
        console.log(`第 ${attempt} 次滑动后分享按钮仍是 ${desc}，继续尝试`);
    }
    throw new Error(`连续滑动 ${MAX_NEXT_VIDEO_ATTEMPTS} 次后仍无法确认切到了下一个视频`);
}
// ===== 记录落地与 outbox 上报 =====
//
// 采集与上报解耦：采集只往 records.jsonl 追加记录，上报由 outbox.json 驱动。
// 脚本被杀或超时都不会丢记录，重放安全。上报契约见
// docs/TODO/device_automation_platform_20261008/03_record_store_and_outbox.md。
const PLUGIN_ID = "douyin_collector";
const CONFIG_DIR = getPluginConfigDir(PLUGIN_ID);
const RECORDS_FILE = `${CONFIG_DIR}/records.jsonl`;
const OUTBOX_FILE = `${CONFIG_DIR}/outbox.json`;
const PROGRESS_FILE = `${CONFIG_DIR}/progress.json`;
// 上报地址与令牌存在宿主的环境变量里，不再落成文件。
// 该存储是全局键值、不按包隔离（EnvPreferences），所以键名必须带包前缀。
// 设置入口是工具箱里的「抖音采集设置」页，读写分别走 UI 模块的 setEnv 与脚本的 getEnv。
const ENV_BASE_URL = "DOUYIN_COLLECTOR_BASE_URL";
const ENV_TOKEN = "DOUYIN_COLLECTOR_TOKEN";
const UPLOAD_PATH = "/api/v1/records";
// 批量条数取自上报契约
const UPLOAD_BATCH_SIZE = 20;
const HTTP_CONNECT_TIMEOUT_MS = 15000;
const HTTP_READ_TIMEOUT_MS = 30000;
// source 固定值，为将来的其他来源留位
const RECORD_SOURCE = "douyin_app";
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
/** 分享链接归一化后的视频标识，用于本地去重。 */
function videoIdOf(url) {
    const matched = url.match(/v\.douyin\.com\/([A-Za-z0-9_-]+)/);
    if (!matched) {
        throw new Error(`分享链接不符合预期，取不出视频标识：${url}`);
    }
    return matched[1];
}
/** 从分享口令里取作者与标题。取不到就是空字符串，契约允许这两个字段为空。 */
function parseShareMeta(shareText) {
    const authorMatched = shareText.match(/【(.+?)的作品】/);
    const titleMatched = shareText.match(/】([\s\S]*?)https?:\/\//);
    return {
        author: authorMatched ? authorMatched[1] : "",
        title: titleMatched ? titleMatched[1].trim() : "",
    };
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
 * 读上报配置。
 *
 * 配置在宿主的环境变量里，设置入口是工具箱里的「抖音采集设置」页。
 * 这里不做任何兜底：键缺失就报错，并把该去哪填写说清楚，绝不拿空地址去发请求。
 */
function readUploadConfig() {
    const baseUrl = (getEnv(ENV_BASE_URL) ?? "").trim();
    const token = (getEnv(ENV_TOKEN) ?? "").trim();
    if (!baseUrl || !token) {
        throw new Error(`未配置上报地址或令牌（地址${baseUrl ? "已设置" : "为空"}，令牌${token ? "已设置" : "为空"}）。` +
            `请在 工具箱 → 抖音采集设置 里填写并保存。`);
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
async function douyin_outbox_flush() {
    const config = readUploadConfig();
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
async function douyin_outbox_status() {
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
async function douyin_upload_config_check() {
    const config = readUploadConfig();
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
async function douyin_collect_share_links(params) {
    const keyword = (params.keyword ?? "").trim();
    if (!keyword) {
        throw new Error("douyin_collect_share_links 需要 keyword");
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
    const chunkBudgetMs = chunkMinutes * 60 * 1000;
    const chunkStartedAt = Date.now();
    const progress = await startProgress(keyword);
    progress.chunk_index += 1;
    progress.last_chunk_started_at = nowIso();
    progress.last_stop_reason = "";
    await saveProgress(progress);
    console.log(`本轮第 ${progress.chunk_index} 片开始，本片目标 ${count} 条，时间上限 ${chunkMinutes} 分钟`);
    await ensureDouyinForeground();
    await Tools.System.intent({
        type: "activity",
        action: "android.intent.action.VIEW",
        uri: `${DOUYIN_SEARCH_SCHEME}?keyword=${encodeURIComponent(keyword)}`,
        package: DOUYIN_PACKAGE,
    });
    await Tools.System.sleep(SEARCH_LOAD_WAIT_MS);
    await waitForNode((root) => root.findByText(SEARCH_PAGE_MARKER, { exact: false }), "搜索结果页", SEARCH_PAGE_TIMEOUT_MS);
    const screenHeight = await readScreenHeight();
    // 先切到「视频」标签。默认的「综合」标签里混着直播、图文、用户等条目，
    // 直播间既没有分享链接面板，滑动还会直接滑进直播间，把整条采集流程带偏。
    const videoTab = await waitForNode((root) => findSearchTab(root, VIDEO_TAB_TEXT), `「${VIDEO_TAB_TEXT}」标签`);
    await tapNode(videoTab, `「${VIDEO_TAB_TEXT}」标签`);
    await Tools.System.sleep(SEARCH_LOAD_WAIT_MS);
    // 遍历按"搜索结果页"驱动：读一页卡片 → 点第一张进详情 → 页内滑动把这一页取完 →
    // 返回列表下滑一屏取下一页。为什么不一路滑到底：详情页的滑动在搜索结果用尽后会接到
    // 推荐流，实测把连续 20 条瑞幸广告当成关键词结果收了下来，页内滑动能把范围钉在列表里。
    const outbox = await loadOutbox();
    const storedRecords = await loadRecords();
    // 本地去重按分享链接归一化后的视频标识，跨轮次生效
    const storedVideoIds = Object.create(null);
    for (const record of storedRecords) {
        storedVideoIds[videoIdOf(record.url)] = true;
    }
    const readVisibleCards = async () => {
        const root = UINode.fromPageInfo(await Tools.UI.getPageInfo());
        return findVisibleVideoCards(root, screenHeight);
    };
    const collected = [];
    let skippedDuplicates = 0;
    let consecutiveSkips = 0;
    let stopReason = "count";
    let pageIndex = 0;
    while (collected.length < count) {
        // 时间上限先到就收尾，避免贴近 30 分钟硬超时被杀，那时没有任何保存机会
        if (Date.now() - chunkStartedAt >= chunkBudgetMs) {
            stopReason = "time";
            console.log(`本片时间上限 ${chunkMinutes} 分钟到，结束本片，本片已采 ${collected.length} 条`);
            break;
        }
        if (consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) {
            // 分页驱动下重复是"走过已采过的位置"，不是异常。停掉本片而不是抛错：
            // 抛错会让工作流节点记一次失败，而这里其实什么都没坏，只是这一段没有新内容。
            stopReason = "duplicates";
            console.log(`连续 ${consecutiveSkips} 个视频都已经采集过，本片不再继续往下走。已新增 ${collected.length}/${count} 条`);
            break;
        }
        // 一次读取同时拿到"这一页有哪几张卡"和"第一张是哪个"，避免读两次之间页面变化
        let pageCards = [];
        await waitForNode((root) => {
            const cards = findVisibleVideoCards(root, screenHeight);
            if (cards.length === 0) {
                return undefined;
            }
            pageCards = cards;
            return cards[0];
        }, "搜索结果卡片");
        pageIndex += 1;
        const pageSize = Math.min(pageCards.length, count - collected.length);
        console.log(`第 ${pageIndex} 页：本页可见 ${pageCards.length} 张卡片，本片这一页取 ${pageSize} 条`);
        await tapNode(pageCards[0], "视频卡片的时长角标");
        await waitForDetailShareButton(screenHeight);
        await Tools.System.sleep(UI_SETTLE_MS);
        let shareDesc = (await waitForDetailShareButton(screenHeight)).contentDesc ?? "";
        for (let slot = 0; slot < pageSize; slot += 1) {
            if (Date.now() - chunkStartedAt >= chunkBudgetMs) {
                stopReason = "time";
                console.log(`本片时间上限 ${chunkMinutes} 分钟到，结束本片，本片已采 ${collected.length} 条`);
                break;
            }
            const { url, shareText, shareDesc: currentShareDesc, promoHint } = await extractShareLinkOnDetailPage(screenHeight);
            shareDesc = currentShareDesc;
            if (collected.indexOf(url) >= 0) {
                // 取到的是同一个视频，说明上一条结束时没有真的切走，先切走再重试
                console.log(`本页第 ${slot + 1} 条取到重复链接，先切换到下一个视频`);
                shareDesc = await swipeToNextVideo(shareDesc, screenHeight);
                continue;
            }
            if (storedVideoIds[videoIdOf(url)]) {
                skippedDuplicates += 1;
                consecutiveSkips += 1;
                console.log(`本页第 ${slot + 1} 条命中已采集过的视频，跳过：${url}`);
                if (slot + 1 < pageSize) {
                    shareDesc = await swipeToNextVideo(shareDesc, screenHeight);
                }
                continue;
            }
            const meta = parseShareMeta(shareText);
            const record = {
                idempotency_key: randomId(),
                keyword,
                url,
                share_text: shareText,
                title: meta.title,
                author: meta.author,
                collected_at: nowIso(),
                source: RECORD_SOURCE,
                keyword_in_title: meta.title.includes(keyword),
                promo_hint: promoHint,
            };
            // 每条立即落盘并建 pending 的 outbox 记录，中途被杀也不会丢
            await appendRecord(outbox, record);
            await saveOutbox(outbox);
            storedVideoIds[videoIdOf(url)] = true;
            consecutiveSkips = 0;
            collected.push(url);
            progress.collected_total += 1;
            progress.last_url = url;
            progress.last_video_id = videoIdOf(url);
            await saveProgress(progress);
            console.log(`已采集第 ${collected.length} 条：${url}`);
            // 让界面能看到分片进展，长任务不至于看起来像卡住
            sendIntermediateResult({
                keyword,
                chunkIndex: progress.chunk_index,
                collectedInChunk: collected.length,
                chunkTarget: count,
                collectedTotal: progress.collected_total,
                url,
            });
            if (slot + 1 < pageSize && collected.length < count) {
                shareDesc = await swipeToNextVideo(shareDesc, screenHeight);
            }
        }
        if (collected.length >= count || stopReason === "time") {
            break;
        }
        // 回列表取下一页。返回后列表位置会保持（实测角标坐标一致），所以直接下滑一屏；
        // 下滑之后卡片没有换，说明结果已经翻到底，这一片到此为止。
        const beforeBounds = pageCards.map((card) => card.bounds ?? "").join("|");
        await Tools.System.shell(`input keyevent ${KEYCODE_BACK}`);
        await Tools.System.sleep(VIDEO_SWITCH_SETTLE_MS);
        await Tools.UI.swipe(540, screenHeight - 400, 540, 700, SWIPE_DURATION_MS);
        await Tools.System.sleep(VIDEO_SWITCH_SETTLE_MS);
        const nextCards = await readVisibleCards();
        if (nextCards.length === 0 || nextCards.map((card) => card.bounds ?? "").join("|") === beforeBounds) {
            stopReason = "search_exhausted";
            console.log("搜索结果已用尽：下滑后没有出现新的卡片");
            break;
        }
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
        stopReason,
        chunkIndex: progress.chunk_index,
        collectedTotal: progress.collected_total,
        recordsFile: RECORDS_FILE,
        outboxFile: OUTBOX_FILE,
        progressFile: PROGRESS_FILE,
    };
    console.log(`本片结束（${stopReason === "time" ? "时间到" : "达到条数目标"}）：新增 ${collected.length} 条，本轮累计 ${progress.collected_total} 条`);
    return payload;
}
exports.douyin_collect_share_link = douyin_collect_share_link;
exports.douyin_collect_share_links = douyin_collect_share_links;
exports.douyin_outbox_flush = douyin_outbox_flush;
exports.douyin_outbox_status = douyin_outbox_status;
exports.douyin_upload_config_check = douyin_upload_config_check;
