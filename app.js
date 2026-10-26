// Processador de Consultas: Interface de controle e inspeção técnica em JavaScript.
// Entrega final (27/10/2026): seleção, projeção e reordenação conectada de junções.

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = value => Number(value ?? 0).toLocaleString('pt-BR');

let schema = {}, sampleCounts = {}, examples = [], requestSequence = 0;
let analysis = null, activeTab = 'graph', selectedTable = null, lastSql = '';
let algebraFormat = 'unicode', algebraMode = 'optimized'; // 'optimized' | 'canonical'
let graphViewMode = 'optimized'; // 'optimized' | 'canonical' | 'comparison'
let planViewMode = 'optimized'; // 'optimized' | 'canonical'

// Navegação do catálogo pela barra lateral
$('#table-nav').addEventListener('click', event => {
  const button = event.target.closest('[data-table]');
  if (!button) return;
  selectTable(button.dataset.table);
});

// Delegação de cliques no painel principal
$('#panel').addEventListener('click', event => {
  // Seleção de card no esquema
  const card = event.target.closest('.schema-table-card');
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

  // Trocador de modo da Álgebra Relacional (Otimizada vs Canônica)
  const algebraModeBtn = event.target.closest('[data-algebra-mode]');
  if (algebraModeBtn) {
    algebraMode = algebraModeBtn.dataset.algebraMode;
    renderAlgebra();
    return;
  }

  // Trocador de visualização do Grafo (Otimizado / Canônico / Comparativo)
  const graphViewBtn = event.target.closest('[data-graph-view]');
  if (graphViewBtn) {
    graphViewMode = graphViewBtn.dataset.graphView;
    renderGraph();
    return;
  }

  // Trocador de visualização do Plano (Otimizado vs Canônico)
  const planViewBtn = event.target.closest('[data-plan-mode]');
  if (planViewBtn) {
    planViewMode = planViewBtn.dataset.planMode;
    renderPlan();
    return;
  }

  // Copiar expressão de álgebra relacional
  const copyBtn = event.target.closest('#copy-algebra-btn');
  if (copyBtn && analysis) {
    const algObj = (algebraMode === 'optimized' && analysis.optimization?.algebra)
      ? analysis.optimization.algebra
      : analysis.algebra;
    const textToCopy = algObj ? (algObj[algebraFormat] || algObj.unicode) : '';
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        const status = $('#copy-status');
        if (status) {
          status.hidden = false;
          setTimeout(() => { status.hidden = true; }, 2000);
        }
      });
    }
  }
});

// Acessibilidade por teclado nos cards do esquema (Enter ou Espaço)
$('#panel').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    const card = event.target.closest('.schema-table-card');
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
  $('#status').textContent = 'Processando consulta no motor Python…';
  $('#run').disabled = true;
  $('#run').innerHTML = '<span>Processando…</span>';
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

    $('#status').textContent = 'Consulta válida: álgebra, grafo otimizado e plano calculados.';

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
    $('#status').textContent = 'A consulta contém erros.';
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
      $('#run').innerHTML = '<span class="btn-icon" aria-hidden="true">▶</span><span>Executar</span><kbd>Ctrl+Enter</kbd>';
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
  anchor.download = 'analise-consulta-otimizada.json';
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
  $('#panel').setAttribute('aria-labelledby', `tab-${activeTab}`);
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

function metricChange(saved, percent, unit) {
  if (saved < 0) return `Aumento de ${number(-saved)} ${unit} (${number(-percent)}%)`;
  if (saved > 0) return `Redução de ${number(saved)} ${unit} (${number(percent)}%)`;
  return `Sem variação na soma de ${unit}`;
}

function equivalenceText() {
  return analysis.optimization?.equivalentResults
    ? 'Resultados canônico e otimizado equivalentes nesta execução, incluindo duplicatas (ordem das linhas desconsiderada).'
    : 'Resultados divergentes: revise os planos antes de apresentar a consulta.';
}

