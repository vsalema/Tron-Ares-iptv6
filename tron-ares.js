// =====================================================
// TRON ARES IPTV PLAYER - JS CLEAN + RESUME + TRACKS
// =====================================================

// --------- RESUME POSITIONS (CHANNELS SEULEMENT) ---------
let resumePositions = {};
try {
  const saved = localStorage.getItem('tronAresResume');
  if (saved) resumePositions = JSON.parse(saved);
} catch {
  resumePositions = {};
}
if (!resumePositions || typeof resumePositions !== 'object') resumePositions = {};

// --- RECHERCHE GLOBALE ---
let currentSearch = '';
function matchesSearch(entry) {
  if (!currentSearch) return true;
  const q = currentSearch.toLowerCase();
  return (
    (entry?.name && entry.name.toLowerCase().includes(q)) ||
    (entry?.group && entry.group.toLowerCase().includes(q))
  );
}

// --------- DATA MODEL ---------
const frChannels = [];    // Liste M3U FR
const channels = [];      // Liste M3U principale
const iframeItems = [];   // Overlays / iFrames

// =====================================================
// 🔒 RESTRICTION FILMS (channelList / listType === 'channels')
// - Aperçu 5 minutes, puis demande un PIN pour continuer
// - PIN : hash SHA-256 en localStorage, déverrouillage temporaire en sessionStorage
// ⚠️ Contrôle côté navigateur uniquement (pratique, pas une “sécurité anti-hack”)
// =====================================================
const MOVIE_LOCK = {
  enabled: true,
  previewSeconds: 5 * 60,
  unlockMinutes: 60,
  pinHashKey: 'tronAresMoviePinHash',
  unlockedUntilKey: 'tronAresMovieUnlockedUntil',
  previewExpiredKey: 'tronAresMoviePreviewExpired',
  _modal: null
};

// --- état aperçu ---
let filmPreviewTimer = null;
let filmPreviewArmedForUrl = null;
let pendingFilmResume = null; // { entry, time, url }

function isFilmEntry(entry) {
  // "Films" = listType === 'channels'
  return !!(entry && entry.listType === 'channels');
}

function _hex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  const enc = new TextEncoder().encode(String(text ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return _hex(digest);
}

function movieLockGetHash() {
  try { return localStorage.getItem(MOVIE_LOCK.pinHashKey) || ''; } catch { return ''; }
}

function movieLockHasPin() {
  return !!movieLockGetHash();
}

function movieLockGetUnlockedUntil() {
  try {
    const v = sessionStorage.getItem(MOVIE_LOCK.unlockedUntilKey);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function movieLockIsUnlocked() {
  if (!MOVIE_LOCK.enabled) return true;
  return Date.now() < movieLockGetUnlockedUntil();
}

function movieLockSetUnlocked(minutes = MOVIE_LOCK.unlockMinutes) {
  const until = Date.now() + Math.max(1, Number(minutes) || 1) * 60_000;
  try { sessionStorage.setItem(MOVIE_LOCK.unlockedUntilKey, String(until)); } catch {}
  try { sessionStorage.removeItem(MOVIE_LOCK.previewExpiredKey); } catch {}
  updateFilmAccessBtnUI?.();
  return until;
}

function movieLockLockNow() {
  try { sessionStorage.removeItem(MOVIE_LOCK.unlockedUntilKey); } catch {}
  updateFilmAccessBtnUI?.();
}

async function movieLockCheckPin(pin) {
  const stored = movieLockGetHash();
  if (!stored) return false;
  const h = await sha256(pin);
  return h === stored;
}

async function movieLockSetPin(pin) {
  const clean = String(pin ?? '').trim();
  if (!clean || clean.length < 4) return false;
  const h = await sha256(clean);
  try { localStorage.setItem(MOVIE_LOCK.pinHashKey, h); } catch {}
  return true;
}

// --- Modal : HTML dans index.html, JS = seulement pilotage ---
function movieLockEnsureModal() {
  if (MOVIE_LOCK._modal) return MOVIE_LOCK._modal;

  const backdrop = document.getElementById('movieLockBackdrop');
  if (!backdrop) {
    console.warn('[movieLock] #movieLockBackdrop introuvable dans index.html');
    // fallback minimal : pas de modal
    MOVIE_LOCK._modal = {
      open() { alert('Modal manquant : ajoute #movieLockBackdrop dans index.html'); },
      close() {},
      flash() {}
    };
    return MOVIE_LOCK._modal;
  }

  const hint = backdrop.querySelector('#movieLockHint');
  const input = backdrop.querySelector('#movieLockPinInput');
  const unlockBtn = backdrop.querySelector('#movieLockUnlockBtn');
  const setPinBtn = backdrop.querySelector('#movieLockSetPinBtn');
  const lockBtn = backdrop.querySelector('#movieLockLockBtn');
  const cancelBtn = backdrop.querySelector('#movieLockCancelBtn');

  const api = {
    backdrop, hint, input,
    _onSuccess: null,
    open(onSuccess) {
      api._onSuccess = typeof onSuccess === 'function' ? onSuccess : null;

      if (hint) {
        hint.textContent = movieLockHasPin()
          ? "Entrez votre PIN pour déverrouiller l’accès aux Films."
          : "Aucun PIN n’est défini. Cliquez sur « Définir / changer PIN » pour activer la restriction.";
      }

      if (input) input.value = '';
      backdrop.classList.remove('hidden');
      backdrop.setAttribute('aria-hidden', 'false');
      setTimeout(() => { try { input?.focus?.(); } catch {} }, 0);
    },
    close() {
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden', 'true');
      api._onSuccess = null;
    },
    flash(msg) {
      if (!hint) return;
      hint.textContent = msg;
      hint.classList.add('tron-lock-warn');
      setTimeout(() => hint.classList.remove('tron-lock-warn'), 650);
    }
  };

  const tryUnlock = async () => {
    if (!movieLockHasPin()) {
      api.flash("Définis d’abord un PIN.");
      return;
    }
    const ok = await movieLockCheckPin(input?.value);
    if (!ok) {
      api.flash("PIN incorrect.");
      return;
    }

    movieLockSetUnlocked();
    api.close();

    // Rafraîchit l'UI
    try { refreshActiveListsUI?.(); } catch {}

    if (typeof api._onSuccess === 'function') api._onSuccess();
    try { setStatus?.('Films déverrouillés'); } catch {}
  };

  // bind une seule fois
  if (!backdrop.dataset.bound) {
    backdrop.dataset.bound = '1';

    unlockBtn?.addEventListener('click', (e) => { e.preventDefault(); tryUnlock(); });
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tryUnlock(); } });

    setPinBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      const p1 = prompt('Définis un nouveau PIN (4 chiffres ou plus) :');
      if (p1 === null) return;
      const p2 = prompt('Confirme le PIN :');
      if (p2 === null) return;
      if (String(p1) !== String(p2)) { api.flash('Les PIN ne correspondent pas.'); return; }

      const ok = await movieLockSetPin(p1);
      if (!ok) { api.flash('PIN invalide (minimum 4 caractères).'); return; }

      api.flash('PIN enregistré. Tu peux déverrouiller.');
    });

    lockBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      movieLockLockNow();
      api.flash('Films verrouillés.');
      try { refreshActiveListsUI?.(); } catch {}
      try { setStatus?.('Films verrouillés'); } catch {}
    });

    cancelBtn?.addEventListener('click', (e) => { e.preventDefault(); api.close(); });

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) api.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (backdrop.classList.contains('hidden')) return;
      api.close();
    });
  }

  MOVIE_LOCK._modal = api;
  return api;
}

// --- wrappers compat (anciens noms utilisés ailleurs) ---
function hasFilmAccess() {
  return movieLockIsUnlocked();
}

function setFilmAccessGranted() {
  movieLockSetUnlocked();
  try { updateFilmAccessBtnUI?.(); } catch {}
}

function isFilmPreviewExpired() {
  try { return sessionStorage.getItem(MOVIE_LOCK.previewExpiredKey) === '1'; } catch { return false; }
}

function setFilmPreviewExpired() {
  try { sessionStorage.setItem(MOVIE_LOCK.previewExpiredKey, '1'); } catch {}
}

function clearFilmPreviewTimer() {
  if (filmPreviewTimer) {
    clearTimeout(filmPreviewTimer);
    filmPreviewTimer = null;
  }
  filmPreviewArmedForUrl = null;
}

function ensureFilmAccessOverlay() {
  // maintenant : le HTML est dans index.html (movieLockBackdrop)
  movieLockEnsureModal();
}

function closeFilmAccessOverlay() {
  const m = movieLockEnsureModal();
  m.close();
}

// Ouvre le modal et, si besoin, reprend la lecture après déverrouillage
function openFilmAccessOverlay(opts = {}) {
  ensureFilmAccessOverlay();

  const resumeEntry = opts.resumeEntry || null;
  const resumeTime = (typeof opts.resumeTime === 'number' && isFinite(opts.resumeTime)) ? opts.resumeTime : 0;

  if (resumeEntry && resumeEntry.url) {
    pendingFilmResume = { entry: resumeEntry, time: resumeTime, url: resumeEntry.url };
  } else {
    pendingFilmResume = null;
  }

  const m = movieLockEnsureModal();
  m.open(() => {
    // reprise éventuelle
    if (pendingFilmResume?.entry?.url) {
      const { entry, time } = pendingFilmResume;
      pendingFilmResume = null;

      try {
        // playUrl existe plus bas dans le fichier (function hoisting OK)
        playUrl(entry);
        // reprise au temps demandé (si VOD)
        if (videoEl && typeof time === 'number' && isFinite(time) && time > 0) {
          const t = time;
          const seekOnce = () => {
            try { videoEl.currentTime = t; } catch {}
            videoEl.removeEventListener('loadedmetadata', seekOnce);
          };
          videoEl.addEventListener('loadedmetadata', seekOnce);
        }
      } catch {}
    }
  });
}

// Ancienne validation “code” -> maintenant validation PIN
async function handleFilmAccessCode(code) {
  ensureFilmAccessOverlay();
  const m = movieLockEnsureModal();
  const ok = await movieLockCheckPin(code);
  if (!ok) {
    m.flash('PIN incorrect.');
    return;
  }
  setFilmAccessGranted();
  m.close();
}

// Lance un timer de 5 minutes quand on joue un film (si pas déverrouillé)
function armFilmPreviewTimer(entry) {
  if (!entry || !entry.url) return;

  // si déjà déverrouillé : pas d'aperçu
  if (hasFilmAccess()) {
    clearFilmPreviewTimer();
    return;
  }

  // éviter de ré-armer inutilement sur le même flux
  if (filmPreviewArmedForUrl === entry.url && filmPreviewTimer) return;

  clearFilmPreviewTimer();
  filmPreviewArmedForUrl = entry.url;

  const start = () => {
    if (filmPreviewTimer) clearTimeout(filmPreviewTimer);

    filmPreviewTimer = setTimeout(() => {
      try {
        // si entre temps c'est déverrouillé, on ne bloque pas
        if (hasFilmAccess()) return;

        setFilmPreviewExpired();
        try { videoEl?.pause?.(); } catch {}

        // demande PIN pour continuer, + reprise au currentTime
        const t = (videoEl && Number.isFinite(videoEl.currentTime)) ? videoEl.currentTime : 0;
        openFilmAccessOverlay({ resumeEntry: entry, resumeTime: t });

        try { setStatus?.('Prévisualisation terminée : PIN requis pour continuer'); } catch {}
      } catch (e) {
        console.warn('Film preview timer error', e);
      }
    }, MOVIE_LOCK.previewSeconds * 1000);
  };

  // Démarre au vrai "playing" pour coller au temps de visionnage
  const onPlaying = () => {
    try { videoEl?.removeEventListener?.('playing', onPlaying); } catch {}
    start();
  };

  if (videoEl && !videoEl.paused && !videoEl.ended) start();
  else videoEl?.addEventListener?.('playing', onPlaying, { once: true });

  try { setStatus?.('Prévisualisation film : 5 minutes avant PIN'); } catch {}
}

