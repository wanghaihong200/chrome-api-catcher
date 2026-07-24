// SVG 图标集,替代 Font Awesome。stroke 风格 24x24,currentColor,由 manage.js 注入。
const s = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="1em" height="1em">${inner}</svg>`;
export const ICONS = {
  logo: s('<rect x="2" y="9" width="6" height="6" rx="1"/><rect x="16" y="9" width="6" height="6" rx="1"/><path d="M8 12h8"/>'),
  search: s('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  refresh: s('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  eye: s('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  xmark: s('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevronDown: s('<path d="m6 9 6 6 6-6"/>'),
  plug: s('<path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0Z"/><path d="M12 16v6"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  warning: s('<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 17h.01"/>'),
  clock: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  check: s('<path d="m5 12 5 5 9-11"/>'),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4"/>'),
};
