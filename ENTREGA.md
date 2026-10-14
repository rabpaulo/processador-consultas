# Guia da entrega 1 — 15/10/2026

Branch: `codex/entrega-1-2026-10-15`. Esta é uma versão cumulativa organizada conforme o cronograma fornecido. O prazo identifica a entrega acadêmica; o Git registra a data real dos commits. A base já continha o projeto completo, por isso a primeira branch recorta a etapa inicial e as seguintes acrescentam os recursos em sequência.

## O que está pronto

Interface gráfica funcional, análise da string SQL e validação de campos e comandos. Esta versão devolve tokens e a estrutura validada; não constrói planos nem executa dados.

| Prazo | Requisito | Situação nesta branch |
| --- | --- | --- |
| 15/10/2026 | Interface gráfica existente e funcional | Disponível |
| 15/10/2026 | A string é parseada | Disponível |
| 15/10/2026 | Campos e comandos errados são validados | Disponível |
| 20/10/2026 | Conversão para álgebra relacional | Etapa futura |
| 20/10/2026 | Grafo não otimizado | Etapa futura |
| 22/10/2026 | Heurísticas de projeção e seleção | Etapa futura |
| 27/10/2026 | Demais heurísticas | Etapa futura |

## Como a entrada é processada

1. `app.js` envia a string do editor para `POST /api/process`. O JavaScript controla formulários, abas, desenho e exportação.
2. `server.py` verifica o JSON e o campo `sql`, chama `consulta.process_query` e devolve uma resposta JSON. `create_server` também permite testes HTTP numa porta temporária.
3. `tokenize`, em `consulta/parser.py`, reconhece palavras, campos qualificados, números, textos, símbolos e operadores, guardando a posição de cada token. A classe `QueryError` transporta a mensagem e a posição para a interface.
4. `Parser` percorre os tokens na gramática `SELECT … FROM … [INNER JOIN … ON …] [WHERE …]`. Condições com `AND` e parênteses viram uma árvore de expressões.
5. `parse` devolve a AST: `columns`, `tables`, `joins`, `where` e `tokens`. `validate` consulta o esquema e resolve cada campo para `alias.Campo`; rejeita tabelas inexistentes, campos inválidos ou ambíguos, aliases repetidos e referências fora do escopo do `ON`.
6. `comparisons` decompõe as conjunções; `predicate_text` gera rótulos legíveis. `processor.py` reúne a resposta desta etapa.

`consulta/schema.py` lê `data/catalog.json`. O esquema contém as dez tabelas do enunciado; os registros de exemplo permitem uma demonstração reproduzível. `*` é expandido usando os campos do catálogo e a ordem do `SELECT` é preservada.

Consultas inválidas mostram linha e coluna. O servidor converte a posição Python para UTF-16, que é o índice usado pela seleção do editor no navegador. A entrada tem limite de 20.000 caracteres e 100 níveis de parênteses.

## Mudanças específicas da entrega 1

- Mantém interface, editor, exemplos, catálogo, exportação JSON, parser e validação em Python.
- `process_query` devolve somente `query` e `backend`; não gera álgebra nem planos.
- `consulta/planner.py` e `consulta/executor.py` estão ausentes desta versão.
- A interface começa em Parser e oferece Esquema e Entregas; não apresenta abas ou resultados de etapas futuras.
- Os testes verificam o processamento e a API da etapa inicial, inclusive a ausência de planos na resposta.

## Roteiro de apresentação

1. Abra o projeto e carregue **Produtos e categorias**.
2. Na aba **Parser**, confira os tokens, os campos resolvidos e os predicados.
3. Veja as dez tabelas na aba **Esquema do banco**.
4. Carregue **Campo inválido** e teste `DELETE FROM Produto`: ambos devem gerar erro com indicação da posição.
5. Use **Exportar análise** para obter o JSON produzido pelo Python.

## Validação

Foram executados **19 testes** com `python -B -m unittest discover -s tests -v`. A suite verifica entradas válidas e inválidas, catálogo, aliases, ambiguidade, limites do parser, posições de erro e integração HTTP. A partir da entrega 2 verifica também os operadores e sua ordem; a partir da entrega 3 verifica resultados e equivalência.

`node --check app.js` verifica a sintaxe da apresentação, sem tornar Node.js uma dependência da aplicação. `git diff --check` verifica o patch. O README contém os comandos para executar a branch, a API e a matriz de requisitos disponíveis e futuros.

Os documentos foram usados como referência dos requisitos acadêmicos e dos prazos. A organização das branches, commits e publicação foi solicitada pelo usuário. A apresentação ou submissão à disciplina permanece responsabilidade da equipe.