function updateFilmAccessBtnUI() {
  const btn = document.getElementById('filmAccessBtn');
  if (!btn) return;
  const ok = hasFilmAccess();
  btn.textContent = ok ? '🔓 Films' : '🔒 Films';
  btn.title = ok ? 'Accès Films activé' : 'Accès Films';
}

// Utilisé au moment de jouer : si l’aperçu est “expiré”, on bloque jusqu’au PIN
function maybeBlockFilmBecausePreviewExpired(entry) {
  if (!MOVIE_LOCK.enabled) return false;
  if (!isFilmEntry(entry)) return false;
  if (hasFilmAccess()) return false;
  if (!isFilmPreviewExpired()) return false;

  openFilmAccessOverlay({ resumeEntry: entry, resumeTime: 0 });
  return true;
}

// =====================================================
// ✅ UID GLOBAL UNIQUE (PERSISTANT) + HELPERS ID/LOGO
// =====================================================
let uid = Number(localStorage.getItem('tronAresUid') || '0');
function nextUid() {
  uid += 1;
  localStorage.setItem('tronAresUid', String(uid));
  return uid;
}

function normalizeLogo(logo, fallbackName) {
  if (logo && typeof logo === 'object') {
    if (logo.type === 'image' && typeof logo.value === 'string' && logo.value.trim()) return logo;
    if (logo.type === 'letter' && typeof logo.value === 'string' && logo.value.trim()) return logo;
  }
  return deriveLogoFromName(fallbackName);
}

let currentIndex = -1;
let currentFrIndex = -1;
let currentIframeIndex = -1;

let favoritesView = [];   // [{ id, sourceType, sourceIndex, entry }]
let currentFavPos = -1;   // position dans favoritesView

// FR par défaut
let currentListType = 'fr'; // 'channels' | 'fr' | 'iframe' | 'favorites'

let overlayMode = false;
let activePlaybackMode = 'stream'; // 'stream' | 'iframe'

let hlsInstance = null;
let dashInstance = null;

let currentEntry = null;
let externalFallbackTried = false;

let activeAudioIndex = -1;
let activeSubtitleIndex = -1;

// --------- DOM REFS ---------
const videoEl = document.getElementById('videoEl');
const iframeOverlay = document.getElementById('iframeOverlay');
const iframeEl = document.getElementById('iframeEl');

const channelFrListEl = document.getElementById('channelFrList');
const channelListEl = document.getElementById('channelList');
const iframeListEl = document.getElementById('iframeList');
const favoriteListEl = document.getElementById('favoriteList');

const statusPill = document.getElementById('statusPill');
const npLogo = document.getElementById('npLogo');
const npTitle = document.getElementById('npTitle');
const npSub = document.getElementById('npSub');
const npBadge = document.getElementById('npBadge');
const npCounter = document.getElementById('npCounter');

// Counter: retire la classe d'animation une fois terminée (permet de rejouer l'effet à chaque update)
if (npCounter) {
  npCounter.addEventListener('animationend', (e) => {
    if (e && e.animationName === 'npTick') npCounter.classList.remove('tick');
  });
}


const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');

const urlInput = document.getElementById('urlInput');
const loadUrlBtn = document.getElementById('loadUrlBtn');
const fileInput = document.getElementById('fileInput');
const openFileBtn = document.getElementById('openFileBtn');
const fileNameLabel = document.getElementById('fileNameLabel');

const iframeTitleInput = document.getElementById('iframeTitleInput');
const iframeUrlInput = document.getElementById('iframeUrlInput');
const addIframeBtn = document.getElementById('addIframeBtn');

const exportM3uJsonBtn = document.getElementById('exportM3uJsonBtn');
const exportIframeJsonBtn = document.getElementById('exportIframeJsonBtn');
const importJsonBtn = document.getElementById('importJsonBtn');
const jsonArea = document.getElementById('jsonArea');

const toggleOverlayBtn = document.getElementById('toggleOverlayBtn');
const fullPageBtn = document.getElementById('fullPageBtn');
const playerContainer = document.getElementById('playerContainer');
const appShell = document.getElementById('appShell');

const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

const fxToggleBtn = document.getElementById('fxToggleBtn');
const pipToggleBtn = document.getElementById('pipToggleBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');

// --- Stream URL (Akamai-style) ---
const openStreamUrlBtn = document.getElementById('openStreamUrlBtn');
const streamUrlOverlay = document.getElementById('streamUrlOverlay');
const streamUrlInput = document.getElementById('streamUrlInput');
const streamTitleInput = document.getElementById('streamTitleInput');
const streamUrlPlayBtn = document.getElementById('streamUrlPlayBtn');
const streamUrlCopyBtn = document.getElementById('streamUrlCopyBtn');
const streamUrlCloseBtn = document.getElementById('streamUrlCloseBtn');

// --- Contrôles pistes (now-playing) ---
const npTracks = document.getElementById('npTracks');
const audioGroup = document.getElementById('audioGroup');
const subtitleGroup = document.getElementById('subtitleGroup');
const audioTrackBtn = document.getElementById('audioTrackBtn');
const subtitleTrackBtn = document.getElementById('subtitleTrackBtn');
const audioTrackMenu = document.getElementById('audioTrackMenu');
const subtitleTrackMenu = document.getElementById('subtitleTrackMenu');

// --- Recherche ---
const globalSearchInput = document.getElementById('globalSearchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');

// --- MINI RADIO R.ALFA + FAKE VISUALIZER ---
const miniRadioEl = document.getElementById('miniRadioPlayer');
const radioPlayBtn = document.getElementById('radioPlayBtn');

const radioAudio = new Audio(
  'https://n32a-eu.rcs.revma.com/amrbkhqtkm0uv?rj-ttl=5&rj-tok=AAABmqMYXjQAwgI6eJQzoCwBDw'
);
radioAudio.preload = 'none';

let radioPlaying = false; // true = overlay Luna ouvert
let lunaIsPlaying = false; // état de lecture remonté par Luna
let prevVideoMuted = false;
let prevVideoVolume = 1;

// =====================================================
// RADIO OVERLAY LAYER (3e couche dans playerContainer)
// =====================================================
let radioOverlayLayer = null;
// =====================================================
// LUNA ↔ TRON : postMessage bridge (commande depuis #radioPlayBtn)
// =====================================================
let lunaReady = false;
const lunaCmdQueue = [];

function lunaGetIframeEl() {
  const layer = ensureRadioOverlayLayer();
  return layer ? layer.querySelector('#lunaIframe') : null;
}

function lunaGetTargetOrigin() {
  const iframe = lunaGetIframeEl();
  if (!iframe) return '*';
  try {
    const u = new URL(iframe.src, window.location.href);
    return u.origin;
  } catch {
    return '*';
  }
}

function lunaPost(cmd, payload = {}) {
  const iframe = lunaGetIframeEl();
  if (!iframe || !iframe.contentWindow) return;

  const msg = {
    __luna: 1,
    from: 'tron-ares',
    type: 'LUNA_CMD',
    cmd,
    payload
  };

  // si Luna n'a pas encore envoyé READY, on met en file
  if (!lunaReady && cmd !== 'HELLO') {
    lunaCmdQueue.push(msg);
    return;
  }

  try {
    iframe.contentWindow.postMessage(msg, lunaGetTargetOrigin());
  } catch {
    try { iframe.contentWindow.postMessage(msg, '*'); } catch {}
  }
}

function lunaFlushQueue() {
  if (!lunaCmdQueue.length) return;
  const iframe = lunaGetIframeEl();
  if (!iframe || !iframe.contentWindow) return;

  const origin = lunaGetTargetOrigin();
  while (lunaCmdQueue.length) {
    const msg = lunaCmdQueue.shift();
    try { iframe.contentWindow.postMessage(msg, origin); }
    catch { try { iframe.contentWindow.postMessage(msg, '*'); } catch {} }
  }
}

function lunaBindWindowMessageListenerOnce() {
  if (window.__tronLunaPmBound) return;
  window.__tronLunaPmBound = true;

  window.addEventListener('message', (ev) => {
    const iframe = lunaGetIframeEl();
    if (!iframe || ev.source !== iframe.contentWindow) return;

    const data = ev.data;
    if (!data || data.__luna !== 1 || data.from !== 'luna') return;

    if (data.type === 'LUNA_READY') {
      lunaReady = true;
      lunaFlushQueue();
      // demande un état immédiat
      lunaPost('GET_STATE');
      return;
    }

    if (data.type === 'LUNA_STATE') {
      lunaIsPlaying = !!data.playing;

      // UI mini-radio = état lecture réel
      miniRadioEl?.classList.toggle('playing', lunaIsPlaying);
      if (radioPlayBtn) radioPlayBtn.textContent = lunaIsPlaying ? '⏸' : '▶';

      // status optionnel
      if (data.station && data.station.name) setStatus(`Luna • ${data.station.name}`);
      return;
    }

    if (data.type === 'LUNA_AUTOPLAY_BLOCKED') {
      setStatus('Luna • autoplay bloqué (clique dans le lecteur)');
      // On montre "▶" pour inciter à relancer
      if (radioPlayBtn) radioPlayBtn.textContent = '▶';
      miniRadioEl?.classList.remove('playing');
      lunaIsPlaying = false;
      return;
    }
  });
}

lunaBindWindowMessageListenerOnce();


