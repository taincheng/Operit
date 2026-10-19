# 01 服务端：字段与列改成平台中立的 content_id

[DONE]

## 改了什么

| 改动 | 位置 |
| --- | --- |
| 契约字段 `aweme_id` → `content_id`；校验从「纯数字」放宽到 `^[A-Za-z0-9_-]{1,64}$`（抖音 aweme_id / 快手 photoId / 小红书 noteId 三种形状都过） | `addons/collect/model/input/collectin/ingest.go` |
| 落库逻辑、身份预查、并发插入兜底全部改认 `content_id`；空身份仍落 NULL（`contentIdOrNil`） | `addons/collect/logic/sys/ingest.go` |
| 列 `content_id VARCHAR(64) NULL` + 唯一索引 `uk_collect_record_source_content (source, content_id)`；列定义仍只在 `collectRecordExtraColumns` 里写一次，建表与升级补列共用 | `addons/collect/migrate.go` |
| `install.sql` / `install-pg.sql` 同步 | `addons/collect/resource/sql/` |
| 生成物（无 DB 可跑 `gf gen dao`，手工同步并标注） | `internal/dao/internal/`、`internal/model/do/`、`internal/model/entity/` |
| 后台列表加「内容ID」列与筛选；详情抽屉显示，缺失时写明「未提供，不参与同内容合并」 | `sysin/collect.go`、`logic/sys/record.go`、`web/src/views/addons/collect/record/` |
| 版本 v1.2.0 → **v1.3.0**（中间态那一版没有发布，语义已换） | `main.go`、`install-data.sql` |
| 部署文档第 3.2 节改写成 v1.3.0，并加上「本地跑过中间态怎么清」的一次性 SQL | `docs/collect-deploy.md` |

## 为什么列宽是 64

抖音 aweme_id 19 位、快手 photoId 19 位、小红书 noteId 24 位，都是短 id；
但把上限一次性放到 64 就不必为下一个平台再改列宽，同时 `^[A-Za-z0-9_-]{1,64}$` 也挡住了
「把整个 URL 塞进来」这类误用（单测里钉了这条）。

## 为什么空身份必须是 NULL

唯一索引 `(source, content_id)` 底下，多个**空串**会被判成互相重复 ——
那样没有身份的记录只能入库一条。SQL 的唯一索引允许并列多个 NULL，所以
`contentIdOrNil("")` 返回 `nil`。单测 `TestContentIdOrNil` 钉住这条。

## 单测

- `TestValidateItemContentId`：三种平台的 id 形状都必须通过；带空格/斜杠/超长/整条 URL 必须拒。
- `TestShortCodeIsNotContentIdentity`：同一个视频的两个不同短码，`video_id` 不同而 `content_id` 相同。
- `TestContentIdOrNil`、`TestVideoKeyIsPairwise`。
