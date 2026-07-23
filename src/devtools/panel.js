const btn = document.getElementById('toggle');
const status = document.getElementById('status');
let recording = false;
const tabId = chrome.devtools.inspectedWindow.tabId;
let tabUrl = '';

chrome.devtools.inspectedWindow.eval('location.href', (result) => { tabUrl = result || ''; });

function render() {
  btn.textContent = recording ? '录制:ON' : '录制:OFF';
  status.textContent = recording ? '正在抓取本标签页请求' : '默认关闭,点击开启';
}

btn.addEventListener('click', async () => {
  recording = !recording;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SET_RECORDING', value: recording });
    recording = !!resp?.recording;
  } catch {
    recording = false; // 出错时回退到关闭
  }
  render();
});

chrome.devtools.network.onRequestFinished.addListener((req) => {
  if (!recording) return;
  req.getContent((responseBody) => {
    try {
      chrome.runtime.sendMessage({
        type: 'RECORD_DEVTOOLS',
        har: req,
        responseBody,
        tabId,
        tabUrl,
      }).catch(() => {});
    } catch { /* 忽略 */ }
  });
});

render();
