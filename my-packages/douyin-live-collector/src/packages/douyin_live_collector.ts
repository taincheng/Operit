/* METADATA
{
    "name": "douyin_live_collector",
    "display_name": {
        "zh": "抖音直播采集",
        "en": "Douyin Live Collector"
    },
    "description": {
        "zh": "按关键词采集抖音「直播」标签下的直播间：进入直播间、走分享流程取短链、解析稳定的 room_id 与主播抖音号，落盘到 records.jsonl 后由 outbox 批量上报。再次采到同一个直播间时，用这次观测到的本场点赞/在线观众更新那一行，缺抖音号的老记录会补上 author_id；页面没显示的计数保持原值。",
        "en": "Collect Douyin live rooms from the Live tab for a keyword: enter each room, take its share link, resolve the stable room_id and the host's Douyin ID, append it to records.jsonl and upload through the outbox. Re-collecting a room updates that row's live like and viewer counts when observed and fills author_id on older rows that lack it; counts the page does not show keep their previous values."
    },
    "enabledByDefault": true,
    "category": "Automatic",
    "tools": [
        {
            "name": "douyin_live_collect_room_link",
            "description": {
                "zh": "取出当前打开的直播间的分享短链、真实房间ID（content_id）、主播抖音号（author_id）、主播名、本场点赞、在线观众与推广标记。流程是点底栏「更多面板」、按文案点面板里的「分享链接」、等「链接已复制成功，去粘贴分享」、返回键关面板，再用 shell 读系统剪贴板（抖音保持前台，不切 App；直播间评论框最多 50 字，口令里的链接会被截断，不能像视频那样粘贴回读），最后 GET 短链跟随 302 解析最终页里的 fromShareRoomId 与 owner.displayId（后者就是主播主页显示的抖音号）。必须在直播间页面调用，不会自己导航。需要「调试器（Shizuku）」权限档，剪贴板经 `Tools.System.shell` 读取。",
                "en": "Extract the share link, stable room id (content_id), host Douyin ID (author_id), host name, live like count, viewer count and promo flag of the live room currently open. It opens the More panel, taps Share Link by text, waits for the copied sheet, closes it, reads the system clipboard through a shell `service call` while Douyin stays in the foreground (the live comment box caps at 50 characters, so the link cannot be pasted back like videos), then GETs the short link and parses fromShareRoomId and owner.displayId from the final page; the latter is the Douyin ID shown on the host's profile. Must be called on a live room page; it does not navigate. Requires the Debugger (Shizuku) permission tier because the clipboard is read through `Tools.System.shell`."
            },
            "parameters": []
        },
        {
            "name": "douyin_live_collect_rooms",
            "description": {
                "zh": "采集抖音搜索「直播」标签下的直播间，一次运行只做一片。自动搜索关键词、把搜索页顶部标签行左滑、切到「直播」，点第一张直播卡进房，按房间逐个取链并解析 room_id 与主播抖音号（author_id）。每个新房间追加一行到 records.jsonl；已经在库里的房间用这次观测到的本场点赞/在线观众就地更新那一行，缺 author_id 的老记录会在这次补上，页面没显示的计数保持原值。按条数目标（新增 + 更新）或时间上限先到者结束，列表出现「暂时没有更多了」也会结束，结束原因写进 progress.json。每条记录带 keyword_in_title 与 promo_hint 两个标记，只标记不过滤。需要「调试器（Shizuku）」权限档，剪贴板经 `Tools.System.shell` 读取。",
                "en": "Collect live rooms from Douyin's Live tab for a keyword, one chunk per run. It searches the keyword, scrolls the tab row to Live, opens the first live card, then takes each room's link and resolves its room_id and the host's Douyin ID (author_id). A new room is appended to records.jsonl; a room already in the store has its live like and viewer counts updated in place when observed and gets author_id filled if an older row lacked it, with counts the page did not show kept as-is. The chunk ends on the item target (new plus updated), the time limit, or the list's end marker, and the reason is written to progress.json. Every record carries keyword_in_title and promo_hint markers; they are markers only. Requires the Debugger (Shizuku) permission tier because the clipboard is read through `Tools.System.shell`."
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
                    "description": { "zh": "本片最多处理多少个直播间（新增 + 更新），默认 1。更新一个与新增一个的耗时相同，所以共用一个预算", "en": "Maximum live rooms to process in this chunk (new plus updated), default 1. Updating costs the same as collecting, so both share one budget" },
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
            "name": "douyin_live_outbox_flush",
            "description": {
                "zh": "把 outbox 里所有 pending 的记录按每批 20 条上报到配置的服务器。地址与令牌在工具箱的「抖音直播采集设置」页里配置。200/202 按响应里的 accepted 与 rejected 逐条置状态，429 停止本轮，5xx 与网络错误保持 pending 并累加尝试次数，其他 4xx 置 failed。failed 不自动重发。",
                "en": "Upload all pending outbox records to the configured server in batches of 20. The base URL and token are configured on the Douyin Live Collector settings page. On 200/202 each record is set from the response's accepted and rejected lists; 429 stops this round; 5xx and network errors stay pending with an incremented attempt count; other 4xx become failed. Failed records are not retried automatically."
            },
            "parameters": []
        },
        {
            "name": "douyin_live_upload_config_check",
            "description": {
                "zh": "自检上报配置：地址是否可达、令牌是否被接受。做法是故意发一个空批次，服务端按参数校验拒收它，不会写入任何数据；而拒收之前鉴权已经做完，所以「参数校验类的 400」正好证明配置可用。",
                "en": "Self-check the upload configuration: whether the base URL is reachable and the token is accepted. It deliberately sends an empty batch which the server rejects on parameter validation, so nothing is written; since authentication happens before validation, a parameter-validation 400 is exactly the proof that the configuration works."
            },
            "parameters": []
        },
        {
            "name": "douyin_live_outbox_status",
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

// deep link 直达搜索页。https 分享链接会弹选择器，所以必须走 scheme 并显式指定包名。
const DOUYIN_SEARCH_SCHEME = "snssdk1128://search";

// 搜索页与直播列表都要加载，抖音是单列自动播放信息流，固定等待比条件等待更早能用。
const SEARCH_LOAD_WAIT_MS = 6000;
const SEARCH_PAGE_TIMEOUT_MS = 30000;
const UI_SETTLE_MS = 800;
const STEP_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 500;
// 单次读页面失败的重试次数。宿主自己的重试只隔 300ms，撑不过页面转场。
const MAX_PAGE_READ_ATTEMPTS = 3;
const MAX_READ_BACKOFF_MS = 3000;
const FOREGROUND_WAIT_TIMEOUT_MS = 15000;

// 从列表点进直播间的等待上限。直播间会先显示封面再出互动条，10 秒留足。
const ROOM_ENTRY_TIMEOUT_MS = 10000;
// 上滑一张卡后等房间标记：第二张卡首次进房比列表首卡慢，10 秒会误判成「没进房」。
const ADVANCE_MARKER_TIMEOUT_MS = 20000;
// 点「分享链接」到「链接已复制成功，去粘贴分享」面板出现的等待上限。
const SHARE_SHEET_TIMEOUT_MS = 8000;

const SWIPE_DURATION_MS = 400;
// 直播间切换/返回列表后的稳定等待。抖音的页面转场有动画，太早读树会读到上一页。
const VIDEO_SWITCH_SETTLE_MS = 2500;
// 列表上滑一张卡之后的稳定等待。
const LIST_SETTLE_MS = 1500;

// 应用窗口底部会被导航栏占掉，落在那里的点击不会传给应用。
const APP_BOTTOM_INSET = 150;
// 搜索页标签行的 y 上限，用来把标签行里的「直播」和正文里的同名文字区分开。
// 直播卡的判定也必须在这条线以下：中心点落到标签行会点到搜索区。
const TAB_ROW_MAX_Y = 400;
const TAB_ROW_SWIPE_Y = 285;

// 直播卡的判定按屏幕比例，不写死像素。
// 2026-11-02 实测：同一台 1080x2400 上抖音把封面节点从 [45,430][1035,1480]（990 宽）
// 换成 [46,606][1035,1925]（989 宽）。差这 1px 就足以让原来的 `width < 990` 把
// 唯一一张可见卡排除掉，结果是一张卡都点不到、连滑三次后报错。
// 0.85 屏宽（918）容得下这种排版漂移，2% 屏宽的左边距把从 x=0 开始的整屏容器排除。
// 可见高度门槛取 0.3 屏高（720）：团购横幅只有 480~525；卡片被上下边缘裁掉时，
// 与内容区的交集仍然远超这条线（实测最小的一例是 1040）。
const CARD_MIN_WIDTH_RATIO = 0.85;
const CARD_MIN_VISIBLE_RATIO = 0.3;
const CARD_MIN_LEFT_RATIO = 0.02;

const SEARCH_PAGE_MARKER = "综合";
const LIVE_TAB_TEXT = "直播";

// 「直播」初始被右边缘的图标压住（实测 [877,258][908,320]），左滑之后中心会落到 205 左右。
// 中心点大于这个值时不点，先左滑，避免点到单双列切换图标。
const LIVE_TAB_MAX_TAP_X = 850;

// 直播结果列表底部的明确结束标记。实测出现过的原文就是这五个字。
const LIVE_LIST_END_TEXT = "暂时没有更多了";

// 直播间在取链途中结束时的页面标记（「直播已结束 / 1.7万人看过 / 去直播频道…」）。
// 2026-11-02 实测：复制口令成功后房间刚好结束，按返回键关面板时房间标记再也不会出现。
// 这时口令已经在剪贴板里、房间信息也在开面板之前读过了，取链本身仍然成立，
// 不能因为「等不到房间标记」把整片采集打断。
const ROOM_ENDED_TEXT = "直播已结束";

// 直播间底栏最右是「更多面板 按钮」，分享链接在里面。
const SHARE_MORE_DESC_PREFIX = "更多面板";
const SHARE_LINK_ITEM_TEXT = "分享链接";
// 点中「分享链接」后抖音会复制口令并弹出这个面板；它是复制成功的唯一可靠判据。
// 点错坐标只会打开「分享给好友」面板，不会复制，也不会出现这句话。
const COPIED_SHEET_TEXT = "链接已复制成功，去粘贴分享";

// 直播间标记与两个计数。互动条按钮的 content-desc 形如：
//   德民信口腔63本场点赞 / 13在线观众
// 主播名里可能本身带数字，所以计数必须从末尾匹配，不能从开头切。
const ROOM_LIKE_SUFFIX = "本场点赞";
const ROOM_VIEWER_SUFFIX = "在线观众";

// 直播间分享口令形如：
//   2- #在抖音，记录美好生活#【主播名】正在直播，来和我一起支持Ta吧。… https://v.douyin.com/xxxx/ …
const SHARE_URL_PATTERN = /https?:\/\/v\.douyin\.com\/[^\s]+/;
const SHARE_AUTHOR_PATTERN = /【(.+?)】/;

// 短链跟随 302 后的最终页里有 fromShareRoomId="<room_id>"。两个样本页都有；
// "roomIdStr" 只在其中一个样本页出现，不能单独依赖。
const LIVE_ROOM_ID_PATTERN = /fromShareRoomId="(\d+)"/;

// 主播抖音号。最终页把房间 JSON 转义后塞进脚本字符串里，owner 对象形如：
//   \"owner\":{\"id\":1176905128877531,\"shortId\":70296714883,\"nickname\":\"牙贝恩口腔连锁\",…,
//            \"displayId\":\"70296714883\",\"withCommercePermission\":false,…}
// displayId 就是主播主页「抖音号：」后面那一串（2026-10-30 真机：主页 70296714883 与页面一致）。
// 用紧跟其后的 withCommercePermission 做锚点：这个键只出现在 owner 对象里；页面里别的用户
// 也可能有 displayId（空串或他人），直接取第一个会取错人。解析不到就抛错，不猜。
const LIVE_AUTHOR_ID_PATTERN = /\\"displayId\\":\\"([^"\\]*)\\",\\"withCommercePermission\\":/;

// 分享页对非浏览器 UA 会返回不同的内容，用移动端 Safari 的 UA 实测能拿到含 fromShareRoomId 的整页。
const SHARE_PAGE_USER_AGENT =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const CONTENT_RESOLVE_CONNECT_TIMEOUT_MS = 10000;
const CONTENT_RESOLVE_READ_TIMEOUT_MS = 20000;

// 列表上滑一张卡的距离。都是 1080x2400 上的实测值；
// 换分辨率需要重量，量法写在 my-packages/README.md 的直播间小节。
const LIST_SWIPE_FROM_Y = 2000;
const LIST_SWIPE_TO_Y = 1000;

// 标签行最多左滑几次；分享面板项最多往上带几次；进出房间最多重试几次。
const MAX_TAB_SWIPE_ATTEMPTS = 3;
const MAX_SHEET_LIFT_ATTEMPTS = 3;
const MAX_ENTER_CARD_ATTEMPTS = 3;
const MAX_ADVANCE_ATTEMPTS = 3;
const MAX_LEAVE_ROOM_ATTEMPTS = 3;

// 关掉分享面板与评论面板都用返回键。走无障碍的全局动作（GLOBAL_ACTION_BACK）。
const BACK_KEY_CODE = "KEYCODE_BACK";

// 直播间页面上的推广/商业标记词。命中就把 promo_hint 置真，交由服务端决定是否过滤。
// 注意这是"标记"不是"判据"：直播间聊天区出现这些词也会命中，所以不据此丢弃。
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
    "购物袋",
    "小房子",
    "直播中",
];

const DEFAULT_COLLECT_COUNT = 1;
// 单片时间上限。脚本硬超时是 30 分钟，这里留出安全边际，默认 18 分钟，最多允许 20 分钟。
const DEFAULT_CHUNK_MINUTES = 18;
const MAX_CHUNK_MINUTES = 20;

type UiNode = ReturnType<typeof UINode.fromPageInfo>;

// 屏幕尺寸，单位与无障碍节点的 bounds 相同（整屏坐标）。
type ScreenSize = {
    width: number;
    height: number;
};

type RoomInfo = {
    host: string;
    likeCount: number | null;
    viewerCount: number | null;
    interactionText: string;
};

type ExtractedRoom = {
    url: string;
    shareText: string;
    contentId: string;
    // 主播的抖音号（平台展示 ID），来自分享页 owner.displayId。
    authorId: string;
    author: string;
    promoHint: boolean;
    info: RoomInfo;
};

/**
 * 读一次当前页面。
 *
 * 宿主的 getPageInfo 内部只做三次 300ms 的重试，页面切换/弹窗动画期间会连续失败，
 * 抛「Failed to retrieve UI data via accessibility service」。这个失败是瞬时的：
 * 2026-11-02 实测，紧接下一次读就能拿到整棵树。单点失败不该终止一整片采集
 * （原来的 readRoot 一次失败就把整片打断），所以这里按次数重试，退避 0.5s/1s。
 * 重试用尽仍然失败才抛错，错误原样上抛，不吞。
 */
