#!/usr/bin/env python3
"""把 uiautomator dump 出来的 XML 压成一行一个节点的清单，便于比对页面结构。

用法：dump_nodes.py <xml> [--all]
默认只打有 text 或 content-desc 的节点；--all 连无文案的可点击节点也打出来。
"""
import re
import sys

path = sys.argv[1]
show_all = "--all" in sys.argv[2:]
xml = open(path, encoding="utf-8").read()

node_re = re.compile(r"<node\b[^>]*>")
attr_re = re.compile(r'([\w:-]+)="([^"]*)"')


def attr(node: str, name: str) -> str:
    matched = re.search(rf'\b{name}="([^"]*)"', node)
    return matched.group(1) if matched else ""


rows = []
for matched in node_re.finditer(xml):
    node = matched.group(0)
    text = attr(node, "text")
    desc = attr(node, "content-desc")
    cls = attr(node, "class").split(".")[-1]
    bounds = attr(node, "bounds")
    clickable = attr(node, "clickable")
    rid = attr(node, "resource-id")
    if not show_all and not text and not desc:
        continue
    rows.append(f"{text!r} desc={desc!r} class={cls} click={clickable} id={rid} bounds={bounds}")

print(f"# nodes={len(rows)}")
print("\n".join(rows))
