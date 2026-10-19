package com.ai.assistance.operit.core.workflow

import android.content.Context
import com.ai.assistance.operit.util.AppLogger
import com.ai.assistance.operit.data.repository.WorkflowRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * WorkflowSchedulerInitializer
 * 
 * Initializes workflow scheduling when the app starts.
 * Re-schedules all enabled workflows to ensure they continue running
 * even if the app was force-stopped or updated.
 *
 * continuous 调度的重排是幂等的：链路还活着时种链不做任何事，因此冷启动既不会额外点火，
 * 也不会取消正在跑的那一轮。
 */
object WorkflowSchedulerInitializer {
    
    private const val TAG = "WorkflowSchedulerInit"
    
    /**
     * Initialize workflow scheduling
     * Should be called from Application.onCreate()
     */
    fun initialize(context: Context) {
        AppLogger.d(TAG, "Initializing workflow scheduler...")
        
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val repository = WorkflowRepository(context.applicationContext)
                val result = repository.getAllWorkflows()
                
                result.getOrNull()?.let { workflows ->
                    var scheduledCount = 0
                    
                    workflows.forEach { workflow ->
                        if (workflow.enabled) {
                            val success = repository.scheduleWorkflow(workflow.id)
                            if (success) {
                                scheduledCount++
                                AppLogger.d(TAG, "Scheduled workflow: ${workflow.name} (${workflow.id})")
                            }
                        }
                    }
                    
                    AppLogger.d(TAG, "Workflow scheduler initialized. Scheduled $scheduledCount workflows.")
                } ?: run {
                    AppLogger.w(TAG, "Failed to get workflows during initialization")
                }
            } catch (e: Exception) {
                AppLogger.e(TAG, "Error initializing workflow scheduler", e)
            }
        }
    }
}

