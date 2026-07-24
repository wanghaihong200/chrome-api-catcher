const toggle = document.getElementById('tabToggle');
const status = document.getElementById('status');
const globalHint = document.getElementById('globalHint');
const tabId = chrome.devtools.inspectedWindow.tabId;

async function getState() {
  const got = await chrome.storage.local.get('recording');
  return got.recording || { global: false, tabs: {} };
}

async function render() {
  const rec = await getState();
  const on = rec.tabs[tabId] === true;
  toggle.classList.toggle('active', on);
  status.textContent = on ? '正在抓取本标签页请求' : '默认关闭,点击开启';
  globalHint.hidden = !!rec.global;
}

toggle.addEventListener('click', async () => {
  const rec = await getState();
  rec.tabs = rec.tabs || {};
  rec.tabs[tabId] = !(rec.tabs[tabId] === true);
  await chrome.storage.local.set({ recording: rec });
  chrome.runtime.sendMessage({ type: 'SET_TAB', tabId, value: rec.tabs[tabId] }).catch(() => {});
  render();
});

chrome.storage.onChanged.addListener((_c, area) => { if (area === 'local') render(); });

// 仅在「本标签页开关开」时上报(全局判定由 background.ingest 的 shouldRecord 完成)
chrome.devtools.network.onRequestFinished.addListener((req) => {
  (async () => {
    const rec = await getState();
    if (rec.tabs[tabId] !== true) return;
    chrome.devtools.inspectedWindow.eval('location.href', (tabUrl) => {
      req.getContent((responseBody) => {
        chrome.runtime.sendMessage({
          type: 'RECORD_DEVTOOLS', har: req, responseBody, tabId, tabUrl: tabUrl || '',
        }).catch(() => {});
      });
    });
  })();
});

render();
