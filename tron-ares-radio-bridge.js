// ===============================================================
// TRON-ARES ↔ LUNA RADIO BRIDGE (postMessage + contrôle bouton)
// ===============================================================

// URL de Luna (ton GitHub Pages)
window.LUNA_URL_OVERRIDE = "https://vsalema.github.io/luna/";

// Nom de la clé de stockage pour forcer Radio Alfa une seule fois
const LUNA_FORCE_KEY = "luna_force_station_once_v1";

// Helper: crée ou récupère l'iframe Luna
function ensureLunaIframe() {
  let iframe = document.querySelector("#lunaIframe");
  if (!iframe) {
    const layer = document.body; // tu peux adapter ici
    iframe = document.createElement("iframe");
    iframe.id = "lunaIframe";
    iframe.allow = "autoplay";
    iframe.style.cssText = `
      position:fixed;
      inset:0;
      width:100%;
      height:100%;
      border:none;
      z-index:9999;
      background:#000;
      display:none;
    `;
    layer.appendChild(iframe);
  }

  // charge l'URL si vide
  const url = window.LUNA_URL_OVERRIDE;
  if (!iframe.src || iframe.src === "about:blank") iframe.src = url;

  return iframe;
}

// ===============================================================
// BRIDGE OBJET GLOBAL
// ===============================================================

window.TronAresRadioBridge = {
  iframe: null,
  origin: null,
  ready: false,
  isPlaying: false,

  init() {
    this.iframe = ensureLunaIframe();
    this.origin = new URL(window.LUNA_URL_OVERRIDE).origin;

    window.addEventListener("message", (e) => this.onMessage(e));

    // on ping Luna après un court délai
    setTimeout(() => this.ping(), 1200);
  },

  onMessage(e) {
    if (e.origin !== this.origin) return;
    const data = e.data || {};

    if (data.type === "LUNA_READY" || data.ready) {
      console.log("✅ Luna READY");
      this.ready = true;
      this.autoForceStation();
    }

    if (data.type === "LUNA_STATE") {
      this.isPlaying = !!data.isPlaying;
    }
  },

  ping() {
    this.send({ cmd: "PING" });
  },

  send(payload) {
    if (!this.iframe || !this.iframe.contentWindow) {
      console.warn("Bridge: iframe non prêt");
      return;
    }
    this.iframe.contentWindow.postMessage(payload, this.origin);
  },

  play() {
    this.send({ cmd: "PLAY" });
    this.isPlaying = true;
  },

  pause() {
    this.send({ cmd: "PAUSE" });
    this.isPlaying = false;
  },

  toggle() {
    if (this.isPlaying) this.pause();
    else this.play();
  },

  open() {
    const iframe = ensureLunaIframe();
    iframe.style.display = "block";
  },

  close() {
    if (this.iframe) this.iframe.style.display = "none";
  },

  // Force Radio Alfa une seule fois par navigateur
  autoForceStation() {
    try {
      if (localStorage.getItem(LUNA_FORCE_KEY) === "1") return;

      localStorage.setItem(LUNA_FORCE_KEY, "1");
      this.send({
        cmd: "SET_STATION",
        station: "RADIO ALFA",
        autoplay: true,
      });
      console.log("🎶 Radio Alfa forcée au premier chargement");
    } catch (err) {
      console.warn("Bridge: impossible de sauvegarder force-station", err);
    }
  },
};

// ===============================================================
// INITIALISATION AUTOMATIQUE
// ===============================================================

document.addEventListener("DOMContentLoaded", () => {
  const bridge = window.TronAresRadioBridge;
  bridge.init();

  const btn = document.getElementById("radioPlayBtn");
  if (!btn) {
    console.warn("Bridge: bouton #radioPlayBtn introuvable");
    return;
  }

  // Attache le clic Play/Pause
  btn.addEventListener("click", () => {
    console.log("▶ Click sur mini-radio");

    const b = window.TronAresRadioBridge;
    if (!b.ready) {
      console.warn("Bridge: Luna non prête, tentative d'ouverture...");
      b.open();
      // petit délai pour que Luna se charge avant de lancer play
      setTimeout(() => b.play(), 1200);
      return;
    }

    b.open(); // ouvre Luna (overlay)
    b.toggle();
  });
});

console.log("🎯 TronAresRadioBridge initialisé");
