# 稳定化内核与 driver 契约

> **归档：本步骤未按原方案实施，目标已由 02 至 07 步直接完成。保留原文作为当时的设想记录，不要照着它重做一遍。**（归档于 2026-10-09）
>
> 原计划先做一个通用的「稳定化内核 + driver 契约」两层工具包，内核单独成包，靠 manifest 的 `requires` 关联，然后再落业务 driver。实际走了另一条路：内核能力与抖音 driver 一起长在业务包 `my-packages/douyin-collector` 里。理由是当时只有一个 driver，先抽内核等于把接口钉在一个还没有第二个用例的猜测上。
>
> 逐项对应关系
>
> | 本步骤的设想 | 实际怎么做的 | 落在哪 |
> | --- | --- | --- |
> | `waitFor(predicate, timeoutMs)`、`waitGone` | 实现为 `waitForNode`，并额外加了「读页面偶发失败」的容错与退避 | `douyin_collector.ts` |
> | `waitStable(readPage, quietMs)` | 未单独实现。用固定等待（搜索页 6 秒）加条件等待组合替代，页面抖动带来的退化边界由 `isNodeVisible` 剔除 | 02 步 |
> | `scrollUntilFound(predicate, maxScrolls)` | 未实现。列表遍历改成按搜索结果页分页驱动，滚动只发生在页与页之间 | 06 步 |
> | `assertPage(expected)` | 未按这个名字实现。等价能力是 `ensureDouyinForeground` 与切「视频」标签前的前置等待 | 同上 |
> | `snapshotFailure()` | 实现为 `describeCurrentPage`，失败信息里带包名、Activity、节点数与文本样例 | 同上 |
> | driver 契约（`selfCheck` / `search` / `listResults` / `openItem` / `extractPayload` / `nextPage`） | 未抽成契约。抖音 driver 是单文件，函数按实际需要长出来 | 02 步 |
> | driver 声明所需权限档位并自检 | 未实现。改用「优先无障碍实时读取、必要时走 shell」的读取策略，并把这条写进了实测基线 | 02 步 |
> | 包拆分与 manifest `requires` 语义实测 | **未做**。非空 `requires` 至今没有用例 | —— |
>
> 什么时候这份设想重新有价值：要做第二个 driver（比如小红书）时，「把内核抽出来」才划算，那时下面这套契约列法是合适的起点。

## 仍未处理：失效的 UINode 静态等待方法

原文「顺带修正」那一条至今没做，而且问题仍在：

- `app/src/main/assets/js/UINode.js` 里 `findAndWait`、`clickAndWait`、`longPressAndWait` 三个静态方法都调用 `Tools.UI.combinedOperation`
- 该函数在宿主实现与类型里都不存在（全仓搜索零命中），一旦调用就抛错
- 但 `docs/doc-src/package-dev/ui.md` 与 `examples/types/ui.d.ts` 仍在提供这套用法
- 修法二选一：给 `Tools.UI` 补上 `combinedOperation` 让文档成真，或删掉这三个静态方法并同步改文档与类型。按项目规则应当修实现，而不是让文档继续教坏


## 旧状态

- 脚本侧唯一的等待原语是 `Tools.System.sleep`，见 `app/src/main/java/com/ai/assistance/operit/core/tools/javascript/JsTools.kt`
- `UINode.wait` 无条件也没有超时。静态方法 `findAndWait`、`clickAndWait`、`longPressAndWait` 调用 `Tools.UI.combinedOperation`，而 UI 命名空间里没有这个函数，属于死代码，调用即 TypeError，但 `docs/doc-src/package-dev/ui.md` 仍在教这套用法
- 条件等待、页面断言与弹窗检测没有实现。现有助手各自手写 swipe 加 sleep 的轮询，例如 `examples/automatic_xiaohongshu_assistant.ts`
- `examples/automatic_ui_base.ts` 只有 358 行，内容是 toolCall 转发与 `complete()` 样板，不具备稳定化能力

## 意图

新建脚本侧工具包，产出两层。

稳定化内核，放在 `kernel/`：

- `waitFor(predicate, timeoutMs)` 与 `waitGone(predicate, timeoutMs)`，超时抛错而不是返回空值
- `waitStable(readPage, quietMs)`，连续两次节点快照一致才算稳定
- `scrollUntilFound(predicate, maxScrolls)`，滚动查找，到达上限明确失败
- `assertPage(expected)`，校验当前包名与 Activity，不符即失败
- `snapshotFailure()`，失败时落盘当前 Activity、节点文本摘要与截图路径

driver 契约，新建 `driver.ts`：

- driver 声明自己需要的权限档位，运行时自检不通过就明确报错，避免在 STANDARD 档下点了没反应却一直 sleep
- 契约方法为 `selfCheck`、`search`、`listResults`、`openItem`、`extractPayload`、`nextPage`
- 关键文案集中成带版本号的文案表，版本变更时一眼可见

包拆分要先验证。计划把平台能力与业务 driver 分成两个包，靠 manifest 的 `requires` 关联，其语义在 `docs/TOOLPKG_FORMAT_GUIDE.md` 中有说明：依赖包先加载，启用业务包会带上内核包，内核包在被依赖期间不能单独关闭。仓库现有 manifest 的 `requires` 都是空数组，没有非空用例，所以这一步要先用最小样例实测。若实现与文档不符，按项目规则修宿主实现，不绕开。

## 期待结果

- 新增采集目标只需实现契约，不再重复实现等待与轮询
- 失败路径统一：抛错并带现场，不出现静默返回
- 顺带修正 `docs/doc-src/package-dev/ui.md` 里 `findAndWait` 系列的失效说明，或让实现补上该函数

## 验证

真机上对抖音搜索页验证两点。

1. `waitFor` 命中文案 `综合`，应在数秒内返回
2. 对不存在的文案，应在超时后抛错，而不是静默返回空

静态检查内核代码，确认等待只走内核，业务层不直接调用 `sleep`。

[SUPERSEDED by 02-07]
