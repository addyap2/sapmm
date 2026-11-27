/* MM Sandbox: exam mode. Timed random tasks on fresh data, results hidden until the end. */
(() => {
'use strict';
const { esc, seed, home, saveTP, drawTrainer, toast } = MMSB;
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const hasItem = (e, m, q) => (e.items || []).some(x => x.matnr === m && (q == null || near(x.qty, q)));
// task bank: key → generator returning { t, p } ; checks in OK[key](e, p)
const BANK = {
  pr: { a: 1, g: () => { const q = pick([200, 300, 400]); return { p: { q }, t: `Create a purchase requisition for <b>${q} PC</b> of <b>RM14</b>, plant 1010.` }; } },
  po: { a: 1, g: () => { const q = pick([30, 40, 60]); return { p: { q }, t: `Create a standard PO with supplier <b>100001</b> for <b>${q} PC</b> of <b>TG12</b>.` }; } },
  gr: { a: 1, g: () => ({ p: {}, t: 'Post the goods receipt for open purchase order <b>4500000002</b> (office chairs).' }) },
  info: { a: 1, g: () => { const pr = pick([95, 99, 105]); return { p: { pr }, t: `Create a purchasing info record: supplier <b>100002</b>, material <b>TG13</b>, net price <b>${pr}.00 EUR</b>.` }; } },
  mat: { a: 1, g: () => ({ p: {}, t: 'Create a new <b>raw material</b> (material type ROH) of your choice in plant 1010.' }) },
  tr: { a: 1, g: () => { const q = pick([10, 15, 20]); return { p: { q }, t: `Transfer <b>${q} PC</b> of <b>TG12</b> from storage location 101A to <b>101B</b>.` }; } },
  gi: { a: 1, g: () => { const q = pick([50, 80, 120]); return { p: { q }, t: `Issue <b>${q} PC</b> of <b>RM14</b> to cost centre <b>10101301</b>.` }; } },
  scrap: { a: 1, g: () => { const q = pick([1, 2]); return { p: { q }, t: `Scrap <b>${q} PC</b> of <b>TG15</b> (damaged in the warehouse).` }; } },
  res: { a: 1, g: () => ({ p: {}, t: 'Post the goods issue for reservation <b>0000000001</b>.' }) },
  ret: { a: 1, g: () => ({ p: {}, t: 'Return <b>2 PC</b> from purchase order <b>4500000001</b> to the supplier.' }) },
  cm: { a: 1, g: () => ({ p: {}, t: 'The supplier of PO <b>4500000001</b> sends a credit memo for <b>1 PC</b>: post it.' }) },
  pi: { a: 1, g: () => ({ p: {}, t: 'Run a physical inventory for <b>TG15</b> in 101A: create the document, enter a count and post the differences.' }) },
  ext: { a: 1, g: () => ({ p: {}, t: 'Extend material <b>TG11</b> to plant <b>1020</b> (storage location 102A).' }) },
  rel: { g: () => ({ p: {}, t: 'Create a purchase order worth <b>more than 10,000 EUR</b> and release it completely.' }) },
  src: { g: () => ({ p: {}, t: 'Maintain a source list for <b>TG12</b> with supplier <b>100002</b> as the <b>fixed</b> source.' }) },
  ctr: { g: () => ({ p: {}, t: 'Create a release order (PO) against contract <b>4600000001</b>.' }) },
  mr21: { g: () => { const pr = pick(['0.88', '0.90', '0.92']); return { p: { pr: +pr }, t: `Change the standard price of <b>RM14</b> to <b>${pr} EUR</b>.` }; } },
  ses: { g: () => ({ p: {}, t: 'Create a service PO (item category D) and post an accepted service entry sheet for it.' }) },
  cc: { g: () => ({ p: {}, t: 'Create a PO for a consumable charged directly to a <b>cost centre</b> (account assignment K).' }) },
  sto: { g: () => ({ p: {}, t: 'Create a stock transport order from plant 1010 to plant 1020 and post its <b>goods issue</b>.' }) },
  subd: { g: () => ({ p: {}, t: 'The supplier of PO <b>4500000001</b> bills extra freight after the invoice: post a <b>subsequent debit</b>.' }) },
  block: { g: () => ({ p: {}, t: 'Post an invoice that is <b>blocked for payment</b> (e.g. price variance) and then <b>release</b> it.' }) }
};
const OK = {
  pr: (e, p) => e.type === 'PR_CREATED' && hasItem(e, 'RM14', p.q),
  po: (e, p) => e.type === 'PO_CREATED' && e.vendor === '100001' && hasItem(e, 'TG12', p.q),
  gr: e => e.type === 'GR_POSTED' && e.po === '4500000002',
  info: e => e.type === 'INFO_CREATED' && e.matnr === 'TG13' && e.vendor === '100002',
  mat: e => e.type === 'MAT_CREATED' && e.mtype === 'ROH',
  tr: (e, p) => e.type === 'MVT_POSTED' && e.mvt === '311' && (e.items || []).some(x => x.matnr === 'TG12' && near(x.qty, p.q) && (!x.toSloc || x.toSloc === '101B')),
  gi: (e, p) => e.type === 'MVT_POSTED' && e.mvt === '201' && hasItem(e, 'RM14', p.q),
  scrap: (e, p) => e.type === 'MVT_POSTED' && e.mvt === '551' && hasItem(e, 'TG15', p.q),
  res: e => e.type === 'MVT_POSTED' && e.res === '0000000001',
  ret: e => e.type === 'GR_RETURN' && e.po === '4500000001',
  cm: e => e.type === 'IR_POSTED' && e.po === '4500000001' && e.cm && !e.sub,
  pi: e => e.type === 'PI_POSTED',
  ext: e => e.type === 'MAT_EXTENDED' && e.matnr === 'TG11' && e.plant === '1020',
  rel: e => e.type === 'PO_RELEASED' && e.final,
  src: e => e.type === 'SRC_SAVED' && e.matnr === 'TG12' && (e.rows || []).some(r => r.vendor === '100002' && r.fixed),
  ctr: e => e.type === 'PO_CREATED' && (e.items || []).some(x => x.agmt === '4600000001'),
  mr21: (e, p) => e.type === 'PRICE_CHANGED' && e.matnr === 'RM14' && near(e.price, p.pr),
  ses: e => e.type === 'SES_POSTED',
  cc: e => e.type === 'PO_CREATED' && (e.items || []).some(x => x.acct === 'K'),
  sto: e => e.type === 'STO_GI',
  subd: e => e.type === 'IR_POSTED' && e.po === '4500000001' && e.sub === 'D',
  block: e => e.type === 'IR_RELEASED'
};
const EXAMS = {
  A: { n: 8, min: 25, title: 'Exam A · Procure-to-pay & inventory', pool: Object.keys(BANK).filter(k => BANK[k].a) },
  B: { n: 12, min: 40, title: 'Exam B · Full MM', pool: Object.keys(BANK) }
};
const PASS = 70;
const TP = () => MMSB.TP;
const ex = () => TP().exam;
const left = () => Math.max(0, Math.round((ex().end - Date.now()) / 1000));
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
function start(id) {
  const E = EXAMS[id];
  const keys = shuffle(E.pool).slice(0, E.n);
  const tasks = keys.map(k => { const g = BANK[k].g(); return { k, t: g.t, p: g.p, done: false }; });
  seed(); home();
  const tp = TP(); tp.active = null; tp.view = 'exam';
  tp.exam = { id, title: E.title, tasks, start: Date.now(), end: Date.now() + E.min * 60000, finished: false, errs: 0 };
  saveTP(); drawTrainer(); tick();
  toast(`⏱ ${E.title}: ${E.n} tasks, ${E.min} minutes. Fresh data loaded.`);
}
function finish(auto) {
  const x = ex(); if (!x || x.finished) return;
  x.finished = true; x.stop = Date.now();
  const ok = x.tasks.filter(t => t.done).length; x.score = Math.round(ok / x.tasks.length * 100);
  const tp = TP(); (tp.examHist ??= []).unshift({ id: x.id, date: new Date().toISOString().slice(0, 10), score: x.score, ok, n: x.tasks.length, mins: Math.ceil((x.stop - x.start) / 60000) });
  tp.examHist = tp.examHist.slice(0, 10); tp.view = 'exam';
  saveTP(); drawTrainer();
  toast(auto ? '⏱ Time is up: exam finished' : 'Exam finished');
}
let timer = null;
function tick() {
  clearInterval(timer);
  timer = setInterval(() => {
    const x = ex(); if (!x || x.finished) { clearInterval(timer); return; }
    if (left() <= 0) { finish(true); return; }
    const el = document.getElementById('examClock'); if (el) el.textContent = mmss(left());
  }, 1000);
}
MMSB.HOOKS.emit = MMSB.HOOKS.emit || [];
MMSB.HOOKS.emit.push(e => {
  const x = ex(); if (!x || x.finished) return;
  if (Date.now() > x.end) { finish(true); return; }
  if (e.type === 'ERR') { x.errs++; saveTP(); return; }
  let hit = false;
  x.tasks.forEach(t => { if (!t.done && OK[t.k]?.(e, t.p)) { t.done = true; t.at = Date.now(); hit = true; } });
  if (hit) saveTP();
});
MMSB.examBank = BANK;
MMSB.examListHtml = () => {
  const x = ex(); const h = TP().examHist || [];
  const running = x && !x.finished;
  return `<div class="sc-grp"><b>🎓 Exam mode</b><p class="small">Random tasks, fresh data, a countdown, no hints. Your score is only shown at the end (pass mark ${PASS}%).</p>
    ${running ? `<button type="button" class="btn pri" data-ex="open">⏱ Resume ${esc(x.title)} (${mmss(left())} left)</button>` :
      Object.entries(EXAMS).map(([id, E]) => `<button type="button" class="btn${id === 'A' ? ' pri' : ''}" data-ex="start" data-id="${id}">${esc(E.title)} · ${E.n} tasks · ${E.min} min</button>`).join(' ')}
    ${h.length ? `<p class="small">Last results: ${h.slice(0, 3).map(r => `${r.date} exam ${r.id}: <b>${r.score}%</b> ${r.score >= PASS ? '✅' : '❌'}`).join(' · ')}</p>` : ''}</div>`;
};
MMSB.examRender = () => {
  const x = ex();
  if (!x) return '<p>No exam.</p><button type="button" class="btn" data-ex="list">← All scenarios</button>';
  if (!x.finished) return `<button type="button" class="btn sm" data-ex="list">← All scenarios</button>
    <h3>${esc(x.title)}</h3><p class="exam-clock">⏱ <b id="examClock">${mmss(left())}</b> left</p>
    <p class="small">Complete the tasks in any order, in the SAP GUI or in Fiori. The sandbox checks your postings silently: results appear when you finish.</p>
    <ol class="steps">${x.tasks.map((t, i) => `<li data-n="${i + 1}"><div>${t.t}</div></li>`).join('')}</ol>
    <button type="button" class="btn pri" data-ex="finish">🏁 Finish exam</button>`;
  const ok = x.tasks.filter(t => t.done).length; const pass = x.score >= PASS;
  return `<button type="button" class="btn sm" data-ex="list">← All scenarios</button>
    <h3>${esc(x.title)}: results</h3>
    <p class="exam-score ${pass ? 'pass' : 'fail'}"><b>${x.score}%</b> · ${ok}/${x.tasks.length} tasks · ${pass ? 'PASSED ✅' : 'NOT PASSED ❌'}</p>
    <p class="small">Time used: ${Math.ceil((x.stop - x.start) / 60000)} min · error messages met: ${x.errs}</p>
    <ol class="steps">${x.tasks.map((t, i) => `<li data-n="${i + 1}" class="${t.done ? 'done' : 'miss'}"><div>${t.t}</div></li>`).join('')}</ol>
    <p class="small">For each ❌ task, the matching guided scenario walks you through it step by step.</p>
    <button type="button" class="btn pri" data-ex="start" data-id="${x.id}">↻ Retake (new random tasks)</button>`;
};
MMSB.examAct = (a, el) => {
  const tp = TP();
  if (a === 'start') { const x = ex(); if (x && !x.finished && !confirm('An exam is running. Abandon it and start a new one?')) return; start(el.dataset.id); return; }
  if (a === 'finish') { if (confirm('Finish the exam now and see your score?')) finish(false); return; }
  if (a === 'open') { tp.view = 'exam'; saveTP(); drawTrainer(); tick(); return; }
  if (a === 'list') { tp.view = null; saveTP(); drawTrainer(); }
};
document.addEventListener('DOMContentLoaded', () => { const x = ex(); if (x && !x.finished) tick(); });
})();
