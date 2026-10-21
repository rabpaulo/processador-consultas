"""Heurísticas de Otimização de Consultas: Redução de Tuplas (Push-Down de Seleção)
e Redução de Atributos (Push-Down de Projeção) — Entrega 3 (22/10/2026).
"""

from .algebra import format_condition, format_operand
from .executor import eval_condition
from .schema import SAMPLE_DATA, SCHEMA


def _extract_conjuncts(condition):
    """Extrai recursivamente todos os predicados elementares ligados por AND."""
    if not condition:
        return []
    if condition["type"] == "and":
        return _extract_conjuncts(condition["left"]) + _extract_conjuncts(condition["right"])
    if condition["type"] == "comparison":
        return [condition]
    return []


def _get_referenced_aliases(condition):
    """Retorna os aliases de tabelas referenciados em uma condição."""
    if not condition:
        return set()
    aliases = set()

    def _walk(operand):
        if not operand or operand.get("type") != "column":
            return
        if "table" in operand and operand["table"]:
            aliases.add(operand["table"])
        elif "key" in operand and "." in operand["key"]:
            aliases.add(operand["key"].split(".", 1)[0])

    if condition["type"] == "and":
        aliases.update(_get_referenced_aliases(condition["left"]))
        aliases.update(_get_referenced_aliases(condition["right"]))
    elif condition["type"] == "comparison":
        _walk(condition.get("left"))
        _walk(condition.get("right"))
    return aliases


def _get_referenced_columns(condition):
    """Retorna o conjunto de chaves qualificadas (alias.coluna) referenciadas."""
    if not condition:
        return set()
    cols = set()

    def _collect(op):
        if op and op.get("type") == "column":
            if "key" in op and op["key"]:
                cols.add(op["key"])

    if condition["type"] == "and":
        cols.update(_get_referenced_columns(condition["left"]))
        cols.update(_get_referenced_columns(condition["right"]))
    elif condition["type"] == "comparison":
        _collect(condition.get("left"))
        _collect(condition.get("right"))
    return cols


def _combine_conditions(conditions):
    """Combina uma lista de condições com AND."""
    if not conditions:
        return None
    curr = conditions[0]
    for nxt in conditions[1:]:
        curr = {
            "type": "and",
            "left": curr,
            "right": nxt,
        }
    return curr


