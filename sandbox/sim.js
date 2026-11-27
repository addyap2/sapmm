/* MM Sandbox — a simulated SAP GUI for practising SAP MM procure-to-pay.
   Training simulator only: not SAP software and not affiliated with SAP SE.
   All data is fictional and stays on this device (localStorage). */
(() => {
'use strict';

// ======================================================================
// Utilities
// ======================================================================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, l) => String(n).padStart(l, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
const today = () => iso(new Date());
const dPlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const fmtD = s => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '';
const parseD = s => {
  s = String(s || '').trim();
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s), y, mo, d;
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return null;
  const dt = new Date(y, mo - 1, d);
  return dt.getMonth() === mo - 1 && dt.getDate() === d ? iso(dt) : null;
};
const N = v => { if (typeof v === 'number') return v; const s = String(v ?? '').replace(/[\s,]/g, ''); if (s === '') return 0; const n = Number(s); return isFinite(n) ? n : NaN; };
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const money = n => Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qf = n => Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 3 });
const getPath = (o, p) => p.split('.').reduce((a, k) => a == null ? a : a[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => (a[k] ??= {}), o); t[last] = v; };
const U = s => String(s ?? '').trim().toUpperCase();
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

class SapErr extends Error { constructor(m, code, field) { super(m); this.code = code; this.field = field; } }
const err = (m, code, field) => { throw new SapErr(m, code, field); };

// ======================================================================
// Organisation & configuration (fictional practice client)
// ======================================================================
const ORG = {
  cc: { '1010': 'Riviera Trading SAS (Fréjus)' },
  plants: { '1010': 'Plant Fréjus' },
  slocs: { '101A': 'Main warehouse', '101B': 'Returns store' },
  porgs: { '1010': 'Purch. Org. Riviera' },
  pgrps: { '001': 'IT & office', '002': 'Packaging' },
  mtypes: { HAWA: 'Trading goods', ROH: 'Raw materials' },
  mtypeDef: { HAWA: { vc: '3100', ctrl: 'V' }, ROH: { vc: '3000', ctrl: 'S' } },
  mgroups: { L001: 'IT hardware', L002: 'Office furniture', L003: 'Packaging' },
  uoms: { PC: 'Piece', BOX: 'Box', KG: 'Kilogram' },
  vclasses: { '3100': 'Trading goods', '3000': 'Raw materials' },
  ctrls: { V: 'V – Moving average price', S: 'S – Standard price' },
  tax: { V1: ['Input VAT 20%', 0.2], V2: ['Input VAT 10%', 0.1], V0: ['Input VAT 0%', 0] },
  payterms: { '0001': 'Payable immediately', NT30: '30 days net', NT45: '45 days net' },
  countries: { FR: 'France', IT: 'Italy', DE: 'Germany', GB: 'United Kingdom', ES: 'Spain' },
  mvts: { '101': 'GR goods receipt', '102': 'GR reversal' },
  stypes: { unr: 'Unrestricted use', qi: 'Quality inspection', blk: 'Blocked stock' },
  tolPct: 5 // price tolerance (upper) for invoice blocking, %
};
const GL = {
  '3100': ['13100000', 'Inventory – trading goods'],
  '3000': ['13000000', 'Inventory – raw materials'],
  WRX: ['21900000', 'GR/IR clearing'],
  VST: ['15400000', 'Input VAT'],
  PRD: ['52000000', 'Price differences'],
  AP: ['21100000', 'Accounts payable – domestic']
};

// ======================================================================
// Data store
// ======================================================================
const KEY = 'sapmm-sandbox-v1', PKEY = 'sapmm-sandbox-trainer-v1';
let S;
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ } };
const nextNo = k => String(S.seq[k]++);

function emptyStore() {
  return { v: 1, seq: { pr: 10000001, po: 4500000001, md: 5000000001, inv: 5105600001, acc: 100000001, bp: 100001, info: 5300000001 },
    materials: {}, vendors: {}, infos: [], stock: {}, prs: {}, pos: {}, matDocs: {}, invoices: {}, accDocs: {}, log: [] };
}

const stockKey = (m, p, s) => `${m}|${p}|${s}`;
const getStock = (m, p, s) => (S.stock[stockKey(m, p, s)] ??= { unr: 0, qi: 0, blk: 0 });
const plantData = (m, p) => S.materials[m]?.plants?.[p];
const findInfo = (v, m, porg, plant) => S.infos.find(i => i.vendor === v && i.matnr === m && i.porg === porg && (!i.plant || i.plant === plant));
const vname = v => S.vendors[v]?.name || '';

function poTotals(P, it) {
  const h = P.history.filter(x => x.item === it.item);
  const gr = sum(h.filter(x => x.type === 'WE'), x => x.qty);
  const grVal = sum(h.filter(x => x.type === 'WE'), x => x.amount);
  const ir = sum(h.filter(x => x.type === 'RE'), x => x.qty);
  const irVal = sum(h.filter(x => x.type === 'RE'), x => x.amount);
  return { gr, grVal: r2(grVal), ir, irVal: r2(irVal), toDeliver: it.qty - gr, toInvoice: gr - ir };
}
function onOrder(m, p) {
  let q = 0;
  for (const P of Object.values(S.pos)) for (const it of P.items) if (it.matnr === m && it.plant === p) q += Math.max(0, poTotals(P, it).toDeliver);
  return q;
}

// ---------- engine: master data ----------
function createMaterial({ matnr, desc, type, uom, group, pgrp, plant = '1010', vc, ctrl, price, slocs = ['101A'], stock = {} }) {
  const d = ORG.mtypeDef[type];
  const pd = { pgrp, vc: vc || d.vc, ctrl: ctrl || d.ctrl, price: r2(N(price) || 0), totQty: 0, totVal: 0, slocs: [...slocs] };
  S.materials[matnr] = { matnr, desc, type, uom, group, created: today(), plants: { [plant]: pd } };
  for (const s of slocs) getStock(matnr, plant, s);
  for (const [s, q] of Object.entries(stock)) { getStock(matnr, plant, s).unr += q; pd.totQty += q; pd.totVal = r2(pd.totVal + q * pd.price); }
  return matnr;
}
function createVendor(v) {
  const id = nextNo('bp');
  S.vendors[id] = { id, created: today(), ...v };
  return id;
}
function createInfo({ vendor, matnr, porg, plant, price, per = 1, days = 5, stdQty = 1 }) {
  const id = nextNo('info');
  S.infos.push({ id, vendor, matnr, porg, plant: plant || '', price: r2(N(price)), per: N(per) || 1, days: N(days), stdQty: N(stdQty) });
  return id;
}

// ---------- engine: purchasing ----------
function createPR({ items, date = today() }) {
  const num = nextNo('pr');
  S.prs[num] = { num, date, items: items.map((it, i) => ({ item: (i + 1) * 10, poRef: '', poItem: '', ...it })) };
  return num;
}
function createPO({ vendor, porg = '1010', pgrp = '001', cc = '1010', docDate = today(), items }) {
  const num = nextNo('po');
  S.pos[num] = { num, type: 'NB', vendor, porg, pgrp, cc, docDate, history: [],
    items: items.map((it, i) => ({ item: (i + 1) * 10, per: 1, grBased: true, ...it })) };
  for (const it of S.pos[num].items) if (it.prRef && S.prs[it.prRef]) {
    const pi = S.prs[it.prRef].items.find(x => x.item === +it.prItem);
    if (pi) { pi.poRef = num; pi.poItem = it.item; }
  }
  return num;
}

// ---------- engine: accounting ----------
function createAcc(type, refDoc, date, lines) {
  const num = pad(nextNo('acc'), 10);
  S.accDocs[num] = { num, year: date.slice(0, 4), type, refDoc, date, cc: '1010', lines: lines.filter(l => Math.abs(l.amt) > 0.004).map((l, i) => ({ ...l, n: i + 1, amt: r2(l.amt) })) };
  return num;
}
const PK = { inv: ['89', '99'], WRX: ['86', '96'], VST: ['40', '50'], PRD: ['83', '93'], AP: ['21', '31'] };
const line = (kind, glk, dc, amt, extra = {}) => {
  if (amt < 0) { dc = dc === 'D' ? 'C' : 'D'; amt = -amt; }
  const g = GL[glk];
  return { pk: PK[kind][dc === 'D' ? 0 : 1], gl: g[0], text: g[1], dc, amt, ...extra };
};

// ---------- engine: goods movements ----------
function postGR({ po, lines, date = today(), mvt = '101', revOf = null, text = '' }) {
  const P = S.pos[po]; const md = nextNo('md'); const year = date.slice(0, 4);
  const acc = []; const sign = mvt === '101' ? 1 : -1;
  const items = lines.map((l, i) => {
    const it = P.items.find(x => x.item === l.item);
    const pd = plantData(it.matnr, it.plant);
    const value = r2(l.qty * it.price / it.per);
    getStock(it.matnr, it.plant, l.sloc)[l.stype] += sign * l.qty;
    let bsx = value, prd = 0;
    if (pd.ctrl === 'S') { bsx = r2(l.qty * pd.price); prd = r2(value - bsx); }
    pd.totQty += sign * l.qty; pd.totVal = r2(pd.totVal + sign * bsx);
    if (pd.ctrl === 'V' && pd.totQty > 0) pd.price = r2(pd.totVal / pd.totQty);
    acc.push(line('inv', pd.vc, 'D', sign * bsx, { matnr: it.matnr }));
    if (prd) acc.push(line('PRD', 'PRD', 'D', sign * prd, { matnr: it.matnr }));
    acc.push(line('WRX', 'WRX', 'C', sign * value, { matnr: it.matnr }));
    P.history.push({ type: 'WE', mvt, doc: md, year, item: it.item, qty: sign * l.qty, amount: sign * value, date });
    return { line: i + 1, matnr: it.matnr, qty: l.qty, uom: it.uom, plant: it.plant, sloc: l.sloc, stype: l.stype, po, poItem: it.item, amount: value };
  });
  const an = createAcc('WE', md, date, acc);
  S.matDocs[md] = { num: md, year, date, mvt, text, items, acc: an, revOf, reversedBy: null };
  if (revOf) S.matDocs[revOf].reversedBy = md;
  return md;
}

// ---------- engine: invoice verification ----------
function computeIR({ po, gross, taxCode, tax, items }) {
  const P = S.pos[po]; const acc = []; const reasons = [];
  acc.push(line('AP', 'AP', 'C', gross, { vendor: P.vendor }));
  const valuation = [];
  for (const x of items) {
    const it = P.items.find(i => i.item === x.item);
    const t = poTotals(P, it);
    const poVal = r2(x.qty * it.price / it.per);
    const diff = r2(x.amount - poVal);
    if (x.qty > t.toInvoice + 1e-9) reasons.push(`Item ${pad(it.item, 5)}: quantity variance (invoiced ${qf(x.qty)}, received but not invoiced ${qf(t.toInvoice)})`);
    if (x.qty > 0 && x.amount / x.qty > (it.price / it.per) * (1 + ORG.tolPct / 100) + 0.0049)
      reasons.push(`Item ${pad(it.item, 5)}: price variance ${money(x.amount / x.qty)} vs PO ${money(it.price / it.per)} (tolerance ${ORG.tolPct}%)`);
    acc.push(line('WRX', 'WRX', 'D', poVal, { matnr: it.matnr }));
    if (diff) {
      const pd = plantData(it.matnr, it.plant);
      if (pd.ctrl === 'V' && pd.totQty >= x.qty) { acc.push(line('inv', pd.vc, 'D', diff, { matnr: it.matnr })); valuation.push({ pd, diff }); }
      else acc.push(line('PRD', 'PRD', 'D', diff, { matnr: it.matnr }));
    }
  }
  if (tax) acc.push(line('VST', 'VST', 'D', tax, { tax: taxCode }));
  return { acc, reasons, blocked: reasons.length > 0, valuation };
}
function postIR({ po, date = today(), ref, gross, taxCode, tax, items }) {
  const P = S.pos[po]; const c = computeIR({ po, gross, taxCode, tax, items });
  const inv = nextNo('inv'); const year = date.slice(0, 4);
  for (const { pd, diff } of c.valuation) { pd.totVal = r2(pd.totVal + diff); if (pd.totQty > 0) pd.price = r2(pd.totVal / pd.totQty); }
  for (const x of items) P.history.push({ type: 'RE', mvt: '', doc: inv, year, item: x.item, qty: x.qty, amount: r2(x.amount), date });
  const an = createAcc('RE', inv, date, c.acc);
  S.invoices[inv] = { num: inv, year, date, ref, po, vendor: P.vendor, gross: r2(gross), taxCode, tax: r2(tax), items: items.map(x => ({ ...x, amount: r2(x.amount) })),
    blocked: c.blocked, reasons: c.reasons, acc: an, released: null };
  return inv;
}

// ---------- seed data ----------
function seed() {
  S = emptyStore();
  createMaterial({ matnr: 'TG11', desc: 'Business laptop 14"', type: 'HAWA', uom: 'PC', group: 'L001', pgrp: '001', price: 520, stock: { '101A': 25 } });
  createMaterial({ matnr: 'TG12', desc: 'Wireless mouse', type: 'HAWA', uom: 'PC', group: 'L001', pgrp: '001', price: 14.2, stock: { '101A': 140 } });
  createMaterial({ matnr: 'TG13', desc: 'USB-C docking station', type: 'HAWA', uom: 'PC', group: 'L001', pgrp: '001', price: 0 });
  createMaterial({ matnr: 'RM14', desc: 'Corrugated carton 40x30', type: 'ROH', uom: 'PC', group: 'L003', pgrp: '002', price: 0.85, stock: { '101A': 2000 } });
  createMaterial({ matnr: 'TG15', desc: 'Ergonomic office chair', type: 'HAWA', uom: 'PC', group: 'L002', pgrp: '001', price: 145, stock: { '101A': 12 } });
  const pd = (o = {}) => ({ porg: { '1010': { curr: 'EUR', terms: 'NT30', grIv: true, ...o } } });
  const v1 = createVendor({ name: "Côte d'Azur IT Distribution", search: 'CAZIT', street: '12 avenue Jean Médecin', post: '06000', city: 'Nice', country: 'FR', lang: 'EN', cc: { '1010': { recon: '21100000', terms: 'NT30' } }, ...pd() });
  const v2 = createVendor({ name: 'Provence Office Supplies', search: 'PROVOFF', street: '45 boulevard Longchamp', post: '13001', city: 'Marseille', country: 'FR', lang: 'FR', cc: { '1010': { recon: '21100000', terms: 'NT45' } }, ...pd({ terms: 'NT45' }) });
  const v3 = createVendor({ name: 'Emballages du Var', search: 'EMBVAR', street: '8 rue de la Poudrière', post: '83000', city: 'Toulon', country: 'FR', lang: 'FR', cc: { '1010': { recon: '21100000', terms: 'NT30' } }, ...pd() });
  createInfo({ vendor: v1, matnr: 'TG11', porg: '1010', plant: '1010', price: 510, days: 7 });
  createInfo({ vendor: v1, matnr: 'TG12', porg: '1010', plant: '1010', price: 13.9, days: 3 });
  createInfo({ vendor: v2, matnr: 'TG12', porg: '1010', plant: '1010', price: 14.5, days: 2 });
  createInfo({ vendor: v2, matnr: 'TG15', porg: '1010', plant: '1010', price: 139, days: 10 });
  createInfo({ vendor: v3, matnr: 'RM14', porg: '1010', plant: '1010', price: 0.82, days: 5 });
  // history: one completed P2P cycle, one open PO, one open PR
  const po1 = createPO({ vendor: v1, docDate: dPlus(-20), items: [{ matnr: 'TG11', short: 'Business laptop 14"', qty: 10, uom: 'PC', price: 510, plant: '1010', sloc: '101A', date: dPlus(-13) }] });
  postGR({ po: po1, date: dPlus(-14), lines: [{ item: 10, qty: 10, sloc: '101A', stype: 'unr' }] });
  postIR({ po: po1, date: dPlus(-10), ref: 'CAZ-2611-0457', gross: 6120, taxCode: 'V1', tax: 1020, items: [{ item: 10, qty: 10, amount: 5100 }] });
  createPO({ vendor: v2, docDate: dPlus(-3), items: [{ matnr: 'TG15', short: 'Ergonomic office chair', qty: 5, uom: 'PC', price: 139, plant: '1010', sloc: '101A', date: dPlus(7) }] });
  createPR({ date: dPlus(-1), items: [{ matnr: 'RM14', short: 'Corrugated carton 40x30', qty: 500, uom: 'PC', plant: '1010', sloc: '101A', date: dPlus(10), pgrp: '002', vendor: '', valPrice: 0.85 }] });
  S.log = [];
  persist();
}
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { S = JSON.parse(raw); if (S && S.v === 1) return; } } catch (e) { /* ignore */ }
  seed();
}

// ======================================================================
// Event log (drives trainer scenarios)
// ======================================================================
function emit(type, data = {}) {
  S.log.push({ t: Date.now(), ...data, type });
  persist();
  checkScenario();
}

// ======================================================================
// Shell: messages, rendering, navigation
// ======================================================================
let cur = null; const stack = [];
const TX = {};

function msg(type, text) {
  const el = $('#msg');
  el.className = 'msg ' + (type || '');
  el.innerHTML = type ? `<span class="mi">${{ S: '✓', E: '!', W: '!', I: 'i' }[type]}</span><span class="t">${esc(text)}</span>` : '';
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('show'), 2600); }

