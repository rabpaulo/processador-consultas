# Guia da entrega 2 — 20/10/2026

Branch: `main`. Versão cumulativa organizada conforme o cronograma oficial da disciplina de Banco de Dados II (Trabalho Etapa 2).

---

## Situação das Entregas

| Prazo | Requisito | Situação nesta versão |
| :--- | :--- | :--- |
| **15/10/2026** | **Interface gráfica existente e funcional** | **Disponível** |
| **15/10/2026** | **A string é parseada** | **Disponível** |
| **15/10/2026** | **Campos e comandos errados são validados** | **Disponível** |
| **20/10/2026** | **Conversão para álgebra relacional** | **Disponível** |
| **20/10/2026** | **Grafo não otimizado** | **Disponível** |
| 22/10/2026 | Heurísticas de projeção e seleção | Etapa futura |
| 27/10/2026 | Demais heurísticas | Etapa futura |

---

## O que foi implementado na Entrega 2 (20/10/2026)

### 1. Conversão para Álgebra Relacional (`consulta/algebra.py`)
- **Conversão canônica**: Transforma a consulta SQL validada para a expressão formal equivalente na álgebra relacional de Codd.
- **Múltiplos formatos de exibição**:
  - **Unicode matemático**: Símbolos padronizados ($\pi$ para projeção, $\sigma$ para seleção, $\bowtie$ para junção interna, $\times$ para produto cartesiano, $\land$ para conjunção, $\le$, $\ge$, $\ne$).
  - **LaTeX**: Código matematicamente formatado para renderização tipográfica e relatórios acadêmicos.
  - **ASCII**: Notação textual pura (`PI`, `SIGMA`, `JOIN`, `CROSS`, `AND`).
- **Componentização**: Detalhamento individual dos operadores de projeção, seleção e relações de entrada.
- **Cópia rápida**: Botão com 1 clique para copiar a expressão para a área de transferência.

### 2. Grafo de Operadores Não Otimizado (`consulta/planner.py`)
- **Árvore canônica de operadores**: Estrutura em grafo gerada em memória onde os nós representam os operadores relacionais e as arestas direcionam o fluxo ascendente das tuplas intermediárias.
- **Nós implementados**:
  - **Varredura Sequencial ($\▤$)**: Nós folhas que leem as tabelas bases do catálogo `BD_Vendas`.
  - **Junção ($\bowtie$) / Produto Cartesiano ($\times$)**: Combinação horizontal das relações através de `INNER JOIN ... ON` ou produto cartesiano no `FROM` (`A, B`).
  - **Seleção ($\sigma$)**: Filtro horizontal das tuplas intermediárias aplicando o predicado do `WHERE`.
  - **Projeção ($\pi$)**: Nó raiz que restringe as tuplas aos atributos solicitados no `SELECT`.
- **Renderização visual na GUI**: Layout em árvore com distinção por cores, badges dos operadores, fórmulas, predicados e telemetria de tuplas intermediárias.

### 3. Ordem de Execução / Plano de Consulta (`consulta/planner.py` & `consulta/executor.py`)
- **Percurso ascendente (bottom-up / pós-ordem)**: Algoritmo determinístico que percorre as folhas até a raiz gerando a ordem sequencial de passos a serem executados pelo processador simples de consultas.
- **Detalhamento de cada passo**: Número do passo, símbolo do operador, operação executada, relações de entrada e saída ($R_1, R_2, \dots$), predicado avaliado e contagem real de tuplas geradas.

### 4. Execução Didática e Exibição de Resultados (`consulta/executor.py`)
- Avaliação in-memory do plano de consulta sobre os dados didáticos do catálogo `BD_Vendas`.
- Exibição tabular interativa dos registros resultantes diretamente na nova aba **Resultado da Consulta**.
- Métricas enriquecidas: contagem de tabelas, total de operadores, passos do plano e tuplas finais.

---

## Roteiro de Demonstração / Apresentação

1. **Executar a aplicação**:
   - Dê dois cliques em `iniciar.cmd` (Windows) ou execute `python3 server.py` (Linux/Mac).
   - Acesse `http://localhost:3000`.

2. **Exemplo 1: Produtos por preço (Consulta Unária com Seleção e Projeção)**:
   - Carregue o exemplo `Produtos por preço`.
   - Clique em **Executar** (<kbd>Ctrl</kbd> + <kbd>Enter</kbd>).
   - Na aba **Álgebra Relacional**: confira $\pi_{Nome, Preco}(\sigma_{Preco > 200 \land QuantEstoque \ge 15}(Produto))$.
   - Na aba **Grafo de Operadores**: veja a árvore com 3 níveis: $\▤ Produto$ (8 tuplas) $\rightarrow$ $\sigma$ (3 tuplas) $\rightarrow$ $\pi$ (3 tuplas).
   - Na aba **Ordem de Execução**: confira os 3 passos ordenados de 1 a 3.
   - Na aba **Resultado da Consulta**: veja os 3 produtos filtrados.

3. **Exemplo 2: Produtos e categorias (Junção Explícita com INNER JOIN)**:
   - Carregue o exemplo `Produtos e categorias`.
   - Na aba **Álgebra Relacional**: veja a junção binária com símbolo $\bowtie_{[p.Categoria\_idCategoria = c.idCategoria]}$.
   - Na aba **Grafo de Operadores**: observe a bifurcação dos dois ramos (Produto $p$ e Categoria $c$) convergindo no operador de junção $\bowtie$, seguido de $\sigma$ e $\pi$.
   - Na aba **Ordem de Execução**: confira a sequência de 5 passos (Varredura $p$ $\rightarrow$ Varredura $c$ $\rightarrow$ Junção $R_1 \bowtie R_2$ $\rightarrow$ Filtro WHERE $\rightarrow$ Projeção).

4. **Exemplo 4: Junção no WHERE (Produto Cartesiano Canônico)**:
   - Carregue o exemplo `Junção no WHERE`.
   - Na aba **Álgebra Relacional**: note o operador de Produto Cartesiano $\times$ na expressão: $(Produto \text{ AS } p \times Categoria \text{ AS } c)$ com a condição de junção dentro da seleção $\sigma$.
   - Na aba **Grafo de Operadores**: veja o nó $\times$ combinando todas as tuplas antes da filtragem.

5. **Exemplo 3: Pedidos por cliente (Junção Múltipla com 3 Tabelas)**:
   - Carregue `Pedidos por cliente`.
   - Observe a árvore combinando as 3 relações (Cliente, Pedido e Status) em 7 passos sequenciais com fluxo de dados transparente.

---

## Validação e Testes Automatizados

Foram executados **22 testes unitários e de integração** com 100% de aprovação:

```bash
python3 -B -m unittest discover -s tests -v
```

Cobertura dos testes:
- Análise léxica, sintática recursiva e validações semânticas da Entrega 1.
- Conversão da álgebra relacional (Unicode, LaTeX e ASCII).
- Estrutura hierárquica do grafo de operadores e nós canônicos.
- Ordenação pós-ordem do plano de execução.
- Avaliação e contagem de tuplas pelo executor em memória.
- Testes da API HTTP (`/api/process`, `/api/catalog`, `/api/health`).
- Verificação de sintaxe do front-end com `node --check app.js`.
