(() => {
  const app = document.getElementById('app');
  const cache = {};
  let course;

  // ---------- storage (safe) ----------
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const progress = store.get('sapmm-progress', {});
  const save = () => store.set('sapmm-progress', progress);
  const key = (m, l) => `m${m}l${l}`;
  const pad = n => String(n).padStart(2, '0');

  // ---------- theme ----------
  const setTheme = t => { document.documentElement.dataset.theme = t; store.set('sapmm-theme', t); };
  setTheme(store.get('sapmm-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  document.getElementById('themeBtn').onclick = () =>
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

  // ---------- data ----------
  const getJSON = async f => cache[f] ??= await (await fetch('content/' + f)).json();
  const getModule = async id => {
    const m = course.modules.find(x => x.id === id);
    return m && m.file ? getJSON(m.file) : null;
  };
  const moduleStats = mod => {
    const total = mod.lessons.length;
    const done = mod.lessons.filter(l => progress[key(mod.id, l.id)]).length;
    return { done, total, pct: Math.round(done / total * 100) };
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- views ----------
  async function home() {
    const loaded = await Promise.all(course.modules.map(m => m.file ? getJSON(m.file) : null));
    let done = 0, total = 0;
    loaded.forEach(m => { if (m) { const s = moduleStats(m); done += s.done; total += s.total; } });
    app.innerHTML = `
      <h1>${esc(course.title)}</h1>
      <p class="muted">${esc(course.subtitle)} · ${esc(course.author)}</p>
      ${total ? `<div class="card"><div class="row"><strong>Your progress</strong><span>${done}/${total} lessons</span></div>
      <div class="bar"><i style="width:${Math.round(done / total * 100)}%"></i></div></div>` : ''}
      <h2>Modules</h2>
      ${course.modules.map((m, i) => {
        const data = loaded[i];
        if (!data) return `<div class="card locked"><div class="row"><span><strong>${m.id}.</strong> ${esc(m.title)}</span><span class="pill">${esc(m.week)} · soon</span></div></div>`;
        const s = moduleStats(data);
        return `<a class="card" href="#/m/${m.id}"><div class="row"><span><strong>${m.id}.</strong> ${esc(m.title)}</span><span class="pill">${esc(m.week)}</span></div>
          <div class="bar"><i style="width:${s.pct}%"></i></div></a>`;
      }).join('')}`;
  }

  async function moduleView(id) {
    const mod = await getModule(id);
    if (!mod) return notFound();
    const s = moduleStats(mod);
    const best = progress[`m${id}quiz`];
    app.innerHTML = `
      <div class="crumbs"><a href="#/">← All modules</a></div>
      <h1>Module ${mod.id}: ${esc(mod.title)}</h1>
      <p class="muted">${esc(mod.intro)}</p>
      <div class="card"><strong>Objectives</strong><ul>${mod.objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
      <div class="row"><span class="muted">${s.done}/${s.total} lessons done</span></div><div class="bar"><i style="width:${s.pct}%"></i></div></div>
      <h2>Lessons</h2>
      ${mod.lessons.map(l => `<a class="card" href="#/m/${id}/l/${l.id}"><div class="row">
        <span>${id}.${l.id} ${esc(l.title)}</span>
        ${progress[key(id, l.id)] ? '<span class="done">✓</span>' : `<span class="pill">${l.minutes} min</span>`}</div></a>`).join('')}
      <h2>Practice</h2>
      <a class="card" href="#/m/${id}/cards"><div class="row"><span>Flashcards</span><span class="pill">${mod.flashcards.length} cards</span></div></a>
      <a class="card" href="#/m/${id}/quiz"><div class="row"><span>Quiz</span><span class="pill">${best != null ? `Best ${best}/${mod.quiz.length}` : mod.quiz.length + ' questions'}</span></div></a>
      <a class="card" href="#/m/${id}/notes"><div class="row"><span>Trainer notes</span><span class="pill">Teaching kit</span></div></a>`;
  }

  async function lessonView(mid, lid) {
    const mod = await getModule(mid);
    const l = mod && mod.lessons.find(x => x.id === lid);
    if (!l) return notFound();
    const idx = mod.lessons.indexOf(l);
    const prev = mod.lessons[idx - 1], next = mod.lessons[idx + 1];
    const k = key(mid, lid);
    const src = `audio/m${pad(mid)}-l${pad(lid)}.mp3`;
    app.innerHTML = `
      <div class="crumbs"><a href="#/m/${mid}">← Module ${mid}</a></div>
      <h1>${mid}.${lid} ${esc(l.title)}</h1>
      <p class="muted">${l.minutes} min</p>
      <div class="card audio" id="audioBox">
        <audio id="aud" controls preload="none" src="${src}"></audio>
        <span class="muted" id="audMsg" hidden>Audio not generated yet.</span>
        <button class="btn ghost" id="ttsBtn" hidden>▶ Read aloud (device voice)</button>
      </div>
      <article class="lesson">${l.body}</article>
      <h2>Key terms</h2>
      <dl class="card terms">${l.keyTerms.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
      <h2>Try it in the system</h2>
      <ol class="card try">${l.tryIt.map(t => `<li>${esc(t.task)}</li>`).join('')}</ol>
      <div class="actions"><button class="btn" id="doneBtn">${progress[k] ? '✓ Completed' : 'Mark as complete'}</button></div>
      <div class="nav">
        ${prev ? `<a class="btn ghost" href="#/m/${mid}/l/${prev.id}">← Previous</a>` : '<span></span>'}
        ${next ? `<a class="btn ghost" href="#/m/${mid}/l/${next.id}">Next →</a>` : `<a class="btn ghost" href="#/m/${mid}/quiz">Quiz →</a>`}
      </div>`;

    const aud = document.getElementById('aud');
    const fallback = () => {
      aud.hidden = true;
      document.getElementById('audMsg').hidden = false;
      if ('speechSynthesis' in window) {
        const b = document.getElementById('ttsBtn');
        b.hidden = false;
        b.onclick = () => {
          if (speechSynthesis.speaking) { speechSynthesis.cancel(); b.textContent = '▶ Read aloud (device voice)'; return; }
          const u = new SpeechSynthesisUtterance(l.narration);
          u.lang = 'en-GB';
          const v = speechSynthesis.getVoices().find(v => v.lang === 'en-GB');
          if (v) u.voice = v;
          u.onend = () => b.textContent = '▶ Read aloud (device voice)';
          speechSynthesis.speak(u);
          b.textContent = '■ Stop';
        };
      }
    };
    fetch(src, { method: 'HEAD' }).then(r => { if (!r.ok) fallback(); }).catch(fallback);

    document.getElementById('doneBtn').onclick = e => {
      progress[k] = !progress[k]; save();
      e.target.textContent = progress[k] ? '✓ Completed' : 'Mark as complete';
    };
  }

  async function quizView(mid) {
    const mod = await getModule(mid);
    if (!mod) return notFound();
    let i = 0, score = 0;
    const render = () => {
      if (i >= mod.quiz.length) {
        const best = Math.max(score, progress[`m${mid}quiz`] ?? 0);
        progress[`m${mid}quiz`] = best; save();
        app.innerHTML = `<div class="crumbs"><a href="#/m/${mid}">← Module ${mid}</a></div>
          <h1>Score: ${score}/${mod.quiz.length}</h1>
          <p class="muted">Best: ${best}/${mod.quiz.length}. C_TS452 pass mark is 76%.</p>
          <div class="actions"><button class="btn" id="again">Try again</button><a class="btn ghost" href="#/m/${mid}">Back to module</a></div>`;
        document.getElementById('again').onclick = () => { i = 0; score = 0; render(); };
        return;
      }
      const q = mod.quiz[i];
      app.innerHTML = `<div class="crumbs"><a href="#/m/${mid}">← Module ${mid}</a></div>
        <p class="muted">Question ${i + 1} of ${mod.quiz.length}</p>
        <h2>${esc(q.q)}</h2>
        <div id="opts">${q.options.map((o, n) => `<button class="opt" data-n="${n}">${esc(o)}</button>`).join('')}</div>
        <div id="fb"></div>`;
      document.querySelectorAll('.opt').forEach(b => b.onclick = () => {
        const n = +b.dataset.n;
        document.querySelectorAll('.opt').forEach(x => { x.disabled = true; if (+x.dataset.n === q.answer) x.classList.add('correct'); });
        if (n === q.answer) score++; else b.classList.add('wrong');
        document.getElementById('fb').innerHTML = `<p class="tip">${esc(q.explain)}</p>
          <div class="actions"><button class="btn" id="nx">${i + 1 < mod.quiz.length ? 'Next' : 'See score'}</button></div>`;
        document.getElementById('nx').onclick = () => { i++; render(); };
      });
    };
    render();
  }

  async function cardsView(mid) {
    const mod = await getModule(mid);
    if (!mod) return notFound();
    let deck = [...mod.flashcards].sort(() => Math.random() - .5), i = 0, flipped = false;
    const render = () => {
      const [f, b] = deck[i];
      app.innerHTML = `<div class="crumbs"><a href="#/m/${mid}">← Module ${mid}</a></div>
        <p class="muted">Card ${i + 1} of ${deck.length} · tap to flip</p>
        <div class="card flash ${flipped ? 'back' : ''}" id="fc">${esc(flipped ? b : f)}</div>
        <div class="nav"><button class="btn ghost" id="pv" ${i ? '' : 'disabled'}>← Prev</button>
        <button class="btn ghost" id="sh">Shuffle</button>
        <button class="btn ghost" id="nx" ${i < deck.length - 1 ? '' : 'disabled'}>Next →</button></div>`;
      document.getElementById('fc').onclick = () => { flipped = !flipped; render(); };
      document.getElementById('pv').onclick = () => { i--; flipped = false; render(); };
      document.getElementById('nx').onclick = () => { i++; flipped = false; render(); };
      document.getElementById('sh').onclick = () => { deck.sort(() => Math.random() - .5); i = 0; flipped = false; render(); };
    };
    render();
  }

  async function notesView(mid) {
    const mod = await getModule(mid);
    if (!mod) return notFound();
    const n = mod.trainerNotes;
    const list = a => `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    app.innerHTML = `<div class="crumbs"><a href="#/m/${mid}">← Module ${mid}</a></div>
      <h1>Trainer notes: Module ${mid}</h1>
      <div class="card"><h3>How to teach it</h3>${list(n.howToTeach)}</div>
      <div class="card"><h3>Common learner mistakes</h3>${list(n.commonMistakes)}</div>
      <div class="card"><h3>Demo script</h3><ol>${n.demoScript.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>`;
  }

  function notFound() { app.innerHTML = `<h1>Not found</h1><p><a href="#/">Back to modules</a></p>`; }

  // ---------- router ----------
  async function route() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    course ??= await getJSON('course.json');
    const p = location.hash.replace(/^#\/?/, '').split('/');
    if (p[0] === 'm' && p[1]) {
      const m = +p[1];
      if (p[2] === 'l') await lessonView(m, +p[3]);
      else if (p[2] === 'quiz') await quizView(m);
      else if (p[2] === 'cards') await cardsView(m);
      else if (p[2] === 'notes') await notesView(m);
      else await moduleView(m);
    } else await home();
    window.scrollTo(0, 0);
  }
  addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
