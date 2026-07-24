/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/manage/**/*.{html,js}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', "'Noto Sans SC'", 'sans-serif'],
        mono: ['ui-monospace', "'JetBrains Mono'", 'Menlo', 'monospace'],
      },
      colors: {
        brand: { 50:'#f0f4ff',100:'#e0eaff',200:'#c2d5ff',300:'#94b5ff',400:'#5e8bff',500:'#3b6af5',600:'#2a52d8',700:'#2242b0',800:'#203991',900:'#1f3476' },
        surface: { 50:'#f8fafc',100:'#f1f5f9',200:'#e2e8f0',300:'#cbd5e1',400:'#94a3b8',500:'#64748b',600:'#475569',700:'#334155',800:'#1e293b',900:'#0f172a' },
        success: '#10b981', warning: '#f59e0b', danger: '#ef4444', info: '#0ea5e9',
      },
    },
  },
  plugins: [],
};
