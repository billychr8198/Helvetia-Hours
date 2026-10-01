/* =========================================================
   Helvetia Hours — app logic
   Timer accuracy: the timer never counts down step by step. It stores
   the exact start time and computes the remaining time from the real
   clock (Date.now()). A tiny Web Worker sends a heartbeat 4 times per
   second; workers are not slowed down like hidden tabs are, so the
   session ends on time and the alarm plays even when minimized.
   ========================================================= */
(function () {
  'use strict';
  var D = window.HH_DATA;
  var MIN = 60000, HOUR = 3600000;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function pickOne(a) { return a[Math.floor(Math.random() * a.length)]; }
  function now() { return Date.now(); }

  /* ---------------- storage ---------------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('hh.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('hh.' + k, JSON.stringify(v)); } catch (e) {} },
    clearAll: function () { try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('hh.') === 0) localStorage.removeItem(k); }); } catch (e) {} }
  };

  /* ---------------- formatting ---------------- */
  function fmtClock(ms) { var s = Math.ceil(ms / 1000), m = Math.floor(s / 60); return pad(m) + ':' + pad(s % 60); }
  function fmtDur(ms) {
    var m = Math.floor(ms / MIN), h = Math.floor(m / 60); m = m % 60;
    if (h && m) return h + ' h ' + m + ' min';
    if (h) return h + ' h';
    return m + ' min';
  }
  function fmtTs(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(s);
  }
  function fmtTOD(d) {
    var h = d.getHours(), m = d.getMinutes();
    if (S.clock24) return pad(h) + ':' + pad(m);
    return ((h % 12) || 12) + ':' + pad(m) + (h < 12 ? ' am' : ' pm');
  }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  /* ---------------- settings ---------------- */
  var small = window.matchMedia('(max-width: 720px)').matches || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  var DEFAULTS = {
    focusMin: 60, shortMin: 10, longMin: 40, longInterval: 4,
    autoStartBreaks: false, autoStartFocus: false, countPartial: true,
    autoCheckTasks: true, autoSwitchTasks: true,
    alarmVolume: 70, alarmLength: 'full', tickSound: 'none', tickVolume: 40,
    sceneQuality: small ? 'light' : 'balanced', clock24: true, notifications: false
  };
  var S = Object.assign({}, DEFAULTS, store.get('settings', {}));
  function saveSettings() { store.set('settings', S); }
  function durFor(mode) { return (mode === 'focus' ? S.focusMin : mode === 'short' ? S.shortMin : S.longMin) * MIN; }

  /* ---------------- data ---------------- */
  var LOG = store.get('log', []);
  if (!Array.isArray(LOG)) LOG = [];
  var META = Object.assign({ celebrated: 0, watched: {}, askedNotify: false }, store.get('meta', {}));
  var TASKS = Object.assign({ list: [], activeId: null }, store.get('tasks', {}));
  var totalCache = null;
  function total() { if (totalCache == null) totalCache = LOG.reduce(function (a, e) { return a + (e.ms || 0); }, 0); return totalCache; }
  function addLog(e) { LOG.push(e); totalCache = null; store.set('log', LOG); }
  function saveMeta() { store.set('meta', META); }
  function saveTasks() { store.set('tasks', TASKS); }
  function activeTask() { for (var i = 0; i < TASKS.list.length; i++) { var t = TASKS.list[i]; if (t.id === TASKS.activeId && !t.done) return t; } return null; }

  /* ---------------- timer state ---------------- */
  var TS = Object.assign({ mode: 'focus', duration: durFor('focus'), elapsed: 0, runningSince: null, startedAt: null, cycle: 0 }, store.get('timer', {}));
  if (!TS.duration || !{ focus: 1, short: 1, long: 1 }[TS.mode]) { TS.mode = 'focus'; TS.duration = durFor('focus'); }
  function saveTimer() { store.set('timer', TS); }
  function elapsedNow() { return TS.elapsed + (TS.runningSince ? now() - TS.runningSince : 0); }
  function remaining() { return Math.max(0, TS.duration - elapsedNow()); }
  function running() { return !!TS.runningSince; }
  function started() { return TS.startedAt != null; }

  var MODES = {
    focus: { label: 'Focus', status: 'Time to climb!', title: 'Time to climb!' },
    short: { label: 'Gipfeli break', status: 'Gipfeli break. Stand up, stretch and sip some water.', title: 'Gipfeli break!' },
    long: { label: 'Fondue break', status: 'Fondue break. You earned a long rest.', title: 'Fondue break!' }
  };
  var CHEERS = [
    'Super gmacht! That is Swiss German for “great job”.',
    'Bien joué ! That is French for “well played”.',
    'Ben fatto! That is Italian for “well done”.',
    'Bun lavur! That is Romansh for “good work”.',
    'Precise like a Swiss watch.',
    'Another step closer to the summit.'
  ];

  /* ---------------- elements ---------------- */
  var body = document.body;
  var el = {
    time: $('#time-text'), display: $('#time-display'), timeEdit: $('#time-edit'), timeEditInput: $('#time-edit-input'),
    start: $('#btn-start'), skip: $('#btn-skip'), reset: $('#btn-reset'), round: $('#status-round'), status: $('#status-text'),
    bar: $('#session-bar-fill'), climbLine: $('#climb-line'), climbDone: $('#climb-done'), climbArea: $('#climb-area'), climbClip: $('#climb-clip-rect'), flag: $('#climb-flag'),
    taskList: $('#task-list'), addTask: $('#btn-add-task'), formSlot: $('#task-form-slot'), summary: $('#task-summary'), taskMenu: $('#task-menu'), taskMenuBtn: $('#btn-task-menu'),
    next: $('#next-wonder'), grid: $('#wonder-grid'), toasts: $('#toasts'), pill: $('#explore-pill'), pillTime: $('#explore-time'), pillToggle: $('#explore-toggle')
  };

  /* =========================================================
     Ticker (Web Worker heartbeat with a fallback)
     ========================================================= */
  var lastText = '', lastTitle = '', lastNextRender = 0;
  function startTicker() {
    var ok = false;
    try {
      var url = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(1)},250);'], { type: 'application/javascript' }));
      var w = new Worker(url); w.onmessage = tick; ok = true;
    } catch (e) { ok = false; }
    if (!ok) setInterval(tick, 250);
    document.addEventListener('visibilitychange', function () { tick(); if (!document.hidden) { renderAll(); flushPending(); } });
    window.addEventListener('focus', tick);
    window.addEventListener('pageshow', tick);
  }
  function tick() {
    var guard = 0;
    while (running() && remaining() <= 0 && guard++ < 24) {
      completeSession(TS.runningSince + (TS.duration - TS.elapsed), {});
    }
    renderTimer();
    alarmTick();
    ambientTick();
  }

  /* =========================================================
     Timer actions
     ========================================================= */
  function setSession(mode) {
    TS.mode = mode; TS.duration = durFor(mode); TS.elapsed = 0; TS.runningSince = null; TS.startedAt = null;
    applyMode();
  }
  function nextModeAfterFocus() {
    TS.cycle = (TS.cycle || 0) + 1;
    if (TS.cycle >= S.longInterval) { TS.cycle = 0; return 'long'; }
    return 'short';
  }
  function startTimer() {
    unlockAudio();
    if (running()) return;
    if (TS.duration - TS.elapsed <= 0) setSession(TS.mode);
    TS.runningSince = now();
    if (!started()) TS.startedAt = TS.runningSince;
    saveTimer(); softClick(); renderAll(); maybeAskNotify();
  }
  function pauseTimer() {
    if (!running()) return;
    TS.elapsed = elapsedNow(); TS.runningSince = null;
    saveTimer(); softClick(); renderAll();
  }
  function toggleTimer() { if (running()) pauseTimer(); else startTimer(); }

  function completeSession(endAt, opts) {
    opts = opts || {};
    var mode = TS.mode, before = total(), next;
    if (mode === 'focus') {
      var t = activeTask();
      addLog({ id: uid(), start: TS.startedAt || endAt - TS.duration, end: endAt, ms: TS.duration, task: t ? t.title : '', taskId: t ? t.id : null, done: true });
      if (t) {
        t.act = (t.act || 0) + 1;
        if (S.autoCheckTasks && t.act >= t.est) { t.done = true; if (S.autoSwitchTasks) switchToNextTask(t.id); }
        saveTasks();
      }
      next = nextModeAfterFocus();
    } else next = 'focus';
    setSession(next);
    var auto = !opts.recovery && ((next !== 'focus' && S.autoStartBreaks) || (next === 'focus' && S.autoStartFocus));
    if (auto) { TS.runningSince = endAt; TS.startedAt = endAt; }
    saveTimer();
    if (!opts.recovery) { playAlarm(); notifyEnd(mode, next); }
    var msg;
    if (opts.recovery) msg = mode === 'focus' ? 'Welcome back! Your focus session finished while the page was closed, and ' + fmtDur(durFor('focus')) + ' was counted.' : 'Welcome back! Your break finished while the page was closed.';
    else if (mode === 'focus') msg = 'Climb complete. ' + pickOne(CHEERS) + ' ' + (next === 'long' ? 'Enjoy your Fondue break.' : 'Enjoy your Gipfeli break.');
    else msg = 'Break is over. Ready for the next climb?';
    toast(esc(msg), !auto && !opts.recovery ? { action: { label: 'Start', fn: startTimer }, timeout: 9000 } : { timeout: 7000 });
    afterProgress(before);
    renderAll();
  }

  function creditPartial() {
    if (TS.mode !== 'focus' || !started()) return 0;
    var e = Math.min(elapsedNow(), TS.duration);
    if (!S.countPartial || e < MIN) return 0;
    var before = total(), t = activeTask();
    addLog({ id: uid(), start: TS.startedAt, end: now(), ms: Math.round(e), task: t ? t.title : '', taskId: t ? t.id : null, done: false });
    afterProgress(before);
    return e;
  }
  function partialText() {
    return S.countPartial ? 'The ' + fmtDur(elapsedNow()) + ' you focused still count toward your next wonder.' : 'Unfinished minutes do not count. You can change this in Settings.';
  }
  function skipSession() {
    var go = function () {
      var mode = TS.mode, wasStarted = started(), credited = creditPartial();
      var next = mode === 'focus' ? (wasStarted ? nextModeAfterFocus() : 'short') : 'focus';
      setSession(next); saveTimer(); renderAll();
      if (credited) toast('Logged ' + esc(fmtDur(credited)) + ' of focus.');
    };
    if (TS.mode === 'focus' && started() && elapsedNow() >= MIN) {
      confirmDialog('Finish this climb now?', partialText(), 'Finish now').then(function (ok) { if (ok) go(); });
    } else go();
  }
  function resetSession() {
    if (!started()) return;
    var go = function () { var c = creditPartial(); setSession(TS.mode); saveTimer(); renderAll(); if (c) toast('Logged ' + esc(fmtDur(c)) + ' of focus.'); };
    if (elapsedNow() >= MIN) confirmDialog('Restart this session?', 'The clock goes back to ' + fmtClock(durFor(TS.mode)) + '. ' + (TS.mode === 'focus' ? partialText() : ''), 'Restart').then(function (ok) { if (ok) go(); });
    else go();
  }
  function switchMode(mode) {
    if (mode === TS.mode && !started()) return;
    var go = function () { var c = creditPartial(); setSession(mode); saveTimer(); renderAll(); if (c) toast('Logged ' + esc(fmtDur(c)) + ' of focus.'); };
    if (started() && elapsedNow() > 5000) {
      confirmDialog('Switch to ' + MODES[mode].label + '?', 'The current session stops. ' + (TS.mode === 'focus' ? partialText() : ''), 'Switch').then(function (ok) { if (ok) go(); });
    } else go();
  }

  /* =========================================================
     Rendering: timer
     ========================================================= */
  var PROFILES = {
    focus: [[0, 64], [30, 60], [62, 62], [96, 48], [126, 52], [160, 38], [188, 42], [222, 28], [248, 32], [282, 18], [306, 22], [340, 9], [366, 13], [400, 3]],
    short: [[0, 8], [40, 12], [80, 22], [120, 24], [170, 36], [210, 38], [260, 50], [310, 52], [360, 60], [400, 62]],
    long: [[0, 48], [50, 44], [100, 50], [150, 45], [200, 51], [250, 46], [300, 50], [350, 45], [400, 48]]
  };
  function profileY(pts, x) {
    for (var i = 1; i < pts.length; i++) if (x <= pts[i][0]) { var a = pts[i - 1], b = pts[i], t = (x - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * t; }
    return pts[pts.length - 1][1];
  }
  function drawProfile() {
    var pts = PROFILES[TS.mode], d = 'M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join(' L');
    el.climbLine.setAttribute('d', d); el.climbDone.setAttribute('d', d); el.climbArea.setAttribute('d', d + ' L400 70 L0 70 Z');
  }
  function setClimb(p) {
    var x = p * 400, y = profileY(PROFILES[TS.mode], x);
    el.climbClip.setAttribute('width', x.toFixed(1));
    el.flag.style.left = (p * 100) + '%'; el.flag.style.top = (y / 70 * 100) + '%';
  }
  function renderTimer() {
    var text = fmtClock(remaining());
    if (text !== lastText) { el.time.textContent = text; el.pillTime.textContent = text; lastText = text; }
    var title = text + ' – ' + MODES[TS.mode].title;
    if (title !== lastTitle) { document.title = title; lastTitle = title; }
    if (!document.hidden) {
      var p = TS.duration ? Math.min(1, elapsedNow() / TS.duration) : 0;
      el.bar.style.width = (p * 100).toFixed(2) + '%';
      setClimb(p);
      if (TS.mode === 'focus' && running() && now() - lastNextRender > 4000) { renderNextWonder(); lastNextRender = now(); }
    }
  }
  function applyMode() {
    body.classList.remove('mode-focus', 'mode-short', 'mode-long');
    body.classList.add('mode-' + TS.mode);
    $$('.mode-tabs [data-mode]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.mode === TS.mode)); });
    var mc = document.querySelector('meta[name="theme-color"]'); if (mc) mc.content = TS.mode === 'focus' ? '#b3271c' : TS.mode === 'short' ? '#0a6a70' : '#1c2a55';
    if (sceneOn) SwissScene.setMode(TS.mode);
    drawProfile();
  }
  function roundNumber() {
    var today = dayKey(new Date()), n = 0;
    LOG.forEach(function (e) { if (e.done && dayKey(new Date(e.end)) === today) n++; });
    return Math.max(1, n + (TS.mode === 'focus' ? 1 : 0));
  }
  function renderAll() {
    body.classList.toggle('running', running());
    body.classList.toggle('started', started());
    el.start.textContent = running() ? 'PAUSE' : 'START';
    el.start.setAttribute('aria-label', running() ? 'Pause timer' : 'Start timer');
    el.pillToggle.textContent = running() ? 'Pause' : 'Start';
    el.round.textContent = '#' + roundNumber();
    var t = activeTask();
    el.status.textContent = TS.mode === 'focus' && t ? t.title : MODES[TS.mode].status;
    lastText = ''; renderTimer();
    renderSummary();
    renderNextWonder();
  }

  /* ---- inline time editing ---- */
  el.display.addEventListener('click', function () {
    if (started()) { toast('Restart the session (R) to change its length, or change it in Settings for next time.'); return; }
    el.display.hidden = true; el.timeEdit.hidden = false;
    el.timeEditInput.max = TS.mode === 'focus' ? 180 : TS.mode === 'short' ? 60 : 120;
    el.timeEditInput.value = Math.round(durFor(TS.mode) / MIN);
    el.timeEditInput.focus(); el.timeEditInput.select();
  });
  function closeTimeEdit() { el.timeEdit.hidden = true; el.display.hidden = false; }
  el.timeEdit.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = clamp(Math.round(Number(el.timeEditInput.value) || 0), 1, Number(el.timeEditInput.max));
    if (TS.mode === 'focus') S.focusMin = v; else if (TS.mode === 'short') S.shortMin = v; else S.longMin = v;
    saveSettings();
    if (!started()) { TS.duration = durFor(TS.mode); saveTimer(); }
    closeTimeEdit(); renderAll(); toast(esc(MODES[TS.mode].label) + ' set to ' + v + ' min.');
  });
  $('#time-edit-cancel').addEventListener('click', closeTimeEdit);
  el.timeEditInput.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closeTimeEdit(); } });

  /* =========================================================
     Sound: Edelweiss alarm + small synthesized effects
     ========================================================= */
  var alarm = new Audio('assets/audio/edelweiss.mp3');
  alarm.preload = 'auto';
  var actx = null, audioReady = false, alarmStopAt = 0, musicToast = null, lastTickSec = -1, nextCowAt = 0;
  function ensureCtx() {
    if (!actx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) { try { actx = new AC(); } catch (e) {} } }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function unlockAudio() {
    ensureCtx();
    if (audioReady) return;
    audioReady = true;
    try {
      alarm.muted = true;
      var p = alarm.play();
      if (p && p.then) p.then(function () { if (!alarmStopAt) { alarm.pause(); alarm.currentTime = 0; } alarm.muted = false; }).catch(function () { alarm.muted = false; audioReady = false; });
    } catch (e) { alarm.muted = false; }
  }
  function playAlarm(seconds, volume) {
    var len = seconds || (S.alarmLength === 'full' ? 48 : Number(S.alarmLength) || 20);
    try {
      alarm.muted = false; alarm.currentTime = 0; alarm.volume = (volume != null ? volume : S.alarmVolume) / 100;
      var p = alarm.play();
      if (p && p.catch) p.catch(function () { toast('Your browser blocked the sound. Press START once so sound is allowed next time.'); });
    } catch (e) {}
    alarmStopAt = now() + len * 1000;
    alarm._vol = alarm.volume;
    if (!musicToast) musicToast = toast('Edelweiss is playing.', { action: { label: 'Stop music', fn: function () { stopAlarm(); } }, timeout: 0 });
  }
  function stopAlarm() {
    try { alarm.pause(); alarm.currentTime = 0; } catch (e) {}
    alarmStopAt = 0;
    if (musicToast) { musicToast.kill(); musicToast = null; }
  }
  function alarmTick() {
    if (!alarmStopAt) return;
    var left = alarmStopAt - now();
    if (alarm.ended || left <= 0) { stopAlarm(); return; }
    if (left < 1600) alarm.volume = Math.max(0, (alarm._vol || 0.7) * left / 1600);
  }
  function envGain(c, t, peak, dur) { var g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); return g; }
  function softClick() {
    var c = ensureCtx(); if (!c) return;
    var t = c.currentTime, o = c.createOscillator(), g = envGain(c, t, 0.06, 0.08);
    o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(520, t + 0.07);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.1);
  }
  function cowbell(vol) {
    var c = ensureCtx(); if (!c) return;
    var t = c.currentTime, g = envGain(c, t, vol, 1.5), bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 820; bp.Q.value = 0.8; g.connect(bp); bp.connect(c.destination);
    [540, 812, 1175, 1630].forEach(function (f, i) {
      var o = c.createOscillator(), og = c.createGain();
      o.type = i < 2 ? 'square' : 'triangle'; o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.01); og.gain.value = [0.5, 0.35, 0.2, 0.1][i];
      o.connect(og); og.connect(g); o.start(t); o.stop(t + 1.6);
    });
  }
  function postHorn(vol) { // the Swiss PostBus three-tone horn: C#, E, A
    var c = ensureCtx(); if (!c) return;
    var t = c.currentTime, lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.connect(c.destination);
    [[554.37, 0, 0.3], [659.25, 0.32, 0.3], [440, 0.64, 0.7]].forEach(function (n) {
      var g = envGain(c, t + n[1], vol, n[2]);
      ['sawtooth', 'square'].forEach(function (type, i) { var o = c.createOscillator(); o.type = type; o.frequency.value = n[0] * (i ? 1.003 : 1); o.connect(g); o.start(t + n[1]); o.stop(t + n[1] + n[2] + 0.05); });
      g.connect(lp);
    });
  }
  function watchTick(vol, hi) {
    var c = ensureCtx(); if (!c) return;
    var t = c.currentTime, len = Math.floor(c.sampleRate * 0.02), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    var src = c.createBufferSource(), hp = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; hp.type = 'highpass'; hp.frequency.value = hi ? 3200 : 2200; g.gain.value = vol;
    src.connect(hp); hp.connect(g); g.connect(c.destination); src.start(t);
  }
  function ambientTick() {
    if (S.tickSound === 'none' || !running() || TS.mode !== 'focus') return;
    var v = S.tickVolume / 100;
    if (S.tickSound === 'watch') {
      var sec = Math.floor(elapsedNow() / 1000);
      if (sec !== lastTickSec) { lastTickSec = sec; watchTick(v * 0.35, sec % 2 === 0); }
    } else if (S.tickSound === 'cowbell') {
      if (now() > nextCowAt) { if (nextCowAt) cowbell(v * 0.12); nextCowAt = now() + 9000 + Math.random() * 9000; }
    }
  }

  /* ---------------- notifications ---------------- */
  function canNotify() { return 'Notification' in window; }
  function notifyEnd(mode, next) {
    if (!S.notifications || !canNotify() || Notification.permission !== 'granted') return;
    var title = mode === 'focus' ? 'Climb complete!' : 'Break is over';
    var text = mode === 'focus' ? (next === 'long' ? 'Time for your ' + S.longMin + ' minute Fondue break.' : 'Time for your ' + S.shortMin + ' minute Gipfeli break.') : 'Ready for the next ' + S.focusMin + ' minute climb?';
    try { var n = new Notification(title, { body: text, icon: 'assets/icons/favicon.svg', tag: 'helvetia-hours' }); n.onclick = function () { window.focus(); n.close(); }; } catch (e) {}
  }
  function requestNotify() {
    if (!canNotify()) { toast('This browser cannot show desktop alerts.'); return Promise.resolve(false); }
    return Notification.requestPermission().then(function (p) {
      S.notifications = p === 'granted'; saveSettings();
      toast(p === 'granted' ? 'Desktop alerts are on.' : 'Desktop alerts are blocked. You can allow them in your browser settings for this site.');
      return S.notifications;
    });
  }
  function maybeAskNotify() {
    if (META.askedNotify || !canNotify() || Notification.permission !== 'default') return;
    META.askedNotify = true; saveMeta();
    toast('Want a small pop-up when time is up, even if this tab is hidden?', { action: { label: 'Turn on alerts', fn: requestNotify }, timeout: 12000 });
  }

  /* =========================================================
     Toasts, modals, dialogs
     ========================================================= */
  function toast(html, opts) {
    opts = opts || {};
    var t = document.createElement('div'); t.className = 'toast'; t.innerHTML = '<p>' + html + '</p>';
    var kill = function () { if (!t.parentNode) return; t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); };
    if (opts.action) {
      var b = document.createElement('button'); b.className = 'mini-btn'; b.textContent = opts.action.label;
      b.addEventListener('click', function () { opts.action.fn(); kill(); }); t.appendChild(b);
    }
    el.toasts.appendChild(t);
    while (el.toasts.children.length > 3) el.toasts.firstChild.remove();
    if (opts.timeout !== 0) setTimeout(kill, opts.timeout || 4500);
    return { el: t, kill: kill };
  }
  var modalStack = [];
  function openModal(m) {
    if (!m.hidden) return;
    m.hidden = false;
    modalStack.push({ el: m, focus: document.activeElement });
    document.body.style.overflow = 'hidden';
    if (m.id === 'player-modal' && sceneOn) SwissScene.pause();
    setTimeout(function () {
      var f = m.querySelector('.modal-card input, .modal-card select, .dialog-actions .mini-btn, .modal-card button:not([data-close])') || m.querySelector('button');
      if (f) f.focus();
    }, 40);
  }
  function closeModal(m) {
    if (!m || m.hidden) return;
    m.hidden = true;
    var i = -1; modalStack.forEach(function (x, k) { if (x.el === m) i = k; });
    var item = i >= 0 ? modalStack.splice(i, 1)[0] : null;
    if (m.id === 'player-modal') { HHPlayer.close(); if (sceneOn) SwissScene.resume(); }
    if (!modalStack.length) document.body.style.overflow = '';
    if (item && item.focus && item.focus.focus) { try { item.focus.focus(); } catch (e) {} }
    if (m._onClose) { var f = m._onClose; m._onClose = null; f(); }
    setTimeout(flushPending, 200);
  }
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-close]'); if (!c) return;
    var m = c.closest('.modal'); if (m) closeModal(m);
  });
  function dialog(opts) {
    var m = $('#dialog-modal'), card = $('#dialog-card');
    card.innerHTML = (opts.kicker ? '<p class="celebrate-kicker">' + opts.kicker + '</p>' : '') + '<h2 id="dialog-title">' + opts.title + '</h2>' + (opts.html || '') +
      '<div class="dialog-actions">' + opts.actions.map(function (a, i) { return '<button class="mini-btn ' + (a.cls || '') + '" data-i="' + i + '">' + a.label + '</button>'; }).join('') + '</div>';
    var result = null;
    card.querySelectorAll('.dialog-actions button').forEach(function (b) {
      b.addEventListener('click', function () { result = opts.actions[Number(b.dataset.i)]; closeModal(m); });
    });
    m._onClose = function () { if (opts.onClose) opts.onClose(result ? result.value : null); if (result && result.fn) result.fn(); };
    openModal(m);
  }
  function confirmDialog(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      dialog({ title: esc(title), html: '<p>' + esc(text) + '</p>', actions: [{ label: 'Cancel', cls: 'ghost', value: false }, { label: esc(okLabel || 'OK'), cls: danger ? 'red' : 'primary', value: true }], onClose: function (v) { resolve(!!v); } });
    });
  }

  /* =========================================================
     Tasks
     ========================================================= */
  var editingId = null;
  function switchToNextTask(fromId) {
    var idx = TASKS.list.findIndex(function (t) { return t.id === fromId; });
    var next = TASKS.list.slice(idx + 1).concat(TASKS.list.slice(0, idx)).find(function (t) { return !t.done; });
    TASKS.activeId = next ? next.id : null;
  }
  function renderTasks() {
    el.taskList.innerHTML = TASKS.list.map(function (t) {
      if (t.id === editingId) return '<li class="task-edit-slot" data-id="' + t.id + '">' + taskFormHTML(t) + '</li>';
      return '<li class="task' + (t.id === TASKS.activeId ? ' active' : '') + (t.done ? ' done' : '') + '" data-id="' + t.id + '" tabindex="0" aria-label="Task: ' + esc(t.title) + (t.id === TASKS.activeId ? ' (current)' : '') + '">' +
        '<button class="task-check" data-act="check" aria-label="' + (t.done ? 'Mark as not done' : 'Mark as done') + '"><svg class="ic"><use href="#i-check"/></svg></button>' +
        '<div class="task-body"><div class="task-title">' + esc(t.title) + '</div>' + (t.note ? '<div class="task-note">' + esc(t.note) + '</div>' : '') + '</div>' +
        '<span class="task-count" title="Done / planned focus sessions"><b>' + (t.act || 0) + '</b>/' + t.est + '</span>' +
        '<button class="task-edit" data-act="edit" aria-label="Edit task"><svg class="ic"><use href="#i-dots"/></svg></button></li>';
    }).join('');
    el.addTask.hidden = editingId === 'new';
    el.formSlot.innerHTML = editingId === 'new' ? taskFormHTML(null) : '';
    var f = document.querySelector('.task-form input[type="text"]'); if (f) f.focus();
    renderSummary(); renderAllStatus();
  }
  function renderAllStatus() { var t = activeTask(); el.status.textContent = TS.mode === 'focus' && t ? t.title : MODES[TS.mode].status; }
  function taskFormHTML(t) {
    return '<div class="task-form" data-form="' + (t ? t.id : 'new') + '"><div class="task-form-body">' +
      '<input type="text" maxlength="140" placeholder="What are you working on?" value="' + esc(t ? t.title : '') + '" aria-label="Task name">' +
      '<label class="small" for="tf-est">Planned focus sessions (' + S.focusMin + ' min each)</label>' +
      '<div class="est-row"><input id="tf-est" type="number" min="1" max="50" value="' + (t ? t.est : 1) + '">' +
      '<button type="button" data-est="-1" aria-label="One less">−</button><button type="button" data-est="1" aria-label="One more">+</button></div>' +
      '<button type="button" class="note-toggle"' + (t && t.note ? ' hidden' : '') + '>+ Add note</button>' +
      '<textarea placeholder="Some notes…" aria-label="Note"' + (t && t.note ? '' : ' hidden') + '>' + esc(t ? t.note || '' : '') + '</textarea>' +
      '</div><div class="task-form-foot">' + (t ? '<button type="button" class="mini-btn text" data-tf="delete">Delete</button>' : '') +
      '<span class="spacer"></span><button type="button" class="mini-btn text" data-tf="cancel">Cancel</button><button type="button" class="mini-btn primary" data-tf="save">Save</button></div></div>';
  }
  function saveForm(form) {
    var title = form.querySelector('input[type="text"]').value.trim();
    if (!title) { form.querySelector('input[type="text"]').focus(); toast('Please write a task name first.'); return; }
    var est = clamp(Math.round(Number(form.querySelector('#tf-est').value) || 1), 1, 50);
    var note = form.querySelector('textarea').value.trim();
    var id = form.dataset.form;
    if (id === 'new') {
      var t = { id: uid(), title: title, est: est, act: 0, done: false, note: note };
      TASKS.list.push(t);
      if (!activeTask()) TASKS.activeId = t.id;
    } else {
      var x = TASKS.list.find(function (q) { return q.id === id; }); if (x) { x.title = title; x.est = est; x.note = note; }
    }
    editingId = null; saveTasks(); renderTasks();
  }
  document.querySelector('.tasks').addEventListener('click', function (e) {
    var form = e.target.closest('.task-form');
    if (form) {
      var est = e.target.closest('[data-est]');
      if (est) { var inp = form.querySelector('#tf-est'); inp.value = clamp((Number(inp.value) || 1) + Number(est.dataset.est), 1, 50); return; }
      if (e.target.closest('.note-toggle')) { e.target.closest('.note-toggle').hidden = true; var ta = form.querySelector('textarea'); ta.hidden = false; ta.focus(); return; }
      var act = e.target.closest('[data-tf]'); if (!act) return;
      if (act.dataset.tf === 'cancel') { editingId = null; renderTasks(); }
      else if (act.dataset.tf === 'save') saveForm(form);
      else if (act.dataset.tf === 'delete') {
        TASKS.list = TASKS.list.filter(function (t) { return t.id !== form.dataset.form; });
        if (TASKS.activeId === form.dataset.form) TASKS.activeId = null;
        editingId = null; saveTasks(); renderTasks();
      }
      return;
    }
    var li = e.target.closest('.task'); if (!li) return;
    var t = TASKS.list.find(function (q) { return q.id === li.dataset.id; }); if (!t) return;
    var b = e.target.closest('[data-act]');
    if (b && b.dataset.act === 'check') {
      t.done = !t.done;
      if (t.done && TASKS.activeId === t.id && S.autoSwitchTasks) switchToNextTask(t.id);
      if (!t.done && !activeTask()) TASKS.activeId = t.id;
      saveTasks(); renderTasks(); return;
    }
    if (b && b.dataset.act === 'edit') { editingId = t.id; renderTasks(); return; }
    TASKS.activeId = t.id; saveTasks(); renderTasks();
  });
  document.querySelector('.tasks').addEventListener('keydown', function (e) {
    var form = e.target.closest('.task-form');
    if (form && e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveForm(form); }
    if (form && e.key === 'Escape') { e.stopPropagation(); editingId = null; renderTasks(); }
    var li = e.target.classList && e.target.classList.contains('task') ? e.target : null;
    if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); TASKS.activeId = li.dataset.id; saveTasks(); renderTasks(); }
  });
  el.addTask.addEventListener('click', function () { editingId = 'new'; renderTasks(); });
  el.taskMenuBtn.addEventListener('click', function (e) {
    e.stopPropagation(); var open = el.taskMenu.hidden; el.taskMenu.hidden = !open; el.taskMenuBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.menu-wrap')) { el.taskMenu.hidden = true; el.taskMenuBtn.setAttribute('aria-expanded', 'false'); } });
  el.taskMenu.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    el.taskMenu.hidden = true;
    if (b.dataset.act === 'clear-done') { TASKS.list = TASKS.list.filter(function (t) { return !t.done; }); saveTasks(); renderTasks(); }
    if (b.dataset.act === 'clear-act') { TASKS.list.forEach(function (t) { t.act = 0; }); saveTasks(); renderTasks(); }
    if (b.dataset.act === 'clear-all') confirmDialog('Clear all tasks?', 'This removes every task from the list. Your focus hours stay saved.', 'Clear all', true).then(function (ok) { if (ok) { TASKS.list = []; TASKS.activeId = null; saveTasks(); renderTasks(); } });
  });
  function finishMs(left) {
    if (left <= 0) return 0;
    var ms = 0, cycle = TS.cycle || 0, mode = TS.mode, first = true, n = left;
    while (n > 0) {
      if (mode === 'focus') {
        ms += first ? (started() ? remaining() : TS.duration) : S.focusMin * MIN;
        n--; cycle++;
        if (n > 0) { if (cycle >= S.longInterval) { mode = 'long'; cycle = 0; } else mode = 'short'; }
      } else {
        ms += first ? remaining() : (mode === 'long' ? S.longMin : S.shortMin) * MIN;
        mode = 'focus';
      }
      first = false;
    }
    return ms;
  }
  function renderSummary() {
    if (!TASKS.list.length) { el.summary.hidden = true; return; }
    var est = 0, act = 0, left = 0;
    TASKS.list.forEach(function (t) { est += t.est; act += t.act || 0; if (!t.done) left += Math.max(0, t.est - (t.act || 0)); });
    var ms = finishMs(left);
    el.summary.hidden = false;
    el.summary.innerHTML = '<div><span>Focus sessions:</span><b>' + act + '/' + est + '</b></div>' +
      '<div><span>Finish at:</span><b>' + (left ? fmtTOD(new Date(now() + ms)) : 'Done') + '</b>' + (left ? ' <span>(' + (ms / HOUR).toFixed(1) + ' h)</span>' : '') + '</div>';
  }

  /* =========================================================
     Wonders: unlocks, posters, trail, celebration
     ========================================================= */
  function hoursDone() { return Math.floor(total() / HOUR); }
  function isUnlocked(w) { return w.hour === 0 || hoursDone() >= w.hour; }
  function lockText(w) { var need = w.hour * HOUR - total(); return 'Opens at hour ' + w.hour + '. ' + fmtDur(Math.max(MIN, need)) + ' of focus to go.'; }
  function rangeText(w) { return fmtTs(w.start) + ' to ' + (w.end != null ? fmtTs(w.end - 1) : 'the end'); }
  function lenText(w) { return w.end != null ? fmtTs(w.end - w.start) : ''; }
  function wonderById(id) { return D.wonders.find(function (w) { return w.id === id; }); }
  var hourChapters = D.wonders.filter(function (w) { return w.hour > 0; });

  /* --- Swiss-poster style artwork for each chapter --- */
  var KINDS = {
    peak: ['#2D6FB7', '#A9D2EE', '#4E5F78', '#5E8F4A', '#FFFFFF'], glacier: ['#3F8FC4', '#D9F0F7', '#6C859C', '#EAF6FA', '#0E7C83'],
    falls: ['#2F6F86', '#BFE3E6', '#3F5E4E', '#4F8A44', '#FFFFFF'], lake: ['#2879B0', '#CBEAF2', '#56677A', '#4E8A45', '#16A3A6'],
    wildlife: ['#C46B2D', '#F7D59A', '#6D5A44', '#4A5D33', '#2A1F18'], bridge: ['#5F82A6', '#E9D8BC', '#6A6E78', '#4F7A41', '#B9AE9C'],
    gorge: ['#C3714A', '#F3C8A2', '#8A4E33', '#2F7A6B', '#16A3A6'], spires: ['#D2884F', '#F7DDB8', '#9A6A45', '#7A5236', '#3A2A20'],
    cliff: ['#5E7A9A', '#DCE6EF', '#9AA4AE', '#3E5A3E', '#FFFFFF'], river: ['#2E8C7A', '#CDEFE3', '#4A6658', '#3C6E40', '#11A39A'],
    castle: ['#3E5C8C', '#F0D9B5', '#5D6E86', '#3B5A35', '#262B36'], city: ['#26396E', '#F2B9A0', '#4F5B78', '#2E3A57', '#F6D58A'],
    valley: ['#3C8FD0', '#E2F1D2', '#5C7A90', '#6FAA45', '#7B4A2B'], culture: ['#DA291C', '#F59A8F', '#A41E14', '#7E1A12', '#FFFFFF'],
    flag: ['#DA291C', '#EF5B4F', '#A41E14', '#7E1A12', '#FFFFFF']
  };
  function seeded(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return function () { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; }; }
  function poster(w, wide) {
    var W = wide ? 320 : 200, H = wide ? 180 : 250, c = KINDS[w.kind] || KINDS.peak, r = seeded(w.id + (wide ? 'w' : ''));
    var gid = 'pg-' + w.id + (wide ? 'w' : ''), hz = H * (wide ? 0.6 : 0.56), s = [];
    s.push('<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">');
    s.push('<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient></defs>');
    s.push('<rect width="' + W + '" height="' + H + '" fill="url(#' + gid + ')"/>');
    var culture = w.kind === 'culture' || w.kind === 'flag';
    if (!culture) s.push('<circle cx="' + (W * (0.66 + r() * 0.2)).toFixed(1) + '" cy="' + (H * (0.2 + r() * 0.1)).toFixed(1) + '" r="' + (W * 0.085).toFixed(1) + '" fill="#fff" opacity=".55"/>');
    else {
      var cs = W * (w.kind === 'flag' ? 0.34 : 0.26), cx = W * 0.62, cy = H * 0.3, a = cs / 3.2;
      s.push('<path d="M' + (cx - a / 2) + ' ' + (cy - cs / 2) + 'h' + a + 'v' + (cs / 2 - a / 2) + 'h' + (cs / 2 - a / 2) + 'v' + a + 'h-' + (cs / 2 - a / 2) + 'v' + (cs / 2 - a / 2) + 'h-' + a + 'v-' + (cs / 2 - a / 2) + 'h-' + (cs / 2 - a / 2) + 'v-' + a + 'h' + (cs / 2 - a / 2) + 'z" fill="#fff"/>');
    }
    // mountain range
    var n = w.kind === 'peak' ? 3 : 4 + Math.floor(r() * 2), pts = [[0, hz - H * 0.05]], peaks = [];
    for (var i = 0; i < n; i++) {
      var px = (i + 0.5) / n * W + (r() - 0.5) * W * 0.08, ph = H * (0.14 + r() * 0.2);
      if (w.kind === 'peak' && i === 1) { px = W * 0.5; ph = H * 0.42; }
      pts.push([px, hz - ph]); peaks.push(pts.length - 1);
      if (i < n - 1) pts.push([(i + 1) / n * W + (r() - 0.5) * 8, hz - H * (0.03 + r() * 0.06)]);
    }
    pts.push([W, hz - H * 0.04]);
    s.push('<path d="M0 ' + H + ' L' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L') + ' L' + W + ' ' + H + 'Z" fill="' + c[2] + '"/>');
    peaks.forEach(function (k) {
      var P = pts[k], L = pts[k - 1], R = pts[k + 1] || [W, hz], f = 0.32;
      var a1 = [P[0] + (L[0] - P[0]) * f, P[1] + (L[1] - P[1]) * f], b1 = [P[0] + (R[0] - P[0]) * f, P[1] + (R[1] - P[1]) * f];
      var m1 = [(P[0] * 0.4 + a1[0] * 0.6) + 2, a1[1] - 3], m2 = [(P[0] * 0.4 + b1[0] * 0.6) - 1, b1[1] + 2];
      s.push('<path d="M' + P.join(' ') + ' L' + b1.join(' ') + ' L' + m2.join(' ') + ' L' + ((P[0] + b1[0]) / 2) + ' ' + (b1[1] - 4) + ' L' + (P[0] - 1) + ' ' + (a1[1] + 1) + ' L' + m1.join(' ') + ' L' + a1.join(' ') + 'Z" fill="#F7FAFC"/>');
    });
    // ground
    var gy = hz + H * 0.06;
    s.push('<path d="M0 ' + (gy + 6) + ' Q' + W * 0.25 + ' ' + (gy - 10) + ' ' + W * 0.5 + ' ' + gy + ' T' + W + ' ' + (gy - 4) + ' L' + W + ' ' + H + ' L0 ' + H + 'Z" fill="' + c[3] + '"/>');
    // motifs
    var water = '#16A3A6';
    switch (w.kind) {
      case 'glacier':
        s.push('<path d="M' + W * 0.36 + ' ' + (hz - 14) + ' L' + W * 0.56 + ' ' + (hz - 18) + ' C' + W * 0.62 + ' ' + (H * 0.75) + ' ' + W * 0.7 + ' ' + H * 0.9 + ' ' + W * 0.78 + ' ' + H + ' L' + W * 0.2 + ' ' + H + ' C' + W * 0.3 + ' ' + H * 0.85 + ' ' + W * 0.34 + ' ' + H * 0.72 + ' ' + W * 0.36 + ' ' + (hz - 14) + 'Z" fill="#F2F8FB"/>');
        for (i = 0; i < 4; i++) s.push('<path d="M' + W * (0.3 + i * 0.08) + ' ' + (H * (0.72 + i * 0.05)) + ' l' + W * 0.12 + ' -4" stroke="#9FD0DE" stroke-width="2"/>');
        break;
      case 'falls':
        s.push('<rect x="' + W * 0.44 + '" y="' + (hz - H * 0.16) + '" width="' + W * 0.05 + '" height="' + (H * 0.5) + '" fill="#F4FBFF" opacity=".95"/>');
        s.push('<rect x="' + W * 0.52 + '" y="' + (hz - H * 0.1) + '" width="' + W * 0.02 + '" height="' + (H * 0.42) + '" fill="#F4FBFF" opacity=".7"/>');
        s.push('<ellipse cx="' + W * 0.48 + '" cy="' + H * 0.9 + '" rx="' + W * 0.22 + '" ry="' + H * 0.05 + '" fill="#fff" opacity=".7"/>');
        break;
      case 'lake': case 'cliff':
        if (w.kind === 'cliff') s.push('<path d="M' + W * 0.08 + ' ' + (gy + 4) + ' C' + W * 0.12 + ' ' + (hz - H * 0.12) + ' ' + W * 0.88 + ' ' + (hz - H * 0.12) + ' ' + W * 0.92 + ' ' + (gy + 4) + ' L' + W * 0.78 + ' ' + (gy + 6) + ' C' + W * 0.72 + ' ' + (hz) + ' ' + W * 0.28 + ' ' + (hz) + ' ' + W * 0.22 + ' ' + (gy + 6) + 'Z" fill="#E9E4D8"/>');
        else {
          s.push('<path d="M0 ' + H * 0.74 + ' C' + W * 0.3 + ' ' + H * 0.7 + ' ' + W * 0.7 + ' ' + H * 0.73 + ' ' + W + ' ' + H * 0.7 + ' L' + W + ' ' + H + ' L0 ' + H + 'Z" fill="' + c[4] + '"/>');
          for (i = 0; i < 3; i++) s.push('<path d="M' + W * (0.15 + i * 0.25) + ' ' + H * (0.8 + i * 0.05) + ' h' + W * 0.16 + '" stroke="#fff" stroke-opacity=".6" stroke-width="2"/>');
        }
        break;
      case 'river': case 'gorge':
        if (w.kind === 'gorge') {
          s.push('<path d="M0 ' + (hz - H * 0.2) + ' L' + W * 0.34 + ' ' + (hz - H * 0.1) + ' L' + W * 0.42 + ' ' + H + ' L0 ' + H + 'Z" fill="' + c[2] + '"/>');
          s.push('<path d="M' + W + ' ' + (hz - H * 0.24) + ' L' + W * 0.66 + ' ' + (hz - H * 0.08) + ' L' + W * 0.58 + ' ' + H + ' L' + W + ' ' + H + 'Z" fill="' + c[2] + '" opacity=".9"/>');
        }
        s.push('<path d="M' + W * 0.5 + ' ' + gy + ' C' + W * 0.42 + ' ' + H * 0.78 + ' ' + W * 0.62 + ' ' + H * 0.86 + ' ' + W * 0.45 + ' ' + H + '" stroke="' + water + '" stroke-width="' + (W * 0.09) + '" fill="none" stroke-linecap="round"/>');
        break;
      case 'bridge':
        var by = hz - H * 0.02, bh = H * 0.16, pier = W / 6, d = 'M0 ' + by + ' H' + W + ' V' + (by + bh) + ' H0Z';
        for (i = 0; i < 6; i++) { var x0 = i * pier + pier * 0.16, x1 = (i + 1) * pier - pier * 0.16, rr = (x1 - x0) / 2; d += ' M' + x0 + ' ' + (by + bh) + ' V' + (by + rr + 4) + ' A' + rr + ' ' + rr + ' 0 0 1 ' + x1 + ' ' + (by + rr + 4) + ' V' + (by + bh) + 'Z'; }
        s.push('<path d="' + d + '" fill="' + c[4] + '" fill-rule="evenodd"/>');
        s.push('<rect x="' + W * 0.2 + '" y="' + (by - 9) + '" width="' + W * 0.34 + '" height="9" fill="#C8102E"/><rect x="' + W * 0.2 + '" y="' + (by - 7) + '" width="' + W * 0.34 + '" height="3" fill="#2B3640"/>');
        break;
      case 'castle':
        var cxl = W * 0.3, cyl = gy - 4;
        s.push('<path d="M' + (cxl - 30) + ' ' + cyl + ' h60 v-26 h-8 v6 h-8 v-6 h-8 v6 h-8 v-6 h-8 v6 h-8 v-6 h-12z" fill="' + c[4] + '"/>');
        s.push('<rect x="' + (cxl + 12) + '" y="' + (cyl - 48) + '" width="14" height="48" fill="' + c[4] + '"/><path d="M' + (cxl + 9) + ' ' + (cyl - 48) + ' l10 -16 l10 16z" fill="#DA291C"/>');
        s.push('<rect x="' + (cxl - 26) + '" y="' + (cyl - 38) + '" width="11" height="38" fill="' + c[4] + '"/><path d="M' + (cxl - 29) + ' ' + (cyl - 38) + ' l8.5 -13 l8.5 13z" fill="#DA291C"/>');
        break;
      case 'city':
        var x = 0; while (x < W) { var bw = 12 + r() * 16, bh2 = 18 + r() * 34, top = gy + 8 - bh2; s.push('<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (H - top).toFixed(1) + '" fill="' + c[3] + '"/>'); if (r() < 0.5) s.push('<path d="M' + x.toFixed(1) + ' ' + top.toFixed(1) + ' l' + (bw / 2).toFixed(1) + ' -9 l' + (bw / 2).toFixed(1) + ' 9z" fill="#B23A2C"/>'); for (var wy = top + 6; wy < H - 6; wy += 9) if (r() < 0.55) s.push('<rect x="' + (x + 3).toFixed(1) + '" y="' + wy.toFixed(1) + '" width="3" height="4" fill="' + c[4] + '"/>'); x += bw + 2; }
        s.push('<rect x="' + W * 0.62 + '" y="' + (gy - 46) + '" width="9" height="60" fill="' + c[3] + '"/><path d="M' + W * 0.62 + ' ' + (gy - 46) + ' l4.5 -16 l4.5 16z" fill="' + c[3] + '"/>');
        break;
      case 'wildlife':
        for (i = 0; i < 3; i++) { var bx = W * (0.2 + i * 0.22 + r() * 0.05), byy = H * (0.18 + r() * 0.16), sz = 7 + r() * 6; s.push('<path d="M' + bx + ' ' + byy + ' q' + sz * 0.6 + ' -' + sz * 0.6 + ' ' + sz + ' 0 q' + sz * 0.4 + ' -' + sz * 0.6 + ' ' + sz + ' 0" stroke="' + c[4] + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>'); }
        break;
      case 'spires':
        for (i = 0; i < 5; i++) { var sx = W * (0.14 + i * 0.17), sh = H * (0.2 + r() * 0.16), sw = 9 + r() * 6; s.push('<path d="M' + (sx - sw) + ' ' + (gy + 10) + ' L' + (sx - 2) + ' ' + (gy + 10 - sh) + ' L' + (sx + 2) + ' ' + (gy + 10 - sh) + ' L' + (sx + sw) + ' ' + (gy + 10) + 'Z" fill="' + c[2] + '"/><ellipse cx="' + sx + '" cy="' + (gy + 8 - sh) + '" rx="8" ry="4" fill="' + c[4] + '"/>'); }
        break;
      case 'valley':
        var hx = W * 0.62, hy = gy + 12;
        s.push('<rect x="' + hx + '" y="' + (hy - 14) + '" width="22" height="14" fill="' + c[4] + '"/><path d="M' + (hx - 4) + ' ' + (hy - 14) + ' l15 -11 l15 11z" fill="#4B3328"/><rect x="' + (hx + 4) + '" y="' + (hy - 10) + '" width="14" height="3" fill="#F6D58A"/>');
        break;
    }
    var label = w.hour === 0 ? 'Free' : String(w.hour).padStart(2, '0');
    s.push('<text x="' + (wide ? 16 : 12) + '" y="' + (wide ? 46 : 50) + '" font-family="Archivo, Helvetica Neue, Arial, sans-serif" font-weight="800" font-size="' + (wide ? 38 : 44) + '" style="font-variation-settings:\'wdth\' 118" fill="#fff" stroke="rgba(0,0,0,.18)" stroke-width="1" paint-order="stroke">' + label + '</text>');
    s.push('</svg>');
    return s.join('');
  }

  var currentLevel = null;
  function renderWonders() {
    var h = hoursDone();
    if (currentLevel == null) currentLevel = h >= 30 ? 2 : 1;
    $$('.level-switch [data-level]').forEach(function (b) { b.setAttribute('aria-selected', String(Number(b.dataset.level) === currentLevel)); });
    var lv = D.levels.find(function (l) { return l.level === currentLevel; });
    var nextLocked = D.wonders.find(function (w) { return !isUnlocked(w); });
    var html = '<p class="level-intro" style="grid-column:1/-1">' + esc(lv.subtitle) + '. ' + esc(lv.hours) + '.</p>';
    html += D.wonders.filter(function (w) { return w.level === currentLevel; }).map(function (w) {
      var open = isUnlocked(w), seen = META.watched[w.id];
      var cta = open ? '<svg class="ic"><use href="#i-play"/></svg>Watch' + (lenText(w) ? ' (' + lenText(w) + ')' : '') : '<svg class="ic"><use href="#i-lock"/></svg>' + esc(lockText(w));
      return '<button class="wonder ' + (open ? 'open' : 'locked') + (nextLocked && nextLocked.id === w.id ? ' next-up' : '') + '" data-wonder="' + w.id + '" aria-label="' + esc(w.title) + (open ? '. Watch chapter' : '. Locked. ' + lockText(w)) + '">' +
        '<span class="poster">' + poster(w) + '</span>' +
        (open ? (seen ? '<span class="seen-badge"><svg class="ic"><use href="#i-check"/></svg>Watched</span>' : '') : '<span class="lock-badge"><svg class="ic"><use href="#i-lock"/></svg></span>') +
        '<span class="wonder-info"><span class="wonder-title">' + esc(w.title) + '</span><span class="wonder-range">' + rangeText(w) + '</span><span class="wonder-cta">' + cta + '</span></span></button>';
    }).join('');
    el.grid.innerHTML = html;
  }
  $$('.level-switch [data-level]').forEach(function (b) { b.addEventListener('click', function () { currentLevel = Number(b.dataset.level); renderWonders(); }); });
  el.grid.addEventListener('click', function (e) { var b = e.target.closest('[data-wonder]'); if (b) openWonder(b.dataset.wonder); });

  function openWonder(id) {
    var w = wonderById(id); if (!w) return;
    if (!isUnlocked(w)) { toast(esc(lockText(w)) + ' Keep climbing!'); return; }
    stopAlarm();
    HHPlayer.open(w, {
      meta: 'Level ' + w.level + ', ' + (w.hour ? 'hour ' + w.hour : 'free introduction') + ': plays ' + rangeText(w),
      show: openModal,
      onWatched: function (wid) { if (!META.watched[wid]) { META.watched[wid] = true; saveMeta(); renderWonders(); } }
    });
  }

  function renderNextWonder() {
    var tot = total(), inSession = TS.mode === 'focus' && started() ? Math.min(elapsedNow(), TS.duration) : 0, live = tot + inSession;
    var h = Math.floor(tot / HOUR), open = hourChapters.filter(isUnlocked).length;
    var next = hourChapters.find(function (w) { return w.hour > h; });
    var html = '<div class="nw-top"><div class="nw-total"><b>' + fmtDur(tot) + '</b> climbed in total</div><div class="nw-total">' + open + ' of ' + hourChapters.length + ' chapters open</div></div>';
    if (!next) {
      html += '<div class="nw-title">You reached the summit. Every chapter is open.<small>Keep climbing: your village still grows with each hour.</small></div><div class="nw-bar"><span style="width:100%"></span></div>';
    } else {
      var into = Math.max(0, live - (next.hour - 1) * HOUR), need = HOUR, p = clamp(into / need, 0, 1);
      if (next.hour - 1 > h) { into = Math.max(0, live - h * HOUR); p = clamp(into / ((next.hour - h) * HOUR), 0, 1); need = (next.hour - h) * HOUR; }
      var left = Math.max(0, need - into);
      html += '<div class="nw-title">Next: ' + esc(next.title) + '<small>Opens at hour ' + next.hour + (D.levels[next.level - 1] ? ' in ' + esc(D.levels[next.level - 1].title) : '') + '</small></div>' +
        '<div class="nw-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(p * 100) + '"><span style="width:' + (p * 100).toFixed(1) + '%"></span></div>' +
        '<div class="nw-foot"><span>' + fmtDur(into) + ' done' + (inSession ? ' (with this session)' : '') + '</span><span>' + (left <= 0 ? 'Opens when this session ends' : fmtDur(left) + ' to go') + '</span></div>';
    }
    el.next.innerHTML = html;
  }

  var pendingCelebration = null;
  function afterProgress(before) {
    totalCache = null;
    var h = hoursDone();
    if (h > (META.celebrated || 0)) {
      var from = META.celebrated || 0, newly = D.wonders.filter(function (w) { return w.hour > from && w.hour <= h; });
      META.celebrated = h; saveMeta();
      if (sceneOn) { SwissScene.setVillageSize(villageSize()); SwissScene.celebrate(); }
      pendingCelebration = { to: h, wonders: newly };
      if (newly.length) { currentLevel = newly[newly.length - 1].level; }
      flushPending();
    } else if (h < (META.celebrated || 0)) { META.celebrated = h; saveMeta(); }
    renderWonders(); renderNextWonder();
    if (window.HHMap) HHMap.refresh();
  }
  function flushPending() {
    if (!pendingCelebration || document.hidden || modalStack.length) return;
    var c = pendingCelebration; pendingCelebration = null;
    var w = c.wonders[c.wonders.length - 1];
    if (!w) {
      dialog({ kicker: 'Hour ' + c.to + ' complete', title: 'You are an Alpine legend', html: '<p>Every chapter is already open, and a new chalet just appeared in your valley. ' + esc(pickOne(CHEERS)) + '</p>', actions: [{ label: 'Keep climbing', cls: 'primary' }] });
      return;
    }
    var many = c.wonders.length > 1;
    dialog({
      kicker: 'Hour ' + c.to + ' complete',
      title: esc(many ? c.wonders.length + ' new chapters are open!' : w.title.split(' - ')[0] + ' is open!'),
      html: '<div class="celebrate-poster">' + poster(w, true) + '</div><p>' + (many ? 'Newest: ' + esc(w.title) + '. ' : esc(w.title) + '. ') + 'You have focused for ' + fmtDur(total()) + ' in total, and a new chalet appeared in your valley. ' + esc(pickOne(CHEERS)) + '</p>',
      actions: [{ label: 'Later', cls: 'ghost' }, { label: 'Watch now', cls: 'red', fn: function () { setTimeout(function () { openWonder(w.id); }, 60); } }]
    });
  }

  /* =========================================================
     Report
     ========================================================= */
  var reportRange = 7;
  function byDay() { var m = {}; LOG.forEach(function (e) { var k = dayKey(new Date(e.end)); m[k] = (m[k] || 0) + e.ms; }); return m; }
  function chartSVG(days) {
    var narrow = window.innerWidth < 640, W = narrow ? 380 : 720, H = narrow ? 240 : 260, ml = 40, mr = 10, mt = 18, mb = 34, iw = W - ml - mr, ih = H - mt - mb;
    var maxMs = Math.max.apply(null, days.map(function (d) { return d.ms; }).concat([HOUR]));
    var maxH = Math.ceil(maxMs / HOUR), step = Math.max(1, Math.ceil(maxH / 5)); maxH = Math.ceil(maxH / step) * step;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Focus hours per day"><g class="axis">';
    for (var v = 0; v <= maxH; v += step) { var y = mt + ih - v / maxH * ih; s += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (ml - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + v + ' h</text>'; }
    s += '</g>';
    var slot = iw / days.length, bw = Math.max(3, slot * 0.62);
    days.forEach(function (d, i) {
      var bh = d.ms / (maxH * HOUR) * ih, x = ml + i * slot + (slot - bw) / 2, y = mt + ih - bh;
      s += '<rect class="bar' + (d.today ? ' today' : '') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, bh).toFixed(1) + '" rx="2"><title>' + d.full + ': ' + fmtDur(d.ms) + '</title></rect>';
      if (days.length <= 7 && d.ms > 0 && !narrow) s += '<text class="bar-val" x="' + (x + bw / 2) + '" y="' + (y - 5) + '">' + (d.ms / HOUR).toFixed(1) + ' h</text>';
      if (days.length <= 7 || i % (narrow ? 5 : 3) === 0 || d.today) s += '<g class="axis"><text x="' + (x + bw / 2) + '" y="' + (H - 12) + '" text-anchor="middle">' + d.label + '</text></g>';
    });
    return s + '</svg>';
  }
  function renderReport() {
    var R = $('#report'), m = byDay(), today = new Date(), tk = dayKey(today);
    var dow = (today.getDay() + 6) % 7, monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow), week = 0;
    for (var i = 0; i < 7; i++) { var dd = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i); week += m[dayKey(dd)] || 0; }
    var streak = 0, cur = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (!((m[tk] || 0) >= MIN)) cur.setDate(cur.getDate() - 1);
    while ((m[dayKey(cur)] || 0) >= MIN) { streak++; cur.setDate(cur.getDate() - 1); }
    var days = [], names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (i = reportRange - 1; i >= 0; i--) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      days.push({ ms: m[dayKey(d)] || 0, today: i === 0, label: reportRange <= 7 ? (window.innerWidth < 640 ? names[d.getDay()] : names[d.getDay()] + ' ' + d.getDate()) : String(d.getDate()), full: d.toDateString() });
    }
    var tiles = [['i-clock', 'Today', fmtDur(m[tk] || 0)], ['i-chart', 'This week', fmtDur(week)], ['i-explore', 'All time', fmtDur(total())], ['i-flame', 'Day streak', streak + (streak === 1 ? ' day' : ' days')]];
    var byTask = {};
    LOG.forEach(function (e) { var k = e.task || 'No task picked'; byTask[k] = (byTask[k] || 0) + e.ms; });
    var taskRows = Object.keys(byTask).map(function (k) { return [k, byTask[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
    var maxTask = taskRows.length ? taskRows[0][1] : 1;
    var recent = LOG.slice(-30).reverse();
    var meter = D.wonders.map(function (w) { return '<span class="' + (isUnlocked(w) ? (w.hour === 0 ? 'free' : 'on' + (w.level === 2 ? ' l2' : '')) : '') + '" title="' + esc((w.hour ? 'Hour ' + w.hour + ': ' : 'Free: ') + w.title) + '"></span>'; }).join('');
    var nextW = hourChapters.find(function (w) { return !isUnlocked(w); });
    R.innerHTML =
      '<header class="paper-head compact"><h1>Study report</h1><p class="lead">Your focus time, saved only in this browser. Breaks are not counted.</p></header>' +
      '<div class="report-tiles">' + tiles.map(function (t) { return '<div class="tile"><div class="t-label"><svg class="ic"><use href="#' + t[0] + '"/></svg>' + t[1] + '</div><div class="t-value">' + t[2].replace(/(\d+) (h|min|days?)/g, '$1<small>$2</small>') + '</div></div>'; }).join('') + '</div>' +
      (LOG.length ? '' : '<p class="empty-note">No focus time yet. Go to <a href="#home">Home</a>, press START, and your first climb will show up here.</p>') +
      '<section class="report-section"><h2>Focus hours<span class="seg" role="group" aria-label="Range"><button data-range="7" aria-pressed="' + (reportRange === 7) + '">Last 7 days</button><button data-range="30" aria-pressed="' + (reportRange === 30) + '">Last 30 days</button></span></h2><div class="chart-wrap">' + chartSVG(days) + '</div></section>' +
      '<section class="report-section"><h2>Wonders trail</h2><div class="trail-meter" aria-hidden="true">' + meter + '</div><p class="trail-caption">' + hourChapters.filter(isUnlocked).length + ' of ' + hourChapters.length + ' chapters open. ' + (nextW ? 'Next: ' + esc(nextW.title) + ' at hour ' + nextW.hour + '.' : 'You opened them all!') + ' Your village has ' + villageSize() + ' chalets.</p></section>' +
      '<section class="report-section"><h2>Where your time went</h2>' + (taskRows.length ? '<ul class="task-bars">' + taskRows.map(function (r) { return '<li><span class="tb-name">' + esc(r[0]) + '</span><span class="tb-time">' + fmtDur(r[1]) + '</span><span class="tb-bar"><span style="width:' + (r[1] / maxTask * 100).toFixed(1) + '%"></span></span></li>'; }).join('') + '</ul>' : '<p class="empty-note">Pick a task before you start, and you will see here which tasks took your time.</p>') + '</section>' +
      '<section class="report-section"><h2>Recent sessions</h2>' + (recent.length ? '<div class="table-wrap"><table class="log-table"><thead><tr><th>Date</th><th>Time</th><th>Focus</th><th>Task</th><th>Result</th></tr></thead><tbody>' + recent.map(function (e) { var a = new Date(e.start), b = new Date(e.end); return '<tr><td>' + a.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + '</td><td>' + fmtTOD(a) + ' to ' + fmtTOD(b) + '</td><td>' + fmtDur(e.ms) + '</td><td>' + esc(e.task || '—') + '</td><td class="' + (e.done ? '' : 'partial') + '">' + (e.done ? 'Finished' : 'Stopped early') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="empty-note">Your sessions will be listed here.</p>') + '</section>' +
      '<section class="report-section"><h2>Backup</h2><p style="color:var(--granite-2);margin:0 0 12px;max-width:62ch">Your progress lives in this browser. Download a backup now and then, especially before clearing your browser data or switching computers.</p><div class="backup-row">' +
      '<button class="mini-btn" data-rep="export"><svg class="ic"><use href="#i-download"/></svg>Download backup</button>' +
      '<button class="mini-btn" data-rep="import"><svg class="ic"><use href="#i-upload"/></svg>Load backup</button>' +
      '<button class="mini-btn" data-rep="csv"><svg class="ic"><use href="#i-download"/></svg>Sessions as CSV</button>' +
      '<input type="file" accept="application/json,.json" id="import-file" hidden></div></section>';
  }
  function download(name, text, type) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  $('#report').addEventListener('click', function (e) {
    var r = e.target.closest('[data-range]'); if (r) { reportRange = Number(r.dataset.range); renderReport(); return; }
    var b = e.target.closest('[data-rep]'); if (!b) return;
    var stamp = dayKey(new Date());
    if (b.dataset.rep === 'export') download('helvetia-hours-backup-' + stamp + '.json', JSON.stringify({ app: 'helvetia-hours', version: 1, exportedAt: new Date().toISOString(), settings: S, tasks: TASKS, log: LOG, meta: META }, null, 1), 'application/json');
    if (b.dataset.rep === 'csv') download('helvetia-hours-sessions-' + stamp + '.csv', 'date,start,end,minutes,task,result\n' + LOG.map(function (x) { var a = new Date(x.start), c = new Date(x.end); return [dayKey(a), fmtTOD(a), fmtTOD(c), (x.ms / MIN).toFixed(1), '"' + String(x.task || '').replace(/"/g, '""') + '"', x.done ? 'finished' : 'stopped early'].join(','); }).join('\n'), 'text/csv');
    if (b.dataset.rep === 'import') $('#import-file').click();
  });
  $('#report').addEventListener('change', function (e) {
    if (e.target.id !== 'import-file' || !e.target.files[0]) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var data = JSON.parse(rd.result);
        if (!data || data.app !== 'helvetia-hours' || !Array.isArray(data.log)) throw new Error('bad');
        var ok = data.log.every(function (x) { return x && typeof x.ms === 'number' && x.ms >= 0 && typeof x.end === 'number'; });
        if (!ok) throw new Error('bad');
        confirmDialog('Load this backup?', 'It has ' + fmtDur(data.log.reduce(function (a, x) { return a + x.ms; }, 0)) + ' of focus. It will replace the progress saved in this browser now.', 'Load backup').then(function (yes) {
          if (!yes) return;
          store.set('log', data.log); store.set('tasks', data.tasks || { list: [], activeId: null });
          store.set('meta', Object.assign({ celebrated: Math.floor(data.log.reduce(function (a, x) { return a + x.ms; }, 0) / HOUR) }, data.meta || {}));
          if (data.settings) store.set('settings', data.settings);
          location.reload();
        });
      } catch (err) { toast('This file is not a Helvetia Hours backup.'); }
    };
    rd.readAsText(e.target.files[0]);
    e.target.value = '';
  });

  /* =========================================================
     Settings modal
     ========================================================= */
  var settingsModal = $('#settings-modal'), sf = $('#settings-form');
  function fillSettings() {
    $('#s-focus').value = S.focusMin; $('#s-short').value = S.shortMin; $('#s-long').value = S.longMin; $('#s-interval').value = S.longInterval;
    $('#s-autobreak').checked = S.autoStartBreaks; $('#s-autofocus').checked = S.autoStartFocus; $('#s-partial').checked = S.countPartial;
    $('#s-autocheck').checked = S.autoCheckTasks; $('#s-autoswitch').checked = S.autoSwitchTasks;
    $('#s-volume').value = S.alarmVolume; $('#s-alarmlen').value = String(S.alarmLength); $('#s-tick').value = S.tickSound; $('#s-tickvol').value = S.tickVolume;
    $('#s-quality').value = S.sceneQuality; $('#s-clock').value = String(S.clock24);
    $('#s-running-note').hidden = !started();
    updateOutputs(); updateNotifyBtn();
  }
  function updateOutputs() { $('#s-volume-out').textContent = $('#s-volume').value; $('#s-tickvol-out').textContent = $('#s-tickvol').value; }
  function updateNotifyBtn() {
    var b = $('#s-notify');
    if (!canNotify()) { b.textContent = 'Not supported'; b.disabled = true; return; }
    if (Notification.permission === 'denied') { b.textContent = 'Blocked in browser'; b.disabled = true; return; }
    b.disabled = false; b.textContent = S.notifications && Notification.permission === 'granted' ? 'On (turn off)' : 'Turn on';
  }
  function openSettings() { fillSettings(); openModal(settingsModal); }
  $('#btn-settings').addEventListener('click', openSettings);
  document.addEventListener('click', function (e) { if (e.target.closest('[data-open="settings"]')) openSettings(); });
  sf.addEventListener('click', function (e) {
    var st = e.target.closest('[data-step]');
    if (st) { var inp = $('#' + st.dataset.for); inp.value = clamp((Number(inp.value) || 0) + Number(st.dataset.step), Number(inp.min), Number(inp.max)); return; }
    var pr = e.target.closest('[data-preset]');
    if (pr) { var v = pr.dataset.preset.split(','); $('#s-focus').value = v[0]; $('#s-short').value = v[1]; $('#s-long').value = v[2]; }
  });
  sf.addEventListener('input', updateOutputs);
  $('#s-test-sound').addEventListener('click', function () { unlockAudio(); if (alarmStopAt) stopAlarm(); else playAlarm(8, Number($('#s-volume').value)); });
  $('#s-notify').addEventListener('click', function () {
    if (S.notifications && canNotify() && Notification.permission === 'granted') { S.notifications = false; saveSettings(); updateNotifyBtn(); toast('Desktop alerts are off.'); return; }
    requestNotify().then(updateNotifyBtn);
  });
  $('#s-reset-all').addEventListener('click', function () {
    confirmDialog('Reset all progress?', 'This deletes your focus hours, tasks, unlocked chapters and settings on this device. Download a backup first if you might want them later.', 'Reset everything', true).then(function (ok) {
      if (ok) { store.clearAll(); location.reload(); }
    });
  });
  $('#s-cancel').addEventListener('click', function () { closeModal(settingsModal); });
  sf.addEventListener('submit', function (e) {
    e.preventDefault();
    var oldQuality = S.sceneQuality;
    S.focusMin = clamp(Math.round(Number($('#s-focus').value) || DEFAULTS.focusMin), 1, 180);
    S.shortMin = clamp(Math.round(Number($('#s-short').value) || DEFAULTS.shortMin), 1, 60);
    S.longMin = clamp(Math.round(Number($('#s-long').value) || DEFAULTS.longMin), 1, 120);
    S.longInterval = clamp(Math.round(Number($('#s-interval').value) || DEFAULTS.longInterval), 1, 12);
    S.autoStartBreaks = $('#s-autobreak').checked; S.autoStartFocus = $('#s-autofocus').checked; S.countPartial = $('#s-partial').checked;
    S.autoCheckTasks = $('#s-autocheck').checked; S.autoSwitchTasks = $('#s-autoswitch').checked;
    S.alarmVolume = Number($('#s-volume').value); S.alarmLength = $('#s-alarmlen').value === 'full' ? 'full' : Number($('#s-alarmlen').value);
    S.tickSound = $('#s-tick').value; S.tickVolume = Number($('#s-tickvol').value);
    S.sceneQuality = $('#s-quality').value; S.clock24 = $('#s-clock').value === 'true';
    saveSettings();
    if (!started()) TS.duration = durFor(TS.mode);
    saveTimer();
    if (S.sceneQuality !== oldQuality) applySceneQuality();
    closeModal(settingsModal); renderAll(); renderTasks();
    toast(started() ? 'Saved. New times start with the next session.' : 'Settings saved.');
  });

  /* =========================================================
     3D scene, explore mode, picking
     ========================================================= */
  var sceneOn = false, exploring = false;
  function villageSize() { return 6 + hoursDone(); }
  function initScene() {
    if (S.sceneQuality === 'off' || !window.SwissScene || !window.THREE) { body.classList.add('scene-off'); sceneOn = false; return; }
    var ok = false;
    try { ok = SwissScene.init({ canvas: $('#scene'), quality: S.sceneQuality, mode: TS.mode, village: villageSize() }); } catch (e) { console.warn(e); ok = false; }
    sceneOn = !!ok; body.classList.toggle('scene-off', !sceneOn);
    if (sceneOn) SwissScene.onPick = onPick;
  }
  function applySceneQuality() {
    if (S.sceneQuality === 'off') { if (sceneOn) SwissScene.pause(); sceneOn = false; body.classList.add('scene-off'); if (exploring) setExplore(false); return; }
    if (!SwissScene.available) { initScene(); return; }
    SwissScene.setQuality(S.sceneQuality); SwissScene.setMode(TS.mode); SwissScene.setVillageSize(villageSize()); SwissScene.resume();
    sceneOn = true; body.classList.remove('scene-off');
  }
  function onPick(p) {
    var b = document.createElement('div'); b.className = 'bubble';
    b.style.left = p.x + 'px'; b.style.top = p.y + 'px';
    b.textContent = p.type === 'cow' ? pickOne(['Muuh!', 'Grüezi!', 'Moo-ve those minutes!', 'Cheese for your fondue?', 'Keep climbing!']) : 'Tüü-taa-too!';
    $('#bubble-layer').appendChild(b); setTimeout(function () { b.remove(); }, 1900);
    if (p.type === 'cow') cowbell(0.22); else postHorn(0.14);
  }
  function setExplore(on) {
    if (on && !sceneOn) { toast('Turn on the 3D valley in Settings to explore it.', { action: { label: 'Settings', fn: openSettings } }); return; }
    exploring = on; body.classList.toggle('exploring', on); el.pill.hidden = !on;
    SwissScene.setExplore(on);
    if (on) { $('#explore-exit').focus(); ensureCtx(); }
  }
  $('#btn-explore').addEventListener('click', function () { setExplore(!exploring); });
  $('#explore-exit').addEventListener('click', function () { setExplore(false); });
  el.pillToggle.addEventListener('click', toggleTimer);

  /* =========================================================
     Router
     ========================================================= */
  var VIEWS = ['home', 'guide', 'cantons', 'report'];
  var mapCtx = { isUnlocked: isUnlocked, lockText: lockText, openWonder: openWonder };
  function showView(name) {
    $$('.view').forEach(function (v) { v.hidden = v.dataset.view !== name; });
    $$('.tabs a').forEach(function (a) { if (a.dataset.tab === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    body.dataset.route = name;
    if (name === 'cantons') { HHMap.init(mapCtx); HHMap.refresh(); }
    if (name === 'report') renderReport();
  }
  function route() {
    var h = (location.hash || '#home').slice(1);
    if (h.indexOf('g-') === 0) {
      if (body.dataset.route !== 'guide') showView('guide');
      var t = document.getElementById(h); if (t) setTimeout(function () { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30);
      return;
    }
    if (VIEWS.indexOf(h) < 0) h = 'home';
    if (exploring) setExplore(false);
    showView(h); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  window.addEventListener('hashchange', route);

  /* =========================================================
     Controls & keyboard
     ========================================================= */
  el.start.addEventListener('click', toggleTimer);
  el.skip.addEventListener('click', skipSession);
  el.reset.addEventListener('click', resetSession);
  $$('.mode-tabs [data-mode]').forEach(function (b) { b.addEventListener('click', function () { switchMode(b.dataset.mode); }); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (window.HHLightbox && HHLightbox.isOpen()) return;
      if (modalStack.length) { closeModal(modalStack[modalStack.length - 1].el); return; }
      if (exploring) { setExplore(false); return; }
      el.taskMenu.hidden = true; return;
    }
    if (modalStack.length || (window.HHLightbox && HHLightbox.isOpen())) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' || e.key === ' ') {
      if (tag === 'BUTTON' || tag === 'A' || (t && t.classList && t.classList.contains('task'))) return;
      e.preventDefault(); toggleTimer();
    } else if (e.key === 'n' || e.key === 'N') skipSession();
    else if (e.key === 'r' || e.key === 'R') resetSession();
    else if (e.key === 'e' || e.key === 'E') setExplore(!exploring);
  });
  document.addEventListener('pointerdown', function () { ensureCtx(); }, { once: true });
  var scrolledOn = false;
  window.addEventListener('scroll', function () { var on = window.scrollY > 8; if (on !== scrolledOn) { scrolledOn = on; body.classList.toggle('scrolled', on); } }, { passive: true });

  /* =========================================================
     Boot
     ========================================================= */
  // Recover a session that ended while the page was closed
  if (running() && remaining() <= 0) completeSession(TS.runningSince + (TS.duration - TS.elapsed), { recovery: true });
  applyMode();
  initScene();
  renderTasks();
  renderWonders();
  renderAll();
  route();
  startTicker();
  if ((META.celebrated || 0) < hoursDone()) afterProgress(total());
  window.HH = { // small debug helper for the browser console
    state: function () { return { timer: TS, totalMs: total(), hours: hoursDone() }; }
  };
})();
