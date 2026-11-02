import os
import sys
import uuid
import time
import shutil
import asyncio
import logging
from typing import Dict, Any, List, Optional
from pydantic import BaseModel
import yt_dlp

from backend.audio_processor import ensure_ffmpeg, process_audio_stems
from backend.lyrics import fetch_lyrics_cascade

logger = logging.getLogger("openkaraoke.queue")

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEMP_DIR = os.path.join(BASE_DIR, "temp")
CACHE_DIR = os.path.join(BASE_DIR, "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

MAX_QUEUE_SIZE = 20

class QueueItem(BaseModel):
    id: str
    video_id: str
    title: str
    artist: str = ""
    thumbnail: str = ""
    duration: int = 0
    requested_by: str = "Palco"
    status: str = "pending"  # pending, processing, ready, playing, finished, error
    percent: int = 0
    message: str = "Aguardando na fila..."
    stems: Dict[str, str] = {}
    lyrics: Dict[str, Any] = {}
    created_at: float = 0.0
    error: Optional[str] = None

class QueueManager:
    def __init__(self):
        self.queue: List[QueueItem] = []
        self._worker_task: Optional[asyncio.Task] = None
        self._new_item_event = asyncio.Event()
        self._listeners: List[asyncio.Queue] = []
        self._running = True
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def start_worker(self):
        """Inicia a task assíncrona do worker de background."""
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._queue_worker_loop())
            logger.info("Worker da fila de processamento em background iniciado.")

    def stop_worker(self):
        """Para o worker da fila."""
        self._running = False
        self._new_item_event.set()
        if self._worker_task:
            self._worker_task.cancel()

    def trigger_broadcast(self):
        """Dispara a atualização SSE para todos os clientes de forma 100% segura em qualquer thread/contexto."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast_update())
        except RuntimeError:
            if self._loop and self._loop.is_running():
                asyncio.run_coroutine_threadsafe(self.broadcast_update(), self._loop)

    async def broadcast_update(self):
        """Notifica todos os clientes conectados (SSE) com o estado atual da fila."""
        payload = self.get_queue_payload()
        for q in list(self._listeners):
            try:
                await q.put(payload)
            except Exception:
                pass

    def get_queue_payload(self) -> List[Dict[str, Any]]:
        """Retorna a lista serializada dos itens ativos na fila ordenados por ordem estrita de chegada (FIFO)."""
        active = [item for item in self.queue if item.status != "finished"]
        active.sort(key=lambda x: x.created_at)
        return [item.model_dump() for item in active]

    def add_to_queue(
        self,
        video_id: str,
        title: str,
        artist: str = "",
        thumbnail: str = "",
        duration: int = 0,
        requested_by: str = "Convidado"
    ) -> QueueItem:
        """Adiciona uma música à fila se o limite de 20 não for excedido."""
        active_items = [i for i in self.queue if i.status in ["pending", "processing", "ready", "playing"]]
        if len(active_items) >= MAX_QUEUE_SIZE:
            raise ValueError(f"Fila cheia! O limite é de {MAX_QUEUE_SIZE} músicas. Aguarde uma música terminar.")

        item_id = str(uuid.uuid4())[:8]
        new_item = QueueItem(
            id=item_id,
            video_id=video_id,
            title=title,
            artist=artist or "YouTube",
            thumbnail=thumbnail,
            duration=duration,
            requested_by=requested_by.strip() or "Convidado",
            status="pending",
            percent=0,
            message="Na fila para processamento...",
            created_at=time.time()
        )
        self.queue.append(new_item)
        self._new_item_event.set()
        self.trigger_broadcast()
        logger.info(f"Música adicionada à fila: '{title}' por '{new_item.requested_by}' (ID: {item_id})")
        return new_item

    def get_item(self, item_id: str) -> Optional[QueueItem]:
        for item in self.queue:
            if item.id == item_id:
                return item
        return None

    def remove_item(self, item_id: str) -> bool:
        for idx, item in enumerate(self.queue):
            if item.id == item_id:
                if item.status == "processing":
                    # Não remove item enquanto estiver em processamento ativo
                    return False
                self.queue.pop(idx)
                self.trigger_broadcast()
                return True
        return False

    def mark_playing(self, item_id: str) -> Optional[QueueItem]:
        target = None
        for item in self.queue:
            if item.id == item_id:
                target = item
                item.status = "playing"
            elif item.status == "playing":
                item.status = "finished"

        if target:
            self.trigger_broadcast()
        return target

    def skip_current(self) -> Optional[QueueItem]:
        """Finaliza a música atual e passa automaticamente para a próxima que estiver pronta."""
        for item in self.queue:
            if item.status == "playing":
                item.status = "finished"
                break

        # Encontra a primeira que está pronta
        for item in self.queue:
            if item.status == "ready":
                item.status = "playing"
                self.trigger_broadcast()
                return item

        self.trigger_broadcast()
        return None

    def update_lyrics(self, item_id: str, new_lyrics: Dict[str, Any]) -> bool:
        item = self.get_item(item_id)
        if item:
            item.lyrics = new_lyrics
            self.trigger_broadcast()
            return True
        return False

    async def _queue_worker_loop(self):
        """Loop contínuo que processa um item de cada vez em background."""
        while self._running:
            # Procura o próximo item pendente
            item_to_process = None
            for item in self.queue:
                if item.status == "pending":
                    item_to_process = item
                    break

            if item_to_process is None:
                # Aguarda novos itens
                self._new_item_event.clear()
                try:
                    await asyncio.wait_for(self._new_item_event.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    pass
                continue

            # Processa o item
            await self._process_item(item_to_process)

    async def _process_item(self, item: QueueItem):
        item.status = "processing"
        item.percent = 5
        item.message = "Verificando cache de alta velocidade..."
        await self.broadcast_update()

        job_dir = os.path.join(TEMP_DIR, item.id)
        os.makedirs(job_dir, exist_ok=True)

        cache_video_dir = os.path.join(CACHE_DIR, item.video_id)
        cached_inst = os.path.join(cache_video_dir, "instrumental.wav")
        cached_lead = os.path.join(cache_video_dir, "lead_vocal.wav")
        cached_lyrics_file = os.path.join(cache_video_dir, "lyrics.json")

        # 1. Verificação de Cache Instantâneo
        if os.path.exists(cached_inst) and os.path.exists(cached_lead):
            logger.info(f"Música {item.video_id} ('{item.title}') carregada do cache instantâneo!")
            item.percent = 60
            item.message = "Carregando do cache de alta velocidade..."
            await self.broadcast_update()

            shutil.copy2(cached_inst, os.path.join(job_dir, "instrumental.wav"))
            shutil.copy2(cached_lead, os.path.join(job_dir, "lead_vocal.wav"))
            if os.path.exists(os.path.join(cache_video_dir, "backing.wav")):
                shutil.copy2(os.path.join(cache_video_dir, "backing.wav"), os.path.join(job_dir, "backing.wav"))
            else:
                shutil.copy2(cached_lead, os.path.join(job_dir, "backing.wav"))

            lyrics_data = None
            if os.path.exists(cached_lyrics_file):
                try:
                    import json
                    with open(cached_lyrics_file, "r", encoding="utf-8") as f:
                        lyrics_data = json.load(f)
                except Exception:
                    pass

            if not lyrics_data:
                lyrics_data = await fetch_lyrics_cascade(
                    title=item.title,
                    artist=item.artist,
                    duration=item.duration,
                    job_dir=job_dir,
                    vocal_audio_path=os.path.join(job_dir, "lead_vocal.wav")
                )

            item.stems = {
                "instrumental": f"/api/audio/{item.id}/instrumental.wav",
                "backing": f"/api/audio/{item.id}/backing.wav",
                "lead_vocal": f"/api/audio/{item.id}/lead_vocal.wav"
            }
            item.lyrics = lyrics_data or {"source": "none", "synced": False, "lines": []}
            item.percent = 100
            item.message = "Pronta para cantar!"
            item.status = "ready"
            await self.broadcast_update()
            return

        loop = asyncio.get_running_loop()

        def sync_pipeline():
            try:
                ensure_ffmpeg()
                video_url = f"https://www.youtube.com/watch?v={item.video_id}"
                input_audio_path = os.path.join(job_dir, "input.wav")

                # Opções do yt-dlp com extração de legendas VTT para a Camada 2 de letras
                ydl_opts = {
                    "format": "bestaudio/best",
                    "outtmpl": os.path.join(job_dir, "input.%(ext)s"),
                    "postprocessors": [{
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "wav",
                        "preferredquality": "192",
                    }],
                    "writesubtitles": True,
                    "writeautomaticsub": True,
                    "subtitleslangs": ["pt", "en"],
                    "subtitlesformat": "vtt",
                    "quiet": True,
                    "no_warnings": True,
                }

                item.percent = 10
                item.message = "Baixando áudio e metadados..."
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([video_url])

                if not os.path.exists(input_audio_path):
                    wavs = [f for f in os.listdir(job_dir) if f.endswith(".wav")]
                    if wavs:
                        input_audio_path = os.path.join(job_dir, wavs[0])
                    else:
                        raise FileNotFoundError("Não foi possível extrair o áudio WAV do vídeo.")

                item.percent = 25
                item.message = "Separando instrumental e vocais com IA (Demucs v4)..."

                def progress_cb(pct, msg):
                    item.percent = pct
                    item.message = msg

                # Separação otimizada com --two-stems vocals
                stems = process_audio_stems(input_audio_path, job_dir, progress_callback=progress_cb)

                item.percent = 85
                item.message = "Buscando e sincronizando letra da música..."

                # Cascata de 4 camadas para a letra
                lead_vocal_path = stems["lead_vocal"]
                # Chamada síncrona segura para a cascata de letras
                async def run_lyrics():
                    return await fetch_lyrics_cascade(
                        title=item.title,
                        artist=item.artist,
                        duration=item.duration,
                        job_dir=job_dir,
                        vocal_audio_path=lead_vocal_path
                    )

                sub_loop = asyncio.new_event_loop()
                lyrics_data = sub_loop.run_until_complete(run_lyrics())
                sub_loop.close()

                item.stems = {
                    "instrumental": f"/api/audio/{item.id}/instrumental.wav",
                    "backing": f"/api/audio/{item.id}/backing.wav",
                    "lead_vocal": f"/api/audio/{item.id}/lead_vocal.wav"
                }
                item.lyrics = lyrics_data
                item.percent = 100
                item.message = "Pronta para cantar!"
                item.status = "ready"

                logger.info(f"Música processada com sucesso: '{item.title}' (ID: {item.id})")

                # Salva no cache persistente para reutilização instantânea
                try:
                    os.makedirs(cache_video_dir, exist_ok=True)
                    shutil.copy2(os.path.join(job_dir, "instrumental.wav"), cached_inst)
                    shutil.copy2(os.path.join(job_dir, "lead_vocal.wav"), cached_lead)
                    if os.path.exists(os.path.join(job_dir, "backing.wav")):
                        shutil.copy2(os.path.join(job_dir, "backing.wav"), os.path.join(cache_video_dir, "backing.wav"))
                    if item.lyrics:
                        import json
                        with open(cached_lyrics_file, "w", encoding="utf-8") as f:
                            json.dump(item.lyrics, f, ensure_ascii=False)
                except Exception as cache_err:
                    logger.warning(f"Aviso ao persistir cache: {cache_err}")

            except Exception as e:
                logger.error(f"Erro ao processar '{item.title}': {e}", exc_info=True)
                item.status = "error"
                item.error = str(e)
                item.message = f"Erro no processamento: {str(e)[:100]}"

        # Executa o pipeline de áudio no threadpool executor para não travar o loop do FastAPI
        await loop.run_in_executor(None, sync_pipeline)
        await self.broadcast_update()

# Instância global singleton
queue_manager = QueueManager()
