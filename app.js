(() => {
  'use strict';
  const app = document.getElementById('app');
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const hue = id => (id * 37 + 165) % 360;
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  let course, mods = [];

  // ---------- state ----------
  const KEY = 'sapmm-state';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
  const S = Object.assign({ done: {}, quiz: {}, checks: {}, boxes: {}, days: [], last: null, audio: {}, speed: 1, badges: [] }, load() || {});
  try { // migrate v1 progress
    const old = JSON.parse(localStorage.getItem('sapmm-progress') || 'null');
    if (old) {
      Object.entries(old).forEach(([k, v]) => { const q = k.match(/^m(\d+)quiz$/); if (q) S.quiz[q[1]] = v; else if (v) S.done[k] = true; });
      localStorage.removeItem('sapmm-progress');
    }
  } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
  const lk = (m, l) => `m${m}l${l}`;
  const today = (d = new Date()) => d.toLocaleDateString('en-CA');

  function markActive() {
    const t = today();
    if (!S.days.includes(t)) { S.days.push(t); S.days = S.days.slice(-400); save(); }
    renderStreak();
  }
  function streak() {
    const set = new Set(S.days); let n = 0; const d = new Date();
    if (!set.has(today(d))) d.setDate(d.getDate() - 1);
    while (set.has(today(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  const renderStreak = () => { $('#streakPill b').textContent = streak(); };

  // ---------- theme ----------
  const setTheme = t => { document.documentElement.dataset.theme = t; const tb = document.getElementById('themeBtn'); if (tb) tb.textContent = t === 'dark' ? '☀️' : '🌙'; try { localStorage.setItem('sapmm-theme', t); } catch {} };
  let theme; try { theme = localStorage.getItem('sapmm-theme'); } catch {}
  setTheme(theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

  // ---------- feedback: toast + confetti ----------
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = $('#confetti'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
    const cols = ['#0fa39b', '#14c4b9', '#f5a524', '#ffffff', '#5b8def'];
    const P = Array.from({ length: 140 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * .4, r: 4 + Math.random() * 5, vx: -2 + Math.random() * 4, vy: 3 + Math.random() * 4, a: Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)] }));
    let f = 0;
    (function tick() {
      x.clearRect(0, 0, c.width, c.height);
      P.forEach(p => { p.x += p.vx; p.y += p.vy; p.a += .1; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c; x.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); x.restore(); });
      if (++f < 150) requestAnimationFrame(tick); else x.clearRect(0, 0, c.width, c.height);
    })();
  }

  // ---------- derived data ----------
  const getMod = id => mods.find(m => m.id === id);
  const allLessons = () => mods.flatMap(m => m.lessons.map(l => ({ m, l })));
  const modStats = m => { const done = m.lessons.filter(l => S.done[lk(m.id, l.id)]).length; return { done, total: m.lessons.length, pct: Math.round(done / m.lessons.length * 100) }; };
  const totals = () => {
    const ls = allLessons(); const done = ls.filter(({ m, l }) => S.done[lk(m.id, l.id)]).length;
    const cards = mods.reduce((n, m) => n + m.flashcards.length, 0);
    const mastered = Object.values(S.boxes).filter(b => b >= 3).length;
    const qs = Object.entries(S.quiz).map(([id, v]) => v / getMod(+id).quiz.length);
    const quizAvg = qs.length ? Math.round(qs.reduce((a, b) => a + b, 0) / qs.length * 100) : null;
    const minutesDone = ls.filter(({ m, l }) => S.done[lk(m.id, l.id)]).reduce((n, { l }) => n + l.minutes, 0);
    return { done, total: ls.length, pct: Math.round(done / ls.length * 100), cards, mastered, quizAvg, minutesDone };
  };
  function nextLesson() {
    if (S.last) { const m = getMod(S.last.m); const l = m && m.lessons.find(x => x.id === S.last.l); if (l && !S.done[lk(m.id, l.id)]) return { m, l }; }
    return allLessons().find(({ m, l }) => !S.done[lk(m.id, l.id)]) || null;
  }
  const allCards = () => mods.flatMap(m => m.flashcards.map((c, i) => ({ id: `${m.id}-${i}`, m, f: c[0], b: c[1] })));
  const dueCount = () => allCards().filter(c => (S.boxes[c.id] ?? 0) < 3).length;
  const ring = (p, label, cls = '') => `<div class="ring ${cls}" style="--p:${p}"><b>${label}</b></div>`;
  const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };

  // ---------- badges ----------
  const BADGES = [
    { id: 'first', icon: '🎯', name: 'First lesson', test: t => t.done >= 1 },
    { id: 'streak3', icon: '🔥', name: '3-day streak', test: () => streak() >= 3 },
    { id: 'streak7', icon: '⚡', name: '7-day streak', test: () => streak() >= 7 },
    { id: 'mod1', icon: '🏁', name: 'Module done', test: () => mods.some(m => modStats(m).pct === 100) },
    { id: 'ace', icon: '💯', name: 'Perfect quiz', test: () => Object.entries(S.quiz).some(([id, v]) => v === getMod(+id).quiz.length) },
    { id: 'cards50', icon: '🧠', name: '50 cards mastered', test: t => t.mastered >= 50 },
    { id: 'half', icon: '🚀', name: 'Halfway', test: t => t.done >= t.total / 2 },
    { id: 'ready', icon: '🎓', name: 'Exam ready', test: () => mods.every(m => (S.quiz[m.id] ?? 0) / m.quiz.length >= .76) }
  ];
  function checkBadges() {
    const t = totals();
    BADGES.forEach(b => { if (!S.badges.includes(b.id) && b.test(t)) { S.badges.push(b.id); save(); setTimeout(() => { toast(`${b.icon} Badge unlocked: ${b.name}`); confetti(); }, 400); } });
  }

  // ---------- views ----------
  function home() {
    const t = totals(), nx = nextLesson(), due = dueCount();
    const cta = nx
      ? `<a class="btn light" href="#/m/${nx.m.id}/l/${nx.l.id}">${t.done ? '▶ Continue' : '▶ Start learning'}: ${nx.m.id}.${nx.l.id} ${esc(nx.l.title)}</a>`
      : `<a class="btn light" href="#/review">🎓 All lessons done. Review for the exam</a>`;
    const curMod = nx ? nx.m : mods[mods.length - 1];
    const cs = modStats(curMod);
    app.innerHTML = `
      <section class="hero">
        <div class="kicker">${greet()}, Antony</div>
        <h1>${esc(course.title)}</h1>
        <p>${esc(course.subtitle)}</p>
        <div class="ring-wrap">${ring(t.pct, t.pct + '%')}<div><b>${t.done} of ${t.total} lessons</b><br><span class="small" style="opacity:.8">${Math.round(t.minutesDone / 60 * 10) / 10} h studied · ${streak()} day streak</span></div></div>
        ${cta}
      </section>
      <div class="stats">
        <div class="stat"><b>🔥 ${streak()}</b><span>Day streak</span></div>
        <div class="stat"><b>${t.mastered}</b><span>Cards mastered</span></div>
        <div class="stat"><b>${t.quizAvg ?? '–'}${t.quizAvg != null ? '%' : ''}</b><span>Quiz average</span></div>
      </div>
      <div class="quick">
        <a href="#/review"><i>🃏</i><span>Review cards<small>${due} to learn</small></span></a>
        <a href="#/quick"><i>⚡</i><span>Quick quiz<small>5 random questions</small></span></a>
        <a href="#/glossary"><i>📖</i><span>Glossary<small>All key terms</small></span></a>
        <a href="#/stats"><i>📊</i><span>Progress<small>Badges & stats</small></span></a>
      </div>
      <h2>Current module</h2>
      ${modCard(curMod)}
      <a class="btn ghost block" href="#/modules">See all ${mods.length} modules</a>`;
  }

  function modCard(m) {
    const s = modStats(m), q = S.quiz[m.id];
    const mins = m.lessons.reduce((n, l) => n + l.minutes, 0);
    return `<a class="card mod" href="#/m/${m.id}" style="--h:${hue(m.id)}">
      <div class="mod-icon">${s.pct === 100 ? '✓' : m.id}</div>
      <div class="mod-body"><strong>${esc(m.title)}</strong>
        <span class="small muted">${m.lessons.length} lessons · ${Math.round(mins / 60 * 10) / 10} h${q != null ? ` · quiz ${q}/${m.quiz.length}` : ''}</span>
        <div class="bar"><i style="width:${s.pct}%"></i></div></div>
      ${ring(s.pct, s.pct + '%', 'sm')}</a>`;
  }

  function modulesView() {
    const t = totals();
    app.innerHTML = `<h1>Modules</h1><p class="muted">${t.done}/${t.total} lessons complete · ${course.modules.map(m => m.week).slice(-1)[0].replace('Week ', '')} weeks</p>
      ${mods.map(m => `<div class="small muted" style="margin-top:14px;font-weight:700">${esc(course.modules.find(x => x.id === m.id).week)}</div>${modCard(m)}`).join('')}`;
  }

  function moduleView(id) {
    const m = getMod(id); if (!m) return notFound();
    const s = modStats(m), q = S.quiz[id];
    const nx = m.lessons.find(l => !S.done[lk(id, l.id)]);
    const mastered = m.flashcards.filter((_, i) => (S.boxes[`${id}-${i}`] ?? 0) >= 3).length;
    app.innerHTML = `
      <section class="mod-header" style="--h:${hue(id)}">
        <a class="crumb" href="#/modules">← All modules</a>
        <div class="kicker">Module ${id}</div>
        <h1>${esc(m.title)}</h1>
        <p style="opacity:.9;margin:.3em 0 1em">${esc(m.intro)}</p>
        <div class="row small"><span>${s.done}/${s.total} lessons</span><span>${s.pct}%</span></div>
        <div class="bar" style="margin-top:6px"><i style="width:${s.pct}%"></i></div>
        <div class="actions" style="margin-bottom:0">${nx
          ? `<a class="btn light" href="#/m/${id}/l/${nx.id}">▶ ${s.done ? 'Continue' : 'Start'}: lesson ${id}.${nx.id}</a>`
          : `<a class="btn light" href="#/m/${id}/quiz">✓ Done. Take the quiz</a>`}</div>
      </section>
      <div class="card"><strong>You'll be able to</strong><ul style="margin:.5em 0 0;padding-left:1.2em">${m.objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul></div>
      <h2>Lessons</h2>
      ${m.lessons.map(l => { const d = S.done[lk(id, l.id)], isNext = nx && nx.id === l.id;
        return `<a class="card lesson-item" href="#/m/${id}/l/${l.id}"><span class="num ${d ? 'done' : isNext ? 'next' : ''}">${d ? '✓' : l.id}</span>
          <span style="flex:1"><strong style="font-weight:600">${esc(l.title)}</strong><br><span class="small muted">${l.minutes} min · ${l.tryIt.length} system task${l.tryIt.length > 1 ? 's' : ''}</span></span>${isNext ? '<span class="pill">Up next</span>' : ''}</a>`; }).join('')}
      <h2>Practise</h2>
      <a class="card row" href="#/m/${id}/cards"><span><strong>🃏 Flashcards</strong><br><span class="small muted">${mastered}/${m.flashcards.length} mastered</span></span><span class="pill">Study</span></a>
      <a class="card row" href="#/m/${id}/quiz"><span><strong>✅ Quiz</strong><br><span class="small muted">${m.quiz.length} questions · pass mark 76%</span></span><span class="pill ${q != null ? '' : 'amber'}">${q != null ? `Best ${Math.round(q / m.quiz.length * 100)}%` : 'Not taken'}</span></a>
      <a class="card row" href="#/m/${id}/notes"><span><strong>🎤 Trainer notes</strong><br><span class="small muted">How to teach it, mistakes, demo script</span></span><span class="pill">Kit</span></a>
      <div class="actions">${id > 1 ? `<a class="btn ghost" href="#/m/${id - 1}">← Module ${id - 1}</a>` : ''}${getMod(id + 1) ? `<a class="btn ghost" href="#/m/${id + 1}">Module ${id + 1} →</a>` : ''}</div>`;
  }

  let audioCleanup = null;
  function lessonView(mid, lid) {
    const m = getMod(mid), l = m && m.lessons.find(x => x.id === lid); if (!l) return notFound();
    S.last = { m: mid, l: lid }; save();
    const idx = m.lessons.indexOf(l), next = m.lessons[idx + 1], prev = m.lessons[idx - 1];
    const k = lk(mid, lid), src = `audio/m${pad(mid)}-l${pad(lid)}.mp3`;
    const nextHref = next ? `#/m/${mid}/l/${next.id}` : `#/m/${mid}/quiz`;
    app.innerHTML = `
      <div class="lesson-head">
        <a class="crumb" href="#/m/${mid}">← Module ${mid}: ${esc(m.title)}</a>
        <h1>${esc(l.title)}</h1>
        <div class="meta"><span class="pill">Lesson ${idx + 1} of ${m.lessons.length}</span><span class="pill">${l.minutes} min</span>${S.done[k] ? '<span class="pill" style="background:rgba(31,157,85,.15);color:var(--ok)">✓ Completed</span>' : ''}</div>
      </div>
      <div class="card player" id="player">
        <button class="play" id="playBtn" aria-label="Play">▶</button>
        <div class="track"><div class="label" id="audioLabel">🎧 Listen to this lesson</div><input type="range" id="seek" min="0" max="100" value="0" step="0.1" aria-label="Seek">
          <div class="times"><span id="cur">0:00</span><span id="dur">–:––</span></div></div>
        <button class="skip" id="back15" aria-label="Back 15 seconds">↺15</button>
        <button class="speed" id="speedBtn">${S.speed}×</button>
      </div>
      <article class="lesson">${l.body}</article>
      <h2>Key terms <span class="small muted">· tap to reveal</span></h2>
      <div class="terms">${l.keyTerms.map(([t, d]) => `<button class="term">${esc(t)}<small hidden>${esc(d)}</small></button>`).join('')}</div>
      <h2>Try it in the system</h2>
      <div class="card">${l.tryIt.map((t, i) => `<label class="check"><input type="checkbox" data-c="${k}t${i}" ${S.checks[`${k}t${i}`] ? 'checked' : ''}><span>${esc(t.task)}</span></label>`).join('')}</div>
      <div class="actions">${prev ? `<a class="btn ghost" href="#/m/${mid}/l/${prev.id}">← Previous</a>` : ''}</div>
      <div class="sticky-cta"><div class="inner"><button class="btn" id="doneBtn">${S.done[k] ? (next ? 'Next lesson →' : 'Take the quiz →') : (next ? '✓ Complete & continue' : '✓ Complete & take quiz')}</button></div></div>`;

    $$('.term').forEach(b => b.onclick = () => { const s = b.querySelector('small'); s.hidden = !s.hidden; b.classList.toggle('open', !s.hidden); });
    $$('.check input').forEach(c => c.onchange = () => { S.checks[c.dataset.c] = c.checked; save(); if (c.checked) toast('Nice, task done ✓'); });
    $('#doneBtn').onclick = () => {
      if (!S.done[k]) {
        S.done[k] = true; save(); markActive();
        if (modStats(m).pct === 100) { confetti(); toast(`🏁 Module ${mid} complete!`); } else toast('Lesson complete ✓');
        checkBadges();
      }
      location.hash = nextHref;
    };
    setupAudio(src, l, m);
  }

  function setupAudio(src, l, m) {
    const key = `${m.id}-${l.id}`;
    const a = new Audio(); a.preload = 'metadata'; let mode = 'audio', speaking = false, saveT = 0;
    const btn = $('#playBtn'), seek = $('#seek'), cur = $('#cur'), dur = $('#dur'), spd = $('#speedBtn');
    const speeds = [0.8, 1, 1.25, 1.5, 1.75];
    const setIcon = p => { btn.textContent = p ? '❚❚' : '▶'; btn.setAttribute('aria-label', p ? 'Pause' : 'Play'); };
    const fallback = () => {
      mode = 'tts'; $('#back15').hidden = true; seek.disabled = true; dur.textContent = '';
      $('#audioLabel').textContent = 'Device voice (audio file not found)';
      if (!('speechSynthesis' in window)) { $('#player').hidden = true; }
    };
    fetch(src, { method: 'HEAD' }).then(r => { if (!r.ok) fallback(); else a.src = src; }).catch(fallback);
    a.onloadedmetadata = () => { dur.textContent = fmt(a.duration); if (S.audio[key] && S.audio[key] < a.duration - 5) { a.currentTime = S.audio[key]; $('#audioLabel').textContent = `Resume from ${fmt(S.audio[key])}`; } };
    a.ontimeupdate = () => {
      if (!a.duration) return; seek.value = a.currentTime / a.duration * 100; seek.style.setProperty('--v', seek.value + '%'); cur.textContent = fmt(a.currentTime);
      if (Date.now() - saveT > 4000) { S.audio[key] = a.currentTime; save(); saveT = Date.now(); }
    };
    a.onended = () => { setIcon(false); delete S.audio[key]; save(); toast('Finished listening 🎧'); };
    a.onplay = () => { setIcon(true); markActive(); $('#audioLabel').textContent = '🎧 Playing'; };
    a.onpause = () => setIcon(false);
    seek.oninput = () => { seek.style.setProperty('--v', seek.value + '%'); if (a.duration) a.currentTime = seek.value / 100 * a.duration; };
    $('#back15').onclick = () => { a.currentTime = Math.max(0, a.currentTime - 15); };
    a.playbackRate = S.speed;
    spd.onclick = () => { S.speed = speeds[(speeds.indexOf(S.speed) + 1) % speeds.length]; a.playbackRate = S.speed; spd.textContent = S.speed + '×'; save(); if (speaking) { speechSynthesis.cancel(); speak(); } };
    const speak = () => {
      const u = new SpeechSynthesisUtterance(l.narration); u.lang = 'en-GB'; u.rate = S.speed;
      const v = speechSynthesis.getVoices().find(v => v.lang === 'en-GB'); if (v) u.voice = v;
      u.onend = () => { speaking = false; setIcon(false); };
      speechSynthesis.speak(u); speaking = true; setIcon(true); markActive();
    };
    btn.onclick = () => {
      if (mode === 'tts') { if (speaking) { speechSynthesis.cancel(); speaking = false; setIcon(false); } else speak(); return; }
      a.paused ? a.play().catch(() => fallback()) : a.pause();
    };
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: l.title, artist: `Module ${m.id}: ${m.title}`, album: course.title, artwork: [{ src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png' }] });
      navigator.mediaSession.setActionHandler('seekbackward', () => { a.currentTime = Math.max(0, a.currentTime - 15); });
      navigator.mediaSession.setActionHandler('seekforward', () => { a.currentTime = Math.min(a.duration || 0, a.currentTime + 15); });
    }
    audioCleanup = () => { if (a.currentTime && !a.ended) { S.audio[key] = a.currentTime; save(); } a.pause(); a.src = ''; if ('speechSynthesis' in window) speechSynthesis.cancel(); };
  }

  function quizView(mid, quick = false) {
    let qs, title, back;
    if (quick) {
      const pool = mods.flatMap(m => m.quiz.map(q => ({ ...q, mid: m.id })));
      qs = shuffle(pool).slice(0, 5); title = 'Quick quiz'; back = '#/';
    } else {
      const m = getMod(mid); if (!m) return notFound();
      qs = m.quiz.map(q => ({ ...q, mid })); title = `Module ${mid} quiz`; back = `#/m/${mid}`;
    }
    let i = 0; const res = [];
    const render = () => {
      if (i >= qs.length) return results();
      const q = qs[i];
      app.innerHTML = `<a class="crumb" href="${back}">← Back</a>
        <div class="row"><strong>${title}</strong><span class="small muted">${i + 1} / ${qs.length}</span></div>
        <div class="qprog">${qs.map((_, n) => `<i class="${n < i ? (res[n] ? 'ok' : 'ko') : n === i ? 'cur' : ''}"></i>`).join('')}</div>
        ${quick ? `<span class="pill">Module ${q.mid}</span>` : ''}
        <h2 style="margin-top:.6em">${esc(q.q)}</h2>
        <div>${q.options.map((o, n) => `<button class="opt" data-n="${n}"><b>${'ABCD'[n]}</b><span>${esc(o)}</span></button>`).join('')}</div>
        <div id="fb"></div>`;
      $$('.opt').forEach(b => b.onclick = () => {
        const n = +b.dataset.n, ok = n === q.answer; res[i] = ok;
        $$('.opt').forEach(x => { x.disabled = true; if (+x.dataset.n === q.answer) x.classList.add('correct'); });
        if (!ok) b.classList.add('wrong'); else if (navigator.vibrate) navigator.vibrate(15);
        $('#fb').innerHTML = `<div class="feedback ${ok ? 'ok' : 'ko'}"><strong>${ok ? '✓ Correct!' : '✗ Not quite.'}</strong> ${esc(q.explain)}</div>
          <div class="sticky-cta"><div class="inner"><button class="btn" id="nx">${i + 1 < qs.length ? 'Next question →' : 'See my score →'}</button></div></div>`;
        $('#nx').onclick = () => { i++; render(); window.scrollTo(0, 0); };
      });
    };
    const results = () => {
      const score = res.filter(Boolean).length, pct = Math.round(score / qs.length * 100);
      markActive();
      if (!quick) { const prevBest = S.quiz[mid] ?? -1; if (score > prevBest) S.quiz[mid] = score; save(); }
      if (pct >= 76) confetti();
      const wrong = qs.filter((_, n) => !res[n]);
      app.innerHTML = `<a class="crumb" href="${back}">← Back</a>
        <div class="card" style="text-align:center">
          <div class="kicker muted">${title}</div>
          <div class="score-big">${pct}%</div>
          <div>${score} of ${qs.length} correct</div>
          <p class="muted">${pct === 100 ? 'Perfect score! 💯' : pct >= 76 ? 'Above the C_TS452 pass mark. Well done 🎉' : 'Below the 76% pass mark. Review and try again 💪'}</p>
          ${!quick ? `<span class="pill">Best: ${Math.round((S.quiz[mid] ?? 0) / qs.length * 100)}%</span>` : ''}
        </div>
        ${wrong.length ? `<h2>Review your mistakes</h2>${wrong.map(q => `<div class="review-item"><strong>${esc(q.q)}</strong><br><span style="color:var(--ok)">✓ ${esc(q.options[q.answer])}</span><br><span class="small muted">${esc(q.explain)}</span></div>`).join('')}` : ''}
        <div class="actions"><button class="btn" id="again">↻ ${quick ? 'New quick quiz' : 'Try again'}</button>
        ${quick ? '<a class="btn ghost" href="#/review">Review cards</a>' : `<a class="btn ghost" href="#/m/${mid}/cards">Study flashcards</a>`}</div>`;
      $('#again').onclick = () => quick ? quizView(0, true) : (i = 0, res.length = 0, render());
      checkBadges();
    };
    render();
  }

  function cardsView(mid) {
    const global = mid == null; const m = global ? null : getMod(mid);
    if (!global && !m) return notFound();
    const pool = global ? allCards() : m.flashcards.map((c, i) => ({ id: `${mid}-${i}`, m, f: c[0], b: c[1] }));
    const back = global ? '#/' : `#/m/${mid}`;
    const deck = shuffle(pool.slice()).sort((a, b) => (S.boxes[a.id] ?? 0) - (S.boxes[b.id] ?? 0)).slice(0, 20);
    let i = 0, known = 0;
    const boxBar = () => { const c = [0, 0, 0, 0, 0]; pool.forEach(p => c[Math.min(4, S.boxes[p.id] ?? 0)]++);
      return `<div class="boxes">${['New', 'Learning', 'Familiar', 'Known', 'Mastered'].map((n, j) => `<div><b style="background:${j ? `hsl(${170 + j * 8} 70% ${55 - j * 5}%)` : 'var(--line)'};opacity:${c[j] ? 1 : .3}"></b>${n}<br><strong style="color:var(--ink)">${c[j]}</strong></div>`).join('')}</div>`; };
    const render = () => {
      if (i >= deck.length) return finish();
      const c = deck[i];
      app.innerHTML = `<a class="crumb" href="${back}">← Back</a>
        <div class="row"><h1 style="margin:0">${global ? 'Review' : `Module ${mid} cards`}</h1><span class="small muted">${i + 1} / ${deck.length}</span></div>
        ${boxBar()}
        <div class="flip" id="flip"><div class="flip-inner" id="fi">
          <div class="face front"><small>${global ? `Module ${c.m.id}` : 'Question'}</small>${esc(c.f)}<span class="small muted" style="position:absolute;bottom:14px;font-weight:600">Tap to flip</span></div>
          <div class="face back"><small>Answer</small>${esc(c.b)}</div></div></div>
        <div class="rate" id="rate" style="visibility:hidden"><button class="btn again" id="again">✗ Again</button><button class="btn" id="good">✓ Got it</button></div>
        <p class="small muted" style="text-align:center">Swipe left = again · right = got it</p>`;
      const flip = $('#flip'), fi = $('#fi');
      const show = () => { flip.classList.add('flipped'); $('#rate').style.visibility = 'visible'; };
      fi.onclick = () => { flip.classList.contains('flipped') ? flip.classList.remove('flipped') : show(); };
      const rate = ok => {
        S.boxes[c.id] = ok ? Math.min(4, (S.boxes[c.id] ?? 0) + 1) : 0; if (ok) known++; save();
        fi.classList.add(ok ? 'swipe-out-r' : 'swipe-out-l');
        setTimeout(() => { i++; render(); }, 260);
      };
      $('#again').onclick = () => rate(false); $('#good').onclick = () => rate(true);
      let sx = null, dx = 0;
      flip.addEventListener('touchstart', e => { sx = e.touches[0].clientX; dx = 0; }, { passive: true });
      flip.addEventListener('touchmove', e => { if (sx == null) return; dx = e.touches[0].clientX - sx; fi.style.transform = `${flip.classList.contains('flipped') ? 'rotateY(180deg) ' : ''}translateX(${dx}px) rotate(${dx / 20}deg)`; }, { passive: true });
      flip.addEventListener('touchend', () => { fi.style.transform = ''; if (Math.abs(dx) > 80) { if (!flip.classList.contains('flipped')) show(); rate(dx > 0); } sx = null; });
    };
    const finish = () => {
      markActive(); confetti(); checkBadges();
      app.innerHTML = `<a class="crumb" href="${back}">← Back</a>
        <div class="card" style="text-align:center"><div style="font-size:3rem">🧠</div><h1>Session complete</h1>
        <p>${known} of ${deck.length} known this round</p>${boxBar()}</div>
        <div class="actions"><button class="btn" id="more">↻ Another round</button><a class="btn ghost" href="${global ? '#/quick' : `#/m/${mid}/quiz`}">Take a quiz</a></div>`;
      $('#more').onclick = () => cardsView(mid);
    };
    render();
  }

  function glossaryView() {
    const items = mods.flatMap(m => m.lessons.flatMap(l => l.keyTerms.map(([t, d]) => ({ t, d, m: m.id, l: l.id }))))
      .sort((a, b) => a.t.localeCompare(b.t, 'en', { sensitivity: 'base' }));
    app.innerHTML = `<h1>Glossary</h1><p class="muted">${items.length} key terms from all modules</p>
      <input class="search" id="q" type="search" placeholder="Search terms, codes, definitions… e.g. MIGO" autocomplete="off">
      <div class="card" id="list" style="padding-top:4px;padding-bottom:4px"></div>`;
    const list = $('#list');
    const hl = (s, q) => q ? esc(s).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>') : esc(s);
    const draw = q => {
      const f = q ? items.filter(x => (x.t + ' ' + x.d).toLowerCase().includes(q.toLowerCase())) : items;
      list.innerHTML = f.length ? f.map(x => `<div class="gl-item"><b>${hl(x.t, q)}</b><span>${hl(x.d, q)}</span><br><a href="#/m/${x.m}/l/${x.l}">Lesson ${x.m}.${x.l} →</a></div>`).join('') : '<p class="muted">No match.</p>';
    };
    $('#q').oninput = e => draw(e.target.value.trim()); draw('');
  }

  function statsView() {
    const t = totals(); const set = new Set(S.days);
    const days = Array.from({ length: 7 }, (_, n) => { const d = new Date(); d.setDate(d.getDate() - 6 + n); return d; });
    app.innerHTML = `<h1>Your progress</h1>
      <div class="stats">
        <div class="stat"><b>🔥 ${streak()}</b><span>Day streak</span></div>
        <div class="stat"><b>${t.done}/${t.total}</b><span>Lessons</span></div>
        <div class="stat"><b>${Math.round(t.minutesDone / 6) / 10} h</b><span>Studied</span></div>
        <div class="stat"><b>${t.mastered}/${t.cards}</b><span>Cards mastered</span></div>
        <div class="stat"><b>${t.quizAvg ?? '–'}${t.quizAvg != null ? '%' : ''}</b><span>Quiz average</span></div>
        <div class="stat"><b>${S.days.length}</b><span>Active days</span></div>
      </div>
      <div class="card"><strong>Last 7 days</strong><div class="week">${days.map(d => `<div><b class="${set.has(today(d)) ? 'on' : ''}"></b>${d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}</div>`).join('')}</div></div>
      <h2>Badges</h2>
      <div class="card badges">${BADGES.map(b => `<div class="badge ${S.badges.includes(b.id) ? 'on' : ''}"><i>${b.icon}</i>${b.name}</div>`).join('')}</div>
      <h2>Exam readiness</h2>
      <div class="card">${mods.map(m => { const s = modStats(m), q = S.quiz[m.id], qp = q != null ? Math.round(q / m.quiz.length * 100) : null;
        return `<div style="margin:10px 0"><div class="row small"><a href="#/m/${m.id}" style="color:var(--ink);text-decoration:none;font-weight:600">${m.id}. ${esc(m.title)}</a><span class="${qp != null && qp >= 76 ? '' : 'muted'}">${qp != null ? `Quiz ${qp}%` : 'No quiz'}</span></div><div class="bar" style="margin-top:4px;height:6px"><i style="width:${s.pct}%"></i></div></div>`; }).join('')}</div>
      <div class="actions"><button class="btn ghost" id="reset">Reset all progress</button></div>`;
    let armed = false;
    $('#reset').onclick = e => {
      if (!armed) { armed = true; e.target.textContent = 'Tap again to confirm reset'; setTimeout(() => { armed = false; if (e.target.isConnected) e.target.textContent = 'Reset all progress'; }, 3000); return; }
      Object.assign(S, { done: {}, quiz: {}, checks: {}, boxes: {}, days: [], last: null, audio: {}, badges: [] }); save(); renderStreak(); toast('Progress reset'); statsView();
    };
  }

  function notesView(mid) {
    const m = getMod(mid); if (!m) return notFound();
    const n = m.trainerNotes;
    app.innerHTML = `<a class="crumb" href="#/m/${mid}">← Module ${mid}</a><h1>🎤 Trainer notes</h1><p class="muted">${esc(m.title)}</p>
      <div class="card"><h3 style="margin-top:0">How to teach it</h3><ul>${n.howToTeach.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="card"><h3 style="margin-top:0">Common learner mistakes</h3><ul>${n.commonMistakes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="card"><h3 style="margin-top:0">Demo script</h3>${n.demoScript.map((x, i) => `<label class="check"><input type="checkbox" data-c="demo${mid}-${i}" ${S.checks[`demo${mid}-${i}`] ? 'checked' : ''}><span>${esc(x)}</span></label>`).join('')}</div>`;
    $$('.check input').forEach(c => c.onchange = () => { S.checks[c.dataset.c] = c.checked; save(); });
  }

  function notFound() { app.innerHTML = `<h1>Not found</h1><p><a href="#/">Back home</a></p>`; }

  // ---------- reading progress ----------
  addEventListener('scroll', () => {
    const bar = $('#readbar'); if (!location.hash.includes('/l/')) { bar.style.width = 0; return; }
    const h = document.documentElement.scrollHeight - innerHeight; bar.style.width = (h > 0 ? scrollY / h * 100 : 0) + '%';
  }, { passive: true });

  // ---------- router ----------
  function route() {
    if (audioCleanup) { audioCleanup(); audioCleanup = null; }
    $('#readbar').style.width = 0;
    const p = location.hash.replace(/^#\/?/, '').split('/');
    const tab = { '': 'home', modules: 'modules', m: 'modules', review: 'review', glossary: 'glossary', stats: 'stats', quick: 'home' }[p[0]] || 'home';
    $$('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    app.style.animation = 'none'; void app.offsetWidth; app.style.animation = '';
    if (p[0] === 'm' && p[1]) {
      const m = +p[1];
      if (p[2] === 'l') lessonView(m, +p[3]);
      else if (p[2] === 'quiz') quizView(m);
      else if (p[2] === 'cards') cardsView(m);
      else if (p[2] === 'notes') notesView(m);
      else moduleView(m);
    } else if (p[0] === 'modules') modulesView();
    else if (p[0] === 'review') cardsView(null);
    else if (p[0] === 'quick') quizView(0, true);
    else if (p[0] === 'glossary') glossaryView();
    else if (p[0] === 'stats') statsView();
    else home();
    window.scrollTo(0, 0);
  }

  async function init() {
    app.innerHTML = '<p class="muted">Loading…</p>';
    course = await (await fetch('content/course.json')).json();
    mods = (await Promise.all(course.modules.filter(m => m.file).map(m => fetch('content/' + m.file).then(r => r.json())))).sort((a, b) => a.id - b.id);
    renderStreak();
    addEventListener('hashchange', route);
    route();
  }
  init().catch(() => { app.innerHTML = '<h1>Offline</h1><p class="muted">Couldn\'t load the course. Check your connection and reload.</p>'; });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