def build_optimized_plan(query, canonical_algebra, canonical_graph, canonical_plan):
    """Aplica as heurísticas de Seleção (Redução de Tuplas) e Projeção (Redução de Atributos)
    gerando o grafo otimizado, plano de execução correspondente e álgebra relacional otimizada.
    """
    tables = query["tables"]
    joins = query["joins"]
    where = query["where"]
    columns = query["columns"]
    proj_keys = [c["key"] for c in columns]

    table_by_alias = {t["alias"]: t["table"] for t in tables}
    where_conjuncts = _extract_conjuncts(where)

    # 1. Separação de predicados do WHERE em unários (push-down de seleção) e de junção
    unary_by_alias = {t["alias"]: [] for t in tables}
    multi_table_conjuncts = []

    for conj in where_conjuncts:
        aliases = _get_referenced_aliases(conj)
        if len(aliases) == 1:
            alias = next(iter(aliases))
            if alias in unary_by_alias:
                unary_by_alias[alias].append(conj)
            else:
                multi_table_conjuncts.append(conj)
        elif len(aliases) == 0:
            # Condição sem referências a colunas (ex: 1 = 1) - atribui à primeira tabela
            unary_by_alias[tables[0]["alias"]].append(conj)
        else:
            multi_table_conjuncts.append(conj)

    # 2. Heurística 5.b.ii: Evitar produto cartesiano convertendo condições de WHERE entre tabelas em INNER JOIN
    optimized_joins = []
    used_multi_conjuncts = set()

    for idx, join in enumerate(joins):
        right_table = tables[idx + 1]
        right_alias = right_table["alias"]
        left_aliases = {t["alias"] for t in tables[:idx + 1]}

        cond = join["condition"]
        if cond is None:
            # Produto cartesiano no FROM: busca se no WHERE há predicado entre left_aliases e right_alias
            for conj_idx, conj in enumerate(multi_table_conjuncts):
                if conj_idx in used_multi_conjuncts:
                    continue
                conj_aliases = _get_referenced_aliases(conj)
                if right_alias in conj_aliases and (conj_aliases - {right_alias}).issubset(left_aliases):
                    cond = conj
                    used_multi_conjuncts.add(conj_idx)
                    break

        optimized_joins.append({
            "rightTable": right_table,
            "condition": cond,
            "wasCartesian": join["condition"] is None and cond is not None,
        })

    remaining_where_conjuncts = [c for i, c in enumerate(multi_table_conjuncts) if i not in used_multi_conjuncts]

    # 3. Análise de atributos necessários para a Heurística de Redução de Atributos (Push-Down de Projeção)
    cols_in_select = set(proj_keys)
    cols_in_joins = set()
    for oj in optimized_joins:
        if oj["condition"]:
            cols_in_joins.update(_get_referenced_columns(oj["condition"]))
    cols_in_remaining_where = set()
    for rw in remaining_where_conjuncts:
        cols_in_remaining_where.update(_get_referenced_columns(rw))

    future_needed_cols = cols_in_select | cols_in_joins | cols_in_remaining_where

    # 4. Construção dos nós folha com Push-Down de Seleção e Push-Down de Projeção
    nodes = []
    edges = []
    node_map = {}
    leaf_heads = {}
    leaf_scan_nodes = []
    applied_selections = []
    applied_projections = []

    for t in tables:
        table_name = t["table"]
        alias = t["alias"]
        has_alias = alias != table_name
        label = f"{table_name} AS {alias}" if has_alias else table_name
        schema_cols = [f"{alias}.{c}" for c in SCHEMA.get(table_name, [])]
        initial_tuples = len(SAMPLE_DATA.get(table_name, []))

        # 4.1 Nó Scan
        scan_id = f"opt_scan_{alias}"
        scan_node = {
            "id": scan_id,
            "type": "scan",
            "symbol": "▤",
            "name": "Varredura Sequencial",
            "label": label,
            "table": table_name,
            "alias": alias,
            "predicate": None,
            "details": f"Leitura em disco da relação base '{table_name}'",
            "outputColumns": schema_cols,
            "children": [],
            "parentId": None,
            "tuplesCount": initial_tuples,
            "heuristic": None,
        }
        nodes.append(scan_node)
        node_map[scan_id] = scan_node
        leaf_scan_nodes.append(scan_node)
        curr_head = scan_node

        # 4.2 Heurística 1: Redução de Tuplas (Push-Down de Seleção)
        unary_preds = unary_by_alias.get(alias, [])
        if unary_preds:
            combined_cond = _combine_conditions(unary_preds)
            pred_text = format_condition(combined_cond, "unicode")
            sel_id = f"opt_sel_{alias}"
            sel_node = {
                "id": sel_id,
                "type": "select",
                "symbol": "σ",
                "name": "Seleção Antecipada",
                "label": f"σ [{pred_text}]",
                "predicate": pred_text,
                "condition": combined_cond,
                "heuristic": "tuple_reduction",
                "heuristicLabel": "Redução de Tuplas (Push-down σ)",
                "details": f"Heurística de Redução de Tuplas: filtra tuplas de '{alias}' antes de junções/produtos.",
                "outputColumns": list(curr_head["outputColumns"]),
                "children": [curr_head["id"]],
                "parentId": None,
                "tuplesCount": 0,
            }
            curr_head["parentId"] = sel_id
            nodes.append(sel_node)
            node_map[sel_id] = sel_node

            edges.append({
                "id": f"opt_edge_{curr_head['id']}_{sel_id}",
                "source": curr_head["id"],
                "target": sel_id,
                "label": "Push-down de Seleção",
                "heuristic": "tuple_reduction",
            })
            curr_head = sel_node
            applied_selections.append({
                "table": table_name,
                "alias": alias,
                "predicate": pred_text,
                "initialTuples": initial_tuples,
            })

        # 4.3 Heurística 2: Redução de Atributos (Push-Down de Projeção)
        # Mantém apenas os atributos da relação que são necessários no SELECT ou nas junções
        needed_for_alias = [c for c in schema_cols if c in future_needed_cols]
        # Se nenhum atributo for necessário diretamente (caso raro), retém a chave primária
        if not needed_for_alias and schema_cols:
            needed_for_alias = [schema_cols[0]]

        discarded_for_alias = [c for c in schema_cols if c not in needed_for_alias]

        # Aplica a projeção antecipada antes das junções quando houver múltiplas tabelas e colunas a descartar
        # Em consultas unárias (1 tabela), a projeção final na raiz já realiza a restrição de atributos
        if len(tables) > 1 and len(discarded_for_alias) > 0:
            proj_id = f"opt_proj_early_{alias}"
            proj_node = {
                "id": proj_id,
                "type": "project",
                "symbol": "π",
                "name": "Projeção Antecipada",
                "label": f"π [{', '.join(needed_for_alias)}]",
                "predicate": None,
                "attributes": needed_for_alias,
                "discardedAttributes": discarded_for_alias,
                "heuristic": "attribute_reduction",
                "heuristicLabel": "Redução de Atributos (Push-down π)",
                "details": f"Heurística de Redução de Atributos: descarta {len(discarded_for_alias)} atributo(s) [{', '.join(discarded_for_alias)}] para estreitar as tuplas antes da junção.",
                "outputColumns": needed_for_alias,
                "children": [curr_head["id"]],
                "parentId": None,
                "tuplesCount": 0,
            }
            curr_head["parentId"] = proj_id
            nodes.append(proj_node)
            node_map[proj_id] = proj_node

            edges.append({
                "id": f"opt_edge_{curr_head['id']}_{proj_id}",
                "source": curr_head["id"],
                "target": proj_id,
                "label": f"-{len(discarded_for_alias)} colunas descartadas",
                "heuristic": "attribute_reduction",
            })
            curr_head = proj_node
            applied_projections.append({
                "table": table_name,
                "alias": alias,
                "kept": needed_for_alias,
                "discarded": discarded_for_alias,
                "columnsBefore": len(schema_cols),
                "columnsAfter": len(needed_for_alias),
            })
        elif len(tables) == 1 and len(discarded_for_alias) > 0:
            # Em unária, anota a redução realizada pela projeção
            applied_projections.append({
                "table": table_name,
                "alias": alias,
                "kept": needed_for_alias,
                "discarded": discarded_for_alias,
                "columnsBefore": len(schema_cols),
                "columnsAfter": len(needed_for_alias),
            })

        leaf_heads[alias] = curr_head

    # 5. Combinação das Relações (Junções e Produtos Cartesianos Otimizados)
    curr_combined = leaf_heads[tables[0]["alias"]]

    for idx, opt_join in enumerate(optimized_joins):
        right_alias = opt_join["rightTable"]["alias"]
        right_head = leaf_heads[right_alias]
        next_cols = curr_combined["outputColumns"] + right_head["outputColumns"]

        if opt_join["condition"]:
            cond_text = format_condition(opt_join["condition"], "unicode")
            join_id = f"opt_join_{idx + 1}"
            join_name = "Junção Otimizada" if opt_join["wasCartesian"] else "Junção (Inner Join)"
            join_heuristic = "cartesian_avoided" if opt_join["wasCartesian"] else None
            join_details = (
                f"Conversão de produto cartesiano em Junção sob o predicado WHERE: {cond_text}"
                if opt_join["wasCartesian"]
                else f"Junção interna entre relações reduzidas: {cond_text}"
            )

            node = {
                "id": join_id,
                "type": "join",
                "symbol": "⋈",
                "name": join_name,
                "label": f"⋈ [{cond_text}]",
                "predicate": cond_text,
                "condition": opt_join["condition"],
                "details": join_details,
                "outputColumns": next_cols,
                "children": [curr_combined["id"], right_head["id"]],
                "parentId": None,
                "tuplesCount": 0,
                "heuristic": join_heuristic,
                "heuristicLabel": "Evitar Produto Cartesiano (Conversão para ⋈)" if opt_join["wasCartesian"] else None,
            }
        else:
            prod_id = f"opt_product_{idx + 1}"
            node = {
                "id": prod_id,
                "type": "product",
                "symbol": "×",
                "name": "Produto Cartesiano",
                "label": f"{curr_combined.get('alias', 'R_left')} × {right_alias}",
                "predicate": None,
                "condition": None,
                "details": "Produto cartesiano entre relações intermediárias",
                "outputColumns": next_cols,
                "children": [curr_combined["id"], right_head["id"]],
                "parentId": None,
                "tuplesCount": 0,
                "heuristic": None,
            }

        curr_combined["parentId"] = node["id"]
        right_head["parentId"] = node["id"]
        nodes.append(node)
        node_map[node["id"]] = node

        edges.append({
            "id": f"opt_edge_{curr_combined['id']}_{node['id']}",
            "source": curr_combined["id"],
            "target": node["id"],
            "label": f"Fluxo reduzido ({len(curr_combined['outputColumns'])} colunas)",
        })
        edges.append({
            "id": f"opt_edge_{right_head['id']}_{node['id']}",
            "source": right_head["id"],
            "target": node["id"],
            "label": f"Fluxo reduzido ({len(right_head['outputColumns'])} colunas)",
        })

        curr_combined = node

    # 6. Seleções Remanescentes do WHERE (se houver condições envolvendo 3+ tabelas não cobertas nas junções)
    if remaining_where_conjuncts:
        rem_cond = _combine_conditions(remaining_where_conjuncts)
        rem_text = format_condition(rem_cond, "unicode")
        sel_rem_id = "opt_select_remaining"
        sel_rem_node = {
            "id": sel_rem_id,
            "type": "select",
            "symbol": "σ",
            "name": "Seleção Residual",
            "label": f"σ [{rem_text}]",
            "predicate": rem_text,
            "condition": rem_cond,
            "details": f"Predicado residual após junções: {rem_text}",
            "outputColumns": list(curr_combined["outputColumns"]),
            "children": [curr_combined["id"]],
            "parentId": None,
            "tuplesCount": 0,
            "heuristic": None,
        }
        curr_combined["parentId"] = sel_rem_id
        nodes.append(sel_rem_node)
        node_map[sel_rem_id] = sel_rem_node

        edges.append({
            "id": f"opt_edge_{curr_combined['id']}_{sel_rem_id}",
            "source": curr_combined["id"],
            "target": sel_rem_id,
            "label": "Tuplas para filtro residual",
        })
        curr_combined = sel_rem_node

    # 7. Projeção Final (Raiz da Árvore Otimizada)
    root_proj_id = "opt_project_root"
    root_proj_node = {
        "id": root_proj_id,
        "type": "project",
        "symbol": "π",
        "name": "Projeção Final",
        "label": f"π [{', '.join(proj_keys)}]",
        "predicate": None,
        "attributes": proj_keys,
        "details": f"Projeta e ordena os atributos do SELECT final: {', '.join(proj_keys)}",
        "outputColumns": proj_keys,
        "children": [curr_combined["id"]],
        "parentId": None,
        "tuplesCount": 0,
        "heuristic": None,
    }
    curr_combined["parentId"] = root_proj_id
    nodes.append(root_proj_node)
    node_map[root_proj_id] = root_proj_node

    edges.append({
        "id": f"opt_edge_{curr_combined['id']}_{root_proj_id}",
        "source": curr_combined["id"],
        "target": root_proj_id,
        "label": "Resultado final",
    })

    # 8. Geração da Ordem de Execução Otimizada (Bottom-Up pós-ordem)
    steps = []
    visited = set()

    def _post_order(node_id):
        if node_id in visited:
            return
        node = node_map[node_id]
        for ch_id in node["children"]:
            _post_order(ch_id)
        visited.add(node_id)

        step_num = len(steps) + 1
        h_label = node.get("heuristicLabel")
        steps.append({
            "step": step_num,
            "nodeId": node["id"],
            "operator": node["symbol"],
            "type": node["type"],
            "name": node["name"],
            "operation": node["details"],
            "target": node["label"],
            "predicate": node.get("predicate"),
            "heuristic": node.get("heuristic"),
            "heuristicLabel": h_label,
            "outputColumns": node["outputColumns"],
            "rowsProduced": 0,
            "columnsProduced": len(node["outputColumns"]),
        })

    _post_order(root_proj_id)

    optimized_graph = {
        "nodes": nodes,
        "edges": edges,
        "rootId": root_proj_id,
        "leaves": [s["id"] for s in leaf_scan_nodes],
    }

    optimized_plan = {
        "steps": steps,
        "totalSteps": len(steps),
        "rootOperator": "π",
        "leafCount": len(leaf_scan_nodes),
    }

    # 9. Execução em Memória do Plano Otimizado
    intermediate_data = {}
    step_map = {s["nodeId"]: s for s in steps}

    for step in steps:
        node_id = step["nodeId"]
        node = node_map[node_id]

        if node["type"] == "scan":
            table_name = node["table"]
            alias = node["alias"]
            raw = SAMPLE_DATA.get(table_name, [])
            rows = []
            for r in raw:
                row_dict = {}
                for col_name, val in r.items():
                    row_dict[f"{alias}.{col_name}"] = val
                    row_dict[col_name] = val
                rows.append(row_dict)
            intermediate_data[node_id] = rows
            node["tuplesCount"] = len(rows)
            step["rowsProduced"] = len(rows)

        elif node["type"] == "select":
            child_rows = intermediate_data[node["children"][0]]
            cond = node.get("condition")
            filtered = [r for r in child_rows if eval_condition(cond, r)]
            intermediate_data[node_id] = filtered
            node["tuplesCount"] = len(filtered)
            step["rowsProduced"] = len(filtered)

        elif node["type"] == "project":
            child_rows = intermediate_data[node["children"][0]]
            attr_keys = node["outputColumns"]
            projected = []
            if node_id == root_proj_id:
                # Na raiz, gera tuplas no formato tabular final
                for r in child_rows:
                    projected.append([r.get(k) for k in attr_keys])
            else:
                for r in child_rows:
                    row_dict = {}
                    for k in attr_keys:
                        row_dict[k] = r.get(k)
                        # também mantém nome sem alias caso útil
                        if "." in k:
                            row_dict[k.split(".", 1)[1]] = r.get(k)
                    projected.append(row_dict)
            intermediate_data[node_id] = projected
            node["tuplesCount"] = len(projected)
            step["rowsProduced"] = len(projected)

        elif node["type"] == "join":
            left_rows = intermediate_data[node["children"][0]]
            right_rows = intermediate_data[node["children"][1]]
            cond = node.get("condition")
            combined = []
            for r_left in left_rows:
                for r_right in right_rows:
                    merged = {**r_left, **r_right}
                    if eval_condition(cond, merged):
                        combined.append(merged)
            intermediate_data[node_id] = combined
            node["tuplesCount"] = len(combined)
            step["rowsProduced"] = len(combined)

        elif node["type"] == "product":
            left_rows = intermediate_data[node["children"][0]]
            right_rows = intermediate_data[node["children"][1]]
            combined = [{**r_left, **r_right} for r_left in left_rows for r_right in right_rows]
            intermediate_data[node_id] = combined
            node["tuplesCount"] = len(combined)
            step["rowsProduced"] = len(combined)

    # Atualiza tuplas nas arestas
    for edge in edges:
        edge["tuplesCount"] = node_map[edge["source"]].get("tuplesCount", 0)

    # 10. Construção da Expressão da Álgebra Relacional Otimizada
    optimized_algebra = _build_optimized_algebra_expression(tables, optimized_joins, unary_by_alias, leaf_heads, node_map, proj_keys)

    # 11. Cálculo de Métricas Comparativas (Canônico vs Otimizado)
    # Tuplas intermediárias: soma das tuplas geradas em passos intermediários
    canon_steps = canonical_plan["steps"]
    canon_intermediate_tuples = sum(s["rowsProduced"] for s in canon_steps[:-1])
    opt_intermediate_tuples = sum(s["rowsProduced"] for s in steps[:-1])

    # Células intermediárias (Volume em memória = tuplas * colunas)
    canon_intermediate_cells = sum(s["rowsProduced"] * s["columnsProduced"] for s in canon_steps[:-1])
    opt_intermediate_cells = sum(s["rowsProduced"] * s["columnsProduced"] for s in steps[:-1])

    tuple_reduction_pct = (
        round(((canon_intermediate_tuples - opt_intermediate_tuples) / canon_intermediate_tuples) * 100, 1)
        if canon_intermediate_tuples > 0 and canon_intermediate_tuples > opt_intermediate_tuples
        else 0.0
    )

    cell_reduction_pct = (
        round(((canon_intermediate_cells - opt_intermediate_cells) / canon_intermediate_cells) * 100, 1)
        if canon_intermediate_cells > 0 and canon_intermediate_cells > opt_intermediate_cells
        else 0.0
    )

    # Enriquecimento dos resumos de heurísticas
    for item in applied_selections:
        alias = item["alias"]
        sel_node = node_map.get(f"opt_sel_{alias}")
        item["finalTuples"] = sel_node["tuplesCount"] if sel_node else item["initialTuples"]
        item["reductionTuples"] = item["initialTuples"] - item["finalTuples"]

    return {
        "applied": True,
        "deliveryDate": "22/10/2026",
        "deliveryName": "Aplicação da Heurística Projeção e Seleção",
        "heuristics": {
            "tupleReduction": {
                "name": "Heurística de Redução de Tuplas (Push-down de Seleção)",
                "description": "Antecipa as operações de seleção (σ) aplicando os predicados unários do WHERE diretamente sobre as relações base antes de qualquer junção ou produto cartesiano.",
                "appliedCount": len(applied_selections),
                "items": applied_selections,
            },
            "attributeReduction": {
                "name": "Heurística de Redução de Atributos (Push-down de Projeção)",
                "description": "Antecipa as operações de projeção (π) mantendo apenas os atributos necessários para junções subsequentes e para o SELECT final, eliminando colunas redundantes precocemente.",
                "appliedCount": len(applied_projections),
                "items": applied_projections,
            },
        },
        "metrics": {
            "canonicalIntermediateTuples": canon_intermediate_tuples,
            "optimizedIntermediateTuples": opt_intermediate_tuples,
            "savedTuples": max(0, canon_intermediate_tuples - opt_intermediate_tuples),
            "tupleReductionPercent": tuple_reduction_pct,
            "canonicalIntermediateCells": canon_intermediate_cells,
            "optimizedIntermediateCells": opt_intermediate_cells,
            "savedCells": max(0, canon_intermediate_cells - opt_intermediate_cells),
            "cellReductionPercent": cell_reduction_pct,
        },
        "graph": optimized_graph,
        "plan": optimized_plan,
        "algebra": optimized_algebra,
        "result": {
            "columns": proj_keys,
            "rows": intermediate_data[root_proj_id],
            "rowCount": len(intermediate_data[root_proj_id]),
            "hasData": len(intermediate_data[root_proj_id]) > 0,
        },
    }


