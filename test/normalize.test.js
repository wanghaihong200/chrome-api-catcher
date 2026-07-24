import { describe, it, expect } from 'vitest';
import { normalizeInjectRecord, normalizeDevtoolsRecord, normalizeUrl } from '../src/logic/normalize.js';

const ctx = { tabId: 5, tabUrl: 'https://a.com/page' };

describe('normalizeInjectRecord', () => {
  it('把 inject 负载转为 NormalizedEntry', () => {
    const raw = {
      source: 'inject', timestamp: 2000, duration: 12,
      request: { url: 'https://a.com/api', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}', isBodyBinary: false },
      response: { status: 200, statusText: 'OK', headers: { 'X-T': '1' }, body: '{"ok":1}', mimeType: 'application/json', isBodyBinary: false },
      resourceType: 'fetch',
    };
    const e = normalizeInjectRecord(raw, ctx);
    expect(e.source).toBe('inject');
    expect(e.tabId).toBe(5);
    expect(e.request.method).toBe('POST');
    expect(e.request.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }]);
    expect(e.request.body).toEqual({ content: '{"a":1}', size: 7, isBinary: false });
    expect(e.response.body.content).toBe('{"ok":1}');
    expect(e.response.resourceType).toBe('fetch');
  });

  it('空 body 得 size 0', () => {
    const raw = { source: 'inject', timestamp: 1, duration: 0, request: { url: 'u', method: 'GET', headers: {}, body: null }, response: { status: 204, statusText: 'No Content', headers: {}, body: null, mimeType: '' }, resourceType: 'xhr' };
    const e = normalizeInjectRecord(raw, ctx);
    expect(e.request.body).toEqual({ content: null, size: 0, isBinary: false });
  });
});

describe('normalizeDevtoolsRecord', () => {
  it('把 HAR 形态转为 NormalizedEntry', () => {
    const harReq = {
      request: { method: 'GET', url: 'https://a.com/api/d', headers: [{ name: 'Accept', value: '*/*' }], postData: { text: '{"x":1}' } },
      response: { status: 200, statusText: 'OK', headers: [{ name: 'C-T', value: 'application/json' }], mimeType: 'application/json' },
      _resourceType: 'xhr', time: 8, startedDateTime: '2026-07-23T00:00:00.000Z',
    };
    const e = normalizeDevtoolsRecord(harReq, '{"d":2}', ctx);
    expect(e.source).toBe('devtools');
    expect(e.response.resourceType).toBe('xhr');
    expect(e.request.body.content).toBe('{"x":1}');
    expect(e.response.body.content).toBe('{"d":2}');
    expect(e.request.headers[0]).toEqual({ name: 'Accept', value: '*/*' });
  });
});

describe('normalizeUrl', () => {
  it('相对 url 用 base 解析为绝对', () => {
    expect(normalizeUrl('/api/x', 'https://a.com/page')).toBe('https://a.com/api/x');
  });
  it('已是绝对则保持绝对(规范化)', () => {
    expect(normalizeUrl('https://a.com/api/x', 'https://a.com/p')).toBe('https://a.com/api/x');
  });
  it('空 url 原样返回', () => {
    expect(normalizeUrl('', 'https://a.com')).toBe('');
  });
  it('base 非法时原样返回 url(不抛)', () => {
    expect(normalizeUrl('/api/x', 'not-a-url')).toBe('/api/x');
  });
});

describe('normalizeInjectRecord · URL 兜底', () => {
  it('相对 url 用 ctx.tabUrl 兜底解析为绝对', () => {
    const raw = {
      source: 'inject', timestamp: 1, duration: 0, resourceType: 'xhr',
      request: { url: '/api/x', method: 'GET', headers: {}, body: null },
      response: { status: 200, statusText: 'OK', headers: {}, body: null, mimeType: '', isBodyBinary: false },
    };
    const e = normalizeInjectRecord(raw, { tabId: 1, tabUrl: 'https://a.com/page' });
    expect(e.request.url).toBe('https://a.com/api/x');
  });
});

describe('normalizeDevtoolsRecord · 字段断言(M2)', () => {
  it('完整保留 mimeType/resourceType/duration/statusText', () => {
    const harReq = {
      request: { method: 'GET', url: 'https://a.com/d', headers: [], postData: { text: '{}' } },
      response: { status: 201, statusText: 'Created', headers: [], mimeType: 'application/json' },
      _resourceType: 'fetch', time: 33, startedDateTime: '2026-07-24T00:00:00.000Z',
    };
    const e = normalizeDevtoolsRecord(harReq, '{}', { tabId: 2, tabUrl: '' });
    expect(e.response.status).toBe(201);
    expect(e.response.statusText).toBe('Created');
    expect(e.response.mimeType).toBe('application/json');
    expect(e.response.resourceType).toBe('fetch');
    expect(e.duration).toBe(33);
  });
});

