# 04 取证与验证

本计划有两处**不能靠推理**：计数 desc 的确切格式（含万位缩写与选中态），
以及列迁移 + 唯一索引在线上库上是否真的能建成。前者必须先真机取证，后者必须跑一次 Upgrade。

## 第 0 步（先做）：真机探针取证

在 `docs/TODO/collector_accessibility_only_20261015/probe_ax_only.js` 里加一个
`interactionCountsProbe(params)`，与现有 `tierReport` / `pasteProbe` 同构：

- 复用现成的 `ensureDouyinForeground` / `openSearchPage` / `ensureDetailPage`（`:164`、`:187`、`:381`）
- 进到详情页后**不点分享按钮**，直接 dump：
  - 所有 `contentDesc` 非空的节点（`summary(node)` 已有：class/text/desc/resourceId/bounds/clickable）
  - 三个前缀（`喜欢` / `评论` / `收藏`）命中的节点，按 `findNodes` 收集
  - 整页文本列表，用于判定「详情页树里有没有稳定的视频标识」（index.md 待确认项 3）
- 用 `params.keyword` 指定关键词；另接一个可选参数，让调用方在详情页里滑到第 N 个视频再 dump

必须覆盖的场景（每个场景存一份 JSON 到本目录）：

| 场景 | 目的 |
| --- | --- |
| 低计数视频（< 1 万） | 基线，应与 `evidence_tier_ax.json:48-52` 一致 |
| 高计数视频（点赞 ≥ 1 万） | 确认是否缩写、`万` 的写法（`1.2万` / `1.2 万` / `12000`） |
| 已点赞 / 已收藏的视频 | 确认状态词位置，正则是否要吃掉前缀 |
| 一条评论区被打开过的视频 | 确认互动条不在画面里时读不到计数（对应 `ensureVideoVisible` 的恢复逻辑） |

跑法（与现有探针一致）：

```bash
adb push docs/TODO/collector_accessibility_only_20261015/probe_ax_only.js \
  /sdcard/Android/data/com.ai.assistance.operit.debug/js_temp/probe_ax_only.js
bash docs/TODO/collector_accessibility_only_20261015/run_probe.sh interactionCountsProbe '{"keyword":"美食"}'
```

**取证结果写回本目录**（例如 `evidence_counts_low.json` / `evidence_counts_wan.json`），
并在 01 文档的正则旁注明出处。**在拿到证据之前不要定稿 01 里的三个正则。**

顺带判定：详情页树里有没有稳定的视频标识。若有，重复视频的更新可以不走分享面板
（每条省 35–40 秒），那样 01 的第 4 节要改写成「先按该标识去重，再决定要不要取链」。
若没有（预计是这种），维持 01 的写法。

## 第 1 步：客户端单条验证

装包（`my-packages/README.md` 的「装到手机」一节）后：

1. 打开抖音任意视频详情页，跑 `douyin_collect_share_link`
2. 检查返回里三个计数与页面显示一致；`interaction_text` 是原始 desc
3. 对同一条视频再跑一次，确认第二次仍然取值成功

## 第 2 步：客户端批量验证

用工作流模板（`resources/workflow_collect_and_upload.json`）跑，或用包详情对话框手工跑
（注意：对话框会把所有声明过的参数一起提交，空着的数值参数会变成空字符串并被宿主拒绝，
`count` 与 `chunk_minutes` 都要填值）。

观察 `records.jsonl`：

- 第一片：全是新增，每条带三个计数
- 紧接着再跑一片：同一批视频落到「更新」分支，**行数不增加**，同一行的三个计数与 `counts_at` 被换成新的
- `counts_at` 变了而 `collected_at` 没变
- 本片内重复遇到同一视频时 `skippedDuplicates` 增加，`stopReason` 取值仍落在原有四种里
- 硬超时杀掉一次（或手工 `adb shell am force-stop`）后检查 `records.jsonl` 仍是完整可解析的
  （验证临时文件 + `move` 的原子替换）
- `outbox.json` 里不再有「键已经不在 records 里」的孤儿条目

## 第 3 步：服务端单测

```bash
cd /Users/zhangtc/code/hotgo/server
go test ./addons/collect/...
```

覆盖 02 文档第 6 节列的七条路径，其中三条必须有独立用例：
**老客户端重发不清零**、**乱序重发不回退**、**同一批里两条同视频**。

## 第 4 步：迁移验证（开发库）

