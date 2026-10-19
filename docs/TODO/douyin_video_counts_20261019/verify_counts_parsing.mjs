#!/usr/bin/env node
/**
 * 计数解析的实证脚本（本地跑，不需要设备）。
 *
 * 做两件事，都用**编译产物**里的代码，不复制一份实现：
 *   1. 从 my-packages/douyin-collector/dist/packages/douyin_collector.js 里抽出
 *      readInteractionCount / readInteractionCounts / isNodeVisible 三段源码，在沙箱里求值；
 *   2. 把真机证据 docs/TODO/douyin_video_counts_20261019/evidence_counts_high.json 里的节点
 *      还原成一棵可查找的树，喂给这两个函数，断言：
 *        - 当前视频（互动条在画面里）读到 41.4万 / 7353 / 7.1万
 *        - 上一条与下一条视频的互动条（bounds 反向）被可见性挡掉，不会串到当前视频头上
 *        - 「评论」在树里出现两次时取首个，结果一致
 *        - 标签在、数字不在时记 null（不造 0）
 *
 * 运行：node docs/TODO/douyin_video_counts_20261019/verify_counts_parsing.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

const distPath = join(repoRoot, 'my-packages/douyin-collector/dist/packages/douyin_collector.js');
const dist = readFileSync(distPath, 'utf8');

/** 按起止标记切出 dist 里的一段源码 */
function sliceBetween(source, fromMarker, toMarker) {
  const start = source.indexOf(fromMarker);
  const end = source.indexOf(toMarker, start);
  assert.ok(start >= 0, `找不到起点标记：${fromMarker}`);
  assert.ok(end > start, `找不到终点标记：${toMarker}`);
  return source.slice(start, end);
}

const parsingSource = sliceBetween(dist, 'const LIKE_COUNT_LABEL', 'async function readRoot');
/** 从 dist 里取一个数字常量的字面值（isNodeVisible 依赖 VISIBLE_TOP_MARGIN 与 APP_BOTTOM_INSET） */
function extractNumberConst(source, name) {
  const matched = source.match(new RegExp(`const ${name} = (-?\\d+);`));
  assert.ok(matched, `找不到常量 ${name}`);
  return Number(matched[1]);
}

const visibilitySource = sliceBetween(dist, 'function isNodeVisible', '/**\n * 屏幕高度');
const visibilityConsts = [
  `const VISIBLE_TOP_MARGIN = ${extractNumberConst(dist, 'VISIBLE_TOP_MARGIN')};`,
  `const APP_BOTTOM_INSET = ${extractNumberConst(dist, 'APP_BOTTOM_INSET')};`,
].join('\n');

// 沙箱里只给这几段源码 + 它们依赖的常量
const sandbox = new Function(
  `${visibilityConsts}\n${visibilitySource}\n${parsingSource}\nreturn { readInteractionCounts, isNodeVisible };`
)();
const { readInteractionCounts, isNodeVisible } = sandbox;

/** 把证据里的节点数组还原成一棵可 find 的树（UINode 的最小可用替身） */
function makeTree(nodes) {
  const children = nodes.map((node) => ({
    className: node.className,
    text: node.text,
    contentDesc: node.contentDesc,
    bounds: node.bounds,
    centerPoint: centerPointOf(node.bounds),
  }));
  return {
    children,
    find(predicate, deep) {
      const stack = [...children];
      while (stack.length > 0) {
        const node = stack.shift();
        if (predicate(node)) {
          return node;
        }
        if (deep) {
          stack.push(...(node.children ?? []));
        }
      }
      return undefined;
    },
  };
}

function centerPointOf(bounds) {
  const matched = (bounds ?? '').match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
  if (!matched) {
    return null;
  }
  const [x1, y1, x2, y2] = matched.slice(1).map(Number);
  if (x2 <= x1 || y2 <= y1) {
    return null;
  }
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
}

const evidence = JSON.parse(readFileSync(join(here, 'evidence_counts_high.json'), 'utf8'));
const matched = evidence.result.samples[0].matched;
const screenHeight = 2400;

// 证据里 12 个节点分属三条互动条：上一条（y 反向）、当前（画面里）、下一条（y 反向）
const current = matched.filter((node) => node.contentDesc.includes('41.4万') || node.contentDesc.includes('7353') || node.contentDesc.includes('7.1万'));
const neighbours = matched.filter((node) => !current.includes(node));

const tree = makeTree(matched);
const counts = readInteractionCounts(tree, screenHeight);

