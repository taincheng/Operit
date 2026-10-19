---
fork_repository: https://github.com/AAswordman/Operit.git
status: completed
For_Agent: 动手前先读「原本状况」里列出的代码位置与现场结论。continuous 不是周期任务，任何把它改回 PeriodicWorkRequest 的改动都会退回到 15 分钟空等
---

# 工作流的连续调度：跑完一轮，等随机 30–120 秒，再跑下一轮

## 原本状况

两个采集工作流（小红书采集与上报、抖音采集与上报）用定时触发节点 `schedule_type=interval` / `interval_ms=900000` 触发，见 `my-packages/{xhs,douyin}-collector/resources/workflow_collect_and_upload.json`。

宿主侧：

- `WorkflowScheduler` 把 interval 夹到 15 分钟下限（`intervalMs / 60000).coerceAtLeast(15)`，注释写着 WorkManager 的限制），并用 `PeriodicWorkRequest` 入队
- `WorkflowWorker` 是普通 `CoroutineWorker`，只负责调用 `WorkflowRepository.triggerWorkflow`
- 一轮工作流的形状是「先清积压 → 采一片（到条数目标或 `chunk_minutes` 就到点）→ 上报」

于是产生一个与工作量无关的固定节拍：一轮采集常常只要约 3 分钟，采完之后要空等 12 分钟左右才轮到下一次点火。分片与断点续跑解决的是「单片别顶到脚本 30 分钟硬超时」，不解决节拍。

现场记录（来自 [device_automation_platform_20261008](../device_automation_platform_20261008/index.md) 与 [08 号 backlog](../device_automation_platform_20261008/08_automation_status_overlay_and_keepawake.md)，都是已实测结论）：

- 周期任务有 flex 窗口，15 分钟周期实测约 10 分钟就点火一次，曾与 10–11 分钟的一片重叠，两轮抢同一个界面
- 应用冷启动时 `WorkflowSchedulerInitializer` 会重排所有启用的工作流，`enqueueUniquePeriodicWork(..., REPLACE, ...)` 会取消同名**正在运行**的任务，把正在跑的那一轮掐掉（这正是 backlog 里「取消来源未查清」那条的答案）
- 首次入队会立即跑一次，所以「导入模板后立刻点火一次」「冷启动多点一次火」，不是等满一个周期
- 设备睡下去之后工作流完全不点火（现场记录过一次 11 小时空窗）。那是息屏/Doze 的问题，不是触发方式的问题，本计划不解决

## 意图与结果

新增一种通用调度类型 `continuous`：**一轮工作流真正结束之后**，随机等待 `[min_gap_ms, max_gap_ms]` 再开始下一轮，间隔从上一轮结束时刻起算，不再有固定节拍空等。

- 适用对象是任意带 `schedule` 触发节点的工作流，不特判采集包
- 首环立即跑（用户启用或导入模板后马上能看到一轮结果）
- 单轮失败也继续排下一轮（持续监控不该因单轮失败停摆），失败原因照旧进执行记录与日志
- `WorkflowExecutionRetryableException` 不排下一轮，交给 WorkManager 退避重试同一轮，避免同一时刻出现两轮
- 关闭工作流、删除工作流、改触发配置都会停链
- 冷启动、开机重排、重复启用都**不会**多点一次火，也不会掐断正在跑的一轮

## 已定决策（2026-10-12 与用户确认）

| 项 | 决定 |
| --- | --- |
| 单轮失败 | 继续下一轮 |
| 能力范围 | 做成通用 `schedule_type`，不是采集包专用 |
| 首环 | 立即跑（不等待随机间隔） |
| 模板参数 | `chunk_minutes` 18 → 5，`count` 维持 3（小红书）/ 6（抖音） |
| 旧工作流 | 不做迁移，两个旧工作流由用户删除后重新从模板新建 |
| 前台 Worker | 本次不做，留到 [08 号 backlog](../device_automation_platform_20261008/08_automation_status_overlay_and_keepawake.md) 之后单独处理 |

## 关键实现选择

