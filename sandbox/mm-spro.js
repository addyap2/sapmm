/* MM Sandbox: Customizing (SPRO) — a simplified, editable IMG for the settings the simulator uses. */
(() => {
'use strict';
const { S, ORG, GL, MVT, mvtName, TX, TITLES, SCEN, HOOKS, esc, pad, today, fmtD, N, r2, money, qf, U, sum, err, emit, msg, call, act, F, I, box, grid, lnk, modal } = MMSB;

Object.assign(TITLES, { SPRO: 'Customizing: Implementation Guide', OBYC: 'Automatic Account Determination', OMR6: 'Tolerance Limits: Invoice Verification', OMJJ: 'Movement Types', OX18: 'Assignment Plant – Company Code', OX09: 'Define Storage Locations' });
const NODES = [
  ['Enterprise Structure', [['org', 'Assignment: organisational overview (display)'], ['sloc', 'Definition › Materials Management › Maintain storage location']]],
  ['Materials Management › General settings', [['mtype', 'Material types: price control default']]],
  ['Materials Management › Purchasing', [['pgrp', 'Create purchasing groups'], ['relpo', 'Release procedure for purchase orders'], ['relpr', 'Release procedure for purchase requisitions'], ['nr', 'Number ranges (display)']]],
  ['Materials Management › Inventory Management', [['mvt', 'Movement types (display)'], ['over', 'Tolerance for over-delivery (goods receipt)']]],
  ['Materials Management › Valuation and Account Assignment', [['obyc', 'Account determination: configure automatic postings']]],
  ['Materials Management › Logistics Invoice Verification', [['tol', 'Invoice block: set tolerance limits'], ['tax', 'Tax codes (display)']]]
];
const findNode = id => NODES.flatMap(n => n[1]).find(x => x[0] === id);
const GLROWS = () => [['BSX', '3100', 'Inventory posting', '3100'], ['BSX', '3000', 'Inventory posting', '3000'], ['BSX', '7920', 'Inventory posting', '7920'], ['WRX', '', 'GR/IR clearing', 'WRX'], ['PRD', '', 'Price differences', 'PRD'], ['GBB', 'VBR', 'Offsetting entry: consumption (cost centre)', 'GBB_VBR'], ['GBB', 'VNG', 'Offsetting entry: scrapping', 'GBB_VNG'], ['GBB', 'INV', 'Offsetting entry: inventory differences', 'GBB_INV'], ['GBB', 'BSA', 'Offsetting entry: initial stock entry', 'GBB_BSA'], ['GBB', 'ZOB', 'Offsetting entry: GR without PO', 'GBB_ZOB'], ['GBB', 'VBO', 'Offsetting entry: subcontracting consumption', 'GBB_VBO'], ['UMB', '', 'Revaluation gains/losses', 'UMB'], ['KON', '', 'Consignment liabilities', 'KON'], ['VST', '', 'Input tax (FI)', 'VST'], ['—', '', 'Supplier reconciliation account (FI)', 'AP'], ['—', '', 'Bank outgoing payments (FI)', 'BANK']];
function nodeScreen(c) {
  const id = c.m.node, m = c.m;
  if (id === 'org') return box('Organisational structure (client 100)', `<pre style="font:12.5px/1.6 ui-monospace,Consolas,monospace;margin:0">Client 100
└─ Company code 1010  Riviera Trading SAS  (EUR, chart of accounts YCOA-like, fictional)
   ├─ Plant 1010  Fréjus           ← valuation area = plant
   │  ${Object.entries(ORG.slocs).map(([k, v]) => `├─ Storage location ${k}  ${v}`).join('\n   │  ')}
   └─ Purchasing organisation 1010  ${ORG.porgs['1010']}  (assigned to company code 1010 and plant 1010)
Purchasing groups: ${Object.entries(ORG.pgrps).map(([k, v]) => `${k} ${v}`).join(' · ')}</pre>`) + '<div class="tip">Exam favourite: a plant belongs to exactly one company code; a purchasing organisation can be company-specific (as here), cross-company or cross-plant.</div>';
  if (id === 'sloc') return box('Storage locations in plant 1010', grid([{ h: 'SLoc', k: 'k' }, { h: 'Description', k: 'v' }, { h: 'Origin', f: r => r.std ? 'Standard' : 'Created in SPRO' }], Object.entries(ORG.slocs).map(([k, v]) => ({ k, v, std: ['101A', '101B'].includes(k) })))) + box('New entry', F('Storage location', 'nk', { w: 5, ph: 'e.g. 101C' }) + F('Description', 'nv', { w: 24 }));
  if (id === 'pgrp') return box('Purchasing groups', grid([{ h: 'PGr', k: 'k' }, { h: 'Description', k: 'v' }], Object.entries(ORG.pgrps).map(([k, v]) => ({ k, v })))) + box('New entry', F('Purchasing group', 'nk', { w: 4, ph: 'e.g. 003' }) + F('Description', 'nv', { w: 24 }));
  if (id === 'mtype') return box('Price control by material type (default for new materials)', grid([{ h: 'Type', k: 't' }, { h: 'Description', f: r => esc(ORG.mtypes[r.t]) }, { h: 'Valuation class', f: r => ORG.mtypeDef[r.t].vc }, { h: 'Price control', f: r => I(`mt.${r.t}`, { type: 'select', opts: { V: 'V Moving average', S: 'S Standard' } }) }], Object.keys(ORG.mtypes).map(t => ({ t })))) + '<div class="tip">Only affects materials created afterwards (MM01). Existing materials keep their price control.</div>';
  if (id === 'relpo' || id === 'relpr') { const k = id === 'relpo' ? 'po' : 'pr'; return box(`Release strategy ${k.toUpperCase()} · characteristic: total net value (EUR)`, F('Release procedure active', 'relActive', { type: 'check' }) + grid([{ h: 'Level', f: (r, i) => i + 1 }, { h: 'Release code', f: (r, i) => I(`rl.${i}.code`, { w: 4 }) }, { h: 'Description', f: (r, i) => I(`rl.${i}.name`, { w: 22 }) }, { h: 'Value from (EUR)', f: (r, i) => I(`rl.${i}.from`, { w: 10, num: 1 }) }], m.rl)) + `<div class="tip">A document needs every level whose limit it reaches, in order (level 2 requires level 1 first). Leave a code empty to remove a level. Applies to documents created or changed afterwards.</div>`; }
  if (id === 'nr') return box('Number ranges (next number)', grid([{ h: 'Object', k: 'o' }, { h: 'Next number', k: 'n' }], [['Purchase requisition', 'pr'], ['Purchase order', 'po'], ['RFQ', 'rfq'], ['Contract', 'ctr'], ['Scheduling agreement', 'sa'], ['Material document', 'md'], ['Invoice document', 'inv'], ['Accounting document', 'acc'], ['Business partner', 'bp'], ['Info record', 'info'], ['Phys. inventory doc.', 'pid']].map(([o, k]) => ({ o, n: S.seq[k] ?? '—' })))) + '<div class="tip">Internal number assignment: the system gives the next free number. Materials use external numbering (you type the number).</div>';
  if (id === 'mvt') { const po = [['101', 'GR for purchase order', '+ unrestricted / QI / blocked', 'BSX / WRX (PRD)'], ['102', 'Reversal of 101', '−', 'reverse'], ['122', 'Return delivery to supplier', '−', 'BSX / WRX reversed'], ['543', 'Subcontracting component consumption', '− stock at supplier', 'GBB-VBO / BSX']]; return box('Movement types', grid([{ h: 'MvT', k: 'k' }, { h: 'Text', k: 't' }, { h: 'Quantity update', k: 'q' }, { h: 'Account determination', k: 'a' }, { h: 'Reversal', k: 'r' }], [...po.map(([k, t, q, a]) => ({ k, t, q, a, r: k === '101' ? '102' : k === '122' ? '123' : '' })), ...Object.entries(MVT).map(([k, d]) => ({ k, t: d.t, q: [d.from && `− ${d.from}`, d.fromK && '− consignment', d.fromO && '− at supplier', d.to && `+ ${d.to}`, d.toO && '+ at supplier'].filter(Boolean).join(' / '), a: d.acc ? `BSX / ${d.acc.replace('_', '-')}` : 'no value change', r: d.rev }))])) + '<div class="tip">In real SAP (OMJJ) a movement type controls screen fields, quantity and value update, account determination keys and the reversal movement type.</div>'; }
  if (id === 'over') return box('Goods receipt tolerances', F('Over-delivery tolerance (%)', 'overTol', { num: 1, w: 6 })) + '<div class="tip">0% = the GR quantity cannot exceed the open PO quantity ("PO quantity exceeded"). In real SAP this is set per info record / PO item.</div>';
  if (id === 'obyc') return box('Transaction keys and G/L accounts (valuation grouping code 0001)', grid([{ h: 'Transaction', k: 0 }, { h: 'Val. class / modifier', k: 1 }, { h: 'Description', k: 2 }, { h: 'G/L account', f: r => I(`gl.${r[3]}.0`, { w: 9 }) }, { h: 'Account text', f: r => I(`gl.${r[3]}.1`, { w: 26 }) }], GLROWS())) + '<div class="tip">Every automatic MM posting looks up its account here (OBYC): BSX + valuation class → inventory account, WRX → GR/IR, PRD → price differences, GBB + modifier → offsetting accounts. Changes apply to new postings only.</div>';
  if (id === 'tol') return box('Tolerance keys for company code 1010', F('PP price variance: upper limit %', 'tpp', { num: 1, w: 6 }) + F('PP price variance: upper limit EUR', 'tabs', { num: 1, w: 10 }) + F('DQ quantity variance check active', 'tdq', { type: 'check' })) + '<div class="tip">An invoice item is blocked for payment (R) when its price is higher than the PO price by more than the % <b>or</b> the absolute limit, or when more is invoiced than received (DQ). Lower prices are never blocked here.</div>';
  if (id === 'tax') return box('Tax codes (country FR)', grid([{ h: 'Tax code', k: 'k' }, { h: 'Description', k: 'd' }, { h: 'Rate', r: 1, k: 'r' }, { h: 'Account', f: () => `${GL.VST[0]} ${GL.VST[1]}` }], Object.entries(ORG.tax).map(([k, v]) => ({ k, d: v[0], r: `${v[1] * 100}%` }))));
  return '';
}
function loadNode(c) {
  const m = c.m, id = m.node; m.nk = ''; m.nv = '';
  if (id === 'mtype') m.mt = Object.fromEntries(Object.keys(ORG.mtypes).map(t => [t, ORG.mtypeDef[t].ctrl]));
  if (id === 'relpo' || id === 'relpr') { const k = id === 'relpo' ? 'po' : 'pr'; m.relActive = S.cfg.rel.active; m.rl = [...S.cfg.rel[k].map(l => ({ ...l, from: String(l.from) })), { code: '', name: '', from: '' }]; }
  if (id === 'over') m.overTol = String(S.cfg.overTol);
  if (id === 'obyc') m.gl = Object.fromEntries(GLROWS().map(r => [r[3], [...GL[r[3]]]]));
  if (id === 'tol') { m.tpp = String(S.cfg.tol.pp); m.tabs = String(S.cfg.tol.ppAbs); m.tdq = S.cfg.tol.dq; }
}
function saveNode(c) {
  const m = c.m, id = m.node;
  if (id === 'sloc' || id === 'pgrp') {
    const k = U(m.nk), v = String(m.nv || '').trim();
    if (!k) err('Enter a key', null, 'nk'); if (!v) err('Enter a description', null, 'nv');
    if (id === 'sloc') { if (!/^[0-9A-Z]{4}$/.test(k)) err('Storage location: 4 characters', null, 'nk'); if (ORG.slocs[k]) err(`Storage location ${k} already exists`, null, 'nk'); S.cfg.slocs[k] = v; }
    else { if (!/^[0-9A-Z]{3}$/.test(k)) err('Purchasing group: 3 characters', null, 'nk'); if (ORG.pgrps[k]) err(`Purchasing group ${k} already exists`, null, 'nk'); S.cfg.pgrps[k] = v; }
    MMSB.ensureAll(); return `Entry ${k} created`;
  }
  if (id === 'mtype') { for (const [t, v] of Object.entries(m.mt)) S.cfg.mtypeCtrl[t] = v; MMSB.ensureAll(); return 'Material type settings saved'; }
  if (id === 'relpo' || id === 'relpr') {
    const k = id === 'relpo' ? 'po' : 'pr';
    const ls = m.rl.filter(l => String(l.code).trim()).map((l, i) => { const code = U(l.code); if (!/^[A-Z0-9]{2}$/.test(code)) err('Release code: 2 characters', null, `rl.${i}.code`); const f = N(l.from); if (!(f > 0)) err('Enter a value limit', null, `rl.${i}.from`); return { code, name: String(l.name || code).trim(), from: f }; }).sort((a, b) => a.from - b.from);
    if (new Set(ls.map(l => l.code)).size !== ls.length) err('Release codes must be unique');
    S.cfg.rel[k] = ls; S.cfg.rel.active = !!m.relActive; return `Release strategy for ${k.toUpperCase()} saved (${ls.length} level${ls.length === 1 ? '' : 's'})`;
  }
  if (id === 'over') { const v = N(m.overTol); if (isNaN(v) || v < 0 || v > 100) err('Enter 0–100', null, 'overTol'); S.cfg.overTol = v; return 'Over-delivery tolerance saved'; }
  if (id === 'obyc') {
    for (const r of GLROWS()) { const [acct, txt] = m.gl[r[3]]; if (!/^\d{8}$/.test(String(acct).trim())) err(`G/L account must have 8 digits (${r[0]} ${r[1]})`, null, `gl.${r[3]}.0`); if (!String(txt).trim()) err('Enter an account text', null, `gl.${r[3]}.1`); }
    for (const r of GLROWS()) { const v = [String(m.gl[r[3]][0]).trim(), String(m.gl[r[3]][1]).trim()]; if (v.join() !== GL[r[3]].join()) S.cfg.gl[r[3]] = v; }
    MMSB.ensureAll(); return 'Account determination saved';
  }
  if (id === 'tol') { const p = N(m.tpp), a = N(m.tabs); if (isNaN(p) || p < 0) err('Enter a percentage', null, 'tpp'); if (isNaN(a) || a < 0) err('Enter an amount', null, 'tabs'); S.cfg.tol = { pp: p, ppAbs: a, dq: !!m.tdq }; return `Tolerance key PP: ${p}% / ${money(a)} EUR saved`; }
  err('Nothing to save in this activity (display only)');
}
TX.SPRO = {
  title: c => c.m.node ? `Change View "${findNode(c.m.node)?.[1] || ''}"` : 'Display IMG',
  init: p => { const m = { node: p.node || '' }; return m; },
  onOpen: c => { if (c.m.node) loadNode(c); },
  tb: c => c.m.node ? [{ l: 'IMG structure', i: '🗂', a: c => act(c => { c.m.node = ''; }) }] : [{ l: 'Reset all customizing', i: '↺', a: () => modal('Reset customizing', '<p>Restore all SPRO settings (accounts, tolerances, release strategy, storage locations, purchasing groups, price control defaults) to the delivered values? Documents are kept.</p>', [{ l: 'Cancel' }, { l: 'Reset', pri: 1, a: () => act(() => { S.cfg = {}; MMSB.ensureAll(); emit('CFG_CHANGED', { node: 'reset' }); msg('S', 'Customizing reset to delivered values'); }) }]) }],
  acts: { node: (c, d) => { c.m.node = d.node; loadNode(c); } },
  render: c => {
    if (!c.m.node) return box('SAP Customizing Implementation Guide', NODES.map(([g, list]) => `<details open class="tree"><summary><span class="fold">📁</span> ${esc(g)}</summary>${list.map(([id, t]) => `<button type="button" class="leaf" data-act="node" data-node="${id}"><b>⚙</b>${esc(t)}</button>`).join('')}</details>`).join('')) +
      '<div class="warnbox">Customizing changes how the whole client behaves. In real projects it is done in a development system and transported. Here changes apply immediately and are kept on this device; use "Reset all customizing" to undo them.</div>' +
      '<div class="tip">Shortcuts: <b>OBYC</b> account determination · <b>OMR6</b> invoice tolerances · <b>OMJJ</b> movement types · <b>OX18</b> organisational overview · <b>OX09</b> storage locations.</div>';
    return nodeScreen(c);
  },
  enter: () => {},
  save: c => { if (!c.m.node) err('Choose an activity first'); const t = saveNode(c); emit('CFG_CHANGED', { node: c.m.node }); loadNode(c); msg('S', `Data was saved: ${t}`); },
  back: c => { if (c.m.node && !c.m._direct) { c.m.node = ''; return true; } }
};
const direct = node => ({ ...TX.SPRO, init: () => ({ node, _direct: true }) });
TX.OBYC = direct('obyc'); TX.OMR6 = direct('tol'); TX.OMJJ = direct('mvt'); TX.OX18 = direct('org'); TX.OX09 = direct('sloc');

SCEN.push({ id: 'spro', title: '19. Customizing: tolerances & accounts', level: 'Configuration · 20 min',
  intro: 'See how configuration changes system behaviour: widen the invoice tolerance, post an invoice that would have been blocked, then explore account determination.',
  steps: [
    { t: 'Open the invoice tolerance limits (<b>OMR6</b>) and set PP to <b>15%</b> and <b>2,000 EUR</b>.', h: '/nOMR6 → upper limit % = 15, upper limit EUR = 2000 → Ctrl+S.', ok: e => e.type === 'CFG_CHANGED' && e.node === 'tol' && S.cfg.tol.pp >= 15 },
    { t: 'Create and receive a PO for <b>10 PC</b> of <b>TG11</b> from 100001.', h: 'ME21N → 100001 → TG11, 10 → Ctrl+S. MIGO → GR → OK → Post.', ok: e => e.type === 'GR_POSTED' && S.pos[e.po]?.items.some(i => i.matnr === 'TG11' && i.qty === 10), cap: (e, x) => { x.po = e.po; } },
    { t: 'Post an invoice 10% above the PO price: it is <b>not</b> blocked now.', h: 'MIRO → PO → Enter → amount 5,610.00 → gross 6,732.00 → Post. Compare with scenario 4.', ok: (e, x) => e.type === 'IR_POSTED' && e.po === x.po && !e.blocked },
    { t: 'Set the tolerance back to <b>5%</b> / <b>1,000 EUR</b>.', h: '/nOMR6 → 5 and 1000 → Ctrl+S.', ok: e => e.type === 'CFG_CHANGED' && e.node === 'tol' && S.cfg.tol.pp <= 5 },
    { t: 'Open account determination (<b>OBYC</b>) and find the GR/IR account (WRX).', h: '/nOBYC. Every automatic posting you have seen in FB03 comes from this table.', ok: e => e.type === 'TX_OPEN' && e.tcode === 'OBYC' },
    { t: 'Create storage location <b>101C</b> "Quarantine" (<b>OX09</b>) and transfer 5 PC of TG12 into it (MIGO 311).', h: '/nOX09 → 101C, Quarantine → Ctrl+S. Then MIGO → A08 / R10 / 311 → TG12, 5, 101A → 101C → Post.', ok: e => e.type === 'MVT_POSTED' && e.mvt === '311' && e.items.some(i => i.toSloc === '101C') }
  ],
  notes: ['Separate customizing (SPRO, consultants) from master data and transactions (users): a classic exam and interview question.', 'Real tolerance keys include PP, DQ, BD (small differences), PS (estimated price) and more, per company code.', 'OBYC is where MM meets FI: walk learners from a posting in FB03 back to the OBYC entry that chose the account.'] });
HOOKS.open = HOOKS.open || [];
HOOKS.open.push(code => { if (['OBYC', 'OMR6', 'OMJJ', 'SPRO', 'OX18', 'OX09'].includes(code)) emit('TX_OPEN', { tcode: code }); });
})();