async function readRoot(): Promise<UiNode> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_PAGE_READ_ATTEMPTS; attempt += 1) {
        try {
            return UINode.fromPageInfo(await Tools.UI.getPageInfo());
        } catch (error) {
            lastError = error;
            console.log(`读页面失败第 ${attempt} 次：${errorMessage(error)}`);
            if (attempt < MAX_PAGE_READ_ATTEMPTS) {
                await Tools.System.sleep(POLL_INTERVAL_MS * attempt);
            }
        }
    }
    throw lastError;
}

// 读取失败时用于拼错误信息。catch 到的东西本身是未知的，这里只做一次收窄。
function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

/** 超时失败时把当前页面概况写进错误里，便于定位是哪一步的现场不对。 */
async function describeCurrentPage(): Promise<string> {
    const page = await Tools.UI.getPageInfo();
    const root = UINode.fromPageInfo(page);
    const texts = root.allTexts(true, true).slice(0, 10);
    const nodes = root.findAll(() => true, true);
    // activityName 实际是当前窗口的根类名（抖音直播间会给
    // com.lynx.tasm.behavior.KeyboardMonitor），只作现场线索，不能拿来做判断。
    return `包名=${page.packageName} 窗口类=${page.activityName} 节点数=${nodes.length} 文本=[${texts.join(" | ")}]`;
}

/**
 * 轮询到条件满足为止。超时直接抛错。
 *
 * 读页面本身会偶发失败：宿主读无障碍树时三次重试只隔 300ms，页面动画期间会连续超时。
 * 在「等条件出现」这个语义下，这类失败等同于「还没就绪」，继续轮询到超时为止；
 * 超时信息里带上最后一次读取失败的原因，避免掩盖真实问题。
 */
async function waitForNode(
    match: (root: UiNode) => UiNode | undefined,
    what: string,
    timeoutMs: number = STEP_TIMEOUT_MS
): Promise<UiNode> {
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
        } catch (error) {
            lastReadError = errorMessage(error);
            consecutiveReadFailures += 1;
            console.log(
                `读页面失败第 ${consecutiveReadFailures} 次，继续等待「${what}」：${lastReadError}`
            );
            await Tools.System.sleep(
                Math.min(POLL_INTERVAL_MS * consecutiveReadFailures, MAX_READ_BACKOFF_MS)
            );
            continue;
        }
        await Tools.System.sleep(POLL_INTERVAL_MS);
    }

    const readErrorNote = lastReadError ? `最后一次读页面失败：${lastReadError}；` : "";
    let scene = "现场读取失败";
    try {
        scene = await describeCurrentPage();
    } catch (error) {
        scene = `现场读取失败：${errorMessage(error)}`;
    }
    throw new Error(`等待「${what}」超时，${timeoutMs}ms 内没有出现。${readErrorNote}${scene}`);
}

/**
 * 等待条件成立，超时返回 undefined 而不抛错。
 * 只用在「进没进房」「有没有换到下一间」这类需要按次数重试、并且要把结果继续往下走的判定上；
 * 真正的页面就绪判定仍然用 waitForNode，超时就抛。
 */
async function tryWaitForNode(
    match: (root: UiNode) => UiNode | undefined,
    timeoutMs: number
): Promise<UiNode | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const root = await readRoot();
            const found = match(root);
            if (found) {
                return found;
            }
        } catch (error) {
            console.log(`读页面失败，继续重试：${errorMessage(error)}`);
        }
        await Tools.System.sleep(POLL_INTERVAL_MS);
    }
    return undefined;
}

async function tapNode(node: UiNode, what: string): Promise<void> {
    const point = node.centerPoint;
    if (!point) {
        throw new Error(`节点「${what}」没有可用坐标`);
    }
    // 点击前把目标节点的身份写进日志，坐标点错时可以直接从日志看出点到了什么
    console.log(
        `点击「${what}」坐标=(${point.x},${point.y}) class=${node.className ?? ""} desc=${node.contentDesc ?? ""} text=${(node.text ?? "").slice(0, 16)} bounds=${node.bounds ?? ""}`
    );
    await Tools.UI.tap(point.x, point.y);
}

/**
 * 节点边界解析。被滚出屏幕的节点会给出反向边界，例如 [56,354][723,70]，
 * 这里统一判成不可用，避免把邻居节点当成候选。
 */
function parseNodeBounds(node: UiNode): { x1: number; y1: number; x2: number; y2: number } | undefined {
    const matched = (node.bounds ?? "").match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
    if (!matched) {
        return undefined;
    }
    const x1 = Number(matched[1]);
    const y1 = Number(matched[2]);
    const x2 = Number(matched[3]);
    const y2 = Number(matched[4]);
    if (x2 <= x1 || y2 <= y1) {
        return undefined;
    }
    return { x1, y1, x2, y2 };
}

/**
 * 判断节点是否在屏幕内、且没有被导航栏挡住。
 * 不设顶部搜索栏下限：直播间的「本场点赞」「更多面板」分别在屏幕最上/最下，
 * 加下限会把它们直接否掉；需要避开搜索区的调用方自己再判 y 下限。
 */
function isNodeOnScreen(node: UiNode, screen: ScreenSize): boolean {
    const bounds = parseNodeBounds(node);
    if (!bounds) {
        return false;
    }
    const point = node.centerPoint;
    if (!point) {
        return false;
    }
    return point.y > 0 && point.y < screen.height - APP_BOTTOM_INSET;
}

