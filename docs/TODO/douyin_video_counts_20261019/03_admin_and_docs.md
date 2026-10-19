# 03 后台展示、契约文档与上线手册

## 1. 后台（hotgo）

记录表现在就是「一行一视频」，所以**不需要新增列表页**，只要把计数显示出来：

- `server/addons/collect/model/input/sysin/collect.go` 的 `RecordListModel` 增加
  `likeCount` / `commentCount` / `collectCount` / `countsAt` / `interactionText`
- `web/src/views/addons/collect/record/model.ts`：
  - `State` 加同名字段
  - 表格 `columns` 在「视频标识」之后插三列（点赞 / 评论 / 收藏），列宽收窄，空值显示为 `-`
    （**不能显示成 0**：null 是「没观测到」，0 是「确实是 0」）
  - 搜索项不动：计数范围筛选没有需求
- `web/src/views/addons/collect/record/index.vue`：
  - 顶部卡片说明改成事实描述：「同一个视频只保留一行，再次采到会更新点赞/评论/收藏三个计数与计数时间」
    （现在是「同一设备同一幂等键只会入库一次」，已经不准了）
  - 详情抽屉在「作者」之后加三条 `n-descriptions-item` 与「计数时间」「互动条原文」；
    「采集时间」标注为首次采集时间，与「计数时间」区分开
- `logic/sys/record.go` 的 `List` / `View` / `Delete` 都不改：
  `Fields(sysin.RecordListModel{})` 会按结构体字段自动带出新列

删除语义确认一遍并写进注释：软删除的行仍然占着 `(source, video_id)` 唯一索引，
该视频之后的上报会被判为「同视频观测」，更新到一行 `deleted_at` 非空的行上，
后台查不到但也不会新建行。这是既有行为（原来的 `uk_device_idem` 也是同样的后果），
本次不引入「删除后可重新入库」，但要在注释里写清楚，避免以后被当成 bug 排查。

## 2. 上报契约文档（本仓库）

`docs/TODO/device_automation_platform_20261008/server_api.md`：

- 「请求体」示例补上 `like_count` / `comment_count` / `collect_count` / `counts_at` / `interaction_text`
- 字段说明表补五行，**必须写明三条**：
  1. 三个计数是**可选**字段，老客户端与另外两个采集包不发；服务端不得因为缺失而拒绝整条记录
  2. 服务端**不得把缺失当成 0**：缺失意味着「本次没有观测到计数」，已有计数保持不动
  3. `counts_at` 是计数的观测时间，与 `collected_at`（首次采集时间）不是一回事；
     服务端按它做单调判断，更早的观测不能覆盖更新的观测
- 增加一节「同一视频的多次观测」，把新的服务端行为写死：
  - 视频身份 = `source` + 从 `url` 路径段抽出的标识（`source` 由域名反查，不看客户端填的 `source`）
  - 首次观测：插入一行
  - 再次观测：更新该行的三个计数、`counts_at`、`interaction_text`，**不新增行**；
    首次采集信息（`collected_at` / `device` / `idempotency_key` / `keyword` / `batch_id`）保持不变
  - 因此 `idempotency_key` 仍在 `(device, idempotency_key)` 上唯一，但**不再等于「一行一条」**
- 「存储建议」一节补：唯一索引除 `(device, idempotency_key)` 外还有 `(source, video_id)`；
  给一条预检 SQL（有重复历史数据时索引建不起来）
- 「兼容性与演进」一节补一句：仍是向后兼容的加字段变更，路径版本不需要换

同目录 `mock_server.py` 顺带扩一下：请求体样例带计数并演示「同视频第二次上报不新增行」，
响应行为不变（它是联调用的参考实现）。

## 3. 包文档（本仓库）

`my-packages/README.md`：

- 「包内工具」表里 `douyin_collect_share_links` 一行补上「同时读互动计数」，
  `douyin_collect_share_link` 补上返回值多出三个计数
- 「分片与续跑」一节补「重复视频不再是纯跳过：每遇到一次就重新取链并更新那三个计数，
  本片预算按『新增 + 更新』计」
- 「记录、状态与进度」附近说明 `records.jsonl` 现在是**一个视频一行**，以及新增的字段；
  同时说明 `outbox.json` 会清掉上一轮观测留下的孤儿键

`my-packages/douyin-collector/src/packages/douyin_collector.ts` 顶部的 `METADATA`：
`douyin_collect_share_links` 与 `douyin_collect_share_link` 的中英文描述都要同步
（宿主会把它展示给模型与用户）。`manifest.json` 的描述里那句「按关键词采集抖音搜索结果的分享链接」
也要带上计数。

## 4. 上线手册（hotgo）

`docs/collect-deploy.md`：

- 开头「先决事实」表：
  - 本次变更从「不改任何既有表」改成「**给 `hg_addon_collect_record` 加 5 列 + 1 个唯一索引**」
  - 破坏性操作一栏从「无」改成「5 次 `ADD COLUMN`（均可空或带默认值，不重写已有行）+ 1 次
    `ADD UNIQUE KEY`；**若历史数据里存在同 `(source, video_id)` 的多行，加索引会失败**」
  - 回滚成本一栏补上「回滚旧二进制后新列与新索引仍在，不影响旧代码读写」
- 新增一节「本次升级步骤」：备份 → 预检重复行 SQL → 打包 → 覆盖二进制 → 重启 →
  后台「插件管理 → 采集接入 → 更新」。写明**只重启不点更新就不会迁移**，
  症状是上报时报 `Unknown column 'like_count'`
- 预检 SQL 与「发现重复行怎么办」一并写进去。**不在代码里做自动合并**（挑哪一行的计数、删哪些行是
  数据决策），但手册里给出建议 SQL 供人工执行：按 `(source, video_id)` 分组，
  保留 `counts_at`（或 `collected_at`）最新的那一行，其余行先导出留档再删。执行前必须备份

## 5. 期待的新实现

后台行内直接能看到三个计数与计数时间，并且知道 null 与 0 的区别；
上线手册能让人独立完成一次「加列 + 加唯一索引」的升级，包括预检与失败处置；
契约文档让服务端实现方知道缺失计数不能当 0、更早的观测不能覆盖更新的观测。

[DONE]
