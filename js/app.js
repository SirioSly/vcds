/* ================================================================
   VCDS Dashboard — App Logic v3
   - Senha de acesso para importar arquivos
   - Upload múltiplo de arquivos (.txt)
   - Tela de Status do Carro (saúde, módulos, evoluções)
   - Engine de comparação: nova / recorrente / resolvida
   - Detecção de duplicatas
================================================================ */

const STORAGE_KEY = 'vcds_jetta_scans';
const AUTH_KEY    = 'vcds_auth';
const PASSWORD    = 'siriovcds';

let scans        = [];
let activeScanId = null;
let pendingAction = null;   // ação pendente aguardando senha

let chartModules   = null;
let chartFaultsBar = null;
let chartTimeline  = null;

// ── Bootstrap ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadScans();
  setupListeners();

  const latest = getLatestScan();
  if (latest) {
    // Já tem logs salvos → abre direto no dashboard com o scan mais recente
    activeScanId = latest.id;
    showDashboard(latest);
  }
  // Sem logs → permanece na tela de upload (comportamento padrão do HTML)
});

// ── Event listeners ──────────────────────────────────────────────
function setupListeners() {
  const fileInput     = document.getElementById('file-input');
  const fileInputDash = document.getElementById('file-input-dash');
  const dropZone      = document.getElementById('drop-zone');

  // Upload com senha
  fileInput.addEventListener('change', e => {
    const files = e.target.files;
    if (files && files.length > 0) handleFiles(files);
    e.target.value = '';
  });
  fileInputDash.addEventListener('change', e => {
    const files = e.target.files;
    if (files && files.length > 0) handleFiles(files);
    e.target.value = '';
  });

  document.getElementById('btn-upload-select').addEventListener('click', () =>
    requireAuth(() => fileInput.click())
  );
  document.getElementById('btn-new-scan').addEventListener('click', () =>
    requireAuth(() => fileInputDash.click())
  );
  document.getElementById('btn-open-history').addEventListener('click', openHistoryDrawer);
  document.getElementById('btn-back-from-status').addEventListener('click', backFromStatus);

  // Drag & drop (exige senha)
  dropZone.addEventListener('click', () => requireAuth(() => fileInput.click()));
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave',    () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = [...(e.dataTransfer.files || [])].filter(f => f.name.toLowerCase().endsWith('.txt'));
    if (files.length > 0) requireAuth(() => handleFiles(files));
  });
}

// ================================================================
//  AUTENTICAÇÃO POR SENHA
// ================================================================

function isAuthenticated() {
  return sessionStorage.getItem(AUTH_KEY) === '1';
}

/** Garante autenticação antes de executar uma ação. */
function requireAuth(callback) {
  if (isAuthenticated()) { callback(); return; }
  pendingAction = callback;
  showPasswordModal();
}

function showPasswordModal() {
  document.getElementById('pwd-overlay').classList.remove('hidden');
  document.getElementById('pwd-error').textContent = '';
  document.getElementById('pwd-input').value = '';
  setTimeout(() => document.getElementById('pwd-input').focus(), 80);
}

function cancelPassword() {
  pendingAction = null;
  document.getElementById('pwd-overlay').classList.add('hidden');
}

function confirmPassword() {
  const input = document.getElementById('pwd-input').value;
  if (input === PASSWORD) {
    sessionStorage.setItem(AUTH_KEY, '1');
    document.getElementById('pwd-overlay').classList.add('hidden');
    if (pendingAction) { pendingAction(); pendingAction = null; }
  } else {
    document.getElementById('pwd-error').textContent = 'Senha incorreta. Tente novamente.';
    document.getElementById('pwd-input').value = '';
    document.getElementById('pwd-input').focus();
    const card = document.getElementById('pwd-card');
    card.classList.remove('shake');
    void card.offsetWidth;   // reflow para reiniciar animação
    card.classList.add('shake');
  }
}

// ================================================================
//  MULTI-FILE HANDLING
// ================================================================

