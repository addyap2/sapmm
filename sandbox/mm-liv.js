/* MM Sandbox: invoice verification extras (cancel, ERS, consignment settlement), payment run, supplier line items, supplier changes. */
(() => {
'use strict';
const { S, ORG, GL, TX, F4, F4T, TITLES, SCEN, HOOKS, esc, pad, today, dPlus, fmtD, parseD, N, r2, r3, money, qf, U, sum, err, nextNo,
  vname, poTotals, postIR, createAcc, line, flipLines, applyVals, emit, msg, call, act, F, I, box, tabs, tabOn, grid, lnk, req, needDate, needVendor, invStatus } = MMSB;

HOOKS.ensure.push(S => { S.payments ??= {}; });
HOOKS.seed.push(S => { S.payments = {}; });
Object.assign(TITLES, { MR8M: 'Cancel Invoice Document', MRRL: 'Evaluated Receipt Settlement (ERS)', MRKO: 'Consignment Settlement', F110: 'Automatic Payment Transactions', FBL1N: 'Supplier Line Item Display', MIR6: 'Supplier Invoices List' });
const terms = v => S.vendors[v]?.porg?.['1010']?.terms || S.vendors[v]?.cc?.['1010']?.terms || 'NT30';
const dueDate = D => { const d = new Date(D.date + 'T12:00:00'); d.setDate(d.getDate() + (ORG.termDays[terms(D.vendor)] ?? 30)); return d.toISOString().slice(0, 10); };
MMSB.dueDate = dueDate;

// ---------- BP: change purchasing data (ERS, GR-based IV, payment terms) ----------
const BP0 = { ...TX.BP };
TX.BP = {
  ...BP0,
  title: c => c.m.mode === 'edit' ? `Change Organization: ${c.m.bp}, ${vname(c.m.bp)}` : BP0.title(c),
  tb: c => c.m.mode === 'show' ? [{ l: 'Change purchasing data', i: '✎', a: c => act(c => { const V = S.vendors[c.m.bp]; const p = V.porg?.['1010']; Object.assign(c.m, { mode: 'edit', has01: !!p, e01: !!p, eTerms: p?.terms || 'NT30', eGrIv: p ? !!p.grIv : true, eErs: !!p?.ers }); }) }] : BP0.tb(c),
  render: c => c.m.mode !== 'edit' ? BP0.render(c) : box(`Business partner ${c.m.bp} · purchasing organization 1010`, F('BP role FLVN01', 'e01', { type: 'check', ro: c.m.has01, desc: c.m.has01 ? 'Supplier (purchasing) – assigned' : 'Tick to add the purchasing role' }) + F('Payment terms', 'eTerms', { f4: 'terms', w: 6, desc: ORG.payterms[U(c.m.eTerms)] || '' }) + F('GR-based inv. verif.', 'eGrIv', { type: 'check' }) + F('Evaluated receipt settlement (ERS)', 'eErs', { type: 'check', desc: 'Invoices are created automatically from goods receipts (MRRL)' })) + '<div class="tip">ERS applies to purchase orders created <b>after</b> the flag is set (the PO copies it).</div>',
  save: c => {
    if (c.m.mode !== 'edit') return BP0.save(c);
    const V = S.vendors[c.m.bp];
    if (!c.m.e01) err('Tick role FLVN01 to maintain purchasing data', null, 'e01');
    if (!ORG.payterms[U(c.m.eTerms)]) err(`Payment terms ${c.m.eTerms} do not exist`, null, 'eTerms');
    V.porg ??= {}; V.porg['1010'] = { ...(V.porg['1010'] || { curr: 'EUR' }), terms: U(c.m.eTerms), grIv: !!c.m.eGrIv, ers: !!c.m.eErs };
    emit('VENDOR_CHANGED', { bp: V.id, ers: !!c.m.eErs, purch: true });
    c.m.mode = 'show'; msg('S', `Business partner ${V.id} changed`);
  },
  back: c => { if (c.m.mode === 'edit') { c.m.mode = 'show'; return true; } return BP0.back(c); }
};

// ---------- MR8M ----------
TX.MR8M = {
  title: 'Cancel Invoice Document',
  init: p => ({ inv: p.inv || '', reason: '01', date: fmtD(today()) }),
  render: c => {
    const D = S.invoices[String(c.m.inv).trim()];
    return box('Invoice document', F('Invoice document no.', 'inv', { req: 1, f4: 'inv', w: 12 }) + F('Reversal reason', 'reason', { type: 'select', opts: { '01': '01 Reversal in current period', '02': '02 Reversal in closed period' } }) + F('Posting date', 'date', { w: 10 })) +
      (D ? box(`${D.cm ? 'Credit memo' : D.kind === 'KN' ? 'Consignment settlement' : 'Invoice'} ${D.num}`, `<table class="g orgtbl"><tr><td>Supplier</td><td>${D.vendor} ${esc(vname(D.vendor))}</td></tr><tr><td>Gross amount</td><td>${money(D.gross)} EUR</td></tr><tr><td>Status</td><td>${invStatus(D)}</td></tr></table>`) : '') +
      '<div class="tip">MR8M posts a reversal document: the PO history, GR/IR clearing, tax and supplier entries are reversed. A paid invoice cannot be cancelled until the payment is reversed.</div>';
  },
  save: c => {
    req(c, ['inv']); const num = String(c.m.inv).trim(); const D = S.invoices[num];
    if (!D) err(`Invoice document ${num} does not exist`, null, 'inv');
    if (D.status === 'parked') err(`Document ${num} is only parked: post it or leave it (nothing to cancel)`, null, 'inv');
    if (D.status === 'reversed') err(`Document ${num} has already been reversed (by ${D.revBy})`, null, 'inv');
    if (D.status === 'reversal') err(`Document ${num} is itself a reversal document`, null, 'inv');
    if (D.paid) err(`Document ${num} is already paid (cleared on ${fmtD(D.paid)}): reverse the payment first`, 'INV_PAID', 'inv');
    if (D.kind === 'KN' || D.kind === 'MR11') err('Consignment settlements and account maintenance documents cannot be cancelled in this sandbox', null, 'inv');
    const date = needDate(c, 'date'); const P = S.pos[D.po]; const s = D.cm ? 1 : -1;
    for (const x of D.items) { const it = P.items.find(i => i.item === x.item); const t = poTotals(P, it); if (D.cm && t.ir + x.qty > t.gr + 1e-9 && false) err(''); }
    const rnum = nextNo('inv');
    for (const x of D.items) P.history.push({ type: 'RE', mvt: '', doc: rnum, year: date.slice(0, 4), item: x.item, qty: s * x.qty, amount: s * x.amount, date });
    applyVals(D.valuation || [], -1);
    const acc = createAcc('RE', rnum, date, flipLines(S.accDocs[D.acc].lines));
    S.invoices[rnum] = { num: rnum, year: date.slice(0, 4), date, ref: `Reversal of ${num}`, po: D.po, vendor: D.vendor, gross: D.gross, taxCode: D.taxCode, tax: D.tax, udc: D.udc, cm: !D.cm, items: D.items, blocked: false, reasons: [], acc, status: 'reversal', of: num, paid: null };
    D.status = 'reversed'; D.revBy = rnum; D.revAcc = acc; D.blocked = false;
    emit('IR_REVERSED', { inv: num, rev: rnum, po: D.po });
    c.m = TX.MR8M.init({}); msg('S', `Document reversed with document ${rnum}`);
  }
};

// ---------- MRRL ----------
TX.MRRL = {
  title: c => c.m.list ? 'Evaluated Receipt Settlement: Items to Settle' : 'Evaluated Receipt Settlement (ERS): Selection',
  init: () => ({ vendor: '', list: false, test: false }),
  tb: c => c.m.list ? [{ l: c.m.test ? 'Test run: nothing posted' : 'Settle', i: '💾', a: c => act(TX.MRRL.settle) }] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MRRL.exec) }],
  rows: c => Object.values(S.pos).filter(P => P.ers && (!c.m.vendor.trim() || P.vendor === c.m.vendor.trim())).flatMap(P => P.items.filter(it => it.cat !== 'K').map(it => ({ P, it, t: poTotals(P, it) })).filter(x => x.t.toInvoice > 1e-9)),
  render: c => {
    if (!c.m.list) return box('Selection', F('Supplier', 'vendor', { f4: 'vendor', w: 10 }) + F('Company code', '_cc', { ro: 1, w: 6, desc: '1010' }) + F('Test run', 'test', { type: 'check' })) + '<div class="tip">ERS: the supplier does not send invoices. The system creates them from goods receipts at the PO price, with tax code V1. Only POs of suppliers flagged for ERS (BP › purchasing data) are selected.</div>';
    const rows = TX.MRRL.rows(c);
    return box(`Goods receipts to settle (${rows.length})`, grid([{ h: 'PO', f: r => lnk('ME23N', { po: r.P.num }, r.P.num) }, { h: 'Item', f: r => r.it.item }, { h: 'Supplier', f: r => `${r.P.vendor} ${esc(vname(r.P.vendor))}` }, { h: 'Material', f: r => r.it.matnr }, { h: 'Qty to settle', r: 1, f: r => qf(r.t.toInvoice) }, { h: 'Net amount EUR', r: 1, f: r => money(r.t.toInvoice * r.it.price / r.it.per) }], rows, { empty: 'Nothing to settle: no ERS purchase order has uninvoiced goods receipts' }));
  },
  exec: c => { c.m.list = true; },
  settle: c => {
    const rows = TX.MRRL.rows(c); if (!rows.length) err('Nothing to settle');
    if (c.m.test) { msg('I', `Test run: ${new Set(rows.map(r => r.P.num)).size} invoice(s) would be created`); return; }
    const byPO = {}; rows.forEach(r => (byPO[r.P.num] ??= []).push(r));
    const nums = Object.entries(byPO).map(([po, rs]) => {
      const items = rs.map(r => ({ item: r.it.item, qty: r.t.toInvoice, amount: r2(r.t.toInvoice * r.it.price / r.it.per) }));
      const net = r2(sum(items, x => x.amount)), tax = r2(net * 0.2);
      const inv = postIR({ po, ref: `ERS ${fmtD(today())}`, gross: r2(net + tax), taxCode: 'V1', tax, items });
      emit('IR_POSTED', { inv, po, blocked: S.invoices[inv].blocked, qty: sum(items, x => x.qty), ers: true });
      return inv;
    });
    c.m.list = false; msg('S', `${nums.length} invoice document${nums.length > 1 ? 's' : ''} created by ERS: ${nums.join(', ')}`);
  },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};

