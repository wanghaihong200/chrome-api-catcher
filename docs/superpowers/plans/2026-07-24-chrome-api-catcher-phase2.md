# Chrome API Catcher · Phase 2 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付独立管理页(照参考文件表格+Modal)+ popup 全局/标签页录制开关,并清理 Phase 1 的 URL 规范化等债务。

**Architecture:** 方案 A——管理页前端持有全部请求元数据,搜索/筛选/分页/统计全在前端做,大 body 懒加载。录制状态以 `chrome.storage.local` 为唯一真相源,background 启动加载到内存并监听 `onChanged` 同步。纯逻辑(`recording`/`normalize`/`dedupe`/`db`)无 DOM 依赖、vitest 单测;UI 用 Tailwind CLI 预编译本地化以符合 MV3 CSP。

**Tech Stack:** Chrome MV3、原生 JS(ES module)、IndexedDB、vitest + fake-indexeddb、Tailwind CSS v3(CLI 预编译)、playwright(集成验证)。

**对应 Spec:** `docs/superpowers/specs/2026-07-24-chrome-api-catcher-phase2-design.md`

**参考 UI 蓝本:** `D:\java_study\创业\接口抓取数据展示.html`(管理页视觉 1:1 来源)

---

## 文件结构总览

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/logic/recording.js` | 新建 | 纯函数 `shouldRecord(state, tabId)` + 默认状态 |
| `test/recording.test.js` | 新建 | recording 单测 |
| `src/logic/normalize.js` | 修改 | 加 `normalizeUrl`;两条 normalize 路径用之;补断言(M2) |
| `test/normalize.test.js` | 修改 | 补 `normalizeUrl` 与字段断言 |
| `src/background/db.js` | 修改 | 加 `getRequestDetail`(合并 body,M7)、`updateRequest`(回写,M6) |
| `test/db.test.js` | 修改 | 补两函数单测 |
| `src/background/background.js` | 修改 | 录制状态 storage 同步、`shouldRecord` 接入、消息扩容、ingest 去重合并、tab 清理 |
| `src/inject/inject.js` | 修改 | XHR 相对 URL 绝对化(债务根源) |
| `tailwind.config.js` | 新建 | Tailwind 配置(brand/surface 语义色、content 扫描) |
| `src/manage/tailwind-input.css` | 新建 | `@tailwind` 指令入口 |
| `src/manage/tailwind.css` | 新建(构建产物) | 本地化 Tailwind |
| `src/manage/icons.js` | 新建 | SVG 图标集(替代 Font Awesome) |
| `src/manage/manage.css` | 新建 | 自定义样式(badge/toggle/分页/code-block,源自参考 `<style>`) |
| `src/manage/manage.html` | 新建 | 管理页结构(照参考裁剪) |
| `src/manage/manage.js` | 新建 | 数据绑定/搜索/筛选/分页/统计/Modal |
| `src/popup/popup.html` / `popup.js` / `popup.css` | 新建 | popup 界面 |
| `src/devtools/panel.js` / `panel.html` | 修改 | 开关改为「本审查标签页开关」 |
| `manifest.json` | 修改 | `action.default_popup` |
| `test/integration/phase2-verify.mjs` | 新建 | playwright 集成验证脚本 |

## 依赖与并行说明

- **Task 1 / 2 / 3 互相独立**(纯逻辑,不同文件),可并行执行。
- **Task 4(background)** 依赖 1/2/3 的产物。
- **Task 5(inject)**、**Task 6(Tailwind 基建)** 独立。
- **Task 7** 依赖 6;**Task 8** 依赖 4+7;**Task 9/10** 依赖 4;**Task 11** 最后。

---

## Task 1: 录制开关纯逻辑 `recording.js`

**Files:**
- Create: `src/logic/recording.js`
- Test: `test/recording.test.js`

- [ ] **Step 1: 写失败测试**

`test/recording.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { shouldRecord, DEFAULT_RECORDING_STATE } from '../src/logic/recording.js';