async function handleFiles(fileList) {
  const files = [...fileList].filter(f => f.name.toLowerCase().endsWith('.txt'));
  if (files.length === 0) return;

  let imported = 0;
  let skipped  = 0;
  let invalid  = 0;

  for (const file of files) {
    const result = await readAndImport(file);
    if      (result === 'ok')      imported++;
    else if (result === 'dupe')    skipped++;
    else if (result === 'invalid') invalid++;
  }

  // Feedback consolidado
  const parts = [];
  if (imported > 0) parts.push(`${imported} scan${imported > 1 ? 's' : ''} importado${imported > 1 ? 's' : ''}`);
  if (skipped  > 0) parts.push(`${skipped} já existia${skipped > 1 ? 'm' : ''}`);
  if (invalid  > 0) parts.push(`${invalid} inválido${invalid > 1 ? 's' : ''}`);

  const type = imported > 0 ? 'ok' : (skipped > 0 ? 'warn' : 'error');
  showToast(parts.join(' · '), type);

  if (imported > 0) {
    // Exibir o scan mais recente importado
    activeScanId = scans[scans.length - 1].id;
    showDashboard(getActiveScan());
  }
}

function readAndImport(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const raw  = e.target.result;
      const data = parseVCDS(raw);

      // Valida se parece um arquivo VCDS real
      if (!data.vin && data.modules.length === 0) {
        resolve('invalid');
        return;
      }

      // Deduplicação
      const fp = scanFingerprint(data);
      if (scans.find(s => scanFingerprint(s.data) === fp)) {
        resolve('dupe');
        return;
      }

      scans.push({ id: Date.now().toString() + Math.random(), filename: file.name, data });
      saveScans();
      resolve('ok');
    };
    reader.onerror = () => resolve('invalid');
    reader.readAsText(file, 'utf-8');
  });
}

function scanFingerprint(data) {
  return `${data.vin}|${data.scanDate}|${data.mileage}`;
}

// ── Storage ──────────────────────────────────────────────────────
function loadScans() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) scans = JSON.parse(raw);
  } catch { scans = []; }
}

function saveScans() {
  if (scans.length > 30) scans = scans.slice(-30);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scans)); } catch {}
}

function deleteScan(id) {
  scans = scans.filter(s => s.id !== id);
  saveScans();
  if (activeScanId === id)
    activeScanId = scans.length > 0 ? scans[scans.length - 1].id : null;
  if (activeScanId) {
    renderHistoryDrawer();
    showDashboard(getActiveScan());
  } else {
    closeHistoryDrawer();
    showUploadScreen();
  }
}

function getActiveScan()  { return scans.find(s => s.id === activeScanId); }
function getLatestScan()  { return scans.length === 0 ? null : scans.slice().sort((a,b) => b.data.scanTimestamp - a.data.scanTimestamp)[0]; }
function getFirstScan()   { return scans.length === 0 ? null : scans.slice().sort((a,b) => a.data.scanTimestamp - b.data.scanTimestamp)[0]; }

// ── Screen management ─────────────────────────────────────────────
function showUploadScreen() {
  document.getElementById('upload-screen').classList.remove('hidden');
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('status-screen').classList.add('hidden');
  renderUploadHistory();
}

