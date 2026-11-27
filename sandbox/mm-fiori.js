/* MM Sandbox: SAP Fiori launchpad (simplified look-alike, not SAP software) with key MM apps on the same data. */
(() => {
'use strict';
const { S, ORG, TX, TITLES, SCEN, HOOKS, esc, pad, today, dPlus, fmtD, N, r2, r3, money, qf, U, sum, err,
  plantData, stockKey, poTotals, postGR, postMvt, planMvt, vname, emit, msg, call, act, I, grid, lnk, invStatus } = MMSB;

const poVal = P => r2(sum(P.items.filter(i => !i.del), i => i.qty * i.price / i.per));
const poStatus = P => { if (P.relReq && !P.released) return ['Awaiting approval', 'warn']; const its = P.items.filter(i => !i.del); const t = its.map(i => poTotals(P, i)); if (t.every((x, k) => x.toDeliver <= 0 && (x.toInvoice <= 0 || its[k].cat === 'K'))) return ['Completed', 'ok']; if (t.some(x => x.gr > 0)) return ['Partially delivered', 'warn']; return [P.output ? 'Sent' : 'Not sent', '']; };
const shell = (title, inner, back = true) => `<div class="fl"><div class="fl-shell">${back ? '<button type="button" class="fl-ic" data-back title="Back">‹</button>' : ''}<button type="button" class="fl-ic" data-call="/UI2/FLP" data-p="{}" title="Home">⌂</button><span class="fl-title">${esc(title)}</span><span class="fl-sp"></span><button type="button" class="fl-gui" data-call="SESSION_MANAGER" data-p="{}">SAP GUI ▸</button></div><div class="fl-body">${inner}</div></div>`;
const tile = (code, t, sub, kpi, unit = '', icon = '') => `<button type="button" class="fl-tile" data-call="${code}" data-p="{}"><span class="fl-tt">${esc(t)}</span><span class="fl-ts">${esc(sub)}</span><span class="fl-tk">${icon ? `<i>${icon}</i>` : ''}${kpi != null ? `<b>${esc(kpi)}</b><small>${esc(unit)}</small>` : ''}</span></button>`;
const chip = (t, k = '') => `<span class="fl-chip ${k}">${esc(t)}</span>`;
const fiori = o => ({ fiori: true, ...o });
const back0 = c => false;

Object.assign(TITLES, { '/UI2/FLP': 'SAP Fiori Launchpad', F_PO: 'Manage Purchase Orders (Fiori)', F_GR: 'Post Goods Receipt for Purchasing Document (Fiori)', F_STOCK: 'Stock – Single Material (Fiori)', F_TRF: 'Transfer Stock – In-Plant (Fiori)', F_MDOC: 'Material Documents Overview (Fiori)', F_INV: 'Supplier Invoices List (Fiori)', F_INBOX: 'My Inbox – Approve Purchasing Documents (Fiori)', F_SPEND: 'Purchasing Spend (Fiori analytics)', F_OVD: 'Monitor Purchase Order Items (Fiori)', F_PIDOC: 'Manage Physical Inventory Documents (Fiori)', F_PR: 'Process Purchase Requisitions (Fiori)' });

TX['/UI2/FLP'] = fiori({
  title: 'SAP Fiori Launchpad',
  render: () => {
    const pend = Object.values(S.pos).filter(P => P.relReq && !P.released).length + Object.values(S.prs).filter(P => P.relReq && !P.released).length;
    const ovd = Object.values(S.pos).flatMap(P => P.items.filter(i => !i.del && i.date < today() && poTotals(P, i).toDeliver > 0)).length;
    const openPR = Object.values(S.prs).flatMap(p => p.items.filter(i => !i.poRef && !i.del)).length;
    const spend = r2(sum(Object.values(S.pos), poVal));
    const blocked = Object.values(S.invoices).filter(i => i.blocked && i.status === 'posted').length;
    const stockVal = r2(sum(Object.values(S.materials), M => M.plants['1010'].totVal));
    const grp = (t, tiles) => `<h2 class="fl-grp">${esc(t)}</h2><div class="fl-tiles">${tiles.join('')}</div>`;
    return shell('Home', grp('Purchasing', [tile('F_PO', 'Manage Purchase Orders', 'Track, edit, release', Object.keys(S.pos).length, 'POs', '🛒'), tile('F_PR', 'Process Purchase Requisitions', 'Convert to POs', openPR, 'open', '📋'), tile('F_INBOX', 'My Inbox', 'Approve purchasing documents', pend, 'pending', '📥'), tile('F_OVD', 'Monitor Purchase Order Items', 'Overdue deliveries', ovd, 'overdue', '⏰'), tile('ME21N', 'Create Purchase Order – Advanced', 'SAP GUI for HTML: ME21N', null, '', '🖥'), tile('ME49', 'Compare Supplier Quotations', 'SAP GUI: ME49', null, '', '⚖'), tile('ML81N', 'Service Entry Sheets', 'Confirm and accept services', null, '', '🧹')]) +
      grp('Inventory', [tile('F_GR', 'Post Goods Receipt for Purchasing Document', 'Receive deliveries', null, '', '📦'), tile('F_STOCK', 'Stock – Single Material', 'Stock by location and type', null, '', '📊'), tile('F_TRF', 'Transfer Stock – In-Plant', 'Storage location / stock type', null, '', '🔁'), tile('F_MDOC', 'Material Documents Overview', 'All goods movements', Object.keys(S.matDocs).length, 'docs', '🧾'), tile('F_PIDOC', 'Manage Physical Inventory Documents', 'Count and post differences', Object.values(S.pids || {}).filter(d => d.status !== 'posted').length, 'open', '🔢'), tile('MIGO', 'Post Goods Movement', 'SAP GUI for HTML: MIGO', null, '', '🖥')]) +
      grp('Invoicing', [tile('F_INV', 'Supplier Invoices List', 'Display, release, reverse', blocked, 'blocked', '💶'), tile('MIRO', 'Create Supplier Invoice – Advanced', 'SAP GUI for HTML: MIRO', null, '', '🖥'), tile('F110', 'Manage Automatic Payments', 'SAP GUI: F110', null, '', '🏦')]) +
      grp('Planning & analytics', [tile('F_SPEND', 'Purchasing Spend', 'By supplier and material group', money(spend), 'EUR', '📈'), tile('MD04', 'Monitor Material Coverage', 'SAP GUI: MD04', null, '', '🧮'), tile('MB5L', 'Inventory Value', 'Stock value per account', money(stockVal), 'EUR', '💰')]) +
      '<p class="disclaimer">Simplified Fiori-style launchpad for training. Tiles marked 🖥 open the classic transaction, as many S/4HANA launchpads do ("SAP GUI for HTML").</p>', false);
  }
});

// ---------- Manage Purchase Orders ----------
const flow = P => {
  const its = P.items.filter(i => !i.del); const t = its.map(i => poTotals(P, i));
  const pr = its.some(i => i.prRef), gr = t.some(x => x.gr > 0), grAll = t.every(x => x.toDeliver <= 0), ir = t.some(x => x.ir > 0), irAll = t.every((x, k) => x.toInvoice <= 0 && x.gr > 0 || its[k].cat === 'K'), invs = [...new Set(P.history.filter(h => h.type === 'RE').map(h => h.doc))].map(d => S.invoices[d]).filter(Boolean);
  const paid = invs.length && invs.filter(i => i.status === 'posted').every(i => i.paid);
  const node = (t, s, k) => `<div class="fl-node ${k}"><b>${esc(t)}</b><small>${esc(s)}</small></div>`;
  return `<div class="fl-flow">${node('Purchase requisition', pr ? its.filter(i => i.prRef).map(i => i.prRef).join(', ') : 'none', pr ? 'done' : 'na')}<span>→</span>${node('Purchase order', `${P.num}${P.relReq ? (P.released ? ' · released' : ' · awaiting approval') : ''}`, P.relReq && !P.released ? 'cur' : 'done')}<span>→</span>${node('Goods receipt', grAll ? 'complete' : gr ? 'partial' : 'open', grAll ? 'done' : gr ? 'cur' : 'open')}<span>→</span>${node('Supplier invoice', irAll && ir ? 'complete' : ir ? 'partial' : 'open', irAll && ir ? 'done' : ir ? 'cur' : 'open')}<span>→</span>${node('Payment', paid ? 'paid' : 'open', paid ? 'done' : 'open')}</div>`;
};
TX.F_PO = fiori({
  title: 'Manage Purchase Orders',
  init: p => ({ q: '', st: '', po: p.po || '' }),
  acts: { open: (c, d) => { c.m.po = d.po; emit('PO_DISPLAY', { num: d.po, fiori: true, hist: S.pos[d.po].history.length }); }, list: c => { c.m.po = ''; } },
  render: c => {
    const m = c.m;
    if (m.po) {
      const P = S.pos[m.po]; const [st, k] = poStatus(P);
      return shell(`Purchase Order ${P.num}`, `<div class="fl-obj"><div class="fl-objh"><div><h1>${P.type === 'LP' ? 'Scheduling agreement' : 'Purchase order'} ${P.num}</h1><p>${esc(vname(P.vendor))} (${P.vendor}) · ${fmtD(P.docDate)}</p></div><div class="fl-kpis"><div><small>Net value</small><b>${money(poVal(P))} EUR</b></div><div><small>Status</small>${chip(st, k)}</div></div></div>
        <div class="fl-actions"><button type="button" class="fl-btn" data-call="ME22N" data-p='${esc(JSON.stringify({ po: P.num }))}'>Edit</button>${P.relReq && !P.released ? `<button type="button" class="fl-btn pri" data-call="F_INBOX" data-p="{}">Approve in My Inbox</button>` : ''}<button type="button" class="fl-btn" data-call="F_GR" data-p='${esc(JSON.stringify({ po: P.num }))}'>Post goods receipt</button><button type="button" class="fl-btn" data-call="ME23N" data-p='${esc(JSON.stringify({ po: P.num }))}'>Open in SAP GUI (ME23N)</button></div>
        <h3>Process flow</h3>${flow(P)}<h3>Items</h3>${grid([{ h: 'Item', k: 'item' }, { h: 'Material', f: r => `${r.matnr}<br><small class="muted">${esc(r.short)}</small>` }, { h: 'Ordered', r: 1, f: r => `${qf(r.qty)} ${r.uom}` }, { h: 'Delivered', r: 1, f: r => qf(poTotals(P, r).gr) }, { h: 'Invoiced', r: 1, f: r => qf(poTotals(P, r).ir) }, { h: 'Net price', r: 1, f: r => r.cat === 'K' ? 'consignment' : money(r.price) }, { h: 'Delivery date', f: r => fmtD(r.date) + (r.date < today() && poTotals(P, r).toDeliver > 0 ? ' ' + chip('Overdue', 'err') : '') }], P.items.filter(i => !i.del))}</div>`);
    }
    const rows = Object.values(S.pos).reverse().filter(P => { const q = m.q.trim().toLowerCase(); return (!q || [P.num, P.vendor, vname(P.vendor), ...P.items.map(i => i.matnr)].join(' ').toLowerCase().includes(q)) && (!m.st || poStatus(P)[0] === m.st); });
    return shell('Manage Purchase Orders', `<div class="fl-filter"><label>Search ${I('q', { w: 22, ph: 'PO, supplier, material', rr: 0 })}</label><label>Status ${I('st', { type: 'select', opts: { '': 'All', 'Awaiting approval': 'Awaiting approval', 'Not sent': 'Not sent', Sent: 'Sent', 'Partially delivered': 'Partially delivered', Completed: 'Completed' }, rr: 1 })}</label><button type="button" class="fl-btn pri" data-act="go">Go</button><span class="fl-sp"></span><button type="button" class="fl-btn" data-call="ME21N" data-p="{}">Create</button></div>
      <div class="fl-card"><div class="fl-ct">Purchase Orders (${rows.length})</div>${grid([{ h: 'Purchase order', f: P => `<b>${P.num}</b>` }, { h: 'Supplier', f: P => `${esc(vname(P.vendor))}<br><small class="muted">${P.vendor}</small>` }, { h: 'Items', f: P => P.items.filter(i => !i.del).map(i => i.matnr).join(', ') }, { h: 'Net value', r: 1, f: P => `${money(poVal(P))} EUR` }, { h: 'Status', f: P => { const [s, k] = poStatus(P); return chip(s, k); } }, { h: 'Created', f: P => fmtD(P.docDate) }], rows, { click: P => `data-act="open" data-po="${P.num}"` })}</div>`);
  },
  enter: () => {}, back: c => { if (c.m.po) { c.m.po = ''; return true; } }
});
TX.F_PO.acts.go = () => {};

// ---------- Post Goods Receipt ----------
TX.F_GR = fiori({
  title: 'Post Goods Receipt for Purchasing Document',
  init: p => ({ po: p.po || '', lines: [], loaded: '', note: '' }),
  onOpen: c => { if (c.m.po) TX.F_GR.load(c); },
  load: c => {
    const m = c.m; m.po = String(m.po).trim(); const P = S.pos[m.po];
    if (!P) err(`Purchasing document ${m.po || '(empty)'} not found`, null, 'po');
    HOOKS.grCheck.forEach(f => f(P));
    m.lines = P.items.map(it => ({ it, t: poTotals(P, it) })).filter(x => x.t.toDeliver > 0 && x.it.cat !== 'D').map(({ it, t }) => ({ item: it.item, matnr: it.matnr, short: it.short, cat: it.cat, uom: it.uom, open: t.toDeliver, qty: String(t.toDeliver), sloc: it.sloc || '101A', stype: 'unr', sel: true }));
    if (!m.lines.length) err(`Purchasing document ${P.num} has no open items`, 'NO_ITEMS', 'po');
    m.loaded = P.num;
  },
  acts: { load: c => TX.F_GR.load(c), post: c => {
    const m = c.m; if (!m.loaded) err('Enter a purchasing document first', null, 'po'); const P = S.pos[m.loaded];
    const lines = m.lines.map((l, i) => ({ l, i })).filter(x => x.l.sel).map(({ l, i }) => { const q = N(l.qty); if (!(q > 0)) err('Enter a quantity', null, `lines.${i}.qty`); if (q > l.open * (1 + (S.cfg.overTol || 0) / 100) + 1e-9) err(`Quantity exceeds the open quantity ${qf(l.open)} (PO quantity exceeded)`, 'QTY_EXCEEDED', `lines.${i}.qty`); l.sloc = U(l.sloc); if (!ORG.slocs[l.sloc]) err(`Storage location ${l.sloc} does not exist`, null, `lines.${i}.sloc`); (HOOKS.stockCheck || []).forEach(f => f(l.matnr, '1010', l.sloc)); const it = P.items.find(x => x.item === l.item); if (it.cat === 'L') for (const cp of it.comps || []) { const need = r3(cp.qty * q / it.qty); if (MMSB.special(`O|${cp.matnr}|1010|${P.vendor}`) + 1e-9 < need) err(`Components missing at supplier: ${cp.matnr} (provide with 541 first)`, 'NO_O_STOCK'); } return { item: l.item, qty: q, sloc: l.sloc, stype: it.cat === 'K' ? 'K' : l.stype }; });
    if (!lines.length) err('Select at least one item');
    const md = postGR({ po: P.num, lines, text: m.note });
    emit('GR_POSTED', { po: P.num, md, fiori: true, items: lines.map(x => ({ item: x.item, qty: x.qty, stype: x.stype })), complete: P.items.every(i => poTotals(P, i).toDeliver <= 0) });
    c.m = TX.F_GR.init({}); msg('S', `Material document ${md} posted`);
  } },
  render: c => {
    const m = c.m;
    return shell('Post Goods Receipt for Purchasing Document', `<div class="fl-filter"><label>Purchasing document ${I('po', { f4: 'po', w: 12, ph: 'PO or agreement' })}</label><button type="button" class="fl-btn pri" data-act="load">Go</button></div>` +
      (m.loaded ? `<div class="fl-card"><div class="fl-ct">${m.loaded} · ${esc(vname(S.pos[m.loaded].vendor))}</div><div class="fl-form"><label>Delivery note ${I('note', { w: 20, ph: 'optional' })}</label></div>${grid([{ h: '', f: (r, i) => I(`lines.${i}.sel`, { type: 'check' }) }, { h: 'Material', f: r => `<b>${r.matnr}</b><br><small class="muted">${esc(r.short)}</small>` }, { h: 'Open', r: 1, f: r => `${qf(r.open)} ${r.uom}` }, { h: 'Quantity', f: (r, i) => I(`lines.${i}.qty`, { w: 6, num: 1 }) }, { h: 'Storage location', f: (r, i) => I(`lines.${i}.sloc`, { f4: 'sloc', w: 4 }) }, { h: 'Stock type', f: (r, i) => r.cat === 'K' ? 'Consignment' : I(`lines.${i}.stype`, { type: 'select', opts: { unr: 'Unrestricted', qi: 'Quality inspection', blk: 'Blocked' } }) }], m.lines)}<div class="fl-foot"><button type="button" class="fl-btn pri" data-act="post">Post</button></div></div>` : '<div class="fl-empty">Enter a purchase order number and choose Go.</div>'));
  },
  enter: c => { if (!c.m.loaded || c.m.loaded !== String(c.m.po).trim()) TX.F_GR.load(c); },
  save: c => TX.F_GR.acts.post(c)
});

// ---------- Stock – Single Material / Transfer ----------
TX.F_STOCK = fiori({
  title: 'Stock – Single Material',
  init: p => ({ matnr: p.matnr || '', shown: '' }),
  onOpen: c => { if (c.m.matnr) TX.F_STOCK.enter(c); },
  acts: { go: c => TX.F_STOCK.enter(c) },
  enter: c => { c.m.matnr = U(c.m.matnr); MMSB.needMat(c.m.matnr, '1010', 'matnr'); c.m.shown = c.m.matnr; emit('STOCK_VIEW', { matnr: c.m.matnr, fiori: true }); },
  render: c => {
    const m = c.m; const M = S.materials[m.shown];
    let body = '<div class="fl-empty">Choose a material.</div>';
    if (M) { const pd = M.plants['1010']; const sl = Object.keys(ORG.slocs).map(s => ({ s, ...(S.stock[stockKey(M.matnr, '1010', s)] || { unr: 0, qi: 0, blk: 0 }) })).filter(x => x.unr || x.qi || x.blk || S.stock[stockKey(M.matnr, '1010', x.s)]); const t = k => sum(sl, x => x[k]);
      const card = (l, v, u) => `<div class="fl-kpi"><small>${esc(l)}</small><b>${v}</b><span>${esc(u)}</span></div>`;
      body = `<div class="fl-objh"><div><h1>${M.matnr}</h1><p>${esc(M.desc)} · ${esc(ORG.mtypes[M.type])} · Plant 1010</p></div></div><div class="fl-kpirow">${card('Unrestricted', qf(t('unr')), M.uom)}${card('Quality inspection', qf(t('qi')), M.uom)}${card('Blocked', qf(t('blk')), M.uom)}${card('On order', qf(MMSB.onOrder(M.matnr, '1010')), M.uom)}${card('Stock value', money(pd.totVal), 'EUR')}</div>
        <div class="fl-card"><div class="fl-ct">By storage location</div>${grid([{ h: 'Storage location', f: r => `${r.s} ${esc(ORG.slocs[r.s])}` }, { h: 'Unrestricted', r: 1, f: r => qf(r.unr) }, { h: 'Quality inspection', r: 1, f: r => qf(r.qi) }, { h: 'Blocked', r: 1, f: r => qf(r.blk) }], sl)}<div class="fl-foot"><button type="button" class="fl-btn" data-call="F_TRF" data-p='${esc(JSON.stringify({ matnr: M.matnr }))}'>Transfer stock</button><button type="button" class="fl-btn" data-call="MD04" data-p='${esc(JSON.stringify({ matnr: M.matnr }))}'>Stock/requirements (MD04)</button></div></div>`; }
    return shell('Stock – Single Material', `<div class="fl-filter"><label>Material ${I('matnr', { f4: 'mat', w: 14 })}</label><button type="button" class="fl-btn pri" data-act="go">Go</button></div>${body}`);
  }
});
const TRF = { 'unr>unr': '311', 'qi>unr': '321', 'unr>qi': '322', 'blk>unr': '343', 'unr>blk': '344' };
TX.F_TRF = fiori({
  title: 'Transfer Stock – In-Plant',
  init: p => ({ matnr: p.matnr || '', from: '101A', fst: 'unr', to: '101A', tst: 'qi', qty: '' }),
  acts: { post: c => {
    const m = c.m; m.matnr = U(m.matnr); MMSB.needMat(m.matnr, '1010', 'matnr'); m.from = U(m.from); m.to = U(m.to);
    if (!ORG.slocs[m.from]) err('Choose a source storage location', null, 'from'); if (!ORG.slocs[m.to]) err('Choose a target storage location', null, 'to');
    const q = N(m.qty); if (!(q > 0)) err('Enter a quantity', null, 'qty');
    let mvt; if (m.from !== m.to) { if (m.fst !== 'unr' || m.tst !== 'unr') err('Between storage locations, transfer unrestricted to unrestricted (311)'); mvt = '311'; } else { mvt = TRF[`${m.fst}>${m.tst}`]; if (!mvt) err('This combination of stock types is not supported (choose different source and target)'); }
    const items = [{ matnr: m.matnr, plant: '1010', sloc: m.from, toSloc: m.to, qty: q }];
    const md = postMvt({ mvt, items, text: 'Fiori transfer' });
    emit('MVT_POSTED', { md, mvt, fiori: true, items: [{ matnr: m.matnr, qty: q, toSloc: mvt === '311' ? m.to : '' }] });
    c.m = TX.F_TRF.init({ matnr: m.matnr }); msg('S', `Material document ${md} posted (movement type ${mvt})`);
  } },
  render: c => shell('Transfer Stock – In-Plant', `<div class="fl-card"><div class="fl-ct">Transfer</div><div class="fl-form grid2">
    <label>Material ${I('matnr', { f4: 'mat', w: 14 })}</label><label>Quantity ${I('qty', { w: 8, num: 1 })}</label>
    <label>From storage location ${I('from', { f4: 'sloc', w: 5 })}</label><label>From stock type ${I('fst', { type: 'select', opts: { unr: 'Unrestricted', qi: 'Quality inspection', blk: 'Blocked' } })}</label>
    <label>To storage location ${I('to', { f4: 'sloc', w: 5 })}</label><label>To stock type ${I('tst', { type: 'select', opts: { unr: 'Unrestricted', qi: 'Quality inspection', blk: 'Blocked' } })}</label></div>
    <p class="small muted">The app picks the movement type for you: 311 (storage location), 321/322 (quality inspection), 343/344 (blocked). In SAP GUI you choose it yourself in MIGO.</p><div class="fl-foot"><button type="button" class="fl-btn pri" data-act="post">Post</button></div></div>`),
  save: c => TX.F_TRF.acts.post(c)
});

// ---------- Lists ----------
TX.F_MDOC = fiori({
  title: 'Material Documents Overview', init: () => ({ q: '' }),
  render: c => { const q = c.m.q.trim().toLowerCase(); const rows = Object.values(S.matDocs).reverse().filter(d => !q || [d.num, d.mvt, ...d.items.map(i => i.matnr)].join(' ').toLowerCase().includes(q)); return shell('Material Documents Overview', `<div class="fl-filter"><label>Search ${I('q', { w: 22, ph: 'document, material, movement type' })}</label><button type="button" class="fl-btn pri">Go</button></div><div class="fl-card"><div class="fl-ct">Material documents (${rows.length})</div>${grid([{ h: 'Document', f: d => `<b>${d.num}</b>` }, { h: 'Movement type', f: d => `${d.mvt} ${esc(MMSB.mvtName(d.mvt))}` }, { h: 'Materials', f: d => d.items.map(i => `${i.matnr} ×${qf(i.qty)}`).join(', ') }, { h: 'Posting date', f: d => fmtD(d.date) }, { h: 'Status', f: d => d.reversedBy ? chip('Reversed', 'err') : d.revOf ? chip('Reversal') : chip('Posted', 'ok') }], rows, { click: d => `data-call="MIGO" data-p='${esc(JSON.stringify({ display: d.num }))}'` })}</div>`); }, enter: () => {}
});
TX.F_INV = fiori({
  title: 'Supplier Invoices List', init: () => ({ st: '' }),
  render: c => { const rows = Object.values(S.invoices).reverse().filter(D => !c.m.st || (c.m.st === 'blocked' ? D.blocked && D.status === 'posted' : c.m.st === 'paid' ? D.paid : D.status === c.m.st)); return shell('Supplier Invoices List', `<div class="fl-filter"><label>Status ${I('st', { type: 'select', opts: { '': 'All', parked: 'Parked', blocked: 'Blocked for payment', posted: 'Posted', paid: 'Paid', reversed: 'Reversed' }, rr: 1 })}</label></div><div class="fl-card"><div class="fl-ct">Supplier invoices (${rows.length})</div>${grid([{ h: 'Invoice', f: D => `<b>${D.num}</b><br><small class="muted">${esc(D.ref)}</small>` }, { h: 'Supplier', f: D => esc(vname(D.vendor)) }, { h: 'Purchase order', f: D => D.po || '—' }, { h: 'Gross amount', r: 1, f: D => `${D.cm ? '-' : ''}${money(D.gross)} EUR` }, { h: 'Status', f: D => invStatus(D) }, { h: '', f: D => D.blocked && D.status === 'posted' ? `<button type="button" class="fl-btn" data-act="rel" data-inv="${D.num}">Release</button>` : '' }], rows, { click: D => `data-call="MIR4" data-p='${esc(JSON.stringify({ inv: D.num }))}'` })}</div><p class="small muted">Releasing here is the same as MRBR: it removes payment block R.</p>`); },
  acts: { rel: (c, d) => { const D = S.invoices[d.inv]; D.blocked = false; D.released = today(); emit('IR_RELEASED', { invs: [D.num], fiori: true }); msg('S', `Invoice ${D.num} released for payment`); } },
  enter: () => {}
});
TX.F_INBOX = fiori({
  title: 'My Inbox',
  acts: {
    ok: (c, d) => { const D = d.kind === 'po' ? S.pos[d.num] : S.prs[d.num]; const code = MMSB.releaseNext(D); emit(d.kind === 'po' ? 'PO_RELEASED' : 'PR_RELEASED', { num: D.num, code, final: D.released, fiori: true }); msg('S', `${d.kind === 'po' ? 'Purchase order' : 'Requisition'} ${D.num} approved (${code})${D.released ? '' : ' · waiting for next level'}`); },
    no: (c, d) => { msg('I', `Rejection noted for ${d.num}: in this sandbox the document simply stays unreleased. Change it (ME22N/ME52N) or delete the items.`); }
  },
  render: () => {
    const items = [...Object.values(S.pos).filter(P => P.relReq && !P.released).map(P => ({ kind: 'po', D: P, val: poVal(P), t: `Purchase order ${P.num}`, s: `${vname(P.vendor)} · ${P.items.map(i => `${i.matnr} ×${qf(i.qty)}`).join(', ')}` })),
      ...Object.values(S.prs).filter(P => P.relReq && !P.released).map(P => ({ kind: 'pr', D: P, val: r2(sum(P.items, i => i.qty * (i.valPrice || 0))), t: `Purchase requisition ${P.num}`, s: P.items.map(i => `${i.matnr} ×${qf(i.qty)}`).join(', ') }))];
    return shell('My Inbox', `<div class="fl-card"><div class="fl-ct">Approve purchasing documents (${items.length})</div>${items.length ? items.map(x => `<div class="fl-task"><div><b>${esc(x.t)}</b><br><small>${esc(x.s)}</small><br><small class="muted">Step ${x.D.relDone.length + 1} of ${x.D.relCodes.length} · release code ${x.D.relCodes.find(cd => !x.D.relDone.includes(cd))}</small></div><div class="fl-tv">${money(x.val)} EUR</div><div><button type="button" class="fl-btn pri" data-act="ok" data-kind="${x.kind}" data-num="${x.D.num}">Approve</button> <button type="button" class="fl-btn" data-act="no" data-num="${x.D.num}">Reject</button></div></div>`).join('') : '<div class="fl-empty">No tasks. Documents above the release limit appear here.</div>'}</div>`);
  }
});
TX.F_OVD = fiori({
  title: 'Monitor Purchase Order Items', init: () => ({ only: true }),
  render: c => { const rows = Object.values(S.pos).flatMap(P => P.items.filter(i => !i.del).map(i => ({ ...i, P, t: poTotals(P, i) }))).filter(r => r.t.toDeliver > 0 && (!c.m.only || r.date < today())).sort((a, b) => a.date < b.date ? -1 : 1);
    return shell('Monitor Purchase Order Items', `<div class="fl-filter"><label>${I('only', { type: 'check', rr: 1 })} Overdue only</label></div><div class="fl-card"><div class="fl-ct">Open items (${rows.length})</div>${grid([{ h: 'Purchase order', f: r => `<b>${r.P.num}</b>/${r.item}` }, { h: 'Supplier', f: r => esc(vname(r.P.vendor)) }, { h: 'Material', k: 'matnr' }, { h: 'Open qty', r: 1, f: r => `${qf(r.t.toDeliver)} ${r.uom}` }, { h: 'Delivery date', f: r => fmtD(r.date) + (r.date < today() ? ' ' + chip(`${Math.round((new Date(today()) - new Date(r.date)) / 864e5)} days late`, 'err') : '') }], rows, { click: r => `data-call="F_PO" data-p='${esc(JSON.stringify({ po: r.P.num }))}'`, empty: c.m.only ? 'No overdue items' : 'No open items' })}</div>`); }
});
TX.F_PR = fiori({
  title: 'Process Purchase Requisitions',
  render: () => { const rows = Object.values(S.prs).flatMap(p => p.items.filter(i => !i.poRef && !i.del).map(i => ({ ...i, P: p }))); return shell('Process Purchase Requisitions', `<div class="fl-card"><div class="fl-ct">Open requisition items (${rows.length})</div>${grid([{ h: 'Requisition', f: r => `<b>${r.P.num}</b>/${r.item}${r.P.origin === 'MRP' ? ' ' + chip('MRP') : ''}` }, { h: 'Material', f: r => `${r.matnr}<br><small class="muted">${esc(r.short)}</small>` }, { h: 'Quantity', r: 1, f: r => `${qf(r.qty)} ${r.uom}` }, { h: 'Delivery date', f: r => fmtD(r.date) }, { h: 'Supplier', f: r => r.vendor ? esc(vname(r.vendor)) : chip('No source', 'warn') }, { h: 'Approval', f: r => r.P.relReq && !r.P.released ? chip('Pending', 'warn') : chip('OK', 'ok') }], rows)}<div class="fl-foot"><button type="button" class="fl-btn" data-call="ME56" data-p="{}">Assign sources (ME56)</button><button type="button" class="fl-btn pri" data-call="ME57" data-p="{}">Convert to POs (ME57)</button></div></div>`); }
});
TX.F_PIDOC = fiori({
  title: 'Manage Physical Inventory Documents',
  render: () => { const rows = Object.values(S.pids || {}).reverse(); return shell('Manage Physical Inventory Documents', `<div class="fl-card"><div class="fl-ct">Physical inventory documents (${rows.length})</div>${grid([{ h: 'Document', f: d => `<b>${d.num}</b>` }, { h: 'Storage location', k: 'sloc' }, { h: 'Materials', f: d => d.items.map(i => i.matnr).join(', ') }, { h: 'Created', f: d => fmtD(d.date) }, { h: 'Status', f: d => chip(d.status, d.status === 'posted' ? 'ok' : d.status === 'counted' ? 'warn' : '') }, { h: 'Next step', f: d => d.status === 'created' ? lnk('MI04', { pid: d.num }, 'Enter count') : d.status === 'counted' ? lnk('MI07', { pid: d.num }, 'Post differences') : '' }], rows, { empty: 'No documents: create one with MI01' })}<div class="fl-foot"><button type="button" class="fl-btn pri" data-call="MI01" data-p="{}">Create (MI01)</button></div></div>`); }
});

// ---------- Analytics ----------
const bars = (data, unit) => { const max = Math.max(1, ...data.map(d => d.v)); return `<div class="fl-bars">${data.map(d => `<div class="fl-bar"><span class="fl-bl">${esc(d.l)}</span><span class="fl-bt"><i style="width:${(d.v / max * 100).toFixed(1)}%"></i></span><span class="fl-bv">${money(d.v)} ${unit}</span></div>`).join('') || '<div class="fl-empty">No data</div>'}</div>`; };
TX.F_SPEND = fiori({
  title: 'Purchasing Spend',
  onOpen: () => emit('REPORT', { tcode: 'F_SPEND' }),
  render: () => {
    const items = Object.values(S.pos).flatMap(P => P.items.filter(i => !i.del && i.cat !== 'K').map(i => ({ v: P.vendor, g: S.materials[i.matnr]?.group || i.group, val: i.qty * i.price / i.per })));
    const by = (k, lab) => Object.entries(items.reduce((a, x) => (a[x[k]] = (a[x[k]] || 0) + x.val, a), {})).map(([key, v]) => ({ l: lab(key), v: r2(v) })).sort((a, b) => b.v - a.v);
    const total = r2(sum(items, x => x.val));
    return shell('Purchasing Spend', `<div class="fl-kpirow"><div class="fl-kpi"><small>Total PO value</small><b>${money(total)}</b><span>EUR</span></div><div class="fl-kpi"><small>Purchase orders</small><b>${Object.keys(S.pos).length}</b><span>documents</span></div><div class="fl-kpi"><small>Suppliers used</small><b>${new Set(items.map(x => x.v)).size}</b><span>suppliers</span></div></div>
      <div class="fl-two"><div class="fl-card"><div class="fl-ct">Spend by supplier</div>${bars(by('v', v => `${v} ${vname(v)}`), 'EUR')}</div><div class="fl-card"><div class="fl-ct">Spend by material group</div>${bars(by('g', g => `${g} ${ORG.mgroups[g] || ''}`), 'EUR')}</div></div>`);
  }
});

SCEN.push({ id: 'fiori', title: '20. The same process in Fiori', level: 'Fiori · 15 min',
  intro: 'Run a purchase-to-receipt cycle from the Fiori launchpad and compare it with SAP GUI.',
  steps: [
    { t: 'Open the Fiori launchpad (<b>/UI2/FLP</b>).', h: 'Type /n/UI2/FLP in the command field, or Menu › SAP Fiori launchpad.', ok: e => e.type === 'TX_OPEN' && e.tcode === '/UI2/FLP' },
    { t: 'Create a PO for <b>12 PC</b> of <b>TG15</b> from <b>100002</b> with the "Create Purchase Order – Advanced" tile.', h: 'Tile "Create Purchase Order – Advanced" opens ME21N. 100002 → TG15, 12 → Enter (gross 139, discount 3%, freight 4 from the info record: check Cond.) → Ctrl+S.', ok: e => e.type === 'PO_CREATED' && e.vendor === '100002' && e.items.some(i => i.matnr === 'TG15' && i.qty === 12), cap: (e, x) => { x.po = e.num; } },
    { t: 'Find your PO in <b>Manage Purchase Orders</b> and open it: look at the process flow.', h: 'Home ⌂ → Manage Purchase Orders → click your PO.', ok: (e, x) => e.type === 'PO_DISPLAY' && e.fiori && e.num === x.po },
    { t: 'Post the goods receipt with the Fiori app <b>Post Goods Receipt for Purchasing Document</b>.', h: 'In the object page click "Post goods receipt" (or use the tile) → Go → Post.', ok: (e, x) => e.type === 'GR_POSTED' && e.fiori && e.po === x.po },
    { t: 'Check the result in <b>Stock – Single Material</b> for TG15.', h: 'Home → Stock – Single Material → TG15 → Go.', ok: e => e.type === 'STOCK_VIEW' && e.fiori && e.matnr === 'TG15' },
    { t: 'Open <b>Purchasing Spend</b> and find your supplier\'s share.', h: 'Home → Purchasing Spend.', ok: e => e.type === 'REPORT' && e.tcode === 'F_SPEND' }
  ],
  notes: ['Fiori apps run on the same tables and documents as SAP GUI: a PO posted in one is visible in the other.', 'Many S/4HANA launchpads mix role-based Fiori apps with classic transactions in "SAP GUI for HTML" tiles.', 'Teach both: end users increasingly start in Fiori; key users and consultants still live in SAP GUI.'] });
HOOKS.open = HOOKS.open || [];
HOOKS.open.push(code => { if (code === '/UI2/FLP') emit('TX_OPEN', { tcode: code }); });
})();
