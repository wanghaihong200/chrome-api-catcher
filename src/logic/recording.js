// 录制开关判定纯函数。
// state 形态: { global: boolean, tabs: { [tabId]: boolean } }
// 语义: global===true 且 tabs[tabId]===true 才录制;两者默认 OFF(tabs 未设 = false)。

export const DEFAULT_RECORDING_STATE = Object.freeze({ global: false, tabs: {} });

export function shouldRecord(state, tabId) {
  if (!state) return false;
  return state.global === true && state.tabs?.[tabId] === true;
}