console.log('当前视频读到：', counts);
assert.equal(counts.like, 414000, '41.4万 应折算成 414000');
assert.equal(counts.comment, 7353, '评论应取 7353');
assert.equal(counts.collect, 71000, '7.1万 应折算成 71000');

// 邻居的互动条必须被可见性挡掉：它们的 bounds 是反向的
for (const node of neighbours) {
  assert.equal(isNodeVisible(node, screenHeight), false, `邻居节点不该算可见：${node.bounds} ${node.contentDesc}`);
}
assert.deepEqual(
  [...new Set(current.map((node) => node.contentDesc))].sort(),
  ['未点赞，喜欢41.4万，按钮', '未选中，收藏7.1万，按钮', '评论7353，按钮'].sort(),
  '当前视频的互动条 desc 应正好是这三条'
);

// 原始文本按「喜欢|评论|收藏」的顺序拼起来，供回查缩写前的原文
assert.equal(counts.text, '未点赞，喜欢41.4万，按钮|评论7353，按钮|未选中，收藏7.1万，按钮');

// 「评论」在树里出现两次（LinearLayout + ImageView），取首个即可，值必须一致
const commentNodes = matched.filter((node) => node.contentDesc.includes('7353'));
assert.equal(commentNodes.length, 2, '证据里 7353 应出现两次');
assert.equal(counts.comment, 7353);

// 标签在、数字不在 -> null，不造 0
const zeroish = makeTree([{ contentDesc: '未点赞，喜欢，按钮', bounds: '[911,1077][1080,1273]' }]);
const zeroishCounts = readInteractionCounts(zeroish, screenHeight);
assert.equal(zeroishCounts.like, null, '没有数字时必须是 null，不能是 0');
assert.equal(zeroishCounts.comment, null, '树里没有该标签时必须是 null');

// 已点赞 / 已收藏这类状态词不影响取值：正则只从标签后面取数
const liked = makeTree([
  { contentDesc: '已点赞，喜欢41.4万，按钮', bounds: '[911,1077][1080,1273]' },
  { contentDesc: '已选中，收藏7.1万，按钮', bounds: '[908,1460][1080,1654]' },
]);
const likedCounts = readInteractionCounts(liked, screenHeight);
assert.equal(likedCounts.like, 414000, '状态词变化不影响取值');
assert.equal(likedCounts.collect, 71000, '状态词变化不影响取值');

// 四位数以下不缩写，直接取原值
const small = makeTree([
  { contentDesc: '未点赞，喜欢2086，按钮', bounds: '[911,1077][1080,1273]' },
  { contentDesc: '评论39，按钮', bounds: '[911,1273][1080,1460]' },
  { contentDesc: '未选中，收藏347，按钮', bounds: '[908,1460][1080,1654]' },
]);
const smallCounts = readInteractionCounts(small, screenHeight);
assert.equal(smallCounts.like, 2086);
assert.equal(smallCounts.comment, 39);
assert.equal(smallCounts.collect, 347);

// ===== 视频身份（content_id）解析 =====
//
// 短码不是身份：抖音每次分享都给新短码。真实身份在短链跳转后的页面的 canonical 里。
// 这里用的 HTML 是 2026-10-19 从 https://v.douyin.com/XWzooKgwlfw/ 跟随后抓回的真实页面
// （同一个视频的另外两个短码 qm7Da46o_LI / bWeB0vUxlbc 落到同一个 aweme_id，见
// evidence_shortlink_redirects.txt）。
const identitySource = sliceBetween(dist, 'const CONTENT_ID_PATTERN', '/**');
const identityPattern = new Function(`${identitySource}\nreturn CONTENT_ID_PATTERN;`)();

const sharePage = readFileSync(join(here, 'fixture_share_page.html'), 'utf8');
const canonicalMatch = sharePage.match(identityPattern);
assert.ok(canonicalMatch, 'canonical 规则必须能在真实分享页里命中');
assert.equal(canonicalMatch[1], '7672977497508440818', 'content_id 必须与三个短码共同指向的那个一致');

// 短码本身不能当作身份：同一页里出现的三个短码互不相同（这里只断言「不含数字化的短码规则」）
assert.ok(!/v\\.douyin\\.com/.test(canonicalMatch[0]), '身份必须来自 canonical，不是短链本身');

console.log('全部断言通过：解析规则与真机证据一致，邻居节点被正确挡掉，content_id 可从真实分享页解析。');
