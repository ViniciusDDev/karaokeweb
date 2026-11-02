import re
import os
import logging
from typing import Dict, Any, List, Optional
import httpx

logger = logging.getLogger("openkaraoke.lyrics")

def clean_track_metadata(raw_title: str, raw_artist: str = "") -> tuple[str, str]:
    """
    Remove ruídos comuns de títulos do YouTube e extrai Artista e Nome da Faixa.
    Ex: 'Chitãozinho & Xororó - Evidências (Clipe Oficial) [4K]' -> ('Evidências', 'Chitãozinho & Xororó')
    """
    title = raw_title.strip()
    artist = (raw_artist or "").strip()

    # Remove tags comuns entre colchetes e parênteses
    noise_pattern = re.compile(
        r"(\[.*?\]|\(.*?\)|\|.*?$|feat\..*?$|ft\..*?$|prod\..*?$|official|video|clipe|áudio|audio|oficial|4k|hd|remastered|lyrics|karaoke|ao vivo|live)",
        flags=re.IGNORECASE
    )

    # Verifica se há separador clássico 'Artista - Música'
    if " - " in title:
        parts = title.split(" - ", 1)
        part_artist = noise_pattern.sub("", parts[0]).strip()
        part_track = noise_pattern.sub("", parts[1]).strip()
        if part_artist and part_track:
            return part_track, part_artist

    clean_title = noise_pattern.sub("", title).strip()
    clean_artist = noise_pattern.sub("", artist).strip()
    # Remove múltiplos espaços
    clean_title = re.sub(r"\s+", " ", clean_title).strip()
    clean_artist = re.sub(r"\s+", " ", clean_artist).strip()

    return clean_title or title, clean_artist or artist

def sanitize_lyric_line(text: str) -> str:
    """
    Remove caracteres de notas musicais, ruídos e tags de áudio (ex: ♪, ♫, ♬, ♩, 🎵, 🎶, [Música]).
    Garante que a frase da letra fique limpa e natural para leitura no karaokê.
    """
    cleaned = re.sub(r"[♪♫♬♩🎵🎶]+", "", text)
    cleaned = re.sub(r"\[(Música|Musica|Music|Aplausos|Risos)\]", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\((Música|Musica|Music|Aplausos|Risos)\)", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned

def parse_lrc(lrc_text: str) -> List[Dict[str, Any]]:
    """
    Converte texto no formato LRC ([mm:ss.xx] Letra) em lista de dicionários com time em segundos.
    """
    lines = []
    pattern = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\](.*)")
    for raw_line in lrc_text.splitlines():
        raw_line = raw_line.strip()
        match = pattern.match(raw_line)
        if match:
            minutes = int(match.group(1))
            seconds = float(match.group(2))
            text = match.group(3).strip()
            text = sanitize_lyric_line(text)
            time_sec = minutes * 60 + seconds
            if text:
                lines.append({"time": round(time_sec, 2), "text": text})
    lines.sort(key=lambda x: x["time"])
    return lines

def parse_vtt(vtt_text: str) -> List[Dict[str, Any]]:
    """
    Faz o parse de legendas WebVTT extraídas do YouTube.
    """
    lines = []
    pattern = re.compile(r"(\d{2}:)?(\d{2}):(\d{2}\.\d{3})\s*-->\s*(\d{2}:)?(\d{2}):(\d{2}\.\d{3})")
    current_time = None

    for raw_line in vtt_text.splitlines():
        raw_line = raw_line.strip()
        if not raw_line or raw_line.startswith("WEBVTT") or raw_line.startswith("NOTE"):
            continue
        match = pattern.match(raw_line)
        if match:
            h = int(match.group(1)[:-1]) if match.group(1) else 0
            m = int(match.group(2))
            s = float(match.group(3))
            current_time = h * 3600 + m * 60 + s
        elif current_time is not None:
            clean_text = re.sub(r"<[^>]+>", "", raw_line).strip()
            clean_text = sanitize_lyric_line(clean_text)
            if clean_text:
                lines.append({"time": round(current_time, 2), "text": clean_text})
                current_time = None

    lines.sort(key=lambda x: x["time"])
    return lines

