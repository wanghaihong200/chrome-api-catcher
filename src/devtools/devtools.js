// 入口页(不可见):仅负责注册 DevTools 面板
// 注意: pagePath 相对【扩展根目录】, 不是相对本脚本文件
chrome.devtools.panels.create('API Catcher', '', 'src/devtools/panel.html');
