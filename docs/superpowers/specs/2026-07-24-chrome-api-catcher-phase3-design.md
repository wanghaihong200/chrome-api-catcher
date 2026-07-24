# Chrome API Catcher — Phase 3 设计:cURL / 批量导出 / 实时刷新

- **日期**:2026-07-24
- **分支**:`phase3`(基于 `phase2` HEAD `849c6f6`)
- **状态**:已与用户对齐,待 writing-plans 生成实现计划
- **依赖**:Phase 1(地基)+ Phase 2(管理页表格+Modal / popup+panel 录制开关 / URL 规范化等债务)已完成

---

## 1. 背景与现状

MV3 扩展。两条抓取路径(`inject.js` MAIN-world hook fetch/XHR + `devtools/panel.js` onRequestFinished)汇入 background service worker → `normalize` 统一 → `shouldKeep` 过滤 → 去重 → `db.js` 写 IndexedDB 双表(`requests` 主表 + `bodies` Blob 表,64KB 内联/拆分)。纯逻辑(db/dedupe/filter/normalize/recording)无 DOM 依赖,vitest 单测(37/37)。

Phase 2 已交付:管理页表格+详情 Modal(方案 A 前端持 5000 条)、popup 全局+标签页开关(默认 OFF)、devtools 面板「本审查标签页开关」、URL 规范化与去重债务(M2/M6/M7)清理、Tailwind 预编译 + SVG 图标本地化(解决 MV3 CSP)。

**Phase 3 在此之上补齐「用起来」的能力**:把抓到的请求变成可复用的 cURL、可导出到主流测试工具、录制时实时看到新请求,并清掉剩余三个债务(M8/M9/M10)。CSP 大坑已在 Phase 2 提前清掉,Phase 3 专注功能。

---

## 2. 范围

### 2.1 目标(本期必做)
1. **cURL 生成器 + 复制**:列表行内 cURL 按钮 + 详情 Modal 的 `curl` tab。
2. **批量导出**:Postman v2.1 / JMeter `.jmx` / HAR 1.2 / JSON 四格式 + 勾选列。
3. **列表实时刷新**:录制时新请求自动追加(智能暂停策略)。
4. **M8 二进制 body**:inject 端完整捕获(FormData/Blob/ArrayBuffer)→ base64,消费端(cURL/导出)统一 base64 表示。
5. **M9 并发去重竞态 + SW 重启重复 bug**:去重真相源改为 IndexedDB。
6. **M10 by-url 索引利用**:去重查询复用已建但闲置的 `by-url` 索引。

### 2.2 非目标(YAGNI,明确不做)
- 删除/清空记录功能(后续 Phase)。
- 导入(只导出不导入)。
- WebSocket / SSE 抓取。
- 录制规则/白名单 UI 编辑(过滤逻辑 `filter.js` 不动)。
- JMeter 二进制 body 的原生完美支持(已知局限,见 §7)。
- 跨设备同步。

---

## 3. 已确认决策(对齐结论)

| 决策点 | 选择 | 理由 |
|---|---|---|
| 去重真相源 | **DB 真相源** | 一举清 M9(并发)+ M10(索引闲置)+ SW 重启 recent 清空导致重复的隐藏 bug;单一真相源,无双源同步问题 |
| M8 范围 | **完整捕获+编码** | inject 端从未捕获二进制请求体(原存 null),本期在 inject 端补 FormData/Blob/ArrayBuffer→base64,响应体按 content-type 二进制分支,M8 彻底清零 |
| cURL 敏感头 | **总是提示** | 复制含 Cookie/Authorization 等敏感头的 cURL 时弹确认(复制完整/复制脱敏版/取消),兼顾安全与可用 |
| 实时刷新 UX | **智能暂停** | `page===1 && 无 filter` 时自动追加;否则只显示「N 条新请求」提示条,点击加载 |
| 导出范围 | 勾选优先 | 有勾选→导出勾选项;无勾选→导出当前筛选结果(非 DB 全量);全选作用于当前筛选结果 |
| 勾选语义 | 跨页保留 | `state.selected` 为 `Set<id>`,翻页不丢失 |
| JMeter 二进制 | 尽力+注释 | JMeter 原生二进制 body 支持弱,body 区放 base64 + 注释,接受此局限(用户确认) |
| cURL 二进制表示 | 进程替换 | `--data-binary @<(printf '%s' '<base64>' \| base64 -d)`,Linux/mac 友好,Windows cmd 不支持(用户确认接受) |

---

## 4. 详细设计

### 4.1 模块与数据流

