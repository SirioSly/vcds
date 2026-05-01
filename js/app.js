/* ================================================================
   VCDS Dashboard — App Logic v2
   - Comparison engine: new / recurring / resolved faults between scans
   - Duplicate scan detection
   - Module status delta between scans
================================================================ */

const STORAGE_KEY = 'vcds_jetta_scans';
let scans        = [];   // all stored scans (parsed + metadata)
let activeScanId = null; // currently displayed scan id

let chartModules   = null;
let chartFaultsBar = null;
let chartTimeline  = null;

// ── Bootstrap ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadScans();
  setupListeners();

  if (scans.length > 0) {
    activeScanId = scans[scans.length - 1].id;
    showDashboard(getActiveScan());
  } else {
    renderUploadHistory();
  }
});

// ── Event listeners ──────────────────────────────────────────────
function setupListeners() {
  const fileInput     = document.getElementById('file-input');
  const fileInputDash = document.getElementById('file-input-dash');
  const dropZone      = document.getElementById('drop-zone');

  fileInput.addEventListener('change',     e => handleFile(e.target.files[0]));
  fileInputDash.addEventListener('change', e => handleFile(e.target.files[0]));

  document.getElementById('btn-upload-select')
    .addEventListener('click', () => fileInput.click());

  document.getElementById('btn-new-scan')
    .addEventListener('click', () => { fileInputDash.value = ''; fileInputDash.click(); });

  document.getElementById('btn-open-history')
    .addEventListener('click', openHistoryDrawer);

  dropZone.addEventListener('click',    () => fileInput.click());
  dropZone.addEventListener('dragover', e  => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave',    () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.txt')) handleFile(file);
  });
}

// ── File handling ────────────────────────────────────────────────
function handleFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    const raw  = e.target.result;
    const data = parseVCDS(raw);

    // ── Duplicate detection: same VIN + same scan date + same mileage
    const fp = scanFingerprint(data);
    const dupe = scans.find(s => scanFingerprint(s.data) === fp);
    if (dupe) {
      showToast('Este scan já foi importado anteriormente.', 'warn');
      activeScanId = dupe.id;
      showDashboard(dupe);
      return;
    }

    // ── Sanity: check if it looks like a VCDS file
    if (!data.vin && data.modules.length === 0) {
      showToast('Arquivo não reconhecido como log VCDS.', 'error');
      return;
    }

    const scan = {
      id:       Date.now().toString(),
      filename: file.name,
      data
    };

    scans.push(scan);
    saveScans();
    activeScanId = scan.id;
    showDashboard(scan);
    showToast('Scan importado com sucesso!', 'ok');
  };
  reader.readAsText(file, 'utf-8');
}

/** Fingerprint to detect duplicate uploads */
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
  if (activeScanId === id) {
    activeScanId = scans.length > 0 ? scans[scans.length - 1].id : null;
  }
  if (activeScanId) {
    renderHistoryDrawer();
    showDashboard(getActiveScan());
  } else {
    closeHistoryDrawer();
    showUploadScreen();
  }
}

function getActiveScan() { return scans.find(s => s.id === activeScanId); }

// ── Screen management ─────────────────────────────────────────────
function showUploadScreen() {
  document.getElementById('upload-screen').classList.remove('hidden');
  document.getElementById('dashboard-screen').classList.add('hidden');
  renderUploadHistory();
}

