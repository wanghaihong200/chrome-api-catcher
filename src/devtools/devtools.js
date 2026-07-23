const btn = document.getElementById('toggle');
const status = document.getElementById('status');
let recording = false;
let tabId = chrome.devtools.inspectedWindow.tabId;
let tabUrl = '';

chrome.devtools.inspectedWindow.eval('location.href', (result) => { tabUrl = result || ''; });

function render() {
  btn.textContent = recording ? '录制:ON' : '录制:OFF';
  status.textContent = recording ? '正在抓取本标签页请求' : '默认关闭,点击开启';
}

btn.addEventListener('click', async () => {
  recording = !recording;
  const resp = await chrome.runtime.sendMessage({ type: 'SET_RECORDING', value: recording });
  recording = !!resp?.recording;
  render();
});

chrome.devtools.network.onRequestFinished.addListener((req) => {
  if (!recording) return;
  req.getContent((responseBody) => {
    chrome.runtime.sendMessage({
      type: 'RECORD_DEVTOOLS',
      har: req,
      responseBody,
      tabId,
      tabUrl,
    });
  });
});

render();
