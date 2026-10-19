"""Geração do Grafo de Operadores Não Otimizado e Plano de Execução."""

from .algebra import format_condition
from .schema import SCHEMA, SAMPLE_DATA


def build_plan(query, algebra):
    """Constrói o grafo de operadores da consulta canônica (não otimizada)
    e percorre a árvore para gerar a ordem de execução correspondente.
    """
    tables = query["tables"]
    joins = query["joins"]
    where = query["where"]
    columns = query["columns"]
    proj_keys = [c["key"] for c in columns]

    nodes = []
    edges = []
    node_map = {}

    # 1. Nós folha: Varredura Sequencial (Scan) de cada tabela
    scan_nodes = []
    for idx, tbl in enumerate(tables):
        table_name = tbl["table"]
        alias = tbl["alias"]
        has_alias = alias != table_name
        label = f"{table_name} AS {alias}" if has_alias else table_name
        all_cols = [f"{alias}.{c}" for c in SCHEMA.get(table_name, [])]
        initial_count = len(SAMPLE_DATA.get(table_name, []))

        node = {
            "id": f"scan_{alias}",
            "type": "scan",
            "symbol": "▤",
            "name": "Varredura Sequencial",
            "label": label,
            "table": table_name,
            "alias": alias,
            "predicate": None,
            "details": f"Varredura sequencial da relação base '{table_name}'",
            "outputColumns": all_cols,
            "children": [],
            "parentId": None,
            "level": 0,
            "tuplesCount": initial_count,
        }
        nodes.append(node)
        node_map[node["id"]] = node
        scan_nodes.append(node)

    # 2. Combinação de relações: Junções (⋈) ou Produtos Cartesianos (×)
    curr_node = scan_nodes[0]
    curr_level = 1

    for idx, join in enumerate(joins):
        right_node = scan_nodes[idx + 1]
        next_cols = curr_node["outputColumns"] + right_node["outputColumns"]

        if join["condition"]:
            cond_text = format_condition(join["condition"], "unicode")
            join_id = f"join_{idx + 1}"
            node = {
                "id": join_id,
                "type": "join",
                "symbol": "⋈",
                "name": "Junção (Inner Join)",
                "label": f"⋈ [{cond_text}]",
                "predicate": cond_text,
                "details": f"Combina tuplas que satisfazem a condição ON: {cond_text}",
                "outputColumns": next_cols,
                "children": [curr_node["id"], right_node["id"]],
                "parentId": None,
                "level": curr_level,
                "tuplesCount": 0,
            }
        else:
            prod_id = f"product_{idx + 1}"
            left_alias = curr_node.get("alias", f"R{idx}")
            right_alias = right_node.get("alias", f"R{idx+1}")
            node = {
                "id": prod_id,
                "type": "product",
                "symbol": "×",
                "name": "Produto Cartesiano",
                "label": f"{left_alias} × {right_alias}",
                "predicate": None,
                "details": "Produto cartesiano irrestrito entre as relações",
                "outputColumns": next_cols,
                "children": [curr_node["id"], right_node["id"]],
                "parentId": None,
                "level": curr_level,
                "tuplesCount": 0,
            }

        curr_node["parentId"] = node["id"]
        right_node["parentId"] = node["id"]
        nodes.append(node)
        node_map[node["id"]] = node

        edges.append({
            "id": f"edge_{curr_node['id']}_{node['id']}",
            "source": curr_node["id"],
            "target": node["id"],
            "label": f"Tuplas de {curr_node['label']}",
            "predicate": None,
        })
        edges.append({
            "id": f"edge_{right_node['id']}_{node['id']}",
            "source": right_node["id"],
            "target": node["id"],
            "label": f"Tuplas de {right_node['label']}",
            "predicate": None,
        })

        curr_node = node
        curr_level += 1

    # 3. Seleção (σ) para o WHERE (se houver)
    if where:
        where_text = format_condition(where, "unicode")
        sel_id = "select_1"
        sel_node = {
            "id": sel_id,
            "type": "select",
            "symbol": "σ",
            "name": "Seleção (Filtro)",
            "label": f"σ [{where_text}]",
            "predicate": where_text,
            "details": f"Filtra tuplas intermediárias pela cláusula WHERE: {where_text}",
            "outputColumns": list(curr_node["outputColumns"]),
            "children": [curr_node["id"]],
            "parentId": None,
            "level": curr_level,
            "tuplesCount": 0,
        }
        curr_node["parentId"] = sel_node["id"]
        nodes.append(sel_node)
        node_map[sel_id] = sel_node

        edges.append({
            "id": f"edge_{curr_node['id']}_{sel_id}",
            "source": curr_node["id"],
            "target": sel_id,
            "label": "Tuplas para filtragem",
            "predicate": where_text,
        })

        curr_node = sel_node
        curr_level += 1

    # 4. Projeção (π) na raiz da árvore
    proj_id = "project_1"
    proj_node = {
        "id": proj_id,
        "type": "project",
        "symbol": "π",
        "name": "Projeção",
        "label": f"π [{', '.join(proj_keys)}]",
        "predicate": None,
        "attributes": proj_keys,
        "details": f"Projeta os atributos solicitados no SELECT: {', '.join(proj_keys)}",
        "outputColumns": proj_keys,
        "children": [curr_node["id"]],
        "parentId": None,
        "level": curr_level,
        "tuplesCount": 0,
    }
    curr_node["parentId"] = proj_id
    nodes.append(proj_node)
    node_map[proj_id] = proj_node

    edges.append({
        "id": f"edge_{curr_node['id']}_{proj_id}",
        "source": curr_node["id"],
        "target": proj_id,
        "label": "Tuplas para projeção",
        "predicate": None,
    })

    # 5. Geração da Ordem de Execução (Plano de Execução)
    # Percurso pós-ordem / ascendente (bottom-up):
    # Folhas -> Junções/Produtos -> Seleção -> Projeção
    steps = []
    step_num = 1

    # Passo(s) de Varredura
    for s_node in scan_nodes:
        steps.append({
            "step": step_num,
            "nodeId": s_node["id"],
            "operator": s_node["symbol"],
            "type": s_node["type"],
            "name": s_node["name"],
            "operation": f"Varredura sequencial na relação base '{s_node['label']}'",
            "target": s_node["label"],
            "predicate": None,
            "input": "Armazenamento em disco / catálogo",
            "output": f"Relação intermediária R{step_num}",
            "outputColumns": s_node["outputColumns"],
            "rowsProduced": s_node["tuplesCount"],
            "columnsProduced": len(s_node["outputColumns"]),
        })
        step_num += 1

    # Passo(s) de Junção / Produto
    for idx, join in enumerate(joins):
        node = nodes[len(scan_nodes) + idx]
        left_step = 1 if idx == 0 else len(scan_nodes) + idx
        right_step = idx + 2
        input_desc = f"R{left_step} e R{right_step}"
        if join["condition"]:
            cond = format_condition(join["condition"], "unicode")
            op_desc = f"Junção interna entre R{left_step} e R{right_step} sob a condição '{cond}'"
            target_desc = f"R{left_step} ⋈ R{right_step}"
        else:
            cond = None
            op_desc = f"Produto cartesiano irrestrito entre R{left_step} e R{right_step}"
            target_desc = f"R{left_step} × R{right_step}"

        steps.append({
            "step": step_num,
            "nodeId": node["id"],
            "operator": node["symbol"],
            "type": node["type"],
            "name": node["name"],
            "operation": op_desc,
            "target": target_desc,
            "predicate": cond,
            "input": input_desc,
            "output": f"Relação intermediária R{step_num}",
            "outputColumns": node["outputColumns"],
            "rowsProduced": 0,
            "columnsProduced": len(node["outputColumns"]),
        })
        step_num += 1

    # Passo de Seleção (se houver WHERE)
    if where:
        where_cond = format_condition(where, "unicode")
        prev_step = step_num - 1
        steps.append({
            "step": step_num,
            "nodeId": "select_1",
            "operator": "σ",
            "type": "select",
            "name": "Seleção (Filtro)",
            "operation": f"Filtro das tuplas de R{prev_step} pelo predicado WHERE '{where_cond}'",
            "target": f"σ(R{prev_step})",
            "predicate": where_cond,
            "input": f"R{prev_step}",
            "output": f"Relação intermediária R{step_num}",
            "outputColumns": list(node_map["select_1"]["outputColumns"]),
            "rowsProduced": 0,
            "columnsProduced": len(node_map["select_1"]["outputColumns"]),
        })
        step_num += 1

    # Passo de Projeção (SELECT)
    prev_step = step_num - 1
    steps.append({
        "step": step_num,
        "nodeId": "project_1",
        "operator": "π",
        "type": "project",
        "name": "Projeção",
        "operation": f"Projeção dos atributos [{', '.join(proj_keys)}] sobre R{prev_step}",
        "target": f"π(R{prev_step})",
        "predicate": None,
        "input": f"R{prev_step}",
        "output": "Resultado Final da Consulta",
        "outputColumns": proj_keys,
        "rowsProduced": 0,
        "columnsProduced": len(proj_keys),
    })

    graph = {
        "nodes": nodes,
        "edges": edges,
        "rootId": proj_id,
        "leaves": [s["id"] for s in scan_nodes],
    }

    plan = {
        "steps": steps,
        "totalSteps": len(steps),
        "rootOperator": "π",
        "leafCount": len(scan_nodes),
    }

    return graph, plan
