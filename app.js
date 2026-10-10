/* 2026 어린이 안전골든벨 트레이닝 - vanilla JS */
(function () {
  'use strict';

  var DATA = Array.isArray(window.QUIZ_DATA) ? window.QUIZ_DATA : [];
  var BY_ID = {};
  DATA.forEach(function (q) { BY_ID[q.id] = q; });
  var SETS = [];
  DATA.forEach(function (q) { if (SETS.indexOf(q.set) < 0) SETS.push(q.set); });
  var TYPES = [['mc', '객관식'], ['ox', 'OX'], ['sa', '주관식']];
  var TYPE_NAME = { mc: '객관식', ox: 'OX', sa: '주관식' };
  var NUM_KO = ['일번', '이번', '삼번', '사번', '오번'];
  var TIMER = { mc: 25, ox: 10, sa: 15 };
  var SURVIVAL_N = 50;

  var app = document.getElementById('app');
  var card = document.getElementById('card');

  /* ---------- utils ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function lsGet(k, def) {
    try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function $(sel) { return app.querySelector(sel); }
  function on(sel, ev, fn) { var el = $(sel); if (el) el.addEventListener(ev, fn); return el; }
  function setWide(w) {
    card.classList.toggle('max-w-xl', !w);
    card.classList.toggle('max-w-2xl', !!w);
  }

  /* ---------- persistent state ---------- */
  var K = { settings: 'gb26_settings', wrong: 'gb26_wrong', stats: 'gb26_stats' };
  var settings = lsGet(K.settings, null) || {};
  if (typeof settings.sfx !== 'boolean') settings.sfx = true;
  if (typeof settings.tts !== 'boolean') settings.tts = true;
  if (typeof settings.autoNext !== 'boolean') settings.autoNext = false;
  if (!Array.isArray(settings.sets)) settings.sets = SETS.slice();
  settings.sets = settings.sets.filter(function (s) { return SETS.indexOf(s) >= 0; });
  if (!Array.isArray(settings.types)) settings.types = ['mc', 'ox', 'sa'];
  if (typeof settings.filterOpen !== 'boolean') settings.filterOpen = false;
  function saveSettings() { lsSet(K.settings, settings); }

  var wrongNote = lsGet(K.wrong, null);
  if (!wrongNote || typeof wrongNote !== 'object') wrongNote = {};
  Object.keys(wrongNote).forEach(function (id) { if (!BY_ID[id]) delete wrongNote[id]; });
  function saveWrong() { lsSet(K.wrong, wrongNote); }
  function wrongCount() { return Object.keys(wrongNote).length; }

  var stats = lsGet(K.stats, null);
  if (!stats || typeof stats !== 'object') stats = {};
  if (!stats.sets || typeof stats.sets !== 'object') stats.sets = {};
  if (!stats.survival || typeof stats.survival !== 'object') stats.survival = { best: 0, clears: 0, plays: 0 };
  function saveStats() { lsSet(K.stats, stats); }

  function filtered() {
    return DATA.filter(function (q) {
      return settings.sets.indexOf(q.set) >= 0 && settings.types.indexOf(q.type) >= 0;
    });
  }

  /* ---------- sound ---------- */
  var actx = null;
  function ctx() {
    if (!actx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { actx = new C(); } catch (e) { return null; }
    }
    if (actx.state === 'suspended') { try { actx.resume(); } catch (e) { /* ignore */ } }
    return actx;
  }
  function playSound(kind) {
    if (!settings.sfx) return;
    var c = ctx(); if (!c) return;
    try {
      var now = c.currentTime;
      if (kind === 'click') {
        var o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(600, now); o.frequency.linearRampToValueAtTime(800, now + 0.08);
        g.gain.setValueAtTime(0.15, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        o.connect(g); g.connect(c.destination); o.start(now); o.stop(now + 0.09);
      } else if (kind === 'correct') {
        [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
          var o2 = c.createOscillator(), g2 = c.createGain(), t = now + i * 0.08;
          o2.type = 'triangle'; o2.frequency.setValueAtTime(f, t);
          g2.gain.setValueAtTime(0.2, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          o2.connect(g2); g2.connect(c.destination); o2.start(t); o2.stop(t + 0.22);
        });
      } else if (kind === 'wrong') {
        var o3 = c.createOscillator(), g3 = c.createGain();
        o3.type = 'sawtooth'; o3.frequency.setValueAtTime(180, now); o3.frequency.linearRampToValueAtTime(140, now + 0.3);
        g3.gain.setValueAtTime(0.15, now); g3.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        o3.connect(g3); g3.connect(c.destination); o3.start(now); o3.stop(now + 0.31);
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------- TTS ---------- */
  var koVoice = null;
  function pickVoice() {
    try {
      var vs = window.speechSynthesis.getVoices() || [];
      koVoice = vs.filter(function (v) { return /ko/i.test(v.lang); })[0] || null;
    } catch (e) { koVoice = null; }
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    try { window.speechSynthesis.onvoiceschanged = pickVoice; } catch (e) { /* ignore */ }
  }
  function stopSpeech() { try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
  function speak(text, cb) {
    var done = false, timer = null;
    function fin() { if (done) return; done = true; clearTimeout(timer); if (cb) cb(); }
    if (!settings.tts || !('speechSynthesis' in window) || !text) { setTimeout(fin, 0); return; }
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; u.rate = 0.95;
      if (koVoice) u.voice = koVoice;
      u.onend = fin; u.onerror = fin;
      timer = setTimeout(fin, Math.max(4000, text.length * 160));
      window.speechSynthesis.speak(u);
    } catch (e) { fin(); }
  }
  function readText(q) {
    var t = q.q.replace(/\(\s*\)|_{2,}/g, ' 빈칸 ');
    if (q.type === 'mc') {
      t += ' ' + q.opts.slice(0, 5).map(function (o, i) { return NUM_KO[i] + ', ' + o + '.'; }).join(' ');
    } else if (q.type === 'ox') {
      t += ' 오, 엑스 중에 고르세요.';
    }
    return t;
  }
  function answerSpeech(q) {
    if (q.type === 'mc') return q.ans.map(function (i) { return NUM_KO[i] + ', ' + q.opts[i]; }).join(', 그리고 ');
    if (q.type === 'ox') return q.ans === 'O' ? '오' : '엑스';
    return q.ans;
  }
  function answerLabel(q) {
    if (q.type === 'mc') return q.ans.map(function (i) { return (i + 1) + '번: ' + q.opts[i]; }).join(' / ');
    if (q.type === 'ox') return q.ans === 'O' ? '⭕ (O)' : '❌ (X)';
    return String(q.ans);
  }

  /* ---------- short answer grading ---------- */
  function norm(s) {
    s = String(s == null ? '' : s).toLowerCase();
    try { return s.replace(/[\s\p{P}\p{S}]/gu, ''); } catch (e) { return s.replace(/[\s.,!?·~'"`()\[\]{}<>\/\\:;\-_=+*&^%$#@|]/g, ''); }
  }
  function answerVariants(ans) {
    var raw = [String(ans)];
    raw.push(String(ans).replace(/\([^)]*\)/g, ''));
    var m = String(ans).match(/\(([^)]*)\)/g);
    if (m) m.forEach(function (p) { raw.push(p.replace(/^\(|\)$/g, '').replace(/^또는\s*/, '')); });
    var out = [];
    raw.forEach(function (r) {
      out.push(r);
      r.split(/[\/,·]/).forEach(function (p) { out.push(p); });
    });
    return out.map(norm).filter(function (s, i, a) { return s && a.indexOf(s) === i; });
  }
  function gradeSA(input, ans) {
    var u = norm(input);
    if (!u) return false;
    return answerVariants(ans).some(function (a) {
      if (u === a) return true;
      if (u.length >= 2 && (a.indexOf(u) >= 0 || u.indexOf(a) >= 0)) return true;
      return false;
    });
  }

  /* ---------- session ---------- */
  var S = null;     // current session
  var token = 0;    // invalidates async callbacks
  var timers = [];
  function clearTimers() { timers.forEach(function (t) { clearTimeout(t); clearInterval(t); }); timers = []; }
  function later(fn, ms) { var my = token; var t = setTimeout(function () { if (my === token) fn(); }, ms); timers.push(t); return t; }

  function newSession(mode, pool) {
    token++; clearTimers(); stopSpeech();
    S = {
      mode: mode, pool: pool.slice(), queue: shuffle(pool), idx: -1, q: null,
      score: 0, combo: 0, solved: 0, correct: 0, hearts: 3, answered: false,
      selected: [], last: null
    };
    if (mode === 'survival') S.queue = S.queue.slice(0, SURVIVAL_N);
    nextQuestion();
  }

  function nextQuestion() {
    token++; clearTimers(); stopSpeech();
    S.idx++;
    if (S.idx >= S.queue.length) {
      if (S.mode === 'infinite' || S.mode === 'auto') {
        S.queue = shuffle(S.pool);
        if (S.queue.length > 1 && S.q && S.queue[0].id === S.q.id) S.queue.push(S.queue.shift());
        S.idx = 0;
      } else if (S.mode === 'survival') { return survivalWin(); }
      else { return finishScreen(); }
    }
    S.q = S.queue[S.idx];
    S.answered = false; S.selected = []; S.last = null; S.revealed = false; S.countdown = null;
    renderQuestion();
    startQuestionFlow();
  }

  /* ---------- recording ---------- */
  function recordResult(q, ok) {
    if (S.mode === 'auto') return null;
    var snap = { wrongEntry: wrongNote[q.id] ? JSON.parse(JSON.stringify(wrongNote[q.id])) : null, removed: false };
    var st = stats.sets[q.set] || (stats.sets[q.set] = { a: 0, c: 0 });
    st.a++; if (ok) st.c++;
    saveStats();
    if (ok) {
      if (S.mode === 'review' && wrongNote[q.id]) {
        wrongNote[q.id].c = (wrongNote[q.id].c || 0) + 1;
        if (wrongNote[q.id].c >= 2) { delete wrongNote[q.id]; snap.removed = true; }
      }
    } else {
      var w = wrongNote[q.id] || { w: 0, c: 0 };
      w.w++; w.c = 0; wrongNote[q.id] = w;
    }
    saveWrong();
    return snap;
  }

  function points(q) { return (q.type === 'sa' ? 15 : 10) + Math.floor(S.combo / 3) * 2; }

  function submit(ok, userText) {
    if (S.answered) return;
    var q = S.q;
    S.answered = true;
    S.solved++;
    var prevCombo = S.combo, gained = 0;
    if (ok) {
      S.combo++; gained = points(q); S.score += gained; S.correct++;
      playSound('correct');
    } else {
      S.combo = 0; playSound('wrong');
      if (S.mode === 'survival') S.hearts--;
    }
    var snap = recordResult(q, ok);
    S.last = { ok: ok, gained: gained, prevCombo: prevCombo, snap: snap, user: userText };
    renderQuestion();
  }

  function selfGrade() {
    var L = S.last, q = S.q;
    if (!L || L.ok || q.type !== 'sa') return;
    playSound('correct');
    L.ok = true; L.self = true;
    S.combo = L.prevCombo + 1;
    L.gained = points(q); S.score += L.gained; S.correct++;
    if (S.mode === 'survival') S.hearts++;
    if (S.mode !== 'auto') {
      var st = stats.sets[q.set]; if (st) { st.c++; saveStats(); }
      // restore wrong note to pre-answer state, then apply "correct" logic
      if (L.snap) {
        if (L.snap.wrongEntry) wrongNote[q.id] = L.snap.wrongEntry; else delete wrongNote[q.id];
        if (S.mode === 'review' && wrongNote[q.id]) {
          wrongNote[q.id].c = (wrongNote[q.id].c || 0) + 1;
          if (wrongNote[q.id].c >= 2) delete wrongNote[q.id];
        }
        saveWrong();
      }
    }
    renderQuestion();
  }

  /* ---------- shared UI pieces ---------- */
  function tagsHtml(q) {
    var h = '<div class="flex flex-wrap gap-1 mb-2 text-xs">';
    h += '<span class="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">' + esc(q.set) + (q.part ? ' · ' + esc(q.part) : '') + '</span>';
    h += '<span class="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">' + TYPE_NAME[q.type] + (q.blank ? ' (빈칸)' : '') + '</span>';
    if (q.note && q.note.indexOf('그림') >= 0) h += '<span class="bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">🖼️ 원본은 그림(안전표지) 문제</span>';
    if (q.note && q.note.indexOf('난이도') >= 0) h += '<span class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">📶 ' + esc(q.note) + '</span>';
    if (wrongNote[q.id]) h += '<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">📕 오답 ' + wrongNote[q.id].w + '회</span>';
    return h + '</div>';
  }
  function expHtml(q, idPrefix) {
    if (!q.exp) return '';
    var e = String(q.exp);
    var id = (idPrefix || 'exp') + q.id;
    if (e.length <= 200) {
      return '<div class="mt-2 text-sm text-gray-700 leading-relaxed whitespace-pre-line">💡 ' + esc(e) + '</div>';
    }
    return '<div class="mt-2 text-sm text-gray-700 leading-relaxed whitespace-pre-line">💡 <span id="' + id + '-s">' + esc(e.slice(0, 200)) + '…</span>' +
      '<span id="' + id + '-f" class="hidden">' + esc(e) + '</span> ' +
      '<button type="button" data-exp="' + id + '" class="exp-toggle text-indigo-600 underline text-xs ml-1">해설 더보기</button></div>';
  }
  function bindExpToggles() {
    Array.prototype.forEach.call(app.querySelectorAll('.exp-toggle'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-exp');
        var s = document.getElementById(id + '-s'), f = document.getElementById(id + '-f');
        var showFull = f.classList.contains('hidden');
        f.classList.toggle('hidden', !showFull); s.classList.toggle('hidden', showFull);
        b.textContent = showFull ? '접기' : '해설 더보기';
      });
    });
  }

  /* ---------- MODE SCREEN ---------- */
  function modeScreen() {
    token++; clearTimers(); stopSpeech();
    S = null; setWide(false);
    var cnt = filtered().length, wc = wrongCount();
    var dis = cnt === 0 ? ' disabled style="opacity:.45"' : '';
    var h = '';
    h += '<p class="text-center text-amber-800 mb-4 text-lg">우리 반 안전 박사에 도전해요! 🧒👧</p>';
    h += '<div class="flex gap-2 justify-center mb-4">' +
      '<button id="tSfx" class="px-3 py-2 rounded-xl text-sm shadow ' + (settings.sfx ? 'bg-amber-400 text-white' : 'bg-gray-200 text-gray-600') + '">🔊 효과음 ' + (settings.sfx ? 'ON' : 'OFF') + '</button>' +
      '<button id="tTts" class="px-3 py-2 rounded-xl text-sm shadow ' + (settings.tts ? 'bg-amber-400 text-white' : 'bg-gray-200 text-gray-600') + '">🗣️ 음성낭독 ' + (settings.tts ? 'ON' : 'OFF') + '</button></div>';

    // filter panel
    h += '<div class="border-2 border-amber-200 rounded-xl mb-4">' +
      '<button id="fToggle" class="w-full flex justify-between items-center p-3 text-amber-900 font-bold">' +
      '<span>🎯 출제 범위 선택</span><span class="text-sm text-amber-700">선택된 문제: <b id="fCount">' + cnt + '</b>문항 ' + (settings.filterOpen ? '▲' : '▼') + '</span></button>';
    if (settings.filterOpen) {
      var allOn = settings.sets.length === SETS.length;
      h += '<div class="px-3 pb-3"><div class="text-xs text-gray-500 mb-1">출제 기관 / 세트</div><div class="flex flex-wrap gap-1 mb-3">';
      h += '<button class="chip-set px-2 py-1 text-sm rounded-full border ' + (allOn ? 'chip-on' : 'chip-off') + '" data-set="__all">전체</button>';
      SETS.forEach(function (s, i) {
        var n = DATA.filter(function (q) { return q.set === s; }).length;
        h += '<button class="chip-set px-2 py-1 text-sm rounded-full border ' + (settings.sets.indexOf(s) >= 0 ? 'chip-on' : 'chip-off') + '" data-set="' + i + '">' + esc(s) + ' <span class="opacity-70 text-xs">' + n + '</span></button>';
      });
      h += '</div><div class="text-xs text-gray-500 mb-1">문제 유형</div><div class="flex flex-wrap gap-1">';
      TYPES.forEach(function (t) {
        h += '<button class="chip-type px-3 py-1 text-sm rounded-full border ' + (settings.types.indexOf(t[0]) >= 0 ? 'chip-on' : 'chip-off') + '" data-type="' + t[0] + '">' + t[1] + '</button>';
      });
      h += '</div>' + (cnt === 0 ? '<p class="text-red-500 text-sm mt-2">⚠️ 선택된 문제가 없어요. 범위를 골라 주세요.</p>' : '') + '</div>';
    }
    h += '</div>';

    function mbtn(id, color, title, sub, extra) {
      return '<button id="' + id + '" class="w-full ' + color + ' text-white text-xl p-5 rounded-xl shadow-lg transition transform hover:-translate-y-1 flex flex-col items-center"' + (extra || '') + '>' +
        '<span>' + title + '</span><span class="text-sm opacity-90 mt-1">' + sub + '</span></button>';
    }
    h += '<div class="grid gap-3">';
    h += mbtn('mInf', 'bg-emerald-500', '🎮 직접 풀기 무한 모드', '혼자서 끝없이 풀어요 · 콤보 보너스!', dis);
    h += mbtn('mAuto', 'bg-indigo-500', '⏱️ 자동 타이머 모드', '읽어주고 시간이 지나면 정답 공개 (교실용)', dis);
    h += mbtn('mSurv', 'bg-rose-500', '🔔 골든벨 서바이벌', SURVIVAL_N + '문제 · 하트 3개 ❤️❤️❤️ 로 끝까지!', dis);
    h += mbtn('mRev', 'bg-orange-500', '📕 오답노트 (' + wc + ')', wc ? '틀린 문제 다시 풀기 · 2번 맞히면 졸업' : '아직 틀린 문제가 없어요', wc ? '' : ' disabled style="opacity:.45"');
    h += '<div class="grid grid-cols-2 gap-3">';
    h += mbtn('mList', 'bg-sky-500', '📚 문제 전체 보기', '검색 · 학습');
    h += mbtn('mRec', 'bg-sky-600', '📊 내 기록', '정답률 · 최고 기록');
    h += '</div></div>';

    h += '<div class="mt-5 bg-amber-100 rounded-xl p-3 text-amber-900 text-xs flex justify-around flex-wrap gap-1 text-center">' +
      '<span>📝 총 ' + DATA.length.toLocaleString() + '문항</span><span>✅ 정답 +10 (주관식 +15)</span><span>🔥 3콤보마다 보너스</span></div>';
    h += '<p class="mt-2 text-center text-xs text-gray-400 hidden md:block">⌨️ 1~5 선택 · O/X · Enter 제출/다음 · Space 다시듣기 · Esc 그만하기</p>';
    app.innerHTML = h;

    on('#tSfx', 'click', function () { settings.sfx = !settings.sfx; saveSettings(); playSound('click'); modeScreen(); });
    on('#tTts', 'click', function () {
      settings.tts = !settings.tts; saveSettings(); playSound('click');
      if (settings.tts) speak('음성 낭독을 켰어요.'); else stopSpeech();
      modeScreen();
    });
    on('#fToggle', 'click', function () { settings.filterOpen = !settings.filterOpen; saveSettings(); playSound('click'); modeScreen(); });
    Array.prototype.forEach.call(app.querySelectorAll('.chip-set'), function (b) {
      b.addEventListener('click', function () {
        playSound('click');
        var v = b.getAttribute('data-set');
        if (v === '__all') settings.sets = settings.sets.length === SETS.length ? [] : SETS.slice();
        else {
          var s = SETS[+v], i = settings.sets.indexOf(s);
          if (i >= 0) settings.sets.splice(i, 1); else settings.sets.push(s);
        }
        saveSettings(); modeScreen();
      });
    });
    Array.prototype.forEach.call(app.querySelectorAll('.chip-type'), function (b) {
      b.addEventListener('click', function () {
        playSound('click');
        var t = b.getAttribute('data-type'), i = settings.types.indexOf(t);
        if (i >= 0) settings.types.splice(i, 1); else settings.types.push(t);
        saveSettings(); modeScreen();
      });
    });
    on('#mInf', 'click', function () { playSound('click'); newSession('infinite', filtered()); });
    on('#mAuto', 'click', function () { playSound('click'); newSession('auto', filtered()); });
    on('#mSurv', 'click', function () {
      playSound('click');
      stats.survival.plays = (stats.survival.plays || 0) + 1; saveStats();
      newSession('survival', filtered());
    });
    on('#mRev', 'click', function () {
      playSound('click');
      var pool = Object.keys(wrongNote).map(function (id) { return BY_ID[id]; }).filter(Boolean);
      if (pool.length) newSession('review', pool);
    });
    on('#mList', 'click', function () { playSound('click'); listScreen(); });
    on('#mRec', 'click', function () { playSound('click'); recordScreen(); });
  }

  /* ---------- QUESTION SCREEN ---------- */
  var MODE_TITLE = { infinite: '🎮 무한 모드', auto: '⏱️ 자동 타이머', survival: '🔔 서바이벌', review: '📕 오답노트' };

  function renderQuestion() {
    setWide(false);
    var q = S.q, L = S.last, isAuto = S.mode === 'auto';
    var h = '';
    // top bar
    var counter;
    if (S.mode === 'survival' || S.mode === 'review') counter = (S.idx + 1) + ' / ' + S.queue.length;
    else counter = (S.idx + 1) + '번째';
    h += '<div class="bg-amber-100 p-3 rounded-xl text-amber-900 font-bold flex justify-between items-center gap-2 text-sm sm:text-base mb-3">' +
      '<span>' + MODE_TITLE[S.mode] + ' · ' + counter + '</span>';
    if (S.mode === 'survival') {
      var hearts = '';
      for (var i = 0; i < 3; i++) hearts += i < S.hearts ? '❤️' : '🤍';
      h += '<span>' + hearts + '</span>';
    }
    if (!isAuto) h += (S.combo >= 2 ? '<span class="text-red-500 animate-pulse">🔥 ' + S.combo + ' 콤보</span>' : '') + '<span>⭐ ' + S.score + '점</span>';
    h += '</div>';
    if (S.mode === 'survival') {
      var pct = Math.round(((S.idx + (S.answered ? 1 : 0)) / S.queue.length) * 100);
      h += '<div class="w-full bg-amber-100 rounded-full h-3 mb-3 overflow-hidden"><div class="bg-rose-500 h-3 rounded-full transition-all" style="width:' + pct + '%"></div></div>';
    }

    // question box
    h += tagsHtml(q);
    h += '<div class="bg-amber-50 border-2 border-amber-300 p-5 pt-8 rounded-2xl min-h-[100px] text-xl text-gray-800 relative mb-4 pop-in">' +
      '<button id="replay" class="absolute top-2 right-2 text-xs bg-white border border-amber-300 text-amber-800 px-2 py-1 rounded-lg shadow-sm hover:bg-amber-100">🔊 다시듣기</button>' +
      '<div class="leading-relaxed">' + esc(q.q) + '</div></div>';

    // answer area
    var revealed = isAuto ? S.revealed : S.answered;
    if (q.type === 'mc') {
      var multi = q.ans.length > 1;
      if (multi && !revealed) h += '<p class="text-indigo-600 text-sm mb-2 font-bold">✔️ 정답 ' + q.ans.length + '개를 모두 고르세요</p>';
      h += '<div class="grid gap-2">';
      q.opts.forEach(function (o, i) {
        var cls = 'w-full bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold p-3 rounded-xl border border-amber-300 text-left transition';
        var isAns = q.ans.indexOf(i) >= 0, isSel = S.selected.indexOf(i) >= 0;
        var mark = '';
        if (revealed) {
          if (isAns) { cls = 'w-full bg-green-500 text-white font-bold p-3 rounded-xl border border-green-600 text-left'; mark = ' ✅'; }
          else if (isSel) { cls = 'w-full bg-red-200 text-red-800 font-bold p-3 rounded-xl border border-red-300 text-left'; mark = ' ❌'; }
          else cls = 'w-full bg-amber-50 text-amber-900 opacity-60 font-bold p-3 rounded-xl border border-amber-200 text-left';
        } else if (isSel) cls += ' opt-sel';
        if (isAuto && !revealed) cls = cls.replace('hover:bg-amber-200', '') + ' cursor-default';
        h += '<button class="opt ' + cls + '" data-i="' + i + '"' + (revealed || isAuto ? ' disabled' : '') + '>' +
          '<span class="inline-block w-7">' + (i + 1) + '.</span>' + esc(o) + mark + '</button>';
      });
      h += '</div>';
      if (multi && !revealed && !isAuto) h += '<button id="mcOk" class="w-full mt-3 bg-indigo-500 hover:bg-indigo-600 text-white text-lg p-3 rounded-xl shadow"' + (S.selected.length ? '' : ' disabled style="opacity:.5"') + '>확인 ✔️</button>';
    } else if (q.type === 'ox') {
      var oc = 'bg-blue-500 hover:bg-blue-600', xc = 'bg-red-500 hover:bg-red-600';
      if (revealed) {
        oc = q.ans === 'O' ? 'bg-green-500 ring-4 ring-green-300' : 'bg-gray-300 opacity-50';
        xc = q.ans === 'X' ? 'bg-green-500 ring-4 ring-green-300' : 'bg-gray-300 opacity-50';
      }
      var dd = revealed || isAuto ? ' disabled' : '';
      h += '<div class="grid grid-cols-2 gap-3">' +
        '<button id="oxO" class="' + oc + ' text-white text-5xl py-6 rounded-2xl shadow-lg transition"' + dd + '>⭕</button>' +
        '<button id="oxX" class="' + xc + ' text-white text-5xl py-6 rounded-2xl shadow-lg transition"' + dd + '>❌</button></div>';
    } else {
      if (!isAuto) {
        h += '<div class="flex gap-2"><input id="saIn" type="text" autocomplete="off" placeholder="정답을 입력하세요" class="flex-1 min-w-0 border-2 border-amber-300 rounded-xl p-3 text-lg focus:outline-none focus:border-amber-500"' +
          (S.answered ? ' disabled value="' + esc(L && L.user || '') + '"' : '') + '>' +
          (S.answered ? '' : '<button id="saOk" class="bg-emerald-500 hover:bg-emerald-600 text-white px-4 rounded-xl shadow whitespace-nowrap">정답 제출</button>') + '</div>';
      } else if (!revealed) {
        h += '<div class="text-center text-amber-700 text-lg py-3">✏️ 정답을 생각해 보세요!</div>';
      }
    }

    // auto mode countdown / reveal
    if (isAuto) {
      if (!revealed) {
        h += '<div id="countdown" class="mt-4 text-center text-2xl text-indigo-600 font-bold">' + (S.countdown == null ? '🗣️ 문제를 읽고 있어요…' : '⏳ 정답 공개까지 ' + S.countdown + '초') + '</div>';
        h += '<button id="revealNow" class="w-full mt-2 bg-indigo-100 text-indigo-700 p-2 rounded-xl text-sm">⏩ 바로 정답 보기</button>';
      } else {
        h += '<div class="mt-4 bg-indigo-100 border border-indigo-300 rounded-xl p-4 pop-in"><div class="text-xl text-indigo-800 font-bold">🎯 정답: ' + esc(answerLabel(q)) + '</div>' + expHtml(q) + '</div>';
      }
      h += '<label class="flex items-center gap-2 mt-3 text-sm text-gray-600 justify-center"><input id="autoNext" type="checkbox" class="w-4 h-4"' + (settings.autoNext ? ' checked' : '') + '> 자동으로 다음 문제 (정답 공개 5초 후)</label>';
    } else if (S.answered && L) {
      if (L.ok) {
        h += '<div class="mt-4 bg-green-100 border border-green-300 rounded-xl p-4 pop-in"><div class="text-xl text-green-700 font-bold">⭕ 정답이에요! +' + L.gained + '점' + (L.self ? ' (자가 채점)' : '') + '</div>';
        if (q.type === 'sa') h += '<div class="text-green-800 mt-1">정답: ' + esc(q.ans) + '</div>';
        if (S.mode === 'review' && !wrongNote[q.id]) h += '<div class="text-orange-600 text-sm mt-1">🎓 오답노트에서 졸업했어요!</div>';
        else if (S.mode === 'review' && wrongNote[q.id]) h += '<div class="text-orange-600 text-sm mt-1">한 번 더 맞히면 오답노트에서 졸업!</div>';
        h += '</div>';
      } else {
        h += '<div class="mt-4 bg-red-100 border border-red-300 rounded-xl p-4 pop-in"><div class="text-xl text-red-600 font-bold">❌ 아쉬워요!' + (S.mode === 'survival' ? ' 하트 -1 💔' : '') + '</div>' +
          '<div class="text-red-800 mt-1">정답: ' + esc(answerLabel(q)) + '</div>';
        if (q.type === 'sa') h += '<button id="selfOk" class="mt-2 bg-white border border-green-400 text-green-700 px-3 py-1 rounded-lg text-sm hover:bg-green-50">✅ 맞은 걸로 할게요</button>';
        h += '</div>';
      }
      if (q.exp) h += '<div class="mt-2 bg-indigo-100 border border-indigo-200 rounded-xl p-3">' + expHtml(q) + '</div>';
    }

    // nav buttons
    h += '<div class="flex gap-2 mt-4">';
    var showNext = isAuto ? true : S.answered;
    if (showNext) {
      var nextLabel = '다음 문제 ➡️';
      if (S.mode === 'survival' && S.hearts <= 0) nextLabel = '결과 보기 💔';
      else if ((S.mode === 'survival' || S.mode === 'review') && S.idx + 1 >= S.queue.length) nextLabel = '결과 보기 🏆';
      h += '<button id="next" class="flex-1 bg-blue-500 hover:bg-blue-600 text-white text-lg p-3 rounded-xl shadow-lg">' + nextLabel + '</button>';
    }
    h += '<button id="stop" class="' + (showNext ? '' : 'flex-1 ') + 'bg-gray-400 hover:bg-gray-500 text-white text-lg p-3 rounded-xl shadow">그만하기 🏁</button></div>';

    app.innerHTML = h;
    bindExpToggles();

    on('#replay', 'click', function () { playSound('click'); speak(S.revealed || S.answered ? readText(q) : readText(q)); });
    on('#stop', 'click', stopMode);
    on('#next', 'click', goNext);
    Array.prototype.forEach.call(app.querySelectorAll('.opt'), function (b) {
      b.addEventListener('click', function () { chooseOpt(+b.getAttribute('data-i')); });
    });
    on('#mcOk', 'click', confirmMulti);
    on('#oxO', 'click', function () { chooseOX('O'); });
    on('#oxX', 'click', function () { chooseOX('X'); });
    on('#saOk', 'click', submitSA);
    var inp = on('#saIn', 'keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); e.stopPropagation(); submitSA(); }
    });
    if (inp && !S.answered) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } }
    on('#selfOk', 'click', selfGrade);
    on('#revealNow', 'click', function () { playSound('click'); reveal(); });
    on('#autoNext', 'change', function (e) {
      settings.autoNext = e.target.checked; saveSettings();
      if (S.revealed && settings.autoNext) later(goNext, 5000);
    });
  }

  function startQuestionFlow() {
    // called right after a new question is rendered
    var q = S.q, my = token;
    if (S.mode === 'auto') {
      speak(readText(q), function () { if (my === token && S && !S.revealed) startCountdown(); });
    } else {
      speak(readText(q));
    }
  }

  function startCountdown() {
    S.countdown = TIMER[S.q.type] || 15;
    var el = $('#countdown'); if (el) el.textContent = '⏳ 정답 공개까지 ' + S.countdown + '초';
    var my = token;
    var iv = setInterval(function () {
      if (my !== token || !S || S.revealed) { clearInterval(iv); return; }
      S.countdown--;
      var c = $('#countdown');
      if (S.countdown <= 0) { clearInterval(iv); reveal(); return; }
      if (c) c.textContent = '⏳ 정답 공개까지 ' + S.countdown + '초';
      if (S.countdown <= 3) playSound('click');
    }, 1000);
    timers.push(iv);
  }

  function reveal() {
    if (!S || S.mode !== 'auto' || S.revealed) return;
    token++; clearTimers();
    S.revealed = true; S.solved++;
    playSound('correct');
    renderQuestion();
    var my = token;
    speak('정답은, ' + answerSpeech(S.q) + ' 입니다.', function () {
      if (my === token && settings.autoNext) later(goNext, 5000);
    });
  }

  function chooseOpt(i) {
    if (S.mode === 'auto' || S.answered) return;
    var q = S.q;
    if (q.type !== 'mc' || i < 0 || i >= q.opts.length) return;
    playSound('click');
    if (q.ans.length > 1) {
      var k = S.selected.indexOf(i);
      if (k >= 0) S.selected.splice(k, 1); else S.selected.push(i);
      renderQuestion();
      return;
    }
    S.selected = [i];
    submit(q.ans[0] === i);
  }
  function confirmMulti() {
    if (S.mode === 'auto' || S.answered || !S.selected.length) return;
    var q = S.q;
    var ok = S.selected.length === q.ans.length && q.ans.every(function (a) { return S.selected.indexOf(a) >= 0; });
    submit(ok);
  }
  function chooseOX(v) {
    if (S.mode === 'auto' || S.answered || S.q.type !== 'ox') return;
    S.selected = [];
    submit(S.q.ans === v);
  }
  function submitSA() {
    if (S.mode === 'auto' || S.answered || S.q.type !== 'sa') return;
    var inp = $('#saIn'); var v = inp ? inp.value.trim() : '';
    if (!v) { if (inp) { inp.classList.add('border-red-400'); inp.focus(); } return; }
    submit(gradeSA(v, S.q.ans), v);
  }
  function goNext() {
    if (!S) return;
    playSound('click');
    if (S.mode === 'survival' && S.hearts <= 0) return survivalLose();
    nextQuestion();
  }
  function stopMode() {
    if (!S) return;
    playSound('click');
    token++; clearTimers(); stopSpeech();
    if (S.mode === 'survival') return survivalLose(true);
    finishScreen();
  }

  /* ---------- FINISH SCREENS ---------- */
  function title(score) {
    if (score >= 150) return '🌟 명예 안전왕 (골든벨 대상)';
    if (score >= 80) return '🏅 우수 안전수호자';
    return '🛡️ 초급 안전지킴이';
  }
  function statBox(label, val) {
    return '<div class="bg-amber-100 rounded-xl p-3 text-center"><div class="text-xs text-amber-700">' + label + '</div><div class="text-2xl text-amber-900">' + val + '</div></div>';
  }
  function finishScreen() {
    token++; clearTimers(); stopSpeech(); setWide(false);
    var s = S, h = '';
    h += '<div class="text-center"><div class="text-6xl mb-2 pulse-scale">🏆</div><h2 class="text-3xl text-amber-600 mb-4 pulse-scale">수고했어요!</h2></div>';
    if (s.mode === 'auto') {
      h += '<div class="grid grid-cols-1 gap-3 mb-4">' + statBox('함께 푼 문제 수', s.solved + '문항') + '</div>';
      h += '<p class="text-center text-gray-600 mb-4">교실에서 함께 푼 문제를 다시 복습해 보세요! 📚</p>';
    } else {
      var rate = s.solved ? Math.round(s.correct / s.solved * 100) : 0;
      h += '<div class="grid grid-cols-2 gap-3 mb-4">' + statBox('총 풀이 수', s.solved) + statBox('정답 수', s.correct) +
        statBox('정답률', rate + '%') + statBox('누적 점수', s.score + '점') + '</div>';
      h += '<div class="text-center bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 mb-4"><div class="text-sm text-amber-700">나의 칭호</div><div class="text-2xl text-amber-800 pulse-scale">' + title(s.score) + '</div></div>';
      if (s.mode === 'review') h += '<p class="text-center text-orange-600 mb-3">📕 남은 오답노트: ' + wrongCount() + '문항</p>';
    }
    h += '<button id="home" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xl p-4 rounded-xl shadow-lg transition transform hover:-translate-y-1">처음으로 돌아가기 🏠</button>';
    app.innerHTML = h;
    on('#home', 'click', function () { playSound('click'); modeScreen(); });
    if (s.mode !== 'auto' && s.solved) speak('수고했어요! 정답 ' + s.correct + '개, 점수는 ' + s.score + '점 입니다.');
  }

  function saveSurvival(reached, cleared) {
    var sv = stats.survival;
    if (reached > (sv.best || 0)) sv.best = reached;
    if (cleared) sv.clears = (sv.clears || 0) + 1;
    if (s_score() > (sv.bestScore || 0)) sv.bestScore = s_score();
    saveStats();
  }
  function s_score() { return S ? S.score : 0; }

  function survivalLose(stopped) {
    token++; clearTimers(); stopSpeech(); setWide(false);
    var s = S, reached = s.correct;
    saveSurvival(reached, false);
    playSound('wrong');
    var h = '<div class="text-center"><div class="text-6xl mb-2">' + (stopped ? '🏁' : '💔') + '</div>' +
      '<h2 class="text-3xl text-rose-600 mb-2">' + (stopped ? '서바이벌 중단' : '아쉽게 탈락!') + '</h2>' +
      '<p class="text-gray-600 mb-4">' + s.queue.length + '문제 중 ' + s.solved + '문제까지 도전했어요.</p></div>';
    h += '<div class="grid grid-cols-2 gap-3 mb-4">' + statBox('맞힌 문제', s.correct) + statBox('점수', s.score + '점') +
      statBox('최고 기록', (stats.survival.best || 0) + '문제') + statBox('골든벨 성공', (stats.survival.clears || 0) + '회') + '</div>';
    h += '<div class="grid gap-2"><button id="retry" class="w-full bg-rose-500 hover:bg-rose-600 text-white text-xl p-4 rounded-xl shadow-lg">다시 도전 🔔</button>' +
      '<button id="home" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xl p-4 rounded-xl shadow-lg">처음으로 돌아가기 🏠</button></div>';
    app.innerHTML = h;
    on('#home', 'click', function () { playSound('click'); modeScreen(); });
    on('#retry', 'click', function () { playSound('click'); stats.survival.plays = (stats.survival.plays || 0) + 1; saveStats(); newSession('survival', filtered()); });
    if (!stopped) speak('아쉽게 탈락했어요. 다시 도전해 봐요!');
  }

  function survivalWin() {
    token++; clearTimers(); stopSpeech(); setWide(false);
    var s = S;
    saveSurvival(s.correct, true);
    playSound('correct');
    var hearts = ''; for (var i = 0; i < 3; i++) hearts += i < s.hearts ? '❤️' : '🤍';
    var h = '<div class="text-center"><div class="text-7xl mb-2 pulse-scale">🔔</div>' +
      '<h2 class="text-3xl text-amber-600 mb-2 pulse-scale">🔔 골든벨을 울렸습니다!</h2>' +
      '<p class="text-gray-600 mb-4">' + s.queue.length + '문제를 모두 통과했어요! 남은 하트 ' + hearts + '</p></div>';
    h += '<div class="grid grid-cols-2 gap-3 mb-4">' + statBox('맞힌 문제', s.correct + ' / ' + s.solved) + statBox('점수', s.score + '점') + '</div>';
    h += '<div class="text-center bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 mb-4"><div class="text-sm text-amber-700">나의 칭호</div><div class="text-2xl text-amber-800 pulse-scale">' + title(s.score) + '</div></div>';
    h += '<button id="home" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xl p-4 rounded-xl shadow-lg">처음으로 돌아가기 🏠</button>';
    app.innerHTML = h;
    on('#home', 'click', function () { playSound('click'); modeScreen(); });
    confetti();
    speak('축하합니다! 골든벨을 울렸습니다!');
  }

  function confetti() {
    var colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#facc15'];
    var w = window.innerWidth;
    for (var i = 0; i < 140; i++) {
      var d = document.createElement('div');
      d.className = 'confetti';
      d.style.left = Math.random() * w + 'px';
      d.style.background = colors[i % colors.length];
      d.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px');
      d.style.animationDuration = (2.5 + Math.random() * 2.5) + 's';
      d.style.animationDelay = (Math.random() * 1.5) + 's';
      if (Math.random() < 0.4) { d.style.width = '8px'; d.style.height = '8px'; d.style.borderRadius = '50%'; }
      document.body.appendChild(d);
      (function (el) { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 7000); })(d);
    }
  }

  /* ---------- LIST SCREEN ---------- */
  var L_STATE = { text: '', set: '', type: '', page: 0, wrongOnly: false };
  function listScreen() {
    token++; clearTimers(); stopSpeech(); S = null; setWide(true);
    var h = '<div class="flex justify-between items-center mb-3"><h2 class="text-2xl text-sky-700">📚 문제 전체 보기</h2>' +
      '<button id="home" class="bg-gray-400 hover:bg-gray-500 text-white px-3 py-2 rounded-xl text-sm">🏠 처음으로</button></div>';
    h += '<div class="grid gap-2 mb-3">' +
      '<input id="lText" type="search" placeholder="🔍 검색어 (문제·보기·정답·해설)" class="w-full border-2 border-sky-200 rounded-xl p-3 focus:outline-none focus:border-sky-400" value="' + esc(L_STATE.text) + '">' +
      '<div class="grid grid-cols-2 gap-2"><select id="lSet" class="min-w-0 border-2 border-sky-200 rounded-xl p-2 bg-white"><option value="">전체 기관/세트</option>' +
      SETS.map(function (s) { return '<option' + (L_STATE.set === s ? ' selected' : '') + ' value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('') + '</select>' +
      '<select id="lType" class="min-w-0 border-2 border-sky-200 rounded-xl p-2 bg-white"><option value="">전체 유형</option>' +
      TYPES.map(function (t) { return '<option' + (L_STATE.type === t[0] ? ' selected' : '') + ' value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select></div>' +
      '<label class="text-sm text-gray-600 flex items-center gap-2"><input id="lWrong" type="checkbox" class="w-4 h-4"' + (L_STATE.wrongOnly ? ' checked' : '') + '> 📕 오답노트 문제만 보기</label></div>';
    h += '<div id="lInfo" class="text-sm text-gray-500 mb-2"></div><div id="lList" class="grid gap-3"></div><div id="lPager" class="flex justify-center items-center gap-2 mt-4"></div>';
    app.innerHTML = h;
    on('#home', 'click', function () { playSound('click'); modeScreen(); });
    var deb = null;
    on('#lText', 'input', function (e) { clearTimeout(deb); deb = setTimeout(function () { L_STATE.text = e.target.value; L_STATE.page = 0; renderList(); }, 250); });
    on('#lSet', 'change', function (e) { L_STATE.set = e.target.value; L_STATE.page = 0; renderList(); });
    on('#lType', 'change', function (e) { L_STATE.type = e.target.value; L_STATE.page = 0; renderList(); });
    on('#lWrong', 'change', function (e) { L_STATE.wrongOnly = e.target.checked; L_STATE.page = 0; renderList(); });
    renderList();
  }
  function searchBlob(q) {
    if (!q._blob) q._blob = [q.q, (q.opts || []).join(' '), String(q.ans), q.ansText || '', q.exp || '', q.part || ''].join(' ').toLowerCase();
    return q._blob;
  }
  function renderList() {
    var terms = L_STATE.text.toLowerCase().split(/\s+/).filter(Boolean);
    var res = DATA.filter(function (q) {
      if (L_STATE.set && q.set !== L_STATE.set) return false;
      if (L_STATE.type && q.type !== L_STATE.type) return false;
      if (L_STATE.wrongOnly && !wrongNote[q.id]) return false;
      if (terms.length) { var b = searchBlob(q); return terms.every(function (t) { return b.indexOf(t) >= 0; }); }
      return true;
    });
    var per = 30, pages = Math.max(1, Math.ceil(res.length / per));
    if (L_STATE.page >= pages) L_STATE.page = pages - 1;
    var slice = res.slice(L_STATE.page * per, L_STATE.page * per + per);
    $('#lInfo').textContent = '검색 결과: ' + res.length + '문항';
    var h = '';
    slice.forEach(function (q) {
      h += '<div class="border-2 border-amber-200 rounded-2xl p-4 bg-white">' + tagsHtml(q) +
        '<div class="text-lg text-gray-800 mb-2"><span class="text-amber-600">#' + q.id + '</span> ' + esc(q.q) + '</div>';
      if (q.type === 'mc') {
        h += '<ol class="grid gap-1 mb-2">';
        q.opts.forEach(function (o, i) {
          var ok = q.ans.indexOf(i) >= 0;
          h += '<li class="px-3 py-1 rounded-lg text-sm ' + (ok ? 'bg-green-500 text-white' : 'bg-amber-50 text-amber-900') + '">' + (i + 1) + '. ' + esc(o) + (ok ? ' ✅' : '') + '</li>';
        });
        h += '</ol>';
      }
      h += '<div class="text-green-700 font-bold">🎯 정답: ' + esc(answerLabel(q)) + '</div>';
      if (q.exp) h += '<details class="mt-2 text-sm text-gray-700"><summary class="cursor-pointer text-indigo-600">💡 해설 보기</summary><div class="mt-1 whitespace-pre-line leading-relaxed bg-indigo-50 rounded-lg p-2">' + esc(q.exp) + '</div></details>';
      h += '</div>';
    });
    if (!slice.length) h = '<p class="text-center text-gray-500 py-8">검색 결과가 없어요 🥲</p>';
    $('#lList').innerHTML = h;
    var p = '<button id="pPrev" class="px-3 py-2 rounded-lg bg-sky-500 text-white text-sm"' + (L_STATE.page <= 0 ? ' disabled style="opacity:.4"' : '') + '>◀ 이전</button>' +
      '<span class="text-sm text-gray-600">' + (L_STATE.page + 1) + ' / ' + pages + '</span>' +
      '<button id="pNext" class="px-3 py-2 rounded-lg bg-sky-500 text-white text-sm"' + (L_STATE.page >= pages - 1 ? ' disabled style="opacity:.4"' : '') + '>다음 ▶</button>';
    $('#lPager').innerHTML = p;
    on('#pPrev', 'click', function () { if (L_STATE.page > 0) { L_STATE.page--; renderList(); app.scrollIntoView({ behavior: 'smooth' }); } });
    on('#pNext', 'click', function () { if (L_STATE.page < pages - 1) { L_STATE.page++; renderList(); app.scrollIntoView({ behavior: 'smooth' }); } });
  }

  /* ---------- RECORD SCREEN ---------- */
  function recordScreen() {
    token++; clearTimers(); stopSpeech(); S = null; setWide(true);
    var ta = 0, tc = 0;
    SETS.forEach(function (s) { var st = stats.sets[s]; if (st) { ta += st.a; tc += st.c; } });
    var sv = stats.survival;
    var h = '<div class="flex justify-between items-center mb-3"><h2 class="text-2xl text-sky-700">📊 내 기록</h2>' +
      '<button id="home" class="bg-gray-400 hover:bg-gray-500 text-white px-3 py-2 rounded-xl text-sm">🏠 처음으로</button></div>';
    h += '<div class="grid grid-cols-2 gap-3 mb-4">' + statBox('총 풀이 수', ta) + statBox('전체 정답률', ta ? Math.round(tc / ta * 100) + '%' : '-') +
      statBox('🔔 서바이벌 최고', (sv.best || 0) + '문제' + (sv.bestScore ? ' · ' + sv.bestScore + '점' : '')) + statBox('🔔 골든벨 성공', (sv.clears || 0) + '회 / ' + (sv.plays || 0) + '판') +
      statBox('📕 오답노트', wrongCount() + '문항') + statBox('맞힌 문제', tc) + '</div>';
    h += '<h3 class="text-lg text-amber-800 mb-2">기관·세트별 정답률</h3><div class="grid gap-2 mb-4">';
    SETS.forEach(function (s) {
      var st = stats.sets[s] || { a: 0, c: 0 }, r = st.a ? Math.round(st.c / st.a * 100) : 0;
      var col = r >= 80 ? 'bg-emerald-500' : r >= 50 ? 'bg-amber-400' : 'bg-rose-400';
      h += '<div class="text-sm"><div class="flex justify-between gap-2"><span class="text-gray-700">' + esc(s) + '</span><span class="text-gray-500 whitespace-nowrap">' + st.c + ' / ' + st.a + (st.a ? ' (' + r + '%)' : '') + '</span></div>' +
        '<div class="w-full bg-gray-100 rounded-full h-2 overflow-hidden"><div class="' + col + ' h-2" style="width:' + (st.a ? r : 0) + '%"></div></div></div>';
    });
    h += '</div><p class="text-xs text-gray-400 mb-3">※ 자동 타이머 모드는 기록에 포함되지 않아요.</p>';
    h += '<button id="reset" class="w-full bg-red-100 text-red-600 border border-red-300 p-3 rounded-xl hover:bg-red-200">🗑️ 기록 초기화 (오답노트 포함)</button>';
    app.innerHTML = h;
    on('#home', 'click', function () { playSound('click'); modeScreen(); });
    on('#reset', 'click', function () {
      if (!window.confirm('모든 기록과 오답노트를 지울까요? 되돌릴 수 없어요.')) return;
      stats = { sets: {}, survival: { best: 0, clears: 0, plays: 0 } }; saveStats();
      wrongNote = {}; saveWrong();
      recordScreen();
    });
  }

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', function (e) {
    if (!S || !S.q || !app.querySelector('#replay')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.target && e.target.tagName) || '';
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    var k = e.key, q = S.q;
    if (k === 'Escape') { e.preventDefault(); stopMode(); return; }
    if (typing) return;
    var revealed = S.mode === 'auto' ? S.revealed : S.answered;
    if (k === ' ' || k === 'Spacebar') { e.preventDefault(); speak(readText(q)); return; }
    if (k === 'Enter') {
      e.preventDefault();
      if (S.mode === 'auto') { if (S.revealed) goNext(); else reveal(); return; }
      if (revealed) { goNext(); return; }
      if (q.type === 'mc' && q.ans.length > 1) confirmMulti();
      else if (q.type === 'sa') submitSA();
      return;
    }
    if (revealed || S.mode === 'auto') return;
    if (q.type === 'mc' && /^[1-5]$/.test(k)) { e.preventDefault(); chooseOpt(+k - 1); return; }
    if (q.type === 'ox') {
      var u = k.toUpperCase();
      if (u === 'O' || k === '0') { e.preventDefault(); chooseOX('O'); }
      else if (u === 'X') { e.preventDefault(); chooseOX('X'); }
    }
  });

  /* ---------- boot ---------- */
  if (!DATA.length) {
    app.innerHTML = '<p class="text-center text-red-500">문제 데이터(data.js)를 불러오지 못했어요.</p>';
  } else {
    modeScreen();
  }
})();
