/* MM Sandbox: MRP (consumption-based and deterministic), stock/requirements list, valuation (MR21, MB5L), subcontracting monitor. */
(() => {
'use strict';
const { S, ORG, GL, TX, F4, F4T, TITLES, SCEN, HOOKS, ACCT, esc, pad, today, dPlus, fmtD, parseD, N, r2, r3, money, qf, U, sum, err, nextNo,
  plantData, stockKey, special, poTotals, createPR, createAcc, line, findInfo, vname, emit, msg, call, act, F, I, box, grid, lnk, req, needDate, needMat } = MMSB;

HOOKS.ensure.push(S => { S.pirs ??= []; S.seq.pir ??= 1; ACCT.PR = 'Price change'; });
HOOKS.seed.push(S => { S.pirs = []; S.seq.pir = 1; const fg = S.materials.FG16?.plants['1010']; if (fg) fg.mrp.spk = '30'; });
Object.assign(TITLES, { MD61: 'Create Planned Independent Requirements', MD63: 'Display Planned Independent Requirements', MD01: 'MRP Run (Total Planning)', MD03: 'MRP: Single-Item, Single-Level', MD04: 'Stock/Requirements List', MR21: 'Price Change', MB5L: 'List of Stock Values: Balances', ME2O: 'SC Stock Monitoring (Supplier)' });

// ---------- planning engine ----------
const stockAvail = m => sum(Object.entries(S.stock).filter(([k]) => k.startsWith(`${m}|1010|`)), ([, v]) => v.unr + v.qi);
function elements(m) {
  const pd = plantData(m, '1010'); const ev = [];
  for (const p of S.pirs.filter(x => x.matnr === m && x.qty > 0)) ev.push({ date: p.date, el: 'IndReq', data: `PIR ${p.id}`, qty: -p.qty, past: p.date < today() });
  for (const R of Object.values(S.reservations)) for (const i of R.items) if (i.matnr === m && !i.final && i.qty - i.wd > 0) ev.push({ date: i.reqDate, el: 'Reserv', data: `${R.num}/${i.item} cc ${R.cc}`, qty: -r3(i.qty - i.wd), link: ['MB23', { res: R.num }] });
  for (const P of Object.values(S.pos)) for (const it of P.items) {
    if (it.del) continue;
    if (it.matnr === m && it.cat !== 'K') { const t = poTotals(P, it); if (t.toDeliver > 0) ev.push({ date: it.date, el: P.type === 'LP' ? 'SchLne' : 'POitem', data: `${P.num}/${it.item} ${P.vendor}`, qty: t.toDeliver, link: ['ME23N', { po: P.num }] }); }
    if (it.cat === 'L' && it.comps) for (const cp of it.comps) if (cp.matnr === m) { const t = poTotals(P, it); const need = r3(cp.qty * Math.max(0, t.toDeliver) / it.qty); const atV = special(`O|${m}|1010|${P.vendor}`); const net = r3(need - atV); if (net > 0) ev.push({ date: it.date, el: 'SubReq', data: `${P.num}/${it.item} (subcontracting ${it.matnr})`, qty: -net, link: ['ME23N', { po: P.num }] }); }
  }
  for (const PR of Object.values(S.prs)) for (const it of PR.items) {
    if (it.poRef || it.del) continue;
    if (it.matnr === m) ev.push({ date: it.date, el: 'PurRqs', data: `${PR.num}/${it.item}${PR.origin === 'MRP' ? ' (MRP)' : ''}`, qty: it.qty, link: ['ME53N', { pr: PR.num }], mrp: PR.origin === 'MRP', pr: PR.num });
    if (it.cat === 'L') for (const b of S.boms[it.matnr] || []) if (b.comp === m) ev.push({ date: it.date, el: 'SubReq', data: `${PR.num}/${it.item} (subcontracting req. ${it.matnr})`, qty: -r3(b.qty * it.qty), link: ['ME53N', { pr: PR.num }] });
  }
  ev.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.qty < 0 ? -1 : 1));
  return { pd, ev };
}
function lotQty(mrp, short, projected) {
  if (mrp.lot === 'FX') return Math.ceil(short / mrp.fix) * mrp.fix;
  if (mrp.lot === 'HB') return Math.max(short, r3(mrp.max - projected));
  return short;
}
function srcFor(m, pd) {
  if (pd.mrp.spk === '30') { const inf = S.infos.find(i => i.matnr === m && i.cat === 'L'); return { vendor: inf?.vendor || '', cat: 'L', price: inf?.price, how: inf ? 'Subcontracting info record' : 'No subcontracting info record' }; }
  const ds = MMSB.determineSource ? MMSB.determineSource(m, '1010') : { vendor: '' };
  return { ...ds, cat: '' };
}
function planMaterial(m) {
  const M = S.materials[m], pd = M.plants['1010'], mrp = pd.mrp; const out = { matnr: m, type: mrp.type, prs: [], msgs: [] };
  if (mrp.type === 'ND') { out.msgs.push('MRP type ND: not planned'); return out; }
  // planning mode 3: delete open MRP-created requisitions and plan again
  for (const PR of Object.values(S.prs)) if (PR.origin === 'MRP' && PR.items.every(i => !i.poRef) && PR.items.some(i => i.matnr === m) && !(PR.relReq && PR.relDone?.length)) delete S.prs[PR.num];
  const src = srcFor(m, pd);
  const mk = (qty, date, why) => {
    const minDate = dPlus(Math.max(1, mrp.pdt));
    const d = date < minDate ? minDate : date;
    if (date < minDate) out.msgs.push(`Exception 07: requirement on ${fmtD(date)} cannot be met in time (planned delivery time ${mrp.pdt} days): delivery date set to ${fmtD(d)}`);
    const num = createPR({ origin: 'MRP', date: today(), items: [{ matnr: m, short: M.desc, qty: r3(qty), uom: M.uom, plant: '1010', sloc: pd.slocs[0] || '101A', date: d, pgrp: pd.pgrp, vendor: src.vendor || '', agmt: src.agmt || '', agmtItem: src.agmtItem || '', valPrice: src.cat === 'L' ? (src.price || 0) : pd.price, cat: src.cat }] });
    out.prs.push({ num, qty: r3(qty), date: d, why });
  };
  const { ev } = elements(m);
  let avail = r3(stockAvail(m) - mrp.safety);
  if (mrp.type === 'VB') {
    const receipts = sum(ev.filter(e => e.qty > 0), e => e.qty);
    const total = r3(stockAvail(m) + receipts);
    if (total <= mrp.rop) { const q = mrp.lot === 'FX' ? mrp.fix : mrp.lot === 'HB' ? r3(mrp.max - total) : r3(mrp.rop - total + mrp.safety + 1); mk(q, today(), `Stock + receipts ${qf(total)} ≤ reorder point ${qf(mrp.rop)}`); }
    else out.msgs.push(`Stock + open receipts ${qf(total)} above reorder point ${qf(mrp.rop)}: no requirement`);
  } else {
    if (avail < 0) { const q = lotQty(mrp, -avail, stockAvail(m)); mk(q, today(), `Safety stock ${qf(mrp.safety)} not covered`); avail = r3(avail + q); }
    for (const e of ev) {
      if (e.past && e.el === 'IndReq') { out.msgs.push(`PIR ${e.data} on ${fmtD(e.date)} is in the past (ignored)`); continue; }
      avail = r3(avail + e.qty);
      if (avail < 0) { const q = lotQty(mrp, -avail, avail + mrp.safety); mk(q, e.date, `Shortage ${qf(-avail)} on ${fmtD(e.date)} (${e.el} ${e.data})`); avail = r3(avail + q); }
    }
  }
  if (!out.prs.length && !out.msgs.length) out.msgs.push('Requirements covered: no new requisition');
  if (out.prs.length && !src.vendor) out.msgs.push(`No unique source of supply (${src.how}): requisition created without supplier`);
  return out;
}
MMSB.planMaterial = planMaterial;
MMSB.vbTotal = m => r3(stockAvail(m) + sum(elements(m).ev.filter(e => e.qty > 0), e => e.qty));

