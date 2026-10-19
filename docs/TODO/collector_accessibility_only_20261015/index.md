---
repository: https://github.com/taincheng/Operit
status: planning
For_Agent: 结论来自 2026-10-15 的真机实测，动手改造前先读 [01 实测记录](01_ax_only_verification.md)，不要重新凭猜测推翻它
---

# 抖音采集去 Shizuku 依赖（纯无障碍档可跑）

## 现状

采集包（`my-packages/{douyin,xhs,kuaishou}-collector`）的 driver 用 shell 做四件事，而宿主的 `execute_shell` 严格按用户首选权限档派发、没有回退（[AndroidShellExecutor.kt](../../../app/src/main/java/com/ai/assistance/operit/core/tools/system/AndroidShellExecutor.kt)）：

| driver 里的用法 | 位置 |
| --- | --- |
| `wm size` 读屏幕高度 | [douyin_collector.ts:495](../../../my-packages/douyin-collector/src/packages/douyin_collector.ts#L495) |
| `input keyevent 4` 返回键 | [douyin_collector.ts:345](../../../my-packages/douyin-collector/src/packages/douyin_collector.ts#L345) |
| `input keycombination 113 29` + `input keyevent 67` 清空输入框 | [douyin_collector.ts:413](../../../my-packages/douyin-collector/src/packages/douyin_collector.ts#L413) |
| `input keyevent 279` 粘贴 | [douyin_collector.ts:381](../../../my-packages/douyin-collector/src/packages/douyin_collector.ts#L381) |

ACCESSIBILITY 档下 shell 直接失败，实测原文：

```
ADB command execution failed (exit code: -1):
Current ACCESSIBILITY unavailable: executor unavailable; Accessibility service is not enabled
```

顺带发现：[AccessibilityShellExecutor.kt](../../../app/src/main/java/com/ai/assistance/operit/core/tools/system/shell/AccessibilityShellExecutor.kt) 的可用性判断用了一个不存在的类名（`<pkg>/.accessibility.YourAccessibilityService`），所以它的 `isAvailable()`/`hasPermission()` 恒为 false。它本来也不执行 shell，但这条报错文案会把人误导成「无障碍服务没开」。

结果就是：**一个面向普通用户的采集功能被绑死在 Shizuku 上**——要开开发者选项，每次重启后还要用 ADB（或无线调试）重新拉起 Shizuku。

## 意图

把采集链路改成「只开一次无障碍服务」即可运行，不依赖 Shizuku / root / 电脑。

## 实测结论

2026-10-15 在真机（24094RAD4C / HyperOS / Android 15 / 抖音 37.8.0 / Operit debug 1.12.2）上，把权限档切成 ACCESSIBILITY 后逐项验证，四个 shell 用法都有纯无障碍替代，且跑通了完整的取链闭环：

| 现有 shell 用法 | 纯无障碍替代 | 结果 |
| --- | --- | --- |
| `wm size` | `Tools.System.getDeviceInfo()`（DisplayMetrics） | ✅ 返回 `1080x2400` |
| `input keyevent 4` | `Tools.UI.pressKey("KEYCODE_BACK")`（GLOBAL_ACTION_BACK） | ✅ 分享面板由「开着」变「关掉」 |
| `Ctrl+A` + `DEL` | `toolCall("set_input_text", {text:""})`（provider `setTextOnNode`） | ✅ 评论框恢复占位文案 |
| `input keyevent 279` | 长按评论框 → 点抖音工具条上的「粘贴」 | ✅ 拿到 `https://v.douyin.com/ag2cnC_ZSkU/` |

三条约束，改造时必须记住：

1. **粘贴省不掉**。`read_clipboard` 在抖音处于前台时读到的是空字符串（本次在 ACCESSIBILITY 档下复测，仍是空），这是 Android 10 起的焦点限制，与权限档无关。所以「让目标应用自己粘」是唯一路线。
2. **抖音的粘贴工具条不在无障碍节点树里**。长按之后工具条【粘贴】【常用语】【自动填充】在屏幕上是可见的（截图 `shots/01_after_provider_longpress.png`），但同一时刻的树里没有任何含「粘贴」的节点。provider 的 AIDL 也没有 `ACTION_PASTE`（[IAccessibilityProvider.aidl](../../../app/src/main/aidl/com/ai/assistance/operit/provider/IAccessibilityProvider.aidl) 只有 `performGlobalAction` / `setTextOnNode` / `performClick` / `performSwipe` 等）。
3. **provider 源码不在本仓库**（`UIAccessibilityService` 全仓无匹配），它是独立安装的 `com.ai.assistance.operit.provider`。

## 落地：方案 A 已于 2026-10-15 落地到三个采集包 0.2.0

三个包的驱动都改成了纯无障碍原语，**不动宿主、不动 provider**（三包同构，改动一致）：

| 现有 | 改为 |
| --- | --- |
| `wm size` | `Tools.System.getDeviceInfo()` 的 `screenResolution` |
| `input keyevent 4` | `Tools.UI.pressKey("KEYCODE_BACK")` |
| `Ctrl+A` + `DEL` | `toolCall("set_input_text", {text:""})` |
| `input keyevent 279` | 长按评论框 + 按偏移点该 App 自己的工具条「粘贴」 |

包内已无任何 `Tools.System.shell` 调用；manifest 版本：抖音 0.1.1 → 0.2.0、小红书 0.1.3 → 0.2.0、快手 0.1.0 → 0.2.0。三个包各自在 ACCESSIBILITY 档下跑通真机回归（Shizuku 未参与），小红书与快手还把**完整工作流**（含上报节点与连续续跑）在该档位跑了多轮，见 [01](01_ax_only_verification.md) 的第 6、7、8 节。

工具条偏移量三个 App 各不相同，**不能互抄**（小红书的「粘贴」是第二个按钮）：

| 包 | 工具条顺序 | 偏移（锚点=输入框左上角） | 实测环境 |
| --- | --- | --- | --- |
| 抖音 | 粘贴·常用语·自动填充 | `+139 / -139` | 抖音 37.8.0 |
| 小红书 | 常用语·**粘贴**·换行·自动填充 | `+253 / -169` | 小红书 9.22.1 |
| 快手 | 粘贴·常用语·自动填充 | `+135 / -145` | 快手 14.1.10.46550 |

截图证据：`shots/01_after_provider_longpress.png`（抖音）、`shots/02_xhs_longpress.png`（小红书）、`shots/04_ks_longpress.png`（快手）。

方案 B 仍然保留为后续优化：它能把「工具条坐标表」彻底去掉，规格与宿主清单见 [02 provider 侧 ACTION_PASTE 接口](02_provider_action_paste.md)。

## 作用域

- 方案 A（已落地）：只改 `my-packages/{douyin,xhs,kuaishou}-collector` 的 driver 与包文档。
- 方案 B（未落地）：额外涉及 provider 项目、[UIHierarchyManager.kt](../../../app/src/main/java/com/ai/assistance/operit/data/repository/UIHierarchyManager.kt) 与 UI 工具链（`DEFAULT_TOOLS_ARCH.md` 的完整清单）。

## 顺带发现：`tools/adb/execute_js.sh` 对 debug APK 不可用

它把 receiver 写成 `$APP_PACKAGE/.core.tools.javascript.ScriptExecutionReceiver`。debug APK 的 applicationId 是 `com.ai.assistance.operit.debug`，而类名的包前缀是 `com.ai.assistance.operit`，`am` 会把开头的 `.` 展开成 applicationId，于是变成 `com.ai.assistance.operit.debug.core.tools...`，广播根本到不了 receiver（`am broadcast` 仍打印 `Broadcast completed: result=0`，现象很像「被 ROM 拦截」——[device_automation_platform_20261008/index.md:72](../device_automation_platform_20261008/index.md#L72) 就是这么记的）。本次用 [run_probe.sh](run_probe.sh) 里的全限定类名绕开，并确认广播链路本身是通的。

## 状态

- [x] 真机验证「纯无障碍档能否跑通采集取链闭环」——见 [01 实测记录](01_ax_only_verification.md)
- [x] 抖音包按方案 A 改造并真机回归（0.2.0，ACCESSIBILITY 档三片成功）
- [x] 小红书包与快手包的同款改造并各自真机回归（均 0.2.0，ACCESSIBILITY 档各一片成功）——见 [01 第 7 节](01_ax_only_verification.md#7-小红书与快手的回归020accessibility-档)
- [x] 小红书（3 轮）与快手（4 轮）**完整工作流**回测：含上报节点与连续续跑，`pending=0`——见 [01 第 8 节](01_ax_only_verification.md#8-工作流级别回测accessibility-档含上报节点与连续触发)
- [x] 小红书**正式工作流**（`021fc29b`，interval 15 分钟 / count=10 / 上限 18 分钟）回测 2 轮：一轮满额 10 条，`interval` 按 15 分钟节拍重复触发——见 [01 第 8 节](01_ax_only_verification.md#8-工作流级别回测accessibility-档含上报节点与连续触发)
- [ ] 抖音的工作流级别回测（目前只回测到采集节点级）
- [ ] 长时间连续跑（小时级）、抖音图文作品、小红书视频笔记、分享面板含联系人行时的工具条位置稳定性
- [ ] 方案 B（provider `ACTION_PASTE`）：provider 项目位置待确认，落地后可删掉坐标表
