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

// --- Chromecast ---
const castLauncher = document.getElementById('castLauncher');


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

let radioPlaying = false;
let prevVideoMuted = false;
let prevVideoVolume = 1;

// =====================================================
// RADIO OVERLAY LAYER (3e couche dans playerContainer)
// =====================================================
let radioOverlayLayer = null;

function ensureRadioOverlayLayer() {
  if (radioOverlayLayer) return radioOverlayLayer;
  if (!playerContainer) return null;

  const host = playerContainer.querySelector('.player-inner') || playerContainer;

  const layer = document.createElement('div');
  layer.id = 'radioOverlayLayer';
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.display = 'none';
  layer.style.zIndex = '50';
  layer.style.pointerEvents = 'auto';
  layer.style.background =
    'radial-gradient(circle at 50% 35%, rgba(0,255,255,.12), rgba(0,0,0,.85) 60%)';
  layer.style.backdropFilter = 'blur(6px)';

  layer.innerHTML = `
    <div style="height:100%; display:flex; align-items:center; justify-content:center; padding:18px;">
      <div style="width:min(720px, 92vw); border:1px solid rgba(0,255,255,.25);
                  border-radius:18px; padding:18px;
                  box-shadow: 0 0 24px rgba(0,255,255,.12);
                  background: linear-gradient(180deg, rgba(0,0,0,.55), rgba(0,0,0,.35));
                  font-family: Orbitron, system-ui, sans-serif;">
        <div style="display:flex; gap:14px; align-items:center;">
          <img src="https://vsalema.github.io/ipodfm/img/Radio_Alfa.png"
               alt="Radio"
               style="width:64px; height:64px; border-radius:14px; object-fit:cover;
                      box-shadow: 0 0 14px rgba(255,145,0,.18); border:1px solid rgba(255,145,0,.35);" />
          <div style="flex:1;">
            <div style="font-size:18px; letter-spacing:.8px; color:rgba(255,255,255,.95);">
              Radio R.Alfa
            </div>
            <div style="margin-top:4px; font-size:12px; color:rgba(200,240,255,.75);">
              <p style="color: #ff9100;">(Pop)</p> Mode Radio (dans le player)
            </div>
          </div>

          <button id="radioOverlayBackBtn"
                  style="border:1px solid rgba(0,255,255,.28);
                         background: rgba(0,0,0,.25);
                         color: rgba(230,255,255,.92);
                         border-radius:12px;
                         padding:10px 12px;
                         cursor:pointer;">
            ⤺ Retour diffusion
          </button>
        </div>

        <div style="margin-top:16px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div style="display:flex; gap:10px; align-items:center;">
            <button id="radioOverlayPlayPauseBtn"
                    style="border:1px solid rgba(255,145,0,.35);
                           background: rgba(255,145,0,.12);
                           color: rgba(255,255,255,.92);
                           border-radius:14px;
                           padding:12px 16px;
                           cursor:pointer; font-weight:700;">
              ⏸ Pause
            </button>

            <div style="display:flex; gap:6px; align-items:flex-end; height:28px;">
              <span class="rovb" style="width:6px; height:10px; background:rgba(0,255,255,.7); border-radius:2px;"></span>
              <span class="rovb" style="width:6px; height:18px; background:rgba(0,255,255,.7); border-radius:2px;"></span>
              <span class="rovb" style="width:6px; height:14px; background:rgba(0,255,255,.7); border-radius:2px;"></span>
              <span class="rovb" style="width:6px; height:22px; background:rgba(0,255,255,.7); border-radius:2px;"></span>
            </div>
          </div>

          <div style="font-size:10px; color:rgba(255,255,255,.7);">
            Radio Alfa est une station de radio s'adressant à la communauté lusophone en France.
          </div>
        </div>
      </div>
    </div>
  `;

  let animTimer = null;
  function startBars() {
    stopBars();
    animTimer = setInterval(() => {
      const bars = layer.querySelectorAll('.rovb');
      bars.forEach(b => {
        const h = 8 + Math.floor(Math.random() * 22);
        b.style.height = h + 'px';
        b.style.opacity = (0.45 + Math.random() * 0.55).toFixed(2);
      });
    }, 140);
  }
  function stopBars() {
    if (animTimer) clearInterval(animTimer);
    animTimer = null;
  }

  layer.__startBars = startBars;
  layer.__stopBars = stopBars;

  const cs = window.getComputedStyle(host);
  if (cs.position === 'static') host.style.position = 'relative';

  host.appendChild(layer);
  radioOverlayLayer = layer;
  return layer;
}

