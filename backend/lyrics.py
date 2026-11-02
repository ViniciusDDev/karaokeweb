import re
import logging
import httpx

logger = logging.getLogger("openkaraoke.lyrics")

def parse_lrc(lrc_text: str):
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
            time_sec = minutes * 60 + seconds
            if text:  # Ignora linhas puramente vazias de timestamp
                lines.append({"time": round(time_sec, 2), "text": text})
    lines.sort(key=lambda x: x["time"])
    return lines

def parse_vtt(vtt_text: str):
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
            # Remove tags HTML simples como <c> </c> geradas pelo YouTube
            clean_text = re.sub(r"<[^>]+>", "", raw_line).strip()
            if clean_text:
                lines.append({"time": round(current_time, 2), "text": clean_text})
                current_time = None

    lines.sort(key=lambda x: x["time"])
    return lines

async def fetch_lyrics(title: str, artist: str = "", duration: int = None):
    """
    Busca letras sincronizadas no LRCLIB API com fallback para busca por texto.
    """
    clean_title = re.sub(r"\(.*?\)|\[.*?\]|official|video|clipe|audio|karaoke|lyrics", "", title, flags=re.I).strip()
    
    async with httpx.AsyncClient(timeout=8.0) as client:
        # 1. Tentativa de busca exata no LRCLIB
        try:
            params = {"track_name": clean_title}
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
                        logger.info(f"Letra sincronizada obtida no LRCLIB para '{clean_title}'")
                        return {"source": "lrclib", "synced": True, "lines": parsed}
        except Exception as e:
            logger.warning(f"Erro na consulta direta ao LRCLIB: {e}")

        # 2. Tentativa de busca ampla (search) no LRCLIB
        try:
            search_query = f"{artist} {clean_title}".strip()
            resp = await client.get("https://lrclib.net/api/search", params={"q": search_query})
            if resp.status_code == 200:
                results = resp.json()
                if isinstance(results, list) and len(results) > 0:
                    for item in results:
                        synced = item.get("syncedLyrics")
                        if synced:
                            parsed = parse_lrc(synced)
                            if parsed:
                                logger.info(f"Letra encontrada via busca LRCLIB para '{search_query}'")
                                return {"source": "lrclib_search", "synced": True, "lines": parsed}
        except Exception as e:
            logger.warning(f"Erro na busca ampla LRCLIB: {e}")

    # Sem letra encontrada
    return {
        "source": "none",
        "synced": False,
        "lines": [{"time": 0.0, "text": "Letra sincronizada não encontrada. Cante livremente!"}]
    }
