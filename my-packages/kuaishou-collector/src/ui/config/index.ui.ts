// 快手采集设置页。注册入口在 src/main.ts，挂到「工具箱」。
//
// 配置存在宿主的环境变量里（EnvPreferences，App 私有 SharedPreferences），
// 键名与子包脚本里的 ENV_BASE_URL / ENV_TOKEN 必须保持一致。
// 这套存储是全局键值、不按包隔离；服务端只有一个，所以键名是中立的，
// 抖音采集、小红书采集与快手采集共用同一组配置。
//
// 待迁移的键是抖音包早期版本留下的（DOUYIN_ 前缀）。服务端只有一个，三个采集包共用这份配置，
// 所以用户先打开哪个设置页都不影响结果；页面加载时会调子包的迁移工具搬过来。
//
// 关于扫码：这里只做「粘贴一段配置文本」的解析。真扫码需要先从相册或相机取到二维码图片，
// 再把它解码成文本，而脚本与 UI 模块都没有图像解码接口，宿主那份 zxing 解码能力没有暴露出来。
// 所以扫码在 App 外完成，扫出来的文本粘进这个页面即可。

const ENV_BASE_URL = "COLLECTOR_BASE_URL";
const ENV_TOKEN = "COLLECTOR_TOKEN";
const CHECK_TOOL = "ks_collector:ks_upload_config_check";
const MIGRATE_TOOL = "ks_collector:ks_migrate_upload_config";
const CLIPBOARD_TOOL = "read_clipboard";

type CheckVerdict =
    | "ok"
    | "token_rejected"
    | "path_not_found"
    | "server_error"
    | "unexpected_status"
    | "unreachable";

// 与子包工具 ks_upload_config_check 的返回结构一致
type CheckResult = {
    success: boolean;
    verdict: CheckVerdict;
    reachable: boolean;
    httpStatus: number;
    serverMessage: string;
};

type Texts = {
    title: string;
    intro: string;
    baseUrlLabel: string;
    baseUrlPlaceholder: string;
    tokenLabel: string;
    tokenPlaceholder: string;
    save: string;
    saving: string;
    check: string;
    checking: string;
    checkHint: string;
    importFromClipboard: string;
    importing: string;
    pastedLabel: string;
    pastedPlaceholder: string;
    parsePasted: string;
    effective: string;
    notConfigured: string;
    savedOk: string;
    pasteImported: string;
    pasteParsed: string;
    errorBaseUrlRequired: string;
    errorBaseUrlScheme: string;
    errorTokenRequired: string;
    errorPasteEmpty: string;
    errorPasteNotJson: string;
    errorPasteMissing: string;
    errorClipboardEmpty: string;
    errorClipboardShape: string;
    errorCheckUnreadable: string;
    errorMigrateFailed: string;
    verdictOk: string;
    verdictTokenRejected: string;
    verdictPathNotFound: string;
    verdictServerError: string;
    verdictUnexpected: string;
    verdictUnreachable: string;
    checkDetail: string;
};

const ZH: Texts = {
    title: "快手采集设置",
    intro: "采集到的分享链接会上报到这里配置的服务端。地址与令牌只存在 App 的私有配置里，不写进任何文件。这里的地址与令牌与抖音、小红书采集共用同一份。",
    baseUrlLabel: "服务端地址",
    baseUrlPlaceholder: "https://your-server.example.com",
    tokenLabel: "令牌",
    tokenPlaceholder: "上报接口的 Bearer 令牌",
    save: "保存",
    saving: "保存中…",
    check: "测试连接",
    checking: "自检中…",
    checkHint: "测试连接用的是已保存的配置。地址与令牌都从环境变量读取，这里不会替你改。",
    importFromClipboard: "从剪贴板导入",
    importing: "读取中…",
    pastedLabel: "粘贴配置文本",
    pastedPlaceholder: '{"base_url":"https://your-server.example.com","token":"你的令牌"}',
    parsePasted: "解析并填入",
    effective: "当前生效",
    notConfigured: "未配置",
    savedOk: "已保存。",
    pasteImported: "已从剪贴板填入地址与令牌，确认后点保存。",
    pasteParsed: "已解析并填入，确认后点保存。",
    errorBaseUrlRequired: "请先填写服务端地址。",
    errorBaseUrlScheme: "服务端地址要以 http:// 或 https:// 开头。",
    errorTokenRequired: "请先填写令牌。",
    errorPasteEmpty: "粘贴框是空的。",
    errorPasteNotJson: "粘贴内容不是 JSON。期望形如 {\"base_url\":\"https://...\",\"token\":\"...\"}。",
    errorPasteMissing: "粘贴内容里缺少 base_url 或 token，或它们不是字符串。",
    errorClipboardEmpty: "剪贴板是空的，或没有文本内容。",
    errorClipboardShape: "读取剪贴板返回了非文本结果，没能拿到配置文本。",
    errorCheckUnreadable: "自检结果读不出来，工具返回的结构不符合预期，详情见应用日志。",
    errorMigrateFailed: "旧配置键迁移失败，详情见应用日志。可以手动重新填写地址与令牌保存一次。",
    verdictOk: "地址可达，令牌有效。",
    verdictTokenRejected: "地址可达，但令牌被拒绝。",
    verdictPathNotFound: "地址可达，但没有这个接口路径。",
    verdictServerError: "地址可达，但服务端自身报错。",
    verdictUnexpected: "地址可达，但响应不符合上报契约。",
    verdictUnreachable: "连不上服务端。",
    checkDetail: "详情",
};

