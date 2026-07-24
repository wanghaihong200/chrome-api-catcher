import { ICONS } from './icons.js';
import { exportAs } from '../logic/exporters/index.js';
import { toCurl, hasSensitive } from '../logic/curl.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

const state = { all: [], filtered: [], page: 1, pageSize: 10, currentDetail: null, selected: new Set(), newCount: 0, pendingIds: new Set(), refreshTimer: null };

function isLiveView() {
  const hasFilter = $('searchInput').value.trim() || $('methodFilter').value || $('statusFilter').value
    || $('timeFilter').value || $('responseTimeFilter').value;
  return state.page === 1 && !hasFilter;
}

// ---- 注入图标 ----
$('logoIcon').innerHTML = ICONS.logo;
$('searchIcon').innerHTML = ICONS.search;
$('refreshIcon').innerHTML = ICONS.refresh;
$('closeModalBtn').innerHTML = ICONS.xmark;
$('stat1Icon').innerHTML = ICONS.plug;
$('stat2Icon').innerHTML = ICONS.plus;
$('stat3Icon').innerHTML = ICONS.warning;
$('stat4Icon').innerHTML = ICONS.clock;

// ---- 工具 ----
function statusClass(s) {
  if (s >= 200 && s < 300) return '2xx';
  if (s >= 300 && s < 400) return '3xx';
  if (s >= 400 && s < 500) return '4xx';
  if (s >= 500) return '5xx';
  return '2xx';
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function timeClass(ms) {
  if (ms < 100) return 'fast';
  if (ms <= 500) return 'normal';
  return 'slow';
}
function timeRangeMs(v) {
  return { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3 }[v] || 0;
}
function toast(msg, type = 'success') {
  const color = type === 'error' ? 'bg-red-500' : type === 'info' ? 'bg-brand-500' : 'bg-emerald-500';
  const el = document.createElement('div');
  el.className = `toast-in flex items-center gap-3 px-5 py-3.5 ${color} text-white rounded-[12px] text-[13px] font-medium min-w-[200px]`;
  el.textContent = msg;
  $('toastContainer').appendChild(el);
  setTimeout(() => { el.classList.remove('toast-in'); el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); }, 2000);
}

// ---- 过滤 ----
function applyFilters() {
  const q = $('searchInput').value.trim().toLowerCase();
  const m = $('methodFilter').value;
  const st = $('statusFilter').value;
  const tf = $('timeFilter').value;
  const rt = $('responseTimeFilter').value;
  const now = Date.now();
  const rangeMs = timeRangeMs(tf);
  state.filtered = state.all.filter((r) => {
    if (q && !(`${r.url} ${r.method} ${r.status}`.toLowerCase().includes(q))) return false;
    if (m && r.method !== m) return false;
    if (st && statusClass(r.status) !== st) return false;
    if (rangeMs && now - r.timestamp > rangeMs) return false;
    if (rt === 'fast' && !(r.duration < 100)) return false;
    if (rt === 'normal' && !(r.duration >= 100 && r.duration <= 500)) return false;
    if (rt === 'slow' && !(r.duration > 500)) return false;
    return true;
  });
  state.page = 1;
  render();
}

// ---- 渲染 ----
function render() {
  renderTable();
  renderPagination();
  renderActiveFilters();
}

function renderStats() {
  const all = state.all;
  const total = all.length;
  const err = all.filter((r) => r.status >= 400).length;
  const now = Date.now();
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const today = all.filter((r) => r.timestamp >= today0.getTime()).length;
  const last24 = all.filter((r) => now - r.timestamp <= 24 * 3600e3).length;
  const durs = all.map((r) => r.duration || 0);
  const avg = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
  const max = durs.length ? Math.max(...durs) : 0;
  $('statTotal').textContent = total.toLocaleString();
  $('statTotalSub').textContent = `异常 ${err} 条`;
  $('statToday').textContent = today;
  $('statTodaySub').textContent = `最近 24h:${last24} 条`;
  $('statError').textContent = err;
  $('statErrorSub').textContent = total ? `占比 ${(100 * err / total).toFixed(1)}%` : '占比 0%';
  $('statAvgTime').textContent = avg;
  $('statAvgSub').textContent = `最慢 ${max}ms`;
}

