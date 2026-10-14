"""Servidor HTTP local e API Python; somente biblioteca padrão é necessária."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

from consulta import process_query
from consulta.parser import QueryError
from consulta.schema import metadata

ROOT = Path(__file__).resolve().parent
STATIC = {"/": ("index.html", "text/html"), "/index.html": ("index.html", "text/html"), "/styles.css": ("styles.css", "text/css"), "/app.js": ("app.js", "text/javascript")}
MAX_BODY = 131072  # Permite 20.000 caracteres Unicode mesmo escapados em JSON.


class Handler(BaseHTTPRequestHandler):
    server_version = "ConsultaPython/1.0"

    def send_bytes(self, status, contents, content_type, *, head=False, extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(contents)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if extra_headers:
            for key, val in extra_headers.items():
                self.send_header(key, val)
        self.end_headers()
        if not head:
            self.wfile.write(contents)

    def send_json(self, status, payload, *, head=False, extra_headers=None):
        contents = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_bytes(status, contents, "application/json", head=head, extra_headers=extra_headers)

    def do_GET(self):
        self.serve_get()

    def do_HEAD(self):
        self.serve_get(head=True)

    def serve_get(self, head=False):
        route = unquote(urlsplit(self.path).path)
        if route == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if route == "/api/catalog":
            return self.send_json(200, metadata(), head=head)
        if route == "/api/health":
            return self.send_json(200, {"status": "ok", "backend": "Python"}, head=head)
        if route == "/api/process":
            return self.send_json(405, {"error": {"message": "Use POST para processar uma consulta."}}, head=head, extra_headers={"Allow": "POST"})
        if route not in STATIC:
            return self.send_json(404, {"error": {"message": "Arquivo não encontrado."}}, head=head)
        filename, content_type = STATIC[route]
        self.send_bytes(200, (ROOT / filename).read_bytes(), content_type, head=head)

    def do_POST(self):
        if urlsplit(self.path).path != "/api/process":
            return self.send_json(404, {"error": {"message": "Rota não encontrada."}})
        if self.headers.get_content_type() != "application/json":
            return self.send_json(415, {"error": {"message": "Envie a consulta como application/json."}})
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.send_json(400, {"error": {"message": "Tamanho de requisição inválido."}})
        if size < 0 or size > MAX_BODY:
            self.close_connection = True
            return self.send_json(413, {"error": {"message": "A requisição excedeu o limite de tamanho."}})
        sql = ""
        try:
            payload = json.loads(self.rfile.read(size).decode("utf-8"))
            if not isinstance(payload, dict) or not isinstance(payload.get("sql"), str):
                raise QueryError("Informe uma string no campo sql.")
            sql = payload["sql"]
            result = process_query(sql)
            self.send_json(200, result)
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": {"message": "JSON inválido.", "position": 0, "code": "request", "line": 1, "column": 1}})
        except QueryError as error:
            before = sql[:error.position]
            # A seleção de texto do navegador usa posições UTF-16.
            utf16_position = len(before.encode("utf-16-le")) // 2
            self.send_json(422, {"error": {"message": str(error), "position": utf16_position, "code": error.code, "line": before.count("\n") + 1, "column": len(before.rsplit("\n", 1)[-1]) + 1}})
        except RecursionError:
            self.send_json(422, {"error": {"message": "Consulta complexa demais para o limite didático.", "position": 0, "code": "resource"}})
        except Exception:
            logging.exception("Erro inesperado ao processar consulta")
            self.send_json(500, {"error": {"message": "Falha interna ao processar a consulta.", "position": 0, "code": "internal"}})

    def log_message(self, format, *args):
        logging.info(format, *args)


def create_server(port=3000):
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main():
    parser = argparse.ArgumentParser(description="Processador de consultas SQL em Python")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "3000")))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        server = create_server(args.port)
    except OSError as error:
        parser.exit(1, f"Não foi possível iniciar o servidor: {error}\n")
    print(f"Processador de consultas Python: http://localhost:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