const EN: Texts = {
    title: "Kuaishou Collector Settings",
    intro: "Collected share links are uploaded to the server configured here. The base URL and token live only in the app's private configuration and are never written to a file. They are shared with the Douyin and Xiaohongshu collectors.",
    baseUrlLabel: "Server base URL",
    baseUrlPlaceholder: "https://your-server.example.com",
    tokenLabel: "Token",
    tokenPlaceholder: "Bearer token of the upload endpoint",
    save: "Save",
    saving: "Saving…",
    check: "Test connection",
    checking: "Checking…",
    checkHint: "Testing uses the saved configuration. Both values are read from the environment variables; this button does not change them.",
    importFromClipboard: "Import from clipboard",
    importing: "Reading…",
    pastedLabel: "Paste configuration text",
    pastedPlaceholder: '{"base_url":"https://your-server.example.com","token":"your-token"}',
    parsePasted: "Parse and fill",
    effective: "Currently effective",
    notConfigured: "Not configured",
    savedOk: "Saved.",
    pasteImported: "Filled from the clipboard. Confirm and press Save.",
    pasteParsed: "Parsed and filled. Confirm and press Save.",
    errorBaseUrlRequired: "Enter the server base URL first.",
    errorBaseUrlScheme: "The base URL must start with http:// or https://.",
    errorTokenRequired: "Enter the token first.",
    errorPasteEmpty: "The paste box is empty.",
    errorPasteNotJson: "The pasted text is not JSON. Expected {\"base_url\":\"https://...\",\"token\":\"...\"}.",
    errorPasteMissing: "The pasted text has no base_url or token, or they are not strings.",
    errorClipboardEmpty: "The clipboard is empty or holds no text.",
    errorClipboardShape: "Reading the clipboard returned a non-text result, so no configuration text was obtained.",
    errorCheckUnreadable: "The check result could not be read; the tool returned an unexpected structure. See the app log for details.",
    errorMigrateFailed: "Migrating the legacy configuration keys failed. See the app log for details; you can also re-enter and save the base URL and token by hand.",
    verdictOk: "Reachable and the token is accepted.",
    verdictTokenRejected: "Reachable but the token was rejected.",
    verdictPathNotFound: "Reachable but the endpoint path does not exist.",
    verdictServerError: "Reachable but the server itself failed.",
    verdictUnexpected: "Reachable but the response does not match the upload contract.",
    verdictUnreachable: "Cannot reach the server.",
    checkDetail: "Detail",
};

function resolveTexts(): Texts {
    const lang = (getLang() ?? "").toLowerCase();
    return lang.startsWith("en") ? EN : ZH;
}

function verdictText(texts: Texts, verdict: CheckVerdict): string {
    if (verdict === "ok") {
        return texts.verdictOk;
    }
    if (verdict === "token_rejected") {
        return texts.verdictTokenRejected;
    }
    if (verdict === "path_not_found") {
        return texts.verdictPathNotFound;
    }
    if (verdict === "server_error") {
        return texts.verdictServerError;
    }
    if (verdict === "unreachable") {
        return texts.verdictUnreachable;
    }
    return texts.verdictUnexpected;
}

function toErrorText(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error ?? "");
}

function maskToken(token: string): string {
    if (token.length <= 8) {
        return "*".repeat(token.length);
    }
    return `${token.slice(0, 4)}${"*".repeat(token.length - 8)}${token.slice(-4)}`;
}

// 解析一段配置文本。只认 JSON 且 base_url 与 token 都必须是非空字符串，
// 不做键名猜测也不做默认值填充：猜错了会把配置写到错的地方，比直接报错难查得多。
function parseConfigText(raw: string, texts: Texts): { baseUrl: string; token: string } {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error(texts.errorPasteEmpty);
    }
    let parsed: { base_url?: unknown; token?: unknown };
    try {
        parsed = JSON.parse(trimmed) as { base_url?: unknown; token?: unknown };
    } catch (error) {
        console.log(`解析配置文本失败：${toErrorText(error)}`);
        throw new Error(texts.errorPasteNotJson);
    }
    const baseUrl = typeof parsed.base_url === "string" ? parsed.base_url.trim() : "";
    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    if (!baseUrl || !token) {
        throw new Error(texts.errorPasteMissing);
    }
    return { baseUrl, token };
}

