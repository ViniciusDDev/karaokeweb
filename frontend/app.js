// OpenKaraoke - Web Audio Engine & Party Queue Controller

let audioCtx = null;
let currentSongData = null;
let currentLyrics = [];
let isPlaying = false;
let startTime = 0;
let pauseOffset = 0;
let totalDuration = 0;

// Web Audio nós (2 Stems: Instrumental & Lead Vocal)
let bufferSources = { instrumental: null, lead: null };
let audioBuffers = { instrumental: null, lead: null };
let gainNodes = { instrumental: null, lead: null };

// Motor de Microfone e Retorno ao Vivo
let micStream = null;
let micSource = null;
let micGainNode = null;
let micAnalyser = null;
let micInterval = null;
let singingSamples = [];
let isMicActive = false;

// Preview de áudio (5 segundos)
let activePreviewAudio = null;
let activePreviewBtn = null;
let previewTimeout = null;

// Função utilitária para obter/iniciar o AudioContext global
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// Estado da Fila e Processamento
let currentQueue = [];
let activePlayingId = null;
let activeProcessingId = null;

// Elementos da UI - Header & Hardware
const hwDesc = document.getElementById("hw-desc");
const headerQueueCount = document.getElementById("header-queue-count");
const btnToggleQueueView = document.getElementById("btn-toggle-queue-view");
const btnHeaderStage = document.getElementById("btn-header-stage");

// Elementos - Vistas do Fluxo Passo a Passo
const viewStepSearch = document.getElementById("view-step-search");
const viewStepResults = document.getElementById("view-step-results");
const viewStepProcessing = document.getElementById("view-step-processing");
const viewStepPlayer = document.getElementById("view-step-player");

// Passo 1: Busca
const formSearch = document.getElementById("form-search");
const inputSearch = document.getElementById("input-search");

// Passo 2: Resultados
const resultsQueryTitle = document.getElementById("results-query-title");
const searchResults = document.getElementById("search-results");

// Passo 3: Processando
const procThumb = document.getElementById("proc-thumb");
const procSpinner = document.getElementById("proc-spinner");
const procSingerBadge = document.getElementById("proc-singer-badge");
const procTitle = document.getElementById("proc-title");
const procArtist = document.getElementById("proc-artist");
const procMsg = document.getElementById("proc-msg");
const procPct = document.getElementById("proc-pct");
const procBarFill = document.getElementById("proc-bar-fill");
const btnProcPlayNow = document.getElementById("btn-proc-play-now");

// Passo 4: Player / Palco
const karaokeBg = document.getElementById("karaoke-bg");
const karaokeOverlay = document.getElementById("karaoke-overlay");
const currentTitle = document.getElementById("current-title");
const currentArtist = document.getElementById("current-artist");
const currentSingerBadge = document.getElementById("current-singer-badge");

const lyricsScrollBox = document.getElementById("lyrics-scroll-box");
const introCountdown = document.getElementById("intro-countdown");
const introCountdownSeconds = document.getElementById("intro-countdown-seconds");
const btnToggleFullscreen = document.getElementById("btn-toggle-fullscreen");

const seekBar = document.getElementById("seek-bar");
const timeCurrent = document.getElementById("time-current");
const timeTotal = document.getElementById("time-total");
const btnPlayPause = document.getElementById("btn-play-pause");
const btnSkipSong = document.getElementById("btn-skip-song");
const btnAdjustLyrics = document.getElementById("btn-adjust-lyrics");

// Drawer da Fila (Menu Suspenso Direito)
const drawerQueue = document.getElementById("drawer-queue");
const drawerQueueBackdrop = document.getElementById("drawer-queue-backdrop");
const drawerQueueBadge = document.getElementById("drawer-queue-badge");
const drawerQueueList = document.getElementById("drawer-queue-list");
const btnCloseQueueDrawer = document.getElementById("btn-close-queue-drawer");

// Modal Mixer de Som (Instrumental, Lead Guia, Retorno Mic, Contraste)
const modalMixer = document.getElementById("modal-mixer");
const btnOpenMixer = document.getElementById("btn-open-mixer");
const btnCloseMixer = document.getElementById("btn-close-mixer");
const btnSaveMixer = document.getElementById("btn-save-mixer");

const sliderInst = document.getElementById("slider-inst");
const sliderLead = document.getElementById("slider-lead");
const sliderMic = document.getElementById("slider-mic");
const sliderOpacity = document.getElementById("slider-opacity");

const volTextInst = document.getElementById("vol-text-inst");
const volTextLead = document.getElementById("vol-text-lead");
const volTextMic = document.getElementById("vol-text-mic");
const textOpacity = document.getElementById("text-opacity");

const btnToggleMic = document.getElementById("btn-toggle-mic");
const micStatusDot = document.getElementById("mic-status-dot");
const micBtnText = document.getElementById("mic-btn-text");
const btnFinishSong = document.getElementById("btn-finish-song");

// Modais Pontuação & Hall
const modalScore = document.getElementById("modal-score");
const finalScoreNumber = document.getElementById("final-score-number");
const scorePraise = document.getElementById("score-praise");
const formHall = document.getElementById("form-hall");
const inputSingerName = document.getElementById("input-singer-name");
const btnCloseScore = document.getElementById("btn-close-score");