def _build_optimized_algebra_expression(tables, optimized_joins, unary_by_alias, leaf_heads, node_map, proj_keys):
    """Constrói a representação formal em álgebra relacional refletindo os push-downs aplicados."""

    def _leaf_expr(t, style="unicode"):
        table_name = t["table"]
        alias = t["alias"]
        has_alias = alias != table_name

        if style == "latex":
            base = f"\\text{{{table_name}}}" + (f" \\text{{ AS }} {alias}" if has_alias else "")
        else:
            base = f"{table_name} AS {alias}" if has_alias else table_name

        # 1. Se houve seleção antecipada
        unary_preds = unary_by_alias.get(alias, [])
        if unary_preds:
            combined = _combine_conditions(unary_preds)
            c_text = format_condition(combined, style)
            if style == "latex":
                base = f"\\sigma_{{{c_text}}}\\left( {base} \\right)"
            elif style == "unicode":
                base = f"σ[{c_text}]({base})"
            else:
                base = f"SIGMA[{c_text}]({base})"

        # 2. Se houve projeção antecipada
        proj_early_node = node_map.get(f"opt_proj_early_{alias}")
        if proj_early_node:
            cols = ", ".join(proj_early_node["outputColumns"])
            if style == "latex":
                base = f"\\pi_{{{cols}}}\\left( {base} \\right)"
            elif style == "unicode":
                base = f"π[{cols}]({base})"
            else:
                base = f"PI[{cols}]({base})"

        return base

    # Combina as expressões com Junção ou Produto
    t0 = tables[0]
    expr_u = _leaf_expr(t0, "unicode")
    expr_l = _leaf_expr(t0, "latex")
    expr_a = _leaf_expr(t0, "ascii")

    for idx, oj in enumerate(optimized_joins):
        t_right = tables[idx + 1]
        r_u = _leaf_expr(t_right, "unicode")
        r_l = _leaf_expr(t_right, "latex")
        r_a = _leaf_expr(t_right, "ascii")

        if oj["condition"]:
            cond_u = format_condition(oj["condition"], "unicode")
            cond_l = format_condition(oj["condition"], "latex")
            cond_a = format_condition(oj["condition"], "ascii")

            expr_u = f"({expr_u} ⋈[{cond_u}] {r_u})"
            expr_l = f"\\left( {expr_l} \\bowtie_{{{cond_l}}} {r_l} \\right)"
            expr_a = f"({expr_a} JOIN[{cond_a}] {r_a})"
        else:
            expr_u = f"({expr_u} × {r_u})"
            expr_l = f"\\left( {expr_l} \\times {r_l} \\right)"
            expr_a = f"({expr_a} CROSS {r_a})"

    # Projeção final na raiz
    cols_str = ", ".join(proj_keys)
    if len(tables) == 1 and expr_u.startswith(f"π[{cols_str}]("):
        final_u = expr_u
        final_l = expr_l
        final_a = expr_a
    else:
        final_u = f"π[{cols_str}]({expr_u})"
        final_l = f"\\pi_{{{cols_str}}}\\left( {expr_l} \\right)"
        final_a = f"PI[{cols_str}]({expr_a})"

    return {
        "unicode": final_u,
        "latex": final_l,
        "ascii": final_a,
        "columns": proj_keys,
    }
