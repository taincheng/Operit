---
For_Agent: 本篇是实测记录。每一条结论都有证据文件，重跑用同目录的 run_probe.sh，不要凭猜测改写结论
---

# 纯无障碍档实测记录

## 环境

| 项 | 值 |
| --- | --- |
| 设备 | Xiaomi 24094RAD4C（HyperOS，Android 15，与既有采集计划同一台） |
| 宿主 | `com.ai.assistance.operit.debug` 1.12.2 |
| 抖音 | 37.8.0（`com.ss.android.ugc.aweme`） |
| 无障碍 provider | `com.ai.assistance.operit.provider` 已启用（`enabled_accessibility_services` 里在列） |
| 权限档 | **ACCESSIBILITY**（探针运行期间）；Shizuku 当时在跑，但采集链路一次都没用到 shell |
| 界面占用 | 验证期间停用了设备上连续跑的「快手采集与上报」工作流，跑完已恢复 |

## 方法

- **怎么切档**：权限档存在 DataStore `files/datastore/android_permission_preferences.preferences_pb`，`preferred_permission_level` 取值 `DEBUGGER`/`ACCESSIBILITY`。切档要 `am force-stop` 之后写文件再启动，否则 DataStore 会覆盖；档位在工具注册时被取用（[ToolRegistration.kt:1900](../../../app/src/main/java/com/ai/assistance/operit/core/tools/ToolRegistration.kt#L1900)），所以必须重启应用。
- **怎么跑脚本**：用 [run_probe.sh](run_probe.sh)。**不要用 `tools/adb/execute_js.sh`**，它把 receiver 写成 `$APP_PACKAGE/.core.tools...`，对 debug APK 会展开成 `com.ai.assistance.operit.debug.core.tools...`，广播到不了（详见 [index.md](index.md) 的顺带发现）。
- **探针**：[probe_ax_only.js](probe_ax_only.js)。每个函数只做验证与取证，不写业务代码、不改配置；失败时返回失败步骤与现场节点，不猜。
- **证据**：结构化结果留在 `evidence_*.json`，屏幕现场留在 `shots/`。

## 1. 档位现场（`tierReport`）

证据：[evidence_tier_ax.json](evidence_tier_ax.json)

| 项 | 结果 |
| --- | --- |
| `Tools.System.getDeviceInfo()` | `1080x2400`，density 2.8125 —— 与 `wm size` 同值，**不需要 shell** |
| `Tools.System.shell("wm size")` | 失败：`Current ACCESSIBILITY unavailable: executor unavailable; Accessibility service is not enabled` |
| `Tools.UI.getPageInfo()` | 正常返回节点树（当前前台是抖音时也正常） |
| `Tools.System.readClipboard()`（抖音前台） | 返回空字符串 —— 粘贴这一步不能用「读剪贴板再 setText」绕开 |

## 2. 返回键（`press_key` 替代 `input keyevent 4`）

在完整流程里验的，判据是节点而不是 `activityName`（后者实测会返回 `androidx.compose.ui.platform.ComposeView`、`com.lynx.tasm.behavior.KeyboardMonitor` 这类东西，不可用）：

- 打开分享面板 → 树里可见「分享链接」项 → `Tools.UI.pressKey("KEYCODE_BACK")` → 再读树：`panelStillOpen = false`，面板项消失、详情页节点回来
- 证据见 [evidence_paste_by_toolbar.json](evidence_paste_by_toolbar.json) 的 `closePanelBack`（上一次不带节点判据的 `backProbe` 用首页也匹配到的「综合」当标记，判据不成立，已废弃）

## 3. 输入框写入与清空（`set_input_text` 替代 `Ctrl+A` + `DEL`）

抖音搜索输入页（`et_search_kw`）与视频评论框（`enc`）两处都测了：

| 动作 | 结果 |
| --- | --- |
| `set_input_text` 写入探针文本 | ✅ 字段值变成 `AX_ONLY_PROBE_TEXT` |
| `set_input_text("")` 清空（评论框） | ✅ 恢复占位文案「发条评论，说说你的感受」 |
| `set_input_text("")` 清空（搜索框） | 字段变成热词建议「实体店引流技巧」——**这是抖音自己的行为**，不是清空失败。清空的判据必须是「真的为空」，用「不再包含探针文本」会误判成成功 |

## 4. 粘贴：长按 + 点工具条（`input keyevent 279` 的替代）

这是唯一没有现成宿主原语的一步，分两段取证。

### 4.1 长按确实生效，但工具条不在节点树里

- 第一次失败的原因是用「点击前」的坐标长按：点一下评论框会打开评论面板，输入框从 `[79,2166][692,2233]` 移到 `[34,966][1040,1105]`，旧坐标落在了别处。改用点击后重新读到的坐标后，长按生效
- 长按后树里**没有**任何含「粘贴」的节点（[evidence_longpress_diag.json](evidence_longpress_diag.json)），但截图 [shots/01_after_provider_longpress.png](shots/01_after_provider_longpress.png) 显示抖音的工具条【粘贴】【常用语】【自动填充】就在屏幕上，键盘联想栏里还带着剪贴板里的分享口令

结论：抖音的粘贴工具条是 provider 当前拿不到的那个窗口。宿主也没有 `ACTION_PASTE`（[IAccessibilityProvider.aidl](../../../app/src/main/aidl/com/ai/assistance/operit/provider/IAccessibilityProvider.aidl)），provider 源码不在本仓库。

### 4.2 按坐标点它，全流程跑通

`pasteByToolbarProbe` 用「输入框左上角 + 偏移」推算工具条「粘贴」的位置（本机本版本实测 offsetX=+139、offsetY=-139），一次成功：

```
toolbarTap        target={x:173,y:827}  editTextTopLeft={x:34,y:966}
afterPaste        text="4.87 复制打开抖音，看看【梅酱紫吃什么的作品】… https://v.douyin.com/ag2cnC_ZSkU/ 11/01 :2pm baA:/ j@c.At "
afterClear        text="发条评论，说说你的感受"
```

证据：[evidence_paste_by_toolbar.json](evidence_paste_by_toolbar.json)。至此「分享 → 分享链接 → 返回键关面板 → 长按评论框 → 点粘贴 → 回读短链 → 清空输入框」在 ACCESSIBILITY 档下一次 shell 都没用。

## 6. 改造后真机回归（抖音包 0.2.0，ACCESSIBILITY 档）

驱动改成纯无障碍原语之后（改动见 [index.md](index.md) 的状态段），按仓库既有做法在真机上跑了一轮回归：

1. `npx tsc -p my-packages/douyin-collector/tsconfig.json` 重新编译 `dist/`
2. 把整个包目录打成 `.toolpkg` 推到 `/sdcard/Android/data/<pkg>/files/packages/`，再用 `com.ai.assistance.operit.DEBUG_INSTALL_TOOLPKG` 广播安装（receiver 用全限定类名）。日志：`Successfully installed debug toolpkg: com.taincheng.douyin_collector_bundle`；抽出来的代码里能 grep 到新常量 `PASTE_BUTTON_OFFSET_X`，确认设备上跑的是新构建
3. 用 [fixtures/workflow_ax_regress.json](fixtures/workflow_ax_regress.json) 推一个只跑采集节点、不跑上报节点的回归工作流（`count=1`、`chunk_minutes=3`，避免往服务端写数据）
4. 档位切到 ACCESSIBILITY 后启动应用，让连续触发器立刻跑第一轮

实测结果（[evidence_regression_ax_tier.log](evidence_regression_ax_tier.log)）：

```
18:15:24 调用工具: douyin_collector:douyin_collect_share_links, 参数: 3 个
18:15:24 本轮第 18 片开始，本片目标 1 条，时间上限 3 分钟
18:15:38 点击「「视频」标签」坐标=(283,289)
18:15:46 第 1 页：本页可见 4 张卡片，本片这一页取 1 条
18:16:07 已采集第 1 条：https://v.douyin.com/thqcTutAFl8/
18:16:07 节点执行成功: 采一条分享链接 … "collectedTotal":103
```

第 19 片同样成功（`https://v.douyin.com/IgM8snB_KhU/`，累计 104），验证期间 Shizuku 虽然在跑但整条链路一次都没用到 shell。这两条记录留在 `records.jsonl` 与 outbox 里（本轮没跑上报节点），下一次正式采集的上报节点会带出去。

随后补了一处前提（长按之前先 `set_input_text("")`：工具条的按钮集合取决于输入框里有没有文本，空时最左是「粘贴」，有草稿时变成「全选 / 复制 / 粘贴」，坐标就会点错），重新编译、重新安装、再跑一轮确认：第 21 片成功（`https://v.douyin.com/S0t_f1j-ABY/`，累计 105）。这一轮的完整日志在 [evidence_regression_ax_tier.log](evidence_regression_ax_tier.log)。

回归结束后把设备恢复原状：删掉回归工作流、快手工作流重新启用、权限档改回 DEBUGGER。残留的那一轮定时任务读到「工作流不存在」即停链（`Workflow execution failed: 工作流不存在`），没有副作用。

## 7. 小红书与快手的回归（0.2.0，ACCESSIBILITY 档）

两个包按同一套改法改造（返回键、清空、屏幕高度三处同构），粘贴这一步各自真机量了一次工具条：

- **小红书**：长按评论框后工具条是【常用语】【粘贴】【换行】【自动填充】，「粘贴」是**第二个**。实测编辑器 `[84,1105][996,1204]` 时「粘贴」中心在 `(337,936)` → 偏移 `+253 / -169`。截图 [shots/02_xhs_longpress.png](shots/02_xhs_longpress.png)，按这个坐标点下去，编辑器确实收到了剪贴板文本（[shots/03_xhs_after_tap.png](shots/03_xhs_after_tap.png)）。回归：第 106 片成功拿到 `https://xhslink.cn/o/4NRSKPo3tXn`，累计 227。
- **快手**：长按评论编辑器后工具条是【粘贴】【常用语】【自动填充】，「粘贴」是**第一个**。实测编辑器 `[31,1080][1049,1243]` 时「粘贴」中心在 `(166,935)` → 偏移 `+135 / -145`。截图 [shots/04_ks_longpress.png](shots/04_ks_longpress.png)，按这个坐标点下去，编辑器收到了剪贴板文本。回归：第 106 片成功拿到 `https://v.kuaishou.com/JRZgcitt`，累计 234。

日志摘录：[evidence_regression_xhs_ks_ax_tier.log](evidence_regression_xhs_ks_ax_tier.log)。回归工作流模板：[fixtures/workflow_ax_xhs_regress.json](fixtures/workflow_ax_xhs_regress.json)、[fixtures/workflow_ax_ks_regress.json](fixtures/workflow_ax_ks_regress.json)（都只跑采集节点，不往服务端写数据）。

三个 App 的工具条差异（顺序与偏移）说明这份坐标表只能按 App 各量一次，不能互抄：

| App | 工具条顺序 | 偏移 |
| --- | --- | --- |
| 抖音 37.8.0 | 粘贴·常用语·自动填充 | `+139 / -139` |
| 小红书 9.22.1 | 常用语·**粘贴**·换行·自动填充 | `+253 / -169` |
| 快手 14.1.10.46550 | 粘贴·常用语·自动填充 | `+135 / -145` |

## 8. 工作流级别回测（ACCESSIBILITY 档，含上报节点与连续触发）

第 6、7 节跑的是「只采一条」的一次性工作流，没有覆盖上报节点与续跑。这一段补上：三个对象都在无障碍档下跑了多轮，小红书与快手分开跑（两个采集器不能同时跑，会互相抢前台）——小红书的连续版工作流（30–120 秒一轮）、小红书的**正式工作流**（interval 15 分钟、count=10）、快手工作流（30–120 秒一轮）。

### 小红书连续工作流（`11111111-…`，count=3、chunk_minutes=5，30–120 秒一轮）

| 片 | 采集 | 上报 |
| --- | --- | --- |
| 108 | 1 条（跳过重复 10 条，撞 5 分钟上限） | `batches=1 sent=228 failed=0 pending=0` |
| 109 | 2 条（跳过重复 9 条） | `batches=1 sent=230 failed=0 pending=0` |
| 110 | 1 条（跳过重复 6 条） | `batches=1 sent=231 failed=0 pending=0` |

- 该关键词已累计 231 条，所以每轮大量命中重复、多数轮撞 5 分钟上限才收尾；这正好覆盖了「按时间结束 + 去重跳过」这条路径
- 第一轮开头的 `先清积压` 把之前的积压（含我早前留下的测试记录）一次报走：`batches=1 sent=227 failed=0 pending=0`
- 每轮耗时约 7 分钟（5 分钟采集上限 + 30–120 秒间隔）

### 小红书正式工作流（`021fc29b`，interval 15 分钟、count=10、chunk_minutes=18）

这是用户实际会跑的那一个（触发方式是 `interval`，与上面连续版走的是调度器不同分支）：

| 片 | 采集 | 上报 |
| --- | --- | --- |
| 111 | 新增 0 条：去重跳过 10（**10 次取链都成功**，只是短链都已在库），`stopReason=duplicates` | `batches=0 sent=231 failed=0 pending=0` |
| 112 | **10/10 条**（满额）：去重跳过 22、广告 1、版式不符 1，`stopReason=count` | `batches=1 sent=241 failed=0 pending=0` |

- 去重是在**取链之后**按短链短码判的（`itemIdOf(outcome.url)`），所以「跳过 10 条重复」等于无障碍档下**成功取链 10 次**，每次都要走长按 + 点粘贴
- 第 112 片把多条循环完整串了一遍：32 张卡片进详情取链、逐条回搜索列表、翻页滚动、广告与版式不符各自跳过，在 18 分钟上限内跑满 10 条（约 15 分钟）
- `interval` 触发按预期重复：第 112 片在上轮结束（09:22:43）后 15 分钟（09:37:44）落下，与 `interval_ms=900000` 一致
- 两轮都没有任何 shell/键码报错

摘录见 [evidence_xhs_real_workflow_ax_tier.log](evidence_xhs_real_workflow_ax_tier.log)。

### 快手工作流（`7cea1682-…`，count=3、chunk_minutes=5，30–120 秒一轮）

| 片 | 采集 | 上报 |
| --- | --- | --- |
| 110 | 3 条（广告跳过 1） | `batches=1 sent=210 failed=31 pending=0` |
| 111 | 3 条（广告跳过 2） | `batches=1 sent=213 failed=31 pending=0` |
| 112 | 3 条（广告跳过 2） | `batches=1 sent=216 failed=31 pending=0` |
| 113 | 3 条（广告跳过 2） | `batches=1 sent=219 failed=31 pending=0` |

- `failed=31` 是快手包的历史遗留失败记录（契约规定 failed 不自动重发），四轮里数字没有变化，本次回测没有新增失败
- `collectedTotal` 241 → 250，每轮耗时约 3.7 分钟，续跑间隔实测 30–120 秒内
- 全程 **没有任何 `execute_shell` / `input keyevent` / `wm size` 相关报错**（三份原始 logcat 都按这些关键字扫过）

### 回测期间顺带遇到的两件事（都不是本次改动引入的）

- **快手 09:54:10 有一轮采集失败**：`顶层标签行只有 0 个可点击节点，取不到第 3 个「视频」。现场：包名=com.smile.gifmaker Activity=com.yxcorp.plugin.search.SearchActivity 节点数=47 文本=[家装 | 搜索]`。这是搜索结果页还没加载出标签行时，driver 按自己的契约**如实报错**（不猜、不兜底）；失败点在「视频」标签定位，与本次改动的四处（返回键 / 粘贴 / 清空 / 屏幕高度）无关。下一轮（第 172 片）3/3 条成功、`pending=0`，工作流自愈。
- **宿主侧 `Failed to write to file: Context not initialized`（进程未被完整初始化时所有节点都会失败）**：今早 09:14–09:16 出现过三轮，昨日 16:16 也有 `Failed to create directory: Context not initialized`（都在本次改动之前）。重启应用后恢复。这是宿主的已知状态问题，不属于本计划范围。

时间线摘录：[evidence_workflow_regression_ax_tier.log](evidence_workflow_regression_ax_tier.log)（小红书连续版 + 快手）、[evidence_xhs_real_workflow_ax_tier.log](evidence_xhs_real_workflow_ax_tier.log)（小红书正式版）。回测结束后设备恢复原状：快手工作流重新启用并排上，小红书的两个工作流保持停用，权限档改回 DEBUGGER。

## 9. 结论

- 采集链路**可以**不依赖 Shizuku，只靠无障碍服务：`device_info` + `press_key` + `set_input_text` + 「长按 + 点工具条粘贴」，三个包（抖音 / 小红书 / 快手）的 0.2.0 都在真机上通过了 ACCESSIBILITY 档回归；工作流级别也跑通了：小红书连续版 3 轮、小红书**正式版**（interval/count=10）2 轮（其中一轮满额 10 条）、快手 4 轮，采集与上报都 `pending=0`
- 需要额外维护的是工具条那一击的坐标（方案 A）：三个偏移量分别是各 App 在自己版本 + 1080x2400 上的实测值，换版本或换分辨率要重测，量法见 [probe_ax_only.js](probe_ax_only.js) 的 `pasteByToolbarProbe` 与 `shots/` 里的三张截图；换成 provider 的 `ACTION_PASTE` 可以彻底去掉这份坐标表（方案 B，规格见 [02](02_provider_action_paste.md)）
- 工具条的按钮集合取决于输入框里有没有文本，所以三个 driver 在长按前都会先置空输入框把前提坐实；这一步不是换路，是把单一路径的前置条件补齐
- 本次未覆盖：抖音的图像作品（图文）与分享面板含联系人行时的工具条位置、小红书视频笔记形态、长时间连续跑（小时级）的稳定性；抖音的工作流还没做工作流级回测（只做了采集节点级）