function showDashboard(scan) {
  document.getElementById('upload-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  document.getElementById('status-screen').classList.add('hidden');
  renderDashboard(scan);
}

function showStatusScreen() {
  if (scans.length === 0) { showToast('Nenhum scan disponível.', 'warn'); return; }
  document.getElementById('upload-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('status-screen').classList.remove('hidden');
  renderStatusScreen();
}

function backFromStatus() {
  if (activeScanId && getActiveScan()) showDashboard(getActiveScan());
  else showUploadScreen();
}

// ── Upload screen history ─────────────────────────────────────────
function renderUploadHistory() {
  const section = document.getElementById('upload-history-section');
  const list    = document.getElementById('upload-history-list');
  if (scans.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';
  const sorted = scans.slice().sort((a,b) => b.data.scanTimestamp - a.data.scanTimestamp);
  list.innerHTML = sorted.map(scan => {
    const d = scan.data;
    const f = d.totalFaults;
    const cls = f === 0 ? 'ok' : f <= 3 ? 'warn' : 'danger';
    const txt = f === 0 ? 'Sem falhas' : `${f} falha${f > 1 ? 's' : ''}`;
    return `
      <div class="upload-history-item" onclick="selectAndShow('${scan.id}')">
        <div>
          <div class="scan-name">${esc(scan.filename)}</div>
          <div class="scan-meta">${d.scanDate} · ${d.mileage ? d.mileage.toLocaleString('pt-BR') + ' km' : '–'}</div>
        </div>
        <span class="scan-badge ${cls}">${txt}</span>
      </div>`;
  }).join('');
}

function selectAndShow(id) {
  activeScanId = id;
  showDashboard(getActiveScan());
}

// ================================================================
//  COMPARISON ENGINE
// ================================================================

function getPreviousScan(currentScan) {
  return scans
    .filter(s => s.id !== currentScan.id && s.data.scanTimestamp < currentScan.data.scanTimestamp)
    .sort((a, b) => b.data.scanTimestamp - a.data.scanTimestamp)[0] || null;
}

function getAllFaults(data) {
  const list = [];
  for (const mod of data.modules)
    for (const f of mod.faults)
      list.push({ ...f, moduleName: mod.name, moduleAddr: mod.address });
  return list;
}

function faultKey(f) { return `${f.moduleAddr}:${f.code}`; }

function getComparison(currentScan) {
  const prev = getPreviousScan(currentScan);
  if (!prev) return null;
  const curr = getAllFaults(currentScan.data);
  const prev_ = getAllFaults(prev.data);
  const currK = new Set(curr.map(faultKey));
  const prevK = new Set(prev_.map(faultKey));
  const moduleChanges = currentScan.data.modules
    .map(cm => {
      const pm = prev.data.modules.find(m => m.address === cm.address);
      return pm && pm.status !== cm.status
        ? { address: cm.address, name: cm.name, from: pm.status, to: cm.status }
        : null;
    }).filter(Boolean);
  return {
    previousScan:    prev,
    newFaults:       curr.filter(f => !prevK.has(faultKey(f))),
    resolvedFaults:  prev_.filter(f => !currK.has(faultKey(f))),
    recurringFaults: curr.filter(f =>  prevK.has(faultKey(f))),
    moduleChanges
  };
}

// ── Main dashboard render ─────────────────────────────────────────
function renderDashboard(scan) {
  const d   = scan.data;
  const cmp = getComparison(scan);

  document.getElementById('nav-vin').textContent  = d.vin || '';
  document.getElementById('nav-date').textContent = d.scanDate;
  document.getElementById('nav-km').textContent   = d.mileage ? d.mileage.toLocaleString('pt-BR') + ' km' : '';
  document.getElementById('history-count').textContent = scans.length;

  const ok          = d.modules.filter(m => m.status === 'OK').length;
  const malfunction = d.modules.filter(m => m.status === 'Malfunction').length;
  const unreachable = d.modules.filter(m => m.status === 'Cannot be reached').length;
  setNum('stat-ok',          ok);
  setNum('stat-malfunction', malfunction);
  setNum('stat-unreachable', unreachable);
  setNum('stat-faults',      d.totalFaults);

  renderCarInfo(d);
  renderComparisonBanner(cmp);
  renderChartModules(ok, malfunction, unreachable, d.modules.length);
  renderChartFaultsBar(d);
  renderChartTimeline();
  renderModulesGrid(d, cmp);
  renderFaultsList(d, cmp);
}

function renderComparisonBanner(cmp) {
  const banner = document.getElementById('comparison-banner');
  if (!cmp) { banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  const prev = cmp.previousScan.data;
  document.getElementById('cmp-prev-info').textContent =
    `vs. ${prev.scanDate}${prev.mileage ? ' · ' + prev.mileage.toLocaleString('pt-BR') + ' km' : ''}`;
  const toggle = (id, n) => {
    document.getElementById(id).classList.toggle('hidden', n === 0);
    document.getElementById(id.replace('cmp-delta-', 'cmp-n-')).textContent = n;
  };
  toggle('cmp-delta-new',       cmp.newFaults.length);
  toggle('cmp-delta-resolved',  cmp.resolvedFaults.length);
  toggle('cmp-delta-recurring', cmp.recurringFaults.length);
}

function renderCarInfo(d) {
  const rows = [
    ['VIN',              d.vin         || '–'],
    ['Quilometragem',    d.mileage     ? d.mileage.toLocaleString('pt-BR') + ' km' : '–'],
    ['Chassis',          d.chassisType || '–'],
    ['Data do scan',     d.scanDate    || '–'],
    ['VCDS',             d.vcdsVersion || '–'],
    ['Módulos scaneados', d.modules.length.toString()],
  ];
  document.getElementById('car-info-table').innerHTML = rows
    .map(([k, v]) => `<div class="info-row">
       <span class="info-key">${k}</span>
       <span class="info-val">${esc(v)}</span>
     </div>`).join('');
}

// ── Charts ────────────────────────────────────────────────────────
function renderChartModules(ok, malfunction, unreachable, total) {
  if (chartModules) chartModules.destroy();
  const ctx = document.getElementById('chart-modules').getContext('2d');
  chartModules = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['OK', 'Com Falha', 'Inacessível'],
      datasets: [{
        data: [ok, malfunction, unreachable],
        backgroundColor: ['rgba(34,211,160,0.85)', 'rgba(245,158,11,0.85)', 'rgba(75,82,112,0.6)'],
        borderColor:     ['#22d3a0', '#f59e0b', '#4b5270'],
        borderWidth: 2, hoverOffset: 6
      }]
    },
    options: {
      cutout: '72%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#8b8faa', font: { family: 'Inter', size: 12 }, padding: 16, boxWidth: 12, boxHeight: 12, borderRadius: 3 } },
        tooltip: tooltipDefaults()
      }
    }
  });
  document.getElementById('donut-center').innerHTML =
    `<span class="dc-num">${total}</span><span class="dc-lbl">módulos</span>`;
}

