"""Seleção, projeção e reordenação conectada de INNER JOINs — 27/10/2026."""

from .algebra import format_condition, algebra_from_graph
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


def _order_relations(tables, unary_by_alias, predicates):
    """Guloso: cardinalidades locais exatas; junções estimadas por valores distintos.

    As estatísticas vêm apenas das folhas filtradas do catálogo didático, sem
    executar junções para escolher o plano. Empates preservam a ordem do FROM.
    Uma extensão conectada sempre vence uma extensão cartesiana.
    """
    counts, distinct = {}, {}
    for table in tables:
        alias = table["alias"]
        local = _combine_conditions(unary_by_alias[alias])
        rows = [{f"{alias}.{k}": v for k, v in row.items()}
                for row in SAMPLE_DATA[table["table"]]]
        rows = [row for row in rows if eval_condition(local, row)]
        counts[alias] = len(rows)
        for col in SCHEMA[table["table"]]:
            key = f"{alias}.{col}"
            distinct[key] = len({row[key] for row in rows if row[key] is not None})

    indexed = list(enumerate(tables))
    first = min(indexed, key=lambda item: (counts[item[1]["alias"]], item[0]))
    ordered = [first[1]]
    remaining = [item for item in indexed if item != first]
    available = {first[1]["alias"]}
    estimate = float(counts[first[1]["alias"]])
    pending = list(predicates)
    joins, decisions = [], []
    while remaining:
        candidates = []
        for index, table in remaining:
            alias = table["alias"]
            applicable = [p for p in pending
                          if alias in _get_referenced_aliases(p["condition"])
                          and _get_referenced_aliases(p["condition"]) <= available | {alias}]
            output = estimate * counts[alias]
            for predicate in applicable:
                cond = predicate["condition"]
                if cond["operator"] == "=":
                    keys = [cond[side]["key"] for side in ("left", "right")]
                    output /= max(1, *(distinct[key] for key in keys))
                else:
                    output /= 3  # Aproximação didática para theta-join.
            candidates.append((not bool(applicable), output, counts[alias], index, table, applicable))
        _, estimate, _, index, table, applicable = min(candidates, key=lambda c: c[:4])
        condition = _combine_conditions([p["condition"] for p in applicable])
        joins.append({"rightTable": table, "condition": condition,
                      "predicates": applicable, "estimatedRows": round(estimate, 3)})
        decisions.append({"alias": table["alias"], "connected": bool(applicable),
                          "estimatedRows": round(estimate, 3)})
        used = {p["id"] for p in applicable}
        pending = [p for p in pending if p["id"] not in used]
        available.add(table["alias"])
        ordered.append(table)
        remaining = [item for item in remaining if item[0] != index]
    return ordered, joins, pending, counts, decisions