function ensureRadioOverlayLayer() {
  if (radioOverlayLayer) return radioOverlayLayer;
  if (!playerContainer) return null;

  const host = playerContainer.querySelector('.player-inner') || playerContainer;

  const layer = document.createElement('div');
  layer.id = 'radioOverlayLayer';
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.display = 'none';
  layer.style.zIndex = '80';
  layer.style.pointerEvents = 'auto';
  layer.style.background = 'rgba(0,0,0,.88)';
  layer.style.backdropFilter = 'blur(6px)';

  layer.innerHTML = `
    <div style="height:100%; width:100%; display:flex; align-items:center; justify-content:center;
                padding:16px; box-sizing:border-box;">
      <div id="lunaPanel"
           style="width:min(1100px, 96vw); height:min(720px, 92vh);
                  display:flex; flex-direction:column;
                  border:1px solid rgba(0,255,255,.22);
                  border-radius:18px; overflow:hidden;
                  background:rgba(0,0,0,.55);
                  box-shadow:0 0 40px rgba(0,255,255,.10);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;
                    padding:10px 12px; border-bottom:1px solid rgba(0,255,255,.18);
                    font-family: Orbitron, system-ui, sans-serif;">
          <div style="display:flex; align-items:center; gap:10px; min-width:0;">
            <div style="width:10px; height:10px; border-radius:50%; background:rgba(0,255,255,.8);
                        box-shadow:0 0 14px rgba(0,255,255,.45);"></div>
            <div style="font-size:13px; letter-spacing:.08em; color:rgba(230,255,255,.92);
                        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              LUNA AUDIO PLAYER
            </div>
          </div>
          <button id="lunaCloseBtn"
                  style="appearance:none; border:1px solid rgba(0,255,255,.28);
                         background:rgba(0,0,0,.35); color:rgba(230,255,255,.92);
                         border-radius:12px; padding:8px 10px; cursor:pointer;
                         font-family: Orbitron, system-ui, sans-serif;">
            ✕
          </button>
        </div>

        <div style="flex:1 1 auto; min-height:0; background:rgba(0,0,0,.25);">
          <iframe id="lunaIframe"
                  title="Luna Player"
                  src="about:blank"
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  style="width:100%; height:100%; border:0; display:block;"></iframe>
        </div>
      </div>
    </div>
  `;

  host.appendChild(layer);
  radioOverlayLayer = layer;

  // Option 2: fermeture via clic hors panneau + touche Échap
  if (!layer.dataset.lunaOverlayBound) {
    layer.dataset.lunaOverlayBound = '1';

    // Clic sur le backdrop (hors #lunaPanel) => ferme + restore
    layer.addEventListener('click', (e) => {
      // si on clique en dehors du panneau
      if (!e.target.closest('#lunaPanel')) {
        try { stopRadioAndRestore(); } catch {}
      }
    });

    // Échap => ferme + restore (uniquement si overlay affiché)
    if (!window.__tronLunaEscBound) {
      window.__tronLunaEscBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        try {
          if (!radioOverlayLayer) return;
          if (radioOverlayLayer.style.display === 'none') return;
          if (!radioPlaying) return;
          stopRadioAndRestore();
        } catch {}
      });
    }
  }

  return layer;
}

function showRadioOverlayInPlayer() {
  const layer = ensureRadioOverlayLayer();
  if (!layer) return;

  layer.style.display = 'block';

  const iframe = layer.querySelector('#lunaIframe');
  if (iframe) {
    const url =
      (radioPlayBtn && radioPlayBtn.dataset && radioPlayBtn.dataset.lunaUrl) ? radioPlayBtn.dataset.lunaUrl :
      (playerContainer && playerContainer.dataset && playerContainer.dataset.lunaUrl) ? playerContainer.dataset.lunaUrl :
      ((typeof window !== 'undefined' && window.LUNA_URL_OVERRIDE) ? window.LUNA_URL_OVERRIDE : 'index.html');
    if (!iframe.src || iframe.src === 'about:blank' || iframe.dataset.loaded !== '1') {
      iframe.src = url;
      iframe.dataset.loaded = '1';
    }
// postMessage: on réinitialise READY quand on (re)charge Luna, puis handshake
if (!iframe.dataset.pmBound) {
  iframe.dataset.pmBound = '1';
  iframe.addEventListener('load', () => {
    lunaReady = false;
    lunaPost('HELLO'); // Luna répond READY + STATE
  });
} else {
  // si déjà bound, on tente un HELLO immédiat
  lunaPost('HELLO');
}

  }

  const closeBtn = layer.querySelector('#lunaCloseBtn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      stopRadioAndRestore();
    };
  }

  setStatus('Luna');
}

function hideRadioOverlayInPlayer() {
  const layer = ensureRadioOverlayLayer();
  if (!layer) return;

  // Stop audio inside the iframe by unloading it
  try {
    const iframe = layer.querySelector('#lunaIframe');
    if (iframe) {
      iframe.src = 'about:blank';
      iframe.dataset.loaded = '0';
    }
  } catch {}

  layer.style.display = 'none';
}

// Masquer les contrôles pistes au démarrage
npTracks?.classList.add('hidden');

// =====================================================
// UTILS
// =====================================================
function setStatus(text) {
  if (statusPill) statusPill.textContent = text;
}
// =====================================================
// STREAM URL (Akamai-style)
// =====================================================
function getQueryParams() {
  try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); }
}

function normalizeStreamUrl(u) {
  if (!u) return '';
  let url = String(u).trim();
  if (!url) return '';
  if (url.startsWith('//')) url = window.location.protocol + url;
  return url;
}

function buildStreamShareLink(streamUrl, title) {
  const url = new URL(window.location.href);
  url.searchParams.set('streamUrl', streamUrl);
  if (title) url.searchParams.set('title', title);
  else url.searchParams.delete('title');
  url.searchParams.set('autoplay', '1');
  return url.toString();
}

function openStreamUrlPanel(prefillFromQuery = true) {
  if (!streamUrlOverlay) return;
  streamUrlOverlay.classList.remove('hidden');
  streamUrlOverlay.setAttribute('aria-hidden', 'false');

  if (prefillFromQuery) {
    const qs = getQueryParams();
    const qUrl = normalizeStreamUrl(qs.get('streamUrl'));
    const qTitle = (qs.get('title') || '').trim();
    if (streamUrlInput) streamUrlInput.value = qUrl || (streamUrlInput.value || '');
    if (streamTitleInput) streamTitleInput.value = qTitle || (streamTitleInput.value || '');
  }

  setTimeout(() => {
    try { streamUrlInput?.focus(); streamUrlInput?.select(); } catch {}
  }, 0);
}

function closeStreamUrlPanel() {
  if (!streamUrlOverlay) return;
  streamUrlOverlay.classList.add('hidden');
  streamUrlOverlay.setAttribute('aria-hidden', 'true');
}

function playDirectStream(url, title, { updateUrl = true } = {}) {
  const cleanUrl = normalizeStreamUrl(url);
  if (!cleanUrl) {
    setStatus('Stream URL vide');
    return;
  }

  const entry = {
    id: `direct-${Date.now()}`,
    name: (title && String(title).trim()) ? String(title).trim() : 'Stream URL',
    url: cleanUrl,
    group: 'Direct',
    isFavorite: false,
    listType: 'direct'
  };

  activePlaybackMode = 'stream';
  try { iframeOverlay?.classList.add('hidden'); } catch {}
  try { iframeEl && (iframeEl.src = 'about:blank'); } catch {}

  playUrl(entry);

  if (updateUrl) {
    try {
      const next = new URL(window.location.href);
      next.searchParams.set('streamUrl', cleanUrl);
      if (entry.name && entry.name !== 'Stream URL') next.searchParams.set('title', entry.name);
      else next.searchParams.delete('title');
      next.searchParams.set('autoplay', '1');
      window.history.replaceState({}, '', next.toString());
    } catch {}
  }
}


function normalizeName(name) {
  return name || 'Flux sans titre';
}

function deriveLogoFromName(name) {
  const initial = (name || '?').trim()[0] || '?';
  return { type: 'letter', value: initial.toUpperCase() };
}

function isProbablyHls(url) {
  if (!url) return false;
  // ✅ HLS "classique" (.m3u8) + heuristiques pour les URLs sans extension
  // (ex: URLs sécurisées / tokenisées qui pointent vers un manifest HLS)
  return (
    /\.m3u8(\?|$)/i.test(url) ||
    /(^|\/)(hls)(\/|-|_)/i.test(url) ||
    /hls-vod/i.test(url) ||
    /\/manifest(\?|$)/i.test(url) ||
    /\/master(\?|$)/i.test(url)
  );
}
function isProbablyDash(url) {
  return /\.mpd(\?|$)/i.test(url);
}
function isProbablyPlaylist(url) {
  return /\.m3u8?(\?|$)/i.test(url);
}
function isYoutubeUrl(url) {
  return /youtu\.be|youtube\.com/i.test(url);
}
function youtubeToEmbed(url) {
  try {
    const u = new URL(url, window.location.href);
    let id = null;
    if (u.hostname.includes('youtu.be')) id = u.pathname.replace('/', '');
    else id = u.searchParams.get('v');
    return id ? `https://www.youtube.com/embed/${id}` : url;
  } catch {
    return url;
  }
}

// ✅ IMPORTANT : MovieContext basé sur l’entrée réellement en lecture (pas sur l’onglet)
function isMovieContext() {
  return currentEntry?.listType === 'channels';
}

// =====================================================
// RADIO ↔ TV : SWITCH INTELLIGENT (retour stream exact)
// =====================================================
let lastPlaybackSnapshot = null;

function snapshotCurrentPlayback() {
  const snap = {
    wasOverlayMode: !!overlayMode,
    entry: currentEntry || null,
    videoSrc: videoEl?.currentSrc || videoEl?.src || '',
    videoTime: 0,
    iframeSrc: iframeEl?.src || ''
  };
  try {
    if (videoEl) snap.videoTime = Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0;
  } catch {}
  return snap;
}

function stopPlaybackForRadio(snap) {
  try { videoEl?.pause(); } catch {}
  try {
    if (videoEl) {
      prevVideoMuted = !!videoEl.muted;
      prevVideoVolume = typeof videoEl.volume === 'number' ? videoEl.volume : 1;
      videoEl.muted = true;
      videoEl.volume = 0;
    }
  } catch {}

  try {
    if (snap?.wasOverlayMode && iframeEl && iframeEl.src && iframeEl.src !== 'about:blank') {
      iframeEl.src = 'about:blank';
    }
  } catch {}

  showRadioOverlayInPlayer();
}

function restorePlaybackAfterRadio() {
  hideRadioOverlayInPlayer();

  try {
    if (videoEl) {
      videoEl.muted = prevVideoMuted;
      videoEl.volume = prevVideoVolume;
    }
  } catch {}

  const snap = lastPlaybackSnapshot;
  lastPlaybackSnapshot = null;
  if (!snap) return;

  if (snap.wasOverlayMode && snap.iframeSrc && snap.iframeSrc !== 'about:blank') {
    showIframe();
    try { iframeEl.src = snap.iframeSrc; } catch {}
    setStatus('Retour overlay');
    return;
  }

  if (snap.entry) {
    const wantedTime = snap.videoTime || 0;

    const once = () => {
      try {
        if (wantedTime > 0 && Number.isFinite(videoEl.duration) && wantedTime < videoEl.duration - 2) {
          videoEl.currentTime = wantedTime;
        }
      } catch {}
      videoEl?.removeEventListener('loadedmetadata', once);
    };
    videoEl?.addEventListener('loadedmetadata', once);

    playUrl(snap.entry);
    setStatus('Retour diffusion');
    return;
  }

  if (snap.videoSrc) {
    showVideo();
    videoEl.src = snap.videoSrc;
    videoEl.play().catch(() => {});
    setStatus('Retour diffusion');
  }
}

