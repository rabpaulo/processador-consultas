"""Mecanismo de execução em memória do plano de operadores sobre SAMPLE_DATA."""

from .schema import SAMPLE_DATA


def eval_operand(operand, row):
    if operand["type"] == "column":
        key = operand.get("key")
        if key in row:
            return row[key]
        name = operand.get("name")
        if name in row:
            return row[name]
        return None
    return operand.get("value")


def eval_condition(condition, row):
    if not condition:
        return True
    if condition["type"] == "and":
        return eval_condition(condition["left"], row) and eval_condition(condition["right"], row)
    if condition["type"] == "comparison":
        left_val = eval_operand(condition["left"], row)
        right_val = eval_operand(condition["right"], row)

        # Em SQL clássico de 3 valores, comparações com NULL resultam em False
        if left_val is None or right_val is None:
            return False

        op = condition["operator"]
        try:
            if op == "=":
                return left_val == right_val
            if op == "<>":
                return left_val != right_val
            if op == "<":
                return left_val < right_val
            if op == "<=":
                return left_val <= right_val
            if op == ">":
                return left_val > right_val
            if op == ">=":
                return left_val >= right_val
        except TypeError:
            # Tipos incompatíveis (ex: comparar número com string)
            return False
    return False


def execute_plan(query, graph, plan, *, result_multiset=None):
    """Executa o plano canônico de operadores sobre o catálogo didático
    e enriquece o grafo e passos com a contagem real de tuplas intermediárias.
    """
    node_map = {n["id"]: n for n in graph["nodes"]}
    step_map = {s["nodeId"]: s for s in plan["steps"]}
    intermediate = {}

    # 1. Executa Scans (Varreduras)
    for leaf_id in graph["leaves"]:
        node = node_map[leaf_id]
        tbl_name = node["table"]
        alias = node["alias"]
        raw_rows = SAMPLE_DATA.get(tbl_name, [])

        rows = []
        for r in raw_rows:
            row_dict = {}
            for col_name, val in r.items():
                row_dict[f"{alias}.{col_name}"] = val
                row_dict[col_name] = val
            rows.append(row_dict)

        intermediate[leaf_id] = rows
        node["tuplesCount"] = len(rows)
        if leaf_id in step_map:
            step_map[leaf_id]["rowsProduced"] = len(rows)

    # 2. Executa Junções e Produtos Cartesianos
    joins = query["joins"]
    for idx, join in enumerate(joins):
        node_id = f"join_{idx + 1}" if join["condition"] else f"product_{idx + 1}"
        node = node_map[node_id]
        left_id, right_id = node["children"]
        left_rows = intermediate[left_id]
        right_rows = intermediate[right_id]

        combined = []
        if join["condition"]:
            cond = join["condition"]
            for r_left in left_rows:
                for r_right in right_rows:
                    merged = {**r_left, **r_right}
                    if eval_condition(cond, merged):
                        combined.append(merged)
        else:
            for r_left in left_rows:
                for r_right in right_rows:
                    combined.append({**r_left, **r_right})

        intermediate[node_id] = combined
        node["tuplesCount"] = len(combined)
        if node_id in step_map:
            step_map[node_id]["rowsProduced"] = len(combined)

    # 3. Executa Seleção (se houver WHERE)
    if query["where"]:
        sel_node = node_map["select_1"]
        child_id = sel_node["children"][0]
        input_rows = intermediate[child_id]
        filtered = [r for r in input_rows if eval_condition(query["where"], r)]
        intermediate["select_1"] = filtered
        sel_node["tuplesCount"] = len(filtered)
        if "select_1" in step_map:
            step_map["select_1"]["rowsProduced"] = len(filtered)

    # 4. Executa Projeção (SELECT)
    proj_node = node_map["project_1"]
    child_id = proj_node["children"][0]
    input_rows = intermediate[child_id]
    proj_keys = [c["key"] for c in query["columns"]]

    result_rows = []
    for r in input_rows:
        row_tuple = [r.get(k) for k in proj_keys]
        result_rows.append(row_tuple)

    intermediate["project_1"] = result_rows
    proj_node["tuplesCount"] = len(result_rows)
    if "project_1" in step_map:
        step_map["project_1"]["rowsProduced"] = len(result_rows)

    # Compara resultados completos sem expô-los na resposta nem reexecutar o plano.
    if result_multiset is not None:
        result_multiset.update(map(tuple, result_rows))
    row_count_before_limit = len(result_rows)
    if query.get("limit") is not None:
        limit_node = node_map[graph["rootId"]]
        result_rows = result_rows[:limit_node["limit"]]
        limit_node["tuplesCount"] = len(result_rows)
        step_map[limit_node["id"]]["rowsProduced"] = len(result_rows)

    # 5. Atualiza fluxo nas arestas do grafo
    for edge in graph["edges"]:
        source_id = edge["source"]
        edge["tuplesCount"] = node_map[source_id].get("tuplesCount", 0)

    return {
        "columns": proj_keys,
        "rows": result_rows,
        "rowCount": len(result_rows),
        "rowCountBeforeLimit": row_count_before_limit,
        "hasData": len(result_rows) > 0,
    }
