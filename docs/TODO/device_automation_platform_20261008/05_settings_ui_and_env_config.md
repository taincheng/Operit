---
status: in_progress
For_Agent: 本步骤只动插件包与文档，不动宿主。动手前先读「实测基线」，那几条都是真机/真服务端验过的
---

# 设置界面与环境变量配置

## 旧实现

服务器地址与令牌存在插件配置目录的文件里：

```
/sdcard/Download/Operit/plugins/com.taincheng.douyin_collector_bundle/config.json
```

这份方案是写 02 步时自己定的，当时没有查宿主是否已有现成机制。后果有两层：

- 换环境要么走 adb，要么在手机上用文件管理器编辑外部存储，都不方便
- 配置落在外部存储，App 私有目录之外，安全性也更差

## 实测基线

以下结论来自本机排查，重写本步骤前请确认仍成立。

宿主已有一套每包可用的配置机制，插件侧完全够用：

- 读：任意脚本可调全局 `getEnv(key)`，见 `examples/types/index.d.ts:275`
- 写：UI 模块的 `ctx.getEnv` / `ctx.setEnv` / `ctx.setEnvs`，见 `examples/types/compose-dsl.d.ts:1235`
- 存储：`EnvPreferences`，App 私有 SharedPreferences，文件名 `env_preferences`，见
  `app/src/main/java/com/ai/assistance/operit/data/preferences/EnvPreferences.kt`
- 该存储是**全局键值，不按包隔离**，键名必须带包前缀避免撞车
- 写入时值为空会删除该键，见 `JsNativeInterfaceDelegates.applyEnvValue`

插件可以自带工具箱界面，且不需要改清单：

- 主脚本里 `ToolPkg.registerToolboxUiModule({id, runtime:"compose_dsl", screen, title})`，挂到「工具箱」导航入口
- 参考实现 `examples/windows_control/src/ui/windows_setup/index.ui.ts` 就是 base_url 加令牌的表单页，含粘贴解析、连接测试、保存
- 取图能力：`ctx.openFilePicker({picker:'camera'|'image'})` 可取到本地 path

二维码解码在插件侧做不到：

- 脚本与 UI 模块都没有图像解码接口，`JsTools.kt` 里逐个查过
- 宿主有 zxing 与现成解码函数 `ColorQrCodeUtil.decodeToString`，但只服务于设置页的提示词导入导出，没有暴露给脚本层
- 纯 JS 自行解码需要一个 PNG/JPEG 解码器拿像素，QuickJS 内不具备，不划算

连接测试的信号（对真实服务端实测）：

| 探针结果 | 含义 |
| --- | --- |
| 401 令牌无效 | 地址可达，令牌被拒 |
| 400 items 条数必须在 1 到 20 之间 | 地址可达，令牌有效。服务端鉴权先于参数校验，所以空批次被拒恰恰证明令牌通过 |
| 404 或其它 4xx | 地址可达，但接口路径不对 |
| 5xx | 服务端自身错误 |
| 网络异常 | 连不上 |

空批次本身是合法探针：服务端拒收空 items，不会写入任何数据。

## 意图

把配置从「手机上的文件」搬到「App 内的设置页」：

- 配置改用 `EnvPreferences` 存放，键名带 `DOUYIN_COLLECTOR_` 前缀
- 新增工具箱设置页：填地址与令牌、保存、测试连接、从剪贴板导入一段配置
- 彻底删除 `config.json` 方案。本方案未发布，按仓库规矩不留双轨
- 不改宿主。真扫码（拍照识别二维码）需要宿主暴露解码接口，本步骤不做，扫码在 App 外完成后粘贴

## 预期结果

- 换环境：打开 工具箱 里的抖音采集设置，粘一段配置或改两个输入框，点保存即可，不碰 adb 与文件管理器
- 配置存在 App 私有目录，不再是外部存储
- 上报工具从环境变量读配置，读不到时给出指向设置页的明确报错

## 作用域

- `my-packages/douyin-collector/src/main.ts`：注册工具箱界面
- `my-packages/douyin-collector/src/ui/config/index.ui.ts`：新增设置页
- `my-packages/douyin-collector/src/packages/douyin_collector.ts`：配置改读环境变量，新增连接自检工具，更新工具描述
- 文档：包 README、上报契约里的配置存放说明、本计划索引
- 不动宿主任何文件，不需要重打 APK

## 验证清单

1. 设置页能在工具箱里打开，保存后 `env_preferences` 里出现两个带前缀的键
2. 上报工具能读到新配置并成功上报
3. 换一组配置（改地址或令牌）后，下一次上报走新配置
4. 配置为空时上报工具报错信息指向设置页，不出现空地址请求
5. 连接自检对四种信号分别给出正确判定

## 验证结果

| 验证项 | 实测 |
| --- | --- |
| 设置页注册 | 工具箱里出现「抖音采集设置」，页面元素与文案正常渲染 |
| 保存写入环境变量 | 点保存后 `shared_prefs/env_preferences.xml` 出现 `DOUYIN_COLLECTOR_BASE_URL` 与 `DOUYIN_COLLECTOR_TOKEN`，值正确 |
| 重启后仍生效 | 应用重启后页面从环境变量读回地址与令牌，令牌按脱敏形式回显 |
| 自检工具可被 UI 调用 | 页面点「测试连接」后工具执行，日志 `配置自检：HTTP 400，判定 ok，服务端消息 items 条数必须在 1 到 20 之间` |
| 删除旧配置后仍可用 | 设备上的 `config.json` 删除后配置读取不受影响，键值来自环境变量 |

未实测：

- 结果卡片在 parse 修复后的最终文案（界面渲染本身已由使用者确认无问题）。修复前实测过一次渲染路径（卡片确实会出现在列表末尾，需要滚动才可见；当时文案是 `地址可达，但响应不符合上报契约。（HTTP undefined）`，正是把 JSON 字符串当对象读导致的）。修复按实测契约改成先解析 JSON 字符串，尚未再跑一次界面确认
- 配置为空时的报错文案。需要清空环境变量才能构造
- 「从剪贴板导入」与「解析并填入」两个入口。前者依赖 `read_clipboard`，该能力已在宿主侧具备；两者共用同一段解析逻辑
- 换一组地址后下一次上报走新配置。地址变更需要另一台可达服务端才能观察到

## 实测契约补充

`ctx.callTool` 对**对象型**工具结果返回的是 JSON 字符串，不是已解析的对象。设置页第一版按对象读字段，导致 `verdict` 与 `httpStatus` 都是 undefined。脚本层同样适用这条，调用返回对象的工具时要先解析。

[DONE]
