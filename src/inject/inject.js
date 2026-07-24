(() => {
  const TAG = '__apiCatcher';
  const send = (payload) => window.postMessage({ TAG, ...payload }, '*');

  // 相对 URL → 绝对(用页面真实 location,iframe 场景也准)。与 normalize.js 的 normalizeUrl 等价。
  function absUrl(url, base) {
    if (!url) return url;
    try { return new URL(url, base || location.href).href; } catch { return url; }
  }

  function headersToObject(h) {
    if (!h) return {};
    const out = {};
    if (typeof h.forEach === 'function') h.forEach((v, k) => { out[k] = v; });
    else Object.assign(out, h);
    return out;
  }

  // ---- hook fetch ----
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const t0 = performance.now();
    let url, method, headers, body;
    try {
      const req = new Request(input, init);
      url = req.url;
      method = (init?.method || req.method || 'GET').toUpperCase();
      headers = headersToObject(init?.headers || req.headers);
      body = init?.body ?? null;
    } catch {
      url = typeof input === 'string' ? input : String(input);
      method = (init?.method || 'GET').toUpperCase();
      headers = headersToObject(init?.headers);
      body = init?.body ?? null;
    }
    const isBodyBinary = body && !(typeof body === 'string');
    const bodyText = typeof body === 'string' ? body : null;

    let response;
    try {
      response = await origFetch.apply(this, arguments);
    } catch (e) {
      throw e; // 不吞错误,让页面看到网络异常
    }
    if (response) {
      // 同步快照(detached 读取时 response 可能已被页面消耗)
      const status = response.status;
      const statusText = response.statusText;
      const respHeaders = headersToObject(response.headers);
      const mimeType = response.headers.get('content-type') || '';
      // detached: 不阻塞返回,流式响应不被破坏
      response.clone().text()
        .then((text) => {
          send({
            source: 'inject',
            timestamp: Date.now(),
            duration: Math.round(performance.now() - t0),
            resourceType: 'fetch',
            request: { url, method, headers, body: bodyText, isBodyBinary: !!isBodyBinary },
            response: { status, statusText, headers: respHeaders, body: text, mimeType, isBodyBinary: false },
          });
        })
        .catch(() => { /* 读取响应体失败则忽略,不影响页面 */ });
    }
    return response;
  };

  // ---- hook XMLHttpRequest ----
  const OrigOpen = XMLHttpRequest.prototype.open;
  const OrigSend = XMLHttpRequest.prototype.send;
  const OrigSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ac = { method: (method || 'GET').toUpperCase(), url: absUrl(String(url)), headers: {}, t0: performance.now() };
    return OrigOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__ac) this.__ac.headers[name] = value;
    return OrigSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const meta = this.__ac;
    if (meta) {
      const isBodyBinary = body && !(typeof body === 'string');
      meta.body = typeof body === 'string' ? body : null;
      meta.isBodyBinary = !!isBodyBinary;
      this.addEventListener('loadend', () => {
        try {
          let text = null;
          try { text = this.responseText; } catch { /* 某些类型无 responseText */ }
          send({
            source: 'inject',
            timestamp: Date.now(),
            duration: Math.round(performance.now() - meta.t0),
            resourceType: 'xhr',
            request: { url: meta.url, method: meta.method, headers: meta.headers, body: meta.body, isBodyBinary: meta.isBodyBinary },
            response: {
              status: this.status, statusText: this.statusText,
              headers: parseRawHeaders(this.getAllResponseHeaders()),
              body: text, mimeType: this.getResponseHeader('content-type') || '',
              isBodyBinary: false,
            },
          });
        } catch { /* 忽略,不影响页面 */ }
      });
    }
    return OrigSend.apply(this, arguments);
  };

  function parseRawHeaders(raw) {
    const out = {};
    if (!raw) return out;
    for (const line of raw.trim().split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
  }
})();
