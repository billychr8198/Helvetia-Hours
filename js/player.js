/* =========================================================
   Helvetia Hours — locked chapter player
   Uses the YouTube IFrame API in privacy-enhanced mode
   (youtube-nocookie.com). YouTube's own controls are hidden and
   covered, so only this chapter can be played: the player starts at
   the chapter start, stops at the chapter end, and any jump outside
   the chapter is pulled back.
   ========================================================= */
(function () {
  'use strict';
  var P = { open: open, close: close, isOpen: function () { return !!cur; } };
  window.HHPlayer = P;

  var apiPromise = null, player = null, cur = null, guardId = 0, finished = false, seeking = false, muted = false;
  var $ = function (id) { return document.getElementById(id); };
  var els = {};

  function fmt(s) {
    s = Math.max(0, Math.floor(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  }

  function loadAPI() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (apiPromise) return apiPromise;
    apiPromise = new Promise(function (resolve, reject) {
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (typeof prev === 'function') { try { prev(); } catch (e) {} } resolve(); };
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
      s.onerror = function () { apiPromise = null; reject(new Error('network')); };
      document.head.appendChild(s);
      setTimeout(function () { if (!(window.YT && window.YT.Player)) { apiPromise = null; reject(new Error('timeout')); } }, 20000);
    });
    return apiPromise;
  }

  function cacheEls() {
    if (els.modal) return;
    ['player-modal', 'player-title', 'player-meta', 'player-stage', 'player-shield', 'player-overlay', 'pc-play', 'pc-back', 'pc-fwd', 'pc-time', 'pc-seek', 'pc-mute', 'pc-vol', 'pc-full', 'yt-host', 'player-note']
      .forEach(function (id) { els[id.replace(/-/g, '_')] = $(id); });
    els.modal = els.player_modal;
    els.player_shield.addEventListener('click', toggle);
    els.pc_play.addEventListener('click', toggle);
    els.pc_back.addEventListener('click', function () { nudge(-10); });
    els.pc_fwd.addEventListener('click', function () { nudge(10); });
    els.pc_seek.addEventListener('input', function () { seeking = true; showTime(cur.start + Number(els.pc_seek.value) / 100 * segLen()); });
    els.pc_seek.addEventListener('change', function () {
      seeking = false; if (!player || !cur) return;
      var t = clampT(cur.start + Number(els.pc_seek.value) / 100 * segLen());
      finished = false; hideOverlay(); player.seekTo(t, true);
    });
    els.pc_mute.addEventListener('click', function () {
      if (!player) return; muted = !muted; if (muted) player.mute(); else player.unMute(); setMuteIcon();
    });
    els.pc_vol.addEventListener('input', function () {
      if (!player) return; player.setVolume(Number(els.pc_vol.value)); if (muted && Number(els.pc_vol.value) > 0) { muted = false; player.unMute(); setMuteIcon(); }
    });
    var stage = els.player_stage;
    var canFull = !!(stage.requestFullscreen || stage.webkitRequestFullscreen);
    if (!canFull) els.pc_full.hidden = true;
    els.pc_full.addEventListener('click', function () {
      var fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (fs) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
      else { (stage.requestFullscreen || stage.webkitRequestFullscreen).call(stage); }
    });
    document.addEventListener('keydown', function (e) {
      if (!cur) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-5); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(5); }
      else if (e.key === 'm') { els.pc_mute.click(); }
    }, true);
  }

  function segEnd() {
    if (!cur) return 0;
    if (cur.end != null) return cur.end;
    var d = player && player.getDuration ? player.getDuration() : 0;
    return d > cur.start ? d : cur.start + 600;
  }
  function segLen() { return Math.max(1, segEnd() - cur.start); }
  function clampT(t) { return Math.min(segEnd() - 0.6, Math.max(cur.start, t)); }
  function nudge(d) {
    if (!player || !cur) return;
    var t = clampT(player.getCurrentTime() + d);
    finished = false; hideOverlay(); player.seekTo(t, true);
  }
  function toggle() {
    if (!player || !cur || !player.getPlayerState) return;
    if (finished) { finished = false; hideOverlay(); player.seekTo(cur.start, true); player.playVideo(); return; }
    var st = player.getPlayerState();
    if (st === 1 || st === 3) player.pauseVideo(); else player.playVideo();
  }
  function setPlayIcon(playing) {
    els.pc_play.innerHTML = '<svg class="ic"><use href="#i-' + (playing ? 'pause' : 'play') + '"/></svg>';
    els.pc_play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  function setMuteIcon() {
    els.pc_mute.innerHTML = '<svg class="ic"><use href="#i-' + (muted ? 'mute' : 'sound') + '"/></svg>';
    els.pc_mute.setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute');
  }
  function showTime(t) {
    var rel = Math.max(0, t - cur.start);
    els.pc_time.textContent = fmt(rel) + ' / ' + fmt(segLen());
    if (!seeking) els.pc_seek.value = Math.min(100, rel / segLen() * 100);
  }
  function showOverlay(html) { els.player_overlay.innerHTML = '<div class="po-inner">' + html + '</div>'; els.player_overlay.hidden = false; }
  function hideOverlay() { els.player_overlay.hidden = true; }

  function guard() {
    if (!player || !cur || !player.getCurrentTime) return;
    var t = player.getCurrentTime(), end = segEnd(), st = player.getPlayerState();
    if (t < cur.start - 0.8) { player.seekTo(cur.start, true); return; }
    if (t > end + 1.2) { player.seekTo(cur.start, true); player.pauseVideo(); return; }
    if (!finished && (t >= end - 0.2 || st === 0)) {
      finished = true;
      player.pauseVideo();
      cur.maxReached = segLen();
      showOverlay('<h3>That is the end of this chapter</h3><p>Well done. The next part opens with your next hour of focus.</p>' +
        '<button class="mini-btn" data-po="replay"><svg class="ic"><use href="#i-reset"/></svg>Watch again</button> ' +
        '<button class="mini-btn ghost" data-po="close">Close</button>');
      if (cur.onWatched) cur.onWatched(cur.id);
    }
    if (!finished) cur.maxReached = Math.max(cur.maxReached || 0, t - cur.start);
    showTime(Math.min(t, end));
  }

  function build(w) {
    if (player && player.destroy) { try { player.destroy(); } catch (e) {} }
    player = null;
    els.yt_host.innerHTML = '<div id="yt-frame"></div>';
    var vars = {
      start: Math.floor(w.start), autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1,
      iv_load_policy: 3, playsinline: 1, enablejsapi: 1, cc_load_policy: 0
    };
    if (w.end != null) vars.end = Math.ceil(w.end);
    if (/^https?:/.test(location.protocol)) vars.origin = location.origin;
    player = new YT.Player('yt-frame', {
      host: 'https://www.youtube-nocookie.com', videoId: w.video, width: '100%', height: '100%', playerVars: vars,
      events: {
        onReady: function () {
          try { player.getIframe().setAttribute('tabindex', '-1'); player.getIframe().setAttribute('title', w.title); } catch (e) {}
          player.setVolume(Number(els.pc_vol.value));
          player.seekTo(w.start, true);
          player.playVideo();
          hideOverlay();
          clearInterval(guardId); guardId = setInterval(guard, 200);
        },
        onStateChange: function (e) {
          setPlayIcon(e.data === 1 || e.data === 3);
          if (e.data === 1) hideOverlay();
        },
        onError: function (e) {
          var code = e && e.data;
          var msg = code === 101 || code === 150
            ? 'The owner of this film does not allow it to be played on other websites right now.'
            : code === 153 || location.protocol === 'file:'
              ? 'YouTube needs the site to be opened from the internet. Open it from GitHub Pages or a local server, not by double-clicking the file.'
              : 'The film could not load. Check your internet connection and try again.';
          showOverlay('<h3>This chapter cannot play here</h3><p>' + msg + '</p><button class="mini-btn ghost" data-po="close">Close</button>');
        }
      }
    });
  }

  function open(w, opts) {
    cacheEls();
    opts = opts || {};
    cur = { id: w.id, video: w.video, start: w.start, end: w.end, title: w.title, onWatched: opts.onWatched, onClose: opts.onClose, maxReached: 0 };
    finished = false; seeking = false; muted = false; setMuteIcon(); setPlayIcon(false);
    els.player_title.textContent = w.title;
    els.player_meta.textContent = opts.meta || '';
    els.pc_time.textContent = '0:00 / ' + (w.end != null ? fmt(w.end - w.start) : '…');
    els.pc_seek.value = 0;
    showOverlay('<h3>Loading the film</h3><p>Getting your chapter ready.</p>');
    if (opts.show) opts.show(els.modal); else els.modal.hidden = false;
    els.player_overlay.onclick = function (e) {
      var b = e.target.closest('[data-po]'); if (!b) return;
      if (b.dataset.po === 'replay') { finished = false; hideOverlay(); player.seekTo(cur.start, true); player.playVideo(); }
      if (b.dataset.po === 'close') { var c = els.modal.querySelector('[data-close].icon-btn'); if (c) c.click(); else close(); }
    };
    loadAPI().then(function () { if (cur && cur.id === w.id) build(w); }).catch(function () {
      showOverlay('<h3>YouTube could not load</h3><p>Check your internet connection, then open the chapter again.</p><button class="mini-btn ghost" data-po="close">Close</button>');
    });
  }

  function close() {
    clearInterval(guardId);
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {} }
    if (player && player.destroy) { try { player.stopVideo(); player.destroy(); } catch (e) {} }
    player = null;
    if (els.yt_host) els.yt_host.innerHTML = '';
    var c = cur; cur = null;
    if (c && c.onClose) c.onClose(c);
  }
})();