// ---------- PIRs ----------
F4.pirmat = () => [...new Set(S.pirs.map(p => p.matnr))].map(m => [m, S.materials[m]?.desc, `${S.pirs.filter(p => p.matnr === m).length} requirement(s)`]);
TX.MD61 = {
  title: c => c.m.step === 2 ? 'Create Planned Independent Requirements: Planning Table' : 'Create Planned Independent Requirements: Initial Screen',
  init: () => ({ step: 1, matnr: '', rows: [{ date: fmtD(dPlus(14)), qty: '' }, { date: fmtD(dPlus(28)), qty: '' }, { date: fmtD(dPlus(42)), qty: '' }] }),
  render: c => {
    const m = c.m;
    const hdr = F('Material', 'matnr', { req: 1, f4: 'mat', w: 18, ro: m.step === 2, desc: S.materials[U(m.matnr)]?.desc || '' }) + F('Plant', '_p', { ro: 1, w: 6, desc: '1010' }) + F('Version', '_v', { ro: 1, w: 4, desc: '00 Active' });
    if (m.step === 1) return box('Planned independent requirements', hdr) + '<div class="tip">PIRs are forecast demand (e.g. from sales planning). MRP type <b>PD</b> plans against them: shortages become purchase requisitions.</div>';
    return box('Header', hdr) + box('Schedule lines', grid([{ h: 'Requirements date', f: (r, i) => I(`rows.${i}.date`, { w: 10 }) }, { h: 'Planned quantity', f: (r, i) => I(`rows.${i}.qty`, { w: 8, num: 1 }) }, { h: 'Unit', f: () => S.materials[U(m.matnr)]?.uom }], m.rows));
  },
  enter: c => { if (c.m.step === 2) return; req(c, ['matnr']); c.m.matnr = U(c.m.matnr); const M = needMat(c.m.matnr, '1010', 'matnr'); if (M.plants['1010'].mrp.type !== 'PD') msg('W', `Material ${M.matnr} has MRP type ${M.plants['1010'].mrp.type}: PIRs are only planned with MRP type PD (change in MM02)`); c.m.step = 2; },
  save: c => {
    const m = c.m; if (m.step === 1) err('Press Enter first');
    const rows = m.rows.map((r, i) => ({ r, i })).filter(x => String(x.r.qty).trim()).map(({ r, i }) => { const d = parseD(r.date); if (!d) err('Enter a valid date (DD.MM.YYYY)', null, `rows.${i}.date`); const q = N(r.qty); if (!(q > 0)) err('Enter a quantity', null, `rows.${i}.qty`); return { d, q }; });
    if (!rows.length) err('Enter at least one quantity', null, 'rows.0.qty');
    rows.forEach(r => S.pirs.push({ id: String(S.seq.pir++), matnr: m.matnr, plant: '1010', date: r.d, qty: r.q }));
    emit('PIR_CREATED', { matnr: m.matnr, qty: sum(rows, r => r.q) });
    c.m = TX.MD61.init(); msg('S', `Planned independent requirements saved for material ${m.matnr} (${rows.length} line${rows.length > 1 ? 's' : ''})`);
  },
  back: c => { if (c.m.step === 2) { c.m.step = 1; return true; } }
};
TX.MD63 = {
  title: 'Display Planned Independent Requirements',
  init: () => ({ matnr: '' }),
  acts: { del: (c, d) => { S.pirs = S.pirs.filter(p => p.id !== d.id); MMSB.S.pirs = S.pirs; msg('S', `Requirement ${d.id} deleted`); } },
  render: c => { const mt = U(c.m.matnr); const rows = S.pirs.filter(p => !mt || p.matnr === mt); return box('Selection', F('Material', 'matnr', { f4: 'mat', w: 18 })) + box(`Planned independent requirements (${rows.length})`, grid([{ h: 'Req.', k: 'id' }, { h: 'Material', k: 'matnr' }, { h: 'Description', f: r => esc(S.materials[r.matnr]?.desc) }, { h: 'Date', f: r => fmtD(r.date) + (r.date < today() ? ' <span class="badge warn">past</span>' : '') }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: '', f: r => `<button type="button" class="btn sm" data-act="del" data-id="${r.id}">Delete</button>` }], rows)); },
  enter: () => {}
};

