#!/usr/bin/env python3
"""小红书采集基线探针（adb 口径）。

用途：在不依赖 Operit 的情况下，用 adb 复核 xiaohongshu_collector_20261012/index.md
里「实测基线」那几条结论。改 driver 之前先用它确认现场没变。

只用标准库。需要 adb 在 PATH 里，且设备已连接。

子命令：
  search <keyword>       用 deep link 触发搜索，并打印搜索框文本与首屏卡片
  cards                  列出当前搜索结果页的卡片，并给出分类判定
  one [index]            在当前搜索结果页上跑完整的一条闭环，打印分享文本与抽出的短链
  dump                   打印当前页面里所有带文案的节点

坐标与文案都对应小红书 9.22.1 / 1080x2400，换版本后要重新核对。
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

XHS_PACKAGE = "com.xingin.xhs"
XHS_SEARCH_SCHEME = "xhsdiscover://search/result"

# 分享面板
SHARE_PANEL_TITLE_TEXT = "分享至"
SHARE_PANEL_COPY_ITEM_TEXT = "复制链接"

# 详情页分享入口
VIDEO_FEED_SHARE_DESC = "分享"
NOTE_SHARE_ENTRY_ID_SUFFIX = "moreOperateIV"

# 详情页评论入口
NOTE_COMMENT_ENTRY_DESC = "评论框"
FEED_COMMENT_ENTRY_TEXT = "说点什么..."

EDIT_TEXT_CLASS_SUFFIX = "EditText"

KEYCODE_BACK = 4
KEYCODE_PASTE = 279
KEYCODE_DEL = 67
CTRL_A_KEYCODES = ["113", "29"]

XHS_SHARE_URL_PATTERN = re.compile(r"https?://xhslink\.(?:cn|com)/[^\s，,、）)】\]]+", re.I)

# 列表里卡片必须完整落在这一段里：上边是吸顶的筛选 chip 栏下沿，下边是导航栏上沿。
# 被裁切的卡片中心点会落到筛选栏上，点开的是筛选面板而不是卡片。
LIST_VIEWPORT_TOP = 497
LIST_VIEWPORT_BOTTOM = 2267

CARD_MIN_SIDE = 400
CARD_MIN_TEXT_LEN = 15

TMP_DIR = os.path.join(tempfile.gettempdir(), "xhs_probe")


def sh(*args):
    # 合并 stderr：uiautomator 的 "ERROR: could not get idle state." 走的是 stderr，
    # 只收 stdout 会把它丢成空输出，排查时看不到真正原因。
    return subprocess.run(
        ADB + ["shell", *[str(a) for a in args]],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=60,
    ).stdout


def focus():
    """当前焦点窗口的整行。

    注意 Window{id u0 pid} 后面还有空格，只取第一个非空白串只会拿到 Window{id，
    后面判断 Activity 名就永远不成立。
    """
    out = sh("dumpsys", "window")
    matched = re.search(r"mCurrentFocus=(.+)", out)
    return matched.group(1).strip() if matched else "(unknown)"


def dump(tag="d", attempts=3):
    """dump 当前页面。

    两个坑：

    1. 抖音那份计划里记过：uiautomator 在 idle 失败时以退出码 0 结束，随后 cat 到的是
       残留的旧文件。所以这里先删目标文件，dump 后校验文件确实存在。
    2. 视频笔记详情页在播放中必然 idle 失败（实测连续三次都是
       ERROR: could not get idle state.，且不会生成文件）。adb 口径的应对是先暂停播放，
       见 pause_video_feed。无障碍档不依赖 idle，不需要这一步。
    """
    os.makedirs(TMP_DIR, exist_ok=True)
    local = os.path.join(TMP_DIR, f"{tag}.xml")
    last = ""
    for _ in range(attempts):
        if os.path.exists(local):
            os.remove(local)
        remote = f"/sdcard/{tag}.xml"
        sh("rm", "-f", remote)
        out = sh("uiautomator", "dump", remote)
        subprocess.run(ADB + ["pull", remote, local], capture_output=True, text=True)
        if os.path.exists(local):
            return ET.parse(local).getroot()
        last = out.strip() or "(无输出)"
        time.sleep(1.5)
    raise RuntimeError(f"dump 失败（前台 {focus()}）：{last}")


def nodes(root):
    return [n.attrib for n in root.iter()]


def center(bounds):
    matched = re.match(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", bounds or "")
    if not matched:
        return None
    x1, y1, x2, y2 = (int(v) for v in matched.groups())
    return ((x1 + x2) // 2, (y1 + y2) // 2, (x1, y1, x2, y2))


def find(root, pred):
    for node in root.iter():
        if pred(node.attrib):
            return node.attrib
    return None


def label(attrib):
    return attrib.get("text") or attrib.get("content-desc") or ""


def tap(x, y):
    sh("input", "tap", str(int(x)), str(int(y)))


def swipe(x1, y1, x2, y2, duration=400):
    sh("input", "swipe", *(str(int(v)) for v in (x1, y1, x2, y2, duration)))


def press_back():
    sh("input", "keyevent", str(KEYCODE_BACK))


def wait_for_focus(fragment, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if fragment in focus():
            return True
        time.sleep(0.6)
    return False


def tap_label(root, wanted):
    """按 text 或 content-desc 相等取节点，点它 bounds 的中心。

    分享面板里的文案节点与承载点击的 ViewGroup bounds 相同，两边 clickable 都是 false，
    所以不能要求节点本身 clickable。
    """
    node = find(root, lambda a: label(a) == wanted)
    if node is None:
        return False
    x, y, _ = center(node["bounds"])
    tap(x, y)
    return True


def card_nodes(root):
    """当前页面上符合「笔记卡片」判据的卡片，按网格顺序返回。

    判据四条，缺一不可：
      - clickable
      - 完整落在列表可视区内
      - 面积够大
      - 子树里有长度达标的正文文本，且没有商品卡的 ¥ desc
    """
    found = []
    for node in root.iter():
        attrib = node.attrib
        if attrib.get("clickable") != "true":
            continue
        box = center(attrib.get("bounds"))
        if box is None:
            continue
        x, y, (x1, y1, x2, y2) = box
        if y2 <= y1 or x2 <= x1:
            continue
        if x2 - x1 < CARD_MIN_SIDE or y2 - y1 < CARD_MIN_SIDE:
            continue
        if y1 < LIST_VIEWPORT_TOP or y2 > LIST_VIEWPORT_BOTTOM:
            continue

        texts = [d.attrib.get("text", "") for d in node.iter() if d.attrib.get("text", "")]
        descs = [d.attrib.get("content-desc", "") for d in node.iter() if d.attrib.get("content-desc", "")]
        if any(d.startswith("¥") for d in descs):
            continue
        body = next((t for t in texts if len(t) >= CARD_MIN_TEXT_LEN), None)
        if body is None:
            continue

        found.append({"point": (x, y), "bounds": attrib["bounds"], "title": body, "texts": texts})
    found.sort(key=lambda c: (center(c["bounds"])[2][1] // 200, center(c["bounds"])[2][0]))
    return found


def cmd_dump(_args):
    root = dump()
    print("focus:", focus())
    for attrib in nodes(root):
        text = label(attrib)
        if text:
            print(f"{text[:40]!r:44} {attrib.get('class', '').split('.')[-1]:14} {attrib['bounds']:24} click={attrib.get('clickable')}")


def cmd_search(args):
    keyword = args.keyword
    encoded = "".join(f"%{b:02X}" for b in keyword.encode("utf-8"))
    uri = f"{XHS_SEARCH_SCHEME}?keyword={encoded}"
    print("deep link:", uri)
    subprocess.run(
        ADB + ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", uri, "-p", XHS_PACKAGE],
        capture_output=True,
        text=True,
    )
    time.sleep(4)
    print("focus:", focus())
    root = dump()
    box = next(
        (a for a in nodes(root) if a.get("class", "").endswith("TextView") and a["bounds"].startswith("[169,115]")),
        None,
    )
    print("搜索框文本:", repr(box["text"]) if box else "(没找到，坐标随版本会变)")
    for card in card_nodes(root):
        print("  卡片", card["point"], card["title"][:34].replace("\n", " "))


def cmd_cards(_args):
    root = dump()
    print("focus:", focus())
    cards = card_nodes(root)
    print(f"笔记卡片 {len(cards)} 张")
    for card in cards:
        print(f"  {card['point']} {card['bounds']:24} {card['title'][:34]!r}")
    products = [
        a for a in nodes(root)
        if a.get("clickable") == "true" and any(d.startswith("¥") for d in [a.get("content-desc", "")])
    ]
    if products:
        print("同屏商品卡：", [(a["bounds"], a.get("content-desc")) for a in products])


def read_video_feed_root():
    """视频笔记详情页：先把播放停住再读，返回节点树根。

    点画面中心是小红书的播放/暂停开关，只影响播放状态，不会导航。
    1080x2400 上画面区是 [0,0][1080,2267]，中心取 (540, 1100)。

    这里要点一次试读一次：进页面后立刻点，视频可能还没起来，这一次点击不生效；
    点太早或太晚都可能落到页面转场动画里。所以最多做三轮「点一次、读一次」，
    三轮都读不到就报错——真正的原因在无障碍档那边不存在，这是 adb 口径的固有限制。
    """
    for _ in range(3):
        tap(540, 1100)
        time.sleep(2.5)
        try:
            return dump("detail", attempts=1)
        except RuntimeError:
            continue
    raise RuntimeError(
        "视频笔记详情页在 adb 口径下读不到（uiautomator 无法进入 idle）。"
        "无障碍档走 provider 的实时读取，不受这条限制；本探针到这里为止。"
    )


def detect_page_type(root):
    """按节点特征判定详情页类型，不用 activityName。

    视频流详情页有 content-desc 恰为「分享」的节点；图文笔记详情页没有这个节点，
    它的分享入口是右上角的 moreOperateIV。
    """
    if find(root, lambda a: a.get("content-desc") == VIDEO_FEED_SHARE_DESC) is not None:
        return "video"
    if find(root, lambda a: a.get("resource-id", "").endswith(NOTE_SHARE_ENTRY_ID_SUFFIX)) is not None:
        return "note"
    return None


def grab_share_text(root):
    """在详情页取分享文本。root 是已经读到手的详情页节点树，返回 (page_type, share_text)。"""
    page_type = detect_page_type(root)
    if page_type is None:
        raise RuntimeError(f"不在详情页上：{focus()}")

    if page_type == "video":
        entry = find(root, lambda a: a.get("content-desc") == VIDEO_FEED_SHARE_DESC)
    else:
        entry = find(root, lambda a: a.get("resource-id", "").endswith(NOTE_SHARE_ENTRY_ID_SUFFIX))
    x, y, _ = center(entry["bounds"])
    tap(x, y)

    deadline = time.time() + 12
    panel = None
    while time.time() < deadline:
        root = dump("panel")
        panel = find(root, lambda a: a.get("text") == SHARE_PANEL_TITLE_TEXT)
        if panel is not None:
            break
        time.sleep(0.5)
    if panel is None:
        raise RuntimeError("分享面板没有出现")

    if not tap_label(root, SHARE_PANEL_COPY_ITEM_TEXT):
        raise RuntimeError(f"面板里没有「{SHARE_PANEL_COPY_ITEM_TEXT}」")
    time.sleep(1.5)  # 面板点完自行关闭

    root = dump("after_copy")
    if page_type == "video":
        entry = find(root, lambda a: (a.get("text") or "").startswith(FEED_COMMENT_ENTRY_TEXT))
    else:
        entry = find(root, lambda a: a.get("content-desc") == NOTE_COMMENT_ENTRY_DESC)
    if entry is None:
        raise RuntimeError("找不到评论入口")
    x, y, _ = center(entry["bounds"])
    tap(x, y)

    if not wait_for_focus("NoteCommentActivity"):
        raise RuntimeError(f"评论页没有打开：{focus()}")

    root = dump("comment")
    edit = find(root, lambda a: a.get("class", "").endswith(EDIT_TEXT_CLASS_SUFFIX))
    if edit is None:
        raise RuntimeError("评论页里没有 EditText")
    placeholder = edit.get("text", "")
    x, y, _ = center(edit["bounds"])
    tap(x, y)
    time.sleep(0.8)
    sh("input", "keyevent", str(KEYCODE_PASTE))

    deadline = time.time() + 8
    share_text = ""
    while time.time() < deadline:
        root = dump("pasted")
        edit = find(root, lambda a: a.get("class", "").endswith(EDIT_TEXT_CLASS_SUFFIX))
        text = (edit or {}).get("text", "")
        if text and text != placeholder:
            share_text = text
            break
        time.sleep(0.5)

    # 清空评论框，不留下草稿
    sh("input", "keycombination", *CTRL_A_KEYCODES)
    time.sleep(0.4)
    sh("input", "keyevent", str(KEYCODE_DEL))
    time.sleep(0.4)
    press_back()
    time.sleep(1.2)

    return page_type, share_text


def cmd_one(args):
    root = dump("list")
    cards = card_nodes(root)
    if not cards:
        print("当前页没有可点的笔记卡片，先跑 search 或滚一下", file=sys.stderr)
        return 1
    index = args.index
    if index >= len(cards):
        print(f"只有 {len(cards)} 张卡片，index={index} 越界", file=sys.stderr)
        return 1
    card = cards[index]
    print("选中卡片:", card["title"][:34].replace("\n", " "))
    tap(*card["point"])

    deadline = time.time() + 15
    while time.time() < deadline:
        if "NoteDetailActivity" in focus() or "DetailFeedActivity" in focus():
            break
        time.sleep(0.6)
    current = focus()
    print("详情页:", current)
    started = time.time()

    # 按页型走两条确定性路径：视频页要先停住播放才能读，图文页直接读。
    if "DetailFeedActivity" in current:
        print("视频笔记：adb 口径要先暂停播放，否则 uiautomator 一直 idle 失败")
        detail_root = read_video_feed_root()
    else:
        detail_root = dump("detail")

    page_type, share_text = grab_share_text(detail_root)
    matched = XHS_SHARE_URL_PATTERN.search(share_text)
    print("页型:", page_type)
    print("分享文本:", repr(share_text))
    print("短链:", matched.group(0) if matched else "(没抽到)")
    print(f"耗时 {time.time() - started:.1f}s（含 adb 固定等待）")

    # 回到列表
    for _ in range(4):
        if "GlobalSearchActivity" in focus():
            break
        press_back()
        time.sleep(1.2)
    print("回到:", focus())
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("search", help="用 deep link 触发搜索")
    p.add_argument("keyword")
    p.set_defaults(func=cmd_search)

    sub.add_parser("cards", help="列出并分类当前搜索结果页的卡片").set_defaults(func=cmd_cards)
    sub.add_parser("dump", help="打印当前页面里带文案的节点").set_defaults(func=cmd_dump)

    p = sub.add_parser("one", help="跑完整的一条闭环")
    p.add_argument("index", nargs="?", type=int, default=0)
    p.set_defaults(func=cmd_one)

    args = parser.parse_args()
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
