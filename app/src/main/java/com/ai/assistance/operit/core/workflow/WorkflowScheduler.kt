package com.ai.assistance.operit.core.workflow

import android.content.Context
import com.ai.assistance.operit.util.AppLogger
import androidx.work.*
import com.ai.assistance.operit.data.model.TriggerNode
import com.ai.assistance.operit.data.model.Workflow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/**
 * WorkflowScheduler manages scheduling workflows using WorkManager
 * 
 * Supports four scheduling types:
 * - interval: Fixed interval execution (e.g., every 15 minutes)
 * - specific_time: One-time execution at a specific time
 * - cron: Cron-based scheduling (simplified implementation)
 * - continuous: Run the next round a random gap after the previous one actually finished
 */
class WorkflowScheduler(private val context: Context) {

    companion object {
        private const val TAG = "WorkflowScheduler"
        private const val WORK_NAME_PREFIX = "workflow_"
        private const val RETRY_BACKOFF_DELAY_MINUTES = 1L

        // Schedule types
        const val SCHEDULE_TYPE_INTERVAL = "interval"
        const val SCHEDULE_TYPE_SPECIFIC_TIME = "specific_time"
        const val SCHEDULE_TYPE_CRON = "cron"
        const val SCHEDULE_TYPE_CONTINUOUS = "continuous"

        // Config keys
        const val CONFIG_SCHEDULE_TYPE = "schedule_type"
        const val CONFIG_INTERVAL_MS = "interval_ms"
        const val CONFIG_SPECIFIC_TIME = "specific_time"
        const val CONFIG_CRON_EXPRESSION = "cron_expression"
        const val CONFIG_REPEAT = "repeat"
        const val CONFIG_END_TIME = "end_time"
        const val CONFIG_ENABLED = "enabled"
        const val CONFIG_MIN_GAP_MS = "min_gap_ms"
        const val CONFIG_MAX_GAP_MS = "max_gap_ms"
        
        // WorkManager data keys
        const val KEY_TRIGGER_NODE_ID = "trigger_node_id"
        const val KEY_CONTINUOUS_SLOT = "continuous_slot"

        /**
         * continuous 调度同时只允许一轮存在。用两个交替的槽位，一轮结束时把下一轮排进另一个槽位：
         * 那个槽位此刻装的是一轮之前已经结束的任务，REPLACE 不会命中正在运行的本轮。
         * 不这么做（同名 REPLACE）会取消正在运行的自己，也就是老的周期任务在冷启动时掐断当前轮的同一个坑。
         */
        private const val CONTINUOUS_SLOT_COUNT = 2

        /**
         * 种链与续链都会读槽位状态再入队，两步之间不能让另一条链路插进来，否则会排出两轮。
         */
        private val continuousChainMutex = Mutex()

        /** 不是 continuous 轮次时 inputData 里的槽位值 */
        const val NO_CONTINUOUS_SLOT = -1
    }

    private val workManager: WorkManager by lazy { 
        WorkManager.getInstance(context.applicationContext)
    }

    /**
     * Schedule a workflow based on its trigger configuration
     *
     * 挂起：continuous 的种链要先查 WorkManager 里两个槽位的状态，不能阻塞调用线程。
     */
    suspend fun scheduleWorkflow(workflow: Workflow): Boolean {
        // Find the trigger node
        val triggerNode = workflow.nodes.filterIsInstance<TriggerNode>()
            .firstOrNull { it.triggerType == "schedule" }

        if (triggerNode == null) {
            AppLogger.d(TAG, "No schedule trigger found for workflow: ${workflow.id}")
            return false
        }

        val config = triggerNode.triggerConfig
        val scheduleType = config[CONFIG_SCHEDULE_TYPE] ?: return false
        val enabled = config[CONFIG_ENABLED]?.toBoolean() ?: true

        if (!enabled) {
            AppLogger.d(TAG, "Schedule is disabled for workflow: ${workflow.id}")
            return false
        }

        return when (scheduleType) {
            SCHEDULE_TYPE_INTERVAL -> scheduleIntervalWorkflow(workflow.id, triggerNode.id, config)
            SCHEDULE_TYPE_CONTINUOUS -> scheduleContinuousWorkflow(workflow.id, triggerNode.id, config)
            SCHEDULE_TYPE_SPECIFIC_TIME -> scheduleOneTimeWorkflow(workflow.id, triggerNode.id, config)
            SCHEDULE_TYPE_CRON -> scheduleCronWorkflow(workflow.id, triggerNode.id, config)
            else -> {
                AppLogger.e(TAG, "Unknown schedule type: $scheduleType")
                false
            }
        }
    }