function showRadioOverlayInPlayer() {
  const layer = ensureRadioOverlayLayer();
  if (!layer) return;

  layer.style.display = 'block';
  layer.__startBars?.();

  const backBtn = layer.querySelector('#radioOverlayBackBtn');
  const ppBtn = layer.querySelector('#radioOverlayPlayPauseBtn');

  backBtn.onclick = () => stopRadioAndRestore();

  ppBtn.onclick = () => {
    if (!radioAudio) return;
    if (radioAudio.paused) {
      radioAudio.play().then(() => {
        radioPlaying = true;
        if (radioPlayBtn) radioPlayBtn.textContent = '⏸';
        miniRadioEl?.classList.add('playing');
        ppBtn.textContent = '⏸ Pause';
        setStatus('Radio R.Alfa en lecture');
        layer.__startBars?.();
      }).catch(() => {});
    } else {
      radioAudio.pause();
      radioPlaying = false;
      if (radioPlayBtn) radioPlayBtn.textContent = '▶';
      miniRadioEl?.classList.remove('playing');
      ppBtn.textContent = '▶ Play';
      setStatus('Radio en pause');
      layer.__stopBars?.();
    }
  };
}

function hideRadioOverlayInPlayer() {
  if (!radioOverlayLayer) return;
  radioOverlayLayer.__stopBars?.();
  radioOverlayLayer.style.display = 'none';
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
// CHROMECAST (Google Cast) — cast du flux en cours
// ✅ Détecte la disponibilité Chromecast (à proximité)
// ✅ Lance/arrête un cast
// ⚠️ On ne peut pas « caster la page » depuis un site web :
//    Chromecast ne reçoit que des URLs média (HLS/DASH/MP4/MP3…)
//    Pour caster l’onglet/page entière → menu Chrome “Caster…”
// =====================================================
const CAST = {
  frameworkReady: false,
  castState: 'NO_DEVICES_AVAILABLE',
  sessionState: null,
  isConnected: false,
  lastLoadedUrl: null,
};

function _castHasFramework() {
  return typeof window.cast !== 'undefined' &&
         window.cast &&
         window.cast.framework &&
         typeof window.chrome !== 'undefined' &&
         window.chrome &&
         window.chrome.cast;
}

function updateCastButtonUI() {
  if (!castLauncher) return;

  castLauncher.classList.remove('cast-disabled','cast-available','cast-connecting','cast-connected');

  // Par défaut : désactivé
  let disabled = true;
  let label = 'Chromecast indisponible';

  if (_castHasFramework() && CAST.frameworkReady) {
    const cs = CAST.castState;

    if (cs === cast.framework.CastState.NO_DEVICES_AVAILABLE) {
      disabled = true;
      label = 'Aucun Chromecast détecté';
    } else if (cs === cast.framework.CastState.CONNECTING) {
      disabled = false;
      label = 'Connexion Chromecast…';
      castLauncher.classList.add('cast-connecting','cast-available');
    } else if (cs === cast.framework.CastState.CONNECTED) {
      disabled = false;
      label = 'Casting en cours — cliquer pour arrêter';
      castLauncher.classList.add('cast-connected');
    } else {
      // NOT_CONNECTED (devices dispo) ou état inconnu
      disabled = false;
      label = 'Caster sur Chromecast';
      castLauncher.classList.add('cast-available');
    }
  } else {
    disabled = true;
    label = 'Chromecast indisponible (Chrome/Edge requis)';
  }

  castLauncher.title = label;
  castLauncher.setAttribute('aria-label', label);

  if (disabled) {
    castLauncher.classList.add('cast-disabled');
    castLauncher.setAttribute('aria-disabled', 'true');
  } else {
    castLauncher.removeAttribute('aria-disabled');
  }
}

function guessCastContentType(url) {
  const u = String(url || '').toLowerCase();

  if (u.includes('.m3u8')) return 'application/x-mpegURL';
  if (u.includes('.mpd'))  return 'application/dash+xml';
  if (u.match(/\.(mp4|m4v)(\?|#|$)/)) return 'video/mp4';
  if (u.match(/\.(webm)(\?|#|$)/))    return 'video/webm';
  if (u.match(/\.(mp3)(\?|#|$)/))     return 'audio/mpeg';
  if (u.match(/\.(aac)(\?|#|$)/))     return 'audio/aac';
  if (u.match(/\.(m4a)(\?|#|$)/))     return 'audio/mp4';
  if (u.match(/\.(ogg|oga)(\?|#|$)/)) return 'audio/ogg';
  if (u.match(/\.(ts)(\?|#|$)/))      return 'video/mp2t';

  // fallback : beaucoup de flux IPTV ne donnent pas l’extension.
  // on laisse une valeur "générique" vidéo, le receiver tentera de lire.
  return 'video/mp4';
}

function guessCastStreamType(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('.m3u8') || u.includes('.mpd') || u.includes('live') || u.includes('manifest')) {
    return chrome.cast.media.StreamType.LIVE;
  }
  return chrome.cast.media.StreamType.BUFFERED;
}

function buildCastLoadRequest() {
  if (!currentEntry || !currentEntry.url) {
    return { ok:false, reason:'Aucun flux en cours.' };
  }

  // iFrame / YouTube : pas casterable via Default Media Receiver
  if (currentEntry.isIframe || isYoutubeUrl(currentEntry.url) || activePlaybackMode === 'iframe') {
    return { ok:false, reason:'Ce contenu (iFrame/YouTube) ne peut pas être casté directement.' };
  }

  const url = String(currentEntry.url);

  // Fichiers locaux / blob
  if (/^(blob:|file:|data:)/i.test(url)) {
    return { ok:false, reason:'Un fichier local / blob ne peut pas être casté (Chromecast doit accéder à une URL HTTP(S)).' };
  }

  const contentType = guessCastContentType(url);
  const mediaInfo = new chrome.cast.media.MediaInfo(url, contentType);

  mediaInfo.streamType = guessCastStreamType(url);

  // Métadonnées (titre/logo)
  try {
    const meta = new chrome.cast.media.GenericMediaMetadata();
    meta.title = normalizeName(currentEntry.name || 'Lecture');
    const logo = currentEntry.logo || deriveLogoFromName(currentEntry.name);
    if (logo && logo.type === 'image' && typeof logo.value === 'string' && /^https?:\/\//i.test(logo.value)) {
      meta.images = [ new chrome.cast.Image(logo.value) ];
    }
    mediaInfo.metadata = meta;
  } catch {}

  const req = new chrome.cast.media.LoadRequest(mediaInfo);
  req.autoplay = true;

  // reprise (uniquement si contenu buffered)
  try {
    if (videoEl && Number.isFinite(videoEl.currentTime) && mediaInfo.streamType === chrome.cast.media.StreamType.BUFFERED) {
      req.currentTime = Math.max(0, Number(videoEl.currentTime) || 0);
    }
  } catch {}

  return { ok:true, request:req, url };
}

async function castLoadCurrentEntry(silent = false) {
  if (!_castHasFramework() || !CAST.frameworkReady) {
    if (!silent) setStatus('Chromecast indisponible');
    return false;
  }

  const ctx = cast.framework.CastContext.getInstance();
  const session = ctx.getCurrentSession();

  if (!session) {
    if (!silent) setStatus('Chromecast : aucune session');
    return false;
  }

  const built = buildCastLoadRequest();
  if (!built.ok) {
    if (!silent) setStatus('Chromecast : ' + built.reason);
    return false;
  }

  // Évite de recharger la même URL en boucle
  if (CAST.lastLoadedUrl === built.url && silent) return true;

  try {
    await session.loadMedia(built.request);
    CAST.lastLoadedUrl = built.url;

    // côté local : on coupe pour éviter double son
    try { videoEl?.pause(); } catch {}

    if (!silent) setStatus('Chromecast : diffusion lancée');
    return true;
  } catch (e) {
    console.warn('Chromecast loadMedia error', e);
    if (!silent) setStatus('Chromecast : impossible de diffuser ce flux');
    return false;
  }
}

// Bind UI
if (castLauncher) {
  updateCastButtonUI(); // état initial
}

// Callback appelé par le SDK Cast
window.__onGCastApiAvailable = function(isAvailable) {
  if (!isAvailable) {
    CAST.frameworkReady = false;
    updateCastButtonUI();
    return;
  }

  try {
    const ctx = cast.framework.CastContext.getInstance();
    const DEFAULT_RECEIVER_APP_ID =
      (cast.framework && cast.framework.CastContext && cast.framework.CastContext.DEFAULT_MEDIA_RECEIVER_APP_ID)
      ? cast.framework.CastContext.DEFAULT_MEDIA_RECEIVER_APP_ID
      : 'CC1AD845'; // Default Media Receiver (fallback)

    ctx.setOptions({
      receiverApplicationId: DEFAULT_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });

    // Debug (décommente si besoin)
    // cast.framework.Logger.setLevel(cast.framework.LoggerLevel.DEBUG);
CAST.frameworkReady = true;
    CAST.castState = ctx.getCastState();

    ctx.addEventListener(
      cast.framework.CastContextEventType.CAST_STATE_CHANGED,
      (e) => {
        CAST.castState = e.castState;
        updateCastButtonUI();
      }
    );

    ctx.addEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      (e) => {
        CAST.sessionState = e.sessionState;
        CAST.isConnected = (
          e.sessionState === cast.framework.SessionState.SESSION_STARTED ||
          e.sessionState === cast.framework.SessionState.SESSION_RESUMED
        );

        updateCastButtonUI();

        // Si session connectée, on tente de diffuser le flux courant
        if (CAST.isConnected) {
          castLoadCurrentEntry(true);
        }
      }
    );

    updateCastButtonUI();
  } catch (e) {
    console.warn('Chromecast init error', e);
    CAST.frameworkReady = false;
    updateCastButtonUI();
  }
};

// CAST: init immédiat si déjà dispo (si le SDK s’est chargé avant la callback)
try{
  if (_castHasFramework() && typeof window.__onGCastApiAvailable === 'function' && window.cast && window.cast.framework) {
    // Some builds set chrome.cast.isAvailable, others rely on cast.framework presence
    window.__onGCastApiAvailable(true);
  }
}catch{}


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
  try { radioAudio?.pause(); } catch {}
  radioPlaying = false;
  if (radioPlayBtn) radioPlayBtn.textContent = '▶';
  miniRadioEl?.classList.remove('playing');
  restorePlaybackAfterRadio();
}

if (miniRadioEl && radioPlayBtn) {
  radioPlayBtn.addEventListener('click', () => {
    if (!radioPlaying) {
      lastPlaybackSnapshot = snapshotCurrentPlayback();
      stopPlaybackForRadio(lastPlaybackSnapshot);

      radioAudio.play()
        .then(() => {
          radioPlaying = true;
          radioPlayBtn.textContent = '⏸';
          miniRadioEl.classList.add('playing');
          setStatus('Radio R.Alfa en lecture');
        })
        .catch(err => {
          console.error('Erreur lecture radio', err);
          setStatus('Erreur radio');
          stopRadioAndRestore();
        });
    } else {
      stopRadioAndRestore();
    }
  });

  radioAudio.addEventListener('ended', () => stopRadioAndRestore());
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
  audioTrackMenu.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'np-track-menu-header';
  header.textContent = 'Audio';
  audioTrackMenu.appendChild(header);

  let provider = 'none';
  let tracks = [];
  let currentIndex = -1;

  // HLS (hls.js)
  if (hlsInstance && Array.isArray(hlsInstance.audioTracks)) {
    provider = 'hls';
    tracks = hlsInstance.audioTracks;
    currentIndex = (Number.isInteger(hlsInstance.audioTrack) && hlsInstance.audioTrack >= 0)
      ? hlsInstance.audioTrack
      : (tracks.length ? 0 : -1);
  }

  // DASH (dash.js)
  if (provider === 'none' && dashInstance && typeof dashInstance.getTracksFor === 'function') {
    provider = 'dash';
    tracks = dashInstance.getTracksFor('audio') || [];

    const currentTrack = (typeof dashInstance.getCurrentTrackFor === 'function')
      ? dashInstance.getCurrentTrackFor('audio')
      : null;

    if (currentTrack && tracks.length) {
      currentIndex = tracks.findIndex(t => {
        if (!t) return false;
        if (t === currentTrack) return true;
        if (t.id !== undefined && currentTrack.id !== undefined && t.id === currentTrack.id) return true;
        if (t.lang && currentTrack.lang && t.lang === currentTrack.lang) {
          const a = Array.isArray(t.roles) ? t.roles.join(',') : '';
          const b = Array.isArray(currentTrack.roles) ? currentTrack.roles.join(',') : '';
          return a === b;
        }
        return false;
      });
    }

    if (currentIndex < 0) currentIndex = tracks.length ? 0 : -1;
  }

  activeAudioIndex = currentIndex;
  // Build a simple language frequency map so we don't show internal ids when a language is unique
  const langCounts = {};
  (tracks || []).forEach((t) => {
    const l = (t && (t.lang || t.language || t.idLanguage))
      ? String(t.lang || t.language || t.idLanguage).trim().toLowerCase()
      : "";
    if (l) langCounts[l] = (langCounts[l] || 0) + 1;
  });

  // No tracks
  if (!tracks || tracks.length === 0) {
    const emptyItem = document.createElement('div');
    emptyItem.className = 'np-track-item';
    emptyItem.style.opacity = '0.7';
    emptyItem.style.pointerEvents = 'none';

    const emptyLabel = document.createElement('div');
    emptyLabel.className = 'np-track-item-label';
    emptyLabel.textContent = 'Aucune piste audio';
    emptyItem.appendChild(emptyLabel);

    audioTrackMenu.appendChild(emptyItem);
    return;
  }

  // Utility: bitrate formatting (DASH)
  const formatBitrate = (bps) => {
    const n = Number(bps);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n >= 1000 * 1000) return `${(n / (1000 * 1000)).toFixed(1)} Mbps`;
    if (n >= 1000) return `${Math.round(n / 1000)} kbps`;
    return `${Math.round(n)} bps`;
  };

  tracks.forEach((track, index) => {
    const item = document.createElement('div');
    item.className = 'np-track-item';
    item.dataset.index = index;

    if (index === currentIndex) item.classList.add('active');

    // Label + meta
    const labelEl = document.createElement('div');
    labelEl.className = 'np-track-item-label';

    const metaEl = document.createElement('div');
    metaEl.className = 'np-track-item-meta';

    if (provider === 'hls') {
      const lang = (track && (track.lang || track.language) ? String(track.lang || track.language) : '').trim();
      const name = (track && track.name ? String(track.name) : '').trim();
      const groupId = (track && track.groupId ? String(track.groupId) : '').trim();

      let label = name || lang || groupId || `Audio ${index + 1}`;
      if (name && lang && name !== lang) label = `${name} (${lang})`;

      labelEl.textContent = label;

      const parts = [];
      if (lang) parts.push(`Langue: ${lang}`);
      if (groupId) parts.push(`Groupe: ${groupId}`);
      metaEl.textContent = parts.join(' • ');
    } else if (provider === 'dash') {
      const lang = (track && (track.lang || track.language) ? String(track.lang || track.language) : '').trim();
      const langKey = lang ? lang.toLowerCase() : "";
      const roles = (track && Array.isArray(track.roles)) ? track.roles.filter(Boolean) : [];

      // Prefer label, then lang, then id
      const rawLabel = (track && track.label) ? String(track.label).trim() : '';
      const rawId = (track && track.id !== undefined) ? String(track.id).trim() : '';

      let label = rawLabel || lang || rawId || `Audio ${index + 1}`;
      if (rawLabel && lang && !rawLabel.toLowerCase().includes(lang.toLowerCase())) {
        label = `${rawLabel} (${lang})`;
      } else if (!rawLabel && rawId && lang) {
        label = (langKey && langCounts[langKey] > 1) ? `${lang} (${rawId})` : lang;
      }

      labelEl.textContent = label;

      const parts = [];
      if (lang) parts.push(`Langue: ${lang}`);
      if (roles.length) parts.push(`Rôle: ${roles.join(', ')}`);

      const bitrateList = (track && Array.isArray(track.bitrateList)) ? track.bitrateList : [];
      const bitrates = bitrateList
        .map(b => (b && (b.bitrate || b.bandwidth)) ? Number(b.bitrate || b.bandwidth) : NaN)
        .filter(Number.isFinite);

      if (bitrates.length) {
        const min = Math.min(...bitrates);
        const max = Math.max(...bitrates);
        if (min === max) parts.push(`Débit: ${formatBitrate(min)}`);
        else parts.push(`Débit: ${formatBitrate(min)} – ${formatBitrate(max)}`);
      }

      metaEl.textContent = parts.join(' • ');
    } else {
      labelEl.textContent = `Audio ${index + 1}`;
      metaEl.textContent = '';
    }

    item.appendChild(labelEl);
    if (metaEl.textContent) item.appendChild(metaEl);

    item.addEventListener('click', () => {
      setAudioTrack(index);
      closeAllTrackMenus();
    });

    audioTrackMenu.appendChild(item);
  });
}

function setAudioTrack(index) {
  // HLS (hls.js)
  if (hlsInstance && Array.isArray(hlsInstance.audioTracks)) {
    if (index < 0 || index >= hlsInstance.audioTracks.length) return;

    hlsInstance.audioTrack = index;
    activeAudioIndex = index;
    buildAudioTrackMenu();
    return;
  }

  // DASH (dash.js)
  if (dashInstance && typeof dashInstance.getTracksFor === 'function') {
    const tracks = dashInstance.getTracksFor('audio') || [];
    if (index < 0 || index >= tracks.length) return;

    const track = tracks[index];

    try {
      if (typeof dashInstance.setCurrentTrack === 'function') {
        dashInstance.setCurrentTrack(track);
      } else if (typeof dashInstance.setCurrentTrackFor === 'function') {
        dashInstance.setCurrentTrackFor('audio', track);
      } else if (typeof dashInstance.setCurrentTrackByIndex === 'function') {
        dashInstance.setCurrentTrackByIndex('audio', index);
      } else {
        console.warn('Impossible de changer la piste audio: API dash.js non trouvée.');
        return;
      }
    } catch (err) {
      console.error('Erreur lors du changement de piste audio (DASH):', err);
      return;
    }

    activeAudioIndex = index;
    buildAudioTrackMenu();
  }
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
  // Track menus are only shown for "Channel/Live" context in this project
  if (!isMovieContext()) {
    audioTrackMenu.innerHTML = '';
    subtitleTrackMenu.innerHTML = '';
    activeAudioIndex = -1;
    activeSubtitleIndex = -1;
    closeAllTrackMenus();
    updateTrackControlsVisibility();
    return;
  }

  buildAudioTrackMenu();
  buildSubtitleTrackMenu();
  updateTrackControlsVisibility();
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

  // stop radio si elle joue
  if (typeof radioAudio !== 'undefined' && radioPlaying) {
    try { radioAudio.pause(); } catch {}
    radioPlaying = false;
    if (radioPlayBtn) radioPlayBtn.textContent = '▶';
    miniRadioEl?.classList.remove('playing');
    hideRadioOverlayInPlayer();
    try {
      videoEl.muted = prevVideoMuted;
      videoEl.volume = prevVideoVolume;
    } catch {}
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
      // Keep track menus in sync with DASH manifests and track changes
if (typeof dashjs !== 'undefined' && dashjs.MediaPlayer && dashjs.MediaPlayer.events) {
  const ev = dashjs.MediaPlayer.events;
  dashInstance.on(ev.STREAM_INITIALIZED, refreshTrackMenus);
  dashInstance.on(ev.TRACKS_ADDED, refreshTrackMenus);
  if (ev.TRACK_CHANGE_RENDERED) dashInstance.on(ev.TRACK_CHANGE_RENDERED, refreshTrackMenus);
}
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


    } catch (e) {
      console.warn('Erreur reprise position', e);
    }
    refreshTrackMenus();
  };

  videoEl.play().catch(() => {});

  updateNowPlaying(entry, modeLabel);
  setStatus('Lecture en cours');

  // Chromecast: si une session est connectée, on tente d’envoyer le nouveau flux
  try {
    if (typeof CAST !== 'undefined' && CAST.isConnected) {
      castLoadCurrentEntry(true);
    }
  } catch {}

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
  await loadFromUrl("https://vsalema.github.io/tvpt4/css/getFeed_grouped_tmdb_categories_v3.m3u");
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