const btnOpenHall = document.getElementById("btn-open-hall");
const modalHallList = document.getElementById("modal-hall-list");
const btnCloseHallModal = document.getElementById("btn-close-hall-modal");
const hallListContainer = document.getElementById("hall-list-container");

// QR Code Widget
const qrWidget = document.getElementById("qr-widget");
const qrCard = document.getElementById("qr-card");
const qrPillBtn = document.getElementById("qr-pill-btn");
const btnMinimizeQr = document.getElementById("btn-minimize-qr");
const qrcodeContainer = document.getElementById("qrcode-container");
const partyUrlText = document.getElementById("party-url-text");
const btnToggleQrWidget = document.getElementById("btn-toggle-qr-widget");

// Modal Ajustar Letra
const modalAdjustLyrics = document.getElementById("modal-adjust-lyrics");
const btnCloseAdjustModal = document.getElementById("btn-close-adjust-modal");
const inputLyricsQuery = document.getElementById("input-lyrics-query");
const btnSearchLrclib = document.getElementById("btn-search-lrclib");
const lyricsOptionsList = document.getElementById("lyrics-options-list");
const btnWhisperGenerate = document.getElementById("btn-whisper-generate");

// ========================================================
// 1. GERENCIADOR DE TELAS (WIZARD PASSO A PASSO)
// ========================================================
window.showStep = function(stepName) {
  stopAudioPreview();

  viewStepSearch.classList.add("hidden");
  viewStepResults.classList.add("hidden");
  viewStepProcessing.classList.add("hidden");
  viewStepPlayer.classList.add("hidden");

  if (stepName === "search") {
    viewStepSearch.classList.remove("hidden");
    setTimeout(() => inputSearch && inputSearch.focus(), 50);
  } else if (stepName === "results") {
    viewStepResults.classList.remove("hidden");
  } else if (stepName === "processing") {
    viewStepProcessing.classList.remove("hidden");
  } else if (stepName === "player") {
    viewStepPlayer.classList.remove("hidden");
  }

  // Atualiza botão do palco no topo
  if (currentSongData) {
    btnHeaderStage.classList.remove("hidden");
  } else {
    btnHeaderStage.classList.add("hidden");
  }
};

window.quickSearch = function(query) {
  inputSearch.value = query;
  formSearch.dispatchEvent(new Event("submit"));
};

// ========================================================
// 2. CONTROLE DO MENU SUSPENSO DA FILA (DRAWER)
// ========================================================
window.toggleQueueDrawer = function(open) {
  if (open) {
    drawerQueueBackdrop.classList.remove("hidden");
    drawerQueue.classList.remove("translate-x-full");
  } else {
    drawerQueue.classList.add("translate-x-full");
    drawerQueueBackdrop.classList.add("hidden");
  }
};

btnToggleQueueView.addEventListener("click", () => toggleQueueDrawer(true));
btnCloseQueueDrawer.addEventListener("click", () => toggleQueueDrawer(false));
drawerQueueBackdrop.addEventListener("click", () => toggleQueueDrawer(false));

btnHeaderStage.addEventListener("click", () => {
  showStep("player");
});

// ========================================================
// 3. INICIALIZAÇÃO
// ========================================================
async function init() {
  setupEventListeners();
  checkHardware();
  initMicrophone();
  initPartyQrCode();
  connectQueueEvents();
  showStep("search");
}

async function checkHardware() {
  try {
    const res = await fetch("/api/hardware");
    const data = await res.json();
    hwDesc.textContent = data.description || "Pronto para uso";
  } catch (e) {
    hwDesc.textContent = "Modo Local Padrão";
  }
}

