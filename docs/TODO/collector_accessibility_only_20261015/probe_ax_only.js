'use strict';

/**
 * 纯无障碍（ACCESSIBILITY 档，不依赖 Shizuku）执行抖音采集的真机探针。
 *
 * 背景：现有 driver 的四个动作走 shell（input keyevent / input keycombination / wm size），
 * 而宿主的 execute_shell 严格按用户首选权限档派发，ACCESSIBILITY 档直接拒绝执行任何命令，
 * 于是整个采集被绑死在 Shizuku 上。本探针逐项验证替代原语在 ACCESSIBILITY 档下是否成立：
 *
 *   1. tierReport   —— 档位现场：device_info（免 shell 的屏幕尺寸）、execute_shell 的失败原文、
 *                      前台页面、read_clipboard 的实测结果
 *   2. backProbe    —— Tools.UI.pressKey("KEYCODE_BACK") 能否替代 shell 的 input keyevent 4
 *   3. setTextProbe —— toolCall("set_input_text") 能否替代 shell 的 CTRL+A + DEL 清空输入框
 *   4. pasteProbe   —— 长按输入框 → 节点树里出现「粘贴」→ 点它，能否替代 shell 的
 *                      input keyevent 279（这是唯一没有现成原语的缺口）
 *
 * 每个函数只做验证与取证，不修改任何业务代码与配置。失败即如实返回失败步骤与现场节点。
 */

const DOUYIN_PACKAGE = "com.ss.android.ugc.aweme";
const DOUYIN_SEARCH_SCHEME = "snssdk1128://search";
const SHARE_BUTTON_DESC_PREFIX = "分享";
const SHARE_PANEL_ITEM_TEXT = "分享链接";
const COPIED_HINT_TEXT = "链接已复制成功";
const SEARCH_PAGE_MARKER = "综合";
const EDIT_TEXT_CLASS = "EditText";
const PASTE_TERMS = ["粘贴", "Paste"];
const SHARE_URL_PATTERN = /https?:\/\/v\.douyin\.com\/[^\s]+/;
const DURATION_TEXT_PATTERN = /^\d{2}:\d{2}$/;
const PROBE_TEXT = "AX_ONLY_PROBE_TEXT";

const POLL_INTERVAL_MS = 500;
const STEP_TIMEOUT_MS = 10000;
const SEARCH_PAGE_TIMEOUT_MS = 30000;
const FOREGROUND_WAIT_TIMEOUT_MS = 15000;
const UI_SETTLE_MS = 800;

function errorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function sleep(ms) {
    return Tools.System.sleep(ms);
}

function walk(node, visit) {
    if (!node) {
        return;
    }
    visit(node);
    const children = node.children ?? [];
    for (const child of children) {
        walk(child, visit);
    }
}

function findNodes(node, predicate) {
    const matched = [];
    walk(node, (candidate) => {
        if (predicate(candidate)) {
            matched.push(candidate);
        }
    });
    return matched;
}

function summary(node) {
    return {
        className: node.className ?? "",
        text: node.text ?? "",
        contentDesc: node.contentDesc ?? "",
        resourceId: node.resourceId ?? "",
        bounds: node.bounds ?? "",
        clickable: node.isClickable === true,
    };
}

function boundsOf(bounds) {
    const matched = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(bounds ?? "");
    if (!matched) {
        return null;
    }
    return {
        x1: Number(matched[1]),
        y1: Number(matched[2]),
        x2: Number(matched[3]),
        y2: Number(matched[4]),
    };
}

/** 被滚出屏幕的节点会给出反向边界（x2 < x1），这一层和 driver 的口径一致。 */
function isVisible(node) {
    const rect = boundsOf(node.bounds);
    if (!rect) {
        return false;
    }
    return rect.x2 > rect.x1 && rect.y2 > rect.y1;
}

function centerPoint(node) {
    const rect = boundsOf(node.bounds);
    if (!rect || rect.x2 <= rect.x1 || rect.y2 <= rect.y1) {
        return null;
    }
    return {
        x: Math.round((rect.x1 + rect.x2) / 2),
        y: Math.round((rect.y1 + rect.y2) / 2),
    };
}

async function readPage() {
    const page = await Tools.UI.getPageInfo();
    return {
        packageName: page.packageName,
        activityName: page.activityName,
        root: page.uiElements,
    };
}

