'use strict';

/**
 * 一次性运维脚本：把抖音采集工作流停掉。
 *
 * 为什么不让 adb 点界面：这台设备上无人值守的工作流会不断把抖音拉到前台，
 * 界面点按的坐标随时会被抢走（2026-10-19 实测连续多次点到了抖音里）。
 * 宿主的 disable_workflow 工具直接改状态，不依赖前台是谁。
 */

async function listWorkflows() {
    const result = await toolCall("get_all_workflows", {});
    return { step: "list", raw: JSON.stringify(result).slice(0, 4000) };
}

async function disableDouyinWorkflow() {
    const listed = await toolCall("get_all_workflows", {});
    const text = JSON.stringify(listed);

    // 工作流对象里同时有 id 与 name；按名字里的「抖音」挑出来
    const workflows = listed?.result?.workflows ?? listed?.workflows ?? null;
    if (!Array.isArray(workflows)) {
        return { success: false, step: "parse", error: "拿不到 workflows 数组", raw: text.slice(0, 4000) };
    }

    const targets = workflows.filter((w) => String(w.name ?? "").includes("抖音"));
    if (targets.length === 0) {
        return { success: false, step: "match", error: "没有名字含「抖音」的工作流", names: workflows.map((w) => w.name) };
    }

    const before = targets.map((w) => ({ id: w.id, name: w.name, enabled: w.enabled }));
    const results = [];
    for (const target of targets) {
        const disabled = await toolCall("disable_workflow", { workflow_id: target.id });
        results.push({ id: target.id, name: target.name, disabled: JSON.stringify(disabled).slice(0, 500) });
    }

    const after = await toolCall("get_all_workflows", {});
    const afterList = after?.result?.workflows ?? after?.workflows ?? [];
    return {
        success: true,
        before,
        results,
        after: afterList
            .filter((w) => String(w.name ?? "").includes("抖音"))
            .map((w) => ({ id: w.id, name: w.name, enabled: w.enabled })),
    };
}

/** 反向操作：把抖音工作流打开（连续触发的开关）。同样不依赖前台是谁。 */
async function enableDouyinWorkflow() {
    const listed = await toolCall("get_all_workflows", {});
    const workflows = listed?.result?.workflows ?? listed?.workflows ?? null;
    if (!Array.isArray(workflows)) {
        return { success: false, step: "parse", error: "拿不到 workflows 数组" };
    }
    const targets = workflows.filter((w) => String(w.name ?? "").includes("抖音"));
    const results = [];
    for (const target of targets) {
        const enabled = await toolCall("enable_workflow", { workflow_id: target.id });
        results.push({ id: target.id, name: target.name, raw: JSON.stringify(enabled).slice(0, 200) });
    }
    const after = await toolCall("get_all_workflows", {});
    const afterList = after?.result?.workflows ?? after?.workflows ?? [];
    return {
        success: true,
        results,
        after: afterList
            .filter((w) => String(w.name ?? "").includes("抖音"))
            .map((w) => ({ id: w.id, name: w.name, enabled: w.enabled })),
    };
}

exports.listWorkflows = listWorkflows;
exports.disableDouyinWorkflow = disableDouyinWorkflow;
exports.enableDouyinWorkflow = enableDouyinWorkflow;
