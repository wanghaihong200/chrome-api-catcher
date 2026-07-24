export const DB_NAME = 'api-catcher';
export const DB_VERSION = 1;
export const INLINE_MAX = 64 * 1024;

function openWithUpgrade(name, version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains('requests')) {
        const s = idb.createObjectStore('requests', { keyPath: 'id' });
        s.createIndex('by-timestamp', 'timestamp');
        s.createIndex('by-url', 'url');
      }
      if (!idb.objectStoreNames.contains('bodies')) {
        idb.createObjectStore('bodies', { keyPath: 'bodyKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 幂等打开:若库已存在但 store 缺失(残留/损坏),bump 版本触发 upgrade 重建 schema
export async function openDB() {
  let db = await openWithUpgrade(DB_NAME, DB_VERSION);
  if (!db.objectStoreNames.contains('requests') || !db.objectStoreNames.contains('bodies')) {
    const next = (db.version || DB_VERSION) + 1;
    db.close();
    db = await openWithUpgrade(DB_NAME, next);
  }
  return db;
}

function tx(idb, store, mode) {
  return idb.transaction(store, mode).objectStore(store);
}

function req2promise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function planBody(body) {
  if (!body || body.content == null) {
    return { inline: null, key: null, needStore: null };
  }
  const small = !body.isBinary && body.size <= INLINE_MAX;
  if (small) {
    return { inline: body.content, key: null, needStore: null };
  }
  const key = genId();
  return { inline: null, key, needStore: { bodyKey: key, content: body.content, isBinary: !!body.isBinary, size: body.size } };
}

export async function putRequest(db, entry) {
  const reqBody = planBody(entry.request.body);
  const respBody = planBody(entry.response.body);

  const t = db.transaction(['requests', 'bodies'], 'readwrite');
  const id = genId();
  const record = {
    id,
    timestamp: entry.timestamp,
    tabId: entry.tabId,
    tabUrl: entry.tabUrl,
    url: entry.request.url,
    method: entry.request.method,
    status: entry.response.status,
    statusText: entry.response.statusText,
    requestHeaders: entry.request.headers,
    requestBodyKey: reqBody.key,
    requestBodyInline: reqBody.inline,
    requestBodySize: entry.request.body.size,
    hasRequestBody: entry.request.body.content != null,
    responseHeaders: entry.response.headers,
    responseBodyKey: respBody.key,
    responseBodyInline: respBody.inline,
    responseBodySize: entry.response.body.size,
    hasResponseBody: entry.response.body.content != null,
    responseMimeType: entry.response.mimeType,
    resourceType: entry.response.resourceType,
    source: entry.source,
    duration: entry.duration,
  };
  t.objectStore('requests').put(record);
  if (reqBody.needStore) t.objectStore('bodies').put(reqBody.needStore);
  if (respBody.needStore) t.objectStore('bodies').put(respBody.needStore);

  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return id;
}

export async function getRequest(db, id) {
  return req2promise(tx(db, 'requests', 'readonly').get(id));
}

/** 读取单条并合并 body(内联优先,否则从 bodies 表懒加载)。用于详情。 */
export async function getRequestDetail(db, id) {
  const record = await req2promise(tx(db, 'requests', 'readonly').get(id));
  if (!record) return null;
  const resolveBody = async (inline, key) => {
    if (inline != null) return { content: inline, isBinary: false };
    if (key) {
      const row = await getBodyRow(db, key);
      return row ? { content: row.content, isBinary: !!row.isBinary } : { content: null, isBinary: false };
    }
    return { content: null, isBinary: false };
  };
  const rb = await resolveBody(record.requestBodyInline, record.requestBodyKey);
  const pb = await resolveBody(record.responseBodyInline, record.responseBodyKey);
  return {
    ...record,
    requestBody: rb.content, requestBodyIsBinary: rb.isBinary,
    responseBody: pb.content, responseBodyIsBinary: pb.isBinary,
  };
}

/** 用 entry 的响应部分回写已存在记录(同 id 覆盖)。用于去重时保留更完整响应(M6)。 */
export async function updateRequest(db, id, entry) {
  const existing = await req2promise(tx(db, 'requests', 'readonly').get(id));
  if (!existing) return false;
  const respBody = planBody(entry.response.body);
  const t = db.transaction(['requests', 'bodies'], 'readwrite');
  const updated = {
    ...existing,
    status: entry.response.status,
    statusText: entry.response.statusText,
    responseHeaders: entry.response.headers,
    responseBodyKey: respBody.key,
    responseBodyInline: respBody.inline,
    responseBodySize: entry.response.body.size,
    hasResponseBody: entry.response.body.content != null,
    responseMimeType: entry.response.mimeType,
    duration: entry.duration || existing.duration,
  };
  t.objectStore('requests').put(updated);
  if (respBody.needStore) t.objectStore('bodies').put(respBody.needStore);
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return true;
}

export async function getBody(db, bodyKey) {
  const row = await req2promise(tx(db, 'bodies', 'readonly').get(bodyKey));
  if (!row) return null;
  return row.content;
}

export async function getBodyRow(db, bodyKey) {
  return req2promise(tx(db, 'bodies', 'readonly').get(bodyKey));
}

export async function listRequests(db, { page = 1, pageSize = 10 } = {}) {
  const store = tx(db, 'requests', 'readonly');
  const idx = store.index('by-timestamp');
  const total = await req2promise(store.count());
  const items = [];
  const skip = (page - 1) * pageSize;
  const open = idx.openCursor(null, 'prev');
  let advanced = false;
  return new Promise((resolve, reject) => {
    open.onsuccess = () => {
      const cursor = open.result;
      if (!cursor) return resolve({ items, total });
      if (!advanced && skip > 0) { advanced = true; cursor.advance(skip); return; }
      if (items.length < pageSize) { items.push(cursor.value); cursor.continue(); }
      else resolve({ items, total });
    };
    open.onerror = () => reject(open.error);
  });
}

/**
 * 在 DB 里按 by-url 索引查同 url 的记录,筛 method + 时间窗 + 请求体大小,返回首个命中 id 或 null。
 * 用 getAll 单请求取回全部记录后内存筛选,避免跨 await 复用事务被 IDB 自动提交。
 * 去重的真相源(M9 并发竞态 / SW 重启 recent 清空 / M10 by-url 索引利用,一并解决)。
 */
export async function findDuplicateByRequest(db, { method, url, timestamp, bodySize, windowMs = 2000 }) {
  const idx = tx(db, 'requests', 'readonly').index('by-url');
  const records = await req2promise(idx.getAll(IDBKeyRange.only(url)));
  for (const rec of records) {
    if (rec.method !== method) continue;
    if (Math.abs(rec.timestamp - timestamp) >= windowMs) continue;
    if (rec.requestBodySize !== bodySize) continue;
    return rec.id;
  }
  return null;
}
