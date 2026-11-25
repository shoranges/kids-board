/* 매일 한자 — 학습 앱 로직 */
(function () {
  'use strict';

  var HD = window.HD || { days: [], chars: {} };
  var DAYS = HD.days.slice().sort(function (a, b) { return a.day - b.day; });
  var CHARS = HD.chars;
  var DAYMAP = {};
  DAYS.forEach(function (d) { DAYMAP[d.day] = d; });

  var PROFILES = {
    seoyeon: { id: 'seoyeon', name: '서연', color: '#EF8A62', bg: '#FFE3D5' },
    seowoo: { id: 'seowoo', name: '서우', color: '#6FA9D6', bg: '#DCEBF9' }
  };
  var STORE = 'hanja.v1.';
  var ACTIVE_KEY = 'hanja.v1.active';

  var state = { me: 'seoyeon', data: {}, view: 'today', vocabTag: 'all', vocabQ: '', cal: null };
  var runtime = { quiz: null, blankTries: {} };
  var trace = { h: null, strokes: {}, guide: true, ctx: null, cv: null, w: 0, drawing: false, cur: null };
  var VOCAB = [];
  var toastTimer = null;

  /* ---------- 작은 도구 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    return (+p[1]) + '월 ' + (+p[2]) + '일';
  }
  function norm(s) { return String(s || '').replace(/\s+/g, '').replace(/[.,!?~"'“”‘’]/g, '').trim(); }
  function shuffle(a) {
    var arr = a.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function uniq(arr, v) { if (arr.indexOf(v) < 0) arr.push(v); }
  function pickOne(a) { return a[Math.floor(Math.random() * a.length)]; }
  function dayNow() { return DAYMAP[currentDay(state.me)]; }

  function toast(msg) {
    var t = $('#toast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------- 저장 ---------- */
  function normalize(d) {
    d = d || {};
    return {
      activeDay: DAYMAP[d.activeDay] ? +d.activeDay : null,
      done: (d.done && typeof d.done === 'object') ? d.done : {},
      work: (d.work && typeof d.work === 'object') ? d.work : {},
      sentences: Array.isArray(d.sentences) ? d.sentences : []
    };
  }
  function loadAll() {
    try { state.me = localStorage.getItem(ACTIVE_KEY) === 'seowoo' ? 'seowoo' : 'seoyeon'; } catch (e) { state.me = 'seoyeon'; }
    ['seoyeon', 'seowoo'].forEach(function (p) {
      var raw = null;
      try { raw = localStorage.getItem(STORE + p); } catch (e) { raw = null; }
      var obj = null;
      if (raw) { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
      state.data[p] = normalize(obj);
    });
  }
  function save(p) {
    try { localStorage.setItem(STORE + p, JSON.stringify(state.data[p])); }
    catch (e) { toast('이 기기에 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.'); }
  }
  function saveActive() {
    try { localStorage.setItem(ACTIVE_KEY, state.me); } catch (e) {}
  }
  function work(dayNum) {
    var d = state.data[state.me];
    d.work[dayNum] = d.work[dayNum] || {};
    return d.work[dayNum];
  }
  function completedCount(p) {
    var d = state.data[p], n = 0;
    Object.keys(d.done).forEach(function (k) { if (d.done[k] && d.done[k].date) n++; });
    return n;
  }
  function totalStars(p) {
    var d = state.data[p], n = 0;
    Object.keys(d.done).forEach(function (k) { if (d.done[k]) n += (+d.done[k].stars || 0); });
    return n;
  }
  function firstUnfinished(p) {
    var d = state.data[p];
    for (var i = 0; i < DAYS.length; i++) if (!d.done[DAYS[i].day]) return DAYS[i].day;
    return DAYS.length ? DAYS[DAYS.length - 1].day : 1;
  }
  function currentDay(p) {
    var d = state.data[p];
    if (d.activeDay && DAYMAP[d.activeDay]) return d.activeDay;
    return firstUnfinished(p);
  }
  function streak(p) {
    var d = state.data[p], set = {};
    Object.keys(d.done).forEach(function (k) { var r = d.done[k]; if (r && r.date) set[r.date] = 1; });
    var day = new Date();
    if (!set[todayStr(day)]) day.setDate(day.getDate() - 1);
    var n = 0;
    while (set[todayStr(day)]) { n++; day.setDate(day.getDate() - 1); }
    return n;
  }
  function dayStatus(p, day) {
    var w = (state.data[p].work || {})[day.day] || {};
    var keys = Object.keys(w.stepA || {});
    var hasTargetSentence = (state.data[p].sentences || []).some(function (s) {
      return s.day === day.day && s.chars && s.chars.length > 0;
    });
    return {
      quiz: !!(w.quiz && w.quiz.done),
      quizCorrect: (w.quiz && w.quiz.correct) || 0,
      quizTotal: (w.quiz && w.quiz.total) || 0,
      stepACount: keys.length,
      stepA: keys.length >= day.chars.length,
      stepB: hasTargetSentence,
      total: day.chars.length
    };
  }

  /* ---------- 어휘 목록 ---------- */
  function buildVocab() {
    var seen = {}; VOCAB = [];
    DAYS.forEach(function (day) {
      day.chars.forEach(function (h) {
        var c = CHARS[h]; if (!c) return;
        c.words.forEach(function (w) {
          var key = w.w + '|' + w.r;
          if (seen[key]) return;
          seen[key] = 1;
          VOCAB.push({ w: w.w, r: w.r, mean: w.mean, tag: w.tag, char: h, eum: c.eum, day: day.day });
        });
      });
    });
  }
  function tagCount(tag) {
    return VOCAB.filter(function (v) { return tag === 'all' || v.tag === tag; }).length;
  }

  /* ---------- 소리 ---------- */
  function pickVoice() {
    try {
      var vs = window.speechSynthesis.getVoices() || [];
      for (var i = 0; i < vs.length; i++) if (/^ko([-_]|$)/i.test(vs[i].lang)) return vs[i];
    } catch (e) {}
    return null;
  }
  function speak(text) {
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') {
      toast('이 브라우저에서는 소리를 들을 수 없어요.'); return;
    }
    try {
      window.speechSynthesis.cancel();
      var u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; u.rate = 0.88; u.pitch = 1.05;
      var v = pickVoice(); if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch (e) { toast('소리를 재생하지 못했어요.'); }
  }

  /* ---------- 헤더 ---------- */
  function renderHeader() {
    var p = state.me, pr = PROFILES[p], day = dayNow();
    $('#dayline').textContent = pr.name + ' · ' + (day ? day.stage + ' ' + day.day + '일차' : '한자 학습');
    $$('#who button').forEach(function (b) {
      var on = b.getAttribute('data-p') === p;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.documentElement.style.setProperty('--pc', pr.color);
    document.documentElement.style.setProperty('--pc-soft', pr.bg);
    $('#statStreak').textContent = streak(p);
    $('#statStars').textContent = totalStars(p);
    $('#statDays').textContent = completedCount(p);
  }

  /* ---------- 오늘 학습 ---------- */
  function renderToday() {
    var p = state.me, day = dayNow();
    if (!day) { $('#view-today').innerHTML = '<div class="card">학습 자료를 불러오지 못했어요.</div>'; return; }
    var rec = state.data[p].done[day.day];
    $('#view-today').innerHTML = dayHead(day, rec) +
      '<div class="today-grid">' + charsSection(day) + traceSection(day) + quizSection(day) +
      stepASection(day) + stepBSection(day) + finishSection(day) + '</div>';
    if (trace.h && day.chars.indexOf(trace.h) < 0) trace.h = null;
    getTraceChar(day);
    setupCanvas();
  }

  function dayHead(day, rec) {
    var p = state.me;
    var count = completedCount(p), total = DAYS.length;
    var pct = Math.round(count / total * 100);
    var opts = DAYS.map(function (x) {
      var done = state.data[p].done[x.day] ? ' ✅' : '';
      return '<option value="' + x.day + '"' + (x.day === day.day ? ' selected' : '') + '>' +
        x.day + '일차 · ' + esc(x.chars.join('')) + done + '</option>';
    }).join('');
    return '<section class="card dayhead">' +
      '<div class="dh-top"><span class="stagebadge">' + esc(day.stage) + '</span>' +
      '<span class="dh-count">' + day.day + '일차 / ' + total + '일</span>' +
      '<label class="daysel">일차 <select id="daySel" aria-label="학습할 일차 고르기">' + opts + '</select></label></div>' +
      '<h2 class="dh-theme">' + esc(day.theme) + '</h2>' +
      '<p class="dh-tip">' + esc(day.tip || '') + '</p>' +
      '<div class="dh-chars">' + day.chars.map(function (h) { return '<span class="hanja">' + esc(h) + '</span>'; }).join('') + '</div>' +
      '<div class="dh-progress"><i style="width:' + pct + '%"></i></div>' +
      '<p class="dh-note">' + total + '일 중 ' + count + '일 마쳤어요 · ' + esc(PROFILES[p].name) + '의 오늘 학습</p>' +
      (rec ? '<p class="done-banner">✅ ' + fmtDate(rec.date) + '에 마친 날이에요 · 다시 복습해도 좋아요</p>' : '') +
      '</section>';
  }

  function charCard(c) {
    var words = c.words.map(function (w) {
      return '<button type="button" class="word" data-act="say" data-say="' + esc(w.r) + '" title="눌러서 발음 듣기">' +
        '<span class="wh hanja">' + esc(w.w) + '</span><span class="wr">' + esc(w.r) + '</span>' +
        (w.tag ? '<span class="tag tag-' + w.tag + '">' + w.tag + '</span>' : '') +
        '<span class="wm">' + esc(w.mean) + '</span></button>';
    }).join('');
    return '<article class="ccard"><div class="c-main">' +
      '<button type="button" class="glyph hanja" data-act="say" data-say="' + esc(c.hun + ' ' + c.eum) + '" aria-label="' + esc(c.hun + ' ' + c.eum) + ' 발음 듣기">' + esc(c.h) + '</button>' +
      '<div class="c-info"><p class="c-read"><span class="hun">' + esc(c.hun) + '</span><b>' + esc(c.eum) + '</b>' +
      '<button type="button" class="csay" data-act="say" data-say="' + esc(c.hun + ' ' + c.eum) + '" aria-label="' + esc(c.hun + ' ' + c.eum) + ' 발음 듣기">🔊 듣기</button></p>' +
      '<p class="c-meta">' + c.strokes + '획 · 부수 ' + esc(c.busu) + '</p>' +
      '<p class="c-hint">' + esc(c.hint) + '</p></div></div>' +
      '<div class="c-words">' + words + '</div></article>';
  }
  function charsSection(day) {
    return '<div class="chars">' + day.chars.map(function (h) { return CHARS[h] ? charCard(CHARS[h]) : ''; }).join('') + '</div>';
  }

  /* ---------- 따라쓰기 ---------- */
  function getTraceChar(day) {
    if (!trace.h || day.chars.indexOf(trace.h) < 0) trace.h = day.chars[0];
    return trace.h;
  }
  function traceSection(day) {
    var h = getTraceChar(day);
    var chips = day.chars.map(function (x) {
      return '<button type="button" data-act="trace-char" data-h="' + x + '" class="hanja' + (x === h ? ' on' : '') + '">' + x + '</button>';
    }).join('');
    return '<section class="card trace" id="traceCard">' +
      '<div class="chead"><h2>✍️ 따라쓰기</h2><div class="tchips" id="traceChips">' + chips + '</div></div>' +
      '<div class="canvas-wrap"><canvas id="traceCanvas" aria-label="' + esc(h) + ' 따라쓰기 칸"></canvas></div>' +
      '<p class="canvas-tip">연한 글씨 위에 손가락으로 따라 써 보세요.</p>' +
      '<div class="tools">' +
      '<button type="button" data-act="trace-clear">🧽 지우기</button>' +
      '<button type="button" data-act="trace-guide" aria-pressed="true" id="guideBtn">👀 가이드 켬</button>' +
      '<button type="button" class="narrow" data-act="trace-prev" aria-label="이전 한자">←</button>' +
      '<button type="button" class="narrow" data-act="trace-next" aria-label="다음 한자">→</button>' +
      '</div></section>';
  }
  function setupCanvas() {
    var cv = document.getElementById('traceCanvas');
    if (!cv || cv.offsetParent === null) return;
    var wrap = cv.parentElement;
    var avail = wrap.clientWidth || 320;
    var size = Math.max(220, Math.min(avail, 360));
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    cv.style.width = size + 'px';
    cv.style.height = size + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    trace.cv = cv; trace.ctx = ctx; trace.w = size;
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', function (e) { if (trace.drawing) onUp(e); });
    redrawTrace();
  }
  function redrawTrace() {
    var ctx = trace.ctx; if (!ctx) return;
    var s = trace.w;
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = '#FFFDF8'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#E7D3C0'; ctx.lineWidth = 1.5; ctx.strokeRect(1, 1, s - 2, s - 2);
    ctx.save();
    ctx.setLineDash([6, 6]); ctx.strokeStyle = '#E6C3AC'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s); ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2); ctx.stroke();
    ctx.setLineDash([2, 8]); ctx.strokeStyle = '#F3DFD0';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s, s); ctx.moveTo(s, 0); ctx.lineTo(0, s); ctx.stroke();
    ctx.restore();
    if (trace.guide && trace.h) {
      ctx.save();
      ctx.fillStyle = 'rgba(120,88,64,.13)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 ' + Math.round(s * 0.74) + 'px "Nanum Myeongjo","Noto Serif KR","Batang",serif';
      ctx.fillText(trace.h, s / 2, s * 0.53);
      ctx.restore();
    }
    ctx.strokeStyle = '#3E2E24';
    ctx.lineWidth = Math.max(6, s * 0.045);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var strokes = trace.strokes[trace.h] || [];
    strokes.forEach(function (st) {
      if (!st.length) return;
      if (st.length === 1) {
        ctx.beginPath(); ctx.arc(st[0].x, st[0].y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fillStyle = '#3E2E24'; ctx.fill();
        return;
      }
      ctx.beginPath(); ctx.moveTo(st[0].x, st[0].y);
      for (var i = 1; i < st.length; i++) ctx.lineTo(st[i].x, st[i].y);
      ctx.stroke();
    });
  }
  function tracePoint(e) {
    var r = trace.cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (trace.w / r.width), y: (e.clientY - r.top) * (trace.w / r.height) };
  }
  function onDown(e) {
    if (!trace.cv || !trace.h) return;
    e.preventDefault();
    trace.drawing = true;
    try { trace.cv.setPointerCapture(e.pointerId); } catch (err) {}
    var p = tracePoint(e);
    trace.cur = [p];
    (trace.strokes[trace.h] = trace.strokes[trace.h] || []).push(trace.cur);
    var ctx = trace.ctx;
    ctx.fillStyle = '#3E2E24';
    ctx.beginPath(); ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
  }
  function onMove(e) {
    if (!trace.drawing || !trace.cur) return;
    e.preventDefault();
    var p = tracePoint(e), prev = trace.cur[trace.cur.length - 1];
    if (Math.abs(prev.x - p.x) + Math.abs(prev.y - p.y) < 0.7) return;
    trace.cur.push(p);
    var ctx = trace.ctx;
    ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  function onUp() { trace.drawing = false; trace.cur = null; }
  function setTraceChar(h) {
    trace.h = h;
    $$('#traceChips button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-h') === h); });
    var cv = document.getElementById('traceCanvas'); if (cv) cv.setAttribute('aria-label', h + ' 따라쓰기 칸');
    redrawTrace();
  }
  function moveTrace(dir) {
    var day = dayNow(); if (!day) return;
    var i = day.chars.indexOf(trace.h);
    if (i < 0) i = 0;
    i = (i + dir + day.chars.length) % day.chars.length;
    setTraceChar(day.chars[i]);
  }

  /* ---------- 퀴즈 ---------- */
  function allPools() {
    var e = [], hun = [], h = [], r = [], m = [];
    DAYS.forEach(function (d) {
      d.chars.forEach(function (x) {
        var c = CHARS[x]; if (!c) return;
        uniq(e, c.eum); uniq(hun, c.hun); uniq(h, c.h);
        c.words.forEach(function (w) { uniq(r, w.r); uniq(m, w.mean); });
      });
    });
    return { eum: e, hun: hun, hanja: h, read: r, mean: m };
  }
  function opts4(answer, pool) {
    var o = [answer], guard = 0;
    while (o.length < 4 && guard < 400) {
      guard++;
      var v = pool[Math.floor(Math.random() * pool.length)];
      if (v && o.indexOf(v) < 0) o.push(v);
    }
    var n = 1;
    while (o.length < 4) { o.push('다른 답 ' + n); n++; }
    return shuffle(o);
  }
  function pickWord(c) {
    var tagged = c.words.filter(function (w) { return !!w.tag; });
    return (tagged[0] || c.words[0] || null);
  }
  function buildQuiz(day) {
    var pools = allPools(), pool = [];
    day.chars.forEach(function (h) {
      var c = CHARS[h]; if (!c) return;
      pool.push({ kind: 'eum', label: '음(소리) 맞히기', text: '이 한자의 음은 무엇일까요?', big: c.h, answer: c.eum, options: opts4(c.eum, pools.eum) });
      if (Math.random() < 0.5) {
        pool.push({ kind: 'hun', label: '뜻(훈) 맞히기', text: '이 한자의 뜻은 무엇일까요?', big: c.h, answer: c.hun, options: opts4(c.hun, pools.hun) });
      } else {
        pool.push({ kind: 'hanja', label: '한자 고르기', text: '다음 뜻과 음에 맞는 한자를 고르세요.', sub: c.hun + ' ' + c.eum, answer: c.h, options: opts4(c.h, pools.hanja) });
      }
      var w = pickWord(c);
      if (w) {
        pool.push({ kind: 'read', label: '한자어 읽기', text: '이 한자어를 어떻게 읽을까요?', big: w.w, answer: w.r, options: opts4(w.r, pools.read) });
        if (w.tag) pool.push({ kind: 'mean', label: w.tag + ' 어휘 뜻', text: '‘' + w.w + '(' + w.r + ')’의 뜻으로 알맞은 것은?', answer: w.mean, options: opts4(w.mean, pools.mean) });
      }
    });
    return shuffle(pool).slice(0, 6);
  }
  function getQuiz(day) {
    var key = state.me + '-' + day.day;
    if (!runtime.quiz || runtime.quiz.key !== key) {
      runtime.quiz = { key: key, qs: buildQuiz(day), i: 0, correct: 0, done: false, locked: false, picked: -1, msg: '', msgOk: false };
    }
    return runtime.quiz;
  }
  function quizSection(day) {
    return '<section class="card quiz" id="quizCard">' + quizInner(day) + '</section>';
  }
  function quizInner(day) {
    var q = getQuiz(day);
    var head = '<div class="chead"><h2>🧠 오늘의 확인 퀴즈</h2><span class="pill">' +
      (q.done ? '완료' : (q.i + 1) + ' / ' + q.qs.length) + '</span></div>';
    if (q.done) {
      var rate = q.qs.length ? q.correct / q.qs.length : 0;
      return head + '<div class="qdone"><div class="qscore">' + q.correct + '<small>/ ' + q.qs.length + ' 문제</small></div>' +
        '<p>' + (rate >= 0.8 ? '아주 훌륭해요! 한자를 제법 잘 알아요.' : rate >= 0.5 ? '좋아요! 틀린 문제는 한자 카드에서 다시 봐요.' : '한 번 더 풀면서 익혀 볼까요?') + '</p>' +
        '<button type="button" data-act="quiz-restart">한 번 더 풀기</button></div>';
    }
    var cur = q.qs[q.i];
    if (!cur) return head;
    var pct = Math.round(((q.i + (q.locked ? 1 : 0)) / q.qs.length) * 100);
    var opts = cur.options.map(function (o, i) {
      var cls = '';
      if (q.locked) {
        if (o === cur.answer) cls = ' ok';
        else if (i === q.picked) cls = ' bad';
      }
      return '<button type="button" data-act="quiz-opt" data-i="' + i + '"' + (q.locked ? ' disabled' : '') + ' class="' + cls + '">' + esc(o) + '</button>';
    }).join('');
    var big = '';
    if (cur.big) big = '<div class="qbig hanja' + (cur.kind === 'read' ? ' word' : '') + '">' + esc(cur.big) + '</div>';
    if (cur.sub) big += '<p class="qsub">' + esc(cur.sub) + '</p>';
    var msg = q.msg ? '<p class="qmsg ' + (q.msgOk ? 'ok' : 'bad') + '">' + esc(q.msg) + '</p>' : '<p class="qmsg">정답이라고 생각하는 것을 눌러 보세요.</p>';
    var next = q.locked ? '<button type="button" class="qnext" data-act="quiz-next">' + (q.i + 1 >= q.qs.length ? '결과 보기 →' : '다음 문제 →') + '</button>' : '';
    return head + '<div class="qbar"><i style="width:' + pct + '%"></i></div>' +
      '<p class="qtype">' + esc(cur.label) + '</p>' +
      '<p class="qtext">' + esc(cur.text) + '</p>' + big +
      '<div class="opts">' + opts + '</div>' + msg + next;
  }
  function answerQuiz(i) {
    var day = dayNow(), q = runtime.quiz;
    if (!day || !q || q.done || q.locked) return;
    var cur = q.qs[q.i]; if (!cur) return;
    q.locked = true; q.picked = i;
    var ok = cur.options[i] === cur.answer;
    if (ok) q.correct++;
    q.msgOk = ok;
    q.msg = ok ? pickOne(['정답이에요! 👏', '딱 맞았어요!', '아주 잘했어요! 🌟']) :
      '아쉬워요. 정답은 ‘' + cur.answer + '’이에요.';
    renderQuizCard(day);
    updateFinish(day);
  }
  function nextQuiz() {
    var day = dayNow(), q = runtime.quiz;
    if (!day || !q || !q.locked) return;
    q.i++;
    if (q.i >= q.qs.length) {
      q.done = true;
      var w = work(day.day);
      w.quiz = { done: true, correct: q.correct, total: q.qs.length };
      save(state.me);
    } else {
      q.locked = false; q.picked = -1; q.msg = ''; q.msgOk = false;
    }
    renderQuizCard(day);
    updateFinish(day);
  }
  function restartQuiz() {
    runtime.quiz = null;
    var day = dayNow(); if (!day) return;
    renderQuizCard(day);
    updateFinish(day);
  }
  function renderQuizCard(day) {
    var el = $('#quizCard');
    if (el) el.innerHTML = quizInner(day);
  }

  /* ---------- Step A: 빈칸 채우기 ---------- */
  function blankAccepted(c) {
    var arr = [c.blank.a];
    c.words.forEach(function (w) {
      if (w.r === c.blank.a || w.w === c.blank.a) { arr.push(w.w); arr.push(w.r); }
    });
    return arr;
  }
  function blankMatch(c, val) {
    var n = norm(val);
    if (!n) return false;
    return blankAccepted(c).some(function (a) { return norm(a) === n; });
  }
  function blankWord(c) {
    for (var i = 0; i < c.words.length; i++) if (c.words[i].r === c.blank.a) return c.words[i];
    return null;
  }
  function blankFeedback(c, ok) {
    var w = blankWord(c);
    var answer = c.blank.a + (w ? '(' + w.w + ')' : '');
    if (ok) return '정답! ' + answer + (w ? ' — ' + w.mean : '');
    return '정답은 ‘' + answer + '’이에요.' + (w ? ' ' + w.mean : '') + ' 다음에 다시 기억해 보아요.';
  }
  function stepASection(day) {
    var w = work(day.day), res = w.stepA || {};
    var items = day.chars.map(function (h, i) {
      var c = CHARS[h]; if (!c) return '';
      var st = res[i];
      var cls = st === 'ok' ? ' ok' : st === 'no' ? ' no' : '';
      var tag = c.blank.tag ? '<span class="tag tag-' + c.blank.tag + '">' + c.blank.tag + '</span> ' : '';
      var disabled = st ? ' disabled' : '';
      var val = st ? esc(c.blank.a) : '';
      var msg = st ? '<p class="bmsg">' + esc(blankFeedback(c, st === 'ok')) + '</p>' : '<p class="bmsg"></p>';
      var btn = st ? '<button type="button" disabled>확인 완료</button>' : '<button type="button" data-act="blank-check" data-i="' + i + '">확인</button>';
      return '<div class="blank' + cls + '" data-i="' + i + '"><p class="bq">' + tag + esc(c.blank.q) + '</p>' +
        '<div class="brow"><input type="text" inputmode="text" autocomplete="off" enterkeyhint="done" placeholder="답을 써 보세요" aria-label="빈칸 답" value="' + val + '"' + disabled + '>' + btn + '</div>' + msg + '</div>';
    }).join('');
    return '<section class="card stepa"><div class="chead"><h2>📝 문장 속 빈칸 채우기</h2><span class="pill">주관식</span></div>' +
      '<p class="lead">오늘 배운 한자어를 직접 타이핑해 보세요. 한자로 써도 맞아요.</p>' +
      '<div class="blanks">' + items + '</div></section>';
  }
  function checkBlank(i, btn) {
    var day = dayNow(); if (!day) return;
    var c = CHARS[day.chars[i]]; if (!c) return;
    var blank = btn.closest('.blank');
    var input = blank.querySelector('input');
    var msgEl = blank.querySelector('.bmsg');
    var val = input.value;
    if (!norm(val)) { msgEl.className = 'bmsg'; msgEl.textContent = '답을 먼저 써 보세요.'; input.focus(); return; }
    var w = work(day.day);
    if (blankMatch(c, val)) {
      blank.classList.add('ok'); blank.classList.remove('no');
      input.disabled = true; btn.disabled = true; btn.textContent = '확인 완료';
      msgEl.className = 'bmsg'; msgEl.textContent = blankFeedback(c, true);
      w.stepA = w.stepA || {}; w.stepA[i] = 'ok';
      save(state.me);
      updateFinish(day);
      return;
    }
    var key = day.day + '-' + i;
    runtime.blankTries[key] = (runtime.blankTries[key] || 0) + 1;
    if (runtime.blankTries[key] < 2) {
      var hint = c.blank.a.charAt(0);
      msgEl.className = 'bmsg';
      msgEl.textContent = '조금 달라요. ‘' + hint + '’로 시작하는 ' + c.blank.a.length + '글자예요. 한 번 더 써 볼까요?';
      input.focus(); input.select();
      return;
    }
    blank.classList.add('no'); blank.classList.remove('ok');
    input.disabled = true; btn.disabled = true; btn.textContent = '확인 완료';
    input.value = c.blank.a;
    msgEl.className = 'bmsg'; msgEl.textContent = blankFeedback(c, false);
    w.stepA = w.stepA || {}; w.stepA[i] = 'no';
    save(state.me);
    updateFinish(day);
  }

  /* ---------- Step B: 문장 만들기 ---------- */
  function stepTargets(day) {
    var arr = [], seen = {};
    day.chars.forEach(function (h) {
      var c = CHARS[h]; if (!c) return;
      var label = h + '(' + c.eum + ')';
      if (!seen[label]) { seen[label] = 1; arr.push({ label: label, tests: [h, c.eum], tag: null, ins: h }); }
    });
    day.chars.forEach(function (h) {
      var c = CHARS[h]; if (!c) return;
      c.words.forEach(function (w) {
        if (!w.tag) return;
        var label = w.w + '(' + w.r + ')';
        if (!seen[label]) { seen[label] = 1; arr.push({ label: label, tests: [w.w, w.r], tag: w.tag, ins: w.r }); }
      });
    });
    return arr;
  }
  function stepBSection(day) {
    var w = work(day.day), sb = w.stepB || {};
    var targets = stepTargets(day);
    var chips = targets.map(function (t) {
      var cls = 'tagged' + (t.tag === '사회' ? ' soc' : '');
      return '<button type="button" class="' + cls + '" data-act="insert" data-ins="' + esc(t.ins) + '">' + esc(t.label) +
        (t.tag ? '<span class="tt">' + t.tag + '</span>' : '') + '</button>';
    }).join('');
    var text = sb.text || '';
    var note = sb.saved ? '<p class="fb-text">지난번에 저장한 문장이에요. 고쳐서 다시 확인할 수 있어요.</p>' : '';
    return '<section class="card stepb"><div class="chead"><h2>✏️ 한자로 문장 만들기</h2><span class="pill">주관식</span></div>' +
      '<p class="lead">오늘 배운 한자나 한자어를 넣어 짧은 문장을 만들어 보세요. 단어를 누르면 입력칸에 들어가요.</p>' +
      '<div class="chips"><span class="chiplabel">넣을 말:</span>' + chips + '</div>' +
      '<textarea id="freeText" rows="4" placeholder="예: 화산이 폭발하면 뜨거운 용암이 흘러나와요." aria-label="내가 만든 문장">' + esc(text) + '</textarea>' +
      '<div class="freefoot"><span id="charCount">' + text.replace(/\s/g, '').length + '자</span>' +
      '<button type="button" data-act="free-submit">문장 확인하기</button></div>' +
      '<div class="feedback" id="freeFeedback"' + (sb.saved ? '' : ' hidden') + '>' + (sb.saved ? note : '') + '</div></section>';
  }
  function insertChip(text) {
    var ta = $('#freeText'); if (!ta) return;
    var s = ta.selectionStart, e = ta.selectionEnd;
    if (s == null) s = e = ta.value.length;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    var pos = s + text.length;
    ta.focus();
    try { ta.setSelectionRange(pos, pos); } catch (err) {}
    var cc = $('#charCount'); if (cc) cc.textContent = ta.value.replace(/\s/g, '').length + '자';
  }
  function submitFree() {
    var day = dayNow(), ta = $('#freeText'); if (!day || !ta) return;
    var text = ta.value.trim();
    if (text.length < 2) { toast('문장을 조금 더 써 볼까요?'); ta.focus(); return; }
    var targets = stepTargets(day);
    var hits = targets.filter(function (t) {
      return t.tests.some(function (x) { return text.indexOf(x) >= 0; });
    });
    var include = hits.length > 0;
    var len = text.replace(/\s+/g, '').length;
    var stars = (include ? 1 : 0) + (len >= 8 ? 1 : 0) + (len >= 16 ? 1 : 0);
    var msg;
    if (include && len >= 8) msg = '오늘 배운 한자나 한자어를 넣어 문장을 멋지게 만들었어요. 길이도 알맞아요!';
    else if (include) msg = '오늘 배운 한자를 넣었어요! 조금만 더 길게, 누가 무엇을 했는지 넣어 보면 더 좋아요.';
    else msg = '문장은 잘 썼어요! 다만 오늘 배운 한자나 교과서 어휘도 꼭 넣어 보세요.';
    var models = [];
    day.chars.forEach(function (h) {
      var c = CHARS[h]; if (!c) return;
      c.ex.forEach(function (s) { models.push({ h: h, e: c.eum, s: s }); });
    });
    models = models.slice(0, 3);
    var modelHTML = models.map(function (m) {
      return '<li><b>' + esc(m.h + '(' + m.e + ')') + '</b> ' + esc(m.s) + '</li>';
    }).join('');

    var d = state.data[state.me];
    var dup = d.sentences.some(function (s) { return s.day === day.day && s.text === text; });
    if (!dup) {
      d.sentences.unshift({
        id: 's' + Date.now() + Math.random().toString(36).slice(2, 6),
        day: day.day, date: todayStr(), ts: Date.now(), text: text,
        chars: hits.map(function (h) { return h.label; })
      });
    }
    var w = work(day.day);
    w.stepB = { saved: true, include: include, text: text, stars: stars };
    save(state.me);

    var fb = $('#freeFeedback');
    if (fb) {
      fb.hidden = false;
      fb.className = 'feedback' + (include ? ' good' : '');
      fb.innerHTML = '<p class="fb-head">' + '⭐'.repeat(Math.max(stars, 1)) + ' ' +
        (include && len >= 8 ? '아주 좋아요!' : include ? '좋은 시작이에요!' : '한 가지만 더!') + '</p>' +
        '<p class="fb-text">' + esc(msg) + '</p>' +
        (include ? '<p class="fb-text">넣은 말: ' + esc(hits.map(function (h) { return h.label; }).join(', ')) + ' · ‘내 문장’에 저장했어요.</p>' : '') +
        '<div class="fb-models"><p class="fb-title">이렇게 써 볼 수도 있어요</p><ul>' + modelHTML + '</ul></div>';
    }
    updateFinish(day);
  }

  /* ---------- 도장 ---------- */
  function finishSection(day) {
    return '<section class="card finish" id="finishCard">' + finishInner(day) + '</section>';
  }
  function finishInner(day) {
    var p = state.me, rec = state.data[p].done[day.day], st = dayStatus(p, day);
    if (rec) {
      return '<div class="chead"><h2>🏅 오늘의 도장</h2><span class="pill">⭐ ' + (+rec.stars || 3) + '개</span></div>' +
        '<div class="alreadydone"><div class="bigstamp">참<br>잘했어요</div>' +
        '<p>' + fmtDate(rec.date) + '에 마친 ' + day.day + '일차예요.<br>복습하고 싶으면 위에서 다시 풀어 볼 수 있어요.</p></div>';
    }
    var all = st.quiz && st.stepA && st.stepB;
    var li = function (ok, label, note) {
      return '<li class="' + (ok ? 'ok' : '') + '"><span class="ck">' + (ok ? '✓' : '') + '</span>' + label +
        '<span class="small">' + (note || '') + '</span></li>';
    };
    return '<div class="chead"><h2>🏅 오늘의 도장</h2><span class="pill">⭐ 3개</span></div>' +
      '<ul class="checklist">' +
      li(st.quiz, '확인 퀴즈', st.quiz ? st.quizCorrect + ' / ' + st.quizTotal + ' 정답' : '아직') +
      li(st.stepA, '빈칸 채우기', st.stepACount + ' / ' + st.total) +
      li(st.stepB, '한자로 문장 만들기', st.stepB ? '저장했어요' : '아직') +
      '</ul>' +
      '<button type="button" class="stampbtn" data-act="stamp"' + (all ? '' : ' disabled') + '>' +
      (all ? '오늘 학습 마치기 ⭐' : '조금만 더! 남은 학습을 마쳐요') + '</button>' +
      '<p class="note">퀴즈·빈칸·문장을 모두 마치면 도장과 별 3개를 받아요.</p>';
  }
  function updateFinish(day) {
    var el = $('#finishCard');
    if (el) el.innerHTML = finishInner(day);
  }
  function stampDay() {
    var p = state.me, day = dayNow(); if (!day) return;
    var d = state.data[p];
    if (d.done[day.day]) return;
    var st = dayStatus(p, day);
    if (!(st.quiz && st.stepA && st.stepB)) {
      toast('퀴즈·빈칸·문장을 모두 마치면 도장을 받을 수 있어요.');
      return;
    }
    d.done[day.day] = {
      date: todayStr(), stars: 3,
      quiz: { correct: st.quizCorrect, total: st.quizTotal },
      stepA: st.stepACount, stepB: true
    };
    // 다음 날짜로 이어서: 바로 다음 일차가 아직이면 그 날, 아니면 남은 첫 일차
    if (DAYMAP[day.day + 1] && !d.done[day.day + 1]) d.activeDay = day.day + 1;
    else d.activeDay = firstUnfinished(p);
    save(p);
    renderHeader();
    showStamp(day);
    renderToday();
  }
  function showStamp(day) {
    var p = state.me;
    $('#stampTitle').textContent = day.day + '일차 완료!';
    $('#stampStars').textContent = '⭐ ⭐ ⭐';
    var s = streak(p);
    $('#stampMsg').textContent = day.stage + ' · ' + day.theme + ' — 별 3개를 받았어요. ' +
      (s > 1 ? '연속 ' + s + '일째 공부 중이에요!' : '내일도 한자로 만나요!');
    var m = $('#stampModal');
    m.hidden = false;
    var btn = m.querySelector('button'); if (btn) btn.focus();
  }
  function closeModal() { $('#stampModal').hidden = true; }

  /* ---------- 출석 달력 ---------- */
  function renderCalendar() {
    var p = state.me, d = state.data[p];
    var y = state.cal.y, m = state.cal.m;
    $('#calTitle').textContent = y + '년 ' + (m + 1) + '월';
    var byDate = {};
    Object.keys(d.done).forEach(function (k) {
      var r = d.done[k];
      if (r && r.date) { (byDate[r.date] = byDate[r.date] || []).push(+k); }
    });
    var start = new Date(y, m, 1).getDay();
    var dim = new Date(y, m + 1, 0).getDate();
    var today = todayStr();
    var cells = ['일', '월', '화', '수', '목', '금', '토'].map(function (w, i) {
      return '<div class="dow' + (i === 0 ? ' sun' : '') + '">' + w + '</div>';
    }).join('');
    for (var i = 0; i < start; i++) cells += '<div class="cell empty"></div>';
    for (var dd = 1; dd <= dim; dd++) {
      var iso = y + '-' + pad(m + 1) + '-' + pad(dd);
      var list = byDate[iso];
      cells += '<div class="cell' + (iso === today ? ' today' : '') + (list ? ' done' : '') + '">' +
        '<span>' + dd + '</span>' + (list ? '<span class="star">⭐</span>' + (list.length > 1 ? '<span class="many">' + list.length + '일</span>' : '') : '') + '</div>';
    }
    $('#calGrid').innerHTML = cells;
    var monthPrefix = y + '-' + pad(m + 1);
    var monthDays = Object.keys(byDate).filter(function (k) { return k.indexOf(monthPrefix) === 0; }).length;
    $('#calStat').innerHTML = '이번 달 <b>' + monthDays + '일</b> 출석 · 연속 <b>' + streak(p) + '일</b> · 총 별 <b>' + totalStars(p) + '개</b>';
    var rows = DAYS.filter(function (x) { return d.done[x.day]; }).map(function (x) {
      var r = d.done[x.day];
      return '<div class="dayrow"><span class="dn">' + x.day + '일차</span><span>' + esc(x.stage + ' · ' + x.theme) + '</span>' +
        '<span class="dd">' + fmtDate(r.date) + '</span></div>';
    });
    $('#calDays').innerHTML = '<h2>마친 날</h2>' +
      (rows.length ? rows.join('') : '<p class="emptybox">아직 마친 날이 없어요.<br>오늘 학습을 마치면 여기에 별이 쌓여요.</p>');
  }
  function moveMonth(delta) {
    var m = state.cal.m + delta, y = state.cal.y;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    state.cal = { y: y, m: m };
    renderCalendar();
  }

  /* ---------- 내 문장 ---------- */
  function renderSentences() {
    var list = state.data[state.me].sentences.slice().sort(function (a, b) { return b.ts - a.ts; });
    $('#sentCount').textContent = list.length + '개';
    if (!list.length) {
      $('#sentList').innerHTML = '<p class="emptybox">아직 만든 문장이 없어요.<br>‘오늘 학습’에서 한자로 문장을 만들면 여기에 모여요.</p>';
      return;
    }
    $('#sentList').innerHTML = list.map(function (s) {
      return '<article class="sent"><div class="sent-top"><span class="sday">' + s.day + '일차</span>' +
        '<span class="sdate">' + fmtDate(s.date) + '</span>' +
        '<button type="button" data-act="del-sent" data-id="' + esc(s.id) + '">삭제</button></div>' +
        '<p class="stext">' + esc(s.text) + '</p>' +
        (s.chars && s.chars.length ? '<p class="stargets">넣은 말: ' + esc(s.chars.join(', ')) + '</p>' : '') + '</article>';
    }).join('');
  }
  function delSentence(btn) {
    if (btn.getAttribute('data-armed') !== '1') {
      btn.setAttribute('data-armed', '1'); btn.textContent = '정말 삭제?'; return;
    }
    var id = btn.getAttribute('data-id');
    var d = state.data[state.me];
    d.sentences = d.sentences.filter(function (s) { return s.id !== id; });
    save(state.me);
    renderSentences();
  }

  /* ---------- 교과 어휘 ---------- */
  function renderVocab() {
    var tag = state.vocabTag, q = state.vocabQ.trim();
    var counts = { all: VOCAB.length, '사회': tagCount('사회'), '과학': tagCount('과학') };
    var buttons = ['all', '사회', '과학'].map(function (t) {
      var label = t === 'all' ? '전체' : t;
      return '<button type="button" data-act="vfilter" data-tag="' + t + '" class="' + (tag === t ? 'on' : '') + '">' +
        label + ' ' + counts[t] + '</button>';
    }).join('');
    $('#vocabFilter').innerHTML = buttons;
    var search = $('#vocabSearch');
    if (search && search.value !== q) search.value = q;
    var list = VOCAB.filter(function (v) {
      if (tag !== 'all' && v.tag !== tag) return false;
      if (!q) return true;
      var hay = v.w + ' ' + v.r + ' ' + v.mean + ' ' + v.char + ' ' + v.eum;
      return hay.indexOf(q) >= 0;
    });
    $('#vocabCount').textContent = list.length + '개';
    if (!list.length) {
      $('#vocabList').innerHTML = '<p class="emptybox">찾는 어휘가 없어요. 다른 낱말로 찾아보세요.</p>';
      return;
    }
    $('#vocabList').innerHTML = list.map(function (v) {
      return '<div class="vrow"><span class="vchar hanja">' + esc(v.char) + '</span><div class="vbody">' +
        '<p class="vword"><span class="hanja">' + esc(v.w) + '</span><span class="vr">' + esc(v.r) + '</span>' +
        (v.tag ? '<span class="tag tag-' + v.tag + '">' + v.tag + '</span>' : '') + '</p>' +
        '<p class="vmean">' + esc(v.mean) + '</p>' +
        '<p class="vday">' + v.day + '일차 · ' + esc(v.char + '(' + v.eum + ')') + '</p></div>' +
        '<button type="button" class="vsay" data-act="say" data-say="' + esc(v.r) + '" aria-label="' + esc(v.r) + ' 듣기">🔊</button></div>';
    }).join('');
  }
  function setVocabTag(t) {
    state.vocabTag = t;
    renderVocab();
  }

  /* ---------- 보기 전환 ---------- */
  function setView(v) {
    if (['today', 'calendar', 'sentences', 'vocab'].indexOf(v) < 0) v = 'today';
    state.view = v;
    ['today', 'calendar', 'sentences', 'vocab'].forEach(function (x) {
      var el = $('#view-' + x); if (el) el.hidden = (x !== v);
    });
    $$('.tab').forEach(function (b) {
      var on = b.getAttribute('data-view') === v;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (v === 'today') renderToday();
    else if (v === 'calendar') renderCalendar();
    else if (v === 'sentences') renderSentences();
    else if (v === 'vocab') renderVocab();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function switchProfile(p) {
    if (!PROFILES[p] || p === state.me) return;
    state.me = p;
    saveActive();
    runtime.quiz = null;
    runtime.blankTries = {};
    trace.h = null;
    renderHeader();
    if (state.view === 'today') renderToday();
    else if (state.view === 'calendar') renderCalendar();
    else if (state.view === 'sentences') renderSentences();
    else if (state.view === 'vocab') renderVocab();
  }

  /* ---------- 이벤트 ---------- */
  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');
    switch (act) {
      case 'profile': switchProfile(el.getAttribute('data-p')); break;
      case 'say': speak(el.getAttribute('data-say')); break;
      case 'trace-char': setTraceChar(el.getAttribute('data-h')); break;
      case 'trace-clear':
        if (trace.h) { trace.strokes[trace.h] = []; redrawTrace(); }
        break;
      case 'trace-guide':
        trace.guide = !trace.guide;
        el.setAttribute('aria-pressed', trace.guide ? 'true' : 'false');
        el.textContent = trace.guide ? '👀 가이드 켬' : '🙈 가이드 끔';
        redrawTrace();
        break;
      case 'trace-prev': moveTrace(-1); break;
      case 'trace-next': moveTrace(1); break;
      case 'quiz-opt': answerQuiz(+el.getAttribute('data-i')); break;
      case 'quiz-next': nextQuiz(); break;
      case 'quiz-restart': restartQuiz(); break;
      case 'blank-check': checkBlank(+el.getAttribute('data-i'), el); break;
      case 'insert': insertChip(el.getAttribute('data-ins')); break;
      case 'free-submit': submitFree(); break;
      case 'stamp': stampDay(); break;
      case 'close-modal': closeModal(); break;
      case 'cal-prev': moveMonth(-1); break;
      case 'cal-next': moveMonth(1); break;
      case 'vfilter': setVocabTag(el.getAttribute('data-tag')); break;
      case 'del-sent': delSentence(el); break;
    }
  }
  function onChange(e) {
    if (e.target && e.target.id === 'daySel') {
      var n = +e.target.value;
      if (!DAYMAP[n]) return;
      state.data[state.me].activeDay = n;
      save(state.me);
      runtime.quiz = null;
      runtime.blankTries = {};
      trace.h = null;
      renderHeader();
      renderToday();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
  function onInput(e) {
    if (e.target && e.target.id === 'freeText') {
      var cc = $('#charCount');
      if (cc) cc.textContent = e.target.value.replace(/\s/g, '').length + '자';
    }
    if (e.target && e.target.id === 'vocabSearch') {
      state.vocabQ = e.target.value;
      renderVocab();
      var inp = document.getElementById('vocabSearch');
      if (inp) {
        inp.focus();
        try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (err) {}
      }
    }
  }
  function onKey(e) {
    if (e.key === 'Enter' && e.target && e.target.closest && e.target.closest('.blank') && e.target.tagName === 'INPUT') {
      e.preventDefault();
      var blank = e.target.closest('.blank');
      var btn = blank.querySelector('button[data-act="blank-check"]');
      if (btn) checkBlank(+blank.getAttribute('data-i'), btn);
    }
  }

  function onResize() {
    if (state.view !== 'today') return;
    var cv = document.getElementById('traceCanvas');
    if (!cv) return;
    var wrap = cv.parentElement;
    var avail = wrap ? wrap.clientWidth : 0;
    if (avail && Math.abs(Math.min(avail, 360) - trace.w) > 2) setupCanvas();
  }

  /* ---------- 시작 ---------- */
  function init() {
    if (!DAYS.length) {
      $('#view-today').innerHTML = '<div class="card"><p class="emptybox">한자 자료를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p></div>';
      return;
    }
    state.cal = { y: new Date().getFullYear(), m: new Date().getMonth() };
    buildVocab();
    loadAll();
    $$('.tab').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    var t = 0;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(onResize, 150);
    });
    renderHeader();
    setView('today');
    // 보드와 같은 서비스워커를 써서 한자 앱도 오프라인에서 열리게 합니다.
    if ('serviceWorker' in navigator) {
      try { navigator.serviceWorker.register('../sw.js').catch(function () {}); } catch (e) {}
    }
    if ('speechSynthesis' in window) { try { window.speechSynthesis.getVoices(); } catch (e) {} }
  }

  init();
})();
