---
For_Agent: 本篇是方案 B 的接口规格。方案 A 已先落地（抖音包 0.2.0，见 01 第 6 节），本篇留作后续优化：它能删掉「工具条坐标表」。动手前先确认 provider 项目位置；宿主侧清单照 DEFAULT_TOOLS_ARCH.md 逐条办
---

# 02 provider 侧 ACTION_PASTE 接口（方案 B，未落地）

> 现状：2026-10-15 先按方案 A 落地了抖音包（长按 + 按偏移点工具条，实测可用）。方案 B 的目标是去掉那份
> 版本相关的坐标表，并让宿主对所有 App 都具备「节点级粘贴」能力。本篇是它的接口规格。

## 旧状态

- 宿主持有的 provider AIDL 副本只有这些方法：`getUiHierarchy` / `performClick` / `performLongPress` / `performGlobalAction` / `performSwipe` / `findFocusedNodeId` / `setTextOnNode` / `takeScreenshot` / `isAccessibilityServiceEnabled` / `getCurrentActivityName`（[IAccessibilityProvider.aidl](../../../app/src/main/aidl/com/ai/assistance/operit/provider/IAccessibilityProvider.aidl)）
- 采集取链的最后一步「让目标应用自己粘贴」因此只能用 shell 的 `input keyevent 279`；纯无障碍档下无路可走，只能退回长按工具条 + 坐标（实测见 [01](01_ax_only_verification.md)）
- provider 的 APK 随宿主入库：`app/src/main/assets/accessibility.apk` 与 `app/src/main/assets/accessibility_version.txt`（当前 **1.5**），安装与升级入口是 [AccessibilityProviderInstaller.kt](../../../app/src/main/java/com/ai/assistance/operit/core/tools/system/AccessibilityProviderInstaller.kt)（`isUpdateNeeded` / `launchInstall`），界面在 `ShizukuDemoScreen` 的 provider 卡片

## 意图

给 provider 加一个「在指定节点上执行粘贴」的节点动作，宿主加一个对应的 UI 工具，driver 用它替换 `input keyevent 279`。目标是：纯无障碍档下取链闭环成立，且不留坐标表。

## 接口

AIDL 只增不改：

```aidl
boolean performPasteOnNode(String nodeId);
```

- provider 侧：复用 `setTextOnNode` 里那套「按 nodeId 找回 AccessibilityNodeInfo」的逻辑，执行 `node.performAction(AccessibilityNodeInfo.ACTION_PASTE)`
- 返回值语义要写死：`true` = 节点存在且粘贴动作已下发；`false` = 节点找不到或该节点不接受粘贴。不允许「不确定也返回 true」
- 为什么传 nodeId 而不是「粘到当前焦点」：与 `setTextOnNode` 对称，provider 不承担焦点判断；焦点解析留在宿主（`findFocusedNodeId` 已有）

## 宿主侧清单（照 [DEFAULT_TOOLS_ARCH.md](../../doc-src/architecture/DEFAULT_TOOLS_ARCH.md) 逐条）

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `app/src/main/aidl/com/ai/assistance/operit/provider/IAccessibilityProvider.aidl` | 加 `performPasteOnNode` |
| 2 | `data/repository/UIHierarchyManager.kt` | 加 `performPasteOnNode(context, nodeId)`，照 `setTextOnNode` 写：`RemoteException` 记日志后返回 false |
| 3 | `core/tools/defaultTool/standard/StandardUITools.kt` | `pasteInputText` 返回 `OPERATION_NOT_SUPPORTED`（与 `setInputText`/`pressKey` 同款） |
| 4 | `core/tools/defaultTool/accessbility/AccessibilityUITools.kt` | 实现 `pasteInputText`：`findFocusedNodeId` + `performPasteOnNode`，与 `setInputText` 同构 |
| 5 | `core/tools/defaultTool/{debugger,admin,root}/*UITools.kt` | `DebuggerUITools` 在无障碍开启且无 display 参数时转给父类（照 `setInputText` 的既有先例）；其余档位沿继承链拿到基类行为 |
| 6 | `core/tools/ToolRegistration.kt` | 注册工具 `paste_input_text` |
| 7 | `core/config/SystemToolPrompts.kt` | 工具 schema 与提示词（中英两版） |
| 8 | `core/tools/javascript/JsTools.kt` | `Tools.UI.pasteInputText()`；顺带补上目前缺的 `setInputText()`（driver 清空输入框要用） |
| 9 | `examples/types/ui.d.ts`、`examples/types/tool-types.d.ts` | 类型与返回 |
| 10 | `docs/doc-src/package-dev/*.md` | 公开 API 文档 |
| 11 | `app/src/main/res/values*/strings.xml` | 工具描述键（9 个语种，`check_localizations.py` 会校验占位符） |
| 12 | `app/src/main/assets/accessibility.apk` + `accessibility_version.txt` | 换成新 provider（1.6） |

## 版本与兼容

两种组合都必须有明确行为，不留静默路径：

- **旧 provider（1.5）+ 新宿主**：AIDL 多出的方法在老 provider 的 `onTransact` 里不认，Binder 会以失败/异常返回。因此 `paste_input_text` 在调用前用 `AccessibilityProviderInstaller` 判断已安装 provider 是否低于要求版本，低于就直接报「无障碍服务版本过旧，更新后才能采集」，把用户引到已有的 provider 升级入口。这不是兜底：它不换路，只是把一个必然失败的动作提前说清楚
- **新 provider + 旧宿主**：无影响，多余方法不会被调用
- **provider 版本号必须 +1**（1.5 → 1.6）：`isUpdateNeeded` 是逐段比大小的，版本号不动的话用户侧根本不会触发更新

## driver 侧改动（douyin / xhs / kuaishou 三个包同构）

| 现有 | 改为 |
| --- | --- |
| `wm size` + 正则解析 | `Tools.System.getDeviceInfo()` 的 `screenResolution` |
| `input keyevent 4` | `Tools.UI.pressKey("KEYCODE_BACK")` |
| `input keycombination 113 29` + `input keyevent 67` | `Tools.UI.setInputText("")` |
| `input keyevent 279` | 点评论框后 `Tools.UI.pasteInputText()` |

方案 B 不需要 01 里那份「工具条偏移量」坐标表，也不需要为了长按而多一次读页面。

## 验证

- 重跑 [01](01_ax_only_verification.md) 的取链流程，把「长按 + 坐标点工具条」换成 `pasteInputText`，判据不变：回读到 `v.douyin.com` 短链、清空后回到占位文案
- 覆盖：图文作品、分享面板含联系人行（面板更高）、连续工作流多轮
- 兼容项：故意装回 1.5 provider，确认工具报的是「版本过旧」而不是别的错

## 状态

- [x] 接口方案与宿主清单
- [x] driver 侧四处 shell 已换成无障碍原语（方案 A，抖音包 0.2.0）——本篇只剩「把坐标点工具条换成 `pasteInputText`」这一步
- [ ] provider 项目改动（**待确认项目位置**）
- [ ] 宿主侧改动与重新打包 provider APK
- [ ] 小红书 / 快手两个包的同款改造与真机回归