function showDashboard(scan) {
  document.getElementById('upload-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  renderDashboard(scan);
}

// ── Upload screen history ─────────────────────────────────────────
function renderUploadHistory() {
  const section = document.getElementById('upload-history-section');
  const list    = document.getElementById('upload-history-list');
  if (scans.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = scans.slice().reverse().map(scan => {
    const d      = scan.data;
    const faults = d.totalFaults;
    const badgeCls = faults === 0 ? 'ok' : faults <= 3 ? 'warn' : 'danger';
    const badgeTxt = faults === 0 ? 'Sem falhas' : `${faults} falha${faults > 1 ? 's' : ''}`;
    return `
      <div class="upload-history-item" onclick="selectAndShow('${scan.id}')">
        <div>
          <div class="scan-name">${esc(scan.filename)}</div>
          <div class="scan-meta">${d.scanDate} · ${d.mileage ? d.mileage.toLocaleString('pt-BR') + ' km' : '–'}</div>
        </div>
        <span class="scan-badge ${badgeCls}">${badgeTxt}</span>
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

/**
 * Returns the most recent scan that occurred BEFORE the given scan.
 * Used as the reference baseline for comparison.
 */
function getPreviousScan(currentScan) {
  return scans
    .filter(s => s.id !== currentScan.id && s.data.scanTimestamp < currentScan.data.scanTimestamp)
    .sort((a, b) => b.data.scanTimestamp - a.data.scanTimestamp)[0] || null;
}

/**
 * Flatten all faults from a scan's data into a single list,
 * each augmented with moduleAddr and moduleName.
 */
function getAllFaults(data) {
  const list = [];
  for (const mod of data.modules) {
    for (const f of mod.faults) {
      list.push({ ...f, moduleName: mod.name, moduleAddr: mod.address });
    }
  }
  return list;
}

/**
 * Unique key for a fault: address + numeric VAG code.
 * pCode is derived from the numeric code so the numeric one is sufficient.
 */
function faultKey(f) {
  return `${f.moduleAddr}:${f.code}`;
}

/**
 * Build comparison object between current and previous scan.
 * Returns null if no previous scan exists.
 */
function getComparison(currentScan) {
  const prev = getPreviousScan(currentScan);
  if (!prev) return null;

  const currFaults = getAllFaults(currentScan.data);
  const prevFaults = getAllFaults(prev.data);

  const currKeys = new Set(currFaults.map(faultKey));
  const prevKeys = new Set(prevFaults.map(faultKey));

  // Module status changes
  const moduleChanges = [];
  for (const cm of currentScan.data.modules) {
    const pm = prev.data.modules.find(m => m.address === cm.address);
    if (pm && pm.status !== cm.status) {
      moduleChanges.push({
        address: cm.address,
        name:    cm.name,
        from:    pm.status,
        to:      cm.status
      });
    }
  }

  return {
    previousScan:     prev,
    newFaults:        currFaults.filter(f => !prevKeys.has(faultKey(f))),
    resolvedFaults:   prevFaults.filter(f => !currKeys.has(faultKey(f))),
    recurringFaults:  currFaults.filter(f =>  prevKeys.has(faultKey(f))),
    moduleChanges
  };
}

// ── Main render ───────────────────────────────────────────────────
function renderDashboard(scan) {
  const d   = scan.data;
  const cmp = getComparison(scan);   // null if no previous scan

  // Nav bar
  document.getElementById('nav-vin').textContent  = d.vin || '';
  document.getElementById('nav-date').textContent = d.scanDate;
  document.getElementById('nav-km').textContent   = d.mileage ? d.mileage.toLocaleString('pt-BR') + ' km' : '';
  document.getElementById('history-count').textContent = scans.length;

  // Stat cards
  const ok          = d.modules.filter(m => m.status === 'OK').length;
  const malfunction = d.modules.filter(m => m.status === 'Malfunction').length;
  const unreachable = d.modules.filter(m => m.status === 'Cannot be reached').length;

  setNum('stat-ok',           ok);
  setNum('stat-malfunction',  malfunction);
  setNum('stat-unreachable',  unreachable);
  setNum('stat-faults',       d.totalFaults);

  // Sections
  renderCarInfo(d);
  renderComparisonBanner(cmp);
  renderChartModules(ok, malfunction, unreachable, d.modules.length);
  renderChartFaultsBar(d);
  renderChartTimeline();
  renderModulesGrid(d, cmp);
  renderFaultsList(d, cmp);
}

// ── Comparison banner ─────────────────────────────────────────────
function renderComparisonBanner(cmp) {
  const banner = document.getElementById('comparison-banner');
  if (!cmp) { banner.classList.add('hidden'); return; }

  banner.classList.remove('hidden');

  const prev = cmp.previousScan.data;
  document.getElementById('cmp-prev-info').textContent =
    `vs. ${prev.scanDate}${prev.mileage ? ' · ' + prev.mileage.toLocaleString('pt-BR') + ' km' : ''}`;

  const nNew       = cmp.newFaults.length;
  const nResolved  = cmp.resolvedFaults.length;
  const nRecurring = cmp.recurringFaults.length;

  const elNew  = document.getElementById('cmp-delta-new');
  const elRes  = document.getElementById('cmp-delta-resolved');
  const elRec  = document.getElementById('cmp-delta-recurring');

  elNew.classList.toggle('hidden', nNew === 0);
  elRes.classList.toggle('hidden', nResolved === 0);
  elRec.classList.toggle('hidden', nRecurring === 0);

  document.getElementById('cmp-n-new').textContent      = nNew;
  document.getElementById('cmp-n-resolved').textContent = nResolved;
  document.getElementById('cmp-n-recurring').textContent= nRecurring;
}

// ── Car info ──────────────────────────────────────────────────────
function renderCarInfo(d) {
  const rows = [
    ['VIN',              d.vin         || '–'],
    ['Quilometragem',    d.mileage     ? d.mileage.toLocaleString('pt-BR') + ' km' : '–'],
    ['Chassis',          d.chassisType || '–'],
    ['Data do scan',     d.scanDate    || '–'],
    ['VCDS',             d.vcdsVersion || '–'],
    ['Módulos scaneados', d.modules.length.toString()],
  ];
  document.getElementById('car-info-table').innerHTML = rows.map(([k, v]) =>
    `<div class="info-row">
       <span class="info-key">${k}</span>
       <span class="info-val">${esc(v)}</span>
     </div>`
  ).join('');
}

// ── Chart: module status donut ────────────────────────────────────
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
        borderWidth: 2,
        hoverOffset: 6
      }]
    },
    options: {
      cutout: '72%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#8b8faa',
            font: { family: 'Inter', size: 12 },
            padding: 16, boxWidth: 12, boxHeight: 12, borderRadius: 3
          }
        },
        tooltip: tooltipDefaults()
      }
    }
  });

  const center = document.getElementById('donut-center');
  center.innerHTML = `<span class="dc-num">${total}</span><span class="dc-lbl">módulos</span>`;
}

// ── Chart: faults per module bar ──────────────────────────────────
function renderChartFaultsBar(d) {
  if (chartFaultsBar) { chartFaultsBar.destroy(); chartFaultsBar = null; }
  const withFaults = d.modules.filter(m => m.faults.length > 0);
  const card = document.getElementById('card-faults-bar');
  if (withFaults.length === 0) { card.style.display = 'none'; return; }
  card.style.display = '';

  const labels = withFaults.map(m => `${m.address} – ${m.name}`);
  const values = withFaults.map(m => m.faults.length);

  const ctx = document.getElementById('chart-faults-bar').getContext('2d');
  chartFaultsBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Falhas',
        data: values,
        backgroundColor: 'rgba(239,68,68,0.7)',
        borderColor: '#ef4444',
        borderWidth: 1.5,
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: tooltipDefaults() },
      scales: {
        x: {
          ticks: { color: '#8b8faa', font: { family: 'Inter', size: 11 }, stepSize: 1 },
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { color: '#1c1c30' }
        },
        y: {
          ticks: { color: '#e4e6f4', font: { family: 'Inter', size: 12 } },
          grid: { display: false },
          border: { color: '#1c1c30' }
        }
      }
    }
  });
}

// ── Chart: fault timeline (2+ scans) ─────────────────────────────
function renderChartTimeline() {
  if (chartTimeline) { chartTimeline.destroy(); chartTimeline = null; }
  const card = document.getElementById('card-timeline');
  if (scans.length < 2) { card.style.display = 'none'; return; }
  card.style.display = '';

  const sorted = scans.slice().sort((a, b) => a.data.scanTimestamp - b.data.scanTimestamp);
  const labels = sorted.map(s => s.data.scanDate);
  const values = sorted.map(s => s.data.totalFaults);
  const kms    = sorted.map(s => s.data.mileage);

  const ctx = document.getElementById('chart-timeline').getContext('2d');
  chartTimeline = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Códigos de falha',
        data: values,
        borderColor: '#5b8ef8',
        backgroundColor: 'rgba(91,142,248,0.08)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: values.map((v, i) => {
          if (i === 0) return '#5b8ef8';
          return v > values[i - 1] ? '#ef4444' : v < values[i - 1] ? '#22d3a0' : '#5b8ef8';
        }),
        pointBorderColor: '#0d0d1a',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipDefaults(),
          callbacks: {
            afterLabel: ctx2 => `Km: ${(kms[ctx2.dataIndex] || 0).toLocaleString('pt-BR')}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#8b8faa', font: { family: 'Inter', size: 11 } },
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { color: '#1c1c30' }
        },
        y: {
          ticks: { color: '#8b8faa', font: { family: 'Inter', size: 11 }, stepSize: 1 },
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { color: '#1c1c30' }
        }
      }
    }
  });
}