```
inject.js(MAIN world)── 二进制请求体/响应体 encodeBody → base64 ──┐
                                                                  ▼
devtools/panel.js ──────────────────────────────────────────► normalize.js
                                                                  ▼
                                          background.ingest(去重 = DB 真相源)
                                                  ▼                          ▼
                                          putRequest(新)            updateRequest(命中回写)
                                                  ▼                          ▼
                                     广播 NEW_REQUEST          广播 REQUEST_UPDATED
                                                  └──────────┬───────────────┘
                                                             ▼
                              manage.js(消费层:实时刷新 / cURL / 导出)
```

**新增纯逻辑模块**(无 DOM,vitest 单测):
- `src/logic/base64.js` — `bytesToBase64(input)`、`decodeBase64(str)`
- `src/logic/curl.js` — `toCurl(detail, {includeSensitive})`、`hasSensitive(detail)`、`SENSITIVE_HEADERS`
- `src/logic/exporters/har.js`、`postman.js`、`jmeter.js`、`json.js` + `index.js`(`exportAs(format, details[])`)

**改造既有模块**:见 §4.2–§4.7。

### 4.2 去重 DB 真相源(M9 + M10 + SW 重启 bug)

`background.ingest` 流程改为:

```
shouldRecord(开关) → shouldKeep(过滤) → findDuplicateByRequest(查 DB)
  ├─ 命中 → pickMoreComplete 判定:新条响应严格更完整则 updateRequest(M6 回写) → 广播 REQUEST_UPDATED
  └─ 未命中 → putRequest → 广播 NEW_REQUEST
```

- **新增 `db.findDuplicateByRequest(db, {method, url, timestamp, bodySize, windowMs=2000})`**:
  - 用 `requests` 表的 `by-url` 索引 `getAllKeys(IDBKeyRange.only(url))` 取同 URL 的 id 集;
  - 逐条 `getRequest`,筛 `method === method && Math.abs(ts - timestamp) < windowMs && requestBodySize === bodySize`;
  - 返回首个命中 id 或 `null`。**M10 的 by-url 索引至此被真正利用。**
- **移除 `state.recent`**:`background.js` 中的 `RECENT_MAX`、`state.recent`、`pushRecent()`、`findDuplicate` 调用全部删除。`dedupe.js` 的 `makeKey/findDuplicate` 仅在单测中保留(不再被生产代码引用)或一并清理——实现时择一,倾向保留文件供单测。
- **广播**:SW 用 `chrome.runtime.sendMessage({type:'NEW_REQUEST', id})` / `{type:'REQUEST_UPDATED', id}` 主动推给所有扩展上下文(popup/panel/manage);接收方按需响应,无关上下文忽略。高频由管理页侧 250ms debounce 批量吸收(见 §4.6),SW 侧不做节流。

### 4.3 M8 二进制捕获

**`inject.js`(MAIN world,有完整 DOM API)** 新增 `async encodeBody(body)`:

| body 类型 | 处理 | 产出 |
|---|---|---|
| `null` | — | `{body: null, isBinary: false}` |
| `string` | 原样 | `{body, isBinary: false}` |
| `URLSearchParams` | `.toString()`(它 `typeof==='object'`,须特判避免误入二进制) | `{body: str, isBinary: false}` |
| `ArrayBuffer` / `TypedArray` | `bytesToBase64` | `{body: b64, isBinary: true}` |
| `Blob` | `await blob.arrayBuffer()` → 同上 | `{body: b64, isBinary: true}` |
| `FormData` | `await new Response(fd).arrayBuffer()` → base64;记录原始 `content-type`(boundary 由 Response 重建,可重放) | `{body: b64, isBinary: true}` |
| 其他/未知 | 标记不可序列化 | `{body: null, isBinary: false}` + 不阻塞 |

- **fetch**:hook 内 `await encodeBody(init?.body)` 后再 `send`(fetch 本就是 async,不破坏页面时序)。
- **XHR**:`send(body)` 的 body 引用存入 `meta`,在 `loadend` 回调里 `await encodeBody(meta.body)`。
- **响应体**:按响应 `content-type` 判二进制(`image/*`、`application/octet-stream`、`font/*`、`video/*`、`audio/*` 等),二进制则 `response.clone().arrayBuffer()` → `bytesToBase64`、`isBinary:true`;否则维持现有 `response.clone().text()`。
- **传输**:统一以字符串(base64 或原文)经 `window.postMessage` 传给 content.js → `chrome.runtime.sendMessage`。

