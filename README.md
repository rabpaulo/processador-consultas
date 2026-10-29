# Processador de Consultas SQL (QueryLab)

> Projeto Acadêmico de Banco de Dados II — Entrega final: 27/10/2026.
> Parser, validação, álgebra, grafos, seleção/projeção antecipadas e reordenação conectada de junções. Veja [ENTREGA.md](ENTREGA.md) para estratégia, limites, métricas e demonstração.

---

## ⚡ Como Rodar no Windows (Muito Fácil)

O projeto usa **apenas a biblioteca padrão do Python**. Você **não precisa instalar nada** via `pip`, nem precisa de Node.js, npm ou MySQL.

### Opção 1: Dois cliques (Mais rápido)
1. Dê um **duplo clique** no arquivo **`iniciar.cmd`**.
2. Abra seu navegador em: **[http://localhost:3000](http://localhost:3000)**.
3. Para rodar a suite de testes unitários: dê um duplo clique em **`testar.cmd`**.

---

### Opção 2: Pelo Prompt de Comando (CMD) ou PowerShell
Abra a pasta do projeto no terminal e execute:

```cmd
.\iniciar.cmd
```

Ou diretamente pelo Python:

```cmd
python server.py
```

Em seguida, acesse no navegador: **`http://localhost:3000`**.  
Para alterar a porta caso a 3000 esteja ocupada:
```cmd
python server.py --port 3001
```

---

### Rodando os Testes Unitários no Windows
Para executar os 55 testes automatizados, incluindo comparações com SQLite em memória:

```cmd
.\testar.cmd
```
ou:
```cmd
python -m unittest discover -s tests -v
```

---

## 🐧 Como Rodar no Linux / macOS

```bash
python3 server.py
```
Acesse **`http://localhost:3000`**. Para rodar os testes:
```bash
python3 -m unittest discover -s tests -v
```

---

## 🎯 Funcionalidades Entregues

### Entrega 1 (15/10/2026)
* **Interface Gráfica**: Editor SQL com atalho <kbd>Ctrl</kbd> + <kbd>Enter</kbd>, seletor rápido de exemplos, navegação pelo catálogo de 10 tabelas e exportação dos resultados em JSON (<kbd>Ctrl</kbd> + <kbd>S</kbd>).
* **Análise Sintática (Parser)**: Decomposição da consulta em tokens com posições exatas UTF-16, montagem da estrutura de projeção (`SELECT`), relações (`FROM` / `INNER JOIN ... ON`) e condições (`WHERE` e `AND`).
* **Validação Semântica**: Verificação rigorosa contra o catálogo `BD_Vendas` (existência de tabelas, resolução de colunas sem ambiguidade, escopo de aliases e sintaxe proibida).
* **Tratamento de Erros**: Aponta linha e coluna exatas de comandos ou campos inválidos e posiciona o cursor no trecho problemático.

### Entrega 2 (20/10/2026)
* **Conversão para Álgebra Relacional Canônica**: Tradução formal da consulta SQL para álgebra relacional nos formatos Unicode ($\pi, \sigma, \bowtie, \times, \land$), LaTeX e ASCII com decomposição dos componentes e botão de cópia rápida.
* **Grafo de Operadores Não Otimizado**: Construção em memória da árvore canônica onde os nós são operadores ($\pi, \sigma, \bowtie, \times, \▤$) e as arestas indicam a direção do fluxo ascendente de tuplas intermediárias.
* **Ordem de Execução (Plano de Consulta Canônico)**: Percurso bottom-up (pós-ordem) no grafo de operadores gerando a ordem sequencial determinística de execução passo a passo.
* **Execução em Memória e Exibição de Resultados**: Avaliação do plano sobre a base de exemplo `BD_Vendas` com cálculo das tuplas intermediárias de cada nó e renderização dos dados na interface gráfica.

### Entrega 3 (22/10/2026)
* **Heurística de Redução de Tuplas (Push-down de Seleção)**: Decompõe predicados conjuntivos e desce seleções unárias ($\sigma$) para serem avaliadas imediatamente após a varredura da respectiva tabela base, antes de junções e produtos.
* **Heurística de Redução de Atributos (Push-down de Projeção)**: Projeção intermediária antecipada ($\pi$) nas folhas descartando colunas redundantes não utilizadas nas operações posteriores.
* **Evitar Produto Cartesiano (Heurística 5.b.ii)**: Converte produtos cartesianos com condições no `WHERE` em junções internas condicionadas ($\bowtie$).
* **Grafo Otimizado e Comparativo Visual**: Alternância entre Árvore Otimizada, Árvore Canônica e Lado a Lado. Métricas mostram somas de tuplas e células emitidas, incluindo aumentos; não medem RAM nem tempo.
* **Álgebra Relacional Otimizada**: Expressão matemática formal refletindo os operadores reordenados em Unicode, LaTeX e ASCII.
* **Nova Interface em Tema Claro**: Remodelação estética completa baseada em diretrizes de design editorial e minimalismo utilitário para ferramentas de dados.

---

### Entrega final (27/10/2026)

* Reordenação gulosa determinística baseada em cardinalidade após filtros e conectividade, preservando a ordem canônica.
* Filtros locais de ON e WHERE antecipados; todos os predicados de ligação aplicados quando os operandos estão disponíveis.
* Produtos mantidos quando não há extensão conectada disponível.
* Álgebra otimizada gerada da árvore executada em Unicode, ASCII e LaTeX, incluindo seleções residuais.
* Comparação dos resultados por multiconjuntos em cada execução; duplicatas preservadas.

### Complemento: LIMIT (29/10/2026)

`LIMIT N` é opcional ao final do SELECT, após as junções e o WHERE, antes do ponto e vírgula. Aceita inteiros não negativos; `LIMIT 0` retorna uma tabela vazia com as colunas preservadas. Valores negativos, decimais, notação científica, identificadores e cláusulas adicionais são rejeitados.

```sql
SELECT p.Nome FROM Produto p LIMIT 3;
SELECT * FROM Pedido LIMIT 0;
SELECT p.Nome FROM Produto p WHERE p.Preco > 200 LIMIT 5;
```

O limite aparece acima da projeção final nos dois grafos, como último passo dos planos e como `LIMIT[N](...)` na álgebra (uma extensão da álgebra relacional). Seleções, projeções antecipadas e reordenação de junções da entrega de 27/10 continuam usando as mesmas heurísticas.

Sem `ORDER BY`, os planos podem retornar subconjuntos diferentes. A equivalência compara os **resultados completos antes do limite**, preservando duplicatas e desconsiderando ordem. A API informa `equivalenceBasis: "before_limit"`, `equivalentResults` para essa comparação e `equivalentReturnedResults` para os subconjuntos efetivamente retornados. Cada resultado inclui `rowCount` e `rowCountBeforeLimit`; a interface mostra essas contagens e explica a ausência de ordem garantida. A tabela de resultados exibe o plano canônico.

O motor executa os resultados completos para conferir equivalência; LIMIT não representa uma execução com parada antecipada. As métricas somam as saídas exceto o operador final: quando há LIMIT, a projeção passa a ser intermediária e entra na soma. Sem LIMIT, os cálculos anteriores são preservados.

## 📂 Estrutura do Projeto

| Arquivo / Pasta | Responsabilidade |
| --- | --- |
| `iniciar.cmd` | Iniciador rápido de um clique para Windows |
| `testar.cmd` | Executor rápido de testes para Windows |
| `server.py` | Servidor HTTP local e API JSON em Python (biblioteca padrão) |
| `index.html` | Interface do usuário em tema claro com abas de inspeção técnica |
| `styles.css` | Design system moderno em tema claro (minimalismo utilitário e tipografia editorial) |
| `app.js` | Controle da interface, renderização do grafo comparativo, heurísticas e dados |
| `consulta/parser.py` | Lexer, parser recursivo e validação semântica |
| `consulta/algebra.py` | Conversão para Álgebra Relacional (Unicode, LaTeX e ASCII) |
| `consulta/planner.py` | Construção do Grafo de Operadores Canônico e Plano de Execução |
| `consulta/optimizer.py` | Seleção/projeção antecipadas e reordenação por cardinalidade e conectividade |
| `consulta/executor.py` | Motor de execução in-memory sobre o catálogo didático |
| `consulta/processor.py` | Pipeline integrado executando canônico + otimizador heurístico |
| `consulta/schema.py` | Leitura do catálogo relacional |
| `data/catalog.json` | 10 tabelas do BD_Vendas, registros didáticos e exemplos de consulta |
| `sql/bd-vendas.sql` | DDL MySQL opcional do modelo de banco |
| `tests/` | 55 testes de unidade/integração; LIMIT, regressões com SQLite e permutações de relações |
| `ENTREGA.md` | Guia detalhado da entrega acadêmica e roteiro de demonstração |
