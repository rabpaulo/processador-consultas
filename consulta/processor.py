"""Processador de consultas SQL: AST, validação, álgebra relacional,
grafo canônico e otimização heurística de seleção, projeção e junções (27/10/2026).
"""

from collections import Counter

from .algebra import build_algebra
from .executor import execute_plan
from .optimizer import build_optimized_plan
from .parser import comparisons, parse, predicate_text, validate
from .planner import build_plan


def process_query(sql):
    """Processa a consulta SQL gerando AST, álgebra relacional canônica, grafo canônico,
    plano de execução e aplicando as heurísticas de push-down de seleção e projeção.
    """
    query = validate(parse(sql))
    predicates = [predicate for join in query["joins"] for predicate in comparisons(join["condition"])] + comparisons(query["where"])
    query["predicateLabels"] = [predicate_text(predicate) for predicate in predicates]
    query["wherePredicateLabels"] = [predicate_text(p) for p in comparisons(query["where"])]
    query["onPredicateLabels"] = [predicate_text(p) for join in query["joins"] for p in comparisons(join["condition"])]

    algebra = build_algebra(query)
    graph, plan = build_plan(query, algebra)
    result = execute_plan(query, graph, plan)
    optimization = build_optimized_plan(query, algebra, graph, plan)
    optimization["equivalentResults"] = (
        result["columns"] == optimization["result"]["columns"]
        and Counter(map(tuple, result["rows"])) == Counter(map(tuple, optimization["result"]["rows"]))
    )

    return {
        "query": query,
        "algebra": algebra,
        "graph": graph,
        "plan": plan,
        "result": result,
        "optimization": optimization,
        "backend": "Python",
    }
