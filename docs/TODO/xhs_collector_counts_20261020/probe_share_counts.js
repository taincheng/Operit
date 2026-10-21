// 真机探针：确认设备侧 Tools.Net.http 取到的分享页里有没有 noteId 与 interactInfo。
//
// 用法（设备接好后）：
//   ./tools/adb/execute_js.sh docs/TODO/xhs_collector_counts_20261020/probe_share_counts.js \
//       probeShareCounts '{"urls":["https://xhslink.cn/o/85Lns6HOD4i","https://xhslink.cn/o/A823cOAFiCS"]}'
//
// 只读取、不写任何文件，也不改剪贴板。输出里 interactInfo 为原文，便于和 App 详情页底栏对照。

const SHARE_PAGE_USER_AGENT =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1";

const NOTE_ID_PATTERN = /"noteId"\s*:\s*"([0-9a-fA-F]{16,32})"/;
const INTERACT_INFO_PATTERN = /"interactInfo"\s*:\s*\{([^{}]*)\}/;

async function probeShareCounts(params) {
    const urls = params && params.urls ? params.urls : [];
    if (!urls.length) {
        throw new Error("需要 urls 数组");
    }
    const results = [];
    for (let i = 0; i < urls.length; i += 1) {
        const url = urls[i];
        const response = await Tools.Net.http({
            url,
            method: "GET",
            headers: {
                "User-Agent": SHARE_PAGE_USER_AGENT,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
            connect_timeout: 10000,
            read_timeout: 15000,
        });
        const html = String(response.content ?? "");
        const note = html.match(NOTE_ID_PATTERN);
        const interact = html.match(INTERACT_INFO_PATTERN);
        results.push({
            url,
            statusCode: response.statusCode,
            htmlLength: html.length,
            noteId: note ? note[1] : null,
            interactInfo: interact ? interact[1] : null,
            interactInfoOccurrences: (html.match(/"interactInfo"/g) || []).length,
        });
        if (i + 1 < urls.length) {
            await Tools.System.sleep(1000);
        }
    }
    return results;
}

exports.probeShareCounts = probeShareCounts;
