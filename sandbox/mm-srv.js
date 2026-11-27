/* MM Sandbox: account-assigned (cost centre) purchasing and service procurement with service entry sheets. */
(() => {
'use strict';
const { S, ORG, GL, TX, TITLES, SCEN, HOOKS, esc, pad, today, fmtD, N, r2, r3, money, qf, U, sum, err,
  vname, poTotals, postGR, emit, msg, call, act, F, I, box, grid, lnk, req, needDate } = MMSB;

HOOKS.ensure.push(S => { S.ses ??= {}; S.seq.ses ??= 1000000001; });
HOOKS.seed.push(S => { S.ses = {}; S.seq.ses = 1000000001; });
Object.assign(TITLES, { ML81N: 'Service Entry Sheet' });

TX.ML81N = {
  title: c => c.m.loaded ? `Create Entry Sheet for Purchase Order ${c.m.loaded}` : 'Service Entry Sheet',
  init: p => ({ po: p.po || '', loaded: '', text: '', accept: false, date: fmtD(today()), lines: [] }),
  onOpen: c => { if (c.m.po) TX.ML81N.load(c); },
  acts: { load: c => TX.ML81N.load(c) },
  load: c => {
    const m = c.m; m.po = String(m.po).trim(); const P = S.pos[m.po];
    if (!P) err(`Purchase order ${m.po || '(empty)'} does not exist`, null, 'po');
    HOOKS.grCheck.forEach(f => f(P));
    m.lines = P.items.filter(it => it.cat === 'D' && !it.del).map(it => ({ it, t: poTotals(P, it) })).filter(x => x.t.toDeliver > 0)
      .map(({ it, t }) => ({ item: it.item, short: it.short, uom: it.uom, ordered: it.qty, done: t.gr, open: t.toDeliver, qty: String(t.toDeliver), price: it.price / it.per, cc: it.cc }));
    if (!m.lines.length) err(`Purchase order ${P.num} has no open service items (item category D)`, 'NO_SRV', 'po');
    m.loaded = P.num;
  },
  render: c => {
    const m = c.m;
    const top = box('Purchase order', `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${F('Purchase order', 'po', { req: 1, f4: 'po', w: 12 })}<button type="button" class="btn sm" data-act="load">⏵ Load</button></div>`);
    if (!m.loaded) return top + '<div class="tip">Services are not received with MIGO. The supplier (or the requester) records the work performed on a <b>service entry sheet</b>; once it is <b>accepted</b>, the acceptance posts like a goods receipt: Dr expense (cost center) / Cr GR/IR. The invoice is then matched against the accepted entry sheet.</div>';
    const P = S.pos[m.loaded];
    return top + box(`Entry sheet · ${P.vendor} ${esc(vname(P.vendor))}`, `<div class="cols"><div>${F('Short text', 'text', { req: 1, w: 30, ph: 'e.g. Cleaning December, week 1–4' })}${F('Posting date', 'date', { w: 10 })}</div><div>${F('Accept data', 'accept', { type: 'check', desc: '🚩 Acceptance (green flag): posts the entry sheet' })}</div></div>`) +
      box('Services performed', grid([{ h: 'Item', k: 'item' }, { h: 'Short text', k: 'short' }, { h: 'Ordered', r: 1, f: r => `${qf(r.ordered)} ${r.uom}` }, { h: 'Accepted so far', r: 1, f: r => qf(r.done) }, { h: 'Quantity (this sheet)', f: (r, i) => I(`lines.${i}.qty`, { w: 6, num: 1 }) }, { h: 'Unit', k: 'uom' }, { h: 'Gross price', r: 1, f: r => money(r.price) }, { h: 'Net value', r: 1, f: r => money(N(r.qty) * r.price) }, { h: 'Cost center', f: r => `${r.cc} ${esc(ORG.costc[r.cc] || '')}` }], m.lines));
  },
  enter: c => { if (!c.m.loaded || c.m.loaded !== String(c.m.po).trim()) TX.ML81N.load(c); },
  save: c => {
    const m = c.m; if (!m.loaded) err('Load a purchase order first', null, 'po');
    if (!String(m.text).trim()) err('Fill in all required entry fields', null, 'text');
    const date = needDate(c, 'date'); if (date > today()) err('Posting date is in the future', null, 'date');
    const tol = S.cfg.overTol || 0;
    const lines = m.lines.map((l, i) => ({ l, i })).filter(x => N(x.l.qty) > 0).map(({ l, i }) => { const q = N(l.qty); if (q > l.open * (1 + tol / 100) + 1e-9) err(`Item ${l.item}: quantity exceeds the open ordered quantity ${qf(l.open)} ${l.uom}`, 'QTY_EXCEEDED', `lines.${i}.qty`); return { item: l.item, qty: q, sloc: '', stype: '' }; });
    if (!lines.length) err('Enter the quantity performed for at least one service line', null, 'lines.0.qty');
    if (!m.accept) err('Set the acceptance flag (Accept data): an entry sheet only posts, and can only be invoiced, once accepted', 'NOT_ACCEPTED', 'accept');
    const num = String(S.seq.ses++);
    const md = postGR({ po: m.loaded, lines, date, text: `Entry sheet ${num}: ${String(m.text).trim()}` });
    S.matDocs[md].ses = num;
    const value = r2(sum(lines, x => x.qty * S.pos[m.loaded].items.find(i => i.item === x.item).price));
    S.ses[num] = { num, po: m.loaded, text: String(m.text).trim(), date, md, value, lines };
    emit('SES_POSTED', { num, po: m.loaded, md, value });
    const acc = S.matDocs[md].acc;
    c.m = TX.ML81N.init({}); msg('S', `Entry sheet ${num} saved and accepted · acceptance document ${md}, accounting document ${acc}`);
  },
  back: c => { if (c.m.loaded) { c.m.loaded = ''; c.m.lines = []; return true; } }
};

SCEN.push(
  { id: 'ccpo', title: '21. Purchasing for a cost centre', level: 'Account assignment · 15 min',
    intro: 'Buy items that go straight to a department instead of into stock: a text item without material master and a stock material charged to a cost centre.',
    steps: [
      { t: 'Create a PO from <b>100002</b> with two account-assigned items (A = <b>K</b>): 50 BOX of "Printer paper A4" (no material, group <b>L004</b>, 4.20 per box) for cost center <b>10101101</b>, and 10 PC of <b>TG12</b> for cost center <b>10101301</b>.', h: 'ME21N → 100002. Line 1: A = K, leave Material empty, Short text "Printer paper A4 80 g", qty 50, OUn BOX, net price 4.20, Matl group L004, Cost center 10101101. Line 2: A = K, TG12, qty 10, Cost center 10101301 → Enter → Ctrl+S.', ok: e => e.type === 'PO_CREATED' && e.items.some(i => i.acct === 'K' && !i.matnr) && e.items.some(i => i.acct === 'K' && i.matnr), cap: (e, x) => { x.po = e.num; } },
      { t: 'Post the goods receipt in <b>MIGO</b>: no storage location, no stock change.', h: 'MIGO → A01 / R01 → your PO → Enter: the lines show "Consumption · cost ctr …" instead of a stock type → OK both → Post.', ok: (e, x) => e.type === 'GR_POSTED' && e.po === x.po, cap: (e, x) => { x.md = e.md; } },
      { t: 'Display the GR accounting document: the expense hits the cost centers.', h: 'MIGO A04 (or MB03) → the material document → accounting document: Dr 61000000 Consumption with cost centers 10101101 / 10101301, Cr 21900000 GR/IR.', ok: (e, x) => e.type === 'ACC_DISPLAY' && e.refDoc === x.md },
      { t: 'Post the invoice in <b>MIRO</b>.', h: 'MIRO → PO → Enter: 50 × 4.20 + 10 × 14.50 = 355.00 net → gross 426.00 → Post.', ok: (e, x) => e.type === 'IR_POSTED' && e.po === x.po },
      { t: 'List account-assigned POs with <b>ME2K</b> for cost center 10101101.', h: '/nME2K → Cost center 10101101 → F8.', ok: e => e.type === 'REPORT' && e.tcode === 'ME2K' }
    ],
    notes: ['Account assignment category K = cost center. Others in real SAP: A asset, F internal order, P project, C sales order.', 'An item without material master must be account-assigned: the material group drives the G/L account (see OBYC / SPRO).', 'TG12 with A = K is consumed at receipt: MMBE does not change. Compare with a normal PO for TG12.'] },
  { id: 'srv', title: '22. Service procurement & entry sheet', level: 'Account assignment · 20 min',
    intro: 'Order a cleaning service, record the work on a service entry sheet, accept it and pay the invoice.',
    steps: [
      { t: 'Create a service PO from <b>100002</b>: item category <b>D</b>, "Office cleaning – December", <b>1 AU</b> at <b>1,200.00</b>, material group <b>S001</b>, cost center <b>10101401</b>.', h: 'ME21N → 100002 → I = D (A becomes K automatically), Short text "Office cleaning – December", qty 1, OUn AU, net price 1200, Matl group S001, Cost center 10101401 → Enter → Ctrl+S.', ok: e => e.type === 'PO_CREATED' && e.items.some(i => i.cat === 'D'), cap: (e, x) => { x.po = e.num; } },
      { t: 'Try to post a goods receipt for it in MIGO and read the message.', h: 'MIGO → A01 / R01 → your PO → Enter.', ok: e => e.type === 'ERR' && e.code === 'USE_ML81N' },
      { t: 'Enter a service entry sheet (<b>ML81N</b>) without accepting it: the system refuses to post.', h: 'ML81N → your PO → Load → Short text "Cleaning December" → Ctrl+S without ticking "Accept data".', ok: e => e.type === 'ERR' && e.code === 'NOT_ACCEPTED' },
      { t: 'Accept the entry sheet and save it.', h: 'Tick "Accept data" → Ctrl+S. The acceptance posts Dr 62500000 External services (cost center 10101401) / Cr GR/IR.', ok: (e, x) => e.type === 'SES_POSTED' && e.po === x.po },
      { t: 'Post the supplier invoice in <b>MIRO</b>.', h: 'MIRO → PO → Enter: 1,200.00 net → gross 1,440.00 → Post.', ok: (e, x) => e.type === 'IR_POSTED' && e.po === x.po },
      { t: 'Check the PO history in <b>ME23N</b>.', h: 'ME23N → your PO: one WE line (the accepted entry sheet) and one RE-L line.', ok: (e, x) => e.type === 'PO_DISPLAY' && e.num === x.po }
    ],
    notes: ['Real S/4HANA uses service masters and service lines (or the newer "lean services" with Fiori "Manage Service Entry Sheets"); the logic is the same: order → entry sheet → acceptance → invoice.', 'Acceptance is the control point: without it there is no GR/IR posting and GR-based invoice verification finds nothing to invoice.', 'Services always need an account assignment: there is no stock for a service.'] }
);
})();
