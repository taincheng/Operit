# 上报配置键名中立化与迁移

## 旧状态

上报地址与令牌存在宿主的环境变量里（`EnvPreferences`，App 私有存储），不落文件。抖音包现在用的键名带来源前缀：

| 键 | 谁读谁写 |
| --- | --- |
| `DOUYIN_COLLECTOR_BASE_URL` | 设置页 `src/ui/config/index.ui.ts` 读写；子包脚本 `src/packages/douyin_collector.ts` 的 `ENV_BASE_URL` 读 |
| `DOUYIN_COLLECTOR_TOKEN` | 同上，`ENV_TOKEN` |

键名文档在 `my-packages/README.md` 的「配置上报地址与令牌」一节。

小红书包要接进来时，这套键名的问题就露出来了：服务端只有一个，配置就该只有一份，而这两个键名把「抖音」写死在了共享配置上。

`EnvPreferences` 是全局键值、不按包隔离，所以两个包读同一组键在机制上是成立的，缺的只是键名与迁移。

## 意图

键名中立化为 `COLLECTOR_BASE_URL` 与 `COLLECTOR_TOKEN`，两个包读写同一组键。抖音包里已经填好的值通过一次性迁移搬过去，用户不需要重新填。

之所以迁移而不是直接改名：这两个键承载的是用户手填的地址与令牌，直接改名等于把已配置的值丢掉，属于破坏用户空间。迁移完成后旧键被删除，状态收敛，这套迁移代码在下一个发布周期可以整段删掉。

## 迁移的语义

逐键处理，只有一条规则：

- 新键为空、旧键有值 → 把旧键的值写进新键
- 旧键有值 → 处理完清掉它
- 新键已经有值 → 新键是唯一权威，不再从旧键取值，旧键照样清掉

最后一个分支是关键：迁移跑第二遍时旧键已经不在了，是空操作；如果新键和旧键同时有值（用户在新版里改过配置），以新键为准，不会被旧值覆盖回去。

## 可用的接口

宿主两边能力不一样，迁移必须按实际接口写，否则落不了地：

| 位置 | 读 | 写 | 清空 |
| --- | --- | --- | --- |
| 子包脚本（QuickJS） | 全局 `getEnv(key)` | `Tools.SoftwareSettings.writeEnvironmentVariable(key, value)` | 同一个调用传空值 |
| UI 模块（compose_dsl） | `ctx.getEnv(key)` | `ctx.setEnv(key, value)` | 没有清空接口 |

清空这条已经确认过实现：`write_environment_variable` 在 value 为空时走的是 `EnvPreferences.removeEnv`，见 `app/src/main/java/com/ai/assistance/operit/core/tools/defaultTool/standard/StandardSoftwareSettingsModifyTools.kt`，类型声明见 `examples/types/software_settings.d.ts`（「empty value clears the variable」）。

所以迁移本体放在子包脚本里，UI 侧靠 `ctx.callTool(...)` 调子包工具触发同一次迁移。这也正好满足「迁移逻辑只写一份」。

## 放哪里

迁移本体只写一份，放在子包脚本里，对外暴露成一个工具：

```ts
// 一次性迁移：把带来源前缀的旧键搬到中立键上，然后清掉旧键。
//
// 为什么放进读配置的路径：无人值守的定时任务不经过设置页，
// 升级后如果没人打开过设置页，旧键还在而新键为空，上报就会报「未配置」。
// 迁移跑完旧键即被清掉，之后每次读配置都是空操作。
// 下一个发布周期连同这个工具与设置页里的那次调用一起删。
async function migrateLegacyUploadConfig(): Promise<void> {
    for (const [legacy, current] of [
        [LEGACY_ENV_BASE_URL, ENV_BASE_URL],
        [LEGACY_ENV_TOKEN, ENV_TOKEN],
    ] as const) {
        const legacyValue = (getEnv(legacy) ?? "").trim();
        if (legacyValue.length === 0) {
            continue;
        }
        if ((getEnv(current) ?? "").trim().length === 0) {
            await Tools.SoftwareSettings.writeEnvironmentVariable(current, legacyValue);
        }
        // 空值即清空，宿主在 value 为空时走 removeEnv
        await Tools.SoftwareSettings.writeEnvironmentVariable(legacy, "");
    }
}
```

