export const SENSITIVE_HEADERS = ['cookie', 'authorization', 'set-cookie', 'proxy-authorization'];

function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

export function hasSensitive(detail) {
  const set = new Set(SENSITIVE_HEADERS);
  const all = [...(detail.requestHeaders || []), ...(detail.responseHeaders || [])];
  return all.some((h) => set.has(String(h.name).toLowerCase()));
}

export function toCurl(detail, { includeSensitive = false } = {}) {
  const notes = [];
  const parts = ['curl'];
  const method = (detail.method || 'GET').toUpperCase();
  if (method !== 'GET') parts.push('-X', method);

  const sens = new Set(SENSITIVE_HEADERS);
  let hidden = 0;
  for (const h of detail.requestHeaders || []) {
    if (!includeSensitive && sens.has(String(h.name).toLowerCase())) { hidden++; continue; }
    parts.push('-H', shellQuote(h.name + ': ' + h.value));
  }

  if (detail.requestBodyIsBinary && detail.requestBody) {
    notes.push('# 请求体为二进制(base64 编码,重放需先解码,需 bash 环境)');
    parts.push("--data-binary @<(printf '%s' '" + detail.requestBody + "' | base64 -d)");
  } else if (detail.requestBody) {
    parts.push('--data', shellQuote(detail.requestBody));
  }

  parts.push(shellQuote(detail.url));

  if (!includeSensitive && hidden > 0) notes.push('# 已隐藏 ' + hidden + ' 个敏感头');
  return notes.length ? notes.join('\n') + '\n' + parts.join(' ') : parts.join(' ');
}
