function parseUrl(raw) {
  try {
    const u = new URL(raw);
    return {
      raw, protocol: u.protocol.replace(':', ''), host: u.hostname.split('.'), port: u.port || undefined,
      path: u.pathname.split('/').filter(Boolean),
      query: [...u.searchParams].map(([k, v]) => ({ key: k, value: v })),
    };
  } catch { return { raw }; }
}
function toItem(d) {
  return {
    name: `${d.method} ${d.url}`,
    request: {
      method: d.method,
      header: (d.requestHeaders || []).map((h) => ({ key: h.name, value: String(h.value), type: 'text' })),
      url: parseUrl(d.url),
      body: d.requestBody != null ? { mode: 'raw', raw: d.requestBody, options: { raw: { language: d.requestBodyIsBinary ? 'text' : 'json' } } } : undefined,
    },
    response: [],
  };
}
export function exportPostman(details) {
  return JSON.stringify({
    info: { _postman_id: 'api-catcher-export', name: 'API Catcher Export', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: (details || []).map(toItem),
  }, null, 2);
}