describe('shouldRecord', () => {
  it('默认状态(global off)不录制', () => {
    expect(shouldRecord(DEFAULT_RECORDING_STATE, 1)).toBe(false);
  });
  it('global on 但 tab 未设 → 不录制(标签页默认 OFF)', () => {
    expect(shouldRecord({ global: true, tabs: {} }, 1)).toBe(false);
  });
  it('global on 且 tab on → 录制', () => {
    expect(shouldRecord({ global: true, tabs: { 1: true } }, 1)).toBe(true);
  });
  it('global on 但 tab 显式 off → 不录制', () => {
    expect(shouldRecord({ global: true, tabs: { 1: false } }, 1)).toBe(false);
  });
  it('tab on 但 global off → 不录制', () => {
    expect(shouldRecord({ global: false, tabs: { 1: true } }, 1)).toBe(false);
  });
  it('state 缺失 → 不录制', () => {
    expect(shouldRecord(null, 1)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/recording.test.js`
Expected: FAIL(`shouldRecord is not a function` / 模块不存在)

- [ ] **Step 3: 写最小实现**

`src/logic/recording.js`:
```js
// 录制开关判定纯函数。
// state 形态: { global: boolean, tabs: { [tabId]: boolean } }
// 语义: global===true 且 tabs[tabId]===true 才录制;两者默认 OFF(tabs 未设 = false)。

export const DEFAULT_RECORDING_STATE = Object.freeze({ global: false, tabs: {} });

export function shouldRecord(state, tabId) {
  if (!state) return false;
  return state.global === true && state.tabs?.[tabId] === true;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/recording.test.js`
Expected: PASS(6/6)

- [ ] **Step 5: 提交**

```bash
git add src/logic/recording.js test/recording.test.js
git commit -m "feat(logic): 录制开关判定纯函数 shouldRecord(global AND per-tab, 默认 OFF)"
```

---

## Task 2: URL 规范化 `normalizeUrl` + normalize 增强(M2)

**Files:**
- Modify: `src/logic/normalize.js`
- Test: `test/normalize.test.js`

- [ ] **Step 1: 写失败测试(追加到 `test/normalize.test.js` 末尾)**

```js
import { normalizeUrl } from '../src/logic/normalize.js';

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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/normalize.test.js`
Expected: FAIL(`normalizeUrl is not a function`)

- [ ] **Step 3: 改 `src/logic/normalize.js`**

在文件顶部(`toHeaders` 之前)加 `normalizeUrl`:
```js
/** 把 url 规范化为绝对;base 缺失/非法时尽量解析,失败原样返回 */
export function normalizeUrl(url, base) {
  if (!url) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}
```

把 `normalizeInjectRecord` 里的 `url: raw.request.url,` 改为:
```js
      url: normalizeUrl(raw.request.url, ctx.tabUrl),
```

把 `normalizeDevtoolsRecord` 里的 `url: req.url,` 改为:
```js
      url: normalizeUrl(req.url),
```

> 说明:inject 路径在源头(inject.js,Task 5)已用页面真实 `location.href` 绝对化,这里的 `ctx.tabUrl` 仅作兜底;devtools 的 HAR url 本就绝对,经 `normalizeUrl` 统一规范化(利于去重 key 一致)。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/normalize.test.js`
Expected: PASS(原有 + 新增全绿)

- [ ] **Step 5: 提交**

```bash
git add src/logic/normalize.js test/normalize.test.js
git commit -m "fix(normalize): normalizeUrl 相对→绝对兜底,补 devtools 字段断言(M2)"
```

---

## Task 3: db.js `getRequestDetail`(M7) + `updateRequest`(M6)

**Files:**
- Modify: `src/background/db.js`
- Test: `test/db.test.js`

- [ ] **Step 1: 写失败测试(追加到 `test/db.test.js` 的 `describe('db', ...)` 内)**

```js
  it('getRequestDetail 合并内联 body', async () => {
    const id = await putRequest(db, makeEntry());
    const detail = await getRequestDetail(db, id);
    expect(detail.responseBody).toBe('{"ok":1}');
    expect(detail.requestBody).toBe(null);
  });

  it('getRequestDetail 从 bodies 表懒加载大 body(M7)', async () => {
    const big = 'x'.repeat(70 * 1024);
    const id = await putRequest(db, makeEntry({ respBody: big, respSize: big.length }));
    const detail = await getRequestDetail(db, id);
    expect(detail.responseBody.length).toBe(big.length);
  });

  it('updateRequest 回写更完整响应(M6)', async () => {
    const id = await putRequest(db, makeEntry({ respBody: '{}', respSize: 2 }));
    const before = await getRequest(db, id);
    expect(before.responseBodySize).toBe(2);
    const newer = makeEntry({ respBody: '{"full":true}', respSize: 12 });
    const ok = await updateRequest(db, id, newer);
    expect(ok).toBe(true);
    const after = await getRequest(db, id);
    expect(after.responseBodySize).toBe(12);
    expect(after.responseBodyInline).toBe('{"full":true}');
    expect(after.id).toBe(id); // 同 id 覆盖,非新增
  });

  it('updateRequest 不存在的 id 返回 false', async () => {
    const ok = await updateRequest(db, 'nope', makeEntry());
    expect(ok).toBe(false);
  });
```

> 注:`makeEntry` 已在文件顶部定义;`getRequestDetail` 与 `updateRequest` 需在 import 中加入。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/db.test.js`
Expected: FAIL(`getRequestDetail is not defined` / import 报错)

- [ ] **Step 3: 改 `test/db.test.js` 顶部 import,加入新函数**

把第 3 行:
```js
import { openDB, putRequest, getRequest, getBody, listRequests } from '../src/background/db.js';
```
改为:
```js
import { openDB, putRequest, getRequest, getRequestDetail, updateRequest, getBody, listRequests } from '../src/background/db.js';
```

- [ ] **Step 4: 在 `src/background/db.js` 实现两函数**

在 `getRequest` 之后追加:
```js
/** 读取单条并合并 body(内联优先,否则从 bodies 表懒加载)。用于详情。 */
export async function getRequestDetail(db, id) {
  const record = await req2promise(tx(db, 'requests', 'readonly').get(id));
  if (!record) return null;
  const resolveBody = async (inline, key) => {
    if (inline != null) return inline;
    if (key) return getBody(db, key);
    return null;
  };
  const requestBody = await resolveBody(record.requestBodyInline, record.requestBodyKey);
  const responseBody = await resolveBody(record.responseBodyInline, record.responseBodyKey);
  return { ...record, requestBody, responseBody };
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- test/db.test.js`
Expected: PASS(原有 4 + 新增 4 = 8)

- [ ] **Step 6: 提交**

```bash
git add src/background/db.js test/db.test.js
git commit -m "feat(db): getRequestDetail 合并 body(M7)、updateRequest 去重回写(M6)"
```

---

## Task 4: background.js 改造(录制状态 + 消息扩容 + 去重合并)

**Files:**
- Modify: `src/background/background.js`

> 依赖:Task 1(`shouldRecord`)、Task 2(`normalizeUrl`,已通过 normalize 接入)、Task 3(`getRequestDetail`/`updateRequest`)。
> background 无法在 vitest(node 环境)里单测(依赖 `chrome.*` 全局),本任务以「编译可加载 + 浏览器集成验证(Task 11)」为保证。改动尽量保持纯函数化,核心判定 `shouldRecord` 已在 Task 1 单测覆盖。

- [ ] **Step 1: 用以下完整内容替换 `src/background/background.js`**

```js
import { openDB, putRequest, getRequestDetail, getRequest, listRequests, updateRequest } from './db.js';
import { shouldKeep } from '../logic/filter.js';
import { makeKey, findDuplicate, pickMoreComplete } from './dedupe.js';
import { normalizeInjectRecord, normalizeDevtoolsRecord } from '../logic/normalize.js';
import { shouldRecord, DEFAULT_RECORDING_STATE } from '../logic/recording.js';

const STORAGE_KEY = 'recording';
const RECENT_MAX = 200;
const ALL_PAGE_SIZE = 5000; // GET_ALL 一次返回上限(方案 A 前端持数据)

const state = {
  recording: { ...DEFAULT_RECORDING_STATE, tabs: {} }, // 内存镜像,storage 为真相源
  recent: [], // [{key, timestamp, id}]
  dbPromise: null,
};

function db() {
  if (!state.dbPromise) state.dbPromise = openDB();
  return state.dbPromise;
}

// ---- 录制状态:启动加载 + storage.onChanged 同步 ----
async function loadRecording() {
  try {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    const r = got[STORAGE_KEY];
    if (r && typeof r === 'object') {
      state.recording = { global: !!r.global, tabs: r.tabs || {} };
    }
  } catch { /* 读取失败保持默认 */ }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  const r = changes[STORAGE_KEY].newValue;
  if (r && typeof r === 'object') {
    state.recording = { global: !!r.global, tabs: r.tabs || {} };
  }
});

async function persistRecording() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: state.recording });
  } catch { /* 忽略 */ }
}

function pushRecent(entry, id) {
  state.recent.unshift({ key: makeKey(entry), timestamp: entry.timestamp, id });
  if (state.recent.length > RECENT_MAX) state.recent.length = RECENT_MAX;
}

async function ingest(entry) {
  if (!shouldRecord(state.recording, entry.tabId)) return; // 开关未开则丢弃
  if (!shouldKeep({ url: entry.request.url, resourceType: entry.response.resourceType, responseMimeType: entry.response.mimeType })) {
    return;
  }
  const dup = findDuplicate(entry, state.recent);
  if (dup) {
    // 去重命中:若新条响应更完整则回写(M6);否则先到先得
    try {
      const existing = await getRequest(await db(), dup.id);
      if (existing) {
        const winner = pickMoreComplete(
          { response: { body: { size: entry.response.body.size } } },
          { response: { body: { size: existing.responseBodySize } } },
        );
        const entrySize = entry.response.body.size;
        // pickMoreComplete 返回 size 更大者(相等返回第一个参数);仅在「新条严格更大」时回写
        const newIsStrictlyBetter = winner.response.body.size === entrySize && entrySize > existing.responseBodySize;
        if (newIsStrictlyBetter) await updateRequest(await db(), dup.id, entry);
      }
    } catch { /* 回写失败不影响主流程 */ }
    return;
  }
  const id = await putRequest(await db(), entry);
  pushRecent(entry, id);
}

function getTabContext(tabId) {
  return (async () => {
    try {
      const tab = await chrome.tabs.get(tabId);
      return { tabId, tabUrl: tab.url || '' };
    } catch {
      return { tabId, tabUrl: '' };
    }
  })();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'RECORD_INJECT': {
          const ctx = await getTabContext(sender.tab?.id ?? -1);
          await ingest(normalizeInjectRecord(msg.raw, ctx));
          sendResponse({ ok: true });
          break;
        }
        case 'RECORD_DEVTOOLS': {
          const ctx = { tabId: msg.tabId, tabUrl: msg.tabUrl || '' };
          await ingest(normalizeDevtoolsRecord(msg.har, msg.responseBody, ctx));
          sendResponse({ ok: true });
          break;
        }
        case 'SET_GLOBAL': {
          state.recording.global = !!msg.value;
          await persistRecording();
          sendResponse({ ok: true, recording: state.recording });
          break;
        }
        case 'SET_TAB': {
          if (msg.tabId != null) {
            state.recording.tabs[msg.tabId] = !!msg.value;
            await persistRecording();
          }
          sendResponse({ ok: true, recording: state.recording });
          break;
        }
        case 'GET_RECORDING_STATE': {
          const tabId = msg.tabId;
          sendResponse({
            global: state.recording.global,
            tabOn: tabId != null ? state.recording.tabs[tabId] === true : null,
            recording: tabId != null ? shouldRecord(state.recording, tabId) : state.recording.global,
          });
          break;
        }
        case 'GET_ALL': {
          const res = await listRequests(await db(), { page: 1, pageSize: ALL_PAGE_SIZE });
          sendResponse(res);
          break;
        }
        case 'GET_LIST': {
          const res = await listRequests(await db(), { page: msg.page || 1, pageSize: msg.pageSize || 10 });
          sendResponse(res);
          break;
        }
        case 'GET_DETAIL': {
          const record = await getRequestDetail(await db(), msg.id);
          sendResponse({ record });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // 异步响应
});

// tab 关闭清理 per-tab 开关
chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.recording.tabs[tabId] !== undefined) {
    delete state.recording.tabs[tabId];
    persistRecording();
  }
});