// ---------- MRKO ----------
TX.MRKO = {
  title: c => c.m.list ? 'Consignment Withdrawals: Settle' : 'Consignment and Pipeline Settlement: Selection',
  init: () => ({ vendor: '', list: false, mode: 'open' }),
  tb: c => c.m.list && c.m.mode === 'open' ? [{ l: 'Settle', i: '💾', a: c => act(TX.MRKO.settle) }] : c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MRKO.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Supplier', 'vendor', { f4: 'vendor', w: 10 }) + F('Processing', 'mode', { type: 'select', opts: { open: 'Settle open withdrawals', all: 'Display all withdrawals' } })) + '<div class="tip">Consignment stock belongs to the supplier. You only owe money when you withdraw it (411 K, or consumption). MRKO turns the withdrawals into a supplier liability, valued at the consignment info record price.</div>';
    const v = c.m.vendor.trim(); const rows = (S.consign || []).filter(x => (!v || x.vendor === v) && (c.m.mode === 'all' || !x.settled));
    return box(`Withdrawals (${rows.length})`, grid([{ h: 'Material doc.', f: r => lnk('MIGO', { display: r.md }, r.md) }, { h: 'Date', f: r => fmtD(r.date) }, { h: 'Supplier', f: r => `${r.vendor} ${esc(vname(r.vendor))}` }, { h: 'Material', k: 'matnr' }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: 'Amount EUR', r: 1, f: r => money(r.amount) }, { h: 'Settled', f: r => r.settled ? lnk('MIR4', { inv: r.settled }, r.settled) : '' }], rows, { empty: 'No consignment withdrawals' }));
  },
  exec: c => { c.m.list = true; },
  settle: c => {
    const v = c.m.vendor.trim(); const rows = (S.consign || []).filter(x => (!v || x.vendor === v) && !x.settled);
    if (!rows.length) err('Nothing to settle');
    const byV = {}; rows.forEach(r => (byV[r.vendor] ??= []).push(r));
    const nums = Object.entries(byV).map(([vd, rs]) => {
      const net = r2(sum(rs, r => r.amount)), tax = r2(net * 0.2); const inv = nextNo('inv');
      const acc = createAcc('KN', inv, today(), [line('gl', 'KON', 'D', net), line('VST', 'VST', 'D', tax, { tax: 'V1' }), line('AP', 'AP', 'C', r2(net + tax), { vendor: vd })]);
      S.invoices[inv] = { num: inv, kind: 'KN', year: today().slice(0, 4), date: today(), ref: 'Consignment settlement', po: '', vendor: vd, gross: r2(net + tax), taxCode: 'V1', tax, udc: 0, cm: false, items: rs.map((r, i) => ({ item: i + 1, matnr: r.matnr, qty: r.qty, amount: r.amount })), blocked: false, reasons: [], acc, status: 'posted', paid: null };
      rs.forEach(r => { r.settled = inv; });
      emit('CONS_SETTLED', { inv, vendor: vd, net });
      return inv;
    });
    c.m.list = false; msg('S', `${nums.length} settlement document${nums.length > 1 ? 's' : ''} posted: ${nums.join(', ')}`);
  },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};

