# Chrome API Catcher · Phase 2 设计文档

- 日期:2026-07-24
- 状态:已确认,待编写实现计划
- 上一阶段:Phase 1「地基」已完成验证(phase1 分支,21/21 单测 + 浏览器验证通过)
- 视觉基准:`D:\java_study\创业\接口抓取数据展示.html`(用户指定,直接作为管理页 UI 蓝本)

## 1. 目标

在 Phase 1 抓取地基之上,交付一个**独立管理页**:以用户指定的参考文件为 UI 蓝本,展示已抓取的接口列表,支持分页、搜索、高级筛选、统计卡片、详情查看;并提供 popup 全局录制开关 + 标签页录制开关。同时清理 Phase 1 遗留的关键债务(尤其 URL 规范化导致的去重错配)。

## 2. 范围

### 2.1 本阶段做(In)

- **独立管理页**(`src/manage/manage.html`):照参考文件「表格 + Modal」布局,视觉风格(品牌蓝 `#3b6af5`、浅色主题、统计卡、彩色 method/status badge、JetBrains Mono 代码块)1:1 对齐。
- **分页**:10 / 20 / 50,默认 10。
- **搜索**:匹配 URL(含路径)、HTTP 方法、状态码。
- **高级筛选下拉**:方法 / 状态码 / 时间范围 / 响应时间。
- **统计卡片×4**:全部接口 / 今日新增 / 异常接口 / 平均响应时间。
- **详情 Modal**:Headers(请求头 + 响应头)、请求体、响应体 三个 tab。
- **popup**:全局录制开关 + 当前激活标签页开关 +「打开管理页」按钮 + 录制状态提示。
- **devtools panel**:录制开关改为「本审查标签页开关」(读写当前标签页 per-tab 状态)。
- **录制语义**:全局开关 AND 标签页开关,**两者默认均为 OFF**,需显式开启。
- **Phase 1 债务清理**:URL 规范化(必清)、M7 详情 body 懒加载(必做)、M6 去重合并增强(顺带)、M2 normalize 断言补充(顺带)。

### 2.2 本阶段不做(Out,留 Phase 3)

- cURL 生成与复制(行内 cURL 按钮、详情 curl tab)
- 批量导出(Postman / JMeter / HAR / JSON)
- 列表实时自动刷新(管理页改为手动「刷新」按钮)
- M8 二进制 base64 解码、M9 并发去重竞态、M10 by-url 索引利用(非阻塞,视情况)

> 参考文件中对应这些功能的 UI(实时刷新 toggle、批量导出下拉、行内 cURL 按钮、详情 curl tab)在 Phase 2 移除。

## 3. 架构决策

### 3.1 数据查询:前端持有数据(方案 A)

管理页打开时一次性向 background 请求**全部请求元数据**(不含大响应体),在内存中完成搜索 / 筛选 / 分页 / 统计。理由:

- 个人抓包工具数据量级为百~千条,前端轻松驾驭;
- 统计卡片本就需全量聚合,前端持数据后统计是顺手的事;
- 与参考文件的前端过滤模型完全一致,改造成本最低。

**bodies 表中 >64KB 的大响应体不进内存**,列表只持元数据;点开详情时按 `responseBodyKey` / `requestBodyKey` 用 `getBody` 取回合并(同时清 M7)。

> 权衡:若未来数据量过万,可切换为 background 端 IndexedDB 游标查询(方案 B);当前不做。

### 3.2 纯逻辑无 DOM 依赖

延续 Phase 1 模式:录制开关判定、URL 规范化、去重合并等纯逻辑放 `src/logic/`,无 DOM 依赖,vitest 单测覆盖。

### 3.3 录制状态:storage 为唯一真相源

`chrome.storage.local` 是录制状态的 source of truth;background 启动时加载到内存,并监听 `chrome.storage.onChanged` 同步内存镜像。popup / panel / 管理页直接读写 storage;`ingest` 用内存镜像判定(避免每次读 storage 的异步开销)。

## 4. 文件结构

### 4.1 新增

| 文件 | 职责 |
|---|---|
| `src/manage/manage.html` | 管理页结构(照参考裁剪) |
| `src/manage/manage.js` | 外联脚本:数据加载、搜索/筛选/分页/统计、Modal、刷新 |
| `src/manage/manage.css` | 自定义样式(badge / toggle / 分页 / code-block 等,源自参考 `<style>`) |
| `src/manage/icons.js` | SVG 图标集,替代 Font Awesome |
| `src/manage/tailwind-input.css` | `@tailwind base/components/utilities` 指令入口 |
| `src/manage/tailwind.css` | 构建产物(本地化 Tailwind),被 `manage.html` 引用 |
| `src/popup/popup.html` / `popup.js` / `popup.css` | popup 界面 |
| `src/logic/recording.js` | 纯函数:`shouldRecord(state, tabId)`、状态合并工具 |
| `tailwind.config.js` | Tailwind 配置(content 扫描 manage 目录,brand/surface 语义色) |

