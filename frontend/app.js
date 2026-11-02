// OpenKaraoke - Web Audio Engine & Party Queue Controller

let audioCtx = null;
let currentSongData = null;
let currentLyrics = [];
let isPlaying = false;
let startTime = 0;
let pauseOffset = 0;
let totalDuration = 0;

// Web Audio nós
let bufferSources = { instrumental: null, backing: null, lead: null };
let audioBuffers = { instrumental: null, backing: null, lead: null };
let gainNodes = { instrumental: null, backing: null, lead: null };

// Motor de Microfone e Retorno ao Vivo
let micStream = null;
let micSource = null;
let micGainNode = null;
let micAnalyser = null;
let micInterval = null;
let singingSamples = [];
let isMicActive = false;

// Função utilitária para obter/iniciar o AudioContext global
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// Estado da Fila
let currentQueue = [];
let activePlayingId = null;

// Elementos da UI
const hwDesc = document.getElementById("hw-desc");
const formSearch = document.getElementById("form-search");
const inputSearch = document.getElementById("input-search");
const searchResults = document.getElementById("search-results");

const sectionKaraoke = document.getElementById("section-karaoke");
const karaokeBg = document.getElementById("karaoke-bg");
const karaokeOverlay = document.getElementById("karaoke-overlay");
const currentTitle = document.getElementById("current-title");
const currentArtist = document.getElementById("current-artist");
const currentSingerBadge = document.getElementById("current-singer-badge");

const lyricPrev = document.getElementById("lyric-prev");
const lyricCurrent = document.getElementById("lyric-current");
const lyricNext = document.getElementById("lyric-next");

const seekBar = document.getElementById("seek-bar");
const timeCurrent = document.getElementById("time-current");
const timeTotal = document.getElementById("time-total");
const btnPlayPause = document.getElementById("btn-play-pause");
const btnSkipSong = document.getElementById("btn-skip-song");
const btnAdjustLyrics = document.getElementById("btn-adjust-lyrics");

const sliderInst = document.getElementById("slider-inst");
const sliderBacking = document.getElementById("slider-backing");
const sliderLead = document.getElementById("slider-lead");
const sliderMic = document.getElementById("slider-mic");
const sliderOpacity = document.getElementById("slider-opacity");

const volTextInst = document.getElementById("vol-text-inst");
const volTextBacking = document.getElementById("vol-text-backing");
const volTextLead = document.getElementById("vol-text-lead");
const volTextMic = document.getElementById("vol-text-mic");
const textOpacity = document.getElementById("text-opacity");

const btnToggleMic = document.getElementById("btn-toggle-mic");
const micStatusDot = document.getElementById("mic-status-dot");
const micBtnText = document.getElementById("mic-btn-text");
const btnFinishSong = document.getElementById("btn-finish-song");

// Modais
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

// Fila da Festa
const mainQueueList = document.getElementById("main-queue-list");
const queueBadgeMain = document.getElementById("queue-badge-main");
const headerQueueCount = document.getElementById("header-queue-count");
const btnToggleQueueView = document.getElementById("btn-toggle-queue-view");
const sectionQueueContainer = document.getElementById("section-queue-container");

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