// ---------- F110 ----------
const openItems = v => Object.values(S.invoices).filter(D => D.status === 'posted' && D.kind !== 'MR11' && !D.paid && (!v || D.vendor === v));
TX.F110 = {
  title: c => c.m.prop ? `Automatic Payment Transactions: Proposal · run ${fmtD(today())} / ${c.m.id}` : 'Automatic Payment Transactions: Parameters',
  init: () => ({ id: 'RIV01', next: fmtD(dPlus(31)), vendor: '', prop: false }),
  tb: c => c.m.prop ? [{ l: 'Payment run', i: '💶', a: c => act(TX.F110.run) }, { l: 'Edit parameters', i: '✎', a: c => act(c => { c.m.prop = false; }) }] : [{ l: 'Proposal', i: '⏵', a: c => act(TX.F110.exec) }],
  proposal: c => {
    const nxt = parseD(c.m.next); const v = c.m.vendor.trim();
    const items = openItems(v).map(D => ({ D, due: dueDate(D) }));
    const pay = [], exc = [];
    for (const x of items) { if (x.D.blocked) exc.push({ ...x, why: 'Blocked for payment (R)' }); else if (!x.D.cm && x.due > nxt) exc.push({ ...x, why: `Not due before next run (due ${fmtD(x.due)})` }); else pay.push(x); }
    const byV = {}; pay.forEach(x => (byV[x.D.vendor] ??= []).push(x));
    const vendors = Object.entries(byV).map(([vd, xs]) => ({ vd, xs, amt: r2(sum(xs, x => x.D.cm ? -x.D.gross : x.D.gross)) }));
    vendors.filter(g => g.amt <= 0).forEach(g => g.xs.forEach(x => exc.push({ ...x, why: 'Supplier has a credit balance' })));
    return { vendors: vendors.filter(g => g.amt > 0), exc };
  },
  render: c => {
    if (!c.m.prop) return box('Parameters', F('Run date', '_d', { ro: 1, w: 10, desc: fmtD(today()) }) + F('Identification', 'id', { req: 1, w: 6 }) + F('Company code', '_cc', { ro: 1, w: 6, desc: '1010' }) + F('Payment method', '_pm', { ro: 1, w: 4, desc: 'T Bank transfer (SEPA)' }) + F('Next payment date', 'next', { req: 1, w: 10 }) + F('Supplier', 'vendor', { f4: 'vendor', w: 10, desc: 'empty = all' })) +
      '<div class="tip">The payment run pays every open supplier item that is due before the <b>next payment date</b>, is not blocked and leaves a positive balance per supplier (credit memos are offset). Each payment posts Dr supplier / Cr bank and clears the items.</div>';
    const p = TX.F110.proposal(c);
    return box(`Payments (${p.vendors.length} supplier${p.vendors.length === 1 ? '' : 's'}) · total ${money(sum(p.vendors, g => g.amt))} EUR`, grid([{ h: 'Supplier', f: g => `${g.vd} ${esc(vname(g.vd))}` }, { h: 'Documents', f: g => g.xs.map(x => `${x.D.num}${x.D.cm ? ' (CM)' : x.D.kind === 'KN' ? ' (KN)' : ''}`).join(', ') }, { h: 'Amount EUR', r: 1, f: g => money(g.amt) }], p.vendors, { empty: 'Nothing to pay' })) +
      box(`Exceptions (${p.exc.length})`, grid([{ h: 'Document', f: x => lnk('MIR4', { inv: x.D.num }, x.D.num) }, { h: 'Supplier', f: x => `${x.D.vendor} ${esc(vname(x.D.vendor))}` }, { h: 'Amount EUR', r: 1, f: x => money(x.D.cm ? -x.D.gross : x.D.gross) }, { h: 'Reason', f: x => esc(x.why) }], p.exc, { empty: 'No exceptions' }));
  },
  exec: c => { req(c, ['id', 'next']); needDate(c, 'next'); c.m.prop = true; emit('PAY_PROPOSAL', {}); },
  run: c => {
    const p = TX.F110.proposal(c); if (!p.vendors.length) err('Nothing to pay in this proposal');
    const docs = p.vendors.map(g => {
      const an = createAcc('ZP', `F110 ${c.m.id}`, today(), [line('APP', 'AP', 'D', g.amt, { vendor: g.vd }), line('gl', 'BANK', 'C', g.amt)]);
      S.payments[an] = { num: an, date: today(), vendor: g.vd, amount: g.amt, docs: g.xs.map(x => x.D.num), run: c.m.id };
      g.xs.forEach(x => { x.D.paid = today(); x.D.payDoc = an; });
      return an;
    });
    emit('PAYMENT_RUN', { n: docs.length, vendors: p.vendors.map(g => g.vd), total: r2(sum(p.vendors, g => g.amt)) });
    c.m = TX.F110.init(); msg('S', `Payment run ${today()} / RIV01 executed: ${docs.length} payment document${docs.length > 1 ? 's' : ''} (${docs.join(', ')})`);
  },
  back: c => { if (c.m.prop) { c.m.prop = false; return true; } }
};