function pageDigest(page) {
    const all = findNodes(page.root, () => true);
    const texts = all.filter((node) => (node.text ?? "").length > 0).map((node) => node.text);
    const descs = all.filter((node) => (node.contentDesc ?? "").length > 0).map((node) => node.contentDesc);
    return {
        packageName: page.packageName,
        activityName: page.activityName,
        nodeCount: all.length,
        texts: texts.slice(0, 20),
        contentDescs: descs.slice(0, 20),
    };
}

async function digestOrError() {
    try {
        return pageDigest(await readPage());
    } catch (error) {
        return { readError: errorMessage(error) };
    }
}

async function waitForNode(predicate, what, timeoutMs = STEP_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let lastReadError = "";
    while (Date.now() < deadline) {
        try {
            const page = await readPage();
            const node = findNodes(page.root, predicate)[0];
            if (node) {
                return { node, page };
            }
        } catch (error) {
            lastReadError = errorMessage(error);
        }
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(
        `等待「${what}」超时（${timeoutMs}ms）。最后读页面失败：${lastReadError || "无"}；当前页面：${JSON.stringify(await digestOrError())}`
    );
}

async function ensureDouyinForeground() {
    const deadline = Date.now() + FOREGROUND_WAIT_TIMEOUT_MS;
    let switchRequested = false;
    let lastState = "";
    while (Date.now() < deadline) {
        try {
            const page = await readPage();
            lastState = page.packageName;
            if (page.packageName === DOUYIN_PACKAGE) {
                return page;
            }
            if (!switchRequested) {
                await Tools.System.startApp(DOUYIN_PACKAGE);
                switchRequested = true;
            }
        } catch (error) {
            lastState = `读页面失败：${errorMessage(error)}`;
        }
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`等待抖音切到前台超时，当前前台：${lastState}`);
}

async function openSearchPage(keyword) {
    await ensureDouyinForeground();
    await Tools.System.intent({
        type: "activity",
        action: "android.intent.action.VIEW",
        uri: `${DOUYIN_SEARCH_SCHEME}?keyword=${encodeURIComponent(keyword)}`,
        package: DOUYIN_PACKAGE,
    });
    return waitForNode(
        (node) => (node.text ?? "").includes(SEARCH_PAGE_MARKER),
        "搜索结果页",
        SEARCH_PAGE_TIMEOUT_MS
    );
}

/**
 * 档位现场。这一项不碰界面，可以在任何时候跑。
 */
async function tierReport() {
    const report = {};

    try {
        const info = await Tools.System.getDeviceInfo();
        report.deviceInfo = {
            model: info.model,
            screenResolution: info.screenResolution,
            screenDensity: info.screenDensity,
        };
    } catch (error) {
        report.deviceInfo = { error: errorMessage(error) };
    }

    try {
        // ADBResultData 的字段是 command/output/exitCode，直接 String() 只会得到 [object Object]。
        const shell = await Tools.System.shell("wm size");
        report.shellWmSize = {
            returned: true,
            command: shell.command ?? "",
            output: shell.output ?? "",
            exitCode: shell.exitCode ?? null,
        };
    } catch (error) {
        report.shellWmSize = { returned: false, error: errorMessage(error) };
    }

    try {
        const page = await readPage();
        report.page = pageDigest(page);
    } catch (error) {
        report.page = { readError: errorMessage(error) };
    }

    try {
        const clipboard = await Tools.System.readClipboard();
        report.readClipboard = { returned: true, text: String(clipboard) };
    } catch (error) {
        report.readClipboard = { returned: false, error: errorMessage(error) };
    }

    return report;
}

/**
 * 现场勘察：只读，把后续实验需要的节点（分享按钮、输入框、时长角标、粘贴候选）列出来。
 * activityName 不可靠（文档实测过它会返回根视图/别的窗口类名），定位一律按节点特征。
 */
async function inspectProbe() {
    await Tools.System.startApp(DOUYIN_PACKAGE);
    const page = await ensureDouyinForeground();
    const nodes = findNodes(page.root, () => true);
    const shareButtons = nodes.filter((node) => (node.contentDesc ?? "").startsWith(SHARE_BUTTON_DESC_PREFIX));
    const editTexts = nodes.filter((node) => (node.className ?? "").includes(EDIT_TEXT_CLASS));
    const durationBadges = nodes.filter((node) => /^\d{2}:\d{2}$/.test(node.text ?? ""));
    const tabTexts = nodes.filter((node) => ["综合", "视频", "用户", "图文", "直播"].includes(node.text ?? ""));

    return {
        page: pageDigest(page),
        shareButtons: shareButtons.map(summary),
        editTexts: editTexts.map(summary),
        durationBadges: durationBadges.slice(0, 8).map(summary),
        tabTexts: tabTexts.map(summary),
    };
}

/**
 * 验证 Tools.UI.pressKey("KEYCODE_BACK") 能否替代 shell 的 input keyevent 4。
 * 判据：从搜索结果页按返回后，页面确实离开了搜索页（「综合」标签消失或页面换了）。
 */
async function backProbe(params) {
    const keyword = params && params.keyword ? params.keyword : "美食";
    const trace = [];

    const before = await openSearchPage(keyword);
    trace.push({ step: "searchPage", page: pageDigest(before.page) });

    let backResult = null;
    try {
        backResult = await Tools.UI.pressKey("KEYCODE_BACK");
        trace.push({ step: "pressKeyBack", result: String(backResult) });
    } catch (error) {
        trace.push({ step: "pressKeyBack", error: errorMessage(error) });
    }
    await sleep(UI_SETTLE_MS * 2);

    const after = await readPage();
    const stillOnSearchPage =
        findNodes(after.root, (node) => (node.text ?? "").includes(SEARCH_PAGE_MARKER)).length > 0;
    trace.push({ step: "afterBack", page: pageDigest(after) });

    return {
        ok: backResult !== null && !stillOnSearchPage,
        beforeActivity: before.page.activityName,
        afterActivity: after.activityName,
        stillOnSearchPage,
        trace,
    };
}

/**
 * 验证 set_input_text 能否替代 shell 的 CTRL+A + DEL 清空输入框。
 * 不自己导航：直接在当前前台页面上找可见的 EditText（抖音搜索输入页的 et_search_kw 即可）。
 * provider 的 setTextOnNode 对任何输入框的作用方式一致，这里要验的是这条通道，不是页面结构。
 * 当前页面没有 EditText 就如实报错并带上现场，不猜。
 */
async function setTextProbe() {
    const trace = [];

    const page = await ensureDouyinForeground();
    const edit = findNodes(
        page.root,
        (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS) && isVisible(node)
    )[0];
    if (!edit) {
        throw new Error(`当前页面没有可见的 EditText：${JSON.stringify(pageDigest(page))}`);
    }
    trace.push({ step: "editText", node: summary(edit) });

    const point = centerPoint(edit);
    await Tools.UI.tap(point.x, point.y);
    await sleep(UI_SETTLE_MS);

    let setResult = null;
    try {
        setResult = await toolCall("set_input_text", { text: PROBE_TEXT });
        trace.push({ step: "setText", result: String(setResult) });
    } catch (error) {
        trace.push({ step: "setText", error: errorMessage(error) });
    }
    await sleep(UI_SETTLE_MS);

    const afterSet = await readPage();
    const editAfterSet = findNodes(
        afterSet.root,
        (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS) && isVisible(node)
    )[0];
    const textAfterSet = editAfterSet ? editAfterSet.text ?? "" : "";
    trace.push({ step: "afterSet", editText: editAfterSet ? summary(editAfterSet) : null });

    let clearResult = null;
    try {
        clearResult = await toolCall("set_input_text", { text: "" });
        trace.push({ step: "clearText", result: String(clearResult) });
    } catch (error) {
        trace.push({ step: "clearText", error: errorMessage(error) });
    }
    await sleep(UI_SETTLE_MS);

    const afterClear = await readPage();
    const editAfterClear = findNodes(
        afterClear.root,
        (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS) && isVisible(node)
    )[0];
    const textAfterClear = editAfterClear ? editAfterClear.text ?? "" : "";
    trace.push({ step: "afterClear", editText: editAfterClear ? summary(editAfterClear) : null });

    return {
        // 清空的判据必须是「真的空了」：抖音的搜索框在内容为空时会自己填一条热词建议，
        // 用「不再包含探针文本」当判据会把这种情况误判成清空成功。
        ok: textAfterSet.includes(PROBE_TEXT) && textAfterClear === "",
        textAfterSet,
        textAfterClear,
        clearedToEmpty: textAfterClear === "",
        trace,
    };
}

/**
 * 确保当前在视频详情页，返回可见的分享按钮节点。
 *
 * 抖音停在搜索输入页时 startApp 只会把任务带到前台、不会回首页，所以这里走搜索：
 * 发 deep link 到结果页，点第一张可见卡片（「视频」标签是时长角标，「综合」标签是
 * content-desc 含「视频封面」），进详情后按「以分享开头」的 content-desc 认分享按钮。
 * 已经在详情页（当前页就有分享按钮）就不重新导航。
 */
async function ensureDetailPage(trace) {
    const page = await ensureDouyinForeground();
    const existing = findNodes(
        page.root,
        (node) => (node.contentDesc ?? "").startsWith(SHARE_BUTTON_DESC_PREFIX) && isVisible(node)
    )[0];
    if (existing) {
        trace.push({ step: "detailPage", reused: true, node: summary(existing) });
        return existing;
    }

    trace.push({ step: "detailPage", reused: false, page: pageDigest(page) });
    await Tools.System.intent({
        type: "activity",
        action: "android.intent.action.VIEW",
        uri: `${DOUYIN_SEARCH_SCHEME}?keyword=${encodeURIComponent("美食")}`,
        package: DOUYIN_PACKAGE,
    });

    const card = await waitForNode(
        (node) =>
            isVisible(node) &&
            (DURATION_TEXT_PATTERN.test((node.text ?? "").trim()) ||
                (node.contentDesc ?? "").includes("视频封面")),
        "搜索结果卡片",
        SEARCH_PAGE_TIMEOUT_MS
    );
    trace.push({ step: "resultCard", node: summary(card.node) });
    const cardPoint = centerPoint(card.node);
    await Tools.UI.tap(cardPoint.x, cardPoint.y);
    await sleep(UI_SETTLE_MS * 2);

    const share = await waitForNode(
        (node) => (node.contentDesc ?? "").startsWith(SHARE_BUTTON_DESC_PREFIX) && isVisible(node),
        "详情页分享按钮",
        STEP_TIMEOUT_MS
    );
    trace.push({ step: "shareButton", node: summary(share.node) });
    return share.node;
}

/**
 * 决定性实验：走完「分享 → 分享链接 → 长按评论输入框 → 点粘贴」，全程不使用 shell。
 * 成功判据：从评论输入框回读到形如 https://v.douyin.com/xxxx/ 的短链。
 */
async function pasteProbe() {
    const trace = [];

    try {
        const shareNode = await ensureDetailPage(trace);
        const sharePoint = centerPoint(shareNode);
        await Tools.UI.tap(sharePoint.x, sharePoint.y);
        await sleep(UI_SETTLE_MS);

        const item = await waitForNode(
            (node) => (node.text ?? "").includes(SHARE_PANEL_ITEM_TEXT) && isVisible(node),
            "分享面板的「分享链接」项"
        );
        trace.push({ step: "shareItem", node: summary(item.node) });
        const itemPoint = centerPoint(item.node);
        await Tools.UI.tap(itemPoint.x, itemPoint.y);
        await sleep(UI_SETTLE_MS);

        await waitForNode((node) => (node.text ?? "").includes(COPIED_HINT_TEXT), "复制成功提示");
        trace.push({ step: "copiedHint", ok: true });

        const backResult = await Tools.UI.pressKey("KEYCODE_BACK");
        trace.push({ step: "closePanelBack", result: String(backResult) });
        await sleep(UI_SETTLE_MS);

        // 判据：分享面板是模态窗口，返回键按下去之后「分享链接」这项必须从树里消失。
        // 这一条同时证明 press_key 真的替代了 shell 的 input keyevent 4。
        const afterBack = await readPage();
        const panelStillOpen =
            findNodes(
                afterBack.root,
                (node) => (node.text ?? "").includes(SHARE_PANEL_ITEM_TEXT) && isVisible(node)
            ).length > 0;
        trace.push({ step: "afterClosePanelBack", panelStillOpen, page: pageDigest(afterBack) });

        const edit = await waitForNode(
            (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS) && isVisible(node),
            "评论输入框",
            STEP_TIMEOUT_MS
        );
        trace.push({ step: "editText", node: summary(edit.node) });
        const editPoint = centerPoint(edit.node);
        await Tools.UI.tap(editPoint.x, editPoint.y);
        await sleep(UI_SETTLE_MS * 2);

        // 点一下评论框会打开评论输入面板、键盘也会顶起来，输入框位置会变，
        // 所以长按必须用点击之后重新读到的坐标，不能用点击前那一份。
        const afterTapPage = await readPage();
        const editAfterTap = findNodes(
            afterTapPage.root,
            (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS) && isVisible(node)
        )[0];
        trace.push({
            step: "editTextAfterTap",
            node: editAfterTap ? summary(editAfterTap) : null,
        });
        const pressPoint = editAfterTap ? centerPoint(editAfterTap) : editPoint;

        const longPressResult = await Tools.UI.longPress(pressPoint.x, pressPoint.y);
        trace.push({ step: "longPress", point: pressPoint, result: String(longPressResult) });
        await sleep(UI_SETTLE_MS * 3);

        const afterLongPress = await readPage();
        const pasteCandidates = findNodes(afterLongPress.root, (node) => {
            const text = node.text ?? "";
            const desc = node.contentDesc ?? "";
            return PASTE_TERMS.some((term) => text.includes(term) || desc.includes(term));
        });
        trace.push({ step: "pasteCandidates", nodes: pasteCandidates.map(summary) });

        const visibleCandidates = pasteCandidates.filter(isVisible);
        const chosen =
            visibleCandidates.find((node) => node.isClickable === true) ?? visibleCandidates[0];
        if (!chosen) {
            return {
                ok: false,
                failedStep: "长按后节点树里没有可见的「粘贴」节点",
                page: pageDigest(afterLongPress),
                clickableAfterLongPress: findNodes(
                    afterLongPress.root,
                    (node) => node.isClickable === true && isVisible(node)
                ).map(summary),
                editTextsAfterLongPress: findNodes(
                    afterLongPress.root,
                    (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS)
                ).map(summary),
                trace,
            };
        }

        const chosenPoint = centerPoint(chosen);
        await Tools.UI.tap(chosenPoint.x, chosenPoint.y);
        await sleep(UI_SETTLE_MS * 2);

        const finalPage = await readPage();
        const editAfterPaste = findNodes(
            finalPage.root,
            (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS) && isVisible(node)
        )[0];
        const pastedText = editAfterPaste ? editAfterPaste.text ?? "" : "";
        const matched = pastedText.match(SHARE_URL_PATTERN);
        trace.push({ step: "afterPaste", editText: editAfterPaste ? summary(editAfterPaste) : null });

        // 顺手在同一现场验证清空：采集里取链后必须把输入框清掉，不能留评论草稿。
        let clearResult = null;
        try {
            clearResult = await toolCall("set_input_text", { text: "" });
        } catch (error) {
            clearResult = errorMessage(error);
        }
        await sleep(UI_SETTLE_MS);
        const afterClear = await readPage();
        const editAfterClear = findNodes(
            afterClear.root,
            (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS) && isVisible(node)
        )[0];
        trace.push({
            step: "afterClear",
            result: String(clearResult),
            editText: editAfterClear ? summary(editAfterClear) : null,
        });

        return {
            ok: matched !== null,
            pastedText: pastedText.slice(0, 200),
            matchedUrl: matched ? matched[0] : "",
            clearedText: editAfterClear ? editAfterClear.text ?? "" : "",
            panelStillOpenAfterBack: panelStillOpen,
            trace,
        };
    } catch (error) {
        return {
            ok: false,
            error: errorMessage(error),
            page: await digestOrError(),
            trace,
        };
    }
}

/**
 * 长按粘贴的诊断版。
 *
 * pasteProbe 用「点击前」拿到的坐标去长按，但点一下评论框会打开评论输入面板、键盘也会顶起来，
 * 输入框的位置会变，所以那次长按很可能落在了别处。这里点击后重新读页面、用新的坐标长按，
 * 并把长按前后的候选节点与可点击节点都打出来，用于判断「粘贴」到底有没有出现在树里。
 */
async function pasteDiagProbe() {
    const trace = [];

    try {
    const shareNode = await ensureDetailPage(trace);
    const sharePoint = centerPoint(shareNode);
    await Tools.UI.tap(sharePoint.x, sharePoint.y);
    await sleep(UI_SETTLE_MS);

    // 分享面板打开后先把面板里的文案记下来：面板项的名字随版本变过（「复制链接」→「分享链接」），
    // 等不到目标项时这份现场就是判据。
    trace.push({ step: "sharePanelSnapshot", page: pageDigest(await readPage()) });

    const item = await waitForNode(
        (node) =>
            isVisible(node) &&
            ((node.text ?? "").includes(SHARE_PANEL_ITEM_TEXT) ||
                (node.text ?? "").includes("复制链接")),
        "分享面板的「分享链接」项"
    );
    trace.push({ step: "shareItem", node: summary(item.node) });
    const itemPoint = centerPoint(item.node);
    await Tools.UI.tap(itemPoint.x, itemPoint.y);
    await sleep(UI_SETTLE_MS);

    await waitForNode((node) => (node.text ?? "").includes(COPIED_HINT_TEXT), "复制成功提示");
    trace.push({ step: "copiedHint", ok: true });

    await Tools.UI.pressKey("KEYCODE_BACK");
    await sleep(UI_SETTLE_MS);

    const edit = await waitForNode(
        (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS) && isVisible(node),
        "评论输入框",
        STEP_TIMEOUT_MS
    );
    const beforeTap = centerPoint(edit.node);
    trace.push({ step: "editTextBeforeTap", node: summary(edit.node) });
    await Tools.UI.tap(beforeTap.x, beforeTap.y);
    await sleep(UI_SETTLE_MS * 2);

    // 点击之后重新定位：面板打开后输入框的坐标会变，用旧坐标长按是错的。
    const afterTapPage = await readPage();
    const editAfterTap = findNodes(
        afterTapPage.root,
        (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS) && isVisible(node)
    )[0];
    trace.push({
        step: "editTextAfterTap",
        node: editAfterTap ? summary(editAfterTap) : null,
        page: pageDigest(afterTapPage),
    });

    const pressPoint = editAfterTap ? centerPoint(editAfterTap) : beforeTap;
    trace.push({ step: "longPressPoint", point: pressPoint });
    const longPressResult = await Tools.UI.longPress(pressPoint.x, pressPoint.y);
    trace.push({ step: "longPress", result: String(longPressResult) });
    await sleep(UI_SETTLE_MS * 3);

    const afterLongPress = await readPage();
    const candidates = findNodes(afterLongPress.root, (node) => {
        const text = node.text ?? "";
        const desc = node.contentDesc ?? "";
        return ["粘贴", "复制", "全选", "选择", "Paste", "PasteText"].some(
            (term) => text.includes(term) || desc.includes(term)
        );
    });
    const clickable = findNodes(afterLongPress.root, (node) => node.isClickable === true && isVisible(node));
    const editTexts = findNodes(
        afterLongPress.root,
        (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS)
    );

    return {
        ok: candidates.length > 0,
        candidates: candidates.map(summary),
        clickableNodes: clickable.map(summary),
        editTexts: editTexts.map(summary),
        page: pageDigest(afterLongPress),
        trace,
    };
    } catch (error) {
        return {
            ok: false,
            error: errorMessage(error),
            page: await digestOrError(),
            trace,
        };
    }
}

/**
 * 「不改 provider」的粘贴路线：抖音的粘贴工具条不在无障碍树里（截图已证明它可见、树里没有），
 * 所以只能用坐标点它。坐标不写死绝对值，而是按「输入框左上角 + 偏移」推算，偏移量由实测给出：
 * 2026-10-15 该机该版本实测，输入框 [34,966][1040,1105] 时「粘贴」按钮中心约在 (173,827)，
 * 即 offsetX=+139（从左边界）、offsetY=-139（从上边界往上）。
 * 这一条要验的是「这条路线今天能不能拿到链接」，偏移量本身是版本相关的输入，写在参数里。
 */
async function pasteByToolbarProbe(params) {
    const offsetX = params && params.offsetX !== undefined ? Number(params.offsetX) : 139;
    const offsetY = params && params.offsetY !== undefined ? Number(params.offsetY) : -139;
    const trace = [];

    try {
        const shareNode = await ensureDetailPage(trace);
        const sharePoint = centerPoint(shareNode);
        await Tools.UI.tap(sharePoint.x, sharePoint.y);
        await sleep(UI_SETTLE_MS);

        const item = await waitForNode(
            (node) => (node.text ?? "").includes(SHARE_PANEL_ITEM_TEXT) && isVisible(node),
            "分享面板的「分享链接」项"
        );
        const itemPoint = centerPoint(item.node);
        await Tools.UI.tap(itemPoint.x, itemPoint.y);
        await sleep(UI_SETTLE_MS);

        await waitForNode((node) => (node.text ?? "").includes(COPIED_HINT_TEXT), "复制成功提示");
        trace.push({ step: "copiedHint", ok: true });

        await Tools.UI.pressKey("KEYCODE_BACK");
        await sleep(UI_SETTLE_MS);

        const edit = await waitForNode(
            (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS) && isVisible(node),
            "评论输入框",
            STEP_TIMEOUT_MS
        );
        const collapsedPoint = centerPoint(edit.node);
        await Tools.UI.tap(collapsedPoint.x, collapsedPoint.y);
        await sleep(UI_SETTLE_MS * 2);

        const afterTapPage = await readPage();
        const editAfterTap = findNodes(
            afterTapPage.root,
            (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS) && isVisible(node)
        )[0];
        if (!editAfterTap) {
            throw new Error(`评论面板打开后找不到输入框：${JSON.stringify(pageDigest(afterTapPage))}`);
        }
        const rect = boundsOf(editAfterTap.bounds);
        const longPressPoint = centerPoint(editAfterTap);
        trace.push({ step: "editTextInPanel", node: summary(editAfterTap) });

        await Tools.UI.longPress(longPressPoint.x, longPressPoint.y);
        await sleep(UI_SETTLE_MS * 3);

        const target = { x: rect.x1 + offsetX, y: rect.y1 + offsetY };
        trace.push({ step: "toolbarTap", target, editTextTopLeft: { x: rect.x1, y: rect.y1 } });
        const tapResult = await Tools.UI.tap(target.x, target.y);
        trace.push({ step: "toolbarTapResult", result: String(tapResult) });
        await sleep(UI_SETTLE_MS * 2);

        const finalPage = await readPage();
        const editAfterPaste = findNodes(
            finalPage.root,
            (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS) && isVisible(node)
        )[0];
        const pastedText = editAfterPaste ? editAfterPaste.text ?? "" : "";
        const matched = pastedText.match(SHARE_URL_PATTERN);
        trace.push({ step: "afterPaste", editText: editAfterPaste ? summary(editAfterPaste) : null });

        let clearResult = null;
        try {
            clearResult = await toolCall("set_input_text", { text: "" });
        } catch (error) {
            clearResult = errorMessage(error);
        }
        await sleep(UI_SETTLE_MS);
        const afterClear = await readPage();
        const editAfterClear = findNodes(
            afterClear.root,
            (node) => (node.className ?? "").includes(EDIT_TEXT_CLASS) && isVisible(node)
        )[0];
        trace.push({
            step: "afterClear",
            result: String(clearResult),
            editText: editAfterClear ? summary(editAfterClear) : null,
        });

        return {
            ok: matched !== null,
            pastedText: pastedText.slice(0, 200),
            matchedUrl: matched ? matched[0] : "",
            clearedText: editAfterClear ? editAfterClear.text ?? "" : "",
            trace,
        };
    } catch (error) {
        return {
            ok: false,
            error: errorMessage(error),
            page: await digestOrError(),
            trace,
        };
    }
}

// ===== 互动计数取证（2026-10-19）=====
//
// 目的：把「点赞 / 评论 / 收藏」三个计数在 content-desc 里的确切格式录下来，给
// my-packages/douyin-collector 的解析正则定稿。要回答的疑点：
//   1. 万位缩写：计数 ≥ 10000 时是「1.2万」还是「12000」
//   2. 选中态：已点赞 / 已收藏时状态词怎么写（未点赞 -> 已点赞？）
//   3. 「评论」节点在树里重复出现（evidence_tier_ax.json 里出现了两次），取值要去重
// 顺带 dump 整页 contentDesc 与文本，判定详情页树里有没有稳定的视频标识
// （若有，重复视频的更新就不必再走 35–40 秒的取链流程）。
//
// 这个函数**只读当前页面**，不自己导航、不切 App。原因是实测的硬约束：
// ScriptExecutionReceiver 在广播里同步跑脚本，App 退到后台后超过 60 秒会被系统的
// 「bg anr」直接杀掉（2026-10-19 实测：Receiver 跑了 61 秒就被 Killing (adj 0): bg anr）。
// 所以导航放在宿主侧（deep link + 截图点按），这里只做一次短读，几秒内返回。

const INTERACTION_DESC_PATTERN = /喜欢|评论|收藏/;
const DETAIL_SWIPE_FROM_Y = 1300;
const DETAIL_SWIPE_TO_Y = 300;
const SWIPE_DURATION_MS = 400;
const VIDEO_SWITCH_SETTLE_MS = 2500;
const MAX_NEXT_VIDEO_ATTEMPTS = 3;
const MAX_DUMP_DESCS = 80;
const MAX_DUMP_TEXTS = 80;

/** 一屏详情页的取证快照：命中计数的节点 + 整页 desc/文本，用于事后判定格式。 */
function interactionSample(page, index, shareDesc) {
    const nodes = findNodes(page.root, () => true);
    const descs = nodes
        .map((node) => node.contentDesc ?? "")
        .filter((desc) => desc.length > 0);
    const texts = nodes
        .map((node) => node.text ?? "")
        .filter((text) => text.trim().length > 0);
    const matched = nodes.filter((node) => INTERACTION_DESC_PATTERN.test(node.contentDesc ?? ""));
    return {
        index,
        shareDesc,
        matched: matched.map(summary),
        contentDescs: descs.slice(0, MAX_DUMP_DESCS),
        texts: texts.slice(0, MAX_DUMP_TEXTS),
    };
}

/** 当前详情页的分享按钮 desc；没有就返回空串（用来判断「真的换了一个视频」）。 */
function currentShareDesc(page) {
    const button = findNodes(
        page.root,
        (node) => (node.contentDesc ?? "").startsWith(SHARE_BUTTON_DESC_PREFIX) && isVisible(node)
    )[0];
    return button ? button.contentDesc ?? "" : "";
}

/** 详情页内上滑切下一个视频，返回切换后的分享按钮 desc；切不动就返回原值。 */
async function swipeToNextDetailVideo(previousShareDesc, trace) {
    for (let attempt = 1; attempt <= MAX_NEXT_VIDEO_ATTEMPTS; attempt += 1) {
        await Tools.UI.swipe(540, DETAIL_SWIPE_FROM_Y, 540, DETAIL_SWIPE_TO_Y, SWIPE_DURATION_MS);
        await sleep(VIDEO_SWITCH_SETTLE_MS);

        const page = await readPage();
        const desc = currentShareDesc(page);
        if (!desc) {
            trace.push({ step: "swipeNoButton", attempt, page: pageDigest(page) });
            continue;
        }
        if (desc !== previousShareDesc) {
            return { switched: true, page, shareDesc: desc };
        }
        trace.push({ step: "swipeSameVideo", attempt, desc });
    }
    return { switched: false, page: null, shareDesc: previousShareDesc };
}

/**
 * 互动计数取证。params:
 *   swipes —— 在详情页内再滑几条，默认 0（只读当前这一条）
 *
 * 前提：当前前台就是抖音的视频详情页。不在详情页时立刻报错并带上现场，
 * 不做「自己导航过去」的尝试——那会把 >60 秒的耗时带进广播接收器，进程会被杀。
 */
async function interactionCountsProbe(params) {
    const swipes = params && params.swipes !== undefined ? Number(params.swipes) : 0;
    const trace = [];
    const samples = [];

    try {
        const first = await readPage();
        trace.push({ step: "currentPage", page: pageDigest(first) });
        if (first.packageName !== DOUYIN_PACKAGE) {
            return {
                ok: false,
                error: `当前前台不是抖音（${first.packageName}），先把抖音打开到视频详情页再跑`,
                samples,
                trace,
            };
        }

        let shareDesc = currentShareDesc(first);
        if (!shareDesc) {
            return {
                ok: false,
                error: "当前页面没有可见的分享按钮，不在视频详情页",
                page: pageDigest(first),
                samples,
                trace,
            };
        }

        let page = first;
        for (let index = 0; index <= swipes; index += 1) {
            if (index > 0) {
                const next = await swipeToNextDetailVideo(shareDesc, trace);
                if (!next.switched) {
                    trace.push({ step: "stopSwiping", reason: "连续几次滑动都没换到下一个视频", index });
                    break;
                }
                page = next.page;
                shareDesc = next.shareDesc;
            }

            const sample = interactionSample(page, index, shareDesc);
            sample.interaction = {
                like: sample.matched.filter((node) => node.contentDesc.indexOf("喜欢") >= 0),
                comment: sample.matched.filter((node) => node.contentDesc.indexOf("评论") >= 0),
                collect: sample.matched.filter((node) => node.contentDesc.indexOf("收藏") >= 0),
            };
            samples.push(sample);
        }

        return {
            ok: samples.some((sample) => sample.matched.length > 0),
            swipes,
            sampleCount: samples.length,
            samples,
            trace,
        };
    } catch (error) {
        return {
            ok: false,
            error: errorMessage(error),
            samples,
            page: await digestOrError(),
            trace,
        };
    }
}


exports.interactionCountsProbe = interactionCountsProbe;
exports.tierReport = tierReport;
exports.pasteByToolbarProbe = pasteByToolbarProbe;
exports.pasteDiagProbe = pasteDiagProbe;
exports.backProbe = backProbe;
exports.setTextProbe = setTextProbe;
exports.pasteProbe = pasteProbe;
exports.inspectProbe = inspectProbe;
