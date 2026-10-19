// QueryLab: Interface de controle e renderização em JavaScript.
// Entrega 2 (20/10/2026): Álgebra Relacional, Grafo de Operadores e Ordem de Execução.

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

// Clique nos cards do esquema para seleção mútua
$('#panel').addEventListener('click', event => {
  const card = event.target.closest('.schema-card');
  if (card) {
    const table = card.id.replace('schema-', '');
    selectTable(selectedTable === table ? null : table);
    return;
  }

  // Trocador de formato da Álgebra Relacional
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
    throw new Error('Não foi possível conectar ao backend Python. Verifique se o servidor local está ativo.');
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
  $('#status').textContent = 'Processando consulta no Python (álgebra, grafo e plano)...';
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

    $('#status').textContent = 'Consulta válida: álgebra relacional, grafo canônico e plano gerados.';
    $('.pipeline-card').classList.add('complete');

    const changed = $('#sql').value !== sql;
    $('#export').disabled = changed;
    if (changed) {
      $('#status').classList.add('pending');
      $('#status').textContent = 'Consulta alterada: clique em Executar para atualizar.';
    }

    renderMetrics();

    // Mantém a aba ativa se for de visualização de resultados, senão vai para o grafo
    if (['schema', 'deliveries'].includes(activeTab)) {
      switchTab('graph');
    } else {
      renderPanel();
    }
  } catch (error) {
    if (request !== requestSequence) return;
    analysis = null;
    $('.pipeline-card').classList.remove('complete');
    $('#export').disabled = true;
    $('#metrics').innerHTML = '';
    $('#status').textContent = 'A consulta precisa de correção.';
    $('#error').hidden = false;

    if (typeof error.position === 'number') {
      const position = Math.max(0, Math.min(error.position, sql.length));
      const before = sql.slice(0, position);
      const line = error.line ?? (before.split('\n').length);
      const column = error.column ?? (before.length - before.lastIndexOf('\n'));
      $('#error').innerHTML = `<strong>Falha na validação da consulta</strong>${escape(error.message)} <span>(linha ${line}, coluna ${column})</span>`;
      $('#sql').setSelectionRange(position, position);
      $('#sql').focus();
    } else {
      $('#error').innerHTML = `<strong>Erro na requisição</strong>${escape(error.message || 'Falha de comunicação com o servidor.')}`;
    }

    renderPanel();
  } finally {
    if (request === requestSequence) {
      $('#run').disabled = false;
      $('#run').innerHTML = '<span>Executar</span> <kbd class="key-hint">Ctrl+Enter</kbd>';
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
  if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
    event.preventDefault();
    if (analysis && !$('#export').disabled) {
      exportAnalysis();
    }
  }
});

$('#sql').addEventListener('input', () => {
  $('#error').hidden = true;
  $('.pipeline-card').classList.remove('complete');
  $('#status').classList.add('pending');
  $('#status').textContent = 'Consulta alterada: clique em Executar para atualizar.';
  $('#export').disabled = true;
  if ($('#example')) $('#example').value = '';
});

$('#example').addEventListener('change', event => {
  if (event.target.value === '') return;
  const idx = Number(event.target.value);
  if (examples[idx]) {
    $('#sql').value = examples[idx].sql;
    run();
  }
});

function exportAnalysis() {
  if (!analysis) return;
  download('analise-consulta.json', JSON.stringify({ sql: lastSql, ...analysis }, null, 2), 'application/json');
}

$('#export').addEventListener('click', exportAnalysis);