function orderingSummary(opt) {
  const order = opt.heuristics.joinOrdering;
  const products = opt.heuristics.cartesianAvoidance;
  return `<div class="technical-footnote">
    <strong>Ordem canônica:</strong> ${escape(order.originalOrder.join(' → '))}<br>
    <strong>Ordem otimizada:</strong> ${escape(order.optimizedOrder.join(' → '))}
    (${order.reordered ? 'reordenada' : 'mantida'}).<br>
    Cardinalidades após filtros locais: ${Object.entries(order.filteredCardinalities).map(([alias, rows]) => `${escape(alias)}: ${number(rows)}`).join('; ')}.<br>
    ${escape(order.description)}<br>
    Saídas estimadas ao adicionar relações: ${order.decisions.map(d => `${escape(d.alias)}: ${number(d.estimatedRows)} (${d.connected ? 'junção' : 'produto necessário'})`).join('; ') || 'Sem combinação binária'}.<br>
    Produtos cartesianos: ${products.canonicalProducts} canônico(s) → ${products.optimizedProducts} otimizado(s).<br>
    ${escape(opt.metrics.definition)}<br>${escape(equivalenceText())}
  </div>`;
}

function renderMetrics() {
  if (!analysis?.query) {
    $('#metrics').innerHTML = '';
    return;
  }
  const opt = analysis.optimization;
  const items = [
    ['Tabelas', analysis.query.tables.length],
    ['Nós (otimizado)', opt?.graph?.nodes?.length ?? analysis.graph?.nodes?.length ?? 0],
    ['Passos do plano', opt?.plan?.steps?.length ?? analysis.plan?.steps?.length ?? 0],
    ['Tuplas resultantes', analysis.result?.rowCount ?? 0],
  ];

  let savingsHtml = '';
  if (opt?.metrics) {
    const m = opt.metrics;
    savingsHtml = `
        <div class="telemetry-badge-savings" title="${escape(m.definition)}">
          <span>Otimização 27/10 · somas emitidas</span>
          <span>${metricChange(m.savedCells, m.cellReductionPercent, 'células')}</span>
          <span>${metricChange(m.savedTuples, m.tupleReductionPercent, 'tuplas')}</span>
        </div>
      `;
  }

  $('#metrics').innerHTML = items.map(([label, value]) => `
    <div class="telemetry-item">
      <span class="telemetry-label">${label}</span>
      <span class="telemetry-val">${number(value)}</span>
    </div>
  `).join('') + savingsHtml;
}

function heading(title, subtitle) {
  return `<div class="panel-heading"><h2>${title}</h2><p>${subtitle}</p></div>`;
}

function renderPanel() {
  if (activeTab === 'schema') return renderSchema();
  if (activeTab === 'deliveries') return renderDeliveries();
  if (!analysis) {
    $('#panel').innerHTML = '<div class="empty-state">Escreva ou selecione uma consulta SQL válida e clique em Executar para inspecionar as etapas do processamento.</div>';
    return;
  }
  if (activeTab === 'graph') renderGraph();
  else if (activeTab === 'heuristics') renderHeuristics();
  else if (activeTab === 'algebra') renderAlgebra();
  else if (activeTab === 'plan') renderPlan();
  else if (activeTab === 'results') renderResults();
  else if (activeTab === 'parser') renderParser();
}

