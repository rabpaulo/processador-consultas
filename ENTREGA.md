# Guia da Entrega 3 — 22/10/2026

Branch: `main`. Versão cumulativa e funcional organizada conforme o cronograma oficial da disciplina de Banco de Dados II (Trabalho Prático — Processador de Consultas).

---

## Situação das Entregas

| Prazo | Requisito | Situação nesta versão |
| :--- | :--- | :--- |
| **15/10/2026** | **Interface gráfica existente e funcional** | **Disponível (Remodelada em Tema Claro Editorial)** |
| **15/10/2026** | **A string é parseada** | **Disponível** |
| **15/10/2026** | **Campos e comandos errados são validados** | **Disponível** |
| **20/10/2026** | **Conversão para álgebra relacional** | **Disponível (Canônica & Otimizada)** |
| **20/10/2026** | **Grafo não otimizado** | **Disponível** |
| **22/10/2026** | **Aplicação da Heurística Projeção e Seleção** | **Disponível** |
| 27/10/2026 | Demais heurísticas | Etapa futura |

---

## O que foi implementado na Entrega 3 (22/10/2026)

### 1. Heurística de Redução de Tuplas — Push-Down de Seleção (`consulta/optimizer.py`)
- **Decomposição conjuntiva**: Decompõe condições complexas do `WHERE` em predicados atômicos interligados por `AND`.
- **Descida de predicados unários (Push-down σ)**: Predicados que referenciam apenas atributos de uma única relação (ex.: `p.Preco > 200`, `c.Descricao = 'Informática'`) são empurrados para a base da árvore, executando imediatamente após a leitura (scan) da relação.
- **Redução drástica de cardinalidade**: Evita que tuplas não correspondentes participem de combinações binárias custosas (junções e produtos cartesianos).
- **Evitar Produto Cartesiano (Heurística 5.b.ii)**: Identifica predicados de junção declarados no `WHERE` (ex.: `p.Categoria_idCategoria = c.idCategoria`) e converte o produto cartesiano ($\times$) em junção interna condicionada ($\bowtie$), eliminando explosão combinatória.

### 2. Heurística de Redução de Atributos — Push-Down de Projeção (`consulta/optimizer.py`)
- **Análise de necessidade de atributos**: Determina para cada relação exatamente os atributos necessários em etapas posteriores:
  - Atributos exigidos na projeção final (`SELECT`);
  - Atributos exigidos em predicados de junção (`ON` ou `WHERE`).
- **Projeções intermediárias nas folhas (Push-down π)**: Logo após a seleção unária (ou leitura da relação), descarta precocemente todos os atributos que não serão mais referenciados.
- **Economia de memória e I/O**: Reduz a largura das tuplas intermediárias antes de entrarem nas junções e buffers em memória.

### 3. Grafo de Operadores Otimizado vs Canônico (`consulta/optimizer.py` & `app.js`)
- **Grafo em memória**: Estrutura em memória contendo nós de varredura, seleções antecipadas com tag de heurística, projeções antecipadas com atributos descartados, junções otimizadas e projeção final.
- **Alternador de visualização na GUI**:
  - **Árvore Otimizada (22/10)**: Exibe a estrutura com push-downs aplicados e badges indicativos;
  - **Árvore Canônica (20/10)**: Exibe a árvore padrão sem otimizações;
  - **Comparativo Lado a Lado**: Visualização simultânea de ambas as árvores para contraste didático e auditoria.
- **Métricas comparativas em tempo real**:
  - Contagem de tuplas intermediárias (Canônico vs Otimizado);
  - Volume de dados intermediários em células de memória (`tuplas × atributos`);
  - Percentual de redução alcançado (ex.: até 60% de economia de dados em memória).

### 4. Álgebra Relacional Otimizada (`consulta/optimizer.py`)
- Geração automática da expressão matemática refletindo a nova árvore em múltiplos formatos:
  - **Unicode**: $\pi_{p.Nome, p.Preco, c.Descricao}\left( \pi_{p.Nome, p.Preco, p.Categoria\_idCategoria}(\sigma_{p.Preco > 200}(Produto)) \bowtie \sigma_{c.Descricao = \text{'Informática'}}(Categoria) \right)$
  - **LaTeX**: Código tipográfico formatado para relatórios;
  - **ASCII**: Notação textual pura (`PI`, `SIGMA`, `JOIN`).