// 把任意值收敛成判定枚举，认不出来就返回 null 由调用方报错
function toVerdict(value: unknown): CheckVerdict | null {
    if (
        value === "ok" ||
        value === "token_rejected" ||
        value === "path_not_found" ||
        value === "server_error" ||
        value === "unexpected_status" ||
        value === "unreachable"
    ) {
        return value;
    }
    return null;
}

// callTool 对对象型结果返回的是 JSON 字符串（宿主实测如此），所以要解析一层。
// 字段缺失就报错，不猜也不填默认值：自检结论说错了比不显示更糟。
function parseCheckResult(raw: string, texts: Texts): CheckResult {
    let parsed: { httpStatus?: unknown; serverMessage?: unknown; verdict?: unknown };
    try {
        parsed = JSON.parse(raw) as { httpStatus?: unknown; serverMessage?: unknown; verdict?: unknown };
    } catch (error) {
        console.log(`解析自检结果失败：${toErrorText(error)}`);
        throw new Error(texts.errorCheckUnreadable);
    }
    const verdict = toVerdict(parsed.verdict);
    if (verdict === null || typeof parsed.httpStatus !== "number") {
        throw new Error(texts.errorCheckUnreadable);
    }
    return {
        success: verdict === "ok",
        verdict,
        reachable: verdict !== "unreachable",
        httpStatus: parsed.httpStatus,
        serverMessage: typeof parsed.serverMessage === "string" ? parsed.serverMessage : "",
    };
}