// ---------- FBL1N / MIR6 ----------
TX.FBL1N = {
  title: c => c.m.list ? 'Supplier Line Item Display' : 'Supplier Line Item Display: Selection',
  init: p => ({ vendor: p.vendor || '', status: 'open', list: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.FBL1N.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Supplier', 'vendor', { f4: 'vendor', w: 10, desc: 'empty = all' }) + F('Company code', '_cc', { ro: 1, w: 6, desc: '1010' }) + F('Line item selection', 'status', { type: 'select', opts: { open: 'Open items', cleared: 'Cleared items', all: 'All items' } }));
    const v = c.m.vendor.trim();
    const inv = Object.values(S.invoices).filter(D => D.status !== 'parked' && D.kind !== 'MR11' && (!v || D.vendor === v)).map(D => ({ open: D.status === 'posted' && !D.paid, type: D.kind === 'KN' ? 'KN' : D.cm ? 'KG' : 'RE', doc: D.num, acc: D.acc, date: D.date, due: dueDate(D), amt: D.cm ? D.gross : -D.gross, vendor: D.vendor, block: D.blocked && D.status === 'posted', ref: D.ref, clr: D.paid ? D.payDoc : D.status !== 'posted' ? (D.revBy || D.of) : '' }));
    const pay = Object.values(S.payments).filter(p => !v || p.vendor === v).map(p => ({ open: false, type: 'ZP', doc: p.num, acc: p.num, date: p.date, due: p.date, amt: p.amount, vendor: p.vendor, ref: `Payment run ${p.run}`, clr: p.num }));
    const rows = [...inv, ...pay].filter(r => c.m.status === 'all' || (c.m.status === 'open') === r.open).sort((a, b) => a.date < b.date ? -1 : 1);
    return box(`Line items (${rows.length})`, grid([{ h: 'St', f: r => `<span class="light ${r.open ? 'r' : 'g'}" title="${r.open ? 'Open' : 'Cleared'}"></span>` }, { h: 'Supplier', f: r => `${r.vendor} ${esc(vname(r.vendor))}` }, { h: 'Type', k: 'type' }, { h: 'Document', f: r => r.type === 'ZP' ? lnk('FB03', { doc: r.acc }, r.doc) : lnk('MIR4', { inv: r.doc }, r.doc) }, { h: 'Doc. date', f: r => fmtD(r.date) }, { h: 'Net due date', f: r => fmtD(r.due) }, { h: 'Amount EUR', r: 1, f: r => money(r.amt) }, { h: 'Block', f: r => r.block ? '<span class="badge err">R</span>' : '' }, { h: 'Reference', f: r => esc(r.ref || '') }, { h: 'Clearing doc.', f: r => esc(r.clr || '') }], rows, { foot: rows.length ? `<tr class="tot"><td colspan="6">Balance</td><td class="r">${money(sum(rows, r => r.amt))}</td><td colspan="3">EUR (negative = we owe)</td></tr>` : '' }));
  },
  enter: c => TX.FBL1N.exec(c), exec: c => { if (c.m.list) return; c.m.list = true; emit('REPORT', { tcode: 'FBL1N', status: c.m.status, vendor: c.m.vendor.trim() }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};
TX.MIR6 = {
  title: c => c.m.list ? 'Supplier Invoices List' : 'Invoice Overview: Selection',
  init: () => ({ vendor: '', st: 'all', list: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MIR6.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Supplier', 'vendor', { f4: 'vendor', w: 10 }) + F('Status', 'st', { type: 'select', opts: { all: 'All', parked: 'Parked', blocked: 'Blocked for payment', posted: 'Posted', reversed: 'Reversed' } }));
    const v = c.m.vendor.trim(), st = c.m.st;
    const rows = Object.values(S.invoices).reverse().filter(D => (!v || D.vendor === v) && (st === 'all' || (st === 'blocked' ? D.blocked && D.status === 'posted' : st === 'reversed' ? ['reversed', 'reversal'].includes(D.status) : D.status === st)));
    return box(`Invoices (${rows.length})`, grid([{ h: 'Document', f: D => lnk('MIR4', { inv: D.num }, D.num) }, { h: 'Type', f: D => D.kind === 'KN' ? 'Consignment' : D.kind === 'MR11' ? 'Account maintenance' : D.sub ? (D.sub === 'D' ? 'Subsequent debit' : 'Subsequent credit') : D.cm ? 'Credit memo' : 'Invoice' }, { h: 'Supplier', f: D => `${D.vendor} ${esc(vname(D.vendor))}` }, { h: 'Reference', f: D => esc(D.ref) }, { h: 'Date', f: D => fmtD(D.date) }, { h: 'PO', f: D => D.po || '' }, { h: 'Gross EUR', r: 1, f: D => money(D.gross) }, { h: 'Status', f: D => invStatus(D) }], rows));
  },
  enter: c => TX.MIR6.exec(c), exec: c => { if (c.m.list) return; c.m.list = true; emit('REPORT', { tcode: 'MIR6' }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};

// ---------- Scenarios ----------
const poOf = (v, m, q) => e => e.type === 'GR_POSTED' && S.pos[e.po]?.vendor === v && S.pos[e.po].items.some(i => i.matnr === m && (!q || i.qty === q));
SCEN.push(
  { id: 'liv', title: '13. Park, credit memo & payment run', level: 'Invoicing · 25 min',
    intro: 'Follow an invoice from parking to payment, with a credit memo in between, and see the supplier account.',
    steps: [
      { t: 'Create a PO for <b>30 PC</b> of <b>TG12</b> from <b>100001</b> and post the goods receipt.', h: 'ME21N → 100001 → TG12, 30 → Ctrl+S. MIGO → A01 / R01 → the PO → OK → Post.', ok: poOf('100001', 'TG12', 30), cap: (e, x) => { x.po = e.po; } },
      { t: 'Park the invoice (<b>MIR7</b>): reference INV-7781, gross 500.40.', h: 'MIR7 → Reference INV-7781 → PO → Enter → gross 500.40 (30 × 13.90 = 417.00 + 20% VAT) → "Save as parked".', ok: (e, x) => e.type === 'IR_PARKED' && e.po === x.po, cap: (e, x) => { x.park = e.inv; } },
      { t: 'Post the parked invoice from <b>MIR4</b>.', h: 'MIR4 → the parked document → "Edit / post parked document" → check the green light → Post. The document keeps its number.', ok: (e, x) => e.type === 'IR_POSTED' && e.po === x.po && e.fromPark },
      { t: 'The supplier credits <b>5 PC</b> (damaged): post a <b>credit memo</b> in MIRO.', h: 'MIRO → Transaction: Credit memo → Reference CM-112 → PO → Enter → change quantity to 5 and amount to 69.50 → gross 83.40 → Post.', ok: (e, x) => e.type === 'IR_POSTED' && e.po === x.po && e.cm },
      { t: 'Run the payment run (<b>F110</b>) and pay supplier 100001.', h: 'F110 → keep the parameters → Proposal → check the credit memo is offset → Payment run.', ok: e => e.type === 'PAYMENT_RUN' && e.vendors.includes('100001') },
      { t: 'Display the cleared items of supplier 100001 in <b>FBL1N</b>.', h: 'FBL1N → Supplier 100001 → Cleared items → F8: invoice, credit memo and payment are green.', ok: e => e.type === 'REPORT' && e.tcode === 'FBL1N' && e.status !== 'open' }
    ],
    notes: ['Parking lets an AP clerk save an incomplete invoice (missing info, waiting for approval) without accounting impact.', 'A credit memo reduces the invoiced quantity in the PO history (RE-H) and reverses GR/IR and VAT.', 'F110 is FI, but MM trainers must explain why an invoice is not paid: blocked (R), not due, or credit balance.'] },
  { id: 'ers', title: '14. ERS & invoice cancellation', level: 'Invoicing · 20 min',
    intro: 'Let the system create invoices from goods receipts (evaluated receipt settlement), then cancel one with MR8M.',
    steps: [
      { t: 'Flag supplier <b>100003</b> for ERS (<b>BP</b> › change purchasing data).', h: 'BP → 100003 → Enter → "Change purchasing data" → tick ERS → Ctrl+S.', ok: e => e.type === 'VENDOR_CHANGED' && e.bp === '100003' && e.ers },
      { t: 'Create a PO for <b>200 PC</b> of <b>RM14</b> from 100003 and receive it.', h: 'ME21N → 100003 → RM14, 200 → Ctrl+S. MIGO → GR → OK → Post. (ME23N › Status shows "ERS".)', ok: e => e.type === 'GR_POSTED' && S.pos[e.po]?.ers && S.pos[e.po].vendor === '100003', cap: (e, x) => { x.po = e.po; } },
      { t: 'Run <b>MRRL</b> to create the invoice automatically.', h: 'MRRL → Supplier 100003 → F8 → Settle.', ok: (e, x) => e.type === 'IR_POSTED' && e.ers && e.po === x.po, cap: (e, x) => { x.inv = e.inv; } },
      { t: 'Cancel the ERS invoice with <b>MR8M</b>.', h: 'MR8M → the invoice number (F4) → reason 01 → Ctrl+S. Check ME23N: RE-L and its reversal.', ok: (e, x) => e.type === 'IR_REVERSED' && e.inv === x.inv },
      { t: 'Run <b>MRRL</b> again: the goods receipt is settled a second time.', h: 'MRRL → 100003 → F8 → Settle.', ok: (e, x) => e.type === 'IR_POSTED' && e.ers && e.po === x.po && e.inv !== x.inv }
    ],
    notes: ['ERS needs reliable PO prices and tax codes: it is typical for packaging, raw materials and intercompany supply.', 'MR8M reverses the whole document. To correct only an amount, use a credit memo or subsequent debit/credit instead.', 'A paid invoice cannot be cancelled before the payment is reversed (FI).'] },
  { id: 'cons', title: '15. Consignment', level: 'Special procurement · 20 min',
    intro: 'Keep a supplier\'s mice in your warehouse, pay only for what you use.',
    steps: [
      { t: 'Create a consignment PO: item category <b>K</b>, <b>100 PC</b> of <b>TG12</b>, supplier <b>100002</b>.', h: 'ME21N → 100002 → I = K, TG12, 100 → Enter: no price is needed → Ctrl+S.', ok: e => e.type === 'PO_CREATED' && e.vendor === '100002' && e.items.some(i => i.cat === 'K'), cap: (e, x) => { x.po = e.num; } },
      { t: 'Receive the consignment stock (<b>MIGO</b>).', h: 'MIGO → A01 / R01 → the PO → OK → Post. No accounting document: the stock is not yours yet.', ok: (e, x) => e.type === 'GR_POSTED' && e.po === x.po },
      { t: 'Look at <b>MMBE</b> for TG12: the consignment line (K) for 100002.', h: '/nMMBE → TG12 → F8.', ok: e => e.type === 'STOCK_VIEW' && e.matnr === 'TG12' },
      { t: 'Withdraw <b>40 PC</b> into your own stock (<b>411 K</b>).', h: 'MIGO → A08 Transfer Posting / R10 / 411K → TG12, 40, SLoc 101A, Supplier 100002 → Post. Accounting: Dr inventory / Cr consignment liabilities (at 14.00 from the consignment info record).', ok: e => e.type === 'MVT_POSTED' && e.mvt === '411K' },
      { t: 'Settle the withdrawal with <b>MRKO</b>.', h: 'MRKO → Supplier 100002 → F8 → Settle.', ok: e => e.type === 'CONS_SETTLED' && e.vendor === '100002' },
      { t: 'Check the supplier\'s open item in <b>FBL1N</b>.', h: 'FBL1N → 100002 → Open items → F8: a KN document of 672.00 EUR (560 + VAT).', ok: e => e.type === 'REPORT' && e.tcode === 'FBL1N' }
    ],
    notes: ['Consignment stock is shown in MMBE but is not valuated: it belongs to the supplier.', 'The price comes from a consignment info record (category K), not from the PO.', 'Withdrawal can also happen by issuing directly from consignment stock (201 K) in real systems.'] },
  { id: 'sub', title: '16. Subcontracting', level: 'Special procurement · 25 min',
    intro: 'Send cartons to a printer who returns finished printed boxes: components provided, service fee paid.',
    steps: [
      { t: 'Create a subcontracting PO: item category <b>L</b>, <b>300 PC</b> of <b>FG16</b>, supplier <b>100003</b>.', h: 'ME21N → 100003 → I = L, FG16, 300 → Enter: the fee 0.45 comes from the subcontracting info record and the BOM adds 300 RM14 as components (ME23N › Status) → Ctrl+S.', ok: e => e.type === 'PO_CREATED' && e.vendor === '100003' && e.items.some(i => i.cat === 'L' && i.matnr === 'FG16'), cap: (e, x) => { x.po = e.num; } },
      { t: 'Try to receive FG16 now: the components are missing at the supplier.', h: 'MIGO → A01 / R01 → the PO → OK → Post → error "Deficit of stock provided to supplier".', ok: e => e.type === 'ERR' && e.code === 'NO_O_STOCK' },
      { t: 'Provide <b>300 PC</b> of <b>RM14</b> to supplier 100003 (<b>541</b>).', h: 'MIGO → A07 Goods Issue / R10 / 541 → RM14, 300, 101A, Supplier 100003 → Post.', ok: e => e.type === 'MVT_POSTED' && e.mvt === '541' && e.items.some(i => i.matnr === 'RM14' && i.vendor === '100003') },
      { t: 'Check the stock at the supplier (<b>ME2O</b> or MMBE for RM14).', h: '/nME2O → F8, or MMBE → RM14: "Stock provided to supplier (O)".', ok: e => (e.type === 'REPORT' && e.tcode === 'ME2O') || (e.type === 'STOCK_VIEW' && e.matnr === 'RM14') },
      { t: 'Post the goods receipt of the printed boxes.', h: 'MIGO → A01 / R01 → the PO → OK → Post. The receipt also consumes the components (543).', ok: (e, x) => e.type === 'GR_POSTED' && e.po === x.po, cap: (e, x) => { x.md = e.md; } },
      { t: 'Display the GR accounting document: fee + components = finished product value.', h: 'MIGO A04 → the material document → accounting document. FG16 is valued at its standard price; the 543 lines consume RM14 and the difference goes to price differences.', ok: (e, x) => e.type === 'ACC_DISPLAY' && e.refDoc === x.md }
    ],
    notes: ['The subcontracting PO pays only the service (fee); components come from your own stock via the BOM.', 'Stock provided to vendor (O) is still yours and still valuated: it just sits at the supplier.', 'Explain the 543 movement: it is posted automatically with the 101 goods receipt.'] }
);
})();
