import blacklist from '../data/trackerBlacklist.js';

const DROP_TYPES = new Set(['script', 'stylesheet', 'image', 'font', 'media', 'manifest', 'eventsource', 'websocket']);

const DROP_EXT = new Set([
  '.js', '.mjs', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg',
  '.webp', '.woff', '.woff2', '.ttf', '.eot', '.ico', '.mp4',
  '.webm', '.mp3', '.map',
]);

function extOf(url) {
  const clean = url.split('?')[0].split('#')[0];
  const slash = clean.lastIndexOf('/');
  const file = slash >= 0 ? clean.slice(slash + 1) : clean;
  const dot = file.lastIndexOf('.');
  return dot >= 0 ? file.slice(dot).toLowerCase() : '';
}

function isTracker(url) {
  const lower = url.toLowerCase();
  return blacklist.some((kw) => lower.includes(kw));
}

export function shouldKeep(r) {
  if (!r || !r.url) return false;
  if (DROP_TYPES.has(r.resourceType)) return false;
  if (DROP_EXT.has(extOf(r.url))) return false;
  if (isTracker(r.url)) return false;
  return true;
}