function renderTable() {
  const tbody = $('tableBody');
  const { filtered, page, pageSize } = state;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (page > pageCount) state.page = pageCount;
  const start = (state.page - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);
  tbody.innerHTML = slice.map((r) => `
    <tr class="table-row-hover border-b border-surface-50" data-id="${r.id}">
      <td class="px-4 py-4"><input type="checkbox" class="row-check w-4 h-4 accent-brand-500" data-id="${r.id}" ${state.selected.has(r.id) ? 'checked' : ''}></td>
      <td class="px-5 py-4"><span class="method-badge method-${r.method}">${r.method}</span></td>
      <td class="px-4 py-4"><div class="text-[13px] text-surface-500 font-mono truncate max-w-[320px]" title="${escapeHtml(r.url)}">${escapeHtml(r.url)}</div></td>
      <td class="px-4 py-4"><span class="status-badge status-${statusClass(r.status)}"><span class="w-1.5 h-1.5 rounded-full inline-block" style="background:currentColor"></span>${r.status}</span></td>
      <td class="px-4 py-4"><div class="time-indicator"><span class="time-dot time-${timeClass(r.duration)}"></span><span class="text-[13px] text-surface-600 font-mono">${r.duration || 0}ms</span></div></td>
      <td class="px-4 py-4"><span class="text-[12px] text-surface-400">${formatTime(r.timestamp)}</span></td>
      <td class="px-5 py-4 text-right whitespace-nowrap">
        <button class="curl-open w-8 h-8 inline-flex items-center justify-center rounded-lg text-surface-400 hover:text-brand-500 hover:bg-brand-50 transition-all" data-id="${r.id}" title="复制 cURL">${ICONS.copy || ''}</button>
        <button class="detail-open w-8 h-8 inline-flex items-center justify-center rounded-lg text-surface-400 hover:text-brand-500 hover:bg-brand-50 transition-all" data-id="${r.id}" title="详情">${ICONS.eye}</button>
      </td>
    </tr>`).join('');
  $('emptyState').classList.toggle('hidden', filtered.length > 0);
  const from = filtered.length ? start + 1 : 0;
  $('showingInfo').textContent = `显示 ${from}-${start + slice.length} 条,共 ${filtered.length} 条`;



}
// ---- 选择 / 批量操作条 ----
function syncSelectionBar() {
  const bar = $('selectionBar');
  const countEl = $('selectedCount');
  if (!bar) return;
  const n = state.selected.size;
  bar.classList.toggle('hidden', n === 0);
  if (countEl) countEl.textContent = `${n} 条`;
}

function toggleSelect(id, checked) {
  if (checked) state.selected.add(id); else state.selected.delete(id);
  syncSelectionBar();
}

function selectAllFiltered(checked) {
  if (checked) state.filtered.forEach((r) => state.selected.add(r.id));
  else state.filtered.forEach((r) => state.selected.delete(r.id));
  renderTable();
  syncSelectionBar();
}

function renderPagination() {
  const pageCount = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  const cur = state.page;
  const btn = (label, page, opts = {}) =>
    `<button class="page-btn ${opts.active ? 'active' : 'text-surface-600'}" ${opts.disabled ? 'disabled' : `data-page="${page}"`}>${label}</button>`;
  const nav = [];
  nav.push(btn('‹', cur - 1, { disabled: cur <= 1 }));
  for (let i = 1; i <= pageCount; i++) {
    if (i === 1 || i === pageCount || Math.abs(i - cur) <= 1) {
      nav.push(btn(i, i, { active: i === cur }));
    } else if (Math.abs(i - cur) === 2) {
      nav.push(`<span class="text-surface-300 px-1">…</span>`);
    }
  }
  nav.push(btn('›', cur + 1, { disabled: cur >= pageCount }));
  $('pageNav').innerHTML = nav.join('');
}

