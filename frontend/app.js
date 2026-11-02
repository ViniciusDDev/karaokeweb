// OpenKaraoke - Web Audio Engine & UI Controller

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

// Motor de Microfone e Pontuação
let micStream = null;
let micAnalyser = null;
let micInterval = null;
let singingSamples = [];
let isMicActive = false;

// Elementos da UI
const hwDesc = document.getElementById("hw-desc");
const formSearch = document.getElementById("form-search");
const inputSearch = document.getElementById("input-search");
const searchResults = document.getElementById("search-results");

const modalProgress = document.getElementById("modal-progress");
const progressBarFill = document.getElementById("progress-bar-fill");
const progressPercent = document.getElementById("progress-percent");
const progressMessage = document.getElementById("progress-message");

const sectionKaraoke = document.getElementById("section-karaoke");
const karaokeBg = document.getElementById("karaoke-bg");
const karaokeOverlay = document.getElementById("karaoke-overlay");
const currentTitle = document.getElementById("current-title");
const currentArtist = document.getElementById("current-artist");

const lyricPrev = document.getElementById("lyric-prev");
const lyricCurrent = document.getElementById("lyric-current");
const lyricNext = document.getElementById("lyric-next");

const seekBar = document.getElementById("seek-bar");
const timeCurrent = document.getElementById("time-current");
const timeTotal = document.getElementById("time-total");
const btnPlayPause = document.getElementById("btn-play-pause");

const sliderInst = document.getElementById("slider-inst");
const sliderBacking = document.getElementById("slider-backing");
const sliderLead = document.getElementById("slider-lead");
const sliderOpacity = document.getElementById("slider-opacity");

const volTextInst = document.getElementById("vol-text-inst");
const volTextBacking = document.getElementById("vol-text-backing");
const volTextLead = document.getElementById("vol-text-lead");
const textOpacity = document.getElementById("text-opacity");

const btnToggleMic = document.getElementById("btn-toggle-mic");
const micStatusDot = document.getElementById("mic-status-dot");
const micBtnText = document.getElementById("mic-btn-text");
const btnFinishSong = document.getElementById("btn-finish-song");

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