function stopRadioAndRestore() {
  // stop Luna (si présent)
  try { lunaPost('PAUSE'); } catch {}
  try { radioAudio?.pause(); } catch {}

  lunaIsPlaying = false;
  lunaReady = false;

  radioPlaying = false;
  if (radioPlayBtn) radioPlayBtn.textContent = '▶';
  miniRadioEl?.classList.remove('playing');

  restorePlaybackAfterRadio();
}
// Stop Luna sans restaurer l'ancien flux (utilisé quand on relance une chaîne/film)
function stopLunaOverlayHard() {
  try { lunaPost('PAUSE'); } catch {}
  try { radioAudio?.pause(); } catch {}

  lunaIsPlaying = false;
  lunaReady = false;

  radioPlaying = false;
  if (radioPlayBtn) radioPlayBtn.textContent = '▶';
  miniRadioEl?.classList.remove('playing');

  // Ferme l'overlay (sans appeler restorePlaybackAfterRadio)
  hideRadioOverlayInPlayer();
  lastPlaybackSnapshot = null;

  try {
    if (videoEl) {
      videoEl.muted = prevVideoMuted;
      videoEl.volume = prevVideoVolume;
    }
  } catch {}
}



if (miniRadioEl && radioPlayBtn) {
  radioPlayBtn.addEventListener('click', () => {
    // 1er clic : ouvre Luna en overlay + lance la 1ère station (RADIO ALFA)
    if (!radioPlaying) {
      lastPlaybackSnapshot = snapshotCurrentPlayback();

      // Stoppe la lecture actuelle (video/iframe) et ouvre l'overlay Luna
      stopPlaybackForRadio(lastPlaybackSnapshot);

      radioPlaying = true; // overlay ouvert

      // Commande Luna: station 0 (RADIO ALFA) + play
      lunaPost('PLAY_STATION', {
        stationIndex: 0,
        stationKey: 'RADIO_ALFA',
        stationName: 'RADIO ALFA'
      });

      // UI optimiste (Luna renverra LUNA_STATE)
      miniRadioEl.classList.add('playing');
      if (radioPlayBtn) radioPlayBtn.textContent = '⏸';
      setStatus('Luna • RADIO ALFA');
      return;
    }

    // overlay déjà ouvert => stop radio + restaurer la diffusion précédente
    stopRadioAndRestore();
  });
}


// =====================================================
// RENDERING
// =====================================================
function renderLists() {
  renderChannelList();
  renderChannelFrList();
  renderIframeList();
  renderFavoritesList();
}

function refreshActiveListsUI() {
  if (currentListType === 'channels') renderChannelList();
  else if (currentListType === 'fr') renderChannelFrList();
  else if (currentListType === 'iframe') renderIframeList();
  else if (currentListType === 'favorites') renderFavoritesList();

  // si l’onglet Favoris est affiché (liste active), on refresh aussi
  if (favoriteListEl?.classList.contains('active') && currentListType !== 'favorites') {
    renderFavoritesList();
  }
}

function renderChannelFrList() {
  if (!channelFrListEl) return;
  channelFrListEl.innerHTML = '';
  frChannels.forEach((ch, idx) => {
    if (!matchesSearch(ch)) return;
    channelFrListEl.appendChild(createChannelElement(ch, idx, 'fr'));
  });
}

function renderChannelList() {
  if (!channelListEl) return;
  channelListEl.innerHTML = '';
  channels.forEach((ch, idx) => {
    if (!matchesSearch(ch)) return;
    channelListEl.appendChild(createChannelElement(ch, idx, 'channels'));
  });
}

function renderIframeList() {
  if (!iframeListEl) return;
  iframeListEl.innerHTML = '';
  iframeItems.forEach((it, idx) => {
    if (!matchesSearch(it)) return;
    iframeListEl.appendChild(createChannelElement(it, idx, 'iframe'));
  });
}

function renderFavoritesList() {
  if (!favoriteListEl) return;
  favoriteListEl.innerHTML = '';

  const favs = [
    ...channels.filter(c => c.isFavorite).map(e => ({ entry: e, sourceType: 'channels' })),
    ...frChannels.filter(c => c.isFavorite).map(e => ({ entry: e, sourceType: 'fr' })),
    ...iframeItems.filter(i => i.isFavorite).map(e => ({ entry: e, sourceType: 'iframe' }))
  ].filter(({ entry }) => matchesSearch(entry));

  favoritesView = favs.map(({ entry, sourceType }) => {
    let sourceIndex = -1;
    if (sourceType === 'channels') sourceIndex = channels.findIndex(x => x.id === entry.id);
    else if (sourceType === 'fr') sourceIndex = frChannels.findIndex(x => x.id === entry.id);
    else if (sourceType === 'iframe') sourceIndex = iframeItems.findIndex(x => x.id === entry.id);
    return { id: entry.id, sourceType, sourceIndex, entry };
  }).filter(x => x.sourceIndex >= 0);

  // sync curseur favoris sur l’entrée réellement en lecture
  currentFavPos = currentEntry?.id ? favoritesView.findIndex(x => x.id === currentEntry.id) : -1;

  favoritesView.forEach((item, pos) => {
    const el = createChannelElement(item.entry, item.sourceIndex, item.sourceType);
    el.dataset.favpos = String(pos);

    el.addEventListener('click', () => {
      currentListType = 'favorites';
      currentFavPos = pos;

      // ✅ on joue directement l’entrée (currentEntry est la source de vérité)
      playUrl(item.entry);
      refreshActiveListsUI();
      renderFavoritesList();
      scrollToActiveItem();
    });

    favoriteListEl.appendChild(el);
  });
}

// =====================================================
// CREATE CHANNEL ELEMENT (✅ 1 SEULE SOURCE D’ACTIVE : currentEntry.id)
// =====================================================
function createChannelElement(entry, index, sourceType) {
  const li = document.createElement('div');
  li.className = 'channel-item';
  li.dataset.index = String(index);
  li.dataset.type = sourceType;

  // ✅ Une seule source de vérité pour "active"
  const isActive = !!currentEntry && currentEntry.id === entry.id;
  if (isActive) li.classList.add('active');

  const logoDiv = document.createElement('div');
  logoDiv.className = 'channel-logo';

  if (entry.logo && entry.logo.type === 'image') {
    const img = document.createElement('img');
    img.src = entry.logo.value;
    img.alt = entry.name || '';
    logoDiv.appendChild(img);
  } else {
    logoDiv.textContent = entry.logo?.value ?? deriveLogoFromName(entry.name).value;
  }

  const metaDiv = document.createElement('div');
  metaDiv.className = 'channel-meta';

  const titleDiv = document.createElement('div');
  titleDiv.className = 'channel-title';
  titleDiv.textContent = normalizeName(entry.name);

  // Numéro de chaîne (affichage)
  const numDiv = document.createElement('div');
  numDiv.className = 'channel-num';
  numDiv.textContent = String(index + 1);

  const titleRow = document.createElement('div');
  titleRow.className = 'channel-title-row';
  titleRow.appendChild(numDiv);
  titleRow.appendChild(titleDiv);

  const subDiv = document.createElement('div');
  subDiv.className = 'channel-sub';
  subDiv.textContent = entry.group || (entry.isIframe ? 'Overlay / iFrame' : 'Flux M3U');

  const tagsDiv = document.createElement('div');
  tagsDiv.className = 'channel-tags';

  const showIframe = !!entry.isIframe || (isActive && activePlaybackMode === 'iframe');

  const tag = document.createElement('div');
  tag.className = 'tag-chip' + (showIframe ? ' tag-chip--iframe' : '');
  tag.textContent = showIframe ? 'IFRAME' : 'STREAM';
  tagsDiv.appendChild(tag);

  if (isYoutubeUrl(entry.url)) {
    const ytTag = document.createElement('div');
    ytTag.className = 'tag-chip tag-chip--iframe';
    ytTag.textContent = 'YOUTUBE';
    tagsDiv.appendChild(ytTag);
  }

  metaDiv.appendChild(titleRow);
  metaDiv.appendChild(subDiv);
  metaDiv.appendChild(tagsDiv);

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'channel-actions';

  const favBtn = document.createElement('button');
  favBtn.className = 'icon-btn';
  favBtn.innerHTML = '★';
  favBtn.title = 'Ajouter / enlever des favoris';
  favBtn.dataset.fav = entry.isFavorite ? 'true' : 'false';

  favBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    entry.isFavorite = !entry.isFavorite;
    favBtn.dataset.fav = entry.isFavorite ? 'true' : 'false';
    refreshActiveListsUI();
    renderFavoritesList();
  });

  const ovBtn = document.createElement('button');
  ovBtn.className = 'icon-btn';
  ovBtn.innerHTML = '⧉';
  ovBtn.title = 'Lire en overlay iFrame';

  ovBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();

    // garder l’onglet courant (sourceType) pour les indices (next/prev hors favoris)
    currentListType = sourceType;
    if (sourceType === 'channels') currentIndex = index;
    else if (sourceType === 'fr') currentFrIndex = index;
    else if (sourceType === 'iframe') currentIframeIndex = index;

    activePlaybackMode = 'iframe';
    playEntryAsOverlay(entry);

    refreshActiveListsUI();
    if (favoriteListEl?.classList.contains('active')) renderFavoritesList();
    scrollToActiveItem();
  });

  actionsDiv.appendChild(favBtn);
  actionsDiv.appendChild(ovBtn);

  li.appendChild(logoDiv);
  li.appendChild(metaDiv);
  li.appendChild(actionsDiv);

  li.addEventListener('click', () => {
    if (sourceType === 'channels') playChannel(index);
    else if (sourceType === 'fr') playFrChannel(index);
    else if (sourceType === 'iframe') playIframe(index);
  });

  return li;
}

// =====================================================
// NOW PLAYING BAR
// =====================================================
function updateNowPlaying(entry, modeLabel) {
  if (!npLogo || !npTitle || !npSub || !npBadge) return;

  if (!entry) {
    npLogo.textContent = '';
    npTitle.textContent = 'Aucune chaîne sélectionnée';
    npSub.textContent = 'Choisissez une chaîne dans la liste';
    npBadge.textContent = 'IDLE';
    return;
  }

  const logo = entry.logo || deriveLogoFromName(entry.name);
  npLogo.innerHTML = '';

  if (logo.type === 'image') {
    const img = document.createElement('img');
    img.src = logo.value;
    img.alt = entry.name || '';
    npLogo.appendChild(img);
  } else {
    npLogo.textContent = logo.value;
  }

  npTitle.textContent = normalizeName(entry.name);
  npSub.textContent = entry.group || (entry.isIframe ? 'Overlay / iFrame' : 'Flux M3U');
  npBadge.textContent = modeLabel;
}



function _entryMatch(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  if (a.url && b.url && a.url === b.url) return true;
  return false;
}

function syncPlaybackPositionFromEntry() {
  if (!currentEntry) return;

  const activeTab = document.querySelector('.tab-btn.active')?.dataset?.tab || currentListType || '';

  const tryList = (type) => {
    if (type === 'favorites') {
      const idx = favoritesView?.findIndex(x => _entryMatch(x?.entry, currentEntry)) ?? -1;
      if (idx >= 0) {
        currentListType = 'favorites';
        currentFavPos = idx;
        return true;
      }
    }

    if (type === 'fr') {
      const idx = frChannels.findIndex(x => _entryMatch(x, currentEntry));
      if (idx >= 0) {
        currentListType = 'fr';
        currentFrIndex = idx;
        return true;
      }
    }

    if (type === 'iframe') {
      const idx = iframeItems.findIndex(x => _entryMatch(x, currentEntry));
      if (idx >= 0) {
        currentListType = 'iframe';
        currentIframeIndex = idx;
        return true;
      }
    }

    if (type === 'channels') {
      const idx = channels.findIndex(x => _entryMatch(x, currentEntry));
      if (idx >= 0) {
        currentListType = 'channels';
        currentIndex = idx;
        return true;
      }
    }

    return false;
  };

  // 1) Priorité à l’onglet actif
  if (tryList(activeTab)) return;

  // 2) Puis au type courant
  if (tryList(currentListType)) return;

  // 3) Fallback: cherche partout
  if (tryList('fr')) return;
  if (tryList('channels')) return;
  if (tryList('iframe')) return;
  tryList('favorites');
}

