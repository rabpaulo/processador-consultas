"""Entrega 1: análise sintática e validação semântica, em Python."""

from .parser import comparisons, parse, predicate_text, validate


def process_query(sql):
    """Resolve a consulta sem construir planos nem executar seus operadores."""
    query = validate(parse(sql))
    predicates = [predicate for join in query["joins"] for predicate in comparisons(join["condition"])] + comparisons(query["where"])
    query["predicateLabels"] = [predicate_text(predicate) for predicate in predicates]
    return {"query": query, "backend": "Python"}
