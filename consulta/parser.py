"""Análise léxica, sintática e validação semântica de um subconjunto SQL."""

import math
import re

from .schema import SCHEMA


class QueryError(ValueError):
    def __init__(self, message, position=0, code="query"):
        super().__init__(message)
        self.position = position
        self.code = code


RESERVED = set("SELECT FROM WHERE INNER JOIN ON AND AS OR LEFT RIGHT FULL OUTER CROSS NATURAL GROUP BY ORDER HAVING LIMIT UNION INSERT UPDATE DELETE DROP CREATE DISTINCT NOT IS NULL TRUE FALSE".split())
NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", re.ASCII)
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z_0-9]*")
OPERATOR = re.compile(r"<=|>=|<>|=|<|>")


def tokenize(sql):
    tokens = []
    index = 0
    while index < len(sql):
        if sql[index].isspace():
            index += 1
            continue
        start = index
        if sql.startswith("--", index):
            end = sql.find("\n", index)
            index = len(sql) if end == -1 else end
            continue
        if sql[index] == "'":
            value = []
            index += 1
            while index < len(sql):
                if sql[index] == "'":
                    if index + 1 < len(sql) and sql[index + 1] == "'":
                        value.append("'")
                        index += 2
                    else:
                        index += 1
                        break
                else:
                    value.append(sql[index])
                    index += 1
            else:
                raise QueryError("Texto sem aspas de fechamento.", start)
            tokens.append({"type": "string", "value": "".join(value), "position": start})
            continue
        match = NUMBER.match(sql, index)
        if match:
            text = match.group()
            if len(text.lstrip("+-")) > 4300:
                raise QueryError("Número fora do intervalo suportado.", start, "resource")
            try:
                if "." in text or "e" in text.lower():
                    value = float(text)
                    if not math.isfinite(value):
                        raise QueryError("Número fora do intervalo suportado.", start, "resource")
                    if value.is_integer():
                        value = int(value)
                else:
                    value = int(text)
            except ValueError as error:
                raise QueryError("Número fora do intervalo suportado.", start, "resource") from error
            tokens.append({"type": "number", "value": value, "position": start})
            index = match.end()
            continue
        match = IDENTIFIER.match(sql, index)
        if match:
            tokens.append({"type": "identifier", "value": match.group(), "position": start})
            index = match.end()
            continue
        match = OPERATOR.match(sql, index)
        if match:
            tokens.append({"type": "operator", "value": match.group(), "position": start})
            index = match.end()
            continue
        if sql[index] in "(),.*;":
            tokens.append({"type": "symbol", "value": sql[index], "position": start})
            index += 1
            continue
        raise QueryError(f'Caractere não suportado: "{sql[index]}".', start)
    tokens.append({"type": "eof", "value": "", "position": len(sql)})
    return tokens


class Parser:
    """Parser descendente recursivo; AND é associado à esquerda."""

    def __init__(self, sql):
        self.tokens = tokenize(sql)
        self.index = 0
        self.tables = []
        self.depth = 0

    @property
    def current(self):
        return self.tokens[self.index]

    def is_token(self, value):
        return self.current["type"] != "string" and str(self.current["value"]).upper() == value

    def take(self, value):
        if self.is_token(value):
            self.index += 1
            return True
        return False

    def expect(self, value):
        if not self.take(value):
            found = self.current["value"] or "fim da consulta"
            raise QueryError(f"Esperado {value}; encontrado {found}.", self.current["position"])

    def identifier(self):
        token = self.current
        if token["type"] != "identifier" or token["value"].upper() in RESERVED:
            found = token["value"] or "fim da consulta"
            raise QueryError(f"Esperado nome de tabela ou campo; encontrado {found}.", token["position"])
        self.index += 1
        return token

    def column(self, allow_star=False):
        position = self.current["position"]
        if allow_star and self.take("*"):
            return {"type": "star", "qualifier": None, "position": position}
        first = self.identifier()["value"]
        if self.take("."):
            if allow_star and self.take("*"):
                return {"type": "star", "qualifier": first, "position": position}
            field_token = self.identifier()
            return {"type": "column", "qualifier": first, "name": field_token["value"], "position": position, "field_position": field_token["position"]}
        return {"type": "column", "qualifier": None, "name": first, "position": position, "field_position": position}

    def operand(self):
        token = self.current
        if token["type"] in ("number", "string"):
            self.index += 1
            return {"type": "literal", "value": token["value"], "position": token["position"]}
        if self.take("NULL"):
            return {"type": "literal", "value": None, "position": token["position"]}
        if self.take("TRUE"):
            return {"type": "literal", "value": True, "position": token["position"]}
        if self.take("FALSE"):
            return {"type": "literal", "value": False, "position": token["position"]}
        return self.column()

    def term(self):
        if self.take("("):
            self.depth += 1
            if self.depth > 100:
                raise QueryError("Limite de 100 níveis de parênteses excedido.", self.current["position"], "resource")
            expression = self.condition()
            self.expect(")")
            self.depth -= 1
            return expression
        left = self.operand()
        operator = self.current
        if operator["type"] != "operator":
            raise QueryError("Esperado operador de comparação (=, >, <, <=, >= ou <>).", operator["position"])
        self.index += 1
        return {"type": "comparison", "left": left, "operator": operator["value"], "right": self.operand(), "position": left["position"]}

    def condition(self):
        expression = self.term()
        while self.take("AND"):
            expression = {"type": "and", "left": expression, "right": self.term()}
        return expression

    def table(self):
        token = self.identifier()
        alias = token["value"]
        if self.take("AS"):
            alias = self.identifier()["value"]
        elif self.current["type"] == "identifier" and self.current["value"].upper() not in RESERVED:
            alias = self.identifier()["value"]
        entry = {"table": token["value"], "alias": alias, "position": token["position"]}
        self.tables.append(entry)
        return entry

    def parse(self):
        self.expect("SELECT")
        columns = [self.column(True)]
        while self.take(","):
            columns.append(self.column(True))
        self.expect("FROM")
        self.table()
        joins = []
        while self.is_token(",") or self.is_token("INNER") or self.is_token("JOIN"):
            if self.take(","):
                entry = self.table()
                joins.append({"alias": entry["alias"], "condition": None})
            else:
                self.take("INNER")
                self.expect("JOIN")
                entry = self.table()
                self.expect("ON")
                joins.append({"alias": entry["alias"], "condition": self.condition()})
        where = self.condition() if self.take("WHERE") else None
        self.take(";")
        if self.current["type"] != "eof":
            raise QueryError(f"Comando ou trecho não suportado: {self.current['value']}. Use SELECT, FROM, INNER JOIN, WHERE e AND.", self.current["position"])
        return {"columns": columns, "tables": self.tables, "joins": joins, "where": where, "tokens": self.tokens[:-1]}