    /**
     * Schedule workflow with fixed interval
     */
    private fun scheduleIntervalWorkflow(workflowId: String, triggerNodeId: String, config: Map<String, String>): Boolean {
        val intervalMs = config[CONFIG_INTERVAL_MS]?.toLongOrNull() ?: return false
        val repeat = config[CONFIG_REPEAT]?.toBoolean() ?: true

        if (!repeat) {
            AppLogger.w(TAG, "Interval scheduling requires repeat=true")
            return false
        }

        // Minimum interval is 15 minutes per WorkManager restrictions
        val intervalMinutes = (intervalMs / 60000).coerceAtLeast(15)

        val constraints = Constraints.Builder()
            .setRequiresBatteryNotLow(false)
            .build()

        val workRequest = PeriodicWorkRequestBuilder<WorkflowWorker>(
            intervalMinutes, TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                RETRY_BACKOFF_DELAY_MINUTES,
                TimeUnit.MINUTES
            )
            .setInputData(
                workDataOf(
                    WorkflowWorker.KEY_WORKFLOW_ID to workflowId,
                    KEY_TRIGGER_NODE_ID to triggerNodeId
                )
            )
            .addTag(workflowId)
            .build()

        workManager.enqueueUniquePeriodicWork(
            getWorkName(workflowId),
            ExistingPeriodicWorkPolicy.REPLACE,
            workRequest
        )

        AppLogger.d(TAG, "Scheduled interval workflow: $workflowId, trigger: $triggerNodeId, interval: $intervalMinutes minutes")
        return true
    }

    /**
     * 连续调度：种下链路的第一环。
     *
     * 为什么不是周期任务：PeriodicWorkRequest 的最小周期是 15 分钟，表达不了「跑完一轮等 30–120 秒」。
     * 这里改成单次任务自链：一轮真正返回之后由它自己排下一轮，间隔从那一刻起算。
     *
     * 种链是幂等的：两个槽位任一还有待跑/在跑的任务就不入队。因此应用冷启动、开机重排、重复启用
     * 都不会额外多点一次火，也不会像周期任务的 REPLACE 那样把正在跑的一轮掐掉。
     */
    private suspend fun scheduleContinuousWorkflow(
        workflowId: String,
        triggerNodeId: String,
        config: Map<String, String>
    ): Boolean {
        val gaps = parseContinuousGaps(config) ?: return false

        continuousChainMutex.withLock {
            if (hasLiveContinuousRound(workflowId)) {
                AppLogger.d(TAG, "Continuous chain already armed for workflow: $workflowId")
                return true
            }
            // 首环立即跑：用户启用工作流或导入模板后马上就能看到一轮结果
            enqueueContinuousRound(workflowId, triggerNodeId, slot = 0, delayMs = 0L)
        }
        return true
    }

    /**
     * 排下一轮。由 [WorkflowWorker] 在上一轮真正返回之后调用，间隔从这里开始计时。
     */
    suspend fun scheduleNextContinuousRound(
        workflowId: String,
        triggerNodeId: String,
        currentSlot: Int,
        config: Map<String, String>
    ): Boolean {
        val gaps = parseContinuousGaps(config) ?: return false
        val delayMs = randomGapMs(gaps.first, gaps.second)
        val nextSlot = (currentSlot + 1) % CONTINUOUS_SLOT_COUNT

        continuousChainMutex.withLock {
            enqueueContinuousRound(workflowId, triggerNodeId, nextSlot, delayMs)
        }
        return true
    }