function renderActiveFilters() {
  const active = [];
  const q = $('searchInput').value.trim(); if (q) active.push(`搜索:${q}`);
  if ($('methodFilter').value) active.push(`方法:${$('methodFilter').value}`);
  if ($('statusFilter').value) active.push(`状态:${$('statusFilter').value}`);
  if ($('timeFilter').value) active.push(`时间:${$('timeFilter').selectedOptions[0].textContent}`);
  if ($('responseTimeFilter').value) active.push(`响应:${$('responseTimeFilter').selectedOptions[0].textContent}`);
  const box = $('activeFilters');
  const clearBtn = $('clearFiltersBtn');
  if (active.length) {
    box.classList.remove('hidden');
    clearBtn.classList.remove('hidden');
    box.innerHTML = '<span class="text-[12px] text-surface-400">已选筛选:</span>' +
      active.map((a) => `<span class="filter-chip">${escapeHtml(a)}</span>`).join('');
  } else {
    box.classList.add('hidden');
    clearBtn.classList.add('hidden');
  }
}

// ---- 详情 Modal ----
async function openDetail(id) {
  const res = await send({ type: 'GET_DETAIL', id });
  const r = res?.record;
  if (!r) { toast('详情读取失败', 'error'); return; }
  state.currentDetail = r;
  $('modalMethod').className = `method-badge method-${r.method}`;
  $('modalMethod').textContent = r.method;
  $('modalUrl').textContent = r.url;
  $('modalMeta').textContent = `${r.status} ${r.statusText || ''} · ${r.duration || 0}ms · ${formatTime(r.timestamp)} · ${r.source}`;
  renderHeaders(r);
  renderBody('content-request', r.requestBody);
  renderBody('content-response', r.responseBody);
  const cc = $('content-curl');
  if (cc) {
    cc.innerHTML = `<div class="bg-white rounded-[12px] p-5 card-shadow">
      <div class="flex justify-between items-center mb-3">
        <span class="text-[12px] text-surface-400">cURL(默认隐藏敏感头)</span>
        <button class="modal-copy-curl px-3 py-1 text-[12px] rounded-lg bg-brand-50 text-brand-500 hover:bg-brand-100">${ICONS.copy || ''} 复制</button>
      </div>
      <pre class="code-block">${escapeHtml(toCurl(r, { includeSensitive: false }))}</pre>
    </div>`;
  }
  $('detailModal').classList.remove('hidden');
  switchTab('headers');
}
function renderHeaders(r) {
  const block = (title, headers, accent) => `
    <div class="bg-white rounded-[12px] p-5 card-shadow">
      <h4 class="text-[13px] font-semibold text-surface-700 mb-3">${title}</h4>
      <div class="space-y-1.5">${(headers || []).map((h) => `
        <div class="flex items-start gap-4 py-1.5 border-b border-surface-50 last:border-0">
          <span class="text-[12px] font-mono ${accent} min-w-[160px] shrink-0">${escapeHtml(h.name)}</span>
          <span class="text-[12px] font-mono text-surface-600 break-all">${escapeHtml(h.value)}</span>
        </div>`).join('') || '<p class="text-[12px] text-surface-400">无</p>'}</div>
    </div>`;
  $('content-headers').innerHTML = block('Request Headers', r.requestHeaders, 'text-brand-500') + block('Response Headers', r.responseHeaders, 'text-success');
}
function renderBody(boxId, content) {
  const box = $(boxId);
  if (content == null || content === '') { box.innerHTML = '<div class="bg-white rounded-[12px] p-5 card-shadow text-[12px] text-surface-400">无内容</div>'; return; }
  let pretty = content;
  try { pretty = JSON.stringify(JSON.parse(content), null, 2); } catch { /* 非 JSON 原样 */ }
  box.innerHTML = `<div class="bg-white rounded-[12px] p-5 card-shadow"><pre class="code-block">${escapeHtml(pretty)}</pre></div>`;
}
function switchTab(tab) {
  ['headers', 'request', 'response', 'curl'].forEach((t) => {
    const btn = document.querySelector(`.detail-tab[data-tab="${t}"]`);
    const content = $(`content-${t}`);
    if (!btn || !content) return;
    if (t === tab) { btn.className = 'detail-tab tab-active'; content.classList.remove('hidden'); }
    else { btn.className = 'detail-tab tab-inactive'; content.classList.add('hidden'); }
  });
}
function closeDetail() { $('detailModal').classList.add('hidden'); }

