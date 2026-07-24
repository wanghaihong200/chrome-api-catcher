// Phase 2 集成验证(playwright headed + --load-extension)
// 参考同目录上级的 verify-extension.mjs 健壮模式:轮询等 SW、清库、try/finally close。
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(__dirname, '..', '..');
const PROFILE = path.join(EXT_DIR, '.test-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });

const log = (...a) => console.log('[verify]', ...a);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
});

let ok = true;
try {
  // 1) 轮询等 service worker
  let sw = ctx.serviceWorkers()[0];
  if (!sw) {
    log('等待 service worker...');
    const got = await new Promise((resolve) => {
      const t = setInterval(() => { sw = ctx.serviceWorkers()[0]; if (sw) { clearInterval(t); resolve(true); } }, 200);
      setTimeout(() => { clearInterval(t); resolve(false); }, 15000);
    });
    if (!got || !sw) throw new Error('service worker 未启动');
  }
  log('service worker:', sw.url());
  const extId = new URL(sw.url()).hostname;
  const manageUrl = `chrome-extension://${extId}/src/manage/manage.html`;

  // 2) 清库
  await sw.evaluate(() => new Promise((r) => { const req = indexedDB.deleteDatabase('api-catcher'); req.onsuccess = req.onerror = req.onblocked = r; }));
  log('已清库');

  // 3) 打开管理页,预设全局+tab1 开关 ON
  const managePage = await ctx.newPage();
  await managePage.goto(manageUrl);
  await managePage.evaluate(async () => {
    await chrome.storage.local.set({ recording: { global: true, tabs: { 1: true } } });
  });
  await managePage.waitForTimeout(400); // 等 storage.onChanged 同步 background 内存镜像
  log('已预设开关 global+tab1=ON');

  // 4) 注入 3 条 devtools 形态记录(第 1、3 条同 url 同 key → 去重,期望入库 2 条)
  const injectRes = await managePage.evaluate(async () => {
    const mk = (url, status, dur, ts) => ({
      request: { url, method: 'GET', headers: [] },
      response: { status, statusText: 'OK', headers: [{ name: 'Content-Type', value: 'application/json' }], mimeType: 'application/json' },
      _resourceType: 'xhr', time: dur, startedDateTime: new Date(ts).toISOString(),
    });
    const now = Date.now();
    const out = [];
    for (const r of [
      mk('https://test.local/api/users', 200, 45, now),
      mk('https://test.local/api/orders', 500, 800, now - 1000),
      mk('https://test.local/api/users', 200, 45, now),
    ]) {
      out.push(await chrome.runtime.sendMessage({ type: 'RECORD_DEVTOOLS', har: r, responseBody: '{"ok":1}', tabId: 1, tabUrl: 'https://test.local' }));
    }
    return out;
  });
  log('注入响应:', JSON.stringify(injectRes));

  // 5) 直接查 IndexedDB 确认去重(独立于管理页 UI)
  const records = await sw.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('api-catcher'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    if (!db.objectStoreNames.contains('requests')) return { error: 'no requests store' };
    const all = await new Promise((res, rej) => { const r = db.transaction('requests', 'readonly').objectStore('requests').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return all.map((r) => ({ url: r.url, status: r.status, source: r.source }));
  });
  if (Array.isArray(records)) {
    log(`IndexedDB 记录数: ${records.length}`);
    for (const r of records) log(`  - ${r.url} ${r.status} src=${r.source}`);
    if (records.length === 2) log('✅ 去重生效(3 注入 → 2 入库)');
    else { log('❌ 去重失效:期望 2,实际', records.length); ok = false; }
  } else { log('❌ DB 错误:', records); ok = false; }

  // 6) 管理页 UI 验证
  await managePage.reload();
  await managePage.waitForTimeout(600);
  const total = await managePage.locator('#statTotal').textContent();
  const errorCount = await managePage.locator('#statError').textContent();
  log(`统计 全部:${total} 异常:${errorCount}`);
  const rows = await managePage.locator('#tableBody tr').count();
  log('表格行数:', rows);
  await managePage.fill('#searchInput', 'users');
  await managePage.waitForTimeout(300);
  const searched = await managePage.locator('#tableBody tr').count();
  log('搜索 users 行数:', searched);
  await managePage.fill('#searchInput', '');
  await managePage.waitForTimeout(200);
  await managePage.locator('.detail-open').first().click();
  await managePage.waitForTimeout(300);
  const modalVisible = await managePage.locator('#detailModal').evaluate((el) => !el.classList.contains('hidden'));
  const respBodyShown = await managePage.locator('#content-response .code-block').count();
  log(`Modal 打开:${modalVisible} 响应体展示:${respBodyShown > 0}`);

  if (rows !== 2) { log('❌ 表格行数期望 2'); ok = false; }
  if (searched !== 1) { log('❌ 搜索失效'); ok = false; }
  if (!modalVisible) { log('❌ Modal 未打开'); ok = false; }
  log(ok ? '✅ Phase 2 自动化核心检查通过' : '❌ 存在失败项');
} catch (e) {
  console.error('[verify] 异常:', e.message);
  ok = false;
} finally {
  await ctx.close();
}
process.exit(ok ? 0 : 1);
