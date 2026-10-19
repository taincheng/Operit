'use strict';

/**
 * 一次性探针：短链解析走哪条通道。
 *
 * 要回答两件事（结果决定 05 文档里第 1 步怎么写）：
 *   1. Tools.Net.http 对 v.douyin.com 短链是否自动跟随 302、交回最终页 HTML
 *   2. 若跟随，最终页里能不能按 rel="canonical" 抽出稳定的 aweme_id
 *
 * 参数：{ "url": "https://v.douyin.com/xxxx/" }
 * 只读，不发任何写请求。
 */

async function probeNetHttp(params) {
    const url = params && params.url ? String(params.url) : "https://v.douyin.com/XWzooKgwlfw/";
    const report = { url };

    try {
        const response = await Tools.Net.http({
            url,
            method: "GET",
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            connect_timeout: 10000,
            read_timeout: 15000,
        });

        const content = String(response.content ?? "");
        report.statusCode = response.statusCode;
        report.headerKeys = Object.keys(response.headers ?? {});
        report.location = (response.headers ?? {})["Location"] ?? (response.headers ?? {})["location"] ?? "";
        report.contentLength = content.length;
        report.contentHead = content.slice(0, 200);
        report.containsRouterData = content.includes("_ROUTER_DATA");
        report.containsCanonical = content.includes('rel="canonical"');

        const canonical = content.match(/rel="canonical"[^>]*href="([^"]+)"/);
        const videoInUrl = canonical ? canonical[1].match(/\/video\/(\d+)/) : null;
        const lastPath = content.match(/"lastPath"\s*:\s*"(\d+)"/);
        const awemeIdInJson = content.match(/\\?"aweme_id\\?"\s*:\s*\\?"(\d+)\\?"/);
        report.canonicalHref = canonical ? canonical[1] : "";
        report.awemeIdFromCanonical = videoInUrl ? videoInUrl[1] : "";
        report.awemeIdFromLastPath = lastPath ? lastPath[1] : "";
        report.awemeIdFromJson = awemeIdInJson ? awemeIdInJson[1] : "";
    } catch (error) {
        report.error = error instanceof Error ? error.message : String(error);
    }

    return report;
}

exports.probeNetHttp = probeNetHttp;