// 1. Inicialização
async function init() {
  setupEventListeners();
  checkHardware();
  initMicrophone();
  initPartyQrCode();
  connectQueueEvents();
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

// 2. Inicialização do QR Code para Conexão dos Celulares
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

// 3. Controle da Fila & Eventos SSE em Tempo Real
function connectQueueEvents() {
  const evtSource = new EventSource("/api/queue/events");
  evtSource.onmessage = (event) => {
    try {
      const queue = JSON.parse(event.data);
      currentQueue = queue;
      renderQueueUI(queue);

      // Se não há nenhuma música tocando no momento e a primeira estiver pronta, inicia automaticamente!
      if (!isPlaying && !activePlayingId) {
        const readySong = queue.find(item => item.status === "ready");
        if (readySong) {
          playQueueSong(readySong.id);
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

function renderQueueUI(queue) {
  const count = queue.length;
  headerQueueCount.textContent = `${count}/20`;
  queueBadgeMain.textContent = `${count} / 20`;

  if (count === 0) {
    mainQueueList.innerHTML = `
      <p class="col-span-full text-center text-slate-400 py-6 text-sm">
        Nenhuma música na fila. Adicione abaixo ou convide amigos para pedir pelo celular via QR Code!
      </p>
    `;
    return;
  }

  mainQueueList.innerHTML = queue.map((item, idx) => {
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
      <div class="border ${statusClass} rounded-xl p-3 flex items-center gap-3 shadow-md hover:border-slate-700 transition">
        <span class="text-sm font-mono font-bold ${item.status === 'playing' ? 'text-emerald-400' : 'text-slate-500'}">#${idx + 1}</span>
        <img src="${item.thumbnail}" class="w-14 h-11 object-cover rounded-lg bg-slate-900 flex-shrink-0">
        <div class="flex-1 min-w-0">
          <h4 class="text-xs font-bold text-slate-100 truncate">${item.title}</h4>
          <p class="text-[11px] text-slate-400 truncate">
            Cantor(a): <span class="text-sky-300 font-semibold">${item.requested_by}</span>
          </p>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          ${actionBtn}
          ${item.status !== 'playing' ? `
            <button onclick="removeQueueSong('${item.id}')" class="text-slate-500 hover:text-red-400 text-xs p-1" title="Remover da fila">
              ✕
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");
}

// 4. Execução de Música da Fila
window.playQueueSong = async function(itemId) {
  try {
    const res = await fetch(`/api/queue/${itemId}/play`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json();
      alert(err.detail || "Não foi possível reproduzir.");
      return;
    }
    const data = await res.json();
    activePlayingId = itemId;
    loadKaraokeTrack(data.item);
  } catch (err) {
    alert("Erro ao tocar música: " + err.message);
  }
};

window.removeQueueSong = async function(itemId) {
  try {
    await fetch(`/api/queue/${itemId}`, { method: "DELETE" });
  } catch (err) {
    alert("Erro ao remover: " + err.message);
  }
};

// 5. Pular Música (Skip)
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
      sectionKaraoke.classList.add("hidden");
    }
  } catch (err) {
    console.error("Erro ao pular:", err);
  }
});

// 6. Busca no YouTube e Adição à Fila
formSearch.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = inputSearch.value.trim();
  if (!query) return;

  searchResults.innerHTML = `
    <div class="col-span-full py-8 text-center text-slate-400 flex flex-col items-center gap-2">
      <div class="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin"></div>
      <p class="text-sm">Buscando músicas no YouTube...</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      searchResults.innerHTML = `<p class="col-span-full text-center text-slate-400 py-6">Nenhum resultado encontrado.</p>`;
      return;
    }

    renderSearchResults(data.results);
  } catch (err) {
    searchResults.innerHTML = `<p class="col-span-full text-center text-red-400 py-6">Erro ao buscar: ${err.message}</p>`;
  }
});

function renderSearchResults(videos) {
  searchResults.innerHTML = videos.map((vid) => `
    <div class="bg-slate-950/70 border border-slate-800 rounded-2xl overflow-hidden flex flex-col hover:border-slate-700 transition group shadow-md">
      <div class="relative aspect-video w-full overflow-hidden bg-slate-900">
        <img src="${vid.thumbnail}" alt="${vid.title}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
        <span class="absolute bottom-2 right-2 bg-black/80 px-2 py-0.5 rounded text-[11px] font-mono text-slate-200">
          ${formatTime(vid.duration)}
        </span>
      </div>
      <div class="p-3.5 flex-1 flex flex-col justify-between gap-3">
        <div>
          <h4 class="font-bold text-xs text-slate-100 line-clamp-2 leading-snug">${vid.title}</h4>
          <p class="text-[11px] text-slate-400 mt-1 truncate">${vid.artist}</p>
        </div>
        <button
          onclick='addSongToMainQueue(${JSON.stringify(vid).replace(/'/g, "&apos;")})'
          class="w-full bg-sky-500/20 hover:bg-sky-500 text-sky-400 hover:text-white font-semibold text-xs py-2 rounded-xl border border-sky-500/30 hover:border-transparent transition flex items-center justify-center gap-1.5 active:scale-95"
        >
          <span>➕ Adicionar à Fila</span>
        </button>
      </div>
    </div>
  `).join("");
}

window.addSongToMainQueue = async function(vid) {
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

    if (!res.ok) {
      const err = await res.json();
      alert(err.detail || "Erro ao adicionar à fila.");
      return;
    }

    inputSearch.value = "";
    searchResults.innerHTML = "";
    sectionQueueContainer.scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    alert("Falha de rede: " + err.message);
  }
};

// 7. Carregamento do Karaokê no Web Audio API
async function loadKaraokeTrack(songData) {
  stopPlayback();
  currentSongData = songData;
  currentLyrics = songData.lyrics?.lines || [];

  currentTitle.textContent = songData.title;
  currentArtist.textContent = songData.artist || "Artista";
  currentSingerBadge.textContent = `🎤 Cantor(a): ${songData.requested_by || "Convidado"}`;
  karaokeBg.style.backgroundImage = `url('${songData.thumbnail}')`;

  sectionKaraoke.classList.remove("hidden");
  sectionKaraoke.scrollIntoView({ behavior: "smooth" });

  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  // Garante que o microfone com retorno ao vivo esteja conectado ao mesmo AudioContext
  if (isMicActive && micStream && !micSource) {
    setupMicAudioNodes(ctx);
  }

  gainNodes.instrumental = ctx.createGain();
  gainNodes.backing = ctx.createGain();
  gainNodes.lead = ctx.createGain();

  gainNodes.instrumental.gain.value = sliderInst.value / 100;
  gainNodes.backing.gain.value = sliderBacking.value / 100;
  gainNodes.lead.gain.value = sliderLead.value / 100;

  gainNodes.instrumental.connect(ctx.destination);
  gainNodes.backing.connect(ctx.destination);
  gainNodes.lead.connect(ctx.destination);

  try {
    const [bufInst, bufBacking, bufLead] = await Promise.all([
      fetchAudioBuffer(songData.stems.instrumental),
      fetchAudioBuffer(songData.stems.backing),
      fetchAudioBuffer(songData.stems.lead_vocal),
    ]);

    audioBuffers.instrumental = bufInst;
    audioBuffers.backing = bufBacking;
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

// 8. Controle de Reprodução Sincronizada
function startPlayback() {
  if (!audioBuffers.instrumental) return;

  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  bufferSources.instrumental = audioCtx.createBufferSource();
  bufferSources.instrumental.buffer = audioBuffers.instrumental;
  bufferSources.instrumental.connect(gainNodes.instrumental);

  bufferSources.backing = audioCtx.createBufferSource();
  bufferSources.backing.buffer = audioBuffers.backing;
  bufferSources.backing.connect(gainNodes.backing);

  bufferSources.lead = audioCtx.createBufferSource();
  bufferSources.lead.buffer = audioBuffers.lead;
  bufferSources.lead.connect(gainNodes.lead);

  startTime = audioCtx.currentTime - pauseOffset;

  bufferSources.instrumental.start(0, pauseOffset);
  bufferSources.backing.start(0, pauseOffset);
  bufferSources.lead.start(0, pauseOffset);

  isPlaying = true;
  btnPlayPause.textContent = "⏸";

  requestAnimationFrame(updatePlaybackProgress);
}

function pausePlayback() {
  if (!isPlaying) return;
  pauseOffset = audioCtx.currentTime - startTime;

  try { bufferSources.instrumental.stop(); } catch(e){}
  try { bufferSources.backing.stop(); } catch(e){}
  try { bufferSources.lead.stop(); } catch(e){}

  isPlaying = false;
  btnPlayPause.textContent = "▶";
}

function stopPlayback() {
  if (isPlaying) {
    try { bufferSources.instrumental.stop(); } catch(e){}
    try { bufferSources.backing.stop(); } catch(e){}
    try { bufferSources.lead.stop(); } catch(e){}
  }
  isPlaying = false;
  pauseOffset = 0;
  btnPlayPause.textContent = "▶";
}

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

// 9. Atualização das Letras em Tempo Real
function updateLyrics(currentTime) {
  if (!currentLyrics || currentLyrics.length === 0) return;

  let activeIdx = -1;
  for (let i = 0; i < currentLyrics.length; i++) {
    if (currentTime >= currentLyrics[i].time) {
      activeIdx = i;
    } else {
      break;
    }
  }

  if (activeIdx >= 0) {
    lyricPrev.textContent = activeIdx > 0 ? currentLyrics[activeIdx - 1].text : "";
    lyricCurrent.textContent = currentLyrics[activeIdx].text;
    lyricNext.textContent = activeIdx < currentLyrics.length - 1 ? currentLyrics[activeIdx + 1].text : "";
  }
}

// 10. Recurso "Ajustar Letra"
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

// 11. Alternância de Visualização e Modais
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

btnToggleQueueView.addEventListener("click", () => {
  sectionQueueContainer.scrollIntoView({ behavior: "smooth" });
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

// 12. Microfone, Retorno ao Vivo e Avaliação
function setupMicAudioNodes(ctx) {
  if (!micStream) return;
  try {
    if (micSource) {
      try { micSource.disconnect(); } catch (e) {}
    }
    micSource = ctx.createMediaStreamSource(micStream);

    // Analyser para o medidor de afinação e pontuação
    micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 512;
    micSource.connect(micAnalyser);

    // Nó de ganho para o retorno do microfone (alto-falantes / fone de ouvido)
    if (!micGainNode) {
      micGainNode = ctx.createGain();
    }
    const currentVol = sliderMic ? parseFloat(sliderMic.value) : 80;
    micGainNode.gain.value = currentVol / 100;

    // Roteia a voz do cantor diretamente para os alto-falantes / saída principal
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

    // Solicita microfone com cancelamento de eco e supressão de ruído para evitar microfonia/feedback
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        latency: 0
      }
    });

    isMicActive = true;
    micBtnText.textContent = "Microfone Ativo";
    micStatusDot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse";

    setupMicAudioNodes(ctx);
    startMicSampling();
  } catch (e) {
    console.warn("Permissão de microfone pendente ou bloqueada:", e);
    isMicActive = false;
    micBtnText.textContent = "Ativar Microfone";
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
  // Avança automaticamente para a próxima música da fila pronta
  btnSkipSong.click();
});

btnCloseScore.addEventListener("click", () => {
  modalScore.classList.add("hidden");
  btnSkipSong.click();
});

// 13. Event Listeners Básicos
function setupEventListeners() {
  btnPlayPause.addEventListener("click", () => {
    if (isPlaying) pausePlayback();
    else startPlayback();
  });

  seekBar.addEventListener("input", (e) => {
    const targetTime = parseFloat(e.target.value);
    pauseOffset = targetTime;
    timeCurrent.textContent = formatTime(targetTime);
    if (isPlaying) {
      stopPlayback();
      startPlayback();
    }
  });

  sliderInst.addEventListener("input", (e) => {
    const val = e.target.value;
    volTextInst.textContent = `${val}%`;
    if (gainNodes.instrumental) gainNodes.instrumental.gain.value = val / 100;
  });

  sliderBacking.addEventListener("input", (e) => {
    const val = e.target.value;
    volTextBacking.textContent = `${val}%`;
    if (gainNodes.backing) gainNodes.backing.gain.value = val / 100;
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
      micBtnText.textContent = "Ativar Microfone";
      micStatusDot.className = "w-2.5 h-2.5 rounded-full bg-slate-500";
    } else {
      await initMicrophone();
    }
  });

  // Retoma o AudioContext no primeiro gesto do usuário caso suspenso pelo navegador
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
