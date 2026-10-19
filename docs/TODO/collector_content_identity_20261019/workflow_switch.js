'use strict';

/**
 * 一次性运维脚本：按名字开关某个采集工作流。
 *
 * 为什么不让 adb 点界面：这台设备上无人值守的工作流会不断把目标 App 拉到前台，
 * 界面点按的坐标随时会被抢走（2026-10-19 实测连续多次点到了 App 里）。
 * 宿主的 enable_workflow / disable_workflow 工具直接改状态，不依赖前台是谁。
 *
 * 用法（见同级 run_workflow_switch.sh）：switchWorkflow({"nameContains":"快手","enable":true})
 */

async function toolCall(name, args) {
    return await Tools.Tools.callTool(name, args);
}

function readWorkflows(listed) {
    const workflows = listed?.result?.workflows ?? listed?.workflows ?? null;
    if (!Array.isArray(workflows)) {
        throw new Error(`拿不到 workflows 数组：${JSON.stringify(listed).slice(0, 400)}`);
    }
    return workflows;
}

async function switchWorkflow(params) {
    const nameContains = String(params?.nameContains ?? "");
    if (nameContains === "") {
        throw new Error("必须给 nameContains（工作流名字里的关键字）");
    }
    const enable = params?.enable === true;

    const workflows = readWorkflows(await toolCall("get_all_workflows", {}));
    const targets = workflows.filter((w) => String(w.name ?? "").includes(nameContains));
    if (targets.length === 0) {
        throw new Error(
            `没有名字含「${nameContains}」的工作流，现有：${workflows.map((w) => w.name).join(" / ")}`
        );
    }

    const before = targets.map((w) => ({ id: w.id, name: w.name, enabled: w.enabled }));
    const results = [];
    for (const target of targets) {
        const outcome = await toolCall(enable ? "enable_workflow" : "disable_workflow", {
            workflow_id: target.id,
        });
        results.push({ id: target.id, name: target.name, raw: JSON.stringify(outcome).slice(0, 300) });
    }

    const after = readWorkflows(await toolCall("get_all_workflows", {}))
        .filter((w) => String(w.name ?? "").includes(nameContains))
        .map((w) => ({ id: w.id, name: w.name, enabled: w.enabled }));

    console.log(`工作流「${nameContains}」${enable ? "启用" : "停用"}结果：${JSON.stringify(after)}`);
    return { success: true, nameContains, enable, before, results, after };
}

exports.switchWorkflow = switchWorkflow;