**`normalize.js` `bodyOf`**:已透传 `isBinary`;`content` 现可能是 base64 字符串(二进制时)。`size = content.length`(content 的**最终存储形态**长度:原文请求体是原文 length,二进制请求体是 base64 length)。去重 `bodySize` 比较仅在**字符串请求体**场景保证 inject/devtools 双路径一致(两边都是原文 length);二进制请求体的双路径去重**非本期目标**(devtools 端 body 由 panel 的 `postData.text` 提供,不在 Phase 3 改造范围)。

**消费端**:`getRequestDetail` 额外回填 `requestBodyIsBinary` / `responseBodyIsBinary`(二进制必在 `bodies` 表,读 `row.isBinary`;inline 路径恒为 `false`)。`requestBody`/`responseBody` 保持为字符串内容(向后兼容现有 `renderBody`)。

### 4.4 cURL 生成器 + 敏感头「总是提示」

**`src/logic/curl.js`**:
```js
export const SENSITIVE_HEADERS = ['cookie', 'authorization', 'set-cookie', 'proxy-authorization'];
export function hasSensitive(detail) { /* 头名小写比对 SENSITIVE_HEADERS,返回 bool */ }
export function toCurl(detail, { includeSensitive = false } = {}) { /* 返回 cURL 字符串 */ }
```
- `toCurl` 规则:
  - method 为 GET → 省略 `-X`;其余显式 `-X METHOD`;
  - 逐请求头 `-H 'Name: Value'`(值内单引号转义为 `'\''`);`includeSensitive=false` 时跳过 `SENSITIVE_HEADERS`;
  - 字符串请求体 → `--data '...'`;二进制请求体 → 注释 `# 请求体为二进制(base64 编码,重放需先解码)` + `--data-binary @<(printf '%s' '<base64>' | base64 -d)`;
  - 末尾 `'<URL>'`(URL 内单引号转义)。
- 单行或多行由实现定(倾向单行 + 反斜杠续行,便于复制)。

**「总是提示」交互**(前端,`manage.js`):
- 行内 cURL 按钮 / Modal 复制按钮点击 → 调 `toCurl(detail,{includeSensitive:false})` 生成脱敏版;
- 若 `hasSensitive(detail)` → 弹确认条:`此请求含 Cookie/Authorization 等敏感头,复制完整 cURL 可能泄露凭据`,三按钮:
  - **复制完整** → `toCurl(detail,{includeSensitive:true})`;
  - **复制脱敏版** → 已生成的脱敏版 + 末尾注释 `# 已隐藏 N 个敏感头`;
  - **取消** → 不复制;
- → `navigator.clipboard.writeText(text)` → toast(`已复制 cURL`)。无敏感头则直接复制脱敏版。

### 4.5 批量导出 + 勾选列

**勾选列**:
- 表格首列加 `<input type="checkbox">`;表头全选 checkbox,**全选作用于当前筛选结果**(`state.filtered` 全部 id),非仅当前页;
- 勾选跨页保留:`state.selected = new Set([id...])`;翻页、改 filter 时不清空(但若 filter 缩小到不含已选项,该项仍在 Set 中,导出时以最新 `getRequestDetail` 为准)。

**批量操作条**(sticky 底部):
- `state.selected.size === 0` → 隐藏;
- `> 0` → 浮出:`已选 N 条` + `[Postman][JMeter][HAR][JSON]` + `[清除选择]`。

**导出流程**:
1. `ids = state.selected.size ? [...state.selected] : state.filtered.map(r => r.id)`;
2. `details = await send({type:'GET_DETAILS_BY_IDS', ids})`(单事务批量合并 body,避免 N 次 `GET_DETAIL`);
3. `text = exportAs(format, details)`;
4. Blob 下载:`api-catcher-<format>-<ts>.<ext>`(ext: postman→`json`/jmeter→`jmx`/har→`har`/json→`json`)。

**四格式纯逻辑导出器**(输入 `Detail[]`,输出字符串):
- **HAR 1.2**(`har.js`):标准 `log.entries[]`;二进制 response body → `content.encoding="base64"` + `content.text=base64`;请求体二进制 → `postData.text=base64` + 自定义 `postData._encoding="base64"`(HAR 无标准字段,标注)。
- **Postman v2.1**(`postman.js`):`collection.info.schema=v2.1.0`,`item[]` 每条一个 request;`header[]`;body:字符串→`mode:'raw'`,`raw:text`;二进制→`mode:'raw'`+base64+注释。
- **JMeter**(`jmeter.js`):`.jmx` XML,`jmeterTestPlan`/`hashTree`/`HTTPSamplerProxy`;body 二进制 → body 区放 base64 + 注释(已知局限)。
- **JSON**(`json.js`):直接 `JSON.stringify(details, null, 2)`,含 `isBinary` 标志,最忠实的自我导出。
- `index.js`:`exportAs(format, details)` 路由到上述四个。

