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

  /* 전용 화면 잠금
     seoyeon.html / seowoo.html 은 window.HANJA_LOCK 을 먼저 정해 두고,
     ?child=seoyeon&lock=1 처럼 주소로 열어도 그 아이 화면으로 고정합니다. */
  var LOCK = (function () {
    var want = null;
    try {
      var q = new URLSearchParams(window.location.search);
      if (q.get('lock') === '1') want = q.get('child');
    } catch (e) { want = null; }
    if (!want) want = window.HANJA_LOCK || null;
    return (want && PROFILES[want]) ? want : null;
  })();

  var state = { me: 'seoyeon', data: {}, view: 'today', vocabTag: 'all', vocabQ: '', cal: null };
  var runtime = { quiz: null, review: null, blankTries: {} };
  /* 2단계 4칸 연습판 — 칸별 획을 me|일차|한자 로 나눠 담아 둡니다. */
  var trace = { h: null, ink: {}, guide: true, cells: [], drawing: false, cur: null, cell: -1 };
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
    if (LOCK) {
      state.me = LOCK;
    } else {
      try { state.me = localStorage.getItem(ACTIVE_KEY) === 'seowoo' ? 'seowoo' : 'seoyeon'; } catch (e) { state.me = 'seoyeon'; }
    }
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
    if (LOCK) return; /* 전용 화면은 공용 화면의 '마지막에 본 아이'를 건드리지 않습니다. */
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
    var traced = (w.trace && typeof w.trace === 'object') ? Object.keys(w.trace).filter(function (h) { return !!w.trace[h]; }) : [];
    return {
      quiz: !!(w.quiz && w.quiz.done),
      quizCorrect: (w.quiz && w.quiz.correct) || 0,
      quizTotal: (w.quiz && w.quiz.total) || 0,
      stepACount: keys.length,
      stepA: keys.length >= day.chars.length,
      stepB: hasTargetSentence,
      traceCount: traced.length,
      traceAll: traced.length >= day.chars.length,
      review: !!(w.review && w.review.done),
      reviewCorrect: (w.review && w.review.correct) || 0,
      reviewTotal: (w.review && w.review.total) || 0,
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
    var st = dayStatus(p, day);
    $('#view-today').innerHTML = dayHead(day, rec) + stepRail(day, st) +
      '<div class="workbook">' + step1Section(day) + step2Section(day) + step3Section(day) +
      step4Section(day) + finishSection(day) + '</div>';
    if (trace.h && day.chars.indexOf(trace.h) < 0) trace.h = null;
    getTraceChar(day);
    setupTrace();
  }

  /* ---------- 단계 머리말·안내 레일 ---------- */
  function stepHead(n, title, hint) {
    return '<div class="stephead"><span class="stepno">' + n + '단계</span><div>' +
      '<h2>' + esc(title) + '</h2>' + (hint ? '<p>' + esc(hint) + '</p>' : '') + '</div></div>';
  }
  function stepRail(day, st) {
    var items = [
      { n: 1, label: '원리·어휘', done: true, note: day.chars.length + '자' },
      { n: 2, label: '4칸 쓰기', done: st.traceAll, note: st.traceCount + '/' + st.total },
      { n: 3, label: '퀴즈·주관식', done: !!(st.quiz && st.stepA && st.stepB), note: st.quiz && st.stepA && st.stepB ? '완료' : '' },
      { n: 4, label: '누적 복습', done: st.review, note: st.review ? st.reviewCorrect + '/' + st.reviewTotal : '' }
    ];
    return '<nav class="steprail" id="stepRail" aria-label="오늘 학습 4단계">' + items.map(function (it) {
      return '<a class="srail' + (it.done ? ' done' : '') + '" href="#step' + it.n + '">' +
        '<b>' + it.n + '</b><span>' + it.label + '</span>' +
        (it.n === 1 ? '<em>' + it.note + '</em>' : (it.done ? '<i>✓</i>' : '<em>' + it.note + '</em>')) + '</a>';
    }).join('') + '</nav>';
  }
  function updateStepRail(day) {
    var rail = $('#stepRail');
    if (!rail || !day) return;
    rail.outerHTML = stepRail(day, dayStatus(state.me, day));
  }
  function step1Section(day) {
    return '<section class="card step1" id="step1">' +
      stepHead(1, '원리 & 어휘', '한자가 어떻게 만들어졌는지 이야기로 읽고, 사회·과학 어휘까지 소리로 들어요.') +
      charsSection(day) + '</section>';
  }
  function step2Section(day) {
    return '<section class="card step2 trace" id="step2">' + traceSection(day) + '</section>';
  }
  function step3Section(day) {
    return '<section class="card step3" id="step3">' +
      stepHead(3, '단어·문장 퀴즈 & 주관식', '뜻·음 → 단어 속 한자 → 문장 빈칸 → 내 문장 만들기 순서로 풀어요.') +
      '<div class="s3grid">' + quizSection(day) + stepASection(day) + stepBSection(day) + '</div></section>';
  }
  function step4Section(day) {
    return '<section class="card step4" id="step4">' + reviewSection(day) + '</section>';
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
      (count >= total ? '<p class="done-banner">🎉 ' + total + '일 한자를 모두 마쳤어요! 정말 대단해요.</p>' :
        (rec ? '<p class="done-banner">✅ ' + fmtDate(rec.date) + '에 마친 날이에요 · 다시 복습해도 좋아요</p>' : '')) +
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
      '<p class="c-hint">💡 ' + esc(c.hint) + '</p></div></div>' +
      (c.origin ? '<div class="origin"><span class="otype">' + esc(c.origin.type) + '</span>' +
        '<p class="ostory">' + esc(c.origin.story) + '</p></div>' : '') +
      '<div class="c-words">' + words + '</div></article>';
  }
  function charsSection(day) {
    return '<div class="chars">' + day.chars.map(function (h) { return CHARS[h] ? charCard(CHARS[h]) : ''; }).join('') + '</div>';
  }

  /* ---------- 2단계: 4칸 반복 덧쓰기 (구몬 스타일) ---------- */
  function getTraceChar(day) {
    if (!trace.h || day.chars.indexOf(trace.h) < 0) trace.h = day.chars[0];
    return trace.h;
  }
  function inkKey(h) { return state.me + '|' + currentDay(state.me) + '|' + h; }
  function inkOf(h) {
    var k = inkKey(h);
    if (!trace.ink[k]) trace.ink[k] = [[], [], [], []];
    return trace.ink[k];
  }
  function inkCount(h) {
    var a = inkOf(h), n = 0;
    for (var i = 0; i < 4; i++) if (a[i] && a[i].length) n++;
    return n;
  }
  function traceSection(day) {
    var h = getTraceChar(day);
    var chips = day.chars.map(function (x) {
      return '<button type="button" data-act="trace-char" data-h="' + x + '" class="hanja' + (x === h ? ' on' : '') + '">' + x + '</button>';
    }).join('');
    var names = ['따라쓰기', '따라쓰기', '흐린 가이드', '혼자쓰기'];
    var cells = [0, 1, 2, 3].map(function (i) {
      return '<div class="tcellwrap" data-cell="' + i + '">' +
        '<canvas class="tcell" data-cell="' + i + '" aria-label="' + esc(h) + ' ' + names[i] + ' 칸"></canvas>' +
        '<span class="tcellno">' + '①②③④'.charAt(i) + ' ' + names[i] + '</span>' +
        '<button type="button" class="tcellclear" data-act="cell-clear" data-cell="' + i + '" aria-label="' + names[i] + ' 칸 지우기">🧽</button>' +
        '</div>';
    }).join('');
    return stepHead(2, '4칸 반복 덧쓰기', '①②는 연한 글씨를 따라 쓰고, ③④는 혼자 써 보세요. 4칸을 다 채우면 배지가 켜져요.') +
      '<div class="chead tchead"><div class="tchips" id="traceChips">' + chips + '</div>' +
      '<span class="tracebadge" id="traceBadge">4칸 중 0칸</span></div>' +
      '<div class="cells" id="traceCells">' + cells + '</div>' +
      '<div class="tools">' +
      '<button type="button" data-act="trace-clear">🧽 전체 지우기</button>' +
      '<button type="button" data-act="trace-guide" aria-pressed="true" id="guideBtn">👀 가이드 켬</button>' +
      '<button type="button" class="narrow" data-act="trace-prev" aria-label="이전 한자">←</button>' +
      '<button type="button" class="narrow" data-act="trace-next" aria-label="다음 한자">→</button>' +
      '</div>';
  }
  function cellByIndex(i) {
    for (var k = 0; k < trace.cells.length; k++) if (trace.cells[k].idx === i) return trace.cells[k];
    return null;
  }
  function setupTrace() {
    var wraps = $$('#traceCells .tcellwrap');
    if (!wraps.length) return;
    trace.cells = [];
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    wraps.forEach(function (wrap) {
      var cv = wrap.querySelector('canvas');
      if (!cv) return;
      var size = Math.max(96, Math.round(wrap.clientWidth || 150));
      cv.width = Math.round(size * dpr);
      cv.height = Math.round(size * dpr);
      var ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      trace.cells.push({ cv: cv, ctx: ctx, size: size, idx: +cv.getAttribute('data-cell') });
      if (!cv.__bound) {
        cv.__bound = true;
        cv.addEventListener('pointerdown', function (e) {
          var cell = cellByIndex(+cv.getAttribute('data-cell'));
          if (cell) startStroke(e, cell);
        });
        cv.addEventListener('pointermove', moveStroke);
        cv.addEventListener('pointerup', endStroke);
        cv.addEventListener('pointercancel', endStroke);
        cv.addEventListener('pointerleave', function (e) {
          if (trace.drawing && trace.cell === +cv.getAttribute('data-cell')) endStroke(e);
        });
      }
    });
    redrawCells();
    updateTraceBadge();
  }
  function drawCell(cell) {
    var s = cell.size, ctx = cell.ctx;
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = '#FFFDF8'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#E7D3C0'; ctx.lineWidth = 1.5; ctx.strokeRect(1, 1, s - 2, s - 2);
    ctx.save();
    ctx.setLineDash([6, 6]); ctx.strokeStyle = '#E6C3AC'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s); ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2); ctx.stroke();
    ctx.setLineDash([2, 8]); ctx.strokeStyle = '#F3DFD0';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s, s); ctx.moveTo(s, 0); ctx.lineTo(0, s); ctx.stroke();
    ctx.restore();
    var alpha = cell.idx < 2 ? 0.16 : (cell.idx === 2 ? 0.06 : 0);
    if (trace.guide && trace.h && alpha > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(120,88,64,' + alpha + ')';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 ' + Math.round(s * 0.74) + 'px "Nanum Myeongjo","Noto Serif KR","Batang",serif';
      ctx.fillText(trace.h, s / 2, s * 0.53);
      ctx.restore();
    }
    var strokes = (trace.h && inkOf(trace.h)[cell.idx]) || [];
    ctx.strokeStyle = '#3E2E24'; ctx.fillStyle = '#3E2E24';
    ctx.lineWidth = Math.max(4, s * 0.045);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    strokes.forEach(function (st) {
      if (!st.length) return;
      if (st.length === 1) {
        ctx.beginPath(); ctx.arc(st[0].x, st[0].y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
        return;
      }
      ctx.beginPath(); ctx.moveTo(st[0].x, st[0].y);
      for (var i = 1; i < st.length; i++) ctx.lineTo(st[i].x, st[i].y);
      ctx.stroke();
    });
  }
  function redrawCells() { trace.cells.forEach(drawCell); }
  function tracePoint(cell, e) {
    var r = cell.cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (cell.size / r.width), y: (e.clientY - r.top) * (cell.size / r.height) };
  }
  function startStroke(e, cell) {
    if (!trace.h) return;
    e.preventDefault();
    trace.drawing = true;
    trace.cell = cell.idx;
    try { cell.cv.setPointerCapture(e.pointerId); } catch (err) {}
    var p = tracePoint(cell, e);
    trace.cur = [p];
    inkOf(trace.h)[cell.idx].push(trace.cur);
    var ctx = cell.ctx;
    ctx.fillStyle = '#3E2E24';
    ctx.lineWidth = Math.max(4, cell.size * 0.045);
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, ctx.lineWidth / 2), 0, Math.PI * 2); ctx.fill();
  }
  function moveStroke(e) {
    if (!trace.drawing || !trace.cur) return;
    var cell = cellByIndex(trace.cell);
    if (!cell) return;
    e.preventDefault();
    var p = tracePoint(cell, e), prev = trace.cur[trace.cur.length - 1];
    if (Math.abs(prev.x - p.x) + Math.abs(prev.y - p.y) < 0.7) return;
    trace.cur.push(p);
    var ctx = cell.ctx;
    ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  function endStroke() {
    if (!trace.drawing) return;
    trace.drawing = false; trace.cur = null;
    updateTraceBadge();
  }
  function updateTraceBadge() {
    var day = dayNow();
    if (!day || !trace.h) return;
    var h = trace.h, n = inkCount(h);
    var rec = work(day.day);
    rec.trace = rec.trace || {};
    var saved = !!rec.trace[h];
    if (n === 4 && !saved) {
      rec.trace[h] = true;
      saved = true;
      save(state.me);
      toast(h + ' 4칸 완성! 쓰기 배지를 받았어요.');
    }
    var badge = $('#traceBadge');
    if (badge) {
      badge.textContent = n === 4 ? '✅ 4칸 완성 · 쓰기 배지'
        : (saved ? '✅ 쓰기 배지 있음 · 이번엔 ' + n + '칸' : '4칸 중 ' + n + '칸 썼어요');
      badge.classList.toggle('on', n === 4 || saved);
    }
    var firstEmpty = -1;
    for (var i = 0; i < 4; i++) if (!(inkOf(h)[i] || []).length) { firstEmpty = i; break; }
    $$('#traceCells .tcellwrap').forEach(function (w) {
      var idx = +w.getAttribute('data-cell');
      w.classList.toggle('inked', (inkOf(h)[idx] || []).length > 0);
      w.classList.toggle('next', idx === firstEmpty);
    });
    updateStepRail(day);
    updateFinish(day);
  }
  /* 칸을 지우면 그 글자의 쓰기 배지도 함께 지웁니다(새로고침만으로는 지워지지 않아요). */
  function dropTraceRecord(h) {
    var day = dayNow(); if (!day) return;
    var rec = work(day.day);
    if (rec.trace && rec.trace[h]) { delete rec.trace[h]; save(state.me); }
  }
  function clearCell(i) {
    if (!trace.h) return;
    inkOf(trace.h)[i] = [];
    dropTraceRecord(trace.h);
    redrawCells();
    updateTraceBadge();
  }
  function clearTrace() {
    if (!trace.h) return;
    trace.ink[inkKey(trace.h)] = [[], [], [], []];
    dropTraceRecord(trace.h);
    redrawCells();
    updateTraceBadge();
    toast(trace.h + ' 4칸을 모두 지웠어요.');
  }
  function setTraceChar(h) {
    trace.h = h;
    $$('#traceChips button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-h') === h); });
    var names = ['따라쓰기', '따라쓰기', '흐린 가이드', '혼자쓰기'];
    $$('#traceCells canvas').forEach(function (cv) {
      cv.setAttribute('aria-label', h + ' ' + names[+cv.getAttribute('data-cell')] + ' 칸');
    });
    redrawCells();
    updateTraceBadge();
  }
  function moveTrace(dir) {
    var day = dayNow(); if (!day) return;
    var i = day.chars.indexOf(trace.h);
    if (i < 0) i = 0;
    i = (i + dir + day.chars.length) % day.chars.length;
    setTraceChar(day.chars[i]);
  }

  /* ---------- 3단계: 확인 퀴즈 · 4단계: 누적 복습 ---------- */
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
  function qEum(c, pools) {
    return { kind: 'eum', label: '뜻·음 맞추기 · 음(소리)', text: '이 한자의 음은 무엇일까요?', big: c.h, answer: c.eum, options: opts4(c.eum, pools.eum) };
  }
  function qHun(c, pools) {
    return { kind: 'hun', label: '뜻·음 맞추기 · 뜻(훈)', text: '이 한자의 뜻은 무엇일까요?', big: c.h, answer: c.hun, options: opts4(c.hun, pools.hun) };
  }
  function qHanja(c, pools) {
    return { kind: 'hanja', label: '뜻·음 맞추기 · 한자 고르기', text: '다음 뜻과 음에 맞는 한자를 고르세요.', sub: c.hun + ' ' + c.eum, answer: c.h, options: opts4(c.h, pools.hanja) };
  }
  function qRead(c, pools) {
    var w = pickWord(c); if (!w) return null;
    return { kind: 'read', label: '한자어 읽기', text: '이 한자어를 어떻게 읽을까요?', big: w.w, answer: w.r, options: opts4(w.r, pools.read) };
  }
  function qMean(c, pools) {
    var w = c.words.filter(function (x) { return !!x.tag; })[0] || pickWord(c);
    if (!w) return null;
    return { kind: 'mean', label: (w.tag || '교과') + ' 어휘 뜻', text: '‘' + w.w + '(' + w.r + ')’의 뜻으로 알맞은 것은?', answer: w.mean, options: opts4(w.mean, pools.mean) };
  }
  /* 단어 속 빈칸에 들어갈 한자 고르기 — 예: ‘화산’ → ○山 */
  var HANJA_VAR = { '產': '産', '産': '產' };  /* 生産처럼 자형이 다른 경우도 같은 글자로 봅니다. */
  function wordHasChar(w, h) {
    if (w.indexOf(h) >= 0) return h;
    var v = HANJA_VAR[h];
    if (v && w.indexOf(v) >= 0) return v;
    return null;
  }
  function qWordHanja(c, pools) {
    var cands = c.words.filter(function (w) { return w.w.length >= 2 && wordHasChar(w.w, c.h); });
    if (!cands.length) return null;
    var w = pickOne(cands);
    var found = wordHasChar(w.w, c.h);
    var masked = w.w.replace(found, '○');
    return {
      kind: 'word', label: '단어 속 한자 맞추기',
      text: '‘' + w.r + '’을 한자로 쓰면 ' + masked + '이에요. ○에 들어갈 한자는?',
      big: masked, sub: w.mean + (w.tag ? ' · ' + w.tag : ''),
      answer: c.h, options: opts4(c.h, pools.hanja)
    };
  }
  function dedupeQ(list) {
    var seen = {}, out = [];
    list.forEach(function (q) {
      if (!q) return;
      var k = q.text + '|' + q.answer;
      if (seen[k]) return;
      seen[k] = 1; out.push(q);
    });
    return out;
  }
  function buildQuiz(day) {
    var pools = allPools(), eums = [], words = [], others = [];
    day.chars.forEach(function (h, i) {
      var c = CHARS[h]; if (!c) return;
      eums.push(qEum(c, pools));
      var wq = qWordHanja(c, pools); if (wq) words.push(wq);
      if (i % 2 === 0) others.push(qHun(c, pools));
      else { var r = qRead(c, pools); if (r) others.push(r); }
    });
    var tagged = null;
    day.chars.forEach(function (h) {
      var c = CHARS[h]; if (!c || tagged) return;
      var w = c.words.filter(function (x) { return !!x.tag; })[0];
      if (w) tagged = qMean(c, pools);
    });
    if (tagged) others.push(tagged);
    eums = shuffle(dedupeQ(eums)); words = shuffle(dedupeQ(words)); others = shuffle(dedupeQ(others));
    var core = [];
    if (words.length) core.push(words.shift());
    if (eums.length) core.push(eums.shift());
    var rest = shuffle(eums.concat(words).concat(others));
    return shuffle(core.concat(rest.slice(0, Math.max(0, 6 - core.length)))).slice(0, 6);
  }
  function makeQState(key, qs) {
    return { key: key, qs: qs, i: 0, correct: 0, done: false, locked: false, picked: -1, msg: '', msgOk: false };
  }
  function getQuiz(day) {
    var key = state.me + '-' + day.day;
    if (!runtime.quiz || runtime.quiz.key !== key) runtime.quiz = makeQState(key, buildQuiz(day));
    return runtime.quiz;
  }
  function getReview(day) {
    var key = state.me + '-r-' + day.day;
    if (!runtime.review || runtime.review.key !== key) runtime.review = makeQState(key, buildReview(day));
    return runtime.review;
  }
  function qBodyHTML(q, prefix) {
    if (!q.qs.length) return '<p class="emptybox">문제를 만들지 못했어요. 잠시 뒤 다시 열어 주세요.</p>';
    if (q.done) {
      var rate = q.qs.length ? q.correct / q.qs.length : 0;
      return '<div class="qdone"><div class="qscore">' + q.correct + '<small>/ ' + q.qs.length + ' 문제</small></div>' +
        '<p>' + (rate >= 0.8 ? '아주 훌륭해요! 한자를 제법 잘 알아요.' : rate >= 0.5 ? '좋아요! 틀린 문제는 위 한자 카드에서 다시 봐요.' : '한 번 더 풀면서 익혀 볼까요?') + '</p>' +
        '<button type="button" data-act="' + prefix + '-restart">한 번 더 풀기</button></div>';
    }
    var cur = q.qs[q.i];
    if (!cur) return '<p class="emptybox">문제를 만들지 못했어요.</p>';
    var pct = Math.round(((q.i + (q.locked ? 1 : 0)) / q.qs.length) * 100);
    var opts = cur.options.map(function (o, i) {
      var cls = '';
      if (q.locked) {
        if (o === cur.answer) cls = ' ok';
        else if (i === q.picked) cls = ' bad';
      }
      return '<button type="button" data-act="' + prefix + '-opt" data-i="' + i + '"' + (q.locked ? ' disabled' : '') + ' class="' + cls + '">' + esc(o) + '</button>';
    }).join('');
    var big = '';
    if (cur.big) big = '<div class="qbig hanja' + (cur.kind === 'read' || cur.kind === 'word' ? ' word' : '') + '">' + esc(cur.big) + '</div>';
    if (cur.sub) big += '<p class="qsub">' + esc(cur.sub) + '</p>';
    var src = cur.src ? '<span class="srctag">' + esc(cur.src) + '</span>' : '';
    var msg = q.msg ? '<p class="qmsg ' + (q.msgOk ? 'ok' : 'bad') + '">' + esc(q.msg) + '</p>' : '<p class="qmsg">정답이라고 생각하는 것을 눌러 보세요.</p>';
    var next = q.locked ? '<button type="button" class="qnext" data-act="' + prefix + '-next">' + (q.i + 1 >= q.qs.length ? '결과 보기 →' : '다음 문제 →') + '</button>' : '';
    return '<div class="qbar"><i style="width:' + pct + '%"></i></div>' +
      '<p class="qtype">' + src + esc(cur.label) + '</p>' +
      '<p class="qtext">' + esc(cur.text) + '</p>' + big +
      '<div class="opts">' + opts + '</div>' + msg + next;
  }
  function quizHead(day) {
    var q = getQuiz(day);
    return '<div class="chead"><h2>🧠 ① 뜻·음·단어 퀴즈</h2><span class="pill">' +
      (q.done ? '완료' : (q.i + 1) + ' / ' + q.qs.length) + '</span></div>';
  }
  function quizSection(day) {
    return '<div class="panel" id="quizCard">' + quizHead(day) + qBodyHTML(getQuiz(day), 'quiz') + '</div>';
  }
  function renderQuizCard(day) {
    var el = $('#quizCard');
    if (el) el.innerHTML = quizHead(day) + qBodyHTML(getQuiz(day), 'quiz');
  }
  /* 4단계 — 오늘 + 최근 일차를 섞은 누적 복습 */
  function reviewItems(day) {
    var prevs = DAYS.filter(function (d) { return d.day < day.day; }).slice(-2);
    var today = day.chars.map(function (h) { return { h: h, day: day.day }; });
    var prev = [];
    prevs.forEach(function (d) { d.chars.forEach(function (h) { prev.push({ h: h, day: d.day }); }); });
    return { today: today, prev: prev, first: prevs.length === 0 };
  }
  function makeQ(item, kind, pools) {
    var c = CHARS[item.h];
    if (!c) return null;
    if (kind === 'eum') return qEum(c, pools);
    if (kind === 'hun') return qHun(c, pools);
    if (kind === 'hanja') return qHanja(c, pools);
    if (kind === 'read') return qRead(c, pools);
    if (kind === 'mean') return qMean(c, pools);
    if (kind === 'word') return qWordHanja(c, pools);
    return null;
  }
  function buildReview(day) {
    var pools = allPools(), it = reviewItems(day);
    var kinds = ['eum', 'hun', 'word', 'read', 'hanja', 'word'];
    var qs = [], used = {};
    function add(item, kind) {
      if (!item) return false;
      var q = makeQ(item, kind, pools);
      if (!q) return false;
      var k = q.text + '|' + q.answer;
      if (used[k]) return false;
      used[k] = 1;
      q.src = item.day === day.day ? '오늘' : (day.day - item.day) + '일 전';
      qs.push(q);
      return true;
    }
    var want = it.first ? 4 : 6;
    var wantToday = it.first ? 4 : 3;
    var g = 0, nToday = 0;
    while (nToday < wantToday && g++ < 80) {
      if (add(pickOne(it.today), pickOne(kinds))) nToday++;
    }
    g = 0;
    while (qs.length < want && g++ < 120) {
      add(pickOne(it.prev.length ? it.prev : it.today), pickOne(kinds));
    }
    return shuffle(qs).slice(0, want);
  }
  function reviewHead(day) {
    var q = getReview(day), it = reviewItems(day);
    return stepHead(4, '누적 복습 체크업',
      it.first
        ? '첫날이라 오늘 배운 한자로 4문제를 풀어요. 배운 글자를 잊지 않게 한 번 더!'
        : '오늘 배운 한자 + 최근 ' + (it.prev.length ? '2일' : '1일') + '에 배운 한자를 섞어 ' + q.qs.length + '문제를 풀어요.') +
      '<div class="chead"><h2>🔁 ' + (it.first ? '오늘 한자 복습' : '오늘 + 지난 한자 복습') + '</h2><span class="pill">' +
      (q.done ? '완료' : (q.i + 1) + ' / ' + q.qs.length) + '</span></div>';
  }
  function reviewSection(day) {
    return reviewHead(day) + '<div class="panel" id="reviewCard">' + qBodyHTML(getReview(day), 'review') + '</div>';
  }
  function renderReviewCard(day) {
    var el = $('#reviewCard');
    if (el) el.innerHTML = qBodyHTML(getReview(day), 'review');
    var head = $('#step4 .chead .pill');
    var q = getReview(day);
    if (head) head.textContent = q.done ? '완료' : (q.i + 1) + ' / ' + q.qs.length;
  }
  function activeQ(prefix) { return prefix === 'review' ? runtime.review : runtime.quiz; }
  function answerQ(prefix, i) {
    var day = dayNow(), q = activeQ(prefix);
    if (!day || !q || q.done || q.locked) return;
    var cur = q.qs[q.i]; if (!cur) return;
    q.locked = true; q.picked = i;
    var ok = cur.options[i] === cur.answer;
    if (ok) q.correct++;
    q.msgOk = ok;
    q.msg = ok ? pickOne(['정답이에요! 👏', '딱 맞았어요!', '아주 잘했어요! 🌟']) :
      '아쉬워요. 정답은 ‘' + cur.answer + '’이에요.';
    renderQ(prefix, day);
  }
  function nextQ(prefix) {
    var day = dayNow(), q = activeQ(prefix);
    if (!day || !q || !q.locked) return;
    q.i++;
    if (q.i >= q.qs.length) {
      q.done = true;
      var w = work(day.day);
      if (prefix === 'review') w.review = { done: true, correct: q.correct, total: q.qs.length };
      else w.quiz = { done: true, correct: q.correct, total: q.qs.length };
      save(state.me);
      if (prefix === 'review') toast('복습 완료! 배운 한자를 잘 지켰어요.');
    } else {
      q.locked = false; q.picked = -1; q.msg = ''; q.msgOk = false;
    }
    renderQ(prefix, day);
    updateFinish(day);
  }
  function restartQ(prefix) {
    var day = dayNow(); if (!day) return;
    if (prefix === 'review') runtime.review = null; else runtime.quiz = null;
    renderQ(prefix, day);
    updateFinish(day);
  }
  function renderQ(prefix, day) {
    if (prefix === 'review') renderReviewCard(day);
    else renderQuizCard(day);
    updateStepRail(day);
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
    return '<div class="panel" id="stepA"><div class="chead"><h2>📝 ② 문장 빈칸 채우기</h2><span class="pill">주관식</span></div>' +
      '<p class="lead">오늘 배운 한자어를 직접 타이핑해 보세요. 한자로 써도 맞아요.</p>' +
      '<div class="blanks">' + items + '</div></div>';
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
    return '<div class="panel" id="stepB"><div class="chead"><h2>✏️ ③ 한자로 문장 만들기</h2><span class="pill">주관식</span></div>' +
      '<p class="lead">오늘 배운 한자나 한자어를 넣어 짧은 문장을 만들어 보세요. 단어를 누르면 입력칸에 들어가요.</p>' +
      '<div class="chips"><span class="chiplabel">넣을 말:</span>' + chips + '</div>' +
      '<textarea id="freeText" rows="3" placeholder="예: 화산이 폭발하면 뜨거운 용암이 흘러나와요." aria-label="내가 만든 문장">' + esc(text) + '</textarea>' +
      '<div class="freefoot"><span id="charCount">' + text.replace(/\s/g, '').length + '자</span>' +
      '<button type="button" data-act="free-submit">문장 확인하기</button></div>' +
      '<div class="feedback" id="freeFeedback"' + (sb.saved ? '' : ' hidden') + '>' + (sb.saved ? note : '') + '</div></div>';
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
    var all = st.quiz && st.stepA && st.stepB && st.traceAll && st.review;
    var li = function (ok, label, note) {
      return '<li class="' + (ok ? 'ok' : '') + '"><span class="ck">' + (ok ? '✓' : '') + '</span>' + label +
        '<span class="small">' + (note || '') + '</span></li>';
    };
    return '<div class="chead"><h2>🏅 오늘의 도장</h2><span class="pill">⭐ 3개</span></div>' +
      '<ul class="checklist">' +
      li(st.traceAll, '4칸 반복 덧쓰기', st.traceCount + ' / ' + st.total + '자') +
      li(st.quiz, '확인 퀴즈', st.quiz ? st.quizCorrect + ' / ' + st.quizTotal + ' 정답' : '아직') +
      li(st.stepA, '문장 빈칸 채우기', st.stepACount + ' / ' + st.total) +
      li(st.stepB, '한자로 문장 만들기', st.stepB ? '저장했어요' : '아직') +
      li(st.review, '누적 복습', st.review ? st.reviewCorrect + ' / ' + st.reviewTotal : '아직') +
      '</ul>' +
      '<button type="button" class="stampbtn" data-act="stamp"' + (all ? '' : ' disabled') + '>' +
      (all ? '오늘 학습 마치기 ⭐' : '조금만 더! 남은 단계를 마쳐요') + '</button>' +
      '<p class="note">4단계를 모두 마치면 도장과 별 3개를 받아요.</p>';
  }
  function updateFinish(day) {
    var el = $('#finishCard');
    if (el) el.innerHTML = finishInner(day);
    updateStepRail(day);
  }
  function stampDay() {
    var p = state.me, day = dayNow(); if (!day) return;
    var d = state.data[p];
    if (d.done[day.day]) return;
    var st = dayStatus(p, day);
    if (!(st.quiz && st.stepA && st.stepB && st.traceAll && st.review)) {
      toast('4단계를 모두 마치면 도장을 받을 수 있어요.');
      return;
    }
    d.done[day.day] = {
      date: todayStr(), stars: 3,
      quiz: { correct: st.quizCorrect, total: st.quizTotal },
      review: { correct: st.reviewCorrect, total: st.reviewTotal },
      trace: st.traceCount,
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
    var lastDate = '';
    $('#sentList').innerHTML = list.map(function (s) {
      var head = s.date !== lastDate ? '<p class="sent-date">' + fmtDate(s.date) + '</p>' : '';
      lastDate = s.date;
      return head + '<article class="sent"><div class="sent-top"><span class="sday">' + s.day + '일차</span>' +
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
    if (LOCK) { toast(PROFILES[LOCK].name + ' 전용 화면이에요. 다른 아이는 자기 화면에서 열어 주세요.'); return; }
    if (!PROFILES[p] || p === state.me) return;
    state.me = p;
    saveActive();
    runtime.quiz = null;
    runtime.review = null;
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
      case 'cell-clear': clearCell(+el.getAttribute('data-cell')); break;
      case 'trace-clear': clearTrace(); break;
      case 'trace-guide':
        trace.guide = !trace.guide;
        el.setAttribute('aria-pressed', trace.guide ? 'true' : 'false');
        el.textContent = trace.guide ? '👀 가이드 켬' : '🙈 가이드 끔';
        redrawCells();
        break;
      case 'trace-prev': moveTrace(-1); break;
      case 'trace-next': moveTrace(1); break;
      case 'quiz-opt': answerQ('quiz', +el.getAttribute('data-i')); break;
      case 'quiz-next': nextQ('quiz'); break;
      case 'quiz-restart': restartQ('quiz'); break;
      case 'review-opt': answerQ('review', +el.getAttribute('data-i')); break;
      case 'review-next': nextQ('review'); break;
      case 'review-restart': restartQ('review'); break;
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
      runtime.review = null;
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
    var wrap = $('#traceCells .tcellwrap');
    if (!wrap || !trace.cells.length) return;
    var avail = Math.round(wrap.clientWidth || 0);
    if (avail && Math.abs(avail - trace.cells[0].size) > 2) setupTrace();
  }

  /* ---------- 전용 화면 표시 ---------- */
  function applyLock() {
    if (!LOCK) {
      var links = $('#modeLinks');
      if (links) links.hidden = false;
      return;
    }
    var pr = PROFILES[LOCK];
    document.documentElement.setAttribute('data-child', LOCK);
    var who = $('#who');
    if (who) {
      who.classList.add('locked');
      who.setAttribute('aria-label', pr.name + ' 전용 화면');
      who.innerHTML = '<span class="pole" data-p="' + LOCK + '"><span class="dot" aria-hidden="true"></span>' +
        pr.name + ' 전용</span>';
    }
    var links = $('#modeLinks');
    if (links) links.hidden = true;
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
    applyLock();
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
