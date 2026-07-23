(() => {
  const TAG = '__apiCatcher';
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.TAG !== TAG || data.source !== 'inject') return;
    const { TAG: _tag, ...raw } = data;
    chrome.runtime.sendMessage({ type: 'RECORD_INJECT', raw });
  });
})();