/**
 * 屏幕尺寸，取自无障碍根节点的 bounds。
 *
 * 不能用 Tools.System.getDeviceInfo() 的 screenResolution：它来自宿主进程的
 * displayMetrics.heightPixels，跟着宿主窗口当时的 insets 走（这台机器上取到过
 * 1080x2163，即扣掉状态栏 104 与导航栏 133；也取到过 1080x2400）；无障碍节点的
 * bounds 却始终是整屏坐标 1080x2400。取值偏小时会把直播间底栏「更多面板 按钮」
 * （[939,2137][1046,2244]，中心 y≈2190）判成屏幕外，取链在第一步就失败。
 * 根节点与所有被比较的节点同属一套坐标，用它才自洽。
 */
async function readScreenSize(): Promise<ScreenSize> {
    const root = await readRoot();
    const bounds = parseNodeBounds(root);
    if (!bounds) {
        throw new Error(`无法从无障碍根节点读取屏幕尺寸：bounds=${root.bounds ?? "(无)"}`);
    }
    return { width: bounds.x2 - bounds.x1, height: bounds.y2 - bounds.y1 };
}

/**
 * 确保抖音在前台。
 *
 * 无障碍服务读的是当前活动窗口，从 Operit 界面调用本工具时前台是 Operit，
 * 不切换就只能读到 Operit 自己的节点树。
 */
async function ensureDouyinForeground(): Promise<void> {
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
        } catch (error) {
            lastReadError = errorMessage(error);
            consecutiveReadFailures += 1;
            console.log(
                `读前台应用失败第 ${consecutiveReadFailures} 次，继续等待抖音就绪：${lastReadError}`
            );
            await Tools.System.sleep(
                Math.min(POLL_INTERVAL_MS * consecutiveReadFailures, MAX_READ_BACKOFF_MS)
            );
            continue;
        }
        await Tools.System.sleep(POLL_INTERVAL_MS);
    }

    const readNote = lastReadError ? `最后一次读页面失败：${lastReadError}；` : "";
    throw new Error(`等待抖音切到前台超时，当前前台是 ${lastPackage || "未知"}。${readNote}`);
}

/**
 * 等到指定包名在前台。用于“把抖音拉到前台开始采集”这一步：
 * 系统要等目标 Activity 真正 resumed 之后剪贴板才可读，读到前台就立刻读会拿到空串。
 */
async function waitForForeground(packageName: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastPackage = "";
    let lastReadError = "";
    while (Date.now() < deadline) {
        try {
            const current = await Tools.UI.getPageInfo();
            lastPackage = current.packageName;
            if (current.packageName === packageName) {
                return;
            }
        } catch (error) {
            lastReadError = errorMessage(error);
            console.log(`读前台应用失败，继续等待 ${packageName} 就绪：${lastReadError}`);
        }
        await Tools.System.sleep(POLL_INTERVAL_MS);
    }
    const readNote = lastReadError ? `最后一次读页面失败：${lastReadError}；` : "";
    throw new Error(`等待前台切到 ${packageName} 超时，当前是 ${lastPackage || "未知"}。${readNote}`);
}

/**
 * service call 的输出是 Parcel 的 hexdump，每行形如：
 *   0x00000000: 00000001 00000000 00000000 00000000
 * 每个 8 位十六进制是 32 位字的十六进制表示，内存是小端，拼回字节流要按小端拆。
 * 解析方式与开发期探针 tools/.../probes/decode_clipboard.py 保持一致。
 */
function parseServiceCallBytes(output: string): number[] {
    const bytes: number[] = [];
    for (const line of output.split("\n")) {
        const matched = line.match(/^\s*0x[0-9a-f]+:\s+((?:[0-9a-f]{8}\s+){1,4})/i);
        if (!matched) {
            continue;
        }
        for (const word of matched[1].trim().split(/\s+/)) {
            const value = parseInt(word, 16);
            bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
        }
    }
    return bytes;
}

/** 剪贴板 Parcel 里的文本是 UTF-8（2026-10-28 真机探针确认），这里按 UTF-8 还原。 */
function decodeUtf8(bytes: number[]): string {
    let text = "";
    for (let index = 0; index < bytes.length; ) {
        const first = bytes[index];
        if (first < 0x80) {
            text += String.fromCharCode(first);
            index += 1;
        } else if (first >= 0xc0 && first < 0xe0 && index + 1 < bytes.length) {
            text += String.fromCharCode(((first & 0x1f) << 6) | (bytes[index + 1] & 0x3f));
            index += 2;
        } else if (first >= 0xe0 && first < 0xf0 && index + 2 < bytes.length) {
            text += String.fromCharCode(
                ((first & 0x0f) << 12) | ((bytes[index + 1] & 0x3f) << 6) | (bytes[index + 2] & 0x3f)
            );
            index += 3;
        } else if (first >= 0xf0 && index + 3 < bytes.length) {
            const codePoint =
                ((first & 0x07) << 18) |
                ((bytes[index + 1] & 0x3f) << 12) |
                ((bytes[index + 2] & 0x3f) << 6) |
                (bytes[index + 3] & 0x3f);
            text += String.fromCodePoint(codePoint);
            index += 4;
        } else {
            index += 1;
        }
    }
    return text;
}

/**
 * 从 Parcel 字节流里取分享口令。
 *
 * 只认 ASCII 短链作为锚点，再向两侧扩到不可打印字节为止：Parcel 里口令前后会有
 * 长度前缀与其它字段，直接全文解码会把它们一起带出来。短链本身是 ASCII，不受影响。
 */
function readShareTextFromParcelBytes(bytes: number[]): string {
    const latin = String.fromCharCode(...bytes);
    const urlMatched = latin.match(SHARE_URL_PATTERN);
    if (!urlMatched || urlMatched.index === undefined) {
        throw new Error("剪贴板里没有抖音分享短链，复制那一步可能没生效。");
    }
    let start = urlMatched.index;
    let end = start + urlMatched[0].length;
    while (start > 0 && bytes[start - 1] >= 0x20 && bytes[start - 1] !== 0x7f) {
        start -= 1;
    }
    while (end < bytes.length && bytes[end] >= 0x20 && bytes[end] !== 0x7f) {
        end += 1;
    }
    return decodeUtf8(bytes.slice(start, end)).trim();
}

/**
 * 用 shell 读系统剪贴板，抖音保持前台，直播间不会因为切 App 而丢。
 *
 * Android 10 起普通应用只有获得焦点时才能读剪贴板；抖音在前台时 Operit 自己读是空串。
 * 但 shell（UID 2000，Shizuku/调试器档就是它）不受这条限制：`service call clipboard 4`
 * 在抖音前台也能拿到完整口令（2026-10-28 真机实测）。所以这里不再把宿主切到前台。
 */
async function readClipboardViaShell(): Promise<string> {
    const result = await Tools.System.shell(
        "service call clipboard 4 s16 com.android.shell s16 null i32 0 i32 0"
    );
    if (result.exitCode !== 0) {
        throw new Error(
            `用 shell 读取剪贴板失败：退出码 ${result.exitCode}，输出：${result.output.slice(0, 200)}`
        );
    }
    return readShareTextFromParcelBytes(parseServiceCallBytes(result.output));
}

/**
 * 一次读页面取出主播名、本场点赞与在线观众。
 *
 * 房间标记是 content-desc 以「本场点赞」结尾的 Button。主播名里可能带数字，
 * 所以计数从末尾匹配：`^(.*?)(\d+(?:\.\d+)?)(万?)本场点赞$` 里的第一组会因为非贪婪
 * 在主播名的第一个数字处就停下，必须改成从右往左取最后一个数字串。
 */
function readRoomInfo(root: UiNode, screen: ScreenSize): RoomInfo {
    const marker = findRoomMarker(root, screen);
    if (!marker) {
        throw new Error(`当前页面没有直播间标记（content-desc 以「${ROOM_LIKE_SUFFIX}」结尾的按钮）`);
    }
    const markerDesc = (marker.contentDesc ?? "").trim();
    const likeMatched = markerDesc.match(/(\d+(?:\.\d+)?)(万?)本场点赞$/);
    if (!likeMatched) {
        throw new Error(`直播间的本场点赞文案结构不认识：${markerDesc}`);
    }
    const host = markerDesc.slice(0, likeMatched.index).trim();
    if (!host) {
        throw new Error(`直播间的本场点赞文案里没有主播名：${markerDesc}`);
    }
    const likeCount = parseCount(likeMatched[1], likeMatched[2]);

    const viewerNode = root.find((node: UiNode) => {
        const desc = (node.contentDesc ?? "").trim();
        return /^\d+(?:\.\d+)?万?在线观众$/.test(desc) && isNodeOnScreen(node, screen);
    }, true);
    let viewerCount: number | null = null;
    if (viewerNode) {
        const viewerMatched = (viewerNode.contentDesc ?? "").trim().match(/^(\d+(?:\.\d+)?)(万?)在线观众$/);
        if (!viewerMatched) {
            throw new Error(`在线观众文案结构不认识：${viewerNode.contentDesc ?? ""}`);
        }
        viewerCount = parseCount(viewerMatched[1], viewerMatched[2]);
    }

    const rawTexts = [markerDesc];
    if (viewerNode) {
        rawTexts.push((viewerNode.contentDesc ?? "").trim());
    }
    return {
        host,
        likeCount,
        viewerCount,
        interactionText: rawTexts.join("|"),
    };
}

function parseCount(numberText: string, unit: string): number {
    const value = Number(numberText);
    return Math.round(unit === "万" ? value * 10000 : value);
}

function findRoomMarker(root: UiNode, screen: ScreenSize): UiNode | undefined {
    return root.find((node: UiNode) => {
        const desc = (node.contentDesc ?? "").trim();
        return desc.endsWith(ROOM_LIKE_SUFFIX) && isNodeOnScreen(node, screen);
    }, true);
}

function findShareMoreButton(root: UiNode, screen: ScreenSize): UiNode | undefined {
    return root.find((node: UiNode) => {
        const desc = (node.contentDesc ?? "").trim();
        return desc.startsWith(SHARE_MORE_DESC_PREFIX) && isNodeOnScreen(node, screen);
    }, true);
}

