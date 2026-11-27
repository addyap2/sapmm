/* MM Sandbox: reservations and physical inventory. */
(() => {
'use strict';
const { S, ORG, TX, F4, F4T, TITLES, SCEN, HOOKS, esc, pad, today, dPlus, fmtD, parseD, N, r2, r3, money, qf, U, sum, err, nextNo,
  plantData, stockKey, postMvt, planMvt, emit, msg, call, act, F, I, box, tabs, tabOn, grid, lnk, req, needDate, needMat, modal } = MMSB;

HOOKS.ensure.push(S => { S.pids ??= {}; S.seq.pid ??= 100000001; S.seq.res ??= 1; });
HOOKS.seed.push(S => {
  S.pids = {}; S.seq.pid = 100000001; S.seq.res = 1;
  const num = pad(S.seq.res++, 10);
  S.reservations[num] = { num, date: dPlus(-2), mvt: '201', cc: '10101301', items: [{ item: 1, matnr: 'TG12', plant: '1010', sloc: '101A', qty: 25, reqDate: dPlus(3), wd: 0, final: false }, { item: 2, matnr: 'TG11', plant: '1010', sloc: '101A', qty: 2, reqDate: dPlus(5), wd: 0, final: false }] };
});
// Posting block for materials in an active physical inventory document
const piBlock = (m, p, s) => Object.values(S.pids || {}).find(d => d.block && d.status !== 'posted' && d.sloc === s && d.items.some(i => i.matnr === m && !i.done));
HOOKS.stockCheck = HOOKS.stockCheck || [];
HOOKS.stockCheck.push((m, p, s) => { const d = piBlock(m, p, s); if (d) err(`Material ${m} in ${p}/${s} is blocked by physical inventory document ${d.num} (posting block): post or delete the count first`, 'PI_BLOCK'); });

F4.pid = () => Object.values(S.pids).reverse().map(d => [d.num, `SLoc ${d.sloc} · ${d.items.map(i => i.matnr).join(', ')}`, d.status]);
F4T.pid = 'Physical inventory document';
Object.assign(TITLES, { MB21: 'Create Reservation', MB22: 'Change Reservation', MB23: 'Display Reservation', MB24: 'Reservations by Material', MB25: 'Reservations by Account Assignment',
  MI01: 'Create Physical Inventory Document', MI02: 'Change Physical Inventory Document', MI03: 'Display Physical Inventory Document', MI04: 'Enter Inventory Count with Document', MI05: 'Change Inventory Count', MI06: 'Display Inventory Count',
  MI07: 'Process List of Differences', MI08: 'Create List of Differences with Doc.', MI09: 'Enter Inventory Count w/o Document', MI11: 'Physical Inventory Document Recount', MI20: 'Print List of Differences' });

// ======================================================================
// Reservations
// ======================================================================
const blankR = () => ({ matnr: '', qty: '', sloc: '101A', reqDate: '' });
TX.MB21 = {
  title: c => c.m.step === 2 ? 'Create Reservation: New Items' : 'Create Reservation: Initial Screen',
  init: () => ({ step: 1, date: fmtD(today()), mvt: '201', cc: '', items: [blankR(), blankR(), blankR()] }),
  render: c => {
    const m = c.m;
    const hdr = F('Base date', 'date', { req: 1, w: 10, ro: m.step === 2 }) + F('Movement type', 'mvt', { ro: 1, w: 4, desc: '201 GI for cost center' }) + F('Cost center', 'cc', { req: 1, f4: 'costc', w: 10, ro: m.step === 2, desc: ORG.costc[m.cc.trim()] || '' });
    if (m.step === 1) return box('Reservation', hdr) + '<div class="tip">A reservation asks the warehouse to keep stock ready for a future withdrawal (here: issue to a cost centre). It increases <b>reserved</b> stock in MMBE and is a requirement for MRP. Withdraw it later in MIGO (A07 / R09).</div>';
    return box('Header', hdr) + box('Items', grid([{ h: 'Item', f: (r, i) => i + 1 }, { h: 'Material', f: (r, i) => I(`items.${i}.matnr`, { f4: 'mat', w: 9 }) }, { h: 'Description', f: r => esc(S.materials[U(r.matnr)]?.desc || '') }, { h: 'Quantity', f: (r, i) => I(`items.${i}.qty`, { w: 6, num: 1 }) }, { h: 'UnE', f: r => esc(S.materials[U(r.matnr)]?.uom || '') }, { h: 'SLoc', f: (r, i) => I(`items.${i}.sloc`, { f4: 'sloc', w: 4 }) }, { h: 'Reqmt date', f: (r, i) => I(`items.${i}.reqDate`, { w: 10, ph: 'DD.MM.YYYY' }) }], m.items));
  },
  enter: c => { const m = c.m; if (m.step === 1) { req(c, ['date', 'cc']); needDate(c, 'date'); m.cc = m.cc.trim(); if (!ORG.costc[m.cc]) err(`Cost center ${m.cc} does not exist`, 'NO_CC', 'cc'); m.step = 2; return; } m.items.forEach((it, i) => { if (!String(it.matnr).trim()) return; it.matnr = U(it.matnr); needMat(it.matnr, '1010', `items.${i}.matnr`); if (!it.reqDate) it.reqDate = m.date; }); },
  save: c => {
    const m = c.m; if (m.step === 1) err('Press Enter first');
    TX.MB21.enter(c);
    const items = m.items.map((it, i) => ({ it, i })).filter(x => x.it.matnr).map(({ it, i }, n) => { const q = N(it.qty); if (!(q > 0)) err('Enter a quantity', null, `items.${i}.qty`); it.sloc = U(it.sloc); if (!ORG.slocs[it.sloc]) err(`Storage location ${it.sloc} does not exist`, null, `items.${i}.sloc`); const d = parseD(it.reqDate); if (!d) err('Enter a valid date (DD.MM.YYYY)', null, `items.${i}.reqDate`); return { item: n + 1, matnr: it.matnr, plant: '1010', sloc: it.sloc, qty: q, reqDate: d, wd: 0, final: false }; });
    if (!items.length) err('Enter at least one item', null, 'items.0.matnr');
    const num = pad(S.seq.res++, 10);
    S.reservations[num] = { num, date: parseD(m.date), mvt: '201', cc: m.cc, items };
    emit('RES_CREATED', { num, cc: m.cc, items: items.map(x => ({ matnr: x.matnr, qty: x.qty })) });
    c.m = TX.MB21.init(); msg('S', `Document ${num} posted (reservation)`);
  },
  back: c => { if (c.m.step === 2) { c.m.step = 1; return true; } }
};
const resView = (R, edit) => box(`Reservation ${R.num} · cost center ${R.cc} ${esc(ORG.costc[R.cc] || '')} · MvT ${R.mvt}`, grid([{ h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Description', f: r => esc(S.materials[r.matnr]?.desc) }, { h: 'Reqmt qty', f: (r, i) => edit ? I(`items.${i}.qty`, { w: 6, num: 1 }) : qf(r.qty) }, { h: 'Withdrawn', r: 1, f: r => qf(r.wd) }, { h: 'Open', r: 1, f: r => qf(Math.max(0, r.qty - r.wd)) }, { h: 'SLoc', k: 'sloc' }, { h: 'Reqmt date', f: r => fmtD(r.reqDate) }, { h: 'Final issue', f: (r, i) => edit ? I(`items.${i}.final`, { type: 'check' }) : r.final ? '✔' : '' }], edit ? R._items : R.items)) +
  `<p class="small">${lnk('MIGO', { action: 'A07', ref: 'R09', doc: R.num }, 'Withdraw in MIGO (A07 / R09) ▸')}</p>`;
TX.MB23 = {
  title: c => c.m.show ? `Display Reservation ${c.m.res}` : 'Display Reservation: Initial Screen',
  init: p => ({ res: p.res || '', show: false, _auto: !!p.res }),
  onOpen: c => { if (c.m._auto) TX.MB23.enter(c); },
  render: c => c.m.show ? resView(S.reservations[c.m.res], false) : box('Reservation', F('Reservation', 'res', { req: 1, f4: 'res', w: 12 })),
  enter: c => { if (c.m.show) return; req(c, ['res']); c.m.res = c.m.res.trim().padStart(10, '0'); if (!S.reservations[c.m.res]) err(`Reservation ${c.m.res} does not exist`, null, 'res'); c.m.show = true; emit('RES_DISPLAY', { num: c.m.res }); },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
};
TX.MB22 = {
  title: c => c.m.show ? `Change Reservation ${c.m.res}` : 'Change Reservation: Initial Screen',
  init: () => ({ res: '', show: false }),
  render: c => c.m.show ? resView({ ...S.reservations[c.m.res], _items: c.m.items }, true) : box('Reservation', F('Reservation', 'res', { req: 1, f4: 'res', w: 12 })),
  enter: c => { if (c.m.show) return; req(c, ['res']); c.m.res = c.m.res.trim().padStart(10, '0'); const R = S.reservations[c.m.res]; if (!R) err(`Reservation ${c.m.res} does not exist`, null, 'res'); c.m.items = R.items.map(x => ({ ...x, qty: String(x.qty) })); c.m.show = true; },
  save: c => { if (!c.m.show) err('Press Enter first'); const R = S.reservations[c.m.res]; c.m.items.forEach((x, i) => { const q = N(x.qty); if (!(q > 0)) err('Enter a quantity', null, `items.${i}.qty`); if (q < R.items[i].wd) err('Quantity cannot be less than the withdrawn quantity', null, `items.${i}.qty`); R.items[i].qty = q; R.items[i].final = !!x.final; }); emit('RES_CHANGED', { num: R.num }); c.m = TX.MB22.init(); msg('S', `Reservation ${R.num} changed`); },
  back: c => { if (c.m.show) { c.m.show = false; return true; } }
};
const resList = (code, byCC) => ({
  title: c => c.m.list ? `Reservations by ${byCC ? 'Account Assignment' : 'Material'}` : `Reservations by ${byCC ? 'Account Assignment' : 'Material'}: Selection`,
  init: () => ({ v: '', open: true, list: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX[code].exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', (byCC ? F('Cost center', 'v', { f4: 'costc', w: 10 }) : F('Material', 'v', { f4: 'mat', w: 18 })) + F('Open items only', 'open', { type: 'check' }));
    const v = c.m.v.trim().toUpperCase();
    const rows = Object.values(S.reservations).reverse().flatMap(R => R.items.map(i => ({ ...i, num: R.num, cc: R.cc, mvt: R.mvt }))).filter(r => (!v || (byCC ? r.cc === v : r.matnr === v)) && (!c.m.open || (!r.final && r.qty - r.wd > 0)));
    return box(`Reservation items (${rows.length})`, grid([{ h: 'Reservation', f: r => lnk('MB23', { res: r.num }, r.num) }, { h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Cost center', k: 'cc' }, { h: 'Reqmt date', f: r => fmtD(r.reqDate) }, { h: 'Reqmt qty', r: 1, f: r => qf(r.qty) }, { h: 'Withdrawn', r: 1, f: r => qf(r.wd) }, { h: 'SLoc', k: 'sloc' }, { h: 'MvT', k: 'mvt' }], rows));
  },
  enter: c => TX[code].exec(c), exec: c => { if (c.m.list) return; c.m.list = true; emit('REPORT', { tcode: code }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
});
TX.MB24 = resList('MB24', false); TX.MB25 = resList('MB25', true);

// ======================================================================
// Physical inventory
// ======================================================================
const bookQty = (m, s) => (S.stock[stockKey(m, '1010', s)] || {}).unr || 0;
function createPID({ sloc, mats, block, freeze, date = today() }) {
  const num = String(S.seq.pid++);
  S.pids[num] = { num, date, plant: '1010', sloc, block, freeze, status: 'created', items: mats.map((m, i) => ({ item: i + 1, matnr: m, book: freeze ? bookQty(m, sloc) : null, count: null, zero: false, done: false, md: '' })) };
  return num;
}
TX.MI01 = {
  title: c => c.m.step === 2 ? 'Create Physical Inventory Document: New Items' : 'Create Physical Inventory Document: Initial Screen',
  init: () => ({ step: 1, date: fmtD(today()), sloc: '101A', block: true, freeze: true, items: [{ matnr: '' }, { matnr: '' }, { matnr: '' }, { matnr: '' }] }),
  tb: c => c.m.step === 2 ? [{ l: 'All materials in SLoc', i: '☰', a: c => act(c => { const ms = Object.keys(S.stock).filter(k => k.endsWith(`|1010|${c.m.sloc}`)).map(k => k.split('|')[0]); c.m.items = ms.map(m => ({ matnr: m })); }) }] : [],
  render: c => {
    const m = c.m;
    const hdr = F('Document date', 'date', { req: 1, w: 10, ro: m.step === 2 }) + F('Plant', '_p', { ro: 1, w: 6, desc: '1010' }) + F('Storage location', 'sloc', { req: 1, f4: 'sloc', w: 6, ro: m.step === 2, desc: ORG.slocs[U(m.sloc)] || '' }) + F('Posting block', 'block', { type: 'check', ro: m.step === 2, desc: 'No goods movements for these materials until differences are posted' }) + F('Freeze book inventory', 'freeze', { type: 'check', ro: m.step === 2, desc: 'Book quantity taken now, not at count time' });
    if (m.step === 1) return box('Physical inventory document', hdr) + '<div class="tip">Physical inventory in three steps: <b>MI01</b> create the count document → <b>MI04</b> enter what was counted → <b>MI07</b> post the differences (701 surplus / 702 shortage, booked to the inventory differences account).</div>';
    return box('Header', hdr) + box('Items (unrestricted stock)', grid([{ h: 'Item', f: (r, i) => i + 1 }, { h: 'Material', f: (r, i) => I(`items.${i}.matnr`, { f4: 'mat', w: 9 }) }, { h: 'Description', f: r => esc(S.materials[U(r.matnr)]?.desc || '') }, { h: 'Stock type', f: () => 'Unrestricted use' }], m.items));
  },
  enter: c => { const m = c.m; if (m.step === 1) { req(c, ['date', 'sloc']); needDate(c, 'date'); m.sloc = U(m.sloc); if (!ORG.slocs[m.sloc]) err(`Storage location ${m.sloc} does not exist`, null, 'sloc'); m.step = 2; return; } m.items.forEach((it, i) => { if (!String(it.matnr).trim()) return; it.matnr = U(it.matnr); needMat(it.matnr, '1010', `items.${i}.matnr`); }); },
  save: c => {
    const m = c.m; if (m.step === 1) err('Press Enter first'); TX.MI01.enter(c);
    const mats = [...new Set(m.items.map(x => x.matnr).filter(Boolean))];
    if (!mats.length) err('Enter at least one material', null, 'items.0.matnr');
    const open = mats.find(mt => Object.values(S.pids).some(d => d.status !== 'posted' && d.sloc === m.sloc && d.items.some(i => i.matnr === mt && !i.done)));
    if (open) err(`Material ${open} is already in an open physical inventory document for ${m.sloc}`, 'PI_OPEN');
    const num = createPID({ sloc: m.sloc, mats, block: !!m.block, freeze: !!m.freeze, date: parseD(m.date) });
    emit('PID_CREATED', { num, sloc: m.sloc, mats });
    c.m = TX.MI01.init(); msg('S', `Physical inventory document ${num} created`);
  },
  back: c => { if (c.m.step === 2) { c.m.step = 1; return true; } }
};
const pidOpen = (c, allow) => { req(c, ['pid']); c.m.pid = c.m.pid.trim(); const D = S.pids[c.m.pid]; if (!D) err(`Physical inventory document ${c.m.pid} does not exist`, null, 'pid'); if (allow && !allow.includes(D.status)) err(`Physical inventory document ${D.num} has status "${D.status}"`, null, 'pid'); return D; };
const pidRows = D => D.items.map(i => { const book = i.book ?? bookQty(i.matnr, D.sloc); const pd = plantData(i.matnr, '1010'); const diff = i.count == null ? null : r3(i.count - book); return { ...i, book, diff, val: diff == null ? null : r2(diff * pd.price), uom: S.materials[i.matnr].uom }; });
const pidView = (D, extra = '') => box(`Phys. inv. document ${D.num} · ${D.plant}/${D.sloc} · ${fmtD(D.date)} · status ${D.status}${D.block ? ' · posting block' : ''}`, grid([{ h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Description', f: r => esc(S.materials[r.matnr]?.desc) }, { h: 'Book qty', r: 1, f: r => qf(r.book) }, { h: 'Counted', r: 1, f: r => r.count == null ? '—' : qf(r.count) }, { h: 'Difference', r: 1, f: r => r.diff == null ? '' : (r.diff > 0 ? '+' : '') + qf(r.diff) }, { h: 'Diff. value EUR', r: 1, f: r => r.val == null ? '' : money(r.val) }, { h: 'UnE', k: 'uom' }, { h: 'Status', f: r => r.done ? (r.md ? `Posted ${lnk('MIGO', { display: r.md }, r.md)}` : 'Posted (no difference)') : r.count == null ? 'Not counted' : 'Counted' }], pidRows(D))) + extra;
const pidDisp = (code, title) => ({
  title: c => c.m.show ? `${title}: ${c.m.pid}` : `${title}: Initial Screen`,
  init: p => ({ pid: p.pid || '', show: false, _auto: !!p.pid }),
  onOpen: c => { if (c.m._auto) TX[code].enter(c); },
  render: c => c.m.show ? pidView(S.pids[c.m.pid]) : box('Document', F('Phys. inventory doc.', 'pid', { req: 1, f4: 'pid', w: 12 })),
  enter: c => { if (c.m.show) return; pidOpen(c); c.m.show = true; emit('PID_DISPLAY', { num: c.m.pid }); },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
});
TX.MI03 = pidDisp('MI03', 'Display Physical Inventory Document'); TX.MI06 = pidDisp('MI06', 'Display Inventory Count');
TX.MI02 = {
  title: c => c.m.show ? `Change Physical Inventory Document ${c.m.pid}` : 'Change Physical Inventory Document: Initial Screen',
  init: () => ({ pid: '', show: false, block: true }),
  render: c => c.m.show ? box('Header', F('Posting block', 'block', { type: 'check' })) + pidView(S.pids[c.m.pid]) : box('Document', F('Phys. inventory doc.', 'pid', { req: 1, f4: 'pid', w: 12 })),
  enter: c => { if (c.m.show) return; const D = pidOpen(c, ['created', 'counted']); c.m.block = D.block; c.m.show = true; },
  save: c => { if (!c.m.show) err('Press Enter first'); const D = S.pids[c.m.pid]; D.block = !!c.m.block; emit('PID_CHANGED', { num: D.num }); c.m = TX.MI02.init(); msg('S', `Physical inventory document ${D.num} changed`); },
  back: c => { if (c.m.show) { c.m.show = false; return true; } }
};
const countTx = code => ({
  title: c => c.m.show ? `Enter Inventory Count ${c.m.pid}` : `${code === 'MI05' ? 'Change' : 'Enter'} Inventory Count: Initial Screen`,
  init: p => ({ pid: p.pid || '', show: false, rows: [], _auto: !!p.pid }),
  onOpen: c => { if (c.m._auto) TX[code].enter(c); },
  render: c => {
    if (!c.m.show) return box('Document', F('Phys. inventory doc.', 'pid', { req: 1, f4: 'pid', w: 12 }) + F('Count date', '_d', { ro: 1, w: 10, desc: fmtD(today()) }));
    const D = S.pids[c.m.pid];
    return box(`Phys. inv. document ${D.num} · SLoc ${D.sloc}`, grid([{ h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Description', f: r => esc(S.materials[r.matnr]?.desc) }, { h: 'Quantity counted', f: (r, i) => r.done ? qf(r.count) : I(`rows.${i}.count`, { w: 8, num: 1 }) }, { h: 'UnE', f: r => S.materials[r.matnr].uom }, { h: 'Zero count', f: (r, i) => r.done ? '' : I(`rows.${i}.zero`, { type: 'check' }) }], c.m.rows)) +
      '<div class="tip">Enter what is physically on the shelf. The book quantity is hidden on purpose: counters should not see it (blind count). Tick <b>Zero count</b> if nothing was found.</div>';
  },
  enter: c => { if (c.m.show) return; const D = pidOpen(c, ['created', 'counted']); c.m.rows = D.items.map(i => ({ ...i, count: i.count == null ? '' : String(i.count) })); c.m.show = true; },
  save: c => {
    if (!c.m.show) err('Press Enter first');
    const D = S.pids[c.m.pid];
    c.m.rows.forEach((r, i) => { if (r.done) return; const z = !!r.zero; const s = String(r.count ?? '').trim(); if (!z && s === '') return; const q = z ? 0 : N(s); if (isNaN(q) || q < 0) err('Enter a valid quantity', null, `rows.${i}.count`); const it = D.items[i]; it.count = q; it.zero = z; if (it.book == null || !D.freeze) it.book = bookQty(it.matnr, D.sloc); });
    if (!D.items.some(i => i.count != null)) err('Enter at least one count', null, 'rows.0.count');
    D.status = D.items.every(i => i.count != null) ? 'counted' : 'created';
    emit('PI_COUNTED', { num: D.num, complete: D.status === 'counted' });
    const n = D.num; c.m = TX[code].init({}); msg('S', `Count entered for phys. inventory doc. ${n}${D.status === 'counted' ? '' : ' (some items still not counted)'}`);
  },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
});
TX.MI04 = countTx('MI04'); TX.MI05 = countTx('MI05');
TX.MI07 = {
  title: c => c.m.show ? `Post Inventory Difference: ${c.m.pid}` : 'Post Inventory Difference: Initial Screen',
  init: p => ({ pid: p.pid || '', show: false, reason: '', _auto: !!p.pid }),
  onOpen: c => { if (c.m._auto) TX.MI07.enter(c); },
  render: c => {
    if (!c.m.show) return box('Document', F('Phys. inventory doc.', 'pid', { req: 1, f4: 'pid', w: 12 }) + F('Posting date', '_d', { ro: 1, w: 10, desc: fmtD(today()) }));
    const D = S.pids[c.m.pid]; const rows = pidRows(D).filter(r => !r.done && r.count != null);
    return pidView(D, box('Differences to post', `<p>${rows.length} counted item(s) · total difference value <b>${money(sum(rows, r => r.val))} EUR</b>.</p>${F('Reason for difference', 'reason', { type: 'select', opts: { '': '', '0001': 'Theft / loss', '0002': 'Counting error last time', '0003': 'Damaged, not booked', '0004': 'Unknown' } })}`)) +
      '<div class="tip">Posting creates a material document with <b>701</b> (surplus) or <b>702</b> (shortage) and an accounting document <b>WI</b>: inventory account against <b>inventory differences</b>. Items with no difference are simply closed.</div>';
  },
  enter: c => { if (c.m.show) return; const D = pidOpen(c, ['created', 'counted']); if (!D.items.some(i => !i.done && i.count != null)) err(`No counted items to post in document ${D.num}: enter the count first (MI04)`, 'NOT_COUNTED', 'pid'); c.m.show = true; },
  save: c => {
    if (!c.m.show) err('Press Enter first');
    const D = S.pids[c.m.pid]; const rows = pidRows(D).filter(r => !r.done && r.count != null);
    const plus = rows.filter(r => r.diff > 0).map(r => ({ matnr: r.matnr, plant: '1010', sloc: D.sloc, qty: r.diff, reason: c.m.reason }));
    const minus = rows.filter(r => r.diff < 0).map(r => ({ matnr: r.matnr, plant: '1010', sloc: D.sloc, qty: -r.diff, reason: c.m.reason }));
    const blk = D.block; D.block = false;
    try { if (minus.length) planMvt({ mvt: '702', items: minus }); } catch (e) { D.block = blk; throw e; }
    const mds = [];
    if (plus.length) { const md = postMvt({ mvt: '701', items: plus, piRef: D.num, text: `Phys. inv. ${D.num}` }); mds.push(md); plus.forEach(p => { D.items.find(i => i.matnr === p.matnr).md = md; }); }
    if (minus.length) { const md = postMvt({ mvt: '702', items: minus, piRef: D.num, text: `Phys. inv. ${D.num}` }); mds.push(md); minus.forEach(p => { D.items.find(i => i.matnr === p.matnr).md = md; }); }
    rows.forEach(r => { const it = D.items.find(i => i.matnr === r.matnr); it.done = true; it.diffPosted = r.diff; });
    if (D.items.every(i => i.done)) D.status = 'posted';
    emit('PI_POSTED', { num: D.num, mds, value: r2(sum(rows, r => r.val)) });
    const n = D.num; c.m = TX.MI07.init({}); msg('S', mds.length ? `Phys. inventory doc. ${n} posted: material document${mds.length > 1 ? 's' : ''} ${mds.join(', ')}` : `Phys. inventory doc. ${n} posted: no differences`);
  },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
};
TX.MI08 = { ...TX.MI07 };
TX.MI09 = {
  title: 'Enter Inventory Count without Document',
  init: () => ({ sloc: '101A', items: [{ matnr: '', count: '' }, { matnr: '', count: '' }, { matnr: '', count: '' }] }),
  render: c => box('Header', F('Storage location', 'sloc', { req: 1, f4: 'sloc', w: 6 }) + F('Count date', '_d', { ro: 1, w: 10, desc: fmtD(today()) })) + box('Items', grid([{ h: 'Material', f: (r, i) => I(`items.${i}.matnr`, { f4: 'mat', w: 9 }) }, { h: 'Description', f: r => esc(S.materials[U(r.matnr)]?.desc || '') }, { h: 'Quantity counted', f: (r, i) => I(`items.${i}.count`, { w: 8, num: 1 }) }], c.m.items)) + '<div class="tip">Creates the physical inventory document and the count in one step (no posting block). Post the differences with MI07.</div>',
  save: c => {
    const m = c.m; m.sloc = U(m.sloc); if (!ORG.slocs[m.sloc]) err(`Storage location ${m.sloc} does not exist`, null, 'sloc');
    const rows = m.items.map((it, i) => ({ it, i })).filter(x => String(x.it.matnr).trim()).map(({ it, i }) => { it.matnr = U(it.matnr); needMat(it.matnr, '1010', `items.${i}.matnr`); const q = N(it.count); if (String(it.count).trim() === '' || isNaN(q) || q < 0) err('Enter the counted quantity', null, `items.${i}.count`); return { m: it.matnr, q }; });
    if (!rows.length) err('Enter at least one material', null, 'items.0.matnr');
    const num = createPID({ sloc: m.sloc, mats: rows.map(r => r.m), block: false, freeze: true });
    rows.forEach((r, i) => { S.pids[num].items[i].count = r.q; }); S.pids[num].status = 'counted';
    emit('PID_CREATED', { num, sloc: m.sloc, mats: rows.map(r => r.m) }); emit('PI_COUNTED', { num, complete: true });
    c.m = TX.MI09.init(); msg('S', `Physical inventory document ${num} created with count`);
  }
};
TX.MI11 = {
  title: 'Physical Inventory Document Recount',
  init: () => ({ pid: '' }),
  render: c => box('Document to recount', F('Phys. inventory doc.', 'pid', { req: 1, f4: 'pid', w: 12 })) + '<div class="tip">When a difference looks suspicious, do not post it: create a recount document. The original items are closed and a new document is created for the same materials.</div>',
  save: c => {
    const D = pidOpen(c, ['counted', 'created']);
    if (!D.items.some(i => i.count != null && !i.done)) err('Only counted items can be recounted', null, 'pid');
    const mats = D.items.filter(i => i.count != null && !i.done).map(i => i.matnr);
    D.items.forEach(i => { if (mats.includes(i.matnr)) { i.done = true; i.recount = true; } });
    if (D.items.every(i => i.done)) D.status = 'posted';
    const num = createPID({ sloc: D.sloc, mats, block: D.block, freeze: D.freeze });
    emit('PID_CREATED', { num, sloc: D.sloc, mats, recountOf: D.num });
    c.m = TX.MI11.init(); msg('S', `Recount document ${num} created for document ${D.num}`);
  }
};
TX.MI20 = {
  title: c => c.m.list ? 'List of Inventory Differences' : 'Print List of Differences: Selection',
  init: () => ({ list: false, open: false }),
  tb: c => c.m.list ? [] : [{ l: 'Execute', i: '⏵', a: c => act(TX.MI20.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Plant', '_p', { ro: 1, w: 6, desc: '1010' }) + F('Open documents only', 'open', { type: 'check' }));
    const rows = Object.values(S.pids).reverse().filter(d => !c.m.open || d.status !== 'posted').flatMap(D => pidRows(D).filter(r => r.count != null).map(r => ({ ...r, num: D.num, sloc: D.sloc, status: D.status })));
    return box(`Differences (${rows.length})`, grid([{ h: 'Phys. inv. doc.', f: r => lnk('MI03', { pid: r.num }, r.num) }, { h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'SLoc', k: 'sloc' }, { h: 'Book qty', r: 1, f: r => qf(r.book) }, { h: 'Counted', r: 1, f: r => qf(r.count) }, { h: 'Difference', r: 1, f: r => qf(r.diff) }, { h: 'Diff. value EUR', r: 1, f: r => money(r.val) }, { h: 'Posted', f: r => r.done ? (r.recount ? 'Recounted' : '✔') : '' }], rows, { foot: rows.length ? `<tr class="tot"><td colspan="7">Total difference value</td><td class="r">${money(sum(rows, r => r.val || 0))}</td><td></td></tr>` : '' }));
  },
  enter: c => TX.MI20.exec(c), exec: c => { if (c.m.list) return; c.m.list = true; emit('REPORT', { tcode: 'MI20' }); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};

// ======================================================================
// Scenarios
// ======================================================================
const stk = (m, s, t = 'unr') => (S.stock[stockKey(m, '1010', s)] || {})[t] || 0;
SCEN.push(
  { id: 'gm', title: '10. Goods movements in the warehouse', level: 'Inventory · 25 min',
    intro: 'Practise the everyday movements: goods issue to a cost centre, transfer posting, quality inspection, scrapping and withdrawal against a reservation.',
    steps: [
      { t: 'Issue <b>5 PC</b> of <b>TG12</b> to cost center <b>10101301</b> (IT) with movement type <b>201</b>.', h: 'MIGO → A07 Goods Issue / R10 Other / 201 → TG12, 5, SLoc 101A, Cost center 10101301 → Post. Then look at the accounting document (FB03): consumption account vs inventory.', ok: e => e.type === 'MVT_POSTED' && e.mvt === '201' && e.items.some(i => i.matnr === 'TG12') },
      { t: 'Transfer <b>20 PC</b> of TG12 from <b>101A</b> to <b>101B</b> (<b>311</b>).', h: 'MIGO → A08 Transfer Posting / R10 / 311 → TG12, 20, SLoc 101A, Recv. SLoc 101B → Post. No accounting document: the value does not change.', ok: e => e.type === 'MVT_POSTED' && e.mvt === '311' && e.items.some(i => i.matnr === 'TG12' && i.toSloc === '101B') },
      { t: 'Put <b>10 PC</b> of TG12 into quality inspection (<b>322</b>), then release them again (<b>321</b>).', h: 'MIGO → A08 / R10 / 322 → TG12, 10, 101A → Post. Check MMBE (Qual. inspection = 10). Then 321 with the same data.', ok: e => e.type === 'MVT_POSTED' && e.mvt === '321', pre: true },
      { t: 'Scrap <b>2 PC</b> of <b>TG11</b> (<b>551</b>) with reason "Damaged".', h: 'MIGO → A07 / R10 / 551 → TG11, 2, 101A, Reason 0001 → Post.', ok: e => e.type === 'MVT_POSTED' && e.mvt === '551' && e.items.some(i => i.matnr === 'TG11') },
      { t: 'Withdraw reservation <b>0000000001</b> in MIGO (<b>A07 / R09</b>).', h: 'MIGO → A07 Goods Issue / R09 Reservation → 0000000001 → Enter → tick OK on both lines → Post. Check MB24: the open quantity is now 0.', ok: e => e.type === 'MVT_POSTED' && e.res === '0000000001' },
      { t: 'Cancel your scrapping document (<b>A03</b>) because the laptops were repairable.', h: 'MIGO → A03 Cancellation → the 551 material document (F4) → Enter → Post: movement type 552.', ok: e => e.type === 'MVT_REVERSED' && e.mvt === '551' }
    ],
    notes: ['Movement type = the key that controls stock type, value change and account determination (SPRO › OMJJ / OBYC).', 'Transfers between storage locations (311) and stock types (321/322/343/344) have no value change, so no accounting document.', 'MB1A/MB1B/MB1C are obsolete in S/4HANA: everything runs through MIGO (try MB1A to show the message).'] },
  { id: 'pi', title: '11. Physical inventory', level: 'Inventory · 15 min',
    intro: 'Count the main warehouse, find a shortage, post the difference and see its accounting impact.',
    steps: [
      { t: 'Create a physical inventory document (<b>MI01</b>) for storage location <b>101A</b> with materials <b>TG12</b> and <b>RM14</b> (posting block on).', h: 'MI01 → SLoc 101A, posting block ticked → Enter → TG12 and RM14 → Ctrl+S.', ok: e => e.type === 'PID_CREATED' && e.sloc === '101A' && e.mats.includes('TG12'), cap: (e, x) => { x.pid = e.num; } },
      { t: 'Try to issue 1 PC of TG12 from 101A (MIGO 201): the posting block stops you.', h: 'MIGO → A07 / R10 / 201 → TG12, 1, 101A, cost center 10101101 → Post. Read the error.', ok: e => e.type === 'ERR' && e.code === 'PI_BLOCK' },
      { t: 'Enter the count (<b>MI04</b>): TG12 = book quantity minus 3, RM14 = book quantity.', h: 'Check the book quantities in MMBE first (counters normally can\'t see them). MI04 → your document → Enter → type the counts → Ctrl+S.', ok: (e, x) => e.type === 'PI_COUNTED' && e.num === x.pid && e.complete },
      { t: 'Check the differences in <b>MI20</b>.', h: '/nMI20 → F8. TG12 shows -3 and its value.', ok: e => e.type === 'REPORT' && e.tcode === 'MI20' },
      { t: 'Post the differences (<b>MI07</b>).', h: 'MI07 → your document → Enter → reason 0001 → Ctrl+S. A 702 material document is posted for TG12.', ok: (e, x) => e.type === 'PI_POSTED' && e.num === x.pid && e.mds.length > 0, cap: (e, x) => { x.md = e.mds[0]; } },
      { t: 'Display the accounting document of the 702 movement (inventory differences account).', h: 'MIGO A04 (or MB03) → the material document → click the accounting document: Dr 52700000 Inventory differences / Cr 13100000 Inventory.', ok: e => e.type === 'ACC_DISPLAY' && e.dtype === 'WI' }
    ],
    notes: ['Explain freeze book inventory and posting block: they make the comparison fair while goods keep moving in a real warehouse.', 'Large differences should trigger a recount (MI11) before posting.', 'Cycle counting (MIBC) and the Fiori "Manage Physical Inventory Documents" app automate the same steps.'] }
);
})();
