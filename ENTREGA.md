# Entrega final — 27/10/2026

QueryLab — Processador de Consultas sobre BD_Vendas. Versão cumulativa das quatro entregas. Os PDFs oficiais, o modelo e a gramática SQL foram preservados.

## Executar e verificar

```powershell
python -B server.py --port 3007
python -B -m unittest discover -s tests -v
node --check app.js
```

Abrir http://localhost:3007. O iniciador continua usando a porta padrão 3000; escolher outra porta se estiver ocupada.

## Estratégia implementada

1. Decompor AND de ON e WHERE; classificar cada ocorrência como filtro local, ligação entre relações ou condição constante. Cada ocorrência tem id e origem.
2. Antecipar filtros locais também de ON de INNER JOIN. Constantes permanecem como seleção residual, representada e executada.
3. Obter cardinalidade e valores distintos das folhas filtradas no catálogo didático. Iniciar pela relação com menos linhas; empate pela posição original.
4. Escolher próximas relações por conectividade, menor saída estimada, menor cardinalidade local e posição original, nessa ordem.
5. Igualdades usam a estimativa N(esquerda) × N(direita) / maior número de valores distintos das colunas. Outras comparações usam seletividade didática de 1/3. Condições múltiplas multiplicam seletividades. São estimativas, não cardinalidades reais nem garantia de ótimo.
6. Reunir todos os predicados aplicáveis na primeira junção com operandos disponíveis, aplicando cada ocorrência uma vez. Somente usar produto quando não há extensão conectada.
7. Preservar atributos do SELECT e dos predicados posteriores nas projeções antecipadas. Preservar duplicatas e aliases.
8. Gerar o plano por pós-ordem e a álgebra Unicode/ASCII/LaTeX diretamente da árvore otimizada, incluindo seleções residuais.
9. Manter a ordem e estruturas canônicas intactas. Comparar resultados como multiconjuntos em cada execução e informar a equivalência real na interface.

## Métricas

Soma de tuplas emitidas: somar saídas dos operadores, incluindo scans, exceto a projeção final.
Soma de células emitidas: somar linhas produzidas × atributos de cada operador.

Diferenças e percentuais são assinados: redução negativa indica aumento. Essas somas não medem RAM, bytes, pico de memória, tempo ou I/O. Novos operadores também emitem linhas: o exemplo Produtos e categorias continua com 22 → 23 tuplas somadas, embora a junção passe de 8 para 3 linhas. O aumento é mostrado explicitamente.

## Três consultas para demonstrar

### 1. Reordenação real

```sql
SELECT c.Nome, p.idPedido, s.Descricao
FROM Cliente c
INNER JOIN Pedido p ON c.idCliente = p.Cliente_idCliente
INNER JOIN Status s ON p.Status_idStatus = s.idStatus
WHERE s.idStatus = 2;
```

Mostrar Árvore → Lado a lado e Plano → Otimizado. Canônico: Cliente → Pedido → Status; junções de 6 e 6 linhas.
Otimizado: Status → Pedido → Cliente; Status reduz de 3 para 1 e as junções produzem 2 e 2 linhas.
Resultado: Bruno/pedido 2/Pago e Delta Ltda/pedido 4/Pago.
Somas: tuplas 27 → 28; células 248 → 116. A primeira soma aumenta por incluir operadores adicionais.

### 2. Produto evitado independentemente do FROM

```sql
SELECT c.Nome, p.idPedido, s.Descricao
FROM Cliente c, Status s, Pedido p
WHERE c.idCliente = p.Cliente_idCliente
  AND p.Status_idStatus = s.idStatus
  AND s.idStatus = 2;
```

Canônico: produtos de 12 e 72 linhas, seguidos de seleção.
Otimizado: Status → Pedido → Cliente; sem produto; junções de 2 e 2 linhas.
Mesmo resultado da consulta 1. Somas: tuplas 99 → 28; células 1208 → 116.

### 3. Condições múltiplas e álgebra fiel

```sql
SELECT p.Nome, c.Descricao
FROM Produto p, Categoria c
WHERE p.Categoria_idCategoria = c.idCategoria
  AND p.idProduto > c.idCategoria;
```

Canônico: produto de 24 linhas e seleção para 7.
Otimizado: Categoria → Produto; junção com ambas as condições, produzindo 7 linhas.
O predicado antes residual agora é absorvido pela junção e aparece nas três representações.
Resultado: todos os produtos exceto Notebook, com suas categorias.
Somas: tuplas 42 → 26; células 302 → 113.

