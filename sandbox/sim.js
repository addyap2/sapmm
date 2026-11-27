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
  plants: { '1010': 'Plant Fréjus', '1020': 'Plant Cannes' },
  slocs: { '101A': 'Main warehouse', '101B': 'Returns store', '102A': 'Cannes shop store' },
  plantSlocs: { '1010': ['101A', '101B'], '1020': ['102A'] },
  porgs: { '1010': 'Purch. Org. Riviera' },
  pgrps: { '001': 'IT & office', '002': 'Packaging' },
  mtypes: { HAWA: 'Trading goods', ROH: 'Raw materials', FERT: 'Finished product' },
  mtypeDef: { HAWA: { vc: '3100', ctrl: 'V' }, ROH: { vc: '3000', ctrl: 'S' }, FERT: { vc: '7920', ctrl: 'S' } },
  mgroups: { L001: 'IT hardware', L002: 'Office furniture', L003: 'Packaging', L004: 'Office supplies', S001: 'Facility services', S002: 'Consulting & training' },
  uoms: { PC: 'Piece', BOX: 'Box', KG: 'Kilogram', AU: 'Activity unit', H: 'Hour' },
  vclasses: { '3100': 'Trading goods', '3000': 'Raw materials', '7920': 'Finished products' },
  ctrls: { V: 'V – Moving average price', S: 'S – Standard price' },
  tax: { V1: ['Input VAT 20%', 0.2], V2: ['Input VAT 10%', 0.1], V0: ['Input VAT 0%', 0] },
  payterms: { '0001': 'Payable immediately', NT30: '30 days net', NT45: '45 days net' },
  termDays: { '0001': 0, NT30: 30, NT45: 45 },
  countries: { FR: 'France', IT: 'Italy', DE: 'Germany', GB: 'United Kingdom', ES: 'Spain' },
  stypes: { unr: 'Unrestricted use', qi: 'Quality inspection', blk: 'Blocked stock' },
  costc: { '10101101': 'Administration', '10101201': 'Sales', '10101301': 'IT services', '10101401': 'Warehouse & logistics' },
  reasons: { '0001': 'Damaged', '0002': 'Poor quality', '0003': 'Wrong material', '0004': 'Expired' },
  itemCats: { '': 'Standard', K: 'K – Consignment', L: 'L – Subcontracting', D: 'D – Service' },
  acctCats: { '': 'None (stock)', K: 'K – Cost center' },
  mrpTypes: { ND: 'ND – No planning', VB: 'VB – Manual reorder point', PD: 'PD – MRP' },
  lots: { EX: 'EX – Lot-for-lot', FX: 'FX – Fixed lot size', HB: 'HB – Replenish to maximum' }
};
const ORG0 = JSON.parse(JSON.stringify({ slocs: ORG.slocs, pgrps: ORG.pgrps, mtypeDef: ORG.mtypeDef, plantSlocs: ORG.plantSlocs }));
const GL_DEF = {
  '3100': ['13100000', 'Inventory – trading goods'],
  '3000': ['13000000', 'Inventory – raw materials'],
  '7920': ['13300000', 'Inventory – finished goods'],
  WRX: ['21900000', 'GR/IR clearing'],
  VST: ['15400000', 'Input VAT'],
  PRD: ['52000000', 'Price differences'],
  AP: ['21100000', 'Accounts payable – domestic'],
  GBB_VBR: ['61000000', 'Consumption – cost centre'],
  GBB_VNG: ['52800000', 'Scrapping'],
  GBB_INV: ['52700000', 'Inventory differences'],
  GBB_BSA: ['39900000', 'Initial stock entry offset'],
  GBB_ZOB: ['52900000', 'Goods receipt without PO'],
  GBB_VBO: ['61100000', 'Consumption – subcontracting'],
  UMB: ['52100000', 'Revaluation gains/losses'],
  KON: ['21950000', 'Consignment liabilities'],
  BANK: ['11000000', 'Bank – outgoing payments'],
  SRV: ['62500000', 'External services'],
  DIF: ['52300000', 'GR/IR clearing differences']
};
const slocOk = (p, s) => (ORG.plantSlocs[p] || []).includes(s);
const glkFor = grp => String(grp || '').startsWith('S') ? 'SRV' : 'GBB_VBR';
const GL = {};

// Movement types for non-PO goods movements (dir: +1 receipt into valuated stock, -1 issue)
const MVT = {
  '201': { t: 'GI for cost center', from: 'unr', dir: -1, acc: 'GBB_VBR', need: ['cc'], rev: '202', doc: 'WA' },
  '551': { t: 'Withdrawal for scrapping', from: 'unr', dir: -1, acc: 'GBB_VNG', need: ['reason'], rev: '552', doc: 'WA' },
  '555': { t: 'Scrapping from blocked stock', from: 'blk', dir: -1, acc: 'GBB_VNG', need: ['reason'], rev: '556', doc: 'WA' },
  '301': { t: 'Transfer posting plant to plant (one step)', from: 'unr', toPlant: true, rev: '302', doc: 'WA' },
  '541': { t: 'Transfer to stock provided to supplier', from: 'unr', toO: true, need: ['vendor'], rev: '542', doc: 'WA' },
  '311': { t: 'Transfer: storage location to storage location', from: 'unr', to: 'unr', toSloc: true, rev: '312', doc: 'WA' },
  '321': { t: 'Transfer: quality inspection to unrestricted', from: 'qi', to: 'unr', rev: '322', doc: 'WA' },
  '322': { t: 'Transfer: unrestricted to quality inspection', from: 'unr', to: 'qi', rev: '321', doc: 'WA' },
  '343': { t: 'Transfer: blocked to unrestricted', from: 'blk', to: 'unr', rev: '344', doc: 'WA' },
  '344': { t: 'Transfer: unrestricted to blocked', from: 'unr', to: 'blk', rev: '343', doc: 'WA' },
  '411K': { t: 'Transfer: consignment to own stock (withdrawal)', fromK: true, to: 'unr', dir: 1, acc: 'KON', kind: 'gl', need: ['vendor'], rev: '412K', doc: 'WA' },
  '542': { t: 'Transfer back from supplier (subcontracting)', fromO: true, to: 'unr', need: ['vendor'], rev: '541', doc: 'WA' },
  '501': { t: 'Receipt without purchase order', to: 'unr', dir: 1, acc: 'GBB_ZOB', value: true, rev: '502', doc: 'WE' },
  '561': { t: 'Initial entry of stock balances', to: 'unr', dir: 1, acc: 'GBB_BSA', value: true, rev: '562', doc: 'WE' },
  '701': { t: 'Physical inventory: surplus', to: 'unr', dir: 1, acc: 'GBB_INV', rev: '702', doc: 'WI' },
  '702': { t: 'Physical inventory: shortage', from: 'unr', dir: -1, acc: 'GBB_INV', rev: '701', doc: 'WI' }
};
const MVTNAME = { '101': 'GR goods receipt', '102': 'GR reversal', '122': 'Return delivery to supplier', '123': 'Reversal of return delivery', '543': 'Consumption of subcontracting component', '544': 'Reversal of subcontracting consumption',
  '202': 'Reversal of GI for cost center', '302': 'Reversal of plant-to-plant transfer', '351': 'GI for stock transport order (to stock in transit)', '552': 'Reversal of scrapping', '556': 'Reversal of scrapping (blocked)', '312': 'Reversal of transfer sloc to sloc', '412K': 'Reversal of consignment withdrawal', '502': 'Reversal of receipt without PO', '562': 'Reversal of initial entry' };
const mvtName = c => MVT[c]?.t || MVTNAME[c] || '';

// ======================================================================
// Data store
// ======================================================================
const KEY = 'sapmm-sandbox-v2', PKEY = 'sapmm-sandbox-trainer-v2';
const S = {};
const HOOKS = { ensure: [], seed: [], poCreate: [], prCreate: [], grCheck: [], poHeader: [], poTb: [] };
const resetStore = d => { for (const k of Object.keys(S)) delete S[k]; Object.assign(S, d); };
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ } };
const nextNo = k => String(S.seq[k]++);
const r3 = n => Math.round(n * 1000) / 1000;

function emptyStore() {
  return { v: 2, seq: { pr: 10000001, po: 4500000001, md: 5000000001, inv: 5105600001, acc: 100000001, bp: 100001, info: 5300000001 },
    materials: {}, vendors: {}, infos: [], stock: {}, special: {}, boms: {}, prs: {}, pos: {}, matDocs: {}, invoices: {}, accDocs: {}, reservations: {}, cfg: {}, log: [] };
}

const stockKey = (m, p, s) => `${m}|${p}|${s}`;
const getStock = (m, p, s) => (S.stock[stockKey(m, p, s)] ??= { unr: 0, qi: 0, blk: 0 });
const plantData = (m, p) => S.materials[m]?.plants?.[p];
const findInfo = (v, m, porg, plant, cat = '') => S.infos.find(i => i.vendor === v && i.matnr === m && i.porg === porg && (!i.plant || i.plant === plant) && (i.cat || '') === cat);
const vname = v => S.vendors[v]?.name || '';
const special = k => S.special[k] || 0;
const addSpecial = (k, q) => { const v = r3(special(k) + q); if (Math.abs(v) < 1e-9) delete S.special[k]; else S.special[k] = v; };
const specialList = (type, m, p) => Object.entries(S.special).filter(([k]) => k.startsWith(`${type}|${m}|${p}|`)).map(([k, q]) => { const a = k.split('|'); return type === 'K' ? { sloc: a[3], vendor: a[4], q } : { vendor: a[3], q }; });

function poTotals(P, it) {
  const h = P.history.filter(x => x.item === it.item);
  const gr = r3(sum(h.filter(x => x.type === 'WE'), x => x.qty));
  const grVal = sum(h.filter(x => x.type === 'WE'), x => x.amount);
  const ir = r3(sum(h.filter(x => x.type === 'RE'), x => x.qty));
  const irVal = sum(h.filter(x => x.type === 'RE'), x => x.amount);
  const gi = r3(sum(h.filter(x => x.type === 'WA'), x => x.qty));
  return { gr, grVal: r2(grVal), ir, irVal: r2(irVal), gi, toDeliver: it.del ? 0 : r3(it.qty - gr), toInvoice: P.type === 'UB' ? 0 : r3(gr - ir), toIssue: it.del ? 0 : r3(it.qty - gi) };
}
function onOrder(m, p) {
  let q = 0;
  for (const P of Object.values(S.pos)) for (const it of P.items) if (it.matnr === m && it.plant === p && it.cat !== 'K' && it.acct !== 'K') q += Math.max(0, poTotals(P, it).toDeliver);
  return q;
}

// ---------- engine: master data ----------
const MRP0 = () => ({ type: 'ND', rop: 0, lot: 'EX', fix: 0, max: 0, safety: 0, pdt: 5 });
function createMaterial({ matnr, desc, type, uom, group, pgrp, plant = '1010', vc, ctrl, price, slocs = ['101A'], stock = {}, mrp = {} }) {
  const d = ORG.mtypeDef[type];
  const pd = { pgrp, vc: vc || d.vc, ctrl: ctrl || d.ctrl, price: r2(N(price) || 0), totQty: 0, totVal: 0, slocs: [...slocs], mrp: { ...MRP0(), ...mrp } };
  S.materials[matnr] = { matnr, desc, type, uom, group, created: today(), plants: { [plant]: pd } };
  for (const s of slocs) getStock(matnr, plant, s);
  for (const [s, q] of Object.entries(stock)) { getStock(matnr, plant, s).unr += q; pd.totQty += q; pd.totVal = r2(pd.totVal + q * pd.price); }
  return matnr;
}
function extendMaterial(matnr, plant, sloc, o = {}) {
  const M = S.materials[matnr]; const src = Object.values(M.plants)[0];
  M.plants[plant] = { pgrp: o.pgrp || src.pgrp, vc: o.vc || src.vc, ctrl: o.ctrl || src.ctrl, price: r2(o.price != null ? o.price : src.price), totQty: 0, totVal: 0, slocs: [sloc], mrp: { ...MRP0(), ...(o.mrp || {}) } };
  getStock(matnr, plant, sloc);
  if (o.stock) { getStock(matnr, plant, sloc).unr += o.stock; M.plants[plant].totQty = o.stock; M.plants[plant].totVal = r2(o.stock * M.plants[plant].price); }
}
function createVendor(v) {
  const id = nextNo('bp');
  S.vendors[id] = { id, created: today(), ...v };
  return id;
}
function createInfo({ vendor, matnr, porg, plant, price, per = 1, days = 5, stdQty = 1, cat = '', disc = 0, frt = 0 }) {
  const id = nextNo('info');
  S.infos.push({ id, vendor, matnr, porg, plant: plant || '', price: r2(N(price)), per: N(per) || 1, days: N(days), stdQty: N(stdQty), cat, disc: N(disc) || 0, frt: N(frt) || 0 });
  return id;
}

// ---------- engine: purchasing ----------
function createPR({ items, date = today(), origin = '' }) {
  const num = nextNo('pr');
  S.prs[num] = { num, date, origin, items: items.map((it, i) => ({ item: (i + 1) * 10, poRef: '', poItem: '', vendor: '', ...it })) };
  HOOKS.prCreate.forEach(f => f(S.prs[num]));
  return num;
}
function createPO({ vendor, porg = '1010', pgrp = '001', cc = '1010', docDate = today(), items, type = 'NB', splant = '' }) {
  const num = nextNo('po');
  S.pos[num] = { num, type, vendor, splant, porg, pgrp, cc, docDate, history: [],
    items: items.map((it, i) => ({ item: (i + 1) * 10, per: 1, grBased: true, cat: '', ...it })) };
  const P = S.pos[num];
  P.ers = !!S.vendors[vendor]?.porg?.[porg]?.ers;
  for (const it of P.items) if (it.prRef && S.prs[it.prRef]) {
    const pi = S.prs[it.prRef].items.find(x => x.item === +it.prItem);
    if (pi) { pi.poRef = num; pi.poItem = it.item; }
  }
  HOOKS.poCreate.forEach(f => f(P));
  return num;
}

// ---------- engine: accounting ----------
const PK = { inv: ['89', '99'], WRX: ['86', '96'], VST: ['40', '50'], PRD: ['83', '93'], AP: ['21', '31'], APP: ['25', '35'], gbb: ['81', '91'], gl: ['40', '50'] };
function createAcc(type, refDoc, date, lines) {
  const num = pad(nextNo('acc'), 10);
  S.accDocs[num] = { num, year: date.slice(0, 4), type, refDoc, date, cc: '1010', lines: lines.filter(l => Math.abs(l.amt) > 0.004).map((l, i) => ({ ...l, n: i + 1, amt: r2(l.amt) })) };
  return num;
}
const line = (kind, glk, dc, amt, extra = {}) => {
  if (amt < 0) { dc = dc === 'D' ? 'C' : 'D'; amt = -amt; }
  const g = GL[glk];
  return { kind, pk: PK[kind][dc === 'D' ? 0 : 1], gl: g[0], text: g[1], dc, amt, ...extra };
};
const flipLines = ls => ls.map(l => ({ ...l, dc: l.dc === 'D' ? 'C' : 'D', pk: PK[l.kind || 'gl'][l.dc === 'D' ? 1 : 0] }));
function applyVals(vals, sign) {
  for (const v of vals) {
    const pd = plantData(v.m, v.p);
    pd.totQty = r3(pd.totQty + sign * v.q); pd.totVal = r2(pd.totVal + sign * v.v);
    if (pd.ctrl === 'V' && pd.totQty > 0) pd.price = r2(pd.totVal / pd.totQty);
  }
}

// ---------- engine: PO-related goods movements (101 / 102 / 122 / 123) ----------
function postGR({ po, lines, date = today(), mvt = '101', revOf = null, text = '', reason = '' }) {
  const P = S.pos[po]; const md = nextNo('md'); const year = date.slice(0, 4);
  const acc = []; const sign = mvt === '101' || mvt === '123' ? 1 : -1; const items = [];
  for (const l of lines) {
    const it = P.items.find(x => x.item === l.item);
    if (P.type === 'UB') {
      const v = r2(l.qty * it.price / it.per);
      addSpecial(`T|${it.matnr}|${it.plant}`, -sign * l.qty);
      const st = getStock(it.matnr, it.plant, l.sloc); st[l.stype] = r3(st[l.stype] + sign * l.qty);
      P.history.push({ type: 'WE', mvt, doc: md, year, item: it.item, qty: sign * l.qty, amount: sign * v, date });
      items.push({ line: items.length + 1, matnr: it.matnr, qty: l.qty, uom: it.uom, plant: it.plant, sloc: l.sloc, stype: l.stype, po, poItem: it.item, amount: v });
      continue;
    }
    if (it.acct === 'K') {
      const v = r2(l.qty * it.price / it.per);
      acc.push(line('gbb', it.glk || 'GBB_VBR', 'D', sign * v, { matnr: it.matnr || '', cc: it.cc }));
      acc.push(line('WRX', 'WRX', 'C', sign * v, { matnr: it.matnr || '' }));
      P.history.push({ type: 'WE', mvt, doc: md, year, item: it.item, qty: sign * l.qty, amount: sign * v, date });
      items.push({ line: items.length + 1, matnr: it.matnr || '', short: it.short, qty: l.qty, uom: it.uom, plant: it.plant, sloc: '', stype: '', cc: it.cc, po, poItem: it.item, amount: v, acct: 'K' });
      continue;
    }
    const pd = plantData(it.matnr, it.plant);
    if (it.cat === 'K') {
      addSpecial(`K|${it.matnr}|${it.plant}|${l.sloc}|${P.vendor}`, sign * l.qty);
      P.history.push({ type: 'WE', mvt, doc: md, year, item: it.item, qty: sign * l.qty, amount: 0, date });
      items.push({ line: items.length + 1, matnr: it.matnr, qty: l.qty, uom: it.uom, plant: it.plant, sloc: l.sloc, stype: 'K', po, poItem: it.item, amount: 0, special: 'K', vendor: P.vendor });
      continue;
    }
    const value = r2(l.qty * it.price / it.per);
    let compVal = 0;
    if (it.cat === 'L') {
      for (const cp of it.comps || []) {
        const cq = r3(cp.qty * l.qty / it.qty); const cpd = plantData(cp.matnr, it.plant); const cv = r2(cq * cpd.price);
        addSpecial(`O|${cp.matnr}|${it.plant}|${P.vendor}`, -sign * cq);
        applyVals([{ m: cp.matnr, p: it.plant, q: -cq, v: -cv }], sign);
        acc.push(line('gbb', 'GBB_VBO', 'D', sign * cv, { matnr: cp.matnr }));
        acc.push(line('inv', cpd.vc, 'C', sign * cv, { matnr: cp.matnr }));
        compVal = r2(compVal + cv);
        items.push({ line: items.length + 1, matnr: cp.matnr, qty: cq, uom: S.materials[cp.matnr].uom, plant: it.plant, sloc: '', stype: 'O', po, poItem: it.item, amount: cv, special: 'O', vendor: P.vendor, mvt: sign > 0 ? '543' : '544' });
      }
    }
    getStock(it.matnr, it.plant, l.sloc)[l.stype] = r3(getStock(it.matnr, it.plant, l.sloc)[l.stype] + sign * l.qty);
    const total = r2(value + compVal);
    let bsx = total, prd = 0;
    if (pd.ctrl === 'S') { bsx = r2(l.qty * pd.price); prd = r2(total - bsx); }
    applyVals([{ m: it.matnr, p: it.plant, q: l.qty, v: bsx }], sign);
    acc.push(line('inv', pd.vc, 'D', sign * bsx, { matnr: it.matnr }));
    if (prd) acc.push(line('PRD', 'PRD', 'D', sign * prd, { matnr: it.matnr }));
    acc.push(line('WRX', 'WRX', 'C', sign * value, { matnr: it.matnr }));
    if (compVal) acc.push(line('gbb', 'GBB_VBO', 'C', sign * compVal, { matnr: it.matnr }));
    P.history.push({ type: 'WE', mvt, doc: md, year, item: it.item, qty: sign * l.qty, amount: sign * value, date });
    items.push({ line: items.length + 1, matnr: it.matnr, qty: l.qty, uom: it.uom, plant: it.plant, sloc: l.sloc, stype: l.stype, po, poItem: it.item, amount: value });
  }
  const an = acc.length ? createAcc('WE', md, date, acc) : '';
  S.matDocs[md] = { num: md, year, date, mvt, text, reason, po, items, acc: an, revOf, reversedBy: null };
  if (revOf) S.matDocs[revOf].reversedBy = md;
  return md;
}

