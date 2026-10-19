# 三个采集包的短链身份取证（2026-10-19）

`content_id` 的解析规则不是猜的，是拿真实分享链接打出来的。这份文件是原始取证，
配套的可重跑断言见 [verify_content_identity.mjs](verify_content_identity.mjs)。

## 快手：三个不同短码 → 同一个 photoId

从本地 `records.jsonl` 里挑出「同一个作品（小陈家装｜这风格老铁们喜欢吗 "装修）被采成 4 行」
的那几个短码，逐个 GET（`curl -L`，移动端 Safari UA）：

| 分享短码 | 跳转后地址 | 页面里的 `"photoId"` |
| --- | --- | --- |
| `KlSb2UEZ` | `v.m.chenzhongtech.com/fw/photo/3xhyi8p93jwdydm?...` | `5238531002599057662` |
| `JW1dhvtt` | `v.m.chenzhongtech.com/fw/photo/3xhyi8p93jwdydm?...` | `5238531002599057662` |
| `7IFbHrYb` | `v.m.chenzhongtech.com/fw/photo/3xhyi8p93jwdydm?...` | `5238531002599057662` |
| `JMr9Ziyt` | （同一作品，本地记录里第 4 行） | — |

结论：短码每次都变（所以不能当身份），页面 JSON 里的 `photoId` 稳定。
解析规则取 `"photoId"\s*:\s*"([A-Za-z0-9_-]+)"`，页面存成
[fixture_ks_share_page.html](fixture_ks_share_page.html)（`7IFbHrYb` 那一份，184,819 字节；抓回来后只去了行尾空白，内容未改）。

跳转地址里的 `photoId=3xhyi8p93jwdydm` 与页面 JSON 里的 `5238531002599057662` 是两个不同的 id；
两者在三个短码下都一致，这里取**页面 JSON 里那个**（结构化字段，比在 URL 子串里找稳）。

## 小红书：短码实测稳定，但仍统一解析 noteId

| 分享短码 | 跳转后地址 | 页面里的 `"noteId"` |
| --- | --- | --- |
| `5KLvfJy1mFj` | `www.xiaohongshu.com/discovery/item/6a263ade0000000022024db0?...` | `6a263ade0000000022024db0` |

321 条历史记录里只有 1 组重复，而且那两行是**同一个 URL、相差 1 秒**（同一秒重复写），
不是短码漂移。所以小红书的短码本来就能当身份；这里仍按契约统一解析 `noteId`，
让服务端三个来源都用 `(source, content_id)` 判重。

页面存成 [fixture_xhs_share_page.html](fixture_xhs_share_page.html)（65,678 字节；同样只去了行尾空白）。

## 抖音（对照，详细取证在另一个目录）

见 [../douyin_video_counts_20261019/evidence_shortlink_redirects.txt](../douyin_video_counts_20261019/evidence_shortlink_redirects.txt)：
同一个视频 27 分钟内 5 个短码，都跳到 `/share/video/7672977497508440818/`。

## 本地历史记录的重复率（修复前的现状）

| 包 | 记录总数 | 不同 (作者, 标题) | 重复行 |
| --- | --- | --- | --- |
| 抖音（修复前） | 470 | 98 | 372（79%） |
| 快手 | 562 | 153 | 409（72%） |
| 小红书 | 321 | 320 | 1（0%） |
