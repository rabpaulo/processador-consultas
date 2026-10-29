"""LIMIT final: sintaxe, execução, equivalência sem ordem e integridade dos planos."""

from collections import Counter
from copy import deepcopy
import sqlite3
import unittest
from unittest.mock import patch

from consulta.algebra import algebra_from_graph
from consulta.optimizer import build_optimized_plan
from consulta.parser import QueryError, parse, validate
from consulta.processor import process_query
from consulta.schema import EXAMPLES, SAMPLE_DATA, SCHEMA


MULTI_JOIN = """SELECT c.Nome, p.idPedido, s.Descricao FROM Cliente c
INNER JOIN Pedido p ON c.idCliente = p.Cliente_idCliente
INNER JOIN Status s ON p.Status_idStatus = s.idStatus"""


class LimitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = sqlite3.connect(":memory:")
        for table, columns in SCHEMA.items():
            cls.db.execute(f'CREATE TABLE "{table}" (' + ",".join(f'"{c}"' for c in columns) + ")")
            cls.db.executemany(f'INSERT INTO "{table}" VALUES (' + ",".join("?" for _ in columns) + ")",
                               [list(row.values()) for row in SAMPLE_DATA[table]])

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def check_limit(self, sql, limit):
        complete = process_query(sql)
        limited = process_query(f"{sql} LIMIT {limit};")
        # SQLite valida o multiconjunto completo; sem ORDER BY não fixa o subconjunto.
        expected = Counter(self.db.execute(sql).fetchall())
        for before, after in [(complete, limited), (complete["optimization"], limited["optimization"])]:
            self.assertEqual(Counter(map(tuple, before["result"]["rows"])), expected)
            self.assertEqual(after["result"]["rows"], before["result"]["rows"][:limit])
            self.assertEqual(after["result"]["columns"], before["result"]["columns"])
            self.assertEqual(after["result"]["rowCountBeforeLimit"], sum(expected.values()))
            self.assertEqual(after["result"]["rowCount"], min(limit, sum(expected.values())))
            self.assertEqual(after["result"]["hasData"], bool(after["result"]["rows"]))
        self.assertTrue(limited["optimization"]["equivalentResults"])
        self.assertEqual(limited["optimization"]["equivalenceBasis"], "before_limit")
        return limited

    def test_limit_zero(self):
        result = self.check_limit("SELECT * FROM Pedido", 0)
        self.assertEqual(result["result"]["rows"], [])
        self.assertGreater(result["result"]["rowCountBeforeLimit"], 0)

    def test_limit_one(self):
        self.check_limit("SELECT p.Nome FROM Produto p", 1)

    def test_limit_three(self):
        self.check_limit("SELECT p.Nome FROM Produto p", 3)

    def test_limit_larger_than_results(self):
        self.check_limit("SELECT p.Nome FROM Produto p", 100)
        self.check_limit("SELECT p.Nome FROM Produto p", 10 ** 100)

    def test_where_and_limit_after_filter(self):
        self.check_limit("SELECT p.Nome FROM Produto p WHERE p.Preco > 200", 5)
        self.check_limit("SELECT p.Nome FROM Produto p WHERE p.idProduto > 4", 1)
        self.check_limit("SELECT p.Nome FROM Produto p WHERE p.Preco < 0", 3)
        self.check_limit("SELECT p.Nome FROM Produto p WHERE 1 = 0", 3)

    def test_multiple_inner_joins_and_limit(self):
        for limit in (0, 1, 3, 100):
            with self.subTest(limit=limit):
                self.check_limit(MULTI_JOIN, limit)
                self.check_limit(MULTI_JOIN + " WHERE s.idStatus = 2", limit)

    def test_invalid_values_and_syntax(self):
        values = ["", "-1", "-0", "+1", "1.5", "3.0", ".5", "3.", "1e2", "3e0",
                  "Nome", "'3'", "TRUE", "NULL", "(3)", "1, 3", "1 3", "1 LIMIT 2",
                  "1 OFFSET 2", "1 WHERE Preco > 0", "1 ORDER BY Nome", "1; SELECT * FROM Produto"]
        prefix = "SELECT Nome FROM Produto LIMIT "
        for value in values:
            with self.subTest(value=value), self.assertRaises(QueryError) as caught:
                validate(parse(prefix + value))
            self.assertGreaterEqual(caught.exception.position, len(prefix))
        for sql in ("SELECT Nome LIMIT 1 FROM Produto", "SELECT Nome FROM Produto; LIMIT 1",
                    "SELECT Nome FROM Produto WHERE LIMIT 1"):
            with self.subTest(sql=sql), self.assertRaises(QueryError):
                parse(sql)

    def test_ast_case_comments_and_leading_zeros(self):
        sql = "select p.Nome from Produto as p limit -- valor\n003; -- fim"
        ast = validate(parse(sql))
        self.assertEqual(ast["limit"], 3)
        self.assertIsInstance(ast["limit"], int)
        self.assertEqual(ast["tokens"][-2]["value"], 3)
        self.assertIsNone(parse("SELECT * FROM Pedido")["limit"])

    def test_queries_without_limit_and_heuristics_unchanged(self):
        for sql in [e["sql"] for e in EXAMPLES[:4]] + [MULTI_JOIN]:
            with self.subTest(sql=sql):
                result = process_query(sql)
                limited = process_query(sql.rstrip().rstrip(";") + " LIMIT 3")
                self.assertIsNone(result["query"]["limit"])
                self.assertEqual(result["graph"]["rootId"], "project_1")
                self.assertEqual(result["optimization"]["graph"]["rootId"], "opt_project_root")
                self.assertEqual(result["optimization"]["heuristics"], limited["optimization"]["heuristics"])
                self.assertEqual(result["optimization"]["predicateAssignments"], limited["optimization"]["predicateAssignments"])
                self.assertEqual(result["optimization"]["equivalenceBasis"], "result")
                for before, after in [(result, limited), (result["optimization"], limited["optimization"])]:
                    nodes = deepcopy(after["graph"]["nodes"][:-1])
                    nodes[-1]["parentId"] = None
                    self.assertEqual(before["graph"]["nodes"], nodes)
                    self.assertEqual(before["graph"]["edges"], after["graph"]["edges"][:-1])

    def test_equivalence_with_different_unordered_subsets(self):
        result = self.check_limit(MULTI_JOIN, 3)
        self.assertNotEqual(Counter(map(tuple, result["result"]["rows"])),
                            Counter(map(tuple, result["optimization"]["result"]["rows"])))
        self.assertFalse(result["optimization"]["equivalentReturnedResults"])
        self.assertTrue(result["optimization"]["equivalentResults"])

    def test_limit_zero_does_not_mask_incorrect_optimization(self):
        # Simula uma falha real no filtro otimizado: o corte vazio não pode ocultá-la.
        with patch("consulta.optimizer.eval_condition", return_value=True):
            result = process_query("SELECT p.Nome FROM Produto p WHERE p.Preco < 0 LIMIT 0")
        self.assertEqual(result["result"]["rows"], [])
        self.assertEqual(result["optimization"]["result"]["rows"], [])
        self.assertFalse(result["optimization"]["equivalentResults"])
        self.assertTrue(result["optimization"]["equivalentReturnedResults"])

    def test_duplicate_rows_and_columns_are_preserved(self):
        sql = """SELECT c.Descricao, c.Descricao FROM Produto p
        INNER JOIN Categoria c ON p.Categoria_idCategoria = c.idCategoria"""
        result = self.check_limit(sql, 3)
        self.assertEqual(len(result["result"]["columns"]), 2)
        self.assertEqual(Counter(map(tuple, result["result"]["rows"])).most_common(1)[0][1], 3)

    def test_graph_edges_counts_and_plan_dependencies(self):
        for limit in (0, 1, 3, 100):
            result = process_query(MULTI_JOIN + f" WHERE s.idStatus > 0 LIMIT {limit}")
            for bundle in (result, result["optimization"]):
                with self.subTest(limit=limit, root=bundle["graph"]["rootId"]):
                    graph, plan = bundle["graph"], bundle["plan"]
                    nodes = {n["id"]: n for n in graph["nodes"]}
                    self.assertEqual(len(nodes), len(graph["nodes"]))
                    root = nodes[graph["rootId"]]
                    self.assertEqual(root["type"], "limit")
                    self.assertEqual(root["limit"], limit)
                    self.assertIsNone(root["parentId"])
                    self.assertEqual(nodes[root["children"][0]]["type"], "project")
                    self.assertEqual(sum(n["type"] == "limit" for n in nodes.values()), 1)
                    self.assertEqual(root["outputColumns"], bundle["result"]["columns"])
                    self.assertEqual(root["tuplesCount"], bundle["result"]["rowCount"])
                    self.assertEqual(nodes[root["children"][0]]["tuplesCount"], bundle["result"]["rowCountBeforeLimit"])
                    pairs = {(e["source"], e["target"]) for e in graph["edges"]}
                    expected_pairs = {(child, node["id"]) for node in nodes.values() for child in node["children"]}
                    self.assertEqual(pairs, expected_pairs)
                    self.assertEqual(len(graph["edges"]), len(nodes) - 1)
                    self.assertEqual(len({e["id"] for e in graph["edges"]}), len(graph["edges"]))
                    for edge in graph["edges"]:
                        self.assertEqual(nodes[edge["source"]]["parentId"], edge["target"])
                        self.assertEqual(edge["tuplesCount"], nodes[edge["source"]]["tuplesCount"])
                    positions = {s["nodeId"]: i for i, s in enumerate(plan["steps"])}
                    self.assertEqual(set(positions), set(nodes))
                    self.assertEqual(plan["totalSteps"], len(nodes))
                    self.assertEqual(plan["rootOperator"], "LIMIT")
                    self.assertEqual([s["step"] for s in plan["steps"]], list(range(1, len(nodes) + 1)))
                    self.assertEqual(plan["steps"][-1]["nodeId"], root["id"])
                    for step in plan["steps"]:
                        node = nodes[step["nodeId"]]
                        self.assertEqual(step["rowsProduced"], node["tuplesCount"])
                        self.assertEqual(step["columnsProduced"], len(node["outputColumns"]))
                        for child in node["children"]:
                            self.assertLess(positions[child], positions[node["id"]])
                    metrics = result["optimization"]["metrics"]
                    prefix = "canonical" if bundle is result else "optimized"
                    self.assertEqual(metrics[prefix + "IntermediateTuples"], sum(s["rowsProduced"] for s in plan["steps"][:-1]))
                    self.assertEqual(metrics[prefix + "IntermediateCells"], sum(s["rowsProduced"] * s["columnsProduced"] for s in plan["steps"][:-1]))

    def test_algebra_wraps_projection_and_preserves_operators(self):
        result = process_query(MULTI_JOIN + " WHERE s.idStatus = 2 LIMIT 3")
        self.assertEqual(result["algebra"]["tree"]["type"], "limit")
        self.assertEqual(result["algebra"]["tree"]["child"]["type"], "project")
        for bundle in (result, result["optimization"]):
            for style, limit, project, select, join in [
                ("unicode", "LIMIT[3](", "π[", "σ[", "⋈["),
                ("ascii", "LIMIT[3](", "PI[", "SIGMA[", "JOIN["),
                ("latex", "\\operatorname{LIMIT}_{3}\\left(", "\\pi_{", "\\sigma_{", "\\bowtie_{"),
            ]:
                expression = bundle["algebra"][style]
                self.assertTrue(expression.startswith(limit))
                for operator in (project, select, join):
                    self.assertIn(operator, expression)
        self.assertEqual(algebra_from_graph(result["optimization"]["graph"]), result["optimization"]["algebra"])

    def test_optimized_plan_does_not_mutate_canonical_limit(self):
        result = process_query(MULTI_JOIN + " LIMIT 3")
        before = deepcopy(result)
        build_optimized_plan(result["query"], result["algebra"], result["graph"], result["plan"])
        self.assertEqual(result, before)