loadRecording();
```

- [ ] **Step 2: 静态自检——确认模块可解析**

Run(仅做语法检查,不需浏览器):
```bash
node --check src/background/background.js 2>&1 || echo "(chrome.* 全局未定义属正常,只看语法错)"
```
Expected: 无 `SyntaxError`(`chrome is not defined` 这类运行期引用错误可忽略,因 `--check` 不执行)。

- [ ] **Step 3: 跑全量单测确认未破坏纯逻辑层**

Run: `npm test`
Expected: 全绿(Phase 1 的 21 + Task 1/2/3 新增)。

- [ ] **Step 4: 提交**

```bash
git add src/background/background.js
git commit -m "feat(background): 录制状态 storage 同步 + shouldRecord 接入 + 消息扩容(SET_GLOBAL/SET_TAB/GET_RECORDING_STATE/GET_ALL/GET_DETAIL) + 去重合并(M6)"
```

---

## Task 5: inject.js XHR 相对 URL 绝对化(债务根源)

**Files:**
- Modify: `src/inject/inject.js`

> inject.js 运行在页面 MAIN world,无法 import 扩展模块,故内联一个与 `normalizeUrl` 等价的 `absUrl`(DRY 让位于隔离约束;该逻辑由 Task 2 的 `normalizeUrl` 单测代表)。fetch 路径已用 `new Request()` 天然绝对,无需改;仅改 XHR。

- [ ] **Step 1: 在 `src/inject/inject.js` 的 IIFE 内顶部(`const send = ...` 之后)加 `absUrl`**

```js
  // 相对 URL → 绝对(用页面真实 location,iframe 场景也准)。与 normalize.js 的 normalizeUrl 等价。
  function absUrl(url, base) {
    if (!url) return url;
    try { return new URL(url, base || location.href).href; } catch { return url; }
  }
```

- [ ] **Step 2: 改 XHR `open` hook 的 url 存储为绝对**

把:
```js
    this.__ac = { method: (method || 'GET').toUpperCase(), url: String(url), headers: {}, t0: performance.now() };
```
改为:
```js
    this.__ac = { method: (method || 'GET').toUpperCase(), url: absUrl(String(url)), headers: {}, t0: performance.now() };
