import { describe, it, expect } from 'vitest';
import { makeKey, findDuplicate, pickMoreComplete } from '../src/background/dedupe.js';

const base = {
  source: 'inject',
  timestamp: 1000000,
  tabId: 1, tabUrl: 'https://a.com',
  request: { url: 'https://a.com/api/u', method: 'GET', headers: [], body: { content: null, size: 0, isBinary: false } },
  response: { status: 200, statusText: 'OK', headers: [], body: { content: '{"a":1}', size: 7, isBinary: false }, mimeType: 'application/json', resourceType: 'xhr' },
  duration: 10,
};

describe('makeKey', () => {
  it('由 method + url + 请求体大小组成', () => {
    expect(makeKey(base)).toBe('GET|https://a.com/api/u|0');
  });
  it('请求体不同则 key 不同', () => {
    const post = { ...base, request: { ...base.request, method: 'POST', body: { content: 'x', size: 1, isBinary: false } } };
    expect(makeKey(post)).toBe('POST|https://a.com/api/u|1');
  });
});

describe('findDuplicate', () => {
  it('同 key 且 2 秒内判为重复', () => {
    const recent = [{ key: makeKey(base), timestamp: base.timestamp, id: 'r1' }];
    const dup = { ...base, timestamp: base.timestamp + 1500 };
    expect(findDuplicate(dup, recent)?.id).toBe('r1');
  });
  it('同 key 但超 2 秒不判重', () => {
    const recent = [{ key: makeKey(base), timestamp: base.timestamp, id: 'r1' }];
    const later = { ...base, timestamp: base.timestamp + 3000 };
    expect(findDuplicate(later, recent)).toBe(null);
  });
  it('空 recent 返回 null', () => {
    expect(findDuplicate(base, [])).toBe(null);
  });
});

describe('pickMoreComplete', () => {
  const withBody = base;
  const noBody = { ...base, response: { ...base.response, body: { content: null, size: 0, isBinary: false } } };
  it('保留响应体非空的一条', () => {
    expect(pickMoreComplete(withBody, noBody)).toBe(withBody);
    expect(pickMoreComplete(noBody, withBody)).toBe(withBody);
  });
  it('响应体更大者优先', () => {
    const bigger = { ...base, response: { ...base.response, body: { content: '{"a":1,"b":2}', size: 13, isBinary: false } } };
    expect(pickMoreComplete(bigger, base)).toBe(bigger);
  });
});