## Antes e depois da implementação

| Caso | Otimizado anterior | Otimizado atual |
|---|---|---|
| Consulta 1 | Ordem c,p,s; junções 6 e 2; somas 32 tuplas/136 células | Ordem s,p,c; junções 2 e 2; 28 tuplas/116 células |
| Consulta 2 | Produto c×s de 4 linhas; junção de 6 e residual para 2; 36 tuplas/164 células | Sem produto; junções 2 e 2; 28 tuplas/116 células |
| Consulta 3 | Junção de 8 e residual para 7; expressão omitia o residual | Junção de 7 com as duas condições; expressão correspondente |

Valores anteriores registrados na auditoria desta sessão e atuais medidos no mesmo catálogo.

## Exemplos do seletor

- Produtos e categorias: Preco > 200 reduz Produto de 8 para **4**, não 5. Categoria Informática: 3 → 1. Resultado: 3 linhas; células 142 → 107.
- Junção no WHERE: Preco < 300 reduz Produto de 8 para **5**, não 4. Produto de 24 substituído por junção de 5; células 286 → 114.
- Pedidos por cliente: ordem Status → Pedido → Cliente; junções de 1 e 1 linha; células 234 → 115.

## Validação automatizada

39 testes: 23 anteriores, com atualização da data e comparação por multiconjuntos na regressão de seleção/projeção, e 16 novas regressões em tests/test_optimizer.py.

Um dos testes percorre 60 cenários: todas as permutações de três e quatro tabelas, com e sem filtro seletivo. Cada consulta é comparada com SQLite em memória e verificada quanto a resultados, multiplicidades, atributos, pais/filhos, arestas, dependências, contagens e aplicação única de cada ocorrência de predicado.

Também são cobertos ON local, componentes desconectados, múltiplas condições, seleção residual constante nas três fórmulas, aut junção, resultado vazio, NULL, estrelas, duplicatas, determinismo, estruturas canônicas preservadas e métricas com aumento.

Resultado da verificação: **39 testes aprovados, zero falhas**. `node --check app.js` e `git diff --check` aprovados.

## Teste manual no Chrome

- Consulta obrigatória de INNER JOIN: ordem Status → Pedido → Cliente, plano em pós-ordem e resultados Bruno/pedido 2 e Delta Ltda/pedido 4 confirmados.
- Consulta com Cliente, Status, Pedido: comparativo mostra 2 produtos no canônico e zero no otimizado, com resultado equivalente.
- Consulta de múltiplas condições: segunda condição presente em Unicode, ASCII e LaTeX.
- Filtros locais do ON: dois filtros antecipados, com origem ON no painel e resultado de 3 linhas.
- Modo canônico sem banner de heurísticas. A métrica 27 → 28 mostra aumento, sem afirmar ganho de tempo/RAM.
- Exemplos existentes Produtos e categorias, Pedidos por cliente e Junção no WHERE exercitados; resultados de 3, 1 e 5 linhas, respectivamente.
- A comparação se adapta à largura disponível; em janela estreita, as duas árvores ficam empilhadas.

## Matriz dos entregáveis

| Entrega | Requisito | Status | Evidência |
|---|---|---|---|
| 15/10 | Interface e entrada SQL | PASS | index.html; app.js:run |
| 15/10 | Parser e validação | PASS | consulta/parser.py; testes de parser/API |
| 20/10 | Álgebra canônica | PASS | consulta/algebra.py:build_algebra |
| 20/10 | Grafo canônico | PASS | consulta/planner.py:build_plan |
| 22/10 | Seleção antecipada | PASS | optimizer.py:build_optimized_plan; ON/WHERE |
| 22/10 | Projeção antecipada | PASS | optimizer.py; testes de atributos/estrelas |
| 27/10 | Reordenação restritiva | PASS | optimizer.py:_order_relations; testes 3/4 tabelas |
| 27/10 | Evitar produtos desnecessários | PASS | 60 permutações conectadas; componentes desconectados |
| 27/10 | Ajustes, álgebra e plano | PASS | algebra_from_graph; pós-ordem; testes de integridade |

## Limites

A heurística é gulosa e não garante ótimo global. Estatísticas vêm dos dados didáticos; estimativas podem divergir das cardinalidades reais exibidas nos nós. O executor continua usando laços aninhados e guarda intermediários em memória. Não foram adicionados OR ou outros tipos de JOIN. A nota acadêmica cabe ao professor.