```

- [ ] **Step 3: 静态自检**

Run: `node --check src/inject/inject.js`
Expected: 无 `SyntaxError`。

- [ ] **Step 4: 提交**

```bash
git add src/inject/inject.js
git commit -m "fix(inject): XHR 相对 URL 用 location.href 绝对化(与 devtools 路径统一,修去重错配)"
```

> 该修复的运行期验收在 Task 11(去重回归:同一接口被 inject 相对 + devtools 绝对双抓,只存一条)。

---

## Task 6: Tailwind 构建基建

**Files:**
- Create: `tailwind.config.js`
- Create: `src/manage/tailwind-input.css`
- Modify: `package.json`

- [ ] **Step 1: 创建 `tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/manage/**/*.{html,js}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', "'Noto Sans SC'", 'sans-serif'],
        mono: ['ui-monospace', "'JetBrains Mono'", 'Menlo', 'monospace'],
      },
      colors: {
        brand: { 50:'#f0f4ff',100:'#e0eaff',200:'#c2d5ff',300:'#94b5ff',400:'#5e8bff',500:'#3b6af5',600:'#2a52d8',700:'#2242b0',800:'#203991',900:'#1f3476' },
        surface: { 50:'#f8fafc',100:'#f1f5f9',200:'#e2e8f0',300:'#cbd5e1',400:'#94a3b8',500:'#64748b',600:'#475569',700:'#334155',800:'#1e293b',900:'#0f172a' },
        success: '#10b981', warning: '#f59e0b', danger: '#ef4444', info: '#0ea5e9',
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: 创建 `src/manage/tailwind-input.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 3: 改 `package.json` 的 `scripts` 与 `devDependencies`**

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build:css": "tailwindcss -i ./src/manage/tailwind-input.css -o ./src/manage/tailwind.css --minify"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "fake-indexeddb": "^6.0.0",
    "tailwindcss": "^3.4.0"
  }
```

- [ ] **Step 4: 安装依赖**

Run: `npm install`
Expected: 安装 `tailwindcss@3.4.x`,无报错。

- [ ] **Step 5: 构建 CSS 验证产物**

Run: `npm run build:css`
Expected: 生成 `src/manage/tailwind.css`,文件非空(含 `.bg-surface-50`、`.text-brand-500` 等用到的类)。

- [ ] **Step 6: 提交**

```bash
git add tailwind.config.js src/manage/tailwind-input.css src/manage/tailwind.css package.json package-lock.json
git commit -m "build: Tailwind 预编译基建(config/input/build:css + 本地化产物)"
```

---

## Task 7: 管理页静态 UI(icons.js + manage.css + manage.html)

**Files:**
- Create: `src/manage/icons.js`
- Create: `src/manage/manage.css`
- Create: `src/manage/manage.html`

- [ ] **Step 1: 创建 `src/manage/icons.js`(SVG 图标集,替代 Font Awesome)**

```js
// SVG 图标集,替代 Font Awesome。stroke 风格 24x24,currentColor,由 manage.js 注入。
const s = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="1em" height="1em">${inner}</svg>`;
export const ICONS = {
  logo: s('<rect x="2" y="9" width="6" height="6" rx="1"/><rect x="16" y="9" width="6" height="6" rx="1"/><path d="M8 12h8"/>'),
  search: s('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  refresh: s('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  eye: s('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  xmark: s('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevronDown: s('<path d="m6 9 6 6 6-6"/>'),
  plug: s('<path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0Z"/><path d="M12 16v6"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  warning: s('<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 17h.01"/>'),
  clock: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  check: s('<path d="m5 12 5 5 9-11"/>'),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4"/>'),
};
```

- [ ] **Step 2: 创建 `src/manage/manage.css`(从参考文件提取自定义类)**

打开参考蓝本 `D:\java_study\创业\接口抓取数据展示.html`,把其 `<style>` 块中以下类**原样复制**到 `src/manage/manage.css`:

`::-webkit-scrollbar*`、`.modal-backdrop`、`@keyframes toastIn/toastOut` 与 `.toast-in/.toast-out`、`@keyframes pulse-ring` 与 `.pulse-ring::before`、`.table-row-hover`、`.code-block` 及其 `.key/.string/.number/.boolean/.null`、`.tab-active/.tab-inactive`、`.status-badge` 与 `.status-2xx/.status-3xx/.status-4xx/.status-5xx`、`.method-badge` 与 `.method-GET/.method-POST/.method-PUT/.method-DELETE/.method-PATCH`、`.fade-in`、`.detail-tab`、`.tooltip`、`.filter-chip`、`.page-btn`、`.live-toggle`、`.time-indicator/.time-dot/.time-fast/.time-normal/.time-slow`、`.search-input:focus`、`.card-shadow/.card-shadow-hover`、`.json-tree` 及子类、`.table-header-sticky`、`@keyframes modalSlideIn/.modal-animate`、`@keyframes countUp/.stat-number`、`.empty-state`。

**不要复制**:`.copy-curl-btn`、`.curl-display` 及子类、`.export-dropdown`、`.export-format-btn`、`.bulk-bar`(属 Phase 3)。

- [ ] **Step 3: 创建 `src/manage/manage.html`(裁剪骨架,数据由 JS 渲染)**

已移除实时刷新 toggle / 批量导出 / 勾选列 / 行内 cURL / curl tab / 远程字体与图标;所有交互改为 id 钩子:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>API 接口看板 · API Catcher</title>
  <link rel="stylesheet" href="tailwind.css" />
  <link rel="stylesheet" href="manage.css" />
</head>
<body class="bg-surface-50 min-h-screen font-sans text-surface-800">
  <div id="toastContainer" class="fixed bottom-6 right-6 z-[100] flex flex-col gap-3"></div>

  <header class="bg-white border-b border-surface-200 sticky top-0 z-40">
    <div class="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <div id="logoIcon" class="w-9 h-9 bg-brand-500 rounded-[10px] flex items-center justify-center text-white"></div>
        <div>
          <h1 class="text-[17px] font-semibold tracking-tight">API 接口看板</h1>
          <p class="text-[11px] text-surface-400 -mt-0.5">接口抓取数据管理</p>
        </div>
      </div>
      <div class="flex items-center gap-5">
        <div class="flex items-center gap-3">
          <div class="relative">
            <div id="liveIndicator" class="w-2.5 h-2.5 bg-success rounded-full pulse-ring hidden"></div>
            <div id="liveDot" class="w-2.5 h-2.5 bg-surface-300 rounded-full"></div>
          </div>
          <span class="text-[13px] text-surface-500 font-medium">全局录制</span>
          <div id="globalToggle" class="live-toggle"></div>
        </div>
        <div class="h-6 w-px bg-surface-200"></div>
        <button id="refreshBtn" class="flex items-center gap-2 px-4 py-2.5 bg-brand-50 hover:bg-brand-100 text-brand-600 text-[13px] font-medium rounded-[10px] transition-all">
          <span id="refreshIcon" class="text-xs"></span><span>刷新</span>
        </button>
      </div>
    </div>
  </header>

  <main class="max-w-[1440px] mx-auto px-6 py-6">
    <div class="grid grid-cols-4 gap-5 mb-6">
      <div class="bg-white rounded-[14px] card-shadow p-5">
        <div class="flex items-start justify-between mb-3">
          <div class="w-10 h-10 bg-brand-50 rounded-[10px] flex items-center justify-center text-brand-500" id="stat1Icon"></div>
          <span class="text-[11px] text-surface-400 font-medium">全部接口</span>
        </div>
        <div class="stat-number text-[28px] font-bold leading-none mb-1" id="statTotal">0</div>
        <div class="text-[12px] text-surface-400" id="statTotalSub">异常 0 条</div>
      </div>
      <div class="bg-white rounded-[14px] card-shadow p-5">
        <div class="flex items-start justify-between mb-3">
          <div class="w-10 h-10 bg-green-50 rounded-[10px] flex items-center justify-center text-success" id="stat2Icon"></div>
          <span class="text-[11px] text-surface-400 font-medium">今日新增</span>
        </div>
        <div class="stat-number text-[28px] font-bold leading-none mb-1" id="statToday">0</div>
        <div class="text-[12px] text-surface-400" id="statTodaySub">最近 24h:0 条</div>
      </div>
      <div class="bg-white rounded-[14px] card-shadow p-5">
        <div class="flex items-start justify-between mb-3">
          <div class="w-10 h-10 bg-red-50 rounded-[10px] flex items-center justify-center text-danger" id="stat3Icon"></div>
          <span class="text-[11px] text-surface-400 font-medium">异常接口</span>
        </div>
        <div class="stat-number text-[28px] font-bold leading-none mb-1" id="statError">0</div>
        <div class="text-[12px] text-surface-400" id="statErrorSub">占比 0%</div>
      </div>
      <div class="bg-white rounded-[14px] card-shadow p-5">
        <div class="flex items-start justify-between mb-3">
          <div class="w-10 h-10 bg-amber-50 rounded-[10px] flex items-center justify-center text-warning" id="stat4Icon"></div>
          <span class="text-[11px] text-surface-400 font-medium">平均响应</span>
        </div>
        <div class="stat-number text-[28px] font-bold leading-none mb-1"><span id="statAvgTime">0</span><span class="text-[16px] font-medium text-surface-400 ml-1">ms</span></div>
        <div class="text-[12px] text-surface-400" id="statAvgSub">最慢 0ms</div>
      </div>
    </div>

    <div class="bg-white rounded-[14px] card-shadow p-5 mb-5">
      <div class="flex items-center gap-4 flex-wrap">
        <div class="relative flex-1 min-w-[280px] max-w-[400px]">
          <span id="searchIcon" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 text-sm"></span>
          <input type="text" id="searchInput" placeholder="搜索 URL / 方法 / 状态码..." class="search-input w-full h-10 pl-10 pr-4 bg-surface-50 border border-surface-200 rounded-[10px] text-[13px] text-surface-700 placeholder-surface-400" />
        </div>
        <select id="methodFilter" class="h-10 pl-3.5 pr-9 bg-surface-50 border border-surface-200 rounded-[10px] text-[13px] text-surface-600 cursor-pointer">
          <option value="">全部方法</option><option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option><option>PATCH</option>
        </select>
        <select id="statusFilter" class="h-10 pl-3.5 pr-9 bg-surface-50 border border-surface-200 rounded-[10px] text-[13px] text-surface-600 cursor-pointer">
          <option value="">全部状态</option><option value="2xx">2xx 成功</option><option value="3xx">3xx 重定向</option><option value="4xx">4xx 客户端错误</option><option value="5xx">5xx 服务端错误</option>
        </select>
        <select id="timeFilter" class="h-10 pl-3.5 pr-9 bg-surface-50 border border-surface-200 rounded-[10px] text-[13px] text-surface-600 cursor-pointer">
          <option value="">全部时间</option><option value="1h">最近1小时</option><option value="6h">最近6小时</option><option value="24h">最近24小时</option><option value="7d">最近7天</option>
        </select>
        <select id="responseTimeFilter" class="h-10 pl-3.5 pr-9 bg-surface-50 border border-surface-200 rounded-[10px] text-[13px] text-surface-600 cursor-pointer">
          <option value="">响应时间</option><option value="fast">&lt; 100ms</option><option value="normal">100-500ms</option><option value="slow">&gt; 500ms</option>
        </select>
        <button id="clearFiltersBtn" class="hidden h-10 px-4 text-[13px] text-surface-500 hover:text-surface-700 font-medium">清除筛选</button>
      </div>
      <div id="activeFilters" class="flex items-center gap-2 mt-3 flex-wrap hidden"></div>
    </div>

    <div class="bg-white rounded-[14px] card-shadow overflow-hidden">
      <div class="flex items-center justify-between px-5 py-4 border-b border-surface-100">
        <span class="text-[13px] text-surface-500 font-medium">接口列表</span>
        <span id="showingInfo" class="text-[12px] text-surface-400"></span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="table-header-sticky border-b border-surface-100">
              <th class="px-5 py-3.5 text-left text-[12px] font-semibold text-surface-500 uppercase tracking-wider">方法</th>
              <th class="px-4 py-3.5 text-left text-[12px] font-semibold text-surface-500 uppercase tracking-wider">URL / 路径</th>
              <th class="px-4 py-3.5 text-left text-[12px] font-semibold text-surface-500 uppercase tracking-wider">状态码</th>
              <th class="px-4 py-3.5 text-left text-[12px] font-semibold text-surface-500 uppercase tracking-wider">响应时间</th>
              <th class="px-4 py-3.5 text-left text-[12px] font-semibold text-surface-500 uppercase tracking-wider">抓取时间</th>
              <th class="px-5 py-3.5 text-right text-[12px] font-semibold text-surface-500 uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody id="tableBody"></tbody>
        </table>
        <div id="emptyState" class="empty-state hidden">暂无数据,请开启录制并刷新</div>
      </div>
      <div class="flex items-center justify-between px-5 py-4 border-t border-surface-100">
        <div class="flex items-center gap-3">
          <span class="text-[12px] text-surface-400">每页显示</span>
          <select id="pageSize" class="h-8 pl-3 pr-8 bg-surface-50 border border-surface-200 rounded-lg text-[12px] text-surface-600 cursor-pointer">
            <option value="10" selected>10 条</option><option value="20">20 条</option><option value="50">50 条</option>
          </select>
        </div>
        <div id="pageNav" class="flex items-center gap-2"></div>
      </div>
    </div>
  </main>

  <div id="detailModal" class="fixed inset-0 z-50 hidden">
    <div id="modalBackdrop" class="modal-backdrop absolute inset-0"></div>
    <div class="absolute inset-4 md:inset-8 lg:inset-12 bg-white rounded-[16px] shadow-[0_20px_60px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden">
      <div class="flex items-center justify-between px-6 py-4 border-b border-surface-100 shrink-0">
        <div class="flex items-center gap-4">
          <span id="modalMethod" class="method-badge"></span>
          <div>
            <h3 id="modalUrl" class="text-[13px] font-mono text-surface-800 break-all"></h3>
            <p id="modalMeta" class="text-[12px] text-surface-400 mt-0.5"></p>
          </div>
        </div>
        <button id="closeModalBtn" class="w-8 h-8 flex items-center justify-center rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100"></button>
      </div>
      <div class="flex items-center gap-1 px-6 border-b border-surface-100 shrink-0">
        <button class="detail-tab tab-active" data-tab="headers">Headers</button>
        <button class="detail-tab tab-inactive" data-tab="request">请求体</button>
        <button class="detail-tab tab-inactive" data-tab="response">响应体</button>
      </div>
      <div class="flex-1 overflow-auto p-6 bg-surface-50">
        <div id="content-headers" class="space-y-4"></div>
        <div id="content-request" class="hidden"></div>
        <div id="content-response" class="hidden"></div>
      </div>
    </div>
  </div>

  <script type="module" src="manage.js"></script>
</body>
</html>
```

- [ ] **Step 4: 重新构建 CSS(扫描到 manage.html 新用到的 class)**

Run: `npm run build:css`
Expected: `tailwind.css` 更新,含 manage.html 用到的全部 class。

- [ ] **Step 5: 静态自检**

人工核对 `manage.html`:无 `https://` 远程资源、无 `onclick=` 等内联事件、`<script type="module" src="manage.js">` 外联、`<link>` 仅引用本地 `tailwind.css`/`manage.css`。

- [ ] **Step 6: 提交**

```bash
git add src/manage/icons.js src/manage/manage.css src/manage/manage.html src/manage/tailwind.css
git commit -m "feat(manage): 管理页静态 UI(icons SVG/manage.css/manage.html 裁剪骨架)"
```

---

## Task 8: 管理页 JS(manage.js)

**Files:**
- Create: `src/manage/manage.js`

> 依赖:Task 4 的消息协议(`GET_ALL`/`GET_DETAIL`/`SET_GLOBAL`)、Task 7 的 HTML id 与 `ICONS`。record 字段见 db.js `putRequest` 写入的平铺字段。

- [ ] **Step 1: 创建 `src/manage/manage.js`**

```js
import { ICONS } from './icons.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

const state = { all: [], filtered: [], page: 1, pageSize: 10, currentDetail: null };

// ---- 注入图标 ----
$('logoIcon').innerHTML = ICONS.logo;
$('searchIcon').innerHTML = ICONS.search;
$('refreshIcon').innerHTML = ICONS.refresh;
$('closeModalBtn').innerHTML = ICONS.xmark;
$('stat1Icon').innerHTML = ICONS.plug;
$('stat2Icon').innerHTML = ICONS.plus;
$('stat3Icon').innerHTML = ICONS.warning;
$('stat4Icon').innerHTML = ICONS.clock;

// ---- 工具 ----
function statusClass(s) {
  if (s >= 200 && s < 300) return '2xx';
  if (s >= 300 && s < 400) return '3xx';
  if (s >= 400 && s < 500) return '4xx';
  if (s >= 500) return '5xx';
  return '2xx';
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function timeClass(ms) {
  if (ms < 100) return 'fast';
  if (ms <= 500) return 'normal';
  return 'slow';
}
function timeRangeMs(v) {
  return { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3 }[v] || 0;
}
function toast(msg, type = 'success') {
  const color = type === 'error' ? 'bg-red-500' : type === 'info' ? 'bg-brand-500' : 'bg-emerald-500';
  const el = document.createElement('div');
  el.className = `toast-in flex items-center gap-3 px-5 py-3.5 ${color} text-white rounded-[12px] text-[13px] font-medium min-w-[200px]`;
  el.textContent = msg;
  $('toastContainer').appendChild(el);
  setTimeout(() => { el.classList.remove('toast-in'); el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); }, 2000);
}

// ---- 过滤 ----
function applyFilters() {
  const q = $('searchInput').value.trim().toLowerCase();
  const m = $('methodFilter').value;
  const st = $('statusFilter').value;
  const tf = $('timeFilter').value;
  const rt = $('responseTimeFilter').value;
  const now = Date.now();
  const rangeMs = timeRangeMs(tf);
  state.filtered = state.all.filter((r) => {
    if (q && !(`${r.url} ${r.method} ${r.status}`.toLowerCase().includes(q))) return false;
    if (m && r.method !== m) return false;
    if (st && statusClass(r.status) !== st) return false;
    if (rangeMs && now - r.timestamp > rangeMs) return false;
    if (rt === 'fast' && !(r.duration < 100)) return false;
    if (rt === 'normal' && !(r.duration >= 100 && r.duration <= 500)) return false;
    if (rt === 'slow' && !(r.duration > 500)) return false;
    return true;
  });
  state.page = 1;
  render();
}

// ---- 渲染 ----
function render() {
  renderTable();
  renderPagination();
  renderActiveFilters();
}

function renderStats() {
  const all = state.all;
  const total = all.length;
  const err = all.filter((r) => r.status >= 400).length;
  const now = Date.now();
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const today = all.filter((r) => r.timestamp >= today0.getTime()).length;
  const last24 = all.filter((r) => now - r.timestamp <= 24 * 3600e3).length;
  const durs = all.map((r) => r.duration || 0);
  const avg = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
  const max = durs.length ? Math.max(...durs) : 0;
  $('statTotal').textContent = total.toLocaleString();
  $('statTotalSub').textContent = `异常 ${err} 条`;
  $('statToday').textContent = today;
  $('statTodaySub').textContent = `最近 24h:${last24} 条`;
  $('statError').textContent = err;
  $('statErrorSub').textContent = total ? `占比 ${(100 * err / total).toFixed(1)}%` : '占比 0%';
  $('statAvgTime').textContent = avg;
  $('statAvgSub').textContent = `最慢 ${max}ms`;
}

function renderTable() {
  const tbody = $('tableBody');
  const { filtered, page, pageSize } = state;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (page > pageCount) state.page = pageCount;
  const start = (state.page - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);
  tbody.innerHTML = slice.map((r) => `
    <tr class="table-row-hover border-b border-surface-50" data-id="${r.id}">
      <td class="px-5 py-4"><span class="method-badge method-${r.method}">${r.method}</span></td>
      <td class="px-4 py-4"><div class="text-[13px] text-surface-500 font-mono truncate max-w-[320px]" title="${escapeHtml(r.url)}">${escapeHtml(r.url)}</div></td>
      <td class="px-4 py-4"><span class="status-badge status-${statusClass(r.status)}"><span class="w-1.5 h-1.5 rounded-full inline-block" style="background:currentColor"></span>${r.status}</span></td>
      <td class="px-4 py-4"><div class="time-indicator"><span class="time-dot time-${timeClass(r.duration)}"></span><span class="text-[13px] text-surface-600 font-mono">${r.duration || 0}ms</span></div></td>
      <td class="px-4 py-4"><span class="text-[12px] text-surface-400">${formatTime(r.timestamp)}</span></td>
      <td class="px-5 py-4 text-right"><button class="detail-open w-8 h-8 inline-flex items-center justify-center rounded-lg text-surface-400 hover:text-brand-500 hover:bg-brand-50 transition-all" data-id="${r.id}">${ICONS.eye}</button></td>
    </tr>`).join('');
  $('emptyState').classList.toggle('hidden', filtered.length > 0);
  const from = filtered.length ? start + 1 : 0;
  $('showingInfo').textContent = `显示 ${from}-${start + slice.length} 条,共 ${filtered.length} 条`;
}

function renderPagination() {
  const pageCount = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  const cur = state.page;
  const btn = (label, page, opts = {}) =>
    `<button class="page-btn ${opts.active ? 'active' : 'text-surface-600'}" ${opts.disabled ? 'disabled' : `data-page="${page}"`}>${label}</button>`;
  const nav = [];
  nav.push(btn('‹', cur - 1, { disabled: cur <= 1 }));
  for (let i = 1; i <= pageCount; i++) {
    if (i === 1 || i === pageCount || Math.abs(i - cur) <= 1) {
      nav.push(btn(i, i, { active: i === cur }));
    } else if (Math.abs(i - cur) === 2) {
      nav.push(`<span class="text-surface-300 px-1">…</span>`);
    }
  }
  nav.push(btn('›', cur + 1, { disabled: cur >= pageCount }));
  $('pageNav').innerHTML = nav.join('');
}

function renderActiveFilters() {
  const active = [];
  const q = $('searchInput').value.trim(); if (q) active.push(`搜索:${q}`);
  if ($('methodFilter').value) active.push(`方法:${$('methodFilter').value}`);
  if ($('statusFilter').value) active.push(`状态:${$('statusFilter').value}`);
  if ($('timeFilter').value) active.push(`时间:${$('timeFilter').selectedOptions[0].textContent}`);
  if ($('responseTimeFilter').value) active.push(`响应:${$('responseTimeFilter').selectedOptions[0].textContent}`);
  const box = $('activeFilters');
  const clearBtn = $('clearFiltersBtn');
  if (active.length) {
    box.classList.remove('hidden');
    clearBtn.classList.remove('hidden');
    box.innerHTML = '<span class="text-[12px] text-surface-400">已选筛选:</span>' +
      active.map((a) => `<span class="filter-chip">${escapeHtml(a)}</span>`).join('');
  } else {
    box.classList.add('hidden');
    clearBtn.classList.add('hidden');
  }
}

// ---- 详情 Modal ----
async function openDetail(id) {
  const res = await send({ type: 'GET_DETAIL', id });
  const r = res?.record;
  if (!r) { toast('详情读取失败', 'error'); return; }
  state.currentDetail = r;
  $('modalMethod').className = `method-badge method-${r.method}`;
  $('modalMethod').textContent = r.method;
  $('modalUrl').textContent = r.url;
  $('modalMeta').textContent = `${r.status} ${r.statusText || ''} · ${r.duration || 0}ms · ${formatTime(r.timestamp)} · ${r.source}`;
  renderHeaders(r);
  renderBody('content-request', r.requestBody);
  renderBody('content-response', r.responseBody);
  $('detailModal').classList.remove('hidden');
  switchTab('headers');
}
function renderHeaders(r) {
  const block = (title, headers, accent) => `
    <div class="bg-white rounded-[12px] p-5 card-shadow">
      <h4 class="text-[13px] font-semibold text-surface-700 mb-3">${title}</h4>
      <div class="space-y-1.5">${(headers || []).map((h) => `
        <div class="flex items-start gap-4 py-1.5 border-b border-surface-50 last:border-0">
          <span class="text-[12px] font-mono ${accent} min-w-[160px] shrink-0">${escapeHtml(h.name)}</span>
          <span class="text-[12px] font-mono text-surface-600 break-all">${escapeHtml(h.value)}</span>
        </div>`).join('') || '<p class="text-[12px] text-surface-400">无</p>'}</div>
    </div>`;
  $('content-headers').innerHTML = block('Request Headers', r.requestHeaders, 'text-brand-500') + block('Response Headers', r.responseHeaders, 'text-success');
}
function renderBody(boxId, content) {
  const box = $(boxId);
  if (content == null || content === '') { box.innerHTML = '<div class="bg-white rounded-[12px] p-5 card-shadow text-[12px] text-surface-400">无内容</div>'; return; }
  let pretty = content;
  try { pretty = JSON.stringify(JSON.parse(content), null, 2); } catch { /* 非 JSON 原样 */ }
  box.innerHTML = `<div class="bg-white rounded-[12px] p-5 card-shadow"><pre class="code-block">${escapeHtml(pretty)}</pre></div>`;
}
function switchTab(tab) {
  ['headers', 'request', 'response'].forEach((t) => {
    const btn = document.querySelector(`.detail-tab[data-tab="${t}"]`);
    const content = $(`content-${t}`);
    if (t === tab) { btn.className = 'detail-tab tab-active'; content.classList.remove('hidden'); }
    else { btn.className = 'detail-tab tab-inactive'; content.classList.add('hidden'); }
  });
}
function closeDetail() { $('detailModal').classList.add('hidden'); }

// ---- 全局开关 ----
async function loadGlobalToggle() {
  const got = await chrome.storage.local.get('recording');
  const r = got.recording || { global: false };
  syncGlobalToggle(!!r.global);
}
function syncGlobalToggle(on) {
  const t = $('globalToggle');
  t.classList.toggle('active', on);
  $('liveDot').classList.toggle('hidden', on);
  $('liveIndicator').classList.toggle('hidden', !on);
}
async function toggleGlobal() {
  const got = await chrome.storage.local.get('recording');
  const r = got.recording || { global: false, tabs: {} };
  r.global = !r.global;
  await chrome.storage.local.set({ recording: r });
  syncGlobalToggle(r.global);
  send({ type: 'SET_GLOBAL', value: r.global }).catch(() => {});
  toast(r.global ? '全局录制已开启' : '全局录制已关闭', 'info');
}

// ---- 数据加载 ----
async function loadAll() {
  const res = await send({ type: 'GET_ALL' });
  state.all = (res?.items || []).slice().sort((a, b) => b.timestamp - a.timestamp);
  renderStats();
  applyFilters();
}

// ---- 事件绑定 ----
$('searchInput').addEventListener('input', applyFilters);
['methodFilter', 'statusFilter', 'timeFilter', 'responseTimeFilter'].forEach((id) => $(id).addEventListener('change', applyFilters));
$('pageSize').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); state.page = 1; render(); });
$('pageNav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]'); if (!b) return;
  state.page = Number(b.dataset.page); render();
});
$('tableBody').addEventListener('click', (e) => {
  const b = e.target.closest('.detail-open'); if (!b) return;
  openDetail(b.dataset.id);
});
$('clearFiltersBtn').addEventListener('click', () => {
  $('searchInput').value = '';
  ['methodFilter', 'statusFilter', 'timeFilter', 'responseTimeFilter'].forEach((id) => ($(id).value = ''));
  applyFilters();
});
$('refreshBtn').addEventListener('click', async () => { await loadAll(); toast('已刷新'); });
$('globalToggle').addEventListener('click', toggleGlobal);
$('closeModalBtn').addEventListener('click', closeDetail);
$('modalBackdrop').addEventListener('click', closeDetail);
document.querySelectorAll('.detail-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

// ---- 启动 ----
loadGlobalToggle();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.recording) syncGlobalToggle(!!changes.recording.newValue?.global);
});
loadAll();
```

- [ ] **Step 2: 重新构建 CSS(manage.js 动态生成的 class 也要被扫描)**

Run: `npm run build:css`
Expected: `tailwind.css` 含 `method-badge`、`status-badge`、`time-indicator` 等用到的类(自定义类在 manage.css;Tailwind 工具类如 `bg-red-500`/`text-success` 由 content 扫描 manage.js 生成)。

- [ ] **Step 3: 提交**

```bash
git add src/manage/manage.js src/manage/tailwind.css
git commit -m "feat(manage): manage.js 数据加载/搜索/筛选/分页/统计/详情 Modal/全局开关"
```

> 运行期验证(加载扩展、打开管理页、看渲染、搜索/分页/详情)在 Task 11 统一进行。

---

## Task 9: popup + manifest

**Files:**
- Create: `src/popup/popup.css`
- Create: `src/popup/popup.html`
- Create: `src/popup/popup.js`
- Modify: `manifest.json`

- [ ] **Step 1: 创建 `src/popup/popup.css`**

```css
body { width: 300px; font-family: system-ui, 'Noto Sans SC', sans-serif; margin: 0; background: #f8fafc; color: #1e293b; }
.header { display: flex; align-items: center; gap: 10px; padding: 14px 16px; background: #fff; border-bottom: 1px solid #e2e8f0; }
.logo { width: 32px; height: 32px; background: #3b6af5; border-radius: 8px; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; }
.title { font-size: 14px; font-weight: 600; }
.subtitle { font-size: 11px; color: #64748b; }
.row { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }
.row-title { font-size: 13px; font-weight: 500; }
.row-desc { font-size: 11px; color: #94a3b8; margin-top: 2px; max-width: 195px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.toggle { width: 40px; height: 22px; background: #cbd5e1; border-radius: 11px; position: relative; cursor: pointer; transition: background .2s; flex-shrink:0; }
.toggle.active { background: #10b981; }
.toggle::after { content:''; position:absolute; top:2px; left:2px; width:18px; height:18px; background:#fff; border-radius:50%; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.toggle.active::after { transform: translateX(18px); }
.manage-btn { display:block; width: calc(100% - 32px); margin: 14px 16px; padding: 10px; background: #3b6af5; color:#fff; border:none; border-radius: 10px; font-size: 13px; font-weight: 500; cursor: pointer; }
.manage-btn:hover { background: #2a52d8; }
```

- [ ] **Step 2: 创建 `src/popup/popup.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <div class="header">
    <div class="logo">◈</div>
    <div>
      <div class="title">API Catcher</div>
      <div class="subtitle" id="statusText">录制已关闭</div>
    </div>
  </div>
  <div class="row">
    <div>
      <div class="row-title">全局录制</div>
      <div class="row-desc">总开关,关闭则全部不录</div>
    </div>
    <div id="globalToggle" class="toggle"></div>
  </div>
  <div class="row">
    <div>
      <div class="row-title">当前标签页</div>
      <div class="row-desc" id="tabDesc">—</div>
    </div>
    <div id="tabToggle" class="toggle"></div>
  </div>
  <button id="openManage" class="manage-btn">打开管理页</button>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 3: 创建 `src/popup/popup.js`**

```js
const $ = (id) => document.getElementById(id);
let currentTab = null;

async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  if (!tab) { $('tabDesc').textContent = '—'; return; }
  if (/^(chrome|edge|about):/i.test(tab.url || '')) {
    $('tabDesc').textContent = '该页面不可录制';
  } else {
    $('tabDesc').textContent = tab.title || tab.url || String(tab.id);
  }
}
async function getState() {
  const got = await chrome.storage.local.get('recording');
  return got.recording || { global: false, tabs: {} };
}
function syncToggle(el, on) { el.classList.toggle('active', on); }
async function render() {
  const rec = await getState();
  syncToggle($('globalToggle'), !!rec.global);
  const tabOn = !!(currentTab && rec.tabs[currentTab.id] === true);
  syncToggle($('tabToggle'), tabOn);
  let txt;
  if (!rec.global) txt = '全局关闭';
  else if (currentTab && rec.tabs[currentTab.id] === true) txt = '正在录制当前标签页';
  else txt = '全局已开,当前标签页未开启';
  $('statusText').textContent = txt;
}

$('globalToggle').addEventListener('click', async () => {
  const rec = await getState();
  rec.global = !rec.global;
  await chrome.storage.local.set({ recording: rec });
  chrome.runtime.sendMessage({ type: 'SET_GLOBAL', value: rec.global }).catch(() => {});
  render();
});
$('tabToggle').addEventListener('click', async () => {
  if (!currentTab || /^(chrome|edge|about):/i.test(currentTab.url || '')) return;
  const rec = await getState();
  rec.tabs = rec.tabs || {};
  rec.tabs[currentTab.id] = !(rec.tabs[currentTab.id] === true);
  await chrome.storage.local.set({ recording: rec });
  chrome.runtime.sendMessage({ type: 'SET_TAB', tabId: currentTab.id, value: rec.tabs[currentTab.id] }).catch(() => {});
  render();
});
$('openManage').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/manage/manage.html') });
});

(async () => { await loadCurrentTab(); await render(); })();
chrome.storage.onChanged.addListener((_c, area) => { if (area === 'local') render(); });
```

- [ ] **Step 4: 改 `manifest.json` 的 `action`**

把:
```json
  "action": { "default_title": "API Catcher" }
```
改为:
```json
  "action": { "default_title": "API Catcher", "default_popup": "src/popup/popup.html" }
```

- [ ] **Step 5: 提交**

```bash
git add manifest.json src/popup/popup.html src/popup/popup.js src/popup/popup.css
git commit -m "feat(popup): popup 全局+当前标签页开关、打开管理页;manifest 注册 default_popup"
```

---

## Task 10: devtools panel 改造(本审查标签页开关)

**Files:**
- Modify: `src/devtools/panel.html`
- Modify: `src/devtools/panel.js`

- [ ] **Step 1: 用以下内容替换 `src/devtools/panel.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: system-ui, sans-serif; margin: 12px; }
    .label { font-size: 13px; font-weight: 500; color: #1e293b; }
    .toggle { width: 44px; height: 24px; background: #cbd5e1; border-radius: 12px; position: relative; cursor: pointer; transition: background .2s; display: inline-block; vertical-align: middle; }
    .toggle.active { background: #10b981; }
    .toggle::after { content:''; position:absolute; top:2px; left:2px; width:20px; height:20px; background:#fff; border-radius:50%; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
    .toggle.active::after { transform: translateX(20px); }
    #status { margin-left: 8px; color: #555; font-size: 12px; }
    #globalHint { display:block; margin-top:8px; color:#b91c1c; font-size:12px; }
  </style>
</head>
<body>
  <div class="label">本标签页录制</div>
  <div style="margin-top:8px"><div id="tabToggle" class="toggle"></div><span id="status">默认关闭</span></div>
  <span id="globalHint" hidden>全局开关未开启,需先在 popup 开启</span>
  <script src="panel.js"></script>
</body>
</html>
```

- [ ] **Step 2: 用以下内容替换 `src/devtools/panel.js`**

```js
const toggle = document.getElementById('tabToggle');
const status = document.getElementById('status');
const globalHint = document.getElementById('globalHint');
const tabId = chrome.devtools.inspectedWindow.tabId;

async function getState() {
  const got = await chrome.storage.local.get('recording');
  return got.recording || { global: false, tabs: {} };
}

async function render() {
  const rec = await getState();
  const on = rec.tabs[tabId] === true;
  toggle.classList.toggle('active', on);
  status.textContent = on ? '正在抓取本标签页请求' : '默认关闭,点击开启';
  globalHint.hidden = !!rec.global;
}

toggle.addEventListener('click', async () => {
  const rec = await getState();
  rec.tabs = rec.tabs || {};
  rec.tabs[tabId] = !(rec.tabs[tabId] === true);
  await chrome.storage.local.set({ recording: rec });
  chrome.runtime.sendMessage({ type: 'SET_TAB', tabId, value: rec.tabs[tabId] }).catch(() => {});
  render();
});

chrome.storage.onChanged.addListener((_c, area) => { if (area === 'local') render(); });

// 仅在「本标签页开关开」时上报(全局判定由 background.ingest 的 shouldRecord 完成)
chrome.devtools.network.onRequestFinished.addListener((req) => {
  (async () => {
    const rec = await getState();
    if (rec.tabs[tabId] !== true) return;
    chrome.devtools.inspectedWindow.eval('location.href', (tabUrl) => {
      req.getContent((responseBody) => {
        chrome.runtime.sendMessage({
          type: 'RECORD_DEVTOOLS', har: req, responseBody, tabId, tabUrl: tabUrl || '',
        }).catch(() => {});
      });
    });
  })();
});

render();
```

- [ ] **Step 3: 提交**

```bash
git add src/devtools/panel.html src/devtools/panel.js
git commit -m "feat(panel): devtools 面板开关改为「本审查标签页开关」(读写 storage per-tab)"
```

---

## Task 11: 集成验证(playwright)

**Files:**
- Create: `test/integration/phase2-verify.mjs`

> 前置:Task 1-10 全部完成、`npm test` 全绿、`npm run build:css` 已产出最新 `tailwind.css`。
> 该脚本需本地 playwright(`npm i -D playwright` 后 `npx playwright install chromium`,或复用 Phase 1 的 `D:\java_study\创业\verify-extension.mjs` 环境)。若环境受限,可改为人工按「人工核对清单」逐项验证。

- [ ] **Step 1: 安装 playwright(若尚未安装)**

Run: `npm i -D playwright && npx playwright install chromium`
(devDependencies 会新增 `playwright`。)

- [ ] **Step 2: 创建 `test/integration/phase2-verify.mjs`**

```js
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(__dirname, '..', '..');
const TEST_PAGE = pathToFileURL(path.join(EXT_DIR, 'test/manual/test-page.html')).href;
const PROFILE = path.join(EXT_DIR, '.test-profile');

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
});

let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 8000 });
const extId = new URL(sw.url()).hostname;
const manageUrl = `chrome-extension://${extId}/src/manage/manage.html`;

