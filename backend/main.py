import os
import sys
import shutil
import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Dict, Any, List

from fastapi import FastAPI, BackgroundTasks, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp

from backend.audio_processor import ensure_ffmpeg, get_hardware_info, process_audio_stems
from backend.lyrics import fetch_lyrics

# Configuração de logs
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("openkaraoke.server")

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEMP_DIR = os.path.join(BASE_DIR, "temp")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

# Estado em memória da sessão
jobs_status: Dict[str, Dict[str, Any]] = {}
hall_of_fame: List[Dict[str, Any]] = []

def clean_temp_directory():
    """Remove todos os arquivos e pastas no diretório temporário."""
    try:
        if os.path.exists(TEMP_DIR):
            for item in os.listdir(TEMP_DIR):
                item_path = os.path.join(TEMP_DIR, item)
                if os.path.isdir(item_path):
                    shutil.rmtree(item_path, ignore_errors=True)
                else:
                    os.remove(item_path)
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
    hw = get_hardware_info()
    logger.info(f"Hardware detectado: {hw['description']}")
    yield
    # Encerramento e limpeza da sessão
    logger.info("Encerrando OpenKaraoke e executando limpeza de arquivos temporários...")
    clean_temp_directory()

app = FastAPI(title="OpenKaraoke API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ProcessRequest(BaseModel):
    video_id: str
    title: str
    artist: str = ""
    thumbnail: str = ""
    duration: int = 0

class ScoreEntry(BaseModel):
    singer: str
    score: int
    song_title: str

@app.get("/api/hardware")
def api_hardware():
    """Retorna informações sobre a aceleração por hardware (GPU/CPU)."""
    return get_hardware_info()

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
            search_res = ydl.extract_info(f"ytsearch5:{q}", download=False)
            if search_res and "entries" in search_res:
                for entry in search_res["entries"]:
                    if not entry:
                        continue
                    duration = entry.get("duration") or 0
                    # Ignora vídeos excessivamente longos (acima de 12 min)
                    if duration > 720:
                        continue
                    results.append({
                        "video_id": entry.get("id"),
                        "title": entry.get("title", "Desconhecido"),
                        "artist": entry.get("uploader", "YouTube"),
                        "duration": duration,
                        "thumbnail": entry.get("thumbnails", [{}])[-1].get("url", "") if entry.get("thumbnails") else f"https://i.ytimg.com/vi/{entry.get('id')}/hqdefault.jpg"
                    })
    except Exception as e:
        logger.error(f"Erro ao buscar no YouTube: {e}")
        raise HTTPException(status_code=500, detail=f"Erro na busca do YouTube: {str(e)}")

    return {"results": results}

def run_processing_pipeline(job_id: str, req: ProcessRequest):
    """Executa o download e separação de faixas em background com atualizações de progresso."""
    job_dir = os.path.join(TEMP_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    def update_progress(percent: int, message: str, data: Any = None):
        jobs_status[job_id] = {
            "status": "processing" if percent < 100 else "completed",
            "percent": percent,
            "message": message,
            "data": data,
            "error": None
        }

    try:
        update_progress(5, "Iniciando download do áudio no YouTube...")
        video_url = f"https://www.youtube.com/watch?v={req.video_id}"
        input_audio_path = os.path.join(job_dir, "input.wav")

        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": os.path.join(job_dir, "input.%(ext)s"),
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
                "preferredquality": "192",
            }],
            "quiet": True,
            "no_warnings": True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])

        if not os.path.exists(input_audio_path):
            # Procura qualquer .wav gerado no diretório
            wavs = [f for f in os.listdir(job_dir) if f.endswith(".wav")]
            if wavs:
                input_audio_path = os.path.join(job_dir, wavs[0])
            else:
                raise FileNotFoundError("Falha ao extrair áudio WAV do YouTube.")

        update_progress(15, "Áudio baixado com sucesso. Iniciando separação de faixas...")

        # Processamento Demucs + Separação Vocal
        stems = process_audio_stems(input_audio_path, job_dir, progress_callback=lambda p, msg: update_progress(15 + int(p * 0.75), msg))

        update_progress(92, "Buscando letras sincronizadas para karaokê...")

        # Busca assíncrona de letras
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        lyrics_data = loop.run_until_complete(fetch_lyrics(req.title, req.artist, req.duration))
        loop.close()

        result_payload = {
            "job_id": job_id,
            "title": req.title,
            "artist": req.artist,
            "thumbnail": req.thumbnail,
            "stems": {
                "instrumental": f"/api/audio/{job_id}/instrumental.wav",
                "backing": f"/api/audio/{job_id}/backing.wav",
                "lead_vocal": f"/api/audio/{job_id}/lead_vocal.wav"
            },
            "lyrics": lyrics_data
        }

        update_progress(100, "Música pronta para cantar!", data=result_payload)

    except Exception as e:
        logger.error(f"Erro no pipeline para job {job_id}: {e}", exc_info=True)
        jobs_status[job_id] = {
            "status": "error",
            "percent": 0,
            "message": "Erro durante o processamento da música",
            "error": str(e),
            "data": None
        }

@app.post("/api/process")
def api_process(req: ProcessRequest, background_tasks: BackgroundTasks):
    """Dispara a extração e separação de faixas para o vídeo selecionado."""
    job_id = str(uuid.uuid4())[:8]
    jobs_status[job_id] = {
        "status": "starting",
        "percent": 0,
        "message": "Preparando processador de áudio...",
        "data": None,
        "error": None
    }
    background_tasks.add_task(run_processing_pipeline, job_id, req)
    return {"job_id": job_id}

@app.get("/api/progress/{job_id}")
async def api_progress(job_id: str):
    """Server-Sent Events (SSE) transmitindo o progresso de download e separação da música."""
    if job_id not in jobs_status:
        raise HTTPException(status_code=404, detail="Job de áudio não encontrado")

    async def event_generator():
        while True:
            info = jobs_status.get(job_id)
            if not info:
                break
            
            import json
            yield f"data: {json.dumps(info)}\n\n"

            if info.get("status") in ["completed", "error"]:
                break
            await asyncio.sleep(0.8)

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/audio/{job_id}/{stem_name}")
def api_audio(job_id: str, stem_name: str):
    """Serve as faixas de áudio isoladas (.wav) geradas para o player web."""
    file_path = os.path.join(TEMP_DIR, job_id, stem_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Faixa de áudio não encontrada")
    return FileResponse(file_path, media_type="audio/wav")

@app.get("/api/hall-of-fame")
def api_get_hall_of_fame():
    """Retorna o Hall da Fama temporário da sessão ordenado pelas maiores pontuações."""
    sorted_hall = sorted(hall_of_fame, key=lambda x: x["score"], reverse=True)
    return {"hall_of_fame": sorted_hall}

@app.post("/api/hall-of-fame")
def api_add_hall_of_fame(entry: ScoreEntry):
    """Adiciona um cantor e pontuação ao Hall da Fama da sessão."""
    # Garante que a nota está estritamente no intervalo festivo de 75 a 100
    clamped_score = max(75, min(100, entry.score))
    hall_of_fame.append({
        "singer": entry.singer.strip() or "Cantor Misterioso",
        "score": clamped_score,
        "song_title": entry.song_title
    })
    return {"success": True, "score": clamped_score}

@app.post("/api/session/reset")
def api_reset_session():
    """Limpa o diretório temporário e reseta o Hall da Fama."""
    global hall_of_fame
    hall_of_fame.clear()
    jobs_status.clear()
    clean_temp_directory()
    return {"success": True, "message": "Sessão reiniciada e arquivos temporários limpos."}

# Servir Frontend SPA
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
