import { openDB, putRequest, getRequestDetail, getRequest, listRequests, updateRequest, findDuplicateByRequest, getDetailsByIds } from './db.js';
import { shouldKeep } from '../logic/filter.js';
import { normalizeInjectRecord, normalizeDevtoolsRecord } from '../logic/normalize.js';
import { shouldRecord, DEFAULT_RECORDING_STATE } from '../logic/recording.js';

const STORAGE_KEY = 'recording';
const ALL_PAGE_SIZE = 5000; // GET_ALL 一次返回上限(方案 A 前端持数据)

const state = {
  recording: { ...DEFAULT_RECORDING_STATE, tabs: {} }, // 内存镜像,storage 为真相源
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
        case 'GET_DETAILS_BY_IDS': {
          const details = await getDetailsByIds(await db(), msg.ids || []);
          sendResponse({ details });
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
