/* MM Sandbox: GR/IR account maintenance (MR11). Subsequent debit/credit lives in MIRO (transactions 3/4). */
(() => {
'use strict';
const { S, ORG, TX, TITLES, SCEN, MENU, esc, today, fmtD, r2, r3, money, qf, sum, err, nextNo, vname, poTotals, createAcc, line, emit, msg, act, F, I, box, grid, lnk } = MMSB;
Object.assign(TITLES, { MR11: 'GR/IR Account Maintenance' });
const rowsFor = c => Object.values(S.pos).filter(P => P.type !== 'UB' && (!c.m.vendor.trim() || P.vendor === c.m.vendor.trim()) && (!c.m.po.trim() || P.num === c.m.po.trim()))
  .flatMap(P => P.items.filter(it => it.cat !== 'K').map(it => { const t = poTotals(P, it); return { P, it, t, dq: r3(t.gr - t.ir), bal: r2(t.grVal - t.ir * it.price / it.per) }; }))
  .filter(r => Math.abs(r.dq) > 1e-9 || Math.abs(r.bal) > 0.004);
TX.MR11 = {
  title: c => c.m.list ? 'GR/IR Account Maintenance: Items' : 'GR/IR Account Maintenance: Selection',
  init: () => ({ vendor: '', po: '', list: false, sel: {} }),
  tb: c => c.m.list ? [{ l: 'Clear selected', i: '🧹', a: c => act(TX.MR11.clear) }] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MR11.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Company code', '_cc', { ro: 1, w: 6, desc: '1010' }) + F('Supplier', 'vendor', { f4: 'vendor', w: 10 }) + F('Purchasing document', 'po', { f4: 'po', w: 12 })) + '<div class="tip">MR11 clears PO items whose GR/IR clearing account will never balance by itself: the supplier will not invoice the rest, or invoiced more than was received. The remaining balance is posted to <b>GR/IR clearing differences</b> and the PO item is closed for invoicing.</div>';
    const rows = rowsFor(c);
    return box(`PO items with a GR/IR balance (${rows.length})`, grid([{ h: 'Sel', f: r => I(`sel.${r.P.num}_${r.it.item}`, { type: 'check' }) }, { h: 'PO', f: r => lnk('ME23N', { po: r.P.num }, r.P.num) }, { h: 'Item', f: r => r.it.item }, { h: 'Supplier', f: r => `${r.P.vendor} ${esc(vname(r.P.vendor))}` }, { h: 'Material', f: r => r.it.matnr || esc(r.it.short) }, { h: 'GR qty', r: 1, f: r => qf(r.t.gr) }, { h: 'IR qty', r: 1, f: r => qf(r.t.ir) }, { h: 'Difference qty', r: 1, f: r => qf(r.dq) }, { h: 'GR/IR balance EUR', r: 1, f: r => money(r.bal) }], rows, { empty: 'No GR/IR balances to clear' }));
  },
  enter: c => TX.MR11.exec(c),
  exec: c => { if (c.m.list) return; c.m.list = true; emit('REPORT', { tcode: 'MR11' }); },
  clear: c => {
    const keys = Object.entries(c.m.sel).filter(([, v]) => v).map(([k]) => k);
    if (!keys.length) err('Select at least one PO item');
    const rows = rowsFor(c).filter(r => keys.includes(`${r.P.num}_${r.it.item}`));
    const byPO = {}; rows.forEach(r => (byPO[r.P.num] ??= []).push(r));
    const nums = Object.entries(byPO).map(([po, rs]) => {
      const num = nextNo('inv'); const P = S.pos[po];
      const acc = rs.flatMap(r => [line('WRX', 'WRX', 'D', r.bal, { matnr: r.it.matnr || '' }), line('gbb', 'DIF', 'C', r.bal, { matnr: r.it.matnr || '' })]);
      const an = createAcc('RE', num, today(), acc);
      rs.forEach(r => P.history.push({ type: 'RE', mvt: '', doc: num, year: today().slice(0, 4), item: r.it.item, qty: r.dq, amount: r2(r.dq * r.it.price / r.it.per), date: today(), mr11: true }));
      S.invoices[num] = { num, kind: 'MR11', year: today().slice(0, 4), date: today(), ref: 'GR/IR account maintenance', po, vendor: P.vendor, gross: 0, taxCode: '', tax: 0, udc: 0, cm: false, items: rs.map(r => ({ item: r.it.item, qty: r.dq, amount: r.bal })), blocked: false, reasons: [], acc: an, status: 'posted', paid: null };
      return num;
    });
    c.m.sel = {}; emit('MR11_POSTED', { nums, pos: Object.keys(byPO) });
    msg('S', `${nums.length} account maintenance document${nums.length > 1 ? 's' : ''} posted: ${nums.join(', ')}`);
  },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};
const liv = MENU[1][1][0][1][0][1].find(n => n[0] === 'Logistics Invoice Verification');
if (liv) liv[1].push(['MR11']);
SCEN.push({ id: 'mr11', title: '24. GR/IR clearing & subsequent debit', level: 'Invoicing · 20 min',
  intro: 'A supplier invoices less than you received and later bills extra freight: clear the GR/IR balance with MR11 and post a subsequent debit.',
  steps: [
    { t: 'Create a PO for <b>100 PC</b> of <b>RM14</b> from <b>100003</b> and receive all 100.', h: 'ME21N → 100003 → RM14, 100 → Ctrl+S. MIGO → A01 / R01 → the PO → OK → Post.', ok: e => e.type === 'GR_POSTED' && S.pos[e.po]?.vendor === '100003' && S.pos[e.po].items.some(i => i.matnr === 'RM14' && i.qty === 100), cap: (e, x) => { x.po = e.po; } },
    { t: 'Post the supplier invoice for only <b>95 PC</b> (5 were free samples: they will never be invoiced).', h: 'MIRO → PO → Enter → quantity 95, amount 77.90 (95 × 0.82) → gross 93.48 → Post.', ok: (e, x) => e.type === 'IR_POSTED' && e.po === x.po && Math.abs(e.qty - 95) < 1e-9 && !e.cm && !e.sub },
    { t: 'Find the open GR/IR balance in <b>MB5S</b>.', h: '/nMB5S → F8: your PO shows 5 PC (4.10 EUR) received but not invoiced.', ok: e => e.type === 'REPORT' && e.tcode === 'MB5S' },
    { t: 'Clear it with <b>MR11</b>.', h: 'MR11 → Purchasing document = your PO → F8 → tick the line → Clear selected. Dr 21900000 GR/IR / Cr 52300000 GR/IR clearing differences.', ok: (e, x) => e.type === 'MR11_POSTED' && e.pos.includes(x.po) },
    { t: 'The supplier now bills <b>25.00 EUR</b> of freight on the same delivery: post a <b>subsequent debit</b> in MIRO.', h: 'MIRO → Transaction: Subsequent debit → Reference FRT-25 → PO → Enter → amount 25.00 on the item → gross 30.00 → Post. RM14 has a standard price, so the 25.00 goes to price differences.', ok: (e, x) => e.type === 'IR_POSTED' && e.po === x.po && e.sub === 'D' },
    { t: 'Look at the PO history in <b>ME23N</b>: WE, RE-L, account maintenance and NB-L lines.', h: 'ME23N → your PO → Purchase order history.', ok: (e, x) => e.type === 'PO_DISPLAY' && e.num === x.po }
  ],
  notes: ['MR11 is a month-end task: run MB5S first, agree with purchasing which balances will never clear, then clear them.', 'Subsequent debit/credit changes only the value, never the quantity, and does not touch GR/IR (unlike an invoice or a credit memo).', 'If stock is still there and the price control is V, a subsequent debit revalues the stock; otherwise it goes to price differences.'] });
})();
