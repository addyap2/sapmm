/* MM Sandbox: English / French interface.
   Every text the app writes is translated on the fly from the dictionary in i18n-fr.js.
   Keys are the English text with document numbers, quantities, dates and codes replaced by {0}, {1}…,
   so one entry covers every message of the same shape. Data (material and supplier names) stays as entered. */
(() => {
'use strict';
const LKEY = 'sapmm-sandbox-lang';
let lang = 'en';
try { lang = localStorage.getItem(LKEY) || 'en'; } catch (e) { /* ignore */ }
const TOK = /[A-Z0-9][A-Z0-9_.,:/-]*/g;
const hasDigit = s => /\d/.test(s);
const norm = s => String(s).replace(/\s+/g, ' ').trim();
function templatize(s) {
  const toks = [];
  const key = norm(s).replace(TOK, m => { if (!hasDigit(m)) return m; toks.push(m); return `{${toks.length - 1}}`; });
  return { key, toks };
}
const fill = (t, toks) => t.replace(/\{(\d+)\}/g, (m, i) => toks[+i] ?? m);
const RICH = '.tip, .warnbox, .steps li > div:first-child, .hint, .tr-notes li, .sc > small, .disclaimer, .done-banner, .tr-body > p, .modal .mb-body > p, .fl-ts';
const D = () => window.MMSB_FR || {};
function tr(s) {
  if (!s || !/[A-Za-z]/.test(s)) return null;
  const { key, toks } = templatize(s);
  const t = D()[key];
  return t == null ? null : fill(t, toks);
}
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA']);
function walk(root) {
  if (lang !== 'fr' || !root) return;
  if (root.nodeType === 3) { txt(root); return; }
  if (root.nodeType !== 1 || SKIP.has(root.tagName)) return;
  const rich = root.matches?.(RICH) ? [root] : [];
  root.querySelectorAll?.(RICH).forEach(e => rich.push(e));
  for (const e of rich) {
    if (e.dataset.i18n === e.innerHTML) continue;
    const t = tr(e.innerHTML);
    if (t != null) { e.innerHTML = t; }
    e.dataset.i18n = e.innerHTML;
  }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => n.nodeType === 1 ? (SKIP.has(n.tagName) || n.dataset?.i18n != null ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT
  });
  const nodes = []; let n;
  while ((n = tw.nextNode())) nodes.push(n);
  nodes.forEach(txt);
  const els = root.querySelectorAll ? [root, ...root.querySelectorAll('[placeholder],[title],[aria-label]')] : [];
  for (const e of els) for (const a of ['placeholder', 'title', 'aria-label']) { const v = e.getAttribute?.(a); if (v) { const t = tr(v); if (t != null && t !== v) e.setAttribute(a, t); } }
}
function txt(node) {
  const v = node.nodeValue; if (!v || !/[A-Za-z]/.test(v)) return;
  if (node.parentElement?.closest?.('[data-i18n]')) return;
  const t = tr(v);
  if (t != null && t !== norm(v)) { const lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0]; node.nodeValue = lead + t + trail; }
}
let busy = false;
const obs = new MutationObserver(muts => {
  if (busy || lang !== 'fr') return;
  busy = true;
  try { for (const m of muts) { if (m.type === 'characterData') txt(m.target); else m.addedNodes.forEach(walk); } }
  finally { obs.takeRecords(); busy = false; }
});
function setLang(l) { try { localStorage.setItem(LKEY, l); } catch (e) { /* ignore */ } location.reload(); }
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.lang = lang === 'fr' ? 'fr' : 'en-GB';
  const btn = document.getElementById('langBtn');
  if (btn) { btn.textContent = lang === 'fr' ? '🇬🇧 EN' : '🇫🇷 FR'; btn.title = lang === 'fr' ? 'Switch to English' : 'Passer en français'; btn.onclick = () => setLang(lang === 'fr' ? 'en' : 'fr'); }
  if (lang === 'fr') {
    // run after the app's own DOMContentLoaded handler has drawn the first screen
    setTimeout(() => { busy = true; walk(document.body); obs.takeRecords(); busy = false; obs.observe(document.body, { subtree: true, childList: true, characterData: true }); }, 0);
  }
});
window.MMSB_I18N = { templatize, tr, get lang() { return lang; }, RICH };
})();
