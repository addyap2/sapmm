/* MM Sandbox: second plant (1020 Cannes), stock transport orders, stock in transit. */
(() => {
'use strict';
const { S, ORG, TX, TITLES, SCEN, MENU, esc, fmtD, qf, money, sum, special, poTotals, emit, act, F, box, grid, lnk } = MMSB;
Object.assign(TITLES, { MB5T: 'Stock in Transit (Stock Transport Orders)' });
TX.MB5T = {
  title: c => c.m.list ? 'Stock in Transit' : 'Stock in Transit: Selection',
  init: () => ({ list: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MB5T.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Company code', '_cc', { ro: 1, w: 6, desc: '1010' }) + F('Receiving plant', '_p', { ro: 1, w: 8, desc: 'all' })) + '<div class="tip">Stock transport orders (order type UB) move stock between plants in two steps: goods issue <b>351</b> in the supplying plant puts it <b>in transit</b>, goods receipt <b>101</b> in the receiving plant takes it out of transit.</div>';
    const rows = Object.values(S.pos).filter(P => P.type === 'UB').flatMap(P => P.items.map(it => { const t = poTotals(P, it); return { P, it, t, transit: Math.max(0, t.gi - t.gr) }; })).filter(r => r.transit > 0 || r.t.toDeliver > 0);
    return box(`Stock transport orders (${rows.length})`, grid([{ h: 'STO', f: r => lnk('ME23N', { po: r.P.num }, r.P.num) }, { h: 'Item', f: r => r.it.item }, { h: 'Material', f: r => `${r.it.matnr} <span class="muted">${esc(r.it.short)}</span>` }, { h: 'From → to plant', f: r => `${r.P.splant} → ${r.it.plant}` }, { h: 'Ordered', r: 1, f: r => qf(r.it.qty) }, { h: 'Issued (351)', r: 1, f: r => qf(r.t.gi) }, { h: 'Received (101)', r: 1, f: r => qf(r.t.gr) }, { h: 'In transit', r: 1, f: r => `<b>${qf(r.transit)}</b>` }, { h: 'Value in transit', r: 1, f: r => money(r.transit * r.it.price) }], rows, { empty: 'No open stock transport orders' }));
  },
  enter: c => TX.MB5T.exec(c), exec: c => { if (c.m.list) return; c.m.list = true; emit('REPORT', { tcode: 'MB5T' }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};
// menu entry
const inv = MENU[1][1][0][1][0][1].find(n => n[0] === 'Inventory Management');
if (inv) inv[1].push(['MB5T']);
SCEN.push({ id: 'sto', title: '23. Second plant & stock transport order', level: 'Inventory · 25 min',
  intro: 'Supply the new Cannes shop (plant 1020) from Fréjus: extend a material to the new plant, move stock with a stock transport order in two steps, then with a one-step transfer.',
  steps: [
    { t: 'Extend material <b>TG11</b> to plant <b>1020</b> (storage location <b>102A</b>) with <b>MM01</b>.', h: 'MM01 → Material TG11, Plant 1020, SLoc 102A → Enter: the system recognises the material and only asks for plant-level views → Ctrl+S.', ok: e => e.type === 'MAT_EXTENDED' && e.matnr === 'TG11' && e.plant === '1020' },
    { t: 'Create a stock transport order (<b>ME21N</b>, order type <b>UB</b>): <b>5 PC</b> of TG11 from supplying plant <b>1010</b> to plant 1020.', h: 'ME21N → Order type UB → Supplying plant 1010 → TG11, qty 5 → Enter: receiving plant 1020, storage location 102A and the valuation price are proposed → Ctrl+S.', ok: e => e.type === 'PO_CREATED' && e.type === 'PO_CREATED' && S.pos[e.num]?.type === 'UB', cap: (e, x) => { x.po = e.num; } },
    { t: 'Try to post the goods receipt in plant 1020 straight away and read the message.', h: 'MIGO → A01 / R01 → your STO → OK → Post: nothing is in transit yet.', ok: e => e.type === 'ERR' && e.code === 'NO_TRANSIT' },
    { t: 'Post the goods issue in plant 1010 (<b>MIGO A07 / R01</b>, movement type <b>351</b>).', h: 'MIGO → A07 Goods Issue → R01 Purchase Order (STO) → your STO → Enter → OK → Post. Stock leaves 1010 and is "in transit" for 1020.', ok: (e, x) => e.type === 'STO_GI' && e.po === x.po },
    { t: 'Look at the stock in transit (<b>MMBE</b> for TG11 or <b>MB5T</b>).', h: '/nMMBE → TG11 → F8: plant 1020 shows 5 in transit. Or /nMB5T → F8.', ok: e => (e.type === 'STOCK_VIEW' && e.matnr === 'TG11') || (e.type === 'REPORT' && e.tcode === 'MB5T') },
    { t: 'Post the goods receipt in plant 1020.', h: 'MIGO → A01 / R01 → your STO → Enter → OK → Post. In-transit stock becomes unrestricted stock in 102A.', ok: (e, x) => e.type === 'GR_POSTED' && e.po === x.po },
    { t: 'Move <b>3 PC</b> of <b>TG12</b> from 1010/101A to 1020/102A in one step (<b>301</b>).', h: 'MIGO → A08 Transfer Posting / R10 / 301 → TG12, 3, plant 1010, SLoc 101A, Recv. plant 1020, Recv. SLoc 102A → Post.', ok: e => e.type === 'MVT_POSTED' && e.mvt === '301' }
  ],
  notes: ['A plant is the valuation area: the same material has a separate price and stock value in each plant (MM03 › Accounting 1, plant 1020).', 'Two-step STO (351 + 101) gives transit visibility and documents (delivery, PO history); one-step 301 is quicker but no trace in purchasing.', 'Within one company code an STO has no supplier invoice: the value simply moves between plants (FB03 of the 351 document).'] });
})();