// 4. Inicialização do QR Code para Conexão dos Celulares
async function initPartyQrCode() {
  try {
    const res = await fetch("/api/party/info");
    const data = await res.json();
    const partyUrl = data.party_url;
    partyUrlText.textContent = partyUrl;

    qrcodeContainer.innerHTML = "";
    if (window.QRCode) {
      new QRCode(qrcodeContainer, {
        text: partyUrl,
        width: 144,
        height: 144,
        colorDark: "#020617",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  } catch (err) {
    partyUrlText.textContent = "Conecte-se ao mesmo Wi-Fi";
  }
}

// ========================================================
// 5. CONTROLE DA FILA & EVENTOS SSE EM TEMPO REAL
// ========================================================
function connectQueueEvents() {
  const evtSource = new EventSource("/api/queue/events");
  evtSource.onmessage = (event) => {
    try {
      const queue = JSON.parse(event.data);
      currentQueue = queue;
      renderDrawerQueue(queue);

      // Se temos uma música sendo processada e monitorada na tela de processamento:
      if (activeProcessingId) {
        const procItem = queue.find(item => item.id === activeProcessingId);
        if (procItem) {
          updateProcessingView(procItem);
        }
      }
    } catch (e) {
      console.error("Erro ao processar evento de fila:", e);
    }
  };

  evtSource.onerror = () => {
    setTimeout(connectQueueEvents, 4000);
  };
}

function renderDrawerQueue(queue) {
  const count = queue.length;
  headerQueueCount.textContent = `${count}/20`;
  drawerQueueBadge.textContent = `${count}/20`;

  if (count === 0) {
    drawerQueueList.innerHTML = `
      <p class="text-center text-slate-500 text-xs py-10">
        A fila está vazia. Adicione músicas pelo sistema de busca ou celular!
      </p>
    `;
    return;
  }

  drawerQueueList.innerHTML = queue.map((item, idx) => {
    let actionBtn = "";
    let statusClass = "border-slate-800 bg-slate-950/80";

    if (item.status === "playing") {
      statusClass = "border-emerald-500/60 bg-emerald-950/20";
      actionBtn = `<span class="text-xs font-bold text-emerald-400 animate-pulse flex items-center gap-1">🎤 No Palco</span>`;
    } else if (item.status === "ready") {
      statusClass = "border-sky-500/40 bg-sky-950/10";
      actionBtn = `
        <button onclick="playQueueSong('${item.id}')" class="bg-sky-500 hover:bg-sky-400 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition active:scale-95 shadow-sm">
          ▶ Tocar Agora
        </button>
      `;
    } else if (item.status === "processing") {
      statusClass = "border-amber-500/40 bg-amber-950/10";
      actionBtn = `
        <div class="flex flex-col gap-1 w-28">
          <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div class="bg-amber-400 h-full transition-all duration-300" style="width: ${item.percent}%"></div>
          </div>
          <span class="text-[10px] text-amber-300 truncate">${item.percent}%: ${item.message}</span>
        </div>
      `;
    } else {
      actionBtn = `<span class="text-[11px] text-slate-400 font-medium">Aguardando...</span>`;
    }

    return `
      <div class="border ${statusClass} rounded-2xl p-3 flex items-center gap-3 shadow-md hover:border-slate-700 transition">
        <span class="text-sm font-mono font-bold ${item.status === 'playing' ? 'text-emerald-400' : 'text-slate-500'}">#${idx + 1}</span>
        <img src="${item.thumbnail}" class="w-14 h-11 object-cover rounded-xl bg-slate-900 flex-shrink-0">
        <div class="flex-1 min-w-0">
          <h4 class="text-xs font-bold text-slate-100 truncate">${item.title}</h4>
          <p class="text-[11px] text-slate-400 truncate">
            Cantor(a): <span class="text-sky-300 font-semibold">${item.requested_by}</span>
          </p>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          ${actionBtn}
          ${item.status !== 'playing' ? `
            <button onclick="removeQueueSong('${item.id}')" class="text-slate-500 hover:text-red-400 text-sm p-1.5 rounded-lg hover:bg-slate-800 transition" title="Remover da fila">
              🗑️
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");
}

// ========================================================
// 6. EXECUÇÃO DE MÚSICA DA FILA & REMOÇÃO
// ========================================================
window.playQueueSong = async function(itemId) {
  try {
    const res = await fetch(`/api/queue/${itemId}/play`, { method: "POST" });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      alert("Erro do servidor ao iniciar música: " + text.slice(0, 160));
      return;
    }

    if (!res.ok) {
      alert(data.detail || "Não foi possível reproduzir a música.");
      return;
    }

    activePlayingId = itemId;
    toggleQueueDrawer(false);
    showStep("player");
    await loadKaraokeTrack(data.item);
  } catch (err) {
    alert("Erro de conexão ao tocar música: " + err.message);
  }
};

window.removeQueueSong = async function(itemId) {
  try {
    await fetch(`/api/queue/${itemId}`, { method: "DELETE" });
    if (activeProcessingId === itemId) {
      activeProcessingId = null;
      showStep("search");
    }
  } catch (err) {
    alert("Erro ao remover: " + err.message);
  }
};

// ========================================================
// 7. PREVIEW DE ÁUDIO DE 5 SEGUNDOS
// ========================================================
function stopAudioPreview() {
  if (previewTimeout) {
    clearTimeout(previewTimeout);
    previewTimeout = null;
  }
  if (activePreviewAudio) {
    try {
      activePreviewAudio.pause();
      activePreviewAudio.currentTime = 0;
    } catch (e) {}
    activePreviewAudio = null;
  }
  if (activePreviewBtn) {
    activePreviewBtn.innerHTML = `<span>▶ 5s Preview</span>`;
    activePreviewBtn.classList.remove("bg-red-500/30", "text-red-300", "border-red-500/40");
    activePreviewBtn = null;
  }
}

window.playAudioPreview = function(videoId, btn) {
  if (activePreviewBtn === btn) {
    stopAudioPreview();
    return;
  }

  stopAudioPreview();
  activePreviewBtn = btn;
  btn.innerHTML = `<span class="animate-pulse">⏳ Carregando...</span>`;

  const audio = new Audio(`/api/preview/${videoId}`);
  activePreviewAudio = audio;

  let started = false;
  const startAudio = () => {
    if (started) return;
    started = true;
    audio.play().then(() => {
      btn.innerHTML = `<span>⏹ Parar (5s)</span>`;
      btn.classList.add("bg-red-500/30", "text-red-300", "border-red-500/40");
      previewTimeout = setTimeout(() => {
        stopAudioPreview();
      }, 5000);
    }).catch(() => {
      btn.innerHTML = `<span>⚠️ Clique p/ Ouvir</span>`;
      setTimeout(() => stopAudioPreview(), 2000);
    });
  };

  audio.addEventListener("canplaythrough", startAudio, { once: true });
  audio.addEventListener("ended", () => stopAudioPreview());
  audio.addEventListener("error", () => {
    btn.innerHTML = `<span>⚠️ Erro Preview</span>`;
    setTimeout(() => stopAudioPreview(), 2000);
  });
  audio.load();
};

// ========================================================
// 8. BUSCA NO YOUTUBE (PASSO 1 -> PASSO 2)
// ========================================================
formSearch.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = inputSearch.value.trim();
  if (!query) return;

  resultsQueryTitle.textContent = `Resultados para "${query}"`;
  showStep("results");

  searchResults.innerHTML = `
    <div class="col-span-full py-12 text-center text-slate-400 flex flex-col items-center gap-3">
      <div class="w-10 h-10 border-3 border-sky-400 border-t-transparent rounded-full animate-spin"></div>
      <p class="text-sm font-medium">Buscando versões e faixas no YouTube...</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      searchResults.innerHTML = `<p class="col-span-full text-center text-slate-400 py-10">Nenhum resultado encontrado para esta busca.</p>`;
      return;
    }

    renderSearchResults(data.results);
  } catch (err) {
    searchResults.innerHTML = `<p class="col-span-full text-center text-red-400 py-10">Erro ao buscar: ${err.message}</p>`;
  }
});

function renderSearchResults(videos) {
  searchResults.innerHTML = videos.map((vid) => `
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden flex flex-col hover:border-slate-700 transition group shadow-lg">
      <div class="relative aspect-video w-full overflow-hidden bg-slate-950">
        <img src="${vid.thumbnail}" alt="${vid.title}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
        <span class="absolute bottom-2 right-2 bg-black/80 px-2 py-0.5 rounded text-[11px] font-mono text-slate-200">
          ${formatTime(vid.duration)}
        </span>
      </div>
      <div class="p-4 flex-1 flex flex-col justify-between gap-3">
        <div>
          <h4 class="font-bold text-xs text-slate-100 line-clamp-2 leading-snug">${vid.title}</h4>
          <p class="text-[11px] text-slate-400 mt-1 truncate">${vid.artist}</p>
        </div>

        <div class="flex flex-col gap-2 pt-1">
          <!-- Botão Preview 5s -->
          <button
            onclick="playAudioPreview('${vid.video_id}', this)"
            class="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs py-1.5 rounded-xl border border-slate-700 transition flex items-center justify-center gap-1.5 active:scale-95"
          >
            <span>▶ 5s Preview</span>
          </button>

          <!-- Botão Adicionar à Fila -->
          <button
            onclick='addSongToMainQueue(${JSON.stringify(vid).replace(/'/g, "&apos;")})'
            class="w-full bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold text-xs py-2 rounded-xl transition flex items-center justify-center gap-1.5 shadow-md shadow-sky-500/20 active:scale-95"
          >
            <span>➕ Adicionar à Fila</span>
          </button>
        </div>
      </div>
    </div>
  `).join("");
}

// ========================================================
// 9. ADIÇÃO À FILA E TELA DE PROCESSAMENTO (PASSO 2 -> PASSO 3)
// ========================================================
window.addSongToMainQueue = async function(vid) {
  stopAudioPreview();

  try {
    const res = await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_id: vid.video_id,
        title: vid.title,
        artist: vid.artist,
        thumbnail: vid.thumbnail,
        duration: vid.duration,
        requested_by: "Palco"
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.detail || "Erro ao adicionar música à fila.");
      return;
    }

    // Configura a tela de processamento para essa música
    const queueItem = data.item;
    activeProcessingId = queueItem.id;
    updateProcessingView(queueItem);
    showStep("processing");
  } catch (err) {
    alert("Falha de conexão: " + err.message);
  }
};

function updateProcessingView(item) {
  procThumb.src = item.thumbnail;
  procTitle.textContent = item.title;
  procArtist.textContent = item.artist;
  procSingerBadge.textContent = `Cantor(a): ${item.requested_by || "Palco"}`;
  procMsg.textContent = item.message;
  procPct.textContent = `${item.percent}%`;
  procBarFill.style.width = `${item.percent}%`;

  if (item.status === "ready") {
    procSpinner.classList.add("hidden");
    btnProcPlayNow.classList.remove("hidden");
    btnProcPlayNow.onclick = () => playQueueSong(item.id);
  } else {
    procSpinner.classList.remove("hidden");
    btnProcPlayNow.classList.add("hidden");
  }
}

// ========================================================
// 10. CARREGAMENTO DO KARAOKÊ NO WEB AUDIO API (PASSO 4)
// ========================================================
async function loadKaraokeTrack(songData) {
  stopPlayback();
  currentSongData = songData;
  currentLyrics = songData.lyrics?.lines || [];
  lastActiveIdx = -1;

  currentTitle.textContent = songData.title;
  currentArtist.textContent = songData.artist || "Artista";
  currentSingerBadge.textContent = `🎤 Cantor(a): ${songData.requested_by || "Convidado"}`;
  karaokeBg.style.backgroundImage = `url('${songData.thumbnail}')`;

  btnHeaderStage.classList.remove("hidden");
  renderSpotifyLyrics(currentLyrics);

  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  // Garante que o microfone com retorno ao vivo esteja conectado ao mesmo AudioContext
  if (isMicActive && micStream && !micSource) {
    setupMicAudioNodes(ctx);
  }

  gainNodes.instrumental = ctx.createGain();
  gainNodes.lead = ctx.createGain();

  gainNodes.instrumental.gain.value = sliderInst ? (sliderInst.value / 100) : 1;
  gainNodes.lead.gain.value = sliderLead ? (sliderLead.value / 100) : 0.2;

  gainNodes.instrumental.connect(ctx.destination);
  gainNodes.lead.connect(ctx.destination);

  try {
    const [bufInst, bufLead] = await Promise.all([
      fetchAudioBuffer(songData.stems.instrumental),
      fetchAudioBuffer(songData.stems.lead_vocal),
    ]);

    audioBuffers.instrumental = bufInst;
    audioBuffers.lead = bufLead;

    totalDuration = bufInst.duration;
    timeTotal.textContent = formatTime(totalDuration);
    seekBar.max = Math.floor(totalDuration);
    pauseOffset = 0;

    startPlayback();
  } catch (err) {
    alert("Falha ao carregar buffers de áudio: " + err.message);
  }
}

async function fetchAudioBuffer(url) {
  const resp = await fetch(url);
  const arrayBuffer = await resp.arrayBuffer();
  return await audioCtx.decodeAudioData(arrayBuffer);
}

// ========================================================
// 11. CONTROLE DE REPRODUÇÃO E SINCRONIA DAS LETRAS
// ========================================================
function startPlayback() {
  if (!audioBuffers.instrumental) return;

  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  bufferSources.instrumental = audioCtx.createBufferSource();
  bufferSources.instrumental.buffer = audioBuffers.instrumental;
  bufferSources.instrumental.connect(gainNodes.instrumental);

  bufferSources.lead = audioCtx.createBufferSource();
  bufferSources.lead.buffer = audioBuffers.lead;
  bufferSources.lead.connect(gainNodes.lead);

  startTime = audioCtx.currentTime - pauseOffset;

  bufferSources.instrumental.start(0, pauseOffset);
  bufferSources.lead.start(0, pauseOffset);

  isPlaying = true;
  btnPlayPause.textContent = "⏸";

  requestAnimationFrame(updatePlaybackProgress);
}

function pausePlayback() {
  if (!isPlaying) return;
  pauseOffset = audioCtx.currentTime - startTime;

  try { bufferSources.instrumental?.stop(); } catch(e){}
  try { bufferSources.lead?.stop(); } catch(e){}

  isPlaying = false;
  btnPlayPause.textContent = "▶";
}

function stopPlayback() {
  if (isPlaying) {
    try { bufferSources.instrumental?.stop(); } catch(e){}
    try { bufferSources.lead?.stop(); } catch(e){}
  }
  isPlaying = false;
  pauseOffset = 0;
  btnPlayPause.textContent = "▶";
  if (introCountdown) introCountdown.classList.add("hidden");
}

window.seekTo = function(targetSeconds) {
  if (!audioBuffers.instrumental) return;
  const clamped = Math.max(0, Math.min(totalDuration, targetSeconds));
  pauseOffset = clamped;
  timeCurrent.textContent = formatTime(clamped);
  seekBar.value = Math.floor(clamped);

  if (isPlaying) {
    try { bufferSources.instrumental?.stop(); } catch(e){}
    try { bufferSources.lead?.stop(); } catch(e){}

    bufferSources.instrumental = audioCtx.createBufferSource();
    bufferSources.instrumental.buffer = audioBuffers.instrumental;
    bufferSources.instrumental.connect(gainNodes.instrumental);

    bufferSources.lead = audioCtx.createBufferSource();
    bufferSources.lead.buffer = audioBuffers.lead;
    bufferSources.lead.connect(gainNodes.lead);

    startTime = audioCtx.currentTime - pauseOffset;

    bufferSources.instrumental.start(0, pauseOffset);
    bufferSources.lead.start(0, pauseOffset);
  }

  updateLyrics(clamped);
};

function updatePlaybackProgress() {
  if (!isPlaying) return;

  const current = audioCtx.currentTime - startTime;
  if (current >= totalDuration) {
    stopPlayback();
    showScoreModal();
    return;
  }

  seekBar.value = Math.floor(current);
  timeCurrent.textContent = formatTime(current);

  updateLyrics(current);
  requestAnimationFrame(updatePlaybackProgress);
}

let lastActiveIdx = -1;

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderSpotifyLyrics(lines) {
  if (!lyricsScrollBox) return;
  if (!lines || lines.length === 0) {
    lyricsScrollBox.innerHTML = `
      <div class="py-12 flex flex-col items-center gap-2 text-slate-400">
        <p class="text-lg sm:text-2xl font-bold">Sem letras sincronizadas disponíveis</p>
        <p class="text-xs text-slate-500">Clique em "📝 Ajustar Letra" para buscar ou gerar com IA.</p>
      </div>
    `;
    return;
  }

  lyricsScrollBox.innerHTML = lines.map((line, idx) => `
    <p
      id="lyric-line-${idx}"
      onclick="seekTo(${line.time})"
      class="lyric-row text-slate-400 text-lg sm:text-2xl md:text-3xl font-semibold cursor-pointer transition-all duration-300 hover:text-sky-300 px-4 py-2 rounded-2xl"
      data-time="${line.time}"
      title="Clique para ir para este trecho"
    >
      ${escapeHtml(line.text)}
    </p>
  `).join("");
}

function updateLyrics(currentTime) {
  if (!currentLyrics || currentLyrics.length === 0) {
    if (introCountdown) introCountdown.classList.add("hidden");
    return;
  }

  // Contador regressivo de introdução antes do primeiro verso
  const firstLine = currentLyrics[0];
  if (firstLine && firstLine.time > 2.5 && currentTime < firstLine.time) {
    const diff = Math.ceil(firstLine.time - currentTime);
    if (diff <= 5 && diff >= 1) {
      if (introCountdown) {
        introCountdown.classList.remove("hidden");
        if (introCountdownSeconds) introCountdownSeconds.textContent = diff;
      }
    } else {
      if (introCountdown) introCountdown.classList.add("hidden");
    }
  } else {
    if (introCountdown) introCountdown.classList.add("hidden");
  }

  let activeIdx = -1;
  for (let i = 0; i < currentLyrics.length; i++) {
    if (currentTime >= currentLyrics[i].time) {
      activeIdx = i;
    } else {
      break;
    }
  }

  if (activeIdx === lastActiveIdx) return;
  lastActiveIdx = activeIdx;

  for (let i = 0; i < currentLyrics.length; i++) {
    const el = document.getElementById(`lyric-line-${i}`);
    if (!el) continue;

    if (i === activeIdx) {
      el.className = "lyric-row text-amber-300 text-2xl sm:text-4xl md:text-5xl font-black scale-105 drop-shadow-lg cursor-pointer transition-all duration-300 px-4 py-2 rounded-2xl";
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (i < activeIdx) {
      el.className = "lyric-row text-slate-500 text-base sm:text-xl font-medium opacity-50 cursor-pointer transition-all duration-300 hover:text-slate-300 px-4 py-1.5 rounded-2xl";
    } else {
      el.className = "lyric-row text-slate-300 text-lg sm:text-2xl font-semibold opacity-90 cursor-pointer transition-all duration-300 hover:text-sky-300 px-4 py-1.5 rounded-2xl";
    }
  }
}

// Pular Música (Skip)
btnSkipSong.addEventListener("click", async () => {
  stopPlayback();
  try {
    const res = await fetch("/api/queue/skip", { method: "POST" });
    const data = await res.json();
    if (data.next_item) {
      activePlayingId = data.next_item.id;
      loadKaraokeTrack(data.next_item);
    } else {
      activePlayingId = null;
      currentSongData = null;
      btnHeaderStage.classList.add("hidden");
      showStep("search");
    }
  } catch (err) {
    console.error("Erro ao pular:", err);
  }
});

// ========================================================
// 12. AJUSTAR LETRA (LRCLIB & WHISPER)
// ========================================================
btnAdjustLyrics.addEventListener("click", () => {
  if (!currentSongData) return;
  modalAdjustLyrics.classList.remove("hidden");
  inputLyricsQuery.value = `${currentSongData.artist} ${currentSongData.title}`.replace(/YouTube|Desconhecido/g, "").trim();
  searchLyricsOptions();
});

btnCloseAdjustModal.addEventListener("click", () => {
  modalAdjustLyrics.classList.add("hidden");
});

btnSearchLrclib.addEventListener("click", () => {
  searchLyricsOptions();
});

async function searchLyricsOptions() {
  const query = inputLyricsQuery.value.trim();
  if (!query) return;

  lyricsOptionsList.innerHTML = `
    <div class="py-6 text-center text-slate-400 flex flex-col items-center gap-2">
      <div class="w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full animate-spin"></div>
      <p class="text-xs">Buscando versões sincronizadas...</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/lyrics/options?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!data.options || data.options.length === 0) {
      lyricsOptionsList.innerHTML = `<p class="text-center text-slate-400 py-4 text-xs">Nenhuma letra sincronizada encontrada no LRCLIB. Experimente usar a IA Whisper abaixo.</p>`;
      return;
    }

    lyricsOptionsList.innerHTML = data.options.map((opt) => `
      <div class="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 hover:border-sky-500/50 transition">
        <div class="flex items-center justify-between">
          <div>
            <h4 class="text-xs font-bold text-white">${opt.track_name}</h4>
            <p class="text-[11px] text-slate-400">${opt.artist_name} • ${opt.album_name || "Single"}</p>
          </div>
          <button
            onclick='selectLyricsOption(${JSON.stringify(opt).replace(/'/g, "&apos;")})'
            class="bg-sky-500 hover:bg-sky-400 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition"
          >
            Usar Esta
          </button>
        </div>
        <p class="text-[10px] text-slate-500 italic truncate">${opt.preview}</p>
      </div>
    `).join("");
  } catch (err) {
    lyricsOptionsList.innerHTML = `<p class="text-center text-red-400 py-4 text-xs">Erro na busca: ${err.message}</p>`;
  }
}

