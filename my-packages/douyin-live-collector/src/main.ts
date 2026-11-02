import configScreen from "./ui/config/index.ui.js";

// 包入口。宿主加载这个包时会调用 registerToolPkg。
//
// 采集与上报工具全部由子包提供；这里只登记「工具箱」里的设置页，
// 上报用的服务端地址与令牌就是在这个页面里配置的（存宿主环境变量，不落文件）。

export function registerToolPkg(): boolean {
  ToolPkg.registerToolboxUiModule({
    id: "douyin_live_collector_config",
    runtime: "compose_dsl",
    screen: configScreen,
    params: {},
    title: {
      zh: "抖音直播采集设置",
      en: "Douyin Live Collector Settings",
    },
  });

  return true;
}