const managePage = await ctx.newPage();
await managePage.goto(manageUrl);

// 清空历史库,避免干扰
await managePage.evaluate(async () => {
  const dbs = await indexedDB.databases();
  await Promise.all((dbs || []).map((d) => new Promise((r) => {
    const req = indexedDB.deleteDatabase(d.name); req.onsuccess = req.onerror = r;
  })));
});

// 预设全局 + tab1 开关为 ON,使下方注入的记录经 background.ingest 正常入库(验证管理页 UI)
await managePage.evaluate(async () => {
  await chrome.storage.local.set({ recording: { global: true, tabs: { 1: true } } });
});
await managePage.waitForTimeout(300); // 等 background storage.onChanged 同步内存镜像

// 打开测试页,触发请求(inject 路径;开关判定在 background,这里直接往库塞数据验证管理页展示)
// 注:inject 上报受 shouldRecord 约束(本自动化无真实 tabId 开关),故改用消息直注入库来验证 UI
const testPage = await ctx.newPage();
await testPage.goto(TEST_PAGE);

// 通过 background 消息注入两条 devtools 形态记录(绕过开关,验证管理页渲染与去重)
await managePage.evaluate(async () => {
  const mk = (url, status, dur, ts) => ({
    source: 'devtools', timestamp: ts, tabId: 1, tabUrl: 'https://test.local',
    request: { url, method: 'GET', headers: [], body: { content: null, size: 0, isBinary: false } },
    response: { status, statusText: 'OK', headers: [{ name: 'Content-Type', value: 'application/json' }], body: { content: '{"ok":1}', size: 7, isBinary: false }, mimeType: 'application/json', resourceType: 'xhr' },
    duration: dur,
  });
  const now = Date.now();
  for (const r of [mk('https://test.local/api/users', 200, 45, now), mk('https://test.local/api/orders', 500, 800, now - 1000), mk('https://test.local/api/users', 200, 45, now)]) {
    await chrome.runtime.sendMessage({ type: 'RECORD_DEVTOOLS', har: { request: r.request, response: { status: r.response.status, statusText: r.response.statusText, headers: r.response.headers, mimeType: r.response.mimeType }, _resourceType: 'xhr', time: r.duration, startedDateTime: new Date(r.timestamp).toISOString() }, responseBody: '{"ok":1}', tabId: r.tabId, tabUrl: r.tabUrl });
  }
});