function findSearchTab(root: UiNode, label: string): UiNode | undefined {
    return root.find((node: UiNode) => {
        if ((node.text ?? "") !== label) {
            return false;
        }
        const point = node.centerPoint;
        return point !== undefined && point.y < TAB_ROW_MAX_Y;
    }, true);
}

function findListEnd(root: UiNode, screen: ScreenSize): UiNode | undefined {
    return root.find((node: UiNode) => {
        return (node.text ?? "").includes(LIVE_LIST_END_TEXT) && isNodeOnScreen(node, screen);
    }, true);
}

/** 详情页/直播间上所有文本里有没有推广标记。命中只写进记录，不用来决定采不采。 */
function hasPromoHint(root: UiNode): boolean {
    const texts = root.allTexts(true, true);
    return texts.some((text) => PROMO_HINT_TERMS.some((term) => text.includes(term)));
}

/**
 * 把搜索页顶部标签行左滑，点「直播」。
 *
 * 「直播」初始节点存在但被右边缘图标裁掉（实测 [877,258][908,320]），
 * 直接点它的中心会落到单双列切换图标附近；左滑一次后中心落到 205 左右。
 * 所以判定条件是「中心 x ≤ 850 且完整在屏幕内」，不满足就先滑。
 */
async function switchToLiveTab(screen: ScreenSize): Promise<void> {
    for (let attempt = 0; attempt <= MAX_TAB_SWIPE_ATTEMPTS; attempt += 1) {
        const root = await readRoot();
        const tab = findSearchTab(root, LIVE_TAB_TEXT);
        const point = tab ? tab.centerPoint : undefined;
        if (
            tab &&
            point &&
            point.x <= LIVE_TAB_MAX_TAP_X &&
            isNodeOnScreen(tab, screen)
        ) {
            // 标签行刚滑动完还有惯性，第一下点击有时只被用来止住滚动，不触发选中。
            // 2026-10-28 实测：点 (760,289) 后页面仍停在「综合」，内容区一直空着，
            // 结果把综合页残留的「直播中」节点当成直播卡，连点三次都没进房。
            // 这里点两次，中间重新读一次节点，确保标签真的被选中。
            await Tools.System.sleep(UI_SETTLE_MS);
            await tapNode(tab, `「${LIVE_TAB_TEXT}」标签（第一次）`);
            await Tools.System.sleep(1500);
            const again = findSearchTab(await readRoot(), LIVE_TAB_TEXT);
            const againPoint = again ? again.centerPoint : undefined;
            if (
                again &&
                againPoint &&
                againPoint.x <= LIVE_TAB_MAX_TAP_X &&
                isNodeOnScreen(again, screen)
            ) {
                await tapNode(again, `「${LIVE_TAB_TEXT}」标签（第二次）`);
            }
            await Tools.System.sleep(SEARCH_LOAD_WAIT_MS);
            return;
        }
        if (attempt === MAX_TAB_SWIPE_ATTEMPTS) {
            break;
        }
        console.log(`第 ${attempt + 1} 次左滑标签行，找可点的「${LIVE_TAB_TEXT}」标签`);
        await Tools.UI.swipe(850, TAB_ROW_SWIPE_Y, 260, TAB_ROW_SWIPE_Y, SWIPE_DURATION_MS);
        await Tools.System.sleep(UI_SETTLE_MS);
    }
    throw new Error(
        `标签行左滑 ${MAX_TAB_SWIPE_ATTEMPTS} 次后仍没找到可点的「${LIVE_TAB_TEXT}」标签`
    );
}

/**
 * 打开搜索并切到直播标签。
 */
async function openLiveSearch(keyword: string): Promise<ScreenSize> {
    await ensureDouyinForeground();
    await Tools.System.intent({
        type: "activity",
        action: "android.intent.action.VIEW",
        uri: `${DOUYIN_SEARCH_SCHEME}?keyword=${encodeURIComponent(keyword)}`,
        package: DOUYIN_PACKAGE,
    });
    await Tools.System.sleep(SEARCH_LOAD_WAIT_MS);
    await waitForNode(
        (root) => root.findByText(SEARCH_PAGE_MARKER, { exact: false }),
        "搜索结果页",
        SEARCH_PAGE_TIMEOUT_MS
    );
    const screen = await readScreenSize();
    await switchToLiveTab(screen);
    return screen;
}

/**
 * 找一张直播卡的点击点。
 *
 * 直播列表的「直播中」角标不在无障碍节点树里（2026-10-28 确认；2026-11-02 的新排版
 * 里有时又出现，不能当唯一判据）。只能按布局找卡片：封面横向几乎占满屏幕。
 *
 * 不能要求整张封面都在屏幕里。2026-11-02 实测：从直播间返回后上滑一屏，下一张卡的
 * 封面会停在 y=354（紧贴标签行下沿）或被底部裁掉；旧规则「y1 ≥ 400 且 y2 ≤ 屏高-150」
 * 把这两类卡全部排除，于是连滑三次后误判成「列表到底」，一片只采到一间。
 * 现在按「与内容区的交集」算：交不够高就不是一张可点的卡，够高就点交集中心。
 */
