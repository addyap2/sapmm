/* MM Sandbox: purchasing in depth (RFQ/quotation, outline agreements, source list, PO/PR change, automatic PO creation). */
(() => {
'use strict';
const { S, ORG, TX, F4, F4T, TITLES, SCEN, HOOKS, esc, pad, today, dPlus, fmtD, parseD, N, r2, r3, money, qf, U, sum, err, nextNo,
  plantData, findInfo, vname, poTotals, createPO, ctrUsage, condNet, emit, msg, call, act, F, I, box, tabs, tabOn, grid, lnk, req, needDate, needMat, needVendor, modal } = MMSB;

HOOKS.ensure.push(S => { S.rfqs ??= {}; S.contracts ??= {}; S.srclist ??= {}; S.seq.rfq ??= 6000000001; S.seq.ctr ??= 4600000001; S.seq.sa ??= 5500000001; S.seq.coll ??= 1; });
HOOKS.seed.push(S => {
  S.contracts = {}; S.rfqs = {}; S.srclist = {}; S.seq.rfq = 6000000001; S.seq.ctr = 4600000001; S.seq.sa = 5500000001; S.seq.coll = 1;
  const num = String(S.seq.ctr++);
  S.contracts[num] = { num, type: 'WK', vendor: '100002', porg: '1010', pgrp: '001', from: dPlus(-30), to: dPlus(335), targetVal: 20000, date: dPlus(-30), items: [{ item: 10, matnr: 'TG15', short: 'Ergonomic office chair', target: 0, price: 135, uom: 'PC' }] };
  S.srclist.RM14 = [{ from: dPlus(-60), to: dPlus(305), vendor: '100003', porg: '1010', agmt: '', fixed: true, blocked: false, mrp: true }];
});
// RFQ awarded when a PO is created from a quotation
HOOKS.poCreate.push(P => {
  for (const it of P.items) if (it.rfq && S.rfqs[it.rfq]) {
    const R = S.rfqs[it.rfq]; R.status = 'awarded'; R.po = P.num;
    for (const o of Object.values(S.rfqs)) if (o.coll === R.coll && o.num !== R.num && o.status !== 'awarded') o.status = 'rejected';
  }
});

// ---------- source determination (used by ME56/ME57/ME59N and MRP) ----------
function validCtr(m, d = today()) { return Object.values(S.contracts).filter(K => K.from <= d && K.to >= d).flatMap(K => K.items.filter(i => i.matnr === m).map(i => ({ K, i }))); }
function determineSource(m, plant = '1010') {
  const d = today();
  const sl = (S.srclist[m] || []).filter(e => e.from <= d && e.to >= d && !e.blocked);
  const pick = sl.find(e => e.fixed) || (sl.length === 1 ? sl[0] : null);
  const priceFor = (v, agmt) => { if (agmt) { const K = S.contracts[agmt]; const ki = K?.items.find(i => i.matnr === m); return ki ? { price: ki.price, agmtItem: ki.item } : null; } const inf = findInfo(v, m, '1010', plant); return inf ? { price: condNet({ gross: inf.price / inf.per, disc: inf.disc, frt: inf.frt }) } : null; };
  if (pick) { const p = priceFor(pick.vendor, pick.agmt); return { vendor: pick.vendor, agmt: pick.agmt || '', agmtItem: p?.agmtItem || '', price: p?.price ?? null, how: `Source list (${pick.fixed ? 'fixed source' : 'only valid source'})` }; }
  if (sl.length > 1) return { vendor: '', how: 'Several sources in source list, none fixed', none: true };
  const cs = validCtr(m, d);
  if (cs.length === 1) return { vendor: cs[0].K.vendor, agmt: cs[0].K.num, agmtItem: cs[0].i.item, price: cs[0].i.price, how: 'Only valid contract' };
  const infos = S.infos.filter(i => i.matnr === m && !i.cat && (!i.plant || i.plant === plant));
  if (infos.length === 1) return { vendor: infos[0].vendor, agmt: '', price: condNet({ gross: infos[0].price / infos[0].per, disc: infos[0].disc, frt: infos[0].frt }), how: 'Only info record' };
  if (infos.length > 1) return { vendor: '', how: `${infos.length} info records and no source list: choose manually (or maintain ME01)`, none: true };
  return { vendor: '', how: 'No source of supply found', none: true };
}
MMSB.determineSource = determineSource;

// ---------- F4 ----------
F4.rfq = () => Object.values(S.rfqs).reverse().map(r => [r.num, `${r.vendor} ${vname(r.vendor)}`, `Coll. ${r.coll} · ${r.items.map(i => i.matnr).join(', ')} · ${r.status}`]);
F4.coll = () => [...new Set(Object.values(S.rfqs).map(r => r.coll))].reverse().map(c => [c, Object.values(S.rfqs).filter(r => r.coll === c).map(r => r.vendor).join(', '), Object.values(S.rfqs).find(r => r.coll === c).items.map(i => i.matnr).join(', ')]);
F4.sa = () => Object.values(S.pos).filter(p => p.type === 'LP').reverse().map(p => [p.num, vname(p.vendor), p.items.map(i => i.matnr).join(', ')]);
F4.agtype = () => [['MK', 'Quantity contract'], ['WK', 'Value contract']];
Object.assign(F4T, { rfq: 'RFQ / quotation', coll: 'Collective number', sa: 'Scheduling agreement', agtype: 'Agreement type' });
Object.assign(TITLES, { ME41: 'Create RFQ', ME42: 'Change RFQ', ME43: 'Display RFQ', ME47: 'Maintain Quotation', ME48: 'Display Quotation', ME49: 'Price Comparison', ME31K: 'Create Contract', ME32K: 'Change Contract', ME33K: 'Display Contract',
  ME31L: 'Create Scheduling Agreement', ME38: 'Maintain Delivery Schedule', ME33L: 'Display Scheduling Agreement', ME01: 'Maintain Source List', ME03: 'Display Source List', ME22N: 'Change Purchase Order', ME52N: 'Change Purchase Requisition',
  ME56: 'Assign Source to Purch. Requisitions', ME57: 'Assign and Process Requisitions', ME58: 'Ordering: Assigned Requisitions', ME59N: 'Automatic Creation of POs', ME2L: 'Purchase Orders by Supplier', ME2C: 'Purchase Orders by Material Group', ME2K: 'Purchase Orders by Account Assignment', ME12: 'Change Purchasing Info Record' });

// ======================================================================
// RFQ & quotation
// ======================================================================
const blankRq = () => ({ matnr: '', qty: '', date: '' });
TX.ME41 = {
  title: 'Create RFQ',
  init: () => ({ deadline: fmtD(dPlus(7)), coll: '', v1: '', v2: '', v3: '', items: [blankRq(), blankRq(), blankRq()] }),
  tb: () => [{ l: 'Check', i: '✔', a: c => act(TX.ME41.enter) }],
  render: c => box('Header data', `<div class="cols"><div>${F('RFQ type', '_t', { ro: 1, w: 4, desc: 'AN Request for quotation' })}${F('Quotation deadline', 'deadline', { req: 1, w: 10 })}${F('Collective number', 'coll', { w: 10, ph: 'optional' })}</div>
      <div>${F('Purch. org. / group', '_o', { ro: 1, w: 8, desc: '1010 / 001' })}${F('Supplier 1', 'v1', { req: 1, f4: 'vendor', w: 10, desc: vname(c.m.v1.trim()) })}${F('Supplier 2', 'v2', { f4: 'vendor', w: 10, desc: vname(c.m.v2.trim()) })}${F('Supplier 3', 'v3', { f4: 'vendor', w: 10, desc: vname(c.m.v3.trim()) })}</div></div>`) +
    box('Item overview', grid([{ h: 'Item', f: (r, i) => (i + 1) * 10 }, { h: 'Material', f: (r, i) => I(`items.${i}.matnr`, { f4: 'mat', w: 9 }) }, { h: 'Short text', f: r => esc(S.materials[U(r.matnr)]?.desc || '') }, { h: 'RFQ quantity', f: (r, i) => I(`items.${i}.qty`, { w: 7, num: 1 }) }, { h: 'Unit', f: r => esc(S.materials[U(r.matnr)]?.uom || '') }, { h: 'Deliv. date', f: (r, i) => I(`items.${i}.date`, { w: 10, ph: 'DD.MM.YYYY' }) }], c.m.items)) +
    '<div class="tip">One RFQ is created per supplier, all linked by the same <b>collective number</b>. Enter the suppliers\' prices later with <b>ME47</b> and compare them with <b>ME49</b>.</div>',
  enter: c => {
    const m = c.m;
    ['v1', 'v2', 'v3'].forEach(k => { m[k] = m[k].trim(); if (m[k]) needVendor(m[k], '1010', k); });
    m.items.forEach((it, i) => { if (!String(it.matnr).trim()) return; it.matnr = U(it.matnr); needMat(it.matnr, '1010', `items.${i}.matnr`); if (!it.date) it.date = fmtD(dPlus(14)); });
  },
  save: c => {
    TX.ME41.enter(c); const m = c.m;
    const vendors = [...new Set([m.v1, m.v2, m.v3].filter(Boolean))];
    if (!vendors.length) err('Enter at least one supplier', null, 'v1');
    const dl = needDate(c, 'deadline'); if (dl < today()) err('Quotation deadline is in the past', null, 'deadline');
    const items = m.items.map((it, i) => ({ it, i })).filter(x => x.it.matnr).map(({ it, i }) => { const q = N(it.qty); if (!(q > 0)) err(`Item ${(i + 1) * 10}: enter a quantity`, null, `items.${i}.qty`); const d = parseD(it.date); if (!d) err('Enter a valid date (DD.MM.YYYY)', null, `items.${i}.date`); const M = S.materials[it.matnr]; return { item: (i + 1) * 10, matnr: it.matnr, short: M.desc, qty: q, uom: M.uom, date: d, price: null }; });
    if (!items.length) err('Enter at least one item', null, 'items.0.matnr');
    const coll = m.coll.trim().toUpperCase() || `COLL-${pad(S.seq.coll++, 4)}`;
    const nums = vendors.map(v => { const num = nextNo('rfq'); S.rfqs[num] = { num, coll, vendor: v, deadline: dl, date: today(), items: items.map(x => ({ ...x })), status: 'open', po: '' }; return num; });
    emit('RFQ_CREATED', { nums, coll, vendors, items: items.map(x => ({ matnr: x.matnr, qty: x.qty })) });
    c.m = TX.ME41.init(); msg('S', `RFQ ${nums[0]} created${nums.length > 1 ? ` (+${nums.length - 1} more: ${nums.slice(1).join(', ')})` : ''} · collective number ${coll}`);
  }
};
const rfqView = (R, edit) => box(`RFQ ${R.num} · ${R.vendor} ${esc(vname(R.vendor))}`, `<table class="g orgtbl"><tr><td>Collective number</td><td>${esc(R.coll)}</td></tr><tr><td>Quotation deadline</td><td>${fmtD(R.deadline)}</td></tr><tr><td>Status</td><td>${{ open: '<span class="badge">Open</span>', quoted: '<span class="badge warn">Quotation received</span>', rejected: '<span class="badge err">Rejected</span>', awarded: `<span class="badge ok">Awarded · PO ${R.po}</span>` }[R.status]}</td></tr></table>`) +
  box('Items', grid([{ h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Short text', k: 'short' }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'Unit', k: 'uom' }, { h: 'Deliv. date', f: r => fmtD(r.date) }, { h: 'Net price', f: (r, i) => edit ? I(`items.${i}.price`, { w: 8, num: 1 }) : r.price != null ? money(r.price) : '—' }, { h: 'Net value', r: 1, f: r => r.price != null ? money(r.price * r.qty) : '' }], R.items));
const rfqTx = (title, mode) => ({
  title: c => c.m.show ? `${title}: ${c.m.rfq}` : `${title}: Initial Screen`,
  init: p => ({ rfq: p.rfq || '', show: false, items: [], rej: false, _auto: !!p.rfq }),
  onOpen: c => { if (c.m._auto) TX[mode].enter(c); },
  render: c => {
    if (!c.m.show) return box('RFQ', F('RFQ', 'rfq', { req: 1, f4: 'rfq', w: 12 })) + (mode === 'ME47' ? '<div class="tip">Enter the RFQ number and press Enter, then type the prices from the supplier\'s quotation and save.</div>' : '');
    const R = S.rfqs[c.m.rfq];
    if (mode === 'ME47') return rfqView({ ...R, items: c.m.items }, true) + box('Quotation', F('Rejection indicator', 'rej', { type: 'check', desc: 'Supplier declined / quotation rejected' }));
    if (mode === 'ME42') return box(`RFQ ${R.num}`, F('Quotation deadline', 'deadline', { w: 10 })) + box('Items', grid([{ h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Quantity', f: (r, i) => I(`items.${i}.qty`, { w: 7, num: 1 }) }, { h: 'Unit', k: 'uom' }], c.m.items));
    return rfqView(R, false);
  },
  enter: c => {
    if (c.m.show) return;
    req(c, ['rfq']); c.m.rfq = c.m.rfq.trim();
    const R = S.rfqs[c.m.rfq]; if (!R) err(`RFQ ${c.m.rfq} does not exist`, null, 'rfq');
    if (mode !== 'ME43' && mode !== 'ME48' && R.status === 'awarded') err(`RFQ ${R.num} is already awarded (PO ${R.po}): no changes possible`, null, 'rfq');
    c.m.items = R.items.map(x => ({ ...x, price: x.price != null ? x.price.toFixed(2) : '', qty: mode === 'ME42' ? String(x.qty) : x.qty })); c.m.rej = R.status === 'rejected'; c.m.deadline = fmtD(R.deadline); c.m.show = true;
    if (mode === 'ME43' || mode === 'ME48') emit('RFQ_DISPLAY', { num: R.num });
  },
  save: c => {
    if (mode === 'ME43' || mode === 'ME48') return;
    if (!c.m.show) err('Enter an RFQ and press Enter first', null, 'rfq');
    const R = S.rfqs[c.m.rfq];
    if (mode === 'ME42') { const d = needDate(c, 'deadline'); c.m.items.forEach((x, i) => { const q = N(x.qty); if (!(q > 0)) err('Enter a quantity', null, `items.${i}.qty`); }); R.deadline = d; R.items.forEach((x, i) => { x.qty = N(c.m.items[i].qty); }); emit('RFQ_CHANGED', { num: R.num }); c.m = TX.ME42.init({}); msg('S', `RFQ ${R.num} changed`); return; }
    if (!c.m.rej) c.m.items.forEach((x, i) => { const p = N(x.price); if (!(p > 0)) err(`Item ${x.item}: enter the quoted net price`, null, `items.${i}.price`); });
    R.items.forEach((x, i) => { x.price = c.m.rej ? null : r2(N(c.m.items[i].price)); });
    R.status = c.m.rej ? 'rejected' : 'quoted';
    emit('QUOTE_ENTERED', { num: R.num, coll: R.coll, vendor: R.vendor, rejected: c.m.rej });
    c.m = TX.ME47.init({}); msg('S', `Quotation ${R.num} saved${R.status === 'rejected' ? ' (rejected)' : ''}`);
  },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
});
TX.ME42 = rfqTx('Change RFQ', 'ME42'); TX.ME43 = rfqTx('Display RFQ', 'ME43'); TX.ME47 = rfqTx('Maintain Quotation', 'ME47'); TX.ME48 = rfqTx('Display Quotation', 'ME48');
TX.ME49 = {
  title: c => c.m.list ? `Price Comparison List · collective number ${c.m.coll}` : 'Price Comparison List',
  init: () => ({ coll: '', list: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.ME49.exec) }],
  acts: { po: (c, d) => { const R = S.rfqs[d.rfq]; call('ME21N', { vendor: R.vendor, src: `quotation ${R.num}`, items: R.items.map(x => ({ matnr: x.matnr, qty: x.qty, price: x.price, date: fmtD(x.date < today() ? dPlus(7) : x.date), rfq: R.num })) }, true); } },
  render: c => {
    if (!c.m.list) return box('Selection', F('Collective number', 'coll', { req: 1, f4: 'coll', w: 12 }) + F('Purch. org.', '_p', { ro: 1, w: 6, desc: '1010' })) + '<div class="tip">Compares all quotations with the same collective number. Press <b>F8</b>.</div>';
    const rs = Object.values(S.rfqs).filter(r => r.coll === c.m.coll);
    const tot = r => r.price == null ? null : 0;
    const totals = rs.map(r => r.items.every(i => i.price != null) ? r2(sum(r.items, i => i.price * i.qty)) : null);
    const valid = totals.filter(x => x != null); const best = valid.length ? Math.min(...valid) : null;
    const rank = t => t == null ? '' : 1 + valid.filter(x => x < t).length;
    const items = rs[0].items;
    const head = `<tr><th>Material</th><th class="r">Quantity</th>${rs.map(r => `<th class="r">${r.vendor}<br><span class="muted small">${esc(vname(r.vendor))}</span></th>`).join('')}</tr>`;
    const rows = items.map((it, ix) => { const ps = rs.map(r => r.items[ix].price); const mn = Math.min(...ps.filter(p => p != null)); return `<tr><td>${it.matnr} <span class="muted">${esc(it.short)}</span></td><td class="r">${qf(it.qty)} ${it.uom}</td>${ps.map(p => `<td class="r" style="${p === mn ? 'font-weight:700;color:#107e3e' : ''}">${p == null ? '—' : money(p)}</td>`).join('')}</tr>`; }).join('');
    const foot = `<tr class="tot"><td colspan="2">Total net value</td>${totals.map(t => `<td class="r">${t == null ? '—' : money(t)}</td>`).join('')}</tr><tr><td colspan="2">Rank</td>${totals.map(t => `<td class="r">${t == null ? '' : (t === best ? '🏆 ' : '') + rank(t)}</td>`).join('')}</tr>
      <tr><td colspan="2">Status</td>${rs.map(r => `<td class="r">${r.status}${r.status === 'quoted' ? `<br><button type="button" class="btn sm" data-act="po" data-rfq="${r.num}">Create PO ▸</button>` : r.status === 'awarded' ? `<br>${lnk('ME23N', { po: r.po }, r.po)}` : ''}</td>`).join('')}</tr>`;
    return box(`Quotations for ${esc(c.m.coll)} (${rs.length} suppliers)`, `<div class="tw"><table class="g">${head}${rows}${foot}</table></div>`) + '<div class="tip">The lowest price per item is shown in green, the cheapest quotation overall is ranked 🏆 1. <b>Create PO</b> copies the quotation into ME21N; when you save, that quotation is <b>awarded</b> and the others are rejected.</div>';
  },
  enter: c => TX.ME49.exec(c),
  exec: c => { if (c.m.list) return; req(c, ['coll']); c.m.coll = c.m.coll.trim().toUpperCase(); if (!Object.values(S.rfqs).some(r => r.coll === c.m.coll)) err(`No RFQs found for collective number ${c.m.coll}`, null, 'coll'); c.m.list = true; emit('REPORT', { tcode: 'ME49', coll: c.m.coll }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};

// ======================================================================
// Contracts
// ======================================================================
const blankK = () => ({ matnr: '', target: '', price: '' });
TX.ME31K = {
  title: c => c.m.step === 2 ? `Create ${c.m.type === 'MK' ? 'Quantity' : 'Value'} Contract: Item Overview` : 'Create Contract: Initial Screen',
  init: () => ({ step: 1, vendor: '', type: 'MK', porg: '1010', pgrp: '001', from: fmtD(today()), to: fmtD(dPlus(365)), targetVal: '', items: [blankK(), blankK(), blankK()] }),
  render: c => {
    const m = c.m;
    const hdr = F('Supplier', 'vendor', { req: 1, f4: 'vendor', w: 10, ro: m.step === 2, desc: vname(m.vendor.trim()) }) + F('Agreement type', 'type', { type: 'select', opts: { MK: 'MK Quantity contract', WK: 'WK Value contract' }, ro: m.step === 2 }) + F('Purch. org. / group', 'pgrp', { f4: 'pgrp', w: 4, desc: `Purch. org. 1010 · ${ORG.pgrps[m.pgrp] || ''}` });
    if (m.step === 1) return box('Agreement', hdr) + '<div class="tip">A contract is a long-term outline agreement with a supplier: a <b>quantity contract</b> (MK) fixes a target quantity per item, a <b>value contract</b> (WK) a total target value. POs referencing the contract are called <b>release orders</b>.</div>';
    return box('Header data', `<div class="cols"><div>${hdr}</div><div>${F('Validity start', 'from', { req: 1, w: 10 })}${F('Validity end', 'to', { req: 1, w: 10 })}${m.type === 'WK' ? F('Target value (EUR)', 'targetVal', { req: 1, num: 1, w: 12 }) : ''}</div></div>`) +
      box('Item overview', grid([{ h: 'Item', f: (r, i) => (i + 1) * 10 }, { h: 'Material', f: (r, i) => I(`items.${i}.matnr`, { f4: 'mat', w: 9 }) }, { h: 'Short text', f: r => esc(S.materials[U(r.matnr)]?.desc || '') }, ...(m.type === 'MK' ? [{ h: 'Target qty', f: (r, i) => I(`items.${i}.target`, { w: 8, num: 1 }) }] : []), { h: 'OUn', f: r => esc(S.materials[U(r.matnr)]?.uom || '') }, { h: 'Net price', f: (r, i) => I(`items.${i}.price`, { w: 8, num: 1 }) }], m.items));
  },
  enter: c => {
    const m = c.m;
    if (m.step === 1) { req(c, ['vendor']); m.vendor = m.vendor.trim(); needVendor(m.vendor, '1010', 'vendor'); m.step = 2; return; }
    m.items.forEach((it, i) => { if (!String(it.matnr).trim()) return; it.matnr = U(it.matnr); const M = needMat(it.matnr, '1010', `items.${i}.matnr`); if (it.price === '') { const inf = findInfo(m.vendor, it.matnr, '1010', '1010'); if (inf) it.price = (inf.price / inf.per).toFixed(2); } });
  },
  save: c => {
    const m = c.m; if (m.step === 1) err('Press Enter to go to the item overview first');
    TX.ME31K.enter(c);
    const from = needDate(c, 'from'), to = needDate(c, 'to'); if (to <= from) err('Validity end must be after validity start', null, 'to');
    if (m.type === 'WK' && !(N(m.targetVal) > 0)) err('Enter a target value', null, 'targetVal');
    const items = m.items.map((it, i) => ({ it, i })).filter(x => x.it.matnr).map(({ it, i }) => { const p = N(it.price); if (!(p > 0)) err(`Item ${(i + 1) * 10}: enter a net price`, null, `items.${i}.price`); const t = N(it.target); if (m.type === 'MK' && !(t > 0)) err(`Item ${(i + 1) * 10}: enter a target quantity`, null, `items.${i}.target`); const M = S.materials[it.matnr]; return { item: (i + 1) * 10, matnr: it.matnr, short: M.desc, uom: M.uom, target: m.type === 'MK' ? t : 0, price: r2(p) }; });
    if (!items.length) err('Enter at least one item', null, 'items.0.matnr');
    const num = nextNo('ctr');
    S.contracts[num] = { num, type: m.type, vendor: m.vendor, porg: '1010', pgrp: m.pgrp, from, to, targetVal: m.type === 'WK' ? r2(N(m.targetVal)) : 0, date: today(), items };
    emit('CTR_CREATED', { num, vendor: m.vendor, ctype: m.type, items: items.map(x => ({ matnr: x.matnr, target: x.target, price: x.price })) });
    c.m = TX.ME31K.init(); msg('S', `Contract ${num} created`);
  },
  back: c => { if (c.m.step === 2) { c.m.step = 1; return true; } }
};
const ctrView = K => {
  const rel = Object.values(S.pos).flatMap(P => P.items.filter(it => it.agmt === K.num && !it.del).map(it => ({ ...it, po: P.num, docDate: P.docDate })));
  const u = ctrUsage(K.num); const pct = K.type === 'WK' ? (K.targetVal ? u.value / K.targetVal * 100 : 0) : null;
  return box(`${K.type === 'MK' ? 'Quantity' : 'Value'} contract ${K.num} · ${K.vendor} ${esc(vname(K.vendor))}`, `<table class="g orgtbl"><tr><td>Validity</td><td>${fmtD(K.from)} – ${fmtD(K.to)} ${K.to < today() ? '<span class="badge err">Expired</span>' : '<span class="badge ok">Valid</span>'}</td></tr>${K.type === 'WK' ? `<tr><td>Target value</td><td>${money(K.targetVal)} EUR · released ${money(u.value)} EUR (${pct.toFixed(1)}%)</td></tr>` : ''}</table>`) +
    box('Items', grid([{ h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Short text', k: 'short' }, ...(K.type === 'MK' ? [{ h: 'Target qty', r: 1, f: r => qf(r.target) }, { h: 'Released qty', r: 1, f: r => qf(ctrUsage(K.num, r.item).qty) }, { h: 'Open target qty', r: 1, f: r => qf(Math.max(0, r.target - ctrUsage(K.num, r.item).qty)) }] : []), { h: 'Net price', r: 1, f: r => money(r.price) }, { h: 'OUn', k: 'uom' }], K.items)) +
    box('Release documentation (release orders)', grid([{ h: 'Purchase order', f: r => lnk('ME23N', { po: r.po }, r.po) }, { h: 'Item', k: 'item' }, { h: 'Contract item', k: 'agmtItem' }, { h: 'Doc. date', f: r => fmtD(r.docDate) }, { h: 'Material', k: 'matnr' }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'Net value', r: 1, f: r => money(r.qty * r.price) }], rel, { empty: 'No release orders yet: create a PO with this contract in the Agreement column' }));
};
TX.ME33K = {
  title: c => c.m.show ? `Display Contract ${c.m.ctr}` : 'Display Contract: Initial Screen',
  init: p => ({ ctr: p.ctr || '', show: false, _auto: !!p.ctr }),
  onOpen: c => { if (c.m._auto) TX.ME33K.enter(c); },
  render: c => c.m.show ? ctrView(S.contracts[c.m.ctr]) : box('Agreement', F('Agreement', 'ctr', { req: 1, f4: 'ctr', w: 12 })),
  enter: c => { if (c.m.show) return; req(c, ['ctr']); c.m.ctr = c.m.ctr.trim(); if (!S.contracts[c.m.ctr]) err(`Contract ${c.m.ctr} does not exist`, null, 'ctr'); c.m.show = true; emit('CTR_DISPLAY', { num: c.m.ctr }); },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
};
TX.ME32K = {
  title: c => c.m.show ? `Change Contract ${c.m.ctr}` : 'Change Contract: Initial Screen',
  init: () => ({ ctr: '', show: false }),
  render: c => {
    if (!c.m.show) return box('Agreement', F('Agreement', 'ctr', { req: 1, f4: 'ctr', w: 12 }));
    const K = S.contracts[c.m.ctr];
    return box(`Contract ${K.num}`, F('Validity end', 'to', { req: 1, w: 10 }) + (K.type === 'WK' ? F('Target value', 'targetVal', { num: 1, w: 12 }) : '')) + box('Items', grid([{ h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, ...(K.type === 'MK' ? [{ h: 'Target qty', f: (r, i) => I(`items.${i}.target`, { w: 8, num: 1 }) }] : []), { h: 'Net price', f: (r, i) => I(`items.${i}.price`, { w: 8, num: 1 }) }], c.m.items)) + '<div class="tip">A new price applies to release orders created from now on; existing POs keep their price.</div>';
  },
  enter: c => { if (c.m.show) return; req(c, ['ctr']); c.m.ctr = c.m.ctr.trim(); const K = S.contracts[c.m.ctr]; if (!K) err(`Contract ${c.m.ctr} does not exist`, null, 'ctr'); Object.assign(c.m, { show: true, to: fmtD(K.to), targetVal: String(K.targetVal || ''), items: K.items.map(x => ({ ...x, target: String(x.target), price: x.price.toFixed(2) })) }); },
  save: c => {
    if (!c.m.show) err('Enter a contract and press Enter first', null, 'ctr');
    const K = S.contracts[c.m.ctr]; const to = needDate(c, 'to'); if (to <= K.from) err('Validity end must be after validity start', null, 'to');
    c.m.items.forEach((x, i) => { if (!(N(x.price) > 0)) err('Enter a net price', null, `items.${i}.price`); });
    K.to = to; if (K.type === 'WK') K.targetVal = r2(N(c.m.targetVal) || K.targetVal);
    K.items.forEach((x, i) => { x.price = r2(N(c.m.items[i].price)); if (K.type === 'MK') x.target = N(c.m.items[i].target) || x.target; });
    emit('CTR_CHANGED', { num: K.num }); c.m = TX.ME32K.init(); msg('S', `Contract ${K.num} changed`);
  },
  back: c => { if (c.m.show) { c.m.show = false; return true; } }
};

// ======================================================================
// Scheduling agreements (stored as purchasing documents of type LP)
// ======================================================================
TX.ME31L = {
  title: 'Create Scheduling Agreement',
  init: () => ({ vendor: '', from: fmtD(today()), to: fmtD(dPlus(365)), items: [{ matnr: '', target: '', price: '' }, { matnr: '', target: '', price: '' }] }),
  render: c => box('Header data', `<div class="cols"><div>${F('Supplier', 'vendor', { req: 1, f4: 'vendor', w: 10, desc: vname(c.m.vendor.trim()) })}${F('Agreement type', '_t', { ro: 1, w: 4, desc: 'LP Scheduling agreement' })}</div><div>${F('Validity start', 'from', { req: 1, w: 10 })}${F('Validity end', 'to', { req: 1, w: 10 })}</div></div>`) +
    box('Item overview', grid([{ h: 'Item', f: (r, i) => (i + 1) * 10 }, { h: 'Material', f: (r, i) => I(`items.${i}.matnr`, { f4: 'mat', w: 9 }) }, { h: 'Short text', f: r => esc(S.materials[U(r.matnr)]?.desc || '') }, { h: 'Target qty', f: (r, i) => I(`items.${i}.target`, { w: 8, num: 1 }) }, { h: 'Net price', f: (r, i) => I(`items.${i}.price`, { w: 8, num: 1 }) }], c.m.items)) +
    '<div class="tip">A scheduling agreement fixes material, price and total quantity for a period. Deliveries are called off with <b>delivery schedule lines</b> (ME38); each due line can then be received in MIGO with the agreement number.</div>',
  enter: c => { const m = c.m; m.vendor = m.vendor.trim(); if (m.vendor) needVendor(m.vendor, '1010', 'vendor'); m.items.forEach((it, i) => { if (!String(it.matnr).trim()) return; it.matnr = U(it.matnr); needMat(it.matnr, '1010', `items.${i}.matnr`); if (it.price === '' && m.vendor) { const inf = findInfo(m.vendor, it.matnr, '1010', '1010'); if (inf) it.price = (inf.price / inf.per).toFixed(2); } }); },
  save: c => {
    TX.ME31L.enter(c); const m = c.m; req(c, ['vendor']);
    const from = needDate(c, 'from'), to = needDate(c, 'to'); if (to <= from) err('Validity end must be after validity start', null, 'to');
    const items = m.items.map((it, i) => ({ it, i })).filter(x => x.it.matnr).map(({ it, i }) => { const t = N(it.target), p = N(it.price); if (!(t > 0)) err('Enter a target quantity', null, `items.${i}.target`); if (!(p > 0)) err('Enter a net price', null, `items.${i}.price`); const M = S.materials[it.matnr]; return { item: (i + 1) * 10, matnr: it.matnr, short: M.desc, uom: M.uom, qty: 0, target: t, price: r2(p), per: 1, plant: '1010', sloc: M.plants['1010'].slocs[0], date: from, grBased: true, cat: '', sched: [], conds: { gross: r2(p), disc: 0, frt: 0, src: 'Scheduling agreement' } }; });
    if (!items.length) err('Enter at least one item', null, 'items.0.matnr');
    const num = nextNo('sa');
    S.pos[num] = { num, type: 'LP', vendor: m.vendor, porg: '1010', pgrp: '001', cc: '1010', docDate: today(), from, to, history: [], items, ers: !!S.vendors[m.vendor]?.porg?.['1010']?.ers };
    HOOKS.poCreate.forEach(f => f(S.pos[num]));
    emit('SA_CREATED', { num, vendor: m.vendor });
    c.m = TX.ME31L.init(); msg('S', `Scheduling agreement ${num} created`);
  }
};
TX.ME38 = {
  title: c => c.m.show ? `Maintain Delivery Schedule: ${c.m.sa}` : 'Maintain Sched. Agreement Schedule: Initial Screen',
  init: p => ({ sa: p.sa || '', show: false, sel: 0, lines: [] }),
  acts: { sel: (c, d) => { TX.ME38.syncLines(c); c.m.sel = +d.i; c.m.lines = TX.ME38.linesFor(c); } },
  linesFor: c => { const it = S.pos[c.m.sa].items[c.m.sel]; const ls = it.sched.map(x => ({ date: fmtD(x.date), qty: String(x.qty), fixed: true })); for (let k = 0; k < 3; k++) ls.push({ date: '', qty: '' }); return ls; },
  syncLines: () => {},
  render: c => {
    if (!c.m.show) return box('Agreement', F('Agreement', 'sa', { req: 1, f4: 'sa', w: 12 }));
    const P = S.pos[c.m.sa], it = P.items[c.m.sel];
    return box(`Scheduling agreement ${P.num} · ${P.vendor} ${esc(vname(P.vendor))}`, grid([{ h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Target qty', r: 1, f: r => qf(r.target) }, { h: 'Scheduled', r: 1, f: r => qf(r.qty) }, { h: 'Delivered', r: 1, f: r => qf(poTotals(P, r).gr) }, { h: 'Net price', r: 1, f: r => money(r.price) }], P.items.map((r, i) => ({ ...r, _cls: i === c.m.sel ? 'on' : '' })), { click: (r, i) => `data-act="sel" data-i="${i}"` })) +
      box(`Delivery schedule · item ${it.item} ${it.matnr}`, grid([{ h: 'Delivery date', f: (r, i) => r.fixed ? r.date : I(`lines.${i}.date`, { w: 10, ph: 'DD.MM.YYYY' }) }, { h: 'Scheduled qty', f: (r, i) => r.fixed ? qf(N(r.qty)) : I(`lines.${i}.qty`, { w: 8, num: 1 }) }, { h: '', f: r => r.fixed ? '<span class="muted small">saved</span>' : '' }], c.m.lines)) +
      '<div class="tip">Add schedule lines (date + quantity) and save. The scheduled quantity becomes receivable in MIGO (A01 / R01 with the agreement number).</div>';
  },
  enter: c => { if (c.m.show) return; req(c, ['sa']); c.m.sa = c.m.sa.trim(); const P = S.pos[c.m.sa]; if (!P || P.type !== 'LP') err(`Scheduling agreement ${c.m.sa} does not exist`, null, 'sa'); c.m.show = true; c.m.lines = TX.ME38.linesFor(c); },
  save: c => {
    if (!c.m.show) err('Enter an agreement and press Enter first', null, 'sa');
    const P = S.pos[c.m.sa], it = P.items[c.m.sel];
    const add = c.m.lines.map((l, i) => ({ l, i })).filter(x => !x.l.fixed && (x.l.date || x.l.qty)).map(({ l, i }) => { const d = parseD(l.date); if (!d) err('Enter a valid date (DD.MM.YYYY)', null, `lines.${i}.date`); if (d < P.from || d > P.to) err(`Date outside agreement validity (${fmtD(P.from)}–${fmtD(P.to)})`, null, `lines.${i}.date`); const q = N(l.qty); if (!(q > 0)) err('Enter a quantity', null, `lines.${i}.qty`); return { date: d, qty: q }; });
    if (!add.length) err('Enter at least one new schedule line', null, 'lines.0.date');
    const total = r3(it.qty + sum(add, x => x.qty));
    if (total > it.target + 1e-9) msg('W', `Target quantity ${qf(it.target)} exceeded (${qf(total)})`);
    it.sched.push(...add); it.sched.sort((a, b) => a.date < b.date ? -1 : 1); it.qty = total; it.date = it.sched.find(x => true)?.date || it.date;
    emit('SCHED_SAVED', { sa: P.num, item: it.item, qty: total });
    c.m.lines = TX.ME38.linesFor(c); msg('S', `Scheduling agreement ${P.num} changed: ${qf(total)} ${it.uom} scheduled`);
  },
  back: c => { if (c.m.show) { c.m.show = false; return true; } }
};
TX.ME33L = {
  title: c => c.m.show ? `Display Scheduling Agreement ${c.m.sa}` : 'Display Scheduling Agreement: Initial Screen',
  init: p => ({ sa: p.sa || '', show: false }),
  render: c => {
    if (!c.m.show) return box('Agreement', F('Agreement', 'sa', { req: 1, f4: 'sa', w: 12 }));
    const P = S.pos[c.m.sa];
    return box(`Scheduling agreement ${P.num} · ${P.vendor} ${esc(vname(P.vendor))} · valid ${fmtD(P.from)}–${fmtD(P.to)}`, P.items.map(it => `<h4>Item ${it.item} ${it.matnr} ${esc(it.short)} · target ${qf(it.target)} ${it.uom} · ${money(it.price)} EUR</h4>` + grid([{ h: 'Delivery date', f: r => fmtD(r.date) }, { h: 'Scheduled', r: 1, f: r => qf(r.qty) }], it.sched, { empty: 'No schedule lines yet (ME38)' }) + `<p class="small">Delivered so far: <b>${qf(poTotals(P, it).gr)}</b> · invoiced: <b>${qf(poTotals(P, it).ir)}</b> · ${lnk('ME23N', { po: P.num }, 'history in ME23N')}</p>`).join(''));
  },
  enter: c => { if (c.m.show) return; req(c, ['sa']); c.m.sa = c.m.sa.trim(); const P = S.pos[c.m.sa]; if (!P || P.type !== 'LP') err(`Scheduling agreement ${c.m.sa} does not exist`, null, 'sa'); c.m.show = true; emit('SA_DISPLAY', { num: P.num }); },
  back: c => { if (c.m.show) { c.m.show = false; return true; } }
};

// ======================================================================
// Source list
// ======================================================================
const blankSL = () => ({ from: fmtD(today()), to: fmtD(dPlus(365)), vendor: '', agmt: '', fixed: false, blocked: false, mrp: true });
const srcTx = ro => ({
  title: c => c.m.show ? `${ro ? 'Display' : 'Maintain'} Source List: Overview Screen` : `${ro ? 'Display' : 'Maintain'} Source List: Initial Screen`,
  init: p => ({ matnr: p.matnr || '', plant: '1010', show: false, rows: [] }),
  tb: c => c.m.show && !ro ? [{ l: 'Add line', i: '＋', a: c => act(c => c.m.rows.push(blankSL())) }] : [],
  render: c => {
    if (!c.m.show) return box('Source list', F('Material', 'matnr', { req: 1, f4: 'mat', w: 18 }) + F('Plant', 'plant', { f4: 'plant', w: 6 })) + '<div class="tip">The source list says which suppliers (or agreements) may supply a material in a plant and for which period. A <b>fixed</b> source is proposed automatically in requisitions, ME59N and MRP.</div>';
    const M = S.materials[c.m.matnr];
    return box(`Material ${M.matnr} ${esc(M.desc)} · Plant 1010`, grid([{ h: 'Valid from', f: (r, i) => ro ? fmtD(parseD(r.from)) : I(`rows.${i}.from`, { w: 10 }) }, { h: 'Valid to', f: (r, i) => ro ? fmtD(parseD(r.to)) : I(`rows.${i}.to`, { w: 10 }) }, { h: 'Supplier', f: (r, i) => ro ? `${r.vendor} ${esc(vname(r.vendor))}` : I(`rows.${i}.vendor`, { f4: 'vendor', w: 8 }) }, { h: 'POrg', f: () => '1010' }, { h: 'Agreement', f: (r, i) => ro ? r.agmt : I(`rows.${i}.agmt`, { f4: 'ctr', w: 10 }) },
      { h: 'Fix', f: (r, i) => I(`rows.${i}.fixed`, { type: 'check', ro }) }, { h: 'Blk', f: (r, i) => I(`rows.${i}.blocked`, { type: 'check', ro }) }, { h: 'MRP', f: (r, i) => I(`rows.${i}.mrp`, { type: 'check', ro }) }], c.m.rows, { empty: 'No source list records' }));
  },
  enter: c => {
    if (c.m.show) return; req(c, ['matnr']); c.m.matnr = U(c.m.matnr); needMat(c.m.matnr, '1010', 'matnr');
    c.m.rows = (S.srclist[c.m.matnr] || []).map(r => ({ ...r, from: fmtD(r.from), to: fmtD(r.to) })); if (!ro && !c.m.rows.length) c.m.rows.push(blankSL()); c.m.show = true;
    if (ro) emit('SRC_DISPLAY', { matnr: c.m.matnr });
  },
  save: c => {
    if (ro) return; if (!c.m.show) err('Enter a material and press Enter first', null, 'matnr');
    const rows = c.m.rows.map((r, i) => ({ r, i })).filter(x => String(x.r.vendor).trim()).map(({ r, i }) => {
      const v = String(r.vendor).trim(); needVendor(v, '1010', `rows.${i}.vendor`);
      const f = parseD(r.from), t = parseD(r.to); if (!f) err('Enter a valid date (DD.MM.YYYY)', null, `rows.${i}.from`); if (!t || t < f) err('Valid-to date must be after valid-from', null, `rows.${i}.to`);
      const a = String(r.agmt || '').trim(); if (a) { const K = S.contracts[a]; if (!K) err(`Contract ${a} does not exist`, null, `rows.${i}.agmt`); if (K.vendor !== v) err(`Contract ${a} belongs to supplier ${K.vendor}`, null, `rows.${i}.agmt`); if (!K.items.some(x => x.matnr === c.m.matnr)) err(`Material ${c.m.matnr} is not in contract ${a}`, null, `rows.${i}.agmt`); }
      return { from: f, to: t, vendor: v, porg: '1010', agmt: a, fixed: !!r.fixed, blocked: !!r.blocked, mrp: !!r.mrp };
    });
    const fixedOverlap = rows.filter(r => r.fixed && !r.blocked);
    for (let a = 0; a < fixedOverlap.length; a++) for (let b = a + 1; b < fixedOverlap.length; b++) if (fixedOverlap[a].from <= fixedOverlap[b].to && fixedOverlap[b].from <= fixedOverlap[a].to) err('Only one fixed source is allowed per period (overlapping fixed sources)');
    S.srclist[c.m.matnr] = rows;
    emit('SRC_SAVED', { matnr: c.m.matnr, rows: rows.map(r => ({ vendor: r.vendor, agmt: r.agmt, fixed: r.fixed })) });
    const mt = c.m.matnr; c.m = TX.ME01.init({}); msg('S', `Source list for material ${mt} saved (${rows.length} record${rows.length === 1 ? '' : 's'})`);
  },
  back: c => { if (c.m.show) { c.m.show = false; return true; } }
});
TX.ME01 = srcTx(false); TX.ME03 = srcTx(true); TX.ME04 = srcTx(true);

// ======================================================================
// ME22N / ME52N change
// ======================================================================
TX.ME22N = {
  title: c => c.m.show ? `Standard PO ${c.m.po} Change` : 'Change Purchase Order',
  init: p => ({ po: p.po || '', show: false, items: [], _auto: !!p.po }),
  onOpen: c => { if (c.m._auto) TX.ME22N.enter(c); },
  render: c => {
    if (!c.m.show) return box('Purchase order', F('Purchase order', 'po', { req: 1, f4: 'po', w: 12 }));
    const P = S.pos[c.m.po];
    return box(`Standard PO ${P.num} · ${P.vendor} ${esc(vname(P.vendor))}`, grid([{ h: 'Itm', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Short text', k: 'short' }, { h: 'PO quantity', f: (r, i) => r._del0 ? qf(r.qty) : I(`items.${i}.qty`, { w: 7, num: 1 }) }, { h: 'Delivered', r: 1, f: r => qf(r._gr) }, { h: 'Net price', f: (r, i) => r.cat === 'K' || r._del0 ? money(N(r.price)) : I(`items.${i}.price`, { w: 8, num: 1 }) }, { h: 'Deliv. date', f: (r, i) => r._del0 ? r.date : I(`items.${i}.date`, { w: 10 }) }, { h: 'Delete', f: (r, i) => I(`items.${i}.del`, { type: 'check', ro: r._del0 }) }], c.m.items)) +
      '<div class="tip">You cannot reduce the quantity below what has already been delivered. The <b>deletion indicator</b> closes the item: no further goods receipts; invoices for goods already received are still possible. Changing price or quantity may restart release approval.</div>';
  },
  enter: c => { if (c.m.show) return; req(c, ['po']); c.m.po = c.m.po.trim(); const P = S.pos[c.m.po]; if (!P) err(`Purchasing document ${c.m.po} does not exist`, null, 'po'); if (P.type === 'LP') err(`${P.num} is a scheduling agreement: use ME38 to change its schedule`, null, 'po'); c.m.items = P.items.map(it => ({ ...it, qty: String(it.qty), price: it.price.toFixed(2), date: fmtD(it.date), del: !!it.del, _del0: !!it.del, _gr: poTotals(P, it).gr })); c.m.show = true; },
  save: c => {
    if (!c.m.show) err('Enter a purchase order and press Enter first', null, 'po');
    const P = S.pos[c.m.po]; const changes = [];
    const oldVal = r2(sum(P.items.filter(x => !x.del), x => x.qty * x.price / x.per));
    c.m.items.forEach((x, i) => {
      const it = P.items[i]; if (x._del0) return;
      const q = N(x.qty), p = it.cat === 'K' ? it.price : N(x.price), d = parseD(x.date);
      if (!(q > 0)) err('Enter a quantity', null, `items.${i}.qty`);
      if (q < x._gr - 1e-9) err(`Item ${pad(it.item, 5)}: quantity cannot be less than the delivered quantity ${qf(x._gr)}`, 'QTY_BELOW_GR', `items.${i}.qty`);
      if (it.cat !== 'K' && !(p > 0)) err('Net price must be greater than 0', null, `items.${i}.price`);
      if (!d) err('Enter a valid date (DD.MM.YYYY)', null, `items.${i}.date`);
      if (x.del && poTotals(P, it).toInvoice > 1e-9 && false) err('');
      if (q !== it.qty) changes.push(`item ${it.item} qty ${qf(it.qty)}→${qf(q)}`);
      if (r2(p) !== it.price) changes.push(`item ${it.item} price ${money(it.price)}→${money(p)}`);
      if (d !== it.date) changes.push(`item ${it.item} date`);
      if (x.del) changes.push(`item ${it.item} deleted`);
      Object.assign(it, { qty: q, price: r2(p), date: d, del: !!x.del });
      if (it.price !== r2(p) || (it.conds && condNet(it.conds) !== it.price)) it.conds = { gross: it.price, disc: 0, frt: 0, src: 'Changed manually (ME22N)' };
      if (it.cat === 'L' && it.comps) it.comps = S.boms[it.matnr].map(b => ({ matnr: b.comp, qty: r3(b.qty * q) }));
    });
    if (!changes.length) { msg('I', 'No data was changed'); return; }
    const newVal = r2(sum(P.items.filter(x => !x.del), x => x.qty * x.price / x.per));
    (HOOKS.poChange || []).forEach(f => f(P, oldVal, newVal));
    emit('PO_CHANGED', { num: P.num, changes, del: c.m.items.some(x => x.del && !x._del0) });
    const n = P.num; c.m = TX.ME22N.init({}); msg('S', `Standard PO ${n} changed${P.relReq && !P.released ? ' (release required again)' : ''}`);
  },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
};
HOOKS.poChange = HOOKS.poChange || [];
TX.ME52N = {
  title: c => c.m.show ? `Change Purchase Requisition ${c.m.pr}` : 'Change Purchase Requisition',
  init: () => ({ pr: '', show: false, items: [] }),
  render: c => {
    if (!c.m.show) return box('Purchase requisition', F('Purch. requisition', 'pr', { req: 1, f4: 'pr', w: 12 }));
    return box(`Purchase requisition ${c.m.pr}`, grid([{ h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Short text', k: 'short' }, { h: 'Quantity', f: (r, i) => r.poRef ? qf(r.qty) : I(`items.${i}.qty`, { w: 7, num: 1 }) }, { h: 'Deliv. date', f: (r, i) => r.poRef ? r.date : I(`items.${i}.date`, { w: 10 }) }, { h: 'Des. supplier', f: (r, i) => r.poRef ? r.vendor : I(`items.${i}.vendor`, { f4: 'vendor', w: 8 }) }, { h: 'Delete', f: (r, i) => I(`items.${i}.del`, { type: 'check', ro: !!r.poRef }) }, { h: 'Status', f: r => r.poRef ? `PO ${r.poRef}` : 'Open' }], c.m.items));
  },
  enter: c => { if (c.m.show) return; req(c, ['pr']); c.m.pr = c.m.pr.trim(); const P = S.prs[c.m.pr]; if (!P) err(`Purchase requisition ${c.m.pr} does not exist`, null, 'pr'); c.m.items = P.items.map(x => ({ ...x, qty: String(x.qty), date: fmtD(x.date), del: !!x.del })); c.m.show = true; },
  save: c => {
    if (!c.m.show) err('Enter a requisition and press Enter first', null, 'pr');
    const P = S.prs[c.m.pr];
    c.m.items.forEach((x, i) => { const it = P.items[i]; if (it.poRef) return; const q = N(x.qty); if (!(q > 0)) err('Enter a quantity', null, `items.${i}.qty`); const d = parseD(x.date); if (!d) err('Enter a valid date (DD.MM.YYYY)', null, `items.${i}.date`); const v = String(x.vendor || '').trim(); if (v) needVendor(v, '1010', `items.${i}.vendor`); Object.assign(it, { qty: q, date: d, vendor: v, del: !!x.del }); });
    (HOOKS.prChange || []).forEach(f => f(P));
    emit('PR_CHANGED', { num: P.num }); c.m = TX.ME52N.init(); msg('S', `Purchase requisition ${P.num} changed`);
  },
  back: c => { if (c.m.show) { c.m.show = false; return true; } }
};

// ======================================================================
// ME56 / ME57 / ME59N: assign sources and convert requisitions
// ======================================================================
const openPRItems = () => Object.values(S.prs).flatMap(p => p.items.filter(i => !i.poRef && !i.del).map(i => ({ ...i, num: p.num, relBlocked: p.relReq && !p.released })));
TX.ME56 = {
  title: c => c.m.list ? 'Assign Source of Supply to Requisitions' : 'Assign Source to Purch. Requisitions: Selection',
  init: () => ({ list: false, onlyNo: true, sel: {} }),
  tb: c => c.m.list ? [{ l: 'Assign automatically', i: '⚙', a: c => act(TX.ME56.assign) }] : [{ l: 'Execute', i: '⏵', a: c => act(TX.ME56.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Only without source', 'onlyNo', { type: 'check' }) + F('Plant', '_p', { ro: 1, w: 6, desc: '1010' }));
    const rows = openPRItems().filter(r => !c.m.onlyNo || !r.vendor).map(r => ({ ...r, ds: determineSource(r.matnr, r.plant) }));
    return box(`Requisition items (${rows.length})`, grid([{ h: 'Sel', f: r => I(`sel.${r.num}_${r.item}`, { type: 'check' }) }, { h: 'Purch. req.', f: r => `${r.num}/${r.item}` }, { h: 'Material', k: 'matnr' }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'Assigned supplier', f: r => r.vendor ? `${r.vendor} ${esc(vname(r.vendor))}${r.agmt ? ` (contract ${r.agmt})` : ''}` : '—' }, { h: 'Proposed source', f: r => r.ds.vendor ? `${r.ds.vendor}${r.ds.agmt ? ' / ' + r.ds.agmt : ''} · ${esc(r.ds.how)}` : `<span class="muted">${esc(r.ds.how)}</span>` }], rows));
  },
  exec: c => { c.m.list = true; },
  assign: c => {
    const keys = Object.entries(c.m.sel).filter(([, v]) => v).map(([k]) => k);
    if (!keys.length) err('Select at least one requisition item');
    let n = 0; const fails = [];
    for (const k of keys) { const [num, item] = k.split('_'); const pi = S.prs[num].items.find(x => x.item === +item); const ds = determineSource(pi.matnr, pi.plant); if (ds.vendor) { pi.vendor = ds.vendor; pi.agmt = ds.agmt || ''; pi.agmtItem = ds.agmtItem || ''; n++; } else fails.push(`${num}/${item}: ${ds.how}`); }
    c.m.sel = {}; emit('SRC_ASSIGNED', { n });
    msg(fails.length ? 'W' : 'S', `${n} requisition item${n === 1 ? '' : 's'} assigned${fails.length ? ` · ${fails.length} without source (${fails[0]})` : ''}`);
  },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};
TX.ME57 = {
  title: c => c.m.list ? 'Assign and Process Purchase Requisitions' : 'Assign and Process Purchase Requisitions: Selection',
  init: () => ({ list: false, assigned: false, sel: {} }),
  tb: c => c.m.list ? [{ l: 'Assign automatically', i: '⚙', a: c => act(TX.ME57.assign) }, { l: 'Process assignment ▸ PO', i: '📄', a: c => act(TX.ME57.process) }] : [{ l: 'Execute', i: '⏵', a: c => act(TX.ME57.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Assigned requisitions only', 'assigned', { type: 'check' }) + F('Plant', '_p', { ro: 1, w: 6, desc: '1010' })) + '<div class="tip">Lists open requisition items. Assign a source, then select the items for <b>one</b> supplier and click <b>Process assignment</b> to open ME21N with them.</div>';
    const rows = openPRItems().filter(r => !c.m.assigned || r.vendor);
    return box(`Open requisition items (${rows.length})`, grid([{ h: 'Sel', f: r => I(`sel.${r.num}_${r.item}`, { type: 'check' }) }, { h: 'Purch. req.', f: r => `${lnk('ME53N', { pr: r.num }, r.num)}/${r.item}${r.relBlocked ? ' <span class="badge warn">not released</span>' : ''}` }, { h: 'Material', k: 'matnr' }, { h: 'Short text', k: 'short' }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'Deliv. date', f: r => fmtD(r.date) }, { h: 'Supplier', f: r => r.vendor ? `${r.vendor} ${esc(vname(r.vendor))}` : '<span class="muted">not assigned</span>' }, { h: 'Agreement', f: r => r.agmt || '' }], rows));
  },
  exec: c => { c.m.list = true; emit('REPORT', { tcode: 'ME57' }); },
  assign: c => TX.ME56.assign(c),
  process: c => {
    const keys = Object.entries(c.m.sel).filter(([, v]) => v).map(([k]) => k);
    if (!keys.length) err('Select at least one requisition item');
    const its = keys.map(k => { const [num, item] = k.split('_'); return { num, pi: S.prs[num].items.find(x => x.item === +item), P: S.prs[num] }; });
    const un = its.find(x => !x.pi.vendor); if (un) err(`Requisition ${un.num}/${un.pi.item} has no supplier assigned: assign a source first`, 'NO_SOURCE');
    const rb = its.find(x => x.P.relReq && !x.P.released); if (rb) err(`Purchase requisition ${rb.num} is not released`, 'PR_NOT_REL');
    const vs = [...new Set(its.map(x => x.pi.vendor))]; if (vs.length > 1) err(`Selected items have ${vs.length} different suppliers (${vs.join(', ')}): process one supplier at a time`);
    c.m.sel = {};
    call('ME21N', { vendor: vs[0], src: 'requisitions (ME57)', items: its.map(x => ({ matnr: x.pi.matnr, qty: x.pi.qty, date: fmtD(x.pi.date < today() ? dPlus(7) : x.pi.date), plant: x.pi.plant, sloc: x.pi.sloc, prRef: x.num, prItem: String(x.pi.item), agmt: x.pi.agmt || '', agmtItem: x.pi.agmtItem ? String(x.pi.agmtItem) : '' })) }, true);
  },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};
TX.ME58 = TX.ME57;
TX.ME59N = {
  title: c => c.m.list ? 'Automatic Creation of Purchase Orders: Log' : 'Automatic Creation of POs from Requisitions',
  init: () => ({ list: false, test: false, log: [] }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.ME59N.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Purch. org. / plant', '_p', { ro: 1, w: 8, desc: '1010 / 1010' }) + F('Test run', 'test', { type: 'check', desc: 'Show the result without creating POs' })) + '<div class="tip">ME59N converts every open, released requisition item that has a <b>unique source of supply</b> (assigned supplier, fixed source list entry, single contract or single info record) into purchase orders, one per supplier.</div>';
    return box(c.m.test ? 'Test run log (nothing created)' : 'Log', grid([{ h: 'Purch. req.', k: 'pr' }, { h: 'Material', k: 'matnr' }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'Supplier', f: r => r.vendor ? `${r.vendor} ${esc(vname(r.vendor))}` : '' }, { h: 'Result', f: r => r.po ? `<span class="badge ok">PO ${c.m.test ? '(test)' : lnk('ME23N', { po: r.po }, r.po)}</span>` : `<span class="badge err">${esc(r.why)}</span>` }], c.m.log, { empty: 'No open requisition items found' }));
  },
  exec: c => {
    if (c.m.list) return;
    const groups = {}; const log = [];
    for (const r of openPRItems()) {
      if (r.relBlocked) { log.push({ pr: `${r.num}/${r.item}`, matnr: r.matnr, qty: r.qty, why: 'Requisition not released' }); continue; }
      const ds = r.vendor ? { vendor: r.vendor, agmt: r.agmt || '', agmtItem: r.agmtItem || '' } : determineSource(r.matnr, r.plant);
      if (!ds.vendor) { log.push({ pr: `${r.num}/${r.item}`, matnr: r.matnr, qty: r.qty, why: ds.how }); continue; }
      const inf = ds.agmt ? null : findInfo(ds.vendor, r.matnr, '1010', r.plant);
      const K = ds.agmt ? S.contracts[ds.agmt] : null; const ki = K?.items.find(x => x.matnr === r.matnr);
      if (!inf && !ki) { log.push({ pr: `${r.num}/${r.item}`, matnr: r.matnr, qty: r.qty, vendor: ds.vendor, why: 'No price (no info record or contract)' }); continue; }
      (groups[ds.vendor] ??= []).push({ r, ds, inf, ki });
    }
    for (const [v, list] of Object.entries(groups)) {
      let po = 'test';
      if (!c.m.test) po = createPO({ vendor: v, items: list.map(({ r, ds, inf, ki }) => { const conds = ki ? { gross: ki.price, disc: 0, frt: 0, src: `Contract ${ds.agmt}` } : { gross: inf.price / inf.per, disc: inf.disc, frt: inf.frt, src: `Info record ${inf.id}` }; const M = S.materials[r.matnr]; return { matnr: r.matnr, short: M.desc, qty: r.qty, uom: M.uom, price: condNet(conds), conds, plant: r.plant, sloc: r.sloc, date: r.date < today() ? dPlus(7) : r.date, prRef: r.num, prItem: r.item, agmt: ds.agmt || '', agmtItem: ki ? ki.item : '' }; }) });
      list.forEach(({ r }) => log.push({ pr: `${r.num}/${r.item}`, matnr: r.matnr, qty: r.qty, vendor: v, po }));
      if (!c.m.test) { const P = S.pos[po]; emit('PO_CREATED', { num: po, vendor: v, auto: true, value: r2(sum(P.items, x => x.qty * x.price)), rel: !!P.relReq, items: P.items.map(x => ({ matnr: x.matnr, qty: x.qty, price: x.price, prRef: x.prRef, agmt: x.agmt, cat: '' })) }); }
    }
    c.m.log = log; c.m.list = true;
    const n = Object.keys(groups).length;
    emit('AUTO_PO', { n, test: c.m.test });
    msg(n ? 'S' : 'W', c.m.test ? `Test run: ${n} purchase order${n === 1 ? '' : 's'} would be created` : `${n} purchase order${n === 1 ? '' : 's'} created`);
  },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};

// ======================================================================
// ME12 info record change, extra PO lists
// ======================================================================
TX.ME12 = {
  title: c => c.m.show ? `Change Info Record ${c.m.id}` : 'Change Info Record: Initial Screen',
  init: () => ({ vendor: '', matnr: '', show: false }),
  render: c => {
    if (!c.m.show) return box('Info record', F('Supplier', 'vendor', { req: 1, f4: 'vendor', w: 10 }) + F('Material', 'matnr', { req: 1, f4: 'mat', w: 18 }) + F('Purch. org.', '_p', { ro: 1, w: 6, desc: '1010' }));
    return box(`Info record ${c.m.id} · ${c.m.vendor} / ${c.m.matnr}`, F('Gross price (EUR)', 'price', { req: 1, num: 1, w: 10 }) + F('Discount RA01 (%)', 'disc', { num: 1, w: 6 }) + F('Freight FRB1 (EUR/unit)', 'frt', { num: 1, w: 8 }) + F('Planned deliv. time (days)', 'days', { num: 1, w: 5 })) + '<div class="tip">Conditions in the info record are copied into new POs: net price = gross − discount + freight.</div>';
  },
  enter: c => { if (c.m.show) return; req(c, ['vendor', 'matnr']); c.m.vendor = c.m.vendor.trim(); c.m.matnr = U(c.m.matnr); const inf = findInfo(c.m.vendor, c.m.matnr, '1010', '1010'); if (!inf) err(`No info record for supplier ${c.m.vendor} / material ${c.m.matnr} (create it with ME11)`, null, 'matnr'); Object.assign(c.m, { show: true, id: inf.id, price: inf.price.toFixed(2), disc: String(inf.disc || 0), frt: String(inf.frt || 0), days: String(inf.days) }); },
  save: c => { if (!c.m.show) err('Press Enter first'); const inf = S.infos.find(i => i.id === c.m.id); const p = N(c.m.price), d = N(c.m.disc), f = N(c.m.frt); if (!(p > 0)) err('Enter a gross price', null, 'price'); if (isNaN(d) || d < 0 || d >= 100) err('Discount must be between 0 and 99%', null, 'disc'); Object.assign(inf, { price: r2(p), disc: d, frt: r2(f || 0), days: N(c.m.days) || inf.days }); emit('INFO_CHANGED', { id: inf.id, matnr: inf.matnr, vendor: inf.vendor }); c.m = TX.ME12.init(); msg('S', `Info record ${inf.id} changed`); },
  back: c => { if (c.m.show) { c.m.show = false; return true; } }
};
const poList = (code, title, filterF, sel) => ({
  title: c => c.m.list ? `Purchasing Documents per ${title}` : `Purchasing Documents per ${title}: Selection`,
  init: () => ({ v: '', list: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX[code].exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', sel(c)) + '<div class="tip">Leave empty for all, then press <b>F8</b>.</div>';
    const rows = Object.values(S.pos).reverse().flatMap(p => p.items.map(it => ({ ...it, po: p.num, vendor: p.vendor, docDate: p.docDate, t: poTotals(p, it) }))).filter(r => filterF(r, c.m.v.trim().toUpperCase()));
    return box(`${title} (${rows.length})`, grid([{ h: 'Purch. doc.', f: r => lnk('ME23N', { po: r.po }, r.po) }, { h: 'Item', k: 'item' }, { h: 'Supplier', f: r => `${r.vendor} ${esc(vname(r.vendor))}` }, { h: 'Material', k: 'matnr' }, { h: 'Matl group', f: r => S.materials[r.matnr]?.group }, { h: 'Doc. date', f: r => fmtD(r.docDate) }, { h: 'PO qty', r: 1, f: r => qf(r.qty) }, { h: 'Still to deliver', r: 1, f: r => qf(Math.max(0, r.t.toDeliver)) }, { h: 'Net value', r: 1, f: r => money(r.qty * r.price / r.per) }], rows, { empty: code === 'ME2K' ? 'No account-assigned purchase orders: in this sandbox POs are for stock (no cost centre). Consumption goes through MIGO 201 instead.' : 'No entries found' }));
  },
  enter: c => TX[code].exec(c), exec: c => { if (c.m.list) return; c.m.list = true; emit('REPORT', { tcode: code }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
});
TX.ME2L = poList('ME2L', 'Supplier', (r, v) => !v || r.vendor === v, c => F('Supplier', 'v', { f4: 'vendor', w: 10 }));
TX.ME2C = poList('ME2C', 'Material Group', (r, v) => !v || S.materials[r.matnr]?.group === v, c => F('Material group', 'v', { f4: 'mgroup', w: 8 }));
TX.ME2K = poList('ME2K', 'Account Assignment', () => false, c => F('Cost center', 'v', { f4: 'costc', w: 10 }));

// ======================================================================
// Scenarios
// ======================================================================
SCEN.push(
  { id: 'rfq', title: '7. RFQ, quotations & price comparison', level: 'Purchasing · 20 min',
    intro: 'Source a new item competitively: send RFQs to two suppliers, enter their quotations, compare and award the best one.',
    steps: [
      { t: 'Create an RFQ (<b>ME41</b>) for <b>20 PC</b> of <b>TG13</b> to suppliers <b>100001</b> and <b>100002</b>.', h: 'ME41 → Supplier 1: 100001, Supplier 2: 100002 → item TG13, qty 20 → Ctrl+S. Note the collective number (COLL-…).', ok: e => e.type === 'RFQ_CREATED' && e.vendors.length >= 2 && e.items.some(i => i.matnr === 'TG13'), cap: (e, x) => { x.coll = e.coll; } },
      { t: 'Enter the first quotation (<b>ME47</b>): e.g. 92.00 per PC.', h: 'ME47 → F4 on RFQ → the RFQ for 100001 → Enter → Net price 92 → Ctrl+S.', ok: (e, x) => e.type === 'QUOTE_ENTERED' && e.coll === x.coll && !e.rejected },
      { t: 'Enter the second quotation: e.g. 88.50 per PC.', h: 'ME47 → the RFQ for 100002 → Net price 88.50 → Ctrl+S.', ok: (e, x) => e.type === 'QUOTE_ENTERED' && e.coll === x.coll && !e.rejected && Object.values(S.rfqs).filter(r => r.coll === x.coll && r.status === 'quoted').length >= 2 },
      { t: 'Compare prices with <b>ME49</b>.', h: 'ME49 → Collective number (F4) → F8. The cheapest is ranked 🏆 1.', ok: (e, x) => e.type === 'REPORT' && e.tcode === 'ME49' && e.coll === x.coll },
      { t: 'Create the PO from the winning quotation and save it.', h: 'In ME49 click "Create PO ▸" under the winner → ME21N opens with supplier, material, quantity and price → Ctrl+S. The quotation becomes "awarded".', ok: (e, x) => e.type === 'PO_CREATED' && Object.values(S.rfqs).some(r => r.coll === x.coll && r.status === 'awarded') }
    ],
    notes: ['In S/4HANA many companies use SAP Ariba or the Fiori "Manage RFQs" apps, but the ME41/ME47/ME49 logic is what C_TS452 tests.', 'Point out that an RFQ and a quotation are the same document: ME47 just adds the prices.', 'Discuss next steps: create an info record from the winning quotation (ME11) so future POs get the price.'] },
  { id: 'ctr', title: '8. Contract, source list & automatic PO', level: 'Purchasing · 25 min',
    intro: 'Negotiate a contract, make it the fixed source of supply and let ME59N convert requisitions into release orders automatically.',
    steps: [
      { t: 'Create a <b>quantity contract</b> (<b>ME31K</b>, type MK) with <b>100001</b> for <b>TG12</b>: target 1,000 PC at 13.20.', h: 'ME31K → Supplier 100001, type MK → Enter → item TG12, target qty 1000, net price 13.20 → Ctrl+S.', ok: e => e.type === 'CTR_CREATED' && e.vendor === '100001' && e.ctype === 'MK' && e.items.some(i => i.matnr === 'TG12'), cap: (e, x) => { x.ctr = e.num; } },
      { t: 'Maintain the source list (<b>ME01</b>) for TG12: supplier 100001 with your contract as <b>fixed</b> source.', h: 'ME01 → TG12 → Enter → Supplier 100001, Agreement = your contract, tick Fix → Ctrl+S.', ok: (e, x) => e.type === 'SRC_SAVED' && e.matnr === 'TG12' && e.rows.some(r => r.fixed && r.agmt === x.ctr) },
      { t: 'Create a requisition (<b>ME51N</b>) for <b>150 PC</b> of TG12.', h: 'ME51N → TG12, 150 → Enter → Ctrl+S. (Value is below the release limit, so no approval is needed.)', ok: e => e.type === 'PR_CREATED' && e.items.some(i => i.matnr === 'TG12' && i.qty === 150), cap: (e, x) => { x.pr = e.num; } },
      { t: 'Run <b>ME59N</b> to create the PO automatically.', h: 'ME59N → F8. The requisition finds the fixed source → a release order is created against your contract at 13.20.', ok: (e, x) => e.type === 'PO_CREATED' && e.items.some(i => i.prRef === x.pr && i.agmt === x.ctr), cap: (e, x) => { x.po = e.num; } },
      { t: 'Check the release documentation in <b>ME33K</b>.', h: 'ME33K → your contract → Enter: the PO appears as a release order and the open target quantity is now 850.', ok: (e, x) => e.type === 'CTR_DISPLAY' && e.num === x.ctr }
    ],
    notes: ['Explain the source determination order used here: assigned supplier → fixed source list entry → single contract → single info record.', 'Quantity contract (MK) vs value contract (WK): show the seeded WK contract 4600000001 for TG15.', 'ME57 is the interactive alternative to ME59N: buyers review requisitions before converting them.'] },
  { id: 'sa', title: '9. Scheduling agreement & PO changes', level: 'Purchasing · 20 min',
    intro: 'Set up a scheduling agreement with call-offs, receive a delivery against it, then change a purchase order.',
    steps: [
      { t: 'Create a scheduling agreement (<b>ME31L</b>) with <b>100003</b> for <b>RM14</b>: target 10,000 PC at 0.80.', h: 'ME31L → Supplier 100003 → RM14, target 10000, price 0.80 → Ctrl+S.', ok: e => e.type === 'SA_CREATED' && e.vendor === '100003', cap: (e, x) => { x.sa = e.num; } },
      { t: 'Add two delivery schedule lines (<b>ME38</b>): 1,000 PC next week and 1,000 PC in a month.', h: 'ME38 → your agreement → Enter → line 1: date in 7 days, 1000; line 2: date in 30 days, 1000 → Ctrl+S.', ok: (e, x) => e.type === 'SCHED_SAVED' && e.sa === x.sa && e.qty >= 2000 },
      { t: 'Receive the first 1,000 PC in <b>MIGO</b> against the agreement.', h: 'MIGO → A01 / R01 → enter the agreement number (5500…) → Enter → change quantity to 1000 → OK → Post.', ok: (e, x) => e.type === 'GR_POSTED' && e.po === x.sa },
      { t: 'Change open PO <b>4500000002</b> (<b>ME22N</b>): increase the quantity from 5 to 8.', h: 'ME22N → 4500000002 → Enter → PO quantity 8 → Ctrl+S.', ok: e => e.type === 'PO_CHANGED' && e.num === '4500000002' },
      { t: 'Try to set the quantity of PO <b>4500000001</b> below what was delivered and read the error.', h: 'ME22N → 4500000001 → quantity 5 (10 were delivered) → Ctrl+S.', ok: e => e.type === 'ERR' && e.code === 'QTY_BELOW_GR' }
    ],
    notes: ['Scheduling agreements suit repetitive supply (packaging, raw materials): fewer documents than one PO per delivery.', 'In real systems schedule lines often come from MRP; here you maintain them manually with ME38.', 'ME22N rules: you cannot go below the delivered quantity; deletion stops further receipts but invoices for received goods remain possible.'] }
);
})();