function renderChartFaultsBar(d) {
  if (chartFaultsBar) { chartFaultsBar.destroy(); chartFaultsBar = null; }
  const withFaults = d.modules.filter(m => m.faults.length > 0);
  const card = document.getElementById('card-faults-bar');
  if (withFaults.length === 0) { card.style.display = 'none'; return; }
  card.style.display = '';
  const ctx = document.getElementById('chart-faults-bar').getContext('2d');
  chartFaultsBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: withFaults.map(m => `${m.address} – ${m.name}`),
      datasets: [{ label: 'Falhas', data: withFaults.map(m => m.faults.length),
        backgroundColor: 'rgba(239,68,68,0.7)', borderColor: '#ef4444',
        borderWidth: 1.5, borderRadius: 4, borderSkipped: false }]
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: tooltipDefaults() },
      scales: {
        x: { ticks: { color: '#8b8faa', font: { family: 'Inter', size: 11 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { color: '#1c1c30' } },
        y: { ticks: { color: '#e4e6f4', font: { family: 'Inter', size: 12 } }, grid: { display: false }, border: { color: '#1c1c30' } }
      }
    }
  });
}

function renderChartTimeline() {
  if (chartTimeline) { chartTimeline.destroy(); chartTimeline = null; }
  const card = document.getElementById('card-timeline');
  if (scans.length < 2) { card.style.display = 'none'; return; }
  card.style.display = '';
  const sorted = scans.slice().sort((a,b) => a.data.scanTimestamp - b.data.scanTimestamp);
  const values = sorted.map(s => s.data.totalFaults);
  const kms    = sorted.map(s => s.data.mileage);
  const ctx = document.getElementById('chart-timeline').getContext('2d');
  chartTimeline = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sorted.map(s => s.data.scanDate),
      datasets: [{
        label: 'Códigos de falha', data: values,
        borderColor: '#5b8ef8', backgroundColor: 'rgba(91,142,248,0.08)',
        fill: true, tension: 0.4,
        pointBackgroundColor: values.map((v, i) =>
          i === 0 ? '#5b8ef8' : v > values[i-1] ? '#ef4444' : v < values[i-1] ? '#22d3a0' : '#5b8ef8'
        ),
        pointBorderColor: '#0d0d1a', pointBorderWidth: 2, pointRadius: 5, pointHoverRadius: 7
      }]
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { ...tooltipDefaults(),
        callbacks: { afterLabel: c => `Km: ${(kms[c.dataIndex] || 0).toLocaleString('pt-BR')}` }
      }},
      scales: {
        x: { ticks: { color: '#8b8faa', font: { family: 'Inter', size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { color: '#1c1c30' } },
        y: { ticks: { color: '#8b8faa', font: { family: 'Inter', size: 11 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { color: '#1c1c30' } }
      }
    }
  });
}