window.selectLyricsOption = async function(opt) {
  if (!currentSongData) return;
  const newLyrics = { source: "lrclib_custom", synced: true, lines: opt.lines };
  try {
    await fetch("/api/lyrics/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queue_id: currentSongData.id,
        lyrics_data: newLyrics
      })
    });

    currentLyrics = opt.lines;
    currentSongData.lyrics = newLyrics;
    lastActiveIdx = -1;
    renderSpotifyLyrics(currentLyrics);
    const current = isPlaying ? (audioCtx.currentTime - startTime) : pauseOffset;
    updateLyrics(current);

    modalAdjustLyrics.classList.add("hidden");
    alert("Letra sincronizada atualizada com sucesso!");
  } catch (err) {
    alert("Erro ao aplicar letra: " + err.message);
  }
};

btnWhisperGenerate.addEventListener("click", async () => {
  if (!currentSongData) return;
  btnWhisperGenerate.disabled = true;
  btnWhisperGenerate.innerHTML = `<span>⏳ Transcrevendo voz com Whisper IA (aguarde alguns segundos)...</span>`;

  try {
    const res = await fetch(`/api/lyrics/whisper/${currentSongData.id}`, { method: "POST" });
    const data = await res.json();
    if (data.success && data.lyrics) {
      currentLyrics = data.lyrics.lines;
      currentSongData.lyrics = data.lyrics;
      lastActiveIdx = -1;
      renderSpotifyLyrics(currentLyrics);
      const current = isPlaying ? (audioCtx.currentTime - startTime) : pauseOffset;
      updateLyrics(current);

      modalAdjustLyrics.classList.add("hidden");
      alert("Letra gerada por IA (Whisper) com marcas de tempo aplicada!");
    } else {
      alert("Não foi possível gerar letra por IA: " + (data.detail || "Verifique o log."));
    }
  } catch (err) {
    alert("Erro ao executar Whisper: " + err.message);
  } finally {
    btnWhisperGenerate.disabled = false;
    btnWhisperGenerate.innerHTML = `<span>🤖 Gerar Letra com IA Local (Whisper)</span>`;
  }
});

