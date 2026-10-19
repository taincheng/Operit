package com.ai.assistance.operit.core.workflow

import android.content.Context
import com.ai.assistance.operit.util.AppLogger
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.ai.assistance.operit.data.repository.WorkflowRepository

/**
 * WorkManager Worker for executing workflows in the background
 * 
 * This worker is scheduled by WorkflowScheduler to execute workflows
 * at specified times or intervals.
 *
 * continuous 调度的每一轮就是这个 Worker 的一次执行：本轮真正返回之后，它负责把下一轮排进另一个
 * 槽位（见 WorkflowScheduler.enqueueContinuousRound 的说明）。间隔从本轮结束时刻起算，而不是固定节拍。
 */
class WorkflowWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        private const val TAG = "WorkflowWorker"
        const val KEY_WORKFLOW_ID = "workflow_id"
        const val KEY_TRIGGER_NODE_ID = "trigger_node_id"
    }

    override suspend fun doWork(): Result {
        val workflowId = inputData.getString(KEY_WORKFLOW_ID)
        val triggerNodeId = inputData.getString(KEY_TRIGGER_NODE_ID)
        val continuousSlot = inputData.getInt(
            WorkflowScheduler.KEY_CONTINUOUS_SLOT,
            WorkflowScheduler.NO_CONTINUOUS_SLOT
        )
        
        if (workflowId.isNullOrBlank()) {
            AppLogger.e(TAG, "Workflow ID is missing from input data")
            return Result.failure()
        }

        AppLogger.d(TAG, "Executing scheduled workflow: $workflowId, trigger: $triggerNodeId")

        val repository = WorkflowRepository(applicationContext)

        return try {
            val result = repository.triggerWorkflow(workflowId, triggerNodeId)
            
            if (result.isSuccess) {
                AppLogger.d(TAG, "Workflow execution succeeded: ${result.getOrNull()}")
                armNextContinuousRound(repository, workflowId, triggerNodeId, continuousSlot)
                Result.success()
            } else if (result.exceptionOrNull() is WorkflowExecutionRetryableException) {
                // 不续链：WorkManager 会退避重试本轮同一份工作，续链会变成同时存在两轮
                AppLogger.w(TAG, "Workflow runtime is not ready; WorkManager will retry: ${result.exceptionOrNull()?.message}")
                Result.retry()
            } else {
                AppLogger.e(TAG, "Workflow execution failed: ${result.exceptionOrNull()?.message}")
                // 单轮失败也继续续链：持续监控不该因为一轮失败就停摆，
                // 失败原因已经落在执行记录与日志里
                armNextContinuousRound(repository, workflowId, triggerNodeId, continuousSlot)
                Result.failure()
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            // 取消工作流/停链走的就是取消路径，这里续链会把刚停掉的链路又接上
            throw e
        } catch (e: Exception) {
            AppLogger.e(TAG, "Error executing workflow", e)
            armNextContinuousRound(repository, workflowId, triggerNodeId, continuousSlot)
            Result.failure()
        }
    }

    /**
     * 只有 continuous 轮次才续链。老周期任务与单次任务的 inputData 里没有槽位，行为保持不变。
     */
    private suspend fun armNextContinuousRound(
        repository: WorkflowRepository,
        workflowId: String,
        triggerNodeId: String?,
        continuousSlot: Int
    ) {
        if (continuousSlot == WorkflowScheduler.NO_CONTINUOUS_SLOT) {
            return
        }
        repository.scheduleNextContinuousRound(workflowId, triggerNodeId, continuousSlot)
    }
}
