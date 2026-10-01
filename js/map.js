/* =========================================================
   Helvetia Hours — canton map + photo lightbox
   ========================================================= */
(function () {
  'use strict';
  var D = window.HH_DATA;
  var NS = 'http://www.w3.org/2000/svg';
  var M = { init: init, select: select, refresh: refresh };
  window.HHMap = M;

  var ctx = null, svg, stage, tooltip, panel, vb0, vb, selected = null, built = false;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function byId(id) { for (var i = 0; i < D.cantons.length; i++) if (D.cantons[i].id === id) return D.cantons[i]; return null; }

  function init(context) {
    ctx = context;
    if (built) return;
    built = true;
    svg = document.getElementById('ch-map');
    stage = document.getElementById('map-stage');
    tooltip = document.getElementById('map-tooltip');
    panel = document.getElementById('canton-panel');
    vb0 = D.map.viewBox.slice(); vb = vb0.slice();
    svg.setAttribute('viewBox', vb.join(' '));
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    var gShapes = document.createElementNS(NS, 'g'), gLabels = document.createElementNS(NS, 'g'), gPins = document.createElementNS(NS, 'g');
    D.cantons.slice().sort(function (a, b) { return b.area - a.area; }).forEach(function (c) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', c.d); p.setAttribute('class', 'canton'); p.setAttribute('data-id', c.id);
      p.setAttribute('fill-rule', 'evenodd'); p.setAttribute('tabindex', '0'); p.setAttribute('role', 'button');
      p.setAttribute('aria-label', c.name);
      gShapes.appendChild(p);
      var t = document.createElementNS(NS, 'text');
      var fs = Math.max(0.3, Math.min(0.78, Math.sqrt(c.area) * 0.15));
      t.setAttribute('x', c.label[0]); t.setAttribute('y', c.label[1]); t.setAttribute('font-size', fs.toFixed(2));
      t.setAttribute('class', 'canton-label'); t.setAttribute('data-id', c.id); t.textContent = c.abbr;
      gLabels.appendChild(t);
      var pin = document.createElementNS(NS, 'circle');
      pin.setAttribute('cx', c.label[0]); pin.setAttribute('cy', (c.label[1] - fs * 0.95).toFixed(3)); pin.setAttribute('r', (fs * 0.2).toFixed(3));
      pin.setAttribute('class', 'map-pin'); pin.setAttribute('data-id', c.id); pin.style.display = 'none';
      gPins.appendChild(pin);
    });
    svg.appendChild(gShapes); svg.appendChild(gLabels); svg.appendChild(gPins);
    var legend = document.createElement('div'); legend.className = 'map-legend'; legend.innerHTML = '<i></i>Film chapter unlocked';
    stage.parentNode.appendChild(legend);

    var sel = document.getElementById('canton-select');
    D.cantons.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (c) {
      var o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    });
    sel.addEventListener('change', function () { if (sel.value) select(sel.value, true); });

    svg.addEventListener('keydown', function (e) {
      var t = e.target.closest && e.target.closest('.canton');
      if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(t.dataset.id, true); }
    });
    bindPanZoom();
    document.getElementById('map-zoom-in').addEventListener('click', function () { zoomAt(0.7); });
    document.getElementById('map-zoom-out').addEventListener('click', function () { zoomAt(1 / 0.7); });
    document.getElementById('map-zoom-reset').addEventListener('click', function () { vb = vb0.slice(); apply(); });

    panel.addEventListener('click', function (e) {
      var ph = e.target.closest('[data-photo]');
      if (ph) { var c = byId(ph.dataset.canton); Lightbox.open(c.photos, Number(ph.dataset.photo), c.name); return; }
      var ch = e.target.closest('[data-wonder]');
      if (ch) ctx.openWonder(ch.dataset.wonder);
    });
    refresh();
  }

  /* -------- pan & zoom with the viewBox -------- */
  function apply() {
    var maxW = vb0[2] * 1.2, minW = vb0[2] / 9;
    vb[2] = Math.min(maxW, Math.max(minW, vb[2])); vb[3] = vb[2] * vb0[3] / vb0[2];
    var cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2;
    cx = Math.min(vb0[0] + vb0[2], Math.max(vb0[0], cx)); cy = Math.min(vb0[1] + vb0[3], Math.max(vb0[1], cy));
    vb[0] = cx - vb[2] / 2; vb[1] = cy - vb[3] / 2;
    svg.setAttribute('viewBox', vb.map(function (n) { return n.toFixed(4); }).join(' '));
  }
  function toSvg(clientX, clientY) {
    var r = svg.getBoundingClientRect(), s = Math.min(r.width / vb[2], r.height / vb[3]);
    var ox = (r.width - vb[2] * s) / 2, oy = (r.height - vb[3] * s) / 2;
    return { x: vb[0] + (clientX - r.left - ox) / s, y: vb[1] + (clientY - r.top - oy) / s, s: s };
  }
  function zoomAt(f, cx, cy) {
    var r = svg.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    var p = toSvg(cx, cy), nw = Math.min(vb0[2] * 1.2, Math.max(vb0[2] / 9, vb[2] * f)), k = nw / vb[2];
    vb[0] = p.x - (p.x - vb[0]) * k; vb[1] = p.y - (p.y - vb[1]) * k; vb[2] = nw; vb[3] = nw * vb0[3] / vb0[2];
    apply();
  }
  function bindPanZoom() {
    var pts = {}, moved = 0, pinch = null;
    stage.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
    stage.addEventListener('pointerdown', function (e) {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY }; moved = 0;
      if (Object.keys(pts).length === 2) { var a = Object.values(pts); pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), w: vb[2] }; }
    });
    stage.addEventListener('pointermove', function (e) {
      var c = e.target.closest && e.target.closest('.canton');
      if (c && e.pointerType === 'mouse' && !Object.keys(pts).length) {
        var r = stage.parentNode.getBoundingClientRect();
        tooltip.hidden = false; tooltip.textContent = byId(c.dataset.id).name;
        tooltip.style.left = (e.clientX - r.left) + 'px'; tooltip.style.top = (e.clientY - r.top) + 'px';
      } else if (!c) tooltip.hidden = true;
      var p = pts[e.pointerId]; if (!p) return;
      var dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4 && !stage.hasPointerCapture(e.pointerId)) { try { stage.setPointerCapture(e.pointerId); } catch (err) {} stage.classList.add('dragging'); tooltip.hidden = true; }
      var ids = Object.keys(pts);
      if (ids.length === 2 && pinch) {
        var a = Object.values(pts), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        var nw = pinch.w * pinch.d / Math.max(1, d), mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
        zoomAt(nw / vb[2], mx, my); return;
      }
      if (moved > 4) { var s = toSvg(0, 0).s; vb[0] -= dx / s; vb[1] -= dy / s; apply(); }
    });
    function up(e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      if (Object.keys(pts).length < 2) pinch = null;
      stage.classList.remove('dragging');
      if (moved <= 4 && !Object.keys(pts).length) {
        var el = document.elementFromPoint(e.clientX, e.clientY), c = el && el.closest && el.closest('.canton');
        if (c) select(c.dataset.id, true);
      }
    }
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('pointerleave', function () { tooltip.hidden = true; });
  }

  /* -------- selection & panel -------- */
  function wondersFor(id) { return D.wonders.filter(function (w) { return w.cantons.indexOf(id) >= 0; }); }

  function refresh() {
    if (!built) return;
    D.cantons.forEach(function (c) {
      var open = wondersFor(c.id).some(function (w) { return ctx.isUnlocked(w); });
      var path = svg.querySelector('.canton[data-id="' + c.id + '"]'), pin = svg.querySelector('.map-pin[data-id="' + c.id + '"]');
      path.classList.toggle('has-footage', open); pin.style.display = open ? '' : 'none';
    });
    if (selected) renderPanel(selected);
  }

  function select(id, scroll) {
    var c = byId(id); if (!c) return;
    selected = id;
    svg.querySelectorAll('.canton.selected, .canton-label.selected').forEach(function (el) { el.classList.remove('selected'); });
    var path = svg.querySelector('.canton[data-id="' + id + '"]');
    path.classList.add('selected'); path.parentNode.appendChild(path);
    svg.querySelector('.canton-label[data-id="' + id + '"]').classList.add('selected');
    document.getElementById('canton-select').value = id;
    renderPanel(id);
    if (scroll && window.matchMedia('(max-width: 900px)').matches) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderPanel(id) {
    var c = byId(id), ws = wondersFor(id);
    var chips = ws.map(function (w) {
      var open = ctx.isUnlocked(w);
      return '<button class="chip ' + (open ? 'open' : 'locked') + '" data-wonder="' + w.id + '" title="' + esc(open ? 'Watch this chapter' : ctx.lockText(w)) + '">' +
        '<svg class="ic"><use href="#i-' + (open ? 'play' : 'lock') + '"/></svg>' + esc(w.title.split(' - ')[0]) + (open ? '' : ' <span style="opacity:.7">(hour ' + w.hour + ')</span>') + '</button>';
    }).join('');
    var photos = c.photos.map(function (p, i) {
      return '<button data-photo="' + i + '" data-canton="' + c.id + '" aria-label="Open photo: ' + esc(p.caption) + '"><img src="' + p.thumb + '" alt="' + esc(p.caption) + '" loading="lazy"><figcaption>' + esc(p.caption) + '</figcaption></button>';
    }).join('');
    panel.innerHTML =
      '<div class="cp-head"><img class="cp-flag" src="' + c.flag + '" alt="Flag of ' + esc(c.name) + '"><div><h2>' + esc(c.name) + '</h2><div class="cp-abbr">' + c.abbr + '</div></div></div>' +
      '<dl class="cp-facts"><dt>Capital</dt><dd>' + esc(c.capital) + '</dd><dt>Languages</dt><dd>' + esc(c.languages) + '</dd><dt>Joined the Confederation</dt><dd>' + c.joined + '</dd></dl>' +
      '<div class="cp-photos"><h3>Photos</h3><div class="photo-grid">' + photos + '</div></div>' +
      (ws.length ? '<div class="cp-footage" style="margin-top:18px"><h3>Film chapters from here</h3><div class="chips">' + chips + '</div></div>' : '') +
      '<div class="cp-story" style="margin-top:18px">' + c.story.map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div>' +
      '<p style="font-size:13px;color:var(--granite-3);margin:6px 0 0"><a href="' + c.flagCredit + '" target="_blank" rel="noopener">Flag source</a> on Wikimedia Commons.</p>';
    panel.scrollTop = 0;
  }

  /* =========================================================
     Lightbox with zoom, pan, pinch, keyboard
     ========================================================= */
  var Lightbox = (function () {
    var lb, img, stageEl, cap, zoomEl, credit, list = [], idx = 0, st = { s: 1, x: 0, y: 0, fit: 1, w: 1, h: 1 }, pts = {}, pinch = null, lastTap = 0, onCloseCb;
    function q(id) { return document.getElementById(id); }
    function setup() {
      if (lb) return;
      lb = q('lightbox'); img = q('lb-img'); stageEl = q('lb-stage'); cap = q('lb-caption'); zoomEl = q('lb-zoom'); credit = q('lb-credit');
      q('lb-close').addEventListener('click', close);
      q('lb-prev').addEventListener('click', function () { go(-1); });
      q('lb-next').addEventListener('click', function () { go(1); });
      q('lb-zoom-in').addEventListener('click', function () { zoom(1.4); });
      q('lb-zoom-out').addEventListener('click', function () { zoom(1 / 1.4); });
      q('lb-fit').addEventListener('click', function () { fit(true); });
      stageEl.addEventListener('wheel', function (e) { e.preventDefault(); zoom(e.deltaY > 0 ? 1 / 1.15 : 1.15, e.clientX, e.clientY); }, { passive: false });
      stageEl.addEventListener('pointerdown', function (e) {
        stageEl.setPointerCapture(e.pointerId); pts[e.pointerId] = { x: e.clientX, y: e.clientY }; img.classList.remove('animate');
        if (Object.keys(pts).length === 2) { var a = Object.values(pts); pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), s: st.s }; }
        stageEl.classList.add('dragging');
      });
      stageEl.addEventListener('pointermove', function (e) {
        var p = pts[e.pointerId]; if (!p) return;
        var dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
        if (Object.keys(pts).length === 2 && pinch) {
          var a = Object.values(pts), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
          setScale(pinch.s * d / pinch.d, (a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2); return;
        }
        st.x += dx; st.y += dy; render();
      });
      function up(e) {
        if (!pts[e.pointerId]) return; delete pts[e.pointerId];
        if (Object.keys(pts).length < 2) pinch = null;
        if (!Object.keys(pts).length) stageEl.classList.remove('dragging');
        var now = Date.now();
        if (e.pointerType !== 'mouse') { if (now - lastTap < 300) dbl(e.clientX, e.clientY); lastTap = now; }
      }
      stageEl.addEventListener('pointerup', up); stageEl.addEventListener('pointercancel', up);
      stageEl.addEventListener('dblclick', function (e) { dbl(e.clientX, e.clientY); });
      document.addEventListener('keydown', function (e) {
        if (lb.hidden) return;
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
        else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
        else if (e.key === '+' || e.key === '=') zoom(1.3); else if (e.key === '-') zoom(1 / 1.3); else if (e.key === '0') fit(true);
      }, true);
      window.addEventListener('resize', function () { if (!lb.hidden) fit(false); });
    }
    function dbl(cx, cy) { img.classList.add('animate'); if (st.s > st.fit * 1.05) fit(true); else setScale(Math.max(st.fit * 2.5, 1), cx, cy); }
    function render() {
      img.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.s + ')';
      zoomEl.textContent = Math.round(st.s * 100) + '%';
    }
    function setScale(s, cx, cy) {
      var min = st.fit * 0.6, max = Math.max(4, st.fit * 10); s = Math.min(max, Math.max(min, s));
      if (cx == null) { cx = window.innerWidth / 2; cy = window.innerHeight / 2; }
      st.x = cx - (cx - st.x) * (s / st.s); st.y = cy - (cy - st.y) * (s / st.s); st.s = s; render();
    }
    function zoom(f, cx, cy) { img.classList.add('animate'); setScale(st.s * f, cx, cy); }
    function fit(anim) {
      var vw = window.innerWidth, vh = window.innerHeight - 140;
      st.fit = Math.min(vw * 0.94 / st.w, vh / st.h, 2);
      st.s = st.fit; st.x = (vw - st.w * st.s) / 2; st.y = 70 + (vh - st.h * st.s) / 2;
      img.classList.toggle('animate', !!anim); render();
    }
    function show() {
      var p = list[idx];
      cap.textContent = p.caption + '  (' + (idx + 1) + ' of ' + list.length + ')';
      credit.href = p.credit;
      st.w = p.w; st.h = p.h; img.style.width = p.w + 'px'; img.style.height = p.h + 'px';
      img.alt = p.caption; img.src = p.thumb; fit(false);
      var full = new Image(); full.onload = function () { if (list[idx] === p) img.src = p.src; }; full.src = p.src;
      q('lb-prev').hidden = q('lb-next').hidden = list.length < 2;
    }
    function go(d) { idx = (idx + d + list.length) % list.length; show(); }
    function open(photos, i, title) {
      setup(); list = photos; idx = i || 0; lb.hidden = false; document.body.style.overflow = 'hidden';
      if (window.SwissScene && SwissScene.pause) SwissScene.pause();
      show(); q('lb-close').focus();
    }
    function close() {
      lb.hidden = true; document.body.style.overflow = '';
      if (window.SwissScene && SwissScene.resume) SwissScene.resume();
      if (onCloseCb) onCloseCb();
    }
    return { open: open, close: close, isOpen: function () { return lb && !lb.hidden; } };
  })();
  window.HHLightbox = Lightbox;
})();
