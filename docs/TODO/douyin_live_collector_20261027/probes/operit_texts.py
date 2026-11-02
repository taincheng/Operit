#!/usr/bin/env python3
"""打印当前界面所有带文案的节点（text 与 content-desc），一行一个。"""
import re
import subprocess

subprocess.run(["adb", "shell", "uiautomator", "dump", "/sdcard/__ui.xml"], capture_output=True)
xml = subprocess.run(
    ["adb", "exec-out", "cat", "/sdcard/__ui.xml"], capture_output=True, text=True
).stdout

for m in re.finditer(r"<node[^>]*>", xml):
    node = m.group(0)
    t = re.search(r'text="([^"]*)"', node)
    d = re.search(r'content-desc="([^"]*)"', node)
    b = re.search(r'bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"', node)
    text = t.group(1) if t else ""
    desc = d.group(1) if d else ""
    if not text and not desc:
        continue
    if not b:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
    print(f"({cx},{cy}) text={text!r} desc={desc!r}")