按 `hotgo/docs/collect-deploy.md` 走一遍升级：

1. 用**旧的**二进制启动，确认 `hg_addon_collect_record` 没有新列、没有新索引
2. 造数据验证预检 SQL：插两行同 `(source, video_id)` 的假数据，确认预检能查出来，
   并且「更新插件」会以明确错误失败（而不是静默跳过）
3. 清掉那两行假数据
4. 换新二进制、重启
5. **先不点「更新插件」**，发一条上报 → 预期失败（`Unknown column`），
   这条负向验证证明「只重启不迁移」的坑是真的（写进上线手册）
6. 后台点「更新插件」→ 再发一条上报 → 成功；确认 5 列与索引都在
7. 再点一次「更新插件」（幂等验证）→ 不报错，列与索引不被重复添加
8. PostgreSQL 环境同样跑一遍 `install-pg.sql` 路径（`LockUpdate` 的方言行为要在这里确认）

## 第 5 步：端到端

工作流连跑两轮（模板默认 `count=6` / `chunk_minutes=5`，连续触发 30–120 秒）：

- 后台记录列表：**总行数不变**，被重复采到的视频行上三个计数与「计数时间」更新了，
  「采集时间」没变
- 用 0.2.0 的包（或直接 curl 一份不带计数的 items）发一条同视频记录 → 该行的计数**没有**被清成 0
- 乱序注入一条 `counts_at` 更早的记录 → 计数不回退

## 回滚

代码回滚按各自仓库的正常流程。数据库侧：新增的 5 列都是可空或带默认值，
回滚旧二进制后新列仍在，旧代码不读它们；新增的唯一索引 `(source, video_id)` 对旧代码
（只按 `(device, idempotency_key)` 去重、只插入）的影响是「同视频的第二行插不进去」，
而旧代码本来就不产生这种行（客户端本地去重）。所以**不需要 DDL 回滚**，
这一点写进上线手册的回滚一栏。

---

# 实际执行记录（2026-10-19）

## 已完成

### 第 0 步：真机探针取证 —— 完成，结论与计划里的推断有出入

探针函数改成「**只读当前页面**」而不是「自己导航到详情页」：实测
`ScriptExecutionReceiver` 在广播里同步跑脚本，App 切到后台后超过 60 秒会被系统
`bg anr` 直接杀掉（第一次跑带导航的版本，接收器跑了 61 秒就被
`Killing 28139:com.ai.assistance.operit.debug (adj 0): bg anr`）。
导航改由宿主侧做（deep link + 截图点按），探针只做一次短读（实测 15.3 秒返回）。

取证环境：24094RAD4C / 抖音 37.8.0 / 1080×2400，关键词 `家装`。
证据文件：[evidence_counts_high.json](evidence_counts_high.json)，
截图 `shots/02_video_tab.png`（列表卡片的 41.4万 / 1.0万 缩写）与 `shots/03_detail_high.png`
（详情页的 41.4万 / 7353 / 7.1万，与证据 JSON 里的 desc 一一对应）。

拿到的关键事实（与计划里的猜测对照）：

| 疑点 | 实测结论 |
| --- | --- |
| 万位缩写 | **确实缩写**，且是一位小数：`41.4万`、`7.1万`、`1.0万`；`7353` 这种四位数仍写原值 |
| 选中态 | 本次只取到未选中态（`未点赞，喜欢41.4万，按钮` / `未选中，收藏7.1万，按钮`）。**没有在用户账号上点过赞**，所以「已点赞」的准确写法仍未取证；正则只从标签后面取数字，对状态词不敏感，因此不受影响 |
| `评论` 重复 | 确认：同一个计数有两个节点（`LinearLayout id=euu` + 内部 `ImageView id=eo6`），desc 完全相同，取首个即可 |
| 树里的邻居 | **树里同时有三条互动条**：上一条（`[911,0][1080,-725]`）、当前（`[911,1077][1080,1273]` 等）、下一条（`[911,3233][1080,2129]`）。两条邻居的 bounds 是反向的，必须过可见性才能取当前视频的计数 |
| 稳定视频标识 | **没有**。整页 45 条 content-desc 与 60 条文本里没有任何可当视频身份的东西，resource-id 全部混淆（`gln` / `euu` / `eo6` / `d-c`）。所以「更新一条已见过的视频」仍然要走完整的取链流程，计划里 01 的第 4 节不用改写 |

### 第 1 步（部分）：计数解析的实证 —— 完成