// ---------- engine: stock transport order goods issue (351) ----------
function postSTOGI({ po, lines, date = today(), text = '' }) {
  const P = S.pos[po]; const md = nextNo('md'); const year = date.slice(0, 4); const acc = []; const items = [];
  for (const l of lines) {
    const it = P.items.find(x => x.item === l.item); const pdF = plantData(it.matnr, P.splant), pdT = plantData(it.matnr, it.plant);
    const v = r2(l.qty * pdF.price);
    const st = getStock(it.matnr, P.splant, l.sloc); st.unr = r3(st.unr - l.qty);
    applyVals([{ m: it.matnr, p: P.splant, q: -l.qty, v: -v }], 1);
    const bsx = pdT.ctrl === 'S' ? r2(l.qty * pdT.price) : v; const prd = r2(v - bsx);
    applyVals([{ m: it.matnr, p: it.plant, q: l.qty, v: bsx }], 1);
    addSpecial(`T|${it.matnr}|${it.plant}`, l.qty);
    acc.push(line('inv', pdT.vc, 'D', bsx, { matnr: it.matnr, plant: it.plant }));
    if (prd) acc.push(line('PRD', 'PRD', 'D', prd, { matnr: it.matnr }));
    acc.push(line('inv', pdF.vc, 'C', v, { matnr: it.matnr, plant: P.splant }));
    P.history.push({ type: 'WA', mvt: '351', doc: md, year, item: it.item, qty: l.qty, amount: v, date });
    items.push({ line: items.length + 1, matnr: it.matnr, qty: l.qty, uom: it.uom, plant: P.splant, sloc: l.sloc, stype: 'unr', po, poItem: it.item, amount: v, toPlant: it.plant });
  }
  const an = createAcc('WA', md, date, acc);
  S.matDocs[md] = { num: md, year, date, mvt: '351', text, po, items, acc: an, revOf: null, reversedBy: null };
  return md;
}

// ---------- engine: other goods movements ----------
function checkDeltas(deltas) {
  const seen = new Set();
  for (const d of deltas) if (d.k && !seen.has(d.k)) { seen.add(d.k); const [m, p, s] = d.k.split('|'); (HOOKS.stockCheck || []).forEach(f => f(m, p, s)); }
  const need = {};
  for (const d of deltas) { const key = d.sp ? 'sp:' + d.sp : `${d.k}#${d.st}`; need[key] = (need[key] || 0) + d.q; }
  for (const [key, q] of Object.entries(need)) {
    if (q >= -1e-9) continue;
    let have, label, m;
    if (key.startsWith('sp:')) { const k = key.slice(3); have = special(k); const a = k.split('|'); m = a[1]; label = a[0] === 'K' ? `consignment stock of supplier ${a[4]} : ${a[1]} ${a[2]} ${a[3]}` : `stock provided to supplier ${a[3]} : ${a[1]} ${a[2]}`; }
    else { const [k, st] = key.split('#'); have = (S.stock[k] || {})[st] || 0; const a = k.split('|'); m = a[0]; label = `${ORG.stypes[st]} stock : ${a[0]} ${a[1]} ${a[2]}`; }
    if (have + q < -1e-9) err(`Deficit of ${label} (${qf(-(have + q))} ${S.materials[m]?.uom || ''} short)`, 'DEFICIT');
  }
}
function applyDeltas(deltas, sign) {
  for (const d of deltas) {
    if (d.sp) addSpecial(d.sp, sign * d.q);
    else { S.stock[d.k] ??= { unr: 0, qi: 0, blk: 0 }; S.stock[d.k][d.st] = r3(S.stock[d.k][d.st] + sign * d.q); }
  }
}
function planMvt({ mvt, items }) {
  const D = MVT[mvt]; if (!D) err(`Movement type ${mvt} is not defined`);
  const deltas = [], vals = [], acc = [], out = [];
  items.forEach((x, i) => {
    const M = S.materials[x.matnr], pd = plantData(x.matnr, x.plant);
    const O = `O|${x.matnr}|${x.plant}|${x.vendor}`;
    if (D.from) deltas.push({ k: stockKey(x.matnr, x.plant, x.sloc), st: D.from, q: -x.qty });
    if (D.fromK) deltas.push({ sp: `K|${x.matnr}|${x.plant}|${x.sloc}|${x.vendor}`, q: -x.qty });
    if (D.fromO) deltas.push({ sp: O, q: -x.qty });
    if (D.to) deltas.push({ k: stockKey(x.matnr, x.plant, D.toSloc ? x.toSloc : x.sloc), st: D.to, q: x.qty });
    if (D.toO) deltas.push({ sp: O, q: x.qty });
    let value = 0;
    if (D.toPlant) {
      deltas.push({ k: stockKey(x.matnr, x.toPlant, x.toSloc), st: 'unr', q: x.qty });
      const pdT = plantData(x.matnr, x.toPlant); const v = r2(x.qty * pd.price); const bsx = pdT.ctrl === 'S' ? r2(x.qty * pdT.price) : v; const prd = r2(v - bsx);
      acc.push(line('inv', pdT.vc, 'D', bsx, { matnr: x.matnr, plant: x.toPlant })); if (prd) acc.push(line('PRD', 'PRD', 'D', prd, { matnr: x.matnr })); acc.push(line('inv', pd.vc, 'C', v, { matnr: x.matnr, plant: x.plant }));
      vals.push({ m: x.matnr, p: x.plant, q: -x.qty, v: -v }, { m: x.matnr, p: x.toPlant, q: x.qty, v: bsx }); value = v;
    }
    if (D.dir > 0) {
      let v = D.value && N(x.amount) > 0 ? r2(N(x.amount)) : r2(x.qty * pd.price);
      if (mvt === '411K') { const inf = findInfo(x.vendor, x.matnr, '1010', x.plant, 'K') || findInfo(x.vendor, x.matnr, '1010', x.plant); v = r2(x.qty * (inf ? inf.price / inf.per : pd.price)); }
      const bsx = pd.ctrl === 'S' ? r2(x.qty * pd.price) : v; const prd = r2(v - bsx);
      acc.push(line('inv', pd.vc, 'D', bsx, { matnr: x.matnr }));
      if (prd) acc.push(line('PRD', 'PRD', 'D', prd, { matnr: x.matnr }));
      acc.push(line(D.kind || 'gbb', D.acc, 'C', v, { matnr: x.matnr, ...(mvt === '411K' ? { cons: x.vendor } : {}) }));
      vals.push({ m: x.matnr, p: x.plant, q: x.qty, v: bsx }); value = v;
    } else if (D.dir < 0) {
      const v = r2(x.qty * pd.price);
      acc.push(line(D.kind || 'gbb', D.acc, 'D', v, { matnr: x.matnr, ...(x.cc ? { cc: x.cc } : {}) }));
      acc.push(line('inv', pd.vc, 'C', v, { matnr: x.matnr }));
      vals.push({ m: x.matnr, p: x.plant, q: -x.qty, v: -v }); value = v;
    }
    out.push({ line: i + 1, matnr: x.matnr, qty: x.qty, uom: M.uom, plant: x.plant, sloc: x.sloc, toSloc: D.toSloc || D.toPlant ? x.toSloc : '', toPlant: D.toPlant ? x.toPlant : '', stype: D.from || D.to || '', cc: x.cc || '', vendor: x.vendor || '', reason: x.reason || '', amount: value });
  });
  checkDeltas(deltas);
  return { deltas, vals, acc, out };
}
function postMvt({ mvt, date = today(), text = '', items, resRef = '', piRef = '' }) {
  const pl = planMvt({ mvt, items });
  applyDeltas(pl.deltas, 1); applyVals(pl.vals, 1);
  const md = nextNo('md');
  const an = pl.acc.length ? createAcc(MVT[mvt].doc, md, date, pl.acc) : '';
  S.matDocs[md] = { num: md, year: date.slice(0, 4), date, mvt, text, items: pl.out, acc: an, deltas: pl.deltas, vals: pl.vals, resRef, piRef, revOf: null, reversedBy: null };
  if (mvt === '411K') { S.consign ??= []; pl.out.forEach(o => S.consign.push({ md, vendor: o.vendor, matnr: o.matnr, qty: o.qty, amount: o.amount, date, settled: '' })); }
  return md;
}
function reverseMvt(D, date = today()) {
  const neg = D.deltas.map(d => ({ ...d, q: -d.q }));
  checkDeltas(neg);
  if (D.mvt === '411K' && (S.consign || []).some(x => x.md === D.num && x.settled)) err(`Withdrawal ${D.num} is already settled (MRKO): it cannot be cancelled`);
  applyDeltas(neg, 1); applyVals(D.vals, -1);
  const md = nextNo('md'); const rev = MVT[D.mvt].rev;
  const an = D.acc ? createAcc(MVT[D.mvt].doc, md, date, flipLines(S.accDocs[D.acc].lines)) : '';
  S.matDocs[md] = { num: md, year: date.slice(0, 4), date, mvt: rev, text: `Reversal of ${D.num}`, items: D.items, acc: an, deltas: neg, vals: D.vals.map(v => ({ ...v, q: -v.q, v: -v.v })), revOf: D.num, reversedBy: null, resRef: D.resRef };
  D.reversedBy = md;
  if (D.mvt === '411K') S.consign = (S.consign || []).filter(x => x.md !== D.num);
  if (D.resRef && S.reservations[D.resRef]) for (const o of D.items) { const ri = S.reservations[D.resRef].items.find(r => r.matnr === o.matnr); if (ri) ri.wd = r3(ri.wd - o.qty); }
  return md;
}

// ---------- engine: invoice verification ----------
function computeIR({ po, gross, taxCode, tax, items, cm = false, udc = 0, sub = '' }) {
  const P = S.pos[po]; const s = cm || sub === 'C' ? -1 : 1; const acc = []; const reasons = []; const valuation = []; const tol = S.cfg.tol;
  acc.push(line('AP', 'AP', 'C', s * gross, { vendor: P.vendor }));
  const net = sum(items, x => x.amount) || 1;
  let left = r2(udc);
  items.forEach((x, idx) => {
    const it = P.items.find(i => i.item === x.item); const t = poTotals(P, it); const pd = plantData(it.matnr, it.plant);
    const poVal = r2(x.qty * it.price / it.per); const diff = r2(x.amount - poVal);
    if (!cm && !sub) {
      if (tol.dq && x.qty > t.toInvoice + 1e-9) reasons.push(`Item ${pad(it.item, 5)}: quantity variance (invoiced ${qf(x.qty)}, received but not invoiced ${qf(t.toInvoice)})`);
      if (diff > 0.004 && poVal > 0 && (diff / poVal * 100 > tol.pp + 1e-9 || diff > tol.ppAbs + 1e-9)) reasons.push(`Item ${pad(it.item, 5)}: price variance +${money(diff)} EUR (${(diff / poVal * 100).toFixed(1)}%; tolerance PP ${tol.pp}% / ${money(tol.ppAbs)} EUR)`);
    }
    if (!sub) acc.push(line('WRX', 'WRX', 'D', s * poVal, { matnr: it.matnr }));
    const share = udc ? (idx === items.length - 1 ? left : r2(udc * x.amount / net)) : 0; left = r2(left - share);
    const extra = sub ? r2(x.amount + share) : r2(diff + share);
    if (extra) {
      if (it.acct === 'K') acc.push(line('gbb', it.glk || 'GBB_VBR', 'D', s * extra, { matnr: it.matnr || '', cc: it.cc }));
      else if (pd.ctrl === 'V' && pd.totQty >= x.qty) { acc.push(line('inv', pd.vc, 'D', s * extra, { matnr: it.matnr })); valuation.push({ m: it.matnr, p: it.plant, q: 0, v: s * extra }); }
      else acc.push(line('PRD', 'PRD', 'D', s * extra, { matnr: it.matnr }));
    }
  });
  if (tax) acc.push(line('VST', 'VST', 'D', s * tax, { tax: taxCode }));
  return { acc, reasons, blocked: reasons.length > 0, valuation };
}
function postIR({ po, date = today(), ref, gross, taxCode, tax, items, cm = false, udc = 0, num = '', sub = '' }) {
  const P = S.pos[po]; const c = computeIR({ po, gross, taxCode, tax, items, cm, udc, sub });
  const inv = num || nextNo('inv'); const year = date.slice(0, 4); const s = cm || sub === 'C' ? -1 : 1;
  if (sub) items = items.map(x => ({ ...x, qty: 0 }));
  applyVals(c.valuation, 1);
  for (const x of items) P.history.push({ type: 'RE', mvt: '', doc: inv, year, item: x.item, qty: s * x.qty, amount: s * r2(x.amount), date, ...(sub ? { sub: true } : {}) });
  const an = createAcc('RE', inv, date, c.acc);
  S.invoices[inv] = { num: inv, year, date, ref, po, vendor: P.vendor, gross: r2(gross), taxCode, tax: r2(tax), udc: r2(udc), cm: cm || sub === 'C', sub, items: items.map(x => ({ ...x, amount: r2(x.amount) })),
    blocked: c.blocked, reasons: c.reasons, acc: an, released: null, status: 'posted', paid: null, valuation: c.valuation };
  return inv;
}

// ---------- seed data ----------
function coreEnsure() {
  S.cfg ??= {}; const c = S.cfg;
  c.gl ??= {}; c.tol ??= { pp: 5, ppAbs: 1000, dq: true }; c.overTol ??= 0; c.slocs ??= {}; c.pgrps ??= {}; c.mtypeCtrl ??= {};
  for (const k of Object.keys(GL)) delete GL[k];
  Object.assign(GL, JSON.parse(JSON.stringify(GL_DEF)), c.gl);
  ORG.slocs = { ...ORG0.slocs, ...c.slocs }; ORG.pgrps = { ...ORG0.pgrps, ...c.pgrps };
  ORG.plantSlocs = JSON.parse(JSON.stringify(ORG0.plantSlocs)); for (const k of Object.keys(c.slocs)) if (!ORG.plantSlocs['1010'].includes(k)) ORG.plantSlocs['1010'].push(k);
  ORG.mtypeDef = JSON.parse(JSON.stringify(ORG0.mtypeDef));
  for (const [k, v] of Object.entries(c.mtypeCtrl)) if (ORG.mtypeDef[k]) ORG.mtypeDef[k].ctrl = v;
  S.reservations ??= {}; S.special ??= {}; S.boms ??= {}; S.consign ??= [];
}
const ensureAll = () => { coreEnsure(); HOOKS.ensure.forEach(f => f(S)); };
function seed() {
  resetStore(emptyStore()); ensureAll();
  createMaterial({ matnr: 'TG11', desc: 'Business laptop 14"', type: 'HAWA', uom: 'PC', group: 'L001', pgrp: '001', price: 520, stock: { '101A': 25 }, mrp: { type: 'PD', lot: 'EX', safety: 5, pdt: 7 } });
  createMaterial({ matnr: 'TG12', desc: 'Wireless mouse', type: 'HAWA', uom: 'PC', group: 'L001', pgrp: '001', price: 14.2, stock: { '101A': 140 }, mrp: { type: 'VB', rop: 100, lot: 'FX', fix: 200, pdt: 3 } });
  createMaterial({ matnr: 'TG13', desc: 'USB-C docking station', type: 'HAWA', uom: 'PC', group: 'L001', pgrp: '001', price: 0 });
  createMaterial({ matnr: 'RM14', desc: 'Corrugated carton 40x30', type: 'ROH', uom: 'PC', group: 'L003', pgrp: '002', price: 0.85, stock: { '101A': 2000 }, mrp: { type: 'PD', lot: 'EX', safety: 300, pdt: 5 } });
  createMaterial({ matnr: 'TG15', desc: 'Ergonomic office chair', type: 'HAWA', uom: 'PC', group: 'L002', pgrp: '001', price: 145, stock: { '101A': 12 } });
  createMaterial({ matnr: 'FG16', desc: 'Printed shipping box (logo)', type: 'FERT', uom: 'PC', group: 'L003', pgrp: '002', price: 1.4, stock: { '101A': 150 }, mrp: { type: 'PD', lot: 'FX', fix: 500, pdt: 10 } });
  S.boms.FG16 = [{ comp: 'RM14', qty: 1 }];
  extendMaterial('TG12', '1020', '102A', { stock: 20 }); extendMaterial('TG15', '1020', '102A', {});
  const pd = (o = {}) => ({ porg: { '1010': { curr: 'EUR', terms: 'NT30', grIv: true, ers: false, ...o } } });
  const v1 = createVendor({ name: "Côte d'Azur IT Distribution", search: 'CAZIT', street: '12 avenue Jean Médecin', post: '06000', city: 'Nice', country: 'FR', lang: 'EN', cc: { '1010': { recon: '21100000', terms: 'NT30' } }, ...pd() });
  const v2 = createVendor({ name: 'Provence Office Supplies', search: 'PROVOFF', street: '45 boulevard Longchamp', post: '13001', city: 'Marseille', country: 'FR', lang: 'FR', cc: { '1010': { recon: '21100000', terms: 'NT45' } }, ...pd({ terms: 'NT45' }) });
  const v3 = createVendor({ name: 'Emballages du Var', search: 'EMBVAR', street: '8 rue de la Poudrière', post: '83000', city: 'Toulon', country: 'FR', lang: 'FR', cc: { '1010': { recon: '21100000', terms: 'NT30' } }, ...pd() });
  createInfo({ vendor: v1, matnr: 'TG11', porg: '1010', plant: '1010', price: 510, days: 7 });
  createInfo({ vendor: v1, matnr: 'TG12', porg: '1010', plant: '1010', price: 13.9, days: 3 });
  createInfo({ vendor: v2, matnr: 'TG12', porg: '1010', plant: '1010', price: 14.5, days: 2 });
  createInfo({ vendor: v2, matnr: 'TG15', porg: '1010', plant: '1010', price: 139, days: 10, disc: 3, frt: 4 });
  createInfo({ vendor: v3, matnr: 'RM14', porg: '1010', plant: '1010', price: 0.82, days: 5 });
  createInfo({ vendor: v3, matnr: 'FG16', porg: '1010', plant: '1010', price: 0.45, days: 10, cat: 'L' });
  createInfo({ vendor: v2, matnr: 'TG12', porg: '1010', plant: '1010', price: 14.0, days: 2, cat: 'K' });
  // history: one completed P2P cycle, one open PO, one open PR
  const po1 = createPO({ vendor: v1, docDate: dPlus(-20), items: [{ matnr: 'TG11', short: 'Business laptop 14"', qty: 10, uom: 'PC', price: 510, conds: { gross: 510, disc: 0, frt: 0, src: 'Info record 5300000001' }, plant: '1010', sloc: '101A', date: dPlus(-13) }] });
  postGR({ po: po1, date: dPlus(-14), lines: [{ item: 10, qty: 10, sloc: '101A', stype: 'unr' }] });
  postIR({ po: po1, date: dPlus(-10), ref: 'CAZ-2611-0457', gross: 6120, taxCode: 'V1', tax: 1020, items: [{ item: 10, qty: 10, amount: 5100 }] });
  createPO({ vendor: v2, docDate: dPlus(-3), items: [{ matnr: 'TG15', short: 'Ergonomic office chair', qty: 5, uom: 'PC', price: 138.83, conds: { gross: 139, disc: 3, frt: 4, src: 'Info record 5300000004' }, plant: '1010', sloc: '101A', date: dPlus(7) }] });
  createPR({ date: dPlus(-1), items: [{ matnr: 'RM14', short: 'Corrugated carton 40x30', qty: 500, uom: 'PC', plant: '1010', sloc: '101A', date: dPlus(10), pgrp: '002', vendor: '', valPrice: 0.85 }] });
  HOOKS.seed.forEach(f => f(S));
  ensureAll();
  S.log = [];
  persist();
}
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw); if (d && d.v === 2) { resetStore(d); ensureAll(); return; } } } catch (e) { /* ignore */ }
  seed();
}

