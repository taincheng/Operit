#!/usr/bin/env python3
"""在当前界面上按文案点一个节点。

用法：operit_tap.py <文案> [--contains] [--desc] [--index N]
先 uiautomator dump，再在节点里找 text（默认）或 content-desc 命中，点它的中心。
只用于开发期驱动 Operit 自己的界面（Compose 页面）。
"""
import re
import subprocess
import sys

args = sys.argv[1:]
if not args:
    raise SystemExit(__doc__)
needle = args[0]
contains = "--contains" in args
use_desc = "--desc" in args
index = 1
if "--index" in args:
    index = int(args[args.index("--index") + 1])

subprocess.run(["adb", "shell", "uiautomator", "dump", "/sdcard/__ui.xml"], capture_output=True)
xml = subprocess.run(
    ["adb", "exec-out", "cat", "/sdcard/__ui.xml"], capture_output=True, text=True
).stdout

matches = []
for m in re.finditer(r"<node[^>]*>", xml):
    node = m.group(0)
    attr = "content-desc" if use_desc else "text"
    t = re.search(rf'{attr}="([^"]*)"', node)
    b = re.search(r'bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"', node)
    if not t or not b:
        continue
    value = t.group(1)
    hit = needle in value if contains else value == needle
    if not hit:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    if x2 <= x1 or y2 <= y1:
        continue
    matches.append(((x1 + x2) // 2, (y1 + y2) // 2, value, node[:160]))

if not matches:
    print(f"NOT FOUND: {needle!r}")
    sys.exit(1)

if index > len(matches):
    print(f"ONLY {len(matches)} MATCHES for {needle!r}")
    sys.exit(1)

x, y, value, node = matches[index - 1]
print(f"tap ({x},{y}) value={value!r}")
print(node)
subprocess.run(["adb", "shell", "input", "tap", str(x), str(y)], check=True)