// -----------------------------------------------------------------------------
// Visualização 1: Árvore de Operadores (Grafo Otimizado / Canônico / Comparativo)
// -----------------------------------------------------------------------------
function renderGraph() {
  const opt = analysis.optimization;
  const currentGraph = (graphViewMode === 'optimized' && opt?.graph) ? opt.graph : analysis.graph;

  if (!currentGraph || !currentGraph.nodes) {
    $('#panel').innerHTML = '<div class="empty-state">Grafo de operadores indisponível.</div>';
    return;
  }

  function renderTreeBranch(nodeId, graphObj) {
    const nodeMap = Object.fromEntries(graphObj.nodes.map(n => [n.id, n]));
    const node = nodeMap[nodeId];
    if (!node) return '';

    const badgeClass = `op-badge-${node.type}`;
    const hasHeuristic = Boolean(node.heuristic);
    const cardHtml = `
      <div class="tree-node-card ${node.type === 'scan' ? 'is-leaf' : ''} ${hasHeuristic ? 'has-heuristic' : ''} ${badgeClass}" id="tree-node-${node.id}">
        <div class="node-badge-col">
          <span class="node-symbol" title="Operador: ${escape(node.name)}">${escape(node.symbol)}</span>
        </div>
        <div class="node-main-col">
          <div class="node-header-line">
            <span class="node-type-label">${escape(node.name)}</span>
            <span class="node-count-badge">${number(node.tuplesCount ?? 0)} tuplas</span>
          </div>
          ${node.heuristicLabel ? `<span class="node-heuristic-badge">${escape(node.heuristicLabel)}</span>` : ''}
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
      return `<div class="tree-subtree">${cardHtml}</div>`;
    }

    if (node.children.length === 1) {
      const child = nodeMap[node.children[0]];
      return `
        <div class="tree-subtree unary-subtree">
          ${cardHtml}
          <div class="tree-connector" aria-hidden="true">
            <span class="connector-line"></span>
            <span class="connector-telemetry">${number(child?.tuplesCount ?? 0)} tuplas</span>
            <span class="connector-line"></span>
          </div>
          <div class="tree-children single-child">
            ${renderTreeBranch(node.children[0], graphObj)}
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
          <span class="connector-telemetry">combinação binária</span>
          <span class="connector-line"></span>
        </div>
        <div class="tree-branches-grid">
          <div class="tree-branch-col branch-left">
            <div class="branch-label">Ramo esquerdo · ${number(leftChild?.tuplesCount ?? 0)} tuplas</div>
            ${renderTreeBranch(node.children[0], graphObj)}
          </div>
          <div class="tree-branch-col branch-right">
            <div class="branch-label">Ramo direito · ${number(rightChild?.tuplesCount ?? 0)} tuplas</div>
            ${renderTreeBranch(node.children[1], graphObj)}
          </div>
        </div>
      </div>
    `;
  }

  // Resumo de heurísticas no topo do grafo
  let heuristicsBanner = '';
  if (opt?.metrics && graphViewMode !== 'canonical') {
    const m = opt.metrics;
    const h = opt.heuristics;
    heuristicsBanner = `
      <div class="heuristics-dashboard-card">
        <div class="heuristics-card-head">
          <div class="heuristics-title-group">
            <h3>Heurísticas de otimização aplicadas (27/10/2026)</h3>
            <span class="heuristics-pill-delivery">Disponível</span>
          </div>
        </div>

        <div class="heuristics-metrics-strip">
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Tuplas emitidas (soma)</span>
            <span class="h-stat-value">${m.canonicalIntermediateTuples} → ${m.optimizedIntermediateTuples}</span>
            <span class="h-stat-sub">${metricChange(m.savedTuples, m.tupleReductionPercent, 'tuplas')}</span>
          </div>
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Células emitidas (soma)</span>
            <span class="h-stat-value">${m.canonicalIntermediateCells} → ${m.optimizedIntermediateCells} células</span>
            <span class="h-stat-sub">${metricChange(m.savedCells, m.cellReductionPercent, 'células')}</span>
          </div>
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Push-down de seleção (σ)</span>
            <span class="h-stat-value">${h.tupleReduction.appliedCount} aplicada(s)</span>
            <span class="h-stat-sub">Filtros aplicados antes de junções</span>
          </div>
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Push-down de projeção (π)</span>
            <span class="h-stat-value">${h.attributeReduction.appliedCount} aplicada(s)</span>
            <span class="h-stat-sub">Colunas não usadas descartadas</span>
          </div>
        </div>

        ${h.tupleReduction.items.length > 0 || h.attributeReduction.items.length > 0 ? `
          <div class="heuristics-breakdown-list">
            ${h.tupleReduction.items.map(it => `
              <div class="heuristic-item-line">
                <span class="h-badge-sel">σ Push-down</span>
                <span><strong>${escape(it.alias)}</strong>: predicado <code>${escape(it.predicate)}</code> antecipado (${it.initialTuples} → ${it.finalTuples} tuplas).</span>
              </div>
            `).join('')}
            ${h.attributeReduction.items.map(it => `
              <div class="heuristic-item-line">
                <span class="h-badge-proj">π Push-down</span>
                <span><strong>${escape(it.alias)}</strong>: mantidos ${it.kept.length} atributos (${escape(it.kept.join(', '))}); descartadas ${it.discarded.length} colunas redundantes (${escape(it.discarded.join(', '))}).</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${orderingSummary(opt)}
      </div>
    `;
  }

  let viewportContent = '';
  if (graphViewMode === 'comparison') {
    viewportContent = `
      <div class="side-by-side-trees">
        <div class="tree-column">
          <div class="tree-col-head">
            <span>Árvore canônica (não otimizada · 20/10)</span>
            <span>${analysis.graph.nodes.length} nós</span>
          </div>
          <div class="tree-viewport">
            ${renderTreeBranch(analysis.graph.rootId, analysis.graph)}
          </div>
        </div>
        <div class="tree-column">
          <div class="tree-col-head is-opt">
            <span>Árvore otimizada (heurísticas · 27/10)</span>
            <span>${opt.graph.nodes.length} nós</span>
          </div>
          <div class="tree-viewport">
            ${renderTreeBranch(opt.graph.rootId, opt.graph)}
          </div>
        </div>
      </div>
    `;
  } else {
    viewportContent = `
      <div class="tree-viewport" role="region" aria-label="Visualização em árvore do grafo de operadores">
        ${renderTreeBranch(currentGraph.rootId, currentGraph)}
      </div>
    `;
  }

  $('#panel').innerHTML = heading(
    graphViewMode === 'optimized'
      ? 'Árvore de operadores otimizada'
      : (graphViewMode === 'comparison' ? 'Comparativo: canônica e otimizada' : 'Árvore de operadores canônica'),
    graphViewMode === 'optimized'
      ? 'Seleções e projeções antecipadas; junções reordenadas por cardinalidade e conectividade (27/10).'
      : (graphViewMode === 'comparison'
        ? 'Consulta original e árvore reconstruída com as heurísticas de 27/10.'
        : 'Representação da consulta original, sem otimização (20/10).')
  ) + `
    <div class="graph-container">
      <div class="graph-control-bar">
        <div class="graph-view-switcher" role="group" aria-label="Modo de visualização da árvore">
          <button class="graph-view-btn ${graphViewMode === 'optimized' ? 'active' : ''}" data-graph-view="optimized">
            Otimizada (27/10)
          </button>
          <button class="graph-view-btn ${graphViewMode === 'canonical' ? 'active' : ''}" data-graph-view="canonical">
            Canônica (20/10)
          </button>
          <button class="graph-view-btn ${graphViewMode === 'comparison' ? 'active' : ''}" data-graph-view="comparison">
            Lado a lado
          </button>
        </div>

        <div class="graph-legend">
          <span class="legend-title">Convenção</span>
          <div class="legend-tags">
            <span class="legend-tag"><b class="op-badge-proj">π</b> Projeção</span>
            <span class="legend-tag"><b class="op-badge-sel">σ</b> Seleção</span>
            <span class="legend-tag"><b class="op-badge-join">⋈</b> Junção</span>
            <span class="legend-tag"><b class="op-badge-prod">×</b> Produto cartesiano</span>
            <span class="legend-tag"><b class="op-badge-scan">▤</b> Varredura</span>
          </div>
        </div>
      </div>

      ${heuristicsBanner}
      ${viewportContent}

      ${graphViewMode !== 'canonical' ? `<div class="technical-footnote">
        <strong>Princípio heurístico (Elmasri & Navathe / Codd):</strong> as operações que reduzem o tamanho dos resultados intermediários são executadas primeiro. <em>Seleções unárias (σ)</em> são empurradas para as folhas para reduzir a cardinalidade antes das junções, e <em>projeções intermediárias (π)</em> eliminam colunas não referenciadas para reduzir a largura das tuplas em memória.
      </div>` : ''}
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 2: Heurísticas Dedicadas (27/10/2026)
// -----------------------------------------------------------------------------
function renderHeuristics() {
  const opt = analysis.optimization;
  if (!opt) {
    $('#panel').innerHTML = '<div class="empty-state">Informações de heurísticas indisponíveis.</div>';
    return;
  }

  const m = opt.metrics;
  const h = opt.heuristics;

  $('#panel').innerHTML = heading('Heurísticas: seleção, projeção e junções', 'Operações aplicadas e ordem escolhida na entrega de 27/10/2026.') + `
    <div class="algebra-container">
      <div class="heuristics-dashboard-card">
        <div class="heuristics-metrics-strip">
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Tuplas emitidas (soma)</span>
            <span class="h-stat-value">${m.canonicalIntermediateTuples} → ${m.optimizedIntermediateTuples}</span>
            <span class="h-stat-sub">${metricChange(m.savedTuples, m.tupleReductionPercent, 'tuplas')}</span>
          </div>
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Células emitidas (soma de tuplas × colunas)</span>
            <span class="h-stat-value">${m.canonicalIntermediateCells} → ${m.optimizedIntermediateCells}</span>
            <span class="h-stat-sub">${metricChange(m.savedCells, m.cellReductionPercent, 'células')}</span>
          </div>
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Push-down de seleção (σ)</span>
            <span class="h-stat-value">${h.tupleReduction.appliedCount} seleção(ões)</span>
            <span class="h-stat-sub">Redução precoce de cardinalidade</span>
          </div>
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Push-down de projeção (π)</span>
            <span class="h-stat-value">${h.attributeReduction.appliedCount} projeção(ões)</span>
            <span class="h-stat-sub">Estreitamento de tuplas</span>
          </div>
        </div>
      </div>

      <div class="parser-columns">
        <section class="heur-card">
          <div class="heur-card-head">
            <span class="op-glyph op-badge-sel">σ</span>
            <h3>1. Redução de tuplas</h3>
          </div>
          <p class="heur-card-desc">
            Predicados unários de ON e WHERE são avaliados logo após a leitura da tabela base, antes de qualquer produto ou junção.
          </p>
          ${h.tupleReduction.items.length === 0 ? `
            <div class="heur-empty">Nenhum predicado unário de ON ou WHERE nesta consulta.</div>
          ` : `
            <div class="heur-list">
              ${h.tupleReduction.items.map(it => `
                <div class="heur-item heur-item--sel">
                  <div class="heur-item-title">${escape(it.table)} (alias ${escape(it.alias)})</div>
                  <div>Predicado: <code>${escape(it.predicate)}</code></div>
                  <div>Origem: ${escape([...new Set(it.predicates.map(p => p.origin))].join(', '))}</div>
                  <div>De <strong>${it.initialTuples} tuplas</strong> para <strong>${it.finalTuples} tuplas</strong>: ${it.reductionTuples} descartadas antes da junção.</div>
                </div>
              `).join('')}
            </div>
          `}
        </section>

        <section class="heur-card">
          <div class="heur-card-head">
            <span class="op-glyph op-badge-proj">π</span>
            <h3>2. Redução de atributos</h3>
          </div>
          <p class="heur-card-desc">
            Projeções antecipadas são inseridas logo acima das folhas para descartar atributos que não são usados por junções posteriores nem pelo SELECT final.
          </p>
          ${h.attributeReduction.items.length === 0 ? `
            <div class="heur-empty">Todos os atributos das relações são necessários para a consulta atual.</div>
          ` : `
            <div class="heur-list">
              ${h.attributeReduction.items.map(it => `
                <div class="heur-item heur-item--proj">
                  <div class="heur-item-title">${escape(it.table)} (alias ${escape(it.alias)})</div>
                  <div>Mantidos (${it.kept.length}): <code>${escape(it.kept.join(', '))}</code></div>
                  <div>Descartados (${it.discarded.length}): <code>${escape(it.discarded.join(', '))}</code>. De ${it.columnsBefore} para ${it.columnsAfter} colunas.</div>
                </div>
              `).join('')}
            </div>
          `}
        </section>
      </div>

      ${orderingSummary(opt)}
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 3: Álgebra Relacional (Otimizada e Canônica)
// -----------------------------------------------------------------------------
function renderAlgebra() {
  const opt = analysis.optimization;
  const currentAlgebra = (algebraMode === 'optimized' && opt?.algebra) ? opt.algebra : analysis.algebra;

  if (!currentAlgebra) {
    $('#panel').innerHTML = '<div class="empty-state">Álgebra relacional indisponível.</div>';
    return;
  }

  const formulaText = currentAlgebra[algebraFormat] || currentAlgebra.unicode;

  // Destaques tipográficos
  const highlighted = escape(formulaText)
    .replace(/(π|PI)/g, '<span class="sym-proj">$1</span>')
    .replace(/(σ|SIGMA)/g, '<span class="sym-sel">$1</span>')
    .replace(/(⋈|JOIN)/g, '<span class="sym-join">$1</span>')
    .replace(/(×|CROSS)/g, '<span class="sym-prod">$1</span>');

  const components = [
    ['Projeção final (π)', currentAlgebra.columns.join(', '), 'Atributos mantidos no resultado final da consulta'],
    ['Predicados WHERE', analysis.query.wherePredicateLabels.join(' ∧ ') || 'Sem predicado WHERE', 'Condições originalmente escritas no WHERE'],
    ['Predicados ON', analysis.query.onPredicateLabels.join(' ∧ ') || 'Sem predicado ON', 'Condições originalmente escritas nos INNER JOINs; filtros locais podem ser antecipados'],
    ['Relações base', analysis.query.tables.map(t => `${t.table} AS ${t.alias}`).join(', '), 'Tabelas do catálogo BD_Vendas lidas na base'],
    ['Modo de execução', algebraMode === 'optimized' ? 'Álgebra otimizada (heurísticas 27/10)' : 'Álgebra canônica (não otimizada)', 'Estratégia algébrica de avaliação'],
  ];

  $('#panel').innerHTML = heading(
    algebraMode === 'optimized' ? 'Álgebra relacional otimizada' : 'Álgebra relacional canônica',
    'Conversão formal da consulta SQL para a notação relacional de Codd.'
  ) + `
    <div class="algebra-container">
      <div class="formula-card">
        <div class="formula-card-header">
          <div class="graph-view-switcher" role="group" aria-label="Modo da álgebra">
            <button class="graph-view-btn ${algebraMode === 'optimized' ? 'active' : ''}" data-algebra-mode="optimized">
              Otimizada (27/10)
            </button>
            <button class="graph-view-btn ${algebraMode === 'canonical' ? 'active' : ''}" data-algebra-mode="canonical">
              Canônica (20/10)
            </button>
          </div>

          <div class="format-toggle" role="group" aria-label="Formato de exibição da álgebra">
            <button class="toggle-btn ${algebraFormat === 'unicode' ? 'active' : ''}" data-format="unicode">Unicode</button>
            <button class="toggle-btn ${algebraFormat === 'latex' ? 'active' : ''}" data-format="latex">LaTeX</button>
            <button class="toggle-btn ${algebraFormat === 'ascii' ? 'active' : ''}" data-format="ascii">ASCII</button>
          </div>
        </div>

        <div class="formula-display" tabindex="0" aria-label="Expressão matemática da álgebra relacional">${highlighted}</div>

        <div class="formula-actions">
          <button id="copy-algebra-btn" class="btn" type="button">Copiar expressão</button>
          <span id="copy-status" class="copy-feedback" hidden>Copiado para a área de transferência.</span>
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
        ${algebraMode === 'optimized'
          ? '<strong>Álgebra otimizada:</strong> reflete a descida (push-down) das seleções para as folhas e a inclusão de projeções antecipadas para estreitar as relações antes da combinação binária.'
          : '<strong>Álgebra canônica:</strong> segue a ordem original sem otimização. Primeiro realiza o produto e as junções de todas as tabelas, aplica a seleção do WHERE no topo e projeta os atributos finais.'}
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 4: Ordem de Execução (Plano Bottom-Up)
// -----------------------------------------------------------------------------
function renderPlan() {
  const opt = analysis.optimization;
  const currentPlan = (planViewMode === 'optimized' && opt?.plan) ? opt.plan : analysis.plan;

  if (!currentPlan || !currentPlan.steps) {
    $('#panel').innerHTML = '<div class="empty-state">Plano de execução indisponível.</div>';
    return;
  }

  $('#panel').innerHTML = heading(
    planViewMode === 'optimized' ? 'Ordem de execução otimizada' : 'Ordem de execução canônica',
    'Sequência determinística obtida pelo percurso pós-ordem (bottom-up) da árvore de operadores.'
  ) + `
    <div class="graph-control-bar">
      <div class="graph-view-switcher" role="group" aria-label="Modo do plano">
        <button class="graph-view-btn ${planViewMode === 'optimized' ? 'active' : ''}" data-plan-mode="optimized">
          Otimizado (27/10)
        </button>
        <button class="graph-view-btn ${planViewMode === 'canonical' ? 'active' : ''}" data-plan-mode="canonical">
          Canônico (20/10)
        </button>
      </div>
      <div class="plan-total">
        Total de passos: <span class="tuple-counter">${currentPlan.steps.length}</span>
      </div>
    </div>

    <div class="plan-wrapper">
      <table class="technical-table">
        <thead>
          <tr>
            <th style="width: 72px;">Passo</th>
            <th style="width: 170px;">Operador</th>
            <th>Ação executada</th>
            <th>Predicado / expressão</th>
            <th>Heurística</th>
            <th style="text-align: right;">Tuplas emitidas</th>
          </tr>
        </thead>
        <tbody>
          ${currentPlan.steps.map(step => `
            <tr>
              <td><span class="step-badge">${step.step}</span></td>
              <td><span class="op-glyph op-badge-${step.type}">${step.operator}</span> <strong>${escape(step.name)}</strong></td>
              <td>${escape(step.operation)}</td>
              <td><code>${escape(step.predicate || step.target || '—')}</code></td>
              <td>${step.heuristicLabel ? `<span class="node-heuristic-badge">${escape(step.heuristicLabel)}</span>` : '<span class="muted">Nenhuma (padrão)</span>'}</td>
              <td style="text-align: right;"><span class="tuple-counter">${number(step.rowsProduced)} tuplas</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="technical-footnote">
      Cada nó folha alimenta suas tuplas para o nó pai imediatamente superior. O plano otimizado aplica reduções locais antes de acionar os operadores binários mais caros.
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 5: Resultado da Consulta (Dados Avaliados)
// -----------------------------------------------------------------------------
function renderResults() {
  const result = analysis.result;
  if (!result || !result.columns) {
    $('#panel').innerHTML = '<div class="empty-state">Nenhum resultado disponível para exibição.</div>';
    return;
  }

  if (result.rows.length === 0) {
    $('#panel').innerHTML = heading('Resultado da consulta', 'Registros obtidos a partir do processamento do plano de consulta.') + `
      <div class="empty-state">
        <span style="font-size: 28px; display: block; margin-bottom: 8px;">∅</span>
        Nenhum registro satisfaz o predicado informado sobre a base BD_Vendas de exemplo.
      </div>
    `;
    return;
  }

  $('#panel').innerHTML = heading(`Resultado da consulta · ${number(result.rowCount)} registros`, 'Tuplas finais produzidas pela execução do plano sobre o catálogo de exemplo BD_Vendas.') + `
    <div class="results-wrapper">
      <table class="technical-table data-grid">
        <thead>
          <tr>
            <th style="width: 48px;">#</th>
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
      Os dados foram avaliados em memória sobre BD_Vendas. ${escape(equivalenceText())}
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 6: Parser & Validação Semântica
// -----------------------------------------------------------------------------
function renderParser() {
  const query = analysis.query;
  const predicates = query.predicateLabels;

  $('#panel').innerHTML = heading('Parser e validação semântica', 'Tokens léxicos, relações resolvidas e predicados validados contra o catálogo BD_Vendas.') + `
    <div class="parser-columns">
      <div class="parser-card">
        <h3>Estrutura semântica resolvida</h3>
        <dl class="semantic-dl">
          <div>
            <dt>Projeção (SELECT)</dt>
            <dd><code>${escape(query.columns.map(c => c.key).join(', '))}</code></dd>
          </div>
          <div>
            <dt>Relações declaradas (FROM / JOIN)</dt>
            <dd><code>${escape(query.tables.map(t => `${t.table} AS ${t.alias}`).join(', '))}</code></dd>
          </div>
          <div>
            <dt>Predicados de seleção e junção</dt>
            <dd><code>${escape(predicates.join(' AND ') || 'Nenhum predicado declarado')}</code></dd>
          </div>
          <div>
            <dt>Integridade do catálogo</dt>
            <dd>Todas as tabelas e atributos existem em BD_Vendas e foram verificados sem ambiguidade.</dd>
          </div>
        </dl>
      </div>

      <div class="parser-card">
        <h3>Tokens léxicos (${query.tokens.length})</h3>
        <div class="token-container">
          ${query.tokens.map(token => `
            <span class="token-pill" tabindex="0" title="Tipo: ${escape(token.type)} · Posição: ${token.position}">
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
// Visualização 7: Esquema BD_Vendas
// -----------------------------------------------------------------------------
function renderSchema() {
  $('#panel').innerHTML = heading('Catálogo BD_Vendas', `${Object.keys(schema).length} tabelas didáticas usadas para validação de escopo, tipos e integridade referencial. Selecione uma tabela para localizá-la na lista lateral.`) + `
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
                <span class="col-glyph" aria-hidden="true">${idx === 0 ? '◆' : '·'}</span>
                <span class="col-name">${escape(column)}</span>
              </li>
            `).join('')}
          </ul>
        </article>
      `).join('')}
    </div>
    <div class="technical-footnote">
      Os dados foram carregados da base didática em memória. O script DDL correspondente para MySQL está em <code>sql/bd-vendas.sql</code>. A chave primária de cada tabela aparece marcada com ◆.
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 8: Requisitos da Disciplina
// -----------------------------------------------------------------------------
function renderDeliveries() {
  const deliveries = [
    [1, '15/10/2026', 'Interface gráfica existente e funcional', 'Editor SQL, exemplos, navegação e exportação JSON', true],
    [1, '15/10/2026', 'A string é parseada', 'Lexer, parser e estrutura validada da consulta', true],
    [1, '15/10/2026', 'Campos e comandos errados são validados', 'Erros sintáticos, catálogo, ambiguidade, aliases e escopo', true],
    [2, '20/10/2026', 'Conversão para álgebra relacional', 'Expressão canônica em Unicode, LaTeX e componentes', true],
    [2, '20/10/2026', 'Grafo não otimizado', 'Árvore de operadores em memória, visualização e plano de execução', true],
    [3, '22/10/2026', 'Aplicação da heurística de projeção e seleção', 'Push-down de seleções (redução de tuplas) e push-down de projeções (redução de atributos)', true],
    [4, '27/10/2026', 'Demais heurísticas', 'Reordenação por cardinalidade, junções conectadas, ON/WHERE e álgebra gerada do grafo', true],
  ];

  $('#panel').innerHTML = heading('Requisitos da disciplina · Banco de Dados II', 'Matriz de entregas conforme as especificações oficiais do trabalho prático.') + `
    <div class="plan-wrapper">
      <table class="technical-table">
        <thead>
          <tr>
            <th style="width: 120px;">Prazo</th>
            <th style="width: 300px;">Requisito</th>
            <th>Descrição técnica implementada</th>
            <th style="width: 130px;">Situação</th>
          </tr>
        </thead>
        <tbody>
          ${deliveries.map(([delivery, date, title, description, isDone]) => `
            <tr>
              <td class="date-col"><strong>${date}</strong></td>
              <td><strong>${escape(title)}</strong></td>
              <td>${escape(description)}</td>
              <td><span class="status-badge ${isDone ? 'is-done' : 'is-upcoming'}">${isDone ? 'Disponível' : 'Etapa futura'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="technical-footnote">
      <strong>Entrega atual (27/10/2026):</strong> seleção, projeção e reordenação de junções estão implementadas no motor Python. A álgebra otimizada é gerada do grafo e o plano segue suas dependências.
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Inicialização do Workbench
// -----------------------------------------------------------------------------
async function initialize() {
  $('#run').disabled = true;
  $('#status').textContent = 'Conectando ao motor Python…';
  try {
    const catalog = await requestJson('/api/catalog');
    ({ schema, sampleCounts, examples } = catalog);

    $('#example').innerHTML = '<option value="">Escolher exemplo…</option>' +
      examples.map((example, index) => `<option value="${index}">${escape(example.name)}</option>`).join('');

    $('#table-nav').innerHTML = Object.keys(schema).map(table => `
      <button data-table="${escape(table)}" type="button" title="Inspecionar tabela ${escape(table)}">
        <span class="nav-icon" aria-hidden="true">▤</span>
        <span class="nav-table-name">${escape(table)}</span>
        <span class="nav-count">${schema[table].length} attr.</span>
      </button>
    `).join('');

    const countElem = $('#catalog-count');
    if (countElem) countElem.textContent = `${Object.keys(schema).length} tabelas`;

    $('#run').disabled = false;
    $('#status').textContent = '';

    // Carrega o segundo exemplo (Produtos e categorias) por padrão
    if (examples[1]) {
      $('#sql').value = examples[1].sql;
      $('#example').value = '1';
      await run();
    }
  } catch (error) {
    $('#status').textContent = 'Servidor indisponível.';
    $('#error').hidden = false;
    $('#error').innerHTML = `
      <strong>Não foi possível conectar ao catálogo</strong>
      ${escape(error.message)}
      <br><button id="retry-btn" class="btn" style="margin-top: 10px;">Tentar novamente</button>
    `;
    $('#retry-btn')?.addEventListener('click', initialize);
  }
}

initialize();
