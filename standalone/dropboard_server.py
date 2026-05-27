#!/usr/bin/env python3
import argparse
import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

CONFIG_FILE_NAME = ".dropboard-config.json"
DEFAULT_DATA_FILE_NAME = "dropboard.default.json"


def read_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")


class DropBoardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, app_dir: Path, **kwargs):
        self.app_dir = app_dir
        super().__init__(*args, directory=str(app_dir), **kwargs)

    @property
    def config_path(self) -> Path:
        return self.app_dir / CONFIG_FILE_NAME

    def _send_json(self, status_code: int, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        # Avoid stale UI/assets when testing datasource path changes.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _read_request_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _load_config(self):
        if not self.config_path.exists():
            return {"dataSourcePath": ""}
        try:
            cfg = read_json(self.config_path)
            if not isinstance(cfg, dict):
                return {"dataSourcePath": ""}
            return {"dataSourcePath": str(cfg.get("dataSourcePath", ""))}
        except Exception:
            return {"dataSourcePath": ""}

    def _resolve_data_path(self):
        header_path = (self.headers.get("X-DropBoard-Data-Source") or "").strip()
        if header_path:
            return Path(header_path).expanduser()
        cfg = self._load_config()
        data_source = (cfg.get("dataSourcePath") or "").strip()
        if data_source:
            return Path(data_source).expanduser()
        return self.app_dir / DEFAULT_DATA_FILE_NAME

    def _validate_data_source(self, value: str):
        raw = (value or "").strip()
        path = Path(raw).expanduser() if raw else (self.app_dir / DEFAULT_DATA_FILE_NAME)
        if not path.exists():
            return {"ok": False, "path": str(path), "error": "File not found"}
        if not path.is_file():
            return {"ok": False, "path": str(path), "error": "Path is not a file"}
        try:
            payload = read_json(path)
        except Exception as exc:
            return {"ok": False, "path": str(path), "error": "Invalid JSON", "detail": str(exc)}
        if not isinstance(payload, dict):
            return {"ok": False, "path": str(path), "error": "JSON root must be an object"}
        return {"ok": True, "path": str(path)}

    @staticmethod
    def _normalize_api_path(path: str) -> str:
        if path.startswith("/api/dropboard/"):
            return path.replace("/api/dropboard/", "/api/", 1)
        return path

    def do_GET(self):
        parsed = urlparse(self.path)
        api_path = self._normalize_api_path(parsed.path)
        if api_path == "/api/config":
            self._send_json(HTTPStatus.OK, self._load_config())
            return
        if api_path == "/api/data":
            path = self._resolve_data_path()
            if not path.exists():
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Data source not found", "path": str(path)})
                return
            try:
                payload = read_json(path)
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON data source", "detail": str(exc)})
                return
            self._send_json(HTTPStatus.OK, {"path": str(path), "data": payload})
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        api_path = self._normalize_api_path(parsed.path)

        if api_path == "/api/config":
            try:
                body = self._read_request_json()
                value = str(body.get("dataSourcePath", "")).strip()
                write_json(self.config_path, {"dataSourcePath": value})
                validation = self._validate_data_source(value)
                self._send_json(HTTPStatus.OK, {"ok": True, "dataSourcePath": value, "validation": validation})
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return

        if api_path == "/api/validate-data-source":
            try:
                body = self._read_request_json()
                value = str(body.get("dataSourcePath", "")).strip() or (self.headers.get("X-DropBoard-Data-Source") or "").strip()
                validation = self._validate_data_source(value)
                status = HTTPStatus.OK if validation.get("ok") else HTTPStatus.BAD_REQUEST
                self._send_json(status, validation)
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return

        if api_path == "/api/init":
            try:
                body = self._read_request_json()
                source = body.get("defaultData")
                if not isinstance(source, dict):
                    source = read_json(self.app_dir / DEFAULT_DATA_FILE_NAME)
                path = self._resolve_data_path()
                if path.exists():
                    self._send_json(HTTPStatus.OK, {"ok": True, "created": False, "path": str(path)})
                    return
                write_json(path, source)
                self._send_json(HTTPStatus.OK, {"ok": True, "created": True, "path": str(path)})
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return

        if api_path == "/api/data":
            try:
                body = self._read_request_json()
                data = body.get("data")
                if not isinstance(data, dict):
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Request body must include object field: data"})
                    return
                path = self._resolve_data_path()
                write_json(path, data)
                self._send_json(HTTPStatus.OK, {"ok": True, "path": str(path)})
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Unknown endpoint"})


def main():
    parser = argparse.ArgumentParser(description="DropBoard local server")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--dir", type=str, default=".")
    args = parser.parse_args()

    app_dir = Path(args.dir).resolve()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), lambda *a, **k: DropBoardHandler(*a, app_dir=app_dir, **k))
    print(f"DropBoard server running on http://127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
