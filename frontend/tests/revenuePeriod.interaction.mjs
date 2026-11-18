// Optional test dependency: npm install --no-save --package-lock=false jsdom
const { JSDOM } = await import(process.env.JSDOM_PATH || 'jsdom');
import { build } from 'rolldown';
import { mkdir, rm } from 'node:fs/promises';
const bundle = new URL('../node_modules/.cache/neo-period-test.mjs', import.meta.url);
await mkdir(new URL('.', bundle), { recursive: true });
await build({ input: new URL('../src/pages/NeoRevenue.jsx', import.meta.url).pathname, external: ['react', 'react/jsx-runtime', 'react-dom/client'], transform: { jsx: { runtime: 'automatic' } }, plugins: [{ name: 'synthetic', resolveId(id) { if (id.includes('api/client')) return '\0api'; if (id.includes('context/LLPContext')) return '\0scope'; }, load(id) { if (id === '\0api') return 'export const apiGet=(...args)=>globalThis.mockApi(...args); export const apiPost=apiGet;'; if (id === '\0scope') return 'export const useLLP=()=>({currentLLP:{global:true}});'; } }], output: { file: bundle.pathname, format: 'esm' } });
import assert from 'node:assert/strict';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
globalThis.window=dom.window;globalThis.document=dom.window.document;Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.alert=msg=>{throw Error(msg)};
const {default:React,act}=await import('react');const {createRoot}=await import('react-dom/client');const {default:NeoRevenue}=await import(bundle.href);
const calls=[];globalThis.mockApi=async(name,params)=>{calls.push({name,params});if(name==='getNeoRevenueMeta')return {ok:true,months:['Apr-2025','Jan-2026','Mar-2026','Apr-2026','Aug-2026'],totalRows:1};if(name==='getNeoRevenue')return {ok:true,total:1,limit:100,data:[{RevenueID:'TEST',ClientName:'Synthetic',RevenueMonth:'Apr-2026',RevenueAmount:10}]};if(name==='getNeoRevenueReport')return {ok:true,kpis:{},monthWise:[{RevenueMonth:'Apr-2026',TotalRevenue:10}],dateWise:[{TransactionDate:'2025-06-30',TotalRevenue:10}],clientWise:[]};return {ok:true,data:[]};};
const pause=()=>new Promise(r=>setTimeout(r,20));const root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(NeoRevenue));await pause()});await act(pause);
const select=label=>document.querySelector(`[aria-label="${label}"]`);
const change=async(label,value)=>act(async()=>{select(label).value=value;select(label).dispatchEvent(new window.Event('change',{bubbles:true}));await pause()});
const button=text=>[...document.querySelectorAll('button')].find(e=>e.textContent===text);
const click=async(el)=>act(async()=>{assert.ok(el,'missing click target');el.click();await pause()});
await change('Financial year','2025-26');assert.deepEqual([...select('Revenue month').options].map(x=>x.value),['','Apr-2025','Jan-2026','Mar-2026']);
await change('Revenue month','Jan-2026');await change('Financial year','2026-27');assert.equal(select('Revenue month').value,'');
await click(button('📊 Reports'));await change('Revenue month','Aug-2026');await change('Report period','range');assert.equal(select('Revenue month'),null);await change('From month','Apr-2026');await change('To month','Aug-2026');await click(button('Apply period'));let params=calls.at(-1).params;assert.equal(params.fromMonth,'Apr-2026');assert.equal(params.toMonth,'Aug-2026');assert.equal(params.month,undefined);
await change('Report period','dates');assert.equal(select('From month'),null);params=calls.at(-1).params;assert.equal(params.fromMonth,undefined);assert.equal(params.month,undefined);
await click(button('By Date'));await click([...document.querySelectorAll('td')].find(e=>e.textContent==='2025-06-30'));assert.equal(select('Report period').value,'dates');assert.equal(select('From date').value,'2025-06-30');params=calls.at(-1).params;assert.equal(params.fromDate,'2025-06-30');assert.equal(params.financialYear,'2026-27');assert.equal(params.month,undefined);
await click(button('Clear'));assert.equal(select('Report period').value,'month');assert.equal(select('Revenue month').value,'');assert.equal(calls.at(-1).params.fromDate,undefined);
await click(button('By Month'));await click([...document.querySelectorAll('td')].find(e=>e.textContent==='Apr 2026'));assert.equal(select('Revenue month').value,'Apr-2026');assert.equal(calls.at(-1).params.month,'Apr-2026');assert.equal(calls.at(-1).params.fromDate,undefined);
await act(async()=>root.unmount());console.log('PASS: mounted React FY filtering/reset, month range API, hidden filter clearing, date/month drill, Clear');

await rm(bundle);