### 4.2 修改

| 文件 | 改动 |
|---|---|
| `manifest.json` | `action` 加 `default_popup: src/popup/popup.html`;录制相关消息扩容 |
| `background/background.js` | 录制开关(global + per-tab)、`GET_ALL`、`GET_DETAIL` 合并 body、`SET_GLOBAL`/`SET_TAB`、storage 同步、tab 关闭清理 |
| `background/db.js` | `getRequest` 支持按需合并 body(M7);新增 `updateRequest`(M6 回写);`listRequests` 支持大 pageSize |
| `background/dedupe.js` | 接入 `pickMoreComplete`,去重命中时回写更完整条目(M6) |
| `logic/normalize.js` | 新增 `normalizeUrl(url, base)` 兜底;补 devtools 断言(M2) |
| `inject/inject.js` | XHR hook 把相对 URL 绝对化(URL 债务根源) |
| `devtools/panel.js` / `panel.html` | 开关改为「本审查标签页开关」,读写 per-tab 状态 |

## 5. 数据模型与存储

### 5.1 请求记录(沿用 Phase 1 schema,无破坏性变更)

`requests` 主表字段(平铺):`id, timestamp, tabId, tabUrl, url, method, status, statusText, requestHeaders, requestBodyKey, requestBodyInline, requestBodySize, hasRequestBody, responseHeaders, responseBodyKey, responseBodyInline, responseBodySize, hasResponseBody, responseMimeType, resourceType, source, duration`。`bodies` 表:`{ bodyKey, content, isBinary, size }`。

### 5.2 录制状态(chrome.storage.local)

```jsonc
// key: "recording"
{
  "global": false,        // 全局总闸,默认 false
  "tabs": {               // 仅记录显式操作过的标签页
    // [tabId]: true/false;未出现 = 视为 false(OFF)
  }
}
```

**判定(纯函数 `shouldRecord`)`src/logic/recording.js`:**

```js
export function shouldRecord(state, tabId) {
  return state.global === true && state.tabs?.[tabId] === true;
}
```

语义:**全局 ON 且该标签页显式 ON** 才入库。两者默认 OFF。

## 6. 录制开关交互

### 6.1 popup