export default function Screen(ctx: ComposeDslContext): ComposeNode {
    const texts = resolveTexts();
    const [baseUrl, setBaseUrl] = ctx.useState<string>(
        "baseUrl",
        ctx.getEnv(ENV_BASE_URL) ?? ""
    );
    const [token, setToken] = ctx.useState<string>("token", ctx.getEnv(ENV_TOKEN) ?? "");
    const [pasted, setPasted] = ctx.useState<string>("pasted", "");
    const [message, setMessage] = ctx.useState<string>("message", "");
    const [messageIsError, setMessageIsError] = ctx.useState<boolean>("messageIsError", false);
    const [busy, setBusy] = ctx.useState<boolean>("busy", false);

    const reportError = (text: string): void => {
        setMessageIsError(true);
        setMessage(text);
    };

    const reportOk = (text: string): void => {
        setMessageIsError(false);
        setMessage(text);
    };

    const validateInputs = (): { baseUrl: string; token: string } => {
        const url = baseUrl.trim();
        const secret = token.trim();
        if (!url) {
            throw new Error(texts.errorBaseUrlRequired);
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            throw new Error(texts.errorBaseUrlScheme);
        }
        if (!secret) {
            throw new Error(texts.errorTokenRequired);
        }
        return { baseUrl: url, token: secret };
    };

    // 自检一次并把结论整理成一句可展示的话。保存与「测试连接」共用它。
    const performCheck = async (): Promise<{ ok: boolean; summary: string }> => {
        const raw = await ctx.callTool<string>(CHECK_TOOL, {});
        const result = parseCheckResult(raw, texts);
        const summary = verdictText(texts, result.verdict);
        const detail = result.serverMessage
            ? `HTTP ${result.httpStatus} · ${result.serverMessage}`
            : `HTTP ${result.httpStatus}`;
        return { ok: result.success, summary: `${summary}（${detail}）` };
    };

    // 保存后立刻自检一次，让「配置是否真的能用」当场有个答案
    const save = async (): Promise<void> => {
        setBusy(true);
        setMessage("");
        try {
            const values = validateInputs();
            await ctx.setEnv(ENV_BASE_URL, values.baseUrl);
            await ctx.setEnv(ENV_TOKEN, values.token);
            setBaseUrl(values.baseUrl);
            setToken(values.token);
            const outcome = await performCheck();
            if (outcome.ok) {
                reportOk(`${texts.savedOk}${outcome.summary}`);
            } else {
                reportError(`${texts.savedOk}${outcome.summary}`);
            }
        } catch (error) {
            reportError(toErrorText(error));
        } finally {
            setBusy(false);
        }
    };

    const check = async (): Promise<void> => {
        setBusy(true);
        setMessage("");
        try {
            const outcome = await performCheck();
            if (outcome.ok) {
                reportOk(outcome.summary);
            } else {
                reportError(outcome.summary);
            }
        } catch (error) {
            reportError(toErrorText(error));
        } finally {
            setBusy(false);
        }
    };

    const fillFrom = (raw: string, okText: string): void => {
        try {
            const values = parseConfigText(raw, texts);
            setBaseUrl(values.baseUrl);
            setToken(values.token);
            reportOk(okText);
        } catch (error) {
            reportError(toErrorText(error));
        }
    };

    const importFromClipboard = async (): Promise<void> => {
        setBusy(true);
        setMessage("");
        try {
            const raw = await ctx.callTool<string>(CLIPBOARD_TOOL, {});
            if (typeof raw !== "string") {
                throw new Error(texts.errorClipboardShape);
            }
            if (!raw.trim()) {
                throw new Error(texts.errorClipboardEmpty);
            }
            fillFrom(raw, texts.pasteImported);
        } catch (error) {
            reportError(toErrorText(error));
        } finally {
            setBusy(false);
        }
    };

    const parsePasted = (): void => {
        fillFrom(pasted, texts.pasteParsed);
    };

    // 页面加载时先把早期版本带 XHS_ 前缀的旧键搬到中立键上，再刷新两个输入框。
    //
    // 待迁移的键不只是本包留下的，抖音与小红书采集页也调同一个迁移，
    // 两边谁先被打开都不影响结果。迁移是幂等的，跑完之后每次都是空操作。
    //
    // 必须把 promise 返回给宿主，不能写成 `() => { void migrateOnLoad(); }`：
    // 那样宿主会把这个动作当同步的，动作一结束就注销状态变化监听，
    // await 之后的 setBaseUrl 就没有监听者，页面会一直停在迁移前的空值上。
    const migrateOnLoad = async (): Promise<void> => {
        try {
            await ctx.callTool(MIGRATE_TOOL, {});
            setBaseUrl(ctx.getEnv(ENV_BASE_URL) ?? "");
            setToken(ctx.getEnv(ENV_TOKEN) ?? "");
        } catch (error) {
            console.log(`旧配置键迁移失败：${toErrorText(error)}`);
            reportError(texts.errorMigrateFailed);
        }
    };

    const savedBaseUrl = ctx.getEnv(ENV_BASE_URL) ?? "";
    const savedToken = ctx.getEnv(ENV_TOKEN) ?? "";
    const effective = savedBaseUrl
        ? `${savedBaseUrl} · ${savedToken ? maskToken(savedToken) : texts.notConfigured}`
        : texts.notConfigured;

    const children: ComposeNode[] = [
        ctx.UI.Text({ text: texts.title, style: "titleMedium" }),
        ctx.UI.Text({ text: texts.intro, style: "bodySmall", color: "onSurfaceVariant" }),
        ctx.UI.TextField({
            label: texts.baseUrlLabel,
            placeholder: texts.baseUrlPlaceholder,
            value: baseUrl,
            onValueChange: setBaseUrl,
            singleLine: true,
        }),
        ctx.UI.TextField({
            label: texts.tokenLabel,
            placeholder: texts.tokenPlaceholder,
            value: token,
            onValueChange: setToken,
            singleLine: true,
        }),
        ctx.UI.Button({
            text: busy ? texts.saving : texts.save,
            enabled: !busy,
            fillMaxWidth: true,
            onClick: save,
        }),
        ctx.UI.Button({
            text: busy ? texts.checking : texts.check,
            enabled: !busy,
            fillMaxWidth: true,
            onClick: check,
        }),
        ctx.UI.Text({ text: texts.checkHint, style: "bodySmall", color: "onSurfaceVariant" }),
        ctx.UI.TextField({
            label: texts.pastedLabel,
            placeholder: texts.pastedPlaceholder,
            value: pasted,
            onValueChange: setPasted,
            minLines: 4,
        }),
        ctx.UI.Button({
            text: texts.parsePasted,
            enabled: !busy,
            fillMaxWidth: true,
            onClick: parsePasted,
        }),
        ctx.UI.Button({
            text: busy ? texts.importing : texts.importFromClipboard,
            enabled: !busy,
            fillMaxWidth: true,
            onClick: importFromClipboard,
        }),
        ctx.UI.Text({
            text: `${texts.effective}：${effective}`,
            style: "bodySmall",
            color: "onSurfaceVariant",
        }),
    ];

    if (message) {
        children.push(
            ctx.UI.Card(
                {
                    containerColor: messageIsError ? "errorContainer" : "surfaceVariant",
                    fillMaxWidth: true,
                },
                [
                    ctx.UI.Text({
                        text: message,
                        style: "bodyMedium",
                        color: messageIsError ? "onErrorContainer" : "onSurfaceVariant",
                    }),
                ]
            )
        );
    }

    return ctx.UI.LazyColumn(
        {
            fillMaxSize: true,
            padding: 16,
            spacing: 12,
            // 返回 promise（不要用 void 包一层），让宿主按异步动作处理，见 migrateOnLoad 的注释
            onLoad: () => migrateOnLoad(),
        },
        children
    );
}
