// Processador de Consultas: Interface de controle e inspeção técnica em JavaScript.
// Entrega 2 (20/10/2026): Álgebra Relacional Canônica, Árvore de Operadores e Ordem de Execução.

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = value => Number(value ?? 0).toLocaleString('pt-BR');

let schema = {}, sampleCounts = {}, examples = [], requestSequence = 0;
let analysis = null, activeTab = 'graph', selectedTable = null, lastSql = '';
let algebraFormat = 'unicode';

// Navegação do catálogo pela barra lateral
$('#table-nav').addEventListener('click', event => {
  const button = event.target.closest('[data-table]');
  if (!button) return;
  selectTable(button.dataset.table);
});

// Delegação de cliques no painel principal
$('#panel').addEventListener('click', event => {
  // Seleção de card no esquema
  const card = event.target.closest('.schema-card');
  if (card) {
    const table = card.id.replace('schema-', '');
    selectTable(selectedTable === table ? null : table);
    return;
  }

  // Trocador de formato da Álgebra Relacional (Unicode / LaTeX / ASCII)
  const formatBtn = event.target.closest('[data-format]');
  if (formatBtn) {
    algebraFormat = formatBtn.dataset.format;
    renderAlgebra();
    return;
  }

  // Copiar expressão de álgebra relacional
  const copyBtn = event.target.closest('#copy-algebra-btn');
  if (copyBtn && analysis?.algebra) {
    const textToCopy = analysis.algebra[algebraFormat] || analysis.algebra.unicode;
    navigator.clipboard.writeText(textToCopy).then(() => {
      const status = $('#copy-status');
      if (status) {
        status.hidden = false;
        setTimeout(() => { status.hidden = true; }, 2000);
      }
    });
  }
});

// Acessibilidade por teclado nos cards do esquema (Enter ou Espaço)
$('#panel').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    const card = event.target.closest('.schema-card');
    if (card) {
      event.preventDefault();
      const table = card.id.replace('schema-', '');
      selectTable(selectedTable === table ? null : table);
    }
  }
});

function selectTable(table) {
  selectedTable = table;
  document.querySelectorAll('#table-nav button').forEach(btn => {
    const isCurrent = btn.dataset.table === selectedTable;
    if (isCurrent) {
      btn.setAttribute('aria-current', 'true');
    } else {
      btn.removeAttribute('aria-current');
    }
    btn.classList.toggle('selected', isCurrent);
  });
  if (selectedTable) {
    if (activeTab !== 'schema') switchTab('schema');
    const card = document.getElementById(`schema-${selectedTable}`);
    if (card) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    }
  } else if (activeTab === 'schema') {
    renderSchema();
  }
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error('Não foi possível conectar ao backend Python. Verifique se o servidor está ativo.');
  }
  const payload = await response.json();
  if (!response.ok) {
    const err = new Error(payload.error?.message || 'Falha na resposta do servidor Python.');
    throw Object.assign(err, payload.error);
  }
  return payload;
}

async function run() {
  if ($('#run').disabled) return;
  const request = ++requestSequence;
  const sql = $('#sql').value;

  $('#error').hidden = true;
  $('#status').classList.remove('pending');
  $('#status').textContent = 'Processando consulta no motor Python...';
  $('#run').disabled = true;
  $('#run').innerHTML = '<span>Processando...</span>';
  $('#export').disabled = true;

  try {
    const result = await requestJson('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql })
    });

    if (request !== requestSequence) return;
    analysis = result;
    lastSql = sql;

    $('#status').textContent = 'Consulta processada com sucesso: álgebra, árvore canônica e plano calculados.';

    const changed = $('#sql').value !== sql;
    $('#export').disabled = changed;
    if (changed) {
      $('#status').classList.add('pending');
      $('#status').textContent = 'Consulta alterada no editor: execute novamente para atualizar.';
    }

    renderMetrics();

    if (['schema', 'deliveries'].includes(activeTab)) {
      switchTab('graph');
    } else {
      renderPanel();
    }
  } catch (error) {
    if (request !== requestSequence) return;
    analysis = null;
    $('#export').disabled = true;
    $('#metrics').innerHTML = '';
    $('#status').textContent = 'A consulta contém erros e precisa de correção.';
    $('#error').hidden = false;

    if (typeof error.position === 'number') {
      const position = Math.max(0, Math.min(error.position, sql.length));
      const before = sql.slice(0, position);
      const line = error.line ?? (before.split('\n').length);
      const column = error.column ?? (before.length - before.lastIndexOf('\n'));
      $('#error').innerHTML = `<strong>Falha na validação da consulta</strong>${escape(error.message)} <span class="error-loc">(linha ${line}, coluna ${column})</span>`;
      $('#sql').setSelectionRange(position, position);
      $('#sql').focus();
    } else {
      $('#error').innerHTML = `<strong>Erro na requisição</strong>${escape(error.message || 'Falha de comunicação com o servidor.')}`;
    }

    renderPanel();
  } finally {
    if (request === requestSequence) {
      $('#run').disabled = false;
      $('#run').innerHTML = '<span class="btn-icon" aria-hidden="true">▶</span><span>Executar</span><kbd class="key-hint">Ctrl+Enter</kbd>';
    }
  }
}

