(() => {
  const TAG = '__apiCatcher';
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.TAG !== TAG || data.source !== 'inject') return;
    const { TAG: _tag, ...raw } = data;
    try {
      chrome.runtime.sendMessage({ type: 'RECORD_INJECT', raw }).catch(() => {});
    } catch (e) {
      // 扩展重载后,旧页面上残留的 content script 其 chrome.runtime 已失效,忽略
    }
  });
})();
