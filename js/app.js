/* ================================================================
   VCDS Mechanic Dashboard — App Logic v4 (SaaS / Multi-car)
   - GitHub API como banco de dados persistente (PAT auth)
   - Multi-carro: cada carro tem scans históricos independentes
   - Deduplicação por scanTimestamp exato
   - Sem senha de acesso local (PAT é a autenticação)
================================================================ */

// ── State ────────────────────────────────────────────────────────
const CONFIG_KEY = 'vcds_gh_config';

let ghConfig = null;         // { token, owner, repo, branch }
let cars = [];               // array do data/index.json
let activeCarId = null;
let activeCarScans = [];     // full scan objects: { id, filename, importedAt, data }
let activeCarMods = [];
let activeScanId = null;
let currentModFilter = 'Todos';

let chartModules   = null;
let chartFaultsBar = null;
let chartTimeline  = null;

// ── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  setupListeners();
  if (!ghConfig || !ghConfig.token) {
    showConfigScreen();
  } else {
    showLoading('Carregando carros...');
    loadCars().then(() => {
      hideLoading();
      showCarsScreen();
    }).catch(err => {
      hideLoading();
      showToast('Erro ao conectar ao GitHub: ' + err.message, 'error');
      showConfigScreen();
    });
  }
});

// ── Config persistence ────────────────────────────────────────────
function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) ghConfig = JSON.parse(raw);
  } catch { ghConfig = null; }
}

function saveConfig(cfg) {
  ghConfig = cfg;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

// ================================================================
//  GITHUB API LAYER
// ================================================================

async function ghGet(path) {
  const { owner, repo, branch, token } = ghConfig;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(url, { headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `HTTP ${res.status}`);
    }
    const json = await res.json();
    const decoded = decodeURIComponent(escape(atob(json.content.replace(/\s/g, ''))));
    return { data: JSON.parse(decoded), sha: json.sha };
  } catch (e) {
    if (e.message && e.message.includes('Not Found')) return null;
    throw e;
  }
}

async function ghPut(path, data, message, existingSha) {
  const { owner, repo, branch, token } = ghConfig;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json'
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // If no existing SHA provided, try to get it
  let sha = existingSha;
  if (!sha) {
    const existing = await ghGet(path).catch(() => null);
    sha = existing ? existing.sha : undefined;
  }

  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const body = { message, content, branch };
  if (sha) body.sha = sha;

  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.message || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.content ? json.content.sha : null;
}

// ================================================================
//  EVENT LISTENERS
// ================================================================

function setupListeners() {
  // Config screen
  document.getElementById('btn-save-config').addEventListener('click', handleSaveConfig);
  document.getElementById('cfg-token').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSaveConfig();
  });

  // Cars screen
  document.getElementById('btn-open-config').addEventListener('click', showConfigScreen);
  document.getElementById('btn-show-new-car').addEventListener('click', () => {
    document.getElementById('new-car-form').classList.remove('hidden');
    document.getElementById('nc-client').focus();
  });
  document.getElementById('btn-cancel-new-car').addEventListener('click', hideNewCarForm);
  document.getElementById('btn-cancel-new-car-2').addEventListener('click', hideNewCarForm);
  document.getElementById('btn-create-car').addEventListener('click', handleCreateCar);

  // Car screen
  document.getElementById('btn-back-from-car').addEventListener('click', () => {
    activeCarId = null;
    activeCarScans = [];
    activeCarMods = [];
    activeScanId = null;
    showCarsScreen();
  });
  document.getElementById('btn-open-history').addEventListener('click', openHistoryDrawer);
  document.getElementById('btn-back-from-status').addEventListener('click', backFromStatus);
  document.getElementById('btn-back-from-mod').addEventListener('click', backFromMod);

  // New scan file input
  const fileInputCar = document.getElementById('file-input-car');
  fileInputCar.multiple = true;
  fileInputCar.addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length > 0) handleFiles(files);
  });
  document.getElementById('btn-new-scan').addEventListener('click', () => {
    setTimeout(() => fileInputCar.click(), 60);
  });
}