def build_optimized_plan(query, canonical_algebra, canonical_graph, canonical_plan):
    """Aplica as heurísticas de Seleção (Redução de Tuplas) e Projeção (Redução de Atributos)
    gerando o grafo otimizado, plano de execução correspondente e álgebra relacional otimizada.
    """
    tables = query["tables"]
    joins = query["joins"]
    where = query["where"]
    columns = query["columns"]
    proj_keys = [c["key"] for c in columns]

    # Todos os JOINs suportados são internos: ON e WHERE são conjunções
    # comutáveis. Cada ocorrência recebe um id e é alocada uma única vez.
    original_order = [t["alias"] for t in tables]
    predicates = []
    for origin, condition in [("ON", j["condition"]) for j in joins] + [("WHERE", where)]:
        for conj in _extract_conjuncts(condition):
            predicates.append({"id": len(predicates), "origin": origin, "condition": conj,
                               "text": format_condition(conj)})
    unary_by_alias = {t["alias"]: [] for t in tables}
    origins_by_alias = {t["alias"]: [] for t in tables}
    multi, residual = [], []
    for predicate in predicates:
        refs = _get_referenced_aliases(predicate["condition"])
        if len(refs) == 1:
            alias = next(iter(refs))
            unary_by_alias[alias].append(predicate["condition"])
            origins_by_alias[alias].append(predicate)
        elif not refs:
            residual.append(predicate)
        else:
            multi.append(predicate)

    tables, optimized_joins, pending, local_counts, decisions = _order_relations(
        tables, unary_by_alias, multi)
    residual.extend(pending)
    residual_conjuncts = [p["condition"] for p in residual]

    # 3. Análise de atributos necessários para a Heurística de Redução de Atributos (Push-Down de Projeção)
    cols_in_select = set(proj_keys)
    cols_in_joins = set()
    for oj in optimized_joins:
        if oj["condition"]:
            cols_in_joins.update(_get_referenced_columns(oj["condition"]))
    cols_in_remaining_where = set()
    for rw in residual_conjuncts:
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
            "details": f"Leitura em memória da relação base '{table_name}'",
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
                "predicates": origins_by_alias[alias],
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
                "predicates": origins_by_alias[alias],
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
            join_name = "Junção Otimizada"
            join_heuristic = "join_ordering"
            join_details = f"Junção conectada com predicados ON/WHERE: {cond_text}"

            node = {
                "id": join_id,
                "type": "join",
                "symbol": "⋈",
                "name": join_name,
                "label": f"⋈ [{cond_text}]",
                "predicate": cond_text,
                "condition": opt_join["condition"],
                "predicates": opt_join["predicates"],
                "estimatedRows": opt_join["estimatedRows"],
                "details": join_details,
                "outputColumns": next_cols,
                "children": [curr_combined["id"], right_head["id"]],
                "parentId": None,
                "tuplesCount": 0,
                "heuristic": join_heuristic,
                "heuristicLabel": "Junções conectadas (ON/WHERE)",
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

    # 6. Seleções residuais: constantes e condições ainda não alocadas.
    if residual_conjuncts:
        rem_cond = _combine_conditions(residual_conjuncts)
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
            "predicates": residual,
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
    optimized_algebra = algebra_from_graph(optimized_graph)

    # 11. Cálculo de Métricas Comparativas (Canônico vs Otimizado)
    # Tuplas intermediárias: soma das tuplas geradas em passos intermediários
    canon_steps = canonical_plan["steps"]
    canon_intermediate_tuples = sum(s["rowsProduced"] for s in canon_steps[:-1])
    opt_intermediate_tuples = sum(s["rowsProduced"] for s in steps[:-1])

    # Soma de células emitidas: não mede bytes nem pico de RAM.
    canon_intermediate_cells = sum(s["rowsProduced"] * s["columnsProduced"] for s in canon_steps[:-1])
    opt_intermediate_cells = sum(s["rowsProduced"] * s["columnsProduced"] for s in steps[:-1])

    tuple_reduction_pct = (
        round(((canon_intermediate_tuples - opt_intermediate_tuples) / canon_intermediate_tuples) * 100, 1)
        if canon_intermediate_tuples > 0
        else 0.0
    )

    cell_reduction_pct = (
        round(((canon_intermediate_cells - opt_intermediate_cells) / canon_intermediate_cells) * 100, 1)
        if canon_intermediate_cells > 0
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
        "deliveryDate": "27/10/2026",
        "deliveryName": "Demais Heurísticas: reordenação, seleção e projeção",
        "predicateAssignments": predicates,
        "heuristics": {
            "joinOrdering": {
                "name": "Reordenação por cardinalidade e conectividade",
                "originalOrder": original_order,
                "optimizedOrder": [t["alias"] for t in tables],
                "reordered": original_order != [t["alias"] for t in tables],
                "filteredCardinalities": local_counts,
                "decisions": decisions,
                "description": "Menor cardinalidade após filtros locais; extensões conectadas por menor saída estimada. Empates estáveis pelo FROM.",
            },
            "cartesianAvoidance": {
                "canonicalProducts": sum(n["type"] == "product" for n in canonical_graph["nodes"]),
                "optimizedProducts": sum(n["type"] == "product" for n in nodes),
            },
            "tupleReduction": {
                "name": "Heurística de Redução de Tuplas (Push-down de Seleção)",
                "description": "Antecipa seleções unárias de ON e WHERE sobre as relações base antes de junções ou produtos.",
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
            "definition": "Soma das saídas de todos os operadores exceto a projeção final, incluindo scans. Células = linhas emitidas × atributos. Não mede RAM nem tempo; operadores adicionais podem aumentar as somas.",
            "canonicalIntermediateTuples": canon_intermediate_tuples,
            "optimizedIntermediateTuples": opt_intermediate_tuples,
            "savedTuples": canon_intermediate_tuples - opt_intermediate_tuples,
            "tupleReductionPercent": tuple_reduction_pct,
            "canonicalIntermediateCells": canon_intermediate_cells,
            "optimizedIntermediateCells": opt_intermediate_cells,
            "savedCells": canon_intermediate_cells - opt_intermediate_cells,
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
