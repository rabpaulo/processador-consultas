import http.client
import json
import threading
import unittest

from server import MAX_BODY, create_server


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = create_server(0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request(self, method, path, payload=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        headers = headers or {}
        if isinstance(payload, (dict, list)):
            payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers = {"Content-Type": "application/json", **headers}
        connection.request(method, path, payload, headers)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_python_health_and_catalog(self):
        status, _, body = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["backend"], "Python")
        status, _, body = self.request("GET", "/api/catalog")
        self.assertEqual(status, 200)
        catalog = json.loads(body)
        self.assertEqual(len(catalog["schema"]), 10)
        self.assertEqual(catalog["sampleCounts"]["Produto"], 8)
        self.assertEqual(len(catalog["examples"]), 5)

    def test_post_query_returns_current_delivery_analysis(self):
        status, headers, body = self.request("POST", "/api/process", {"sql": "SELECT Nome FROM Produto WHERE idProduto = 1"})
        self.assertEqual(status, 200)
        self.assertIn("application/json", headers["Content-Type"])
        result = json.loads(body)
        self.assertEqual(result["backend"], "Python")
        self.assertEqual(result["query"]["columns"][0]["key"], "Produto.Nome")
        self.assertNotIn("optimizedResult", result)
        self.assertNotIn("algebra", result)

    def test_query_error_has_line_column_and_position(self):
        status, _, body = self.request("POST", "/api/process", {"sql": "SELECT Nome,\nValor FROM Produto"})
        self.assertEqual(status, 422)
        error = json.loads(body)["error"]
        self.assertIn("Campo inexistente", error["message"])
        self.assertEqual((error["line"], error["column"], error["position"]), (2, 1, 13))

    def test_error_position_matches_browser_utf16(self):
        sql = "SELECT Nome FROM Produto WHERE Nome = '😀' AND Valor = 1"
        status, _, body = self.request("POST", "/api/process", {"sql": sql})
        self.assertEqual(status, 422)
        position = sql.index("Valor")
        self.assertEqual(json.loads(body)["error"]["position"], len(sql[:position].encode("utf-16-le")) // 2)

    def test_malformed_requests_and_wrong_content_type(self):
        for payload in ({}, {"sql": 123}, ["SELECT * FROM Produto"]):
            with self.subTest(payload=payload):
                status, _, body = self.request("POST", "/api/process", payload)
                self.assertEqual(status, 422)
                self.assertIn("sql", json.loads(body)["error"]["message"])
        self.assertEqual(self.request("POST", "/api/process", b"{", {"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.request("POST", "/api/process", b"SELECT * FROM Produto")[0], 415)

    def test_oversized_request_is_rejected(self):
        status, _, _ = self.request("POST", "/api/process", b"", {"Content-Type": "application/json", "Content-Length": str(MAX_BODY + 1)})
        self.assertEqual(status, 413)

    def test_static_assets_and_backend_files_are_separate(self):
        for path in ("/", "/styles.css", "/app.js"):
            with self.subTest(path=path):
                status, _, body = self.request("GET", path)
                self.assertEqual(status, 200)
                self.assertTrue(body)
        for path in ("/server.py", "/consulta/parser.py", "/data/catalog.json", "/src/parser.js", "/../server.py", "/%2e%2e/server.py"):
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 404)
        status_405, headers_405, _ = self.request("GET", "/api/process")
        self.assertEqual(status_405, 405)
        self.assertEqual(headers_405.get("Allow"), "POST")
        self.assertEqual(self.request("GET", "/favicon.ico")[0], 204)
        self.assertEqual(self.request("POST", "/bad", {})[0], 404)

    def test_head_has_no_body(self):
        status, headers, body = self.request("HEAD", "/api/catalog")
        self.assertEqual(status, 200)
        self.assertGreater(int(headers["Content-Length"]), 0)
        self.assertEqual(body, b"")


if __name__ == "__main__":
    unittest.main()
