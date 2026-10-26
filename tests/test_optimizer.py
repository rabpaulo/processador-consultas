"""Regressões da entrega final: estrutura, semântica e apresentação algébrica."""

from collections import Counter
from copy import deepcopy
from itertools import permutations
import sqlite3
import unittest

from consulta.algebra import algebra_from_graph, format_condition
from consulta.optimizer import build_optimized_plan
from consulta.parser import comparisons, references
from consulta.processor import process_query
from consulta.schema import SAMPLE_DATA, SCHEMA


INNER = """SELECT c.Nome, p.idPedido, s.Descricao FROM Cliente c
INNER JOIN Pedido p ON c.idCliente = p.Cliente_idCliente
INNER JOIN Status s ON p.Status_idStatus = s.idStatus WHERE s.idStatus = 2"""
COMMA = """SELECT c.Nome, p.idPedido, s.Descricao FROM Cliente c, Status s, Pedido p
WHERE c.idCliente = p.Cliente_idCliente AND p.Status_idStatus = s.idStatus AND s.idStatus = 2"""


class OptimizerTests(unittest.TestCase):
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

    def check_query(self, sql):
        result = process_query(sql)
        optimized = result["optimization"]
        self.assertTrue(optimized["equivalentResults"])
        expected = Counter(self.db.execute(sql).fetchall())
        self.assertEqual(Counter(map(tuple, result["result"]["rows"])), expected)
        self.assertEqual(Counter(map(tuple, optimized["result"]["rows"])), expected)
        self.assertEqual(result["result"]["columns"], optimized["result"]["columns"])
        for graph, plan in [(result["graph"], result["plan"]), (optimized["graph"], optimized["plan"])]:
            nodes = {n["id"]: n for n in graph["nodes"]}
            order = {step["nodeId"]: i for i, step in enumerate(plan["steps"])}
            self.assertEqual(len(nodes), len(graph["nodes"]))
            self.assertEqual(len(order), len(plan["steps"]))
            self.assertEqual(set(nodes), set(order))
            self.assertEqual(len(graph["edges"]), len(nodes) - 1)
            self.assertIsNone(nodes[graph["rootId"]]["parentId"])
            expected_edges, reached = set(), set()

            def visit(node_id):
                self.assertNotIn(node_id, reached)
                reached.add(node_id)
                node = nodes[node_id]
                available = set()
                for child in node["children"]:
                    self.assertEqual(nodes[child]["parentId"], node_id)
                    self.assertLess(order[child], order[node_id])
                    expected_edges.add((child, node_id))
                    available.update(nodes[child]["outputColumns"])
                    visit(child)
                if node.get("condition"):
                    used = {r["key"] for p in comparisons(node["condition"]) for r in references(p)}
                    self.assertLessEqual(used, available)
                if node["type"] == "project":
                    self.assertLessEqual(set(node["outputColumns"]), available)

            visit(graph["rootId"])
            self.assertEqual(reached, set(nodes))
            self.assertEqual(expected_edges, {(e["source"], e["target"]) for e in graph["edges"]})
            self.assertEqual(set(graph["leaves"]), {k for k, n in nodes.items() if not n["children"]})
            for edge in graph["edges"]:
                self.assertEqual(edge["tuplesCount"], nodes[edge["source"]]["tuplesCount"])
            for step in plan["steps"]:
                self.assertEqual(step["rowsProduced"], nodes[step["nodeId"]]["tuplesCount"])
        # Cada ocorrência original de predicado deve aparecer exatamente em um operador.
        allocated = [p["id"] for n in optimized["graph"]["nodes"] for p in n.get("predicates", [])]
        self.assertEqual(sorted(allocated), list(range(len(optimized["predicateAssignments"]))))
        for node in optimized["graph"]["nodes"]:
            if node.get("condition"):
                for condition in comparisons(node["condition"]):
                    for style in ("unicode", "ascii", "latex"):
                        self.assertIn(format_condition(condition, style), optimized["algebra"][style])
        return result

    def test_three_table_order_and_actual_cardinalities(self):
        result = self.check_query(INNER)
        opt = result["optimization"]
        self.assertEqual(opt["heuristics"]["joinOrdering"]["optimizedOrder"], ["s", "p", "c"])
        self.assertEqual([n["alias"] for n in result["graph"]["nodes"] if n["type"] == "scan"], ["c", "p", "s"])
        self.assertEqual([s["rowsProduced"] for s in opt["plan"]["steps"] if s["type"] == "join"], [2, 2])

    def test_four_table_order(self):
        result = self.check_query("""SELECT c.Nome,p.idPedido,t.Descricao FROM Cliente c
        INNER JOIN TipoCliente t ON c.TipoCliente_idTipoCliente=t.idTipoCliente
        INNER JOIN Pedido p ON c.idCliente=p.Cliente_idCliente
        INNER JOIN Status s ON p.Status_idStatus=s.idStatus WHERE s.idStatus=2""")
        self.assertEqual(result["optimization"]["heuristics"]["joinOrdering"]["optimizedOrder"], ["s", "p", "c", "t"])

    def test_connected_permutations_three_and_four_tables(self):
        for tables, predicates in [
            (["Cliente c", "Status s", "Pedido p"], "c.idCliente=p.Cliente_idCliente AND p.Status_idStatus=s.idStatus"),
            (["Cliente c", "Status s", "Pedido p", "TipoCliente t"], "c.idCliente=p.Cliente_idCliente AND p.Status_idStatus=s.idStatus AND c.TipoCliente_idTipoCliente=t.idTipoCliente"),
        ]:
            for order in permutations(tables):
                for extra in ("", " AND s.idStatus=2"):
                    sql = "SELECT c.Nome,p.idPedido,s.Descricao FROM " + ",".join(order) + " WHERE " + predicates + extra
                    with self.subTest(sql=sql):
                        result = self.check_query(sql)
                        self.assertFalse(any(n["type"] == "product" for n in result["optimization"]["graph"]["nodes"]))

    def test_required_cartesian_elimination(self):
        result = self.check_query(COMMA)
        self.assertEqual(result["optimization"]["heuristics"]["cartesianAvoidance"], {"canonicalProducts": 2, "optimizedProducts": 0})

    def test_more_restrictive_connected_extension_wins(self):
        result = self.check_query("""SELECT c.Descricao,p.Nome,s.Descricao
        FROM Categoria c,Produto p,Status s
        WHERE c.idCategoria=p.Categoria_idCategoria AND c.idCategoria=s.idStatus AND c.idCategoria=1""")
        order = result["optimization"]["heuristics"]["joinOrdering"]
        self.assertEqual(order["optimizedOrder"], ["c", "s", "p"])
        self.assertEqual(order["decisions"][0]["estimatedRows"], 1)

    def test_disconnected_components_preserve_product(self):
        for sql in ["SELECT p.Nome,s.Descricao FROM Produto p,Status s",
                    "SELECT p.Nome,c.Descricao,s.Descricao FROM Produto p,Status s,Categoria c WHERE p.Categoria_idCategoria=c.idCategoria"]:
            with self.subTest(sql=sql):
                result = self.check_query(sql)
                self.assertEqual(sum(n["type"] == "product" for n in result["optimization"]["graph"]["nodes"]), 1)

    def test_on_unary_filters_and_origin(self):
        result = self.check_query("""SELECT p.Nome,c.Descricao FROM Produto p INNER JOIN Categoria c
        ON p.Categoria_idCategoria=c.idCategoria AND p.Preco>200 AND c.idCategoria=1""")
        items = result["optimization"]["heuristics"]["tupleReduction"]["items"]
        self.assertEqual({i["alias"] for i in items}, {"p", "c"})
        self.assertTrue(all(p["origin"] == "ON" for i in items for p in i["predicates"]))
        self.assertEqual(result["result"]["rowCount"], 3)

    def test_multiple_join_conditions_in_all_formats(self):
        result = self.check_query("""SELECT p.Nome,c.Descricao FROM Produto p,Categoria c
        WHERE p.Categoria_idCategoria=c.idCategoria AND p.idProduto>c.idCategoria""")
        join = next(n for n in result["optimization"]["graph"]["nodes"] if n["type"] == "join")
        self.assertEqual(len(comparisons(join["condition"])), 2)
        self.assertEqual(result["result"]["rowCount"], 7)

    def test_residual_constant_in_graph_and_algebra(self):
        result = self.check_query("SELECT p.Nome FROM Produto p WHERE 1=0")
        opt = result["optimization"]
        residual = next(n for n in opt["graph"]["nodes"] if n["id"] == "opt_select_remaining")
        self.assertEqual(residual["tuplesCount"], 0)
        for style, symbol in [("unicode", "σ"), ("ascii", "SIGMA"), ("latex", "\\sigma")]:
            self.assertIn(symbol, opt["algebra"][style])
            self.assertIn("1 = 0", opt["algebra"][style])
        self.assertEqual(algebra_from_graph(opt["graph"]), opt["algebra"])

    def test_self_join_aliases(self):
        self.check_query("""SELECT a.Nome,b.Nome FROM Produto a,Produto b
        WHERE a.Categoria_idCategoria=b.Categoria_idCategoria AND a.idProduto<b.idProduto AND b.Preco>200""")

    def test_empty_relation_and_null(self):
        for where in ["p.Preco<0", "p.Descricao=NULL"]:
            result = self.check_query("SELECT p.Nome,c.Descricao FROM Produto p,Categoria c WHERE p.Categoria_idCategoria=c.idCategoria AND " + where)
            self.assertEqual(result["optimization"]["result"]["rowCount"], 0)

    def test_stars_and_projection_dependencies(self):
        for columns in ["*", "p.*,c.Descricao", "p.Nome", "c.*,p.Nome,p.Nome"]:
            self.check_query("SELECT " + columns + " FROM Produto p,Categoria c WHERE p.Categoria_idCategoria=c.idCategoria AND p.Preco>200")

    def test_duplicates_are_preserved(self):
        result = self.check_query("SELECT c.Descricao FROM Produto p,Categoria c WHERE p.Categoria_idCategoria=c.idCategoria")
        self.assertEqual(result["optimization"]["result"]["rowCount"], 8)
        self.assertEqual(Counter(map(tuple, result["optimization"]["result"]["rows"])).most_common(1)[0][1], 4)

    def test_canonical_structures_are_unchanged(self):
        result = process_query(INNER)
        before = deepcopy(result)
        build_optimized_plan(result["query"], result["algebra"], result["graph"], result["plan"])
        self.assertEqual(result, before)

    def test_signed_metrics_do_not_hide_increases(self):
        result = self.check_query("SELECT p.Nome,s.Descricao FROM Produto p,Status s")
        m = result["optimization"]["metrics"]
        self.assertLess(m["savedTuples"], 0)
        self.assertLess(m["tupleReductionPercent"], 0)
        self.assertEqual(m["savedTuples"], m["canonicalIntermediateTuples"] - m["optimizedIntermediateTuples"])
        self.assertIn("Não mede RAM nem tempo", m["definition"])

    def test_deterministic_ties_and_repeated_predicates(self):
        sql = "SELECT a.Nome,b.Nome FROM Produto a,Produto b WHERE a.idProduto=b.idProduto AND a.idProduto=b.idProduto"
        result = self.check_query(sql)
        self.assertEqual(result, process_query(sql))
        self.assertEqual(result["optimization"]["heuristics"]["joinOrdering"]["optimizedOrder"], ["a", "b"])
