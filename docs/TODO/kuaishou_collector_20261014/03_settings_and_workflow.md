---
For_Agent: 设置页与工作流模板都是从抖音、小红书包里同构搬过来的，改键名时三个包要一起改
---

# 03 设置页、工作流模板与装载

## 旧实现情况

- 抖音设置页：`my-packages/douyin-collector/src/ui/config/index.ui.ts`，含 `onLoad` 迁移与自检
- 小红书设置页：`my-packages/xhs-collector/src/ui/config/index.ui.ts`，与抖音同构，只换了工具名前缀与文案
- 工作流连续触发：`docs/TODO/continuous_workflow_trigger_20261012/index.md`

## 意图

快手包自带同构的一份：

**设置页**（`src/ui/config/index.ui.ts`，在 `src/main.ts` 里登记到工具箱）

- 标题「快手采集设置」，读写宿主环境变量 `COLLECTOR_BASE_URL` / `COLLECTOR_TOKEN`，与另外两包**共用同一组键**
- 与小红书包一致：`onLoad` 调 `ks_collector:ks_migrate_upload_config` 把抖音旧键搬过来，**必须把 promise 返回给宿主**（`onLoad: () => migrateOnLoad()`），否则 `await` 之后的 `setState` 不触发重渲染，首访停在迁移前的空值上
- 保存后立刻自检一次；另有「测试连接」「从剪贴板导入」「解析并填入」三个动作，与抖音页一致

**工作流模板**（`resources/workflow_collect_and_upload.json`）

- 五个节点：连续触发 + 手动触发 → 先清积压 `ks_outbox_flush` → 采一片 `ks_collect_share_links` → 再上报 `ks_outbox_flush`
- 连续触发配置 `{"schedule_type":"continuous","min_gap_ms":"30000","max_gap_ms":"120000","enabled":"true"}`
- 默认参数：`keyword=家装`、`count=3`、`chunk_minutes=5`。快手单条约 18 秒（adb 口径），`count=3` 配 5 分钟上限留了充足余量

**包清单**（`manifest.json`）

- `toolpkg_id`：`com.taincheng.kuaishou_collector_bundle`
- 子包 `ks_collector`，入口 `dist/packages/ks_collector.js`
- 一个工作流模板 `ks_scheduled_collect_and_upload`，资源键 `ks_workflow_collect_and_upload`
- 不登记 APK 白名单（与另外两包一致，走外部包装载）

## 六个工具

| 工具 | 作用 |
| --- | --- |
| `ks_collect_share_link` | 取当前打开作品的分享链接，需要在详情页调用，不会自己导航 |
| `ks_collect_share_links` | 采集搜索结果：逐张点进详情取链再返回列表，采完一屏往下滚一屏 |
| `ks_outbox_flush` | 把 pending 记录按每批 20 条上报到服务端 |
| `ks_outbox_status` | 查看 pending、sent、failed 各多少条 |
| `ks_upload_config_check` | 自检上报地址与令牌是否可用，不会写入任何数据 |
| `ks_migrate_upload_config` | 把抖音包早期版本的 `DOUYIN_` 前缀旧键搬到中立键并清空旧键，幂等 |

## 预期结果

- `npx tsc -p my-packages/kuaishou-collector/tsconfig.json` 无错误
- 包装到设备后，工具箱里出现「快手采集设置」，保存后自检给出结论
- 工作流模板能从「从模板新建 → 插件模板」导入，导入后手动触发一轮能跑通「清积压 → 采一片 → 上报」

## 验证

### 落地验证（2026-10-14，真机）

- `npx tsc -p my-packages/kuaishou-collector/tsconfig.json` 通过，无错误
- 打包与装载：`tools/toolpkg/debug_toolpkg.py` 造出的 `.toolpkg` 推到 `/sdcard/Android/data/com.ai.assistance.operit.debug/files/packages/`，重启应用后启动日志 `scan candidate finish, phase=external, type=toolpkg, file=com.taincheng.kuaishou_collector_bundle.toolpkg, errors=0`
- 外部包要在包管理里**手工启用**（行右侧那个无文案的 checkable 开关）：启用后日志 `Successfully enabled toolpkg container: com.taincheng.kuaishou_collector_bundle`，工具箱里随即出现「快手采集设置」，包详情里也能看到工作流模板「连续采集快手并上报」
- 六个工具在对话里逐个调用成功（`use_package` + `package_proxy`，每个工具首次调用要过一次权限确认）
- 采集闭环：`coffee` 与 `家装` 各一片，各 3 条，短链互不相同，详见 [index.md](index.md#落地验证2026-10-14真机)
- 上报：`ks_outbox_flush` 走通，被拒记录的 `last_error` 带出 `reason`，详见 [02](02_record_store_and_outbox.md) 的验证段

工作流模板也做了真机验证（导入、三节点顺序、连续触发、续跑、冷启动恢复），逐条结果见 [index.md](index.md#工作流真机验证2026-10-14)。导入路径是「工作流 → 右下角按钮 → 从模板新建 → 插件模板（列表最下面）→ 连续采集快手并上报」，导入后默认启用，宿主立刻点火一轮。