function updateNowPlayingCounter() {
  if (!npCounter) return;

  // Synchronise indices/type à partir de currentEntry (robuste, même si playUrl() est appelé directement)
  syncPlaybackPositionFromEntry();

  let pos = 0;
  let total = 0;

  if (currentListType === 'favorites') {
    total = favoritesView?.length || 0;
    pos = currentFavPos >= 0 ? (currentFavPos + 1) : 0;
  } else if (currentListType === 'fr') {
    total = frChannels.length;
    pos = currentFrIndex >= 0 ? (currentFrIndex + 1) : 0;
  } else if (currentListType === 'iframe') {
    total = iframeItems.length;
    pos = currentIframeIndex >= 0 ? (currentIframeIndex + 1) : 0;
  } else {
    total = channels.length;
    pos = currentIndex >= 0 ? (currentIndex + 1) : 0;
  }

  const newText = total ? `${pos}/${total}` : '-/-';
  if (npCounter.textContent !== newText) {
    npCounter.textContent = newText;
    // Tick animation sans reflow de layout (transform/opacity seulement)
    npCounter.classList.remove('tick');
    void npCounter.offsetWidth; // restart animation
    npCounter.classList.add('tick');
  }
}





// =====================================================
// PISTES AUDIO / SOUS-TITRES (HLS) - MOVIE CONTEXT
// =====================================================
function closeAllTrackMenus() {
  audioTrackMenu?.classList.remove('open');
  subtitleTrackMenu?.classList.remove('open');
}

function buildAudioTrackMenu() {
  if (!audioTrackMenu || !hlsInstance || !isMovieContext()) return;

  const tracks = hlsInstance.audioTracks || [];
  audioTrackMenu.innerHTML = '';
  if (!tracks.length) return;

  const header = document.createElement('div');
  header.className = 'np-track-menu-header';
  header.textContent = 'Pistes audio';
  audioTrackMenu.appendChild(header);

  tracks.forEach((t, idx) => {
    const item = document.createElement('div');
    item.className = 'np-track-item';
    if (idx === hlsInstance.audioTrack) item.classList.add('active');

    const label = document.createElement('div');
    label.className = 'np-track-item-label';
    label.textContent = t.name || t.lang || ('Piste ' + (idx + 1));

    const meta = document.createElement('div');
    meta.className = 'np-track-item-meta';
    meta.textContent = (t.lang || '').toUpperCase();

    item.append(label, meta);
    item.addEventListener('click', () => {
      hlsInstance.audioTrack = idx;
      buildAudioTrackMenu();
      closeAllTrackMenus();
    });

    audioTrackMenu.appendChild(item);
  });
}

function buildSubtitleTrackMenu() {
  if (!subtitleTrackMenu || !isMovieContext() || !videoEl) return;

  subtitleTrackMenu.innerHTML = '';

  let useHls = false;
  let tracks = [];
  let activeIndex = -1;

  if (hlsInstance && Array.isArray(hlsInstance.subtitleTracks) && hlsInstance.subtitleTracks.length > 0) {
    useHls = true;
    tracks = hlsInstance.subtitleTracks;
    activeIndex = hlsInstance.subtitleTrack;
  } else {
    const tt = Array.from(videoEl.textTracks || []).filter(t =>
      t.kind === 'subtitles' || t.kind === 'captions'
    );
    tracks = tt;
    if (tt.length) activeIndex = tt.findIndex(t => t.mode === 'showing');
  }

  activeSubtitleIndex = activeIndex;

  const header = document.createElement('div');
  header.className = 'np-track-menu-header';
  header.textContent = 'Sous-titres';
  subtitleTrackMenu.appendChild(header);

  const offItem = document.createElement('div');
  offItem.className = 'np-track-item';
  if (activeIndex === -1) offItem.classList.add('active');

  const offLabel = document.createElement('div');
  offLabel.className = 'np-track-item-label';
  offLabel.textContent = 'Aucun';
  offItem.appendChild(offLabel);

  offItem.addEventListener('click', () => {
    if (useHls && hlsInstance) {
      hlsInstance.subtitleTrack = -1;
    } else {
      Array.from(videoEl.textTracks || []).forEach(t => {
        if (t.kind === 'subtitles' || t.kind === 'captions') t.mode = 'disabled';
      });
    }
    activeSubtitleIndex = -1;
    buildSubtitleTrackMenu();
    closeAllTrackMenus();
  });

  subtitleTrackMenu.appendChild(offItem);

  if (!tracks.length) {
    const empty = document.createElement('div');
    empty.className = 'np-track-item';
    empty.textContent = 'Aucun sous-titre disponible';
    subtitleTrackMenu.appendChild(empty);
    return;
  }

  tracks.forEach((t, idx) => {
    const item = document.createElement('div');
    item.className = 'np-track-item';
    if (idx === activeIndex) item.classList.add('active');

    const label = document.createElement('div');
    label.className = 'np-track-item-label';
    label.textContent = t.name || t.label || t.lang || t.language || ('Sous-titres ' + (idx + 1));

    const meta = document.createElement('div');
    meta.className = 'np-track-item-meta';
    meta.textContent = (t.lang || t.language || '').toUpperCase();

    item.append(label, meta);

    item.addEventListener('click', () => {
      if (useHls && hlsInstance) {
        hlsInstance.subtitleTrack = idx;
      } else {
        const vt = Array.from(videoEl.textTracks || []);
        vt.forEach((track, i) => {
          if (track.kind === 'subtitles' || track.kind === 'captions') {
            track.mode = (i === idx ? 'showing' : 'disabled');
          }
        });
      }
      activeSubtitleIndex = idx;
      buildSubtitleTrackMenu();
      closeAllTrackMenus();
    });

    subtitleTrackMenu.appendChild(item);
  });
}

function updateTrackControlsVisibility() {
  if (!npTracks) return;

  if (!isMovieContext()) {
    npTracks.classList.add('hidden');
    return;
  }

  npTracks.classList.remove('hidden');
  audioGroup?.classList.remove('hidden');
  subtitleGroup?.classList.remove('hidden');
}

function refreshTrackMenus() {
  buildAudioTrackMenu();
  buildSubtitleTrackMenu();
  updateTrackControlsVisibility();

  if (hlsInstance && Array.isArray(hlsInstance.audioTracks) && hlsInstance.audioTracks.length) {
    activeAudioIndex = hlsInstance.audioTrack ?? -1;
  } else {
    activeAudioIndex = -1;
  }

  if (audioTrackBtn) audioTrackBtn.classList.toggle('active', activeAudioIndex !== -1);
  if (subtitleTrackBtn) subtitleTrackBtn.classList.toggle('active', activeSubtitleIndex !== -1);
}

// =====================================================
// PLAYER LOGIC
// =====================================================
function destroyHls() {
  if (hlsInstance) {
    try { hlsInstance.destroy(); } catch {}
    hlsInstance = null;
  }

  // Important : ne pas masquer #npTracks ici.
  // Sinon, à chaque changement de chaîne (Next/Prev), le bloc disparaît puis réapparaît
  // quand le manifest est prêt → effet de "saut" des boutons Audio / Sous-titres.
  closeAllTrackMenus();
  activeAudioIndex = -1;
  activeSubtitleIndex = -1;
  updateTrackControlsVisibility();
}


function destroyDash() {
  if (dashInstance) {
    try { dashInstance.reset(); } catch {}
    dashInstance = null;
  }
}

function showVideo() {
  overlayMode = false;
  iframeOverlay?.classList.add('hidden');
  if (iframeEl) iframeEl.src = 'about:blank';
  if (videoEl) videoEl.style.visibility = 'visible';
}

function showIframe() {
  overlayMode = true;
  iframeOverlay?.classList.remove('hidden');
  try { videoEl?.pause(); } catch {}
  if (videoEl) videoEl.style.visibility = 'hidden';
}

function playEntryAsOverlay(entry) {
  if (!entry || !entry.url) return;

  currentEntry = entry;
  activePlaybackMode = 'iframe';

  updateNowPlayingCounter();

  let url = entry.url;

  // HLS/DASH brut → lecteur externe
  if (isProbablyHls(url) || isProbablyDash(url)) {
    fallbackToExternalPlayer(entry);
    refreshActiveListsUI();
    if (favoriteListEl?.classList.contains('active')) renderFavoritesList();
    return;
  }

  showIframe();

  if (isYoutubeUrl(url)) {
    url = youtubeToEmbed(url);
    url += (url.includes('?') ? '&' : '?') + 'autoplay=1&mute=1';
  }

  if (iframeEl) iframeEl.src = url;
  updateNowPlaying(entry, 'IFRAME');
  setStatus('Overlay iFrame actif');

  refreshTrackMenus();
}

function fallbackToExternalPlayer(entry) {
  if (!entry || !entry.url) return;

  showIframe();

  currentEntry = entry;
  updateNowPlayingCounter();

  const base = 'https://vsalema.github.io/play/?';
  if (iframeEl) iframeEl.src = base + encodeURIComponent(entry.url);

  updateNowPlaying(entry, 'EXT-PLAYER');
  setStatus('Lecture via lecteur externe');
}