// 1. Inicialização
async function init() {
  setupEventListeners();
  checkHardware();
  initMicrophone();
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

// 2. Busca no YouTube
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
      <div class="p-4 flex-1 flex flex-col justify-between gap-3">
        <div>
          <h4 class="font-bold text-sm text-slate-100 line-clamp-2 leading-snug">${vid.title}</h4>
          <p class="text-xs text-slate-400 mt-1 truncate">${vid.artist}</p>
        </div>
        <button
          onclick='selectSong(${JSON.stringify(vid).replace(/'/g, "&apos;")})'
          class="w-full bg-sky-500/20 hover:bg-sky-500 text-sky-400 hover:text-white font-semibold text-xs py-2.5 rounded-xl border border-sky-500/30 hover:border-transparent transition flex items-center justify-center gap-1.5 active:scale-95"
        >
          <span>🎤 Cantar Esta</span>
        </button>
      </div>
    </div>
  `).join("");
}

// 3. Processamento de Áudio com SSE
window.selectSong = async function(vid) {
  modalProgress.classList.remove("hidden");
  progressBarFill.style.width = "5%";
  progressPercent.textContent = "5%";
  progressMessage.textContent = "Enviando solicitação...";

  try {
    const res = await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_id: vid.video_id,
        title: vid.title,
        artist: vid.artist,
        thumbnail: vid.thumbnail,
        duration: vid.duration
      })
    });

    const { job_id } = await res.json();
    listenProgress(job_id);
  } catch (err) {
    alert("Erro ao iniciar processamento: " + err.message);
    modalProgress.classList.add("hidden");
  }
};

function listenProgress(job_id) {
  const evtSource = new EventSource(`/api/progress/${job_id}`);

  evtSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    progressBarFill.style.width = `${data.percent}%`;
    progressPercent.textContent = `${data.percent}%`;
    progressMessage.textContent = data.message;

    if (data.status === "completed") {
      evtSource.close();
      setTimeout(() => {
        modalProgress.classList.add("hidden");
        loadKaraokeTrack(data.data);
      }, 600);
    } else if (data.status === "error") {
      evtSource.close();
      alert("Erro na separação da música: " + (data.error || "Tente outro vídeo."));
      modalProgress.classList.add("hidden");
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
  };
}

// 4. Carregamento do Karaokê no Web Audio API
async function loadKaraokeTrack(songData) {
  stopPlayback();
  currentSongData = songData;
  currentLyrics = songData.lyrics?.lines || [];

  currentTitle.textContent = songData.title;
  currentArtist.textContent = songData.artist || "Artista";
  karaokeBg.style.backgroundImage = `url('${songData.thumbnail}')`;

  sectionKaraoke.classList.remove("hidden");
  sectionKaraoke.scrollIntoView({ behavior: "smooth" });

  progressMessage.textContent = "Decodificando faixas de áudio sincronizadas...";
  modalProgress.classList.remove("hidden");

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } else if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }

  // Cria os nós de ganho
  gainNodes.instrumental = audioCtx.createGain();
  gainNodes.backing = audioCtx.createGain();
  gainNodes.lead = audioCtx.createGain();

  gainNodes.instrumental.gain.value = sliderInst.value / 100;
  gainNodes.backing.gain.value = sliderBacking.value / 100;
  gainNodes.lead.gain.value = sliderLead.value / 100;

  gainNodes.instrumental.connect(audioCtx.destination);
  gainNodes.backing.connect(audioCtx.destination);
  gainNodes.lead.connect(audioCtx.destination);

  // Carrega e decodifica as 3 faixas simultaneamente
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

    modalProgress.classList.add("hidden");
    startPlayback();
  } catch (err) {
    modalProgress.classList.add("hidden");
    alert("Falha ao carregar buffers de áudio: " + err.message);
  }
}

async function fetchAudioBuffer(url) {
  const resp = await fetch(url);
  const arrayBuffer = await resp.arrayBuffer();
  return await audioCtx.decodeAudioData(arrayBuffer);
}

// 5. Controle de Reprodução Sincronizada
function startPlayback() {
  if (!audioBuffers.instrumental) return;

  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  // Instancia novas fontes de áudio ligadas aos respectivos nós de ganho
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

// 6. Atualização de Letras em Tempo Real
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

// 7. Microfone e Avaliação Verossímil
async function initMicrophone() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    isMicActive = true;
    micBtnText.textContent = "Microfone Ligado";
    micStatusDot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse";

    const micCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = micCtx.createMediaStreamSource(micStream);
    micAnalyser = micCtx.createAnalyser();
    micAnalyser.fftSize = 512;
    source.connect(micAnalyser);

    startMicSampling();
  } catch (e) {
    isMicActive = false;
    micBtnText.textContent = "Mic Desligado";
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
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const avgEnergy = sum / dataArray.length;

    // Detecta se houve vocalização acima do ruído de fundo
    if (avgEnergy > 18) {
      singingSamples.push(avgEnergy);
    }
  }, 100);
}

function calculateFestiveScore() {
  // Se cantou com boa frequência, calcula o empenho
  const totalSeconds = totalDuration || 180;
  const singingSeconds = (singingSamples.length * 0.1);
  const singingRatio = Math.min(1.0, singingSeconds / (totalSeconds * 0.45)); // Espera-se cantar ~45% da música

  // Pontuação base verossímil
  const rawScore = Math.floor(singingRatio * 100);

  // Fórmula de calibração festiva garantida entre 75 e 100
  const festiveScore = Math.round(75 + 25 * Math.pow(Math.min(1, Math.max(0, rawScore / 100)), 0.6));
  
  // Limpeza para a próxima música
  singingSamples = [];

  return festiveScore;
}

function showScoreModal() {
  const score = calculateFestiveScore();
  finalScoreNumber.textContent = score;

  const praises = [
    "Afinadíssimo! Que apresentação!",
    "Show de Estádio! A plateia foi à loucura!",
    "Voz de Ouro! Parabéns pelo fôlego!",
    "Quase uma estrela pop internacional!",
    "Arrasou no palco! Energia pura!"
  ];
  scorePraise.textContent = praises[Math.floor(Math.random() * praises.length)];

  modalScore.classList.remove("hidden");

  // Chuva de confetes
  try {
    confetti({
      particleCount: 120,
      spread: 70,
      origin: { y: 0.6 }
    });
  } catch(e){}
}

// 8. Event Listeners
function setupEventListeners() {
  btnPlayPause.addEventListener("click", () => {
    if (isPlaying) {
      pausePlayback();
    } else {
      startPlayback();
    }
  });

  seekBar.addEventListener("input", (e) => {
    const target = parseFloat(e.target.value);
    pauseOffset = target;
    timeCurrent.textContent = formatTime(target);
    updateLyrics(target);

    if (isPlaying) {
      stopPlayback();
      startPlayback();
    }
  });

  // Mixer Sliders
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

  sliderOpacity.addEventListener("input", (e) => {
    const val = e.target.value;
    textOpacity.textContent = `${val}%`;
    karaokeOverlay.style.backgroundColor = `rgba(2, 6, 23, ${val / 100})`;
  });

  btnFinishSong.addEventListener("click", () => {
    pausePlayback();
    showScoreModal();
  });

  btnCloseScore.addEventListener("click", () => {
    modalScore.classList.add("hidden");
  });

  btnToggleMic.addEventListener("click", () => {
    initMicrophone();
  });

  // Salvar no Hall da Fama
  formHall.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = inputSingerName.value.trim() || "Cantor";
    const score = parseInt(finalScoreNumber.textContent, 10);
    const song = currentSongData?.title || "Música";

    try {
      await fetch("/api/hall-of-fame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          singer: name,
          score: score,
          song_title: song
        })
      });
      modalScore.classList.add("hidden");
      inputSingerName.value = "";
      openHallOfFame();
    } catch(err) {
      alert("Erro ao salvar no Hall da Fama: " + err.message);
    }
  });

  btnOpenHall.addEventListener("click", openHallOfFame);
  btnCloseHallModal.addEventListener("click", () => modalHallList.classList.add("hidden"));
}

async function openHallOfFame() {
  modalHallList.classList.remove("hidden");
  try {
    const res = await fetch("/api/hall-of-fame");
    const data = await res.json();
    const list = data.hall_of_fame || [];

    if (list.length === 0) {
      hallListContainer.innerHTML = `<p class="text-xs text-slate-400 text-center py-6">Nenhum cantor pontuou ainda nesta sessão.</p>`;
      return;
    }

    hallListContainer.innerHTML = list.map((item, idx) => `
      <div class="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800">
        <div class="flex items-center gap-3">
          <span class="w-6 h-6 rounded-full ${idx === 0 ? 'bg-amber-400 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'} text-xs flex items-center justify-center font-mono">
            ${idx + 1}
          </span>
          <div>
            <p class="font-bold text-sm text-slate-100">${item.singer}</p>
            <p class="text-[11px] text-slate-400 truncate max-w-[200px] sm:max-w-xs">${item.song_title}</p>
          </div>
        </div>
        <span class="text-sm font-extrabold text-amber-300 font-mono">${item.score} pts</span>
      </div>
    `).join("");
  } catch(e) {
    hallListContainer.innerHTML = `<p class="text-xs text-red-400 text-center py-4">Erro ao carregar Hall da Fama.</p>`;
  }
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// Inicializar quando o DOM estiver pronto
document.addEventListener("DOMContentLoaded", init);
