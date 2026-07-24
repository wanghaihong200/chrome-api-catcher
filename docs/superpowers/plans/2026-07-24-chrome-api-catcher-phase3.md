# Chrome API Catcher — Phase 3 实现计划:cURL / 批量导出 / 实时刷新

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 API Catcher 补齐「用起来」的能力——cURL 生成+复制、四格式批量导出、录制时实时刷新,并清掉 M8(二进制 body)/M9(并发去重竞态)/M10(by-url 索引)三个债务。

**Architecture:** 纯逻辑层(`base64.js`/`curl.js`/`exporters/*`/`db.js` 新查询)无 DOM 依赖走 vitest 严格 TDD;捕获层(`inject.js`)与消费层(`manage.js`)走「实现 + playwright 集成验证」。去重真相源从内存 `recent` 改为 IndexedDB `by-url` 索引查询,SW 通过 `chrome.runtime.sendMessage` 广播 `NEW_REQUEST`/`REQUEST_UPDATED`,管理页 debounce 后增量合并。

**Tech Stack:** Chrome MV3、IndexedDB(fake-indexeddb 单测)、vitest、playwright(headed,chromium-1223 ↔ playwright@1.60.0)、Tailwind CLI 预编译。

**对应 spec:** `docs/superpowers/specs/2026-07-24-chrome-api-catcher-phase3-design.md`

**全局约定:**
- 所有 commit message 末尾追加 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 改 `manage.html`/`manage.js` 的 Tailwind class 后**必须** `npm run build:css`(Phase 2 既有约束,见 Task 14)。
- 测试命令统一 `npx vitest run <file>`(项目用 vitest)。
- 分支 `phase3`(已基于 phase2 HEAD `849c6f6`)。

---

## 文件结构

**新增(纯逻辑,可单测):**
- `src/logic/base64.js` — `bytesToBase64(input)`、`decodeBase64(str)`
- `src/logic/curl.js` — `toCurl(detail,{includeSensitive})`、`hasSensitive(detail)`、`SENSITIVE_HEADERS`
- `src/logic/exporters/har.js` — `exportHar(details)`
- `src/logic/exporters/postman.js` — `exportPostman(details)`
- `src/logic/exporters/jmeter.js` — `exportJmeter(details)`
- `src/logic/exporters/json.js` — `exportJson(details)`
- `src/logic/exporters/index.js` — `exportAs(format, details)`
- `test/base64.test.js`、`test/curl.test.js`、`test/exporters.test.js`
- `test/integration/phase3-verify.mjs`

**修改:**
- `src/background/db.js` — 加 `getBodyRow`、`findDuplicateByRequest`、`getDetailsByIds`;扩 `getRequestDetail` 回填 `isBinary`
- `src/background/background.js` — ingest 改 DB 真相源、移除 `recent`、加广播、加 `GET_DETAILS_BY_IDS` 消息
- `src/inject/inject.js` — 加 `encodeBody`(内联 base64)、fetch/XHR 响应体二进制分支
- `src/manage/manage.js` — 勾选列、批量操作条、行内 cURL、Modal curl tab、敏感头提示、实时刷新 listener、提示条
- `src/manage/manage.html` / `manage.css` / `icons.js` — 对应 UI

`src/logic/normalize.js` **无需改**:`bodyOf` 已透传 `isBinary`,`size = content.length` 对 base64 字符串自动成立(spec §4.3 已澄清)。

---

## Task 1: `base64.js` — 字节↔base64 工具

**Files:**
- Create: `src/logic/base64.js`
- Test: `test/base64.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/base64.test.js
import { describe, it, expect } from 'vitest';
import { bytesToBase64, decodeBase64 } from '../src/logic/base64.js';

describe('base64', () => {
  it('encodes ArrayBuffer', () => {
    expect(bytesToBase64(new Uint8Array([72, 105]).buffer)).toBe('SGk='); // "Hi"
  });
  it('encodes Uint8Array view with offset', () => {
    const view = new Uint8Array([0, 0, 72, 105]).subarray(2);
    expect(bytesToBase64(view)).toBe('SGk=');
  });
  it('encodes string as utf-8', () => {
    expect(bytesToBase64('Hi')).toBe('SGk=');
  });
  it('encodes empty / null input to empty string', () => {
    expect(bytesToBase64(new ArrayBuffer(0))).toBe('');
    expect(bytesToBase64(null)).toBe('');
  });
  it('decodes back to the same bytes', () => {
    const orig = [1, 2, 3, 4, 5, 250];
    const dec = decodeBase64(bytesToBase64(new Uint8Array(orig).buffer));
    expect(Array.from(dec)).toEqual(orig);
  });
  it('handles large arrays in chunks (no stack overflow)', () => {
    const big = new Uint8Array(20000);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;
    const dec = decodeBase64(bytesToBase64(big.buffer));
    expect(Array.from(dec)).toEqual(Array.from(big));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/base64.test.js`
Expected: FAIL — `Cannot find module '../src/logic/base64.js'`

- [ ] **Step 3: 最小实现**

```js
// src/logic/base64.js
export function bytesToBase64(input) {
  let bytes;
  if (input == null) return '';
  if (typeof input === 'string') bytes = new TextEncoder().encode(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  else return '';
  let binary = '';
  const CHUNK = 0x8000; // 分块防爆栈
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function decodeBase64(b64) {
  if (!b64) return new Uint8Array(0);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/base64.test.js`