$('#run').addEventListener('click', run);

$('#sql').addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    run();
  }
});

// Atalho global Ctrl+S / Cmd+S para exportar análise
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (!$('#export').disabled && analysis) {
      exportAnalysis();
    }
  }
});

$('#sql').addEventListener('input', () => {
  const isDirty = $('#sql').value !== lastSql;
  if (isDirty && analysis) {
    $('#status').classList.add('pending');
    $('#status').textContent = 'Consulta modificada: pressione Ctrl+Enter para reprocessar.';
    $('#export').disabled = true;
  }
});

// Seletor de exemplos de consulta
$('#example').addEventListener('change', () => {
  const index = parseInt($('#example').value, 10);
  if (!Number.isNaN(index) && examples[index]) {
    $('#sql').value = examples[index].sql;
    run();
  }
});

function exportAnalysis() {
  if (!analysis) return;
  const data = JSON.stringify(analysis, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'analise-consulta.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

$('#export').addEventListener('click', exportAnalysis);

function switchTab(targetTab) {
  activeTab = targetTab;
  document.querySelectorAll('.tabs button[role="tab"]').forEach(btn => {
    const isSelected = btn.dataset.tab === activeTab;
    btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    btn.tabIndex = isSelected ? 0 : -1;
  });
  renderPanel();
}

$('.tabs').addEventListener('click', event => {
  const button = event.target.closest('[data-tab]');
  if (button) switchTab(button.dataset.tab);
});

$('.tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...document.querySelectorAll('[role=tab]')];
  const index = buttons.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  switchTab(buttons[next].dataset.tab);
  buttons[next].focus();
});

function renderMetrics() {
  if (!analysis?.query) {
    $('#metrics').innerHTML = '';
    return;
  }
  const items = [
    ['Tabelas', analysis.query.tables.length],
    ['Operadores', analysis.graph?.nodes?.length ?? 0],
    ['Passos do Plano', analysis.plan?.steps?.length ?? 0],
    ['Tuplas Resultantes', analysis.result?.rowCount ?? 0],
  ];
  $('#metrics').innerHTML = items.map(([label, value]) => `
    <div class="telemetry-item">
      <span class="telemetry-label">${label}:</span>
      <span class="telemetry-val">${number(value)}</span>
    </div>
  `).join('');
}

function heading(title, subtitle) {
  return `<div class="panel-heading"><h2>${title}</h2><p>${subtitle}</p></div>`;
}

function renderPanel() {
  if (activeTab === 'schema') return renderSchema();
  if (activeTab === 'deliveries') return renderDeliveries();
  if (!analysis) {
    $('#panel').innerHTML = '<div class="empty-state">Escreva ou selecione uma consulta SQL válida e clique em Executar para inspecionar os artefatos gerados.</div>';
    return;
  }
  if (activeTab === 'graph') renderGraph();
  else if (activeTab === 'algebra') renderAlgebra();
  else if (activeTab === 'plan') renderPlan();
  else if (activeTab === 'results') renderResults();
  else if (activeTab === 'parser') renderParser();
}

// -----------------------------------------------------------------------------
// Visualização 1: Árvore de Operadores (Grafo Canônico Não Otimizado)
// -----------------------------------------------------------------------------
function renderGraph() {
  const graph = analysis.graph;
  if (!graph || !graph.nodes) {
    $('#panel').innerHTML = '<div class="empty-state">Grafo de operadores indisponível.</div>';
    return;
  }

  const nodeMap = Object.fromEntries(graph.nodes.map(n => [n.id, n]));

  function renderTreeBranch(nodeId) {
    const node = nodeMap[nodeId];
    if (!node) return '';

    const badgeClass = `op-badge-${node.type}`;
    const cardHtml = `
      <div class="tree-node-card ${node.type === 'scan' ? 'is-leaf' : ''}" id="tree-node-${node.id}">
        <div class="node-badge-col">
          <span class="node-symbol ${badgeClass}" title="Operador: ${escape(node.name)}">${escape(node.symbol)}</span>
        </div>
        <div class="node-main-col">
          <div class="node-header-line">
            <span class="node-type-label">${escape(node.name)}</span>
            <span class="node-count-badge">${number(node.tuplesCount ?? 0)} tuplas</span>
          </div>
          <div class="node-predicate-line">
            <code>${escape(node.predicate || node.label)}</code>
          </div>
          <div class="node-meta-line" title="${escape((node.outputColumns || []).join(', '))}">
            ${escape((node.outputColumns || []).length)} atributos intermediários
          </div>
        </div>
      </div>
    `;

    if (!node.children || node.children.length === 0) {
      return `<div class="tree-leaf-wrapper">${cardHtml}</div>`;
    }

    if (node.children.length === 1) {
      const child = nodeMap[node.children[0]];
      return `
        <div class="tree-subtree unary-subtree">
          ${cardHtml}
          <div class="tree-connector" aria-hidden="true">
            <span class="connector-line"></span>
            <span class="connector-telemetry">▲ ${number(child?.tuplesCount ?? 0)} tuplas</span>
            <span class="connector-line"></span>
          </div>
          <div class="tree-children single-child">
            ${renderTreeBranch(node.children[0])}
          </div>
        </div>
      `;
    }

    // Junção binária ou Produto cartesiano (2 ramos)
    const leftChild = nodeMap[node.children[0]];
    const rightChild = nodeMap[node.children[1]];

    return `
      <div class="tree-subtree binary-subtree">
        ${cardHtml}
        <div class="tree-connector binary-fork-connector" aria-hidden="true">
          <span class="connector-line"></span>
          <span class="connector-telemetry">▲ combinação relacional</span>
          <span class="connector-line"></span>
        </div>
        <div class="tree-branches-grid">
          <div class="tree-branch-col branch-left">
            <div class="branch-label">
              <span>Ramo Esquerdo (${number(leftChild?.tuplesCount ?? 0)} tuplas)</span>
            </div>
            ${renderTreeBranch(node.children[0])}
          </div>
          <div class="tree-branch-col branch-right">
            <div class="branch-label">
              <span>Ramo Direito (${number(rightChild?.tuplesCount ?? 0)} tuplas)</span>
            </div>
            ${renderTreeBranch(node.children[1])}
          </div>
        </div>
      </div>
    `;
  }

  $('#panel').innerHTML = heading('Árvore de Operadores (Grafo Canônico Não Otimizado)', 'Estrutura algébrica em árvore: folhas representam leituras de tabelas e nós intermediários realizam junções, filtros e projeções.') + `
    <div class="graph-container">
      <div class="graph-legend">
        <span class="legend-title">Convenção do fluxo de dados:</span>
        <div class="legend-tags">
          <span class="legend-tag"><b class="op-badge-proj">π</b> Projeção</span>
          <span class="legend-tag"><b class="op-badge-sel">σ</b> Seleção</span>
          <span class="legend-tag"><b class="op-badge-join">⋈</b> Junção</span>
          <span class="legend-tag"><b class="op-badge-prod">×</b> Produto Cartesiano</span>
          <span class="legend-tag"><b class="op-badge-scan">▤</b> Varredura (Scan)</span>
        </div>
      </div>

      <div class="tree-viewport" role="region" aria-label="Visualização em árvore do grafo de operadores">
        ${renderTreeBranch(graph.rootId)}
      </div>

      <div class="technical-footnote">
        <strong>Estratégia Canônica:</strong> As tabelas são varridas na base, unidas por produtos ou junções teta, filtradas pela seleção do WHERE e restringidas pela projeção final. As próximas entregas (22/10 e 27/10) aplicarão heurísticas para empurrar seleções e projeções para as folhas.
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 2: Álgebra Relacional Canônica
// -----------------------------------------------------------------------------
function renderAlgebra() {
  const algebra = analysis.algebra;
  if (!algebra) {
    $('#panel').innerHTML = '<div class="empty-state">Álgebra relacional indisponível.</div>';
    return;
  }

  const formulaText = algebra[algebraFormat] || algebra.unicode;

  // Formatação com destaques tipográficos para operadores
  const highlighted = escape(formulaText)
    .replace(/(π|PI)/g, '<span class="sym-proj">$1</span>')
    .replace(/(σ|SIGMA)/g, '<span class="sym-sel">$1</span>')
    .replace(/(⋈|JOIN)/g, '<span class="sym-join">$1</span>')
    .replace(/(×|CROSS)/g, '<span class="sym-prod">$1</span>');

  const components = [
    ['Projeção (π)', algebra.columns.join(', '), 'Atributos mantidos na relação resultante final'],
    ['Seleção (σ)', analysis.query.where ? analysis.query.predicateLabels.join(' ∧ ') : 'Sem predicado WHERE', 'Filtro de restrição booleano aplicado às tuplas'],
    ['Relações (FROM/JOIN)', analysis.query.tables.map(t => `${t.table} AS ${t.alias}`).join(', '), 'Tabelas base do catálogo BD_Vendas lidas da base'],
    ['Operações Binárias', algebra.joinCount > 0 ? `${algebra.joinCount} junção(ões) / produto(s)` : 'Consulta sobre relação unária', 'Combinações horizontais na árvore canônica'],
  ];

  $('#panel').innerHTML = heading('Expressão em Álgebra Relacional Canônica', 'Conversão matemática rigorosa da consulta SQL para a notação relacional formal de Codd.') + `
    <div class="algebra-container">
      <div class="formula-card">
        <div class="formula-card-header">
          <span class="formula-title">Expressão Formal</span>
          <div class="format-toggle" role="group" aria-label="Formato de exibição da álgebra">
            <button class="toggle-btn ${algebraFormat === 'unicode' ? 'active' : ''}" data-format="unicode">Unicode</button>
            <button class="toggle-btn ${algebraFormat === 'latex' ? 'active' : ''}" data-format="latex">LaTeX</button>
            <button class="toggle-btn ${algebraFormat === 'ascii' ? 'active' : ''}" data-format="ascii">ASCII</button>
          </div>
        </div>

        <div class="formula-display" tabindex="0" aria-label="Expressão matemática da álgebra relacional">${highlighted}</div>

        <div class="formula-actions">
          <button id="copy-algebra-btn" class="btn btn-secondary" type="button">
            <span>Copiar Expressão</span>
          </button>
          <span id="copy-status" class="copy-feedback" hidden>Copiado para a área de transferência!</span>
        </div>
      </div>

      <div class="algebra-grid">
        ${components.map(([title, val, desc]) => `
          <div class="algebra-meta-card">
            <h3>${escape(title)}</h3>
            <div class="meta-content"><code>${escape(val)}</code></div>
            <p class="meta-desc">${escape(desc)}</p>
          </div>
        `).join('')}
      </div>

      <div class="technical-footnote">
        A álgebra canônica segue a ordem estrita: primeiro realiza o produto cartesiano ou junção de todas as relações no FROM, aplica a seleção do WHERE sobre o conjunto resultante e projeta apenas os atributos especificados no SELECT.
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 3: Ordem de Execução (Plano Bottom-Up)
// -----------------------------------------------------------------------------
function renderPlan() {
  const plan = analysis.plan;
  if (!plan || !plan.steps) {
    $('#panel').innerHTML = '<div class="empty-state">Plano de execução indisponível.</div>';
    return;
  }

  $('#panel').innerHTML = heading('Ordem de Execução da Consulta (Plano Físico)', 'Sequência determinística calculada a partir do percurso pós-ordem (bottom-up) na árvore de operadores.') + `
    <div class="plan-wrapper">
      <table class="technical-table">
        <thead>
          <tr>
            <th style="width: 54px;">Passo</th>
            <th style="width: 140px;">Operador</th>
            <th>Ação Executada</th>
            <th>Predicado / Expressão</th>
            <th>Relações (Entrada ➔ Saída)</th>
            <th style="width: 130px; text-align: right;">Tuplas Emitidas</th>
          </tr>
        </thead>
        <tbody>
          ${plan.steps.map(step => `
            <tr>
              <td><span class="step-badge">${step.step}</span></td>
              <td><span class="op-glyph op-badge-${step.type}">${step.operator}</span> <strong>${escape(step.name)}</strong></td>
              <td>${escape(step.operation)}</td>
              <td><code>${escape(step.predicate || '—')}</code></td>
              <td><span class="flow-step">${escape(step.input)} ➔ <strong>${escape(step.output)}</strong></span></td>
              <td style="text-align: right;"><span class="tuple-counter">${number(step.rowsProduced)} tuplas</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="technical-footnote">
      Cada nó folha alimenta suas tuplas para o nó pai imediatamente superior. Operadores binários combinam dois fluxos intermediários já processados.
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 4: Resultado da Consulta (Dados Avaliados)
// -----------------------------------------------------------------------------
function renderResults() {
  const result = analysis.result;
  if (!result || !result.columns) {
    $('#panel').innerHTML = '<div class="empty-state">Nenhum resultado disponível para exibição.</div>';
    return;
  }

  if (result.rows.length === 0) {
    $('#panel').innerHTML = heading('Resultado da Consulta', 'Registros obtidos a partir do processamento do plano de consulta.') + `
      <div class="empty-state" style="padding: 40px 16px;">
        <span style="font-size: 28px; display: block; margin-bottom: 8px;">∅</span>
        Nenhum registro satisfeito pelo predicado informado sobre a base BD_Vendas de exemplo.
      </div>
    `;
    return;
  }

  $('#panel').innerHTML = heading(`Resultado da Consulta (${result.rowCount} registros)`, 'Tuplas finais produzidas pela execução do plano sobre o catálogo de exemplo BD_Vendas.') + `
    <div class="results-wrapper">
      <table class="technical-table data-grid">
        <thead>
          <tr>
            <th style="width: 44px; color: var(--text-dim);">#</th>
            ${result.columns.map(col => `<th>${escape(col)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${result.rows.map((row, idx) => `
            <tr>
              <td class="row-num">${idx + 1}</td>
              ${row.map(val => {
                if (val === null || val === undefined) {
                  return `<td><span class="null-indicator">NULL</span></td>`;
                }
                if (typeof val === 'number') {
                  return `<td class="num-cell">${number(val)}</td>`;
                }
                return `<td>${escape(val)}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="technical-footnote">
      Os dados apresentados foram avaliados em memória pelo executor em Python utilizando os registros didáticos de BD_Vendas.
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 5: Parser & Validação Semântica
// -----------------------------------------------------------------------------
function renderParser() {
  const query = analysis.query;
  const predicates = query.predicateLabels;

  $('#panel').innerHTML = heading('Componentes da Consulta (Parser & Validação)', 'Tokens léxicos, relações resolvidas e predicados validados contra o catálogo BD_Vendas.') + `
    <div class="parser-columns">
      <div class="parser-card">
        <h3>Estrutura Semântica Resolvida</h3>
        <dl class="semantic-dl">
          <div>
            <dt>Projeção (SELECT)</dt>
            <dd><code>${escape(query.columns.map(c => c.key).join(', '))}</code></dd>
          </div>
          <div>
            <dt>Relações Declaradas (FROM / JOIN)</dt>
            <dd><code>${escape(query.tables.map(t => `${t.table} AS ${t.alias}`).join(', '))}</code></dd>
          </div>
          <div>
            <dt>Predicados de Seleção e Junção</dt>
            <dd><code>${escape(predicates.join(' AND ') || 'Nenhum predicado declarado')}</code></dd>
          </div>
          <div>
            <dt>Integridade do Catálogo</dt>
            <dd>Todas as tabelas e atributos existem em BD_Vendas e foram verificados sem ambiguidade.</dd>
          </div>
        </dl>
      </div>

      <div class="parser-card">
        <h3>Tokens Léxicos Identificados (${query.tokens.length})</h3>
        <div class="token-container">
          ${query.tokens.map(token => `
            <span class="token-pill" tabindex="0" title="Tipo: ${escape(token.type)} | Offset: ${token.position}">
              ${escape(token.type === 'string' ? "'" + token.value + "'" : token.value)}
            </span>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="technical-footnote">
      Gramática reconhecida: SELECT, FROM, INNER JOIN ... ON, WHERE, AND, aliases com ou sem AS, *, parênteses e operadores de comparação (=, &gt;, &lt;, &lt;=, &gt;=, &lt;&gt;).
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 6: Esquema BD_Vendas
// -----------------------------------------------------------------------------
function renderSchema() {
  $('#panel').innerHTML = heading('Catálogo BD_Vendas (10 Tabelas)', 'Modelo relacional didático utilizado para validação de escopo, tipos e integridade referencial.') + `
    <div class="schema-layout">
      ${Object.entries(schema).map(([table, columns]) => `
        <article id="schema-${escape(table)}" class="schema-table-card ${selectedTable === table ? 'is-selected' : ''}" tabindex="0" role="button" aria-pressed="${selectedTable === table ? 'true' : 'false'}">
          <div class="schema-card-head">
            <span class="table-name">${escape(table)}</span>
            <span class="table-rows-tag">${escape(sampleCounts[table] ?? 0)} tuplas</span>
          </div>
          <ul class="schema-col-list">
            ${columns.map((column, idx) => `
              <li class="${idx === 0 ? 'is-pk' : ''}">
                <span class="col-glyph">${idx === 0 ? '🔑' : '•'}</span>
                <span class="col-name">${escape(column)}</span>
              </li>
            `).join('')}
          </ul>
        </article>
      `).join('')}
    </div>
    <div class="technical-footnote">
      Os dados foram carregados da base didática em memória. O script DDL correspondente para MySQL encontra-se em <code>sql/bd-vendas.sql</code>.
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 7: Requisitos da Disciplina
// -----------------------------------------------------------------------------
function renderDeliveries() {
  const deliveries = [
    [1, '15/10/2026', 'Interface gráfica existente e funcional', 'Editor SQL, exemplos, navegação e exportação JSON'],
    [1, '15/10/2026', 'A string é parseada', 'Lexer, parser e estrutura validada da consulta'],
    [1, '15/10/2026', 'Campos e comandos errados são validados', 'Erros sintáticos, catálogo, ambiguidade, aliases e escopo'],
    [2, '20/10/2026', 'Conversão para álgebra relacional', 'Expressão canônica em Unicode, LaTeX e componentes'],
    [2, '20/10/2026', 'Grafo não otimizado', 'Árvore de operadores em memória, visualização e plano de execução'],
    [3, '22/10/2026', 'Heurísticas de projeção e seleção', 'Filtros e redução de atributos antecipados'],
    [4, '27/10/2026', 'Demais heurísticas', 'Seletividade, ordem das relações e conversão de produto em junção'],
  ];

  $('#panel').innerHTML = heading('Requisitos da Disciplina: Banco de Dados II', 'Matriz de entregas conforme as especificações do trabalho prático.') + `
    <div class="plan-wrapper">
      <table class="technical-table">
        <thead>
          <tr>
            <th style="width: 100px;">Prazo</th>
            <th style="width: 260px;">Requisito</th>
            <th>Descrição Técnica</th>
            <th style="width: 110px;">Situação</th>
          </tr>
        </thead>
        <tbody>
          ${deliveries.map(([delivery, date, title, description]) => `
            <tr>
              <td class="date-col">${date}</td>
              <td><strong>${escape(title)}</strong></td>
              <td>${escape(description)}</td>
              <td><span class="status-badge ${delivery <= 2 ? 'is-done' : 'is-upcoming'}">${delivery <= 2 ? 'Disponível' : 'Etapa futura'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="technical-footnote">
      A entrega 2 (20/10/2026) contempla formalmente a conversão para álgebra relacional canônica, a construção do grafo de operadores não otimizado, o plano sequencial de execução e a exibição de resultados em tabela.
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Inicialização do Workbench
// -----------------------------------------------------------------------------
async function initialize() {
  $('#run').disabled = true;
  $('#status').textContent = 'Conectando ao catálogo didático do motor Python...';
  try {
    const catalog = await requestJson('/api/catalog');
    ({ schema, sampleCounts, examples } = catalog);

    $('#example').innerHTML = '<option value="">Carregar exemplo de consulta...</option>' +
      examples.map((example, index) => `<option value="${index}">${escape(example.name)}</option>`).join('');

    $('#table-nav').innerHTML = Object.keys(schema).map(table => `
      <button data-table="${escape(table)}" type="button" title="Inspecionar tabela ${escape(table)}">
        <span class="nav-icon">▤</span>
        <span class="nav-table-name">${escape(table)}</span>
        <span class="nav-count">${schema[table].length}</span>
      </button>
    `).join('');

    const countElem = $('#catalog-count');
    if (countElem) countElem.textContent = `${Object.keys(schema).length} tabelas`;

    $('#run').disabled = false;

    // Carrega o segundo exemplo (Produtos e categorias) por padrão
    if (examples[1]) {
      $('#sql').value = examples[1].sql;
      $('#example').value = '1';
      await run();
    }
  } catch (error) {
    $('#status').textContent = 'Servidor Python indisponível.';
    $('#error').hidden = false;
    $('#error').innerHTML = `
      <strong>Não foi possível conectar ao catálogo</strong>
      ${escape(error.message)}
      <br><button id="retry-btn" class="btn btn-secondary" style="margin-top: 8px;">Tentar novamente</button>
    `;
    $('#retry-btn')?.addEventListener('click', initialize);
  }
}

initialize();
