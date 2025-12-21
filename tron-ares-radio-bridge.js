/*!
 * Tron-Ares ↔ Luna Radio Bridge (Overlay-safe, Ultra Reliable)
 * - Mini player controls Luna via postMessage (PLAY/PAUSE/NEXT/PREV/SET_STATION)
 * - Uses existing #radioPanel overlay (if present) to show the full Luna UI (iframe)
 * - Forces "RADIO ALFA" only on the first load of the page (then lets the user navigate)
 *
 * Expected Luna side: a Luna build that supports postMessage commands:
 *  - window.postMessage({type:'LUNA_CMD', cmd:'PLAY'|'PAUSE'|'TOGGLE'|'NEXT'|'PREV'|'SET_STATION'|'SET_VOLUME', payload:{...}}, '*')
 *  - emits events: {type:'LUNA_EVT', evt:'READY'|'STATE'|'STATION'|'ACK'|'ERROR', payload:{...}}
 */
(function () {
  "use strict";

  // ----------------------------
  // CONFIG
  // ----------------------------
  const DEFAULT_LUNA_URL = "https://vsalema.github.io/luna/";
  const LUNA_URL =
    (typeof window !== "undefined" && window.LUNA_URL_OVERRIDE)
      ? String(window.LUNA_URL_OVERRIDE)
      : DEFAULT_LUNA_URL;

  // First boot station
  const FIRST_STATION_NAME = "RADIO ALFA";
  const BOOT_KEY = "tron_ares_luna_first_station_done_v1"; // session-scoped

  // PostMessage protocol
  const MSG_CMD = "LUNA_CMD";
  const MSG_EVT = "LUNA_EVT";

  // ----------------------------
  // DOM TARGETS (Tron-Ares)
  // ----------------------------
  const sel = {
    mini: "#miniRadioPlayer",
    miniPlay: "#radioPlayBtn",

    // Optional extra controls if you have them in your UI
    miniNext: "#radioNextBtn",
    miniPrev: "#radioPrevBtn",

    // Existing overlay panel in your page (preferred)
    panel: "#radioPanel",
    panelClose: "#radioClose",
    panelCard: ".radio-panel-card",
  };

  // ----------------------------
  // INTERNAL STATE
  // ----------------------------
  const state = {
    ready: false,
    playing: false,
    stationName: "",
    overlayOpen: false,
    iframeLoaded: false,
    lastCmdId: 0,
    pending: new Map(), // id -> {resolve, reject, t}
  };

  function q(root, s) {
    return (root || document).querySelector(s);
  }

  function isLeftClick(e) {
    return !e || e.button === 0;
  }

  // ----------------------------
  // IFRAME / OVERLAY MANAGEMENT
  // ----------------------------
  function ensureInjectedStyle() {
    if (document.getElementById("tronLunaBridgeStyle")) return;

    const css = `
      /* Luna frame inside existing #radioPanel */
      #radioPanel { position: fixed; inset: 0; z-index: 9999; }
      #radioPanel .luna-frame-wrap {
        position: absolute;
        inset: 0;
        display: none;
        padding: 18px;
      }
      #radioPanel[data-mode="luna"] .luna-frame-wrap { display: block; }
      #radioPanel[data-mode="luna"] ${sel.panelCard} { display: none !important; }

      #radioPanel .luna-frame {
        width: 100%;
        height: 100%;
        border: 0;
        border-radius: 18px;
        background: rgba(0,0,0,.22);
        box-shadow: 0 30px 90px rgba(0,0,0,.55);
      }
      /* Ensure close button stays clickable above iframe */
      #radioPanel ${sel.panelClose} { position: relative; z-index: 10000; }

      /* Optional: make the mini player "open" hint on hover */
      ${sel.mini} { cursor: pointer; }
      ${sel.miniPlay} { cursor: pointer; }
    `;

    const style = document.createElement("style");
    style.id = "tronLunaBridgeStyle";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensurePanelWithIframe() {
    ensureInjectedStyle();

    // Prefer the existing Tron-Ares overlay panel
    const panel = q(document, sel.panel);
    if (!panel) return null;

    // Create wrap if missing
    let wrap = panel.querySelector(".luna-frame-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "luna-frame-wrap";
      panel.appendChild(wrap);
    }

    // Create iframe if missing
    let iframe = wrap.querySelector("iframe.luna-frame");
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.className = "luna-frame";
      iframe.setAttribute("allow", "autoplay; fullscreen; clipboard-read; clipboard-write");
      iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
      iframe.setAttribute("title", "Luna Radio Player");
      wrap.appendChild(iframe);
    }

    // Ensure close button closes overlay (without stopping audio)
    const closeBtn = q(panel, sel.panelClose);
    if (closeBtn && !closeBtn.dataset.lunaBridgeBound) {
      closeBtn.dataset.lunaBridgeBound = "1";
      closeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeLunaOverlay();
      });
    }

    return { panel, wrap, iframe };
  }

  function openLunaOverlay() {
    const obj = ensurePanelWithIframe();
    if (!obj) return;

    const { panel, iframe } = obj;

    // Load iframe once
    if (!state.iframeLoaded || !iframe.src || iframe.src === "about:blank") {
      iframe.src = LUNA_URL;
      state.iframeLoaded = true;
    }

    panel.classList.remove("hidden");
    panel.setAttribute("aria-hidden", "false");
    panel.dataset.mode = "luna";
    state.overlayOpen = true;

    // Prevent background scroll
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }

  function closeLunaOverlay() {
    const obj = ensurePanelWithIframe();
    if (!obj) return;

    const { panel } = obj;

    // Just close, do NOT stop audio
    panel.classList.add("hidden");
    panel.setAttribute("aria-hidden", "true");
    panel.dataset.mode = "";

    state.overlayOpen = false;

    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
  }

  // ----------------------------
  // POSTMESSAGE HELPERS
  // ----------------------------
  function getIframeWindow() {
    const obj = ensurePanelWithIframe();
    if (!obj) return null;
    const iframe = obj.iframe;
    if (!iframe || !iframe.contentWindow) return null;
    return iframe.contentWindow;
  }

  function postToLuna(message) {
    const win = getIframeWindow();
    if (!win) return false;
    win.postMessage(message, "*");
    return true;
  }

  function nextCmdId() {
    state.lastCmdId += 1;
    return "cmd_" + Date.now() + "_" + state.lastCmdId;
  }

  function sendCmd(cmd, payload) {
    const id = nextCmdId();
    const msg = { type: MSG_CMD, cmd, payload: payload || {}, id };

    // Fire and forget for ultra reliability; also keep a short-lived promise for ACK.
    postToLuna(msg);

    return new Promise((resolve) => {
      const t = setTimeout(() => {
        state.pending.delete(id);
        resolve({ ok: false, timeout: true });
      }, 1600);

      state.pending.set(id, { resolve, t });
    });
  }

  async function waitReady(maxMs = 4500) {
    if (state.ready) return true;

    // Ensure iframe is loaded (hidden is fine)
    const obj = ensurePanelWithIframe();
    if (!obj) return false;

    if (!state.iframeLoaded || !obj.iframe.src || obj.iframe.src === "about:blank") {
      obj.iframe.src = LUNA_URL;
      state.iframeLoaded = true;
    }

    // Ping READY by sending a harmless command; READY should arrive quickly.
    sendCmd("PING", { t: Date.now() }).catch(() => {});

    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (state.ready) return true;
      await new Promise((r) => setTimeout(r, 80));
    }
    return state.ready;
  }

  // ----------------------------
  // BOOT: FORCE RADIO ALFA ONCE
  // ----------------------------
  function bootForcedStationDone() {
    try { return sessionStorage.getItem(BOOT_KEY) === "1"; } catch (_) { return false; }
  }
  function setBootForcedStationDone() {
    try { sessionStorage.setItem(BOOT_KEY, "1"); } catch (_) {}
  }

  async function forceFirstStationOnce() {
    if (bootForcedStationDone()) return;

    const ok = await waitReady();
    if (!ok) return;

    // Force station without stealing navigation later
    await sendCmd("SET_STATION", { name: FIRST_STATION_NAME, autoplay: false, force: true });
    setBootForcedStationDone();
  }

  // ----------------------------
  // MINI PLAYER WIRES
  // ----------------------------
  function bindMiniPlayer() {
    const mini = q(document, sel.mini);
    const playBtn = q(document, sel.miniPlay);

    // Optional
    const nextBtn = q(document, sel.miniNext);
    const prevBtn = q(document, sel.miniPrev);

    if (playBtn && !playBtn.dataset.lunaBridgeBound) {
      playBtn.dataset.lunaBridgeBound = "1";
      playBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Ensure iframe exists/ready but keep overlay closed
        await forceFirstStationOnce();

        // Toggle play/pause
        const ok = await waitReady();
        if (!ok) return;

        if (state.playing) await sendCmd("PAUSE");
        else await sendCmd("PLAY");
      });
    }

    // Clicking the mini player (outside the play button) opens the full Luna UI overlay
    if (mini && !mini.dataset.lunaBridgeBound) {
      mini.dataset.lunaBridgeBound = "1";
      mini.addEventListener("click", async (e) => {
        if (!isLeftClick(e)) return;

        // Don't open if click on the play button itself
        if (playBtn && e.target && playBtn.contains(e.target)) return;

        // Load/boot station once, then open
        await forceFirstStationOnce();
        openLunaOverlay();
      });
    }

    if (nextBtn && !nextBtn.dataset.lunaBridgeBound) {
      nextBtn.dataset.lunaBridgeBound = "1";
      nextBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = await waitReady();
        if (!ok) return;
        await sendCmd("NEXT");
      });
    }

    if (prevBtn && !prevBtn.dataset.lunaBridgeBound) {
      prevBtn.dataset.lunaBridgeBound = "1";
      prevBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = await waitReady();
        if (!ok) return;
        await sendCmd("PREV");
      });
    }
  }

  // ----------------------------
  // RECEIVE EVENTS FROM LUNA
  // ----------------------------
  function onMessage(ev) {
    const data = ev && ev.data;
    if (!data || typeof data !== "object") return;

    if (data.type !== MSG_EVT) return;

    const evt = data.evt;
    const payload = data.payload || {};

    if (evt === "READY") {
      state.ready = true;
      return;
    }

    if (evt === "ACK" && data.id && state.pending.has(data.id)) {
      const p = state.pending.get(data.id);
      clearTimeout(p.t);
      state.pending.delete(data.id);
      p.resolve({ ok: true, payload });
      return;
    }

    if (evt === "STATE") {
      if (typeof payload.playing === "boolean") state.playing = payload.playing;
      return;
    }

    if (evt === "STATION") {
      if (payload && payload.name) state.stationName = String(payload.name);
      return;
    }
  }

  // ----------------------------
  // PUBLIC API (Optional)
  // ----------------------------
  function exposeApi() {
    window.TronRadio = {
      open: openLunaOverlay,
      close: closeLunaOverlay,
      play: async () => { await forceFirstStationOnce(); await sendCmd("PLAY"); },
      pause: async () => { await sendCmd("PAUSE"); },
      toggle: async () => { await forceFirstStationOnce(); await sendCmd("TOGGLE"); },
      setStation: async (name) => { await waitReady(); await sendCmd("SET_STATION", { name: String(name || "") }); },
    };
  }

  // ----------------------------
  // INIT
  // ----------------------------
  function init() {
    // Prepare panel/iframe in the background (no visual)
    ensurePanelWithIframe();

    window.addEventListener("message", onMessage, false);

    // Bind after DOM is ready
    bindMiniPlayer();

    // Soft boot (no autoplay): load iframe early to reduce lag on first play
    // but do NOT force station until user interaction triggers it (more browser-friendly).
    try {
      const obj = ensurePanelWithIframe();
      if (obj && (!obj.iframe.src || obj.iframe.src === "about:blank")) {
        obj.iframe.src = LUNA_URL;
        state.iframeLoaded = true;
      }
    } catch (_) {}

    exposeApi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
