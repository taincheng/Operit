#!/usr/bin/env python3
"""adb shell service call clipboard getPrimaryClip 的返回值是个 Parcel hex dump。

Parcel dump 里的每个 8 位十六进制是「32 位值的十六进制表示」，而内存是小端，
所以按 int(word, 16).to_bytes(4, "little") 还原字节流。
还原之后剪贴板文本可能是 String16（UTF-16LE）也可能是 UTF-8 字节串，
两种都扫一遍，只用于开发期取证。
"""
import re
import subprocess

raw = subprocess.run(
    [
        "adb",
        "shell",
        "service",
        "call",
        "clipboard",
        "4",
        "s16",
        "com.android.shell",
        "s16",
        "null",
        "i32",
        "0",
        "i32",
        "0",
    ],
    capture_output=True,
    text=True,
).stdout

data = bytearray()
for line in raw.splitlines():
    matched = re.match(r"0x[0-9a-f]+:\s+((?:[0-9a-f]{8}\s+){1,4})", line)
    if not matched:
        continue
    for word in matched.group(1).split():
        data.extend(int(word, 16).to_bytes(4, "little"))


def is_readable(text: str) -> bool:
    if not text:
        return False
    good = sum(1 for ch in text if ch.isprintable() or ch in "\n\t")
    return good >= len(text) * 0.85


# UTF-8 可打印串（中文、URL 都在这一类里）
for matched in re.finditer(rb"[\x20-\x7e\xc2-\xf4][\x20-\x7e\x80-\xbf]{3,}", bytes(data)):
    try:
        text = matched.group(0).decode("utf-8")
    except UnicodeDecodeError:
        continue
    if is_readable(text):
        print("UTF8:", text)

# String16：长度前缀 + UTF-16LE
i = 0
while i + 4 <= len(data):
    length = int.from_bytes(data[i : i + 4], "little")
    if 1 <= length <= 2000 and i + 4 + length * 2 <= len(data):
        try:
            text = bytes(data[i + 4 : i + 4 + length * 2]).decode("utf-16-le")
        except UnicodeDecodeError:
            text = ""
        if is_readable(text):
            print("UTF16:", text)
            i += 4 + length * 2
            continue
    i += 1