调用点两个，每个包各自一份：

1. 子包脚本 `readUploadConfig()` 的开头。这是读上报配置的唯一入口，任何上报路径都会先完成迁移
2. 设置页加载时。脚本与 UI 模块是两个运行上下文（QuickJS 与 compose_dsl），不共享代码，所以设置页通过调用子包工具 `douyin_collector:douyin_migrate_upload_config` 触发同一次迁移，页面上就能直接看到搬过来的值

设置页调工具这条路径是现成的：抖音设置页已经在用 `douyin_collector:douyin_upload_config_check` 与 `read_clipboard`。

## 改动清单

抖音包：

- `src/packages/douyin_collector.ts`：`ENV_BASE_URL` / `ENV_TOKEN` 换成中立键；加 `LEGACY_ENV_*` 常量、`migrateLegacyUploadConfig()` 与工具 `douyin_migrate_upload_config`；`readUploadConfig()` 开头调用迁移
- `src/ui/config/index.ui.ts`：两个键常量换成中立键；页面加载时调一次迁移工具
- `dist/`：重新编译

小红书包：从一开始就只有中立键，同时带上同一份迁移（用户可能先打开小红书设置页）。

仓库文档：

- `my-packages/README.md` 的「配置上报地址与令牌」一节改键名，并说明迁移会自动完成、不需要重填

## 不做的事

- 不做「新键读不到就退回读旧键」的读取路径。迁移只改变存储位置，配置读取永远只看中立键
- 不保留旧键作为兼容读取来源。迁移完成后旧键必须消失，否则两套键会长期并存

## 验证

真机 24094RAD4C / Operit debug 1.12.2，2026-10-12 实测：

1. 迁移前状态：`shared_prefs/env_preferences.xml` 里只有 `DOUYIN_COLLECTOR_BASE_URL` 与 `DOUYIN_COLLECTOR_TOKEN`
2. 部署迁移后的包并重启应用，只进「工具箱 → 抖音采集设置」：**首访**就显示原值，`当前生效` 一行也是原值；`env_preferences.xml` 里旧键消失、中立键有值。迁移之后重进页面结果一致（幂等）
3. 不打开任何设置页，走「包管理 → 抖音采集 → 子包 → `douyin_migrate_upload_config` → 执行」：返回 `{"success":true,"baseUrlConfigured":true,"tokenConfigured":true}`，`env_preferences.xml` 同样完成迁移。这条路径与无人值守的上报走同一套脚本运行时，所以「不打开设置页也能迁移」成立
4. 未单独跑 `douyin_outbox_flush`：`readUploadConfig()` 是上报路径读配置的唯一入口，迁移就在它的第一行，且第 3 条已经证明脚本运行时里迁移与读取都生效

核对 `EnvPreferences` 的办法：`adb shell run-as com.ai.assistance.operit.debug cat shared_prefs/env_preferences.xml`。

## 实测踩到的坑：onLoad 必须把 promise 返回给宿主

第一版把 onLoad 写成了 `onLoad: () => { void migrateOnLoad(); }`，结果迁移确实执行了（日志里 `before="" after="http://47.121.25.197:8000"`），但页面首访仍然显示空值与「未配置」。

原因在 `JsComposeDslRuntimeScript.kt`：宿主拿 `invokeAction` 的返回值判断动作是不是异步的。返回 promise 才会订阅状态变化监听并安排中间渲染；返回 undefined 就被当同步动作，动作一结束 `__operit_finalize_action()` 立刻注销监听，`await` 之后的 `setBaseUrl` 没有监听者，永远不触发重渲染。

所以 UI 模块里凡是「await 之后再改状态」的处理函数，都必须把 promise 返回出去：

```ts
onLoad: () => migrateOnLoad(),        // 对
onLoad: () => { void migrateOnLoad(); }  // 错：await 之后的 setState 被丢掉
```

[DONE]
