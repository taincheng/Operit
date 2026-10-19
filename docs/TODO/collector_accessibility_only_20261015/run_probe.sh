#!/bin/bash
# 在真机上运行 probe_ax_only.js 的某个导出函数并打印结构化结果。
#
# 为什么不用 tools/adb/execute_js.sh：那个脚本把 receiver 写成 "$APP_PACKAGE/.core.tools...",
# debug APK 的 applicationId 是 com.ai.assistance.operit.debug，而类名的包前缀是
# com.ai.assistance.operit，am 会把 "." 展开成前者，于是广播根本到不了 receiver。
# 这里用全限定类名，并且因为探针以 temp_file 方式推送，每次运行前都重新 push。
#
# 用法：bash run_probe.sh <函数名> [参数JSON]
set -euo pipefail

FUNCTION_NAME="${1:?用法: bash run_probe.sh <函数名> [参数JSON]}"
PARAMS_JSON="${2:-{\}}"

PKG=com.ai.assistance.operit.debug
CLS=com.ai.assistance.operit
DIR="/sdcard/Android/data/$PKG/js_temp"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WAIT_SECONDS="${WAIT_SECONDS:-120}"

adb push "$SCRIPT_DIR/probe_ax_only.js" "$DIR/probe_ax_only.js" >/dev/null
python3 -c "import json,sys; json.dump(json.loads(sys.argv[1]), open(sys.argv[2],'w'))" \
    "$PARAMS_JSON" "$SCRIPT_DIR/params_probe.json"
adb push "$SCRIPT_DIR/params_probe.json" "$DIR/params_probe.json" >/dev/null

RESULT_FILE="$DIR/result_${FUNCTION_NAME}_$(date +%s).json"
adb shell rm -f "$RESULT_FILE"
adb shell "am broadcast -a $CLS.EXECUTE_JS -n $PKG/$CLS.core.tools.javascript.ScriptExecutionReceiver \
--include-stopped-packages \
--es file_path '$DIR/probe_ax_only.js' \
--es function_name '$FUNCTION_NAME' \
--es params_file_path '$DIR/params_probe.json' \
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
