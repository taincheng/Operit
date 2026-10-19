# 连续调度的链路与续链

## 旧状态

- `WorkflowScheduler.scheduleWorkflow(workflow: Workflow): Boolean` 是非挂起函数，只支持 `interval` / `specific_time` / `cron`
- `interval` 走 `PeriodicWorkRequest`，最小 15 分钟；一次入队会立即执行一次；`REPLACE` 会取消同名正在运行的任务
- `WorkflowWorker` 跑完就返回，不关心「下一轮什么时候来」
- `WorkflowRepository.scheduleWorkflow(id)` 内部用 `runBlocking { getWorkflowById(id) }` 取工作流

## 意图

- 新增 `schedule_type = "continuous"`，配置项 `min_gap_ms` / `max_gap_ms`
- 一轮结束后由该轮自己排下一轮，延迟 = `[min_gap_ms, max_gap_ms]` 内的随机值
- 首环立即跑；种链幂等，冷启动/开机/重复启用都不额外点火、不掐断正在跑的一轮
- 停链：`cancelWorkflow` 覆盖三个任务名（老的周期名 + 两个槽位）
- 调度相关方法改 `suspend`，让种链的存活检查可以 `await()` 而不是阻塞线程

## 实现

### 任务名与槽位

```text
workflow_<workflowId>                老周期任务名，保留给 interval / cron
workflow_<workflowId>_continuous_0   连续调度槽位 0
workflow_<workflowId>_continuous_1   连续调度槽位 1
```

一轮的 slot 通过 inputData（`WorkflowScheduler.KEY_CONTINUOUS_SLOT`）传给自己；结束时排进 `(slot + 1) % 2`。因为「下一轮排在另一个槽位」而另一个槽位此刻装的是一轮之前已经结束的任务，`REPLACE` 不会命中正在运行的本轮。

### 接口

```kotlin
// WorkflowScheduler
suspend fun scheduleWorkflow(workflow: Workflow): Boolean                       // 新增 continuous 分支
suspend fun cancelWorkflow(workflowId: String)                                  // 三个任务名一起取消并 await
suspend fun scheduleNextContinuousRound(
    workflowId: String, triggerNodeId: String, currentSlot: Int,
    config: Map<String, String>
): Boolean
private suspend fun hasLiveContinuousRound(workflowId: String): Boolean          // 两槽位 ENQUEUED/RUNNING/BLOCKED
private fun enqueueContinuousRound(workflowId, triggerNodeId, slot, delayMs)
private fun parseContinuousGaps(config): Pair<Long, Long>?                       // 缺失/非法即报错返回 null
private fun randomGapMs(min, max): Long
```

进程内的种链与续链用 `companion object` 里的 `Mutex` 串行化，避免「种链检查通过」与「上一轮续链」同时发生而排出两轮。

### Repository

```kotlin
suspend fun scheduleWorkflow(id: String): Boolean          // 去掉 runBlocking
suspend fun unscheduleWorkflow(id: String)
suspend fun rescheduleWorkflow(id: String): Boolean
suspend fun scheduleNextContinuousRound(workflowId: String, triggerNodeId: String?, slot: Int): Boolean
```

`scheduleNextContinuousRound` 在续链前重新读一遍工作流：

- 工作流已停用 → 不续链
- 触发节点不存在 → 记 ERROR 日志，不续链
- 该触发节点的 `schedule_type` 已经不是 `continuous` → 不续链（用户把触发方式改回固定间隔时，链路自然结束）

### Worker

```kotlin
val continuousSlot = inputData.getInt(WorkflowScheduler.KEY_CONTINUOUS_SLOT, NO_CONTINUOUS_SLOT)
val result = repository.triggerWorkflow(workflowId, triggerNodeId)
when {
    result.isSuccess -> { 续链(); Result.success() }
    retryable        -> { 不续链; Result.retry() }          // WorkManager 退避重试同一轮
    else             -> { 续链(); Result.failure() }
}
catch (CancellationException) -> 抛出去，不续链            // 停链/取消就是停链
catch (Exception) -> { 续链(); Result.failure() }
```

`continuousSlot < 0` 表示这一轮来自老的周期任务或单次任务，行为与原来完全一致（不续链）。

## 验证方式

真机（见 [04](04-verification.md)）：日志里每轮结束后应出现 `Armed continuous round: ... slot=<0|1> delay=<30000..120000>ms`，两轮之间实际间隔落在配置区间内且逐轮不同；冷启动不出现额外点火；关闭开关后不再出现新的 `Armed` 日志。

[DONE]