// ---------- MRP run ----------
const logView = log => grid([{ h: 'Material', f: r => lnk('MD04', { matnr: r.matnr }, r.matnr) }, { h: 'MRP type', k: 'type' }, { h: 'Requisitions created', f: r => r.prs.map(p => `${lnk('ME53N', { pr: p.num }, p.num)} ${qf(p.qty)} for ${fmtD(p.date)}`).join('<br>') || '—' }, { h: 'Messages', f: r => r.msgs.map(esc).join('<br>') }], log);
TX.MD01 = {
  title: c => c.m.done ? 'MRP Run: Statistics' : 'MRP Run',
  init: () => ({ mode: '3', done: false, log: [] }),
  tb: c => c.m.done ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MD01.exec) }],
  render: c => {
    if (!c.m.done) return box('Control parameters', F('Plant', '_p', { ro: 1, w: 6, desc: '1010 Plant Fréjus' }) + F('Processing key', '_k', { ro: 1, w: 6, desc: 'NEUPL Regenerative planning' }) + F('Create purchase req.', '_r', { ro: 1, w: 4, desc: '1 Purchase requisitions (always)' }) + F('Planning mode', 'mode', { type: 'select', opts: { '3': '3 Delete and recreate planning data' } })) + '<div class="tip">Plans every material with MRP type PD or VB. Open MRP-created requisitions are deleted and recreated; manually created ones and POs count as receipts.</div>';
    const n = sum(c.m.log, r => r.prs.length);
    return box(`Planned materials: ${c.m.log.length} · requisitions created: ${n}`, logView(c.m.log));
  },
  exec: c => { if (c.m.done) return; c.m.log = Object.keys(S.materials).filter(m => plantData(m, '1010').mrp.type !== 'ND').map(planMaterial); c.m.done = true; const n = sum(c.m.log, r => r.prs.length); emit('MRP_RUN', { all: true, n, mats: c.m.log.filter(r => r.prs.length).map(r => r.matnr) }); msg('S', `MRP run finished: ${n} purchase requisition${n === 1 ? '' : 's'} created`); },
  back: c => { if (c.m.done) { c.m.done = false; return true; } }
};
TX.MD03 = {
  title: c => c.m.done ? `MRP: Result for ${c.m.matnr}` : 'MRP: Single-Item, Single-Level',
  init: p => ({ matnr: p.matnr || '', done: false, log: [] }),
  tb: c => c.m.done ? [{ l: 'Stock/Requirements list', i: '📈', a: c => call('MD04', { matnr: c.m.matnr }, true) }] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MD03.exec) }],
  render: c => c.m.done ? box('Planning result', logView(c.m.log)) : box('Material', F('Material', 'matnr', { req: 1, f4: 'mat', w: 18 }) + F('Plant', '_p', { ro: 1, w: 6, desc: '1010' })) + '<div class="tip">Plans one material. Check the result in MD04.</div>',
  enter: c => TX.MD03.exec(c),
  exec: c => { if (c.m.done) return; req(c, ['matnr']); c.m.matnr = U(c.m.matnr); needMat(c.m.matnr, '1010', 'matnr'); const r = planMaterial(c.m.matnr); c.m.log = [r]; c.m.done = true; emit('MRP_RUN', { all: false, n: r.prs.length, mats: r.prs.length ? [r.matnr] : [], matnr: r.matnr }); msg(r.prs.length ? 'S' : 'I', r.prs.length ? `${r.prs.length} purchase requisition${r.prs.length > 1 ? 's' : ''} created for ${r.matnr}` : `No new requisition for ${r.matnr}: ${r.msgs[0] || ''}`); },
  back: c => { if (c.m.done) { c.m.done = false; return true; } }
};
TX.MD04 = {
  title: c => c.m.show ? `Stock/Requirements List as of ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Stock/Requirements List: Initial Screen',
  init: p => ({ matnr: p.matnr || '', show: false, _auto: !!p.matnr }),
  onOpen: c => { if (c.m._auto) TX.MD04.enter(c); },
  tb: c => c.m.show ? [{ l: 'Plan (MD03)', i: '⚙', a: c => act(c => { const r = planMaterial(c.m.matnr); emit('MRP_RUN', { all: false, n: r.prs.length, mats: r.prs.length ? [r.matnr] : [], matnr: r.matnr }); msg(r.prs.length ? 'S' : 'I', r.prs.length ? `${r.prs.length} requisition(s) created` : r.msgs[0] || 'No change'); }) }, { l: 'Refresh', i: '↻', a: c => act(() => {}) }, { l: 'Other material', i: '⇄', a: c => act(c => { c.m.show = false; c.m._auto = false; }) }] : [],
  render: c => {
    if (!c.m.show) return box('Material', F('Material', 'matnr', { req: 1, f4: 'mat', w: 18 }) + F('Plant', '_p', { ro: 1, w: 6, desc: '1010' }));
    const M = S.materials[c.m.matnr]; const { pd, ev } = elements(M.matnr); const mrp = pd.mrp;
    let run = stockAvail(M.matnr);
    const rows = [{ date: today(), el: 'Stock', data: 'Plant stock (unrestricted + QI)', qty: run, avail: run, cls: 'tot' }];
    if (mrp.safety) { run = r3(run - mrp.safety); rows.push({ date: today(), el: 'SafeSt', data: 'Safety stock', qty: -mrp.safety, avail: run }); }
    for (const e of ev) { if (!(e.past && e.el === 'IndReq')) run = r3(run + e.qty); rows.push({ ...e, avail: run, cls: run < 0 ? 'neg' : '' }); }
    return box(`${M.matnr} ${esc(M.desc)} · MRP type ${mrp.type}${mrp.type === 'VB' ? ` · reorder point ${qf(mrp.rop)}` : ''} · lot size ${mrp.lot}${mrp.lot === 'FX' ? ' ' + qf(mrp.fix) : ''} · safety ${qf(mrp.safety)} · PDT ${mrp.pdt} d`,
      grid([{ h: 'Date', f: r => fmtD(r.date) }, { h: 'MRP element', f: r => `<b>${r.el}</b>` }, { h: 'MRP element data', f: r => r.link ? `<button type="button" class="lnk" data-call="${r.link[0]}" data-p='${esc(JSON.stringify(r.link[1]))}'>${esc(r.data)}</button>` : esc(r.data) }, { h: 'Rec./reqd qty', r: 1, f: r => (r.qty > 0 && r.el !== 'Stock' ? '+' : '') + qf(r.qty) }, { h: 'Available qty', r: 1, f: r => `<span style="${r.avail < 0 ? 'color:#bb0000;font-weight:700' : ''}">${qf(r.avail)}</span>` }], rows.map(r => ({ ...r, _cls: r.cls === 'tot' ? 'tot' : '' })))) +
      '<div class="tip">The list is dynamic: receipts (+) are POs, schedule lines and requisitions; requirements (−) are PIRs, reservations and subcontracting components. A <b>negative available quantity</b> (red) is a shortage that MRP will cover with a requisition.</div>';
  },
  enter: c => { if (c.m.show) return; req(c, ['matnr']); c.m.matnr = U(c.m.matnr); needMat(c.m.matnr, '1010', 'matnr'); c.m.show = true; emit('MD04_VIEW', { matnr: c.m.matnr }); },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
};

// ---------- Valuation ----------
TX.MR21 = {
  title: 'Price Change: Overview Screen',
  init: () => ({ matnr: '', price: '', date: fmtD(today()) }),
  render: c => {
    const M = S.materials[U(c.m.matnr)]; const pd = M?.plants['1010'];
    const np = N(c.m.price); const diff = pd && np > 0 ? r2(np * pd.totQty - pd.totVal) : null;
    return box('Price change', F('Posting date', 'date', { w: 10 }) + F('Material', 'matnr', { req: 1, f4: 'mat', w: 18, desc: M?.desc || '' }) + F('New price (EUR)', 'price', { req: 1, num: 1, w: 10 })) +
      (pd ? box('Current valuation', `<table class="g orgtbl"><tr><td>Price control</td><td>${ORG.ctrls[pd.ctrl]}</td></tr><tr><td>Current price</td><td>${money(pd.price)} EUR</td></tr><tr><td>Total valuated stock</td><td>${qf(pd.totQty)} ${M.uom}</td></tr><tr><td>Total value</td><td>${money(pd.totVal)} EUR</td></tr>${diff != null ? `<tr><td>Revaluation at new price</td><td><b>${diff >= 0 ? '+' : ''}${money(diff)} EUR</b> (inventory ${GL[pd.vc][0]} against ${GL.UMB[0]} ${esc(GL.UMB[1])})</td></tr>` : ''}</table>`) : '') +
      '<div class="tip">Changing a standard price revalues all stock on hand: the difference is posted to the revaluation account. Press Enter to preview the revaluation, Ctrl+S to post.</div>';
  },
  enter: c => { if (String(c.m.matnr).trim()) { c.m.matnr = U(c.m.matnr); needMat(c.m.matnr, '1010', 'matnr'); } },
  save: c => {
    req(c, ['matnr', 'price']); c.m.matnr = U(c.m.matnr); const M = needMat(c.m.matnr, '1010', 'matnr'); const pd = M.plants['1010'];
    const np = N(c.m.price); if (!(np > 0)) err('Enter a new price greater than 0', null, 'price'); if (r2(np) === pd.price) err('New price is the same as the current price', null, 'price');
    const date = needDate(c, 'date'); const old = pd.price; const diff = r2(np * pd.totQty - pd.totVal);
    const doc = `PC${pad(Object.keys(S.accDocs).length + 1, 8)}`;
    const an = diff ? createAcc('PR', `${M.matnr} ${money(old)}→${money(np)}`, date, [line('inv', pd.vc, 'D', diff, { matnr: M.matnr }), line('gbb', 'UMB', 'C', diff, { matnr: M.matnr })]) : '';
    pd.price = r2(np); pd.totVal = r2(np * pd.totQty);
    emit('PRICE_CHANGED', { matnr: M.matnr, old, price: pd.price, diff, acc: an });
    c.m = TX.MR21.init(); msg('S', `Price change posted for ${M.matnr}: ${money(old)} → ${money(np)} EUR${an ? `, revaluation ${money(diff)} EUR (document ${an})` : ''}`);
  }
};
TX.MB5L = {
  title: c => c.m.list ? 'List of Stock Values: Balances in Local Currency' : 'List of Stock Values: Selection',
  init: () => ({ list: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MB5L.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Company code', '_cc', { ro: 1, w: 6, desc: '1010' }) + F('Fiscal year / period', '_fy', { ro: 1, w: 8, desc: 'Current period' }));
    const rows = Object.values(S.materials).map(M => { const pd = M.plants['1010']; return { gl: GL[pd.vc][0], glt: GL[pd.vc][1], m: M.matnr, d: M.desc, q: pd.totQty, uom: M.uom, v: pd.totVal, p: pd.price, ctrl: pd.ctrl }; }).sort((a, b) => a.gl < b.gl ? -1 : 1);
    const accts = [...new Set(rows.map(r => r.gl))];
    return accts.map(g => { const rs = rows.filter(r => r.gl === g); return box(`G/L account ${g} ${esc(rs[0].glt)} · stock value ${money(sum(rs, r => r.v))} EUR`, grid([{ h: 'Material', k: 'm' }, { h: 'Description', k: 'd' }, { h: 'Price ctrl', k: 'ctrl' }, { h: 'Price', r: 1, f: r => money(r.p) }, { h: 'Valuated stock', r: 1, f: r => `${qf(r.q)} ${r.uom}` }, { h: 'Stock value EUR', r: 1, f: r => money(r.v) }], rs)); }).join('') +
      `<div class="tip">Total stock value: <b>${money(sum(rows, r => r.v))} EUR</b>. MB5L compares the material ledger with the G/L inventory accounts: at period end they must agree. Valuated stock includes stock provided to subcontractors (O) but not consignment stock (K).</div>`;
  },
  enter: c => TX.MB5L.exec(c), exec: c => { if (c.m.list) return; c.m.list = true; emit('REPORT', { tcode: 'MB5L' }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};
TX.ME2O = {
  title: c => c.m.list ? 'SC Stock Monitoring for Supplier' : 'SC Stock Monitoring: Selection',
  init: () => ({ vendor: '', list: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.ME2O.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Supplier', 'vendor', { f4: 'vendor', w: 10 }) + F('Plant', '_p', { ro: 1, w: 6, desc: '1010' }));
    const v = c.m.vendor.trim();
    const stock = Object.entries(S.special).filter(([k]) => k.startsWith('O|')).map(([k, q]) => { const a = k.split('|'); return { m: a[1], v: a[3], q }; }).filter(r => !v || r.v === v);
    const reqs = Object.values(S.pos).filter(P => !v || P.vendor === v).flatMap(P => P.items.filter(it => it.cat === 'L' && !it.del).flatMap(it => (it.comps || []).map(cp => { const t = poTotals(P, it); return { po: P.num, item: it.item, fin: it.matnr, m: cp.matnr, v: P.vendor, need: r3(cp.qty * Math.max(0, t.toDeliver) / it.qty) }; }))).filter(r => r.need > 0);
    return box('Stock provided to supplier (O)', grid([{ h: 'Supplier', f: r => `${r.v} ${esc(vname(r.v))}` }, { h: 'Component', k: 'm' }, { h: 'Description', f: r => esc(S.materials[r.m]?.desc) }, { h: 'Stock at supplier', r: 1, f: r => qf(r.q) }], stock, { empty: 'No stock at subcontractors' })) +
      box('Open subcontracting requirements', grid([{ h: 'PO', f: r => lnk('ME23N', { po: r.po }, `${r.po}/${r.item}`) }, { h: 'Finished material', k: 'fin' }, { h: 'Component', k: 'm' }, { h: 'Required', r: 1, f: r => qf(r.need) }, { h: 'Available at supplier', r: 1, f: r => qf(special(`O|${r.m}|1010|${r.v}`)) }, { h: 'To provide (541)', r: 1, f: r => { const s = r3(r.need - special(`O|${r.m}|1010|${r.v}`)); return s > 0 ? `<b style="color:#bb0000">${qf(s)}</b>` : '0'; } }], reqs, { empty: 'No open subcontracting POs' }));
  },
  enter: c => TX.ME2O.exec(c), exec: c => { if (c.m.list) return; c.m.list = true; emit('REPORT', { tcode: 'ME2O' }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};

// ---------- Scenarios ----------
SCEN.push(
  { id: 'mrp', title: '17. MRP: plan, check, convert', level: 'Planning · 25 min',
    intro: 'Enter forecast demand, run MRP, read the stock/requirements list and convert the planned requisitions into purchase orders.',
    steps: [
      { t: 'Enter a planned independent requirement (<b>MD61</b>) for <b>TG11</b> in three weeks, bigger than what you have: stock + on order + 60.', h: 'Check MMBE for TG11 first (unrestricted + on order). MD61 → TG11 → Enter → first line: date in 3 weeks, quantity = that total + 60 → Ctrl+S.', ok: e => e.type === 'PIR_CREATED' && e.matnr === 'TG11' },
      { t: 'Open the stock/requirements list (<b>MD04</b>) for TG11 and find the shortage.', h: 'MD04 → TG11 → Enter. Stock − safety stock − 60 goes negative (red).', ok: e => e.type === 'MD04_VIEW' && e.matnr === 'TG11' },
      { t: 'Plan TG11 (<b>MD03</b>, or the "Plan" button in MD04).', h: 'MD03 → TG11 → Enter. A purchase requisition (lot-for-lot) is created with supplier 100001 (only info record). No requisition? Then the PIR was smaller than stock + receipts: add one in MD61.', ok: e => e.type === 'MRP_RUN' && e.mats.includes('TG11') },
      { t: 'Consume some TG12 (reorder-point material): issue it to cost center 10101101 (MIGO 201), then look at MD04.', h: 'MIGO → A07 / R10 / 201 → TG12, e.g. 60, 101A, cost center 10101101 → Post. Reorder-point planning compares stock + open receipts (POs, requisitions) with 100: open POs from earlier scenarios may keep TG12 above it. That is correct MRP behaviour.', ok: e => e.type === 'MVT_POSTED' && e.mvt === '201' && e.items.some(i => i.matnr === 'TG12') },
      { t: 'Run total planning (<b>MD01</b>) and read the log for each material.', h: 'MD01 → Execute. If TG12 (VB, fixed lot 200) is at or below its reorder point it gets a requisition for 200 PC; otherwise the log tells you why not. Check RM14 and FG16 too.', ok: e => e.type === 'MRP_RUN' && e.all },
      { t: 'Convert the MRP requisitions into purchase orders (<b>ME59N</b> or ME57).', h: 'The TG11 requisition is above 10,000 EUR: release it first (ME54N or My Inbox in Fiori). Then ME59N → F8: requisitions with a unique source become POs; the others are listed with the reason (TG12 has two possible suppliers: set the desired supplier in ME52N, or maintain a source list in ME01, then run ME59N again).', ok: e => e.type === 'PO_CREATED' && e.items.some(i => i.prRef && S.prs[i.prRef]?.origin === 'MRP') }
    ],
    notes: ['MRP types: VB reorder point (consumption-based), PD deterministic (requirements-driven), ND not planned. Change them in MM02 › MRP 1.', 'Lot sizes: EX lot-for-lot, FX fixed, HB replenish to maximum. Safety stock is a buffer MRP never plans to use.', 'MD04 is the planner\'s main screen: teach learners to read it line by line (receipts +, requirements −, available quantity).'] },
  { id: 'val', title: '18. Valuation & price change', level: 'Valuation · 15 min',
    intro: 'Change a standard price, see the revaluation posting and check the stock value per G/L account.',
    steps: [
      { t: 'Display <b>RM14</b> in <b>MM03</b> (Accounting 1): standard price, stock and value.', h: 'MM03 → RM14 → Enter → tab Accounting 1.', ok: e => e.type === 'MAT_DISPLAY' && e.matnr === 'RM14' },
      { t: 'Change the standard price of RM14 to <b>0.90</b> (<b>MR21</b>).', h: 'MR21 → RM14 → new price 0.90 → Enter (preview the revaluation) → Ctrl+S.', ok: e => e.type === 'PRICE_CHANGED' && e.matnr === 'RM14', cap: (e, x) => { x.acc = e.acc; } },
      { t: 'Display the revaluation document in <b>FB03</b>.', h: 'FB03 → F4 → the newest document of type PR → Dr inventory raw materials / Cr 52100000 revaluation.', ok: e => e.type === 'ACC_DISPLAY' && e.dtype === 'PR' },
      { t: 'Check the stock value per G/L account (<b>MB5L</b>).', h: '/nMB5L → F8.', ok: e => e.type === 'REPORT' && e.tcode === 'MB5L' }
    ],
    notes: ['Standard price (S) gives stable values: variances go to price difference accounts. Moving average (V) follows purchase prices.', 'In S/4HANA the material ledger is always active; price changes are usually planned (CKMLCP / costing run) rather than manual.', 'Show learners how the same goods receipt posts differently for TG11 (V) and RM14 (S).'] }
);
})();
