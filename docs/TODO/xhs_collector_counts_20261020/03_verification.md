# 03 验证

状态：编译通过，真机采集与就地更新已验证；上报待本地服务端联调。

## 第一层：编译与静态检查

```bash
npx tsc -p my-packages/xhs-collector/tsconfig.json
```

- 退出码 0，无类型错误
- `METADATA` 合法 JSON，工具列表 6 项（不再有 `xhs_backfill_counts`）
- `dist/packages/xhs_collector.js` 已重新生成

## 第二层：解析规则

- 真实分享页 fixture：`noteId=6a263ade0000000022024db0`，`likedCount=868`、`collectedCount=187`、`commentCount=45`
- 高计数：`10万+` → 100000、`6.9万` → 69000、`2597` → 2597
- 空计数：`commentCount=""` → 0（同页 `commentData.commentCount` 为 0）
- 英文写法 `100K+` / `69.1K` / `2,597` 也能解析

## 第三层：真机（24094RAD4C / 小红书 9.22.1 / Operit debug）

0.4.0 包已安装并加载。用现有工作流采集 `家装`：

```
笔记身份与计数解析成功：.../AdauPAuAjpj -> content_id=6acc9d4b...，赞 52、评 6、藏 51（likedCount=52|collectedCount=51|commentCount=6）
笔记身份与计数解析成功：.../6jASvwmSaz -> content_id=6a5212f1...，赞 77000、评 630、藏 28000（likedCount=7.7万|collectedCount=2.8万|commentCount=630）
已在库里，更新计数：.../6jASvwmSaz（content_id=6a5212f1...，赞 77000、评 630、藏 28000）
本片结束（达到条数目标）：新增 3 条、更新计数 4 条，跳过广告页 0 条、采不动的卡片 0 条
```

- 新增 3 条：`224/1/302`、`353/19/246`、`165/0/161`
- 空 `commentCount` 记为 0（`165/0/161`）
- 高计数 `万` 折算正确（`7.7万` → 77000、`2.8万` → 28000）
- 更新路径：同一片内 4 条旧记录走 `已在库里，更新计数`，`records.jsonl` 行数不变；
  `collected_at` 不变、`counts_at` 变新、`idempotency_key` 换新

## 第四层：存量（A 方案）

- 不提供批量回填工具；0.4.0 之前的记录不主动重取
- 再次采到同一篇（带 `content_id` 的老行）时就地补计数并置 pending
- 没有 `content_id` 的更老记录不参与去重，不会被主动补；等正常采集再次遇到时才会带上

## 第五层：上报（被服务端迁移挡住）

- 设备侧 `adb reverse tcp:8001 tcp:8001` 已设置，`http://localhost:8001` 可达
- 本地服务端**代码**是 v1.3.0，会按 `content_id` 查询；但数据库仍是 v1.2.0 结构：
  `hg_sys_addons_install` 里 collect 是 `v1.2.0`，表里没有 `content_id` 列
- 实测 POST 一条带 `content_id` 的记录返回 `500 storage_unavailable`，服务端日志：
  `Unknown column 'content_id' in 'where clause'`
- 结论：先跑 collect 插件的 v1.3.0 升级（或按 `migrate.go` 加 `content_id` 列与
  `uk_collect_record_source_content` 唯一索引），再跑 `xhs_outbox_flush`
- 联调时要确认：按 `(source, content_id)` 更新同一行，不因换 `idempotency_key` 新增重复行；
  计数与 `counts_at` 更新，`collected_at` 保持首次采集时间
