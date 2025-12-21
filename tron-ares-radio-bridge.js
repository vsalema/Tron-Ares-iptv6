/*! tron-ares-radio-bridge.js
   Tron Ares ↔ Luna (iframe) : postMessage bridge ultra-robuste

   - Handshake PING/READY
   - File une commande par message, avec queue tant que Luna n'est pas prête
   - Force "RADIO ALFA" uniquement au 1er chargement (localStorage)
*/
(() => {
  "use strict";

  const NS = "LUNA_BRIDGE";

  const DEFAULT_LUNA_URL = "https://vsalema.github.io/luna/";
  const DEFAULT_STATION_NAME = "RADIO ALFA";
  const LS_KEY_FORCED = "tronAresLunaForcedStationV1";

  const state = {
    ready: false,
    lastReadyTs: 0,
    lastEvent: "",
    isPlaying: false,
    stationName: "",
    queue: [],
    pingTimer: null,
  };

  function getLunaUrl(){
    try{
      if(typeof window !== "undefined" && window.LUNA_URL_OVERRIDE) return String(window.LUNA_URL_OVERRIDE);
    }catch(_){}
    return DEFAULT_LUNA_URL;
  }

  function getIframe(){
    return document.querySelector("#lunaIframe") || null;
  }

  function ensureIframeLoaded(){
    const iframe = getIframe();
    if(!iframe) return null;

    const url = getLunaUrl();
    if(!iframe.src || iframe.src === "about:blank" || iframe.dataset.loaded !== "1"){
      iframe.src = url;
      iframe.dataset.loaded = "1";
    }
    return iframe;
  }

  function postToLuna(cmd, payload){
    const iframe = ensureIframeLoaded();
    if(!iframe || !iframe.contentWindow) return false;

    iframe.contentWindow.postMessage(
      { __ns: NS, cmd, payload },
      "*" // même origine (GitHub Pages). Simplifie les cas local/dev.
    );
    return true;
  }

  function flushQueue(){
    if(!state.ready) return;
    while(state.queue.length){
      const m = state.queue.shift();
      postToLuna(m.cmd, m.payload);
    }
  }

  function send(cmd, payload){
    // Always ensure iframe is loaded before sending
    ensureIframeLoaded();

    if(!state.ready){
      state.queue.push({ cmd, payload });
      // ping loop will deliver once READY
      return;
    }
    postToLuna(cmd, payload);
  }

  function startPing(){
    if(state.pingTimer) return;
    state.pingTimer = window.setInterval(() => {
      // If iframe not created yet, wait
      const iframe = ensureIframeLoaded();
      if(!iframe) return;
      postToLuna("PING", {});
    }, 500);
  }

  function stopPing(){
    if(!state.pingTimer) return;
    clearInterval(state.pingTimer);
    state.pingTimer = null;
  }

  function setStationOnce(name = DEFAULT_STATION_NAME){
    try{
      const forced = localStorage.getItem(LS_KEY_FORCED);
      if(forced === "1") return;
      localStorage.setItem(LS_KEY_FORCED, "1");
    }catch(_){}
    send("SET_STATION", { stationName: name, autoplay: false });
  }

  function play(){
    // Force station only once, then play
    setStationOnce(DEFAULT_STATION_NAME);
    send("PLAY", {});
  }

  function pause(){
    send("PAUSE", {});
  }

  function toggle(){
    setStationOnce(DEFAULT_STATION_NAME);
    send("TOGGLE", {});
  }

  function setStation(name, autoplay=false){
    if(!name) return;
    send("SET_STATION", { stationName: String(name), autoplay: !!autoplay });
  }

  function getState(){
    send("GET_STATE", {});
  }

  // Receive events from Luna
  window.addEventListener("message", (evt) => {
    const data = evt && evt.data;
    if(!data || data.__ns !== NS) return;

    const ev = String(data.event || "").toUpperCase();
    if(!ev) return;

    state.lastEvent = ev;

    if(ev === "READY"){
      state.ready = true;
      state.lastReadyTs = Date.now();
      stopPing();
      flushQueue();
      return;
    }

    if(ev === "PLAYING"){
      state.isPlaying = true;
      window.dispatchEvent(new CustomEvent("tron-ares:luna-playing", { detail: data }));
      return;
    }

    if(ev === "PAUSED"){
      state.isPlaying = false;
      window.dispatchEvent(new CustomEvent("tron-ares:luna-paused", { detail: data }));
      return;
    }

    if(ev === "STATION_SET"){
      state.stationName = String(data.name || "");
      window.dispatchEvent(new CustomEvent("tron-ares:luna-station", { detail: data }));
      return;
    }

    if(ev === "STATE"){
      state.isPlaying = !!data.isPlaying;
      state.stationName = String(data.name || "");
      window.dispatchEvent(new CustomEvent("tron-ares:luna-state", { detail: data }));
      return;
    }

    if(ev === "NEED_USER_GESTURE"){
      window.dispatchEvent(new CustomEvent("tron-ares:luna-need-gesture", { detail: data }));
      return;
    }

    if(ev === "ERROR"){
      window.dispatchEvent(new CustomEvent("tron-ares:luna-error", { detail: data }));
      return;
    }
  });

  // Public API
  window.TronAresRadioBridge = {
    ensureIframeLoaded,
    start: startPing,
    play,
    pause,
    toggle,
    setStation,
    setStationOnce,
    getState,
    get ready(){ return state.ready; },
    get isPlaying(){ return state.isPlaying; },
    get stationName(){ return state.stationName; }
  };

  // Auto-start handshake
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", startPing, { once:true });
  }else{
    startPing();
  }
})();
