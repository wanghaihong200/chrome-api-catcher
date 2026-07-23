(() => {
  const TAG = '__apiCatcher';
  const send = (payload) => window.postMessage({ TAG, ...payload }, '*');

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
    let bodyText = null;
    if (typeof body === 'string') bodyText = body;

    let response, error;
    try {
      response = await origFetch.apply(this, arguments);
    } catch (e) {
      error = e; throw e;
    } finally {
      if (response) {
        try {
          const clone = response.clone();
          const text = await clone.text();
          send({
            source: 'inject',
            timestamp: Date.now(),
            duration: Math.round(performance.now() - t0),
            resourceType: 'fetch',
            request: { url, method, headers, body: bodyText, isBodyBinary: !!isBodyBinary },
            response: {
              status: response.status, statusText: response.statusText,
              headers: headersToObject(response.headers),
              body: text, mimeType: response.headers.get('content-type') || '',
              isBodyBinary: false,
            },
          });
        } catch { /* 读取响应体失败则忽略,不影响页面 */ }
      }
    }
    return response;
  };

  // ---- hook XMLHttpRequest ----
  const OrigOpen = XMLHttpRequest.prototype.open;
  const OrigSend = XMLHttpRequest.prototype.send;
  const OrigSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ac = { method: (method || 'GET').toUpperCase(), url: String(url), headers: {}, t0: performance.now() };
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