// ========================================================
// 13. MESA DE SOM & MODAL DE MIXER
// ========================================================
btnOpenMixer.addEventListener("click", () => modalMixer.classList.remove("hidden"));
btnCloseMixer.addEventListener("click", () => modalMixer.classList.add("hidden"));
btnSaveMixer.addEventListener("click", () => modalMixer.classList.add("hidden"));

// ========================================================
// 14. QR CODE & HALL DA FAMA
// ========================================================
btnMinimizeQr.addEventListener("click", () => {
  qrCard.classList.add("hidden");
  qrPillBtn.classList.remove("hidden");
});

qrPillBtn.addEventListener("click", () => {
  qrCard.classList.remove("hidden");
  qrPillBtn.classList.add("hidden");
});

btnToggleQrWidget.addEventListener("click", () => {
  if (qrCard.classList.contains("hidden")) {
    qrCard.classList.remove("hidden");
    qrPillBtn.classList.add("hidden");
  } else {
    qrCard.classList.add("hidden");
    qrPillBtn.classList.remove("hidden");
  }
});

btnOpenHall.addEventListener("click", async () => {
  modalHallList.classList.remove("hidden");
  try {
    const res = await fetch("/api/hall-of-fame");
    const data = await res.json();
    if (data.hall_of_fame.length === 0) {
      hallListContainer.innerHTML = `<p class="text-xs text-slate-400 text-center py-6">Nenhum cantor pontuou ainda nesta sessão.</p>`;
      return;
    }
    hallListContainer.innerHTML = data.hall_of_fame.map((entry, idx) => `
      <div class="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
        <div class="flex items-center gap-3">
          <span class="font-mono text-xs font-bold ${idx === 0 ? 'text-amber-400' : 'text-slate-400'}">#${idx + 1}</span>
          <div>
            <h4 class="text-xs font-bold text-white">${entry.singer}</h4>
            <p class="text-[10px] text-slate-400">${entry.song_title}</p>
          </div>
        </div>
        <span class="text-sm font-black text-amber-400 font-brand">${entry.score} pts</span>
      </div>
    `).join("");
  } catch (e) {
    hallListContainer.innerHTML = `<p class="text-xs text-red-400 text-center py-6">Erro ao carregar Hall da Fama.</p>`;
  }
});

