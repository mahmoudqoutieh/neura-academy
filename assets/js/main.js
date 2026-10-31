/* Neura Academy: scroll-scrubbed film, pointer effects, enrollment form. */
(function () {
  "use strict";

  var clamp = function (v, min, max) {
    if (min === undefined) min = 0;
    if (max === undefined) max = 1;
    return Math.min(max, Math.max(min, v));
  };
  var smoothstep = function (v) {
    var x = clamp(v);
    return x * x * (3 - 2 * x);
  };

  /* ---------- Scroll scrub: scroll position drives each chapter's clip ---------- */
  function initScrollScrub() {
    var root = document.querySelector("[data-scroll-scrub]");
    if (!root) return;

    var layers = Array.prototype.slice.call(root.querySelectorAll("[data-scroll-scrub-layer]"));
    var bands = Array.prototype.slice.call(root.querySelectorAll("[data-scroll-scrub-band]"));
    var buttons = Array.prototype.slice.call(root.querySelectorAll("[data-jump]"));
    if (!layers.length || layers.length !== bands.length) return;

    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var coarsePointer = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    var smallViewport = window.matchMedia("(max-width: 860px)");
    var isMobile = function () { return coarsePointer || smallViewport.matches; };

    var segs = layers.map(function (layer, i) {
      return {
        layer: layer,
        band: bands[i],
        clip: layer.getAttribute("data-clip"),
        mobileClip: layer.getAttribute("data-mobile-clip"),
        start: 0, end: 0, current: 0, target: 0,
        visible: i === 0, loading: false, ready: false, failed: false,
        video: null, objectUrl: null, source: null, abort: null
      };
    });
    var sourceFor = function (s) { return isMobile() && s.mobileClip ? s.mobileClip : s.clip; };

    var rootTop = 0, total = 1, vh = window.innerHeight, layoutWidth = window.innerWidth;
    var dirty = true, active = -1, userReady = false;

    function unload(s) {
      if (s.abort) s.abort.abort();
      if (s.video) s.video.remove();
      if (s.objectUrl) URL.revokeObjectURL(s.objectUrl);
      s.abort = s.video = s.objectUrl = s.source = null;
      s.loading = s.ready = s.failed = false;
      s.current = s.target;
      delete s.layer.dataset.videoPainted;
    }

    function layout() {
      var pageY = window.scrollY || window.pageYOffset;
      rootTop = root.getBoundingClientRect().top + pageY;
      vh = window.innerHeight;
      layoutWidth = window.innerWidth;
      segs.forEach(function (s) {
        if (s.source && s.source !== sourceFor(s)) unload(s);
        var r = s.band.getBoundingClientRect();
        s.start = r.top + pageY - rootTop;
        s.end = s.start + r.height;
      });
      total = Math.max(segs[segs.length - 1].end, vh);
      if (typeof wake === "function") wake();
    }

    function prime(video) {
      if (!video || !isMobile()) return;
      var p = video.play();
      if (p && p.then) p.then(function () { video.pause(); }).catch(function () {});
    }

    function load(s) {
      var source = sourceFor(s);
      if (reduceMotion || s.loading || s.ready || s.failed || !source) return;
      s.loading = true;
      s.source = source;
      s.abort = "AbortController" in window ? new AbortController() : null;
      var signal = s.abort ? s.abort.signal : undefined;

      // Fetching the whole clip into a Blob makes every frame seekable instantly.
      fetch(source, { signal: signal })
        .then(function (res) {
          if (!res.ok) throw new Error("clip " + res.status);
          return res.blob();
        })
        .then(function (blob) {
          if (s.source !== source) return;
          var url = URL.createObjectURL(blob);
          var video = document.createElement("video");
          video.className = "scroll-scrub__video";
          video.muted = true;
          video.playsInline = true;
          video.preload = "auto";
          video.setAttribute("muted", "");
          video.setAttribute("playsinline", "");
          video.src = url;
          video.addEventListener("loadedmetadata", function () {
            if (s.video !== video) return;
            s.ready = true;
            s.loading = false;
            wake();
          }, { once: true });
          video.addEventListener("loadeddata", function () {
            if (userReady && s.video === video) prime(video);
          }, { once: true });
          video.addEventListener("seeked", function () {
            if (s.video === video) s.layer.dataset.videoPainted = "true";
          }, { once: true });
          video.addEventListener("error", function () {
            if (s.video !== video) return;
            video.remove();
            URL.revokeObjectURL(url);
            s.video = s.objectUrl = null;
            s.failed = true;
            s.loading = s.ready = false;
          }, { once: true });
          s.layer.appendChild(video);
          s.video = video;
          s.objectUrl = url;
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") return;
          s.failed = true;
          s.loading = false;
        });
    }

    function readScroll() {
      var pageY = window.scrollY || window.pageYOffset;
      var y = clamp(pageY - rootTop, 0, total);
      var fade = 0.1 * vh;
      var current = 0;

      segs.forEach(function (s, i) {
        if (y >= s.start) current = i;
        s.target = clamp((y - s.start) / Math.max(s.end - s.start, 1));
        var outside = y < s.start ? s.start - y : y > s.end ? y - s.end : 0;
        var opacity = reduceMotion ? (outside === 0 ? 1 : 0) : smoothstep(1 - outside / Math.max(fade, 1));
        s.visible = opacity > 0.001;
        s.layer.style.opacity = String(opacity);
        s.layer.style.zIndex = i === current ? "2" : "1";
        // Load only the clips near the reader: mobile data stays small.
        var reach = isMobile() ? 0.75 * vh : 1.5 * vh;
        if (y > s.start - reach && y < s.end + reach) load(s);
      });

      if (current !== active) {
        active = current;
        buttons.forEach(function (b, i) {
          if (i === active) b.setAttribute("aria-current", "step");
          else b.removeAttribute("aria-current");
        });
      }
      root.style.setProperty("--ss-progress", String(clamp(y / total)));
    }

    // Returns true while any clip is still easing toward its scroll target.
    function updateVideos() {
      var eps = isMobile() ? 0.02 : 0.008;
      var busy = false;
      segs.forEach(function (s) {
        var v = s.video;
        if (s.loading) busy = true;
        if (!v || !s.ready) return;
        if (v.seeking) { busy = true; return; }
        if (Math.abs(s.current - s.target) < 0.0005) return;
        busy = true;
        s.current += (s.target - s.current) * 0.2;
        var t = clamp(s.current, 0, 0.999) * (v.duration || 1);
        if (Math.abs(v.currentTime - t) > eps) {
          try { v.currentTime = t; } catch (e) { /* keep last painted frame */ }
        }
      });
      return busy;
    }

    var running = false;
    function tick() {
      if (dirty) {
        dirty = false;
        readScroll();
      }
      var busy = updateVideos();
      if (dirty || busy) {
        window.requestAnimationFrame(tick);
      } else {
        running = false;
      }
    }
    function wake() {
      dirty = true;
      if (!running) {
        running = true;
        window.requestAnimationFrame(tick);
      }
    }

    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", function () {
      // Mobile URL-bar show/hide only changes height: skip the relayout.
      if (coarsePointer && window.innerWidth === layoutWidth) return;
      layout();
    });
    window.addEventListener("orientationchange", layout);
    window.addEventListener("load", layout);
    var onFirstGesture = function () {
      if (userReady) return;
      userReady = true;
      segs.forEach(function (s) { prime(s.video); });
    };
    window.addEventListener("pointerdown", onFirstGesture, { once: true, passive: true });
    window.addEventListener("touchstart", onFirstGesture, { once: true, passive: true });

    buttons.forEach(function (b) {
      b.addEventListener("click", function () {
        var s = segs[Number(b.getAttribute("data-jump"))];
        if (!s) return;
        window.scrollTo({ top: rootTop + s.start + 0.15 * (s.end - s.start), behavior: reduceMotion ? "auto" : "smooth" });
      });
    });

    layout();
    wake();
  }

  /* ---------- Pointer effects (desktop with a mouse only) ---------- */
  function initPointerFx() {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (reduce || !fine) return;

    var root = document.documentElement;
    root.setAttribute("data-fx", "on");
    var ring = document.querySelector(".n-cursor");
    var x = window.innerWidth / 2, y = window.innerHeight / 2;
    var rx = x, ry = y, px = 0, py = 0;

    (function tick() {
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
      px += ((x / window.innerWidth - 0.5) * 2 - px) * 0.08;
      py += ((y / window.innerHeight - 0.5) * 2 - py) * 0.08;
      root.style.setProperty("--mx", px.toFixed(4));
      root.style.setProperty("--my", py.toFixed(4));
      if (ring) ring.style.transform = "translate3d(" + rx + "px," + ry + "px,0)";
      window.requestAnimationFrame(tick);
    })();

    window.addEventListener("pointermove", function (e) {
      x = e.clientX;
      y = e.clientY;
      var t = e.target;
      if (!t || !t.closest) return;

      if (ring) ring.toggleAttribute("data-hot", !!t.closest("a, button, summary, input, select, textarea"));

      var tilt = t.closest("[data-tilt]");
      if (tilt) {
        var r = tilt.getBoundingClientRect();
        var nx = (e.clientX - r.left) / r.width - 0.5;
        var ny = (e.clientY - r.top) / r.height - 0.5;
        tilt.style.setProperty("--rx", (-ny * 10).toFixed(2) + "deg");
        tilt.style.setProperty("--ry", (nx * 12).toFixed(2) + "deg");
        tilt.style.setProperty("--gx", ((nx + 0.5) * 100).toFixed(1) + "%");
        tilt.style.setProperty("--gy", ((ny + 0.5) * 100).toFixed(1) + "%");
      }

      var magnet = t.closest("[data-magnetic]");
      if (magnet) {
        var m = magnet.getBoundingClientRect();
        var dx = e.clientX - (m.left + m.width / 2);
        var dy = e.clientY - (m.top + m.height / 2);
        magnet.style.transform = "translate3d(" + dx * 0.22 + "px," + dy * 0.3 + "px,0)";
      }

      var list = t.closest(".n-tracks__list");
      if (list) {
        var l = list.getBoundingClientRect();
        list.style.setProperty("--px", e.clientX - l.left + "px");
        list.style.setProperty("--py", e.clientY - l.top + "px");
      }
    }, { passive: true });

    window.addEventListener("pointerout", function (e) {
      var from = e.target, to = e.relatedTarget;
      if (!from || !from.closest) return;
      var tilt = from.closest("[data-tilt]");
      if (tilt && !tilt.contains(to)) {
        tilt.style.setProperty("--rx", "0deg");
        tilt.style.setProperty("--ry", "0deg");
      }
      var magnet = from.closest("[data-magnetic]");
      if (magnet && !magnet.contains(to)) magnet.style.transform = "";
    }, { passive: true });
  }

  /* ---------- Enrollment form ---------- */
  function initEnroll() {
    var form = document.querySelector(".n-form");
    if (!form) return;
    var done = document.querySelector(".n-form-done");
    var errorBox = form.querySelector(".n-form-error");
    var button = form.querySelector(".n-submit");
    var label = form.querySelector(".n-submit__label");
    var idleLabel = label.textContent;

    function applyPlanFromUrl() {
      var plan = new URLSearchParams(window.location.search).get("plan");
      if (plan === "monthly" || plan === "yearly") form.elements.plan.value = plan;
    }
    applyPlanFromUrl();
    window.addEventListener("popstate", applyPlanFromUrl);

    // Plan buttons pick the plan without reloading the page.
    Array.prototype.forEach.call(document.querySelectorAll("[data-plan]"), function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        form.elements.plan.value = a.getAttribute("data-plan");
        if (window.history && history.replaceState) {
          history.replaceState(null, "", "?plan=" + a.getAttribute("data-plan") + "#enroll");
        }
        document.getElementById("enroll").scrollIntoView({ behavior: "smooth" });
      });
    });

    function fail(message) {
      errorBox.textContent = message;
      errorBox.hidden = false;
      button.disabled = false;
      button.removeAttribute("data-busy");
      label.textContent = idleLabel;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.elements.name.value.trim();
      var email = form.elements.email.value.trim();
      if (name.length < 2) return fail("اكتب اسمك الكامل.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("تأكد من كتابة بريد إلكتروني صحيح.");

      errorBox.hidden = true;
      button.disabled = true;
      button.setAttribute("data-busy", "true");
      label.textContent = "جارٍ الإرسال";

      fetch(form.getAttribute("action"), {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" }
      })
        .then(function (res) {
          return res.json().catch(function () { return { ok: false }; });
        })
        .then(function (data) {
          if (data && data.ok) {
            form.hidden = true;
            done.hidden = false;
            return;
          }
          fail((data && data.message) || "تعذّر حفظ طلبك الآن. حاول مرة أخرى بعد قليل.");
        })
        .catch(function () {
          fail("تعذّر الاتصال. تحقق من الإنترنت ثم حاول مجدداً.");
        });
    });
  }


  /* ---------- Phone: scrolling plays the film as still frames on a canvas ---------- */
  // Drawing a ready image is cheap on phones; seeking a <video> is what stutters.
  function initPhoneFilm() {
    var section = document.querySelector(".m-scroll");
    if (!section) return;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var canvas = section.querySelector(".m-scroll__canvas");
    var ctx = canvas && canvas.getContext && canvas.getContext("2d");
    if (reduce || !ctx) return; // CSS shows a plain readable stack instead

    var media = section.querySelector(".m-scroll__media");
    var stage = section.querySelector(".m-scroll__stage");
    var bar = section.querySelector(".m-scroll__progress span");
    var chapters = Array.prototype.slice.call(section.querySelectorAll(".m-scroll__chapter"));
    var count = Number(section.getAttribute("data-count")) || 1;
    var base = section.getAttribute("data-frames");
    var saveData = navigator.connection && navigator.connection.saveData;
    var frames = new Array(count);
    var loaded = new Array(count);
    // Decoded copies of the frames near the reader: drawing these is ~7x cheaper
    // than drawing an <img>, which the browser would re-decode every time.
    var bitmaps = {}, pendingBitmap = {};
    var canBitmap = typeof window.createImageBitmap === "function";
    var WINDOW = 10;
    var top = 0, span = 1, progress = 0, drawn = -1, running = false, dirty = true, started = false;
    var chapterState = chapters.map(function () { return { o: -1, y: 0 }; });

    section.classList.add("is-ready");

    function url(i) {
      var n = String(i + 1);
      while (n.length < 3) n = "0" + n;
      return base + n + ".webp";
    }

    // Coarse-to-fine order: every 16th frame first, then fill the gaps.
    function loadAll() {
      if (started) return;
      started = true;
      var order = [], seen = {}, strides = saveData ? [8, 4] : [16, 8, 4, 2, 1];
      strides.forEach(function (st) {
        for (var i = 0; i < count; i += st) if (!seen[i]) { seen[i] = 1; order.push(i); }
      });
      if (!seen[count - 1]) order.push(count - 1);
      var next = 0, active = 0;
      function pump() {
        while (active < 6 && next < order.length) {
          (function (i) {
            active++;
            var img = new Image();
            img.decoding = "async";
            img.onload = function () {
              // Decode off the main thread so drawing it later never blocks scrolling.
              var ready = function () {
                loaded[i] = true;
                active--;
                if (Math.abs(i - frameIndex()) < 20) wake();
                pump();
              };
              if (img.decode) img.decode().then(ready, ready);
              else ready();
            };
            img.onerror = function () { active--; pump(); };
            img.src = url(i);
            frames[i] = img;
          })(order[next++]);
        }
      }
      pump();
    }

    function frameIndex() { return Math.round(progress * (count - 1)); }

    function nearestLoaded(i) {
      for (var d = 0; d < count; d++) {
        if (i - d >= 0 && loaded[i - d]) return i - d;
        if (i + d < count && loaded[i + d]) return i + d;
      }
      return -1;
    }

    function layout() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.round(media.clientWidth * dpr), h = Math.round(media.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        drawn = -1;
      }
      var rect = section.getBoundingClientRect();
      // The stage sticks below the header, so the film starts that much earlier.
      var stickTop = parseFloat(window.getComputedStyle(stage).top) || 0;
      top = rect.top + (window.scrollY || window.pageYOffset) - stickTop;
      span = Math.max(section.offsetHeight - stage.offsetHeight, 1);
      wake();
    }

    function warmBitmaps(center) {
      if (!canBitmap) return;
      for (var d = 0; d <= WINDOW; d++) {
        [center + d, center - d].forEach(function (i) {
          if (i < 0 || i >= count || !loaded[i] || bitmaps[i] || pendingBitmap[i]) return;
          pendingBitmap[i] = true;
          window.createImageBitmap(frames[i]).then(function (bm) {
            delete pendingBitmap[i];
            if (Math.abs(i - frameIndex()) > 2 * WINDOW) { bm.close && bm.close(); return; }
            bitmaps[i] = bm;
            if (Math.abs(i - frameIndex()) <= 2) { drawn = -1; wake(); }
          }, function () { delete pendingBitmap[i]; canBitmap = false; });
        });
      }
      for (var k in bitmaps) {
        if (Math.abs(k - center) > 2 * WINDOW) {
          if (bitmaps[k].close) bitmaps[k].close();
          delete bitmaps[k];
        }
      }
    }

    function nearestBitmap(i) {
      for (var d = 0; d <= 3; d++) {
        if (bitmaps[i - d]) return i - d;
        if (bitmaps[i + d]) return i + d;
      }
      return -1;
    }

    function draw() {
      var want = frameIndex();
      warmBitmaps(want);
      var i = nearestBitmap(want), src;
      if (i >= 0) src = bitmaps[i];
      else {
        i = nearestLoaded(want);
        if (i < 0) return;
        src = frames[i];
      }
      if (i === drawn) return;
      var img = src;
      var cw = canvas.width, ch = canvas.height, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      var scale = Math.max(cw / iw, ch / ih);
      var sw = cw / scale, sh = ch / scale;
      ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, cw, ch);
      drawn = i;
    }

    var smooth = function (x) { x = clamp(x); return x * x * (3 - 2 * x); };

    function updateChapters() {
      var n = chapters.length, seg = 1 / n, edge = 0.2;
      chapters.forEach(function (el, i) {
        var local = (progress - i * seg) / seg;
        var fadeIn = i === 0 ? 1 : smooth(local / edge);
        var fadeOut = i === n - 1 ? 1 : smooth((1 - local) / edge);
        var v = Math.min(fadeIn, fadeOut);
        var y = Math.round((1 - v) * (local < 0.5 ? 26 : -26));
        var st = chapterState[i];
        if (Math.abs(st.o - v) > 0.01 || st.y !== y) {
          el.style.opacity = v.toFixed(3);
          el.style.transform = "translate3d(0," + y + "px,0)";
          st.o = v;
          st.y = y;
        }
        el.classList.toggle("is-active", v > 0.5);
      });
    }

    function tick() {
      running = false;
      if (dirty) {
        dirty = false;
        var y = window.scrollY || window.pageYOffset;
        progress = clamp((y - top) / span);
        if (bar) bar.style.transform = "scaleX(" + progress.toFixed(4) + ")";
        updateChapters();
      }
      draw();
    }

    function wake() {
      dirty = true;
      if (!running) {
        running = true;
        window.requestAnimationFrame(tick);
      }
    }

    var lastWidth = window.innerWidth;
    window.addEventListener("scroll", function () { loadAll(); wake(); }, { passive: true });
    window.addEventListener("resize", function () {
      // Ignore the URL bar showing/hiding (height-only changes).
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      layout();
    });
    window.addEventListener("orientationchange", function () { window.setTimeout(layout, 200); });

    // First frame comes from the <img>; the rest start after the page has loaded.
    var first = section.querySelector(".m-scroll__poster");
    frames[0] = first;
    var markFirst = function () { loaded[0] = true; wake(); };
    if (first.complete && first.naturalWidth) markFirst();
    else first.addEventListener("load", markFirst, { once: true });
    if (document.readyState === "complete") loadAll();
    else window.addEventListener("load", loadAll, { once: true });

    layout();
  }

  /* ---------- Phone: sticky enroll bar + menu ---------- */
  function initPhoneChrome() {
    var bar = document.querySelector(".m-cta-bar");
    var film = document.querySelector(".m-scroll");
    var form = document.getElementById("enroll");
    if (bar && film && form && "IntersectionObserver" in window) {
      var filmVisible = true, formVisible = false;
      var sync = function () { bar.classList.toggle("is-visible", !filmVisible && !formVisible); };
      new IntersectionObserver(function (e) { filmVisible = e[0].isIntersecting; sync(); }).observe(film);
      new IntersectionObserver(function (e) { formVisible = e[0].isIntersecting; sync(); }, { rootMargin: "0px 0px -20% 0px" }).observe(form);
    }
    var menu = document.querySelector(".m-menu");
    if (menu) {
      menu.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest("a")) menu.removeAttribute("open");
      });
    }
  }

  function init() {
    var year = document.querySelector("[data-year]");
    if (year) year.textContent = String(new Date().getFullYear());
    var desktop = window.matchMedia("(min-width: 861px)");
    if (desktop.matches) {
      initScrollScrub();
    } else {
      var onChange = function (e) {
        if (!e.matches) return;
        initScrollScrub();
        if (desktop.removeEventListener) desktop.removeEventListener("change", onChange);
      };
      if (desktop.addEventListener) desktop.addEventListener("change", onChange);
      initPhoneFilm();
      initPhoneChrome();
    }
    initPointerFx();
    initEnroll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
