const $ = (id) => document.getElementById(id);
let currentTab = null;

async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  if (!tab) { $('tabDesc').textContent = '—'; return; }
  if (/^(chrome|edge|about):/i.test(tab.url || '')) {
    $('tabDesc').textContent = '该页面不可录制';
  } else {
    $('tabDesc').textContent = tab.title || tab.url || String(tab.id);
  }
}
async function getState() {
  const got = await chrome.storage.local.get('recording');
  return got.recording || { global: false, tabs: {} };
}
function syncToggle(el, on) { el.classList.toggle('active', on); }
async function render() {
  const rec = await getState();
  syncToggle($('globalToggle'), !!rec.global);
  const tabOn = !!(currentTab && rec.tabs[currentTab.id] === true);
  syncToggle($('tabToggle'), tabOn);
  let txt;
  if (!rec.global) txt = '全局关闭';
  else if (currentTab && rec.tabs[currentTab.id] === true) txt = '正在录制当前标签页';
  else txt = '全局已开,当前标签页未开启';
  $('statusText').textContent = txt;
}

$('globalToggle').addEventListener('click', async () => {
  const rec = await getState();
  rec.global = !rec.global;
  await chrome.storage.local.set({ recording: rec });
  chrome.runtime.sendMessage({ type: 'SET_GLOBAL', value: rec.global }).catch(() => {});
  render();
});
$('tabToggle').addEventListener('click', async () => {
  if (!currentTab || /^(chrome|edge|about):/i.test(currentTab.url || '')) return;
  const rec = await getState();
  rec.tabs = rec.tabs || {};
  rec.tabs[currentTab.id] = !(rec.tabs[currentTab.id] === true);
  await chrome.storage.local.set({ recording: rec });
  chrome.runtime.sendMessage({ type: 'SET_TAB', tabId: currentTab.id, value: rec.tabs[currentTab.id] }).catch(() => {});
  render();
});
$('openManage').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/manage/manage.html') });
});

(async () => { await loadCurrentTab(); await render(); })();
chrome.storage.onChanged.addListener((_c, area) => { if (area === 'local') render(); });
