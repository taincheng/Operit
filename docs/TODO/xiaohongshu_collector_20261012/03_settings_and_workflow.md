# 设置页、环境变量与工作流模板

## 旧状态

抖音采集把这三样都做完了：

- 设置页 `my-packages/douyin-collector/src/ui/config/index.ui.ts`，在包入口 `src/main.ts` 里用 `ToolPkg.registerToolboxUiModule` 挂到工具箱
- 上报地址与令牌存在宿主环境变量里（`EnvPreferences`，App 私有存储），不落文件
- 工作流模板 `resources/workflow_collect_and_upload.json`，在 `manifest.json` 里用 `workflow_templates` 声明

小红书这一层没有新的技术问题，只有标识不同。

## 意图

照搬，只改包标识、键名、工具名与文案。

## 包结构

```text
my-packages/xhs-collector/
├── manifest.json                             toolpkg_id = com.taincheng.xhs_collector_bundle
├── tsconfig.json                             与抖音那份同构
├── resources/workflow_collect_and_upload.json
├── src/
│   ├── main.ts                               登记工具箱设置页
│   ├── packages/xhs_collector.ts             driver + 落地 + outbox
│   └── ui/config/index.ui.ts                 设置页
└── dist/                                     编译产物，manifest 入口指向这里
```

`manifest.json` 的字段与抖音一致：`subpackages[0].id = "xhs_collector"`、`entry = "dist/packages/xhs_collector.js"`、`resources` 指向工作流模板、`workflow_templates` 声明模板入口。

## 环境变量

上报配置与抖音包**共用同一组中立键**，不各存一份：

| 键 | 用途 |
| --- | --- |
| `COLLECTOR_BASE_URL` | 上报服务端地址 |
| `COLLECTOR_TOKEN` | Bearer 令牌 |

`EnvPreferences` 是全局键值、不按包隔离。抖音包原来那组带 `DOUYIN_` 前缀的键由 [04](04_shared_upload_config_migration.md) 做一次性迁移，迁移后旧键被删除，两个包都只认这组中立键。键名在设置页与子包脚本里必须一致。

因为共用一份配置，小红书设置页保存的值会同时是抖音采集用的值；这是预期的，服务端只有一个。页面文案要把这一点写出来，避免用户以为是两个独立的配置。

## 设置页

入口：`工具箱 → 小红书采集设置`。`ToolPkg.registerToolboxUiModule` 的 `id` 用 `xhs_collector_config`，`runtime` 用 `compose_dsl`，与抖音一致。

页面功能与抖音一致：

- 直接填地址与令牌，保存后自动跑一次自检
- 粘贴一段配置文本，点「解析并填入」
- 点「从剪贴板导入」直接从剪贴板取配置文本

自检调 `xhs_collector:xhs_upload_config_check`。剪贴板读取走宿主的 `read_clipboard`，这一步在 Operit 自己处于前台时可用，与采集期读剪贴板的限制（见 [01](01_xhs_driver.md)）不是同一回事。

页面加载时还要调一次 `xhs_collector:xhs_migrate_upload_config`：用户可能先打开的是这一页，而待迁移的旧键是抖音包留下的，见 [04](04_shared_upload_config_migration.md)。

页面加载用的 onLoad **必须把 promise 返回给宿主**，写成 `onLoad: () => migrateOnLoad()`。写成 `() => { void migrateOnLoad(); }` 的话，宿主按同步动作处理，动作一结束就注销状态变化监听，`await` 之后的 `setBaseUrl` 不触发重渲染，首访会停在迁移前的空值上。原因与实测见 [04](04_shared_upload_config_migration.md) 的「实测踩到的坑」。

真扫码不在页面里做：脚本与 UI 模块都没有图像解码接口，宿主的 zxing 能力没有暴露出来。扫码在 App 外完成，把文本粘进来。

## 工作流模板

与抖音同构，只换工具名与文案：

- 两个触发节点：每 15 分钟定时触发（无人值守）、手动触发（试跑）
- 三个执行节点：先 `xhs_collector:xhs_outbox_flush` 清积压 → `xhs_collector:xhs_collect_share_links` 采一片 → 再 flush 一次上报本片

顺序与理由照搬抖音：flush 放在采集之前，是因为采集耗时长、可能被下一次点火打断，而上报只要几秒；这样任何一轮被中断，积压也会在下一轮开头清掉。

导入入口是「工作流」页右下角→「从模板新建」，插件模板列表在**最下面**，分区标题是「插件模板」。导入后宿主会立刻按定时配置点火一次。

## 编译与装载

```bash
npx tsc -p my-packages/xhs-collector/tsconfig.json
```

改动 `src/` 之后必须重新编译，否则手机上加载的还是旧的 `dist/`。

设备侧走应用内的 `dev_package` 流程：开发目录 `/sdcard/Download/Operit/dev_package/{packageId}/`，宿主类型放同级 `types/`，改完在应用内重载，不需要重建 APK。也可以用 `.toolpkg` 装到 `/sdcard/Android/data/com.ai.assistance.operit.debug/files/packages/` 后重启应用（应用只扫描该目录下的文件而不是目录，所以必须打包成 `.toolpkg`）；外部包装完还要去包管理里手动打开，`enabled_by_default` 只对内置包生效。

## 验证

2026-10-12 在真机上实测：

1. 工具箱里出现「小红书采集设置」，与「抖音采集设置」并列 ✓
2. 打开小红书设置页：首访就显示与抖音同一份地址与令牌，`当前生效` 一行也正确 ✓（共用中立键 + 页面加载时迁移都生效）
3. 只打开小红书设置页也能完成旧键迁移 ✓ 见 [04](04_shared_upload_config_migration.md) 的验证
4. `xhs_collector` 子包 6 个工具在包详情里都能手动跑 ✓
5. 从「从模板新建 → 插件模板」导入「定时采集小红书并上报」：宿主导入后立刻点火一次，日志里完整看到「清积压 → 采一片 → 上报」三段，采集片以「达到条数目标」结束并写下 `progress.json` ✓
6. 模板里的静态参数按预期生效：关键词 `家装`、`count 3` ✓

未做：

- 定时触发到点后的无人值守跑没有单独等一个 15 分钟周期（导入时的那次点火已经走过同一条代码路径）
- 手动触发节点没有单独试（导入点火走的是定时节点）

装载侧实测补充：外部包必须先在包管理里启用，模板选择器才会列出它的模板——模板列表按**容器是否启用**筛选（`imported_packages`），只把子包状态打开不够。启用这一步本次是用等价的偏好写入完成的，没有走 UI 开关。

[DONE]
