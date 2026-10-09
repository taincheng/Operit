"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerToolPkg = registerToolPkg;
const index_ui_js_1 = __importDefault(require("./ui/config/index.ui.js"));
// 包入口。宿主加载这个包时会调用 registerToolPkg。
//
// 采集与上报工具全部由子包提供；这里只登记「工具箱」里的设置页，
// 上报用的服务端地址与令牌就是在这个页面里配置的（存宿主环境变量，不落文件）。
function registerToolPkg() {
    ToolPkg.registerToolboxUiModule({
        id: "douyin_collector_config",
        runtime: "compose_dsl",
        screen: index_ui_js_1.default,
        params: {},
        title: {
            zh: "抖音采集设置",
            en: "Douyin Collector Settings",
        },
    });
    return true;
}
