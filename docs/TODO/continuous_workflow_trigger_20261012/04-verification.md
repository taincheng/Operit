# 验证记录

2026-10-12 至 10-13 在真机上完成 A（调度链路）与 B（采集链路）两段验证，下面是实测结果。

## 环境

| 项 | 值 |
| --- | --- |
| 设备 | Xiaomi 24094RAD4C（HyperOS，Android 15，与既有采集计划同一台） |
| 宿主 | `com.ai.assistance.operit.debug` 1.12.2，`./gradlew assembleDebug` 重新打包（2026-10-12 18:03）后 `adb install -r` 覆盖安装 |
| 采集包 | `com.taincheng.xhs_collector_bundle` 0.1.3、`com.taincheng.douyin_collector_bundle` 0.1.1，用 `tools/toolpkg/debug_toolpkg.py` 推到设备外部包目录 |
| 前置 | 无障碍 provider 已启用；屏幕保持常亮（`svc power stayon usb`）；采集期间不触碰设备界面 |
| 编译 | `./gradlew :app:compileDebugKotlin` 与 `./gradlew assembleDebug` 均 `BUILD SUCCESSFUL` |

## 代码复核（本机已做）

| 项 | 复核方式 | 结果 |
| --- | --- | --- |
| `continuous` 分支只增不改，`interval` / `specific_time` / `cron` 行为未动 | 阅读 `git diff core/workflow/WorkflowScheduler.kt` | ✅ 三个老分支一字未改，只在 `when` 里多一行 |
| 改 `suspend` 后的调用点都在协程里 | 全仓检索 `scheduleWorkflow(` / `unscheduleWorkflow(` / `rescheduleWorkflow(` | ✅ 4 处全在协程；顺带去掉了 `scheduleWorkflow` 里原有的 `runBlocking` |
| 种链幂等：两槽位任一 ENQUEUED/RUNNING/BLOCKED 时不入队 | 阅读 `scheduleContinuousWorkflow` + `hasLiveContinuousRound` | ✅ 实测见 A-2 |
| 续链不会取消本轮：下一轮排进 `(slot + 1) % 2` | 阅读 `scheduleNextContinuousRound` / `enqueueContinuousRound` | ✅ 实测 slot 严格 0/1 交替 |
| `retry()` 与 `CancellationException` 都不续链 | 阅读 `WorkflowWorker.doWork` | ✅ 只有成功、非 retryable 失败、未知异常三条路径续链 |
| 停链覆盖三个任务名并 `await()` 落库 | 阅读 `cancelWorkflow` | ✅ 实测见 A-4 |
| `Operation.await()` / `ListenableFuture.await()` / `WorkInfo.State.BLOCKED` 存在 | 解包 `work-runtime-2.9.0-sources.jar` | ✅ 都在 `androidx.work` 包内 |
| 模板 JSON 与契约一致、清单版本已 +1 | 读仓库文件 + 从设备拉回 `.toolpkg` 解包核对 | ✅ 设备上的包确实带 `continuous` / 30000 / 120000 / `chunk_minutes=5` |
| 新增 string 键在源语言与 7 个语种唯一存在 | 逐键 `grep -c` | ✅ 每键计数 1；`values-ja` 本就缺这组文案，按同口径未补 |
| 9 个 `strings.xml` 是合法 XML | `ElementTree.parse` | ✅ |
| 采集脚本未改动，`dist/` 无需重编译 | 检查改动范围 | ✅ 只改 `resources/*.json` 与 `manifest.json` |

## A 调度链路（探针工作流，不碰界面）

物料：`fixtures/workflow_continuous_probe.json`（`list_files` 只读节点，间隔 30–120 秒）；
核对用 `fixtures/analyze_continuous_log.py`。

### A-1 首环立即跑 + 间隔随机且落在区间内

13 分钟窗口 12 轮，`delay` 与「上一轮结束 → 下一轮开始」的实测间隔：