// ---- cURL 复制 ----
async function copyCurlForId(id) {
  const res = await send({ type: 'GET_DETAIL', id });
  const r = res?.record;
  if (!r) { toast('详情读取失败', 'error'); return; }
  await copyCurlDetail(r);
}

async function copyCurlDetail(detail) {
  const redacted = toCurl(detail, { includeSensitive: false });
  if (!hasSensitive(detail)) {
    await writeClip(redacted);
    toast('已复制 cURL');
    return;
  }
  const ok = confirm('此请求含 Cookie/Authorization 等敏感头,复制完整 cURL 可能泄露凭据。\n\n[确定]=复制完整版  [取消]=复制脱敏版(不含敏感头)');
  if (ok) {
    await writeClip(toCurl(detail, { includeSensitive: true }));
    toast('已复制完整 cURL(含敏感头)');
  } else {
    await writeClip(redacted);
    toast('已复制脱敏 cURL');
  }
}

async function writeClip(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { toast('剪贴板写入失败,请重试', 'error'); }
}

// ---- 全局开关 ----
async function loadGlobalToggle() {
  const got = await chrome.storage.local.get('recording');
  const r = got.recording || { global: false, tabs: {} };
  syncGlobalToggle(!!r.global);
}
function syncGlobalToggle(on) {
  const t = $('globalToggle');
  t.classList.toggle('active', on);
  $('liveDot').classList.toggle('hidden', on);
  $('liveIndicator').classList.toggle('hidden', !on);
}
async function toggleGlobal() {
  const got = await chrome.storage.local.get('recording');
  const r = got.recording || { global: false, tabs: {} };
  r.global = !r.global;
  await chrome.storage.local.set({ recording: r });
  syncGlobalToggle(r.global);
  send({ type: 'SET_GLOBAL', value: r.global }).catch(() => {});
  toast(r.global ? '全局录制已开启' : '全局录制已关闭', 'info');
}

// ---- 实时刷新(debounce + 智能暂停) ----
const REFRESH_DEBOUNCE_MS = 250;
const ALL_MAX = 5000;

function scheduleRefresh() {
  if (state.refreshTimer) return;
  state.refreshTimer = setTimeout(() => { state.refreshTimer = null; flushPending(); }, REFRESH_DEBOUNCE_MS);
}

function stripDetail(d) {
  const { requestBody, responseBody, requestBodyIsBinary, responseBodyIsBinary, ...meta } = d;
  return meta;
}

async function flushPending() {
  if (state.pendingIds.size === 0) return;
  const ids = [...state.pendingIds];
  state.pendingIds.clear();
  const res = await send({ type: 'GET_DETAILS_BY_IDS', ids });
  const details = res?.details || [];
  const byId = new Map(details.map((d) => [d.id, d]));
  let newItems = 0;
  // 用 id 是否已存在于 state.all 判断 insert vs update(而非依赖消息 type):幂等且对竞态更鲁棒。
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) continue;
    const idx = state.all.findIndex((r) => r.id === id);
    if (idx >= 0) state.all[idx] = { ...state.all[idx], ...stripDetail(d) };
    else { state.all.unshift(stripDetail(d)); if (state.all.length > ALL_MAX) state.all.pop(); newItems++; }
  }
  state.all.sort((a, b) => b.timestamp - a.timestamp);
  if (isLiveView()) { renderStats(); applyFilters(); }
  else { state.newCount += newItems; showNewBadge(); renderStats(); }
}