btnCloseHallModal.addEventListener("click", () => {
  modalHallList.classList.add("hidden");
});

// ========================================================
// 15. MICROFONE, RETORNO AO VIVO E AVALIAÇÃO
// ========================================================
function setupMicAudioNodes(ctx) {
  if (!micStream) return;
  try {
    if (micSource) {
      try { micSource.disconnect(); } catch (e) {}
    }
    micSource = ctx.createMediaStreamSource(micStream);

    micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 512;
    micSource.connect(micAnalyser);

    if (!micGainNode) {
      micGainNode = ctx.createGain();
    }
    const currentVol = sliderMic ? parseFloat(sliderMic.value) : 80;
    micGainNode.gain.value = currentVol / 100;

    micSource.connect(micGainNode);
    micGainNode.connect(ctx.destination);
  } catch (err) {
    console.warn("Erro ao configurar nós de áudio do microfone:", err);
  }
}

async function initMicrophone() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        latency: 0
      }
    });

    isMicActive = true;
    micBtnText.textContent = "Mic Ativo";
    micStatusDot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse";

    setupMicAudioNodes(ctx);
    startMicSampling();
  } catch (e) {
    console.warn("Permissão de microfone pendente ou bloqueada:", e);
    isMicActive = false;
    micBtnText.textContent = "Ativar Mic";
    micStatusDot.className = "w-2.5 h-2.5 rounded-full bg-slate-500";
  }
}