// ── Modules grid ──────────────────────────────────────────────────
function renderModulesGrid(d, cmp) {
  const changedAddr = new Map();
  if (cmp) cmp.moduleChanges.forEach(ch => changedAddr.set(ch.address, ch));
  document.getElementById('modules-grid').innerHTML = d.modules.map(m => {
    const isOk   = m.status === 'OK';
    const isWarn = m.status === 'Malfunction';
    const cls = isOk ? 'ok-card' : isWarn ? 'warn-card' : 'muted-card';
    const dot = isOk ? 'ok' : isWarn ? 'warn' : 'muted';
    const faultBadge = m.faults.length > 0
      ? `<span class="module-fault-count">⚑ ${m.faults.length} falha${m.faults.length > 1 ? 's' : ''}</span>` : '';
    const ch = changedAddr.get(m.address);
    const changeBadge = ch
      ? `<span class="module-change-badge ${ch.from === 'OK' ? 'worse' : ch.to === 'OK' ? 'better' : 'changed'}">
           ${ch.to === 'OK' ? '↑ Melhorou' : ch.from === 'OK' ? '↓ Piorou' : '~ Mudou'}
         </span>` : '';
    return `
      <div class="module-card ${cls}">
        <div class="module-top">
          <span class="module-addr">${esc(m.address)}</span>
          <span class="module-dot ${dot}"></span>
        </div>
        <div class="module-name">${esc(m.name)}</div>
        ${faultBadge}${changeBadge}
      </div>`;
  }).join('');
}

// ── Faults list ───────────────────────────────────────────────────
function renderFaultsList(d, cmp) {
  const list  = document.getElementById('faults-list');
  const badge = document.getElementById('faults-count-badge');
  const allFaults = getAllFaults(d);

  if (cmp) {
    const newK = new Set(cmp.newFaults.map(faultKey));
    const recK = new Set(cmp.recurringFaults.map(faultKey));
    allFaults.forEach(f => {
      f._delta = newK.has(faultKey(f)) ? 'new' : recK.has(faultKey(f)) ? 'recurring' : null;
    });
    allFaults.sort((a, b) => ({ new: 0, recurring: 1 }[a._delta] ?? 2) - ({ new: 0, recurring: 1 }[b._delta] ?? 2));
  }

  badge.textContent  = allFaults.length > 0 ? allFaults.length : '';
  badge.style.display = allFaults.length > 0 ? '' : 'none';

  if (allFaults.length === 0 && (!cmp || cmp.resolvedFaults.length === 0)) {
    list.innerHTML = `<div class="no-faults"><div class="no-faults-icon">✓</div><p>Nenhuma falha encontrada neste scan</p></div>`;
    return;
  }

  let html = allFaults.map((f, i) => renderFaultItem(f, i, f._delta)).join('');
  if (cmp && cmp.resolvedFaults.length > 0) {
    html += `<div class="resolved-section-title"><span class="resolved-icon">✓</span>Resolvidas desde o scan anterior</div>`;
    html += cmp.resolvedFaults.map((f, i) => renderFaultItem(f, allFaults.length + i, 'resolved')).join('');
  }
  list.innerHTML = html;
}