// ── Modules grid ──────────────────────────────────────────────────
function renderModulesGrid(d, cmp) {
  const grid = document.getElementById('modules-grid');

  // Build a map of module status changes for quick lookup
  const changedAddr = new Map();   // address → { from, to }
  if (cmp) {
    for (const ch of cmp.moduleChanges) changedAddr.set(ch.address, ch);
  }

  grid.innerHTML = d.modules.map(m => {
    const isOk   = m.status === 'OK';
    const isWarn = m.status === 'Malfunction';
    const cls    = isOk ? 'ok-card' : isWarn ? 'warn-card' : 'muted-card';
    const dot    = isOk ? 'ok' : isWarn ? 'warn' : 'muted';

    const faultBadge = m.faults.length > 0
      ? `<span class="module-fault-count">⚑ ${m.faults.length} falha${m.faults.length > 1 ? 's' : ''}</span>`
      : '';

    // Status change badge
    let changeBadge = '';
    const ch = changedAddr.get(m.address);
    if (ch) {
      const wasOk  = ch.from === 'OK';
      const nowOk  = ch.to   === 'OK';
      if (wasOk && !nowOk) {
        changeBadge = `<span class="module-change-badge worse">↓ Piorou</span>`;
      } else if (!wasOk && nowOk) {
        changeBadge = `<span class="module-change-badge better">↑ Melhorou</span>`;
      } else {
        changeBadge = `<span class="module-change-badge changed">~ Mudou</span>`;
      }
    }

    return `
      <div class="module-card ${cls}">
        <div class="module-top">
          <span class="module-addr">${esc(m.address)}</span>
          <span class="module-dot ${dot}"></span>
        </div>
        <div class="module-name">${esc(m.name)}</div>
        ${faultBadge}
        ${changeBadge}
      </div>`;
  }).join('');
}