// ======================================================================
// Event log (drives trainer scenarios)
// ======================================================================
function emit(type, data = {}) {
  S.log.push({ t: Date.now(), ...data, type });
  persist();
  (HOOKS.emit || []).forEach(f => { try { f(S.log[S.log.length - 1]); } catch (e) { console.error(e); } });
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
  (HOOKS.open || []).forEach(f => f(code));
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
  document.body.classList.toggle('fiori', !!d.fiori);
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
  po: () => Object.values(S.pos).reverse().map(p => [p.num, p.type === 'UB' ? `STO from plant ${p.splant}` : vname(p.vendor), p.items.map(i => `${i.matnr} ×${qf(i.qty)}`).join(', ')]),
  pr: () => Object.values(S.prs).reverse().map(p => [p.num, p.items.map(i => `${i.matnr} ×${qf(i.qty)}`).join(', '), p.items.every(i => i.poRef) ? 'Ordered' : 'Open']),
  matdoc: () => Object.values(S.matDocs).reverse().map(d => [d.num, `${d.mvt} ${mvtName(d.mvt)}`, `${d.items[0]?.po ? 'PO ' + d.items[0].po + ' · ' : ''}${fmtD(d.date)}${d.reversedBy ? ' · reversed' : ''}`]),
  inv: () => Object.values(S.invoices).reverse().map(i => [i.num, vname(i.vendor), `${i.cm ? 'Credit memo · ' : ''}${money(i.gross)} EUR · ${i.status === 'parked' ? 'parked' : i.status === 'reversed' ? 'reversed' : i.blocked ? 'blocked' : i.paid ? 'paid' : 'posted'}`]),
  acc: () => Object.values(S.accDocs).reverse().map(a => [a.num, `${a.type} – ${ACCT[a.type] || ''}`, `Ref. ${a.refDoc} · ${fmtD(a.date)}`]),
  costc: () => Object.entries(ORG.costc), reason: () => Object.entries(ORG.reasons),
  res: () => Object.values(S.reservations).reverse().map(r => [r.num, `Cost ctr ${r.cc}`, r.items.map(i => `${i.matnr} ×${qf(i.qty)}`).join(', ')]),
  ctr: () => Object.values(S.contracts || {}).reverse().map(k => [k.num, vname(k.vendor), `${k.type} · ${k.items.map(i => i.matnr).join(', ')} · until ${fmtD(k.to)}`])
};
const ACCT = { WE: 'Goods receipt', RE: 'Invoice receipt', WA: 'Goods issue / transfer', WI: 'Inventory difference', ZP: 'Outgoing payment', PR: 'Price change', KN: 'Consignment settlement' };
const F4T = { mat: 'Material', vendor: 'Supplier', plant: 'Plant', sloc: 'Storage location', porg: 'Purchasing organization', pgrp: 'Purchasing group', cc: 'Company code', mtype: 'Material type', mgroup: 'Material group', uom: 'Unit of measure', tax: 'Tax code', terms: 'Payment terms', country: 'Country', vclass: 'Valuation class', po: 'Purchasing document', pr: 'Purchase requisition', matdoc: 'Material document', inv: 'Invoice document', acc: 'Accounting document', costc: 'Cost center', reason: 'Reason for movement', res: 'Reservation', ctr: 'Outline agreement' };

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
    const b = e.target.closest('[data-mb]'); if (b) { const def = buttons[+b.dataset.mb]; const mEl = $('.modal', bg); def.a?.(mEl); if (bg.contains(mEl)) closeModal(); }
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
  MK03: 'Transaction MK03 is obsolete in SAP S/4HANA: use transaction BP (Business Partner)',
  MB1A: 'Transaction MB1A is obsolete in SAP S/4HANA: use transaction MIGO (goods issue)',
  MB1B: 'Transaction MB1B is obsolete in SAP S/4HANA: use transaction MIGO (transfer posting)',
  MB1C: 'Transaction MB1C is obsolete in SAP S/4HANA: use transaction MIGO (other goods receipts)',
  MB01: 'Transaction MB01 is obsolete in SAP S/4HANA: use transaction MIGO',
  MB11: 'Transaction MB11 is obsolete in SAP S/4HANA: use transaction MIGO'
};