| 轮 | slot | 请求间隔(s) | 实测间隔(s) | 偏差(s) | 本轮耗时(s) |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0（首环） | - | - | 0.516 |
| 1 | 1 | 40.827 | 40.878 | +0.051 | 0.185 |
| 2 | 0 | 91.356 | 91.395 | +0.039 | 0.210 |
| 3 | 1 | 113.460 | 113.489 | +0.029 | 0.250 |
| 4 | 0 | 54.816 | 54.860 | +0.044 | 0.184 |
| 5 | 1 | 67.921 | 67.954 | +0.033 | 0.220 |
| 6 | 0 | 48.850 | 48.889 | +0.039 | 0.220 |
| 7 | 1 | 98.560 | 98.601 | +0.041 | 0.181 |
| 8 | 0 | 38.233 | 38.257 | +0.024 | 0.211 |
| 9 | 1 | 46.353 | 46.390 | +0.037 | 0.215 |
| 10 | 0 | 47.046 | 47.078 | +0.032 | 0.210 |
| 11 | 1 | 83.103 | 83.152 | +0.049 | 0.209 |
| 12 | 0 | 68.495 | （窗口结束，未观测） | - | - |

结论：首环 `delay=0ms` 立即执行；12 个随机值全部落在 30000–120000 内且互不相同；实测间隔比请求值大 0.024–0.051 秒（WorkManager 单次任务的调度开销）；slot 严格 0/1 交替；相邻两轮不重叠。

### A-2 冷启动不额外点火、不掐断在跑的一轮

链路 armed 期间 `am force-stop` 后重启应用：

```
09:19:28.727 WorkflowScheduler: Continuous chain already armed for workflow: c0ffee00-...
09:19:29.065 WorkflowScheduler: Continuous chain already armed for workflow: c0ffee00-...
```

- 两次重排都没有入队新任务，没有「立即多点一次火」
- 重启后 25 秒内没有任何一轮开始；此前已入队的那一轮按原定 delay 在 18:20:04.989 才开始，不是重启后立刻跑
- 整个窗口没有 `工作流执行已取消` / `Cancelling workflow execution`，即没有老的周期任务那种 REPLACE 掐断
- 该窗口后续三轮实测间隔 50.348 / 109.736 / 37.735 秒，请求 50.309 / 109.707 / 37.699，偏差 +0.029 ~ +0.039 秒

### A-3 单轮失败仍续链

把节点动作改成不存在的工具名 `no_such_tool_probe`，连续 4 轮全部失败：

```
E WorkflowWorker: Workflow execution failed: Workflow execution failed
E WorkflowExecutor: 节点执行失败: 列一次工作流目录, 错误: Tool not found: no_such_tool_probe
```

4 轮失败后每次都照常 armed 下一轮（`delay=102007 / 41778 / 97572 / 66609 ms`），链路没有因为失败停摆。

### A-4 停用即停链

把工作流 `enabled` 改成 false 后重启应用，已入队的那一轮仍然跑（符合「已排队的不撤回」）：

```
09:25:45.866 WorkflowWorker: Executing scheduled workflow: c0ffee00-...
09:25:45.876 E WorkflowWorker: Workflow execution failed: 工作流已禁用: 连续调度测试A（调度链路）
09:25:45.884 WorkflowRepository: Workflow is disabled, continuous chain stops: c0ffee00-...
```

之后 5 分钟窗口内没有任何新的 armed 或 round，链路停住。

## B 采集链路（两个采集包各跑一遍）

两个采集器都要把目标 App 拉到前台，**同一台设备上不能同时启用**（会互相抢前台）。因此先后各跑一段，
另一个先停用。工作流按模板资源生成，见 `fixtures/build_workflow_from_template.py`。

### B-1 小红书（关键词 `家装`，count=3，chunk_minutes=5）

| 轮 | slot | 请求间隔(s) | 实测间隔(s) | 偏差(s) | 本轮耗时(s) | 采集结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0（首环） | - | - | 151.977 | `stopReason=count`，chunk 20，total 98 |
| 1 | 1 | 89.066 | 89.126 | +0.060 | 124.585 | `count`，chunk 21，total 101 |
| 2 | 0 | 52.129 | 52.195 | +0.066 | 306.988 | `time`（撞 5 分钟上限，只收 1 条），chunk 22，total 102 |
| 3 | 1 | 78.536 | 78.610 | +0.074 | 185.694 | `count`，chunk 23，total 105 |
| 4 | 0 | 37.169 | 37.233 | +0.064 | - | （随后停用该工作流） |

数据面：`progress.json` chunk 19 → 23、collected_total 95 → 105；`records.jsonl` 95 → 105 行（+10，与每轮采集条数一致，无重复）；每轮上报节点返回 `failed=0, pending=0`，`outbox.json` 结束时 0 条。

### B-2 抖音（关键词 `美食`，count=6，chunk_minutes=5）

