#!/usr/bin/env bash
# 本机 macOS 自带 bash 3.2，没有 mapfile，tools/adb/execute_js.sh 在这里会直接报
# 「No authorized devices found」。这个脚本做同一件事，只是设备枚举不用 mapfile。
# 用法：run_js.sh <js文件> [函数名] [参数JSON或@文件] [结果等待秒数]
set -euo pipefail

FILE_PATH="$1"
FUNCTION_NAME="${2:-main}"
PARAMS_ARG="${3:-{}}"
WAIT_SECONDS="${4:-30}"

if [ ! -f "$FILE_PATH" ]; then
    echo "Error: File does not exist - $FILE_PATH" >&2
    exit 1
fi

APP_PACKAGE="com.ai.assistance.operit.debug"
SERIAL="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
if [ -z "$SERIAL" ]; then
    echo "Error: No authorized devices found" >&2
    exit 1
fi

TARGET_DIR="/sdcard/Android/data/$APP_PACKAGE/js_temp"
STAMP="$(date +%s)"
TARGET_FILE="$TARGET_DIR/$(basename "$FILE_PATH")"
TARGET_RESULT_FILE="$TARGET_DIR/probe_${STAMP}.json"

adb -s "$SERIAL" shell mkdir -p "$TARGET_DIR"
adb -s "$SERIAL" push "$FILE_PATH" "$TARGET_FILE" >/dev/null

if [[ "$PARAMS_ARG" == @* ]]; then
    PARAMS_FILE="${PARAMS_ARG#@}"
    TARGET_PARAMS_FILE="$TARGET_DIR/params_${STAMP}.json"
    adb -s "$SERIAL" push "$PARAMS_FILE" "$TARGET_PARAMS_FILE" >/dev/null
    PARAMS_EXTRA="--es params_file_path '$TARGET_PARAMS_FILE'"
else
    PARAMS_EXTRA="--es params '$PARAMS_ARG'"
fi

adb -s "$SERIAL" shell rm -f "$TARGET_RESULT_FILE"
adb -s "$SERIAL" shell "am broadcast -a com.ai.assistance.operit.EXECUTE_JS -n $APP_PACKAGE/com.ai.assistance.operit.core.tools.javascript.ScriptExecutionReceiver --include-stopped-packages --es file_path '$TARGET_FILE' --es function_name '$FUNCTION_NAME' $PARAMS_EXTRA --es result_file_path '$TARGET_RESULT_FILE' --ez temp_file true --ez temp_params_file true" >/dev/null

START="$(date +%s)"
while true; do
    if adb -s "$SERIAL" shell "if [ -f '$TARGET_RESULT_FILE' ]; then echo __READY__; fi" | grep -q "__READY__"; then
        break
    fi
    NOW="$(date +%s)"
    if [ $((NOW - START)) -ge "$WAIT_SECONDS" ]; then
        echo "Error: Timed out waiting for result file: $TARGET_RESULT_FILE" >&2
        exit 1
    fi
    sleep 1
done

adb -s "$SERIAL" shell "cat '$TARGET_RESULT_FILE'"
adb -s "$SERIAL" shell rm -f "$TARGET_RESULT_FILE"