- 全局开关 toggle(读写 `recording.global`)
- 当前激活标签页开关 toggle + 标签页标题/URL(读写 `recording.tabs[currentTabId]`)
- 「打开管理页」按钮 → `chrome.tabs.create({ url: chrome.runtime.getURL('src/manage/manage.html') })`
- 状态提示文字,反映四种状态:
  - 全局关:「录制已关闭(全局)」
  - 全局开 + 当前标签页关:「全局已开,当前标签页未开启」
  - 全局开 + 当前标签页开:「正在录制当前标签页」
  - 当前标签页不可录制(如 chrome://):禁用并提示

popup 打开时通过 `chrome.tabs.query({active:true,currentWindow:true})` 取当前标签页;直接读写 storage,无需消息往返。

### 6.2 devtools panel

- 一个 toggle:控制 `recording.tabs[inspectedWindow.tabId]`
- 若 `recording.global === false`,提示「需先在 popup 开启全局开关」,toggle 仍可操作但提示全局未开
- 移除 Phase 1 的单一全局开关语义

### 6.3 管理页 header

- 全局开关 toggle(与 popup 同步同一 storage key)

### 6.4 background

- 启动:从 storage 读 `recording` 到内存 `state.recording`
- 监听 `chrome.storage.onChanged`:同步内存
- `ingest(entry)`:`if (!shouldRecord(state.recording, entry.tabId)) return;`
- `chrome.tabs.onRemoved`:清理 `recording.tabs[tabId]`(写回 storage)

## 7. background 消息协议

| 消息 | 方向 | 用途 | 改动 |
|---|---|---|---|
| `RECORD_INJECT` / `RECORD_DEVTOOLS` | → bg | 抓取入库 | 不变(受开关 + 过滤 + 去重约束) |
| `GET_ALL` | → bg | 返回全部元数据 `{items, total}`(按时间倒序) | **新增** |
| `GET_DETAIL` | → bg | 返回单条记录(合并 body 后) | **改**:合并 `requestBody`/`responseBody` |
| `SET_GLOBAL` `{value}` | → bg | 设全局开关 | **改**(原 `SET_RECORDING`) |
| `SET_TAB` `{tabId, value}` | → bg | 设标签页开关 | **新增** |
| `GET_RECORDING_STATE` `{tabId?}` | → bg | 返回 `{global, tabOn}` | **改**(原 `GET_RECORDING`) |
| `GET_LIST` | → bg | 分页列表 | 保留(panel/兼容) |

> popup/panel 主要直接读写 storage;消息通道用于 background 内存同步与详情/全量数据获取。

## 8. 管理页 UI(照参考裁剪)

### 8.1 保留(视觉与交互 1:1 对齐参考)

- **Header**:logo + 标题「API 接口看板」;右侧 = **全局录制开关 toggle + 手动「刷新」按钮**(移除参考的实时刷新 toggle 与批量导出下拉)
- **统计卡片×4**(主数字 / 次级信息):
  - 全部接口:主 = 总条数,次级 =「异常 N 条」
  - 今日新增:主 = 今日条数(timestamp ≥ 当日 0 点),次级 =「最近 24h:M 条」
  - 异常接口:主 = status≥400 条数,次级 =「占比 x%」
  - 平均响应时间:主 = duration 均值(ms),次级 =「最慢 N ms」
  - 参考的「较上周 / 较昨日」趋势无历史数据支撑,一律不展示
- **筛选栏**:搜索框 + 方法下拉(GET/POST/PUT/DELETE/PATCH)+ 状态下拉(2xx/3xx/4xx/5xx)+ 时间范围下拉(1h/6h/24h/7d)+ 响应时间下拉(<100ms / 100-500ms / >500ms)+ 清除筛选
- **数据表格**:方法 badge + URL/路径 + 状态码 badge + 响应时间指示点 + 抓取时间 + 操作列(**仅「查看详情」按钮**,移除行内 cURL 按钮与勾选框)
- **分页**:每页 10/20/50 选择器 + 页码导航
- **详情 Modal**:标题栏(method badge + URL + 关闭)+ tab(Headers / 请求体 / 响应体)+ 内容区(Headers 用键值表;请求体/响应体用深色 code-block,JSON 尝试格式化与语法高亮)。移除 curl tab。
- **Toast**:复制反馈等(轻量,保留)

### 8.2 移除 / 占位

- 实时刷新 toggle → 改手动「刷新」按钮(用户未选实时刷新)
- 批量导出下拉 → 移除(Phase 3)
- 行内 cURL 复制按钮 → 移除(Phase 3)
- 详情 curl tab → 移除(Phase 3)
- 勾选列与批量操作条 → 移除(随 Phase 3 批量导出一并加回)

## 9. CSP / Tailwind 构建流程

MV3 扩展页默认 CSP `script-src 'self'` 禁止远程脚本、内联脚本、eval。参考文件的三类违规必须处理:

1. **Tailwind**:用 Tailwind CLI 预编译。
   - `tailwind.config.js`:`content: ['./src/manage/**/*.{html,js}']`,extend 参考的 `brand` / `surface` / 语义色与字体族
   - `src/manage/tailwind-input.css`:`@tailwind base; @tailwind components; @tailwind utilities;`
   - 构建命令(写入 `package.json`):`"build:css": "tailwindcss -i ./src/manage/tailwind-input.css -o ./src/manage/tailwind.css --minify"`
   - 产物 `tailwind.css` 提交进仓库(扩展加载需要);改 HTML/JS 的 class 后重跑构建
2. **Font Awesome**:替换为 `src/manage/icons.js` 内联 SVG 图标集(用到的图标:search、refresh、eye、xmark、chevron-down、plug、plus、triangle-exclamation、clock、check-circle、network-wired 等)
3. **字体**:改系统栈。`system-ui, 'Noto Sans SC', sans-serif` 与 `ui-monospace, 'JetBrains Mono', Menlo, monospace`(本地无字体文件则回退系统等宽)
4. **内联事件**:参考所有 `onclick="..."` → `manage.js` 中 `addEventListener`,JS 全部外联

## 10. Phase 1 债务清理

### 10.1 URL 规范化(必清,根因修复)

**根因**:`inject.js` XHR hook 用 `meta.url = String(url)`,页面传入的相对 URL(如 `/api/x`)原样保存;而 devtools 路径的 HAR `url` 永远是绝对 URL。`makeKey = method|url|bodySize`,url 形态不同 → 同一请求存两条。

**修复**(双保险):
- `inject.js` XHR hook:`meta.url = absUrl(String(url), location.href)`,在请求发生页面用真实 `location.href` 解析(fetch 路径已用 `new Request()` 天然绝对,无需改)
- `logic/normalize.js`:新增 `normalizeUrl(url, base)`:`try { return new URL(url, base).href } catch { return url }`,在 `normalizeInjectRecord` 用 `ctx.tabUrl` 兜底;`normalizeDevtoolsRecord` 的 url 已绝对,经此不变
- 抽 `absUrl`(inject 内,页面侧)与 `normalizeUrl`(logic 内,SW 侧)为可测纯函数;补 normalize 单测(清 M2)

### 10.2 M7 详情 body 懒加载(必做)

`GET_DETAIL`:读取 record 后,若 `responseBodyKey` 存在且 `responseBodyInline` 为空,`getBody` 取回填入 `responseBody`;`requestBody` 同理。返回体:`{ ...record, requestBody: <内容>, responseBody: <内容> }`。

### 10.3 M6 去重合并增强(顺带)

`dedupe.findDuplicate` 命中时,`pickMoreComplete` 比较响应体大小;若新条 `response.body.size > 旧`,调用新增的 `db.updateRequest(id, entry)` 回写更完整的响应部分。若不大于,维持先到先得。

### 10.4 M2 normalize 断言补充(顺带)

随 10.1 补:`normalizeUrl` 相对/绝对/异常输入单测;`normalizeDevtoolsRecord` 的 mimeType/resourceType/duration 等字段断言。

## 11. 测试策略

### 11.1 单元测试(vitest)

- `logic/normalize.js`:`normalizeUrl`(相对→绝对、已是绝对、非法输入)、`normalizeInjectRecord`/`normalizeDevtoolsRecord` URL 兜底与字段断言(M2)
- `logic/recording.js`:`shouldRecord` 四象限(global on/off × tab on/off/未设)
- `background/dedupe.js`:`pickMoreComplete` 接入路径(新条更完整→回写;否则不变)
- `background/db.js`:`getRequest` body 合并(M7)、`updateRequest`(M6)

### 11.2 浏览器验证(playwright)

复用 Phase 1 的 `verify-extension.mjs` 思路(headed + --load-extension):
- 加载扩展 → 打开管理页 → 验证统计卡数字、表格渲染、分页切换(10/20/50)、搜索(url/method/status)、高级筛选、详情 Modal 三 tab、body 展示
- popup:全局开关 + 标签页开关 AND 语义(四种组合下入库行为)、打开管理页
- **URL 去重回归**:同一接口被 inject(相对)+ devtools(绝对)双路径抓取,验证只存一条(债务修复核心验收)
- 录制关闭时不入库

## 12. 验收标准

1. `npm test` 全绿(Phase 1 的 21 条 + Phase 2 新增)
2. `npm run build:css` 产出 `src/manage/tailwind.css`,管理页无 CSP 报错、视觉与参考一致
3. 管理页:表格 / 分页(10·20·50,默认 10)/ 搜索(url·method·status)/ 高级筛选 / 统计卡 / 详情 Modal(Headers·请求体·响应体)均可用
4. popup:全局开关 + 当前标签页开关,默认均 OFF;AND 语义正确;可打开管理页
5. devtools panel:开关为本审查标签页开关
6. URL 去重:相对/绝对双路径同接口只存一条
7. 详情能看到完整请求/响应 body(含 >64KB 懒加载)

## 13. 风险与权衡

- **数据量增长**:方案 A 前端持全量元数据;若单库积累上万条,初始加载与内存有压力。缓解:加载时按时间倒序上限(如 5000 条)+ 提示;长期切方案 B。
- **Tailwind 构建产物体积**:参考用了大量 class,编译后 `tailwind.css` 可能数十~上百 KB(可接受);`--minify` 压缩。
- **CSP 改造遗漏**:任何遗漏的内联 `onclick` 或远程资源都会导致白屏。验证清单逐项核对(management 页控制台无 CSP error)。
- **storage 一致性**:popup/panel 直写 storage,background 靠 `onChanged` 同步内存;开关切换到 ingest 生效有毫秒级窗口,可接受(非 M9 的并发去重竞态)。
- **per-tab 状态残留**:tab 关闭清理;但浏览器重启后 `tabs` 里可能残留已不存在的 tabId(无害,判定时 tabId 不匹配自然 false),可选定期清理。

## 14. 后续(Phase 3 预告,不在本阶段)

cURL 生成器、批量导出(Postman/JMeter/HAR/JSON)、列表实时刷新、二进制 body base64 解码(M8)、并发去重竞态(M9)、by-url 索引查询加速(M10)、勾选列 + 批量操作条随导出一并加回。
