# 01 计数来源：分享页的 interactInfo

## 旧实现

`resolveContentId` 用 `Tools.Net.http` GET 短链（自动跟随 302），从返回的 HTML 里只正则取 `"noteId"`，
其余内容丢掉。同一次响应里已经有 `"interactInfo":{"likedCount":...,"collectedCount":...,"commentCount":...}`。

## 实测（2026-10-20，Mac 直连，非设备）

请求头与包内完全一致：

```
User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 ... EdgiOS/121.0.2277.107 ...
Accept-Language: zh-CN,zh;q=0.9,en;q=0.8
```

抓了仓库里出现过的 11 条真实短链（4 图文 + 7 视频），**11/11 都有 `noteId` 与 `interactInfo`**：

| 短链 | 类型 | likedCount | commentCount | collectedCount |
| --- | --- | --- | --- | --- |
| 27kYsBC1b8D | video | `8661` | `176` | `6057` |
| 2sZ7DQHIS2g | normal | `51` | `7` | `15` |
| 4DVI09Pqrga | normal | `32` | `21` | `3` |
| 4NRSKPo3tXn | video | `90` | `10` | `54` |
| 5RyEkTS4Kvu | video | `9` | `1` | `4` |
| 66lFgudICDX | video | `1085` | `35` | `800` |
| 7BmccjtqDyU | video | `802` | `4` | `288` |
| 85Lns6HOD4i | normal | `1387` | `36` | `698` |
| A823cOAFiCS | video | `10万+` | `2597` | `6.9万` |
| AtCIdOLGWGj | video | `3` | `2` | `2` |
| g1lutXN4tH | video | `4` | `""` | `10` |

不加 `Accept-Language: zh-CN` 时同一页面会返回 `100K+` / `2,597` / `69.1K` 这种英文写法，
所以解析器同时支持万/亿/K/M、千分位逗号与结尾 `+`；包内请求头固定为中文，实际只会遇到前两种。

## 两条口径

1. **封顶缩写**：计数 ≥ 10 万时页面只给「10万+」，真实值拿不到，折成下限 100000。
   这与抖音的「41.4万」是同一类有损缩写，原始字符串写进 `interaction_text` 供回查。
2. **空串是 0**：`g1lutXN4tH` 的 `commentCount` 是空串，同一页 `commentData.commentCount` 为 `0`，
   其余 10 条两处数值完全一致。所以空串按 0 处理，不写成 `null`。
   字段本身缺失（不是空串）才算页面改版，直接抛错、不写记录。

## 解析规则

```ts
const XHS_INTERACT_INFO_PATTERN = /"interactInfo"\s*:\s*\{([^{}]*)\}/;
const COUNT_TEXT_PATTERN = /^(\d+(?:\.\d+)?)(万|亿|[KkMm])?\+?$/;
```

- 先取第一个 `interactInfo` 块（页面里渲染了两份，内容相同）
- 逐字段取 `likedCount` / `collectedCount` / `commentCount` 的字符串值
- 去掉空白与千分位逗号；空串 → 0；其余必须完整匹配 `COUNT_TEXT_PATTERN`，否则抛错
- 万 ×10000、亿 ×100000000、K ×1000、M ×1000000，四舍五入成整数

## 记录字段

`CollectedRecord` 新增：

| 字段 | 说明 |
| --- | --- |
| `like_count` | 点赞数（整数，0 合法） |
| `comment_count` | 评论数 |
| `collect_count` | 收藏数 |
| `interaction_text` | 三项原文，形如 `likedCount=10万+\|collectedCount=6.9万\|commentCount=2597` |
| `counts_at` | 这三个计数是哪一刻从分享页观测到的，ISO8601 |

`xhs_collect_share_link` 的返回值同时带上 `likeCount` / `commentCount` / `collectCount` / `interactionText`。

## 设备确认（2026-10-20，24094RAD4C / 小红书 9.22.1）

设备上实测通过：

- `Tools.Net.http` 取回的分享页带 `interactInfo`，解析结果与 Mac 直连一致；
  `A823cOAFiCS` → `10万+ / 2597 / 6.9万` 折成 `100000 / 2597 / 69000`，`5YIkSwnLXTq` → `787 / 13 / 137`
- 正常采集日志逐条打印三个计数，例如 `赞 224、评 1、藏 302`、`赞 165、评 0、藏 161`（空 `commentCount` 记为 0）
- 同一片里再次遇到旧记录时走 `已在库里，更新计数`，不新增行

证据见 [03_verification.md](03_verification.md)。