// ---- 数据加载 ----
async function loadAll() {
  const res = await send({ type: 'GET_ALL' });
  state.all = (res?.items || []).slice().sort((a, b) => b.timestamp - a.timestamp);
  renderStats();
  applyFilters();
}

// ---- 导出下载 ----
function extOf(format) {
  return { postman: 'json', jmeter: 'jmx', har: 'har', json: 'json' }[format] || 'txt';
}

async function doExport(format) {
  const ids = state.selected.size ? [...state.selected] : state.filtered.map((r) => r.id);
  if (!ids.length) { toast('没有可导出的请求', 'error'); return; }
  const res = await send({ type: 'GET_DETAILS_BY_IDS', ids });
  const details = res?.details || [];
  if (!details.length) { toast('读取详情失败', 'error'); return; }
  const text = exportAs(format, details);
  const blob = new Blob([text], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `api-catcher-${format}-${Date.now()}.${extOf(format)}`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`已导出 ${details.length} 条(${format})`);
}

// ---- 事件绑定 ----
$('searchInput').addEventListener('input', applyFilters);
['methodFilter', 'statusFilter', 'timeFilter', 'responseTimeFilter'].forEach((id) => $(id).addEventListener('change', applyFilters));
$('pageSize').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); state.page = 1; render(); });
$('pageNav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]'); if (!b) return;
  state.page = Number(b.dataset.page); render();
});
$('tableBody').addEventListener('click', (e) => {
  const curl = e.target.closest('.curl-open');
  if (curl) { copyCurlForId(curl.dataset.id); return; }
  const d = e.target.closest('.detail-open');
  if (d) { openDetail(d.dataset.id); return; }
});
$('tableBody').addEventListener('change', (e) => {
  const cb = e.target.closest('.row-check');
  if (!cb) return;
  toggleSelect(cb.dataset.id, cb.checked);
});
const selectAllCb = $('selectAll');
if (selectAllCb) selectAllCb.addEventListener('change', (e) => selectAllFiltered(e.target.checked));
const clearSelBtn = $('clearSelectionBtn');
if (clearSelBtn) clearSelBtn.addEventListener('click', () => { state.selected.clear(); renderTable(); syncSelectionBar(); });

$('clearFiltersBtn').addEventListener('click', () => {
  $('searchInput').value = '';
  ['methodFilter', 'statusFilter', 'timeFilter', 'responseTimeFilter'].forEach((id) => ($(id).value = ''));
  applyFilters();
});

// ---- 新请求提示条 ----
function showNewBadge() {
  const badge = $('newBadge');
  if (!badge) return;
  badge.classList.remove('hidden');
  const label = $('newBadgeCount');
  if (label) label.textContent = state.newCount;
}
function hideNewBadge() {
  state.newCount = 0;
  const b = $('newBadge');
  if (b) b.classList.add('hidden');
}
const nbv = $('newBadgeView');
if (nbv) nbv.addEventListener('click', async () => { hideNewBadge(); state.page = 1; await loadAll(); });
$('refreshBtn').addEventListener('click', async () => { await loadAll(); toast('已刷新'); });
$('globalToggle').addEventListener('click', toggleGlobal);
$('closeModalBtn').addEventListener('click', closeDetail);
$('modalBackdrop').addEventListener('click', closeDetail);
$('detailModal').addEventListener('click', (e) => {
  if (e.target.closest('.modal-copy-curl') && state.currentDetail) copyCurlDetail(state.currentDetail);
});
document.querySelectorAll('.detail-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

for (const [id, fmt] of [['exportPostman','postman'],['exportJmeter','jmeter'],['exportHar','har'],['exportJson','json']]) {
  const btn = $(id);
  if (btn) btn.addEventListener('click', () => doExport(fmt));
}

// ---- 启动 ----
loadGlobalToggle();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.recording) syncGlobalToggle(!!changes.recording.newValue?.global);
});
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'NEW_REQUEST' || msg.type === 'REQUEST_UPDATED') {
    if (msg.id) { state.pendingIds.add(msg.id); scheduleRefresh(); }
  }
});
loadAll();