function call(code, params = {}, push = false) {
  code = U(code);
  if (OBSOLETE[code]) { msg('E', OBSOLETE[code]); emit('ERR', { code: 'XK01', tcode: code }); return; }
  const def = TX[code];
  if (!def && LATER.includes(code)) { msg('I', `${code} exists in SAP but is not simulated in this sandbox yet`); return; }
  if (!def) { msg('E', `Transaction ${code} does not exist`); return; }
  if (push && cur) stack.push(cur); else if (!push) stack.length = 0;
  cur = { code, def, m: def.init ? def.init(params) : {} };
  msg('', '');
  if (def.onOpen) act(def.onOpen); else render();
}
function home() { stack.length = 0; call('SESSION_MANAGER'); }
function back() {
  closeModal();
  if (cur.def.back && cur.def.back(cur)) { render(); return; }
  if (stack.length) { cur = stack.pop(); render(); return; }
  if (cur.code !== 'SESSION_MANAGER') home();
}

function act(fn, ...args) {
  $$('#screen .errf').forEach(e => e.classList.remove('errf'));
  msg('', '');
  let field = null;
  try { fn(cur, ...args); }
  catch (e) {
    if (e instanceof SapErr) { msg('E', e.message); field = e.field; if (e.code) emit('ERR', { code: e.code }); }
    else { console.error(e); msg('E', 'Unexpected error: ' + e.message); }
  }
  render(field);
  persist();
}

function render(errField) {
  const c = cur, d = c.def;
  $('#title').textContent = typeof d.title === 'function' ? d.title(c) : d.title;
  c.tb = d.tb ? d.tb(c) : [];
  $('#apptb').innerHTML = c.tb.map((b, i) => `<button type="button" data-tb="${i}" title="${esc(b.t || b.l)}">${b.i ? `<span class="ic">${b.i}</span>` : ''}${esc(b.l)}</button>`).join('');
  $('#screen').innerHTML = d.render(c);
  $('#stc').textContent = c.code;
  bind();
  let f = errField && $(`#screen [data-k="${CSS.escape(errField)}"]`);
  if (f) { f.classList.add('errf'); f.focus(); }
  else if (c.code !== 'SESSION_MANAGER' && !('ontouchstart' in window)) {
    f = $$('#screen input[data-k]:not([readonly]):not([type=checkbox])').find(x => !x.value) || $('#screen input[data-k]:not([readonly])');
    f?.focus();
  }
  $('#screen').scrollTop = errField ? $('#screen').scrollTop : 0;
}

function bind() {
  $$('#screen [data-k]').forEach(el => {
    const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      const v = el.type === 'checkbox' ? el.checked : el.value;
      setPath(cur.m, el.dataset.k, v);
      cur.def.onInput?.(cur, el.dataset.k, v);
      if (el.dataset.rr != null) act(() => {});
    });
  });
}