    private fun enqueueContinuousRound(
        workflowId: String,
        triggerNodeId: String,
        slot: Int,
        delayMs: Long
    ) {
        val constraints = Constraints.Builder()
            .setRequiresBatteryNotLow(false)
            .build()

        val workRequest = OneTimeWorkRequestBuilder<WorkflowWorker>()
            .setConstraints(constraints)
            .setInputData(
                workDataOf(
                    WorkflowWorker.KEY_WORKFLOW_ID to workflowId,
                    KEY_TRIGGER_NODE_ID to triggerNodeId,
                    KEY_CONTINUOUS_SLOT to slot
                )
            )
            .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
            .addTag(workflowId)
            .build()

        workManager.enqueueUniqueWork(
            getContinuousSlotWorkName(workflowId, slot),
            ExistingWorkPolicy.REPLACE,
            workRequest
        )

        AppLogger.d(
            TAG,
            "Armed continuous round: workflow=$workflowId trigger=$triggerNodeId slot=$slot delay=${delayMs}ms"
        )
    }

    /**
     * 两个槽位里只要还有一个待跑或在跑的任务，链路就是活的。
     * BLOCKED 一并算活：任务已有但尚未进入可运行状态。
     */
    private suspend fun hasLiveContinuousRound(workflowId: String): Boolean {
        for (slot in 0 until CONTINUOUS_SLOT_COUNT) {
            val live = workManager.getWorkInfosForUniqueWork(getContinuousSlotWorkName(workflowId, slot))
                .await()
                .any {
                    it.state == WorkInfo.State.ENQUEUED ||
                        it.state == WorkInfo.State.RUNNING ||
                        it.state == WorkInfo.State.BLOCKED
                }
            if (live) {
                return true
            }
        }
        return false
    }

    /**
     * 读 continuous 的随机间隔区间。缺失或非法都按配置错误处理并报错返回，不静默取默认值。
     */
    private fun parseContinuousGaps(config: Map<String, String>): Pair<Long, Long>? {
        val minGapMs = config[CONFIG_MIN_GAP_MS]?.toLongOrNull()
        val maxGapMs = config[CONFIG_MAX_GAP_MS]?.toLongOrNull()

        if (minGapMs == null || maxGapMs == null || minGapMs <= 0L || maxGapMs < minGapMs) {
            AppLogger.e(
                TAG,
                "continuous 需要 min_gap_ms/max_gap_ms 且满足 0 < min <= max，当前 min=$minGapMs max=$maxGapMs"
            )
            return null
        }
        return minGapMs to maxGapMs
    }

    private fun randomGapMs(minGapMs: Long, maxGapMs: Long): Long {
        return if (maxGapMs == minGapMs) {
            minGapMs
        } else {
            Random.nextLong(minGapMs, maxGapMs + 1)
        }
    }

    /**
     * Schedule workflow for specific time
     */
    private fun scheduleOneTimeWorkflow(workflowId: String, triggerNodeId: String, config: Map<String, String>): Boolean {
        val specificTimeStr = config[CONFIG_SPECIFIC_TIME] ?: return false
        val repeat = config[CONFIG_REPEAT]?.toBoolean() ?: false

        val targetTime = try {
            parseDateTime(specificTimeStr)
        } catch (e: Exception) {
            AppLogger.e(TAG, "Failed to parse specific_time: $specificTimeStr", e)
            return false
        }

        val currentTime = System.currentTimeMillis()
        val delay = targetTime - currentTime

        if (delay < 0) {
            AppLogger.w(TAG, "Specific time is in the past: $specificTimeStr")
            return false
        }

        val constraints = Constraints.Builder()
            .setRequiresBatteryNotLow(false)
            .build()

        val workRequest = OneTimeWorkRequestBuilder<WorkflowWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                RETRY_BACKOFF_DELAY_MINUTES,
                TimeUnit.MINUTES
            )
            .setInputData(
                workDataOf(
                    WorkflowWorker.KEY_WORKFLOW_ID to workflowId,
                    KEY_TRIGGER_NODE_ID to triggerNodeId
                )
            )
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .addTag(workflowId)
            .build()