function hideNewCarForm() {
  document.getElementById('new-car-form').classList.add('hidden');
  document.getElementById('nc-client').value = '';
  document.getElementById('nc-make').value   = '';
  document.getElementById('nc-model').value  = '';
  document.getElementById('nc-year').value   = '';
  document.getElementById('nc-vin').value    = '';
  document.getElementById('nc-stage').value  = 'Stock';
  document.getElementById('nc-notes').value  = '';
}

// ================================================================
//  CONFIG SCREEN
// ================================================================

async function handleSaveConfig() {
  const token  = document.getElementById('cfg-token').value.trim();
  const owner  = document.getElementById('cfg-owner').value.trim();
  const repo   = document.getElementById('cfg-repo').value.trim();
  const branch = document.getElementById('cfg-branch').value.trim() || 'main';
  const errEl  = document.getElementById('cfg-error');

  errEl.textContent = '';
  errEl.classList.add('hidden');

  if (!token) { showCfgError('O token do GitHub é obrigatório.'); return; }
  if (!owner)  { showCfgError('O owner é obrigatório.'); return; }
  if (!repo)   { showCfgError('O repositório é obrigatório.'); return; }

  document.getElementById('btn-save-config').textContent = 'Conectando...';
  document.getElementById('btn-save-config').disabled = true;

  // Validate token by calling the repo endpoint
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });
    if (res.status === 401) throw new Error('Token inválido ou sem permissão.');
    if (res.status === 404) throw new Error(`Repositório "${owner}/${repo}" não encontrado.`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `HTTP ${res.status}`);
    }
  } catch(e) {
    showCfgError(e.message);
    document.getElementById('btn-save-config').textContent = 'Salvar e Conectar';
    document.getElementById('btn-save-config').disabled = false;
    return;
  }

  saveConfig({ token, owner, repo, branch });

  showLoading('Carregando carros...');
  try {
    await loadCars();
    hideLoading();
    showCarsScreen();
  } catch(e) {
    hideLoading();
    showCfgError('Erro ao carregar dados: ' + e.message);
  }

  document.getElementById('btn-save-config').textContent = 'Salvar e Conectar';
  document.getElementById('btn-save-config').disabled = false;
}