### 5. Remodelação Completa de UI/UX em Tema Claro Editorial
- **Visual Moderno e Funcional**: Baseado nas melhores práticas de design de ferramentas de engenharia de software (estilo editorial / minimalismo utilitário).
- **Paleta de Alto Contraste**: Fundo claro e limpo (`#f8f9fa`), cartões brancos com bordas sutis (`#e2e8f0`), tipografia escura com legibilidade máxima (`#0f172a`), sem gradientes artificiais ou sombras pesadas.
- **Badges Semânticos Padronizados**: Cores pastéis suaves e calibradas para cada operador relacional ($\pi$ índigo, $\sigma$ âmbar, $\bowtie$ esmeralda, $\times$ vermelho, $\▤$ ardósia).
- **Nova aba "Heurísticas (22/10)"**: Painel dedicado explicando minuciosamente o push-down de seleção e projeção para a consulta em execução.

---

## Roteiro de Demonstração / Apresentação

1. **Iniciar a aplicação**:
   - Dê dois cliques em `iniciar.cmd` (Windows) ou execute `python3 server.py` (Linux/Mac).
   - Acesse no navegador: `http://localhost:3000`.

2. **Exemplo 1: Produtos e categorias (Push-down de Seleção e Projeção com INNER JOIN)**:
   - No dropdown de exemplos, selecione `Produtos e categorias`.
   - Clique em **Executar** (<kbd>Ctrl</kbd> + <kbd>Enter</kbd>).
   - Na aba **Árvore de Operadores**:
     - Observe no topo o painel com as métricas de otimização: economia de **24,6% no volume em memória**.
     - Veja que o ramo `Produto` aplica primeiro a seleção $\sigma_{[p.Preco > 200]}$, reduzindo de 8 para 5 tuplas, e em seguida a projeção $\pi$ descartando 3 atributos não utilizados (`idProduto`, `Descricao`, `QuantEstoque`).
     - Veja que o ramo `Categoria` aplica a seleção $\sigma_{[c.Descricao = 'Informática']}$, reduzindo de 3 para 1 tupla.
     - A junção $\bowtie$ opera sobre relações já filtradas e estreitas!
     - Alterne para o modo **Comparativo Lado a Lado** para visualizar a diferença gritante entre a árvore canônica e a otimizada.
   - Na aba **Heurísticas (22/10)**:
     - Veja o relatório analítico de cada heurística aplicada com antes/depois de tuplas e colunas.
   - Na aba **Álgebra Relacional**:
     - Alterne entre **Álgebra Otimizada** e **Álgebra Canônica** para conferir a expressão formal correspondente.

3. **Exemplo 2: Junção no WHERE (Evitar Produto Cartesiano + Push-down de Seleção)**:
   - Carregue o exemplo `Junção no WHERE`.
   - Clique em **Executar**.
   - Note as métricas: **-35% de tuplas intermediárias** e **-60,1% de dados em memória**!
   - Na árvore canônica, é gerado um produto cartesiano de 24 tuplas ($8 \times 3$).
   - Na árvore otimizada, a condição `p.Preco < 300` é empurrada para a relação `Produto`, reduzindo para 4 tuplas, e a condição `p.Categoria_idCategoria = c.idCategoria` converte o produto em junção interna!
   - Não há formação do produto cartesiano de 24 tuplas.

4. **Exemplo 3: Pedidos por cliente (Junção Tripla com Push-down de Projeção Extensiva)**:
   - Carregue `Pedidos por cliente`.
   - Note a economia de **45,7% de volume de dados em memória**: colunas pesadas de `Cliente` (como `Email`, `Senha`, `Nascimento`, `DataRegistro`) são descartadas logo na folha antes das duas junções subsequentes.

---

## Validação e Testes Automatizados

Foram executados **23 testes automatizados** com 100% de aprovação cobrindo toda a cadeia:

```bash
python3 -B -m unittest discover -s tests -v
```

Cobertura dos testes:
- Análise léxica, sintática recursiva e validações semânticas da Entrega 1.
- Conversão da álgebra relacional canônica da Entrega 2.
- Construção do grafo não otimizado e plano determinístico pós-ordem.
- Avaliação in-memory sobre o catálogo `BD_Vendas`.
- **Nova cobertura da Entrega 3**:
  - Testes do módulo `consulta/optimizer.py`.
  - Verificação do push-down de seleção unária ($\sigma$).
  - Verificação do push-down de projeção antecipada ($\pi$).
  - Conversão de produto cartesiano em junção sob o `WHERE`.
  - Garantia de equivalência exata dos resultados finais entre os planos canônico e otimizado.
  - Testes de resposta da API HTTP `/api/process` com a chave `optimization`.
  - Validação de sintaxe JavaScript com `node --check app.js`.