// ── Faults list ───────────────────────────────────────────────────
function renderFaultsList(d, cmp) {
  const list  = document.getElementById('faults-list');
  const badge = document.getElementById('faults-count-badge');

  const allFaults = getAllFaults(d);

  // Tag each current fault with its delta status
  if (cmp) {
    const newKeys       = new Set(cmp.newFaults.map(faultKey));
    const recurringKeys = new Set(cmp.recurringFaults.map(faultKey));
    for (const f of allFaults) {
      const k = faultKey(f);
      f._delta = newKeys.has(k) ? 'new' : recurringKeys.has(k) ? 'recurring' : null;
    }
    // Sort: new first, then recurring, then untagged
    allFaults.sort((a, b) => {
      const rank = { new: 0, recurring: 1, null: 2 };
      return (rank[a._delta] ?? 2) - (rank[b._delta] ?? 2);
    });
  }

  badge.textContent  = allFaults.length > 0 ? allFaults.length : '';
  badge.style.display = allFaults.length > 0 ? '' : 'none';

  if (allFaults.length === 0 && (!cmp || cmp.resolvedFaults.length === 0)) {
    list.innerHTML = `
      <div class="no-faults">
        <div class="no-faults-icon">✓</div>
        <p>Nenhuma falha encontrada neste scan</p>
      </div>`;
    return;
  }

  // Render current faults
  let html = allFaults.map((f, i) => renderFaultItem(f, i, f._delta)).join('');

  // Render resolved faults (were in previous scan, gone now)
  if (cmp && cmp.resolvedFaults.length > 0) {
    html += `<div class="resolved-section-title">
      <span class="resolved-icon">✓</span>
      Resolvidas desde o scan anterior
    </div>`;
    html += cmp.resolvedFaults.map((f, i) =>
      renderFaultItem(f, allFaults.length + i, 'resolved')
    ).join('');
  }

  list.innerHTML = html;
}