        workManager.enqueueUniqueWork(
            getWorkName(workflowId),
            ExistingWorkPolicy.REPLACE,
            workRequest
        )

        AppLogger.d(TAG, "Scheduled one-time workflow: $workflowId, trigger: $triggerNodeId, time: $specificTimeStr, delay: ${delay}ms")
        return true
    }

    /**
     * Schedule workflow using cron expression
     * 
     * Simplified cron implementation that calculates next execution time
     */
    private fun scheduleCronWorkflow(workflowId: String, triggerNodeId: String, config: Map<String, String>): Boolean {
        val cronExpression = config[CONFIG_CRON_EXPRESSION] ?: return false
        val repeat = config[CONFIG_REPEAT]?.toBoolean() ?: true

        val nextExecutionTime = calculateNextCronTime(cronExpression)
        if (nextExecutionTime == null) {
            AppLogger.e(TAG, "Failed to calculate next cron time for: $cronExpression")
            return false
        }

        val currentTime = System.currentTimeMillis()
        val delay = nextExecutionTime - currentTime

        if (delay < 0) {
            AppLogger.w(TAG, "Calculated cron time is in the past")
            return false
        }

        val constraints = Constraints.Builder()
            .setRequiresBatteryNotLow(false)
            .build()

        if (repeat) {
            // For repeated cron, we use the interval between executions
            // This is a simplified approach - ideally we'd reschedule after each execution
            val intervalMs = calculateCronInterval(cronExpression)
            if (intervalMs != null && intervalMs >= 15 * 60 * 1000) {
                val intervalMinutes = intervalMs / 60000
                val workRequest = PeriodicWorkRequestBuilder<WorkflowWorker>(
                    intervalMinutes, TimeUnit.MINUTES
                )
                    .setConstraints(constraints)
                    .setBackoffCriteria(
                        BackoffPolicy.EXPONENTIAL,
                        RETRY_BACKOFF_DELAY_MINUTES,
                        TimeUnit.MINUTES
                    )
                    .setInputData(
                        workDataOf(
                            WorkflowWorker.KEY_WORKFLOW_ID to workflowId,
                            KEY_TRIGGER_NODE_ID to triggerNodeId
                        )
                    )
                    .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                    .addTag(workflowId)
                    .build()

                workManager.enqueueUniquePeriodicWork(
                    getWorkName(workflowId),
                    ExistingPeriodicWorkPolicy.REPLACE,
                    workRequest
                )
                AppLogger.d(TAG, "Scheduled cron workflow (periodic): $workflowId, trigger: $triggerNodeId, expression: $cronExpression")
            } else {
                // Fallback to one-time for complex cron patterns
                scheduleOneTimeWorkflowWithDelay(workflowId, triggerNodeId, delay)
                AppLogger.d(TAG, "Scheduled cron workflow (one-time): $workflowId, trigger: $triggerNodeId, expression: $cronExpression")
            }
        } else {
            scheduleOneTimeWorkflowWithDelay(workflowId, triggerNodeId, delay)
            AppLogger.d(TAG, "Scheduled cron workflow (one-time): $workflowId, trigger: $triggerNodeId, expression: $cronExpression")
        }

        return true
    }

    /**
     * Helper to schedule one-time work with delay
     */
    private fun scheduleOneTimeWorkflowWithDelay(workflowId: String, triggerNodeId: String, delayMs: Long) {
        val constraints = Constraints.Builder()
            .setRequiresBatteryNotLow(false)
            .build()

        val workRequest = OneTimeWorkRequestBuilder<WorkflowWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                RETRY_BACKOFF_DELAY_MINUTES,
                TimeUnit.MINUTES
            )
            .setInputData(
                workDataOf(
                    WorkflowWorker.KEY_WORKFLOW_ID to workflowId,
                    KEY_TRIGGER_NODE_ID to triggerNodeId
                )
            )
            .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
            .addTag(workflowId)
            .build()

        workManager.enqueueUniqueWork(
            getWorkName(workflowId),
            ExistingWorkPolicy.REPLACE,
            workRequest
        )
    }

    /**
     * Cancel scheduled workflow
     *
     * 要把 continuous 的两个槽位一起取消，否则关掉开关后下一轮还会照常点火。
     * 取消要 await 完成：否则紧接着的种链查询会读到尚未落库的旧状态而误判为「链路还活着」。
     */
    suspend fun cancelWorkflow(workflowId: String) {
        workManager.cancelUniqueWork(getWorkName(workflowId)).await()
        for (slot in 0 until CONTINUOUS_SLOT_COUNT) {
            workManager.cancelUniqueWork(getContinuousSlotWorkName(workflowId, slot)).await()
        }
        AppLogger.d(TAG, "Cancelled workflow schedule: $workflowId")
    }

    /**
     * Check if workflow is scheduled
     */
    suspend fun isWorkflowScheduled(workflowId: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val names = mutableListOf(getWorkName(workflowId))
            for (slot in 0 until CONTINUOUS_SLOT_COUNT) {
                names += getContinuousSlotWorkName(workflowId, slot)
            }
            names.any { name ->
                workManager.getWorkInfosForUniqueWork(name).await()
                    .any { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.RUNNING }
            }
        } catch (e: Exception) {
            AppLogger.e(TAG, "Error checking workflow schedule status", e)
            false
        }
    }

    /**
     * Get work name for workflow
     */
    private fun getWorkName(workflowId: String): String {
        return "$WORK_NAME_PREFIX$workflowId"
    }

    /**
     * continuous 轮次的任务名。两个槽位交替使用，见 CONTINUOUS_SLOT_COUNT 的说明。
     */
    private fun getContinuousSlotWorkName(workflowId: String, slot: Int): String {
        return "${getWorkName(workflowId)}_continuous_$slot"
    }

    /**
     * Parse datetime string (ISO 8601 or common formats)
     */
    private fun parseDateTime(dateTimeStr: String): Long {
        val formats = listOf(
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd HH:mm",
            "yyyy-MM-dd"
        )

        for (format in formats) {
            try {
                val sdf = SimpleDateFormat(format, Locale.getDefault())
                val date = sdf.parse(dateTimeStr)
                if (date != null) {
                    return date.time
                }
            } catch (e: Exception) {
                // Try next format
            }
        }

        throw IllegalArgumentException("Unsupported datetime format: $dateTimeStr")
    }

    /**
     * Calculate next execution time for cron expression
     * 
     * Simplified cron parser supporting basic patterns:
     * - 0 0 * * * (daily at midnight)
     * - 0 2 * * * (every 2 hours)
     * - 15 * * * * (every 15 minutes)
     */
    private fun calculateNextCronTime(cronExpression: String): Long? {
        val parts = cronExpression.trim().split("\\s+".toRegex())
        if (parts.size < 5) {
            AppLogger.e(TAG, "Invalid cron expression: $cronExpression")
            return null
        }

        val minute = parts[0]
        val hour = parts[1]
        val dayOfMonth = parts[2]
        val month = parts[3]
        val dayOfWeek = parts[4]

        val calendar = Calendar.getInstance()
        calendar.add(Calendar.MINUTE, 1) // Start from next minute

        // Simple cron pattern matching
        return when {
            // Daily at specific time: "0 0 * * *"
            minute.matches("\\d+".toRegex()) && hour.matches("\\d+".toRegex()) && 
            dayOfMonth == "*" && month == "*" && dayOfWeek == "*" -> {
                calculateDailyTime(minute.toInt(), hour.toInt())
            }
            // Every N hours: "0 */N * * *"
            minute == "0" && hour.startsWith("*/") && 
            dayOfMonth == "*" && month == "*" && dayOfWeek == "*" -> {
                val hourInterval = hour.substring(2).toIntOrNull() ?: return null
                val nextTime = Calendar.getInstance()
                nextTime.add(Calendar.HOUR_OF_DAY, hourInterval)
                nextTime.set(Calendar.MINUTE, 0)
                nextTime.set(Calendar.SECOND, 0)
                nextTime.timeInMillis
            }
            // Every N minutes: "*/N * * * *"
            minute.startsWith("*/") && hour == "*" && 
            dayOfMonth == "*" && month == "*" && dayOfWeek == "*" -> {
                val minuteInterval = minute.substring(2).toIntOrNull() ?: return null
                val nextTime = Calendar.getInstance()
                nextTime.add(Calendar.MINUTE, minuteInterval)
                nextTime.set(Calendar.SECOND, 0)
                nextTime.timeInMillis
            }
            else -> {
                AppLogger.w(TAG, "Unsupported cron pattern: $cronExpression")
                null
            }
        }
    }

    /**
     * Calculate next daily execution time
     */
    private fun calculateDailyTime(minute: Int, hour: Int): Long {
        val calendar = Calendar.getInstance()
        calendar.set(Calendar.HOUR_OF_DAY, hour)
        calendar.set(Calendar.MINUTE, minute)
        calendar.set(Calendar.SECOND, 0)
        calendar.set(Calendar.MILLISECOND, 0)

        // If time has passed today, schedule for tomorrow
        if (calendar.timeInMillis <= System.currentTimeMillis()) {
            calendar.add(Calendar.DAY_OF_MONTH, 1)
        }

        return calendar.timeInMillis
    }

    /**
     * Calculate interval in milliseconds for cron expression
     * Returns null for complex patterns
     */
    private fun calculateCronInterval(cronExpression: String): Long? {
        val parts = cronExpression.trim().split("\\s+".toRegex())
        if (parts.size < 5) return null

        val minute = parts[0]
        val hour = parts[1]

        return when {
            // Daily
            minute.matches("\\d+".toRegex()) && hour.matches("\\d+".toRegex()) -> {
                24 * 60 * 60 * 1000L
            }
            // Every N hours
            minute == "0" && hour.startsWith("*/") -> {
                val hourInterval = hour.substring(2).toLongOrNull() ?: return null
                hourInterval * 60 * 60 * 1000
            }
            // Every N minutes
            minute.startsWith("*/") && hour == "*" -> {
                val minuteInterval = minute.substring(2).toLongOrNull() ?: return null
                minuteInterval * 60 * 1000
            }
            else -> null
        }
    }

    /**
     * Get next execution time for a workflow
     */
    fun getNextExecutionTime(workflow: Workflow): Long? {
        val triggerNode = workflow.nodes.filterIsInstance<TriggerNode>()
            .firstOrNull { it.triggerType == "schedule" }
            ?: return null

        val config = triggerNode.triggerConfig
        val scheduleType = config[CONFIG_SCHEDULE_TYPE] ?: return null

        return when (scheduleType) {
            SCHEDULE_TYPE_SPECIFIC_TIME -> {
                config[CONFIG_SPECIFIC_TIME]?.let { parseDateTime(it) }
            }
            SCHEDULE_TYPE_CRON -> {
                config[CONFIG_CRON_EXPRESSION]?.let { calculateNextCronTime(it) }
            }
            SCHEDULE_TYPE_INTERVAL -> {
                // For interval, next execution is interval from now
                val intervalMs = config[CONFIG_INTERVAL_MS]?.toLongOrNull() ?: return null
                System.currentTimeMillis() + intervalMs
            }
            SCHEDULE_TYPE_CONTINUOUS -> {
                // 下一轮从上一轮结束时刻起算，此刻还没有可预告的时间点
                null
            }
            else -> null
        }
    }
}

