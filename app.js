// Processador de Consultas: Interface de controle e inspeção técnica em JavaScript.
// Entrega 3 (22/10/2026): Heurísticas de Seleção (Redução de Tuplas) e Projeção (Redução de Atributos).

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
  $('#status').textContent = 'Processando consulta e aplicando heurísticas de otimização no motor Python...';
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

    $('#status').textContent = 'Consulta validada com sucesso: álgebra relacional, grafo otimizado (22/10) e plano calculados.';

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
  const opt = analysis.optimization;
  const items = [
    ['Tabelas', analysis.query.tables.length],
    ['Nós (Otimizado)', opt?.graph?.nodes?.length ?? analysis.graph?.nodes?.length ?? 0],
    ['Passos do Plano', opt?.plan?.steps?.length ?? analysis.plan?.steps?.length ?? 0],
    ['Tuplas Resultantes', analysis.result?.rowCount ?? 0],
  ];

  let savingsHtml = '';
  if (opt?.metrics) {
    const m = opt.metrics;
    if (m.savedCells > 0 || m.savedTuples > 0) {
      savingsHtml = `
        <div class="telemetry-badge-savings" title="Economia de volume em memória intermediária obtida pelas heurísticas de 22/10">
          <span>⚡ Otimização 22/10:</span>
          <span>${m.cellReductionPercent > 0 ? `-${m.cellReductionPercent}% células` : `-${m.tupleReductionPercent}% tuplas`}</span>
        </div>
      `;
    }
  }

  $('#metrics').innerHTML = items.map(([label, value]) => `
    <div class="telemetry-item">
      <span class="telemetry-label">${label}:</span>
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
    $('#panel').innerHTML = '<div class="empty-state">Escreva ou selecione uma consulta SQL válida e clique em Executar para inspecionar os artefatos gerados.</div>';
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
      <div class="tree-node-card ${node.type === 'scan' ? 'is-leaf' : ''} ${hasHeuristic ? 'has-heuristic' : ''}" id="tree-node-${node.id}">
        <div class="node-badge-col">
          <span class="node-symbol ${badgeClass}" title="Operador: ${escape(node.name)}">${escape(node.symbol)}</span>
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
          <span class="connector-telemetry">▲ combinação binária</span>
          <span class="connector-line"></span>
        </div>
        <div class="tree-branches-grid">
          <div class="tree-branch-col branch-left">
            <div class="branch-label">
              <span>Ramo Esquerdo (${number(leftChild?.tuplesCount ?? 0)} tuplas)</span>
            </div>
            ${renderTreeBranch(node.children[0], graphObj)}
          </div>
          <div class="tree-branch-col branch-right">
            <div class="branch-label">
              <span>Ramo Direito (${number(rightChild?.tuplesCount ?? 0)} tuplas)</span>
            </div>
            ${renderTreeBranch(node.children[1], graphObj)}
          </div>
        </div>
      </div>
    `;
  }

  // Dashboard de Heurísticas no topo do Grafo
  let heuristicsBanner = '';
  if (opt?.metrics) {
    const m = opt.metrics;
    const h = opt.heuristics;
    heuristicsBanner = `
      <div class="heuristics-dashboard-card">
        <div class="heuristics-card-head">
          <div class="heuristics-title-group">
            <span style="font-size: 16px;">⚡</span>
            <h3>Heurísticas de Otimização Aplicadas (Entrega 22/10/2026)</h3>
            <span class="heuristics-pill-delivery">Disponível</span>
          </div>
        </div>

        <div class="heuristics-metrics-strip">
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Redução de Tuplas Intermediárias</span>
            <span class="h-stat-value">${m.canonicalIntermediateTuples} ➔ ${m.optimizedIntermediateTuples}</span>
            <span class="h-stat-sub">${m.tupleReductionPercent > 0 ? `-${m.tupleReductionPercent}% tuplas intermediárias` : 'Filtradas na folha'}</span>
          </div>
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Redução de Volume em Memória</span>
            <span class="h-stat-value">${m.canonicalIntermediateCells} ➔ ${m.optimizedIntermediateCells} cél.</span>
            <span class="h-stat-sub">${m.cellReductionPercent > 0 ? `-${m.cellReductionPercent}% memória intermediária` : 'Atributos estreitados'}</span>
          </div>
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Push-Down de Seleção (σ)</span>
            <span class="h-stat-value">${h.tupleReduction.appliedCount} aplicada(s)</span>
            <span class="h-stat-sub">Filtros aplicados antes de junções</span>
          </div>
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Push-Down de Projeção (π)</span>
            <span class="h-stat-value">${h.attributeReduction.appliedCount} aplicada(s)</span>
            <span class="h-stat-sub">Colunas não usadas descartadas</span>
          </div>
        </div>

        ${h.tupleReduction.items.length > 0 || h.attributeReduction.items.length > 0 ? `
          <div class="heuristics-breakdown-list">
            ${h.tupleReduction.items.map(it => `
              <div class="heuristic-item-line">
                <span class="h-badge-sel">σ Push-down</span>
                <span><strong>${escape(it.alias)}</strong>: predicado <code>${escape(it.predicate)}</code> antecipado (${it.initialTuples} ➔ ${it.finalTuples} tuplas).</span>
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
      </div>
    `;
  }

  let viewportContent = '';
  if (graphViewMode === 'comparison') {
    viewportContent = `
      <div class="side-by-side-trees">
        <div class="tree-column">
          <div class="tree-col-head">
            <span>Árvore Canônica (Não Otimizada - 20/10)</span>
            <span>${analysis.graph.nodes.length} nós</span>
          </div>
          <div class="tree-viewport">
            ${renderTreeBranch(analysis.graph.rootId, analysis.graph)}
          </div>
        </div>
        <div class="tree-column">
          <div class="tree-col-head">
            <span style="color: #0f766e;">⚡ Árvore Otimizada (Heurísticas - 22/10)</span>
            <span style="color: #0f766e;">${opt.graph.nodes.length} nós</span>
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
      ? 'Árvore de Operadores Otimizada (Heurísticas de Seleção e Projeção — 22/10)'
      : (graphViewMode === 'comparison' ? 'Comparativo de Árvores de Operadores (Canônica vs Otimizada)' : 'Árvore de Operadores Canônica (Não Otimizada — 20/10)'),
    'Representação algébrica em memória onde as folhas representam leituras e os nós intermediários realizam junções, seleções e projeções.'
  ) + `
    <div class="graph-container">
      <div class="graph-control-bar">
        <div class="graph-view-switcher" role="group" aria-label="Modo de visualização da árvore">
          <button class="graph-view-btn ${graphViewMode === 'optimized' ? 'active' : ''}" data-graph-view="optimized">
            ⚡ Árvore Otimizada (22/10)
          </button>
          <button class="graph-view-btn ${graphViewMode === 'canonical' ? 'active' : ''}" data-graph-view="canonical">
            Árvore Canônica (20/10)
          </button>
          <button class="graph-view-btn ${graphViewMode === 'comparison' ? 'active' : ''}" data-graph-view="comparison">
            Comparativo Lado a Lado
          </button>
        </div>

        <div class="graph-legend">
          <span class="legend-title">Convenção:</span>
          <div class="legend-tags">
            <span class="legend-tag"><b class="op-badge-proj">π</b> Projeção</span>
            <span class="legend-tag"><b class="op-badge-sel">σ</b> Seleção</span>
            <span class="legend-tag"><b class="op-badge-join">⋈</b> Junção</span>
            <span class="legend-tag"><b class="op-badge-prod">×</b> Produto Cartesiano</span>
            <span class="legend-tag"><b class="op-badge-scan">▤</b> Varredura (Scan)</span>
          </div>
        </div>
      </div>

      ${heuristicsBanner}
      ${viewportContent}

      <div class="technical-footnote">
        <strong>Princípio Heurístico (Elmasri & Navathe / Codd):</strong> As operações que reduzem o tamanho dos resultados intermediários são executadas primeiro. <em>Seleções unárias (σ)</em> são empurradas para as folhas para reduzir a cardinalidade das tuplas antes das junções, e <em>projeções intermediárias (π)</em> eliminam colunas não referenciadas para reduzir a largura das tuplas em memória.
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 2: Heurísticas Dedicadas (22/10/2026)
// -----------------------------------------------------------------------------
function renderHeuristics() {
  const opt = analysis.optimization;
  if (!opt) {
    $('#panel').innerHTML = '<div class="empty-state">Informações de heurísticas indisponíveis.</div>';
    return;
  }

  const m = opt.metrics;
  const h = opt.heuristics;

  $('#panel').innerHTML = heading('Heurísticas de Otimização: Seleção e Projeção (Entrega 22/10/2026)', 'Detalhamento algorítmico do push-down de operadores para minimização de I/O e memória intermediária.') + `
    <div class="algebra-container">
      <div class="heuristics-dashboard-card" style="background: #ffffff; border-color: var(--border-default);">
        <div class="heuristics-metrics-strip">
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Tuplas Intermediárias</span>
            <span class="h-stat-value">${m.canonicalIntermediateTuples} ➔ ${m.optimizedIntermediateTuples}</span>
            <span class="h-stat-sub">Economia de ${m.savedTuples} tuplas (${m.tupleReductionPercent}%)</span>
          </div>
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Células em Memória (Tuplas × Colunas)</span>
            <span class="h-stat-value">${m.canonicalIntermediateCells} ➔ ${m.optimizedIntermediateCells}</span>
            <span class="h-stat-sub">Economia de ${m.savedCells} células (${m.cellReductionPercent}%)</span>
          </div>
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Push-Down de Seleção (σ)</span>
            <span class="h-stat-value">${h.tupleReduction.appliedCount} predicado(s)</span>
            <span class="h-stat-sub">Redução precoce de cardinalidade</span>
          </div>
          <div class="heuristic-stat-box">
            <span class="h-stat-label">Push-Down de Projeção (π)</span>
            <span class="h-stat-value">${h.attributeReduction.appliedCount} projeção(ões)</span>
            <span class="h-stat-sub">Estreitamento de tuplas</span>
          </div>
        </div>
      </div>

      <div class="parser-columns">
        <div class="parser-card">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span class="op-glyph op-badge-sel">σ</span>
            <h3 style="margin: 0;">1. Heurística de Redução de Tuplas</h3>
          </div>
          <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 12px; line-height: 1.5;">
            Predicados unários presentes na cláusula WHERE são empurrados para baixo na árvore, sendo avaliados imediatamente após a leitura (scan) de cada tabela base e antes de qualquer produto ou junção.
          </p>
          ${h.tupleReduction.items.length === 0 ? `
            <div style="font-size: 12px; color: var(--text-muted); background: #f8fafc; padding: 10px; border-radius: 4px;">
              Nenhum predicado unário nesta consulta (seleções aplicadas nas junções ou sem restrição WHERE).
            </div>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${h.tupleReduction.items.map(it => `
                <div style="padding: 10px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px;">
                  <div style="font-weight: 700; font-size: 12px; color: #92400e; margin-bottom: 4px;">
                    Relação: ${escape(it.table)} (alias: ${escape(it.alias)})
                  </div>
                  <div style="font-size: 11px; margin-bottom: 4px;">
                    Predicado: <code>${escape(it.predicate)}</code>
                  </div>
                  <div style="font-size: 11px; color: #78350f;">
                    Resultado: de <strong>${it.initialTuples} tuplas</strong> para <strong>${it.finalTuples} tuplas</strong> (${it.reductionTuples} tuplas descartadas antes da junção).
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <div class="parser-card">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span class="op-glyph op-badge-proj">π</span>
            <h3 style="margin: 0;">2. Heurística de Redução de Atributos</h3>
          </div>
          <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 12px; line-height: 1.5;">
            Projeções antecipadas são inseridas logo acima das folhas para descartar atributos redundantes não necessários para junções subsequentes nem para o SELECT final, diminuindo a largura das tuplas em memória.
          </p>
          ${h.attributeReduction.items.length === 0 ? `
            <div style="font-size: 12px; color: var(--text-muted); background: #f8fafc; padding: 10px; border-radius: 4px;">
              Todos os atributos da relação são necessários para a consulta atual.
            </div>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${h.attributeReduction.items.map(it => `
                <div style="padding: 10px; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 4px;">
                  <div style="font-weight: 700; font-size: 12px; color: #3730a3; margin-bottom: 4px;">
                    Relação: ${escape(it.table)} (alias: ${escape(it.alias)})
                  </div>
                  <div style="font-size: 11px; margin-bottom: 4px;">
                    Atributos mantidos (${it.kept.length}): <code>${escape(it.kept.join(', '))}</code>
                  </div>
                  <div style="font-size: 11px; color: #4338ca;">
                    Descartados precocemente (${it.discarded.length}): <code>${escape(it.discarded.join(', '))}</code> (de ${it.columnsBefore} para ${it.columnsAfter} colunas).
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>

      <div class="technical-footnote">
        <strong>Conclusão Técnica:</strong> O plano otimizado produz exatamente os mesmos resultados da consulta canônica, porém com um consumo significativamente menor de memória e tempo de processamento por reduzir o produto cartesiano e descartar dados inúteis na primeira oportunidade.
      </div>
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
    ['Projeção Final (π)', currentAlgebra.columns.join(', '), 'Atributos mantidos no resultado final da consulta'],
    ['Seleção (σ)', analysis.query.where ? analysis.query.predicateLabels.join(' ∧ ') : 'Sem predicado WHERE', 'Filtros aplicados para restringir tuplas'],
    ['Relações Base', analysis.query.tables.map(t => `${t.table} AS ${t.alias}`).join(', '), 'Tabelas do catálogo BD_Vendas lidas na base'],
    ['Modo de Execução', algebraMode === 'optimized' ? 'Álgebra Otimizada (Heurísticas 22/10)' : 'Álgebra Canônica (Não Otimizada)', 'Estratégia algébrica de avaliação'],
  ];

  $('#panel').innerHTML = heading(
    algebraMode === 'optimized' ? 'Expressão em Álgebra Relacional Otimizada (Heurísticas 22/10)' : 'Expressão em Álgebra Relacional Canônica (20/10)',
    'Conversão formal da consulta SQL para a notação relacional matemática de Codd.'
  ) + `
    <div class="algebra-container">
      <div class="formula-card">
        <div class="formula-card-header">
          <div class="graph-view-switcher" role="group" aria-label="Modo da álgebra">
            <button class="graph-view-btn ${algebraMode === 'optimized' ? 'active' : ''}" data-algebra-mode="optimized">
              ⚡ Álgebra Otimizada (22/10)
            </button>
            <button class="graph-view-btn ${algebraMode === 'canonical' ? 'active' : ''}" data-algebra-mode="canonical">
              Álgebra Canônica (20/10)
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
        ${algebraMode === 'optimized'
          ? '<strong>Álgebra Otimizada:</strong> Reflete a descida (push-down) das seleções para os nós folhas e a inclusão de projeções antecipadas para estreitar as relações antes da combinação binária.'
          : '<strong>Álgebra Canônica:</strong> Segue a ordem original sem otimização: primeiro realiza o produto/junção de todas as tabelas, aplica a seleção do WHERE no topo e projeta os atributos finais.'}
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
    planViewMode === 'optimized' ? 'Ordem de Execução Otimizada (Plano com Heurísticas 22/10)' : 'Ordem de Execução Canônica (Plano Sequencial 20/10)',
    'Sequência determinística calculada a partir do percurso pós-ordem (bottom-up) na árvore de operadores.'
  ) + `
    <div class="graph-control-bar" style="margin-bottom: 14px;">
      <div class="graph-view-switcher" role="group" aria-label="Modo do plano">
        <button class="graph-view-btn ${planViewMode === 'optimized' ? 'active' : ''}" data-plan-mode="optimized">
          ⚡ Plano Otimizado (Heurísticas 22/10)
        </button>
        <button class="graph-view-btn ${planViewMode === 'canonical' ? 'active' : ''}" data-plan-mode="canonical">
          Plano Canônico (Não Otimizado 20/10)
        </button>
      </div>
      <div style="font-size: 12px; color: var(--text-secondary); font-weight: 600;">
        Total de Passos: <span class="tuple-counter">${currentPlan.steps.length}</span>
      </div>
    </div>

    <div class="plan-wrapper">
      <table class="technical-table">
        <thead>
          <tr>
            <th style="width: 50px;">Passo</th>
            <th style="width: 150px;">Operador</th>
            <th>Ação Executada</th>
            <th>Predicado / Expressão</th>
            <th>Heurística Aplicada</th>
            <th style="width: 120px; text-align: right;">Tuplas Emitidas</th>
          </tr>
        </thead>
        <tbody>
          ${currentPlan.steps.map(step => `
            <tr>
              <td><span class="step-badge">${step.step}</span></td>
              <td><span class="op-glyph op-badge-${step.type}">${step.operator}</span> <strong>${escape(step.name)}</strong></td>
              <td>${escape(step.operation)}</td>
              <td><code>${escape(step.predicate || step.target || '—')}</code></td>
              <td>${step.heuristicLabel ? `<span class="node-heuristic-badge">${escape(step.heuristicLabel)}</span>` : '<span style="color: var(--text-dim);">Nenhuma (Padrão)</span>'}</td>
              <td style="text-align: right;"><span class="tuple-counter">${number(step.rowsProduced)} tuplas</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="technical-footnote">
      Cada nó folha alimenta suas tuplas para o nó pai imediatamente superior. O plano otimizado aplica reduções locais antes de acionar operadores binários mais caros.
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
      Os dados apresentados foram avaliados em memória pelo executor em Python utilizando os registros didáticos de BD_Vendas. Tanto o plano canônico quanto o plano otimizado geram o mesmo resultado.
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Visualização 6: Parser & Validação Semântica
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
// Visualização 7: Esquema BD_Vendas
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
// Visualização 8: Requisitos da Disciplina
// -----------------------------------------------------------------------------
function renderDeliveries() {
  const deliveries = [
    [1, '15/10/2026', 'Interface gráfica existente e funcional', 'Editor SQL, exemplos, navegação e exportação JSON', true],
    [1, '15/10/2026', 'A string é parseada', 'Lexer, parser e estrutura validada da consulta', true],
    [1, '15/10/2026', 'Campos e comandos errados são validados', 'Erros sintáticos, catálogo, ambiguidade, aliases e escopo', true],
    [2, '20/10/2026', 'Conversão para álgebra relacional', 'Expressão canônica em Unicode, LaTeX e componentes', true],
    [2, '20/10/2026', 'Grafo não otimizado', 'Árvore de operadores em memória, visualização e plano de execução', true],
    [3, '22/10/2026', 'Aplicação da Heurística Projeção e Seleção', 'Push-down de seleções (redução de tuplas) e push-down de projeções (redução de atributos)', true],
    [4, '27/10/2026', 'Demais heurísticas', 'Seletividade, reordenação de relações mais restritivas e ajustes finos', false],
  ];

  $('#panel').innerHTML = heading('Requisitos da Disciplina: Banco de Dados II', 'Matriz de entregas conforme as especificações oficiais do trabalho prático.') + `
    <div class="plan-wrapper">
      <table class="technical-table">
        <thead>
          <tr>
            <th style="width: 100px;">Prazo</th>
            <th style="width: 280px;">Requisito</th>
            <th>Descrição Técnica Implementada</th>
            <th style="width: 110px;">Situação</th>
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
      <strong>Entrega Atual (22/10/2026):</strong> As heurísticas de Redução de Tuplas (push-down de seleção) e Redução de Atributos (push-down de projeção) estão implementadas no motor Python e refletidas visualmente na árvore de operadores, álgebra relacional otimizada e plano físico.
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