def score_lrclib_candidate(item: Dict[str, Any], target_track: str, target_artist: str, target_dur: Optional[int] = None) -> float:
    """Calcula pontuação de aderência para evitar versões em outros idiomas ou faixas erradas."""
    score = 0.0
    cand_track = (item.get("trackName") or "").lower()
    cand_artist = (item.get("artistName") or "").lower()
    t_track = target_track.lower().strip()
    t_artist = target_artist.lower().strip()

    # Penaliza versões traduzidas indesejadas (ex: espanhol ou acústico quando não solicitado)
    bad_tags = ["en español", "versión en español", "version en espanol", "spanish version", "en castellano", "traducción", "cover"]
    for tag in bad_tags:
        if tag in cand_track and tag not in t_track:
            score -= 15.0

    # Correspondência de faixa
    if t_track and t_track == cand_track:
        score += 10.0
    elif t_track and t_track in cand_track:
        score += 5.0

    # Correspondência de artista
    if t_artist and t_artist in cand_artist:
        score += 8.0
    elif t_artist:
        artist_words = [w for w in t_artist.split() if len(w) > 3]
        if any(w in cand_artist for w in artist_words):
            score += 4.0

    # Correspondência de duração
    cand_dur = item.get("duration")
    if target_dur and cand_dur:
        diff = abs(cand_dur - target_dur)
        if diff <= 6:
            score += 5.0
        elif diff <= 15:
            score += 2.0
        elif diff > 50:
            score -= 4.0

    return score