function startMicSampling() {
  if (micInterval) clearInterval(micInterval);
  const dataArray = new Uint8Array(256);

  micInterval = setInterval(() => {
    if (!isPlaying || !micAnalyser) return;
    micAnalyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const avgEnergy = sum / dataArray.length;
    if (avgEnergy > 18) singingSamples.push(avgEnergy);
  }, 100);
}

function calculateScore() {
  const sampleCount = singingSamples.length;
  let baseScore = 80;
  if (sampleCount > 50) baseScore += 10;
  else if (sampleCount > 20) baseScore += 5;

  const pseudoRandom = (Date.now() % 9);
  let finalScore = baseScore + pseudoRandom;
  return Math.max(75, Math.min(100, finalScore));
}

function showScoreModal() {
  const score = calculateScore();
  finalScoreNumber.textContent = score;

  if (score >= 95) scorePraise.textContent = "Voz de Ouro! Estrela da Noite! 🌟";
  else if (score >= 90) scorePraise.textContent = "Show Inesquecível! Afinação de Respeito! 🔥";
  else if (score >= 82) scorePraise.textContent = "Mandou Muito Bem! A Galera Foi ao Delírio! 🎉";
  else scorePraise.textContent = "Boa Apresentação! Valeu a Animação! 👏";

  if (window.confetti) {
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  }

  inputSingerName.value = currentSongData?.requested_by || "";
  modalScore.classList.remove("hidden");
  singingSamples = [];
}

