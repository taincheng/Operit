// 三个采集包的 content_id 解析规则校验
//
// 规则直接取自编译产物（dist/packages/*.js），所以这份断言校验的是**真正发到设备上跑的代码**，
// 而不是源码里那句看起来一样的正则。fixture 是 2026-10-19 从真实分享短链抓回的页面。
//
// 跑法：node docs/TODO/collector_content_identity_20261019/verify_content_identity.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/** 取两个标记之间的源码片段，用来从编译产物里捞出常量定义。 */
function sliceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `产物里找不到 ${startMarker}`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `产物里找不到 ${startMarker} 之后的 ${endMarker}`);
    return source.slice(start, end);
}

/** 从编译产物里取一个正则常量。 */
function patternFrom(distPath, constName) {
    const source = readFileSync(distPath, 'utf8');
    const block = sliceBetween(source, `const ${constName}`, ';');
    return new Function(`${block}\nreturn ${constName};`)();
}

const cases = [
    {
        name: '抖音',
        dist: join(repoRoot, 'my-packages', 'douyin-collector', 'dist', 'packages', 'douyin_collector.js'),
        constName: 'CONTENT_ID_PATTERN',
        fixture: join(repoRoot, 'docs', 'TODO', 'douyin_video_counts_20261019', 'fixture_share_page.html'),
        expected: '7672977497508440818',
        // 抖音的规则认 canonical 里的 /video/<id>
        why: '同一个视频的 5 个短码都跳到这个 id',
    },
    {
        name: '快手',
        dist: join(repoRoot, 'my-packages', 'kuaishou-collector', 'dist', 'packages', 'ks_collector.js'),
        constName: 'KS_CONTENT_ID_PATTERN',
        fixture: join(here, 'fixture_ks_share_page.html'),
        expected: '5238531002599057662',
        why: '同一个作品的 3 个短码（KlSb2UEZ / JW1dhvtt / 7IFbHrYb）页面里都是这个 photoId',
    },
    {
        name: '小红书',
        dist: join(repoRoot, 'my-packages', 'xhs-collector', 'dist', 'packages', 'xhs_collector.js'),
        constName: 'XHS_CONTENT_ID_PATTERN',
        fixture: join(here, 'fixture_xhs_share_page.html'),
        expected: '6a263ade0000000022024db0',
        why: '短链跳转后的分享页里就是这个 noteId',
    },
];

for (const testCase of cases) {
    const pattern = patternFrom(testCase.dist, testCase.constName);
    const page = readFileSync(testCase.fixture, 'utf8');
    const matched = page.match(pattern);
    assert.ok(matched, `${testCase.name}：${testCase.constName} 必须在真实分享页里命中`);
    assert.equal(matched[1], testCase.expected, `${testCase.name}：解析出的 content_id 必须是那个稳定值（${testCase.why}）`);

    // 短码本身不能是身份：抖音与快手的短码每次都变，规则必须落在页面里的稳定字段上
    assert.ok(
        !/v\.(douyin|kuaishou)\.com/.test(matched[0]),
        `${testCase.name}：身份必须来自分享页里的稳定字段，不能是短链本身`
    );
    console.log(`${testCase.name}：${testCase.constName} -> ${matched[1]} ✔`);
}

console.log('三个包的 content_id 解析规则都从编译产物里取到，并与真实分享页一致。');
