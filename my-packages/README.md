# 自己的业务包放这里

这个目录放本项目使用者自己的业务代码，不属于上游仓库的功能。它不参与 APK 打包，所以改这里不需要重新编译 Android 工程，也不影响与上游同步代码。

## 和 examples/ 的区别

`examples/` 是上游的工具包与示例集合，同时被 `tools/example_packages/sync_example_packages.py` 当作 APK 内置包的来源。一旦某个包进了那个白名单，它就会随 APK 出厂，每次改动都要重建 APK。

本目录不登记白名单，因此只作为源码存放与版本管理的位置。

## 目录结构

```text
my-packages/
└── douyin-collector/
	├── manifest.json   包清单，声明包 ID、入口与子包
	├── tsconfig.json   编译配置，输出到 dist/
	├── src/            TypeScript 源码
	│   ├── main.ts     包入口，导出 registerToolPkg
	│   └── packages/   子包，每个文件用 METADATA 块声明工具
	└── dist/           编译产物，manifest 里的入口指向这里
```

## 包内工具

`douyin-collector` 对外提供 4 个工具。

| 工具 | 作用 |
| --- | --- |
| `douyin_collect_share_link` | 取出当前打开的视频的分享链接，需要在视频详情页调用，不会自己导航 |
| `douyin_collect_share_links` | 采集搜索结果：切到「视频」标签，逐条取链并追加到 records.jsonl。一次运行只做一片 |
| `douyin_outbox_flush` | 把 pending 记录按每批 20 条上报到服务端，failed 不自动重发 |
| `douyin_outbox_status` | 查看 pending、sent、failed 各多少条 |
| `douyin_upload_config_check` | 自检上报地址与令牌是否可用，不会写入任何数据 |

记录、状态与进度存在插件的配置目录里，路径是 `/sdcard/Download/Operit/plugins/com.taincheng.douyin_collector_bundle/`。`records.jsonl` 是采集结果，每行一条；`outbox.json` 是每条的上报状态与尝试次数；`progress.json` 是分片进度。

## 分片与续跑

脚本硬超时 30 分钟且被杀时没有保存机会，所以一次运行只做一片：`count` 是本片条数目标，`chunk_minutes` 是本片时间上限，默认 18 分钟、最多 20 分钟，两者先到者结束本片。结束时会写 `progress.json`。

`progress.json` 记录的是进度与轮次，不是列表位置。搜索结果首屏会浮动，按位置续跑不可靠；续跑靠的是 records.jsonl 里的视频标识去重，已经在库里的视频直接跳过。所以下一片照常从头进列表，不会被重复采集，也不会从头重来一遍已完成的量。

运行期间要保持应用在前台、屏幕常亮。仓库没有锁屏与息屏下的注入处理，息屏后能否继续操作没有代码保障，不要假设可以息屏无人值守。

包的 `manifest.json` 里带了一个工作流模板「定时采集抖音并上报」，导入后每 15 分钟采一片并上报。导入入口是工作流的「从模板新建」。

自检提示：包详情页的对话框会把所有声明过的参数一起提交，空着的数值参数会变成空字符串并被宿主严格转换拒绝。手工在对话框里跑 `douyin_collect_share_links` 时，`count` 与 `chunk_minutes` 都要填值。

## 配置上报地址与令牌

配置在 App 里改，不碰文件：

```
工具箱 → 抖音采集设置
```

页面里可以直接填地址与令牌，也可以把一段配置文本粘进「粘贴配置文本」框再点「解析并填入」，还可以点「从剪贴板导入」直接从剪贴板取。保存后页面会自动跑一次自检。

两个值存在宿主的环境变量里（`EnvPreferences`，App 私有存储），键名是 `DOUYIN_COLLECTOR_BASE_URL` 与 `DOUYIN_COLLECTOR_TOKEN`。这段存储是全局键值、不按包隔离，所以键名带包前缀，改键名时子包脚本与设置页必须一起改。

自检工具 `douyin_upload_config_check` 会故意发一个空批次：服务端按参数校验拒收它，不会写入数据；而鉴权在参数校验之前，所以「参数校验类的 400」恰好证明配置可用。

上报契约与逐条验证记录见 `../docs/TODO/device_automation_platform_20261008/server_api.md`。

## 编译

```bash
npx tsc -p my-packages/douyin-collector/tsconfig.json
```

改动 `src/` 之后必须重新编译，否则手机上加载的还是旧的 `dist/`。

## 装到手机

推荐用应用内的开发流程，改完即重载，不用重建 APK。

1. 在 Operit 里装并运行 `SandboxPackage_DEV` 技能，入口是 `/sdcard/Download/Operit/skills/SandboxPackage_DEV/scripts/install_or_update.js`
2. 开发目录是 `/sdcard/Download/Operit/dev_package/{packageId}/`
3. 宿主类型放在同级的 `/sdcard/Download/Operit/dev_package/types/`，不要放进包目录内部
4. 包内的 `tsconfig.json` 让 `typeRoots` 与 `include` 指向 `../types`

本目录里的 `tsconfig.json` 指向仓库中的 `examples/types`，是为在电脑上编译准备的，两边不要互相覆盖。

用 `.toolpkg` 文件装的话，装完还要去包管理里把包打开：外部包不会自动启用，清单里的 `enabled_by_default` 只对内置包生效。没打开的包，它的工具在包详情里能手动跑，但工作流的模板选择器不会列出它。

## 导入工作流模板

入口是「工作流」页右下角按钮展开后的「从模板新建」。模板列表里内置模板占了前九条，插件模板在**最下面**，要滚到底才看得到，分区标题是「插件模板」。点一下就会生成一条可编辑的正式工作流，之后与包无关。

模板里有定时触发与手动触发两个节点：定时触发用于无人值守，手动触发用于随时试跑，在编辑器右下的操作菜单里点「触发工作流」即可。只能定时触发的话，手动触发会直接空跑，日志里记 `没有手动触发类型的触发节点`。

导入后宿主会立刻按定时配置点火一次，不是等满一个周期。

## 注意

不要在 `my-packages/` 下新建 Gradle 模块。这个仓库的 Gradle 模块都是原生或宿主组件，业务代码是跑在 QuickJS 上的脚本包，不属于那一层。