| 轮 | slot | 请求间隔(s) | 实测间隔(s) | 偏差(s) | 本轮耗时(s) | 采集结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0（首环） | - | - | 270.459 | `count`，chunk 1，total 6 |
| 1 | 1 | 36.509 | 36.587 | +0.078 | 206.590 | `count`，chunk 2，total 12 |
| 2 | 0 | 114.670 | 114.737 | +0.067 | 199.421 | `count`，chunk 3，total 18 |
| 3 | 1 | 81.348 | 81.413 | +0.065 | 208.380 | `count`，chunk 4，total 24 |
| 4 | 0 | 57.602 | （随后停用，不再排） | - | - | `count`，chunk 5，total 30 |

数据面：chunk 1 → 5、collected_total 6 → 30；`records.jsonl` 348 → 378 行（+30 = 5 轮 × 6，无重复）；每轮上报 `failed=0, pending=0`，`outbox.json` 结束时 0 条。

停用抖音工作流后，第 5 轮跑完立即出现：

```
09:57:34.584 WorkflowRepository: Workflow is disabled, continuous chain stops: 22222222-...
```

## 未覆盖 / 已知边界

- **「从模板新建」这个点击路径没有手点验证**：采集期间不能触碰设备界面，所以正式工作流是按模板资源等价生成的（`fixtures/build_workflow_from_template.py`）。可以确认的是设备上的 `.toolpkg` 里就是新模板（拉回来解包核对过：0.1.3 / `continuous` / 30000 / 120000 / `chunk_minutes=5`），而导入代码本身本次未改
- **息屏 / Doze**：本轮全程保持屏幕常亮（USB 供电 + `stayon`）。设备真睡下去时单次任务同样会被推迟，这是 08 号 backlog 的范围，本计划不解决
- **两条连续采集工作流同时启用会互相抢前台**，实测无法并行（两个驱动都要把各自 App 拉到前台）。用户侧要一次只跑一个
- 第 3 轮小红书耗时 306.988 秒，略超 5 分钟上限：脚本在循环顶部判截止时间，单条笔记约 30 秒，所以最多溢出到一条的处理时间。这是既有脚本行为，不是本次改动引入
- 每轮都会往 `_execution_logs` 写一份执行记录，密集模式下增长较快，本篇未做留存策略

## 顺带发现（不属本计划范围，未改）

- `ExecuteNode.jsCode` 是宿主代码里的保留字段：模型（`data/model/Workflow.kt`）、执行器（`core/workflow/WorkflowExecutor.kt`，0 处引用）、脚本工具（`StandardWorkflowTools.kt` 的创建/补丁/类型推断）都在宿主侧。执行器只读 `actionType`，**从不执行 `jsCode`**，只填 `jsCode` 的节点会以 `节点没有配置 actionType` 失败。它对现有功能没有影响（编辑器不给这个字段，老工作流有没有它都一样跑），唯一代价是契约与文档里声明了它。
  **2026-10-13 决定：保留不删**（用户确认不影响功能即不动）。已在 [docs/doc-src/package-dev/workflow.md](../../doc-src/package-dev/workflow.md) 标注它是保留字段、不会被宿主执行，避免包作者按文档填了却拿到一个必然失败的节点。将来若要真做内联 JS，再单开计划
- 停用工作流只有在经由仓库层保存时才会取消 WorkManager 任务；直接改 JSON 文件停用时，已入队的那一轮仍会跑一次（跑完由 `scheduleNextContinuousRound` 读到 `enabled=false` 停链）。实测就是这种表现

## 复现物料

| 文件 | 用途 |
| --- | --- |
| [fixtures/workflow_continuous_probe.json](fixtures/workflow_continuous_probe.json) | A 段探针工作流（只读 `list_files`，continuous 30–120 秒） |
| [fixtures/build_workflow_from_template.py](fixtures/build_workflow_from_template.py) | 把采集包模板转成可推到设备的正式工作流 JSON |
| [fixtures/analyze_continuous_log.py](fixtures/analyze_continuous_log.py) | 从 logcat 里算出每轮请求间隔 vs 实测间隔 |

操作路径：工作流 JSON 推到 `/sdcard/Download/Operit/workflow/<uuid>.json`，重启应用即可被调度初始化流程接上；
`am force-stop` + `am start -n com.ai.assistance.operit.debug/com.ai.assistance.operit.ui.main.MainActivity`
用来制造冷启动；进度与数据落在 `/sdcard/Download/Operit/plugins/<容器包名>/`。

[DONE]
