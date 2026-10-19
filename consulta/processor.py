"""Entrega 2: análise sintática, validação semântica, álgebra relacional, grafo de operadores e plano."""

from .algebra import build_algebra
from .executor import execute_plan
from .parser import comparisons, parse, predicate_text, validate
from .planner import build_plan


def process_query(sql):
    """Processa a consulta SQL gerando AST, álgebra relacional, grafo não otimizado e ordem de execução."""
    query = validate(parse(sql))
    predicates = [predicate for join in query["joins"] for predicate in comparisons(join["condition"])] + comparisons(query["where"])
    query["predicateLabels"] = [predicate_text(predicate) for predicate in predicates]

    algebra = build_algebra(query)
    graph, plan = build_plan(query, algebra)
    result = execute_plan(query, graph, plan)

    return {
        "query": query,
        "algebra": algebra,
        "graph": graph,
        "plan": plan,
        "result": result,
        "backend": "Python",
    }