function showCfgError(msg) {
  const el = document.getElementById('cfg-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ================================================================
//  CARS MANAGEMENT
// ================================================================

async function loadCars() {
  const result = await ghGet('data/index.json');
  if (!result) {
    // First run — create empty index
    cars = [];
    await ghPut('data/index.json', { cars: [] }, 'Initialize VCDS data store');
  } else {
    cars = result.data.cars || [];
  }
}

async function saveCarsIndex() {
  await ghPut('data/index.json', { cars }, 'Update cars index');
}

async function handleCreateCar() {
  const clientName = document.getElementById('nc-client').value.trim();
  if (!clientName) { showToast('Informe o nome do cliente.', 'warn'); return; }

  const make  = document.getElementById('nc-make').value.trim();
  const model = document.getElementById('nc-model').value.trim();
  const year  = parseInt(document.getElementById('nc-year').value) || null;
  const vin   = document.getElementById('nc-vin').value.trim().toUpperCase();
  const stage = document.getElementById('nc-stage').value;
  const notes = document.getElementById('nc-notes').value.trim();

  const carId = 'car_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const newCar = {
    id: carId,
    clientName,
    make,
    model,
    year,
    vin,
    stage,
    notes,
    createdAt: Date.now(),
    scanCount: 0,
    lastScanDate: null,
    lastFaults: null
  };

  showLoading('Criando carro...');
  hideNewCarForm();

  try {
    // Create data structure in GitHub
    await ghPut(`data/cars/${carId}/scans/index.json`, [], `Create car ${clientName} - scans index`);
    await ghPut(`data/cars/${carId}/mods.json`, [], `Create car ${clientName} - mods`);

    cars.push(newCar);
    await saveCarsIndex();

    hideLoading();
    renderCarsScreen();
    showToast('Carro criado!', 'ok');
  } catch(e) {
    hideLoading();
    showToast('Erro ao criar carro: ' + e.message, 'error');
  }
}

function confirmDeleteCar(carId) {
  const car = cars.find(c => c.id === carId);
  if (!car) return;
  if (!confirm(`Remover "${car.clientName} — ${car.make} ${car.model}" da lista?\n\nOs arquivos no GitHub não serão apagados.`)) return;

  showLoading('Removendo...');
  cars = cars.filter(c => c.id !== carId);
  saveCarsIndex().then(() => {
    hideLoading();
    renderCarsScreen();
    showToast('Carro removido da lista.', 'warn');
  }).catch(e => {
    hideLoading();
    showToast('Erro: ' + e.message, 'error');
  });
}

// ================================================================
//  SELECT CAR
// ================================================================

async function selectCar(carId) {
  activeCarId = carId;
  activeScanId = null;
  activeCarScans = [];
  activeCarMods = [];

  showLoading('Carregando scans...');

  try {
    const [scanIdxResult, modsResult] = await Promise.all([
      ghGet(`data/cars/${carId}/scans/index.json`),
      ghGet(`data/cars/${carId}/mods.json`)
    ]);

    activeCarMods = modsResult ? (modsResult.data || []) : [];

    const scanMetas = (scanIdxResult ? (scanIdxResult.data || []) : [])
      .sort((a, b) => b.scanTimestamp - a.scanTimestamp)
      .slice(0, 30);

    if (scanMetas.length > 0) {
      const fullResults = await Promise.all(
        scanMetas.map(m => ghGet(`data/cars/${carId}/scans/${m.id}.json`))
      );
      activeCarScans = fullResults
        .filter(Boolean)
        .map(r => r.data)
        .filter(Boolean);
    }

    // Set active scan to latest
    if (activeCarScans.length > 0) {
      const latest = activeCarScans.slice().sort((a, b) => b.data.scanTimestamp - a.data.scanTimestamp)[0];
      activeScanId = latest ? latest.id : null;
    }

    hideLoading();
    _hideAllScreens();
    document.getElementById('car-screen').classList.remove('hidden');
    renderCarScreen();
  } catch(e) {
    hideLoading();
    showToast('Erro ao carregar: ' + e.message, 'error');
  }
}

// ================================================================
//  FILE IMPORT (per car)
// ================================================================

async function handleFiles(fileList) {
  if (!activeCarId) { showToast('Nenhum carro selecionado.', 'warn'); return; }
  const files = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.txt'));
  if (files.length === 0) return;

  let imported = 0, skipped = 0, invalid = 0;
  showLoading('Importando scans...');

  for (const file of files) {
    try {
      const result = await addScan(file);
      if      (result === 'ok')      imported++;
      else if (result === 'dupe')    skipped++;
      else if (result === 'invalid') invalid++;
    } catch(e) {
      invalid++;
      console.error('Import error:', e);
    }
  }

  hideLoading();

  const parts = [];
  if (imported > 0) parts.push(`${imported} scan${imported > 1 ? 's' : ''} importado${imported > 1 ? 's' : ''}`);
  if (skipped  > 0) parts.push(`${skipped} já existia${skipped > 1 ? 'm' : ''}`);
  if (invalid  > 0) parts.push(`${invalid} inválido${invalid > 1 ? 's' : ''}`);

  const type = imported > 0 ? 'ok' : (skipped > 0 ? 'warn' : 'error');
  showToast(parts.join(' · '), type);

  if (imported > 0) {
    const latest = getLatestScan();
    activeScanId = latest ? latest.id : null;
    renderCarScreen();
  }
}

async function addScan(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const raw  = e.target.result;
        const data = parseVCDS(raw);

        if (!data.vin && data.modules.length === 0) {
          resolve('invalid');
          return;
        }

        // Dedup: only reject if scanTimestamp is identical and not zero
        const ts = data.scanTimestamp;
        if (ts && activeCarScans.find(s => s.data.scanTimestamp === ts)) {
          resolve('dupe');
          return;
        }

        const scanId = 'scan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const importedAt = Date.now();
        const scanObj = { id: scanId, filename: file.name, importedAt, data };

        // Write full scan file
        await ghPut(
          `data/cars/${activeCarId}/scans/${scanId}.json`,
          scanObj,
          `Add scan ${file.name}`
        );

        // Update scans index
        const scanIdxResult = await ghGet(`data/cars/${activeCarId}/scans/index.json`);
        const scanIndex = scanIdxResult ? (scanIdxResult.data || []) : [];
        scanIndex.push({
          id:            scanId,
          filename:      file.name,
          importedAt,
          scanDate:      data.scanDate,
          scanTimestamp: data.scanTimestamp,
          mileage:       data.mileage,
          totalFaults:   data.totalFaults,
          vin:           data.vin
        });
        await ghPut(
          `data/cars/${activeCarId}/scans/index.json`,
          scanIndex,
          `Update scan index for car ${activeCarId}`
        );

        // Update cars index
        const car = cars.find(c => c.id === activeCarId);
        if (car) {
          car.scanCount    = scanIndex.length;
          car.lastScanDate = data.scanDate;
          car.lastFaults   = data.totalFaults;
          await saveCarsIndex();
        }

        // Update local state
        activeCarScans.push(scanObj);

        resolve('ok');
      } catch(err) {
        reject(err);
      }
    };
    reader.onerror = () => resolve('invalid');
    reader.readAsText(file, 'utf-8');
  });
}

