import { describe, it, expect } from 'vitest';
import { toCurl, hasSensitive, SENSITIVE_HEADERS } from '../src/logic/curl.js';

const base = {
  method: 'POST', url: 'https://x/api',
  requestHeaders: [{ name: 'Content-Type', value: 'application/json' }],
  requestBody: '{\"a\":1}', requestBodyIsBinary: false,
};

describe('curl', () => {
  it('omits -X for GET, includes -X for others', () => {
    expect(toCurl({ ...base, method: 'GET', requestBody: null })).not.toContain('-X');
    expect(toCurl(base)).toContain('-X POST');
  });
  it('emits --data for string body', () => {
    expect(toCurl(base)).toContain("--data '{\"a\":1}'");
  });
  it('quotes URL', () => {
    expect(toCurl(base)).toContain("'https://x/api'");
  });
  it('escapes single quotes in body', () => {
    const c = toCurl({ ...base, requestBody: "a'b" });
    expect(c).toContain(`'a'\\''b`);
  });
  it('uses process-substitution for binary body', () => {
    const c = toCurl({ ...base, requestBodyIsBinary: true, requestBody: 'QkFTRTY0' });
    expect(c).toContain('# 请求体为二进制');
    expect(c).toContain("--data-binary @<(printf '%s' 'QkFTRTY0' | base64 -d)");
  });
  it('hasSensitive detects cookie/auth', () => {
    expect(hasSensitive({ requestHeaders: [{ name: 'Cookie', value: 'x' }], responseHeaders: [] })).toBe(true);
    expect(hasSensitive({ requestHeaders: [{ name: 'X', value: 'y' }], responseHeaders: [] })).toBe(false);
    expect(hasSensitive({ requestHeaders: [], responseHeaders: [{ name: 'Set-Cookie', value: 'a=b' }] })).toBe(true);
  });
  it('includeSensitive=false hides sensitive headers + notes count', () => {
    const d = { ...base, requestHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Authorization', value: 'Bearer s' }] };
    const redacted = toCurl(d, { includeSensitive: false });
    expect(redacted).not.toContain('Bearer s');
    expect(redacted).toContain('# 已隐藏 1 个敏感头');
    const full = toCurl(d, { includeSensitive: true });
    expect(full).toContain('Bearer s');
  });
});
