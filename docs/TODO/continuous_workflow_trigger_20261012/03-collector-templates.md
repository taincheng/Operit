# 两个采集包的模板与清单

## 旧状态

`my-packages/xhs-collector` 与 `my-packages/douyin-collector` 各带一个工作流模板 `resources/workflow_collect_and_upload.json`：

- 触发节点：`schedule_type=interval`、`interval_ms=900000`、`repeat=true`，名字「每 15 分钟定时触发」
- 采集节点：`chunk_minutes = 18`
- 清单 `manifest.json` 的包描述与模板描述都写着「每 15 分钟」
- 版本：小红书 `0.1.2`，抖音 `0.1.0`

## 意图

- 触发节点改成 `continuous`，`min_gap_ms=30000` / `max_gap_ms=120000`
- `chunk_minutes` 18 → 5：连续模式下轮次密，单轮越短越好，同时远离 `CoroutineWorker` 约 10 分钟的执行上限
- `count` 维持小红书 3、抖音 6
- 节点名、节点描述、包描述、模板名与描述同步改成「连续采集」
- 版本号 +1，便于区分新旧包

不改采集脚本（`src/**/*.ts`），所以不需要重新编译 `dist/`，`npx tsc` 不用跑。

## 实现

触发节点（两个包同构，只改工具名与关键词）：

```json
{
  "id": "trigger_schedule_<xhs|douyin>",
  "type": "trigger",
  "name": "连续运行：每轮结束等 30–120 秒",
  "description": "一轮跑完（清积压 → 采一片 → 上报）后随机等待 30–120 秒再开始下一轮。间隔从上一轮结束时刻起算，不再固定每 15 分钟点火",
  "triggerType": "schedule",
  "triggerConfig": {
    "schedule_type": "continuous",
    "min_gap_ms": "30000",
    "max_gap_ms": "120000",
    "enabled": "true"
  }
}
```

手动触发节点不动（编辑器里「触发工作流」仍然走它）。

清单：

- `version`：小红书 `0.1.2 → 0.1.3`，抖音 `0.1.0 → 0.1.1`
- `description` 与 `workflow_templates[].description` 改成「一轮跑完等 30–120 秒再跑下一轮」
- `workflow_templates[].display_name`：「定时采集抖音并上报」→「连续采集抖音并上报」，小红书同理
- `workflow_templates[].id` 与 `resources[].key` 保持不变，避免额外的引用改动

## 用户侧要做的事

旧工作流不做迁移（已与用户确认）：在「工作流」页里删除（或至少停用）原来那两条 15 分钟的工作流，再从「从模板新建 → 插件模板」重新导入新版模板。**两条工作流不要同时存在**，否则两轮采集会抢同一个界面。

## 验证方式

真机（见 [04](04-verification.md)）：按上述步骤重建两条工作流，确认导入后立即跑一轮，之后每轮结束等待 30–120 秒再起下一轮。

[DONE]
