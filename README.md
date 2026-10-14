# Processador de Consultas SQL (QueryLab)

> Projeto Acadêmico de Banco de Dados II — Etapa 2 (Entrega 1: 15/10/2026).  
> Analisador léxico, parser sintático descendente recursivo e validador semântico em Python puro com interface gráfica web anti-slop.

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
Para verificar se tudo está funcionando (19 testes automatizados):

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

## 🎯 Funcionalidades da Entrega 1 (15/10/2026)

* **Interface Gráfica**: Editor SQL com atalho <kbd>Ctrl</kbd> + <kbd>Enter</kbd>, seletor rápido de exemplos, navegação pelo catálogo de 10 tabelas e exportação dos resultados em JSON (<kbd>Ctrl</kbd> + <kbd>S</kbd>).
* **Análise Sintática (Parser)**: Decomposição da consulta em tokens com posições exatas UTF-16, montagem da estrutura de projeção (`SELECT`), relações (`FROM` / `INNER JOIN ... ON`) e condições (`WHERE` e `AND`).
* **Validação Semântica**: Verificação rigorosa contra o catálogo `BD_Vendas` (existência de tabelas, resolução de colunas sem ambiguidade, escopo de aliases e sintaxe proibida).
* **Tratamento de Erros**: Aponta linha e coluna exatas de comandos ou campos inválidos (ex.: `DELETE FROM Produto` ou campos inexistentes) e posiciona o cursor no trecho problemático.

---

## 📂 Estrutura do Projeto

| Arquivo / Pasta | Responsabilidade |
| --- | --- |
| `iniciar.cmd` | Iniciador rápido de um clique para Windows |
| `testar.cmd` | Executor rápido de testes para Windows |
| `server.py` | Servidor HTTP local e API JSON em Python (biblioteca padrão) |
| `index.html` | Interface do usuário (IDE limpa, sem AI-slop) |
| `styles.css` | Design system em grafite neutro escuro com contraste WCAG AA |
| `app.js` | Controle da interface, atalhos de teclado e chamadas à API Python |
| `consulta/parser.py` | Lexer, parser recursivo e validação semântica |
| `consulta/processor.py` | Pipeline da entrega 1 |
| `consulta/schema.py` | Leitura do catálogo relacional |
| `data/catalog.json` | 10 tabelas do BD_Vendas, registros didáticos e exemplos de consulta |
| `sql/bd-vendas.sql` | DDL MySQL opcional do modelo de banco |
| `tests/` | Suite com 19 testes automatizados de unidade e integração |

---

## 📖 Subconjunto SQL Suportado

* **Comandos e Cláusulas**: `SELECT`, `FROM`, `WHERE`, `INNER JOIN ... ON`, `AND`.
* **Operadores de Comparação**: `=`, `>`, `<`, `<=`, `>=`, `<>`.
* **Projeção e Nomes**: Aliases de tabela com ou sem `AS`, `*`, `tabela.*`, colunas qualificadas (`p.Nome`).
* **Tipos de Dados**: Textos com aspas simples (`'Informática'`), números inteiros e decimais com ponto (`200.50`), valores `NULL`.
* **Comentários**: Linhas iniciadas com `--`.
* **Restrições Didáticas**: Não aceita `OR`, subconsultas, funções de agregação, `GROUP BY`, `ORDER BY` ou comandos de escrita (`INSERT`/`UPDATE`/`DELETE`).