function playUrl(entry) {
  if (!entry || !entry.url || !videoEl) return;

  // 🔒 Films : si l’aperçu est terminé et pas déverrouillé, on bloque jusqu’au PIN
  if (isFilmEntry(entry)) {
    if (maybeBlockFilmBecausePreviewExpired(entry)) {
      try { setStatus('Accès Films requis'); } catch {}
      return;
    }
  } else {
    // si on quitte l'onglet films, on stoppe le timer d'aperçu
    clearFilmPreviewTimer();
  }

  // stop Luna si l'overlay est ouvert
  if (radioPlaying) {
    stopLunaOverlayHard();
  }

  currentEntry = entry;
  // Met à jour tout de suite l'affichage des contrôles pistes (évite tout clignotement)
  updateTrackControlsVisibility();
  updateNowPlayingCounter();
  activePlaybackMode = 'stream';
  externalFallbackTried = false;

  const url = entry.url;

  // RTP / SMIL => lecteur externe
  if (/rtp\.pt/i.test(url) || /smil:/i.test(url)) {
    fallbackToExternalPlayer(entry);
    refreshActiveListsUI();
    if (favoriteListEl?.classList.contains('active')) renderFavoritesList();
    return;
  }

  // Entrées iframe/youtube
  if (entry.isIframe || isYoutubeUrl(url)) {
    playEntryAsOverlay(entry);
    refreshActiveListsUI();
    if (favoriteListEl?.classList.contains('active')) renderFavoritesList();
    return;
  }

  // Lecture vidéo
  showVideo();
  destroyHls();
  destroyDash();

  videoEl.removeAttribute('src');
  videoEl.load();

  let modeLabel = 'VIDEO';

  if (isProbablyDash(url) && window.dashjs) {
    try {
      dashInstance = dashjs.MediaPlayer().create();
      dashInstance.initialize(videoEl, url, true);
      modeLabel = 'DASH';
      dashInstance.on(dashjs.MediaPlayer.events.ERROR, e => {
        console.error('DASH error:', e);
        setStatus('Erreur DASH');
      });
    } catch (e) {
      console.error('DASH init error:', e);
      modeLabel = 'VIDEO';
      videoEl.src = url;
    }
  } else if (isProbablyHls(url) && window.Hls && Hls.isSupported()) {
    hlsInstance = new Hls();
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(videoEl);
    modeLabel = 'HLS';

    hlsInstance.on(Hls.Events.MANIFEST_PARSED, refreshTrackMenus);
    hlsInstance.on(Hls.Events.AUDIO_TRACKS_UPDATED, refreshTrackMenus);
    hlsInstance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, refreshTrackMenus);
    hlsInstance.on(Hls.Events.AUDIO_TRACK_SWITCHED, refreshTrackMenus);
    hlsInstance.on(Hls.Events.SUBTITLE_TRACK_SWITCH, refreshTrackMenus);

    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      console.error('HLS error:', data);
      if (!externalFallbackTried && data.fatal && currentEntry) {
        externalFallbackTried = true;
        fallbackToExternalPlayer(currentEntry);
      }
    });
  } else {
    videoEl.src = url;
    modeLabel = url.match(/\.(mp3|aac|ogg)(\?|$)/i) ? 'AUDIO' : 'VIDEO';
  }

  // ✅ reprise position basée sur l’entrée (pas sur l’onglet)
  videoEl.onloadedmetadata = () => {
    try {
      if (entry.listType !== 'channels') return;

      const key = entry.url;
      const savedPos = resumePositions[key];

      if (
        typeof savedPos === 'number' &&
        savedPos > 10 &&
        isFinite(videoEl.duration) &&
        savedPos < videoEl.duration - 5
      ) {
        videoEl.currentTime = savedPos;
      }

      // ✅ reprise après déverrouillage Films (best-effort)
      try {
        if (pendingFilmResume && pendingFilmResume.url === entry.url) {
          const t = Number(pendingFilmResume.time || 0);
          pendingFilmResume = null;
          if (isFinite(t) && t > 0) {
            // léger offset pour éviter d'être exactement sur une limite de segment
            videoEl.currentTime = Math.max(0, t - 0.2);
          }
        }
      } catch {}
    } catch (e) {
      console.warn('Erreur reprise position', e);
    }
    refreshTrackMenus();
  };

  videoEl.play().catch(() => {});

  // 🔒 démarre le timer d'aperçu (5 min) uniquement pour les Films si pas d'accès
  if (isFilmEntry(entry) && !hasFilmAccess()) {
    armFilmPreviewTimer(entry);
  } else {
    clearFilmPreviewTimer();
  }

  updateNowPlaying(entry, modeLabel);
  setStatus('Lecture en cours');

  refreshActiveListsUI();
  if (favoriteListEl?.classList.contains('active')) renderFavoritesList();
}

// =====================================================
// PLAYERS FOR EACH LIST + SCROLL AUTO
// =====================================================
function playChannel(index) {
  if (index < 0 || index >= channels.length) return;
  currentListType = 'channels';
  currentIndex = index;
  const entry = channels[index];
  playUrl(entry);
  renderChannelList();
  if (favoriteListEl?.classList.contains('active')) renderFavoritesList();
  scrollToActiveItem();
}

function playFrChannel(index) {
  if (index < 0 || index >= frChannels.length) return;
  currentListType = 'fr';
  currentFrIndex = index;
  const entry = frChannels[index];
  playUrl(entry);
  renderChannelFrList();
  if (favoriteListEl?.classList.contains('active')) renderFavoritesList();
  scrollToActiveItem();
}

function playIframe(index) {
  if (index < 0 || index >= iframeItems.length) return;
  currentListType = 'iframe';
  currentIframeIndex = index;
  const entry = iframeItems[index];
  playUrl(entry);
  renderIframeList();
  if (favoriteListEl?.classList.contains('active')) renderFavoritesList();
  scrollToActiveItem();
}

// =====================================================
// NEXT / PREV (avec support FAVORITES)
// =====================================================
function playNext() {
  if (currentListType === 'favorites') {
    if (!favoritesView.length) return;

    if (currentFavPos === -1) currentFavPos = 0;
    else currentFavPos = (currentFavPos + 1) % favoritesView.length;

    const item = favoritesView[currentFavPos];
    if (!item) return;

    playUrl(item.entry);
    renderFavoritesList();
    scrollToActiveItem();
    return;
  }

  if (currentListType === 'fr') {
    if (!frChannels.length) return;
    if (currentFrIndex === -1) playFrChannel(0);
    else playFrChannel((currentFrIndex + 1) % frChannels.length);
  } else if (currentListType === 'iframe') {
    if (!iframeItems.length) return;
    if (currentIframeIndex === -1) playIframe(0);
    else playIframe((currentIframeIndex + 1) % iframeItems.length);
  } else {
    if (!channels.length) return;
    if (currentIndex === -1) playChannel(0);
    else playChannel((currentIndex + 1) % channels.length);
  }
}

function playPrev() {
  if (currentListType === 'favorites') {
    if (!favoritesView.length) return;

    if (currentFavPos === -1) currentFavPos = favoritesView.length - 1;
    else currentFavPos = (currentFavPos - 1 + favoritesView.length) % favoritesView.length;

    const item = favoritesView[currentFavPos];
    if (!item) return;

    playUrl(item.entry);
    renderFavoritesList();
    scrollToActiveItem();
    return;
  }

  if (currentListType === 'fr') {
    if (!frChannels.length) return;
    if (currentFrIndex === -1) playFrChannel(frChannels.length - 1);
    else playFrChannel((currentFrIndex - 1 + frChannels.length) % frChannels.length);
  } else if (currentListType === 'iframe') {
    if (!iframeItems.length) return;
    if (currentIframeIndex === -1) playIframe(iframeItems.length - 1);
    else playIframe((currentIframeIndex - 1 + iframeItems.length) % iframeItems.length);
  } else {
    if (!channels.length) return;
    if (currentIndex === -1) playChannel(channels.length - 1);
    else playChannel((currentIndex - 1 + channels.length) % channels.length);
  }
}

// --- SCROLL AUTO SUR LA LISTE ACTIVE ---
function scrollToActiveItem() {
  let listEl = null;
  if (currentListType === 'channels') listEl = channelListEl;
  else if (currentListType === 'fr') listEl = channelFrListEl;
  else if (currentListType === 'iframe') listEl = iframeListEl;
  else if (currentListType === 'favorites') listEl = favoriteListEl;
  else return;

  if (!listEl) return;

  const activeItem = listEl.querySelector('.channel-item.active');
  if (!activeItem) return;

  const listRect = listEl.getBoundingClientRect();
  const itemRect = activeItem.getBoundingClientRect();

  const delta = (itemRect.top - listRect.top) - (listRect.height / 2 - itemRect.height / 2);
  listEl.scrollTop += delta;
}

// =====================================================
// M3U PARSER
// =====================================================
function parseM3U(content, listType = 'channels', defaultGroup = 'Playlist') {
  const lines = content.split(/\r?\n/);
  const results = [];
  let lastInf = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#EXTM3U')) continue;

    if (line.startsWith('#EXTINF')) {
      lastInf = line;
      continue;
    }

    if (line.startsWith('#')) continue;

    const url = line;
    let name = 'Sans titre';
    let logo = null;
    let group = defaultGroup;

    if (lastInf) {
      const nameMatch = lastInf.split(',').slice(-1)[0].trim();
      if (nameMatch) name = nameMatch;

      const logoMatch = lastInf.match(/tvg-logo="([^"]+)"/i);
      if (logoMatch) logo = { type: 'image', value: logoMatch[1] };

      const groupMatch = lastInf.match(/group-title="([^"]+)"/i);
      if (groupMatch) group = groupMatch[1];
    }

    results.push({
      id: `${listType}-ch-${nextUid()}`,
      name,
      url,
      logo: normalizeLogo(logo, name),
      group,
      isIframe: isYoutubeUrl(url),
      isFavorite: false,
      listType
    });

    lastInf = null;
  }

  return results;
}

// =====================================================
// LOADERS
// =====================================================
async function loadFromUrl(url) {
  if (!url) return;
  setStatus('Chargement…');

  try {
    if (isProbablyPlaylist(url)) {
      const res = await fetch(url);
      const text = await res.text();

      if (text.trim().startsWith('#EXTM3U')) {
        const parsed = parseM3U(text, 'channels', 'Playlist');
        channels.push(...parsed);
        renderLists();

        if (parsed.length && currentIndex === -1) {
          playChannel(channels.length - parsed.length);
        }

        setStatus('Playlist chargée (' + parsed.length + ' entrées)');
      } else {
        const entry = {
          id: `single-url-${nextUid()}`,
          name: url,
          url,
          logo: deriveLogoFromName('S'),
          group: 'Single URL',
          isIframe: isYoutubeUrl(url),
          isFavorite: false,
          listType: 'channels'
        };
        channels.push(entry);
        renderLists();
        playChannel(channels.length - 1);
        setStatus('Flux chargé');
      }
    } else {
      const entry = {
        id: `single-url-${nextUid()}`,
        name: url,
        url,
        logo: deriveLogoFromName('S'),
        group: 'Single URL',
        isIframe: isYoutubeUrl(url),
        isFavorite: false,
        listType: 'channels'
      };
      channels.push(entry);
      renderLists();
      playChannel(channels.length - 1);
      setStatus('Flux chargé');
    }
  } catch (e) {
    console.error(e);
    setStatus('Erreur de chargement (CORS / réseau)');
    alert(
      'Impossible de charger cette URL dans le navigateur.\n' +
      'Ça peut venir d’un blocage CORS ou d’un problème réseau.\n' +
      'Si c’est un flux IPTV, il est peut-être prévu pour une app native (VLC, box, etc.), pas pour le web.'
    );
  }
}

async function loadFrM3u(url) {
  try {
    const res = await fetch(url);
    const text = await res.text();

    if (!text.trim().startsWith('#EXTM3U')) {
      console.error('Fichier FR non valide');
      return;
    }

    const parsed = parseM3U(text, 'fr', 'FR');
    frChannels.push(...parsed);
    renderLists();
    setStatus('Chaînes FR chargées : ' + parsed.length);
  } catch (e) {
    console.error('Erreur M3U FR', e);
    setStatus('Erreur M3U FR');
  }
}

