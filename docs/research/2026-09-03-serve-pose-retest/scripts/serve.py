"""Static server with HTTP Range support.

python -m http.server ignores Range and answers 200 with the whole file, so
a <video> reports seekable = [0, 0] and every currentTime assignment is
silently dropped. The review page is useless without seeking, and the
failure looks like a broken overlay rather than a broken server.
"""
import os
import re
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

TYPES = {".mp4": "video/mp4", ".js": "application/javascript",
         ".html": "text/html; charset=utf-8"}


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        if not os.path.isfile(path):
            return SimpleHTTPRequestHandler.do_GET(self)
        size = os.path.getsize(path)
        ctype = TYPES.get(os.path.splitext(path)[1], "application/octet-stream")
        rng = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
        if not m:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(size))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            with open(path, "rb") as fh:
                self.wfile.write(fh.read())
            return
        start = int(m.group(1) or 0)
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        self.send_response(206)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with open(path, "rb") as fh:
            fh.seek(start)
            self.wfile.write(fh.read(end - start + 1))

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    os.chdir(sys.argv[2])
    HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
