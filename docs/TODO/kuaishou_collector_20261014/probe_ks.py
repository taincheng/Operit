#!/usr/bin/env python3
"""快手采集基线探针（adb 口径）。

用途：在不依赖 Operit 的情况下，用 adb 复核 kuaishou_collector_20261014/index.md
里「实测基线」那几条结论。改 driver 之前先用它确认现场没变。

只用标准库。需要 adb 在 PATH 里，且设备已连接。

子命令：
  search [keyword]       用 deep link 触发搜索，并打印顶层标签行的 7 个自绘节点
  tab                    切到第 3 个顶层标签（视频），并打印列表容器状态
  cards                  列出当前搜索结果页的作品卡片（desc 形如「作者的作品」）
  one [index]            在当前列表上取第 index 张卡（默认 0）的完整一条闭环，打印分享文本与短链
  dump                   打印当前页面里所有带文案的节点
  ad                     打印当前详情页是不是广告页

坐标与文案都对应快手 14.1.10.46550 / 1080x2400，换版本后要重新核对。
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

ADB = ["adb"]

KS_PACKAGE = "com.smile.gifmaker"
KS_SEARCH_SCHEME = "kwai://search"

# 顶层标签行：容器 resource-id 后缀与第几个可点击子节点是「视频」
TABS_ID_SUFFIX = ":id/tabs"
VIDEO_TAB_INDEX = 2

# 搜索结果卡片：content-desc 形如「朱朱(自装日记)的作品」
CARD_DESC_SUFFIX = "的作品"

# 详情页
SHARE_ENTRY_ID_SUFFIX = "forward_button"
SHARE_PANEL_COPY_ITEM_TEXT = "复制链接"
COMMENT_ENTRY_DESC_PREFIX = "评论框"
EDITOR_ID_SUFFIX = "editor"
AD_PAGE_ID_SUFFIX = "ad_card_container_root"

# App 窗口可用区（实测 [104,2267]）。卡片 bounds 会伸到 2400，所以按中心点判可用性。
APP_WINDOW_BOTTOM = 2267
LIST_TOP = 352

SHARE_URL_PATTERN = re.compile(r"https?://v\.kuaishou\.com/[^\s]+")

KEYCODE_BACK = 4
KEYCODE_PASTE = 279
KEYCODE_DEL = 67
CTRL_A_KEYCODES = "113 29"

TMP_DIR = os.path.join(tempfile.gettempdir(), "ks_probe")
os.makedirs(TMP_DIR, exist_ok=True)
DEVICE_DUMP = "/sdcard/ks_probe_dump.xml"


def sh(*args, timeout=60):
    return subprocess.run(
        ADB + ["shell", *[str(a) for a in args]],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=timeout,
    ).stdout


def focus():
    """当前焦点窗口整行。"""
    for line in sh("dumpsys window").splitlines():
        if "mCurrentFocus" in line:
            return line.strip()
    return ""


def dump(retries=3):
    """dump 当前页面并解析。dump 失败时不生成目标文件，所以先删远端文件再判本地结果。"""
    local = os.path.join(TMP_DIR, "dump.xml")
    for _ in range(retries):
        sh("rm -f", DEVICE_DUMP)
        sh("uiautomator dump", DEVICE_DUMP)
        if os.path.exists(local):
            os.remove(local)
        subprocess.run(
            ADB + ["pull", DEVICE_DUMP, local],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if os.path.exists(local):
            try:
                return ET.parse(local).getroot()
            except ET.ParseError:
                pass
        time.sleep(0.8)
    return None


def bounds(node):
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
    if not m:
        return None
    x1, y1, x2, y2 = (int(g) for g in m.groups())
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def center(node):
    box = bounds(node)
    if not box:
        return None
    return ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2)


def _parents(root):
    return {c: p for p in root.iter() for c in p}


def find_text(root, text, exact=True):
    for n in root.iter():
        t = n.attrib.get("text", "")
        if (t == text) if exact else (text in t):
            return n
    return None


def find_desc(root, prefix):
    for n in root.iter():
        if n.attrib.get("content-desc", "").startswith(prefix):
            return n
    return None


def find_id(root, suffix):
    for n in root.iter():
        if n.attrib.get("resource-id", "").endswith(suffix):
            return n
    return None


def clickable_ancestor(root, node):
    """节点自身 clickable 为 false 时，往上找真正吃点击的那一层。"""
    pm = _parents(root)
    cur = node
    while cur is not None:
        if cur.attrib.get("clickable") == "true":
            return cur
        cur = pm.get(cur)
    return None


def labeled(node, limit=40):
    return ((node.attrib.get("text", "") or node.attrib.get("content-desc", ""))[:limit])


def top_tabs(root):
    """顶层标签行里的 7 个自绘节点，按左边界排序。

    它们没有 text / content-desc / resource-id，只有 bounds 与 clickable，
    所以只能按「容器 + 顺序」定位，第 3 个（下标 2）是「视频」。
    """
    container = find_id(root, TABS_ID_SUFFIX)
    if container is None:
        return []
    tabs = [
        n
        for n in container.iter()
        if n.attrib.get("class") == "android.view.View"
        and n.attrib.get("clickable") == "true"
        and bounds(n)
    ]
    tabs.sort(key=lambda n: bounds(n)[0])
    return tabs


def cards(root):
    """当前视口内可点击的作品卡片，按先上后下、同行先左后右排序。"""
    out = []
    for n in root.iter():
        desc = n.attrib.get("content-desc", "")
        if not desc.endswith(CARD_DESC_SUFFIX) or n.attrib.get("clickable") != "true":
            continue
        box = bounds(n)
        if not box:
            continue
        cy = (box[1] + box[3]) // 2
        if LIST_TOP < cy < APP_WINDOW_BOTTOM:
            out.append(n)
    out.sort(key=lambda n: (bounds(n)[1], bounds(n)[0]))
    return out


def search(keyword):
    uri = f"{KS_SEARCH_SCHEME}?keyword={keyword}"
    sh("am", "force-stop", KS_PACKAGE)
    time.sleep(2)
    sh("am", "start", "-a", "android.intent.action.VIEW", "-d", uri, "-p", KS_PACKAGE)
    time.sleep(9)
    print("focus:", focus())
    root = dump()
    if root is None:
        print("dump 失败")
        return
    marker = find_id(root, "search_result_text")
    print("搜索框:", repr(marker.attrib.get("text", "")) if marker is not None else "未找到")
    tabs = top_tabs(root)
    print(f"顶层标签 {len(tabs)} 个（自绘，无文案）:")
    for i, tab in enumerate(tabs):
        mark = " <== 视频" if i == VIDEO_TAB_INDEX else ""
        print(f"   [{i}] bounds={tab.attrib.get('bounds')} center={center(tab)}{mark}")
    print("appbar（综合页的筛选 chip 行）:", "在" if find_id(root, ":id/appbar") is not None else "不在")


def switch_tab():
    root = dump()
    tabs = top_tabs(root)
    if len(tabs) <= VIDEO_TAB_INDEX:
        print(f"标签行只有 {len(tabs)} 个节点，无法切到「视频」")
        return
    point = center(tabs[VIDEO_TAB_INDEX])
    print(f"点第 {VIDEO_TAB_INDEX + 1} 个标签 {point}")
    sh("input", "tap", point[0], point[1])
    time.sleep(4)
    root = dump()
    found = cards(root)
    print("appbar:", "在" if find_id(root, ":id/appbar") is not None else "不在")
    print(f"作品卡片 {len(found)} 张:")
    for i, card in enumerate(found):
        print(f"   [{i}] {card.attrib.get('content-desc')} {card.attrib.get('bounds')}")


def extract_one(index=0, keep_input=False):
    """在当前列表上取第 index 张卡的一条闭环。返回短链或 None。"""
    root = dump()
    found = cards(root)
    if index >= len(found):
        print(f"只有 {len(found)} 张卡，取不到第 {index} 张")
        return None
    card = found[index]
    print(f"点卡片：{card.attrib.get('content-desc')} center={center(card)}")
    point = center(card)
    sh("input", "tap", point[0], point[1])
    time.sleep(6)
    print("focus:", focus())

    root = dump()
    ad = find_id(root, AD_PAGE_ID_SUFFIX)
    if ad is not None:
        print("广告详情页（有 ad_card_container_root，没有分享入口），整条跳过")
        return_to_list()
        return None

    share = find_id(root, SHARE_ENTRY_ID_SUFFIX)
    if share is None:
        print("找不到分享入口 forward_button")
        return None
    point = center(clickable_ancestor(root, share) or share)
    print(f"分享入口 desc={share.attrib.get('content-desc')!r} center={point}")
    sh("input", "tap", point[0], point[1])
    time.sleep(3)

    root = dump()
    item = find_text(root, SHARE_PANEL_COPY_ITEM_TEXT)
    if item is None:
        print("分享面板里没有「复制链接」")
        return None
    anchor = clickable_ancestor(root, item) or item
    point = center(anchor)
    print(f"「{SHARE_PANEL_COPY_ITEM_TEXT}」可点击祖先 bounds={anchor.attrib.get('bounds')} center={point}")
    sh("input", "tap", point[0], point[1])
    time.sleep(2.5)

    root = dump()
    entry = find_desc(root, COMMENT_ENTRY_DESC_PREFIX)
    if entry is None:
        print("找不到评论入口")
        return None
    point = center(clickable_ancestor(root, entry) or entry)
    print(f"评论入口 desc={entry.attrib.get('content-desc')!r} center={point}")
    sh("input", "tap", point[0], point[1])
    time.sleep(3)

    root = dump()
    editor = find_id(root, EDITOR_ID_SUFFIX)
    if editor is None:
        print("评论编辑器没打开，找不到 editor")
        return None
    point = center(editor)
    print(f"评论编辑器 bounds={editor.attrib.get('bounds')} center={point}")
    sh("input", "tap", point[0], point[1])
    time.sleep(1)
    sh("input", "keyevent", KEYCODE_PASTE)
    time.sleep(2)

    root = dump()
    editor = find_id(root, EDITOR_ID_SUFFIX)
    text = editor.attrib.get("text", "") if editor is not None else ""
    matched = SHARE_URL_PATTERN.search(text)
    print("粘贴回读:", repr(text))
    print("短链:", matched.group(0) if matched else "未抽到")
    if matched:
        title = text[matched.end():].split("该作品在快手")[0].strip()
        print("标题:", repr(title))

    if not keep_input:
        sh("input", "keycombination", CTRL_A_KEYCODES)
        time.sleep(0.8)
        sh("input", "keyevent", KEYCODE_DEL)
        time.sleep(0.8)
        sh("input", "keyevent", KEYCODE_BACK)
        time.sleep(1.2)

    return matched.group(0) if matched else None


def return_to_list():
    for _ in range(4):
        if "SearchActivity" in focus():
            return True
        sh("input", "keyevent", KEYCODE_BACK)
        time.sleep(1.5)
    return "SearchActivity" in focus()


def cmd_dump():
    root = dump()
    if root is None:
        print("dump 失败")
        return
    for n in root.iter():
        text = n.attrib.get("text", "")
        desc = n.attrib.get("content-desc", "")
        if not text and not desc:
            continue
        rid = n.attrib.get("resource-id", "").replace(f"{KS_PACKAGE}:id/", "")
        print(
            f"{n.attrib.get('bounds', ''):<24}"
            f"{n.attrib.get('class', '').split('.')[-1]:<14}"
            f"{rid:<30}{text[:30]!r:<34}{desc[:30]!r:<34}c={n.attrib.get('clickable')}"
        )


def cmd_ad():
    root = dump()
    if root is None:
        print("dump 失败")
        return
    print("广告页判据 ad_card_container_root:", "命中" if find_id(root, AD_PAGE_ID_SUFFIX) is not None else "未命中")
    print("分享入口 forward_button:", "在" if find_id(root, SHARE_ENTRY_ID_SUFFIX) is not None else "不在")
    print("focus:", focus())


def main():
    parser = argparse.ArgumentParser(description="快手采集基线探针")
    sub = parser.add_subparsers(dest="command", required=True)

    p_search = sub.add_parser("search", help="触发搜索并打印标签行")
    p_search.add_argument("keyword", nargs="?", default="家装")

    sub.add_parser("tab", help="切到视频标签并列出卡片")

    sub.add_parser("cards", help="列出当前结果页的作品卡片")

    p_one = sub.add_parser("one", help="取第 index 张卡的完整闭环")
    p_one.add_argument("index", nargs="?", type=int, default=0)
    p_one.add_argument("--keep-input", action="store_true", help="不回滚评论框内容")

    sub.add_parser("dump", help="打印当前页面带文案的节点")
    sub.add_parser("ad", help="判断当前详情页是不是广告页")

    args = parser.parse_args()

    if args.command == "search":
        search(args.keyword)
    elif args.command == "tab":
        switch_tab()
    elif args.command == "cards":
        root = dump()
        if root is None:
            print("dump 失败")
            return
        found = cards(root)
        print(f"{len(found)} 张作品卡片:")
        for i, card in enumerate(found):
            print(f"   [{i}] {card.attrib.get('content-desc')} {card.attrib.get('bounds')}")
    elif args.command == "one":
        extract_one(args.index, args.keep_input)
    elif args.command == "dump":
        cmd_dump()
    elif args.command == "ad":
        cmd_ad()


if __name__ == "__main__":
    main()
