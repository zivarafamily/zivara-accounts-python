// Run after frontend dependency installation. jsdom is an optional test dependency.
// JSDOM_PATH may point to an existing installation without changing package files.
import assert from 'node:assert/strict';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { build } from 'rolldown';
const { JSDOM } = await import(process.env.JSDOM_PATH || 'jsdom');
const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const bundle = new URL('../node_modules/.cache/sidebar-test.mjs', import.meta.url);
await mkdir(new URL('.', bundle), { recursive: true });
await build({
  input: new URL('../src/App.jsx', import.meta.url).pathname,
  external: ['react', 'react/jsx-runtime', 'react-dom/client', 'react-router-dom'],
  transform: { jsx: { runtime: 'automatic' } },
  plugins: [{
    name: 'isolated-sidebar',
    resolveId(id) {
      if (id.startsWith('./pages/')) return '\0page';
      if (id.includes('context/LLPContext')) return '\0scope';
    },
    load(id) {
      if (id === '\0page') return 'export default function Page(){ return null; }';
      if (id === '\0scope') return 'export const useLLP=()=>({currentLLP:null,clearLLP:()=>{}}); export const LLPProvider=({children})=>children;';
    },
    transform(code, id) {
      if (id.endsWith('/src/App.jsx')) return code + '\nexport { Sidebar, NAV_ALL, NAV_GROUPS, canAccessModule };';
    },
  }],
  output: { file: bundle.pathname, format: 'esm' },
});
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { Sidebar, NAV_ALL, NAV_GROUPS, canAccessModule } = await import(bundle.href);
const grouped = ['dashboard', ...NAV_GROUPS.flatMap(group => group.items)];
assert.equal(new Set(grouped).size, NAV_ALL.length);
assert.deepEqual([...grouped].sort(), NAV_ALL.map(item => item.key).sort());
for (const item of NAV_ALL) {
  assert.ok(source.includes(`<Route path="${item.to}" element={can("${item.key}")`), item.to);
  for (const role of ['admin', 'managing_partner', 'partner', 'viewer', 'employee']) {
    assert.equal(canAccessModule(item.key, role, []), ['admin', 'managing_partner'].includes(role) || item.baselineRoles.includes(role));
    assert.equal(canAccessModule(item.key, role, [item.key]), true);
  }
}
let closed = 0;
let root;
async function mount(role = 'admin', allowedModules = [], path = '/neorevenue', open = false) {
  if (root) await act(async () => root.unmount());
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path] },
    React.createElement(Sidebar, { role, allowedModules, open, user: 'Synthetic', onClose: () => closed++, onLogout: () => {} }))));
}
const nav = () => document.querySelector('nav');
const toggle = name => [...nav().querySelectorAll('button')].find(el => el.textContent.includes(name));
const visibleLinks = () => [...nav().querySelectorAll('a')].filter(el => !el.closest('[hidden]'));
const click = async el => act(async () => { assert.ok(el); el.click(); });
await mount();
assert.equal(nav().querySelectorAll('button').length, 4);
assert.deepEqual(visibleLinks().map(el => el.textContent), ['🏠Dashboard']);
assert.equal(nav().querySelectorAll('[aria-expanded="true"]').length, 0);
assert.equal(toggle('Revenue').getAttribute('aria-label'), 'Revenue, current section');
for (const button of nav().querySelectorAll('button')) {
  assert.equal(button.tagName, 'BUTTON');
  assert.ok(document.getElementById(button.getAttribute('aria-controls')));
}
await click(toggle('Accounting'));
assert.equal(visibleLinks().length, 8);
await click(toggle('Revenue'));
assert.equal(toggle('Accounting').getAttribute('aria-expanded'), 'false');
assert.equal(visibleLinks().length, 4);
const neo = visibleLinks().find(el => el.getAttribute('href') === '/neorevenue');
neo.focus();
await act(async () => neo.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
assert.equal(toggle('Revenue').getAttribute('aria-expanded'), 'false');
assert.equal(document.activeElement, toggle('Revenue'));
// Mobile uses the same disclosure, overlay and existing route-close callback.
window.innerWidth = 375;
await mount('admin', [], '/neorevenue', true);
assert.ok(document.querySelector('.sidebar-open'));
assert.ok(document.querySelector('.mob-overlay'));
await click(toggle('Revenue'));
await click(visibleLinks().find(el => el.getAttribute('href') === '/clients'));
assert.equal(closed, 1);
assert.equal(toggle('Revenue').getAttribute('aria-label'), 'Revenue, current section');
await click(document.querySelector('.mob-overlay'));
assert.equal(closed, 2);
await mount('partner');
assert.equal(nav().querySelectorAll('button').length, 2);
await click(toggle('Accounting'));
assert.deepEqual(visibleLinks().map(el => el.getAttribute('href')), ['/payment-tracker']);
await click(toggle('Revenue'));
assert.deepEqual(visibleLinks().map(el => el.getAttribute('href')), ['/clients', '/neoinvoices', '/neorevenue']);
assert.equal(toggle('Setup'), undefined);
await mount('viewer', ['imports']);
assert.equal(nav().querySelectorAll('button').length, 1);
await click(toggle('Setup'));
assert.deepEqual(visibleLinks().map(el => el.getAttribute('href')), ['/imports']);
await mount('viewer');
assert.equal(nav().querySelectorAll('button,a').length, 0);
await act(async () => root.unmount());
await rm(bundle);
console.log('PASS: all 20 routes, role/module predicates, 5-entry admin nav, collapsed/one-open states, active group, Escape focus, mobile close callbacks, partner/viewer visibility');
