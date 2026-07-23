function toHeaders(h) {
  if (!h) return [];
  if (Array.isArray(h)) {
    return h.map((x) => ({ name: x.name, value: x.value }));
  }
  return Object.entries(h).map(([name, value]) => ({ name, value: String(value) }));
}

function bodyOf(content, isBinary) {
  if (content == null) return { content: null, size: 0, isBinary: !!isBinary };
  const size = typeof content === 'string' ? content.length : (content?.byteLength ?? 0);
  return { content, size, isBinary: !!isBinary };
}

export function normalizeInjectRecord(raw, ctx) {
  return {
    source: 'inject',
    timestamp: raw.timestamp,
    tabId: ctx.tabId, tabUrl: ctx.tabUrl,
    request: {
      url: raw.request.url,
      method: raw.request.method,
      headers: toHeaders(raw.request.headers),
      body: bodyOf(raw.request.body, raw.request.isBodyBinary),
    },
    response: {
      status: raw.response.status,
      statusText: raw.response.statusText,
      headers: toHeaders(raw.response.headers),
      body: bodyOf(raw.response.body, raw.response.isBodyBinary),
      mimeType: raw.response.mimeType || '',
      resourceType: raw.resourceType || 'fetch',
    },
    duration: raw.duration || 0,
  };
}

export function normalizeDevtoolsRecord(harReq, responseBody, ctx) {
  const req = harReq.request || {};
  const resp = harReq.response || {};
  return {
    source: 'devtools',
    timestamp: Date.parse(harReq.startedDateTime) || Date.now(),
    tabId: ctx.tabId, tabUrl: ctx.tabUrl,
    request: {
      url: req.url,
      method: req.method,
      headers: toHeaders(req.headers),
      body: bodyOf(req.postData?.text ?? null, false),
    },
    response: {
      status: resp.status,
      statusText: resp.statusText,
      headers: toHeaders(resp.headers),
      body: bodyOf(responseBody, false),
      mimeType: resp.mimeType || '',
      resourceType: harReq._resourceType || 'xhr',
    },
    duration: Math.round(harReq.time || 0),
  };
}