function download(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 100);
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('[role=tab]').forEach(button => {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  $('#panel').setAttribute('aria-labelledby', `tab-${tab}`);
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
  const metrics = [
    ['Tabelas', analysis.query.tables.length, 'No catálogo BD_Vendas'],
    ['Operadores', analysis.graph?.nodes?.length ?? 0, 'Nós na árvore canônica'],
    ['Passos do Plano', analysis.plan?.steps?.length ?? 0, 'Ordem de execução'],
    ['Tuplas Resultantes', analysis.result?.rowCount ?? 0, 'Registros filtrados'],
  ];
  $('#metrics').innerHTML = metrics.map(([label, value, description]) => `
    <div class="metric">
      <span class="metric-label">${label}</span>
      <span class="metric-value">${number(value)}</span>
      <span class="metric-foot">${description}</span>
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
    $('#panel').innerHTML = '<div class="empty">Insira ou selecione uma consulta SQL válida para inspecionar os componentes.</div>';
    return;
  }
  if (activeTab === 'graph') renderGraph();
  else if (activeTab === 'algebra') renderAlgebra();
  else if (activeTab === 'plan') renderPlan();
  else if (activeTab === 'results') renderResults();
  else if (activeTab === 'parser') renderParser();
}

// -----------------------------------------------------------------------------
// Visualização 1: Grafo de Operadores (Árvore Canônica)
// -----------------------------------------------------------------------------
function renderGraph() {
  const graph = analysis.graph;
  if (!graph || !graph.nodes) {
    $('#panel').innerHTML = '<div class="empty">Grafo de operadores indisponível nesta etapa.</div>';
    return;
  }

  const nodeMap = Object.fromEntries(graph.nodes.map(n => [n.id, n]));

  function renderNode(nodeId) {
    const node = nodeMap[nodeId];
    if (!node) return '';

    const badgeClass = `badge-${node.type}`;
    const cardHtml = `
      <div class="flow-node-card">
        <span class="node-glyph ${badgeClass}">${escape(node.symbol)}</span>
        <div class="node-content">
          <div class="node-title-row">
            <span class="node-op-name">${escape(node.name)}</span>
            <span class="node-tuples">${number(node.tuplesCount ?? 0)} tuplas</span>
          </div>
          <div class="node-expression"><code>${escape(node.predicate || node.label)}</code></div>
          <div class="node-schema-cols" title="${escape((node.outputColumns || []).join(', '))}">
            ${escape((node.outputColumns || []).length)} atributos intermediários
          </div>
        </div>
      </div>
    `;

    if (!node.children || node.children.length === 0) {
      return cardHtml;
    }

    if (node.children.length === 1) {
      const child = nodeMap[node.children[0]];
      return `
        ${cardHtml}
        <div class="flow-arrow-down" aria-hidden="true">
          <div class="arrow-line"></div>
          <span class="arrow-label">↑ ${number(child?.tuplesCount ?? 0)} tuplas intermediárias</span>
          <div class="arrow-line"></div>
        </div>
        ${renderNode(node.children[0])}
      `;
    }

    // Junção binária ou Produto cartesiano (2 ramos)
    const leftChild = nodeMap[node.children[0]];
    const rightChild = nodeMap[node.children[1]];

    return `
      ${cardHtml}
      <div class="flow-arrow-down" aria-hidden="true">
        <div class="arrow-line"></div>
        <span class="arrow-label">↑ combinação binária de relações</span>
      </div>
      <div class="join-branches-row">
        <div class="join-branch">
          <span class="arrow-label" style="font-family: var(--font-mono); font-size: 10px; color: var(--text-muted);">
            Ramo Esquerdo (${number(leftChild?.tuplesCount ?? 0)} tuplas)
          </span>
          ${renderNode(node.children[0])}
        </div>
        <div class="join-branch">
          <span class="arrow-label" style="font-family: var(--font-mono); font-size: 10px; color: var(--text-muted);">
            Ramo Direito (${number(rightChild?.tuplesCount ?? 0)} tuplas)
          </span>
          ${renderNode(node.children[1])}
        </div>
      </div>
    `;
  }

  $('#panel').innerHTML = heading('Grafo de Operadores (Árvore Canônica Não Otimizada)', 'Representação interna em árvore da consulta, com nós de operadores e arestas indicando o fluxo de dados intermediários.') + `
    <div class="graph-wrapper">
      <div class="graph-legend-row">
        <span><b>Convenção:</b> Direção do fluxo de dados ascende das folhas (tabelas) em direção à raiz (projeção final).</span>
        <div class="graph-legend-items">
          <span class="legend-badge"><b class="badge-proj">π</b> Projeção</span>
          <span class="legend-badge"><b class="badge-sel">σ</b> Seleção</span>
          <span class="legend-badge"><b class="badge-join">⋈</b> Junção</span>
          <span class="legend-badge"><b class="badge-prod">×</b> Produto Cartesiano</span>
          <span class="legend-badge"><b class="badge-scan">▤</b> Varredura</span>
        </div>
      </div>

      <div class="tree-flow" role="region" aria-label="Visualização em árvore do grafo de operadores">
        ${renderNode(graph.rootId)}
      </div>

      <p class="note">
        Esta árvore representa a estratégia canônica inicial. Nas entregas seguintes (22/10 e 27/10), as heurísticas de otimização empurrarão as seleções e projeções para as folhas e reordenarão as relações.
      </p>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 2: Álgebra Relacional
// -----------------------------------------------------------------------------
function renderAlgebra() {
  const algebra = analysis.algebra;
  if (!algebra) {
    $('#panel').innerHTML = '<div class="empty">Álgebra relacional indisponível.</div>';
    return;
  }

  const formulaText = algebra[algebraFormat] || algebra.unicode;

  // Formatação para visualização estilizada
  const highlighted = escape(formulaText)
    .replace(/(π|PI)/g, '<span class="op-proj">$1</span>')
    .replace(/(σ|SIGMA)/g, '<span class="op-sel">$1</span>')
    .replace(/(⋈|JOIN)/g, '<span class="op-join">$1</span>')
    .replace(/(×|CROSS)/g, '<span class="op-prod">$1</span>');

  const components = [
    ['Projeção (π)', algebra.columns.join(', '), 'Atributos selecionados na consulta final'],
    ['Seleção (σ)', analysis.query.where ? analysis.query.predicateLabels.join(' ∧ ') : 'Sem filtro WHERE', 'Condições para redução de tuplas'],
    ['Relações (FROM/JOIN)', analysis.query.tables.map(t => `${t.table} AS ${t.alias}`).join(', '), 'Tabelas base lidas do catálogo'],
    ['Operadores Binários', algebra.joinCount > 0 ? `${algebra.joinCount} junção(ões) / produto(s)` : 'Consulta unária (1 tabela)', 'Combinação horizontal de relações'],
  ];

  $('#panel').innerHTML = heading('Expressão em Álgebra Relacional Canônica', 'Conversão matemática formal da consulta SQL para a teoria relacional de Codd.') + `
    <div class="algebra-box">
      <div class="algebra-math-card">
        <div class="algebra-header">
          <strong>Fórmula Formal Canônica</strong>
          <div class="algebra-format-buttons" role="group" aria-label="Alternar formato da álgebra">
            <button class="format-btn ${algebraFormat === 'unicode' ? 'active' : ''}" data-format="unicode">Unicode</button>
            <button class="format-btn ${algebraFormat === 'latex' ? 'active' : ''}" data-format="latex">LaTeX</button>
            <button class="format-btn ${algebraFormat === 'ascii' ? 'active' : ''}" data-format="ascii">ASCII</button>
          </div>
        </div>

        <div class="algebra-formula" tabindex="0" aria-label="Expressão da álgebra relacional">${highlighted}</div>

        <div class="algebra-actions">
          <button id="copy-algebra-btn" class="btn btn-ghost" type="button">
            <span>Copiar Expressão</span>
          </button>
          <span id="copy-status" class="copy-badge" hidden>Copiado com sucesso!</span>
        </div>
      </div>

      <div class="parser-grid">
        ${components.map(([title, val, desc]) => `
          <div class="detail-card">
            <h3>${escape(title)}</h3>
            <p style="margin: 0 0 4px; font-family: var(--font-mono); font-size: 12px; color: var(--text-primary); word-break: break-word;">${escape(val)}</p>
            <small style="color: var(--text-muted); font-size: 10px;">${escape(desc)}</small>
          </div>
        `).join('')}
      </div>

      <p class="note">A expressão canônica aplica o produto ou junção nas relações de entrada, filtra as tuplas via seleção e restringe os atributos via projeção.</p>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 3: Ordem de Execução (Plano)
// -----------------------------------------------------------------------------
function renderPlan() {
  const plan = analysis.plan;
  if (!plan || !plan.steps) {
    $('#panel').innerHTML = '<div class="empty">Plano de execução indisponível.</div>';
    return;
  }

  $('#panel').innerHTML = heading('Ordem de Execução da Consulta (Plano)', 'Sequência determinística calculada pelo processador simples de consultas a partir do percurso pós-ordem no grafo de operadores.') + `
    <div class="plan-table-container">
      <table>
        <thead>
          <tr>
            <th style="width: 50px;">Passo</th>
            <th style="width: 140px;">Operador</th>
            <th>Operação Realizada</th>
            <th>Predicado / Atributos</th>
            <th>Fluxo de Dados</th>
            <th style="width: 130px; text-align: right;">Tuplas Geradas</th>
          </tr>
        </thead>
        <tbody>
          ${plan.steps.map(step => `
            <tr>
              <td><span class="step-num-pill">${step.step}</span></td>
              <td><b class="step-glyph badge-${step.type}">${step.operator}</b> <strong>${escape(step.name)}</strong></td>
              <td>${escape(step.operation)}</td>
              <td><code>${escape(step.predicate || '—')}</code></td>
              <td><span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">${escape(step.input)} ➔ <strong>${escape(step.output)}</strong></span></td>
              <td style="text-align: right;"><span class="step-tuples-badge">${number(step.rowsProduced)} tuplas</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p class="note">Ordem bottom-up: folhas são lidas sequencialmente, combinadas através de junções ou produtos cartesianos, filtradas por seleções e projetadas para retorno final.</p>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 4: Resultado da Consulta (Dados)
// -----------------------------------------------------------------------------
function renderResults() {
  const result = analysis.result;
  if (!result || !result.columns) {
    $('#panel').innerHTML = '<div class="empty">Nenhum resultado disponível para exibição.</div>';
    return;
  }

  if (result.rows.length === 0) {
    $('#panel').innerHTML = heading('Resultado da Consulta', 'Registros obtidos a partir do processamento do plano de consulta.') + `
      <div class="empty" style="padding: 32px 16px;">
        <span style="font-size: 24px; display: block; margin-bottom: 8px;">∅</span>
        Nenhum registro satisfeito pelas condições informadas sobre a base de dados de exemplo.
      </div>
    `;
    return;
  }

  $('#panel').innerHTML = heading(`Resultado da Consulta (${result.rowCount} registros)`, 'Tuplas finais produzidas pela execução do plano sobre o catálogo de exemplo BD_Vendas.') + `
    <div class="results-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px; color: var(--text-dim);">#</th>
            ${result.columns.map(col => `<th>${escape(col)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${result.rows.map((row, idx) => `
            <tr>
              <td style="font-family: var(--font-mono); font-size: 10px; color: var(--text-dim);">${idx + 1}</td>
              ${row.map(val => {
                if (val === null || val === undefined) {
                  return `<td><span class="null-pill">NULL</span></td>`;
                }
                if (typeof val === 'number') {
                  return `<td style="font-family: var(--font-mono);">${number(val)}</td>`;
                }
                return `<td>${escape(val)}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p class="note">Os dados apresentados são avaliados dinamicamente em memória pelo processador em Python utilizando o catálogo didático local.</p>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 5: Parser & AST
// -----------------------------------------------------------------------------
function renderParser() {
  const query = analysis.query;
  const predicates = query.predicateLabels;

  $('#panel').innerHTML = heading('Componentes da Consulta (Parser & AST)', 'Tokens léxicos, relações resolvidas e predicados validados contra o catálogo.') + `
    <div class="parser-grid">
      <div class="detail-card">
        <h3>Estrutura Validada</h3>
        <dl>
          <div>
            <dt>Projeção (SELECT)</dt>
            <dd>${escape(query.columns.map(column => column.key).join(', '))}</dd>
          </div>
          <div>
            <dt>Relações (FROM / JOIN)</dt>
            <dd>${escape(query.tables.map(table => table.table + ' AS ' + table.alias).join(', '))}</dd>
          </div>
          <div>
            <dt>Condições (ON / WHERE)</dt>
            <dd>${escape(predicates.join(' AND ') || 'Sem predicados declarados')}</dd>
          </div>
          <div>
            <dt>Validação Semântica</dt>
            <dd>Tabelas existentes no catálogo, campos resolvidos sem ambiguidade e escopo de aliases verificado.</dd>
          </div>
        </dl>
      </div>

      <div class="detail-card">
        <h3>Análise Léxica (${query.tokens.length} tokens)</h3>
        <div class="token-list">
          ${query.tokens.map(token => `
            <span class="token" tabindex="0" title="Tipo: ${escape(token.type)} | Posição: ${token.position + 1}">
              ${escape(token.type === 'string' ? "'" + token.value + "'" : token.value)}
            </span>
          `).join('')}
        </div>
      </div>
    </div>
    <p class="note">
      Gramática suportada: SELECT, FROM, INNER JOIN ... ON, WHERE, AND, aliases com ou sem AS, *, parênteses e operadores de comparação (=, &gt;, &lt;, &lt;=, &gt;=, &lt;&gt;).
    </p>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 6: Esquema do Banco
// -----------------------------------------------------------------------------
function renderSchema() {
  $('#panel').innerHTML = heading('Catálogo BD_Vendas', 'As dez tabelas do modelo de dados utilizadas para validar referências e tipos.') + `
    <div class="schema-grid">
      ${Object.entries(schema).map(([table, columns]) => `
        <article id="schema-${escape(table)}" class="schema-card ${selectedTable === table ? 'selected' : ''}" tabindex="0" role="button" aria-pressed="${selectedTable === table ? 'true' : 'false'}">
          <h3>${escape(table)} <small>${escape(sampleCounts[table] ?? 0)} registros</small></h3>
          <ul>${columns.map(column => `<li>${escape(column)}</li>`).join('')}</ul>
        </article>
      `).join('')}
    </div>
    <p class="note">Os registros são exemplos didáticos locais. O script DDL correspondente para MySQL encontra-se em sql/bd-vendas.sql.</p>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 7: Cronograma de Entregas
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

  $('#panel').innerHTML = heading('Cronograma de Entregas', 'Requisitos da disciplina de Banco de Dados II (Trabalho Etapa 2).') + `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Prazo</th>
            <th>Requisito</th>
            <th>Descrição</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          ${deliveries.map(([delivery, date, title, description]) => `
            <tr>
              <td class="delivery-date">${date}</td>
              <td><strong>${title}</strong></td>
              <td>${description}</td>
              <td><span class="badge ${delivery <= 2 ? '' : 'pending'}">${delivery <= 2 ? 'Disponível' : 'Etapa futura'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p class="note">A entrega 2 (20/10/2026) contempla a conversão da consulta para álgebra relacional formal, construção do grafo de operadores não otimizado, geração da ordem de execução (plano) e exibição dos resultados.</p>
  `;
}

// -----------------------------------------------------------------------------
// Inicialização
// -----------------------------------------------------------------------------
async function initialize() {
  $('#run').disabled = true;
  $('#status').textContent = 'Conectando ao backend Python...';
  try {
    const catalog = await requestJson('/api/catalog');
    ({ schema, sampleCounts, examples } = catalog);

    $('#example').innerHTML = '<option value="">Carregar exemplo...</option>' +
      examples.map((example, index) => `<option value="${index}">${escape(example.name)}</option>`).join('');

    $('#table-nav').innerHTML = Object.keys(schema).map(table => `
      <button data-table="${escape(table)}" type="button">
        <span>▤</span>
        <span>${escape(table)}</span>
        <small>${schema[table].length}</small>
      </button>
    `).join('');

    const countElem = $('#catalog-count');
    if (countElem) countElem.textContent = Object.keys(schema).length;

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
      <strong>Não foi possível carregar o catálogo</strong>
      ${escape(error.message)}
      <br><button id="retry-btn" class="btn btn-ghost" style="margin-top: 8px;">Tentar novamente</button>
    `;
    $('#retry-btn')?.addEventListener('click', initialize);
  }
}

initialize();
