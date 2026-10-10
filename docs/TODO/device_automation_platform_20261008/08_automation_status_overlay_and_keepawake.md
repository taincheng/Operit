---
status: backlog
For_Agent: 本步骤暂缓，尚未实施。里面的结论是直接查宿主代码得到的，重新发起时从这里起步即可，不必再查一遍
---

# 自动化状态浮窗与采集期间保亮

## 为什么记在这里

采集要长时间无人值守，现在有两个痛点：

- 采集期间界面上看不到"正在做什么、采到第几条"，只能事后翻日志
- 屏幕一旦息掉，输入注入会被丢，采集直接失败

用户见过其他无障碍自动化产品有常驻浮窗显示当前工作信息，希望本项目也能有类似能力。当前决定暂缓实施，先把结论与方案记下来。

## 实测结论

以下都是查宿主代码得到的，不是推测。

### 现成的浮窗设施

- `FloatingChatService` 加 `ui/floating/FloatingChatWindow.kt`：悬浮窗有四种形态，悬浮球、窗口、全屏、屏幕 OCR，需要悬浮窗权限
- `UIDebuggerService` 加 `services/floating/UIDebuggerWindowManager.kt`：浮窗 UI 调试器，是 Compose 浮窗，常驻在其他应用之上，实时显示当前前台应用的节点树。形态上最接近"常驻显示实时信息"，但它显示的是节点树，不是任务进度
- 两者都不是任务状态浮窗

### 进度通道的现状

- `core/tools/ToolProgressBus.kt` 是全局进度总线，字段为 `toolName`、`progress`、`message`
- 它只被两处渲染：`AgentChatInputSection.kt` 与 `ClassicChatInputSection.kt`，也就是主聊天界面的输入区，不在悬浮窗里
- 脚本的 `sendIntermediateResult()` 走 `NativeInterface.sendCallIntermediateResult` 再进 `JsToolManager.onIntermediateResult`，那里只发一条 trace
- 关键一条：`WorkflowExecutor` 调用工具用的是 `toolHandler.executeTool(tool)`，是非流式路径，不是聊天那条流式路径。所以定时工作流运行时，采集每条上报的进度不会出现在任何界面上，只进 trace 与日志

### 息屏与休眠

- 全仓没有任何点亮屏幕或越过锁屏的调用：`setTurnScreenOn`、`FLAG_TURN_SCREEN_ON`、`showWhenLocked`、`KEYCODE_WAKEUP` 零命中
- 全仓唯一的唤醒锁在 `FloatingChatService`，是 `PARTIAL_WAKE_LOCK`，只保 CPU 不保屏幕，且限时 10 分钟
- 屏幕常亮设置 `keep_screen_on`（默认开）由 `ActivityLifecycleManager` 给可见窗口加 `FLAG_KEEP_SCREEN_ON`。采集期间前台是抖音，这个标志不适用
- `WorkflowScheduler` 用 WorkManager，`WorkflowWorker` 是普通 `CoroutineWorker`，受 10 分钟执行上限约束，且周期性任务在 Doze 里会被推迟
- 目前能跑通的真实原因：采集过程每约 30 秒有一次注入输入，输入事件会重置息屏计时。活跃阶段因此不会睡，但两条之间若系统息屏超时更短就会中断
- `WAKE_LOCK` 权限已申请，做屏幕锁不需要再加权限

### 现场补充（2026-10-10 上午）

过夜跑了一段，实测把这个步骤的必要性坐实了：

- 10-09 19:11 到 10-10 06:01 之间应用日志没有任何活动，等于设备睡下去之后**工作流一次都没点火**，空窗约 11 小时。日志本身是连续的，不是被截断
- 10-10 10:05 与 10:15 两次点火都失败在「等待分享链接」，页面停在搜索结果页。同一时刻另一次运行却采到了第 12 条，说明失败与代码无关，取决于当时的前台状态与时机
- 截至 10-10 10:22，outbox 里积压 78 条 pending，服务端没收到

最后一条的原因值得单独记：多次日志显示采集节点成功之后紧接着就是 `工作流执行已取消`，上报节点因此被跳过。怀疑与两种机制有关，但都还没证实：

- `WorkflowWorker` 是普通 `CoroutineWorker`，可能受 10 分钟执行上限影响，而单片耗时正好在 10 分钟上下
- 新一次定时点火会取消正在跑的那一片

无论哪种，用户侧的缓解手段都一样：先做关电池优化与插电，根治要等方案 D。

## 方案

按代价分层，都未实施。

| 方案 | 内容 | 备注 |
| --- | --- | --- |
| A 最小 | 让悬浮窗订阅 `ToolProgressBus`，并把工具执行路径的 intermediate 也喂进总线 | 改动小，但悬浮窗需要用户手动打开 |
| B 对症 | 专用「采集状态浮窗」，显示关键词、片序、已采与目标、当前 URL，采集期间自动显示与隐藏 | 需要补一条脚本到浮窗的通道，现有总线字段不够用 |
| C 保亮 | 上面任一浮窗带 `FLAG_KEEP_SCREEN_ON` | 它是覆盖在其他应用之上的窗口，前台是抖音时同样生效 |
| D 调度 | `WorkflowWorker` 改前台 Worker | 去掉 10 分钟上限，降低被 Doze 推迟的概率 |

倾向 B 加 C，D 可选。

## 不写代码时可以先做的

- 给 Operit 关电池优化：设置、应用、Operit、电池、无限制
- 插电运行，并打开开发者选项里的「充电时不锁定屏幕」
- 屏幕超时设为永不
- 每片条数从 20 降到 10 至 15，让单片耗时离 10 分钟上限有余量

## 验证清单

1. 采集期间浮窗显示关键词、片序、已采与目标、当前条目
2. 前台是抖音时屏幕保持常亮
3. 单片耗时超过 10 分钟不再被中途掐断
4. 息屏（未进 Doze）与进 Doze 两种情况下，定时点火的真实延迟

[BACKLOG]
