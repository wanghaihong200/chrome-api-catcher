const TIME_WINDOW_MS = 2000;

/** 生成去重 key:method|url|请求体大小 */
export function makeKey(entry) {
  const { method, url, body } = entry.request;
  return `${method}|${url}|${body.size}`;
}

/** 在 recent 里找时间窗内的同 key 项,返回匹配项或 null */
export function findDuplicate(entry, recent) {
  const key = makeKey(entry);
  for (const item of recent) {
    if (item.key === key && Math.abs(entry.timestamp - item.timestamp) < TIME_WINDOW_MS) {
      return item;
    }
  }
  return null;
}

/** 两条同请求中,选信息更完整(响应体非空且更大)的一条 */
export function pickMoreComplete(a, b) {
  const sa = a.response.body.size;
  const sb = b.response.body.size;
  if (sa === sb) return a;
  return sa > sb ? a : b;
}
