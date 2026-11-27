/* MM Sandbox: release strategies (PO and PR), message output. */
(() => {
'use strict';
const { S, ORG, TX, F4, F4T, TITLES, SCEN, HOOKS, esc, pad, today, dPlus, fmtD, N, r2, money, qf, U, sum, err,
  vname, poTotals, emit, msg, call, act, F, I, box, grid, lnk, req, modal } = MMSB;

const DEFREL = () => ({ active: true, po: [{ code: 'B1', name: 'Purchasing manager', from: 10000 }, { code: 'F1', name: 'Finance director', from: 50000 }], pr: [{ code: 'B1', name: 'Purchasing manager', from: 10000 }] });
HOOKS.ensure.push(S => { S.cfg.rel ??= DEFREL(); });
const poValue = P => r2(sum(P.items.filter(i => !i.del), i => i.qty * i.price / i.per));
const prValue = P => r2(sum(P.items.filter(i => !i.del), i => i.qty * (i.valPrice || 0)));
const levels = (kind, value) => S.cfg.rel.active ? S.cfg.rel[kind].filter(l => value >= l.from).map(l => l.code) : [];
function setStrategy(D, kind, value) {
  const codes = levels(kind, value);
  D.relCodes = codes; D.relDone = []; D.relReq = codes.length > 0; D.released = !D.relReq; D.relStrat = codes.length ? `S${codes.length}` : '';
}
HOOKS.poCreate.push(P => { if (P.type === 'LP') { P.relReq = false; P.released = true; return; } setStrategy(P, 'po', poValue(P)); });
HOOKS.prCreate.push(P => setStrategy(P, 'pr', prValue(P)));
(HOOKS.poChange ??= []).push((P, oldV, newV) => { const codes = levels('po', newV); if (newV > oldV + 0.004 || codes.join() !== (P.relCodes || []).join()) { const was = P.released && P.relReq; setStrategy(P, 'po', newV); if (was && P.relReq) P.output = null; } });
(HOOKS.prChange ??= []).push(P => setStrategy(P, 'pr', prValue(P)));
HOOKS.grCheck.push(P => { if (P.relReq && !P.released) err(`Purchase order ${P.num} is not yet released: goods receipt not possible (release with ME29N)`, 'NOT_RELEASED', 'doc'); });
HOOKS.poHeader.push(P => {
  const rel = P.relReq ? `${P.released ? '<span class="badge ok">Released</span>' : '<span class="badge warn">Release pending</span>'} strategy ${P.relStrat}: ${P.relCodes.map(c => `${c} ${P.relDone.includes(c) ? '✔' : '○'}`).join(' · ')}` : '<span class="muted">No release required</span>';
  const out = P.output ? `<span class="badge ok">Output sent ${fmtD(P.output.date)} (${esc(P.output.medium)})</span>` : '<span class="muted">Not yet output</span>';
  return `<div class="cols mt"><div><div class="f"><label>Release</label><span>${rel}</span><span></span></div></div><div><div class="f"><label>Messages</label><span>${out}</span><span></span></div></div></div>`;
});
HOOKS.poTb.push((c, P) => P && P.type !== 'LP' ? [{ l: 'Print preview', i: '🖨', a: () => poForm(P) }, ...(P.relReq && !P.released ? [{ l: 'Release (ME29N)', i: '✔', a: () => call('ME29N', { po: P.num }, true) }] : [])] : []);

function poForm(P) {
  const V = S.vendors[P.vendor];
  const html = `<div style="font:13px/1.5 Arial;color:#222"><div style="display:flex;justify-content:space-between"><div><b style="font-size:18px">Riviera Trading SAS</b><br>135 rue de l'Exemple · 83600 Fréjus · France</div><div style="text-align:right"><b style="font-size:16px">PURCHASE ORDER</b><br>No. ${P.num}<br>Date ${fmtD(P.docDate)}</div></div>
    <p style="margin-top:18px"><b>Supplier</b><br>${esc(V.name)}<br>${esc(V.street)}<br>${esc(V.post)} ${esc(V.city)}<br>Supplier no. ${V.id}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:10px" border="1" cellpadding="5"><tr style="background:#eee"><th>Item</th><th>Material</th><th>Description</th><th>Qty</th><th>Delivery</th><th>Price</th><th>Value EUR</th></tr>
    ${P.items.filter(i => !i.del).map(i => `<tr><td>${i.item}</td><td>${i.matnr}</td><td>${esc(i.short)}${i.cat === 'K' ? ' (consignment)' : i.cat === 'L' ? ' (subcontracting: components provided)' : ''}</td><td style="text-align:right">${qf(i.qty)} ${i.uom}</td><td>${fmtD(i.date)}</td><td style="text-align:right">${i.cat === 'K' ? '' : money(i.price)}</td><td style="text-align:right">${i.cat === 'K' ? '' : money(i.qty * i.price / i.per)}</td></tr>`).join('')}
    <tr><td colspan="6" style="text-align:right"><b>Total net value</b></td><td style="text-align:right"><b>${money(poValue(P))}</b></td></tr></table>
    <p>Payment terms: ${esc(ORG.payterms[V.porg?.['1010']?.terms] || '')}. Please quote our PO number on delivery note and invoice.</p><p class="small" style="color:#888">Training document · MM Sandbox · fictional data</p></div>`;
  modal(`Print preview · PO ${P.num}`, html, [{ l: 'Close' }, { l: 'Open printable page', pri: 1, a: () => { const w = window.open('', '_blank'); if (w) { w.document.write(`<!DOCTYPE html><title>PO ${P.num}</title><body style="max-width:780px;margin:30px auto">${html}<script>print()<\/script>`); w.document.close(); } } }]);
}
MMSB.poForm = poForm;

// release API (also used by the Fiori "My Inbox" app)
function releaseNext(D, code) {
  if (!D.relReq) err(`Document ${D.num} is not subject to release`);
  if (D.released) err(`Document ${D.num} is already fully released`);
  const next = D.relCodes.find(c => !D.relDone.includes(c));
  if (code && code !== next) err(`Release code ${code} is not the next step: ${D.relDone.length ? `prerequisite ${next}` : `${next}`} must release first`, 'REL_ORDER');
  D.relDone.push(next); D.released = D.relDone.length === D.relCodes.length;
  return next;
}
function cancelRelease(D) {
  if (!D.relDone?.length) err(`No release to cancel for ${D.num}`);
  if (D.history && D.history.some(h => h.type === 'WE')) err(`Release of ${D.num} cannot be cancelled: goods receipts already posted`);
  const c = D.relDone.pop(); D.released = false; D.output = null; return c;
}
MMSB.releaseNext = releaseNext; MMSB.cancelRelease = cancelRelease; MMSB.poValue = poValue;
const relName = (kind, code) => S.cfg.rel[kind].find(l => l.code === code)?.name || code;

Object.assign(TITLES, { ME29N: 'Release Purchase Order', ME28: 'Release Purchase Orders (Collective)', ME54N: 'Release Purchase Requisition', ME55: 'Collective Release of Purchase Reqs.', ME9F: 'Message Output: Purchase Orders' });
F4.relcode = () => S.cfg.rel.po.map(l => [l.code, l.name, `from ${money(l.from)} EUR`]);
F4T.relcode = 'Release code';

const relTable = (D, kind) => grid([{ h: 'Code', k: 'code' }, { h: 'Description', f: r => esc(relName(kind, r.code)) }, { h: 'Status', f: r => D.relDone.includes(r.code) ? '<span class="badge ok">Released</span>' : r.code === D.relCodes.find(c => !D.relDone.includes(c)) ? '<span class="badge warn">Next</span>' : '<span class="badge">Waiting</span>' }], D.relCodes.map(code => ({ code })), { empty: 'No release strategy: value below the release limit' });
const indiv = (code, kind) => ({
  title: c => c.m.show ? `${kind === 'po' ? 'Standard PO' : 'Purch. Req.'} ${c.m.doc} Release` : `${kind === 'po' ? 'Release Purchase Order' : 'Release Purchase Requisition'}`,
  init: p => ({ doc: p.po || p.pr || '', show: false, _auto: !!(p.po || p.pr) }),
  onOpen: c => { if (c.m._auto) TX[code].enter(c); },
  tb: c => c.m.show ? [{ l: 'Release', i: '✔', a: c => act(TX[code].rel) }, { l: 'Cancel release', i: '↶', a: c => act(TX[code].canc) }] : [],
  render: c => {
    if (!c.m.show) return box(kind === 'po' ? 'Purchase order' : 'Purchase requisition', F(kind === 'po' ? 'Purchase order' : 'Purch. requisition', 'doc', { req: 1, f4: kind === 'po' ? 'po' : 'pr', w: 12 })) + `<div class="tip">Documents with a value from ${money(S.cfg.rel[kind][0]?.from || 0)} EUR need approval. ${kind === 'po' ? 'Until the PO is fully released it cannot be output to the supplier or received in MIGO.' : 'An unreleased requisition cannot be converted into a PO.'} Limits are set in SPRO.</div>`;
    const D = kind === 'po' ? S.pos[c.m.doc] : S.prs[c.m.doc]; const val = kind === 'po' ? poValue(D) : prValue(D);
    return box(`${kind === 'po' ? 'PO' : 'Requisition'} ${D.num}${kind === 'po' ? ' · ' + D.vendor + ' ' + esc(vname(D.vendor)) : ''} · value ${money(val)} EUR`, `<div class="f"><label>Release strategy</label><b>${D.relStrat || '—'}</b><span>${D.released ? '<span class="badge ok">Fully released</span>' : '<span class="badge warn">Release pending</span>'}</span></div>` + relTable(D, kind)) +
      box('Items', grid([{ h: 'Item', k: 'item' }, { h: 'Material', k: 'matnr' }, { h: 'Short text', k: 'short' }, { h: 'Quantity', r: 1, f: r => qf(r.qty) }, { h: kind === 'po' ? 'Net price' : 'Val. price', r: 1, f: r => money(kind === 'po' ? r.price : r.valPrice) }], D.items));
  },
  enter: c => { if (c.m.show) return; req(c, ['doc']); c.m.doc = c.m.doc.trim(); const D = kind === 'po' ? S.pos[c.m.doc] : S.prs[c.m.doc]; if (!D) err(`Document ${c.m.doc} does not exist`, null, 'doc'); if (!D.relReq) err(`Document ${D.num} is not subject to release (value below the limit)`, 'NO_REL', 'doc'); c.m.show = true; },
  rel: c => { const D = kind === 'po' ? S.pos[c.m.doc] : S.prs[c.m.doc]; const cd = releaseNext(D); emit(kind === 'po' ? 'PO_RELEASED' : 'PR_RELEASED', { num: D.num, code: cd, final: D.released }); msg('S', `${kind === 'po' ? 'Purchase order' : 'Requisition'} ${D.num} released with code ${cd}${D.released ? ' (fully released)' : ` · next: ${D.relCodes.find(x => !D.relDone.includes(x))}`}`); },
  canc: c => { const D = kind === 'po' ? S.pos[c.m.doc] : S.prs[c.m.doc]; const cd = cancelRelease(D); emit('REL_CANCELLED', { num: D.num, code: cd }); msg('S', `Release ${cd} cancelled for ${D.num}`); },
  back: c => { if (c.m.show && !c.m._auto) { c.m.show = false; return true; } }
});
TX.ME29N = indiv('ME29N', 'po'); TX.ME54N = indiv('ME54N', 'pr');
const coll = (code, kind) => ({
  title: c => c.m.list ? `${kind === 'po' ? 'Purchase Orders' : 'Requisitions'} for Release · code ${c.m.code}` : `Collective Release: Selection`,
  init: () => ({ code: 'B1', list: false, sel: {} }),
  tb: c => c.m.list ? [{ l: 'Release selected', i: '✔', a: c => act(TX[code].rel) }] : [{ l: 'Execute', i: '⏵', a: c => act(TX[code].exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Release code', 'code', { req: 1, f4: 'relcode', w: 4, desc: relName(kind, U(c.m.code)) }) + F('Release prerequisite fulfilled', '_x', { ro: 1, w: 4, desc: 'Yes' }));
    const docs = Object.values(kind === 'po' ? S.pos : S.prs).filter(D => D.relReq && !D.released && D.relCodes.find(x => !D.relDone.includes(x)) === c.m.code);
    return box(`Documents waiting for code ${c.m.code} (${docs.length})`, grid([{ h: 'Sel', f: D => I(`sel.${D.num}`, { type: 'check' }) }, { h: 'Document', f: D => lnk(kind === 'po' ? 'ME29N' : 'ME54N', kind === 'po' ? { po: D.num } : { pr: D.num }, D.num) }, ...(kind === 'po' ? [{ h: 'Supplier', f: D => `${D.vendor} ${esc(vname(D.vendor))}` }] : []), { h: 'Value EUR', r: 1, f: D => money(kind === 'po' ? poValue(D) : prValue(D)) }, { h: 'Strategy', k: 'relStrat' }, { h: 'Done', f: D => D.relDone.join(', ') || '—' }], docs, { empty: 'Nothing to release for this code' }));
  },
  exec: c => { c.m.code = U(c.m.code); if (!S.cfg.rel[kind].some(l => l.code === c.m.code)) err(`Release code ${c.m.code} is not defined`, null, 'code'); c.m.list = true; emit('REPORT', { tcode: code }); },
  rel: c => { const ids = Object.entries(c.m.sel).filter(([, v]) => v).map(([k]) => k); if (!ids.length) err('Select at least one document'); ids.forEach(id => { const D = (kind === 'po' ? S.pos : S.prs)[id]; releaseNext(D, c.m.code); emit(kind === 'po' ? 'PO_RELEASED' : 'PR_RELEASED', { num: id, code: c.m.code, final: D.released }); }); c.m.sel = {}; msg('S', `${ids.length} document${ids.length > 1 ? 's' : ''} released with code ${c.m.code}`); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
});
TX.ME28 = coll('ME28', 'po'); TX.ME55 = coll('ME55', 'pr');
TX.ME9F = {
  title: c => c.m.list ? 'Message Output: Purchase Orders' : 'Message Output: Selection',
  init: () => ({ list: false, sel: {}, medium: 'Print', processed: false }),
  tb: c => c.m.list ? [{ l: 'Output message', i: '🖨', a: c => act(TX.ME9F.out) }] : [{ l: 'Execute', i: '⏵', a: c => act(TX.ME9F.exec) }],
  render: c => {
    if (!c.m.list) return box('Selection', F('Message type', '_t', { ro: 1, w: 6, desc: 'NEU Purchase order' }) + F('Transmission medium', 'medium', { type: 'select', opts: { Print: '1 Print output', Email: '5 External send (e-mail)' } }) + F('Include already output', 'processed', { type: 'check' })) + '<div class="tip">Message determination proposes output type NEU for each released PO. Unreleased POs are not offered: they cannot be sent to the supplier.</div>';
    const docs = Object.values(S.pos).filter(P => P.type !== 'LP' && (c.m.processed || !P.output)).reverse();
    return box(`Purchase orders (${docs.length})`, grid([{ h: 'Sel', f: P => P.relReq && !P.released ? '' : I(`sel.${P.num}`, { type: 'check' }) }, { h: 'PO', f: P => lnk('ME23N', { po: P.num }, P.num) }, { h: 'Supplier', f: P => `${P.vendor} ${esc(vname(P.vendor))}` }, { h: 'Value EUR', r: 1, f: P => money(poValue(P)) }, { h: 'Release', f: P => P.relReq ? (P.released ? '<span class="badge ok">Released</span>' : '<span class="badge warn">Pending</span>') : '—' }, { h: 'Output', f: P => P.output ? `${fmtD(P.output.date)} ${esc(P.output.medium)}` : '' }], docs));
  },
  exec: c => { c.m.list = true; },
  out: c => { const ids = Object.entries(c.m.sel).filter(([, v]) => v).map(([k]) => k); if (!ids.length) err('Select at least one purchase order'); ids.forEach(id => { const P = S.pos[id]; if (P.relReq && !P.released) err(`PO ${id} is not released: output not possible`, 'NOT_RELEASED'); P.output = { date: today(), medium: c.m.medium }; emit('PO_OUTPUT', { num: id }); }); c.m.sel = {}; msg('S', `${ids.length} message${ids.length > 1 ? 's' : ''} processed (${c.m.medium === 'Email' ? 'sent by e-mail' : 'printed'})`); },
  back: c => { if (c.m.list) { c.m.list = false; return true; } }
};

SCEN.push({ id: 'rel', title: '12. Release strategy & PO output', level: 'Purchasing · 20 min',
  intro: 'A high-value PO needs approval before it can be sent or received. Approve it, output it, then receive the goods.',
  steps: [
    { t: 'Create a PO for <b>25 PC</b> of <b>TG11</b> from <b>100001</b> (value 12,750 EUR, above the 10,000 EUR limit).', h: 'ME21N → 100001 → TG11, 25 → Enter → Ctrl+S. The message says "subject to release".', ok: e => e.type === 'PO_CREATED' && e.rel && e.items.some(i => i.matnr === 'TG11'), cap: (e, x) => { x.po = e.num; } },
    { t: 'Try to post the goods receipt: MIGO refuses an unreleased PO.', h: 'MIGO → A01 / R01 → your PO → Enter. Read the error.', ok: e => e.type === 'ERR' && e.code === 'NOT_RELEASED' },
    { t: 'Release the PO with code <b>B1</b> (<b>ME29N</b> or <b>ME28</b>).', h: 'ME29N → your PO → Enter → Release. (ME28 does the same for many POs at once.)', ok: (e, x) => e.type === 'PO_RELEASED' && e.num === x.po && e.final },
    { t: 'Output the PO to the supplier (<b>ME9F</b>) and look at the print preview.', h: 'ME9F → F8 → tick your PO → Output message. Then ME23N → your PO → "Print preview".', ok: (e, x) => e.type === 'PO_OUTPUT' && e.num === x.po },
    { t: 'Now post the goods receipt.', h: 'MIGO → A01 / R01 → your PO → Enter → OK → Post.', ok: (e, x) => e.type === 'GR_POSTED' && e.po === x.po },
    { t: 'Create a requisition for <b>30 PC</b> of TG11 (value ≈ 15,500 EUR) and release it with <b>ME54N</b>.', h: 'ME51N → TG11, 30 → Ctrl+S. Then ME54N → the requisition → Enter → Release.', ok: e => e.type === 'PR_RELEASED' && e.final }
  ],
  notes: ['Release strategies are driven by classification (characteristics such as value, purchasing group, plant). Here the value limits are configurable in SPRO › Release procedure.', 'Raising the value of a released PO in ME22N resets the release: try it.', 'In Fiori, approvers use "My Inbox": open the launchpad (/UI2/FLP) and approve from there.'] });
})();