// ================================================================
//  MODS (per car)
// ================================================================

async function saveCarMods() {
  await ghPut(
    `data/cars/${activeCarId}/mods.json`,
    activeCarMods,
    `Update mods for car ${activeCarId}`
  );
}

// ================================================================
//  SCREEN MANAGEMENT
// ================================================================

function _hideAllScreens() {
  ['config-screen', 'cars-screen', 'car-screen', 'status-screen', 'mod-screen']
    .forEach(id => document.getElementById(id).classList.add('hidden'));
}

function showConfigScreen() {
  _hideAllScreens();
  if (ghConfig) {
    document.getElementById('cfg-token').value  = ghConfig.token  || '';
    document.getElementById('cfg-owner').value  = ghConfig.owner  || 'SirioSly';
    document.getElementById('cfg-repo').value   = ghConfig.repo   || 'vcds';
    document.getElementById('cfg-branch').value = ghConfig.branch || 'main';
  }
  document.getElementById('config-screen').classList.remove('hidden');
}

function showCarsScreen() {
  _hideAllScreens();
  document.getElementById('cars-screen').classList.remove('hidden');
  renderCarsScreen();
}

function showCarScreen() {
  _hideAllScreens();
  document.getElementById('car-screen').classList.remove('hidden');
  renderCarScreen();
}

function showStatusScreen() {
  if (activeCarScans.length === 0) { showToast('Nenhum scan disponível.', 'warn'); return; }
  _hideAllScreens();
  document.getElementById('status-screen').classList.remove('hidden');
  renderStatusScreen();
}

function backFromStatus() {
  _hideAllScreens();
  document.getElementById('car-screen').classList.remove('hidden');
}

function showModScreen() {
  _hideAllScreens();
  document.getElementById('mod-screen').classList.remove('hidden');
  renderModScreen();
}

function backFromMod() {
  _hideAllScreens();
  document.getElementById('car-screen').classList.remove('hidden');
}

// ================================================================
//  LOADING OVERLAY
// ================================================================