### 4.6 实时刷新(智能暂停)

**管理页 listener**(新增):
- 收 `NEW_REQUEST` / `REQUEST_UPDATED` → 把 id 累积进 `pendingIds`(Set)+ 启动 250ms debounce 定时器(已存在则不清除,等触发);
- debounce 触发:`details = await send({type:'GET_DETAILS_BY_IDS', ids:[...pendingIds]})`;逐条:NEW → unshift 进 `state.all`(若 `state.all.length > 5000` 则裁剪尾部,与 `GET_ALL` 的 `ALL_PAGE_SIZE` 一致);UPDATED → 找到同 id 替换字段(`status/statusText/duration/responseBodySize/responseHeaders` 等);清空 `pendingIds`;
- **智能暂停判定**:`isLiveView = (state.page === 1) && 无 search/method/status/time/responseTime 任意 filter`;`isLiveView` → `renderTable()`(新条挤入顶部);否则 `newCount++` 并显示提示条;
- `REQUEST_UPDATED`:静默更新 `state.all`,若该条在当前页则轻量重渲染该行(低频,直接 `renderTable()` 可接受)。

**提示条**(顶部 sticky):`● 录制中 · 有 N 条新请求 [查看]`;点击 → `loadAll()` + `state.page=1` + `newCount=0` + 隐藏提示条。

### 4.7 UI 增量(`manage.html` / `manage.css` / `icons.js`)

- **表格**:首列 checkbox(全选);行尾操作列由单 `eye` 改为 `eye`(详情)+ `copy`(cURL)两按钮。
- **批量操作条**:见 §4.5。
- **详情 Modal**:tab 增加「cURL」(现有 headers/request/response 之外);展示 `toCurl(detail,{includeSensitive:false})` 脱敏版于 `<pre>`,下方「复制」按钮走 §4.4 敏感头提示流程。
- **提示条**:见 §4.6。
- **`icons.js`**:新增 `copy`、`download`(或复用)、`checkbox` 相关 SVG。
- **约束**:改 `manage.html`/`manage.js` 的 Tailwind class 后**必须 `npm run build:css`** 重跑(Phase 2 既有约束)。

---

## 5. 数据结构与协议变更

### 5.1 IndexedDB schema
**无 schema 变更**。`requests` 表字段不变;`bodies` 表已有 `{bodyKey, content, isBinary, size}`(`isBinary` 已存在,Phase 3 开始真正写入与读取)。`by-url` 索引已建,本期首次被查询使用。

### 5.2 `getRequestDetail` 返回(扩展)
现有:`{...record, requestBody, responseBody}`。
扩展为:`{...record, requestBody, responseBody, requestBodyIsBinary, responseBodyIsBinary}`。
- inline body → `isBinary=false`;
- bodies 表 body → 读 `row.isBinary`;
- `requestBody`/`responseBody` 仍为字符串(base64 或原文),保持 `renderBody` 向后兼容。

### 5.3 消息协议

| type | 方向 | payload | 变更 |
|---|---|---|---|
| `RECORD_INJECT` / `RECORD_DEVTOOLS` | 页→SW | (不变,但 raw 现可含 base64 body + isBinary) | 字段扩展 |
| `SET_GLOBAL` / `SET_TAB` / `GET_RECORDING_STATE` | — | — | 不变 |
| `GET_ALL` / `GET_LIST` / `GET_DETAIL` | 页→SW | — | 不变 |
| **`GET_DETAILS_BY_IDS`** | 页→SW | `{type, ids:[]}` → `{details: Detail[]}` | **新增** |
| **`NEW_REQUEST`** | SW→页(广播) | `{type, id}` | **新增** |
| **`REQUEST_UPDATED`** | SW→页(广播) | `{type, id}` | **新增** |

ingest 内部流程变更(去重 DB 化)非消息,见 §4.2。

---

## 6. 测试策略

### 6.1 vitest 单测(纯逻辑)
- `base64.js`:`bytesToBase64` 对 string/ArrayBuffer/TypedArray/Blob(异步)/空输入,与 `atob` 互验;大数组分块不爆栈。
- `curl.js`:`toCurl` 各 method;敏感头过滤(`hasSensitive` 判定、`includeSensitive` 开关);字符串/二进制 body;URL/header 单引号转义;固定 fixture 断言输出子串。
- `exporters/*`:四格式固定 `Detail[]` fixture → 断言关键结构(HAR 的 `encoding:"base64"`、Postman schema 版本、JMeter XML 骨架、JSON 含 isBinary)。
- `db.findDuplicateByRequest`:fake-indexeddb 注入同 url 不同 method/超窗口/不同 bodySize 的记录,验证只命中同 method+窗口内+同 bodySize。
- `db.getDetailsByIds`:批量合并 body + isBinary 回填。
- `normalize`:二进制分支(isBinary 透传、base64 content)。
- 现有 37 个单测保持绿色(去重改 DB 真相源后,`dedupe.test.js` 若依赖生产路径需调整;`makeKey/findDuplicate/pickMoreComplete` 作为纯函数单测保留)。

