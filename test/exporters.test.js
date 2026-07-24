import { describe, it, expect } from 'vitest';
import { exportAs } from '../src/logic/exporters/index.js';
import { exportPostman } from '../src/logic/exporters/postman.js';
import { exportJmeter } from '../src/logic/exporters/jmeter.js';

export const fixture = {
  id: '1', method: 'POST', url: 'https://x/api?q=1', status: 200, statusText: 'OK', duration: 12,
  timestamp: 1700000000000, source: 'inject', tabUrl: 'https://x/', resourceType: 'fetch', responseMimeType: 'application/json',
  requestHeaders: [{ name: 'Content-Type', value: 'application/json' }],
  responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
  requestBody: '{"a":1}', requestBodySize: 7, requestBodyIsBinary: false,
  responseBody: '{"ok":1}', responseBodySize: 7, responseBodyIsBinary: false,
};

describe('har exporter', () => {
  it('produces HAR 1.2 log with entry', () => {
    const har = JSON.parse(exportAs('har', [fixture]));
    expect(har.log.version).toBe('1.2');
    expect(har.log.entries[0].request.method).toBe('POST');
  });
  it('sets encoding=base64 for binary response', () => {
    const har = JSON.parse(exportAs('har', [{ ...fixture, responseBodyIsBinary: true }]));
    expect(har.log.entries[0].response.content.encoding).toBe('base64');
  });
});

describe('json exporter', () => {
  it('round-trips the detail array', () => {
    const arr = JSON.parse(exportAs('json', [fixture]));
    expect(arr[0].method).toBe('POST');
    expect(arr[0].requestBodyIsBinary).toBe(false);
  });
});

describe('postman exporter', () => {
  it('targets schema v2.1.0', () => {
    const pm = JSON.parse(exportPostman([fixture]));
    expect(pm.info.schema).toContain('v2.1.0');
  });
  it('maps headers + body', () => {
    const pm = JSON.parse(exportPostman([fixture]));
    const req = pm.item[0].request;
    expect(req.method).toBe('POST');
    expect(req.header[0].key).toBe('Content-Type');
    expect(req.body.raw).toBe('{"a":1}');
  });
  it('parses url into host/path/query', () => {
    const pm = JSON.parse(exportPostman([fixture]));
    const url = pm.item[0].request.url;
    expect(url.host).toEqual(['x']);
    expect(url.query[0]).toEqual({ key: 'q', value: '1' });
  });
});

describe('jmeter exporter', () => {
  it('emits jmeterTestPlan skeleton', () => {
    const xml = exportJmeter([fixture]);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<jmeterTestPlan');
    expect(xml).toContain('<HTTPSamplerProxy');
    expect(xml).toContain('HTTPSampler.path');
  });
  it('escapes XML special chars in url', () => {
    const xml = exportJmeter([{ ...fixture, url: 'https://x/a?b=<c>&d="e"' }]);
    expect(xml).toContain('&lt;c&gt;');
    expect(xml).toContain('&quot;e&quot;');
  });
  it('notes binary body with comment', () => {
    const xml = exportJmeter([{ ...fixture, requestBodyIsBinary: true, requestBody: 'QkFTRTY0' }]);
    expect(xml).toContain('<!-- 请求体为二进制');
  });
});

describe('exportAs routing', () => {
  it('throws on unknown format', () => {
    expect(() => exportAs('nope', [fixture])).toThrow(/unknown format/);
  });
});
