import unittest

from consulta.parser import QueryError, parse, validate
from consulta.processor import process_query
from consulta.schema import EXAMPLES, SAMPLE_DATA, SCHEMA


def query(sql):
    return validate(parse(sql))


class ProcessorTests(unittest.TestCase):
    def test_catalog_and_sample_fields(self):
        self.assertEqual(len(SCHEMA), 10)
        for table, columns in SCHEMA.items():
            for row in SAMPLE_DATA[table]:
                self.assertEqual(list(row), columns)
        self.assertIn("Cliente_idCliente", SCHEMA["Endereco"])
        self.assertIn("PrecoUnitario", SCHEMA["Pedido_has_Produto"])

    def test_parser_aliases_groups_and_operators(self):
        parsed = query("select p.Nome from Produto p where (p.Preco >= 200 and (p.Preco <= 1000 AND p.Nome <> 'Fone')); -- fim")
        self.assertEqual(parsed["columns"][0]["key"], "p.Nome")
        self.assertEqual(parsed["where"]["type"], "and")
        self.assertEqual(parsed["tables"][0]["table"], "Produto")
        self.assertGreater(len(parsed["tokens"]), 20)

    def test_invalid_tables_fields_aliases_and_scopes(self):
        cases = [
            ("SELECT Nome FROM Fantasma", "Tabela inexistente"),
            ("SELECT Valor FROM Produto", "Campo inexistente"),
            ("SELECT Nome FROM Produto p, Cliente c", "ambíguo"),
            ("SELECT p.Nome FROM Produto p, Categoria p", "Alias repetido"),
            ("SELECT Produto.Nome FROM Produto p", "fora do escopo"),
            ("SELECT z.* FROM Produto p", "alias inexistente"),
            ("SELECT p.Nome FROM Produto p INNER JOIN Categoria c ON z.idStatus = c.idCategoria INNER JOIN Status z ON z.idStatus = c.idCategoria", "fora do escopo"),
        ]
        for sql, message in cases:
            with self.subTest(sql=sql), self.assertRaisesRegex(QueryError, message):
                query(sql)

    def test_rejects_unsupported_syntax_with_position(self):
        cases = ["", "DELETE FROM Produto", "SELECT Nome FROM Produto; DROP TABLE Produto", "SELECT Nome FROM Produto WHERE Preco != 1", "SELECT Nome FROM Produto WHERE Preco > 1 OR Preco < 2", "SELECT Nome FROM Produto WHERE (Preco > 1", "SELECT Nome FROM Produto WHERE Nome = 'ab", "SELECT SUM(Preco) FROM Produto", "SELECT Nome FROM Produto ORDER BY Nome", "SELECT Nome FROM Produto INNER JOIN Categoria", "SELECT Nome, FROM Produto", "SELECT Nome FROM Produto WHERE Preco > 1 AND", "SELECT Nome FROM Produto LIMIT 1"]
        for sql in cases:
            with self.subTest(sql=sql), self.assertRaises(QueryError) as caught:
                query(sql)
            self.assertIsInstance(caught.exception.position, int)

    def test_depth_and_query_length_limits(self):
        with self.assertRaisesRegex(QueryError, "parênteses"):
            parse("SELECT Nome FROM Produto WHERE " + "(" * 101 + "1 = 1" + ")" * 101)
        with self.assertRaisesRegex(QueryError, "20.000"):
            parse(" " * 20001)

    def test_query_structure_and_predicate_labels(self):
        result = process_query("SELECT p.Nome FROM Produto p WHERE p.Preco > 200")
        self.assertEqual(result["query"]["columns"][0]["key"], "p.Nome")
        self.assertEqual(result["query"]["predicateLabels"], ["p.Preco > 200"])
        self.assertEqual(result["backend"], "Python")
        self.assertNotIn("optimizedResult", result)

    def test_supported_catalog_examples(self):
        for example in EXAMPLES[:4]:
            with self.subTest(example=example["name"]):
                self.assertTrue(process_query(example["sql"])["query"]["tokens"])

    def test_star_and_duplicate_output_columns(self):
        result = process_query("SELECT c.*, p.Nome, p.Nome FROM Categoria c INNER JOIN Produto p ON c.idCategoria = p.Categoria_idCategoria")
        self.assertEqual([column["key"] for column in result["query"]["columns"]], ["c.idCategoria", "c.Descricao", "p.Nome", "p.Nome"])

    def test_first_delivery_does_not_build_a_plan(self):
        result = process_query("SELECT Nome FROM Produto")
        self.assertEqual(set(result), {"query", "backend"})

    def test_audit_fixes_parser(self):
        # 1. Inteiro longo (> 4300 dígitos) não causa crash 500 nem ValueError
        with self.assertRaisesRegex(QueryError, "fora do intervalo"):
            parse("SELECT Nome FROM Produto WHERE idProduto = " + "9" * 4500)

        # 2. Literais booleanos TRUE e FALSE
        res_bool = query("SELECT Nome FROM Produto WHERE 1 = TRUE AND 0 = FALSE")
        self.assertEqual(res_bool["columns"][0]["key"], "Produto.Nome")

        # 3. Notação científica no NUMBER
        res_sci = query("SELECT Nome FROM Produto WHERE Preco > 1e2")
        self.assertEqual(res_sci["tokens"][7]["type"], "number")
        self.assertEqual(res_sci["tokens"][7]["value"], 100)

        # 4. NATURAL em RESERVED rejeitado como trecho não suportado
        with self.assertRaisesRegex(QueryError, "não suportado: NATURAL"):
            query("SELECT * FROM Produto NATURAL JOIN Categoria")

        # 5. Posição de erro em campo qualificado inexistente aponta exatamente para a coluna
        sql = "SELECT p.Inexistente FROM Produto p"
        with self.assertRaises(QueryError) as ctx:
            query(sql)
        self.assertEqual(ctx.exception.position, sql.index("Inexistente"))