### 6.2 集成验证(`test/integration/phase3-verify.mjs`,playwright headed)
复用 Phase 2 基建(`setInterval` 200ms + 15s 超时轮询等 SW,**勿用** `waitForEvent('serviceworker')`;chromium-1223 ↔ playwright@1.60.0,装时 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`)。覆盖:
1. **实时刷新**:打开管理页 + 开录制 → 触发页面请求 → 新行自动出现在列表顶部(无需手动刷新)。
2. **智能暂停**:翻到第 2 页 → 触发新请求 → 列表不跳,提示条出现「N 条新请求」→ 点击 → 回到第 1 页 + 新行可见。
3. **去重 DB 真相源**:并发(inject + devtools 双抓同一 GET)→ 管理页只 1 条(M9 回归)。
4. **勾选 + 导出**:勾选若干 → 导出 4 格式 → 产物文件存在且 `JSON.parse`/XML 结构可解析;无勾选时导出当前筛选结果。
5. **行内 cURL**:点 cURL 按钮 → 剪贴板含 `curl` 字样;含敏感头时确认弹窗出现。
6. **二进制捕获**:测试页发起 `FormData` / `Blob` 上传 → 管理页详情/导出含 base64 + isBinary=true。

### 6.3 仍需真实 Chrome 手动验证(集成脚本难覆盖)
- service worker 空闲被杀重启后,旧请求不重复、新请求正常去重(SW 重启 bug 回归)。
- 敏感头确认弹窗的视觉与三按钮交互。
- 批量操作条 sticky 视觉与隐藏/浮出过渡。
- Modal cURL tab 的脱敏展示与复制流程。
- 控制台无 CSP 报错。

---

## 7. 已知局限与风险

1. **JMeter 二进制/FormData**:JMeter 原生二进制 body 支持弱,`.jmx` 里 body 区放 base64 + 注释,需用户手动解码处理。用户已确认接受。
2. **cURL 二进制进程替换**:`@<(base64 -d)` 仅 Linux/mac 友好,Windows cmd/PowerShell 不直接支持;Windows 用户需先 `base64 -d > body.bin` 再 `--data-binary @body.bin`。用户已确认接受。
3. **base64 体积**:base64 比原始字节大约 33%;大文件上传/下载的 body 会占用更多 IndexedDB 空间。可接受(请求量非海量,且有 64KB 内联阈值)。
4. **FormData boundary**:用 `new Response(fd)` 重建的 boundary 与原请求不同,但 multipart 结构完整,cURL 重放服务端能正确解析。
5. **实时刷新高频**:极端高频(如每秒数十请求)下 250ms debounce 仍会频繁 `GET_DETAILS_BY_IDS`;若实测卡顿,可将 debounce 提到 500ms 或在提示条模式(非 live view)下完全不拉取 detail、只计数。
6. **`state.recent` 移除的回归面**:`dedupe.js` 生产路径不再使用,需确认无其他引用;单测中 `makeKey/findDuplicate` 保留为纯函数测试。

---

## 8. 实现顺序建议(供 writing-plans 参考)

按依赖与风险从低到高,先纯逻辑后集成:
1. **base64.js + 单测**(无依赖,基础设施)。
2. **db 改造**:`findDuplicateByRequest` + `getDetailsByIds` + `getRequestDetail` isBinary 回填 + 单测。
3. **去重 DB 真相源**:background.ingest 改造 + 移除 recent + 广播 + 单测/集成。
4. **M8 inject 捕获**:`encodeBody` + 响应体二进制分支 + normalize 透传 + 单测。
5. **curl.js + 单测**。
6. **exporters/* + index.js + 单测**。
7. **消费端消息**:`GET_DETAILS_BY_IDS` 消息处理。
8. **manage.js 消费**:勾选列 + 批量操作条 + 行内 cURL + Modal curl tab + 敏感头提示 + 实时刷新 listener + 提示条。
9. **UI**:manage.html/css/icons.js + `npm run build:css`。
10. **集成验证** `phase3-verify.mjs` + 手动验证清单。
