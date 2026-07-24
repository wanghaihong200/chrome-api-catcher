function parseQs(url) {
  try { return [...new URL(url).searchParams].map(([name, value]) => ({ name, value })); } catch { return []; }
}
function toEntry(d) {
  return {
    startedDateTime: new Date(d.timestamp).toISOString(),
    time: d.duration || 0,
    request: {
      method: d.method, url: d.url, httpVersion: 'HTTP/1.1',
      headers: (d.requestHeaders || []).map((h) => ({ name: h.name, value: String(h.value) })),
      queryString: parseQs(d.url), cookies: [], headersSize: -1, bodySize: d.requestBodySize || 0,
      postData: d.requestBody != null ? {
        mimeType: 'application/octet-stream', text: d.requestBody,
        ...(d.requestBodyIsBinary ? { _encoding: 'base64' } : {}),
      } : undefined,
    },
    response: {
      status: d.status || 0, statusText: d.statusText || '', httpVersion: 'HTTP/1.1',
      headers: (d.responseHeaders || []).map((h) => ({ name: h.name, value: String(h.value) })),
      cookies: [], redirectURL: '', headersSize: -1, bodySize: d.responseBodySize || 0,
      content: {
        size: d.responseBodySize || 0, mimeType: d.responseMimeType || 'application/octet-stream',
        text: d.responseBody ?? '',
        ...(d.responseBodyIsBinary ? { encoding: 'base64' } : {}),
      },
    },
    cache: {}, timings: { send: 0, wait: 0, receive: d.duration || 0 },
  };
}
export function exportHar(details) {
  return JSON.stringify({
    log: { version: '1.2', creator: { name: 'API Catcher', version: '0.1.0' }, entries: (details || []).map(toEntry) },
  }, null, 2);
}
