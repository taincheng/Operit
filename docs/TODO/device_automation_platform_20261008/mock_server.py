#!/usr/bin/env python3
"""03 步的 mock 服务端。

按上报契约实现 POST /api/v1/records，用 /tmp/douyin_mock_mode.txt 切换行为，
便于逐条验证客户端的四种状态判定：

- accepted （默认）全部 accepted
- partial  第一条 accepted，其余 rejected
- error500 返回 500
- error400 返回 400
- throttle 返回 429 并带 Retry-After

收到的请求追加到 /tmp/douyin_mock_requests.jsonl，重复的幂等键记到
/tmp/douyin_mock_duplicates.txt。运行方式见同目录 README 的说明。
"""

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("MOCK_PORT", "8765"))
MODE_FILE = "/tmp/douyin_mock_mode.txt"
LOG_FILE = "/tmp/douyin_mock_requests.jsonl"
SEEN_FILE = "/tmp/douyin_mock_seen.json"
DUP_FILE = "/tmp/douyin_mock_duplicates.txt"


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