Expected: PASS(6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/logic/base64.js test/base64.test.js
git commit -m "feat(logic): base64 字节编解码工具(M8 基础设施)"
```

---

## Task 2: `db.js` — `getBodyRow` + `getRequestDetail` 回填 isBinary

**Files:**
- Modify: `src/background/db.js`(`getBody` 附近)
- Test: `test/db.test.js`(追加;该文件顶部已 `import 'fake-indexeddb/auto'`)

- [ ] **Step 1: 写失败测试(追加到 test/db.test.js 末尾)**

```js
// 追加到 test/db.test.js。若文件顶部尚未注入,先加:import 'fake-indexeddb/auto';
import { openDB, putRequest, getRequestDetail } from '../src/background/db.js';

async function seedEntry(overrides = {}) {
  const db = await openDB();
  const entry = {
    timestamp: 1000, tabId: 1, tabUrl: 'https://x/', source: 'inject', duration: 10,
    request: { url: 'https://x/api', method: 'GET', headers: [], body: { content: '{"a":1}', size: 7, isBinary: false } },
    response: { status: 200, statusText: 'OK', headers: [], body: { content: '{}', size: 2, isBinary: false }, mimeType: 'application/json', resourceType: 'xhr' },
    ...overrides,
  };
  const id = await putRequest(db, entry);
  return { db, id, entry };
}

describe('getRequestDetail isBinary', () => {
  it('reports isBinary=false for inline text body', async () => {
    const { db, id } = await seedEntry();
    const d = await getRequestDetail(db, id);
    expect(d.requestBody).toBe('{"a":1}');
    expect(d.requestBodyIsBinary).toBe(false);
    expect(d.responseBodyIsBinary).toBe(false);
  });
  it('reports isBinary=true for split binary body', async () => {
    const bigBin = 'A'.repeat(70 * 1024); // > 64KB 触发拆分到 bodies 表;isBinary=true 强制拆分
    const { db, id } = await seedEntry({
      request: { url: 'https://x/api', method: 'POST', headers: [], body: { content: bigBin, size: bigBin.length, isBinary: true } },
    });
    const d = await getRequestDetail(db, id);
    expect(d.requestBody).toBe(bigBin);
    expect(d.requestBodyIsBinary).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/db.test.js`
Expected: FAIL — `requestBodyIsBinary` is `undefined`

- [ ] **Step 3: 改实现**

在 `src/background/db.js` 中,**新增** `getBodyRow`(返回整行,含 isBinary),并**重写** `getRequestDetail`:

```js
// 新增(放在 getBody 之前或之后)
export async function getBodyRow(db, bodyKey) {
  return req2promise(tx(db, 'bodies', 'readonly').get(bodyKey));
}

// 重写 getRequestDetail
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
```

保留旧 `getBody`(返回 content)以防其他引用;若 grep 确认无引用可删。

- [ ] **Step 4: 运行确认通过(含现有 db 测试)**

Run: `npx vitest run test/db.test.js`
Expected: PASS(新增 2 + 现有全部)

- [ ] **Step 5: Commit**

```bash
git add src/background/db.js test/db.test.js
git commit -m "feat(db): getRequestDetail 回填 requestBodyIsBinary/responseBodyIsBinary"
```

---

## Task 3: `db.js` — `findDuplicateByRequest`(M9 + M10)

**Files:**
- Modify: `src/background/db.js`(末尾新增导出)
- Test: `test/db.test.js`(追加)

- [ ] **Step 1: 写失败测试(追加)**

```js
import { findDuplicateByRequest } from '../src/background/db.js';

describe('findDuplicateByRequest', () => {
  it('finds same method+url+bodySize within window', async () => {
    const { db, id } = await seedEntry({ timestamp: 1000 });
    const dup = await findDuplicateByRequest(db, { method: 'GET', url: 'https://x/api', timestamp: 1500, bodySize: 0 });
    expect(dup).toBe(id);
  });
  it('returns null when method differs', async () => {
    const { db } = await seedEntry({ timestamp: 1000, request: { url: 'https://x/api', method: 'POST', headers: [], body: { content: '', size: 0, isBinary: false } } });
    const dup = await findDuplicateByRequest(db, { method: 'GET', url: 'https://x/api', timestamp: 1000, bodySize: 0 });
    expect(dup).toBeNull();
  });
  it('returns null outside time window', async () => {
    const { db } = await seedEntry({ timestamp: 1000 });
    const dup = await findDuplicateByRequest(db, { method: 'GET', url: 'https://x/api', timestamp: 4000, bodySize: 0, windowMs: 2000 });
    expect(dup).toBeNull();
  });
  it('returns null when bodySize differs', async () => {
    const { db } = await seedEntry({ timestamp: 1000, request: { url: 'https://x/api', method: 'GET', headers: [], body: { content: 'abcdef', size: 6, isBinary: false } } });
    const dup = await findDuplicateByRequest(db, { method: 'GET', url: 'https://x/api', timestamp: 1000, bodySize: 99 });
    expect(dup).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/db.test.js -t findDuplicateByRequest`
Expected: FAIL — `findDuplicateByRequest is not a function`

- [ ] **Step 3: 实现(追加到 db.js 末尾)**

```js
/**
 * 在 DB 里按 by-url 索引查同 url 的记录,筛 method + 时间窗 + 请求体大小,返回首个命中 id 或 null。
 * 去重的真相源(M9 并发竞态 / SW 重启 recent 清空 / M10 by-url 索引利用,一并解决)。
 */
export async function findDuplicateByRequest(db, { method, url, timestamp, bodySize, windowMs = 2000 }) {
  const store = tx(db, 'requests', 'readonly');
  const idx = store.index('by-url');
  const keys = await req2promise(idx.getAllKeys(IDBKeyRange.only(url)));
  for (const id of keys) {
    const rec = await req2promise(store.get(id));
    if (!rec) continue;
    if (rec.method !== method) continue;
    if (Math.abs(rec.timestamp - timestamp) >= windowMs) continue;
    if (rec.requestBodySize !== bodySize) continue;
    return id;
  }
  return null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/db.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/background/db.js test/db.test.js
git commit -m "feat(db): findDuplicateByRequest 用 by-url 索引查重(M9/M10)"
```

---

## Task 4: `db.js` — `getDetailsByIds`(批量详情)

**Files:**
- Modify: `src/background/db.js`(末尾新增导出)
- Test: `test/db.test.js`(追加)

> **陷阱提醒:** IndexedDB 事务在 request 队列空出间隙会自动提交,故**不可**在单个事务里 `await` 串行多个 `get`。这里用「循环调用 `getRequestDetail`(每条独立事务)」——仍是单次消息一次往返,比 N 次 `GET_DETAIL` 消息省往返开销。

- [ ] **Step 1: 写失败测试(追加)**

```js
import { getDetailsByIds } from '../src/background/db.js';

describe('getDetailsByIds', () => {
  it('returns details for given ids, skipping unknown', async () => {
    const a = await seedEntry({ request: { url: 'https://x/a', method: 'GET', headers: [], body: { content: '', size: 0, isBinary: false } } });
    const b = await seedEntry({ request: { url: 'https://x/b', method: 'GET', headers: [], body: { content: '', size: 0, isBinary: false } } });
    const details = await getDetailsByIds(a.db, [a.id, b.id, 'no-such-id']);
    expect(details).toHaveLength(2);
    expect(details.map((d) => d.url).sort()).toEqual(['https://x/a', 'https://x/b']);
    expect(details[0].requestBodyIsBinary).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/db.test.js -t getDetailsByIds`
Expected: FAIL — `getDetailsByIds is not a function`

- [ ] **Step 3: 实现(追加到 db.js 末尾)**

```js
/** 批量取详情(合并 body + isBinary)。单次消息调用;内部每条独立事务以规避 IDB 自动提交。 */
export async function getDetailsByIds(db, ids) {
  const out = [];
  for (const id of ids || []) {
    const d = await getRequestDetail(db, id);
    if (d) out.push(d);
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/db.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/background/db.js test/db.test.js
git commit -m "feat(db): getDetailsByIds 批量合并详情"
```

---

## Task 5: `background.js` — ingest 改 DB 真相源 + 移除 recent + 广播 + 新消息

**Files:**
- Modify: `src/background/background.js`
- Verify: 现有单测不回归(`npx vitest run`),行为由 Task 15 集成验证覆盖

> 本任务改的是依赖 chrome API 的 background,无纯函数可单测;去重核心 `findDuplicateByRequest` 已在 Task 3 单测。这里保证:① 现有 37 单测全绿;② 移除 recent 后无残留引用。

- [ ] **Step 1: 改 import 与 state**

`src/background/background.js` 顶部 import 改为(去掉 `makeKey/findDuplicate/pickMoreComplete` 的生产引用):

```js
import { openDB, putRequest, getRequestDetail, getRequest, listRequests, updateRequest, findDuplicateByRequest, getDetailsByIds } from './db.js';
import { shouldKeep } from '../logic/filter.js';
import { normalizeInjectRecord, normalizeDevtoolsRecord } from '../logic/normalize.js';
import { shouldRecord, DEFAULT_RECORDING_STATE } from '../logic/recording.js';
```

`state` 与常量改为(删除 `recent`/`RECENT_MAX`/`pushRecent`):

```js
const STORAGE_KEY = 'recording';
const ALL_PAGE_SIZE = 5000;

const state = {
  recording: { ...DEFAULT_RECORDING_STATE, tabs: {} },
  dbPromise: null,
};
```

删除 `pushRecent` 函数整段。

- [ ] **Step 2: 重写 `ingest` + 加 `notify`**

```js
function notify(msg) {
  try { chrome.runtime.sendMessage(msg).catch(() => { /* 无监听者时忽略 */ }); } catch { /* SW 间回环等忽略 */ }
}

async function ingest(entry) {
  if (!shouldRecord(state.recording, entry.tabId)) return;
  if (!shouldKeep({ url: entry.request.url, resourceType: entry.response.resourceType, responseMimeType: entry.response.mimeType })) {
    return;
  }
  const dupId = await findDuplicateByRequest(await db(), {
    method: entry.request.method,
    url: entry.request.url,
    timestamp: entry.timestamp,
    bodySize: entry.request.body.size,
  });
  if (dupId) {
    try {
      const existing = await getRequest(await db(), dupId);
      if (existing) {
        const entrySize = entry.response.body.size;
        if (entrySize > existing.responseBodySize) {
          await updateRequest(await db(), dupId, entry);
          notify({ type: 'REQUEST_UPDATED', id: dupId });
        }
      }
    } catch { /* 回写失败不影响主流程 */ }
    return;
  }
  const id = await putRequest(await db(), entry);
  notify({ type: 'NEW_REQUEST', id });
}
```

- [ ] **Step 3: 加 `GET_DETAILS_BY_IDS` 消息分支**

在 `chrome.runtime.onMessage` 的 switch 里(`GET_DETAIL` 分支之后)插入:

```js
case 'GET_DETAILS_BY_IDS': {
  const details = await getDetailsByIds(await db(), msg.ids || []);
  sendResponse({ details });
  break;
}
```

- [ ] **Step 4: 运行全量单测确认无回归**

Run: `npx vitest run`
Expected: PASS(37 现有 + Task 1–4 新增;若 `dedupe.test.js` 有用例引用已删的 `pushRecent`/生产路径,修正其只测 `makeKey/findDuplicate/pickMoreComplete` 纯函数)

- [ ] **Step 5: Commit**

```bash
git add src/background/background.js test/dedupe.test.js
git commit -m "refactor(background): 去重改 DB 真相源(M9/M10),移除 recent,广播 NEW/UPDATED,加 GET_DETAILS_BY_IDS"
```

---

## Task 6: `inject.js` — `encodeBody`(内联 base64)+ 响应体二进制分支

**Files:**
- Modify: `src/inject/inject.js`
- Verify: 由 Task 15 集成验证覆盖(MAIN world 无法 import 扩展模块,故内联 base64)

> **内联说明:** `inject.js` 运行在 MAIN world(页面上下文),拿不到扩展的 ES module。`bytesToBase64` 在此内联一份,算法与 `src/logic/base64.js` 完全一致(后者单测覆盖算法;此副本由集成测试覆盖)。

- [ ] **Step 1: 加内联 base64 与判定工具(放在 IIFE 内顶部,`absUrl` 之后)**

```js
  function bytesToBase64(input) {
    let bytes;
    if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
    else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    else return '';
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(binary);
  }
  const BINARY_RESP_RE = /^(image\/|application\/octet-stream|font\/|video\/|audio\/)/i;
  function isBinaryResp(mimeType) { return BINARY_RESP_RE.test(mimeType || ''); }

  async function encodeBody(body) {
    if (body == null || typeof body === 'string') return { body: body ?? null, isBinary: false };
    if (body instanceof URLSearchParams) return { body: body.toString(), isBinary: false };
    try {
      let buf;
      if (body instanceof ArrayBuffer) buf = body;
      else if (ArrayBuffer.isView(body)) buf = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      else if (body instanceof Blob) buf = await body.arrayBuffer();
      else if (body instanceof FormData) buf = await new Response(body).arrayBuffer();
      else return { body: null, isBinary: false };
      return { body: bytesToBase64(buf), isBinary: true };
    } catch { return { body: null, isBinary: false }; }
  }
```

- [ ] **Step 2: 改 fetch 的请求体与响应体**

把 fetch hook 里现有的 `const bodyText = typeof body === 'string' ? body : null;` 与 `request.body`/`response.body` 段替换。`body` 捕获后改为 `await encodeBody`:

```js
    const enc = await encodeBody(body); // body = init?.body ?? null
```

`send` 的 `request` 字段改为:

```js
            request: { url, method, headers, body: enc.body, isBodyBinary: enc.isBinary },
```

响应体按 content-type 分支(替换原 `response.clone().text().then(...)` 段):

```js
      if (isBinaryResp(mimeType)) {
        response.clone().arrayBuffer()
          .then((buf) => send({
            source: 'inject', timestamp: Date.now(), duration: Math.round(performance.now() - t0), resourceType: 'fetch',
            request: { url, method, headers, body: enc.body, isBodyBinary: enc.isBinary },
            response: { status, statusText, headers: respHeaders, body: bytesToBase64(buf), mimeType, isBodyBinary: true },
          }))
          .catch(() => {});
      } else {
        response.clone().text()
          .then((text) => send({
            source: 'inject', timestamp: Date.now(), duration: Math.round(performance.now() - t0), resourceType: 'fetch',
            request: { url, method, headers, body: enc.body, isBodyBinary: enc.isBinary },
            response: { status, statusText, headers: respHeaders, body: text, mimeType, isBodyBinary: false },
          }))
          .catch(() => {});
      }
```

- [ ] **Step 3: 改 XHR 的请求体**

XHR `send` 的 `loadend` 回调里,把 `meta.body`/`meta.isBodyBinary` 改为 `await encodeBody(meta.body)`:

```js
      this.addEventListener('loadend', async () => {
        try {
          const enc = await encodeBody(meta.body);
          let text = null;
          try { text = this.responseText; } catch { /* 某些类型无 responseText */ }
          send({
            source: 'inject', timestamp: Date.now(), duration: Math.round(performance.now() - meta.t0), resourceType: 'xhr',
            request: { url: meta.url, method: meta.method, headers: meta.headers, body: enc.body, isBodyBinary: enc.isBinary },
            response: { status: this.status, statusText: this.statusText, headers: parseRawHeaders(this.getAllResponseHeaders()), body: text, mimeType: this.getResponseHeader('content-type') || '', isBodyBinary: false },
          });
        } catch { /* 忽略,不影响页面 */ }
      });
```

> XHR 响应体维持 `responseText`(本期不对 XHR 做二进制优化,见 spec §7)。

- [ ] **Step 4: 运行全量单测确认无回归**

Run: `npx vitest run`
Expected: PASS(inject.js 不被单测覆盖,确认未破坏 import 链)

- [ ] **Step 5: Commit**

```bash
git add src/inject/inject.js
git commit -m "feat(inject): encodeBody 捕获二进制请求体(FormData/Blob/ArrayBuffer→base64)+ fetch 响应体二进制分支(M8)"
```

---

## Task 7: `curl.js` — cURL 生成器 + 敏感头判定

**Files:**
- Create: `src/logic/curl.js`
- Test: `test/curl.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/curl.test.js
import { describe, it, expect } from 'vitest';
import { toCurl, hasSensitive, SENSITIVE_HEADERS } from '../src/logic/curl.js';

const base = {
  method: 'POST', url: 'https://x/api',
  requestHeaders: [{ name: 'Content-Type', value: 'application/json' }],
  requestBody: '{"a":1}', requestBodyIsBinary: false,
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
    expect(c).toContain(`'a'\\''b'`);
  });
  it('uses process-substitution for binary body', () => {
    const c = toCurl({ ...base, requestBodyIsBinary: true, requestBody: 'QkFTRTY0' });
    expect(c).toContain('# 请求体为二进制');
    expect(c).toContain("--data-binary @<(printf '%s' 'QkFTRTY0' | base64 -d)");
  });
  it('hasSensitive detects cookie/auth', () => {
    expect(hasSensitive({ requestHeaders: [{ name: 'Cookie', value: 'x' }], responseHeaders: [] })).toBe(true);
    expect(hasSensitive({ requestHeaders: [{ name: 'X', value: 'y' }], responseHeaders: [] })).toBe(false);
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/curl.test.js`
Expected: FAIL — `Cannot find module '../src/logic/curl.js'`

- [ ] **Step 3: 实现**

```js
// src/logic/curl.js
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
    parts.push('-H', shellQuote(`${h.name}: ${h.value}`));
  }

  if (detail.requestBodyIsBinary && detail.requestBody) {
    notes.push('# 请求体为二进制(base64 编码,重放需先解码)');
    parts.push(`--data-binary @<(printf '%s' '${detail.requestBody}' | base64 -d)`);
  } else if (detail.requestBody) {
    parts.push('--data', shellQuote(detail.requestBody));
  }

  parts.push(shellQuote(detail.url));

  if (!includeSensitive && hidden > 0) notes.push(`# 已隐藏 ${hidden} 个敏感头`);
  return notes.length ? notes.join('\n') + '\n' + parts.join(' ') : parts.join(' ');
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/curl.test.js`
Expected: PASS(7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/logic/curl.js test/curl.test.js
git commit -m "feat(logic): cURL 生成器 + 敏感头判定"
```

---

## Task 8: exporters — `har.js` + `json.js` + `index.js`

**Files:**
- Create: `src/logic/exporters/har.js`、`json.js`、`index.js`
- Test: `test/exporters.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/exporters.test.js
import { describe, it, expect } from 'vitest';
import { exportAs } from '../src/logic/exporters/index.js';

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

describe('exportAs routing', () => {
  it('throws on unknown format', () => {
    expect(() => exportAs('nope', [fixture])).toThrow(/unknown format/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/exporters.test.js`
Expected: FAIL — `Cannot find module '../src/logic/exporters/index.js'`

- [ ] **Step 3: 实现 har.js**

```js
// src/logic/exporters/har.js
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
```

- [ ] **Step 4: 实现 json.js**

```js
// src/logic/exporters/json.js
export function exportJson(details) {
  return JSON.stringify(details, null, 2);
}
```

- [ ] **Step 5: 实现 index.js(har/json 先行;postman/jmeter 在 Task 9/10 加入)**

```js
// src/logic/exporters/index.js
import { exportHar } from './har.js';
import { exportPostman } from './postman.js';
import { exportJmeter } from './jmeter.js';
import { exportJson } from './json.js';

export function exportAs(format, details) {
  switch (format) {
    case 'har': return exportHar(details);
    case 'postman': return exportPostman(details);
    case 'jmeter': return exportJmeter(details);
    case 'json': return exportJson(details);
    default: throw new Error(`unknown format: ${format}`);
  }
}
```

> Step 5 后 index.js 引用了尚未创建的 postman.js/jmeter.js,会导致 Task 8 测试 import 报错。**临时**在 index.js 注释掉 postman/jmeter 两行(并在 switch 里临时 `throw` 或回退),等 Task 9/10 完成后再取消注释。或:本步先只引 har/json,Task 9/10 各自补 import 行。**推荐后者**——Step 5 的 index.js 暂为:

```js
// src/logic/exporters/index.js(临时,Task 9/10 后补全)
import { exportHar } from './har.js';
import { exportJson } from './json.js';

export function exportAs(format, details) {
  switch (format) {
    case 'har': return exportHar(details);
    case 'json': return exportJson(details);
    default: throw new Error(`unknown format: ${format}`);
  }
}
```

Task 9 结束加 `postman` 分支,Task 10 结束加 `jmeter` 分支。

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run test/exporters.test.js`
Expected: PASS(har 2 + json 1 + routing 1;routing 测 unknown 走 default throw,成立)

- [ ] **Step 7: Commit**

```bash
git add src/logic/exporters/har.js src/logic/exporters/json.js src/logic/exporters/index.js test/exporters.test.js
git commit -m "feat(logic): HAR/JSON 导出器 + exportAs 路由"
```

---

## Task 9: exporters — `postman.js`(v2.1)

**Files:**
- Create: `src/logic/exporters/postman.js`
- Modify: `src/logic/exporters/index.js`(加 postman 分支)
- Test: `test/exporters.test.js`(追加)

- [ ] **Step 1: 写失败测试(追加)**

```js
import { exportPostman } from '../src/logic/exporters/postman.js';

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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/exporters.test.js -t postman`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 postman.js**

```js
// src/logic/exporters/postman.js
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
```

- [ ] **Step 4: 在 index.js 加 postman 分支**

```js
// src/logic/exporters/index.js —— 加 import 与 case
import { exportPostman } from './postman.js';
// switch 内:
//   case 'postman': return exportPostman(details);
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run test/exporters.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/logic/exporters/postman.js src/logic/exporters/index.js test/exporters.test.js
git commit -m "feat(logic): Postman v2.1 导出器"
```

---

## Task 10: exporters — `jmeter.js`(XML)+ 补全 index.js

**Files:**
- Create: `src/logic/exporters/jmeter.js`
- Modify: `src/logic/exporters/index.js`(加 jmeter 分支)
- Test: `test/exporters.test.js`(追加)

- [ ] **Step 1: 写失败测试(追加)**

```js
import { exportJmeter } from '../src/logic/exporters/jmeter.js';

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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/exporters.test.js -t jmeter`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 jmeter.js**

```js
// src/logic/exporters/jmeter.js
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function sampler(d) {
  const headers = (d.requestHeaders || [])
    .map((h) => `        <Header name="${esc(h.name)}" value="${esc(h.value)}"/>`).join('\n');
  let bodyProp = '';
  if (d.requestBody != null) {
    if (d.requestBodyIsBinary) {
      bodyProp = `        <!-- 请求体为二进制(base64),JMeter 不直接支持,请手动解码 -->\n        <stringProp name="Body.data">${esc(d.requestBody)}</stringProp>`;
    } else {
      bodyProp = `        <stringProp name="Body.data">${esc(d.requestBody)}</stringProp>`;
    }
  }
  const method = esc(d.method || 'GET');
  return `      <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${method} ${esc(d.url)}" enabled="true">
        <stringProp name="HTTPSampler.method">${method}</stringProp>
        <stringProp name="HTTPSampler.path">${esc(d.url)}</stringProp>
${bodyProp}
      </HTTPSamplerProxy>
      <hashTree>
${headers || '        <!-- no headers -->'}
      </hashTree>`;
}

export function exportJmeter(details) {
  const samplers = (details || []).map(sampler).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="API Catcher Export" enabled="true"/>
    <hashTree>
${samplers}
    </hashTree>
  </hashTree>
</jmeterTestPlan>`;
}
```

- [ ] **Step 4: 在 index.js 加 jmeter 分支(补全四格式)**

```js
import { exportJmeter } from './jmeter.js';
// switch 内:
//   case 'jmeter': return exportJmeter(details);
```

- [ ] **Step 5: 运行全量单测确认通过**

Run: `npx vitest run`
Expected: PASS(全部)

- [ ] **Step 6: Commit**

```bash
git add src/logic/exporters/jmeter.js src/logic/exporters/index.js test/exporters.test.js
git commit -m "feat(logic): JMeter .jmx 导出器(二进制 body 注释标注)"
```

---

## Task 11: `manage.js` — 勾选列 + 批量操作条 + 导出下载

**Files:**
- Modify: `src/manage/manage.js`、`src/manage/manage.html`、`src/manage/icons.js`(UI DOM 在 Task 14 统一落地,本任务先写 JS 逻辑与占位钩子,Task 14 接线)
- Verify: Task 15 集成验证

> 前端 UI 无纯函数单测;JS 逻辑由集成测试覆盖。本任务先把 `state.selected`、勾选/全选、导出函数写好,DOM 事件在 Task 14 接线。若 `manage.html` 尚无对应元素,事件绑定用可选链容错(`if (el) el.addEventListener`)。

- [ ] **Step 1: 扩 state + 工具**

`manage.js` 顶部 state 改为:

```js
const state = { all: [], filtered: [], page: 1, pageSize: 10, currentDetail: null, selected: new Set(), newCount: 0, pendingIds: new Set(), refreshTimer: null };
```

文件顶部加 import:

```js
import { exportAs } from '../logic/exporters/index.js';
```

- [ ] **Step 2: renderTable 加 checkbox 列 + cURL 按钮(替换现有 `<tr>...<td>...eye` 模板)**

```js
  tbody.innerHTML = slice.map((r) => `
    <tr class="table-row-hover border-b border-surface-50" data-id="${r.id}">
      <td class="px-4 py-4"><input type="checkbox" class="row-check w-4 h-4 accent-brand-500" data-id="${r.id}" ${state.selected.has(r.id) ? 'checked' : ''}></td>
      <td class="px-5 py-4"><span class="method-badge method-${r.method}">${r.method}</span></td>
      <td class="px-4 py-4"><div class="text-[13px] text-surface-500 font-mono truncate max-w-[320px]" title="${escapeHtml(r.url)}">${escapeHtml(r.url)}</div></td>
      <td class="px-4 py-4"><span class="status-badge status-${statusClass(r.status)}"><span class="w-1.5 h-1.5 rounded-full inline-block" style="background:currentColor"></span>${r.status}</span></td>
      <td class="px-4 py-4"><div class="time-indicator"><span class="time-dot time-${timeClass(r.duration)}"></span><span class="text-[13px] text-surface-600 font-mono">${r.duration || 0}ms</span></div></td>
      <td class="px-4 py-4"><span class="text-[12px] text-surface-400">${formatTime(r.timestamp)}</span></td>
      <td class="px-5 py-4 text-right whitespace-nowrap">
        <button class="curl-open w-8 h-8 inline-flex items-center justify-center rounded-lg text-surface-400 hover:text-brand-500 hover:bg-brand-50 transition-all" data-id="${r.id}" title="复制 cURL">${ICONS.copy}</button>
        <button class="detail-open w-8 h-8 inline-flex items-center justify-center rounded-lg text-surface-400 hover:text-brand-500 hover:bg-brand-50 transition-all" data-id="${r.id}" title="详情">${ICONS.eye}</button>
      </td>
    </tr>`).join('');
```

- [ ] **Step 3: 勾选 + 全选 + 批量操作条同步逻辑**

```js
function syncSelectionBar() {
  const bar = $('selectionBar');
  const countEl = $('selectedCount');
  if (!bar) return;
  const n = state.selected.size;
  bar.classList.toggle('hidden', n === 0);
  if (countEl) countEl.textContent = `${n} 条`;
}

function toggleSelect(id, checked) {
  if (checked) state.selected.add(id); else state.selected.delete(id);
  syncSelectionBar();
}
function selectAllFiltered(checked) {
  if (checked) state.filtered.forEach((r) => state.selected.add(r.id));
  else state.filtered.forEach((r) => state.selected.delete(r.id));
  renderTable();
  syncSelectionBar();
}
```

事件委托(加到现有事件绑定区;`tableBody` 已有 click 委托,这里补 change 委托 + 全选):

```js
$('tableBody').addEventListener('change', (e) => {
  const cb = e.target.closest('.row-check');
  if (!cb) return;
  toggleSelect(cb.dataset.id, cb.checked);
});
const selectAllCb = $('selectAll');
if (selectAllCb) selectAllCb.addEventListener('change', (e) => selectAllFiltered(e.target.checked));
$('clearSelectionBtn').addEventListener('click', () => { state.selected.clear(); renderTable(); syncSelectionBar(); });
```

- [ ] **Step 4: 导出下载函数**

```js
function extOf(format) {
  return { postman: 'json', jmeter: 'jmx', har: 'har', json: 'json' }[format] || 'txt';
}

async function doExport(format) {
  const ids = state.selected.size ? [...state.selected] : state.filtered.map((r) => r.id);
  if (!ids.length) { toast('没有可导出的请求', 'error'); return; }
  const res = await send({ type: 'GET_DETAILS_BY_IDS', ids });
  const details = res?.details || [];
  if (!details.length) { toast('读取详情失败', 'error'); return; }
  const text = exportAs(format, details);
  const blob = new Blob([text], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `api-catcher-${format}-${Date.now()}.${extOf(format)}`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`已导出 ${details.length} 条(${format})`);
}
```

事件绑定(Task 14 的批量操作条按钮 id 为 `exportPostman/exportJmeter/exportHar/exportJson`):

```js
$('exportPostman').addEventListener('click', () => doExport('postman'));
$('exportJmeter').addEventListener('click', () => doExport('jmeter'));
$('exportHar').addEventListener('click', () => doExport('har'));
$('exportJson').addEventListener('click', () => doExport('json'));
```

- [ ] **Step 5: Commit(逻辑先落地,DOM 接线在 Task 14)**

```bash
git add src/manage/manage.js
git commit -m "feat(manage): 勾选列/全选/跨页选择 + 批量导出(4 格式下载)"
```

---

## Task 12: `manage.js` — 行内 cURL + Modal curl tab + 敏感头提示

**Files:**
- Modify: `src/manage/manage.js`
- Verify: Task 15 集成验证

- [ ] **Step 1: 加 import 与 cURL 复制逻辑**

```js
import { toCurl, hasSensitive } from '../logic/curl.js';
```

行内 cURL 按钮 click 委托(补到 `tableBody` 的 click 监听里,与 `.detail-open` 并列):

```js
$('tableBody').addEventListener('click', (e) => {
  const curl = e.target.closest('.curl-open');
  if (curl) { copyCurlForId(curl.dataset.id); return; }
  const d = e.target.closest('.detail-open');
  if (d) { openDetail(d.dataset.id); return; }
});
```

> 注意:Task 11 Step 3 已有一个 `tableBody` click 监听(checkbox 走 change)。把 `.detail-open` 的旧监听与本 step 合并为单一 click 监听(移除 `manage.js` 原来的 `$('.detail-open')` 独立监听),避免重复。

- [ ] **Step 2: copyCurlForId(含敏感头「总是提示」)**

```js
async function copyCurlForId(id) {
  const res = await send({ type: 'GET_DETAIL', id });
  const r = res?.record;
  if (!r) { toast('详情读取失败', 'error'); return; }
  await copyCurlDetail(r);
}

async function copyCurlDetail(detail) {
  const redacted = toCurl(detail, { includeSensitive: false });
  if (!hasSensitive(detail)) {
    await writeClip(redacted);
    toast('已复制 cURL');
    return;
  }
  const ok = confirm('此请求含 Cookie/Authorization 等敏感头,复制完整 cURL 可能泄露凭据。\n\n[确定]=复制完整版  [取消]=复制脱敏版(不含敏感头)');
  if (ok) {
    await writeClip(toCurl(detail, { includeSensitive: true }));
    toast('已复制完整 cURL(含敏感头)');
  } else {
    await writeClip(redacted);
    toast('已复制脱敏 cURL');
  }
}

async function writeClip(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { /* 聚焦失败等;降级:见 spec,可加 textarea 兜底,本期 toast 提示 */ toast('剪贴板写入失败,请重试', 'error'); }
}
```

> 用原生 `confirm`(同步)做最小可用提示;若要更美观可在后续替换为自定义弹窗。MV3 扩展页 `confirm` 可用。

- [ ] **Step 3: Modal curl tab 渲染**

`switchTab` 的 tab 列表加入 `'curl'`:

```js
function switchTab(tab) {
  ['headers', 'request', 'response', 'curl'].forEach((t) => {
    const btn = document.querySelector(`.detail-tab[data-tab="${t}"]`);
    const content = $(`content-${t}`);
    if (!btn || !content) return;
    if (t === tab) { btn.className = 'detail-tab tab-active'; content.classList.remove('hidden'); }
    else { btn.className = 'detail-tab tab-inactive'; content.classList.add('hidden'); }
  });
}
```

`openDetail` 末尾(curl tab 默认展示脱敏版 + 复制按钮):

```js
  const detail = r;
  $('content-curl').innerHTML = `<div class="bg-white rounded-[12px] p-5 card-shadow">
    <div class="flex justify-between items-center mb-3">
      <span class="text-[12px] text-surface-400">cURL(默认隐藏敏感头)</span>
      <button class="modal-copy-curl px-3 py-1 text-[12px] rounded-lg bg-brand-50 text-brand-500 hover:bg-brand-100">${ICONS.copy} 复制</button>
    </div>
    <pre class="code-block">${escapeHtml(toCurl(detail, { includeSensitive: false }))}</pre>
  </div>`;
```

Modal 内复制按钮事件(在 `openDetail` 之后绑定一次,或用委托):

```js
$('detailModal').addEventListener('click', (e) => {
  if (e.target.closest('.modal-copy-curl') && state.currentDetail) copyCurlDetail(state.currentDetail);
});
```

> `openDetail` 已设 `state.currentDetail = r`。`state.currentDetail` 需含 `requestHeaders` 等(curl 依赖);`getRequestDetail` 返回的 record 已含这些字段。

- [ ] **Step 4: Commit**

```bash
git add src/manage/manage.js
git commit -m "feat(manage): 行内 cURL 复制 + 详情 Modal curl tab + 敏感头复制提示"
```

---

## Task 13: `manage.js` — 实时刷新 listener + 智能暂停 + 提示条

**Files:**
- Modify: `src/manage/manage.js`
- Verify: Task 15 集成验证

- [ ] **Step 1: isLiveView 判定**

```js
function isLiveView() {
  const hasFilter = $('searchInput').value.trim() || $('methodFilter').value || $('statusFilter').value
    || $('timeFilter').value || $('responseTimeFilter').value;
  return state.page === 1 && !hasFilter;
}
```

- [ ] **Step 2: debounce 合并 listener**

```js
const REFRESH_DEBOUNCE_MS = 250;
const ALL_MAX = 5000;

function scheduleRefresh() {
  if (state.refreshTimer) return;
  state.refreshTimer = setTimeout(() => { state.refreshTimer = null; flushPending(); }, REFRESH_DEBOUNCE_MS);
}

async function flushPending() {
  if (state.pendingIds.size === 0) return;
  const ids = [...state.pendingIds];
  state.pendingIds.clear();
  const res = await send({ type: 'GET_DETAILS_BY_IDS', ids });
  const details = res?.details || [];
  const byId = new Map(details.map((d) => [d.id, d]));
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) continue;
    const idx = state.all.findIndex((r) => r.id === id);
    if (idx >= 0) state.all[idx] = { ...state.all[idx], ...stripDetail(d) }; // UPDATED:只合并元数据
    else { state.all.unshift(stripDetail(d)); if (state.all.length > ALL_MAX) state.all.pop(); } // NEW
  }
  state.all.sort((a, b) => b.timestamp - a.timestamp);
  if (isLiveView()) { renderStats(); applyFilters(); }
  else { state.newCount += details.length; showNewBadge(); renderStats(); }
}

// 列表行只需要元数据;detail 的 body 字段不必留在 state.all(省内存)
function stripDetail(d) {
  const { requestBody, responseBody, requestBodyIsBinary, responseBodyIsBinary, ...meta } = d;
  return meta;
}
```

> 注:`applyFilters()` 内会 `state.page = 1; render()`。实时追加在 live view 下调 `applyFilters` 会重算 filtered + 渲染当前页,新条挤入顶部。可接受。

- [ ] **Step 3: 提示条**

```js
function showNewBadge() {
  const badge = $('newBadge');
  if (!badge) return;
  badge.classList.remove('hidden');
  const label = $('newBadgeCount');
  if (label) label.textContent = state.newCount;
}
function hideNewBadge() { state.newCount = 0; const b = $('newBadge'); if (b) b.classList.add('hidden'); }

// 接线(Task 14 的提示条 id 为 newBadge/newBadgeCount/newBadgeView)
const nbv = $('newBadgeView');
if (nbv) nbv.addEventListener('click', async () => { hideNewBadge(); state.page = 1; await loadAll(); });
```

- [ ] **Step 4: 注册 onMessage 监听**

```js
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'NEW_REQUEST' || msg.type === 'REQUEST_UPDATED') {
    if (msg.id) { state.pendingIds.add(msg.id); scheduleRefresh(); }
  }
});
```

- [ ] **Step 5: Commit**

```bash
git add src/manage/manage.js
git commit -m "feat(manage): 实时刷新(SW 广播 + debounce + 智能暂停 + 新请求提示条)"
```

---

## Task 14: UI — `manage.html` / `manage.css` / `icons.js` + 编译 CSS

**Files:**
- Modify: `src/manage/manage.html`、`src/manage/manage.css`、`src/manage/icons.js`
- Run: `npm run build:css`

- [ ] **Step 1: `icons.js` 加 copy / checkbox 相关 SVG**

```js
// 在 ICONS 对象内追加
  copy: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
```

(`checkbox` 用原生 `<input type="checkbox">`,无需 SVG。`selectAll` 同理。)

- [ ] **Step 2: `manage.html` 表头加全选 checkbox 列**

在表格 `<thead><tr>` 最前加一列;`<tbody>` 由 JS 渲染(Task 11 已含首列)。例:

```html
<thead><tr>
  <th class="px-4 py-3"><input type="checkbox" id="selectAll" class="w-4 h-4 accent-brand-500"></th>
  <th class="px-5 py-3 text-left text-[12px] font-semibold text-surface-400 uppercase">方法</th>
  <!-- 其余列保持不变 -->
</tr></thead>
```

- [ ] **Step 3: 批量操作条(sticky 底部)+ 新请求提示条(sticky 顶部)**

在 `<body>` 内合适位置(表格容器外)加:

```html
<!-- 新请求提示条(实时刷新,默认 hidden) -->
<div id="newBadge" class="hidden sticky top-0 z-20 bg-brand-500 text-white text-[13px] px-5 py-2.5 flex items-center justify-between">
  <span>● 录制中 · 有 <span id="newBadgeCount">0</span> 条新请求</span>
  <button id="newBadgeView" class="underline">查看</button>
</div>

<!-- 批量操作条(选中后浮出) -->
<div id="selectionBar" class="hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-30 bg-surface-700 text-white rounded-[12px] shadow-lg px-5 py-3 flex items-center gap-4">
  <span class="text-[13px]">已选 <span id="selectedCount">0</span> 条</span>
  <div class="flex gap-2">
    <button id="exportPostman" class="px-3 py-1.5 text-[12px] rounded-lg bg-white/10 hover:bg-white/20">Postman</button>
    <button id="exportJmeter" class="px-3 py-1.5 text-[12px] rounded-lg bg-white/10 hover:bg-white/20">JMeter</button>
    <button id="exportHar" class="px-3 py-1.5 text-[12px] rounded-lg bg-white/10 hover:bg-white/20">HAR</button>
    <button id="exportJson" class="px-3 py-1.5 text-[12px] rounded-lg bg-white/10 hover:bg-white/20">JSON</button>
  </div>
  <button id="clearSelectionBtn" class="px-3 py-1.5 text-[12px] rounded-lg bg-white/10 hover:bg-white/20">清除选择</button>
</div>
```

- [ ] **Step 4: 详情 Modal 加 curl tab**

在现有 `.detail-tab` 按钮组(headers/request/response)后加:

```html
<button class="detail-tab tab-inactive" data-tab="curl">cURL</button>
```

并在 Modal 内容区加对应容器(`<pre>` 由 JS 填充):

```html
<div id="content-curl" class="hidden"></div>
```

- [ ] **Step 5: 重跑 Tailwind 编译**

Run: `npm run build:css`
Expected: `src/manage/tailwind.css` 更新,无报错。

- [ ] **Step 6: 手动加载扩展自检**

在 Chrome `chrome://extensions` 加载 `D:\java_study\创业\chrome-api-catcher`,打开管理页,确认:
- 首列 checkbox + 表头全选出现;
- 批量操作条默认隐藏(无选中);
- 详情 Modal 出现 cURL tab;
- 控制台无 CSP 报错。

- [ ] **Step 7: Commit**

```bash
git add src/manage/manage.html src/manage/manage.css src/manage/icons.js src/manage/tailwind.css
git commit -m "feat(manage): 勾选列/批量操作条/新请求提示条/Modal curl tab UI + 重编译 CSS"
```

---

## Task 15: 集成验证 + 手动验证清单

**Files:**
- Create: `test/integration/phase3-verify.mjs`
- Reference: `test/integration/phase2-verify.mjs`(复用其 playwright headed + 轮询等 SW 基建)

- [ ] **Step 1: 写集成脚本(基于 phase2-verify.mjs 的扩展启动/轮询封装)**

核心断言点(复用 phase2 的 `loadExtension(context)` 与 `waitForServiceWorker(context)` 等价轮询):

```js
// test/integration/phase3-verify.mjs(节选关键断言,完整脚本参考 phase2-verify.mjs 的启动/重载/轮询结构)
import { chromium } from 'playwright';

const EXT_PATH = 'D:\\java_study\\创业\\chrome-api-catcher';
const TEST_PAGE = `file:///D:/java_study/创业/chrome-api-catcher/test/manual/test-page.html`;

// 1. 启动扩展 + 等待 service worker(轮询 200ms,15s 超时)
// 2. 打开管理页 manage.html
// 3. 开启录制(全局)
// 4. 打开测试页,触发若干 fetch/xhr
// 5. 断言:管理页表格行数增加(实时刷新)
// 6. 翻到第 2 页 → 触发新请求 → 断言列表不跳 + 提示条 #newBadge 可见
// 7. 勾选若干行 → 断言 #selectionBar 可见 + selectedCount>0
//    → 点击各导出按钮 → 断言下载触发(page.on('download'))
//    → JSON.parse 下载内容校验
// 8. 点行内 cURL 按钮 → 断言剪贴板(需授予权限)含 'curl'
// 9. 触发含 Cookie 的请求 → 断言 confirm 对话框出现(page.on('dialog'))
// 10. 触发 FormData 上传 → GET_DETAIL → 断言 requestBodyIsBinary===true 且 requestBody 为 base64
```

> 完整脚本:拷贝 phase2-verify.mjs 的 `launchChromeWithExtension`/`waitForBg`/`openManage` 等辅助,替换断言区为上述 1–10。playwright 装时带 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`,版本锁 `playwright@1.60.0`(chromium-1223)。

- [ ] **Step 2: 运行集成脚本(headed)**

Run: `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 node test/integration/phase3-verify.mjs`
Expected: 所有断言通过(若有剪贴板/下载权限问题,headed 模式下手动观察并记录)。

- [ ] **Step 3: 全量单测最终回归**

Run: `npx vitest run`
Expected: PASS(全部)

- [ ] **Step 4: 写手动验证清单(真实 Chrome,集成脚本难覆盖项)**

在 spec §6.3 基础上,确认以下并记录到提交说明:
- service worker 空闲被杀重启后(`chrome://extensions` 手动 Stop/Start),旧请求不重复、新请求正常去重(SW 重启 bug 回归)。
- 敏感头 `confirm` 弹窗三态(完整/脱敏/取消)。
- 批量操作条 sticky 视觉与隐藏/浮出。
- 二进制请求(FormData 文件上传)cURL 含进程替换写法、HAR 含 `encoding:base64`。
- 控制台全程无 CSP 报错。

- [ ] **Step 5: Commit**

```bash
git add test/integration/phase3-verify.mjs
git commit -m "test: Phase 3 集成验证(实时刷新/导出/cURL/去重/二进制捕获)"
```

---

## 完成标准

- [ ] `npx vitest run` 全绿(含新增 base64/curl/exporters/db 测试)。
- [ ] `phase3-verify.mjs` 集成核心断言通过(实时刷新、导出、cURL、去重、二进制)。
- [ ] 真实 Chrome 手动验证清单(spec §6.3 + Task 15 Step 4)逐项确认,控制台无 CSP 报错。
- [ ] M8/M9/M10 三个债务在 spec 中对应章节可勾销。
