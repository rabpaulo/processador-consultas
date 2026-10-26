"""Conversão de consultas SQL validadas para Álgebra Relacional."""


def format_operand(operand, style="unicode"):
    if operand["type"] == "column":
        return operand["key"]
    value = operand["value"]
    if value is None:
        return "\\text{NULL}" if style == "latex" else "NULL"
    if isinstance(value, bool):
        val_str = "TRUE" if value else "FALSE"
        return f"\\text{{{val_str}}}" if style == "latex" else val_str
    if isinstance(value, str):
        escaped = value.replace("'", "''")
        return f"\\text{{'{escaped}'}}" if style == "latex" else f"'{escaped}'"
    return str(value)


def format_condition(condition, style="unicode"):
    if not condition:
        return ""
    if condition["type"] == "and":
        left = format_condition(condition["left"], style)
        right = format_condition(condition["right"], style)
        if style == "latex":
            return f"{left} \\land {right}"
        if style == "unicode":
            return f"{left} ∧ {right}"
        return f"{left} AND {right}"
    if condition["type"] == "comparison":
        left = format_operand(condition["left"], style)
        right = format_operand(condition["right"], style)
        op = condition["operator"]
        if style == "latex":
            op_map = {"=": "=", "<>": "\\neq", "<=": "\\le", ">=": "\\ge", "<": "<", ">": ">"}
            return f"{left} {op_map.get(op, op)} {right}"
        if style == "unicode":
            op_map = {"=": "=", "<>": "≠", "<=": "≤", ">=": "≥", "<": "<", ">": ">"}
            return f"{left} {op_map.get(op, op)} {right}"
        return f"{left} {op} {right}"
    return ""


def algebra_from_graph(graph):
    """Serializa os operadores efetivamente executados, inclusive filtros residuais."""
    node_map = {node["id"]: node for node in graph["nodes"]}

    def expression(node_id, style):
        node = node_map[node_id]
        if node["type"] == "scan":
            table, alias = node["table"], node["alias"]
            base = f"\\text{{{table}}}" if style == "latex" else table
            if alias != table:
                base += f" \\text{{ AS }} {alias}" if style == "latex" else f" AS {alias}"
            return base
        children = [expression(child, style) for child in node["children"]]
        if node["type"] in ("select", "project"):
            project = node["type"] == "project"
            text = ", ".join(node["outputColumns"]) if project else format_condition(node["condition"], style)
            if style == "latex":
                op = "\\pi" if project else "\\sigma"
                return f"{op}_{{{text}}}\\left( {children[0]} \\right)"
            op = ("π" if project else "σ") if style == "unicode" else ("PI" if project else "SIGMA")
            return f"{op}[{text}]({children[0]})"
        join = node["type"] == "join"
        text = format_condition(node.get("condition"), style)
        if style == "latex":
            op = f"\\bowtie_{{{text}}}" if join else "\\times"
            return f"\\left( {children[0]} {op} {children[1]} \\right)"
        op = ("⋈" if join else "×") if style == "unicode" else ("JOIN" if join else "CROSS")
        if join:
            op += f"[{text}]"
        return f"({children[0]} {op} {children[1]})"

    return {**{style: expression(graph["rootId"], style) for style in ("unicode", "ascii", "latex")},
            "columns": node_map[graph["rootId"]]["outputColumns"]}


def build_algebra(query):
    """Gera representações em texto, Unicode, LaTeX e árvore da álgebra relacional canônica."""
    tables = query["tables"]
    joins = query["joins"]
    where = query["where"]
    columns = [col["key"] for col in query["columns"]]
    cols_str = ", ".join(columns)

    # 1. Relação base inicial
    t0 = tables[0]
    has_alias0 = t0["alias"] != t0["table"]
    t0_name = f"{t0['table']} AS {t0['alias']}" if has_alias0 else t0["table"]

    rel_unicode = t0_name
    rel_latex = f"\\text{{{t0['table']}}}" + (f" \\text{{ AS }} {t0['alias']}" if has_alias0 else "")
    rel_ascii = t0_name

    rel_tree = {
        "type": "relation",
        "symbol": "▤",
        "name": t0["table"],
        "alias": t0["alias"],
        "label": t0_name,
    }

    # 2. Junções e Produtos Cartesianos
    for idx, join in enumerate(joins):
        t = tables[idx + 1]
        has_alias = t["alias"] != t["table"]
        t_name = f"{t['table']} AS {t['alias']}" if has_alias else t["table"]
        t_latex = f"\\text{{{t['table']}}}" + (f" \\text{{ AS }} {t['alias']}" if has_alias else "")

        right_tree = {
            "type": "relation",
            "symbol": "▤",
            "name": t["table"],
            "alias": t["alias"],
            "label": t_name,
        }

        if join["condition"]:
            cond_u = format_condition(join["condition"], "unicode")
            cond_l = format_condition(join["condition"], "latex")
            cond_a = format_condition(join["condition"], "ascii")

            rel_unicode = f"({rel_unicode} ⋈[{cond_u}] {t_name})"
            rel_latex = f"\\left( {rel_latex} \\bowtie_{{{cond_l}}} {t_latex} \\right)"
            rel_ascii = f"({rel_ascii} JOIN[{cond_a}] {t_name})"

            rel_tree = {
                "type": "join",
                "symbol": "⋈",
                "condition": cond_u,
                "conditionLatex": cond_l,
                "left": rel_tree,
                "right": right_tree,
            }
        else:
            rel_unicode = f"({rel_unicode} × {t_name})"
            rel_latex = f"\\left( {rel_latex} \\times {t_latex} \\right)"
            rel_ascii = f"({rel_ascii} CROSS {t_name})"

            rel_tree = {
                "type": "product",
                "symbol": "×",
                "left": rel_tree,
                "right": right_tree,
            }

    # 3. Seleção (WHERE)
    if where:
        where_u = format_condition(where, "unicode")
        where_l = format_condition(where, "latex")
        where_a = format_condition(where, "ascii")

        sel_unicode = f"σ[{where_u}]({rel_unicode})"
        sel_latex = f"\\sigma_{{{where_l}}}\\left( {rel_latex} \\right)"
        sel_ascii = f"SIGMA[{where_a}]({rel_ascii})"

        tree_after_select = {
            "type": "select",
            "symbol": "σ",
            "predicate": where_u,
            "predicateLatex": where_l,
            "child": rel_tree,
        }
    else:
        sel_unicode = rel_unicode
        sel_latex = rel_latex
        sel_ascii = rel_ascii
        tree_after_select = rel_tree

    # 4. Projeção (SELECT)
    full_unicode = f"π[{cols_str}]({sel_unicode})"
    full_latex = f"\\pi_{{{cols_str}}}\\left( {sel_latex} \\right)"
    full_ascii = f"PI[{cols_str}]({sel_ascii})"

    root_tree = {
        "type": "project",
        "symbol": "π",
        "columns": columns,
        "child": tree_after_select,
    }

    return {
        "unicode": full_unicode,
        "latex": full_latex,
        "ascii": full_ascii,
        "tree": root_tree,
        "columns": columns,
        "hasWhere": bool(where),
        "joinCount": len(joins),
        "tableCount": len(tables),
    }
