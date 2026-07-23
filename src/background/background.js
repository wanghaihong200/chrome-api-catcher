import { openDB, putRequest, getRequest, getBody, listRequests } from './db.js';
import { shouldKeep } from '../logic/filter.js';
import { makeKey, findDuplicate, pickMoreComplete } from './dedupe.js';
import { normalizeInjectRecord, normalizeDevtoolsRecord } from '../logic/normalize.js';

const state = {
  recording: false,         // 默认关闭
  recent: [],               // [{key, timestamp, id}],去重用,最多 200 条
  dbPromise: null,
};

function db() {
  if (!state.dbPromise) state.dbPromise = openDB();
  return state.dbPromise;
}

function pushRecent(entry, id) {
  state.recent.unshift({ key: makeKey(entry), timestamp: entry.timestamp, id });
  if (state.recent.length > 200) state.recent.length = 200;
}

async function ingest(entry) {
  if (!state.recording) return;            // 录制关闭则丢弃
  if (!shouldKeep({ url: entry.request.url, resourceType: entry.response.resourceType, responseMimeType: entry.response.mimeType })) {
    return;                                // 静态/埋点过滤
  }
  const dup = findDuplicate(entry, state.recent);
  if (dup) {
    // 已有同请求:Phase 1 采用先到先得,不回写覆盖
    return;
  }
  const id = await putRequest(await db(), entry);
  pushRecent(entry, id);
}

async function getTabContext(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return { tabId, tabUrl: tab.url || '' };
  } catch {
    return { tabId, tabUrl: '' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'RECORD_INJECT': {
          const ctx = await getTabContext(sender.tab?.id ?? -1);
          const entry = normalizeInjectRecord(msg.raw, ctx);
          await ingest(entry);
          sendResponse({ ok: true });
          break;
        }
        case 'RECORD_DEVTOOLS': {
          const ctx = { tabId: msg.tabId, tabUrl: msg.tabUrl || '' };
          const entry = normalizeDevtoolsRecord(msg.har, msg.responseBody, ctx);
          await ingest(entry);
          sendResponse({ ok: true });
          break;
        }
        case 'SET_RECORDING': {
          state.recording = !!msg.value;
          sendResponse({ ok: true, recording: state.recording });
          break;
        }
        case 'GET_RECORDING':
          sendResponse({ recording: state.recording });
          break;
        case 'GET_LIST': {
          const res = await listRequests(await db(), { page: msg.page || 1, pageSize: msg.pageSize || 10 });
          sendResponse(res);
          break;
        }
        case 'GET_DETAIL': {
          const record = await getRequest(await db(), msg.id);
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
