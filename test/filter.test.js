import { describe, it, expect } from 'vitest';
import { shouldKeep } from '../src/logic/filter.js';

describe('shouldKeep', () => {
  it('保留 xhr/fetch 类型', () => {
    expect(shouldKeep({ url: 'https://a.com/api/u', resourceType: 'xhr' })).toBe(true);
    expect(shouldKeep({ url: 'https://a.com/api/u', resourceType: 'fetch' })).toBe(true);
  });

  it('丢弃静态资源类型', () => {
    for (const t of ['script', 'stylesheet', 'image', 'font', 'media', 'manifest']) {
      expect(shouldKeep({ url: 'https://a.com/x', resourceType: t })).toBe(false);
    }
  });

  it('丢弃静态资源 URL 后缀', () => {
    for (const u of [
      'https://a.com/app.js', 'https://a.com/style.css', 'https://a.com/a.png',
      'https://a.com/b.JPG', 'https://a.com/c.WEBP', 'https://a.com/f.woff2',
      'https://a.com/i.ico', 'https://a.com/v.mp4',
    ]) {
      expect(shouldKeep({ url: u, resourceType: 'fetch' })).toBe(false);
    }
  });

  it('丢弃埋点黑名单 URL', () => {
    expect(shouldKeep({ url: 'https://www.google-analytics.com/collect', resourceType: 'xhr' })).toBe(false);
    expect(shouldKeep({ url: 'https://xxx.umeng.com/track', resourceType: 'fetch' })).toBe(false);
    expect(shouldKeep({ url: 'https://hm.baidu.com/hm.js', resourceType: 'script' })).toBe(false);
  });

  it('丢弃 SSE / WebSocket', () => {
    expect(shouldKeep({ url: 'https://a.com/stream', resourceType: 'eventsource' })).toBe(false);
    expect(shouldKeep({ url: 'wss://a.com/ws', resourceType: 'websocket' })).toBe(false);
  });

  it('保留 multipart 文件上传', () => {
    expect(shouldKeep({ url: 'https://a.com/upload', resourceType: 'xhr', responseMimeType: 'multipart/form-data' })).toBe(true);
  });

  it('保留普通 JSON 接口', () => {
    expect(shouldKeep({ url: 'https://a.com/api/list', resourceType: 'xhr', responseMimeType: 'application/json' })).toBe(true);
  });
});
