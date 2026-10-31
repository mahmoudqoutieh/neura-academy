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


  /* ---------- Phone layout: hero loop, story dots, sticky enroll bar, menu ---------- */
  function initPhone() {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var saveData = navigator.connection && navigator.connection.saveData;
    var hasIO = "IntersectionObserver" in window;

    // Hero loop: starts only after the page has loaded, pauses when off screen.
    var video = document.querySelector(".m-hero__video");
    if (video && !reduce && !saveData) {
      var start = function () {
        video.src = video.getAttribute("data-src");
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
        if (hasIO) {
          new IntersectionObserver(function (entries) {
            var e = entries[0];
            if (e.isIntersecting) { var q = video.play(); if (q && q.catch) q.catch(function () {}); }
            else video.pause();
          }).observe(video);
        }
      };
      var later = function () {
        if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 1500 });
        else window.setTimeout(start, 300);
      };
      if (document.readyState === "complete") later();
      else window.addEventListener("load", later, { once: true });
    }

    // Story dots follow the swipe position.
    var track = document.querySelector(".m-story__track");
    var dots = document.querySelectorAll(".m-story__dots span");
    if (track && dots.length) {
      var pending = false;
      track.addEventListener("scroll", function () {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(function () {
          pending = false;
          var card = track.firstElementChild;
          var step = card ? card.getBoundingClientRect().width + 14 : 1;
          var i = Math.round(Math.abs(track.scrollLeft) / step);
          Array.prototype.forEach.call(dots, function (d, n) { d.classList.toggle("is-active", n === i); });
        });
      }, { passive: true });
    }

    // Sticky enroll bar: visible after the hero, hidden while the form is on screen.
    var bar = document.querySelector(".m-cta-bar");
    var hero = document.querySelector(".m-hero");
    var form = document.getElementById("enroll");
    if (bar && hero && form && hasIO) {
      var heroVisible = true, formVisible = false;
      var sync = function () { bar.classList.toggle("is-visible", !heroVisible && !formVisible); };
      new IntersectionObserver(function (e) { heroVisible = e[0].isIntersecting; sync(); }).observe(hero);
      new IntersectionObserver(function (e) { formVisible = e[0].isIntersecting; sync(); }, { rootMargin: "0px 0px -20% 0px" }).observe(form);
    }

    // Menu closes after choosing a section.
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
      initPhone();
    }
    initPointerFx();
    initEnroll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
