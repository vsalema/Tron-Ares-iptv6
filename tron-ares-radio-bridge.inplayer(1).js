/* tron-ares-radio-bridge.js
   -------------------------------------------------------
   Bridge fiable Tron-Ares  ↔  Luna (iframe) via postMessage

   Objectif :
   - Le mini player Tron-Ares pilote Luna (PLAY/PAUSE/SET_STATION…)
   - Luna peut être ouverte "dans le player" (dans #playerContainer)
   - "RADIO ALFA" est forcée UNIQUEMENT au premier chargement (session)
   - Ensuite l'utilisateur peut naviguer librement dans Luna.

   Dépendances :
   - Dans Tron-Ares : #playerContainer + #miniRadioPlayer + #miniRadioPlayBtn
   - Côté Luna : la page doit intégrer le handler postMessage (index.luna.postmessage.html)

   API globale (facultatif) :
   window.LunaRadioBridge.open()
   window.LunaRadioBridge.close()
   window.LunaRadioBridge.play()
   window.LunaRadioBridge.pause()
   window.LunaRadioBridge.toggle()
   window.LunaRadioBridge.setStationByName("RADIO ALFA", false)
   window.LunaRadioBridge.setStationByUrl(url, true)
*/

(() => {
  "use strict";

  // ---------- CONFIG ----------
  const DEFAULT_LUNA_URL = "https://vsalema.github.io/luna/"; // remplace par ton URL déployée si besoin
  const OVERRIDE = (typeof window !== "undefined" && window.LUNA_URL_OVERRIDE) ? String(window.LUNA_URL_OVERRIDE) : "";
  const LUNA_URL = OVERRIDE || DEFAULT_LUNA_URL;

  // PostMessage protocol (doit matcher côté Luna)
  const CMD_TYPE = "LUNA_BRIDGE_CMD";
  const EVT_TYPE = "LUNA_BRIDGE_EVT";

  // Forcer une station uniquement au 1er chargement
  const FORCE_KEY = "luna_forced_station_v1";
  const FORCED_STATION_NAME = "RADIO ALFA";

  // ---------- HELPERS ----------
  function getOrigin(url) {
    try { return new URL(url).origin; } catch (_) { return "*"; }
  }
  const LUNA_ORIGIN = getOrigin(LUNA_URL);

  function qs(sel, root = document) { return root.querySelector(sel); }

  function safeLog(...args) { /* console.log(...args); */ }

  // ---------- STATE ----------
  let ready = false;
  let pending = [];
  let overlay = null;
  let iframe = null;

  // ---------- UI / OVERLAY ----------
  function ensureOverlay() {
    if (overlay && iframe) return { overlay, iframe };

    const host = qs("#playerContainer") || document.body;

    // styles injectés (isolés)
    if (!document.getElementById("lunaBridgeStyles")) {
      const st = document.createElement("style");
      st.id = "lunaBridgeStyles";
      st.textContent = `
        .luna-inplayer-layer{
          position:absolute;
          inset:0;
          z-index: 9999;
          display:none;
          background: rgba(0,0,0,.55);
          backdrop-filter: blur(8px);
        }
        .luna-inplayer-layer.open{ display:block; }
        .luna-inplayer-card{
          position:absolute;
          inset: 18px;
          border-radius: 16px;
          overflow:hidden;
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(0,0,0,.35);
          box-shadow: 0 18px 55px rgba(0,0,0,.55);
        }
        .luna-inplayer-head{
          position:absolute;
          top: 10px;
          left: 10px;
          right: 10px;
          display:flex;
          justify-content:space-between;
          align-items:center;
          z-index: 2;
          pointer-events:none;
        }
        .luna-inplayer-title{
          pointer-events:none;
          font: 600 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          color: rgba(255,255,255,.85);
          background: rgba(0,0,0,.35);
          border: 1px solid rgba(255,255,255,.12);
          padding: 8px 10px;
          border-radius: 999px;
        }
        .luna-inplayer-close{
          pointer-events:auto;
          appearance:none;
          border: 1px solid rgba(255,255,255,.14);
          background: rgba(255,255,255,.08);
          color: rgba(255,255,255,.90);
          width: 40px;
          height: 40px;
          border-radius: 12px;
          cursor:pointer;
          display:grid;
          place-items:center;
        }
        .luna-inplayer-close:active{ transform: scale(.98); }
        .luna-inplayer-iframe{
          position:absolute;
          inset:0;
          width:100%;
          height:100%;
          border:0;
          display:block;
        }
      `;
      document.head.appendChild(st);
    }

    overlay = document.createElement("div");
    overlay.className = "luna-inplayer-layer";
    overlay.id = "lunaInPlayerLayer";

    overlay.innerHTML = `
      <div class="luna-inplayer-card">
        <div class="luna-inplayer-head">
          <div class="luna-inplayer-title">Luna Audio Player</div>
          <button class="luna-inplayer-close" type="button" aria-label="Fermer">✕</button>
        </div>
        <iframe class="luna-inplayer-iframe" id="lunaIframe" title="Luna Audio Player"></iframe>
      </div>
    `;

    host.style.position = host.style.position || "relative";
    host.appendChild(overlay);

    iframe = overlay.querySelector("#lunaIframe");
    const closeBtn = overlay.querySelector(".luna-inplayer-close");

    closeBtn.addEventListener("click", () => close());
    overlay.addEventListener("click", (e) => {
      // clique hors card = ferme
      if (e.target === overlay) close();
    });

    return { overlay, iframe };
  }

  function open() {
    const { overlay: ov, iframe: ifr } = ensureOverlay();
    ov.classList.add("open");
    ensureLoaded();
    // Focus visuel (sans voler le focus clavier si tu veux)
    try { ifr.focus({ preventScroll: true }); } catch (_) {}
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove("open");
    // IMPORTANT : on ne décharge PAS l'iframe => bridge reste dispo
  }

  // ---------- BRIDGE ----------
  function ensureLoaded() {
    const { iframe: ifr } = ensureOverlay();

    // Evite les reloads
    if (!ifr.src || ifr.src === "about:blank") {
      ifr.src = LUNA_URL;
    }
  }

  function post(cmd, payload) {
    ensureLoaded();
    const { iframe: ifr } = ensureOverlay();

    const msg = { type: CMD_TYPE, cmd: String(cmd), payload: payload || {} };

    if (!ready) {
      pending.push(msg);
      safeLog("[LunaBridge] queued", msg);
      return;
    }

    try {
      ifr.contentWindow.postMessage(msg, LUNA_ORIGIN);
    } catch (e) {
      console.warn("[LunaBridge] postMessage failed:", e);
    }
  }

  function flush() {
    if (!ready || !pending.length) return;
    const q = pending.slice();
    pending.length = 0;
    for (const msg of q) {
      try {
        iframe.contentWindow.postMessage(msg, LUNA_ORIGIN);
      } catch (e) {
        console.warn("[LunaBridge] flush failed:", e);
      }
    }
  }

  function forceStationOnce() {
    try {
      if (sessionStorage.getItem(FORCE_KEY) === "1") return;
      sessionStorage.setItem(FORCE_KEY, "1");
    } catch (_) {
      // si sessionStorage bloqué : on force quand même une fois (dans cette exécution)
      if (forceStationOnce._done) return;
      forceStationOnce._done = true;
    }

    // IMPORTANT : autoplay=false => on laisse l'utilisateur choisir play
    post("SET_STATION", { name: FORCED_STATION_NAME, autoplay: false });
  }

  function onMessage(e) {
    // sécurité : accepte uniquement l'origin Luna (si possible)
    if (LUNA_ORIGIN !== "*" && e.origin !== LUNA_ORIGIN) return;

    const data = e.data || {};
    if (!data || data.type !== EVT_TYPE) return;

    if (data.evt === "READY") {
      ready = true;
      safeLog("[LunaBridge] READY", data);

      // Force station 1 seule fois
      forceStationOnce();

      // Flush commandes en attente
      flush();
      return;
    }
  }

  window.addEventListener("message", onMessage, false);

  // ---------- MINI PLAYER WIRING ----------
  function wireMiniPlayer() {
    const mini = qs("#miniRadioPlayer");
    const btnPlay = qs("#miniRadioPlayBtn");

    if (!mini || !btnPlay) return;

    // Cliquer sur la carte => ouvrir Luna dans le player
    mini.addEventListener("click", (e) => {
      if (e.target && e.target.closest("#miniRadioPlayBtn")) return;
      open();
    });

    // Bouton Play => toggle play/pause Luna
    btnPlay.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      post("TOGGLE", {});
    });
  }

  // ---------- PUBLIC API ----------
  window.LunaRadioBridge = {
    open,
    close,
    play: () => post("PLAY", {}),
    pause: () => post("PAUSE", {}),
    toggle: () => post("TOGGLE", {}),
    setStationByName: (name, autoplay = false) => post("SET_STATION", { name: String(name || ""), autoplay: !!autoplay }),
    setStationByUrl:  (streamUrl, autoplay = false) => post("SET_STATION", { streamUrl: String(streamUrl || ""), autoplay: !!autoplay }),
    get ready() { return ready; },
    get url() { return LUNA_URL; },
    get origin() { return LUNA_ORIGIN; }
  };

  // Init
  ensureOverlay();      // crée l'iframe (mais ne l'affiche pas)
  ensureLoaded();       // charge Luna dès le départ (ultra fiable)
  wireMiniPlayer();     // branche les boutons
})();
