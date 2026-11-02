import os
import sys
import shutil
import asyncio
import logging
import socket
import json
from contextlib import asynccontextmanager
from typing import Dict, Any, List, Optional

from fastapi import FastAPI, BackgroundTasks, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp

from backend.audio_processor import ensure_ffmpeg, get_hardware_info
from backend.lyrics import (
    clean_track_metadata,
    search_lrclib_options,
    transcribe_with_whisper,
    is_whisper_available,
    fetch_lyrics_cascade
)
from backend.queue_manager import queue_manager, QueueItem

# Configuração de logs
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("openkaraoke.server")

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEMP_DIR = os.path.join(BASE_DIR, "temp")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

hall_of_fame: List[Dict[str, Any]] = []

def get_local_ip() -> str:
    """Detecta automaticamente o IP local na rede Wi-Fi / LAN."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        pass

    try:
        hostname = socket.gethostname()
        ip = socket.gethostbyname(hostname)
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass

    return "127.0.0.1"

def clean_temp_directory():
    """Remove todos os arquivos e pastas no diretório temporário."""
    try:
        if os.path.exists(TEMP_DIR):
            for item in os.listdir(TEMP_DIR):
                item_path = os.path.join(TEMP_DIR, item)
                if os.path.isdir(item_path):
                    shutil.rmtree(item_path, ignore_errors=True)
                else:
                    try:
                        os.remove(item_path)
                    except Exception:
                        pass
            logger.info("Diretório temporário ./temp/ limpo com sucesso.")
        else:
            os.makedirs(TEMP_DIR, exist_ok=True)
    except Exception as e:
        logger.warning(f"Erro durante a limpeza do temp: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inicialização da sessão
    logger.info("Iniciando OpenKaraoke...")
    ensure_ffmpeg()
    clean_temp_directory()
    queue_manager.start_worker()
    hw = get_hardware_info()
    local_ip = get_local_ip()
    logger.info(f"Hardware detectado: {hw['description']}")
    logger.info(f"Modo Festa disponível em: http://{local_ip}:5000/party")
    yield
    # Encerramento e limpeza da sessão
    logger.info("Encerrando OpenKaraoke e executando limpeza de arquivos temporários...")
    queue_manager.stop_worker()
    clean_temp_directory()

app = FastAPI(title="OpenKaraoke API", version="1.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AddToQueueRequest(BaseModel):
    video_id: str
    title: str
    artist: str = ""
    thumbnail: str = ""
    duration: int = 0
    requested_by: str = "Palco"

class SelectLyricsRequest(BaseModel):
    queue_id: str
    lyrics_data: Dict[str, Any]

class ScoreEntry(BaseModel):
    singer: str
    score: int
    song_title: str

@app.get("/api/hardware")
def api_hardware():
    """Retorna informações sobre a aceleração por hardware (GPU/CPU)."""
    return get_hardware_info()

@app.get("/api/party/info")
def api_party_info():
    """Retorna o IP local e URL da festa para geração do QR Code."""
    ip = get_local_ip()
    port = 5000
    party_url = f"http://{ip}:{port}/party"
    return {
        "local_ip": ip,
        "port": port,
        "party_url": party_url
    }

@app.get("/api/search")
def api_search(q: str = Query(..., min_length=1)):
    """Busca vídeos de músicas no YouTube usando yt-dlp."""
    ensure_ffmpeg()
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
    }
    results = []
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            search_res = ydl.extract_info(f"ytsearch8:{q}", download=False)
            if search_res and "entries" in search_res:
                for entry in search_res["entries"]:
                    if not entry:
                        continue
                    duration = entry.get("duration") or 0
                    if duration > 720:  # Ignora faixas acima de 12 minutos
                        continue
                    raw_title = entry.get("title", "Desconhecido")
                    uploader = entry.get("uploader", "YouTube")
                    clean_track, clean_artist = clean_track_metadata(raw_title, uploader)
                    display_artist = clean_artist if clean_artist and clean_artist.lower() != "youtube" else uploader
                    results.append({
                        "video_id": entry.get("id"),
                        "title": raw_title,
                        "artist": display_artist,
                        "duration": duration,
                        "thumbnail": entry.get("thumbnails", [{}])[-1].get("url", "") if entry.get("thumbnails") else f"https://i.ytimg.com/vi/{entry.get('id')}/hqdefault.jpg"
                    })
    except Exception as e:
        logger.error(f"Erro ao buscar no YouTube: {e}")
        raise HTTPException(status_code=500, detail=f"Erro na busca do YouTube: {str(e)}")

    return {"results": results}

@app.get("/api/preview/{video_id}")
async def api_preview(video_id: str):
    """
    Retorna um preview de áudio (5 segundos) do vídeo do YouTube para confirmação rápida da versão.
    Salva em cache em temp/previews/{video_id}.mp3.
    """
    preview_dir = os.path.join(TEMP_DIR, "previews")
    os.makedirs(preview_dir, exist_ok=True)
    preview_file = os.path.join(preview_dir, f"{video_id}.mp3")

    if os.path.exists(preview_file):
        return FileResponse(preview_file, media_type="audio/mpeg")

    loop = asyncio.get_running_loop()

    def extract_preview():
        ensure_ffmpeg()
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": os.path.join(preview_dir, f"{video_id}.%(ext)s"),
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "128",
            }],
            "download_ranges": yt_dlp.utils.download_range_func(None, [(20, 25)]),
            "force_keyframes_at_cuts": True,
            "quiet": True,
            "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([f"https://www.youtube.com/watch?v={video_id}"])

    try:
        await loop.run_in_executor(None, extract_preview)
        if os.path.exists(preview_file):
            return FileResponse(preview_file, media_type="audio/mpeg")
    except Exception as e:
        logger.warning(f"Download_ranges falhou para preview {video_id}: {e}")

    # Fallback: se não conseguiu fatiar 5s, redireciona para stream direto
    def get_stream_url():
        ydl_opts = {"format": "bestaudio/best", "quiet": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            return info.get("url")

    try:
        stream_url = await loop.run_in_executor(None, get_stream_url)
        if stream_url:
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=stream_url)
    except Exception as e:
        logger.error(f"Erro ao extrair stream URL de preview para {video_id}: {e}")

    raise HTTPException(status_code=404, detail="Não foi possível gerar o preview desta música.")

# ----------------------------------------------------------------------
# Endpoints do Sistema de Fila
# ----------------------------------------------------------------------
@app.get("/api/queue")
async def api_get_queue():
    """Retorna os itens ativos na fila."""
    return {"queue": queue_manager.get_queue_payload()}

@app.post("/api/queue")
async def api_add_queue(req: AddToQueueRequest):
    """Adiciona uma música à fila (limite de 20)."""
    try:
        item = queue_manager.add_to_queue(
            video_id=req.video_id,
            title=req.title,
            artist=req.artist,
            thumbnail=req.thumbnail,
            duration=req.duration,
            requested_by=req.requested_by
        )
        return {"success": True, "item": item.model_dump()}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

@app.delete("/api/queue/{item_id}")
async def api_remove_queue(item_id: str):
    """Remove uma música da fila."""
    success = queue_manager.remove_item(item_id)
    if not success:
        raise HTTPException(status_code=400, detail="Não foi possível remover o item (ou já em reprodução).")
    return {"success": True}

@app.post("/api/queue/{item_id}/play")
async def api_play_queue(item_id: str):
    """Inicia a reprodução de um item que está pronto."""
    item = queue_manager.mark_playing(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado na fila.")
    return {"success": True, "item": item.model_dump()}

@app.post("/api/queue/{item_id}/retry")
async def api_retry_queue(item_id: str):
    """Reinicia o processamento de uma música que falhou na fila."""
    success = queue_manager.retry_item(item_id)
    if not success:
        raise HTTPException(status_code=404, detail="Item não encontrado na fila.")
    return {"success": True}

@app.post("/api/queue/skip")
async def api_skip_queue():
    """Pula a música atual e avança para a próxima pronta."""
    next_item = queue_manager.skip_current()
    return {"success": True, "next_item": next_item.model_dump() if next_item else None}

@app.get("/api/queue/events")
async def api_queue_events():
    """Stream SSE para sincronizar o estado da fila em tempo real com TV e celulares."""
    subscriber_queue: asyncio.Queue = asyncio.Queue()
    queue_manager._listeners.append(subscriber_queue)

    async def event_generator():
        try:
            # Envia estado inicial imediatamente
            initial_data = json.dumps(queue_manager.get_queue_payload())
            yield f"data: {initial_data}\n\n"

            while True:
                data = await subscriber_queue.get()
                yield f"data: {json.dumps(data)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if subscriber_queue in queue_manager._listeners:
                queue_manager._listeners.remove(subscriber_queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")

# ----------------------------------------------------------------------
# Endpoints de Letras: Ajustar Letra & Whisper
# ----------------------------------------------------------------------
@app.get("/api/lyrics/options")
async def api_lyrics_options(q: str = Query(..., min_length=1)):
    """Busca opções de letras no LRCLIB para o modal 'Ajustar Letra'."""
    options = await search_lrclib_options(q)
    return {"options": options}

@app.post("/api/lyrics/select")
async def api_lyrics_select(req: SelectLyricsRequest):
    """Aplica uma nova letra selecionada manualmente à música."""
    success = queue_manager.update_lyrics(req.queue_id, req.lyrics_data)
    if not success:
        raise HTTPException(status_code=404, detail="Música não encontrada na fila.")
    return {"success": True}

@app.post("/api/lyrics/whisper/{queue_id}")
async def api_lyrics_whisper(queue_id: str):
    """Força a transcrição local da voz isolada via modelo Whisper."""
    item = queue_manager.get_item(queue_id)
    if not item:
        raise HTTPException(status_code=404, detail="Música não encontrada.")

    avail, msg = is_whisper_available()
    if not avail:
        raise HTTPException(status_code=400, detail=msg)

    vocal_path = os.path.join(TEMP_DIR, queue_id, "lead_vocal.wav")
    if not os.path.exists(vocal_path):
        raise HTTPException(status_code=400, detail="Faixa de voz isolada ainda não está pronta.")

    whisper_result = transcribe_with_whisper(vocal_path)
    if not whisper_result:
        raise HTTPException(status_code=500, detail="Whisper não conseguiu transcrever o áudio isolado desta faixa.")

    queue_manager.update_lyrics(queue_id, whisper_result)
    return {"success": True, "lyrics": whisper_result}

# ----------------------------------------------------------------------
# Áudio, Hall da Fama e Páginas
# ----------------------------------------------------------------------
@app.get("/api/audio/{item_id}/{stem_name}")
def api_audio(item_id: str, stem_name: str):
    """Serve as faixas de áudio isoladas (.wav) geradas para o player web."""
    file_path = os.path.join(TEMP_DIR, item_id, stem_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Faixa de áudio não encontrada")
    return FileResponse(file_path, media_type="audio/wav")

@app.get("/api/hall-of-fame")
def api_get_hall_of_fame():
    """Retorna o Hall da Fama temporário da sessão."""
    sorted_hall = sorted(hall_of_fame, key=lambda x: x["score"], reverse=True)
    return {"hall_of_fame": sorted_hall}

@app.post("/api/hall-of-fame")
def api_add_hall_of_fame(entry: ScoreEntry):
    """Adiciona um cantor e pontuação ao Hall da Fama."""
    clamped_score = max(0, min(100, entry.score))
    hall_of_fame.append({
        "singer": entry.singer.strip() or "Cantor Misterioso",
        "score": clamped_score,
        "song_title": entry.song_title
    })
    return {"success": True, "score": clamped_score}

@app.get("/favicon.ico", include_in_schema=False)
def api_favicon():
    """Serve um ícone de microfone para a aba do navegador, evitando logs de 404 no terminal."""
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎤</text></svg>'
    return Response(content=svg, media_type="image/svg+xml")

@app.get("/party")
def page_party():
    """Serve a interface mobile para os convidados no celular."""
    party_file = os.path.join(FRONTEND_DIR, "party.html")
    if os.path.exists(party_file):
        return FileResponse(party_file)
    raise HTTPException(status_code=404, detail="Página do Modo Festa não encontrada.")

# Servir Frontend SPA
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