function renderFaultItem(f, i, delta) {
  const hasFreezeFrame = Object.keys(f.freezeFrame || {}).length > 0;

  const pcodeBadge = f.pCode
    ? `<span class="fault-pcode">${esc(f.pCode)}</span>` : '';
  const detailLine = f.detail
    ? `<div class="fault-detail">${esc(f.detail)}</div>` : '';

  // Delta badge
  let deltaBadge = '';
  if (delta === 'new')       deltaBadge = `<span class="fault-delta new">Nova</span>`;
  else if (delta === 'recurring') deltaBadge = `<span class="fault-delta recurring">Recorrente</span>`;
  else if (delta === 'resolved')  deltaBadge = `<span class="fault-delta resolved">Resolvida</span>`;

  // Frequency badge (if > 1)
  const freqBadge = (f.frequency > 0)
    ? `<span class="fault-freq" title="Frequência de ocorrência">${f.frequency}×</span>` : '';

  // Freeze frame rows
  const ffRows = hasFreezeFrame
    ? Object.entries(f.freezeFrame).map(([k, v]) =>
        `<div class="freeze-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`
      ).join('') : '';

  const freezeBlock = hasFreezeFrame ? `
    <div class="fault-body">
      <div class="freeze-frame-title">Freeze Frame</div>
      <div class="freeze-table">${ffRows}</div>
    </div>` : '';

  const metaKm  = f.mileage ? `<span class="fault-meta-item">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      ${esc(f.mileage)}</span>` : '';
  const metaDate = f.date ? `<span class="fault-meta-item">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      ${esc(f.date)}</span>` : '';
  const metaMod = `<span class="fault-meta-item">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      ${esc(f.moduleAddr)} – ${esc(f.moduleName)}</span>`;

  const toggleBtn = hasFreezeFrame ? `
    <div class="fault-toggle">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>` : '';

  const isResolved = delta === 'resolved';

  return `
    <div class="fault-item${isResolved ? ' resolved' : ''}" id="fault-${i}">
      <div class="fault-header" ${hasFreezeFrame ? `onclick="toggleFault('fault-${i}')"` : ''}>
        <div class="fault-codes">
          <span class="fault-id">${esc(f.code)}</span>
          ${pcodeBadge}
          ${freqBadge}
        </div>
        <div class="fault-info">
          <div class="fault-desc-row">
            <span class="fault-desc">${esc(f.description)}</span>
            ${deltaBadge}
          </div>
          ${detailLine}
          <div class="fault-meta">${metaMod}${metaKm}${metaDate}</div>
        </div>
        ${toggleBtn}
      </div>
      ${freezeBlock}
    </div>`;
}

function toggleFault(id) {
  document.getElementById(id).classList.toggle('open');
}

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
  const list = document.getElementById('drawer-scan-list');
  if (scans.length === 0) {
    list.innerHTML = `<p style="color:var(--text2);font-size:.85rem;text-align:center;padding:24px">Nenhum scan salvo.</p>`;
    return;
  }
  // Sort newest first
  const sorted = scans.slice().sort((a, b) => b.data.scanTimestamp - a.data.scanTimestamp);
  list.innerHTML = sorted.map(scan => {
    const d      = scan.data;
    const faults = d.totalFaults;
    const active = scan.id === activeScanId ? 'active' : '';
    const fCls   = faults === 0 ? 'none' : 'some';
    const fTxt   = faults === 0 ? 'Sem falhas' : `${faults} falha${faults > 1 ? 's' : ''}`;
    const km     = d.mileage ? d.mileage.toLocaleString('pt-BR') + ' km' : '–';
    return `
      <div class="drawer-scan-item ${active}" onclick="selectScan('${scan.id}')">
        <div class="dsi-name" title="${esc(scan.filename)}">${esc(scan.filename)}</div>
        <div class="dsi-meta">${d.scanDate} · ${km}</div>
        <div class="dsi-footer">
          <span class="dsi-faults ${fCls}">${fTxt}</span>
          <button class="dsi-del" onclick="event.stopPropagation(); deleteScan('${scan.id}')">Remover</button>
        </div>
      </div>`;
  }).join('');
}

function selectScan(id) {
  activeScanId = id;
  closeHistoryDrawer();
  showDashboard(getActiveScan());
}

// ── Toast notifications ───────────────────────────────────────────
function showToast(msg, type = 'ok') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className   = `toast toast-${type} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ── Chart defaults ────────────────────────────────────────────────
function tooltipDefaults() {
  return {
    backgroundColor: '#10101e',
    borderColor: '#1c1c30',
    borderWidth: 1,
    titleColor: '#e4e6f4',
    bodyColor: '#8b8faa',
    padding: 12,
    cornerRadius: 8,
    titleFont: { family: 'Inter', size: 13, weight: '600' },
    bodyFont:  { family: 'Inter', size: 12 }
  };
}

// ── Helpers ───────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setNum(id, n) {
  const el = document.getElementById(id);
  if (el) el.textContent = n;
}