function findLiveCardTapPoint(
    root: UiNode,
    screen: ScreenSize
): { x: number; y: number } | undefined {
    const minWidth = Math.floor(screen.width * CARD_MIN_WIDTH_RATIO);
    const minLeft = Math.floor(screen.width * CARD_MIN_LEFT_RATIO);
    const minVisibleHeight = Math.floor(screen.height * CARD_MIN_VISIBLE_RATIO);
    // 标签行下沿以上点到的是搜索区，底部 150px 是导航栏，点击都不会传给卡片。
    const contentTop = TAB_ROW_MAX_Y;
    const contentBottom = screen.height - APP_BOTTOM_INSET;
    let best: { x: number; y: number; visibleHeight: number } | undefined;
    const seen = new Set<string>();
    for (const node of root.findAll(() => true, true)) {
        const bounds = parseNodeBounds(node);
        if (!bounds) {
            continue;
        }
        if (bounds.x2 - bounds.x1 < minWidth) {
            continue;
        }
        // 从 x=0 开始铺满整屏的容器不是卡片（列表、根、ViewPager）。
        if (bounds.x1 < minLeft) {
            continue;
        }
        const visibleTop = Math.max(bounds.y1, contentTop);
        const visibleBottom = Math.min(bounds.y2, contentBottom);
        const visibleHeight = visibleBottom - visibleTop;
        if (visibleHeight < minVisibleHeight) {
            continue;
        }
        const key = `${bounds.x1},${bounds.y1},${bounds.x2},${bounds.y2}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        if (best === undefined || visibleHeight > best.visibleHeight) {
            best = {
                x: Math.floor((bounds.x1 + bounds.x2) / 2),
                y: Math.floor(visibleTop + visibleHeight / 2),
                visibleHeight,
            };
        }
    }
    return best === undefined ? undefined : { x: best.x, y: best.y };
}

/**
 * 从直播列表点首张卡进房。
 *
 * 直播列表的预览在持续播放，外部 uiautomator 读不到（could not get idle state），
 * 所以按布局找封面、点它的中心，再用「直播间标记」确认真的进去了；没进去就重试。
 * 列表为空时页面会显示「暂时没有更多了」；若这个标记出现在列表顶部（y < 700），
 * 说明一张卡都没有，返回 false 由调用方按 search_exhausted 收片。
 */
async function enterFirstLiveCard(screen: ScreenSize): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_ENTER_CARD_ATTEMPTS; attempt += 1) {
        const root = await readRoot();
        if (findRoomMarker(root, screen)) {
            return true;
        }
        const tapPoint = findLiveCardTapPoint(root, screen);
        if (!tapPoint) {
            if (findListEnd(root, screen)) {
                console.log(`直播列表为空：页面顶部显示「${LIVE_LIST_END_TEXT}」`);
                return false;
            }
            console.log(`第 ${attempt} 次没有找到可点的直播卡，上滑一屏再看`);
            await Tools.UI.swipe(540, LIST_SWIPE_FROM_Y, 540, LIST_SWIPE_TO_Y, SWIPE_DURATION_MS);
            await Tools.System.sleep(LIST_SETTLE_MS);
            continue;
        }
        console.log(`第 ${attempt} 次点击可视直播卡 (${tapPoint.x},${tapPoint.y})`);
        await Tools.UI.tap(tapPoint.x, tapPoint.y);
        const marker = await tryWaitForNode(
            (current) => findRoomMarker(current, screen),
            ROOM_ENTRY_TIMEOUT_MS
        );
        if (marker) {
            return true;
        }
        // 点到团购广告会打开商品页/详情页。这里不能看 page.activityName：
        // 抖音现在上报的是窗口根类名（搜索页实测 androidx.compose.ui.platform.ComposeView，
        // 直播间实测 com.lynx.tasm.behavior.KeyboardMonitor），不是 Activity 名。
        // 用「搜索标签行还在不在」判断是否还停在直播列表：不在列表就按返回键回去，
        // 再上滑换一张，别在原地死点同一个广告。
        const current = await readRoot();
        if (!findSearchTab(current, LIVE_TAB_TEXT)) {
            console.log("点击卡片后没进直播间，按返回键回列表");
            await Tools.UI.pressKey(BACK_KEY_CODE);
            await Tools.System.sleep(UI_SETTLE_MS);
        }
        await Tools.UI.swipe(540, LIST_SWIPE_FROM_Y, 540, LIST_SWIPE_TO_Y, SWIPE_DURATION_MS);
        await Tools.System.sleep(LIST_SETTLE_MS);
    }

    const root = await readRoot();
    const end = findListEnd(root, screen);
    const endY = end ? end.centerPoint?.y ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    if (end && endY < 700) {
        console.log(`直播列表为空：页面顶部显示「${LIVE_LIST_END_TEXT}」`);
        return false;
    }
    throw new Error(
        `连续 ${MAX_ENTER_CARD_ATTEMPTS} 次点击可视直播卡都没有进入直播间。${await describeCurrentPage()}`
    );
}

/**
 * 点分享面板里的「分享链接」。
 *
 * 面板高度会随联系人行/功能项变化，实测同一台设备上这一项出现过 [445,1799]、[231,1799]、
 * [321,1390] 三种位置，所以只能按文案定位；落在导航栏下面时把面板内容往上带。
 */
async function tapShareLinkItem(screen: ScreenSize): Promise<void> {
    const finder = (root: UiNode) => root.findByText(SHARE_LINK_ITEM_TEXT, { exact: true });

    for (let attempt = 0; attempt <= MAX_SHEET_LIFT_ATTEMPTS; attempt += 1) {
        const item = await waitForNode(finder, SHARE_LINK_ITEM_TEXT);
        if (isNodeOnScreen(item, screen)) {
            await tapNode(item, SHARE_LINK_ITEM_TEXT);
            return;
        }
        console.log(
            `「${SHARE_LINK_ITEM_TEXT}」落在可视区外（${item.bounds ?? "(无边界)"}），把面板内容往上带`
        );
        await Tools.UI.swipe(540, 2150, 540, 1850, SWIPE_DURATION_MS);
        await Tools.System.sleep(UI_SETTLE_MS);
    }

    throw new Error(`「${SHARE_LINK_ITEM_TEXT}」始终处于可视区外，无法点击`);
}

/**
 * 从分享短链解析出直播间身份与主播抖音号。
 *
 * 短码不能当身份：同一个直播间每次分享都会生成新的 v.douyin.com 短码
 * （2026-10-27 实测同一房间两次分享得到 0_wFCWMBhU4 与 LRiifJrGLeg）。
 * 短链 302 到 webcast.amemv.com/douyin/webcast/reflow/<room_id>，最终页里还有
 * fromShareRoomId="<room_id>"，两个样本页都有；同一页里的 owner.displayId 就是主播抖音号。
 *
 * 解析失败直接抛错，绝不退回用短码当身份、也不拿主播名当抖音号：
 * 退回去等于把重复行继续写进库，或者把两个不同账号写成一个。
 */
type LiveRoomIdentity = {
    roomId: string;
    authorId: string;
};

async function resolveLiveRoomIdentity(shareUrl: string): Promise<LiveRoomIdentity> {
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
        throw new Error(`解析直播间身份失败：${shareUrl} 返回 HTTP ${response.statusCode}`);
    }

    const roomMatched = response.content.match(LIVE_ROOM_ID_PATTERN);
    if (!roomMatched) {
        throw new Error(
            `解析直播间身份失败：${shareUrl} 的最终页里没有 fromShareRoomId（页面可能改版或被风控）`
        );
    }

    const authorMatched = response.content.match(LIVE_AUTHOR_ID_PATTERN);
    if (!authorMatched || !authorMatched[1]) {
        throw new Error(
            `解析主播抖音号失败：${shareUrl} 的最终页 owner 里没有非空 displayId（页面可能改版或被风控）`
        );
    }

    return { roomId: roomMatched[1], authorId: authorMatched[1] };
}

/**
 * 在当前直播间里走一次完整分享流程，取回短链、身份与房间信息。
 * 单条工具与批量采集共用这一段，避免两处逻辑各自漂移。
 */
async function extractRoomShareLink(screen: ScreenSize): Promise<ExtractedRoom> {
    const root = await readRoot();
    // 房间信息与推广标记在点开面板之前读：面板是模态窗口，打开后下层节点读不到。
    const info = readRoomInfo(root, screen);
    const promoHint = hasPromoHint(root);

    let moreButton: UiNode;
    try {
        moreButton = await waitForNode(
            (current) => findShareMoreButton(current, screen),
            "直播间的更多面板按钮"
        );
    } catch (error) {
        // 现场诊断：把含「更多」「面板」的节点与底栏候选全部打出来，确认是节点缺失、
        // 还是被屏幕过滤掉了；不改变行为，只补日志后原样抛出。
        const page = await Tools.UI.getPageInfo();
        const diagnoseRoot = UINode.fromPageInfo(page);
        const candidates = diagnoseRoot
            .findAll((node: UiNode) => {
                const desc = (node.contentDesc ?? "").trim();
                return desc.includes("更多") || desc.includes("面板") || desc.includes("分享");
            }, true)
            .map((node: UiNode) => `${node.contentDesc ?? ""}@${node.bounds ?? ""}`);
        console.log(
            `找不到更多面板按钮：屏幕高=${screen.height}，含「更多/面板/分享」的节点=${candidates.join(" ; ") || "(无)"}`
        );
        throw error;
    }
    await tapNode(moreButton, "更多面板");

    await tapShareLinkItem(screen);

    await waitForNode(
        (current) => current.findByText(COPIED_SHEET_TEXT, { exact: false }),
        COPIED_SHEET_TEXT,
        SHARE_SHEET_TIMEOUT_MS
    );
    // 面板是模态窗口，用返回键关掉之后直播间的节点才回到节点树里。
    await Tools.UI.pressKey(BACK_KEY_CODE);
    await Tools.System.sleep(UI_SETTLE_MS);
    // 正常情况等房间标记回来；房间在取链途中结束时等「直播已结束」面板。
    // 两者都代表「分享面板已经关掉、可以安全读剪贴板」。
    await waitForNode(
        (current) =>
            findRoomMarker(current, screen) ??
            current.findByText(ROOM_ENDED_TEXT, { exact: false }),
        "关闭分享面板后的直播间（或直播已结束面板）",
        ROOM_ENTRY_TIMEOUT_MS
    );

    // 抖音一直保持前台，shell 直接读剪贴板，不再切 App，直播间不会因此丢失。
    const clipboardText = await readClipboardViaShell();

    const matched = clipboardText.match(SHARE_URL_PATTERN);
    if (!matched) {
        const preview = clipboardText.trim().slice(0, 40);
        throw new Error(
            `剪贴板里没有抖音分享短链，复制那一步可能没生效。内容开头：${preview || "(空)"}`
        );
    }
    const url = matched[0];
    const authorMatched = clipboardText.match(SHARE_AUTHOR_PATTERN);
    const author = authorMatched ? authorMatched[1] : info.host;

    const identity = await resolveLiveRoomIdentity(url);
    console.log(
        `直播间身份解析成功：${url} -> room_id=${identity.roomId}，主播抖音号=${identity.authorId}`
    );

    return {
        url,
        shareText: clipboardText,
        contentId: identity.roomId,
        authorId: identity.authorId,
        author,
        promoHint,
        info,
    };
}

type DouyinLiveCollectRoomLinkResult = {
    success: boolean;
    url: string;
    shareText: string;
    contentId: string;
    authorId: string;
    author: string;
    likeCount: number | null;
    viewerCount: number | null;
    promoHint: boolean;
    interactionText: string;
};

async function douyin_live_collect_room_link(): Promise<DouyinLiveCollectRoomLinkResult> {
    await ensureDouyinForeground();
    const screen = await readScreenSize();

    const marker = await tryWaitForNode(
        (root) => findRoomMarker(root, screen),
        ROOM_ENTRY_TIMEOUT_MS
    );
    if (!marker) {
        throw new Error(
            `当前页面不是直播间，找不到 content-desc 以「${ROOM_LIKE_SUFFIX}」结尾的按钮。${await describeCurrentPage()}`
        );
    }

    const extracted = await extractRoomShareLink(screen);
    return {
        success: true,
        url: extracted.url,
        shareText: extracted.shareText,
        contentId: extracted.contentId,
        authorId: extracted.authorId,
        author: extracted.author,
        likeCount: extracted.info.likeCount,
        viewerCount: extracted.info.viewerCount,
        promoHint: extracted.promoHint,
        interactionText: extracted.info.interactionText,
    };
}

// ===== 记录落地与 outbox 上报 =====
//
// 采集与上报解耦：采集只往 records.jsonl 追加/更新记录，上报由 outbox.json 驱动。
// 脚本被杀或超时都不会丢记录，重放安全。上报契约见
// docs/TODO/device_automation_platform_20261008/03_record_store_and_outbox.md。

const PLUGIN_ID = "douyin_live_collector";
const CONFIG_DIR = getPluginConfigDir(PLUGIN_ID);
const RECORDS_FILE = `${CONFIG_DIR}/records.jsonl`;
const OUTBOX_FILE = `${CONFIG_DIR}/outbox.json`;
const PROGRESS_FILE = `${CONFIG_DIR}/progress.json`;

// 上报地址与令牌存在宿主的环境变量里，不落文件。
// 该存储是全局键值、不按包隔离（EnvPreferences）。服务端只有一个，
// 所以四个采集包共用同一组中立键，键名不带来源前缀。
const ENV_BASE_URL = "COLLECTOR_BASE_URL";
const ENV_TOKEN = "COLLECTOR_TOKEN";

const UPLOAD_PATH = "/api/v1/records";
// 批量条数取自上报契约
const UPLOAD_BATCH_SIZE = 20;
const HTTP_CONNECT_TIMEOUT_MS = 15000;
const HTTP_READ_TIMEOUT_MS = 30000;

// 直播用独立 source：同平台视频包上报 douyin_app，直播若沿用会在服务端按 source
// 分表时混进视频；content_type 只是记录内标记，不能替代 source 的分类作用。
const RECORD_SOURCE = "douyin_live_app";

type CollectedRecord = {
    idempotency_key: string;
    keyword: string;
    url: string;
    share_text: string;
    title: string;
    author: string;
    // 主播抖音号，见 resolveLiveRoomIdentity。老记录没有这个字段，
    // 下次再采到同一个 room_id 时会补上（更新条件见 douyin_live_collect_rooms）。
    author_id: string;
    // collected_at 是**首次采集时间**，再次观测到同一个直播间时不变；
    // 计数属于哪一刻由 counts_at 单独记。
    collected_at: string;
    source: string;
    // 直播间身份，见 resolveLiveRoomIdentity。短链码每次都变，只有它是稳定的。
    content_id: string;
    // 固定 "live"，便于服务端把直播与视频分开入库（服务端契约允许忽略不认识的字段）。
    content_type: "live";
    // 相关性与推广标记。只做标记，不据此丢弃数据。
    keyword_in_title: boolean;
    promo_hint: boolean;
    // 本场点赞 / 在线观众。null 表示这次没在页面上读到（不是 0）；
    // 更新已有记录时，null 的那一项保持原值，不覆盖。
    like_count: number | null;
    comment_count: number | null;
    collect_count: number | null;
    viewer_count: number | null;
    // 命中的原始文案，例如「德民信口腔63本场点赞|13在线观众」。
    interaction_text: string;
    // 这两个计数的观测时间。服务端按它做单调判断。
    counts_at: string;
};

type OutboxEntry = {
    status: "pending" | "sent" | "failed";
    attempts: number;
    last_error: string;
    updated_at: string;
};

type OutboxFileData = {
    entries: Record<string, OutboxEntry>;
};

type UploadConfig = {
    base_url: string;
    token: string;
};

type UploadClientInfo = {
    device: string;
    app_version: string;
};

type RejectedItem = {
    key: string;
    reason: string;
};

type UploadResponse = {
    accepted?: string[];
    rejected?: RejectedItem[];
};

// 一次批量请求的判定结果。kind 直接对应上报契约里的四种情况。
type BatchOutcome = {
    httpStatus: number;
    kind: "accepted" | "throttled" | "retryable" | "client_error" | "unparseable";
    acceptedKeys: string[];
    rejectedKeys: string[];
    note: string;
    retryAfterSeconds: number;
};

type DouyinLiveOutboxFlushResult = {
    success: boolean;
    batches: number;
    sent: number;
    failed: number;
    pending: number;
    recordsFile: string;
    outboxFile: string;
    note: string;
};

type DouyinLiveOutboxStatusResult = {
    success: boolean;
    pending: number;
    sent: number;
    failed: number;
    records: number;
    recordsFile: string;
    outboxFile: string;
};

type UploadCheckVerdict =
    | "ok"
    | "token_rejected"
    | "path_not_found"
    | "server_error"
    | "unexpected_status"
    | "unreachable";

type DouyinLiveUploadConfigCheckResult = {
    success: boolean;
    verdict: UploadCheckVerdict;
    reachable: boolean;
    httpStatus: number;
    serverMessage: string;
    baseUrl: string;
    tokenMasked: string;
};

/**
 * 幂等键。QuickJS 没有 crypto，用 Math.random 拼 v4；键在采集时生成，
 * 重发时保持不变，服务端按它去重。
 */
function randomId(): string {
    const digits = "0123456789abcdef";
    const hex: string[] = [];
    for (let i = 0; i < 32; i += 1) {
        hex.push(digits.charAt(Math.floor(Math.random() * 16)));
    }
    const variant = "89ab".charAt(Math.floor(Math.random() * 4));
    return (
        hex.slice(0, 8).join("") +
        "-" +
        hex.slice(8, 12).join("") +
        "-4" +
        hex.slice(13, 16).join("") +
        "-" +
        variant +
        hex.slice(17, 20).join("") +
        "-" +
        hex.slice(20, 32).join("")
    );
}

function nowIso(): string {
    // toISOString 带 Z，属于 ISO8601 的时区表示
    return new Date().toISOString();
}

async function readTextFile(path: string): Promise<string> {
    const exists = await Tools.Files.exists(path, "android");
    if (!exists.exists) {
        return "";
    }
    const file = await Tools.Files.read(path);
    return file.content;
}

async function loadRecords(): Promise<CollectedRecord[]> {
    const content = await readTextFile(RECORDS_FILE);
    const records: CollectedRecord[] = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (!line) {
            continue;
        }
        try {
            records.push(JSON.parse(line) as CollectedRecord);
        } catch (error) {
            throw new Error(`records.jsonl 第 ${i + 1} 行不是合法 JSON：${errorMessage(error)}`);
        }
    }
    return records;
}

async function loadOutbox(): Promise<OutboxFileData> {
    const content = await readTextFile(OUTBOX_FILE);
    if (!content.trim()) {
        return { entries: {} };
    }
    const parsed = JSON.parse(content) as OutboxFileData;
    if (!parsed.entries) {
        throw new Error(`outbox.json 结构不对，缺少 entries 字段：${OUTBOX_FILE}`);
    }
    return parsed;
}

async function saveOutbox(outbox: OutboxFileData): Promise<void> {
    await Tools.Files.write(OUTBOX_FILE, JSON.stringify(outbox, null, 2), false, "android");
}

function outboxEntryOf(outbox: OutboxFileData, key: string): OutboxEntry {
    const entry = outbox.entries[key];
    if (entry) {
        return entry;
    }
    const created: OutboxEntry = {
        status: "pending",
        attempts: 0,
        last_error: "",
        updated_at: nowIso(),
    };
    outbox.entries[key] = created;
    return created;
}

function markOutbox(
    outbox: OutboxFileData,
    key: string,
    status: "pending" | "sent" | "failed",
    error: string
): void {
    const entry = outboxEntryOf(outbox, key);
    entry.status = status;
    entry.last_error = error;
    entry.updated_at = nowIso();
}

/** 把一条新采集的直播间追加到 records.jsonl，并给它建一条 pending 的 outbox 记录。 */
async function appendRecord(outbox: OutboxFileData, record: CollectedRecord): Promise<void> {
    const appended = await Tools.Files.write(
        RECORDS_FILE,
        `${JSON.stringify(record)}\n`,
        true,
        "android"
    );
    // 写失败必须炸出来：静默放过的话这条记录只活在 outbox 的键里，
    // 下一轮 flush 从文件里读不到它，等到数据对不上才发现。
    if (!appended.successful) {
        throw new Error(`追加采集记录失败：${appended.details || "(没有细节)"}`);
    }
    markOutbox(outbox, record.idempotency_key, "pending", "");
}

/**
 * 用整份记录重写 records.jsonl（原地更新一个直播间的计数时用）。
 *
 * 为什么写临时文件再 move 而不是直接覆盖：脚本随时可能被 30 分钟硬超时杀掉，
 * 直接覆盖会留下半截文件，而 loadRecords 遇到坏行是直接抛错的，整个采集会瘫掉。
 * 宿主的 move 在 Android 上走 File.renameTo，同目录下是原子替换。
 *
 * 为什么每次更新都重写整个文件、而不是攒到本片结束时写一次：
 * 更新后的那一行随时可能因为脚本被杀而丢失，攒到最后等于把「这一片采到的计数」
 * 押在收尾能不能跑到。文件是一个直播间一行，量级是几百行，重写几次的代价可以忽略。
 */
async function saveRecords(records: CollectedRecord[]): Promise<void> {
    const content = records.map((record) => `${JSON.stringify(record)}\n`).join("");
    const tempFile = `${RECORDS_FILE}.rewrite`;
    const written = await Tools.Files.write(tempFile, content, false, "android");
    if (!written.successful) {
        throw new Error(`写临时记录文件失败：${written.details || "(没有细节)"}`);
    }
    const moved = await Tools.Files.move(tempFile, RECORDS_FILE, "android");
    // move 失败时目标文件还是旧内容（不是半截），但这次更新会丢，必须如实报错而不是继续
    if (!moved.successful) {
        throw new Error(`替换采集记录文件失败：${moved.details || "(没有细节)"}`);
    }
}

// ===== 分片与断点续跑 =====
//
// 脚本硬超时 30 分钟且没有协作式检查点，所以一次运行只做一片：
// 按条数目标或时间上限先到者结束，结束时写 progress.json。
// 下一片由工作流定时点火，靠 records.jsonl 里的直播间身份去重，
// 已在库里的房间不跳过，而是更新那一行的本场点赞/在线观众。

type CollectProgress = {
    keyword: string;
    round_id: string;
    chunk_index: number;
    collected_total: number;
    last_url: string;
    last_room_id: string;
    last_host: string;
    last_stop_reason: string;
    last_chunk_started_at: string;
    last_chunk_finished_at: string;
    updated_at: string;
};

async function loadProgress(): Promise<CollectProgress | undefined> {
    const content = await readTextFile(PROGRESS_FILE);
    if (!content.trim()) {
        return undefined;
    }
    return JSON.parse(content) as CollectProgress;
}

async function saveProgress(progress: CollectProgress): Promise<void> {
    progress.updated_at = nowIso();
    await Tools.Files.write(PROGRESS_FILE, JSON.stringify(progress, null, 2), false, "android");
}

/**
 * 取出本轮的进度状态。
 * 同一个关键词的上一轮没结束就续上同一轮，换了关键词就开新一轮。
 */
async function startProgress(keyword: string): Promise<CollectProgress> {
    const previous = await loadProgress();
    if (previous && previous.keyword === keyword) {
        console.log(
            `续上一轮：关键词=${keyword} 第 ${previous.chunk_index} 片已完成，累计新增 ${previous.collected_total} 条`
        );
        return previous;
    }
    return {
        keyword,
        round_id: randomId(),
        chunk_index: 0,
        collected_total: 0,
        last_url: "",
        last_room_id: "",
        last_host: "",
        last_stop_reason: "",
        last_chunk_started_at: "",
        last_chunk_finished_at: "",
        updated_at: nowIso(),
    };
}

/**
 * 读上报配置。
 *
 * 配置在宿主的环境变量里，设置入口是工具箱里的「抖音直播采集设置」页。
 * 这里不做任何兜底：键缺失就报错，并把该去哪填写说清楚，绝不拿空地址去发请求。
 */
async function readUploadConfig(): Promise<UploadConfig> {
    const baseUrl = (getEnv(ENV_BASE_URL) ?? "").trim();
    const token = (getEnv(ENV_TOKEN) ?? "").trim();
    if (!baseUrl || !token) {
        throw new Error(
            `未配置上报地址或令牌（地址${baseUrl ? "已设置" : "为空"}，令牌${token ? "已设置" : "为空"}）。` +
                `请在 工具箱 → 抖音直播采集设置 里填写并保存。`
        );
    }
    return { base_url: baseUrl, token };
}

// 配置里令牌的脱敏形式，用于自检结果与界面回显
function maskToken(token: string): string {
    if (token.length <= 8) {
        return "*".repeat(token.length);
    }
    return `${token.slice(0, 4)}${"*".repeat(token.length - 8)}${token.slice(-4)}`;
}

// 从服务端响应体里取 message，取不到就把原文截断返回，让界面能直接展示原因
function parseServerMessage(content: string): string {
    const trimmed = content.trim();
    if (!trimmed) {
        return "";
    }
    try {
        const parsed = JSON.parse(trimmed) as { message?: string };
        if (typeof parsed.message === "string") {
            return parsed.message;
        }
    } catch (error) {
        console.log(`配置自检：响应体不是 JSON，按原文展示：${errorMessage(error)}`);
    }
    return trimmed.slice(0, 200);
}

async function readClientInfo(): Promise<UploadClientInfo> {
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
async function sendBatch(
    config: UploadConfig,
    batch: CollectedRecord[],
    client: UploadClientInfo
): Promise<BatchOutcome> {
    const body = JSON.stringify({
        batch_id: randomId(),
        client,
        items: batch,
    });

    let status = 0;
    let content = "";
    let headers: Record<string, string> = {};
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
    } catch (error) {
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
        let parsed: UploadResponse;
        try {
            parsed = JSON.parse(content) as UploadResponse;
        } catch (error) {
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

    // 401/403/404/405 都不是「这条记录被服务端拒收」，而是请求根本没到 hotgo 的 API：
    // 令牌不对，或者 base_url 填成了后台静态页面的地址（反向代理没有转发 /api）。
    // 这类问题必须保持 pending：按 failed 处理的话，failed 又规定不自动重发，一次配置
    // 改错就会把整批已采数据永久钉死。2026-11-02 生产事故就是这么发生的——
    // base_url 少了 :8000，nginx 对 POST /api/v1/records 回 405，21 条记录被判 failed，
    // 生产一条都查不到，只能在设备上手工把它们改回 pending 补发。
    if (status === 401 || status === 403) {
        return {
            httpStatus: status,
            kind: "retryable",
            acceptedKeys: [],
            rejectedKeys: [],
            note: `令牌被服务端拒绝（HTTP ${status}）：检查「抖音直播采集设置」里的令牌与 hotgo 后台是否一致`,
            retryAfterSeconds: 0,
        };
    }
    if (status === 404 || status === 405) {
        return {
            httpStatus: status,
            kind: "retryable",
            acceptedKeys: [],
            rejectedKeys: [],
            note: `上报地址不是 hotgo API（HTTP ${status}）：base_url 要填 API 地址（默认 http://主机:8000），不是后台页面地址；走反向代理时确认 /api 已转发给 hotgo`,
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

function countRecordsByStatus(records: CollectedRecord[], outbox: OutboxFileData) {
    let pending = 0;
    let sent = 0;
    let failed = 0;
    for (const record of records) {
        const status = outboxEntryOf(outbox, record.idempotency_key).status;
        if (status === "sent") {
            sent += 1;
        } else if (status === "failed") {
            failed += 1;
        } else {
            pending += 1;
        }
    }
    return { pending, sent, failed };
}

/** 把 outbox 里所有 pending 记录按批量发出去。failed 不自动重发。 */
async function douyin_live_outbox_flush(): Promise<DouyinLiveOutboxFlushResult> {
    const config = await readUploadConfig();
    const client = await readClientInfo();
    const records = await loadRecords();
    const outbox = await loadOutbox();

    const pendingRecords = records.filter(
        (record) => outboxEntryOf(outbox, record.idempotency_key).status === "pending"
    );

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
        } else if (outcome.kind === "throttled") {
            note = outcome.note;
            console.log(`被限流，停止本轮上报：${outcome.note}`);
            break;
        } else if (outcome.kind === "retryable") {
            for (const record of batch) {
                const entry = outboxEntryOf(outbox, record.idempotency_key);
                entry.attempts += 1;
                entry.last_error = outcome.note;
                entry.updated_at = nowIso();
            }
            note = outcome.note;
            console.log(`可重试失败，保持 pending：${outcome.note}`);
        } else {
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
    console.log(
        `上报结束：批 ${batches}，sent ${counts.sent}，failed ${counts.failed}，pending ${counts.pending}`
    );

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

async function douyin_live_outbox_status(): Promise<DouyinLiveOutboxStatusResult> {
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
 */
async function douyin_live_upload_config_check(): Promise<DouyinLiveUploadConfigCheckResult> {
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
    } catch (error) {
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
    let verdict: UploadCheckVerdict;
    if (status === 400 && serverMessage.includes("items")) {
        verdict = "ok";
    } else if (status === 401 || status === 403) {
        verdict = "token_rejected";
    } else if (status === 404 || status === 405) {
        verdict = "path_not_found";
    } else if (status >= 500) {
        verdict = "server_error";
    } else {
        verdict = "unexpected_status";
    }

    console.log(
        `配置自检：HTTP ${status}，判定 ${verdict}，服务端消息 ${serverMessage || "无"}`
    );
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

type DouyinLiveCollectRoomsParams = {
    keyword: string;
    count?: number;
    chunk_minutes?: number;
};

type StopReason = "count" | "time" | "search_exhausted";

type DouyinLiveCollectRoomsResult = {
    success: boolean;
    keyword: string;
    requested: number;
    collected: string[];
    updated: number;
    skippedUnusable: number;
    stopReason: StopReason;
    chunkIndex: number;
    collectedTotal: number;
    recordsFile: string;
    outboxFile: string;
    progressFile: string;
};

/**
 * 从直播间（或误点进去的别的页面）回到直播列表。
 *
 * 判定必须用页面内容，不能用 page.activityName：抖音当前上报的是窗口根类名而不是
 * Activity 名（直播间实测 com.lynx.tasm.behavior.KeyboardMonitor，搜索页实测
 * androidx.compose.ui.platform.ComposeView）。拿它判断「还在不在直播间」会一次
 * 返回键都不按，紧接着等搜索页等到 30 秒超时，整片采集就在第一间之后断掉。
 *
 * 「回到列表」的判据：搜索标签行在，且没有直播间标记。
 */
async function leaveRoomToList(screen: ScreenSize): Promise<UiNode> {
    for (let attempt = 1; attempt <= MAX_LEAVE_ROOM_ATTEMPTS; attempt += 1) {
        const root = await readRoot();
        if (findSearchTab(root, LIVE_TAB_TEXT) && !findRoomMarker(root, screen)) {
            return root;
        }
        const inRoom =
            findRoomMarker(root, screen) !== undefined ||
            root.findByText(ROOM_ENDED_TEXT, { exact: false }) !== undefined;
        if (!inRoom) {
            // 既不是直播间（含已结束面板），也不是列表：多半是按返回键之后的转场，
            // 搜索页的标签行还没画出来。这里先等它稳定，等不到就如实报错。
            //
            // 不能像原来那样直接再按一次返回：2026-11-02 实测连续三次返回会把抖音
            // 退出搜索页、一路退到桌面（com.miui.home），整片采集从一个可恢复的
            // 超时变成彻底跑飞。
            const settled = await tryWaitForNode(
                (current) =>
                    findSearchTab(current, LIVE_TAB_TEXT) && !findRoomMarker(current, screen)
                        ? current
                        : undefined,
                VIDEO_SWITCH_SETTLE_MS
            );
            if (settled) {
                return settled;
            }
            throw new Error(
                `当前页面既不是直播间也不是直播列表，不再继续按返回键。${await describeCurrentPage()}`
            );
        }
        console.log(`第 ${attempt} 次返回：仍在直播间，按返回键`);
        await Tools.UI.pressKey(BACK_KEY_CODE);
        await Tools.System.sleep(VIDEO_SWITCH_SETTLE_MS);
    }
    throw new Error(
        `连续返回 ${MAX_LEAVE_ROOM_ATTEMPTS} 次仍没回到直播列表。${await describeCurrentPage()}`
    );
}

async function advanceToNextRoom(
    screen: ScreenSize,
    previousHost: string
): Promise<boolean> {
    const listRoot = await leaveRoomToList(screen);
    if (findListEnd(listRoot, screen)) {
        console.log(`直播列表已到到底部（「${LIVE_LIST_END_TEXT}」）`);
        return false;
    }

    for (let attempt = 1; attempt <= MAX_ADVANCE_ATTEMPTS; attempt += 1) {
        await Tools.UI.swipe(540, LIST_SWIPE_FROM_Y, 540, LIST_SWIPE_TO_Y, SWIPE_DURATION_MS);
        await Tools.System.sleep(LIST_SETTLE_MS);
        const root = await readRoot();
        const tapPoint = findLiveCardTapPoint(root, screen);
        if (!tapPoint) {
            if (findListEnd(root, screen)) {
                console.log(`直播列表已到底部（「${LIVE_LIST_END_TEXT}」）`);
                return false;
            }
            console.log(`第 ${attempt} 次上滑后没有可点的直播卡，继续滑`);
            continue;
        }
        console.log(`第 ${attempt} 次点击可视直播卡 (${tapPoint.x},${tapPoint.y})`);
        await Tools.UI.tap(tapPoint.x, tapPoint.y);
        const marker = await tryWaitForNode(
            (current) => findRoomMarker(current, screen),
            ADVANCE_MARKER_TIMEOUT_MS
        );
        if (!marker) {
            // 可能已经进了直播间，只是浮层还没露出「本场点赞」标记；直接再滑就滑在
            // 房间里了。还在列表上就直接重试；已经不在列表（进了没读到标记的直播间，
            // 或点到了商品页）就先退回列表再继续。同样不看 activityName。
            const current = await readRoot();
            if (findRoomMarker(current, screen)) {
                console.log(`第 ${attempt} 次点击卡片后没有读到直播间标记，先退回列表`);
                await leaveRoomToList(screen);
            } else if (!findSearchTab(current, LIVE_TAB_TEXT)) {
                // 点到广告/商品页：按一次返回回到列表。不能交给 leaveRoomToList，
                // 它只在「确认还在直播间」时才按返回，落在商品页时会如实报错。
                console.log(`第 ${attempt} 次点击卡片后到了别的页面，按返回键回列表`);
                await Tools.UI.pressKey(BACK_KEY_CODE);
                await Tools.System.sleep(VIDEO_SWITCH_SETTLE_MS);
            }
            continue;
        }
        const info = readRoomInfo(await readRoot(), screen);
        if (info.host !== previousHost) {
            return true;
        }
        console.log(`第 ${attempt} 次上滑后仍是同一个主播（${info.host}），返回再滑`);
        await leaveRoomToList(screen);
    }
    return false;
}
async function douyin_live_collect_rooms(
    params: DouyinLiveCollectRoomsParams
): Promise<DouyinLiveCollectRoomsResult> {
    const keyword = (params.keyword ?? "").trim();
    if (!keyword) {
        throw new Error("douyin_live_collect_rooms 需要 keyword");
    }
    const count = params.count === undefined ? DEFAULT_COLLECT_COUNT : Math.floor(params.count);
    if (count < 1) {
        throw new Error("count 必须大于等于 1");
    }
    const chunkMinutes =
        params.chunk_minutes === undefined ? DEFAULT_CHUNK_MINUTES : params.chunk_minutes;
    if (chunkMinutes <= 0) {
        throw new Error("chunk_minutes 必须大于 0");
    }
    if (chunkMinutes > MAX_CHUNK_MINUTES) {
        throw new Error(
            `chunk_minutes 最多 ${MAX_CHUNK_MINUTES} 分钟。脚本硬超时是 30 分钟，单片留出安全边际`
        );
    }
    const chunkBudgetMs = chunkMinutes * 60 * 1000;
    const chunkStartedAt = Date.now();

    const progress = await startProgress(keyword);
    progress.chunk_index += 1;
    progress.last_chunk_started_at = nowIso();
    progress.last_stop_reason = "";
    await saveProgress(progress);
    console.log(
        `本轮第 ${progress.chunk_index} 片开始，本片目标 ${count} 个直播间（新增 + 更新），时间上限 ${chunkMinutes} 分钟`
    );

    const screen = await openLiveSearch(keyword);

    const outbox = await loadOutbox();
    const records = await loadRecords();
    // content_id -> records 里的下标。用来判断这次遇到的是新增还是「库里已有、要更新那一行」。
    // 跨轮次生效：records.jsonl 就是一个直播间一行。
    const recordIndexByRoomId: Record<string, number> = Object.create(null);
    for (let index = 0; index < records.length; index += 1) {
        const contentId = records[index].content_id;
        if (contentId) {
            recordIndexByRoomId[contentId] = index;
        }
    }

    const collected: string[] = [];
    let updated = 0;
    let skippedUnusable = 0;
    let stopReason: StopReason = "count";
    let lastProcessedRoomId = "";

    const entered = await enterFirstLiveCard(screen);
    if (!entered) {
        stopReason = "search_exhausted";
    } else {
        // 新增与更新都走一次完整的取链（身份只能从分享短链的最终页里取），成本一样，共用一个预算
        while (collected.length + updated < count) {
            if (Date.now() - chunkStartedAt >= chunkBudgetMs) {
                stopReason = "time";
                console.log(
                    `本片时间上限 ${chunkMinutes} 分钟到，结束本片，本片已新增 ${collected.length} 条、更新 ${updated} 条`
                );
                break;
            }

            const extracted = await extractRoomShareLink(screen);

            // 取到的还是上一间：说明上一条结束时没有真的切走，先切走再继续，
            // 不能把同一间重复算成一次更新。
            if (lastProcessedRoomId && extracted.contentId === lastProcessedRoomId) {
                console.log(
                    `本片又一次取到同一个直播间（room_id=${extracted.contentId}），先切到下一间`
                );
                const advanced = await advanceToNextRoom(screen, extracted.info.host);
                if (!advanced) {
                    stopReason = "search_exhausted";
                    break;
                }
                continue;
            }

            const countsAt = nowIso();
            const existingIndex = recordIndexByRoomId[extracted.contentId];
            if (existingIndex === undefined) {
                const record: CollectedRecord = {
                    idempotency_key: randomId(),
                    keyword,
                    url: extracted.url,
                    share_text: extracted.shareText,
                    // 直播间没有可读的房间标题节点，title 固定空字符串；
                    // 主播名放在 author 里。
                    title: "",
                    author: extracted.author,
                    author_id: extracted.authorId,
                    collected_at: countsAt,
                    source: RECORD_SOURCE,
                    content_id: extracted.contentId,
                    content_type: "live",
                    keyword_in_title: extracted.author.includes(keyword),
                    promo_hint: extracted.promoHint,
                    like_count: extracted.info.likeCount,
                    comment_count: null,
                    collect_count: null,
                    viewer_count: extracted.info.viewerCount,
                    interaction_text: extracted.info.interactionText,
                    counts_at: countsAt,
                };
                // 每条立即落盘并建 pending 的 outbox 记录，中途被杀也不会丢
                await appendRecord(outbox, record);
                await saveOutbox(outbox);
                recordIndexByRoomId[extracted.contentId] = records.length;
                records.push(record);
                collected.push(extracted.url);
                progress.collected_total += 1;
                console.log(
                    `已采集第 ${collected.length} 条：${extracted.url}（room_id=${extracted.contentId}，主播 ${extracted.author}，抖音号 ${extracted.authorId}，本场点赞 ${extracted.info.likeCount ?? "无"}、在线 ${extracted.info.viewerCount ?? "无"}）`
                );
            } else {
                // 库里有这个直播间：用这次观测到的字段就地更新那一行。
                //
                // 抖音号一定要补：0.1.x 的老记录没有 author_id，同一个房间再采到时
                // 不能因为「计数没变」就跳过，否则这些行永远缺 ID。
                // 计数仍然只在观测到时覆盖：页面没显示在线观众时不能把它写成 null，
                // 否则会把上一次采到的数字清掉。
                const target = records[existingIndex];
                const authorIdChanged = target.author_id !== extracted.authorId;
                if (
                    !authorIdChanged &&
                    extracted.info.likeCount === null &&
                    extracted.info.viewerCount === null
                ) {
                    // 抖音号没变、两个计数也都没读到：没有可更新的数据，保持原行不动。
                    // 不换幂等键、不写文件，避免把一次「什么都没看到」的观测当成新数据上报。
                    skippedUnusable += 1;
                    console.log(
                        `直播间已在库里，抖音号没变且两个计数都没读到，保持原值不更新：room_id=${extracted.contentId}`
                    );
                } else {
                    const previousKey = target.idempotency_key;
                    const observedCounts =
                        extracted.info.likeCount !== null || extracted.info.viewerCount !== null;
                    if (extracted.info.likeCount !== null) {
                        target.like_count = extracted.info.likeCount;
                    }
                    if (extracted.info.viewerCount !== null) {
                        target.viewer_count = extracted.info.viewerCount;
                    }
                    // author_id 是这次一定观测到的字段，直接覆盖：
                    // 老记录是空的，这里正好补上；账号改了抖音号也能跟着更新。
                    target.author_id = extracted.authorId;
                    target.url = extracted.url;
                    target.share_text = extracted.shareText;
                    if (observedCounts) {
                        // counts_at / interaction_text 是计数的观测现场：
                        // 只在真的读到计数时改，避免「只补抖音号」的那次把计数时间推到现在。
                        target.interaction_text = extracted.info.interactionText;
                        target.counts_at = countsAt;
                    }
                    // idempotency_key 必须换新：服务端按 (device, idempotency_key) 去重，
                    // 沿用旧键会被判成「已入库」而完全不更新，换键之后才走「同一房间的新观测」。
                    target.idempotency_key = randomId();
                    // 上一轮观测的 outbox 条目随这一行被覆盖而作废，一并清掉，别让它长成孤儿
                    delete outbox.entries[previousKey];
                    await saveRecords(records);
                    markOutbox(outbox, target.idempotency_key, "pending", "");
                    await saveOutbox(outbox);
                    updated += 1;
                    console.log(
                        `已更新第 ${updated} 条：${extracted.url}（room_id=${extracted.contentId}，抖音号 ${target.author_id}${authorIdChanged ? "（本次补上/变更）" : ""}，本场点赞 ${extracted.info.likeCount ?? "无"}、在线 ${extracted.info.viewerCount ?? "无"}）`
                    );
                }
            }

            lastProcessedRoomId = extracted.contentId;
            progress.last_url = extracted.url;
            progress.last_room_id = extracted.contentId;
            progress.last_host = extracted.info.host;
            await saveProgress(progress);

            // 让界面能看到分片进展，长任务不至于看起来像卡住
            sendIntermediateResult({
                keyword,
                chunkIndex: progress.chunk_index,
                collectedInChunk: collected.length,
                updatedInChunk: updated,
                chunkTarget: count,
                collectedTotal: progress.collected_total,
                url: extracted.url,
                host: extracted.author,
                likeCount: extracted.info.likeCount,
                viewerCount: extracted.info.viewerCount,
            });

            if (collected.length + updated >= count) {
                break;
            }

            const advanced = await advanceToNextRoom(screen, extracted.info.host);
            if (!advanced) {
                stopReason = "search_exhausted";
                break;
            }
        }
    }

    progress.last_stop_reason = stopReason;
    progress.last_chunk_finished_at = nowIso();
    await saveProgress(progress);

    const payload: DouyinLiveCollectRoomsResult = {
        success: true,
        keyword,
        requested: count,
        collected,
        updated,
        skippedUnusable,
        stopReason,
        chunkIndex: progress.chunk_index,
        collectedTotal: progress.collected_total,
        recordsFile: RECORDS_FILE,
        outboxFile: OUTBOX_FILE,
        progressFile: PROGRESS_FILE,
    };
    console.log(
        `本片结束（${describeStopReason(stopReason)}）：新增 ${collected.length} 条、更新 ${updated} 条，本轮累计新增 ${progress.collected_total} 条`
    );
    return payload;
}

function describeStopReason(reason: StopReason): string {
    if (reason === "time") {
        return "时间到";
    }
    if (reason === "search_exhausted") {
        return "直播列表到底";
    }
    return "达到条数目标";
}

exports.douyin_live_collect_room_link = douyin_live_collect_room_link;
exports.douyin_live_collect_rooms = douyin_live_collect_rooms;
exports.douyin_live_outbox_flush = douyin_live_outbox_flush;
exports.douyin_live_outbox_status = douyin_live_outbox_status;
exports.douyin_live_upload_config_check = douyin_live_upload_config_check;
