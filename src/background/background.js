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