formHall.addEventListener("submit", async (e) => {
  e.preventDefault();
  const singer = inputSingerName.value.trim() || "Cantor";
  const score = parseInt(finalScoreNumber.textContent, 10);
  const songTitle = currentSongData ? `${currentSongData.artist} - ${currentSongData.title}` : "Música";

  await fetch("/api/hall-of-fame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ singer, score, song_title: songTitle })
  });

  modalScore.classList.add("hidden");
  btnSkipSong.click();
});

btnCloseScore.addEventListener("click", () => {
  modalScore.classList.add("hidden");
  btnSkipSong.click();
});

// ========================================================
// 16. EVENT LISTENERS GERAIS
// ========================================================
function setupEventListeners() {
  btnPlayPause.addEventListener("click", () => {
    if (isPlaying) pausePlayback();
    else startPlayback();
  });

  seekBar.addEventListener("input", (e) => {
    const targetTime = parseFloat(e.target.value);
    seekTo(targetTime);
  });

  if (btnToggleFullscreen) {
    btnToggleFullscreen.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(err => {
          console.warn("Tela cheia indisponível:", err);
        });
      } else {
        document.exitFullscreen?.().catch(err => {
          console.warn("Erro ao sair de tela cheia:", err);
        });
      }
    });
  }

  sliderInst.addEventListener("input", (e) => {
    const val = e.target.value;
    volTextInst.textContent = `${val}%`;
    if (gainNodes.instrumental) gainNodes.instrumental.gain.value = val / 100;
  });

  sliderLead.addEventListener("input", (e) => {
    const val = e.target.value;
    volTextLead.textContent = `${val}%`;
    if (gainNodes.lead) gainNodes.lead.gain.value = val / 100;
  });

  if (sliderMic) {
    sliderMic.addEventListener("input", (e) => {
      const val = e.target.value;
      if (volTextMic) volTextMic.textContent = `${val}%`;
      if (micGainNode) micGainNode.gain.value = val / 100;
    });
  }

  sliderOpacity.addEventListener("input", (e) => {
    const val = e.target.value;
    textOpacity.textContent = `${val}%`;
    karaokeOverlay.style.backgroundColor = `rgba(2, 6, 23, ${val / 100})`;
  });

  btnFinishSong.addEventListener("click", () => {
    stopPlayback();
    showScoreModal();
  });

  btnToggleMic.addEventListener("click", async () => {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (isMicActive) {
      if (micStream) micStream.getTracks().forEach(t => t.stop());
      if (micSource) {
        try { micSource.disconnect(); } catch (e) {}
        micSource = null;
      }
      isMicActive = false;
      micBtnText.textContent = "Ativar Mic";
      micStatusDot.className = "w-2.5 h-2.5 rounded-full bg-slate-500";
    } else {
      await initMicrophone();
    }
  });

  document.addEventListener("click", () => {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  }, { once: true });
}

function formatTime(seconds) {
  if (isNaN(seconds)) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

window.addEventListener("DOMContentLoaded", init);