function renderFaultItem(f, i, delta) {
  const hasFF = Object.keys(f.freezeFrame || {}).length > 0;
  const deltaBadge = {
    new:       `<span class="fault-delta new">Nova</span>`,
    recurring: `<span class="fault-delta recurring">Recorrente</span>`,
    resolved:  `<span class="fault-delta resolved">Resolvida</span>`
  }[delta] || '';
  const freqBadge = f.frequency > 0 ? `<span class="fault-freq">${f.frequency}×</span>` : '';
  const ffRows = hasFF ? Object.entries(f.freezeFrame)
    .map(([k, v]) => `<div class="freeze-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('') : '';
  const freezeBlock = hasFF
    ? `<div class="fault-body"><div class="freeze-frame-title">Freeze Frame</div><div class="freeze-table">${ffRows}</div></div>` : '';
  const metaMod = `<span class="fault-meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>${esc(f.moduleAddr)} – ${esc(f.moduleName)}</span>`;
  const metaKm  = f.mileage ? `<span class="fault-meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${esc(f.mileage)}</span>` : '';
  const metaDate = f.date ? `<span class="fault-meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${esc(f.date)}</span>` : '';
  const toggleBtn = hasFF ? `<div class="fault-toggle"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></div>` : '';

  return `
    <div class="fault-item${delta === 'resolved' ? ' resolved' : ''}" id="fault-${i}">
      <div class="fault-header" ${hasFF ? `onclick="toggleFault('fault-${i}')"` : ''}>
        <div class="fault-codes">
          <span class="fault-id">${esc(f.code)}</span>
          ${f.pCode ? `<span class="fault-pcode">${esc(f.pCode)}</span>` : ''}
          ${freqBadge}
        </div>
        <div class="fault-info">
          <div class="fault-desc-row">
            <span class="fault-desc">${esc(f.description)}</span>
            ${deltaBadge}
          </div>
          ${f.detail ? `<div class="fault-detail">${esc(f.detail)}</div>` : ''}
          <div class="fault-meta">${metaMod}${metaKm}${metaDate}</div>
        </div>
        ${toggleBtn}
      </div>
      ${freezeBlock}
    </div>`;
}

function toggleFault(id) { document.getElementById(id).classList.toggle('open'); }

// ── History drawer ────────────────────────────────────────────────
function openHistoryDrawer() {
  renderHistoryDrawer();
  document.getElementById('history-drawer').classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
}
function closeHistoryDrawer() {
  document.getElementById('history-drawer').classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
}
function renderHistoryDrawer() {
  const list   = document.getElementById('drawer-scan-list');
  const sorted = scans.slice().sort((a,b) => b.data.scanTimestamp - a.data.scanTimestamp);
  if (sorted.length === 0) {
    list.innerHTML = `<p style="color:var(--text2);font-size:.85rem;text-align:center;padding:24px">Nenhum scan salvo.</p>`;
    return;
  }
  list.innerHTML = sorted.map(scan => {
    const d = scan.data;
    const f = d.totalFaults;
    return `
      <div class="drawer-scan-item ${scan.id === activeScanId ? 'active' : ''}" onclick="selectScan('${scan.id}')">
        <div class="dsi-name" title="${esc(scan.filename)}">${esc(scan.filename)}</div>
        <div class="dsi-meta">${d.scanDate} · ${d.mileage ? d.mileage.toLocaleString('pt-BR') + ' km' : '–'}</div>
        <div class="dsi-footer">
          <span class="dsi-faults ${f === 0 ? 'none' : 'some'}">${f === 0 ? 'Sem falhas' : f + ' falha' + (f > 1 ? 's' : '')}</span>
          <button class="dsi-del" onclick="event.stopPropagation();deleteScan('${scan.id}')">Remover</button>
        </div>
      </div>`;
  }).join('');
}
function selectScan(id) {
  activeScanId = id;
  closeHistoryDrawer();
  showDashboard(getActiveScan());
}

// ================================================================
//  STATUS SCREEN
// ================================================================

function renderStatusScreen() {
  const latest = getLatestScan();
  const first  = getFirstScan();
  if (!latest) return;
  const d = latest.data;

  // Nav VIN
  document.getElementById('status-nav-vin').textContent = d.vin || '';

  // Health score
  const score = calcHealthScore(d);
  renderHealthRing(score, d, latest);

  // Evolutions
  renderEvolutions(latest, first);

  // Modules table
  renderModulesTable(d);

  // Active faults
  renderStatusFaults(d);
}

// ── Health score ──────────────────────────────────────────────────
function calcHealthScore(data) {
  const reachable = data.modules.filter(m => m.status !== 'Cannot be reached').length;
  if (reachable === 0) return 100;
  const ok   = data.modules.filter(m => m.status === 'OK').length;
  const base = Math.round((ok / reachable) * 100);
  return Math.max(0, base - Math.min(data.totalFaults * 3, 35));
}

function renderHealthRing(score, d, scan) {
  const CIRC = 2 * Math.PI * 52;  // r=52
  const ring  = document.getElementById('ring-fg');
  const numEl = document.getElementById('health-score-num');
  const pctEl = document.getElementById('health-score-pct');

  const color = score >= 80 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--danger)';
  ring.style.stroke           = color;
  ring.style.strokeDashoffset = CIRC - (CIRC * score / 100);
  numEl.style.color = color;
  numEl.textContent = score;
  pctEl.style.color = color;

  // Info
  document.getElementById('health-vin').textContent  = d.vin || '';
  document.getElementById('health-meta').textContent =
    `Último scan: ${d.scanDate}${d.mileage ? ' · ' + d.mileage.toLocaleString('pt-BR') + ' km' : ''}`;

  const ok    = d.modules.filter(m => m.status === 'OK').length;
  const warn  = d.modules.filter(m => m.status === 'Malfunction').length;
  const unrch = d.modules.filter(m => m.status === 'Cannot be reached').length;

  document.getElementById('health-mini-stats').innerHTML = [
    `<span class="hms ok"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>${ok} OK</span>`,
    warn  > 0 ? `<span class="hms warn"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>${warn} com falha</span>` : '',
    unrch > 0 ? `<span class="hms muted"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>${unrch} inacessível</span>` : '',
    d.totalFaults > 0 ? `<span class="hms danger">⚑ ${d.totalFaults} código${d.totalFaults > 1 ? 's' : ''} de falha</span>` : `<span class="hms ok">✓ Sem falhas ativas</span>`,
    `<span class="hms blue">📋 ${scans.length} scan${scans.length > 1 ? 's' : ''} registrado${scans.length > 1 ? 's' : ''}</span>`
  ].join('');
}

