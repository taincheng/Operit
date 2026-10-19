#!/usr/bin/env python3
"""从 logcat 抓取结果里核对 continuous 调度的实际间隔。

判定口径：
- armed 时间点与 delay 来自 `Armed continuous round: ... slot=X delay=Yms`
- 一轮的起点是 `WorkflowWorker(...): Executing scheduled workflow:`，终点是同一轮的
  `Workflow execution succeeded/failed`（这行不带工作流 id，归到最近一次开始的那一轮）
- 实际间隔 = 下一轮起点 − 上一轮终点，与该轮结束时 armed 的 delay 对比

用法：
    python3 analyze_continuous_log.py <logcat 文本> [workflow id]
第二个参数可选，用来只看某一条工作流（同一段日志里可能混着别的采集工作流）。
"""

from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path

ARMED_RE = re.compile(
    r"^(?P<ts>\d\d-\d\d \d\d:\d\d:\d\d\.\d\d\d) .*Armed continuous round: "
    r"workflow=(?P<wf>\S+) trigger=\S+ slot=(?P<slot>\d+) delay=(?P<delay>\d+)ms"
)
START_RE = re.compile(
    r"^(?P<ts>\d\d-\d\d \d\d:\d\d:\d\d\.\d\d\d) .*WorkflowWorker.*Executing scheduled workflow: (?P<wf>[^,]+),"
)
END_RE = re.compile(
    r"^(?P<ts>\d\d-\d\d \d\d:\d\d:\d\d\.\d\d\d) .*WorkflowWorker.*Workflow execution (?:succeeded|failed)"
)
NOTE_RE = re.compile(r"already armed|chain stops|not scheduling|Execution cancelled|执行已取消", re.IGNORECASE)


def parse_ts(value: str) -> datetime:
    # 同一天的抓取窗口内比较足够用，这里补一个固定年份避免 strptime 的歧义告警
    return datetime.strptime("2026-" + value, "%Y-%m-%d %H:%M:%S.%f")


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print(__doc__)
        return 2

    only_workflow = sys.argv[2] if len(sys.argv) == 3 else None

    arms: list[tuple[datetime, str, int, int]] = []
    starts: list[tuple[datetime, str]] = []
    ends: list[tuple[datetime, str]] = []
    notes: list[str] = []
    active_workflow: str | None = None

    for line in Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace").splitlines():
        armed = ARMED_RE.search(line)
        if armed:
            arms.append((parse_ts(armed["ts"]), armed["wf"], int(armed["slot"]), int(armed["delay"])))
            continue
        start = START_RE.search(line)
        if start:
            active_workflow = start["wf"].strip()
            starts.append((parse_ts(start["ts"]), active_workflow))
            continue
        end = END_RE.search(line)
        if end and active_workflow is not None:
            ends.append((parse_ts(end["ts"]), active_workflow))
            continue
        if NOTE_RE.search(line):
            notes.append(line.strip())

    if only_workflow is not None:
        arms = [item for item in arms if item[1] == only_workflow]
        starts = [item for item in starts if item[1] == only_workflow]
        ends = [item for item in ends if item[1] == only_workflow]

    print(f"workflow: {only_workflow or '(全部)'}")
    print(f"arming events: {len(arms)}   round starts: {len(starts)}   round ends: {len(ends)}")
    print()
    print(f"{'#':>2} {'slot':>4} {'delay(s)':>9} {'actual gap(s)':>14} {'dev(s)':>7} {'round(s)':>9}")
    # arm[i] 就是第 i 轮（索引对齐：seed 是 arm[0] → round 0）。
    # 第 i 轮的间隔实现值 = 第 i 轮起点 − 第 i-1 轮终点；第 i 轮的 delay 在第 i-1 轮结束时 armed。
    for index, (armed_at, _workflow, slot, delay_ms) in enumerate(arms):
        actual = None
        if index > 0 and index < len(starts) and index - 1 < len(ends):
            actual = (starts[index][0] - ends[index - 1][0]).total_seconds()
        duration = None
        if index < len(ends) and index < len(starts):
            duration = (ends[index][0] - starts[index][0]).total_seconds()
        actual_text = f"{actual:.3f}" if actual is not None else "-"
        dev_text = f"{actual - delay_ms / 1000:+.3f}" if actual is not None else "-"
        duration_text = f"{duration:.3f}" if duration is not None else "-"
        print(f"{index:>2} {slot:>4} {delay_ms / 1000:>9.3f} {actual_text:>14} {dev_text:>7} {duration_text:>9}")

    if notes:
        print()
        print("调度相关旁注：")
        for note in notes:
            print("  " + note)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