**为什么不用周期任务**：`PeriodicWorkRequest` 的最小周期是 15 分钟，无法表达 30–120 秒。

**为什么用「两个交替槽位 + 单次任务」而不是 APPEND 链**：

- 一轮工作流本身就是那个单次任务。它结束时如果同名 `REPLACE` 排下一轮，会取消正在运行的自己——这正是现状里掐断当前轮的那个坑
- 用两个交替的唯一任务名（`workflow_<id>_continuous_0/1`，下一轮排进另一个槽位），入队那一刻另一个槽里一定是上一轮已结束的任务，`REPLACE` 只会清掉历史记录，永远不会取消本轮；每个工作流在 WorkManager 里的记录恒为 ≤2 条，不会像 `APPEND` 链那样随轮次无限增长
- 种链只在两个槽位都没有「待跑/在跑」任务时才入队，因此天然幂等

**为什么把 `WorkflowScheduler.scheduleWorkflow` 与仓库层三个调度方法改成 `suspend`**：种链必须查 WorkManager 里两个槽位的状态（不能阻塞主线程），改成挂起后可以直接 `await()`；顺带去掉 `WorkflowRepository.scheduleWorkflow` 里原有的 `runBlocking`。

## 作用域

- `core/workflow/WorkflowScheduler.kt`、`WorkflowWorker.kt`（新增 continuous 链路）
- `data/repository/WorkflowRepository.kt`（三个调度方法改 suspend + 新增续链接口）
- `ui/features/workflow/components/ScheduleConfigDialog.kt` 与 9 个 `strings.xml`（新增连续运行配置项）
- `my-packages/xhs-collector`、`my-packages/douyin-collector` 的工作流模板与 `manifest.json`（文案、参数、版本号）
- 活文档：`my-packages/README.md`、`docs/doc-src/package-dev/workflow.md`
- 不改任何采集脚本（`src/**/*.ts`），因此不需要重新编译 `dist/`
- 不改 `interval` / `specific_time` / `cron` 的行为，老工作流不受影响

## 步骤

- [01 连续调度的链路与续链](01-continuous-chain-scheduling.md)
- [02 连续运行的配置界面与文案](02-schedule-config-ui.md)
- [03 两个采集包的模板与清单](03-collector-templates.md)
- [04 验证记录](04-verification.md)

## 状态

代码、文档与真机验证全部完成（2026-10-13）。编译与打包通过，A（调度链路）与 B（两个采集包各跑一段）的实测数据见 [04](04-verification.md)：随机间隔落在 30–120 秒、实测偏差 +0.02~+0.08 秒、冷启动不额外点火也不掐断在跑的一轮、单轮失败仍续链、停用即停链、两个采集包的 chunk 与 records 逐轮推进且 outbox 每轮清空。

唯一没做的是「从模板新建」那一下手点（采集期间不能碰设备界面），等价路径与设备上的模板内容都已核对，见 04 的「未覆盖」。

## 影响到的既有说法

本计划推翻下面两处记录里「每 15 分钟定时触发」的说法（它们是当时的事实记录，保留原文，不再回改）：

- [xiaohongshu_collector_20261012/03_settings_and_workflow.md](../xiaohongshu_collector_20261012/03_settings_and_workflow.md)
- [device_automation_platform_20261008/04_unattended_chunked_runs.md](../device_automation_platform_20261008/04_unattended_chunked_runs.md)

## 未解决 / 不在范围内

- 息屏与 Doze 下的点火推迟：continuous 与周期任务一样会被推迟。要真正无人值守过夜，需要 08 号 backlog 的保亮与前台 Worker
- 一轮超过约 10 分钟时 `CoroutineWorker` 的上限：模板把 `chunk_minutes` 收到 5，单轮远低于上限
- WorkManager 的延迟不是精确定时：实测在设备醒着、应用前台时偏差约 0.02–0.08 秒，Doze 下会明显更晚
- **两个采集器不能同时启用**：小红书与抖音都要把各自的 App 拉到前台，同时跑会互相抢界面，实测无法并行。要一次只跑一个
