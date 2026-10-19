import configScreen from "./ui/config/index.ui.js";

// 包入口。宿主加载这个包时会调用 registerToolPkg。
//
// 采集与上报工具全部由子包提供；这里只登记「工具箱」里的设置页，
// 上报用的服务端地址与令牌就是在这个页面里配置的（存宿主环境变量，不落文件），
// 与抖音采集共用同一组中立键。

export function registerToolPkg(): boolean {
  ToolPkg.registerToolboxUiModule({
    id: "xhs_collector_config",
    runtime: "compose_dsl",
    screen: configScreen,
    params: {},
    title: {
      zh: "小红书采集设置",
      en: "Xiaohongshu Collector Settings",
    },
  });

  return true;
}
