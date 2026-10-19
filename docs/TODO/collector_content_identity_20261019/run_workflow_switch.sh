#!/bin/bash
# 在真机上开关某个采集工作流：bash run_workflow_switch.sh <名字关键字> <enable|disable>
#
# 与 run_probe.sh 同样的道理：debug APK 的 applicationId 是 com.ai.assistance.operit.debug，
# 而 receiver 类名的包前缀是 com.ai.assistance.operit，所以必须用全限定类名广播。
# 脚本以 temp_file 方式推送，每次运行前重新 push（跑完就被删掉）。
set -euo pipefail

NAME_CONTAINS="${1:?用法: bash run_workflow_switch.sh <名字关键字> <enable|disable>}"
ACTION="${2:?用法: bash run_workflow_switch.sh <名字关键字> <enable|disable>}"
case "$ACTION" in
    enable) ENABLE_JSON=true ;;
    disable) ENABLE_JSON=false ;;
    *) echo "第二个参数只能是 enable 或 disable" >&2; exit 2 ;;
esac

PKG=com.ai.assistance.operit.debug
CLS=com.ai.assistance.operit
DIR="/sdcard/Android/data/$PKG/js_temp"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WAIT_SECONDS="${WAIT_SECONDS:-60}"

adb push "$SCRIPT_DIR/workflow_switch.js" "$DIR/workflow_switch.js" >/dev/null
# 参数文件写到 /tmp，别在计划目录里留临时文件
PARAMS_FILE="$(mktemp -t params_switch)"
python3 -c "import json,sys; json.dump({'nameContains': sys.argv[1], 'enable': json.loads(sys.argv[2])}, open(sys.argv[3],'w'))" \
    "$NAME_CONTAINS" "$ENABLE_JSON" "$PARAMS_FILE"
adb push "$PARAMS_FILE" "$DIR/params_switch.json" >/dev/null
rm -f "$PARAMS_FILE"

RESULT_FILE="$DIR/result_switch_$(date +%s).json"
adb shell rm -f "$RESULT_FILE"
adb shell "am broadcast -a $CLS.EXECUTE_JS -n $PKG/$CLS.core.tools.javascript.ScriptExecutionReceiver \
--include-stopped-packages \
--es file_path '$DIR/workflow_switch.js' \
--es function_name 'switchWorkflow' \
--es params_file_path '$DIR/params_switch.json' \
--es result_file_path '$RESULT_FILE' \
--ez temp_file true --ez temp_params_file true" >/dev/null

for _ in $(seq 1 "$WAIT_SECONDS"); do
    if adb shell "[ -f $RESULT_FILE ] && echo READY" 2>/dev/null | grep -q READY; then
        adb shell cat "$RESULT_FILE"
        exit 0
    fi
    sleep 1
done

echo "超时：$WAIT_SECONDS 秒内没有等到结果文件 $RESULT_FILE" >&2
exit 1