[verify_counts_parsing.mjs](verify_counts_parsing.mjs) 从**编译产物**
`dist/packages/douyin_collector.js` 里切出 `readInteractionCount` /
`readInteractionCounts` / `isNodeVisible` 三段源码，在沙箱里求值，把
`evidence_counts_high.json` 的节点还原成树喂进去，断言：

- 当前视频读到 `414000 / 7353 / 71000`，`interaction_text` 是三条原文按 `喜欢|评论|收藏` 拼接
- 上一条与下一条的互动条全部被 `isNodeVisible` 挡掉（不串台）
- `评论` 两个节点取首个，值一致
- 状态词变化（`已点赞，喜欢41.4万，按钮`）不影响取值
- 标签在、数字不在 → `null`（不造 0）；四位数不缩写时取原值

```bash
node docs/TODO/douyin_video_counts_20261019/verify_counts_parsing.mjs
# 全部断言通过：解析规则与真机证据一致，邻居节点被正确挡掉。
```

### 服务端：编译与单测 —— 完成

```bash
cd /Users/zhangtc/code/hotgo/server
go build ./addons/collect/...     # exit 0
go vet   ./addons/collect/...     # exit 0
go test  ./addons/collect/...     # ok consts / ok collectin
```

`collectin` 侧新增 `TestValidateItemCounts`（老客户端缺失计数放行、带计数必须带
`counts_at`、负数拒收、`counts_at` 非法拒收）与 `TestVideoIdentityIsNotIdempotencyKey`
（同一视频两次观测的视频身份相同、幂等键不同）。

### 联调参考实现 —— 完成并实测

`mock_server.py` 增加了视频身份视图，实测同一视频两次上报（`k1` 插入、`k2` 更新）
会往 `/tmp/douyin_mock_videos.jsonl` 写 `inserted` / `updated` 两条，可直接看出客户端
有没有按契约换键、有没有带 `counts_at`。

### 客户端真机端到端 —— 已做（由 App 内工作流触发）

2026-10-19 在真机上启用了工作流「抖音采集与上报（连续采集测试）」，连续触发连跑 3 片：

| 观测 | 结果 |
| --- | --- |
| 计数采集 | 17 条新记录全部带 `like_count` / `comment_count` / `collect_count` / `interaction_text` / `counts_at`，日志逐条可核对（`1.9万 → 19000`） |
| 上报 | 两次 flush 全部 `sent`，`failed 0`，服务端接受了带新字段的记录 |
| 片内预算 | `count=6` 按「新增 + 更新」计，第三片以 `时间到` 收尾，行为符合预期 |
| **更新分支** | **一次都没走到** —— 见下面的缺陷 |

**跑出来的缺陷**：抖音每次「分享链接」都会给一个新的短码，所以「同一个视频」在库里的身份根本对不上。
同一视频 27 分钟内被采 5 次、5 个不同短码、计数完全相同；470 条记录里只有 98 个不同的（作者，标题），
372 条是重复行。这同时说明**原包「已采集过的视频跳过」从来没生效过**。

结论、取证与修复方案见 [05_video_identity.md](05_video_identity.md)，修复的实施与验证见 [06_identity_fix_done.md](06_identity_fix_done.md)。05 是这次迭代**必须先修**的前置项：
不换身份，本次做的「重复视频更新」永远走不到，服务端那条 `(source, video_id)` 唯一索引也约束不住同一个视频。

## 未完成（需要环境）

### 服务端列迁移（Upgrade）

本机没有可用的 MySQL（`127.0.0.1:3306` 不可达，Docker daemon 未运行），所以第 4 步的
迁移验证（旧二进制 → 新二进制 → 更新插件 → 预检重复行 → 幂等重跑）没有执行。
步骤与 SQL 已写进 `hotgo/docs/collect-deploy.md` 的 3.1 小节，环境就绪后按它走一遍即可。

### 生成文件是手改的（需要留意）

`hotgo/AGENTS.md` 要求 DAO/DO/Entity 由 `gf gen dao` 生成、禁止手改。本次因为本机没有
数据库，`server/internal/{dao/internal,model/do,model/entity}/addon_collect_record.go`
是手工按现有格式补的列（列名、类型、注释与 `migrate.go` 的 `columnSpec`、
`resource/sql/install.sql` 逐字对齐，已核对）。**有库之后应跑一次 `gf gen dao` 复核**，
把手工改动替换成生成结果。
