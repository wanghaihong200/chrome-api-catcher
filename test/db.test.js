import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB, putRequest, getRequest, getBody, listRequests } from '../src/background/db.js';

function makeEntry({ respBody = '{"ok":1}', respSize, url = 'https://a.com/api/x' } = {}) {
  const size = respSize ?? (respBody ? respBody.length : 0);
  return {
    source: 'inject', timestamp: 1000, tabId: 1, tabUrl: 'https://a.com',
    request: { url, method: 'GET', headers: [], body: { content: null, size: 0, isBinary: false } },
    response: { status: 200, statusText: 'OK', headers: [], body: { content: respBody, size, isBinary: false }, mimeType: 'application/json', resourceType: 'xhr' },
    duration: 5,
  };
}

let db;
beforeEach(async () => {
  db = await openDB();
  // fake-indexeddb keeps data across opens in the same process; clear stores for isolation.
  await new Promise((resolve, reject) => {
    const t = db.transaction(['requests', 'bodies'], 'readwrite');
    t.objectStore('requests').clear();
    t.objectStore('bodies').clear();
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
});

describe('db', () => {
  it('小响应体内联,无 bodyKey', async () => {
    const id = await putRequest(db, makeEntry());
    const r = await getRequest(db, id);
    expect(r.responseBodyInline).toBe('{"ok":1}');
    expect(r.responseBodyKey).toBe(null);
    expect(r.hasResponseBody).toBe(true);
  });

  it('大响应体拆 bodies 表,主表存 bodyKey', async () => {
    const big = 'x'.repeat(70 * 1024);
    const id = await putRequest(db, makeEntry({ respBody: big, respSize: big.length }));
    const r = await getRequest(db, id);
    expect(r.responseBodyKey).not.toBe(null);
    expect(r.responseBodyInline).toBe(null);
    const body = await getBody(db, r.responseBodyKey);
    expect(body.length).toBe(big.length);
  });

  it('二进制响应体即使小也拆表', async () => {
    const e = makeEntry({ respBody: 'BIN' });
    e.response.body.isBinary = true;
    const id = await putRequest(db, e);
    const r = await getRequest(db, id);
    expect(r.responseBodyKey).not.toBe(null);
  });

  it('listRequests 按 timestamp 倒序分页', async () => {
    for (let i = 0; i < 12; i++) {
      await putRequest(db, { ...makeEntry({ url: `https://a.com/api/${i}` }), timestamp: 1000 + i });
    }
    const page1 = await listRequests(db, { page: 1, pageSize: 10 });
    expect(page1.total).toBe(12);
    expect(page1.items.length).toBe(10);
    expect(page1.items[0].timestamp).toBe(1011);
    const page2 = await listRequests(db, { page: 2, pageSize: 10 });
    expect(page2.items.length).toBe(2);
  });
});