def parse(sql):
    if not isinstance(sql, str):
        raise QueryError("A consulta SQL deve ser uma string.")
    if len(sql) > 20000:
        raise QueryError("A consulta deve ter no máximo 20.000 caracteres.", 0, "resource")
    if not sql.strip():
        raise QueryError("Insira uma consulta SELECT.")
    try:
        return Parser(sql).parse()
    except RecursionError as error:
        raise QueryError("Consulta complexa demais para o limite didático. Reduza os predicados.", 0, "resource") from error


def comparisons(expression):
    """Decompõe AND iterativamente, preservando a ordem dos predicados."""
    result = []
    stack = [expression] if expression else []
    while stack:
        current = stack.pop()
        if current["type"] == "and":
            stack.extend([current["right"], current["left"]])
        else:
            result.append(current)
    return result


def references(predicate):
    return [operand for operand in (predicate["left"], predicate["right"]) if operand["type"] == "column"]


def aliases(predicate):
    return list(dict.fromkeys(column["alias"] for column in references(predicate)))


def operand_text(operand):
    if operand["type"] == "column":
        return operand["key"]
    value = operand["value"]
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    return str(value)


def predicate_text(predicate):
    return f"{operand_text(predicate['left'])} {predicate['operator']} {operand_text(predicate['right'])}"


def validate(ast):
    tables = []
    seen = set()
    for entry in ast["tables"]:
        name = next((name for name in SCHEMA if name.lower() == entry["table"].lower()), None)
        if name is None:
            raise QueryError(f"Tabela inexistente: {entry['table']}. Consulte o esquema BD_Vendas.", entry["position"])
        if entry["alias"].lower() in seen:
            raise QueryError(f"Alias repetido: {entry['alias']}. Use aliases distintos.", entry["position"])
        seen.add(entry["alias"].lower())
        tables.append({**entry, "table": name})

    def resolve(column, scope):
        candidates = scope
        if column["qualifier"]:
            candidates = [entry for entry in scope if entry["alias"].lower() == column["qualifier"].lower()]
            if not candidates:
                raise QueryError(f"Tabela ou alias fora do escopo: {column['qualifier']}.", column["position"])
        matches = [
            {"type": "column", "alias": entry["alias"], "name": name, "key": f"{entry['alias']}.{name}", "position": column["position"]}
            for entry in candidates for name in SCHEMA[entry["table"]] if name.lower() == column["name"].lower()
        ]
        if not matches:
            prefix = column["qualifier"] + "." if column["qualifier"] else ""
            err_pos = column.get("field_position", column["position"]) if column["qualifier"] else column["position"]
            raise QueryError(f"Campo inexistente: {prefix}{column['name']}.", err_pos)
        if len(matches) > 1:
            raise QueryError(f"Campo ambíguo: {column['name']}. Informe tabela ou alias.", column["position"])
        return matches[0]

    def resolve_expression(expression, scope):
        predicates = []
        for predicate in comparisons(expression):
            predicates.append({**predicate, **{side: resolve(predicate[side], scope) if predicate[side]["type"] == "column" else predicate[side] for side in ("left", "right")}})
        result = None
        for predicate in predicates:
            result = predicate if result is None else {"type": "and", "left": result, "right": predicate}
        return result

    columns = []
    for column in ast["columns"]:
        if column["type"] != "star":
            columns.append(resolve(column, tables))
            continue
        scope = [entry for entry in tables if entry["alias"].lower() == column["qualifier"].lower()] if column["qualifier"] else tables
        if not scope:
            raise QueryError(f"Tabela ou alias inexistente: {column['qualifier']}.", column["position"])
        columns.extend({"type": "column", "alias": entry["alias"], "name": name, "key": f"{entry['alias']}.{name}", "position": column["position"]} for entry in scope for name in SCHEMA[entry["table"]])
    return {
        **ast, "tables": tables, "columns": columns,
        "joins": [{**join, "alias": tables[index + 1]["alias"], "condition": resolve_expression(join["condition"], tables[:index + 2])} for index, join in enumerate(ast["joins"])],
        "where": resolve_expression(ast["where"], tables),
    }
