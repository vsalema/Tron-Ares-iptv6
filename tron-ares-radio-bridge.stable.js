/**
 * Tron-Ares → Luna Player bridge (ultra fiable)
 * - Intercepte le clic du bouton #radioPlayBtn (capture) pour éviter toute logique existante qui pourrait entrer en conflit.
 * - Ouvre un overlay avec un iframe Luna
 * - Force "RADIO ALFA" uniquement au premier chargement (par session) puis laisse l'utilisateur naviguer librement
 * - Contrôle PLAY/PAUSE via postMessage
 *
 * Dépendances: aucune.
 * HTML attendu: un bouton avec id="radioPlayBtn" (dans #miniRadioPlayer).
 */

(() => {
  "use strict";

  const CFG = {
    LUNA_URL: (typeof window !== "undefined" && window.LUNA_URL_OVERRIDE)
      ? String(window.LUNA_URL_OVERRIDE)
      : "https://vsalema.github.io/luna/",
    FIRST_STATION_NAME: "RADIO ALFA",
    SESSION_KEY_FORCED: "tronAres_luna_forced_station_v1",
    OVERLAY_ID: "tronRadioOverlay",
    IFRAME_ID: "tronRadioIframe",
    CLOSE_ID: "tronRadioClose",
    PING_EVERY_MS: 250,
    READY_TIMEOUT_MS: 12000,
    ACK_TIMEOUT_MS: 8000,
  };

  function safeOrigin(url){
    try { return new URL(url).origin; } catch(_) { return "*"; }
  }

  const state = {
    overlay: null,
    iframe: null,
    targetOrigin: safeOrigin(CFG.LUNA_URL),
    playing: false,
    restoring: null,
  };

  // -------------------------
  // Overlay UI
  // -------------------------
  function injectStylesOnce(){
    if(document.getElementById("tronRadioOverlayStyle")) return;

    const style = document.createElement("style");
    style.id = "tronRadioOverlayStyle";
    style.textContent = `
      #${CFG.OVERLAY_ID}{
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,.55);
        backdrop-filter: blur(8px);
        z-index: 99999;
      }
      #${CFG.OVERLAY_ID}.open{ display:flex; }
      #${CFG.OVERLAY_ID} .tronRadioFrame{
        width: min(1100px, 94vw);
        height: min(690px, 88vh);
        border-radius: 18px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.18);
        background: rgba(10,12,18,.60);
        box-shadow: 0 20px 70px rgba(0,0,0,.55);
        position: relative;
      }
      #${CFG.CLOSE_ID}{
        position: absolute;
        top: 12px;
        right: 12px;
        width: 44px;
        height: 44px;
        border-radius: 14px;
        border: 1px solid rgba(255,255,255,.18);
        background: rgba(255,255,255,.08);
        color: rgba(255,255,255,.92);
        cursor: pointer;
        display: grid;
        place-items: center;
        z-index: 2;
        user-select: none;
      }
      #${CFG.CLOSE_ID}:hover{
        background: rgba(255,255,255,.12);
        border-color: rgba(255,255,255,.26);
      }
      #${CFG.IFRAME_ID}{
        width: 100%;
        height: 100%;
        border: 0;
        background: transparent;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay(){
    injectStylesOnce();

    let overlay = document.getElementById(CFG.OVERLAY_ID);
    if(!overlay){
      overlay = document.createElement("div");
      overlay.id = CFG.OVERLAY_ID;
      overlay.setAttribute("aria-hidden", "true");
      overlay.innerHTML = `
        <div class="tronRadioFrame" role="dialog" aria-label="Luna Radio Player">
          <button id="${CFG.CLOSE_ID}" type="button" aria-label="Fermer">✕</button>
          <iframe id="${CFG.IFRAME_ID}" title="Luna Radio Player"
                  allow="autoplay; encrypted-media; fullscreen"
                  referrerpolicy="no-referrer"
                  loading="eager"></iframe>
        </div>
      `;
      document.body.appendChild(overlay);

      const closeBtn = overlay.querySelector("#" + CFG.CLOSE_ID);
      closeBtn.addEventListener("click", () => stopRadio());

      overlay.addEventListener("click", (e) => {
        // click outside frame closes
        const frame = overlay.querySelector(".tronRadioFrame");
        if(frame && !frame.contains(e.target)) stopRadio();
      });

      window.addEventListener("keydown", (e) => {
        if(e.key === "Escape" && overlay.classList.contains("open")){
          stopRadio();
        }
      });
    }

    const iframe = overlay.querySelector("#" + CFG.IFRAME_ID);
    state.overlay = overlay;
    state.iframe = iframe;

    // Ensure src once
    if(!iframe.src || iframe.src === "about:blank"){
      iframe.src = CFG.LUNA_URL;
    }

    return { overlay, iframe };
  }

  function openOverlay(){
    const { overlay } = ensureOverlay();
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
  }

  function closeOverlay(){
    if(!state.overlay) return;
    state.overlay.classList.remove("open");
    state.overlay.setAttribute("aria-hidden", "true");
  }

  // -------------------------
  // Media pause/restore (best-effort)
  // -------------------------
  function pauseAllMediaInDocument(){
    const media = Array.from(document.querySelectorAll("audio, video"));
    const snapshot = media.map(el => ({
      el,
      wasPlaying: !el.paused && !el.ended,
      t: Number.isFinite(el.currentTime) ? el.currentTime : 0,
      muted: !!el.muted,
      vol: Number.isFinite(el.volume) ? el.volume : 1,
    }));

    snapshot.forEach(s => {
      try{
        s.el.pause();
        s.el.muted = true;
      }catch(_){}
    });

    return () => {
      snapshot.forEach(s => {
        try{
          s.el.muted = s.muted;
          s.el.volume = s.vol;
          if(Number.isFinite(s.t) && s.t > 0) s.el.currentTime = s.t;
          if(s.wasPlaying) s.el.play().catch(()=>{});
        }catch(_){}
      });
    };
  }

  // -------------------------
  // postMessage helpers
  // -------------------------
  const MSG = {
    CMD_TYPE: "LUNA_CMD",
    EVT_TYPE: "LUNA_EVENT",
  };

  function postToLuna(cmd, payload){
    const iframe = state.iframe;
    if(!iframe || !iframe.contentWindow) return false;
    try{
      iframe.contentWindow.postMessage({ type: MSG.CMD_TYPE, cmd, payload: payload || null }, state.targetOrigin);
      return true;
    }catch(_){
      return false;
    }
  }

  function waitForReady(timeoutMs){
    return new Promise((resolve) => {
      const iframe = state.iframe;
      if(!iframe || !iframe.contentWindow){
        resolve(false);
        return;
      }

      let done = false;
      const start = Date.now();

      function cleanup(ok){
        if(done) return;
        done = true;
        window.removeEventListener("message", onMsg);
        clearInterval(pingT);
        clearTimeout(toT);
        resolve(ok);
      }

      function onMsg(ev){
        if(ev.source !== iframe.contentWindow) return;
        const data = ev.data || {};
        if(data.type === MSG.EVT_TYPE && data.event === "READY"){
          cleanup(true);
        }
      }

      window.addEventListener("message", onMsg);

      const ping = () => postToLuna("PING", { t: Date.now() });

      ping();
      const pingT = setInterval(() => {
        if(Date.now() - start > timeoutMs) cleanup(false);
        else ping();
      }, CFG.PING_EVERY_MS);

      const toT = setTimeout(() => cleanup(false), timeoutMs);
    });
  }

  function sendAndWaitAck(cmd, payload, timeoutMs){
    return new Promise((resolve) => {
      const iframe = state.iframe;
      if(!iframe || !iframe.contentWindow){
        resolve(false);
        return;
      }

      let done = false;
      function cleanup(ok){
        if(done) return;
        done = true;
        window.removeEventListener("message", onMsg);
        clearTimeout(toT);
        resolve(ok);
      }

      function onMsg(ev){
        if(ev.source !== iframe.contentWindow) return;
        const data = ev.data || {};
        if(data.type !== MSG.EVT_TYPE) return;
        if(data.event === "ACK" && String(data.cmd || "") === cmd){
          cleanup(!!data.ok);
        }
      }

      window.addEventListener("message", onMsg);

      const sent = postToLuna(cmd, payload || null);
      if(!sent){
        cleanup(false);
        return;
      }

      const toT = setTimeout(() => cleanup(false), timeoutMs);
    });
  }

  async function ensureFirstStationOnce(){
    try{
      if(sessionStorage.getItem(CFG.SESSION_KEY_FORCED) === "1") return;
    }catch(_){}

    // Force only after READY to maximize reliability
    const ok = await sendAndWaitAck("SET_STATION", { name: CFG.FIRST_STATION_NAME, autoplay: false }, CFG.ACK_TIMEOUT_MS);
    if(ok){
      try{ sessionStorage.setItem(CFG.SESSION_KEY_FORCED, "1"); }catch(_){}
    }
  }

  // -------------------------
  // Mini player UI
  // -------------------------
  function getPlayBtn(){
    return document.getElementById("radioPlayBtn");
  }

  function setPlayBtnUI(isPlaying){
    const btn = getPlayBtn();
    if(!btn) return;
    btn.textContent = isPlaying ? "❚❚" : "▶";
    btn.setAttribute("aria-pressed", isPlaying ? "true" : "false");
  }

  // -------------------------
  // Public actions
  // -------------------------
  async function startRadio(){
    ensureOverlay();
    openOverlay();

    // Pause other media and store restore function
    if(!state.restoring){
      state.restoring = pauseAllMediaInDocument();
    }

    // Wait Luna ready
    const ready = await waitForReady(CFG.READY_TIMEOUT_MS);
    if(!ready){
      console.warn("[TronAres] Luna iframe not ready (timeout).");
      // still show overlay so user can interact manually
    }else{
      await ensureFirstStationOnce();
      postToLuna("PLAY", null);
    }

    state.playing = true;
    setPlayBtnUI(true);
  }

  function stopRadio(){
    // Pause Luna
    postToLuna("PAUSE", null);

    closeOverlay();

    // Restore media
    if(state.restoring){
      try{ state.restoring(); }catch(_){}
      state.restoring = null;
    }

    state.playing = false;
    setPlayBtnUI(false);
  }

  async function toggleRadio(){
    if(state.playing) stopRadio();
    else await startRadio();
  }

  // -------------------------
  // Interception ultra fiable
  // -------------------------
  function bind(){
    // Intercept clicks early to avoid conflicts with existing handlers
    document.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("#radioPlayBtn") : null;
      if(!btn) return;

      e.preventDefault();
      e.stopPropagation();

      // stopImmediatePropagation is not on EventTarget in some browsers; wrap.
      if(typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

      toggleRadio();
    }, true);

    // Optional: if a separate overlay open button exists (example #radioOpenBtn), handle here
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", bind);
  }else{
    bind();
  }
})();