await managePage.reload();
await managePage.waitForTimeout(600);

const total = await managePage.locator('#statTotal').textContent();
const errorCount = await managePage.locator('#statError').textContent();
console.log('统计 全部:', total, ' 异常:', errorCount);

const rows = await managePage.locator('#tableBody tr').count();
console.log('表格行数(默认10/页,共3条去重后应=2):', rows);

// 搜索
await managePage.fill('#searchInput', 'users');
await managePage.waitForTimeout(300);
const searched = await managePage.locator('#tableBody tr').count();
console.log('搜索 users 行数(应=1):', searched);

// 分页切换
await managePage.selectOption('#pageSize', '20');
await managePage.waitForTimeout(200);

// 详情 Modal
await managePage.fill('#searchInput', '');
await managePage.waitForTimeout(200);
await managePage.locator('.detail-open').first().click();
await managePage.waitForTimeout(300);
const modalVisible = await managePage.locator('#detailModal').evaluate((el) => !el.classList.contains('hidden'));
const respBodyShown = await managePage.locator('#content-response .code-block').count();
console.log('Modal 打开:', modalVisible, ' 响应体展示:', respBodyShown > 0);

let ok = true;
if (rows !== 2) { console.error('❌ 去重失效:期望 2 条,实际', rows); ok = false; }
if (searched !== 1) { console.error('❌ 搜索失效'); ok = false; }
if (!modalVisible) { console.error('❌ Modal 未打开'); ok = false; }
console.log(ok ? '✅ Phase 2 自动化核心检查通过' : '❌ 存在失败项');
await ctx.close();
process.exit(ok ? 0 : 1);
```

- [ ] **Step 3: 运行自动化验证**

Run: `node test/integration/phase2-verify.mjs`
Expected: 输出 `✅ Phase 2 自动化核心检查通过`,退出码 0。

- [ ] **Step 4: 人工核对清单(关键,自动化覆盖不到的)**

加载扩展到真实 Chrome,逐项确认:
- [ ] popup 打开,全局开关 + 当前标签页开关默认 OFF;同时开两者后,测试页请求能入库;只开全局不开标签页不入库
- [ ] popup「打开管理页」能打开管理页;管理页 header 全局开关与 popup 同步
- [ ] 管理页视觉与参考文件一致(配色/统计卡/badge/分页);无 CSP 报错(控制台干净)
- [ ] 搜索 / 4 个筛选下拉 / 分页 10·20·50 / 详情三 tab(headers/请求体/响应体)均可用
- [ ] **URL 去重回归**:打开测试页 + F12 开 DevTools API Catcher 面板(本标签页开关 ON)+ popup 全局 ON;点「GET JSON」(被 inject 与 devtools 双路径同时抓);刷新管理页,该 URL **只 1 条**(债务修复核心验收)
- [ ] 详情能看到响应体(含触发一次大响应体验证懒加载)

- [ ] **Step 5: 提交**

```bash
git add test/integration/phase2-verify.mjs package.json package-lock.json
git commit -m "test: Phase 2 集成验证脚本(playwright:统计/去重/搜索/分页/详情)+ 人工核对清单"
```

---

## 完成标准回顾

- `npm test` 全绿(Phase 1 的 21 + recording 6 + normalize 新增 + db 新增 4)
- `npm run build:css` 产出 `src/manage/tailwind.css`,管理页无 CSP 报错
- 管理页:统计 / 表格 / 分页 10·20·50 / 搜索 / 高级筛选 / 详情 Modal 全部可用
- popup:全局 + 标签页开关(默认 OFF,AND 语义)、打开管理页
- devtools panel:本审查标签页开关
- URL 去重:相对/绝对双路径同接口只存一条
- 详情可见完整请求/响应 body(含懒加载)