// ── Evolutions ────────────────────────────────────────────────────
function renderEvolutions(latest, first) {
  const card = document.getElementById('evolutions-card');
  if (!first || first.id === latest.id) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  const latestFaults = new Set(getAllFaults(latest.data).map(faultKey));
  const firstFaults  = new Set(getAllFaults(first.data).map(faultKey));

  // Resolvidas: estavam no primeiro scan, não estão no último
  const resolved = [];
  const seenR = new Set();
  const sortedScans = scans.slice().sort((a,b) => a.data.scanTimestamp - b.data.scanTimestamp);
  for (const scan of sortedScans.filter(s => s.id !== latest.id)) {
    for (const f of getAllFaults(scan.data)) {
      const k = faultKey(f);
      if (!latestFaults.has(k) && !seenR.has(k)) {
        seenR.add(k);
        resolved.push({ ...f, seenIn: scan.data.scanDate });
      }
    }
  }

  // Novas: não estavam no primeiro scan, estão no último
  const newSincFirst = getAllFaults(latest.data).filter(f => !firstFaults.has(faultKey(f)));

  let html = '';

  if (resolved.length > 0) {
    html += `<div class="evo-group">
      <div class="evo-group-title" style="color:var(--ok)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        ${resolved.length} falha${resolved.length > 1 ? 's' : ''} resolvida${resolved.length > 1 ? 's' : ''}
      </div>`;
    html += resolved.map(f => `
      <div class="evo-item">
        <div class="evo-dot resolved">✓</div>
        <div class="evo-body">
          <div class="evo-codes">
            <span class="evo-vag">${esc(f.code)}</span>
            ${f.pCode ? `<span class="evo-pcode">${esc(f.pCode)}</span>` : ''}
          </div>
          <div class="evo-desc">${esc(f.description)}</div>
          <div class="evo-meta">${esc(f.moduleName)} · Detectada em ${esc(f.seenIn)}</div>
        </div>
      </div>`).join('');
    html += `</div>`;
  }

  if (newSincFirst.length > 0) {
    html += `<div class="evo-group">
      <div class="evo-group-title" style="color:var(--danger)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ${newSincFirst.length} nova${newSincFirst.length > 1 ? 's' : ''} desde o 1º scan
      </div>`;
    html += newSincFirst.map(f => `
      <div class="evo-item">
        <div class="evo-dot new">+</div>
        <div class="evo-body">
          <div class="evo-codes">
            <span class="evo-vag">${esc(f.code)}</span>
            ${f.pCode ? `<span class="evo-pcode">${esc(f.pCode)}</span>` : ''}
          </div>
          <div class="evo-desc">${esc(f.description)}</div>
          <div class="evo-meta">${esc(f.moduleName)}</div>
        </div>
      </div>`).join('');
    html += `</div>`;
  }

  if (!html) {
    html = `<p style="color:var(--ok);font-size:.85rem;text-align:center;padding:16px">
      ✓ Nenhuma mudança de falhas desde o 1º scan.
    </p>`;
  }

  document.getElementById('evolutions-content').innerHTML = html;
}

