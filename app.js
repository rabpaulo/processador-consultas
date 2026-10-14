// QueryLab: Interface de controle e renderização em JavaScript.
// A lógica do analisador léxico, sintático e catálogo relacional está em Python.

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = value => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

let schema = {}, sampleCounts = {}, examples = [], requestSequence = 0;
let analysis = null, activeTab = 'parser', selectedTable = null, lastSql = '';

// Navegação do catálogo pela barra lateral
$('#table-nav').addEventListener('click', event => {
  const button = event.target.closest('[data-table]');
  if (!button) return;
  selectTable(button.dataset.table);
});

// Clique nos cards do esquema para seleção mútua
$('#panel').addEventListener('click', event => {
  const card = event.target.closest('.schema-card');
  if (!card) return;
  const table = card.id.replace('schema-', '');
  selectTable(selectedTable === table ? null : table);
});

function selectTable(table) {
  selectedTable = table;
  document.querySelectorAll('#table-nav button').forEach(btn => {
    const isCurrent = btn.dataset.table === selectedTable;
    btn.setAttribute('aria-current', isCurrent ? 'true' : 'false');
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
  const request = ++requestSequence;
  const sql = $('#sql').value;

  $('#error').hidden = true;
  $('#status').classList.remove('pending');
  $('#status').textContent = 'Analisando consulta no Python...';
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

    $('#status').textContent = 'Consulta válida: análise sintática e semântica concluída.';
    $('.pipeline-card').classList.add('complete');

    const changed = $('#sql').value !== sql;
    $('#export').disabled = changed;
    if (changed) {
      $('#status').classList.add('pending');
      $('#status').textContent = 'Consulta alterada: clique em Executar para atualizar.';
    }

    renderMetrics();
    // Alterna para a aba Parser para exibir imediatamente o resultado gerado
    switchTab('parser');
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
  $('#status').classList.add('pending');
  $('#status').textContent = 'Consulta alterada: clique em Executar para atualizar.';
  $('#export').disabled = true;
  // Limpa seleção do exemplo para não manter estado defasado
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
    ['Colunas', analysis.query.columns.length, 'Campos e aliases validados'],
    ['Tokens', analysis.query.tokens.length, 'Componentes léxicos analisados'],
    ['Predicados', analysis.query.predicateLabels.length, 'Condições em ON e WHERE'],
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
  if (activeTab === 'parser') renderParser();
}

function renderParser() {
  const query = analysis.query;
  const predicates = query.predicateLabels;

  $('#panel').innerHTML = heading('Componentes da Consulta', 'Tokens léxicos, relações resolvidas e predicados validados contra o catálogo.') + `
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

function renderSchema() {
  $('#panel').innerHTML = heading('Catálogo BD_Vendas', 'As dez tabelas do modelo de dados utilizadas para validar referências e tipos.') + `
    <div class="schema-grid">
      ${Object.entries(schema).map(([table, columns]) => `
        <article id="schema-${table}" class="schema-card ${selectedTable === table ? 'selected' : ''}">
          <h3>${table} <small>${sampleCounts[table] ?? 0} registros</small></h3>
          <ul>${columns.map(column => `<li>${column}</li>`).join('')}</ul>
        </article>
      `).join('')}
    </div>
    <p class="note">Os registros são exemplos didáticos locais. O script DDL correspondente para MySQL encontra-se em sql/bd-vendas.sql.</p>
  `;
}

function renderDeliveries() {
  const deliveries = [
    [1, '15/10/2026', 'Interface gráfica existente e funcional', 'Editor SQL, exemplos, navegação e exportação JSON'],
    [1, '15/10/2026', 'A string é parseada', 'Lexer, parser e estrutura validada da consulta'],
    [1, '15/10/2026', 'Campos e comandos errados são validados', 'Erros sintáticos, catálogo, ambiguidade, aliases e escopo'],
    [2, '20/10/2026', 'Conversão para álgebra relacional', 'Expressão relacional calculada em Python'],
    [2, '20/10/2026', 'Grafo não otimizado', 'Operadores na ordem original da consulta'],
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
              <td><span class="badge">${delivery <= 1 ? 'Disponível' : 'Etapa futura'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p class="note">A entrega 1 contempla a interface completa, o parser sintático e o validador semântico com mensagens informativas de erro.</p>
  `;
}

async function initialize() {
  $('#run').disabled = true;
  $('#status').textContent = 'Conectando ao backend Python...';
  try {
    const catalog = await requestJson('/api/catalog');
    ({ schema, sampleCounts, examples } = catalog);

    $('#example').innerHTML = '<option value="">Carregar exemplo...</option>' +
      examples.map((example, index) => `<option value="${index}">${escape(example.name)}</option>`).join('');

    $('#table-nav').innerHTML = Object.keys(schema).map(table => `
      <button data-table="${table}" type="button">
        <span>▤</span>
        <span>${table}</span>
        <small>${schema[table].length}</small>
      </button>
    `).join('');

    const countElem = $('#catalog-count');
    if (countElem) countElem.textContent = Object.keys(schema).length;

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