// ---------------- Easy Access ----------------
const MENU = [
  ['Favourites', [['/UI2/FLP'], ['ME21N'], ['MIGO'], ['MIRO'], ['MMBE'], ['MD04']], true],
  ['SAP menu', [
    ['Logistics', [
      ['Materials Management', [
        ['Purchasing', [
          ['Purchase Requisition', [['ME51N'], ['ME52N'], ['ME53N'], ['ME54N'], ['ME55'], ['ME5A'], ['ME56'], ['ME57'], ['ME59N']]],
          ['Purchase Order', [['ME21N'], ['ME22N'], ['ME23N'], ['ME28'], ['ME29N'], ['ME9F']]],
          ['Service Entry Sheet', [['ML81N']]],
          ['Purchase Order › List Displays', [['ME2N'], ['ME2M'], ['ME2L'], ['ME2C'], ['ME2K'], ['ME2O']]],
          ['RFQ / Quotation', [['ME41'], ['ME42'], ['ME43'], ['ME47'], ['ME48'], ['ME49']]],
          ['Outline Agreement', [['ME31K'], ['ME32K'], ['ME33K'], ['ME31L'], ['ME38'], ['ME33L']]],
          ['Master Data', [['ME11'], ['ME12'], ['ME13'], ['ME01'], ['ME03']]]
        ], true],
        ['Inventory Management', [['MIGO'], ['MIGO_GI'], ['MIGO_TR'], ['MBRL'], ['MB03'], ['MMBE'], ['MB52'], ['MB51'], ['MB5L']], true],
        ['Inventory Management › Reservation', [['MB21'], ['MB22'], ['MB23'], ['MB24'], ['MB25']]],
        ['Physical Inventory', [['MI01'], ['MI02'], ['MI03'], ['MI04'], ['MI05'], ['MI06'], ['MI07'], ['MI08'], ['MI09'], ['MI11'], ['MI20']]],
        ['Logistics Invoice Verification', [['MIRO'], ['MIR7'], ['MIR4'], ['MIR6'], ['MR8M'], ['MRBR'], ['MRRL'], ['MRKO'], ['MB5S']], true],
        ['Material Master', [['MM01'], ['MM02'], ['MM03']], true],
        ['Valuation', [['MR21'], ['MB5L']]]
      ], true],
      ['Production › MRP', [['MD61'], ['MD63'], ['MD01'], ['MD03'], ['MD04']]]
    ], true],
    ['Cross-Application Components', [['Business Partner', [['BP']]]]],
    ['Accounting', [['Financial Accounting', [['FB03'], ['FBL1N'], ['F110']]]]],
    ['Tools › Customizing', [['SPRO']]]
  ], true]
];
const hasLeaf = n => n.length === 1 ? !!TX[n[0]] : n[1].some(hasLeaf);
function tree(nodes) {
  return nodes.filter(hasLeaf).map(n => n.length === 1
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

// ---------------- MM01 / MM02 / MM03: Material master ----------------
const MATVIEWS = [['basic', 'Basic data 1'], ['purch', 'Purchasing'], ['mrp', 'MRP 1'], ['plant', 'Plant data / stor.'], ['acct', 'Accounting 1']];
const mrpFields = (m, ro) => F('MRP type', 'mrpType', { type: 'select', opts: ORG.mrpTypes, ro, rr: 1 }) +
  (m.mrpType === 'VB' ? F('Reorder point', 'rop', { num: 1, w: 8, ro, req: !ro }) : '') +
  (m.mrpType !== 'ND' ? F('Lot size', 'lot', { type: 'select', opts: ORG.lots, ro, rr: 1 }) + (m.lot === 'FX' ? F('Fixed lot size', 'fix', { num: 1, w: 8, ro, req: !ro }) : '') + (m.lot === 'HB' ? F('Maximum stock level', 'max', { num: 1, w: 8, ro, req: !ro }) : '') + F('Safety stock', 'safety', { num: 1, w: 8, ro }) : '') +
  F('Planned deliv. time (days)', 'pdt', { num: 1, w: 5, ro }) + F('MRP controller', '_mc', { ro: 1, w: 5, desc: '001 Planner Riviera' }) +
  '<div class="tip"><b>VB</b>: when stock falls below the reorder point, MRP creates a requisition. <b>PD</b>: MRP nets requirements (planned independent requirements, reservations, safety stock) against stock and open receipts. <b>ND</b>: not planned.</div>';
function mrpValidate(m, go) {
  if (!ORG.mrpTypes[m.mrpType]) go('mrp', 'mrpType', 'Invalid MRP type');
  if (m.mrpType === 'VB' && !(N(m.rop) > 0)) go('mrp', 'rop', 'Enter a reorder point (MRP type VB)');
  if (m.mrpType !== 'ND' && m.lot === 'FX' && !(N(m.fix) > 0)) go('mrp', 'fix', 'Enter a fixed lot size (lot size FX)');
  if (m.mrpType !== 'ND' && m.lot === 'HB' && !(N(m.max) > 0)) go('mrp', 'max', 'Enter a maximum stock level (lot size HB)');
}
const mrpOut = m => ({ type: m.mrpType, rop: N(m.rop) || 0, lot: m.lot, fix: N(m.fix) || 0, max: N(m.max) || 0, safety: N(m.safety) || 0, pdt: N(m.pdt) || 0 });
TX.MM01 = {
  title: c => c.m.step === 2 ? (c.m.extend ? `Extend Material ${U(c.m.matnr)} to Plant ${c.m.plant}` : `Create Material ${U(c.m.matnr)} (${ORG.mtypes[c.m.type]})`) : 'Create Material (Initial Screen)',
  init: () => ({ step: 1, matnr: '', ind: 'R', type: 'HAWA', plant: '1010', sloc: '101A', desc: '', uom: 'PC', group: '', pgrp: '001', vc: '', ctrl: '', price: '', mrpType: 'ND', rop: '', lot: 'EX', fix: '', max: '', safety: '', pdt: '5' }),
  tb: c => c.m.step === 2 ? [] : [{ l: 'Select view(s)', i: '☰', a: c => act(TX.MM01.enter) }],
  render: c => {
    const m = c.m;
    if (m.step === 1) return box('Material', F('Material', 'matnr', { req: 1, w: 18, ph: 'e.g. TG20' }) + F('Industry sector', 'ind', { type: 'select', opts: { R: 'Retail', M: 'Mechanical engineering' } }) +
      F('Material type', 'type', { req: 1, f4: 'mtype', w: 6, desc: ORG.mtypes[U(m.type)] || '' })) +
      box('Organizational levels', F('Plant', 'plant', { req: 1, f4: 'plant', w: 6, desc: ORG.plants[m.plant] || '' }) + F('Storage location', 'sloc', { req: 1, f4: 'sloc', w: 6, desc: ORG.slocs[U(m.sloc)] || '' })) +
      `<div class="tip">The material number uses external numbering in this client: type your own (e.g. <b>TG20</b>). Views created: Basic data 1, Purchasing, MRP 1, Plant data/stor., Accounting 1.</div>`;
    const t = tabOn(c, MATVIEWS);
    let inner = '';
    if (t === 'basic') inner = F('Material description', 'desc', { req: 1, w: 40, ro: m.extend }) + F('Base unit of measure', 'uom', { req: 1, f4: 'uom', w: 5, ro: m.extend, desc: ORG.uoms[U(m.uom)] || '' }) + F('Material group', 'group', { req: 1, f4: 'mgroup', w: 8, ro: m.extend, desc: ORG.mgroups[U(m.group)] || '' }) + (m.extend ? '<div class="tip">Client-level data (description, unit, group) already exists: you only maintain the plant-level views for the new plant.</div>' : '');
    if (t === 'purch') inner = F('Purchasing group', 'pgrp', { req: 1, f4: 'pgrp', w: 5, desc: ORG.pgrps[m.pgrp] || '' }) + F('Order unit', 'uom', { ro: 1, w: 5 }) + `<div class="tip">The purchasing group is the buyer (or team) responsible for this material.</div>`;
    if (t === 'mrp') inner = mrpFields(m, false);
    if (t === 'plant') inner = F('Plant', 'plant', { ro: 1, w: 6, desc: ORG.plants[m.plant] }) + F('Storage location', 'sloc', { ro: 1, w: 6, desc: ORG.slocs[U(m.sloc)] });
    if (t === 'acct') inner = F('Valuation class', 'vc', { req: 1, f4: 'vclass', w: 6, desc: ORG.vclasses[m.vc] || '' }) + F('Price control', 'ctrl', { type: 'select', opts: ORG.ctrls, rr: 1 }) + F(m.ctrl === 'S' ? 'Standard price (EUR)' : 'Moving price (EUR)', 'price', { w: 12, num: 1, req: m.ctrl === 'S' }) +
      `<div class="tip">Valuation class links the material to its inventory G/L account (see SPRO › account determination). Price control <b>V</b> lets the price move with each goods receipt; <b>S</b> keeps a fixed standard price and posts differences to a price-difference account.</div>`;
    return tabs(c, MATVIEWS) + box(MATVIEWS.find(v => v[0] === t)[1], inner);
  },
  enter: c => {
    const m = c.m;
    if (m.step === 1) {
      req(c, ['matnr', 'type', 'plant', 'sloc']);
      m.matnr = U(m.matnr); m.type = U(m.type); m.sloc = U(m.sloc);
      if (!/^[A-Z0-9-]{2,18}$/.test(m.matnr)) err('Material number: use 2–18 letters, digits or hyphens', null, 'matnr');
      if (S.materials[m.matnr]) {
        const M = S.materials[m.matnr];
        needOf(ORG.plants, m.plant, 'Plant', 'plant');
        if (M.plants[m.plant]) err(`Material ${m.matnr} already exists in plant ${m.plant} (use MM02 to change it)`, 'MAT_EXISTS', 'matnr');
        if (!slocOk(m.plant, m.sloc)) err(`Storage location ${m.sloc} does not exist in plant ${m.plant}`, null, 'sloc');
        const src = Object.values(M.plants)[0];
        Object.assign(m, { extend: true, type: M.type, desc: M.desc, uom: M.uom, group: M.group, pgrp: src.pgrp, vc: src.vc, ctrl: src.ctrl, price: String(src.price), mrpType: 'ND', step: 2, tab: 'purch' });
        msg('I', `Material ${m.matnr} already exists: maintain its views for plant ${m.plant} (plant extension)`); return;
      }
      needOf(ORG.mtypes, m.type, 'Material type', 'type'); needOf(ORG.plants, m.plant, 'Plant', 'plant'); needOf(ORG.slocs, m.sloc, 'Storage location', 'sloc');
      if (!slocOk(m.plant, m.sloc)) err(`Storage location ${m.sloc} does not exist in plant ${m.plant}`, null, 'sloc');
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
    mrpValidate(m, go);
    if (!ORG.vclasses[m.vc]) go('acct', 'vc', `Valuation class ${m.vc} does not exist`);
    const p = N(m.price);
    if (isNaN(p) || p < 0) go('acct', 'price', 'Enter a valid price');
    if (m.ctrl === 'S' && !p) go('acct', 'price', 'Enter a standard price (price control S)');
  },
  save: c => {
    if (c.m.step === 1) err('Select views first: press Enter');
    TX.MM01.validate(c);
    const m = c.m;
    if (m.extend) { extendMaterial(m.matnr, m.plant, m.sloc, { pgrp: m.pgrp, vc: m.vc, ctrl: m.ctrl, price: N(m.price), mrp: mrpOut(m) }); emit('MAT_EXTENDED', { matnr: m.matnr, plant: m.plant }); c.m = TX.MM01.init(); msg('S', `Material ${m.matnr} extended to plant ${m.plant}`); return; }
    createMaterial({ matnr: m.matnr, desc: m.desc.trim(), type: m.type, uom: U(m.uom), group: U(m.group), pgrp: m.pgrp, plant: m.plant, vc: m.vc, ctrl: m.ctrl, price: N(m.price), slocs: [m.sloc], mrp: mrpOut(m) });
    emit('MAT_CREATED', { matnr: m.matnr, mtype: m.type });
    c.m = TX.MM01.init();
    msg('S', !N(m.price) && m.ctrl === 'V' ? `Material ${m.matnr} created (moving price 0.00: it will be set by the first goods receipt)` : `Material ${m.matnr} created`);
  },
  back: c => { if (c.m.step === 2) { c.m.step = 1; return true; } }
};
TX.MM02 = {
  title: c => c.m.step === 2 ? `Change Material ${c.m.matnr} (${ORG.mtypes[S.materials[c.m.matnr]?.type] || ''})` : 'Change Material (Initial Screen)',
  init: p => ({ step: 1, matnr: p.matnr || '', plant: '1010' }),
  render: c => {
    const m = c.m;
    if (m.step === 1) return box('Material', F('Material', 'matnr', { req: 1, f4: 'mat', w: 18 }) + F('Plant', 'plant', { f4: 'plant', w: 6 })) + '<div class="tip">Change the description, material group, purchasing group or MRP data. Price control and valuation class cannot be changed here once stock exists (use MR21 to change a standard price).</div>';
    const V = [['basic', 'Basic data 1'], ['purch', 'Purchasing'], ['mrp', 'MRP 1']], t = tabOn(c, V);
    let inner = '';
    if (t === 'basic') inner = F('Material description', 'desc', { req: 1, w: 40 }) + F('Base unit of measure', 'uom', { ro: 1, w: 5 }) + F('Material group', 'group', { req: 1, f4: 'mgroup', w: 8, desc: ORG.mgroups[U(m.group)] || '' });
    if (t === 'purch') inner = F('Purchasing group', 'pgrp', { req: 1, f4: 'pgrp', w: 5, desc: ORG.pgrps[m.pgrp] || '' });
    if (t === 'mrp') inner = mrpFields(m, false);
    return tabs(c, V) + box(V.find(v => v[0] === t)[1], inner);
  },
  enter: c => {
    const m = c.m; if (m.step === 2) return;
    req(c, ['matnr']); m.matnr = U(m.matnr);
    const M = needMat(m.matnr, m.plant, 'matnr'), pd = M.plants[m.plant];
    Object.assign(m, { step: 2, tab: 'basic', desc: M.desc, uom: M.uom, group: M.group, pgrp: pd.pgrp, mrpType: pd.mrp.type, rop: String(pd.mrp.rop || ''), lot: pd.mrp.lot, fix: String(pd.mrp.fix || ''), max: String(pd.mrp.max || ''), safety: String(pd.mrp.safety || ''), pdt: String(pd.mrp.pdt ?? '') });
  },
  save: c => {
    const m = c.m; if (m.step === 1) err('Enter a material and press Enter first', null, 'matnr');
    const go = (tab, k, e) => { m.tab = tab; err(e, null, k); };
    if (!m.desc.trim()) go('basic', 'desc', 'Fill in all required entry fields');
    if (!ORG.mgroups[U(m.group)]) go('basic', 'group', `Material group ${m.group} does not exist`);
    if (!ORG.pgrps[m.pgrp]) go('purch', 'pgrp', `Purchasing group ${m.pgrp} does not exist`);
    mrpValidate(m, go);
    const M = S.materials[m.matnr], pd = M.plants[m.plant];
    M.desc = m.desc.trim(); M.group = U(m.group); pd.pgrp = m.pgrp; pd.mrp = mrpOut(m);
    emit('MAT_CHANGED', { matnr: m.matnr, mrp: pd.mrp.type });
    c.m = TX.MM02.init({}); msg('S', `Material ${M.matnr} changed`);
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
    if (t === 'basic') inner = row('Material', M.matnr) + row('Description', M.desc) + row('Material type', `${M.type} – ${ORG.mtypes[M.type]}`) + row('Base unit of measure', M.uom) + row('Material group', `${M.group} – ${ORG.mgroups[M.group]}`) + row('Created on', fmtD(M.created)) +
      (S.boms[M.matnr] ? `<h4>Bill of material</h4>` + grid([{ h: 'Component', k: 'comp' }, { h: 'Description', f: r => esc(S.materials[r.comp]?.desc) }, { h: 'Qty per 1 ' + M.uom, r: 1, f: r => qf(r.qty) }], S.boms[M.matnr]) : '');
    if (t === 'purch') inner = row('Purchasing group', `${pd.pgrp} – ${ORG.pgrps[pd.pgrp]}`) + `<h4>Info records</h4>` + grid([{ h: 'Info record', k: 'id' }, { h: 'Cat.', f: r => r.cat ? ORG.itemCats[r.cat] : 'Standard' }, { h: 'Supplier', f: r => `${r.vendor} ${esc(vname(r.vendor))}` }, { h: 'Gross price', r: 1, f: r => money(r.price) }, { h: 'Disc. %', r: 1, f: r => r.disc ? qf(r.disc) : '' }, { h: 'Freight/unit', r: 1, f: r => r.frt ? money(r.frt) : '' }, { h: 'Deliv. days', r: 1, k: 'days' }], S.infos.filter(i => i.matnr === M.matnr), { empty: 'No purchasing info record: a PO price will not be proposed' });
    if (t === 'mrp') { const mm = pd.mrp; inner = row('MRP type', ORG.mrpTypes[mm.type]) + (mm.type === 'VB' ? row('Reorder point', qf(mm.rop)) : '') + (mm.type !== 'ND' ? row('Lot size', ORG.lots[mm.lot]) + (mm.lot === 'FX' ? row('Fixed lot size', qf(mm.fix)) : '') + (mm.lot === 'HB' ? row('Maximum stock', qf(mm.max)) : '') + row('Safety stock', qf(mm.safety)) : '') + row('Planned deliv. time', `${mm.pdt} days`); }
    if (t === 'plant') inner = row('Plant', `${m.plant} – ${ORG.plants[m.plant]}`) + grid([{ h: 'SLoc', k: 's' }, { h: 'Description', f: r => esc(ORG.slocs[r.s]) }, { h: 'Unrestricted', r: 1, f: r => qf(r.unr) }, { h: 'Quality insp.', r: 1, f: r => qf(r.qi) }, { h: 'Blocked', r: 1, f: r => qf(r.blk) }],
      Object.keys(ORG.slocs).filter(s => S.stock[stockKey(M.matnr, m.plant, s)]).map(s => ({ s, ...S.stock[stockKey(M.matnr, m.plant, s)] })));
    if (t === 'acct') inner = row('Valuation class', `${pd.vc} – ${ORG.vclasses[pd.vc]}`) + row('Price control', ORG.ctrls[pd.ctrl]) + row(pd.ctrl === 'S' ? 'Standard price' : 'Moving price', `${money(pd.price)} EUR / 1 ${M.uom}`) + row('Total valuated stock', `${qf(pd.totQty)} ${M.uom}`) + row('Total value', `${money(pd.totVal)} EUR`) + row('Inventory G/L account', `${GL[pd.vc][0]} ${GL[pd.vc][1]}`);
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
const blankPO = () => ({ acct: '', cc: '', group: '', cat: '', matnr: '', short: '', qty: '', uom: '', date: '', price: '', plant: '', sloc: '', prRef: '', prItem: '', agmt: '', agmtItem: '', conds: null, _auto: true });
const condNet = c => r2((N(c.gross) || 0) * (1 - (N(c.disc) || 0) / 100) + (N(c.frt) || 0));
function fillSTO(c) {
  const m = c.m, h = m.hdr; h.splant = String(h.splant || '').trim();
  if (!ORG.plants[h.splant]) err(`Plant ${h.splant || '(empty)'} does not exist`, null, 'hdr.splant');
  m.items.forEach((it, i) => {
    if (!String(it.matnr).trim()) return;
    const k = `items.${i}.`, no = pad((i + 1) * 10, 5);
    if (it.acct || it.cat) err(`Item ${no}: stock transport orders take neither account assignment nor item category`, null, k + 'cat');
    it.matnr = U(it.matnr); it.plant = String(it.plant || '').trim();
    if (!it.plant || it.plant === h.splant && !it._pset) it.plant = Object.keys(ORG.plants).find(p => p !== h.splant);
    if (it.plant === h.splant) err(`Item ${no}: receiving plant must differ from supplying plant ${h.splant}`, null, k + 'plant');
    const M = needMat(it.matnr, h.splant, k + 'matnr'); needMat(it.matnr, it.plant, k + 'matnr');
    it.short = M.desc; it.uom = M.uom; it.group = M.group;
    it.sloc = U(it.sloc); if (!slocOk(it.plant, it.sloc)) it.sloc = ORG.plantSlocs[it.plant][0];
    if (!it.date) it.date = fmtD(dPlus(2));
    const pdF = M.plants[h.splant]; it.price = pdF.price.toFixed(2); it.conds = { gross: pdF.price, disc: 0, frt: 0, src: `Valuation price plant ${h.splant}` }; it._auto = true;
  });
  return [];
}
function fillPOItems(c) {
  const m = c.m, h = m.hdr;
  if (h.type === 'UB') return fillSTO(c);
  h.vendor = String(h.vendor).trim();
  m.items.forEach(it => { const a = String(it.agmt || '').trim(); if (a && !h.vendor && S.contracts?.[a]) h.vendor = S.contracts[a].vendor; });
  if (h.vendor) needVendor(h.vendor, h.porg, 'hdr.vendor');
  if (!ORG.porgs[h.porg]) err(`Purchasing organization ${h.porg} does not exist`, null, 'hdr.porg');
  if (!ORG.pgrps[h.pgrp]) err(`Purchasing group ${h.pgrp} does not exist`, null, 'hdr.pgrp');
  const notes = [];
  m.items.forEach((it, i) => {
    it.agmt = String(it.agmt || '').trim();
    if (!String(it.matnr).trim() && !it.agmt && !String(it.short || '').trim()) return;
    const k = `items.${i}.`, no = pad((i + 1) * 10, 5);
    it.cat = U(it.cat || ''); it.acct = U(it.acct || ''); it.cc = String(it.cc || '').trim();
    if (it.cat === 'D' && !it.acct) it.acct = 'K';
    if (it.agmt) {
      const K = S.contracts?.[it.agmt]; if (!K) err(`Contract ${it.agmt} does not exist`, 'NO_CTR', k + 'agmt');
      if (h.vendor && K.vendor !== h.vendor) err(`Contract ${it.agmt} belongs to supplier ${K.vendor}, not ${h.vendor}`, null, k + 'agmt');
      const dd = parseD(h.docDate) || today();
      if (dd > K.to || dd < K.from) err(`Contract ${it.agmt} is not valid on ${fmtD(dd)} (validity ${fmtD(K.from)}–${fmtD(K.to)})`, 'CTR_EXPIRED', k + 'agmt');
      const ki = K.items.find(x => x.item === +it.agmtItem) || (String(it.matnr).trim() ? K.items.find(x => x.matnr === U(it.matnr)) : K.items[0]);
      if (!ki) err(`Material ${U(it.matnr)} is not in contract ${it.agmt}`, null, k + 'agmt');
      it.agmtItem = String(ki.item); it.matnr = ki.matnr;
      if (it._auto || it.price === '') { it.conds = { gross: ki.price, disc: 0, frt: 0, src: `Contract ${K.num}` }; it.price = ki.price.toFixed(2); it._auto = true; }
    }
    if (!String(it.matnr).trim()) {
      if (!it.acct) err(`Item ${no}: an item without material must be account-assigned (A = K and a cost center)`, 'NO_ACCT', k + 'acct');
      if (it.cat === 'K' || it.cat === 'L') err(`Item ${no}: item category ${it.cat} needs a material number`, null, k + 'cat');
      it.matnr = ''; it.plant = it.plant || '1010'; it.sloc = ''; it.uom = U(it.uom) || (it.cat === 'D' ? 'AU' : 'PC');
      if (!ORG.uoms[it.uom]) err(`Unit of measure ${it.uom} does not exist`, null, k + 'uom');
      it.group = U(it.group || ''); if (!ORG.mgroups[it.group]) err(it.group ? `Material group ${it.group} does not exist` : `Item ${no}: enter a material group (needed for account determination)`, 'NO_MATGRP', k + 'group');
      if (!it.date) it.date = fmtD(dPlus(7));
      if (it._auto && it.price !== '' && !it.conds) it._auto = false;
      return;
    }
    if (it.cat === 'D') err(`Item ${no}: service items (D) are entered without material number: clear the material and type a short text`, null, k + 'matnr');
    it.matnr = U(it.matnr); it.plant = it.plant || '1010';
    const M = needMat(it.matnr, it.plant, k + 'matnr');
    it.short = M.desc; it.uom = M.uom; it.group = M.group; it.sloc = it.acct === 'K' ? '' : U(it.sloc || M.plants[it.plant].slocs[0] || '101A');
    if (!it.date) it.date = fmtD(dPlus(Math.max(1, M.plants[it.plant].mrp?.pdt || 7)));
    if (it.cat && !ORG.itemCats[it.cat]) err(`Item category ${it.cat} is not allowed (use K or L, or leave empty)`, null, k + 'cat');
    if (it.cat === 'L' && !S.boms[it.matnr]?.length) err(`Item ${no}: no BOM for ${it.matnr}, so subcontracting components cannot be determined`, 'NO_BOM', k + 'matnr');
    if (it.cat === 'K') { if (it._auto) { it.price = ''; it.conds = null; } return; }
    if (h.vendor && !it.agmt && (it._auto || it.price === '')) {
      const inf = findInfo(h.vendor, it.matnr, h.porg, it.plant, it.cat === 'L' ? 'L' : '');
      if (inf) { it.conds = { gross: inf.price / inf.per, disc: inf.disc || 0, frt: inf.frt || 0, src: `Info record ${inf.id}` }; it.price = condNet(it.conds).toFixed(2); it._auto = true; }
      else { it.price = ''; it.conds = null; notes.push(`${it.matnr}: no ${it.cat === 'L' ? 'subcontracting ' : ''}info record for supplier ${h.vendor}, so no price proposed`); }
    }
  });
  return notes;
}
function prSourceList() {
  return Object.values(S.prs).flatMap(p => p.items.filter(i => !i.poRef && !i.del).map(i => ({ ...i, num: p.num, rel: p.relReq && !p.released })));
}
const poInit = (p = {}) => {
  const items = (p.items || []).map(x => ({ ...blankPO(), ...x, qty: String(x.qty ?? ''), price: x.price != null ? Number(x.price).toFixed(2) : '', _auto: x.price == null }));
  while (items.length < 3) items.push(blankPO());
  return { hdr: { type: 'NB', splant: '1010', vendor: p.vendor || '', docDate: fmtD(today()), porg: '1010', pgrp: p.pgrp || '001', cc: '1010' }, items, doc: innerWidth > 820, _pre: !!p.items, src: p.src || '' };
};
TX.ME21N = {
  title: 'Create Purchase Order',
  init: poInit,
  onOpen: c => { if (c.m._pre) { const n = fillPOItems(c); msg(n.length ? 'W' : 'S', n[0] || `Data adopted${c.m.src ? ' from ' + c.m.src : ''}: check and save`); } },
  tb: c => [{ l: c.m.doc ? 'Document overview off' : 'Document overview on', i: '☰', a: c => act(c => { c.m.doc = !c.m.doc; }) }, { l: 'Check', i: '✔', a: c => act(TX.ME21N.check) }, { l: 'Add line', i: '＋', a: c => act(c => c.m.items.push(blankPO())) }],
  onInput: (c, k) => { if (/^items\.\d+\.price$/.test(k)) { const it = c.m.items[+k.split('.')[1]]; it._auto = false; it.conds = { gross: N(it.price) || 0, disc: 0, frt: 0, src: 'Entered manually' }; } },
  acts: {
    adopt: (c, d) => {
      const P = S.prs[d.pr]; const pi = P.items.find(i => i.item === +d.item);
      if (P.relReq && !P.released) err(`Purchase requisition ${P.num} is not released: release it first (ME54N)`, 'PR_NOT_REL');
      if (c.m.items.some(x => x.prRef === P.num && +x.prItem === pi.item)) err(`Requisition ${P.num} item ${pi.item} is already in this PO`);
      let row = c.m.items.find(x => !String(x.matnr).trim() && !String(x.agmt).trim());
      if (!row) { row = blankPO(); c.m.items.push(row); }
      Object.assign(row, { cat: pi.cat || '', matnr: pi.matnr, qty: String(pi.qty), date: fmtD(pi.date < today() ? dPlus(7) : pi.date), plant: pi.plant, sloc: pi.sloc, prRef: P.num, prItem: String(pi.item), _auto: true, price: '', agmt: pi.agmt || '', agmtItem: pi.agmtItem || '' });
      if (!String(c.m.hdr.vendor).trim() && pi.vendor) c.m.hdr.vendor = pi.vendor;
      if (pi.pgrp) c.m.hdr.pgrp = pi.pgrp;
      fillPOItems(c);
      msg('S', `Requisition ${P.num} item ${pi.item} adopted${String(c.m.hdr.vendor).trim() ? '' : ': now enter the supplier'}`);
    },
    cond: (c, d) => {
      const i = +d.i, it = c.m.items[i];
      if (!String(it.matnr).trim()) err('Enter a material first', null, `items.${i}.matnr`);
      const cd = it.conds || { gross: N(it.price) || 0, disc: 0, frt: 0, src: 'Entered manually' };
      modal(`Conditions: item ${pad((i + 1) * 10, 5)} ${it.matnr}`, `<table class="g"><tr><th>CnTy</th><th>Name</th><th class="r">Amount</th><th>Unit</th></tr>
        <tr><td>PB00</td><td>Gross price</td><td><input class="cell num" id="cdG" value="${esc(cd.gross)}" size="10"></td><td>EUR / 1 ${esc(it.uom)}</td></tr>
        <tr><td>RA01</td><td>Discount % on gross</td><td><input class="cell num" id="cdD" value="${esc(cd.disc || 0)}" size="10"></td><td>%</td></tr>
        <tr><td>FRB1</td><td>Freight (value per unit)</td><td><input class="cell num" id="cdF" value="${esc(cd.frt || 0)}" size="10"></td><td>EUR / 1 ${esc(it.uom)}</td></tr></table>
        <p class="small muted">Source: ${esc(cd.src || '')}. Net price = gross − discount + freight. Freight is included in the stock value at goods receipt.</p>`,
        [{ l: 'Cancel' }, { l: 'Apply', pri: 1, a: mEl => { const g = N($('#cdG', mEl).value), di = N($('#cdD', mEl).value), f = N($('#cdF', mEl).value);
          act(() => { if (!(g > 0) || isNaN(di) || di < 0 || di >= 100 || isNaN(f) || f < 0) err('Invalid condition values'); it.conds = { gross: g, disc: di, frt: f, src: 'Changed manually' }; it.price = condNet(it.conds).toFixed(2); it._auto = false; msg('S', `Net price for item ${pad((i + 1) * 10, 5)}: ${it.price} EUR`); }); } }]);
    }
  },
  render: c => {
    const m = c.m, h = m.hdr;
    const net = sum(m.items.filter(x => String(x.matnr).trim()), x => N(x.qty) * N(x.price) || 0);
    const docov = m.doc ? `<section class="box docov"><h3>Document overview · My open requisitions</h3><div class="in">${grid([{ h: 'Purch. req.', f: r => `<b>${r.num}</b>/${r.item}${r.rel ? ' <span class="badge warn">not released</span>' : ''}` }, { h: 'Material', f: r => `${r.matnr} ×${qf(r.qty)}` }, { h: '', f: r => `<button type="button" class="btn sm" data-act="adopt" data-pr="${r.num}" data-item="${r.item}" title="Adopt into PO">Adopt ▸</button>` }], prSourceList(), { empty: 'No open requisitions' })}</div></section>` : '';
    const main = box('Header', `<div class="cols"><div>${F('Order type', 'hdr.type', { type: 'select', opts: { NB: 'NB Standard PO', UB: 'UB Stock transport order' }, rr: 1 })}${h.type === 'UB' ? F('Supplying plant', 'hdr.splant', { req: 1, f4: 'plant', w: 6, desc: ORG.plants[String(h.splant).trim()] || '' }) : F('Supplier', 'hdr.vendor', { req: 1, f4: 'vendor', w: 12, desc: vname(String(h.vendor).trim()) })}${F('Doc. date', 'hdr.docDate', { w: 10 })}</div>
      <div>${F('Purch. org.', 'hdr.porg', { req: 1, f4: 'porg', w: 6 })}${F('Purch. group', 'hdr.pgrp', { req: 1, f4: 'pgrp', w: 4, desc: ORG.pgrps[h.pgrp] || '' })}${F('Company code', 'hdr.cc', { ro: 1, w: 6, desc: 'Riviera Trading SAS' })}</div></div>`,
      `<span class="small">Net value: <b>${money(net)} EUR</b></span>`) +
      box('Item overview', grid([
        { h: 'Itm', f: (r, i) => (i + 1) * 10 }, { h: 'A', f: (r, i) => I(`items.${i}.acct`, { type: 'select', opts: { '': '', K: 'K' } }) }, { h: 'I', f: (r, i) => I(`items.${i}.cat`, { type: 'select', opts: { '': '', K: 'K', L: 'L', D: 'D' } }) }, { h: 'Material', f: (r, i) => I(`items.${i}.matnr`, { f4: 'mat', w: 9 }) }, { h: 'Short text', f: (r, i) => r.matnr ? esc(r.short) : I(`items.${i}.short`, { w: 16, ph: 'text item / service' }) },
        { h: 'PO quantity', f: (r, i) => I(`items.${i}.qty`, { w: 6, num: 1 }) }, { h: 'OUn', f: (r, i) => r.matnr ? esc(r.uom) : I(`items.${i}.uom`, { f4: 'uom', w: 3 }) }, { h: 'Deliv. date', f: (r, i) => I(`items.${i}.date`, { w: 10, ph: 'DD.MM.YYYY' }) },
        { h: 'Net price', f: (r, i) => I(`items.${i}.price`, { w: 8, num: 1 }) }, { h: '', f: (r, i) => `<button type="button" class="btn sm" data-act="cond" data-i="${i}" title="Conditions (PB00, RA01, FRB1)">Cond.</button>` }, { h: 'Curr.', f: () => 'EUR' },
        { h: 'Plant', f: (r, i) => I(`items.${i}.plant`, { f4: 'plant', w: 4 }) }, { h: 'SLoc', f: (r, i) => r.acct === 'K' ? '' : I(`items.${i}.sloc`, { f4: 'sloc', w: 4 }) }, { h: 'Matl group', f: (r, i) => r.matnr ? esc(r.group || '') : I(`items.${i}.group`, { f4: 'mgroup', w: 5 }) }, { h: 'Cost center', f: (r, i) => I(`items.${i}.cc`, { f4: 'costc', w: 8 }) },
        { h: 'Agreement', f: (r, i) => I(`items.${i}.agmt`, { f4: 'ctr', w: 10 }) }, { h: 'Purch. req.', f: r => r.prRef ? `${r.prRef}/${r.prItem}` : '' }
      ], m.items)) +
      `<div class="tip">Enter the supplier and materials, then press <b>Enter</b>: the net price is proposed from the info record (or from the contract in <b>Agreement</b>). <b>Cond.</b> shows gross price, discount and freight. Item category <b>I</b>: K = consignment, L = subcontracting, D = service. Account assignment <b>A</b> = K charges a cost center instead of stock: then the material is optional (text item: short text, unit, material group). Save with <b>Ctrl+S</b>.</div>`;
    return `<div class="split ${m.doc ? '' : 'nodo'}">${docov}<div>${main}</div></div>`;
  },
  enter: c => { const n = fillPOItems(c); if (n.length) msg('W', n[0]); },
  check: c => { TX.ME21N.validate(c); msg('S', 'No messages issued during check'); },
  validate: c => {
    const m = c.m, h = m.hdr;
    fillPOItems(c);
    if (h.type !== 'UB' && !String(h.vendor).trim()) err('Enter a supplier', null, 'hdr.vendor');
    const d0 = parseD(h.docDate); if (!d0) err('Enter a valid date (DD.MM.YYYY)', null, 'hdr.docDate');
    const rows = m.items.map((it, i) => ({ it, i })).filter(x => String(x.it.matnr).trim() || (x.it.acct && String(x.it.short || '').trim()));
    if (!rows.length) err('Enter at least one item', null, 'items.0.matnr');
    return rows.map(({ it, i }) => {
      const k = `items.${i}.`, no = pad((i + 1) * 10, 5);
      const q = N(it.qty); if (!(q > 0)) err(`Item ${no}: enter a PO quantity`, 'NO_QTY', k + 'qty');
      const p = it.cat === 'K' ? (N(it.price) || 0) : N(it.price);
      if (it.cat !== 'K' && !(p > 0)) err(`Item ${no}: net price must be greater than 0`, 'NO_PRICE', k + 'price');
      const d = parseD(it.date); if (!d) err('Enter a valid date (DD.MM.YYYY)', null, k + 'date');
      if (d < today()) err(`Item ${no}: delivery date is in the past`, null, k + 'date');
      if (it.acct !== 'K' && !ORG.slocs[it.sloc]) err(`Storage location ${it.sloc} does not exist`, null, k + 'sloc');
      if (it.acct === 'K' && !ORG.costc[it.cc]) err(it.cc ? `Cost center ${it.cc} does not exist` : `Item ${no}: enter a cost center (account assignment K)`, 'NO_CC', k + 'cc');
      const comps = it.cat === 'L' ? S.boms[it.matnr].map(b => ({ matnr: b.comp, qty: r3(b.qty * q) })) : undefined;
      return { acct: it.acct, cc: it.acct === 'K' ? it.cc : '', group: it.group, glk: it.acct === 'K' ? glkFor(it.group) : '', cat: it.cat, matnr: it.matnr, short: String(it.short).trim(), qty: q, uom: it.uom, price: r2(p), plant: it.plant, sloc: it.sloc, date: d, prRef: it.prRef, prItem: it.prItem, agmt: it.agmt, agmtItem: it.agmt ? +it.agmtItem : '', rfq: it.rfq || '', conds: it.conds || { gross: r2(p), disc: 0, frt: 0, src: 'Entered manually' }, comps };
    });
  },
  save: c => {
    const items = TX.ME21N.validate(c), h = c.m.hdr;
    const num = createPO({ vendor: h.type === 'UB' ? '' : h.vendor, type: h.type, splant: h.type === 'UB' ? h.splant : '', porg: h.porg, pgrp: h.pgrp, cc: h.cc, docDate: parseD(h.docDate), items });
    const P = S.pos[num];
    emit('PO_CREATED', { num, vendor: P.vendor, type: P.type, splant: P.splant, value: r2(sum(P.items, x => x.qty * x.price / x.per)), rel: !!P.relReq, items: items.map(x => ({ matnr: x.matnr, short: x.short, qty: x.qty, price: x.price, prRef: x.prRef, agmt: x.agmt, cat: x.cat, acct: x.acct, cc: x.cc, src: x.conds?.src || '' })) });
    c.m = poInit();
    const warn = items.filter(x => x.agmt).map(x => { const K = S.contracts[x.agmt]; const ki = K.items.find(y => y.item === x.agmtItem); const used = ctrUsage(K.num, ki.item); return K.type === 'MK' && used.qty > ki.target ? `target quantity of contract ${K.num} item ${ki.item} exceeded (${qf(used.qty)} / ${qf(ki.target)})` : K.type === 'WK' && ctrUsage(K.num).value > K.targetVal ? `target value of contract ${K.num} exceeded` : ''; }).filter(Boolean);
    msg(warn.length ? 'W' : 'S', `${P.type === 'UB' ? 'Stock transport order' : 'Standard PO'} created under the number ${num}${P.relReq ? ' (subject to release)' : ''}${warn.length ? ': ' + warn[0] : ''}`);
  }
};
function ctrUsage(ctr, item) {
  let qty = 0, value = 0;
  for (const P of Object.values(S.pos)) for (const it of P.items) if (it.agmt === ctr && !it.del && (item == null || it.agmtItem === item)) { qty += it.qty; value += it.qty * it.price / it.per; }
  return { qty: r3(qty), value: r2(value) };
}
const POTABS = [['hist', 'Purchase order history'], ['status', 'Status'], ['cond', 'Conditions']];
TX.ME23N = {
  title: c => c.m.show ? `${S.pos[c.m.po]?.type === 'LP' ? 'Scheduling Agreement' : S.pos[c.m.po]?.type === 'UB' ? 'Stock Transport Order' : 'Standard PO'} ${c.m.po} Display` : 'Display Purchase Order',
  init: p => ({ po: p.po || '', show: false, sel: 0, _auto: !!p.po }),
  onOpen: c => { if (c.m._auto) TX.ME23N.enter(c); },
  tb: c => c.m.show ? [{ l: 'Other purchase order', i: '⇄', a: c => act(c => { c.m.show = false; c.m.po = ''; c.m._auto = false; }) }, ...HOOKS.poTb.flatMap(f => f(c, S.pos[c.m.po]) || [])] : [],
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
      detail = grid([{ h: 'Sh. text', f: r => r.type === 'WA' ? 'WA' : r.type === 'WE' ? 'WE' : r.mr11 ? 'Acct maint.' : r.sub ? (r.amount < 0 ? 'NB-H' : 'NB-L') : (r.qty < 0 ? 'RE-H' : 'RE-L') }, { h: 'MvT', k: 'mvt' }, { h: 'Material doc.', f: r => r.type === 'RE' ? lnk('MIR4', { inv: r.doc }, r.doc) : lnk('MIGO', { display: r.doc }, r.doc) }, { h: 'Item', f: () => '1' }, { h: 'Pstng date', f: r => fmtD(r.date) },
        { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'Amount EUR', r: 1, f: r => money(r.amount) }, { h: 'Status', f: r => { if (r.type !== 'RE') return ''; const iv = S.invoices[r.doc]; return iv?.status === 'reversed' ? '<span class="badge">Reversed</span>' : iv?.blocked ? '<span class="badge err">Blocked for payment</span>' : iv?.paid ? '<span class="badge ok">Paid</span>' : ''; } }], h, { empty: 'No PO history yet: no goods receipt or invoice posted for this item', foot });
    }
    if (t === 'status') detail = `<table class="g orgtbl"><tr><td>Item category</td><td>${ORG.itemCats[it.cat || '']}</td></tr><tr><td>Account assignment</td><td>${it.acct === 'K' ? `K Cost center ${it.cc} ${esc(ORG.costc[it.cc] || '')} · G/L ${GL[it.glk || 'GBB_VBR'][0]} ${esc(GL[it.glk || 'GBB_VBR'][1])}` : 'None (stock material)'}</td></tr><tr><td>Ordered</td><td>${qf(it.qty)} ${it.uom} · ${money(it.qty * it.price / it.per)} EUR</td></tr><tr><td>Delivered</td><td>${qf(tt.gr)} ${it.uom}</td></tr><tr><td>Still to deliver</td><td>${qf(tt.toDeliver)} ${it.uom}${it.del ? ' (item deleted)' : ''}</td></tr><tr><td>Invoiced</td><td>${qf(tt.ir)} ${it.uom} · ${money(tt.irVal)} EUR</td></tr><tr><td>GR-based invoice verification</td><td>${it.grBased ? 'Yes' : 'No'}${P.ers ? ' · ERS (evaluated receipt settlement)' : ''}</td></tr>${it.agmt ? `<tr><td>Outline agreement</td><td>${lnk('ME33K', { ctr: it.agmt }, `${it.agmt} / ${it.agmtItem}`)}</td></tr>` : ''}</table>` +
      (it.comps ? '<h4>Subcontracting components (provided to supplier)</h4>' + grid([{ h: 'Component', k: 'matnr' }, { h: 'Description', f: r => esc(S.materials[r.matnr]?.desc) }, { h: 'Requirement qty', r: 1, f: r => qf(r.qty) }, { h: 'Stock at supplier', r: 1, f: r => qf(special(`O|${r.matnr}|${it.plant}|${P.vendor}`)) }], it.comps) : '');
    if (t === 'cond') { const cd = it.conds || { gross: it.price, disc: 0, frt: 0, src: '' }; const g = cd.gross, d = r2(g * (cd.disc || 0) / 100);
      detail = it.cat === 'K' ? '<p class="muted">Consignment item: no price in the PO. Liability is created when stock is withdrawn (411 K) and settled with MRKO, at the consignment info record price.</p>' :
        `<table class="g"><tr><th>CnTy</th><th>Name</th><th class="r">Amount</th><th class="r">Condition value</th></tr><tr><td>PB00</td><td>Gross price</td><td class="r">${money(g)} EUR</td><td class="r">${money(g * it.qty)}</td></tr>${cd.disc ? `<tr><td>RA01</td><td>Discount % on gross</td><td class="r">-${qf(cd.disc)} %</td><td class="r">-${money(d * it.qty)}</td></tr>` : ''}${cd.frt ? `<tr><td>FRB1</td><td>Freight (value)</td><td class="r">${money(cd.frt)} EUR</td><td class="r">${money(cd.frt * it.qty)}</td></tr>` : ''}<tr class="tot"><td></td><td>Net value</td><td class="r">${money(it.price)} EUR</td><td class="r">${money(it.qty * it.price / it.per)}</td></tr></table><p class="small muted">Source: ${esc(cd.src || '—')}</p>`; }
    return box(`Header · ${P.type} ${P.type === 'LP' ? 'Scheduling agreement' : P.type === 'UB' ? 'Stock transport order' : 'Standard PO'} ${P.num}`, `<div class="cols"><div>${P.type === 'UB' ? `<div class="f"><label>Supplying plant</label><b>${P.splant}</b><span>${esc(ORG.plants[P.splant])}</span></div>` : `<div class="f"><label>Supplier</label><b>${P.vendor}</b><span>${esc(V?.name)}</span></div>`}<div class="f"><label>Doc. date</label><span>${fmtD(P.docDate)}</span><span></span></div></div>
      <div><div class="f"><label>Purch. org. / group</label><span>${P.porg} / ${P.pgrp}</span><span></span></div><div class="f"><label>Company code</label><span>${P.cc}</span><span></span></div></div></div>${HOOKS.poHeader.map(f => f(P) || '').join('')}`) +
      box('Item overview', grid([{ h: 'Itm', k: 'item' }, { h: 'A', f: r => r.acct || '' }, { h: 'I', f: r => r.cat || '' }, { h: 'Material', f: r => r.matnr || '—' }, { h: 'Short text', k: 'short' }, { h: 'PO qty', r: 1, f: r => qf(r.qty) }, { h: 'OUn', k: 'uom' }, { h: 'Deliv. date', f: r => fmtD(r.date) }, { h: 'Net price', r: 1, f: r => r.cat === 'K' ? '' : money(r.price) }, { h: 'Plant', k: 'plant' }, { h: 'SLoc', k: 'sloc' }, { h: 'Purch. req.', f: r => r.prRef ? lnk('ME53N', { pr: r.prRef }, r.prRef) : '' },
        { h: 'Status', f: r => { if (r.del) return '<span class="badge err">Deleted</span>'; const x = poTotals(P, r); return x.toDeliver <= 0 ? (x.toInvoice <= 0 || r.cat === 'K' ? '<span class="badge ok">Delivered & invoiced</span>' : '<span class="badge warn">To be invoiced</span>') : x.gr > 0 ? '<span class="badge warn">Partly delivered</span>' : '<span class="badge">Open</span>'; } }],
        P.items.map((r, i) => ({ ...r, _cls: i === c.m.sel ? 'on' : '' })), { click: (r, i) => `data-act="sel" data-i="${i}"` })) +
      tabs(c, POTABS) + box(`Item ${pad(it.item, 5)} [ ${it.matnr || 'text item'} ] ${esc(it.short)}`, detail);
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
const MIGO_REF = { A01: { R01: 'R01 Purchase Order', R10: 'R10 Other' }, A02: { R02: 'R02 Material Document' }, A03: { R02: 'R02 Material Document' }, A04: { R02: 'R02 Material Document' }, A07: { R10: 'R10 Other', R09: 'R09 Reservation', R01: 'R01 Purchase Order (STO)' }, A08: { R10: 'R10 Other' } };
const MIGO_MVT = { A01: ['501', '561'], A07: ['201', '551', '555', '541'], A08: ['311', '301', '321', '322', '343', '344', '411K', '542'] };
const blankOther = () => ({ matnr: '', qty: '', plant: '1010', sloc: '101A', toPlant: '', toSloc: '', cc: '', vendor: '', amount: '', reason: '' });
const isOther = m => m.ref === 'R10';
const migoBase = { A01: 'Goods Receipt', A02: 'Return Delivery', A03: 'Cancellation', A04: 'Display', A07: 'Goods Issue', A08: 'Transfer Posting' };
function migoInit(p = {}) {
  const action = p.action || (p.display ? 'A04' : 'A01');
  const m = { action, ref: p.ref || Object.keys(MIGO_REF[action])[0], doc: p.display || p.doc || '', mvt: p.mvt || (MIGO_MVT[action]?.[0] || '101'), docDate: fmtD(today()), postDate: fmtD(today()), text: '', lines: [], loaded: '', reason: '0001', _auto: !!(p.display || p.doc) };
  if (isOther(m)) { m.lines = Array.from({ length: 4 }, blankOther); m.loaded = 'OTHER'; }
  return m;
}
TX.MIGO = {
  title: c => { const m = c.m; const ref = { R01: 'Purchase Order', R02: 'Material Document', R10: 'Other', R09: 'Reservation' }[m.ref]; return `${migoBase[m.action]} ${ref}${m.loaded && !isOther(m) ? ' ' + m.loaded : ''}${m.action === 'A01' && m.ref === 'R01' && m.loaded ? ' – ' + vname(S.pos[m.loaded]?.vendor) : ''}`; },
  init: migoInit,
  onOpen: c => { if (c.m._auto) TX.MIGO.load(c); },
  onInput: (c, k) => {
    const m = c.m;
    if (k === 'action') { m.ref = Object.keys(MIGO_REF[m.action])[0]; m.mvt = MIGO_MVT[m.action]?.[0] || '101'; }
    if (k === 'action' || k === 'ref') { m.lines = []; m.loaded = ''; m.doc = ''; if (isOther(m)) { m.mvt = MIGO_MVT[m.action][0]; m.lines = Array.from({ length: 4 }, blankOther); m.loaded = 'OTHER'; } }
  },
  tb: c => [...(isOther(c.m) ? [{ l: 'Add line', i: '＋', a: c => act(c => c.m.lines.push(blankOther())) }] : [{ l: 'Execute', i: '⏵', t: 'Load document (Enter)', a: c => act(TX.MIGO.load) }]), ...(c.m.action !== 'A04' ? [{ l: 'Check', i: '✔', a: c => act(TX.MIGO.check) }, { l: 'Post', i: '💾', a: c => act(TX.MIGO.save) }] : [])],
  render: c => {
    const m = c.m;
    const docF4 = m.ref === 'R01' ? 'po' : m.ref === 'R09' ? 'res' : 'matdoc';
    const top = `<div class="box"><div class="in" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${I('action', { type: 'select', opts: { A01: 'A01 Goods Receipt', A02: 'A02 Return Delivery', A03: 'A03 Cancellation', A04: 'A04 Display', A07: 'A07 Goods Issue', A08: 'A08 Transfer Posting' }, rr: 1 })}
      ${I('ref', { type: 'select', opts: MIGO_REF[m.action], rr: 1 })}
      ${isOther(m) ? '' : I('doc', { req: 1, f4: docF4, w: 12, ph: { po: 'PO number', res: 'Reservation', matdoc: 'Mat. doc.' }[docF4] })}
      ${m.action === 'A01' && m.ref === 'R01' ? `<span class="muted">GR goods receipt</span> ${I('_m101', { ro: 1, w: 4 }).replace('value=""', 'value="101"')}` : ''}
      ${isOther(m) ? I('mvt', { type: 'select', opts: Object.fromEntries(MIGO_MVT[m.action].map(x => [x, `${x} ${MVT[x].t}`])), rr: 1 }) : ''}
      ${m.action === 'A07' && m.ref === 'R01' ? '<span class="muted">GI for stock transport order · MvT 351</span>' : ''}
      ${m.action === 'A02' ? `<span class="muted">Reason</span> ${I('reason', { type: 'select', opts: ORG.reasons })} <span class="muted">MvT 122</span>` : ''}
      ${isOther(m) ? '' : '<button type="button" class="btn sm" data-act="load">⏵ Execute</button>'}</div></div>`;
    if (!m.loaded) return top + `<div class="tip">${{ A01: 'Enter the purchase order number (F4 to search) and press <b>Enter</b>. Then tick <b>OK</b> for each line you received and <b>Post</b>. Choose <b>R10 Other</b> for receipts without a PO (501) or initial stock entry (561).', A02: 'Return goods to the supplier: enter the goods receipt material document (101) and press Enter. Movement type 122 reduces stock and the PO delivered quantity.', A03: 'Enter the material document to cancel and press Enter. The system posts the reversal movement type (102, 202, 312…).', A04: 'Enter the material document number and press Enter.', A07: 'Choose a reference: R10 Other (cost centre issue 201, scrapping 551, provide to subcontractor 541) or R09 Reservation.', A08: 'Transfer postings change the storage location or stock type without a value change, or move consignment stock to own stock (411 K).' }[m.action]}</div>`;
    if (m.action === 'A04') {
      const D = S.matDocs[m.loaded];
      return top + box(`Material document ${D.num} / ${D.year}`, `<div class="cols"><div><div class="f"><label>Movement type</label><b>${D.mvt}</b><span>${esc(mvtName(D.mvt))}</span></div><div class="f"><label>Posting date</label><span>${fmtD(D.date)}</span><span></span></div>${D.text ? `<div class="f"><label>Header text</label><span>${esc(D.text)}</span><span></span></div>` : ''}</div>
        <div><div class="f"><label>Accounting document</label>${D.acc ? lnk('FB03', { doc: D.acc }, D.acc) : '<span class="muted">None (no value change)</span>'}<span></span></div><div class="f"><label>Status</label><span>${D.reversedBy ? `Reversed by ${D.reversedBy}` : D.revOf ? `Reversal of ${D.revOf}` : 'Posted'}</span><span></span></div>${D.resRef ? `<div class="f"><label>Reservation</label><span>${D.resRef}</span><span></span></div>` : ''}${D.piRef ? `<div class="f"><label>Phys. inv. document</label><span>${D.piRef}</span><span></span></div>` : ''}</div></div>`) +
        box('Items', grid([{ h: 'Line', k: 'line' }, { h: 'MvT', f: r => r.mvt || D.mvt }, { h: 'Material', k: 'matnr' }, { h: 'Description', f: r => esc(S.materials[r.matnr]?.desc) }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'EUn', k: 'uom' }, { h: 'Plant', f: r => r.toPlant ? `${r.plant} → ${r.toPlant}` : r.plant }, { h: 'SLoc', f: r => r.toSloc ? `${r.sloc} → ${r.toSloc}` : r.sloc }, { h: 'Stock type', f: r => r.special === 'K' ? 'Consignment (K)' : r.special === 'O' ? 'Provided to supplier (O)' : ORG.stypes[r.stype] || '' },
          { h: 'Reference', f: r => r.po ? lnk('ME23N', { po: r.po }, `${r.po} ${r.poItem}`) : r.cc ? `Cost ctr ${r.cc}` : r.vendor ? `Supplier ${r.vendor}` : '' }, { h: 'Amount EUR', r: 1, f: r => money(r.amount) }], D.items));
    }
    const hdr = box('Header', `<div class="cols"><div>${F('Document date', 'docDate', { w: 10 })}${F('Posting date', 'postDate', { w: 10 })}</div><div>${F('Header text', 'text', { w: 24 })}${m.action === 'A01' && m.ref === 'R01' ? `<div class="f"><label>Supplier</label><b>${S.pos[m.loaded].vendor}</b><span>${esc(vname(S.pos[m.loaded].vendor))}</span></div>` : ''}${m.ref === 'R09' ? `<div class="f"><label>Cost center</label><b>${S.reservations[m.loaded].cc}</b><span>${esc(ORG.costc[S.reservations[m.loaded].cc] || '')}</span></div>` : ''}</div></div>`);
    if (isOther(m)) {
      const D = MVT[m.mvt];
      const cols = [{ h: 'Line', f: (r, i) => i + 1 }, { h: 'Material', f: (r, i) => I(`lines.${i}.matnr`, { f4: 'mat', w: 9 }) }, { h: 'Description', f: r => esc(S.materials[U(r.matnr)]?.desc || '') }, { h: 'Qty in UnE', f: (r, i) => I(`lines.${i}.qty`, { w: 6, num: 1 }) }, { h: 'EUn', f: r => esc(S.materials[U(r.matnr)]?.uom || '') },
        { h: 'Plant', f: (r, i) => I(`lines.${i}.plant`, { f4: 'plant', w: 4 }) }, { h: 'SLoc', f: (r, i) => I(`lines.${i}.sloc`, { f4: 'sloc', w: 4 }) }];
      if (D.toPlant) cols.push({ h: 'Recv. plant', f: (r, i) => I(`lines.${i}.toPlant`, { f4: 'plant', w: 4 }) }, { h: 'Recv. SLoc', f: (r, i) => I(`lines.${i}.toSloc`, { f4: 'sloc', w: 4 }) });
      if (D.toSloc) cols.push({ h: 'Recv. SLoc', f: (r, i) => I(`lines.${i}.toSloc`, { f4: 'sloc', w: 4 }) });
      if (D.need?.includes('cc')) cols.push({ h: 'Cost center', f: (r, i) => I(`lines.${i}.cc`, { f4: 'costc', w: 8 }) });
      if (D.need?.includes('vendor')) cols.push({ h: 'Supplier', f: (r, i) => I(`lines.${i}.vendor`, { f4: 'vendor', w: 8 }) });
      if (D.value) cols.push({ h: 'Amount EUR (opt.)', f: (r, i) => I(`lines.${i}.amount`, { w: 8, num: 1 }) });
      if (D.need?.includes('reason')) cols.push({ h: 'Reason', f: (r, i) => I(`lines.${i}.reason`, { type: 'select', opts: { '': '', ...ORG.reasons } }) });
      cols.push({ h: D.fromK ? 'Consignment stock' : D.fromO ? 'Stock at supplier' : 'Available', r: 1, f: r => r._avail == null ? '' : qf(r._avail) });
      return top + hdr + box(`Items · MvT ${m.mvt} ${esc(D.t)}`, grid(cols, m.lines)) + `<div class="tip">${{ '201': 'Goods issue to a cost centre: stock goes down and the value is expensed to the consumption account of the cost centre.', '551': 'Scrapping: stock goes down and the value is posted to the scrapping account. A reason is required.', '555': 'Scrapping from blocked stock.', '541': 'Provide components to a subcontractor: stock moves to "stock provided to supplier" (still yours and still valuated).', '311': 'Moves stock between storage locations in the same plant: no accounting document.', '301': 'Moves stock from one plant to another in one step: the value moves from the issuing plant\'s inventory to the receiving plant\'s.', '321': 'Releases stock from quality inspection to unrestricted use: no accounting document.', '322': 'Puts unrestricted stock into quality inspection.', '343': 'Releases blocked stock.', '344': 'Blocks unrestricted stock.', '411K': 'Withdraws consignment stock into your own stock: creates a liability to the supplier (settled with MRKO).', '542': 'Takes stock back from the subcontractor.', '501': 'Receipt without a purchase order: valued at the material price (or the amount you enter).', '561': 'Initial stock entry when going live: offset to the initial entry account.' }[m.mvt] || ''} Press Enter to check availability.</div>`;
    }
    const a01 = m.action === 'A01', a02 = m.action === 'A02', r09 = m.ref === 'R09', sto = m.action === 'A07' && m.ref === 'R01';
    return top + hdr + box('Items', grid([
      { h: 'OK', f: (r, i) => I(`lines.${i}.ok`, { type: 'check' }) }, { h: 'Line', f: (r, i) => i + 1 }, { h: 'Material', f: r => `${r.matnr || ''} <span class="muted">${esc(S.materials[r.matnr]?.desc || r.short || '')}</span>` },
      { h: 'Qty in UnE', f: (r, i) => a01 || a02 || r09 || sto ? I(`lines.${i}.qty`, { w: 6, num: 1 }) : qf(r.qty) }, { h: 'EUn', k: 'uom' },
      { h: 'SLoc', f: (r, i) => r.acct === 'K' ? '<span class="muted">—</span>' : a01 || r09 || sto ? I(`lines.${i}.sloc`, { f4: 'sloc', w: 4 }) : r.sloc },
      { h: 'Stock type', f: (r, i) => r.acct === 'K' ? `Consumption · cost ctr ${r.cc}` : a01 && r.cat !== 'K' ? I(`lines.${i}.stype`, { type: 'select', opts: ORG.stypes }) : r.cat === 'K' || r.special === 'K' ? 'Consignment (K)' : ORG.stypes[r.stype] || 'Unrestricted use' },
      { h: 'Plant', f: r => r.toPlant ? `${r.plant} → ${r.toPlant}` : r.plant }, { h: a01 || sto ? 'Open qty' : a02 ? 'Returnable' : r09 ? 'Open qty' : 'Reference', f: r => a01 || a02 || r09 || sto ? qf(r.open) : r.po ? `${r.po} ${r.poItem}` : '' }, { h: 'I', f: r => r.cat || '' }, { h: 'MvT', f: () => sto ? '351' : a01 ? '101' : a02 ? '122' : r09 ? S.reservations[m.loaded].mvt : ({ '101': '102', '122': '123' }[S.matDocs[m.loaded]?.mvt] || MVT[S.matDocs[m.loaded]?.mvt]?.rev || '') }
    ], m.lines)) + (a01 ? '<div class="tip">Change the quantity for a partial delivery. Choose <b>Quality inspection</b> as stock type if the goods must be checked before use (release later with 321).</div>' : m.action === 'A03' ? '<div class="warnbox">Posting creates a reversal document and undoes the stock (and value) change.</div>' : '');
  },
  acts: { load: c => TX.MIGO.load(c) },
  enter: c => {
    const m = c.m;
    if (isOther(m)) { TX.MIGO.otherItems(c, true); return; }
    if (!m.loaded || m.loaded !== String(m.doc).trim()) TX.MIGO.load(c);
  },
  load: c => {
    const m = c.m; if (isOther(m)) return;
    m.doc = String(m.doc).trim(); m.lines = []; m.loaded = '';
    if (!m.doc) err('Fill in all required entry fields', null, 'doc');
    if (m.action === 'A07' && m.ref === 'R01') {
      const P = S.pos[m.doc]; if (!P) err(`Purchase order ${m.doc} does not exist`, null, 'doc');
      if (P.type !== 'UB') err(`Purchase order ${m.doc} is not a stock transport order: a goods issue with reference to a PO is only possible for STOs (order type UB)`, 'NOT_STO', 'doc');
      HOOKS.grCheck.forEach(f => f(P));
      m.lines = P.items.map(it => ({ it, t: poTotals(P, it) })).filter(x => x.t.toIssue > 0).map(({ it, t }) => ({ item: it.item, matnr: it.matnr, qty: String(t.toIssue), open: t.toIssue, uom: it.uom, sloc: (ORG.plantSlocs[P.splant] || ['101A'])[0], plant: P.splant, toPlant: it.plant, stype: 'unr', ok: false }));
      if (!m.lines.length) err(`Document ${m.doc} does not contain any selectable items`, 'NO_ITEMS', 'doc');
      m.loaded = m.doc; return;
    }
    if (m.action === 'A01') {
      const P = S.pos[m.doc];
      if (!P) err(`Purchase order ${m.doc} does not exist`, null, 'doc');
      HOOKS.grCheck.forEach(f => f(P));
      if (P.items.some(it => it.cat === 'D' && poTotals(P, it).toDeliver > 0) && !P.items.some(it => it.cat !== 'D' && poTotals(P, it).toDeliver > 0)) err(`Purchase order ${P.num} contains only service items: enter a service entry sheet (ML81N) instead of a goods receipt`, 'USE_ML81N', 'doc');
      m.lines = P.items.map(it => ({ it, t: poTotals(P, it) })).filter(x => x.t.toDeliver > 0 && x.it.cat !== 'D').map(({ it, t }) => ({ item: it.item, matnr: it.matnr, short: it.short, acct: it.acct, cc: it.cc, cat: it.cat, qty: String(t.toDeliver), open: t.toDeliver, uom: it.uom, sloc: it.sloc, plant: it.plant, stype: 'unr', ok: false }));
      if (!m.lines.length) err(`Document ${m.doc} does not contain any selectable items`, 'NO_ITEMS', 'doc');
      m.loaded = m.doc; emit('GR_LOADED', { po: m.doc });
      return;
    }
    if (m.ref === 'R09') {
      const R = S.reservations[m.doc];
      if (!R) err(`Reservation ${m.doc} does not exist`, null, 'doc');
      m.lines = R.items.filter(x => x.qty - x.wd > 0 && !x.final).map(x => ({ item: x.item, matnr: x.matnr, qty: String(r3(x.qty - x.wd)), open: r3(x.qty - x.wd), uom: S.materials[x.matnr].uom, sloc: x.sloc, plant: x.plant, stype: 'unr', ok: false }));
      if (!m.lines.length) err(`Reservation ${m.doc} has no open items (already withdrawn)`, 'NO_ITEMS', 'doc');
      m.loaded = m.doc; return;
    }
    const D = S.matDocs[m.doc];
    if (!D) err(`Material document ${m.doc} does not exist`, null, 'doc');
    if (m.action === 'A02') {
      if (D.mvt !== '101') err(`Material document ${m.doc} is not a goods receipt for a purchase order (movement type 101)`, null, 'doc');
      if (D.reversedBy) err(`Material document ${m.doc} has been cancelled`, null, 'doc');
      const P = S.pos[D.po || D.items[0].po];
      m.lines = D.items.filter(x => x.special !== 'O').map(x => { const it = P.items.find(i => i.item === x.poItem); const ret = Math.min(x.qty, poTotals(P, it).gr); return { ...x, cat: it.cat, open: ret, qty: String(ret), ok: false }; }).filter(x => x.open > 0);
      if (!m.lines.length) err(`Nothing left to return for material document ${m.doc}`, null, 'doc');
    }
    if (m.action === 'A03') {
      if (D.revOf) err(`Material document ${m.doc} is a reversal document and cannot be cancelled`, null, 'doc');
      if (D.reversedBy) err(`Material document ${m.doc} has already been cancelled (by ${D.reversedBy})`, null, 'doc');
      if (!['101', '122'].includes(D.mvt) && !MVT[D.mvt]) err(`Movement type ${D.mvt} cannot be cancelled here`, null, 'doc');
      if (D.piRef) err(`Material document ${m.doc} comes from physical inventory: cancel is not allowed, count again instead`, null, 'doc');
      m.lines = D.items.filter(x => x.special !== 'O').map(x => ({ ...x, ok: true }));
    }
    m.loaded = m.doc;
    if (m.action === 'A04') emit('MD_DISPLAY', { md: m.doc });
  },
  otherItems: (c, soft) => {
    const m = c.m, D = MVT[m.mvt];
    const out = [];
    m.lines.forEach((l, i) => {
      const k = `lines.${i}.`;
      if (!String(l.matnr).trim()) return;
      l.matnr = U(l.matnr); l.sloc = U(l.sloc); l.toSloc = U(l.toSloc); l.vendor = String(l.vendor || '').trim(); l.cc = String(l.cc || '').trim();
      l.plant = String(l.plant || '1010').trim(); l.toPlant = String(l.toPlant || '').trim();
      const M = needMat(l.matnr, l.plant, k + 'matnr');
      if (!slocOk(l.plant, l.sloc)) err(`Storage location ${l.sloc || '(empty)'} does not exist in plant ${l.plant}`, null, k + 'sloc');
      l._avail = D.fromK ? special(`K|${l.matnr}|${l.plant}|${l.sloc}|${l.vendor}`) : D.fromO ? special(`O|${l.matnr}|${l.plant}|${l.vendor}`) : D.from ? (S.stock[stockKey(l.matnr, l.plant, l.sloc)] || {})[D.from] || 0 : (S.stock[stockKey(l.matnr, l.plant, l.sloc)] || {}).unr || 0;
      if (soft) return;
      const q = N(l.qty); if (!(q > 0)) err(`Line ${i + 1}: enter a quantity`, null, k + 'qty');
      if (D.toPlant) { if (!ORG.plants[l.toPlant] || l.toPlant === l.plant) err(`Line ${i + 1}: enter a receiving plant different from ${l.plant}`, null, k + 'toPlant'); needMat(l.matnr, l.toPlant, k + 'toPlant'); if (!slocOk(l.toPlant, l.toSloc)) err(`Line ${i + 1}: enter a receiving storage location of plant ${l.toPlant}`, null, k + 'toSloc'); }
      if (D.toSloc) { if (!ORG.slocs[l.toSloc]) err(`Line ${i + 1}: enter a receiving storage location`, null, k + 'toSloc'); if (l.toSloc === l.sloc) err(`Line ${i + 1}: receiving storage location must differ from issuing`, null, k + 'toSloc'); }
      if (D.need?.includes('cc') && !ORG.costc[l.cc]) err(l.cc ? `Cost center ${l.cc} does not exist` : `Line ${i + 1}: enter a cost center (account assignment)`, 'NO_CC', k + 'cc');
      if (D.need?.includes('vendor')) needVendor(l.vendor, null, k + 'vendor');
      if (D.need?.includes('reason') && !l.reason) err(`Line ${i + 1}: enter a reason for movement`, null, k + 'reason');
      if (m.mvt === '561' || m.mvt === '501') { if (!plantData(l.matnr, '1010').price && !(N(l.amount) > 0)) err(`Line ${i + 1}: material ${l.matnr} has no price: enter an amount`, null, k + 'amount'); }
      out.push({ matnr: l.matnr, plant: l.plant, sloc: l.sloc, toPlant: l.toPlant, toSloc: l.toSloc, qty: q, cc: l.cc, vendor: l.vendor, amount: l.amount, reason: l.reason, _M: M });
    });
    if (!soft && !out.length) err('Enter at least one item', null, 'lines.0.matnr');
    return out;
  },
  check: c => { TX.MIGO.prepare(c); msg('S', 'Document is O.K.'); },
  prepare: c => {
    const m = c.m;
    if (!m.loaded) err('Enter a document and press Enter first', null, 'doc');
    const date = needDate(c, 'postDate');
    if (date > today()) err('Posting date is in the future', null, 'postDate');
    if (isOther(m)) {
      const items = TX.MIGO.otherItems(c, false);
      planMvt({ mvt: m.mvt, items });
      return () => { const md = postMvt({ mvt: m.mvt, date, text: m.text, items }); emit('MVT_POSTED', { md, mvt: m.mvt, items: items.map(x => ({ matnr: x.matnr, qty: x.qty, cc: x.cc, vendor: x.vendor, toSloc: x.toSloc })) }); return [md, `Material document ${md} posted`]; };
    }
    const sel = m.lines.map((l, i) => ({ l, i })).filter(x => x.l.ok);
    if (!sel.length) err('No item selected: tick "OK" for each line to post', 'NOT_OK', 'lines.0.ok');
    if (m.ref === 'R09') {
      const R = S.reservations[m.loaded];
      const items = sel.map(({ l, i }) => { const q = N(l.qty); if (!(q > 0)) err(`Line ${i + 1}: enter a quantity`, null, `lines.${i}.qty`); if (q > l.open + 1e-9) err(`Line ${i + 1}: quantity exceeds open reservation quantity ${qf(l.open)}`, null, `lines.${i}.qty`); l.sloc = U(l.sloc); return { matnr: l.matnr, plant: l.plant, sloc: l.sloc, qty: q, cc: R.cc, item: l.item }; });
      planMvt({ mvt: R.mvt, items });
      return () => { const md = postMvt({ mvt: R.mvt, date, text: m.text, items, resRef: R.num }); items.forEach(x => { const ri = R.items.find(r => r.item === x.item); ri.wd = r3(ri.wd + x.qty); }); emit('MVT_POSTED', { md, mvt: R.mvt, res: R.num, items: items.map(x => ({ matnr: x.matnr, qty: x.qty, cc: R.cc })) }); return [md, `Material document ${md} posted`]; };
    }
    if (m.action === 'A07' && m.ref === 'R01') {
      const P = S.pos[m.loaded];
      const lines = sel.map(({ l, i }) => { const q = N(l.qty); if (!(q > 0)) err(`Line ${i + 1}: enter a quantity`, null, `lines.${i}.qty`); if (q > l.open + 1e-9) err(`Line ${i + 1}: quantity exceeds the quantity still to be issued ${qf(l.open)}`, null, `lines.${i}.qty`); l.sloc = U(l.sloc); if (!slocOk(P.splant, l.sloc)) err(`Storage location ${l.sloc} does not exist in plant ${P.splant}`, null, `lines.${i}.sloc`); (HOOKS.stockCheck || []).forEach(f => f(l.matnr, P.splant, l.sloc)); const have = (S.stock[stockKey(l.matnr, P.splant, l.sloc)] || {}).unr || 0; if (have + 1e-9 < q) err(`Deficit of Unrestricted use stock : ${l.matnr} ${P.splant} ${l.sloc} (${qf(r3(q - have))} ${l.uom} short)`, 'DEFICIT', `lines.${i}.qty`); return { item: l.item, qty: q, sloc: l.sloc }; });
      return () => { const md = postSTOGI({ po: P.num, lines, date, text: m.text }); emit('STO_GI', { po: P.num, md, qty: sum(lines, x => x.qty) }); return [md, `Material document ${md} posted (goods issue 351: stock in transit to plant ${P.items[0].plant})`]; };
    }
    if (m.action === 'A01') {
      const P = S.pos[m.loaded]; const tol = S.cfg.overTol || 0;
      const lines = sel.map(({ l, i }) => {
        const q = N(l.qty);
        if (!(q > 0)) err(`Line ${i + 1}: enter a quantity`, null, `lines.${i}.qty`);
        if (q > l.open * (1 + tol / 100) + 1e-9) err(`PO quantity exceeded by ${qf(r3(q - l.open))} ${l.uom} : ${l.matnr} ${P.num} ${pad(l.item, 5)}`, 'QTY_EXCEEDED', `lines.${i}.qty`);
        if (l.acct !== 'K') { l.sloc = U(l.sloc); if (!ORG.slocs[l.sloc]) err(`Storage location ${l.sloc || '(empty)'} does not exist`, null, `lines.${i}.sloc`); (HOOKS.stockCheck || []).forEach(f => f(l.matnr, l.plant, l.sloc)); }
        const it = P.items.find(x => x.item === l.item);
        if (P.type === 'UB') { if (!slocOk(it.plant, l.sloc)) err(`Storage location ${l.sloc} does not exist in receiving plant ${it.plant}`, null, `lines.${i}.sloc`); const tr = special(`T|${it.matnr}|${it.plant}`); if (tr + 1e-9 < q) err(`Not enough stock in transit for ${it.matnr} in plant ${it.plant} (${qf(tr)} ${it.uom}): post the goods issue (MIGO A07 / R01, movement type 351) in plant ${P.splant} first`, 'NO_TRANSIT', `lines.${i}.qty`); }
        if (it.cat === 'L') for (const cp of it.comps || []) { const need = r3(cp.qty * q / it.qty), have = special(`O|${cp.matnr}|${it.plant}|${P.vendor}`); if (have + 1e-9 < need) err(`Deficit of stock provided to supplier ${P.vendor} : ${cp.matnr} ${it.plant} (${qf(r3(need - have))} ${S.materials[cp.matnr].uom} short). Provide components first (MIGO A07, 541).`, 'NO_O_STOCK', `lines.${i}.qty`); }
        return { item: l.item, qty: q, sloc: l.sloc, stype: it.cat === 'K' ? 'K' : l.stype };
      });
      return () => { const md = postGR({ po: m.loaded, lines, date, text: m.text }); const po = m.loaded; emit('GR_POSTED', { po, md, items: lines.map(x => ({ item: x.item, qty: x.qty, stype: x.stype })), complete: S.pos[po].items.every(i => poTotals(S.pos[po], i).toDeliver <= 0) }); return [md, `Material document ${md} posted`]; };
    }
    const D = S.matDocs[m.loaded];
    if (m.action === 'A02') {
      const P = S.pos[D.po || D.items[0].po];
      const lines = sel.map(({ l, i }) => {
        const q = N(l.qty); if (!(q > 0)) err(`Line ${i + 1}: enter a quantity`, null, `lines.${i}.qty`);
        if (q > l.open + 1e-9) err(`Line ${i + 1}: you can return at most ${qf(l.open)} ${l.uom}`, null, `lines.${i}.qty`);
        if (l.acct !== 'K') (HOOKS.stockCheck || []).forEach(f => f(l.matnr, l.plant, l.sloc));
        const have = l.acct === 'K' ? Infinity : l.cat === 'K' ? special(`K|${l.matnr}|${l.plant}|${l.sloc}|${P.vendor}`) : (S.stock[stockKey(l.matnr, l.plant, l.sloc)] || {})[l.stype] || 0;
        if (have + 1e-9 < q) err(`Deficit of ${ORG.stypes[l.stype] || 'consignment'} stock : ${l.matnr} ${l.plant} ${l.sloc} (${qf(r3(q - have))} ${l.uom} short)`, 'DEFICIT', `lines.${i}.qty`);
        return { item: l.poItem, qty: q, sloc: l.sloc, stype: l.stype };
      });
      return () => { const md = postGR({ po: P.num, mvt: '122', lines, date, text: m.text, reason: m.reason }); emit('GR_RETURN', { md, po: P.num, qty: sum(lines, x => x.qty) }); return [md, `Material document ${md} posted (return delivery, reason ${m.reason} ${ORG.reasons[m.reason]})`]; };
    }
    // A03 cancellation
    if (D.mvt === '101' || D.mvt === '122') {
      const P = S.pos[D.po || D.items[0].po]; const sign = D.mvt === '101' ? 1 : -1;
      for (const x of D.items.filter(y => y.special !== 'O')) {
        const it = P.items.find(i => i.item === x.poItem);
        if (sign > 0) {
          const have = it.acct === 'K' ? Infinity : it.cat === 'K' ? special(`K|${x.matnr}|${x.plant}|${x.sloc}|${P.vendor}`) : getStock(x.matnr, x.plant, x.sloc)[x.stype];
          if (have < x.qty - 1e-9) err(`Deficit of ${it.cat === 'K' ? 'consignment' : ORG.stypes[x.stype]} stock ${qf(r3(x.qty - have))} ${x.uom} : ${x.matnr} ${x.plant} ${x.sloc}`, 'DEFICIT');
          const t = poTotals(P, it);
          if (it.cat !== 'K' && t.gr - x.qty < t.ir - 1e-9) err(`Cannot cancel: ${qf(t.ir)} ${x.uom} already invoiced for PO ${P.num} ${pad(it.item, 5)}. Cancel the invoice first (MR8M) or post a return delivery (122).`, 'INVOICED');
        }
      }
      return () => { const md = postGR({ po: P.num, mvt: sign > 0 ? '102' : '123', revOf: D.num, date, lines: D.items.filter(y => y.special !== 'O').map(x => ({ item: x.poItem, qty: x.qty, sloc: x.sloc, stype: x.stype === 'K' ? 'K' : x.stype })) }); emit('GR_REVERSED', { md, of: D.num, po: P.num }); return [md, `Material document ${md} posted (reversal of ${D.num})`]; };
    }
    const negCheck = D.deltas.map(d => ({ ...d, q: -d.q })); checkDeltas(negCheck);
    return () => { const md = reverseMvt(D, date); emit('MVT_REVERSED', { md, of: D.num, mvt: D.mvt }); return [md, `Material document ${md} posted (reversal of ${D.num})`]; };
  },
  save: c => {
    const m = c.m;
    if (m.action === 'A04') return;
    const commit = TX.MIGO.prepare(c);
    const [, text] = commit();
    const keep = { action: m.action, ref: m.ref, mvt: m.mvt };
    c.m = migoInit(keep); msg('S', text);
  },
  back: c => { if (c.m.loaded && !isOther(c.m) && !c.m._auto) { c.m.loaded = ''; c.m.lines = []; return true; } }
};
TX.MB03 = { ...TX.MIGO, init: p => migoInit({ action: 'A04', display: p.display || '' }) };
TX.MBRL = { ...TX.MIGO, init: p => migoInit({ action: 'A02', doc: p.doc || '' }) };
TX.MIGO_TR = { ...TX.MIGO, init: p => migoInit({ action: 'A08', ref: 'R10' }) };
TX.MIGO_GI = { ...TX.MIGO, init: p => migoInit({ action: 'A07', ref: 'R10' }) };

// ---------------- MIRO / MIR7 / MIR4: Invoice verification ----------------
function miroCalc(m) {
  const items = m.items.filter(x => x.sel);
  const net = r2(sum(items, x => N(x.amount) || 0));
  const udc = r2(N(m.udc) || 0);
  const rate = ORG.tax[U(m.tax)]?.[1] ?? 0;
  const tax = m.calc ? r2((net + udc) * rate) : r2(N(m.taxAmt) || 0);
  const bal = r2((N(m.gross) || 0) - net - udc - tax);
  return { net, udc, tax, bal, items };
}
function miroInit(p = {}) {
  const m = { tx: '1', date: fmtD(today()), post: fmtD(today()), ref: '', gross: '', tax: 'V1', calc: true, taxAmt: '', udc: '', po: '', loaded: '', items: [], park: !!p.park, parkId: '' };
  if (p.parked && S.invoices[p.parked]) { const D = S.invoices[p.parked]; Object.assign(m, { tx: D.cm ? '2' : '1', date: fmtD(D.date), ref: D.ref, gross: D.gross.toFixed(2), tax: D.taxCode, udc: D.udc ? D.udc.toFixed(2) : '', po: D.po, parkId: D.num, park: false, _items: D.items }); }
  return m;
}
TX.MIRO = {
  title: c => `${c.m.park ? 'Park' : 'Enter'} Incoming ${({ 2: 'Credit Memo', 3: 'Subsequent Debit', 4: 'Subsequent Credit' })[c.m.tx] || 'Invoice'}: Company Code 1010${c.m.parkId ? ` · parked document ${c.m.parkId}` : ''}`,
  init: miroInit,
  onOpen: c => { if (c.m.parkId) { TX.MIRO.enter(c); const saved = c.m._items || []; c.m.items.forEach(x => { const s = saved.find(y => y.item === x.item); if (s) { x.qty = String(s.qty); x.amount = r2(s.amount).toFixed(2); } else x.sel = false; }); } },
  onInput: (c, k) => { if (k === 'tx') { c.m.loaded = ''; c.m.items = []; } },
  tb: c => [{ l: 'Simulate', i: '🔍', a: c => act(TX.MIRO.simulate) }, ...(c.m.park ? [{ l: 'Save as parked', i: '📝', a: c => act(TX.MIRO.parkSave) }] : [{ l: 'Post', i: '💾', a: c => act(TX.MIRO.save) }, { l: 'Park', i: '📝', a: c => act(TX.MIRO.parkSave) }])],
  render: c => {
    const m = c.m, k = miroCalc(m), P = S.pos[m.loaded];
    const light = !m.loaded ? 'n' : k.bal === 0 && k.items.length ? 'g' : 'r';
    return `<div class="balance"><span class="light ${light}"></span>Balance <span class="amt">${money(k.bal)} EUR</span><span class="muted small">· Net ${money(k.net)}${k.udc ? ` · Unpl. del. costs ${money(k.udc)}` : ''} · Tax ${money(k.tax)}${P ? ` · Supplier ${P.vendor} ${esc(vname(P.vendor))}` : ''}</span></div>` +
      `<div class="cols">${box('Basic data', F('Transaction', 'tx', { type: 'select', opts: { 1: 'Invoice', 2: 'Credit memo', 3: 'Subsequent debit', 4: 'Subsequent credit' }, rr: 1 }) + F('Invoice date', 'date', { req: 1, w: 10 }) + F('Reference', 'ref', { req: 1, w: 16, ph: "Supplier's invoice no." }) + F('Posting date', 'post', { w: 10 }) +
        F('Amount (gross)', 'gross', { req: 1, w: 12, num: 1, desc: 'EUR' }) + F('Tax code', 'tax', { f4: 'tax', w: 4, desc: ORG.tax[U(m.tax)]?.[0] || '' }) + F('Calculate tax', 'calc', { type: 'check', rr: 1 }) + (m.calc ? '' : F('Tax amount', 'taxAmt', { w: 12, num: 1 })) + F('Unpl. del. costs', 'udc', { w: 10, num: 1, desc: 'EUR (optional)' }))}
      ${box('PO reference', F('Purchase order', 'po', { req: 1, f4: 'po', w: 12 }) + `<div class="tip">${m.tx === '3' || m.tx === '4' ? 'Subsequent debit/credit: an extra charge (or refund) on goods already invoiced, e.g. a price increase or freight billed later. Type only the amount: the quantity does not change, GR/IR is not touched, the amount goes to stock (if still there and price control V) or to price differences.' : m.tx === '2' ? 'Credit memo: items are proposed from the quantities already invoiced. The supplier credits you: the GR/IR and VAT entries are reversed.' : 'Enter the PO and press <b>Enter</b>: items are proposed from the goods receipts not yet invoiced (GR-based IV). Then type the supplier\'s gross amount and press <b>Enter</b> until the balance is <b>0.00</b> (green light). <b>Park</b> saves the invoice without posting it.'}</div>`)}</div>` +
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
      if (P.type === 'UB') err(`Purchase order ${m.po} is a stock transport order within the company code: there is no supplier invoice`, 'STO_NO_IV', 'po');
      const cm = m.tx === '2', sub = m.tx === '3' || m.tx === '4';
      const items = P.items.filter(it => it.cat !== 'K').map(it => ({ it, t: poTotals(P, it) })).filter(x => cm || sub ? x.t.ir > 0 : x.t.toInvoice > 0)
        .map(({ it, t }) => { const q = cm || sub ? t.ir : t.toInvoice; return { item: it.item, qty: String(q), amount: sub ? '0.00' : (cm ? r2(t.irVal) : r2(q * it.price / it.per)).toFixed(2), uom: it.uom, matnr: it.matnr, short: it.short, unit: it.price / it.per, sel: true }; });
      if (!items.length) err(cm || sub ? `Nothing invoiced yet for purchase order ${m.po}: no credit memo possible` : `No suitable purchase order history entry found for invoice receipt (PO ${m.po}: post the goods receipt first)`, cm ? 'NO_IR' : 'NO_GR', 'po');
      m.items = items; m.loaded = m.po;
      emit('IR_LOADED', { po: m.po });
    }
    if (!ORG.tax[U(m.tax)]) err(`Tax code ${m.tax} does not exist`, null, 'tax');
    m.items.forEach(x => { x.amount = (N(x.amount) || 0).toFixed(2); });
    const k = miroCalc(m);
    if (m.loaded && N(m.gross) && k.bal !== 0) msg('W', `Balance is not zero: ${money(k.bal)} EUR`);
  },
  validate: (c, parking) => {
    const m = c.m;
    TX.MIRO.enter(c);
    req(c, parking ? ['date', 'po'] : ['date', 'ref', 'gross', 'po']);
    const d = needDate(c, 'date'); const pd = needDate(c, 'post');
    if (!m.loaded) err('Enter the purchase order and press Enter', null, 'po');
    const k = miroCalc(m), P = S.pos[m.loaded];
    if (!k.items.length) err('Select at least one item', null, 'items.0.sel');
    k.items.forEach(x => {
      const i = m.items.indexOf(x);
      if (!(N(x.qty) > 0)) err(`Item ${x.item}: enter a quantity`, null, `items.${i}.qty`);
      if (!(N(x.amount) > 0)) err(`Item ${x.item}: enter an amount`, null, `items.${i}.amount`);
      if (m.tx === '2') { const t = poTotals(P, P.items.find(y => y.item === x.item)); if (N(x.qty) > t.ir + 1e-9) err(`Item ${x.item}: credit memo quantity ${qf(N(x.qty))} exceeds invoiced quantity ${qf(t.ir)}`, null, `items.${i}.qty`); }
    });
    if (!parking && k.bal !== 0) err(`Balance is not zero: ${money(k.bal)} EUR. The gross amount must equal items + delivery costs + tax.`, 'BALANCE', 'gross');
    return { po: m.loaded, date: pd, docDate: d, ref: m.ref.trim(), gross: N(m.gross) || 0, taxCode: U(m.tax), tax: k.tax, udc: k.udc, cm: m.tx === '2', sub: m.tx === '3' ? 'D' : m.tx === '4' ? 'C' : '', items: k.items.map(x => ({ item: x.item, qty: N(x.qty), amount: N(x.amount) })) };
  },
  simulate: c => {
    const v = TX.MIRO.validate(c);
    const r = computeIR(v);
    modal('Simulate document', grid([{ h: 'Pos.', f: (x, i) => i + 1 }, { h: 'PK', k: 'pk' }, { h: 'G/L / supplier', f: x => x.vendor ? `${x.vendor} ${esc(vname(x.vendor))}` : `${x.gl} ${esc(x.text)}` }, { h: 'D/C', f: x => x.dc === 'D' ? 'Debit' : 'Credit' }, { h: 'Amount EUR', r: 1, f: x => (x.dc === 'C' ? '-' : '') + money(x.amt) }], r.acc) +
      (r.blocked ? `<div class="warnbox"><b>Invoice will be blocked for payment:</b><br>${r.reasons.map(esc).join('<br>')}</div>` : '<div class="tip">No variances outside tolerance: the invoice will be free for payment.</div>'), [{ l: 'Close' }, { l: 'Post', pri: 1, a: () => act(TX.MIRO.save) }]);
    msg('S', 'Simulation: document balances to zero');
  },
  parkSave: c => {
    const v = TX.MIRO.validate(c, true); const m = c.m;
    const num = m.parkId || nextNo('inv');
    S.invoices[num] = { num, year: v.date.slice(0, 4), date: v.date, ref: v.ref, po: v.po, vendor: S.pos[v.po].vendor, gross: r2(v.gross), taxCode: v.taxCode, tax: v.tax, udc: v.udc, cm: v.cm, items: v.items, blocked: false, reasons: [], acc: '', status: 'parked', paid: null };
    emit('IR_PARKED', { inv: num, po: v.po });
    c.m = miroInit({ park: m.park }); msg('S', `Document ${num} was parked`);
  },
  save: c => {
    const v = TX.MIRO.validate(c);
    const inv = postIR({ ...v, num: c.m.parkId || '' }); const I_ = S.invoices[inv];
    emit('IR_POSTED', { inv, po: v.po, blocked: I_.blocked, qty: sum(v.items, x => x.qty), cm: v.cm, sub: v.sub, fromPark: !!c.m.parkId, udc: v.udc });
    c.m = miroInit();
    msg(I_.blocked ? 'W' : 'S', I_.blocked ? `Document no. ${inv} created: blocked for payment (${I_.reasons.length} variance${I_.reasons.length > 1 ? 's' : ''}, release with MRBR)` : `Document no. ${inv} created`);
  }
};
TX.MIR7 = { ...TX.MIRO, init: p => miroInit({ ...p, park: !p.parked }) };
const invStatus = D => D.status === 'parked' ? '<span class="badge warn">Parked (not posted)</span>' : D.status === 'reversed' ? `<span class="badge">Reversed by ${D.revBy || ''}</span>` : D.blocked ? '<span class="badge err">Blocked for payment (R)</span>' : D.paid ? `<span class="badge ok">Paid ${fmtD(D.paid)}</span>` : D.released ? `<span class="badge ok">Released ${fmtD(D.released)}</span>` : '<span class="badge ok">Free for payment</span>';
TX.MIR4 = {
  title: c => c.m.show ? `Display ${S.invoices[c.m.inv]?.cm ? 'Credit Memo' : 'Invoice'} Document ${c.m.inv} ${S.invoices[c.m.inv]?.year || ''}` : 'Display Invoice Document',
  init: p => ({ inv: p.inv || '', show: false, _auto: !!p.inv }),
  onOpen: c => { if (c.m._auto) TX.MIR4.enter(c); },
  tb: c => { const D = c.m.show && S.invoices[c.m.inv]; return D && D.status === 'parked' ? [{ l: 'Edit / post parked document', i: '✎', a: c => call('MIRO', { parked: D.num }, true) }] : D && D.status === 'posted' ? [{ l: 'Cancel (MR8M)', i: '↶', a: c => call('MR8M', { inv: D.num }, true) }] : []; },
  render: c => {
    if (!c.m.show) return box('Invoice document', F('Invoice document no.', 'inv', { req: 1, f4: 'inv', w: 12 }) + F('Fiscal year', '_y', { ro: 1, w: 5, desc: String(new Date().getFullYear()) }));
    const D = S.invoices[c.m.inv];
    return box(`${D.cm ? 'Credit memo' : 'Invoice'} ${D.num} / ${D.year}`, `<table class="g orgtbl"><tr><td>Supplier</td><td>${D.vendor} ${esc(vname(D.vendor))}</td></tr><tr><td>Reference</td><td>${esc(D.ref)}</td></tr><tr><td>Posting date</td><td>${fmtD(D.date)}</td></tr><tr><td>Gross amount</td><td>${money(D.gross)} EUR (tax ${D.taxCode}: ${money(D.tax)}${D.udc ? `; unplanned delivery costs ${money(D.udc)}` : ''})</td></tr>
      <tr><td>Purchase order</td><td>${D.po ? lnk('ME23N', { po: D.po }, D.po) : 'None (consignment settlement MRKO)'}</td></tr><tr><td>Accounting document</td><td>${D.acc ? lnk('FB03', { doc: D.acc }, D.acc) : '—'}${D.revAcc ? ` · reversal ${lnk('FB03', { doc: D.revAcc }, D.revAcc)}` : ''}</td></tr>
      <tr><td>Status</td><td>${invStatus(D)}</td></tr></table>${D.reasons?.length ? `<div class="warnbox">${D.reasons.map(esc).join('<br>')}</div>` : ''}`) +
      box('PO reference', grid([{ h: 'Item', k: 'item' }, { h: 'Material', f: r => r.matnr || S.pos[D.po]?.items.find(i => i.item === r.item)?.matnr }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'Amount EUR', r: 1, f: r => money(r.amount) }], D.items));
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
    const rows = Object.values(S.invoices).filter(i => i.blocked && i.status === 'posted');
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
  init: p => ({ matnr: p.matnr || '', plant: '', list: false, _auto: !!p.matnr }),
  onOpen: c => { if (c.m._auto) TX.MMBE.exec(c); },
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MMBE.exec) }],
  render: c => {
    if (!c.m.list) return box('Database selections', F('Material', 'matnr', { req: 1, f4: 'mat', w: 18 }) + F('Plant', 'plant', { f4: 'plant', w: 6, desc: 'empty = all plants' })) + '<div class="tip">Press <b>F8</b> or <b>Enter</b> to execute.</div>';
    const M = S.materials[c.m.matnr];
    const plants = Object.keys(M.plants).filter(p => !c.m.plant || p === c.m.plant);
    const row = (l, x, cls, ord = '', rs = '') => `<tr class="${cls}"><td>${l}</td><td class="r">${qf(x.unr)}</td><td class="r">${qf(x.qi)}</td><td class="r">${qf(x.blk)}</td><td class="r">${qf(x.tr || 0)}</td><td class="r">${ord}</td><td class="r">${rs}</td></tr>`;
    const data = plants.map(p => {
      const sl = (ORG.plantSlocs[p] || []).filter(s => S.stock[stockKey(M.matnr, p, s)]).map(s => ({ s, ...S.stock[stockKey(M.matnr, p, s)] }));
      const tr = special(`T|${M.matnr}|${p}`);
      const t = { unr: sum(sl, x => x.unr), qi: sum(sl, x => x.qi), blk: sum(sl, x => x.blk), tr };
      const oo = onOrder(M.matnr, p);
      const resv = sum(Object.values(S.reservations).flatMap(r => r.items).filter(i => i.matnr === M.matnr && i.plant === p && !i.final), i => Math.max(0, i.qty - i.wd));
      return { p, sl, t, oo, resv, K: specialList('K', M.matnr, p), O: specialList('O', M.matnr, p), pd: M.plants[p] };
    });
    const tot = { unr: sum(data, d => d.t.unr), qi: sum(data, d => d.t.qi), blk: sum(data, d => d.t.blk), tr: sum(data, d => d.t.tr) };
    return box(`Material ${M.matnr} ${esc(M.desc)} · Base unit ${M.uom}`,
      `<div class="tw"><table class="g"><tr><th>Client / company code / plant / storage location / special stock</th><th class="r">Unrestricted use</th><th class="r">Qual. inspection</th><th class="r">Blocked</th><th class="r">In transit</th><th class="r">On-order stock</th><th class="r">Reserved</th></tr>
      ${row('Full', tot, 'tot', qf(sum(data, d => d.oo)), qf(sum(data, d => d.resv)))}${row('1010 Riviera Trading SAS', tot, 'lvl1', qf(sum(data, d => d.oo)), qf(sum(data, d => d.resv)))}
      ${data.map(d => row(`${d.p} ${esc(ORG.plants[d.p])} · ${d.pd.ctrl === 'S' ? 'standard' : 'moving'} price ${money(d.pd.price)}`, d.t, 'lvl2', qf(d.oo), qf(d.resv)) + d.sl.map(x => row(`${x.s} ${esc(ORG.slocs[x.s])}`, x, 'lvl3')).join('') +
        (d.t.tr ? row(`Stock in transit (stock transport order)`, { unr: 0, qi: 0, blk: 0, tr: d.t.tr }, 'lvl3') : '') +
        d.K.map(k => row(`${k.sloc} · Consignment (K) – supplier ${k.vendor} ${esc(vname(k.vendor))}`, { unr: k.q, qi: 0, blk: 0 }, 'lvl3')).join('') +
        d.O.map(o => row(`Stock provided to supplier (O) – ${o.vendor} ${esc(vname(o.vendor))}`, { unr: o.q, qi: 0, blk: 0 }, 'lvl3')).join('')).join('')}</table></div>
      <div class="tip"><b>On-order stock</b> = quantity in open purchase orders not yet received. <b>In transit</b> = issued by the supplying plant (351) but not yet received by this plant: it is valuated in the receiving plant. <b>Consignment (K)</b> stock belongs to the supplier until you withdraw it (411 K). <b>Stock provided to supplier (O)</b> is your own, valuated stock at a subcontractor.</div>`);
  },
  enter: c => TX.MMBE.exec(c),
  exec: c => { if (c.m.list) return; req(c, ['matnr']); c.m.matnr = U(c.m.matnr); c.m.plant = String(c.m.plant || '').trim(); const M = needMat(c.m.matnr, c.m.plant || null, 'matnr'); c.m.list = true; emit('STOCK_VIEW', { matnr: c.m.matnr, plant: c.m.plant }); },
  back: c => { if (c.m.list && !c.m._auto) { c.m.list = false; return true; } }
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
      .filter(r => r.cat !== 'K' && S.pos[r.po].type !== 'UB').map(r => ({ ...r, dq: r.t.gr - r.t.ir, dv: r2((r.t.gr - r.t.ir) * r.price / r.per) })).filter(r => !c.m.only || Math.abs(r.dq) > 1e-9);
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
    const refLink = ['WE', 'WA', 'WI'].includes(A.type) && S.matDocs[A.refDoc] ? lnk('MIGO', { display: A.refDoc }, A.refDoc) : A.type === 'RE' && S.invoices[A.refDoc] ? lnk('MIR4', { inv: A.refDoc }, A.refDoc) : esc(A.refDoc);
    return box(`Document ${A.num} · Company code 1010 · Fiscal year ${A.year}`, `<table class="g orgtbl"><tr><td>Document type</td><td>${A.type} ${ACCT[A.type] || ''}</td></tr><tr><td>Reference</td><td>${refLink}</td></tr><tr><td>Posting date</td><td>${fmtD(A.date)}</td></tr><tr><td>Currency</td><td>EUR</td></tr></table>`) +
      box('Line items', grid([{ h: 'Itm', k: 'n' }, { h: 'PK', k: 'pk' }, { h: 'Account', f: r => r.vendor ? `${r.vendor}` : r.gl }, { h: 'Description', f: r => r.vendor ? `${esc(vname(r.vendor))} (recon. ${GL.AP[0]})` : esc(r.text) }, { h: 'Amount EUR', r: 1, f: r => (r.dc === 'C' ? '-' : '') + money(r.amt) }, { h: 'Material', f: r => r.matnr || '' }, { h: 'Cost ctr', f: r => r.cc || '' }, { h: 'Tax', f: r => r.tax || '' }], A.lines,
        { foot: `<tr class="tot"><td colspan="4">Debit ${money(d)} · Credit ${money(cr)}</td><td class="r">${money(d - cr)}</td><td colspan="2"></td></tr>` })) +
      `<div class="tip">Posting keys: <b>89/99</b> inventory, <b>86/96</b> GR/IR clearing, <b>31/21</b> supplier credit/debit, <b>25</b> outgoing payment, <b>40/50</b> G/L debit/credit, <b>81/91</b> costs (consumption, scrapping, differences), <b>83/93</b> price differences. Debit always equals credit.</div>`;
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
const TITLES = { MM01: 'Create Material', MM02: 'Change Material', MM03: 'Display Material', BP: 'Maintain Business Partner', ME11: 'Create Purchasing Info Record', ME13: 'Display Purchasing Info Records', ME51N: 'Create Purchase Requisition', ME53N: 'Display Purchase Requisition', ME5A: 'List Display of Purchase Requisitions',
  ME21N: 'Create Purchase Order', ME23N: 'Display Purchase Order', ME2N: 'Purchase Orders by PO Number', ME2M: 'Purchase Orders by Material', MIGO: 'Goods Movement', MIGO_GI: 'Goods Issue', MIGO_TR: 'Transfer Posting', MBRL: 'Return Delivery per Material Document', MB03: 'Display Material Document',
  MMBE: 'Stock Overview', MB52: 'Warehouse Stocks', MB51: 'Material Document List', MIRO: 'Enter Incoming Invoice', MIR7: 'Park Incoming Invoice', MIR4: 'Display Invoice Document', MRBR: 'Release Blocked Invoices', MB5S: 'List of GR/IR Balances', FB03: 'Display Accounting Document' };

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
function startScenario(id) { if (TP.fresh !== false) { seed(); home(); } TP.active = id; TP.runs[id] = { cursor: S.log.length, step: 0, ctx: {}, done: false, started: Date.now() }; saveTP(); drawTrainer(); toast('Scenario started: follow step 1'); }
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
  if (TP.view === 'exam' && MMSB.examRender) { body.innerHTML = MMSB.examRender(); return; }
  const sc = SCEN.find(s => s.id === TP.view);
  if (!sc) {
    body.innerHTML = (MMSB.examListHtml ? MMSB.examListHtml() : '') + `<p class="small">Guided exercises check your work automatically as you post documents. Pick a scenario:</p>` +
      SCEN.map((s, i) => { const g = i < 6 ? 'Basics' : s.level.split('·')[0].trim(); const pg = i === 0 ? '' : i < 6 ? 'Basics' : i === 6 ? 'Basics' : SCEN[i - 1].level.split('·')[0].trim(); const head = g !== pg || i === 0 ? `<div class="sc-grp">${esc(g)}</div>` : ''; const r = TP.runs[s.id]; const pct = r ? Math.round(r.step / s.steps.length * 100) : 0; return `${head}<button type="button" class="sc" data-sc="${s.id}"><b>${esc(s.title)}</b>${r?.done ? ' ✅' : TP.active === s.id ? ' <span class="badge">active</span>' : ''}<small>${esc(s.level)} · ${s.steps.length} steps</small><small>${esc(s.intro)}</small><div class="prog"><i style="width:${pct}%"></i></div></button>`; }).join('') +
      `<div class="tr-tools"><button type="button" class="btn sm" data-tr="snap">📸 Save snapshot</button><button type="button" class="btn sm" data-tr="restore">↩ Restore snapshot</button><button type="button" class="btn sm" data-tr="reset">↺ Reset sandbox data</button><button type="button" class="btn sm" data-tr="export">⬇ Export data</button><label class="btn sm" style="cursor:pointer">⬆ Import<input type="file" accept="application/json" data-tr="import" hidden></label></div>
      <p class="disclaimer">Free practice works too: everything you post stays in this browser. Reset restores the starting data.</p>`;
    return;
  }
  const run = TP.runs[sc.id]; const active = TP.active === sc.id && run;
  body.innerHTML = `<button type="button" class="btn sm" data-tr="list">← All scenarios</button><h3 style="margin:10px 0 2px">${esc(sc.title)}</h3><p class="small muted" style="margin:0 0 8px">${esc(sc.level)}</p><p class="small">${esc(sc.intro)}</p>
    ${active ? '' : `<label class="small" style="display:block;margin:6px 0"><input type="checkbox" data-tr="fresh" ${TP.fresh !== false ? 'checked' : ''}> Start with fresh data (recommended)</label><button type="button" class="btn pri" data-tr="start">▶ ${run ? 'Restart' : 'Start'} scenario</button>`}
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
  if (which === 'menu') items.unshift(['SAP Fiori launchpad', () => call('/UI2/FLP')]);
  pop.innerHTML = items.map((x, i) => `<button type="button" data-mi="${i}">${esc(x[0])}</button>`).join('');
  const r = btn.getBoundingClientRect(); pop.style.left = r.left + 'px'; pop.style.top = r.bottom + 'px'; pop.dataset.w = which; pop.hidden = false;
  pop.onclick = e => { const b = e.target.closest('[data-mi]'); if (b) { pop.hidden = true; items[+b.dataset.mi][1](); } };
}
function saveSnap() { try { localStorage.setItem('sapmm-sandbox-snap', JSON.stringify(S)); toast('📸 Snapshot saved: restore it any time from the Trainer panel'); } catch (e) { toast('Snapshot could not be saved (storage full?)'); } }
function restoreSnap() { let raw = null; try { raw = localStorage.getItem('sapmm-sandbox-snap'); } catch (e) { /* ignore */ } if (!raw) { toast('No snapshot saved yet'); return; } resetStore(JSON.parse(raw)); ensureAll(); persist(); home(); toast('↩ Snapshot restored'); }
function confirmReset() {
  modal('Reset sandbox data', '<p>Delete everything you have posted and restore the starting data? Scenario progress is also reset.</p>', [{ l: 'Cancel' }, { l: 'Reset', pri: 1, a: () => { seed(); TP = { runs: {}, open: TP.open }; saveTP(); home(); drawTrainer(); msg('S', 'Sandbox data reset to the starting state'); } }]);
}
function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `mm-sandbox-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importData(file) {
  const fr = new FileReader();
  fr.onload = () => { try { const d = JSON.parse(fr.result); if (d.v !== 2 || !d.materials || !d.pos) throw 0; resetStore(d); ensureAll(); persist(); home(); msg('S', 'Sandbox data imported'); } catch (e) { msg('E', 'Import failed: not a valid MM Sandbox export file'); } };
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
    if (t.closest('[data-back]')) { back(); return; }
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
    const ex = t.closest('[data-ex]'); if (ex) { MMSB.examAct?.(ex.dataset.ex, ex); return; }
    const tr = t.closest('[data-tr]'); if (!tr || tr.tagName === 'INPUT') return;
    ({ list: () => { TP.view = null; saveTP(); drawTrainer(); }, start: () => startScenario(TP.view), reset: confirmReset, export: exportData, snap: saveSnap, restore: restoreSnap })[tr.dataset.tr]?.();
  });
  $('#trainerBody').addEventListener('change', e => { if (e.target.dataset.tr === 'import' && e.target.files[0]) importData(e.target.files[0]); if (e.target.dataset.tr === 'fresh') { TP.fresh = e.target.checked; saveTP(); } });

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
window.MMSB = { S, ORG, GL, MVT, mvtName, TX, F4, F4T, MENU, TITLES, SCEN, LATER, OBSOLETE, HOOKS, ACCT, $, $$, esc, pad, iso, today, dPlus, fmtD, parseD, N, r2, r3, money, qf, getPath, setPath, U, sum, SapErr, err, nextNo, persist,
  getStock, stockKey, plantData, findInfo, vname, special, addSpecial, specialList, poTotals, onOrder, createMaterial, createVendor, createInfo, createPR, createPO, createAcc, line, flipLines, PK, applyVals, postGR, planMvt, postMvt, reverseMvt, computeIR, postIR, ctrUsage, condNet,
  emit, msg, toast, call, home, back, act, render, ensureAll, seed, resetStore, postSTOGI, extendMaterial, slocOk, saveTP, drawTrainer, startScenario, get TP() { return TP; }, F, I, box, tabs, tabOn, grid, callAttr, lnk, req, needDate, needMat, needVendor, needOf, modal, closeModal, invStatus, get cur() { return cur; } };
document.addEventListener('DOMContentLoaded', init);
})();
