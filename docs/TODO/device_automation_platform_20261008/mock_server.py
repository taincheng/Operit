#!/usr/bin/env python3
"""03 步的 mock 服务端。

按上报契约实现 POST /api/v1/records，用 /tmp/douyin_mock_mode.txt 切换行为，
便于逐条验证客户端的四种状态判定：

- accepted （默认）全部 accepted
- partial  第一条 accepted，其余 rejected
- error500 返回 500
- error400 返回 400
- throttle 返回 429 并带 Retry-After

收到的请求追加到 /tmp/douyin_mock_requests.jsonl（含三个互动计数与 counts_at 原文），
重复的幂等键记到 /tmp/douyin_mock_duplicates.txt。

同一个内容的第二次观测在这里只做「看得见」的处理：按 (source, content_id) 记录每个内容
最近一次的计数，并往 /tmp/douyin_mock_videos.jsonl 追加一条 updated 记录。
这样联调时能直接看出客户端有没有按契约换新的幂等键、有没有带上 counts_at，
而不用去读真实的库。真实服务端的做法见 server_api.md 的「同一视频的多次观测」。
"""

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("MOCK_PORT", "8765"))
MODE_FILE = "/tmp/douyin_mock_mode.txt"
LOG_FILE = "/tmp/douyin_mock_requests.jsonl"
SEEN_FILE = "/tmp/douyin_mock_seen.json"
DUP_FILE = "/tmp/douyin_mock_duplicates.txt"
VIDEO_FILE = "/tmp/douyin_mock_videos.jsonl"


def read_mode() -> str:
    try:
        with open(MODE_FILE, encoding="utf-8") as handle:
            return handle.read().strip() or "accepted"
    except FileNotFoundError:
        return "accepted"


def load_seen() -> set:
    try:
        with open(SEEN_FILE, encoding="utf-8") as handle:
            return set(json.load(handle))
    except FileNotFoundError:
        return set()


def save_seen(seen: set) -> None:
    with open(SEEN_FILE, "w", encoding="utf-8") as handle:
        json.dump(sorted(seen), handle)


VIDEO_SEEN_FILE = "/tmp/collector_mock_content_state.json"

# 契约里登记的来源域名，与 collectin.platformRules 对齐
PLATFORM_DOMAINS = (
    ("douyin_app", "v.douyin.com"),
    ("xiaohongshu", "xhslink.cn"),
    ("xiaohongshu", "xhslink.com"),
    ("xiaohongshu", "xiaohongshu.com"),
    ("kuaishou", "v.kuaishou.com"),
)


def platform_source(item: dict):
    """按契约从链接反查来源；域名不在白名单里返回 None（该条会被服务端拒掉）。"""
    from urllib.parse import urlparse

    parsed = urlparse(item.get("url", ""))
    host = (parsed.hostname or "").lower()
    for name, domain in PLATFORM_DOMAINS:
        if host == domain or host.endswith("." + domain):
            return name
    return None


def record_identity(item: dict):
    """内容身份 = (source, content_id)。

    身份是客户端解析出来的 content_id（抖音 aweme_id / 快手 photoId / 小红书 noteId），
    **不是**链接路径里的短码——抖音与快手每次分享都给新短码，拿它当身份会让同一个视频
    反复插成新行（真实服务端也一样，所以这里对齐）。
    没有 content_id 就没有身份，调用方按新行处理。
    """
    source = platform_source(item)
    if source is None:
        return None
    content_id = str(item.get("content_id") or "").strip()
    return (source, content_id)


def short_code_of(item: dict):
    """链接路径最后一段（短码）。只用于日志核对，不当身份。"""
    from urllib.parse import urlparse

    return urlparse(item.get("url", "")).path.strip("/").rsplit("/", 1)[-1].strip()


def load_videos() -> dict:
    try:
        with open(VIDEO_SEEN_FILE, encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return {}


def save_videos(videos: dict) -> None:
    """键是 "source|content_id"，与 load_videos 的读法一致。"""
    with open(VIDEO_SEEN_FILE, "w", encoding="utf-8") as handle:
        json.dump(videos, handle, ensure_ascii=False)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass

    def _respond(self, status: int, body: bytes, headers=None) -> None:
        self.send_response(status)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            self._respond(400, b"invalid json")
            return

        items = payload.get("items", [])
        keys = [item.get("idempotency_key", "") for item in items]
        with open(LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "path": self.path,
                        "authorization": self.headers.get("Authorization", ""),
                        "content_type": self.headers.get("Content-Type", ""),
                        "batch_id": payload.get("batch_id"),
                        "client": payload.get("client"),
                        "keys": keys,
                        "items": items,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

        mode = read_mode()
        if mode == "error500":
            self._respond(500, b"mock server failed")
            return
        if mode == "error400":
            self._respond(400, b"mock contract violation")
            return
        if mode == "throttle":
            self._respond(429, b"slow down", {"Retry-After": "120"})
            return

        seen = load_seen()
        duplicates = [key for key in keys if key in seen]
        if duplicates:
            with open(DUP_FILE, "a", encoding="utf-8") as handle:
                handle.write("\n".join(duplicates) + "\n")
        seen.update(keys)
        save_seen(seen)

        # 视频身份 = 来源 + 链接路径最后一段，与契约里服务端的算法一致。
        # 第二次看到同一个视频就是一次「更新」，日志里标出来，便于联调时核对。
        videos = load_videos()
        for item in items:
            identity = record_identity(item)
            if identity is None:
                continue
            source, content_id = identity
            has_identity = content_id != ""
            video_key = f"{source}|{content_id}"
            # 没有 content_id 就没有身份：每次都是一行新的，不做任何猜测
            first_seen = (not has_identity) or (video_key not in videos)
            counts = {
                "like_count": item.get("like_count"),
                "comment_count": item.get("comment_count"),
                "collect_count": item.get("collect_count"),
                "counts_at": item.get("counts_at"),
            }
            if has_identity:
                videos[video_key] = counts
            with open(VIDEO_FILE, "a", encoding="utf-8") as handle:
                handle.write(
                    json.dumps(
                        {
                            "action": "inserted" if first_seen else "updated",
                            "source": source,
                            "content_id": content_id,
                            "short_code": short_code_of(item),
                            "idempotency_key": item.get("idempotency_key", ""),
                            "counts": counts,
                            "interaction_text": item.get("interaction_text", ""),
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
        save_videos(videos)

        if mode == "partial":
            accepted = keys[:1]
            rejected = [{"key": key, "reason": "duplicate"} for key in keys[1:]]
        else:
            accepted = keys
            rejected = []

        body = json.dumps({"accepted": accepted, "rejected": rejected}).encode("utf-8")
        self._respond(200, body, {"Content-Type": "application/json"})


if __name__ == "__main__":
    print(f"mock server listening on 127.0.0.1:{PORT}, mode file {MODE_FILE}", flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