function showLoading(msg) {
  const el = document.getElementById('loading-overlay');
  document.getElementById('loading-text').textContent = msg || 'Carregando...';
  el.classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

// ================================================================
//  CARS SCREEN RENDER
// ================================================================

function renderCarsScreen() {
  const grid  = document.getElementById('cars-grid');
  const empty = document.getElementById('cars-empty');

  if (cars.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = cars.map(car => {
    const initial    = (car.clientName || '?')[0].toUpperCase();
    const displayName = [car.make, car.model].filter(Boolean).join(' ') || 'Carro';
    const yearStr    = car.year ? ` (${car.year})` : '';
    const faults     = car.lastFaults;
    const faultCls   = faults === null ? '' : faults === 0 ? 'ok' : faults <= 3 ? 'warn' : 'danger';
    const faultTxt   = faults === null ? '–' : faults === 0 ? 'Sem falhas' : `${faults} falha${faults > 1 ? 's' : ''}`;
    const scanTxt    = car.scanCount > 0
      ? `${car.scanCount} scan${car.scanCount > 1 ? 's' : ''} · ${car.lastScanDate || ''}`
      : 'Nenhum scan ainda';
    return `
      <div class="car-card" onclick="selectCar('${car.id}')">
        <div class="car-card-header">
          <div class="car-card-avatar">${esc(initial)}</div>
          <div class="car-card-info">
            <div class="car-card-name">${esc(car.clientName)}</div>
            <div class="car-card-model">${esc(displayName)}${esc(yearStr)}</div>
            ${car.vin ? `<div class="car-card-vin">${esc(car.vin)}</div>` : ''}
          </div>
          <button class="car-del-btn" onclick="event.stopPropagation();confirmDeleteCar('${car.id}')" title="Remover carro">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>
        <div class="car-card-stats">
          ${car.stage && car.stage !== 'Stock' ? `<span class="car-stage-badge">${esc(car.stage)}</span>` : ''}
          ${faults !== null ? `<span class="car-fault-badge ${faultCls}">${faultTxt}</span>` : ''}
          <span class="car-scan-meta">${esc(scanTxt)}</span>
        </div>
      </div>`;
  }).join('');
}

// ================================================================
//  CAR SCREEN RENDER (main dashboard)
// ================================================================

function renderCarScreen() {
  const car = cars.find(c => c.id === activeCarId);
  if (!car) return;

  const displayName = [car.make, car.model].filter(Boolean).join(' ') || 'Carro';
  document.getElementById('car-nav-name').textContent  = car.clientName;
  document.getElementById('car-nav-vin').textContent   = car.vin || '';
  const stageBadge = document.getElementById('car-nav-stage');
  if (car.stage && car.stage !== 'Stock') {
    stageBadge.textContent = car.stage;
    stageBadge.style.display = '';
  } else {
    stageBadge.style.display = 'none';
  }

  document.getElementById('history-count').textContent = activeCarScans.length;
  updateModsBadge();

  const scan = getActiveScan();
  if (!scan) {
    // No scans yet
    document.getElementById('car-nav-date').textContent = '–';
    document.getElementById('car-nav-km').textContent   = '–';
    document.getElementById('stat-ok').textContent          = '0';
    document.getElementById('stat-malfunction').textContent = '0';
    document.getElementById('stat-unreachable').textContent = '0';
    document.getElementById('stat-faults').textContent      = '0';
    document.getElementById('car-info-table').innerHTML     = '';
    document.getElementById('modules-grid').innerHTML       = '<p style="color:var(--text2);padding:20px;text-align:center">Importe um scan para ver os dados.</p>';
    document.getElementById('faults-list').innerHTML        = '';
    document.getElementById('comparison-banner').classList.add('hidden');
    document.getElementById('card-faults-bar').style.display = 'none';
    document.getElementById('card-timeline').style.display   = 'none';
    if (chartModules)   { chartModules.destroy();   chartModules   = null; }
    if (chartFaultsBar) { chartFaultsBar.destroy(); chartFaultsBar = null; }
    if (chartTimeline)  { chartTimeline.destroy();  chartTimeline  = null; }
    return;
  }

  renderCarDashboard(scan);
}

// ── Car dashboard ─────────────────────────────────────────────────
function renderCarDashboard(scan) {
  const d   = scan.data;
  const cmp = getComparison(scan);

  document.getElementById('car-nav-date').textContent = d.scanDate;
  document.getElementById('car-nav-km').textContent   = d.mileage ? d.mileage.toLocaleString('pt-BR') + ' km' : '';

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

// ── Helpers ───────────────────────────────────────────────────────
function getActiveScan()  { return activeCarScans.find(s => s.id === activeScanId) || null; }
function getLatestScan()  {
  return activeCarScans.length === 0 ? null
    : activeCarScans.slice().sort((a, b) => b.data.scanTimestamp - a.data.scanTimestamp)[0];
}
function getFirstScan()   {
  return activeCarScans.length === 0 ? null
    : activeCarScans.slice().sort((a, b) => a.data.scanTimestamp - b.data.scanTimestamp)[0];
}

// ================================================================
//  COMPARISON ENGINE
// ================================================================

function getPreviousScan(currentScan) {
  return activeCarScans
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
  const curr   = getAllFaults(currentScan.data);
  const prev_  = getAllFaults(prev.data);
  const currK  = new Set(curr.map(faultKey));
  const prevK  = new Set(prev_.map(faultKey));
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

// ================================================================
//  DASHBOARD RENDERS
// ================================================================

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
  if (activeCarScans.length < 2) { card.style.display = 'none'; return; }
  card.style.display = '';
  const sorted = activeCarScans.slice().sort((a, b) => a.data.scanTimestamp - b.data.scanTimestamp);
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

  badge.textContent   = allFaults.length > 0 ? allFaults.length : '';
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
  const metaMod  = `<span class="fault-meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>${esc(f.moduleAddr)} – ${esc(f.moduleName)}</span>`;
  const metaKm   = f.mileage ? `<span class="fault-meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${esc(f.mileage)}</span>` : '';
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
  const sorted = activeCarScans.slice().sort((a, b) => b.data.scanTimestamp - a.data.scanTimestamp);
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
  renderCarScreen();
}
function deleteScan(id) {
  // Removes from local state only (GitHub files stay)
  activeCarScans = activeCarScans.filter(s => s.id !== id);
  if (activeScanId === id) {
    const latest = getLatestScan();
    activeScanId = latest ? latest.id : null;
  }

  // Update scans index in GitHub
  const scanIndex = activeCarScans.map(s => ({
    id:            s.id,
    filename:      s.filename,
    importedAt:    s.importedAt,
    scanDate:      s.data.scanDate,
    scanTimestamp: s.data.scanTimestamp,
    mileage:       s.data.mileage,
    totalFaults:   s.data.totalFaults,
    vin:           s.data.vin
  }));

  showLoading('Removendo scan...');
  ghPut(
    `data/cars/${activeCarId}/scans/index.json`,
    scanIndex,
    `Remove scan ${id}`
  ).then(() => {
    // Update car metadata
    const car = cars.find(c => c.id === activeCarId);
    if (car) {
      car.scanCount = activeCarScans.length;
      const latest = getLatestScan();
      car.lastScanDate = latest ? latest.data.scanDate : null;
      car.lastFaults   = latest ? latest.data.totalFaults : null;
      return saveCarsIndex();
    }
  }).then(() => {
    hideLoading();
    renderHistoryDrawer();
    renderCarScreen();
    showToast('Scan removido.', 'warn');
  }).catch(e => {
    hideLoading();
    showToast('Erro: ' + e.message, 'error');
  });
}

// ================================================================
//  STATUS SCREEN
// ================================================================

function renderStatusScreen() {
  const latest = getLatestScan();
  const first  = getFirstScan();
  if (!latest) return;
  const d = latest.data;

  const car = cars.find(c => c.id === activeCarId);
  const carName = car ? [car.make, car.model].filter(Boolean).join(' ') || car.clientName : 'Carro';

  document.getElementById('status-nav-vin').textContent = d.vin || '';
  document.getElementById('health-car-name').textContent = carName;

  const score = calcHealthScore(d);
  renderHealthRing(score, d, latest);
  renderEvolutions(latest, first);
  renderModulesTable(d);
  renderStatusFaults(d);
}

function calcHealthScore(data) {
  const reachable = data.modules.filter(m => m.status !== 'Cannot be reached').length;
  if (reachable === 0) return 100;
  const ok   = data.modules.filter(m => m.status === 'OK').length;
  const base = Math.round((ok / reachable) * 100);
  return Math.max(0, base - Math.min(data.totalFaults * 3, 35));
}

function renderHealthRing(score, d, scan) {
  const CIRC = 2 * Math.PI * 52;
  const ring  = document.getElementById('ring-fg');
  const numEl = document.getElementById('health-score-num');
  const pctEl = document.getElementById('health-score-pct');

  const color = score >= 80 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--danger)';
  ring.style.stroke           = color;
  ring.style.strokeDashoffset = CIRC - (CIRC * score / 100);
  numEl.style.color = color;
  numEl.textContent = score;
  pctEl.style.color = color;

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
    `<span class="hms blue">📋 ${activeCarScans.length} scan${activeCarScans.length > 1 ? 's' : ''} registrado${activeCarScans.length > 1 ? 's' : ''}</span>`
  ].join('');
}

function renderEvolutions(latest, first) {
  const card = document.getElementById('evolutions-card');
  if (!first || first.id === latest.id) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  const latestFaults = new Set(getAllFaults(latest.data).map(faultKey));
  const firstFaults  = new Set(getAllFaults(first.data).map(faultKey));

  const resolved = [];
  const seenR = new Set();
  const sortedScans = activeCarScans.slice().sort((a, b) => a.data.scanTimestamp - b.data.scanTimestamp);
  for (const scan of sortedScans.filter(s => s.id !== latest.id)) {
    for (const f of getAllFaults(scan.data)) {
      const k = faultKey(f);
      if (!latestFaults.has(k) && !seenR.has(k)) {
        seenR.add(k);
        resolved.push({ ...f, seenIn: scan.data.scanDate });
      }
    }
  }

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
          <div class="evo-codes"><span class="evo-vag">${esc(f.code)}</span>${f.pCode ? `<span class="evo-pcode">${esc(f.pCode)}</span>` : ''}</div>
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
          <div class="evo-codes"><span class="evo-vag">${esc(f.code)}</span>${f.pCode ? `<span class="evo-pcode">${esc(f.pCode)}</span>` : ''}</div>
          <div class="evo-desc">${esc(f.description)}</div>
          <div class="evo-meta">${esc(f.moduleName)}</div>
        </div>
      </div>`).join('');
    html += `</div>`;
  }

  if (!html) {
    html = `<p style="color:var(--ok);font-size:.85rem;text-align:center;padding:16px">✓ Nenhuma mudança de falhas desde o 1º scan.</p>`;
  }
  document.getElementById('evolutions-content').innerHTML = html;
}

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

// ================================================================
//  MODIFICAÇÕES SCREEN
// ================================================================

function renderModScreen() {
  renderModSummary();
  renderModList();
  updateModsBadge();
}

function openModForm(id) {
  const card = document.getElementById('mod-form-card');
  card.classList.remove('hidden');

  if (id) {
    const mod = activeCarMods.find(m => m.id === id);
    if (!mod) return;
    document.getElementById('mod-form-title').textContent = 'Editar Modificação';
    document.getElementById('mod-edit-id').value    = id;
    document.getElementById('mod-date').value       = mod.date;
    document.getElementById('mod-category').value   = mod.category;
    document.getElementById('mod-value').value      = mod.value || '';
    document.getElementById('mod-title').value      = mod.title;
    document.getElementById('mod-notes').value      = mod.notes || '';
  } else {
    document.getElementById('mod-form-title').textContent = 'Nova Modificação';
    document.getElementById('mod-edit-id').value    = '';
    document.getElementById('mod-date').value       = new Date().toISOString().slice(0, 10);
    document.getElementById('mod-category').value   = 'Manutenção';
    document.getElementById('mod-value').value      = '';
    document.getElementById('mod-title').value      = '';
    document.getElementById('mod-notes').value      = '';
  }
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeModForm() {
  document.getElementById('mod-form-card').classList.add('hidden');
}

async function saveMod() {
  const title = document.getElementById('mod-title').value.trim();
  if (!title) {
    showToast('Preencha o título da modificação.', 'warn');
    document.getElementById('mod-title').focus();
    return;
  }

  const id = document.getElementById('mod-edit-id').value;
  const mod = {
    id:        id || (Date.now().toString() + Math.random()),
    date:      document.getElementById('mod-date').value || new Date().toISOString().slice(0, 10),
    category:  document.getElementById('mod-category').value,
    value:     parseFloat(document.getElementById('mod-value').value) || 0,
    title,
    notes:     document.getElementById('mod-notes').value.trim(),
    createdAt: id ? (activeCarMods.find(m => m.id === id)?.createdAt || Date.now()) : Date.now()
  };

  if (id) {
    const idx = activeCarMods.findIndex(m => m.id === id);
    if (idx >= 0) activeCarMods[idx] = mod; else activeCarMods.push(mod);
  } else {
    activeCarMods.push(mod);
  }

  showLoading('Salvando...');
  try {
    await saveCarMods();
    hideLoading();
    closeModForm();
    renderModScreen();
    showToast(id ? 'Modificação atualizada!' : 'Modificação salva!', 'ok');
  } catch(e) {
    hideLoading();
    showToast('Erro ao salvar: ' + e.message, 'error');
  }
}

async function deleteMod(id) {
  if (!confirm('Remover esta modificação?')) return;
  activeCarMods = activeCarMods.filter(m => m.id !== id);
  showLoading('Removendo...');
  try {
    await saveCarMods();
    hideLoading();
    renderModScreen();
    showToast('Modificação removida.', 'warn');
  } catch(e) {
    hideLoading();
    showToast('Erro: ' + e.message, 'error');
  }
}

function filterMods(btn) {
  document.querySelectorAll('.mod-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentModFilter = btn.dataset.cat;
  renderModList();
}

function renderModSummary() {
  const total      = activeCarMods.length;
  const totalValue = activeCarMods.reduce((s, m) => s + (m.value || 0), 0);
  const cats       = [...new Set(activeCarMods.map(m => m.category))].length;

  const catTotals = {};
  for (const m of activeCarMods) catTotals[m.category] = (catTotals[m.category] || 0) + m.value;
  const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];

  const el = document.getElementById('mod-summary-row');
  if (total === 0) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="mod-summary-card">
      <div class="mod-summary-icon">🔧</div>
      <div class="mod-summary-label">Modificações</div>
      <div class="mod-summary-value blue">${total}</div>
    </div>
    <div class="mod-summary-card">
      <div class="mod-summary-icon">💰</div>
      <div class="mod-summary-label">Total Investido</div>
      <div class="mod-summary-value green">${formatBRL(totalValue)}</div>
    </div>
    <div class="mod-summary-card">
      <div class="mod-summary-icon">📂</div>
      <div class="mod-summary-label">Categorias</div>
      <div class="mod-summary-value">${cats}</div>
    </div>
    ${topCat ? `
    <div class="mod-summary-card">
      <div class="mod-summary-icon">${catIcon(topCat[0])}</div>
      <div class="mod-summary-label">Maior Gasto</div>
      <div class="mod-summary-value warn">${esc(topCat[0])}</div>
    </div>` : ''}
  `;
}

function renderModList() {
  const list    = document.getElementById('mod-list');
  const filters = document.getElementById('mod-filters');

  if (activeCarMods.length === 0) {
    filters.style.display = 'none';
    list.innerHTML = `
      <div class="mod-empty">
        <div class="mod-empty-icon">🔧</div>
        <p>Nenhuma modificação registrada ainda</p>
        <small>Clique em "+ Adicionar" para começar a registrar</small>
      </div>`;
    return;
  }

  filters.style.display = 'flex';

  const filtered = currentModFilter === 'Todos'
    ? activeCarMods : activeCarMods.filter(m => m.category === currentModFilter);
  const sorted = filtered.slice().sort((a, b) => new Date(b.date) - new Date(a.date));

  if (sorted.length === 0) {
    list.innerHTML = `
      <div class="mod-empty">
        <div class="mod-empty-icon">🔍</div>
        <p>Nenhuma modificação nesta categoria</p>
      </div>`;
    return;
  }

  list.innerHTML = sorted.map(mod => {
    const icon     = catIcon(mod.category);
    const dateStr  = mod.date ? formatModDate(mod.date) : '–';
    const valueStr = mod.value > 0 ? formatBRL(mod.value) : '–';
    const valCls   = mod.value > 0 ? '' : ' zero';
    return `
      <div class="mod-item">
        <div class="mod-item-cat-icon">${icon}</div>
        <div class="mod-item-body">
          <div class="mod-item-title">${esc(mod.title)}</div>
          <div class="mod-item-meta">
            <span class="mod-item-date">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              ${dateStr}
            </span>
            <span class="mod-item-cat">${esc(mod.category)}</span>
          </div>
          ${mod.notes ? `<div class="mod-item-notes">${esc(mod.notes)}</div>` : ''}
        </div>
        <div class="mod-item-right">
          <div class="mod-item-value${valCls}">${valueStr}</div>
          <div class="mod-item-actions">
            <button class="mod-act-btn" onclick="openModForm('${mod.id}')">Editar</button>
            <button class="mod-act-btn del" onclick="deleteMod('${mod.id}')">Remover</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function updateModsBadge() {
  const badge = document.getElementById('mods-count');
  if (!badge) return;
  if (activeCarMods.length > 0) {
    badge.textContent   = activeCarMods.length;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// ── Mod helpers ───────────────────────────────────────────────────
function catIcon(cat) {
  return { Performance:'⚡', Motor:'🔧', Suspensão:'🛞', Freios:'🔴',
           Elétrica:'💡', Estética:'✨', Manutenção:'🔩',
           Diagnóstico:'📋', Outro:'📦' }[cat] || '📦';
}

function formatBRL(value) {
  return 'R$ ' + Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatModDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ================================================================
//  TOAST
// ================================================================
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