# -------------------------------------------------------------
# Camada 1: LRCLIB (Busca Exata e Busca Ampla)
# -------------------------------------------------------------
async def fetch_lyrics_lrclib(track: str, artist: str = "", duration: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Consulta a API LRCLIB com estratégias em cascata e ranqueamento inteligente."""
    async with httpx.AsyncClient(timeout=6.0) as client:
        # 1. Tentativa com parâmetros diretos
        try:
            params: Dict[str, Any] = {"track_name": track}
            if artist:
                params["artist_name"] = artist
            if duration:
                params["duration"] = duration

            resp = await client.get("https://lrclib.net/api/get", params=params)
            if resp.status_code == 200:
                data = resp.json()
                synced = data.get("syncedLyrics")
                if synced:
                    parsed = parse_lrc(synced)
                    if parsed:
                        logger.info(f"Camada 1: Letra sincronizada obtida no LRCLIB direto para '{track}' ({artist})")
                        return {"source": "lrclib", "synced": True, "lines": parsed}
        except Exception as e:
            logger.debug(f"LRCLIB get falhou: {e}")

        # 2. Tentativa por busca ampla com query composta e ranqueamento de candidatos
        queries = []
        if artist and track:
            queries.append(f"{artist} {track}")
        queries.append(track)

        for q in queries:
            try:
                resp = await client.get("https://lrclib.net/api/search", params={"q": q})
                if resp.status_code == 200:
                    results = resp.json()
                    if isinstance(results, list) and len(results) > 0:
                        candidates = []
                        for item in results:
                            synced = item.get("syncedLyrics")
                            if synced:
                                cand_score = score_lrclib_candidate(item, track, artist, duration)
                                candidates.append((cand_score, item))

                        if candidates:
                            candidates.sort(key=lambda x: x[0], reverse=True)
                            best_score, best_item = candidates[0]
                            # Só descarta se a pontuação for muito negativa (penalidade alta de idioma)
                            if best_score >= -5.0:
                                parsed = parse_lrc(best_item["syncedLyrics"])
                                if parsed:
                                    logger.info(f"Camada 1: Letra ranqueada (score {best_score}) para '{best_item.get('trackName')}' ({best_item.get('artistName')})")
                                    return {"source": "lrclib_search", "synced": True, "lines": parsed}
            except Exception as e:
                logger.debug(f"LRCLIB search falhou para '{q}': {e}")

    return None

async def search_lrclib_options(query: str) -> List[Dict[str, Any]]:
    """
    Busca opções de letras no LRCLIB para o modal de seleção manual do usuário ('Ajustar Letra').
    """
    options = []
    clean_q = re.sub(r"\[.*?\]|\(.*?\)", "", query).strip()
    if not clean_q:
        return []

    async with httpx.AsyncClient(timeout=6.0) as client:
        try:
            resp = await client.get("https://lrclib.net/api/search", params={"q": clean_q})
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    for item in data:
                        synced = item.get("syncedLyrics")
                        if synced:
                            parsed = parse_lrc(synced)
                            if parsed:
                                preview = " / ".join([line["text"] for line in parsed[:3]])
                                options.append({
                                    "id": item.get("id"),
                                    "track_name": item.get("trackName"),
                                    "artist_name": item.get("artistName"),
                                    "album_name": item.get("albumName"),
                                    "duration": item.get("duration"),
                                    "preview": preview,
                                    "lines": parsed
                                })
        except Exception as e:
            logger.warning(f"Erro ao buscar opções no LRCLIB: {e}")

    return options

# -------------------------------------------------------------
# Camada 2: Legendas do YouTube (VTT / Captions)
# -------------------------------------------------------------
def fetch_youtube_subtitles(job_dir: str) -> Optional[Dict[str, Any]]:
    """Verifica se há legendas VTT salvas no diretório da música."""
    if not os.path.exists(job_dir):
        return None

    vtt_files = [f for f in os.listdir(job_dir) if f.endswith(".vtt")]
    for vtt_file in vtt_files:
        try:
            vtt_path = os.path.join(job_dir, vtt_file)
            with open(vtt_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            lines = parse_vtt(content)
            if lines:
                logger.info(f"Camada 2: Letra sincronizada obtida das legendas do YouTube ({vtt_file})")
                return {"source": "youtube_vtt", "synced": True, "lines": lines}
        except Exception as e:
            logger.debug(f"Erro ao ler legenda VTT {vtt_file}: {e}")

    return None

# -------------------------------------------------------------
# Camada 3: Whisper IA Local (Transcreve lead_vocal.wav com timestamps)
# -------------------------------------------------------------
_whisper_model = None

def transcribe_with_whisper(vocal_audio_path: str) -> Optional[Dict[str, Any]]:
    """
    Executa o modelo Whisper na faixa de voz isolada para gerar timestamps locais.
    Utiliza import dinâmico com modelo leve (tiny ou base) para máxima velocidade.
    """
    global _whisper_model
    if not os.path.exists(vocal_audio_path):
        return None

    try:
        import whisper
        import torch
        from backend.audio_processor import is_cuda_functional

        device = "cuda" if is_cuda_functional() else "cpu"
        if _whisper_model is None:
            logger.info(f"Carregando modelo Whisper 'tiny' ({device})...")
            _whisper_model = whisper.load_model("tiny", device=device)

        logger.info(f"Camada 3: Executando Whisper em '{vocal_audio_path}'...")
        result = _whisper_model.transcribe(vocal_audio_path, verbose=False)
        segments = result.get("segments", [])

        lines = []
        for seg in segments:
            text = seg.get("text", "").strip()
            text = sanitize_lyric_line(text)
            if text:
                lines.append({
                    "time": round(float(seg.get("start", 0.0)), 2),
                    "text": text
                })

        if lines:
            logger.info(f"Camada 3: Whisper transcreveu {len(lines)} frases sincronizadas com sucesso!")
            return {"source": "whisper_ai", "synced": True, "lines": lines}

    except ImportError:
        logger.info("Camada 3: Pacote 'whisper' não instalado. Pulando transcrição local.")
    except Exception as e:
        logger.warning(f"Camada 3: Falha na transcrição do Whisper: {e}")

    return None

# -------------------------------------------------------------
# Função Principal em Cascata
# -------------------------------------------------------------
async def fetch_lyrics_cascade(
    title: str,
    artist: str = "",
    duration: Optional[int] = None,
    job_dir: Optional[str] = None,
    vocal_audio_path: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executa a cascata de 4 camadas:
    1. LRCLIB (LRC oficial sincronizado)
    2. Legendas VTT do YouTube
    3. Whisper IA Local na faixa isolada de voz
    4. Fallback amigável de Cante Livremente
    """
    clean_track, clean_artist = clean_track_metadata(title, artist)

    # 1. Camada 1: LRCLIB
    lrc_result = await fetch_lyrics_lrclib(clean_track, clean_artist, duration)
    if lrc_result:
        return lrc_result

    # 2. Camada 2: Legendas do YouTube
    if job_dir:
        vtt_result = fetch_youtube_subtitles(job_dir)
        if vtt_result:
            return vtt_result

    # 3. Camada 3: Whisper IA Local
    if vocal_audio_path and os.path.exists(vocal_audio_path):
        whisper_result = transcribe_with_whisper(vocal_audio_path)
        if whisper_result:
            return whisper_result

    # 4. Camada 4: Cante Livremente
    logger.info(f"Camada 4: Letra não encontrada nas camadas 1-3 para '{title}'. Ativando modo livre.")
    return {
        "source": "none",
        "synced": False,
        "lines": [{"time": 0.0, "text": "Letra sincronizada não encontrada. Cante livremente!"}]
    }