function loadFromFile(file) {
  if (!file) return;
  if (fileNameLabel) fileNameLabel.textContent = file.name;
  setStatus('Lecture du fichier local…');

  const reader = new FileReader();

  if (/\.m3u8?$/i.test(file.name)) {
    reader.onload = () => {
      const text = String(reader.result || '');
      const parsed = parseM3U(text, 'channels', 'Playlist locale');
      channels.push(...parsed);
      renderLists();
      if (parsed.length && currentIndex === -1) {
        playChannel(channels.length - parsed.length);
      }
      setStatus('Playlist locale chargée (' + parsed.length + ' entrées)');
    };
    reader.readAsText(file);
  } else {
    const objectUrl = URL.createObjectURL(file);
    const entry = {
      id: `local-${nextUid()}`,
      name: file.name,
      url: objectUrl,
      logo: deriveLogoFromName(file.name),
      group: 'Local',
      isIframe: false,
      isFavorite: false,
      listType: 'channels'
    };
    channels.push(entry);
    renderLists();
    playChannel(channels.length - 1);
    setStatus('Fichier local prêt');
  }
}

function addIframeOverlay() {
  const title = iframeTitleInput?.value.trim() || 'Overlay iFrame';
  const url = iframeUrlInput?.value.trim();
  if (!url) return;

  const entry = {
    id: `iframe-${nextUid()}`,
    name: title,
    url,
    logo: deriveLogoFromName(title),
    group: 'Overlay',
    isIframe: true,
    isFavorite: false,
    listType: 'iframe'
  };

  iframeItems.push(entry);
  if (iframeTitleInput) iframeTitleInput.value = '';
  if (iframeUrlInput) iframeUrlInput.value = '';
  renderLists();
  playIframe(iframeItems.length - 1);
  showIframe();
  setStatus('Overlay ajouté');
}

// =====================================================
// JSON EXPORT / IMPORT
// =====================================================
function exportM3uToJson() {
  const payload = {
    type: 'm3u',
    version: 1,
    items: channels.map(ch => ({
      name: ch.name,
      url: ch.url,
      logo: ch.logo || deriveLogoFromName(ch.name),
      group: ch.group || '',
      isFavorite: !!ch.isFavorite,
      isIframe: !!ch.isIframe
    }))
  };
  if (jsonArea) jsonArea.value = JSON.stringify(payload, null, 2);
  setStatus('Export M3U → JSON prêt');
}

function exportIframeToJson() {
  const payload = {
    type: 'iframe',
    version: 1,
    items: iframeItems.map(it => ({
      name: it.name,
      url: it.url,
      logo: it.logo || deriveLogoFromName(it.name),
      group: it.group || 'Overlay',
      isFavorite: !!it.isFavorite
    }))
  };
  if (jsonArea) jsonArea.value = JSON.stringify(payload, null, 2);
  setStatus('Export iFrame → JSON prêt');
}

function importFromJson() {
  const text = (jsonArea?.value || '').trim();
  if (!text) {
    alert('Colle d’abord du JSON dans la zone prévue.');
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error(e);
    alert('JSON invalide : impossible de parser.');
    return;
  }

  if (!data || !Array.isArray(data.items)) {
    alert("Format JSON inattendu : il manque le tableau 'items'.");
    return;
  }

  const type = data.type || 'm3u';

  if (type === 'm3u') {
    data.items.forEach((item, idx) => {
      const name = item?.name || ('M3U ' + (channels.length + idx + 1));
      const url = item?.url;
      if (!url) return;

      channels.push({
        id: `json-${type}-${nextUid()}`,
        name,
        url,
        logo: normalizeLogo(item?.logo, name),
        group: item?.group || 'Playlist JSON',
        isIframe: !!item?.isIframe || isYoutubeUrl(url),
        isFavorite: !!item?.isFavorite,
        listType: 'channels'
      });
    });

    renderLists();
    setStatus('Import JSON M3U terminé (' + data.items.length + ' entrées)');
  } else if (type === 'iframe') {
    data.items.forEach((item, idx) => {
      const name = item?.name || ('Overlay ' + (iframeItems.length + idx + 1));
      const url = item?.url;
      if (!url) return;

      iframeItems.push({
        id: `json-${type}-${nextUid()}`,
        name,
        url,
        logo: normalizeLogo(item?.logo, name),
        group: item?.group || 'Overlay JSON',
        isIframe: true,
        isFavorite: !!item?.isFavorite,
        listType: 'iframe'
      });
    });

    renderLists();
    setStatus('Import JSON iFrame terminé (' + data.items.length + ' entrées)');
  } else {
    alert("Type JSON inconnu : '" + type + "'. Utilise 'm3u' ou 'iframe'.");
  }
}

// =====================================================
// EVENTS
// =====================================================


function autoplayFirstInList(listType) {
  // Ne pas interrompre la mini-radio si elle est en lecture
  if (typeof radioPlaying !== 'undefined' && radioPlaying) return;

  if (listType === 'favorites') {
    renderFavoritesList();
    if (!favoritesView.length) return;

    currentListType = 'favorites';
    currentFavPos = 0;

    const item = favoritesView[0];
    if (!item) return;

    playUrl(item.entry);
    renderFavoritesList();
    scrollToActiveItem();
    return;
  }

  if (listType === 'fr') {
    if (!frChannels.length) return;
    playFrChannel(0);
    return;
  }

  if (listType === 'iframe') {
    if (!iframeItems.length) return;
    playIframe(0);
    return;
  }

  // channels
  if (!channels.length) return;
  playChannel(0);
}


// Onglets
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const prevTab = document.querySelector('.tab-btn.active')?.dataset?.tab || '';

    // ✅ Même action que le bouton "⤺ Retour diffusion" du Radio Overlay
    // (radioOverlayBackBtn) : stop radio + restore playback.
    // Important : on évite l'autoplay automatique sur ce clic, sinon on écrase
    // le flux restauré par la 1ère chaîne de l'onglet.
    const radioOverlayOpen = !!radioOverlayLayer && radioOverlayLayer.style.display !== 'none';
    const skipAutoplay = (radioOverlayOpen || radioPlaying);
    if (skipAutoplay) {
      stopRadioAndRestore();
    }
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const tab = btn.dataset.tab;
    document.querySelectorAll('.list').forEach(l => l.classList.remove('active'));

    if (tab === 'channels') { currentListType = 'channels'; channelListEl?.classList.add('active'); }
    if (tab === 'fr') { currentListType = 'fr'; channelFrListEl?.classList.add('active'); }
    if (tab === 'iframes') { currentListType = 'iframe'; iframeListEl?.classList.add('active'); }
    if (tab === 'favorites') {
      currentListType = 'favorites';
      favoriteListEl?.classList.add('active');
      renderFavoritesList();
    }

    // Auto-diffuse la première chaîne quand on change de liste
    if (!skipAutoplay && tab && tab !== prevTab) {
      autoplayFirstInList(currentListType);
    }

    scrollToActiveItem();
    updateNowPlayingCounter();
    updateTrackControlsVisibility();
  });
});

// Recherche globale + clear
if (globalSearchInput) {
  const wrapper = globalSearchInput.closest('.search-wrapper');
  const syncWrapper = () => {
    if (!wrapper) return;
    wrapper.classList.toggle('has-text', globalSearchInput.value.length > 0);
  };

  syncWrapper();
  globalSearchInput.addEventListener('input', () => {
    currentSearch = globalSearchInput.value.trim().toLowerCase();
    syncWrapper();
    renderLists();
    scrollToActiveItem();
  });
}

if (clearSearchBtn && globalSearchInput) {
  clearSearchBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    currentSearch = '';
    globalSearchInput.value = '';
    const wrapper = globalSearchInput.closest('.search-wrapper');
    if (wrapper) wrapper.classList.remove('has-text');
    renderLists();
    scrollToActiveItem();
  });
}


// Bouton 🔒 Films (ouvre le modal d'accès)
const filmAccessBtn = document.getElementById('filmAccessBtn');
if (filmAccessBtn) {
  updateFilmAccessBtnUI();
  filmAccessBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    openFilmAccessOverlay();
  });
}

// Sections repliables
document.querySelectorAll('.loader-section .collapsible-label').forEach(label => {
  label.addEventListener('click', () => {
    const section = label.closest('.loader-section');
    section?.classList.toggle('open');
  });
});

// Sidebar
toggleSidebarBtn?.addEventListener('click', () => {
  const isCollapsed = sidebar?.classList.toggle('collapsed');
  toggleSidebarBtn.classList.toggle('active', !isCollapsed);
});
if (window.innerWidth <= 900) sidebar?.classList.add('collapsed');

// URL loader
loadUrlBtn?.addEventListener('click', () => loadFromUrl(urlInput?.value.trim()));
urlInput?.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') loadFromUrl(urlInput.value.trim());
});

// File loader
openFileBtn?.addEventListener('click', () => fileInput?.click());
fileInput?.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) loadFromFile(fileInput.files[0]);
});

// Iframe overlay add
addIframeBtn?.addEventListener('click', () => addIframeOverlay());
iframeUrlInput?.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') addIframeOverlay();
});

// Toggle overlay mode (chip STREAM/IFRAME)
toggleOverlayBtn?.addEventListener('click', () => {
  if (!currentEntry) {
    setStatus('Aucune entrée active');
    return;
  }

  if (overlayMode) {
    if (currentEntry.isIframe || isYoutubeUrl(currentEntry.url)) {
      setStatus('Cette entrée est un overlay (pas de mode vidéo)');
      return;
    }

    activePlaybackMode = 'stream';
    playUrl(currentEntry);
    refreshActiveListsUI();
    setStatus('Mode vidéo');
    return;
  }

  activePlaybackMode = 'iframe';
  playEntryAsOverlay(currentEntry);
  refreshActiveListsUI();
  setStatus('Mode iFrame');
});

// Fullscreen
fullPageBtn?.addEventListener('click', () => {
  const elem = appShell;
  if (!document.fullscreenElement) elem?.requestFullscreen?.();
  else document.exitFullscreen?.();
});

// Next / Prev
nextBtn?.addEventListener('click', playNext);
prevBtn?.addEventListener('click', playPrev);

// FX
fxToggleBtn?.addEventListener('click', () => {
  const active = appShell?.classList.toggle('fx-boost');
  playerContainer?.classList.toggle('fx-boost-edges', !!active);
  fxToggleBtn.classList.toggle('btn-accent', !!active);
});

// PiP
pipToggleBtn?.addEventListener('click', () => {
  const active = playerContainer?.classList.toggle('pip-mode');
  pipToggleBtn.classList.toggle('btn-accent', !!active);
});

// Stream URL panel
openStreamUrlBtn?.addEventListener('click', (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  openStreamUrlPanel(true);
});

streamUrlCloseBtn?.addEventListener('click', (ev) => {
  ev.preventDefault();
  closeStreamUrlPanel();
});

streamUrlOverlay?.addEventListener('click', (ev) => {
  if (ev.target === streamUrlOverlay) closeStreamUrlPanel();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && streamUrlOverlay && !streamUrlOverlay.classList.contains('hidden')) {
    closeStreamUrlPanel();
  }
});

streamUrlPlayBtn?.addEventListener('click', (ev) => {
  ev.preventDefault();
  const url = streamUrlInput?.value || '';
  const title = streamTitleInput?.value || '';
  closeStreamUrlPanel();
  playDirectStream(url, title, { updateUrl: true });
});