// ---------- field helpers ----------
let fid = 0;
function F(label, k, o = {}) {
  const id = 'f' + (++fid);
  return `<div class="f"><label for="${id}">${esc(label)}</label>${I(k, { ...o, id })}${o.desc != null ? `<span class="fd">${esc(o.desc)}</span>` : '<span></span>'}</div>`;
}
function I(k, o = {}) {
  const id = o.id || 'f' + (++fid);
  const v = getPath(cur.m, k);
  const ro = o.ro ? 'readonly tabindex="-1"' : '';
  if (o.type === 'check') return `<span class="inp"><input type="checkbox" id="${id}" data-k="${k}" ${v ? 'checked' : ''} ${o.ro ? 'disabled' : ''} ${o.rr ? 'data-rr' : ''}></span>`;
  if (o.type === 'select') return `<span class="inp"><select id="${id}" data-k="${k}" ${o.ro ? 'disabled' : ''} ${o.rr ? 'data-rr' : ''}>${Object.entries(o.opts).map(([a, b]) => `<option value="${esc(a)}" ${a == v ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></span>`;
  const f4 = o.f4 && !o.ro ? `<button type="button" class="f4" data-f4btn="${o.f4}" data-for="${id}" title="Possible entries (F4)" aria-label="Possible entries">▼</button>` : '';
  return `<span class="inp"><input id="${id}" data-k="${k}" value="${esc(v ?? '')}" ${ro} size="${o.w || 12}" ${o.f4 ? `data-f4="${o.f4}"` : ''} class="${o.req ? 'req' : ''} ${o.num ? 'num' : ''}" autocomplete="off" spellcheck="false" ${o.ph ? `placeholder="${esc(o.ph)}"` : ''}>${f4}</span>`;
}
const box = (title, inner, right = '') => `<section class="box"><h3><span>${title}</span>${right}</h3><div class="in">${inner}</div></section>`;
const tabs = (c, list, key = 'tab') => `<div class="tabs" role="tablist">${list.map(([id, l]) => `<button type="button" role="tab" data-tab="${id}" data-tabkey="${key}" class="${(c.m[key] || list[0][0]) === id ? 'on' : ''}" aria-selected="${(c.m[key] || list[0][0]) === id}">${esc(l)}</button>`).join('')}</div>`;
const tabOn = (c, list, key = 'tab') => c.m[key] || list[0][0];
function grid(cols, rows, o = {}) {
  const head = `<tr>${cols.map(c => `<th class="${c.r ? 'r' : ''}">${esc(c.h)}</th>`).join('')}</tr>`;
  const body = rows.length ? rows.map((r, i) => `<tr class="${o.click ? 'click' : ''} ${r._cls || ''}" ${o.click ? o.click(r, i) : ''}>${cols.map(c => `<td class="${c.r ? 'r' : ''}">${c.f ? c.f(r, i) : esc(r[c.k])}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length}" class="muted">${esc(o.empty || 'No entries found')}</td></tr>`;
  return `<div class="tw"><table class="g">${head}${body}${o.foot || ''}</table></div>`;
}
const callAttr = (code, p) => `data-call="${code}" data-p='${esc(JSON.stringify(p))}'`;
const lnk = (code, p, text) => `<button type="button" class="lnk" ${callAttr(code, p)}>${esc(text)}</button>`;
function req(c, keys) { for (const k of keys) if (String(getPath(c.m, k) ?? '').trim() === '') err('Fill in all required entry fields', null, k); }
function needDate(c, k) { const d = parseD(getPath(c.m, k)); if (!d) err(`Enter a valid date (DD.MM.YYYY)`, null, k); return d; }
function needMat(x, plant, field) {
  const m = S.materials[U(x)];
  if (!m) err(`Material ${U(x)} does not exist`, 'NO_MAT', field);
  if (plant && !m.plants[plant]) err(`Material ${m.matnr} not maintained in plant ${plant}`, 'NO_PLANT', field);
  return m;
}
function needVendor(v, porg, field) {
  const V = S.vendors[String(v).trim()];
  if (!V) err(`Supplier ${String(v).trim()} does not exist`, 'NO_VENDOR', field);
  if (porg && !V.porg?.[porg]) err(`Supplier ${V.id} has not been created for purchasing organization ${porg}`, 'NO_PORG', field);
  return V;
}
const needOf = (dict, v, what, field) => { if (!(U(v) in dict) && !(String(v).trim() in dict)) err(`${what} ${v} does not exist`, null, field); return dict[U(v)] ? U(v) : String(v).trim(); };

// ---------- F4 value help ----------
const F4 = {
  mat: () => Object.values(S.materials).map(m => [m.matnr, m.desc, ORG.mtypes[m.type]]),
  vendor: () => Object.values(S.vendors).map(v => [v.id, v.name, `${v.city}${v.porg?.['1010'] ? '' : ' (no purchasing data)'}`]),
  plant: () => Object.entries(ORG.plants), sloc: () => Object.entries(ORG.slocs), porg: () => Object.entries(ORG.porgs),
  pgrp: () => Object.entries(ORG.pgrps), cc: () => Object.entries(ORG.cc), mtype: () => Object.entries(ORG.mtypes),
  mgroup: () => Object.entries(ORG.mgroups), uom: () => Object.entries(ORG.uoms), tax: () => Object.entries(ORG.tax).map(([k, v]) => [k, v[0]]),
  terms: () => Object.entries(ORG.payterms), country: () => Object.entries(ORG.countries), vclass: () => Object.entries(ORG.vclasses),
  po: () => Object.values(S.pos).reverse().map(p => [p.num, vname(p.vendor), p.items.map(i => `${i.matnr} ×${qf(i.qty)}`).join(', ')]),
  pr: () => Object.values(S.prs).reverse().map(p => [p.num, p.items.map(i => `${i.matnr} ×${qf(i.qty)}`).join(', '), p.items.every(i => i.poRef) ? 'Ordered' : 'Open']),
  matdoc: () => Object.values(S.matDocs).reverse().map(d => [d.num, `${d.mvt} ${ORG.mvts[d.mvt]}`, `PO ${d.items[0]?.po} · ${fmtD(d.date)}${d.reversedBy ? ' · reversed' : ''}`]),
  inv: () => Object.values(S.invoices).reverse().map(i => [i.num, vname(i.vendor), `${money(i.gross)} EUR${i.blocked ? ' · blocked' : ''}`]),
  acc: () => Object.values(S.accDocs).reverse().map(a => [a.num, a.type === 'WE' ? 'WE – Goods receipt' : 'RE – Invoice receipt', `Ref. ${a.refDoc} · ${fmtD(a.date)}`])
};
const F4T = { mat: 'Material', vendor: 'Supplier', plant: 'Plant', sloc: 'Storage location', porg: 'Purchasing organization', pgrp: 'Purchasing group', cc: 'Company code', mtype: 'Material type', mgroup: 'Material group', uom: 'Unit of measure', tax: 'Tax code', terms: 'Payment terms', country: 'Country', vclass: 'Valuation class', po: 'Purchasing document', pr: 'Purchase requisition', matdoc: 'Material document', inv: 'Invoice document', acc: 'Accounting document' };

function openF4(type, input) {
  const rows = F4[type]();
  const draw = q => {
    const f = q ? rows.filter(r => r.join(' ').toLowerCase().includes(q.toLowerCase())) : rows;
    return `<table class="g">${f.map(r => `<tr class="click" data-pick="${esc(r[0])}">${r.map((x, i) => `<td>${i === 0 ? `<b>${esc(x)}</b>` : esc(x)}</td>`).join('')}</tr>`).join('') || '<tr><td class="muted">No values found</td></tr>'}</table>`;
  };
  modal(`${F4T[type]} (${rows.length} entr${rows.length === 1 ? 'y' : 'ies'})`, `<input class="f4filter" placeholder="Search…" aria-label="Search values"><div class="f4list">${draw('')}</div>`, [], m => {
    const fi = $('.f4filter', m); fi.focus();
    fi.addEventListener('input', () => { $('.f4list', m).innerHTML = draw(fi.value); });
    fi.addEventListener('keydown', e => { if (e.key === 'Enter') { const first = $('[data-pick]', m); if (first) { e.preventDefault(); first.click(); } } });
    m.addEventListener('click', e => {
      const tr = e.target.closest('[data-pick]'); if (!tr) return;
      input.value = tr.dataset.pick; setPath(cur.m, input.dataset.k, tr.dataset.pick); cur.def.onInput?.(cur, input.dataset.k, tr.dataset.pick);
      closeModal(); input.focus();
    });
  });
}

// ---------- modal ----------
function modal(title, body, buttons = [], onMount) {
  const bg = $('#modal');
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h4><span>${esc(title)}</span><button type="button" data-close aria-label="Close">✕</button></h4><div class="mb-body">${body}</div>${buttons.length ? `<div class="mb-foot">${buttons.map((b, i) => `<button type="button" data-mb="${i}" class="${b.pri ? 'pri' : ''}">${esc(b.l)}</button>`).join('')}</div>` : ''}</div>`;
  bg.hidden = false;
  bg.onclick = e => {
    if (e.target === bg || e.target.closest('[data-close]')) return closeModal();
    const b = e.target.closest('[data-mb]'); if (b) { const def = buttons[+b.dataset.mb]; closeModal(); def.a?.(); }
  };
  onMount?.($('.modal', bg));
  if (!onMount) $('.modal button', bg)?.focus();
}
function closeModal() { const bg = $('#modal'); bg.hidden = true; bg.innerHTML = ''; }

// ======================================================================
// Transactions
// ======================================================================
const LATER = ['ME22N', 'ME52N', 'ME54N', 'ME28', 'ME29N', 'MM02', 'ME12', 'ME31K', 'ME32K', 'ME33K', 'ME31L', 'ME41', 'ME47', 'ME49', 'ME01', 'ME57', 'ME59N', 'MB1A', 'MB1B', 'MB1C', 'MI01', 'MI04', 'MI07', 'MD01', 'MD04', 'MD03', 'MD02', 'MIR7', 'MR8M', 'MRRL', 'F110', 'FBL1N', 'MMR1', 'ME9F'];
const OBSOLETE = {
  XK01: 'Transaction XK01 is obsolete in SAP S/4HANA: use transaction BP (Business Partner)',
  XK02: 'Transaction XK02 is obsolete in SAP S/4HANA: use transaction BP (Business Partner)',
  XK03: 'Transaction XK03 is obsolete in SAP S/4HANA: use transaction BP (Business Partner)',
  MK01: 'Transaction MK01 is obsolete in SAP S/4HANA: use transaction BP (Business Partner)',
  MK03: 'Transaction MK03 is obsolete in SAP S/4HANA: use transaction BP (Business Partner)'
};

// ---------------- Easy Access ----------------
const MENU = [
  ['Favourites', [['ME21N'], ['MIGO'], ['MIRO'], ['MMBE']], true],
  ['SAP menu', [
    ['Logistics', [
      ['Materials Management', [
        ['Purchasing', [
          ['Purchase Requisition', [['ME51N'], ['ME53N'], ['ME5A']]],
          ['Purchase Order', [['ME21N'], ['ME23N'], ['ME2N'], ['ME2M']]],
          ['Master Data › Purchasing Info Record', [['ME11'], ['ME13']]]
        ], true],
        ['Inventory Management', [['MIGO'], ['MMBE'], ['MB52'], ['MB51']], true],
        ['Logistics Invoice Verification', [['MIRO'], ['MIR4'], ['MRBR'], ['MB5S']], true],
        ['Material Master', [['MM01'], ['MM03']], true]
      ], true]
    ], true],
    ['Cross-Application Components', [['Business Partner', [['BP']]]]],
    ['Accounting', [['Financial Accounting › General Ledger', [['FB03']]]]]
  ], true]
];
function tree(nodes) {
  return nodes.map(n => n.length === 1
    ? `<button type="button" class="leaf" ${callAttr(n[0], {})}><b>${n[0]}</b>${esc(TX[n[0]]?.label || '')}</button>`
    : `<details ${n[2] ? 'open' : ''}><summary><span class="fold">📁</span> ${esc(n[0])}</summary>${tree(n[1])}</details>`).join('');
}
TX.SESSION_MANAGER = {
  title: 'SAP Easy Access',
  render: () => `<div class="ea"><div class="box"><h3>Menu</h3><div class="in tree">${tree(MENU)}</div></div>
    <div>${box('Practice client 100', `<table class="g orgtbl">
      <tr><td>Company code</td><td><b>1010</b> Riviera Trading SAS</td></tr>
      <tr><td>Plant</td><td><b>1010</b> Fréjus</td></tr>
      <tr><td>Storage locations</td><td><b>101A</b> Main warehouse<br><b>101B</b> Returns store</td></tr>
      <tr><td>Purchasing org.</td><td><b>1010</b> Purch. Org. Riviera</td></tr>
      <tr><td>Purchasing groups</td><td><b>001</b> IT &amp; office · <b>002</b> Packaging</td></tr>
      <tr><td>Suppliers</td><td>${Object.keys(S.vendors).length} · Materials: ${Object.keys(S.materials).length}</td></tr></table>`)}
      <div class="tip"><b>New here?</b> Open <b>🎓 Trainer</b> (top right) and start with scenario 1. Type a transaction code in the command field (top left) and press Enter. <b>F4</b> or ▼ shows possible entries, <b>F3</b> goes back, <b>Ctrl+S</b> saves, <b>F8</b> executes reports.</div>
      <div class="tip">Command field: <b>/nME21N</b> leaves the current transaction and starts a new one. <b>/n</b> on its own returns here.</div>
      <p class="disclaimer">Training simulator with fictional data. Not SAP software and not affiliated with SAP SE. Screens are simplified versions of SAP GUI transactions.</p></div></div>`
};

// ---------------- MM01 / MM03: Material master ----------------
const MATVIEWS = [['basic', 'Basic data 1'], ['purch', 'Purchasing'], ['plant', 'Plant data / stor.'], ['acct', 'Accounting 1']];
TX.MM01 = {
  title: c => c.m.step === 2 ? `Create Material ${U(c.m.matnr)} (${ORG.mtypes[c.m.type]})` : 'Create Material (Initial Screen)',
  init: () => ({ step: 1, matnr: '', ind: 'R', type: 'HAWA', plant: '1010', sloc: '101A', desc: '', uom: 'PC', group: '', pgrp: '001', vc: '', ctrl: '', price: '' }),
  tb: c => c.m.step === 2 ? [] : [{ l: 'Select view(s)', i: '☰', a: c => act(TX.MM01.enter) }],
  render: c => {
    const m = c.m;
    if (m.step === 1) return box('Material', F('Material', 'matnr', { req: 1, w: 18, ph: 'e.g. TG20' }) + F('Industry sector', 'ind', { type: 'select', opts: { R: 'Retail', M: 'Mechanical engineering' } }) +
      F('Material type', 'type', { req: 1, f4: 'mtype', w: 6, desc: ORG.mtypes[U(m.type)] || '' })) +
      box('Organizational levels', F('Plant', 'plant', { req: 1, f4: 'plant', w: 6, desc: ORG.plants[m.plant] || '' }) + F('Storage location', 'sloc', { req: 1, f4: 'sloc', w: 6, desc: ORG.slocs[U(m.sloc)] || '' })) +
      `<div class="tip">The material number uses external numbering in this client: type your own (e.g. <b>TG20</b>). Views created: Basic data 1, Purchasing, Plant data/stor., Accounting 1.</div>`;
    const t = tabOn(c, MATVIEWS);
    let inner = '';
    if (t === 'basic') inner = F('Material description', 'desc', { req: 1, w: 40 }) + F('Base unit of measure', 'uom', { req: 1, f4: 'uom', w: 5, desc: ORG.uoms[U(m.uom)] || '' }) + F('Material group', 'group', { req: 1, f4: 'mgroup', w: 8, desc: ORG.mgroups[U(m.group)] || '' });
    if (t === 'purch') inner = F('Purchasing group', 'pgrp', { req: 1, f4: 'pgrp', w: 5, desc: ORG.pgrps[m.pgrp] || '' }) + F('Order unit', 'uom', { ro: 1, w: 5 }) + `<div class="tip">The purchasing group is the buyer (or team) responsible for this material.</div>`;
    if (t === 'plant') inner = F('Plant', 'plant', { ro: 1, w: 6, desc: ORG.plants[m.plant] }) + F('Storage location', 'sloc', { ro: 1, w: 6, desc: ORG.slocs[U(m.sloc)] });
    if (t === 'acct') inner = F('Valuation class', 'vc', { req: 1, f4: 'vclass', w: 6, desc: ORG.vclasses[m.vc] || '' }) + F('Price control', 'ctrl', { type: 'select', opts: ORG.ctrls }) + F(m.ctrl === 'S' ? 'Standard price (EUR)' : 'Moving price (EUR)', 'price', { w: 12, num: 1, req: m.ctrl === 'S' }) +
      `<div class="tip">Valuation class links the material to its inventory G/L account (3100 → 13100000). Price control <b>V</b> lets the price move with each goods receipt; <b>S</b> keeps a fixed standard price and posts differences to a price-difference account.</div>`;
    return tabs(c, MATVIEWS) + box(MATVIEWS.find(v => v[0] === t)[1], inner);
  },
  enter: c => {
    const m = c.m;
    if (m.step === 1) {
      req(c, ['matnr', 'type', 'plant', 'sloc']);
      m.matnr = U(m.matnr); m.type = U(m.type); m.sloc = U(m.sloc);
      if (!/^[A-Z0-9-]{2,18}$/.test(m.matnr)) err('Material number: use 2–18 letters, digits or hyphens', null, 'matnr');
      if (S.materials[m.matnr]) err(`Material ${m.matnr} already exists (use MM03 to display it)`, 'MAT_EXISTS', 'matnr');
      needOf(ORG.mtypes, m.type, 'Material type', 'type'); needOf(ORG.plants, m.plant, 'Plant', 'plant'); needOf(ORG.slocs, m.sloc, 'Storage location', 'sloc');
      Object.assign(m, { vc: ORG.mtypeDef[m.type].vc, ctrl: ORG.mtypeDef[m.type].ctrl, step: 2, tab: 'basic', group: m.type === 'ROH' ? 'L003' : '' });
      return;
    }
    TX.MM01.validate(c);
  },
  validate: c => {
    const m = c.m;
    const go = (tab, k, e) => { m.tab = tab; err(e, null, k); };
    if (!m.desc.trim()) go('basic', 'desc', 'Fill in all required entry fields');
    if (!ORG.uoms[U(m.uom)]) go('basic', 'uom', `Unit of measure ${m.uom} does not exist`);
    if (!ORG.mgroups[U(m.group)]) go('basic', 'group', m.group ? `Material group ${m.group} does not exist` : 'Fill in all required entry fields');
    if (!ORG.pgrps[m.pgrp]) go('purch', 'pgrp', `Purchasing group ${m.pgrp} does not exist`);
    if (!ORG.vclasses[m.vc]) go('acct', 'vc', `Valuation class ${m.vc} does not exist`);
    const p = N(m.price);
    if (isNaN(p) || p < 0) go('acct', 'price', 'Enter a valid price');
    if (m.ctrl === 'S' && !p) go('acct', 'price', 'Enter a standard price (price control S)');
  },
  save: c => {
    if (c.m.step === 1) err('Select views first: press Enter');
    TX.MM01.validate(c);
    const m = c.m;
    createMaterial({ matnr: m.matnr, desc: m.desc.trim(), type: m.type, uom: U(m.uom), group: U(m.group), pgrp: m.pgrp, plant: m.plant, vc: m.vc, ctrl: m.ctrl, price: N(m.price), slocs: [m.sloc] });
    emit('MAT_CREATED', { matnr: m.matnr, mtype: m.type });
    c.m = TX.MM01.init(); msg('S', `Material ${m.matnr} created`);
    if (!N(m.price) && m.ctrl === 'V') msg('S', `Material ${m.matnr} created (moving price 0.00: it will be set by the first goods receipt)`);
  },
  back: c => { if (c.m.step === 2) { c.m.step = 1; return true; } }
};
TX.MM03 = {
  title: c => c.m.show ? `Display Material ${c.m.matnr} (${ORG.mtypes[S.materials[c.m.matnr]?.type] || ''})` : 'Display Material (Initial Screen)',
  init: p => ({ matnr: p.matnr || '', show: false, plant: '1010', _auto: !!p.matnr }),
  onOpen: c => { if (c.m._auto) TX.MM03.enter(c); },
  render: c => {
    const m = c.m;
    if (!m.show) return box('Material', F('Material', 'matnr', { req: 1, f4: 'mat', w: 18 })) + box('Organizational levels', F('Plant', 'plant', { f4: 'plant', w: 6 }));
    const M = S.materials[m.matnr], pd = M.plants[m.plant], t = tabOn(c, MATVIEWS);
    const row = (l, v) => `<div class="f"><label>${esc(l)}</label><span class="inp"><input readonly tabindex="-1" data-k="_" value="${esc(v)}" size="${Math.max(6, String(v).length + 2)}"></span><span></span></div>`;
    let inner = '';
    if (t === 'basic') inner = row('Material', M.matnr) + row('Description', M.desc) + row('Material type', `${M.type} – ${ORG.mtypes[M.type]}`) + row('Base unit of measure', M.uom) + row('Material group', `${M.group} – ${ORG.mgroups[M.group]}`) + row('Created on', fmtD(M.created));
    if (t === 'purch') inner = row('Purchasing group', `${pd.pgrp} – ${ORG.pgrps[pd.pgrp]}`) + `<h4>Info records</h4>` + grid([{ h: 'Info record', k: 'id' }, { h: 'Supplier', f: r => `${r.vendor} ${esc(vname(r.vendor))}` }, { h: 'Net price', r: 1, f: r => money(r.price) }, { h: 'Deliv. days', r: 1, k: 'days' }], S.infos.filter(i => i.matnr === M.matnr), { empty: 'No purchasing info record: a PO price will not be proposed' });
    if (t === 'plant') inner = row('Plant', `${m.plant} – ${ORG.plants[m.plant]}`) + grid([{ h: 'SLoc', k: 's' }, { h: 'Description', f: r => esc(ORG.slocs[r.s]) }, { h: 'Unrestricted', r: 1, f: r => qf(r.unr) }, { h: 'Quality insp.', r: 1, f: r => qf(r.qi) }, { h: 'Blocked', r: 1, f: r => qf(r.blk) }],
      Object.keys(ORG.slocs).filter(s => S.stock[stockKey(M.matnr, m.plant, s)]).map(s => ({ s, ...S.stock[stockKey(M.matnr, m.plant, s)] })));
    if (t === 'acct') inner = row('Valuation class', `${pd.vc} – ${ORG.vclasses[pd.vc]}`) + row('Price control', ORG.ctrls[pd.ctrl]) + row(pd.ctrl === 'S' ? 'Standard price' : 'Moving price', `${money(pd.price)} EUR / 1 ${M.uom}`) + row('Total stock', `${qf(pd.totQty)} ${M.uom}`) + row('Total value', `${money(pd.totVal)} EUR`) + row('Inventory G/L account', `${GL[pd.vc][0]} ${GL[pd.vc][1]}`);
    return tabs(c, MATVIEWS) + box(MATVIEWS.find(v => v[0] === t)[1], inner);
  },
  enter: c => {
    if (c.m.show) return;
    req(c, ['matnr']); c.m.matnr = U(c.m.matnr);
    needMat(c.m.matnr, c.m.plant, 'matnr');
    c.m.show = true; emit('MAT_DISPLAY', { matnr: c.m.matnr });
  },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
};

// ---------------- BP: Business partner (supplier) ----------------
const BPTABS = [['addr', 'Address'], ['cc', 'Supplier: company code'], ['purch', 'Supplier: purchasing']];
TX.BP = {
  title: c => c.m.mode === 'create' ? 'Create Organization (Supplier)' : c.m.mode === 'show' ? `Display Organization: ${c.m.bp}, ${vname(c.m.bp)}` : 'Maintain Business Partner',
  init: () => ({ mode: 'start', bp: '', r00: true, r01: true, name: '', search: '', street: '', post: '', city: '', country: 'FR', lang: 'EN', recon: '21100000', ccterms: 'NT30', porg: '1010', curr: 'EUR', pterms: 'NT30', grIv: true }),
  tb: c => c.m.mode === 'start' ? [{ l: 'Organization', i: '🏢', t: 'Create organization', a: c => act(c => { Object.assign(c.m, TX.BP.init(), { mode: 'create', tab: 'addr' }); }) }, { l: 'Display', i: '👓', a: c => act(TX.BP.enter) }] : [],
  render: c => {
    const m = c.m;
    if (m.mode === 'start') return box('Business partner', F('Business partner', 'bp', { f4: 'vendor', w: 12 })) +
      `<div class="tip">In S/4HANA a supplier is a <b>business partner</b> with supplier roles: <b>FLVN00</b> Supplier (Fin. Accounting) for company code data and <b>FLVN01</b> Supplier for purchasing data. Click <b>Organization</b> to create one, or enter a number and press Enter to display.</div>`;
    if (m.mode === 'show') {
      const V = S.vendors[m.bp];
      const kv = rows => `<table class="g orgtbl">${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>`;
      return box('Business partner ' + V.id, kv([['Name', V.name], ['Search term', V.search], ['Street', V.street], ['Postcode / city', `${V.post} ${V.city}`], ['Country', ORG.countries[V.country] || V.country], ['Roles', `FLVN00${V.porg?.['1010'] ? ', FLVN01' : ''}`]])) +
        box('Company code 1010', kv([['Reconciliation account', V.cc?.['1010']?.recon || '—'], ['Payment terms', V.cc?.['1010']?.terms || '—']])) +
        box('Purchasing organization 1010', V.porg?.['1010'] ? kv([['Order currency', V.porg['1010'].curr], ['Payment terms', V.porg['1010'].terms], ['GR-based invoice verification', V.porg['1010'].grIv ? 'Yes' : 'No']]) : `<div class="warnbox">No purchasing data: role FLVN01 is missing, so you cannot create purchase orders for this supplier.</div>`);
    }
    const t = tabOn(c, BPTABS);
    let inner = '';
    if (t === 'addr') inner = F('Name', 'name', { req: 1, w: 36 }) + F('Search term 1', 'search', { w: 12 }) + F('Street / house no.', 'street', { w: 36 }) + F('Postcode', 'post', { w: 8 }) + F('City', 'city', { req: 1, w: 24 }) + F('Country', 'country', { req: 1, f4: 'country', w: 4, desc: ORG.countries[U(m.country)] || '' }) + F('Language', 'lang', { type: 'select', opts: { EN: 'English', FR: 'French' } });
    if (t === 'cc') inner = F('Company code', '_cc', { ro: 1, w: 6, desc: '1010 Riviera Trading SAS' }) + F('Reconciliation acct', 'recon', { req: 1, w: 10, desc: 'Accounts payable – domestic' }) + F('Payment terms', 'ccterms', { f4: 'terms', w: 6, desc: ORG.payterms[U(m.ccterms)] || '' });
    if (t === 'purch') inner = F('Purchasing org.', 'porg', { ro: 1, w: 6, desc: ORG.porgs['1010'] }) + F('Order currency', 'curr', { ro: 1, w: 5 }) + F('Payment terms', 'pterms', { f4: 'terms', w: 6, desc: ORG.payterms[U(m.pterms)] || '' }) + F('GR-based inv. verif.', 'grIv', { type: 'check' }) +
      `<div class="tip">This tab is saved only if role FLVN01 is ticked. GR-based invoice verification means invoices are matched against each goods receipt.</div>`;
    return box('Grouping & roles', `${F('BP role FLVN00', 'r00', { type: 'check', desc: 'Supplier (Fin. Accounting)' })}${F('BP role FLVN01', 'r01', { type: 'check', desc: 'Supplier (purchasing)' })}`) + tabs(c, BPTABS) + box(BPTABS.find(x => x[0] === t)[1], inner);
  },
  enter: c => {
    const m = c.m;
    if (m.mode === 'start') {
      if (!String(m.bp).trim()) err('Enter a business partner number, or click Organization to create one', null, 'bp');
      needVendor(m.bp, null, 'bp'); m.bp = String(m.bp).trim(); m.mode = 'show'; emit('BP_DISPLAY', { bp: m.bp });
    }
  },
  save: c => {
    const m = c.m;
    if (m.mode !== 'create') return;
    if (!m.name.trim()) { m.tab = 'addr'; err('Fill in all required entry fields', null, 'name'); }
    if (!m.city.trim()) { m.tab = 'addr'; err('Fill in all required entry fields', null, 'city'); }
    if (!ORG.countries[U(m.country)]) { m.tab = 'addr'; err(`Country ${m.country} does not exist`, null, 'country'); }
    if (!m.r00) err('Select at least role FLVN00 Supplier (Fin. Accounting)', null, 'r00');
    if (!ORG.payterms[U(m.ccterms)]) { m.tab = 'cc'; err(`Payment terms ${m.ccterms} do not exist`, null, 'ccterms'); }
    const v = { name: m.name.trim(), search: (m.search || m.name).trim().toUpperCase().slice(0, 10), street: m.street.trim(), post: m.post.trim(), city: m.city.trim(), country: U(m.country), lang: m.lang,
      cc: { '1010': { recon: m.recon, terms: U(m.ccterms) } } };
    if (m.r01) { if (!ORG.payterms[U(m.pterms)]) { m.tab = 'purch'; err(`Payment terms ${m.pterms} do not exist`, null, 'pterms'); } v.porg = { '1010': { curr: 'EUR', terms: U(m.pterms), grIv: !!m.grIv } }; }
    const id = createVendor(v);
    emit('VENDOR_CREATED', { bp: id, purch: !!m.r01 });
    c.m = TX.BP.init(); c.m.bp = id;
    msg('S', `Business partner ${id} created${m.r01 ? '' : ' (no purchasing data: role FLVN01 not assigned)'}`);
  },
  back: c => { if (c.m.mode !== 'start') { c.m.mode = 'start'; return true; } }
};

// ---------------- ME11 / ME13: Info record ----------------
TX.ME11 = {
  title: c => c.m.step === 2 ? 'Create Info Record: Purch. Organization Data 1' : 'Create Info Record: Initial Screen',
  init: () => ({ step: 1, vendor: '', matnr: '', porg: '1010', plant: '1010', price: '', per: '1', days: '5', stdQty: '1' }),
  render: c => {
    const m = c.m;
    const hdr = F('Supplier', 'vendor', { req: 1, f4: 'vendor', w: 12, ro: m.step === 2, desc: vname(String(m.vendor).trim()) }) + F('Material', 'matnr', { req: 1, f4: 'mat', w: 18, ro: m.step === 2, desc: S.materials[U(m.matnr)]?.desc || '' }) +
      F('Purchasing org.', 'porg', { req: 1, f4: 'porg', w: 6, ro: m.step === 2 }) + F('Plant', 'plant', { f4: 'plant', w: 6, ro: m.step === 2 }) + F('Info category', '_cat', { ro: 1, w: 10, desc: 'Standard' });
    if (m.step === 1) return box('Info record', hdr) + `<div class="tip">An info record stores the price and conditions agreed with one supplier for one material. ME21N proposes its net price automatically.</div>`;
    return box('Info record', hdr) + box('Conditions', F('Net price (EUR)', 'price', { req: 1, num: 1, w: 12 }) + F('Per', 'per', { num: 1, w: 5, desc: S.materials[U(m.matnr)]?.uom }) + F('Planned deliv. time (days)', 'days', { num: 1, w: 5 }) + F('Standard quantity', 'stdQty', { num: 1, w: 8 }));
  },
  enter: c => {
    const m = c.m;
    if (m.step === 2) return;
    req(c, ['vendor', 'matnr', 'porg']);
    m.matnr = U(m.matnr); m.vendor = String(m.vendor).trim();
    needVendor(m.vendor, m.porg, 'vendor'); needMat(m.matnr, m.plant || null, 'matnr');
    if (findInfo(m.vendor, m.matnr, m.porg, m.plant)) err(`Info record for supplier ${m.vendor}, material ${m.matnr} already exists (display with ME13)`, 'INFO_EXISTS', 'matnr');
    m.step = 2;
  },
  save: c => {
    const m = c.m;
    if (m.step === 1) err('Press Enter to go to the conditions screen first');
    const p = N(m.price);
    if (!(p > 0)) err('Enter a net price greater than 0', null, 'price');
    const id = createInfo({ vendor: m.vendor, matnr: m.matnr, porg: m.porg, plant: m.plant, price: p, per: m.per, days: m.days, stdQty: m.stdQty });
    emit('INFO_CREATED', { id, vendor: m.vendor, matnr: m.matnr });
    c.m = TX.ME11.init(); msg('S', `Info record ${id} created`);
  },
  back: c => { if (c.m.step === 2) { c.m.step = 1; return true; } }
};
TX.ME13 = {
  title: 'Display Info Records',
  init: () => ({ vendor: '', matnr: '' }),
  tb: () => [{ l: 'Execute', i: '⏵', a: c => act(TX.ME13.exec) }],
  render: c => {
    const v = String(c.m.vendor).trim(), mt = U(c.m.matnr);
    const rows = S.infos.filter(i => (!v || i.vendor === v) && (!mt || i.matnr === mt));
    return box('Selection', F('Supplier', 'vendor', { f4: 'vendor', w: 12 }) + F('Material', 'matnr', { f4: 'mat', w: 18 }) + `<p class="small muted">Leave fields empty to list all. Press Enter to refresh.</p>`) +
      box('Purchasing info records', grid([{ h: 'Info record', k: 'id' }, { h: 'Supplier', f: r => `${r.vendor} ${esc(vname(r.vendor))}` }, { h: 'Material', f: r => `${r.matnr} ${esc(S.materials[r.matnr]?.desc)}` }, { h: 'POrg', k: 'porg' }, { h: 'Plant', k: 'plant' }, { h: 'Net price', r: 1, f: r => `${money(r.price)} EUR` }, { h: 'Per', r: 1, k: 'per' }, { h: 'Deliv. days', r: 1, k: 'days' }], rows));
  },
  enter: c => { emit('REPORT', { tcode: 'ME13' }); }, exec: c => { emit('REPORT', { tcode: 'ME13' }); }
};

// ---------------- ME51N / ME53N / ME5A: Purchase requisition ----------------
const blankPR = () => ({ matnr: '', short: '', qty: '', uom: '', date: '', plant: '', sloc: '', pgrp: '', vendor: '', valPrice: '' });
function fillPRItems(c) {
  c.m.items.forEach((it, i) => {
    if (!String(it.matnr).trim()) return;
    const k = `items.${i}.`;
    it.matnr = U(it.matnr); it.plant = it.plant || '1010';
    const M = needMat(it.matnr, it.plant, k + 'matnr');
    const pd = M.plants[it.plant];
    it.short = M.desc; it.uom = M.uom; it.sloc = U(it.sloc || pd.slocs[0] || '101A'); it.pgrp = it.pgrp || pd.pgrp;
    if (!it.date) it.date = fmtD(dPlus(7));
    if (it.valPrice === '' || it._auto) { it.valPrice = pd.price ? pd.price.toFixed(2) : ''; it._auto = true; }
    if (String(it.vendor).trim()) needVendor(String(it.vendor).trim(), null, k + 'vendor');
  });
}
TX.ME51N = {
  title: 'Create Purchase Requisition',
  init: () => ({ items: Array.from({ length: 4 }, blankPR) }),
  tb: () => [{ l: 'Check', i: '✔', a: c => act(TX.ME51N.enter) }, { l: 'Add line', i: '＋', a: c => act(c => c.m.items.push(blankPR())) }],
  onInput: (c, k) => { if (k.endsWith('.valPrice')) c.m.items[+k.split('.')[1]]._auto = false; },
  render: c => box('Item overview', grid([
    { h: 'Item', f: (r, i) => (i + 1) * 10 }, { h: 'Material', f: (r, i) => I(`items.${i}.matnr`, { f4: 'mat', w: 9 }) }, { h: 'Short text', f: r => esc(r.short) },
    { h: 'Quantity', f: (r, i) => I(`items.${i}.qty`, { w: 6, num: 1 }) }, { h: 'Unit', f: r => esc(r.uom) }, { h: 'Deliv. date', f: (r, i) => I(`items.${i}.date`, { w: 10, ph: 'DD.MM.YYYY' }) },
    { h: 'Plant', f: (r, i) => I(`items.${i}.plant`, { f4: 'plant', w: 4 }) }, { h: 'SLoc', f: (r, i) => I(`items.${i}.sloc`, { f4: 'sloc', w: 4 }) },
    { h: 'PGr', f: (r, i) => I(`items.${i}.pgrp`, { f4: 'pgrp', w: 3 }) }, { h: 'Desired supplier', f: (r, i) => I(`items.${i}.vendor`, { f4: 'vendor', w: 8 }) },
    { h: 'Val. price', f: (r, i) => I(`items.${i}.valPrice`, { w: 7, num: 1 }) }
  ], c.m.items)) + `<div class="tip">Type the material and press <b>Enter</b>: short text, unit, purchasing group and valuation price are proposed from the material master. A PR is an internal document: it is never sent to the supplier.</div>`,
  enter: c => { fillPRItems(c); },
  save: c => {
    fillPRItems(c);
    const rows = c.m.items.map((it, i) => ({ it, i })).filter(x => String(x.it.matnr).trim());
    if (!rows.length) err('Enter at least one item', null, 'items.0.matnr');
    const items = rows.map(({ it, i }) => {
      const q = N(it.qty); if (!(q > 0)) err(`Item ${(i + 1) * 10}: enter a quantity`, null, `items.${i}.qty`);
      const d = parseD(it.date); if (!d) err('Enter a valid date (DD.MM.YYYY)', null, `items.${i}.date`);
      if (d < today()) err(`Item ${(i + 1) * 10}: delivery date is in the past`, null, `items.${i}.date`);
      if (!ORG.slocs[it.sloc]) err(`Storage location ${it.sloc} does not exist`, null, `items.${i}.sloc`);
      if (!ORG.pgrps[it.pgrp]) err(`Purchasing group ${it.pgrp} does not exist`, null, `items.${i}.pgrp`);
      return { matnr: it.matnr, short: it.short, qty: q, uom: it.uom, plant: it.plant, sloc: it.sloc, date: d, pgrp: it.pgrp, vendor: String(it.vendor).trim(), valPrice: N(it.valPrice) || 0 };
    });
    const num = createPR({ items });
    emit('PR_CREATED', { num, items: items.map(x => ({ matnr: x.matnr, qty: x.qty })) });
    c.m = TX.ME51N.init(); msg('S', `Purchase requisition ${num} created`);
  }
};
TX.ME53N = {
  title: c => c.m.show ? `Display Purchase Requisition ${c.m.pr}` : 'Display Purchase Requisition',
  init: p => ({ pr: p.pr || '', show: false, _auto: !!p.pr }),
  onOpen: c => { if (c.m._auto) TX.ME53N.enter(c); },
  render: c => {
    if (!c.m.show) return box('Purchase requisition', F('Purch. requisition', 'pr', { req: 1, f4: 'pr', w: 12 }));
    const P = S.prs[c.m.pr];
    return box(`Purchase requisition ${P.num} · created ${fmtD(P.date)}`, grid([{ h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Short text', k: 'short' }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'Unit', k: 'uom' }, { h: 'Deliv. date', f: r => fmtD(r.date) }, { h: 'Plant', k: 'plant' }, { h: 'PGr', k: 'pgrp' }, { h: 'Des. supplier', k: 'vendor' }, { h: 'Val. price', r: 1, f: r => money(r.valPrice) },
      { h: 'Status', f: r => r.poRef ? `<span class="badge ok">PO created</span> ${lnk('ME23N', { po: r.poRef }, r.poRef)}` : '<span class="badge warn">Not yet ordered</span>' }], P.items));
  },
  enter: c => {
    if (c.m.show) return;
    req(c, ['pr']); c.m.pr = String(c.m.pr).trim();
    if (!S.prs[c.m.pr]) err(`Purchase requisition ${c.m.pr} does not exist`, null, 'pr');
    c.m.show = true; emit('PR_DISPLAY', { num: c.m.pr });
  },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
};
TX.ME5A = {
  title: 'List Display of Purchase Requisitions',
  init: () => ({ list: false, open: true, matnr: '' }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.ME5A.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Material', 'matnr', { f4: 'mat', w: 18 }) + F('Plant', '_p', { ro: 1, w: 6, desc: '1010' }) + F('Open requisitions only', 'open', { type: 'check' }));
    const mt = U(c.m.matnr);
    const rows = Object.values(S.prs).flatMap(p => p.items.map(i => ({ ...i, num: p.num, pdate: p.date }))).filter(r => (!mt || r.matnr === mt) && (!c.m.open || !r.poRef));
    return box(`Purchase requisitions (${rows.length})`, grid([{ h: 'Purch. req.', f: r => lnk('ME53N', { pr: r.num }, r.num) }, { h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Short text', k: 'short' }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'Unit', k: 'uom' }, { h: 'Deliv. date', f: r => fmtD(r.date) }, { h: 'PGr', k: 'pgrp' }, { h: 'PO', f: r => r.poRef ? lnk('ME23N', { po: r.poRef }, r.poRef) : '—' }], rows));
  },
  exec: c => { c.m.list = true; emit('REPORT', { tcode: 'ME5A' }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};

// ---------------- ME21N / ME23N: Purchase order ----------------
const blankPO = () => ({ matnr: '', short: '', qty: '', uom: '', date: '', price: '', plant: '', sloc: '', prRef: '', prItem: '', _auto: true });
function fillPOItems(c, strict) {
  const m = c.m, h = m.hdr;
  h.vendor = String(h.vendor).trim();
  if (h.vendor) needVendor(h.vendor, h.porg, 'hdr.vendor');
  if (!ORG.porgs[h.porg]) err(`Purchasing organization ${h.porg} does not exist`, null, 'hdr.porg');
  if (!ORG.pgrps[h.pgrp]) err(`Purchasing group ${h.pgrp} does not exist`, null, 'hdr.pgrp');
  const notes = [];
  m.items.forEach((it, i) => {
    if (!String(it.matnr).trim()) return;
    const k = `items.${i}.`;
    it.matnr = U(it.matnr); it.plant = it.plant || '1010';
    const M = needMat(it.matnr, it.plant, k + 'matnr');
    it.short = M.desc; it.uom = M.uom; it.sloc = U(it.sloc || M.plants[it.plant].slocs[0] || '101A');
    if (!it.date) it.date = fmtD(dPlus(7));
    if (h.vendor && (it._auto || it.price === '')) {
      const inf = findInfo(h.vendor, it.matnr, h.porg, it.plant);
      it.price = inf ? (inf.price / inf.per).toFixed(2) : ''; it._auto = true;
      if (!inf) notes.push(`${it.matnr}: no info record for supplier ${h.vendor}, so no price proposed`);
    }
  });
  return notes;
}
function prSourceList() {
  return Object.values(S.prs).flatMap(p => p.items.filter(i => !i.poRef).map(i => ({ ...i, num: p.num })));
}
TX.ME21N = {
  title: 'Create Purchase Order',
  init: () => ({ hdr: { type: 'NB', vendor: '', docDate: fmtD(today()), porg: '1010', pgrp: '001', cc: '1010' }, items: Array.from({ length: 3 }, blankPO), doc: innerWidth > 820 }),
  tb: c => [{ l: c.m.doc ? 'Document overview off' : 'Document overview on', i: '☰', a: c => act(c => { c.m.doc = !c.m.doc; }) }, { l: 'Check', i: '✔', a: c => act(TX.ME21N.check) }, { l: 'Add line', i: '＋', a: c => act(c => c.m.items.push(blankPO())) }],
  onInput: (c, k) => { if (/^items\.\d+\.price$/.test(k)) c.m.items[+k.split('.')[1]]._auto = false; },
  acts: {
    adopt: (c, d) => {
      const P = S.prs[d.pr]; const pi = P.items.find(i => i.item === +d.item);
      if (c.m.items.some(x => x.prRef === P.num && +x.prItem === pi.item)) err(`Requisition ${P.num} item ${pi.item} is already in this PO`);
      let row = c.m.items.find(x => !String(x.matnr).trim());
      if (!row) { row = blankPO(); c.m.items.push(row); }
      Object.assign(row, { matnr: pi.matnr, qty: String(pi.qty), date: fmtD(pi.date < today() ? dPlus(7) : pi.date), plant: pi.plant, sloc: pi.sloc, prRef: P.num, prItem: String(pi.item), _auto: true, price: '' });
      if (!String(c.m.hdr.vendor).trim() && pi.vendor) c.m.hdr.vendor = pi.vendor;
      if (pi.pgrp) c.m.hdr.pgrp = pi.pgrp;
      fillPOItems(c);
      msg('S', `Requisition ${P.num} item ${pi.item} adopted${String(c.m.hdr.vendor).trim() ? '' : ': now enter the supplier'}`);
    }
  },
  render: c => {
    const m = c.m, h = m.hdr;
    const net = sum(m.items.filter(x => String(x.matnr).trim()), x => N(x.qty) * N(x.price) || 0);
    const docov = m.doc ? `<section class="box docov"><h3>Document overview · My open requisitions</h3><div class="in">${grid([{ h: 'Purch. req.', f: r => `<b>${r.num}</b>/${r.item}` }, { h: 'Material', f: r => `${r.matnr} ×${qf(r.qty)}` }, { h: '', f: r => `<button type="button" class="btn sm" data-act="adopt" data-pr="${r.num}" data-item="${r.item}" title="Adopt into PO">Adopt ▸</button>` }], prSourceList(), { empty: 'No open requisitions' })}</div></section>` : '';
    const main = box('Header', `<div class="cols"><div>${F('Order type', 'hdr.type', { ro: 1, w: 4, desc: 'Standard PO' })}${F('Supplier', 'hdr.vendor', { req: 1, f4: 'vendor', w: 12, desc: vname(String(h.vendor).trim()) })}${F('Doc. date', 'hdr.docDate', { w: 10 })}</div>
      <div>${F('Purch. org.', 'hdr.porg', { req: 1, f4: 'porg', w: 6 })}${F('Purch. group', 'hdr.pgrp', { req: 1, f4: 'pgrp', w: 4, desc: ORG.pgrps[h.pgrp] || '' })}${F('Company code', 'hdr.cc', { ro: 1, w: 6, desc: 'Riviera Trading SAS' })}</div></div>`,
      `<span class="small">Net value: <b>${money(net)} EUR</b></span>`) +
      box('Item overview', grid([
        { h: 'Itm', f: (r, i) => (i + 1) * 10 }, { h: 'Material', f: (r, i) => I(`items.${i}.matnr`, { f4: 'mat', w: 9 }) }, { h: 'Short text', f: r => esc(r.short) },
        { h: 'PO quantity', f: (r, i) => I(`items.${i}.qty`, { w: 6, num: 1 }) }, { h: 'OUn', f: r => esc(r.uom) }, { h: 'Deliv. date', f: (r, i) => I(`items.${i}.date`, { w: 10, ph: 'DD.MM.YYYY' }) },
        { h: 'Net price', f: (r, i) => I(`items.${i}.price`, { w: 8, num: 1 }) }, { h: 'Curr.', f: () => 'EUR' }, { h: 'Plant', f: (r, i) => I(`items.${i}.plant`, { f4: 'plant', w: 4 }) }, { h: 'SLoc', f: (r, i) => I(`items.${i}.sloc`, { f4: 'sloc', w: 4 }) },
        { h: 'Purch. req.', f: r => r.prRef ? `${r.prRef}/${r.prItem}` : '' }
      ], m.items)) +
      `<div class="tip">Enter the supplier and materials, then press <b>Enter</b>: the net price is proposed from the info record. Use <b>Adopt</b> in the document overview to create the PO with reference to a requisition. Save with <b>Ctrl+S</b>.</div>`;
    return `<div class="split ${m.doc ? '' : 'nodo'}">${docov}<div>${main}</div></div>`;
  },
  enter: c => { const n = fillPOItems(c); if (n.length) msg('W', n[0]); },
  check: c => { TX.ME21N.validate(c); msg('S', 'No messages issued during check'); },
  validate: c => {
    const m = c.m, h = m.hdr;
    if (!String(h.vendor).trim()) err('Enter a supplier', null, 'hdr.vendor');
    fillPOItems(c);
    const d0 = parseD(h.docDate); if (!d0) err('Enter a valid date (DD.MM.YYYY)', null, 'hdr.docDate');
    const rows = m.items.map((it, i) => ({ it, i })).filter(x => String(x.it.matnr).trim());
    if (!rows.length) err('Enter at least one item', null, 'items.0.matnr');
    return rows.map(({ it, i }) => {
      const k = `items.${i}.`, no = pad((i + 1) * 10, 5);
      const q = N(it.qty); if (!(q > 0)) err(`Item ${no}: enter a PO quantity`, 'NO_QTY', k + 'qty');
      const p = N(it.price); if (!(p > 0)) err(`Item ${no}: net price must be greater than 0`, 'NO_PRICE', k + 'price');
      const d = parseD(it.date); if (!d) err('Enter a valid date (DD.MM.YYYY)', null, k + 'date');
      if (d < today()) err(`Item ${no}: delivery date is in the past`, null, k + 'date');
      if (!ORG.slocs[it.sloc]) err(`Storage location ${it.sloc} does not exist`, null, k + 'sloc');
      return { matnr: it.matnr, short: it.short, qty: q, uom: it.uom, price: r2(p), plant: it.plant, sloc: it.sloc, date: d, prRef: it.prRef, prItem: it.prItem };
    });
  },
  save: c => {
    const items = TX.ME21N.validate(c), h = c.m.hdr;
    const num = createPO({ vendor: h.vendor, porg: h.porg, pgrp: h.pgrp, cc: h.cc, docDate: parseD(h.docDate), items });
    emit('PO_CREATED', { num, vendor: h.vendor, items: items.map(x => ({ matnr: x.matnr, qty: x.qty, price: x.price, prRef: x.prRef })) });
    c.m = TX.ME21N.init(); msg('S', `Standard PO created under the number ${num}`);
  }
};
const POTABS = [['hist', 'Purchase order history'], ['status', 'Status'], ['cond', 'Conditions']];
TX.ME23N = {
  title: c => c.m.show ? `Standard PO ${c.m.po} Display` : 'Display Purchase Order',
  init: p => ({ po: p.po || '', show: false, sel: 0, _auto: !!p.po }),
  onOpen: c => { if (c.m._auto) TX.ME23N.enter(c); },
  tb: c => c.m.show ? [{ l: 'Other purchase order', i: '⇄', a: c => act(c => { c.m.show = false; c.m.po = ''; c.m._auto = false; }) }] : [],
  acts: { sel: (c, d) => { c.m.sel = +d.i; } },
  render: c => {
    if (!c.m.show) return box('Purchase order', F('Purchase order', 'po', { req: 1, f4: 'po', w: 12 })) + `<div class="tip">Press F4 or ▼ to search all purchase orders.</div>`;
    const P = S.pos[c.m.po], V = S.vendors[P.vendor];
    const it = P.items[c.m.sel] || P.items[0];
    const t = tabOn(c, POTABS);
    const tt = poTotals(P, it);
    let detail = '';
    if (t === 'hist') {
      const h = P.history.filter(x => x.item === it.item);
      const foot = h.length ? `<tr class="tot"><td colspan="5">Total goods receipts</td><td class="r">${qf(tt.gr)}</td><td class="r">${money(tt.grVal)}</td><td></td></tr><tr class="tot"><td colspan="5">Total invoice receipts</td><td class="r">${qf(tt.ir)}</td><td class="r">${money(tt.irVal)}</td><td></td></tr>` : '';
      detail = grid([{ h: 'Sh. text', f: r => r.type === 'WE' ? 'WE' : 'RE-L' }, { h: 'MvT', k: 'mvt' }, { h: 'Material doc.', f: r => r.type === 'WE' ? lnk('MIGO', { display: r.doc }, r.doc) : lnk('MIR4', { inv: r.doc }, r.doc) }, { h: 'Item', f: () => '1' }, { h: 'Pstng date', f: r => fmtD(r.date) },
        { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'Amount EUR', r: 1, f: r => money(r.amount) }, { h: 'Status', f: r => r.type === 'RE' && S.invoices[r.doc]?.blocked ? '<span class="badge err">Blocked for payment</span>' : '' }], h, { empty: 'No PO history yet: no goods receipt or invoice posted for this item', foot });
    }
    if (t === 'status') detail = `<table class="g orgtbl"><tr><td>Ordered</td><td>${qf(it.qty)} ${it.uom} · ${money(it.qty * it.price / it.per)} EUR</td></tr><tr><td>Delivered</td><td>${qf(tt.gr)} ${it.uom}</td></tr><tr><td>Still to deliver</td><td>${qf(tt.toDeliver)} ${it.uom}</td></tr><tr><td>Invoiced</td><td>${qf(tt.ir)} ${it.uom} · ${money(tt.irVal)} EUR</td></tr><tr><td>GR-based invoice verification</td><td>${it.grBased ? 'Yes' : 'No'}</td></tr></table>`;
    if (t === 'cond') { const inf = findInfo(P.vendor, it.matnr, P.porg, it.plant); detail = `<table class="g orgtbl"><tr><td>PB00 Gross price</td><td>${money(it.price)} EUR / ${it.per} ${it.uom}</td></tr><tr><td>Net value</td><td>${money(it.qty * it.price / it.per)} EUR</td></tr><tr><td>Source</td><td>${inf ? `Info record ${inf.id}` : 'Entered manually'}</td></tr></table>`; }
    return box(`Header · ${P.type} Standard PO ${P.num}`, `<div class="cols"><div><div class="f"><label>Supplier</label><b>${P.vendor}</b><span>${esc(V?.name)}</span></div><div class="f"><label>Doc. date</label><span>${fmtD(P.docDate)}</span><span></span></div></div>
      <div><div class="f"><label>Purch. org. / group</label><span>${P.porg} / ${P.pgrp}</span><span></span></div><div class="f"><label>Company code</label><span>${P.cc}</span><span></span></div></div></div>`) +
      box('Item overview', grid([{ h: 'Itm', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Short text', k: 'short' }, { h: 'PO qty', r: 1, f: r => qf(r.qty) }, { h: 'OUn', k: 'uom' }, { h: 'Deliv. date', f: r => fmtD(r.date) }, { h: 'Net price', r: 1, f: r => money(r.price) }, { h: 'Plant', k: 'plant' }, { h: 'SLoc', k: 'sloc' }, { h: 'Purch. req.', f: r => r.prRef ? lnk('ME53N', { pr: r.prRef }, r.prRef) : '' },
        { h: 'Status', f: r => { const x = poTotals(P, r); return x.toDeliver <= 0 ? (x.toInvoice <= 0 ? '<span class="badge ok">Delivered & invoiced</span>' : '<span class="badge warn">To be invoiced</span>') : x.gr > 0 ? '<span class="badge warn">Partly delivered</span>' : '<span class="badge">Open</span>'; } }],
        P.items.map((r, i) => ({ ...r, _cls: i === c.m.sel ? 'on' : '' })), { click: (r, i) => `data-act="sel" data-i="${i}"` })) +
      tabs(c, POTABS) + box(`Item ${pad(it.item, 5)} [ ${it.matnr} ] ${esc(it.short)}`, detail);
  },
  enter: c => {
    if (c.m.show) return;
    req(c, ['po']); c.m.po = String(c.m.po).trim();
    if (!S.pos[c.m.po]) err(`Purchasing document ${c.m.po} does not exist`, null, 'po');
    c.m.show = true; c.m.tab = 'hist';
    emit('PO_DISPLAY', { num: c.m.po, hist: S.pos[c.m.po].history.length });
  },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
};

// ---------------- MIGO: Goods movement ----------------
TX.MIGO = {
  title: c => ({ A01: 'Goods Receipt Purchase Order', A03: 'Cancellation Material Document', A04: 'Display Material Document' })[c.m.action] + (c.m.loaded ? ` ${c.m.loaded} – ${c.m.action === 'A01' ? vname(S.pos[c.m.loaded]?.vendor) : 'TRAINEE'}` : ''),
  init: p => ({ action: p.display ? 'A04' : 'A01', doc: p.display || '', mvt: '101', docDate: fmtD(today()), postDate: fmtD(today()), text: '', lines: [], loaded: '', _auto: !!p.display }),
  onOpen: c => { if (c.m._auto) TX.MIGO.load(c); },
  onInput: (c, k) => { if (k === 'action') { c.m.lines = []; c.m.loaded = ''; c.m.doc = ''; } },
  tb: c => [{ l: 'Execute', i: '⏵', t: 'Load document (Enter)', a: c => act(TX.MIGO.load) }, ...(c.m.action !== 'A04' ? [{ l: 'Check', i: '✔', a: c => act(TX.MIGO.check) }, { l: 'Post', i: '💾', a: c => act(TX.MIGO.save) }] : [])],
  render: c => {
    const m = c.m;
    const top = `<div class="box"><div class="in" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${I('action', { type: 'select', opts: { A01: 'A01 Goods Receipt', A03: 'A03 Cancellation', A04: 'A04 Display' }, rr: 1 })}
      ${I('_ref', { type: 'select', opts: m.action === 'A01' ? { R01: 'R01 Purchase Order' } : { R02: 'R02 Material Document' } })}
      ${I('doc', { req: 1, f4: m.action === 'A01' ? 'po' : 'matdoc', w: 12, ph: m.action === 'A01' ? 'PO number' : 'Mat. doc.' })}
      ${m.action === 'A01' ? `<span class="muted">GR goods receipt</span> ${I('mvt', { ro: 1, w: 4 })}` : ''}
      <button type="button" class="btn sm" data-act="load">⏵ Execute</button></div></div>`;
    if (!m.loaded) return top + `<div class="tip">${m.action === 'A01' ? 'Enter the purchase order number (F4 to search) and press <b>Enter</b>. Then tick <b>Item OK</b> for each line you received and <b>Post</b>.' : 'Enter the material document number and press <b>Enter</b>.'}</div>`;
    if (m.action === 'A04') {
      const D = S.matDocs[m.loaded];
      return top + box(`Material document ${D.num} / ${D.year}`, `<div class="cols"><div><div class="f"><label>Movement type</label><b>${D.mvt}</b><span>${ORG.mvts[D.mvt]}</span></div><div class="f"><label>Posting date</label><span>${fmtD(D.date)}</span><span></span></div></div>
        <div><div class="f"><label>Accounting document</label>${lnk('FB03', { doc: D.acc }, D.acc)}<span></span></div><div class="f"><label>Status</label><span>${D.reversedBy ? `Reversed by ${D.reversedBy}` : D.revOf ? `Reversal of ${D.revOf}` : 'Posted'}</span><span></span></div></div></div>`) +
        box('Items', grid([{ h: 'Line', k: 'line' }, { h: 'Material', k: 'matnr' }, { h: 'Description', f: r => esc(S.materials[r.matnr]?.desc) }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'EUn', k: 'uom' }, { h: 'Plant', k: 'plant' }, { h: 'SLoc', k: 'sloc' }, { h: 'Stock type', f: r => ORG.stypes[r.stype] }, { h: 'Purchase order', f: r => lnk('ME23N', { po: r.po }, `${r.po} ${r.poItem}`) }, { h: 'Amount EUR', r: 1, f: r => money(r.amount) }], D.items));
    }
    return top + box('Header', `<div class="cols"><div>${F('Document date', 'docDate', { w: 10 })}${F('Posting date', 'postDate', { w: 10 })}</div><div>${F('Header text', 'text', { w: 24 })}${m.action === 'A01' ? `<div class="f"><label>Supplier</label><b>${S.pos[m.loaded].vendor}</b><span>${esc(vname(S.pos[m.loaded].vendor))}</span></div>` : ''}</div></div>`) +
      box('Items', grid([
        { h: 'OK', f: (r, i) => I(`lines.${i}.ok`, { type: 'check' }) }, { h: 'Line', f: (r, i) => i + 1 }, { h: 'Material', f: r => `${r.matnr} <span class="muted">${esc(S.materials[r.matnr]?.desc)}</span>` },
        { h: 'Qty in UnE', f: (r, i) => m.action === 'A01' ? I(`lines.${i}.qty`, { w: 6, num: 1 }) : qf(r.qty) }, { h: 'EUn', k: 'uom' },
        { h: 'SLoc', f: (r, i) => m.action === 'A01' ? I(`lines.${i}.sloc`, { f4: 'sloc', w: 4 }) : r.sloc },
        { h: 'Stock type', f: (r, i) => m.action === 'A01' ? I(`lines.${i}.stype`, { type: 'select', opts: ORG.stypes }) : ORG.stypes[r.stype] },
        { h: 'Plant', k: 'plant' }, { h: m.action === 'A01' ? 'Open qty' : 'PO', f: r => m.action === 'A01' ? qf(r.open) : `${r.po} ${r.poItem}` }, { h: 'MvT', f: () => m.action === 'A01' ? '101' : '102' }
      ], m.lines)) + (m.action === 'A01' ? '<div class="tip">Change the quantity for a partial delivery. Choose <b>Quality inspection</b> as stock type if the goods must be checked before use.</div>' : '<div class="warnbox">Posting creates a reversal document with movement type <b>102</b> and takes the quantity back out of stock.</div>');
  },
  acts: { load: c => TX.MIGO.load(c) },
  enter: c => { if (!c.m.loaded || c.m.loaded !== String(c.m.doc).trim()) TX.MIGO.load(c); },
  load: c => {
    const m = c.m; m.doc = String(m.doc).trim(); m.lines = []; m.loaded = '';
    if (!m.doc) err('Fill in all required entry fields', null, 'doc');
    if (m.action === 'A01') {
      const P = S.pos[m.doc];
      if (!P) err(`Purchase order ${m.doc} does not exist`, null, 'doc');
      m.lines = P.items.map(it => ({ it, t: poTotals(P, it) })).filter(x => x.t.toDeliver > 0).map(({ it, t }) => ({ item: it.item, matnr: it.matnr, qty: String(t.toDeliver), open: t.toDeliver, uom: it.uom, sloc: it.sloc, plant: it.plant, stype: 'unr', ok: false }));
      if (!m.lines.length) err(`Document ${m.doc} does not contain any selectable items`, 'NO_ITEMS', 'doc');
      m.loaded = m.doc; emit('GR_LOADED', { po: m.doc });
    } else {
      const D = S.matDocs[m.doc];
      if (!D) err(`Material document ${m.doc} does not exist`, null, 'doc');
      if (m.action === 'A03') {
        if (D.mvt !== '101') err(`Material document ${m.doc} is a reversal document and cannot be cancelled`, null, 'doc');
        if (D.reversedBy) err(`Material document ${m.doc} has already been cancelled (by ${D.reversedBy})`, null, 'doc');
        m.lines = D.items.map(x => ({ ...x, ok: true }));
      }
      m.loaded = m.doc;
      if (m.action === 'A04') emit('MD_DISPLAY', { md: m.doc });
    }
  },
  check: c => { TX.MIGO.validate(c); msg('S', 'Document is O.K.'); },
  validate: c => {
    const m = c.m;
    if (!m.loaded) err('Enter a document and press Enter first', null, 'doc');
    const date = needDate(c, 'postDate');
    if (date > today()) err('Posting date is in the future', null, 'postDate');
    const sel = m.lines.map((l, i) => ({ l, i })).filter(x => x.l.ok);
    if (!sel.length) err('No item selected: tick "Item OK" for each line to post', 'NOT_OK', 'lines.0.ok');
    if (m.action === 'A01') {
      const P = S.pos[m.loaded];
      return { date, lines: sel.map(({ l, i }) => {
        const q = N(l.qty);
        if (!(q > 0)) err(`Line ${i + 1}: enter a quantity`, null, `lines.${i}.qty`);
        if (q > l.open + 1e-9) err(`PO quantity exceeded by ${qf(q - l.open)} ${l.uom} : ${l.matnr} ${P.num} ${pad(l.item, 5)}`, 'QTY_EXCEEDED', `lines.${i}.qty`);
        l.sloc = U(l.sloc); if (!ORG.slocs[l.sloc]) err(`Storage location ${l.sloc || '(empty)'} does not exist`, null, `lines.${i}.sloc`);
        return { item: l.item, qty: q, sloc: l.sloc, stype: l.stype };
      }) };
    }
    const D = S.matDocs[m.loaded], P = S.pos[D.items[0].po];
    for (const x of D.items) {
      const st = getStock(x.matnr, x.plant, x.sloc);
      if (st[x.stype] < x.qty) err(`Deficit of ${ORG.stypes[x.stype]} stock ${qf(x.qty - st[x.stype])} ${x.uom} : ${x.matnr} ${x.plant} ${x.sloc}`, 'DEFICIT');
      const it = P.items.find(i => i.item === x.poItem); const t = poTotals(P, it);
      if (t.gr - x.qty < t.ir - 1e-9) err(`Cannot cancel: ${qf(t.ir)} ${x.uom} already invoiced for PO ${P.num} ${pad(it.item, 5)}. Cancel the invoice first.`, 'INVOICED');
    }
    return { date, D, P };
  },
  save: c => {
    const m = c.m;
    if (m.action === 'A04') return;
    const v = TX.MIGO.validate(c);
    if (m.action === 'A01') {
      const md = postGR({ po: m.loaded, lines: v.lines, date: v.date, text: m.text });
      const po = m.loaded;
      emit('GR_POSTED', { po, md, items: v.lines.map(x => ({ item: x.item, qty: x.qty, stype: x.stype })), complete: S.pos[po].items.every(i => poTotals(S.pos[po], i).toDeliver <= 0) });
      c.m = TX.MIGO.init({}); msg('S', `Material document ${md} posted`);
    } else {
      const md = postGR({ po: v.P.num, mvt: '102', revOf: v.D.num, date: v.date, lines: v.D.items.map(x => ({ item: x.poItem, qty: x.qty, sloc: x.sloc, stype: x.stype })) });
      emit('GR_REVERSED', { md, of: v.D.num, po: v.P.num });
      c.m = TX.MIGO.init({}); c.m.action = 'A03'; msg('S', `Material document ${md} posted (reversal of ${v.D.num})`);
    }
  },
  back: c => { if (c.m.loaded && !c.m._auto) { c.m.loaded = ''; c.m.lines = []; return true; } }
};

// ---------------- MIRO / MIR4 / MRBR: Invoice verification ----------------
function miroCalc(m) {
  const items = m.items.filter(x => x.sel);
  const net = r2(sum(items, x => N(x.amount) || 0));
  const rate = ORG.tax[U(m.tax)]?.[1] ?? 0;
  const tax = m.calc ? r2(net * rate) : r2(N(m.taxAmt) || 0);
  const bal = r2((N(m.gross) || 0) - net - tax);
  return { net, tax, bal, items };
}
TX.MIRO = {
  title: c => `Enter Incoming Invoice: Company Code 1010`,
  init: () => ({ date: fmtD(today()), post: fmtD(today()), ref: '', gross: '', tax: 'V1', calc: true, taxAmt: '', po: '', loaded: '', items: [], tab: 'basic' }),
  tb: () => [{ l: 'Simulate', i: '🔍', a: c => act(TX.MIRO.simulate) }, { l: 'Post', i: '💾', a: c => act(TX.MIRO.save) }],
  render: c => {
    const m = c.m, k = miroCalc(m), P = S.pos[m.loaded];
    const light = !m.loaded ? 'n' : k.bal === 0 && k.items.length ? 'g' : 'r';
    return `<div class="balance"><span class="light ${light}"></span>Balance <span class="amt">${money(k.bal)} EUR</span><span class="muted small">· Net ${money(k.net)} · Tax ${money(k.tax)}${P ? ` · Supplier ${P.vendor} ${esc(vname(P.vendor))}` : ''}</span></div>` +
      `<div class="cols">${box('Basic data', F('Transaction', '_t', { ro: 1, w: 10, desc: 'Invoice' }) + F('Invoice date', 'date', { req: 1, w: 10 }) + F('Reference', 'ref', { req: 1, w: 16, ph: "Supplier's invoice no." }) + F('Posting date', 'post', { w: 10 }) +
        F('Amount (gross)', 'gross', { req: 1, w: 12, num: 1, desc: 'EUR' }) + F('Tax code', 'tax', { f4: 'tax', w: 4, desc: ORG.tax[U(m.tax)]?.[0] || '' }) + F('Calculate tax', 'calc', { type: 'check', rr: 1 }) + (m.calc ? '' : F('Tax amount', 'taxAmt', { w: 12, num: 1 })))}
      ${box('PO reference', F('Purchase order', 'po', { req: 1, f4: 'po', w: 12 }) + `<div class="tip">Enter the PO and press <b>Enter</b>: items are proposed from the goods receipts not yet invoiced (GR-based IV). Then type the supplier's gross amount and press <b>Enter</b> until the balance is <b>0.00</b> (green light).</div>`)}</div>` +
      box('Items', grid([
        { h: 'Sel', f: (r, i) => I(`items.${i}.sel`, { type: 'check', rr: 1 }) }, { h: 'Item', k: 'item' }, { h: 'Amount', f: (r, i) => I(`items.${i}.amount`, { w: 9, num: 1 }) }, { h: 'Quantity', f: (r, i) => I(`items.${i}.qty`, { w: 6, num: 1 }) }, { h: 'OUn', k: 'uom' },
        { h: 'Material', k: 'matnr' }, { h: 'Short text', k: 'short' }, { h: 'PO price', r: 1, f: r => money(r.unit) }, { h: 'Tax code', f: () => esc(U(m.tax)) }
      ], m.items, { empty: 'Enter a purchase order and press Enter' }));
  },
  enter: c => {
    const m = c.m; m.po = String(m.po).trim();
    if (m.po && m.po !== m.loaded) {
      const P = S.pos[m.po];
      if (!P) err(`Purchase order ${m.po} does not exist`, null, 'po');
      const items = P.items.map(it => ({ it, t: poTotals(P, it) })).filter(x => x.t.toInvoice > 0)
        .map(({ it, t }) => ({ item: it.item, qty: String(t.toInvoice), amount: r2(t.toInvoice * it.price / it.per).toFixed(2), uom: it.uom, matnr: it.matnr, short: it.short, unit: it.price / it.per, sel: true }));
      if (!items.length) err(`No suitable purchase order history entry found for invoice receipt (PO ${m.po}: post the goods receipt first)`, 'NO_GR', 'po');
      m.items = items; m.loaded = m.po;
      emit('IR_LOADED', { po: m.po });
    }
    if (!ORG.tax[U(m.tax)]) err(`Tax code ${m.tax} does not exist`, null, 'tax');
    m.items.forEach(x => { x.amount = (N(x.amount) || 0).toFixed(2); });
    const k = miroCalc(m);
    if (m.loaded && N(m.gross) && k.bal !== 0) msg('W', `Balance is not zero: ${money(k.bal)} EUR`);
  },
  validate: c => {
    const m = c.m;
    TX.MIRO.enter(c);
    req(c, ['date', 'ref', 'gross', 'po']);
    const d = needDate(c, 'date'); const pd = needDate(c, 'post');
    if (!m.loaded) err('Enter the purchase order and press Enter', null, 'po');
    const k = miroCalc(m);
    if (!k.items.length) err('Select at least one item', null, 'items.0.sel');
    k.items.forEach(x => { const i = m.items.indexOf(x); if (!(N(x.qty) > 0)) err(`Item ${x.item}: enter a quantity`, null, `items.${i}.qty`); if (!(N(x.amount) > 0)) err(`Item ${x.item}: enter an amount`, null, `items.${i}.amount`); });
    if (k.bal !== 0) err(`Balance is not zero: ${money(k.bal)} EUR. The gross amount must equal items + tax.`, 'BALANCE', 'gross');
    return { po: m.loaded, date: pd, docDate: d, ref: m.ref.trim(), gross: N(m.gross), taxCode: U(m.tax), tax: k.tax, items: k.items.map(x => ({ item: x.item, qty: N(x.qty), amount: N(x.amount) })) };
  },
  simulate: c => {
    const v = TX.MIRO.validate(c);
    const r = computeIR(v);
    modal('Simulate document', grid([{ h: 'Pos.', f: (x, i) => i + 1 }, { h: 'PK', k: 'pk' }, { h: 'G/L / supplier', f: x => x.vendor ? `${x.vendor} ${esc(vname(x.vendor))}` : `${x.gl} ${esc(x.text)}` }, { h: 'D/C', f: x => x.dc === 'D' ? 'Debit' : 'Credit' }, { h: 'Amount EUR', r: 1, f: x => (x.dc === 'C' ? '-' : '') + money(x.amt) }], r.acc) +
      (r.blocked ? `<div class="warnbox"><b>Invoice will be blocked for payment:</b><br>${r.reasons.map(esc).join('<br>')}</div>` : '<div class="tip">No variances: the invoice will be released for payment.</div>'), [{ l: 'Close' }, { l: 'Post', pri: 1, a: () => act(TX.MIRO.save) }]);
    msg('S', 'Simulation: document balances to zero');
  },
  save: c => {
    const v = TX.MIRO.validate(c);
    const inv = postIR(v); const I_ = S.invoices[inv];
    emit('IR_POSTED', { inv, po: v.po, blocked: I_.blocked, qty: sum(v.items, x => x.qty) });
    c.m = TX.MIRO.init();
    msg(I_.blocked ? 'W' : 'S', I_.blocked ? `Document no. ${inv} created: blocked for payment (${I_.reasons.length} variance${I_.reasons.length > 1 ? 's' : ''}, release with MRBR)` : `Document no. ${inv} created`);
  }
};
TX.MIR4 = {
  title: c => c.m.show ? `Display Invoice Document ${c.m.inv} ${S.invoices[c.m.inv]?.year || ''}` : 'Display Invoice Document',
  init: p => ({ inv: p.inv || '', show: false, _auto: !!p.inv }),
  onOpen: c => { if (c.m._auto) TX.MIR4.enter(c); },
  render: c => {
    if (!c.m.show) return box('Invoice document', F('Invoice document no.', 'inv', { req: 1, f4: 'inv', w: 12 }) + F('Fiscal year', '_y', { ro: 1, w: 5, desc: String(new Date().getFullYear()) }));
    const D = S.invoices[c.m.inv];
    return box(`Invoice ${D.num} / ${D.year}`, `<table class="g orgtbl"><tr><td>Supplier</td><td>${D.vendor} ${esc(vname(D.vendor))}</td></tr><tr><td>Reference</td><td>${esc(D.ref)}</td></tr><tr><td>Invoice date / posting</td><td>${fmtD(D.date)}</td></tr><tr><td>Gross amount</td><td>${money(D.gross)} EUR (tax ${D.taxCode}: ${money(D.tax)})</td></tr>
      <tr><td>Purchase order</td><td>${lnk('ME23N', { po: D.po }, D.po)}</td></tr><tr><td>Accounting document</td><td>${lnk('FB03', { doc: D.acc }, D.acc)}</td></tr>
      <tr><td>Payment status</td><td>${D.blocked ? '<span class="badge err">Blocked for payment (R)</span>' : D.released ? `<span class="badge ok">Released ${fmtD(D.released)}</span>` : '<span class="badge ok">Free for payment</span>'}</td></tr></table>${D.reasons.length ? `<div class="warnbox">${D.reasons.map(esc).join('<br>')}</div>` : ''}`) +
      box('PO reference', grid([{ h: 'Item', k: 'item' }, { h: 'Material', f: r => S.pos[D.po].items.find(i => i.item === r.item)?.matnr }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'Amount EUR', r: 1, f: r => money(r.amount) }], D.items));
  },
  enter: c => {
    if (c.m.show) return;
    req(c, ['inv']); c.m.inv = String(c.m.inv).trim();
    if (!S.invoices[c.m.inv]) err(`Invoice document ${c.m.inv} does not exist`, null, 'inv');
    c.m.show = true; emit('INV_DISPLAY', { inv: c.m.inv });
  },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
};
TX.MRBR = {
  title: 'Release Blocked Invoices',
  init: () => ({ list: false, sel: {} }),
  tb: c => c.m.list ? [{ l: 'Release', i: '🔓', a: c => act(TX.MRBR.release) }] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MRBR.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Company code', '_cc', { ro: 1, w: 6, desc: '1010' }) + F('Release', '_r', { ro: 1, w: 18, desc: 'Manual release' })) + '<div class="tip">Press <b>F8</b> (Execute) to list invoices blocked for payment.</div>';
    const rows = Object.values(S.invoices).filter(i => i.blocked);
    return box(`Blocked invoices (${rows.length})`, grid([{ h: 'Sel', f: r => I(`sel.${r.num}`, { type: 'check' }) }, { h: 'Invoice', f: r => lnk('MIR4', { inv: r.num }, r.num) }, { h: 'Supplier', f: r => `${r.vendor} ${esc(vname(r.vendor))}` }, { h: 'PO', k: 'po' }, { h: 'Gross EUR', r: 1, f: r => money(r.gross) }, { h: 'Blocking reason', f: r => r.reasons.map(esc).join('<br>') }], rows, { empty: 'No blocked invoices' })) +
      '<div class="tip">Releasing removes payment block R so the payment run (F110) can pay the invoice. In real life, check the variance with the buyer first!</div>';
  },
  exec: c => { c.m.list = true; emit('REPORT', { tcode: 'MRBR' }); },
  release: c => {
    const ids = Object.entries(c.m.sel).filter(([, v]) => v).map(([k]) => k).filter(k => S.invoices[k]?.blocked);
    if (!ids.length) err('Select at least one invoice');
    ids.forEach(k => { S.invoices[k].blocked = false; S.invoices[k].released = today(); });
    c.m.sel = {};
    emit('IR_RELEASED', { invs: ids });
    msg('S', `${ids.length} invoice${ids.length > 1 ? 's' : ''} released for payment`);
  },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};

// ---------------- Reports: MMBE, MB52, MB51, ME2N, ME2M, MB5S ----------------
TX.MMBE = {
  title: c => c.m.list ? 'Stock Overview: Company Code/Plant/Storage Location/Batch' : 'Stock Overview',
  init: p => ({ matnr: p.matnr || '', plant: '1010', list: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MMBE.exec) }],
  render: c => {
    if (!c.m.list) return box('Database selections', F('Material', 'matnr', { req: 1, f4: 'mat', w: 18 }) + F('Plant', 'plant', { f4: 'plant', w: 6 })) + '<div class="tip">Press <b>F8</b> or <b>Enter</b> to execute.</div>';
    const M = S.materials[c.m.matnr], pd = M.plants['1010'];
    const sl = Object.keys(ORG.slocs).filter(s => S.stock[stockKey(M.matnr, '1010', s)]).map(s => ({ s, ...S.stock[stockKey(M.matnr, '1010', s)] }));
    const t = { unr: sum(sl, x => x.unr), qi: sum(sl, x => x.qi), blk: sum(sl, x => x.blk) }; const oo = onOrder(M.matnr, '1010');
    const row = (l, x, cls, ord = '') => `<tr class="${cls}"><td>${l}</td><td class="r">${qf(x.unr)}</td><td class="r">${qf(x.qi)}</td><td class="r">${qf(x.blk)}</td><td class="r">${ord}</td></tr>`;
    return box(`Material ${M.matnr} ${esc(M.desc)} · Base unit ${M.uom} · ${pd.ctrl === 'S' ? 'Standard' : 'Moving'} price ${money(pd.price)} EUR`,
      `<div class="tw"><table class="g"><tr><th>Client / company code / plant / storage location</th><th class="r">Unrestricted use</th><th class="r">Qual. inspection</th><th class="r">Blocked</th><th class="r">On-order stock</th></tr>
      ${row('Full', t, 'tot', qf(oo))}${row('1010 Riviera Trading SAS', t, 'lvl1', qf(oo))}${row('1010 Plant Fréjus', t, 'lvl2', qf(oo))}${sl.map(x => row(`${x.s} ${ORG.slocs[x.s]}`, x, 'lvl3')).join('')}</table></div>
      <div class="tip"><b>On-order stock</b> = quantity in open purchase orders not yet received. It turns into unrestricted (or quality inspection) stock when you post the goods receipt in MIGO.</div>`);
  },
  enter: c => TX.MMBE.exec(c),
  exec: c => { if (c.m.list) return; req(c, ['matnr']); c.m.matnr = U(c.m.matnr); needMat(c.m.matnr, '1010', 'matnr'); c.m.list = true; emit('STOCK_VIEW', { matnr: c.m.matnr }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};
TX.MB52 = {
  title: c => c.m.list ? 'Display Warehouse Stocks of Material' : 'Warehouse Stocks of Material',
  init: () => ({ matnr: '', plant: '1010', list: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MB52.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Material', 'matnr', { f4: 'mat', w: 18 }) + F('Plant', 'plant', { f4: 'plant', w: 6 }));
    const mt = U(c.m.matnr);
    const rows = Object.entries(S.stock).map(([k, v]) => { const [m, p, s] = k.split('|'); return { m, p, s, ...v }; }).filter(r => !mt || r.m === mt)
      .map(r => { const pd = plantData(r.m, r.p); return { ...r, val: r2(r.unr * pd.price), price: pd.price, uom: S.materials[r.m].uom }; });
    const total = sum(rows, r => r.val);
    return box('Warehouse stocks', grid([{ h: 'Material', k: 'm' }, { h: 'Description', f: r => esc(S.materials[r.m].desc) }, { h: 'Plnt', k: 'p' }, { h: 'SLoc', k: 's' }, { h: 'Unrestricted', r: 1, f: r => qf(r.unr) }, { h: 'BUn', k: 'uom' }, { h: 'Value unrestricted', r: 1, f: r => money(r.val) }, { h: 'Qual. insp.', r: 1, f: r => qf(r.qi) }, { h: 'Blocked', r: 1, f: r => qf(r.blk) }], rows,
      { foot: `<tr class="tot"><td colspan="6">Total value</td><td class="r">${money(total)}</td><td colspan="2">EUR</td></tr>` }));
  },
  enter: c => TX.MB52.exec(c), exec: c => { if (c.m.list) return; c.m.list = true; emit('REPORT', { tcode: 'MB52' }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};
TX.MB51 = {
  title: c => c.m.list ? 'Material Document List' : 'Material Document List: Selection',
  init: () => ({ matnr: '', mvt: '', list: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MB51.exec) }],
  render: c => {
    if (!c.m.list) return box('Item data', F('Material', 'matnr', { f4: 'mat', w: 18 }) + F('Plant', '_p', { ro: 1, w: 6, desc: '1010' }) + F('Movement type', 'mvt', { w: 4 }));
    const mt = U(c.m.matnr), mv = String(c.m.mvt).trim();
    const rows = Object.values(S.matDocs).reverse().filter(d => !mv || d.mvt === mv).flatMap(d => d.items.map(x => ({ ...x, num: d.num, mvt: d.mvt, date: d.date }))).filter(r => !mt || r.matnr === mt);
    return box('Material documents', grid([{ h: 'Material', k: 'matnr' }, { h: 'Plnt', k: 'plant' }, { h: 'SLoc', k: 'sloc' }, { h: 'MvT', k: 'mvt' }, { h: 'Mat. doc.', f: r => lnk('MIGO', { display: r.num }, r.num) }, { h: 'Item', k: 'line' }, { h: 'Pstng date', f: r => fmtD(r.date) }, { h: 'Quantity', r: 1, f: r => (r.mvt === '102' ? '-' : '') + qf(r.qty) }, { h: 'EUn', k: 'uom' }, { h: 'Amount EUR', r: 1, f: r => (r.mvt === '102' ? '-' : '') + money(r.amount) }, { h: 'PO', k: 'po' }], rows));
  },
  enter: c => TX.MB51.exec(c), exec: c => { if (c.m.list) return; c.m.list = true; emit('REPORT', { tcode: 'MB51' }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};
const me2n = (code, title) => ({
  title: c => c.m.list ? `Purchasing Documents per ${title}` : `Purchasing Documents per ${title}: Selection`,
  init: () => ({ vendor: '', matnr: '', scope: 'ALL', list: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX[code].exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', (code === 'ME2M' ? F('Material', 'matnr', { f4: 'mat', w: 18 }) + F('Supplier', 'vendor', { f4: 'vendor', w: 12 }) : F('Supplier', 'vendor', { f4: 'vendor', w: 12 }) + F('Material', 'matnr', { f4: 'mat', w: 18 })) + F('Plant', '_p', { ro: 1, w: 6, desc: '1010' }) +
      F('Selection parameters', 'scope', { type: 'select', opts: { ALL: 'ALL – all documents', WE101: 'WE101 – open goods receipts', RE101: 'RE101 – open invoices' } })) + '<div class="tip">Press <b>F8</b> to execute. Selection parameter <b>WE101</b> lists items still to be delivered, <b>RE101</b> items still to be invoiced.</div>';
    const v = String(c.m.vendor).trim(), mt = U(c.m.matnr);
    const rows = Object.values(S.pos).reverse().filter(p => !v || p.vendor === v).flatMap(p => p.items.map(it => ({ ...it, po: p.num, vendor: p.vendor, docDate: p.docDate, t: poTotals(p, it) })))
      .filter(r => (!mt || r.matnr === mt) && (c.m.scope === 'ALL' || (c.m.scope === 'WE101' ? r.t.toDeliver > 0 : r.t.toInvoice > 0)));
    return box(`Purchasing documents (${rows.length})`, grid([{ h: 'Purch. doc.', f: r => lnk('ME23N', { po: r.po }, r.po) }, { h: 'Item', k: 'item' }, { h: 'Supplier', f: r => `${r.vendor} ${esc(vname(r.vendor))}` }, { h: 'Doc. date', f: r => fmtD(r.docDate) }, { h: 'Material', k: 'matnr' }, { h: 'Short text', k: 'short' }, { h: 'PO qty', r: 1, f: r => qf(r.qty) }, { h: 'OUn', k: 'uom' },
      { h: 'Still to deliver', r: 1, f: r => qf(Math.max(0, r.t.toDeliver)) }, { h: 'Still to invoice', r: 1, f: r => qf(Math.max(0, r.t.toInvoice)) }, { h: 'Net price', r: 1, f: r => money(r.price) }, { h: 'Net value', r: 1, f: r => money(r.qty * r.price / r.per) }], rows));
  },
  enter: c => TX[code].exec(c), exec: c => { if (c.m.list) return; c.m.list = true; emit('REPORT', { tcode: code, scope: c.m.scope }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
});
TX.ME2N = me2n('ME2N', 'PO Number');
TX.ME2M = me2n('ME2M', 'Material');
TX.MB5S = {
  title: c => c.m.list ? 'List of GR/IR Balances' : 'List of GR/IR Balances: Selection',
  init: () => ({ only: true, list: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MB5S.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Company code', '_cc', { ro: 1, w: 6, desc: '1010' }) + F('Only items with balance', 'only', { type: 'check' })) + '<div class="tip">The GR/IR clearing account is credited at goods receipt and debited at invoice receipt. A balance means goods received but not invoiced (or the reverse).</div>';
    const rows = Object.values(S.pos).flatMap(p => p.items.map(it => ({ ...it, po: p.num, vendor: p.vendor, t: poTotals(p, it) })))
      .map(r => ({ ...r, dq: r.t.gr - r.t.ir, dv: r2((r.t.gr - r.t.ir) * r.price / r.per) })).filter(r => !c.m.only || Math.abs(r.dq) > 1e-9);
    return box('GR/IR balances', grid([{ h: 'Purch. doc.', f: r => lnk('ME23N', { po: r.po }, r.po) }, { h: 'Item', k: 'item' }, { h: 'Supplier', f: r => `${r.vendor} ${esc(vname(r.vendor))}` }, { h: 'Material', k: 'matnr' }, { h: 'GR qty', r: 1, f: r => qf(r.t.gr) }, { h: 'IR qty', r: 1, f: r => qf(r.t.ir) }, { h: 'Difference qty', r: 1, f: r => qf(r.dq) }, { h: 'GR value', r: 1, f: r => money(r.t.grVal) }, { h: 'Difference value (at PO price)', r: 1, f: r => money(r.dv) }], rows, { empty: 'No GR/IR balances: everything received has been invoiced' }));
  },
  enter: c => TX.MB5S.exec(c), exec: c => { if (c.m.list) return; c.m.list = true; emit('REPORT', { tcode: 'MB5S' }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};

// ---------------- FB03: Accounting document ----------------
TX.FB03 = {
  title: c => c.m.show ? `Display Document: Data Entry View` : 'Display Document: Initial Screen',
  init: p => ({ doc: p.doc || '', show: false, _auto: !!p.doc }),
  onOpen: c => { if (c.m._auto) TX.FB03.enter(c); },
  render: c => {
    if (!c.m.show) return box('Key', F('Document number', 'doc', { req: 1, f4: 'acc', w: 12 }) + F('Company code', '_cc', { ro: 1, w: 6, desc: '1010' }) + F('Fiscal year', '_y', { ro: 1, w: 5, desc: String(new Date().getFullYear()) })) + '<div class="tip">Goods receipts create accounting documents of type <b>WE</b>, invoices of type <b>RE</b>. You can also jump here from MIGO (display) or MIR4.</div>';
    const A = S.accDocs[String(c.m.doc).trim().padStart(10, '0')];
    const d = sum(A.lines.filter(l => l.dc === 'D'), l => l.amt), cr = sum(A.lines.filter(l => l.dc === 'C'), l => l.amt);
    const refLink = A.type === 'WE' ? lnk('MIGO', { display: A.refDoc }, A.refDoc) : lnk('MIR4', { inv: A.refDoc }, A.refDoc);
    return box(`Document ${A.num} · Company code 1010 · Fiscal year ${A.year}`, `<table class="g orgtbl"><tr><td>Document type</td><td>${A.type} ${A.type === 'WE' ? 'Goods receipt' : 'Invoice receipt'}</td></tr><tr><td>Reference</td><td>${refLink}</td></tr><tr><td>Posting date</td><td>${fmtD(A.date)}</td></tr><tr><td>Currency</td><td>EUR</td></tr></table>`) +
      box('Line items', grid([{ h: 'Itm', k: 'n' }, { h: 'PK', k: 'pk' }, { h: 'Account', f: r => r.vendor ? `${r.vendor}` : r.gl }, { h: 'Description', f: r => r.vendor ? `${esc(vname(r.vendor))} (recon. ${GL.AP[0]})` : esc(r.text) }, { h: 'Amount EUR', r: 1, f: r => (r.dc === 'C' ? '-' : '') + money(r.amt) }, { h: 'Material', f: r => r.matnr || '' }, { h: 'Tax', f: r => r.tax || '' }], A.lines,
        { foot: `<tr class="tot"><td colspan="4">Debit ${money(d)} · Credit ${money(cr)}</td><td class="r">${money(d - cr)}</td><td colspan="2"></td></tr>` })) +
      `<div class="tip">Posting keys: <b>89/99</b> inventory, <b>86/96</b> GR/IR clearing, <b>31</b> supplier credit, <b>40</b> debit (tax), <b>83/93</b> price differences. Debit always equals credit.</div>`;
  },
  enter: c => {
    if (c.m.show) return;
    req(c, ['doc']); const k = String(c.m.doc).trim().padStart(10, '0');
    if (!S.accDocs[k]) err(`Document ${c.m.doc} does not exist in company code 1010`, null, 'doc');
    c.m.doc = k; c.m.show = true; emit('ACC_DISPLAY', { num: k, dtype: S.accDocs[k].type, refDoc: S.accDocs[k].refDoc });
  },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
};

// Titles used in Easy Access and the command-field list
const TITLES = { MM01: 'Create Material', MM03: 'Display Material', BP: 'Maintain Business Partner', ME11: 'Create Purchasing Info Record', ME13: 'Display Purchasing Info Records', ME51N: 'Create Purchase Requisition', ME53N: 'Display Purchase Requisition', ME5A: 'List Display of Purchase Requisitions',
  ME21N: 'Create Purchase Order', ME23N: 'Display Purchase Order', ME2N: 'Purchase Orders by PO Number', ME2M: 'Purchase Orders by Material', MIGO: 'Goods Movement', MMBE: 'Stock Overview', MB52: 'Warehouse Stocks', MB51: 'Material Document List',
  MIRO: 'Enter Incoming Invoice', MIR4: 'Display Invoice Document', MRBR: 'Release Blocked Invoices', MB5S: 'List of GR/IR Balances', FB03: 'Display Accounting Document' };

// ======================================================================
// Trainer scenarios
// ======================================================================
const openQtyPO = po => S.pos[po] ? sum(S.pos[po].items, it => Math.max(0, poTotals(S.pos[po], it).toDeliver)) : -1;
const SCEN = [
  { id: 'nav', title: '1. Find your way around', level: 'Starter · 10 min',
    intro: 'Learn the SAP GUI basics: command field, F4 help, Back, reports and document links.',
    steps: [
      { t: 'Open the stock overview (<b>MMBE</b>) for material <b>TG11</b>.', h: 'Type MMBE in the command field, Enter. Material TG11, then F8 (or Enter).', ok: e => e.type === 'STOCK_VIEW' && e.matnr === 'TG11' },
      { t: 'Display material <b>TG11</b> with <b>MM03</b> and look at the Accounting 1 tab.', h: 'Type /nMM03 → Material TG11 → Enter → tab "Accounting 1". Note the moving price and the G/L account.', ok: e => e.type === 'MAT_DISPLAY' && e.matnr === 'TG11' },
      { t: 'List all purchase orders with <b>ME2N</b>.', h: '/nME2N, leave the selection empty, F8.', ok: e => e.type === 'REPORT' && e.tcode === 'ME2N' },
      { t: 'Open PO <b>4500000001</b> in <b>ME23N</b> and look at the purchase order history.', h: 'Click the PO number in ME2N, or /nME23N → 4500000001 → Enter. The "Purchase order history" tab shows the goods receipt (WE) and the invoice (RE-L).', ok: e => e.type === 'PO_DISPLAY' && e.num === '4500000001' },
      { t: 'From the PO history, open the goods receipt and then its <b>accounting document</b>.', h: 'Click the material document number in the history (opens MIGO display), then click the accounting document number (opens FB03).', ok: e => e.type === 'ACC_DISPLAY' }
    ],
    notes: ['Teach the command field first: /n, /o and the difference between ME21N (create), ME22N (change) and ME23N (display).', 'Point out that every follow-on document is linked: learners should always be able to "walk" from PO to GR to accounting document.', 'Common mistake: typing a transaction code without /n while inside another transaction.'] },
  { id: 'p2p', title: '2. Procure-to-pay end to end', level: 'Core · 25 min',
    intro: 'Run the full cycle: requisition → purchase order → goods receipt → invoice, then check the results.',
    steps: [
      { t: 'Create a purchase requisition (<b>ME51N</b>) for <b>40 PC</b> of <b>TG12</b> (wireless mouse), plant 1010.', h: 'ME51N → Material TG12, Quantity 40 → Enter (other fields are proposed) → Ctrl+S.', ok: e => e.type === 'PR_CREATED' && e.items.some(i => i.matnr === 'TG12' && i.qty === 40), cap: (e, x) => { x.pr = e.num; } },
      { t: 'Create a purchase order (<b>ME21N</b>) <b>with reference to that requisition</b>, supplier <b>100001</b>.', h: 'ME21N → in the document overview click "Adopt ▸" on your requisition → Supplier 100001 → Enter (price 13.90 comes from the info record) → Ctrl+S.', ok: (e, x) => e.type === 'PO_CREATED' && e.items.some(i => i.prRef === x.pr), cap: (e, x) => { x.po = e.num; } },
      { t: 'Post the goods receipt (<b>MIGO</b>, 101) for the full quantity.', h: 'MIGO → A01 Goods Receipt / R01 Purchase Order → your PO number → Enter → tick "OK" → Post.', ok: (e, x) => e.type === 'GR_POSTED' && e.po === x.po && openQtyPO(x.po) === 0 },
      { t: 'Post the supplier invoice (<b>MIRO</b>) with no variance.', h: 'MIRO → Reference e.g. INV-001 → PO number → Enter. Items: 40 × 13.90 = 556.00. With V1 (20% VAT) the gross amount is 667.20. Type it, press Enter (green light), Post.', ok: (e, x) => e.type === 'IR_POSTED' && e.po === x.po && !e.blocked, cap: (e, x) => { x.inv = e.inv; } },
      { t: 'Check the <b>PO history</b> in ME23N.', h: '/nME23N → your PO → Enter. You should see a WE line and an RE-L line.', ok: (e, x) => e.type === 'PO_DISPLAY' && e.num === x.po },
      { t: 'Check the new stock in <b>MMBE</b> for TG12.', h: '/nMMBE → TG12 → F8. Unrestricted stock went up by 40.', ok: e => e.type === 'STOCK_VIEW' && e.matnr === 'TG12' }
    ],
    notes: ['Draw the cycle on the board before starting: PR (internal) → PO (external, legal) → GR (stock + value) → IR (liability) → payment (FI).', 'Ask learners to predict the accounting entries before posting the GR and IR, then check in FB03: GR = Dr inventory / Cr GR/IR; IR = Dr GR/IR + Dr VAT / Cr supplier.', 'Classic mistakes: forgetting "Item OK" in MIGO; entering the net amount instead of the gross amount in MIRO.'] },
  { id: 'master', title: '3. New supplier & material from scratch', level: 'Core · 25 min',
    intro: 'Create the master data a purchase order needs: business partner, material, info record.',
    steps: [
      { t: 'Create a supplier with <b>BP</b> (roles FLVN00 and FLVN01).', h: 'BP → "Organization" button → Name and City → keep both roles ticked → check the Purchasing tab → Ctrl+S. Note the BP number.', ok: e => e.type === 'VENDOR_CREATED' && e.purch, cap: (e, x) => { x.v = e.bp; } },
      { t: 'Create a trading good (<b>MM01</b>, type HAWA).', h: 'MM01 → Material e.g. TG20 → Industry Retail → Type HAWA → Enter → Description, unit PC, group L001 → Ctrl+S.', ok: e => e.type === 'MAT_CREATED', cap: (e, x) => { x.m = e.matnr; } },
      { t: 'Create a purchasing <b>info record</b> (<b>ME11</b>) linking your new supplier and material.', h: 'ME11 → your supplier, your material, Purch. org 1010, Plant 1010 → Enter → Net price → Ctrl+S.', ok: (e, x) => e.type === 'INFO_CREATED' && e.vendor === x.v && e.matnr === x.m },
      { t: 'Create a <b>PO</b> for your material from your supplier: the price must be proposed automatically.', h: 'ME21N → your supplier → your material, quantity → Enter: the net price appears from the info record → Ctrl+S.', ok: (e, x) => e.type === 'PO_CREATED' && e.vendor === x.v && e.items.some(i => i.matnr === x.m), cap: (e, x) => { x.po = e.num; } },
      { t: 'Receive the goods (<b>MIGO</b>) and check that the moving price was set (<b>MM03</b>, Accounting 1).', h: 'MIGO GR for your PO, then MM03 → your material → Accounting 1. A new material with price 0 takes its moving price from the first goods receipt.', ok: (e, x) => e.type === 'MAT_DISPLAY' && e.matnr === x.m && S.pos[x.po] && S.pos[x.po].history.length > 0 }
    ],
    notes: ['Explain why XK01 no longer works in S/4HANA: suppliers are business partners (try XK01 in class to show the message).', 'Organisational levels matter: data is maintained per company code (FI), purchasing organisation (MM) and plant.', 'Common mistake: creating the supplier without role FLVN01, then wondering why ME21N refuses it.'] },
  { id: 'var', title: '4. Price variance & blocked invoice', level: 'Intermediate · 20 min',
    intro: 'Post an invoice above the PO price, see it blocked for payment and release it.',
    steps: [
      { t: 'Create a PO for <b>10 PC</b> of <b>TG11</b> from supplier <b>100001</b> (price 510.00 from the info record).', h: 'ME21N → Supplier 100001 → TG11, qty 10 → Enter → Ctrl+S.', ok: e => e.type === 'PO_CREATED' && e.vendor === '100001' && e.items.some(i => i.matnr === 'TG11' && i.qty === 10), cap: (e, x) => { x.po = e.num; } },
      { t: 'Post the goods receipt in <b>MIGO</b>.', h: 'MIGO → A01 / R01 → your PO → Enter → OK → Post.', ok: (e, x) => e.type === 'GR_POSTED' && e.po === x.po },
      { t: 'Post an invoice at <b>561.00 per PC</b> (10% above the PO price) in <b>MIRO</b>.', h: 'MIRO → PO → Enter → change the item amount to 5,610.00 → gross amount 6,732.00 (5,610 + 20% VAT) → Enter → Post. The tolerance is 5%, so the invoice is blocked.', ok: (e, x) => e.type === 'IR_POSTED' && e.po === x.po && e.blocked, cap: (e, x) => { x.inv = e.inv; } },
      { t: 'Display the invoice\'s <b>accounting document</b> and find where the 510.00 variance was posted.', h: 'MIR4 → your invoice → click the accounting document (or FB03). TG11 has price control V, so the variance goes to the inventory account and changes the moving price.', ok: (e, x) => e.type === 'ACC_DISPLAY' && e.refDoc === x.inv },
      { t: 'Release the invoice for payment with <b>MRBR</b>.', h: 'MRBR → F8 → tick your invoice → Release.', ok: (e, x) => e.type === 'IR_RELEASED' && e.invs.includes(x.inv) }
    ],
    notes: ['Explain tolerance keys (here PP, price variance, 5% upper limit) and payment block R.', 'Contrast price control V (variance to stock if stock is still there) with S (variance to price differences account). Repeat with RM14 to show the S case.', 'Real-world point: releasing should follow a check with the buyer or a corrected PO price, not be automatic.'] },
  { id: 'partial', title: '5. Partial delivery & GR-based invoice', level: 'Intermediate · 20 min',
    intro: 'Receive a PO in two deliveries and see how GR-based invoice verification and the GR/IR account behave.',
    steps: [
      { t: 'Create a PO for <b>100 PC</b> of <b>RM14</b> from supplier <b>100003</b>.', h: 'ME21N → Supplier 100003 → RM14, qty 100 → Enter (price 0.82) → Ctrl+S.', ok: e => e.type === 'PO_CREATED' && e.vendor === '100003' && e.items.some(i => i.matnr === 'RM14' && i.qty === 100), cap: (e, x) => { x.po = e.num; } },
      { t: 'Post a <b>partial</b> goods receipt of <b>60 PC</b>.', h: 'MIGO → your PO → change Qty in UnE to 60 → OK → Post.', ok: (e, x) => e.type === 'GR_POSTED' && e.po === x.po && e.items.some(i => i.qty === 60) },
      { t: 'Post the invoice for the 60 PC received (MIRO proposes only 60).', h: 'MIRO → PO → Enter: 60 × 0.82 = 49.20 net; gross with V1 = 59.04 → Post.', ok: (e, x) => e.type === 'IR_POSTED' && e.po === x.po && Math.abs(e.qty - 60) < 1e-9 },
      { t: 'Post the second goods receipt for the remaining <b>40 PC</b>.', h: 'MIGO → same PO: the open quantity is now 40 → OK → Post.', ok: (e, x) => e.type === 'GR_POSTED' && e.po === x.po && openQtyPO(x.po) === 0 },
      { t: 'Check the GR/IR balance in <b>MB5S</b>: 40 PC received, not yet invoiced.', h: '/nMB5S → F8. Your PO shows a difference of 40 PC (32.80 EUR).', ok: e => e.type === 'REPORT' && e.tcode === 'MB5S' },
      { t: 'Clear the balance: post the invoice for the last 40 PC.', h: 'MIRO → PO → Enter (40 proposed) → 32.80 net → gross 39.36 → Post. Run MB5S again: the line disappears.', ok: (e, x) => e.type === 'IR_POSTED' && e.po === x.po && openQtyPO(x.po) === 0 && S.pos[x.po].items.every(i => poTotals(S.pos[x.po], i).toInvoice === 0) }
    ],
    notes: ['GR-based IV: each goods receipt is invoiced separately; an invoice cannot exceed what was received without a quantity block.', 'RM14 uses a standard price (0.85) while the PO price is 0.82: show the price-difference line in the GR accounting document (FB03).', 'MB5S is a month-end favourite: finance asks purchasing to explain old GR/IR balances.'] },
  { id: 'trouble', title: '6. Troubleshoot like a trainer', level: 'Advanced · 15 min',
    intro: 'Trigger the error messages learners meet most often, read them, then fix the root cause.',
    steps: [
      { t: 'Try to create a PO for <b>TG13</b> (docking station) from supplier <b>100001</b> without typing a price. Read the error.', h: 'ME21N → 100001 → TG13, qty 5 → Ctrl+S. No info record exists, so no price is proposed: "net price must be greater than 0".', ok: e => e.type === 'ERR' && e.code === 'NO_PRICE' },
      { t: 'Try to create a supplier with the old transaction <b>XK01</b>.', h: 'Type /nXK01. S/4HANA tells you to use BP.', ok: e => e.type === 'ERR' && e.code === 'XK01' },
      { t: 'Try to post a goods receipt for PO <b>4500000001</b> (already fully delivered).', h: 'MIGO → A01 / R01 → 4500000001 → Enter: "does not contain any selectable items".', ok: e => e.type === 'ERR' && e.code === 'NO_ITEMS' },
      { t: 'In <b>MIRO</b>, try to post an invoice whose balance is not zero.', h: 'MIRO → PO 4500000002 has no GR yet (another classic error!). Use a PO you have received instead, type a wrong gross amount and Post.', ok: e => e.type === 'ERR' && e.code === 'BALANCE' },
      { t: 'Fix the root cause of step 1: create an info record for <b>TG13</b> / <b>100001</b> (e.g. 89.00), then create the PO again.', h: 'ME11 → 100001 / TG13 / 1010 / 1010 → Enter → 89.00 → Ctrl+S. Then ME21N: the price is now proposed.', ok: e => e.type === 'PO_CREATED' && e.items.some(i => i.matnr === 'TG13') && S.infos.some(i => i.matnr === 'TG13') }
    ],
    notes: ['Teach learners to read the status bar and double-click a message for the long text (in real SAP).', 'Each error maps to missing master data or a missing previous step: build a "symptom → cause → fix" table with the class.', 'Good exam technique: C_TS452 questions often describe an error and ask for the cause.'] }
];

let TP; // trainer progress
function loadTP() { try { TP = JSON.parse(localStorage.getItem(PKEY)) || {}; } catch (e) { TP = {}; } TP.runs ??= {}; }
const saveTP = () => { try { localStorage.setItem(PKEY, JSON.stringify(TP)); } catch (e) { /* ignore */ } };
function startScenario(id) { TP.active = id; TP.runs[id] = { cursor: S.log.length, step: 0, ctx: {}, done: false, started: Date.now() }; saveTP(); drawTrainer(); toast('Scenario started: follow step 1'); }
function checkScenario() {
  const sc = SCEN.find(s => s.id === TP?.active); if (!sc) return;
  const run = TP.runs[sc.id]; if (!run || run.done) return;
  let progressed = false;
  while (run.step < sc.steps.length) {
    const st = sc.steps[run.step];
    let hit = -1;
    for (let i = run.cursor; i < S.log.length; i++) { try { if (st.ok(S.log[i], run.ctx)) { hit = i; break; } } catch (e) { /* ignore */ } }
    if (hit < 0) break;
    st.cap?.(S.log[hit], run.ctx); run.cursor = hit + 1; run.step++; progressed = true;
  }
  if (progressed) {
    if (run.step >= sc.steps.length) { run.done = true; toast(`🎉 Scenario complete: ${sc.title}`); }
    else toast(`✓ Step done. Next: step ${run.step + 1}`);
    saveTP(); drawTrainer();
  }
}
function drawTrainer() {
  const body = $('#trainerBody'); if (!body || $('#trainer').hidden) return;
  const sc = SCEN.find(s => s.id === TP.view);
  if (!sc) {
    body.innerHTML = `<p class="small">Guided exercises check your work automatically as you post documents. Pick a scenario:</p>` +
      SCEN.map(s => { const r = TP.runs[s.id]; const pct = r ? Math.round(r.step / s.steps.length * 100) : 0; return `<button type="button" class="sc" data-sc="${s.id}"><b>${esc(s.title)}</b>${r?.done ? ' ✅' : TP.active === s.id ? ' <span class="badge">active</span>' : ''}<small>${esc(s.level)} · ${s.steps.length} steps</small><small>${esc(s.intro)}</small><div class="prog"><i style="width:${pct}%"></i></div></button>`; }).join('') +
      `<div class="tr-tools"><button type="button" class="btn sm" data-tr="reset">↺ Reset sandbox data</button><button type="button" class="btn sm" data-tr="export">⬇ Export data</button><label class="btn sm" style="cursor:pointer">⬆ Import<input type="file" accept="application/json" data-tr="import" hidden></label></div>
      <p class="disclaimer">Free practice works too: everything you post stays in this browser. Reset restores the starting data.</p>`;
    return;
  }
  const run = TP.runs[sc.id]; const active = TP.active === sc.id && run;
  body.innerHTML = `<button type="button" class="btn sm" data-tr="list">← All scenarios</button><h3 style="margin:10px 0 2px">${esc(sc.title)}</h3><p class="small muted" style="margin:0 0 8px">${esc(sc.level)}</p><p class="small">${esc(sc.intro)}</p>
    ${active ? '' : `<button type="button" class="btn pri" data-tr="start">▶ ${run ? 'Restart' : 'Start'} scenario</button>`}
    ${run?.done ? '<div class="done-banner">🎉 Completed! Restart it to rehearse it as a classroom demo.</div>' : ''}
    <ol class="steps">${sc.steps.map((s, i) => `<li data-n="${i + 1}" class="${run && i < run.step ? 'done' : active && i === run.step && !run.done ? 'now' : ''}"><div>${s.t}</div><button type="button" class="lnk hbtn" data-hint>Show hint</button><div class="hint">${esc(s.h)}</div></li>`).join('')}</ol>
    ${run?.ctx && Object.keys(run.ctx).length ? `<p class="small muted">Your documents: ${Object.entries(run.ctx).map(([k, v]) => `${({ pr: 'PR', po: 'PO', inv: 'Invoice', v: 'Supplier', m: 'Material' })[k] || k} <b>${esc(v)}</b>`).join(' · ')}</p>` : ''}
    ${active && !run.done ? `<button type="button" class="btn sm" data-tr="start">↺ Restart</button>` : ''}
    <h4>🎤 Trainer notes</h4><div class="tr-notes"><ul>${sc.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`;
}
function openTrainer(open) {
  const tr = $('#trainer'); tr.hidden = !open; document.body.classList.toggle('tr-open', open);
  $('#trainerBtn').setAttribute('aria-expanded', String(open)); TP.open = open; saveTP();
  if (open) { if (TP.view === undefined && TP.active) TP.view = TP.active; drawTrainer(); }
}

// ======================================================================
// Wiring
// ======================================================================
function runOk() {
  const el = $('#okcode'); let v = U(el.value); el.value = '';
  if (!v) { act(c => c.def.enter?.(c)); return; }
  if (v === '/N' || v === '/O' || v === '/NEND' || v === '/NEX') { home(); return; }
  if (v.startsWith('/N') || v.startsWith('/O')) v = v.slice(2);
  if (v === 'SESSION_MANAGER' || v === 'SMEN') { home(); return; }
  call(v);
}
function menu(which, btn) {
  const pop = $('#menuPop');
  if (!pop.hidden && pop.dataset.w === which) { pop.hidden = true; return; }
  const items = { menu: [['SAP Easy Access', () => home()], ['Create Purchase Order (ME21N)', () => call('ME21N')], ['Goods Movement (MIGO)', () => call('MIGO')], ['Enter Invoice (MIRO)', () => call('MIRO')]],
    system: [['Reset sandbox data…', () => confirmReset()], ['Export data', () => exportData()], ['Status…', () => modal('System: status', `<table class="g orgtbl"><tr><td>System</td><td>S4D (simulated)</td></tr><tr><td>Client</td><td>100</td></tr><tr><td>User</td><td>TRAINEE</td></tr><tr><td>Transaction</td><td>${cur.code}</td></tr><tr><td>Documents</td><td>${Object.keys(S.pos).length} POs · ${Object.keys(S.matDocs).length} material docs · ${Object.keys(S.invoices).length} invoices</td></tr></table>`, [{ l: 'OK', pri: 1 }])]],
    help: [['Keyboard shortcuts', () => modal('Keyboard shortcuts', `<table class="g orgtbl"><tr><td>Enter</td><td>Check / continue</td></tr><tr><td>F3</td><td>Back</td></tr><tr><td>Shift+F3</td><td>Exit to Easy Access</td></tr><tr><td>F4</td><td>Possible entries (value help)</td></tr><tr><td>F8</td><td>Execute (reports)</td></tr><tr><td>Ctrl+S</td><td>Save / Post</td></tr><tr><td>F12 / Esc</td><td>Cancel / close popup</td></tr><tr><td>/nXXXX</td><td>Start transaction XXXX</td></tr></table>`, [{ l: 'OK', pri: 1 }])], ['Transactions in this sandbox', () => modal('Transactions', grid([{ h: 'Code', k: 'c' }, { h: 'Description', k: 'd' }], Object.entries(TITLES).map(([c, d]) => ({ c, d }))), [{ l: 'OK', pri: 1 }])], ['About this sandbox', () => modal('About', '<p>MM Sandbox is a training simulator built for the SAP MM Trainer Track. It reproduces the logic of the main procure-to-pay transactions with fictional data.</p><p>It is <b>not SAP software</b> and is not affiliated with SAP SE. Screens are simplified. Use a real system (SAP Learning Hub, CAL trial or IDES access) to validate what you learn here.</p>', [{ l: 'OK', pri: 1 }])]] }[which];
  pop.innerHTML = items.map((x, i) => `<button type="button" data-mi="${i}">${esc(x[0])}</button>`).join('');
  const r = btn.getBoundingClientRect(); pop.style.left = r.left + 'px'; pop.style.top = r.bottom + 'px'; pop.dataset.w = which; pop.hidden = false;
  pop.onclick = e => { const b = e.target.closest('[data-mi]'); if (b) { pop.hidden = true; items[+b.dataset.mi][1](); } };
}
function confirmReset() {
  modal('Reset sandbox data', '<p>Delete everything you have posted and restore the starting data (5 materials, 3 suppliers, 2 POs, 1 requisition)? Scenario progress is also reset.</p>', [{ l: 'Cancel' }, { l: 'Reset', pri: 1, a: () => { seed(); TP = { runs: {}, open: TP.open }; saveTP(); home(); drawTrainer(); msg('S', 'Sandbox data reset to the starting state'); } }]);
}
function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `mm-sandbox-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importData(file) {
  const fr = new FileReader();
  fr.onload = () => { try { const d = JSON.parse(fr.result); if (d.v !== 1 || !d.materials || !d.pos) throw 0; S = d; persist(); home(); msg('S', 'Sandbox data imported'); } catch (e) { msg('E', 'Import failed: not a valid MM Sandbox export file'); } };
  fr.readAsText(file);
}

function init() {
  load(); loadTP();
  // Easy Access labels
  for (const k of Object.keys(TITLES)) TX[k].label = TITLES[k];
  $('#tclist').innerHTML = Object.entries(TITLES).map(([c, d]) => `<option value="${c}">${esc(d)}</option>`).join('');
  $('#okBtn').onclick = runOk;
  $('#saveBtn').onclick = () => cur.def.save ? act(cur.def.save) : msg('I', 'Nothing to save in this transaction');
  $('#backBtn').onclick = back; $('#cancelBtn').onclick = back; $('#exitBtn').onclick = home; $('#homeBtn').onclick = home;
  $('#execBtn').onclick = () => cur.def.exec ? act(cur.def.exec) : act(c => c.def.enter?.(c));
  $('#trainerBtn').onclick = () => openTrainer($('#trainer').hidden);
  $('#trainerClose').onclick = () => openTrainer(false);
  $$('[data-menu]').forEach(b => b.onclick = e => { e.stopPropagation(); menu(b.dataset.menu, b); });
  document.addEventListener('click', e => { if (!e.target.closest('#menuPop')) $('#menuPop').hidden = true; });

  $('#screen').addEventListener('click', e => {
    const t = e.target;
    const f4 = t.closest('[data-f4btn]'); if (f4) { openF4(f4.dataset.f4btn, document.getElementById(f4.dataset.for)); return; }
    const cl = t.closest('[data-call]'); if (cl) { e.preventDefault(); call(cl.dataset.call, JSON.parse(cl.dataset.p || '{}'), cur.code !== 'SESSION_MANAGER'); return; }
    const tb = t.closest('[data-tab]'); if (tb) { cur.m[tb.dataset.tabkey] = tb.dataset.tab; render(); return; }
    const a = t.closest('[data-act]'); if (a && !t.closest('input,select')) { const fn = cur.def.acts?.[a.dataset.act]; if (fn) act(fn, a.dataset); }
  });
  $('#apptb').addEventListener('click', e => { const b = e.target.closest('[data-tb]'); if (b) cur.tb[+b.dataset.tb].a(cur); });
  $('#trainerBody').addEventListener('click', e => {
    const t = e.target;
    const s = t.closest('[data-sc]'); if (s) { TP.view = s.dataset.sc; saveTP(); drawTrainer(); return; }
    if (t.closest('[data-hint]')) { const li = t.closest('li'); li.classList.toggle('showhint'); t.textContent = li.classList.contains('showhint') ? 'Hide hint' : 'Show hint'; return; }
    const tr = t.closest('[data-tr]'); if (!tr || tr.tagName === 'INPUT') return;
    ({ list: () => { TP.view = null; saveTP(); drawTrainer(); }, start: () => startScenario(TP.view), reset: confirmReset, export: exportData })[tr.dataset.tr]?.();
  });
  $('#trainerBody').addEventListener('change', e => { if (e.target.dataset.tr === 'import' && e.target.files[0]) importData(e.target.files[0]); });

  $('#okcode').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); runOk(); } });
  document.addEventListener('keydown', e => {
    if (!$('#modal').hidden) { if (e.key === 'Escape' || e.key === 'F12') { e.preventDefault(); closeModal(); } return; }
    if (e.key === 'F3' && e.shiftKey) { e.preventDefault(); home(); return; }
    if (e.key === 'F3' || e.key === 'F12') { e.preventDefault(); back(); return; }
    if (e.key === 'Escape') { $('#menuPop').hidden = true; return; }
    if (e.key === 'F4') { e.preventDefault(); const a = document.activeElement; if (a?.dataset?.f4) openF4(a.dataset.f4, a); return; }
    if (e.key === 'F8') { e.preventDefault(); $('#execBtn').click(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#saveBtn').click(); return; }
    if (e.key === 'Enter' && !e.target.closest('#trainer') && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A' && !e.target.closest('.menu-pop')) {
      e.preventDefault(); act(c => c.def.enter?.(c));
    }
  });
  home();
  if (TP.open && innerWidth >= 1100) openTrainer(true);
  if (!localStorage.getItem('sapmm-sandbox-seen')) { localStorage.setItem('sapmm-sandbox-seen', '1'); TP.view = 'nav'; saveTP(); openTrainer(true); }
}
init();
})();
