# 发布指南

发布包:**`dist/chrome-api-catcher-1.0.0.zip`**(manifest.json 在 zip 根,含 src/ + icons/ + assets/ + README + LICENSE + PRIVACY)。Chrome 与 Edge 通用同一份 zip。

---

## 重新打包(代码更新后)

在仓库根目录执行:
```bash
mkdir -p dist
powershell.exe -NoProfile -Command "Compress-Archive -Path manifest.json,src,icons,assets,README.md,LICENSE,PRIVACY.md -DestinationPath dist/chrome-api-catcher-1.0.0.zip -Force"
```

---

## 一、Chrome Web Store 发布

1. **注册开发者账号**:https://chrome.google.com/webstore/devconsole/(需一次性 $5 注册费,Google 账号登录)。
2. **新建项目**:点「项目」→「新建项目」→ **上传 `dist/chrome-api-catcher-1.0.0.zip`**。
3. **填写商品信息**(见下方「商店素材」):
   - 名称、简短/详细描述、类别(开发者工具)、语言(中文 + 英文可选)
   - 图标:已在 zip 内(128px),Store 还要一个 128x128 商店图标(可用 `icons/icon128.png`)
   - **截图**:至少 1 张,尺寸 **1280×800** 或 640×400(`assets/` 里的截图需调整到此尺寸,或重新截图)
   - 权限说明(说明为何需要各权限)
   - **隐私政策 URL**:`https://github.com/wanghaihong200/chrome-api-catcher/blob/main/PRIVACY.md`
4. **提交审核**:点「提交审核」。审核通常几小时到几天。审核反馈会在开发者控制台显示。

> Chrome 审核重点:`<all_urls>` + `scripting` 权限会被仔细审查,务必在权限说明里讲清楚「仅在用户开启录制时抓取,数据仅本地存储」(已在 PRIVACY.md 阐述)。

---

## 二、Microsoft Edge Add-ons 发布

1. **注册 Partner Center**:https://partner.microsoft.com/dashboard/microsoftedge(免费,Microsoft 账号登录)。
2. **创建扩展**:点「Create new extension」→ **上传同一份 `dist/chrome-api-catcher-1.0.0.zip`**(Edge 完全兼容 Chrome MV3 扩展)。
3. **填写信息**:名称、描述、类别、截图(同 Chrome)、隐私政策 URL、权限说明。
4. **提交审核**:点「Publish」。审核通常几小时到几天。

> Edge 与 Chrome 共用同一份 zip,无需改动。Edge 商店审核通常比 Chrome 略快。

---

## 商店素材(文案)

### 名称
API Catcher

### 简短描述(132 字符内)
抓取网页接口调用,生成可复用的 cURL,支持搜索筛选与 Postman/JMeter/HAR/JSON 批量导出。

### 详细描述
API Catcher 是一款接口调试利器(Chrome MV3 扩展),帮你抓取网页调用的接口(fetch / XHR),一键生成 cURL,并批量导出到主流测试工具。

**核心功能:**
- 🔌 双路径抓取(页面 hook + DevTools 面板),互为补充
- 📋 一键生成 cURL,敏感头(Cookie/Authorization)可切换显示/隐藏
- 📤 批量导出:Postman v2.1 / JMeter / HAR / JSON
- 🔍 搜索 + 多维筛选(方法/状态/响应时间/自定义时间段)
- ⚡ 录制时列表实时刷新(智能暂停,不跳页)
- ⏺️ 录制开关默认关闭(全局 + 标签页,白名单心智)
- 🗂️ 二进制请求体(FormData/Blob)以 base64 保存,导出可重放

**数据安全:** 所有抓取的数据仅存储在本地浏览器(IndexedDB),不上传任何服务器。详见隐私政策。

**开源:** https://github.com/wanghaihong200/chrome-api-catcher

### 类别
开发者工具(Developer Tools)

### 权限说明(提交审核时填)
- `storage`:本地保存抓取的请求与录制开关状态
- `scripting` / `activeTab` / `tabs`:在用户开启录制的标签页注入抓取脚本
- `<all_urls>`:抓取用户在任意网站发起的接口请求(仅录制开启时,默认关闭)

所有数据仅存本地,无任何数据上传。详见隐私政策。

---

## 发布前自检清单

- [x] manifest.json 在 zip 根
- [x] 图标 16/48/128 px(icon128.png ≥ 128×128)
- [x] 隐私政策(PRIVACY.md,有公开 URL)
- [ ] 截图调整为 1280×800(至少 1 张,最多 5 张)
- [ ] 版本号 1.0.0(manifest 已设)
- [x] 代码功能验证(62 单测 + 6 集成场景全绿)