streamUrlCopyBtn?.addEventListener('click', async (ev) => {
  ev.preventDefault();
  const url = normalizeStreamUrl(streamUrlInput?.value || getQueryParams().get('streamUrl') || '');
  const title = (streamTitleInput?.value || getQueryParams().get('title') || '').trim();
  if (!url) { setStatus('Rien à copier'); return; }
  const link = buildStreamShareLink(url, title);
  try {
    await navigator.clipboard.writeText(link);
    setStatus('Lien copié');
  } catch {
    try { window.prompt('Copie le lien :', link); } catch {}
  }
});

// Thème
let currentTheme = 'classic';
themeToggleBtn?.addEventListener('click', () => {
  if (currentTheme === 'classic') {
    document.body.classList.add('theme-redblue');
    currentTheme = 'redblue';
    themeToggleBtn.textContent = 'Thème : Rouge/Bleu';
    themeToggleBtn.classList.add('btn-accent');
    setStatus('Thème Rouge/Bleu actif');
  } else {
    document.body.classList.remove('theme-redblue');
    currentTheme = 'classic';
    themeToggleBtn.textContent = 'Thème : Cyan/Orange';
    themeToggleBtn.classList.remove('btn-accent');
    setStatus('Thème Cyan/Orange actif');
  }
});

// JSON export/import
exportM3uJsonBtn?.addEventListener('click', exportM3uToJson);
exportIframeJsonBtn?.addEventListener('click', exportIframeToJson);
importJsonBtn?.addEventListener('click', importFromJson);

// Video events
videoEl?.addEventListener('playing', () => setStatus('Lecture en cours'));
videoEl?.addEventListener('pause', () => setStatus('Pause'));
videoEl?.addEventListener('waiting', () => setStatus('Buffering…'));
videoEl?.addEventListener('error', () => {
  const mediaError = videoEl.error;

  if (!externalFallbackTried && currentEntry && !currentEntry.isIframe && isProbablyHls(currentEntry.url)) {
    externalFallbackTried = true;
    console.warn('Erreur vidéo, fallback vers lecteur externe pour :', currentEntry.url);
    fallbackToExternalPlayer(currentEntry);
    return;
  }

  let msg = 'Erreur vidéo';
  if (mediaError) {
    switch (mediaError.code) {
      case mediaError.MEDIA_ERR_NETWORK: msg = 'Erreur réseau ou CORS possible'; break;
      case mediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: msg = 'Format non supporté ou URL invalide'; break;
      default: msg = 'Erreur de lecture (code ' + mediaError.code + ')';
    }
  }
  setStatus(msg);
  if (npBadge) npBadge.textContent = 'ERREUR';
  console.error('Video error', mediaError);
});

// ✅ Sauvegarde reprise : basée sur l’entrée réellement en lecture
videoEl?.addEventListener('timeupdate', () => {
  if (!currentEntry) return;
  if (currentEntry.listType !== 'channels') return;

  const key = currentEntry.url;

  if (!videoEl.duration || !isFinite(videoEl.duration) || videoEl.duration < 60) return;

  const t = videoEl.currentTime;
  if (t < 10) return;

  if (videoEl.duration - t < 20) {
    delete resumePositions[key];
    localStorage.setItem('tronAresResume', JSON.stringify(resumePositions));
    return;
  }

  resumePositions[key] = t;
  localStorage.setItem('tronAresResume', JSON.stringify(resumePositions));
});

// Track menus
audioTrackBtn?.addEventListener('click', (ev) => {
  ev.stopPropagation();
  if (!isMovieContext()) return;
  buildAudioTrackMenu();
  const isOpen = audioTrackMenu?.classList.toggle('open');
  if (isOpen) subtitleTrackMenu?.classList.remove('open');
});

subtitleTrackBtn?.addEventListener('click', (ev) => {
  ev.stopPropagation();
  if (!isMovieContext()) return;
  buildSubtitleTrackMenu();
  const isOpen = subtitleTrackMenu?.classList.toggle('open');
  if (isOpen) audioTrackMenu?.classList.remove('open');
});

document.addEventListener('click', () => closeAllTrackMenus());

// =====================================================
// DEMO DE BASE + OVERLAYS CUSTOM
// =====================================================
(function seedDemo() {
  const customOverlays = [
    { title: "CMTV", logo: "https://vsalema.github.io/StreamPilot-X-Studio-S/logos/cmtv.png", url: "//popcdn.day/player.php?stream=CMTVPT" },
    { title: "TVI",  logo: "https://vsalema.github.io/StreamPilot-X-Studio-S/logos/TVI.png", url: "https://vsalema.github.io/tvi2/" },
    { title: "TVIR", logo: "https://vsalema.github.io/StreamPilot-X-Studio-S/logos/tvir.jpg", url: "https://vsalema.github.io/tvi-reality/" },
    { title: "TVIF", logo: "https://vsalema.github.io/StreamPilot-X-Studio-O/logos/tvif.png", url: "https://vsalema.github.io/tvi-ficcao/" },
    { title: "TVIA", logo: "https://vsalema.github.io/StreamPilot-X-Studio-S/logos/tvia.png", url: "https://vsalema.github.io/tvi-africa/" },
    { title: "SIC",  logo: "https://vsalema.github.io/StreamPilot-X-Studio-S/logos/sic.jpg", url: "https://vsalema.github.io/sic/" },
    { title: "CNN",  logo: "https://vsalema.github.io/StreamPilot-X-Studio-S/logos/cnn.png", url: "https://vsalema.github.io/CNN/" },
    { title: "RTP1", logo: "https://vsalema.github.io/StreamPilot-X-Studio-S/logos/rtp1.jpg", url: "https://vsalema.github.io/play/?https://streaming-live.rtp.pt/liverepeater/smil:rtp1HD.smil/playlist.m3u8" },
    { title: "RTPN", logo: "https://vsalema.github.io/StreamPilot-X-Studio-S/logos/rtpn.png", url: "https://vsalema.github.io/play/?https://streaming-live.rtp.pt/livetvhlsDVR/rtpnHDdvr.smil/playlist.m3u8?DVR" },
    { title: "RTPI", logo: "https://vsalema.github.io/StreamPilot-X-Studio-S/logos/rtpi.jpg", url: "https://vsalema.github.io/play/?https://streaming-live.rtp.pt/liverepeater/rtpi.smil/playlist.m3u8" },
    { title: "BTV", logo: "https://vsalema.github.io/StreamPilot-X-Studio-S/logos/btv.svg", url: "//popcdn.day/go.php?stream=BTV1" },
    { title: "SCP", logo: "https://pplware.sapo.pt/wp-content/uploads/2017/06/scp_00.jpg", url: "//popcdn.day/go.php?stream=SPT1" },
    { title: "11",  logo: "https://www.zupimages.net/up/24/13/qj99.jpg", url: "https://popcdn.day/go.php?stream=Canal11" },
    { title: "BOLA", logo: "https://www.telesatellite.com/images/actu/a/abolatv.jpg", url: "//popcdn.day/go.php?stream=ABOLA" },
    { title: "Sport tv 1", logo: "https://cdn.brandfetch.io/idKvjRibkN/w/400/h/400/theme/dark/icon.jpeg?c=1dxbfHSJFAPEGdCLU4o5B", url: "//popcdn.day/go.php?stream=SPT1" },
    { title: "Sport tv 2", logo: "https://cdn.brandfetch.io/idKvjRibkN/w/400/h/400/theme/dark/icon.jpeg?c=1dxbfHSJFAPEGdCLU4o5B", url: "//popcdn.day/go.php?stream=SPT2" },
    { title: "Sport tv 3", logo: "https://cdn.brandfetch.io/idKvjRibkN/w/400/h/400/theme/dark/icon.jpeg?c=1dxbfHSJFAPEGdCLU4o5B", url: "//popcdn.day/go.php?stream=SPT3" },
    { title: "Sport tv 4", logo: "https://cdn.brandfetch.io/idKvjRibkN/w/400/h/400/theme/dark/icon.jpeg?c=1dxbfHSJFAPEGdCLU4o5B", url: "//popcdn.day/go.php?stream=SPT4" },
    { title: "Sport tv 5", logo: "https://cdn.brandfetch.io/idKvjRibkN/w/400/h/400/theme/dark/icon.jpeg?c=1dxbfHSJFAPEGdCLU4o5B", url: "//popcdn.day/go.php?stream=SPT5" },
    { title: "DAZN 1 PT",  logo: "https://upload.wikimedia.org/wikipedia/commons/7/71/DAZN_logo.svg", url: "//popcdn.day/go.php?stream=ELEVEN1" },
    { title: "DAZN 2 PT",  logo: "https://upload.wikimedia.org/wikipedia/commons/7/71/DAZN_logo.svg", url: "//popcdn.day/go.php?stream=ELEVEN2" },
    { title: "DAZN 3 PT",  logo: "https://upload.wikimedia.org/wikipedia/commons/7/71/DAZN_logo.svg", url: "//popcdn.day/go.php?stream=ELEVEN3" },
    { title: "DAZN 4 PT",  logo: "https://upload.wikimedia.org/wikipedia/commons/7/71/DAZN_logo.svg", url: "//popcdn.day/go.php?stream=ELEVEN4" },
    { title: "DAZN 5 PT",  logo: "https://upload.wikimedia.org/wikipedia/commons/7/71/DAZN_logo.svg", url: "//popcdn.day/go.php?stream=ELEVEN5" }
  ];

  customOverlays.forEach((item) => {
    iframeItems.push({
      id: `custom-ov-${nextUid()}`,
      name: item.title,
      url: item.url,
      logo: { type: "image", value: item.logo },
      group: "Overlay",
      isIframe: true,
      isFavorite: false,
      listType: "iframe"
    });
  });

  renderLists();
  updateNowPlaying(null, 'IDLE');
})();

// =====================================================
// CHARGEMENT AUTOMATIQUE DES PLAYLISTS PRINCIPALES
// =====================================================
(async function loadMainPlaylists() {
  await loadFromUrl("https://vsalema.github.io/tvpt4/css/playlist_par_genre.m3u");
  await loadFrM3u("https://vsalema.github.io/tvpt4/css/playlist-tvf-r.m3u");

  // ✅ Akamai-style: lecture directe via ?streamUrl=...
  const qs = getQueryParams();
  const directUrl = normalizeStreamUrl(qs.get('streamUrl'));
  if (directUrl) {
    const t = (qs.get('title') || '').trim();
    const muted = (qs.get('muted') === '1');
    const autoplayParam = qs.get('autoplay');
    const shouldAutoplay = (autoplayParam === null) ? true : (autoplayParam !== '0');

    if (muted && videoEl) {
      try { videoEl.muted = true; } catch {}
    }

    playDirectStream(directUrl, t, { updateUrl: false });

    if (!shouldAutoplay && videoEl) {
      try { videoEl.pause(); } catch {}
    }

    renderLists();
    updateNowPlaying(currentEntry, 'DIRECT');
    return;
  }


  if (frChannels.length > 0) {
    currentListType = 'fr';
    currentFrIndex = 0;

    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
      if (b.dataset.tab === 'fr') b.classList.add('active');
    });

    document.querySelectorAll('.list').forEach(l => l.classList.remove('active'));
    channelFrListEl?.classList.add('active');

    renderLists();
    playFrChannel(0);
  }
})();