// ── Modules table ─────────────────────────────────────────────────
function renderModulesTable(d) {
  const tbody = document.getElementById('modules-table-body');
  tbody.innerHTML = d.modules.map(m => {
    const isOk   = m.status === 'OK';
    const isWarn = m.status === 'Malfunction';
    const scls   = isOk ? 'ok' : isWarn ? 'warn' : 'muted';
    const stxt   = isOk ? '● OK' : isWarn ? '● Falha' : '○ Inacessível';
    return `<tr>
      <td><span class="tbl-addr">${esc(m.address)}</span></td>
      <td style="font-weight:500">${esc(m.name)}</td>
      <td><span class="tbl-status ${scls}">${stxt}</span></td>
      <td class="tbl-mono">${esc(m.component || '–')}</td>
      <td class="tbl-mono">${esc(m.partNoSW  || '–')}</td>
      <td class="tbl-mono">${esc(m.coding    || '–')}</td>
    </tr>`;
  }).join('');
}

function filterModulesTable(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('#modules-table-body tr').forEach(row => {
    row.style.display = (!q || row.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
}

// ── Status screen faults ──────────────────────────────────────────
function renderStatusFaults(d) {
  const card  = document.getElementById('status-faults-card');
  const list  = document.getElementById('status-faults-list');
  const badge = document.getElementById('status-faults-badge');
  const faults = getAllFaults(d);

  if (faults.length === 0) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  badge.textContent = faults.length;
  list.innerHTML = faults.map((f, i) => renderFaultItem(f, 'sf-' + i, null)).join('');
}

// ── Toast ─────────────────────────────────────────────────────────
function showToast(msg, type = 'ok') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className   = `toast toast-${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

// ── Chart defaults ────────────────────────────────────────────────
function tooltipDefaults() {
  return {
    backgroundColor: '#10101e', borderColor: '#1c1c30', borderWidth: 1,
    titleColor: '#e4e6f4', bodyColor: '#8b8faa', padding: 12, cornerRadius: 8,
    titleFont: { family: 'Inter', size: 13, weight: '600' },
    bodyFont:  { family: 'Inter', size: 12 }
  };
}

// ── Helpers ───────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function setNum(id, n) { const el = document.getElementById(id); if (el) el.textContent = n; }
