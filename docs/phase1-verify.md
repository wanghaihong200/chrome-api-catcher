# Phase 1 验证清单

## 加载插件
1. Chrome 打开 `chrome://extensions`,开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选 `chrome-api-catcher/` 目录

## 录制开关说明(Phase 1)
Phase 1 的录制开关在 DevTools 面板(popup 全局开关留待 Phase 2):
1. 在目标标签页按 F12 → 找到 "API Catcher" 面板
2. 点「录制:OFF」切到 ON(默认关闭,需手动开启)

## 注入路径验证
1. 标签页打开 `test/manual/test-page.html`(file:// 或本地 server)
2. F12 → API Catcher 面板 → 录制 ON
3. 回测试页点「GET JSON」「POST JSON」「XHR」「multipart」
4. F12 → Application → IndexedDB → api-catcher → requests
   - [ ] 出现 4 条记录(method/url 正确)
   - [ ] 响应体在内联字段或 bodies 表
5. 点「埋点 URL」→ requests 表**不增加**(被过滤)
6. 点「加载 .js」→ requests 表**不增加**(被过滤)

## DevTools 路径验证
1. 新标签打开测试页,F12 → API Catcher 面板 → 录制 ON
2. 点「GET JSON」
3. IndexedDB 应收到请求(与注入同请求,2 秒内同 key 被去重)

## 去重验证
- 同一 GET 在 2 秒内被注入+DevTools 各抓一次 → requests 只增 1 条
- 间隔 >2 秒再发 → 视为新请求,增 1 条

## 全部单测
- [ ] `npm test` 全绿(21/21: filter 7 / dedupe 7 / normalize 3 / db 4)
