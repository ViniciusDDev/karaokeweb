import os
import sys
import shutil
import logging
import subprocess
import numpy as np
import soundfile as sf
import torch

logger = logging.getLogger("openkaraoke.audio")

def ensure_ffmpeg():
    """Garante que o executável do ffmpeg esteja no PATH do sistema."""
    if shutil.which("ffmpeg"):
        return True
    try:
        import imageio_ffmpeg
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        ffmpeg_dir = os.path.dirname(ffmpeg_exe)
        if ffmpeg_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
            logger.info(f"FFmpeg adicionado dinamicamente ao PATH: {ffmpeg_dir}")
        return True
    except Exception as e:
        logger.warning(f"Não foi possível configurar FFmpeg via imageio-ffmpeg: {e}")
        return False

def is_cuda_functional():
    """Valida se o PyTorch consegue realmente alocar tensores e executar kernels na GPU."""
    if not torch.cuda.is_available():
        return False
    try:
        x = torch.zeros(1, device="cuda")
        del x
        return True
    except Exception as e:
        logger.warning(f"CUDA detectado mas incapaz de executar tensores na GPU: {e}")
        return False

def has_nvidia_hardware():
    """Detecta se há hardware ou driver NVIDIA instalado no sistema operacional."""
    if shutil.which("nvidia-smi"):
        return True
    for p in [
        r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
        r"C:\Windows\System32\nvidia-smi.exe"
    ]:
        if os.path.exists(p):
            return True
    try:
        import ctypes
        if hasattr(ctypes, "windll"):
            ctypes.windll.LoadLibrary("nvcuda.dll")
            return True
    except Exception:
        pass
    try:
        res = subprocess.run(
            ["powershell", "-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"],
            capture_output=True, text=True, timeout=3
        )
        if "NVIDIA" in res.stdout.upper():
            return True
    except Exception:
        pass
    return False

def check_and_auto_enable_cuda():
    """
    Se uma GPU NVIDIA for detectada no sistema mas CUDA não estiver funcional no PyTorch atual,
    garante a instalação dos wheels oficiais do PyTorch com suporte a CUDA moderna.
    """
    if is_cuda_functional():
        return True

    if has_nvidia_hardware():
        logger.info("GPU NVIDIA detectada no sistema. Ativando suporte a aceleração CUDA no PyTorch...")
        # Prioriza CUDA 12.4 (ampla compatibilidade GTX/RTX), depois 12.1 e 12.6
        candidate_indices = [
            ("cu124", "https://download.pytorch.org/whl/cu124"),
            ("cu121", "https://download.pytorch.org/whl/cu121"),
            ("cu126", "https://download.pytorch.org/whl/cu126")
        ]
        for cu_ver, index_url in candidate_indices:
            try:
                cmd = [
                    sys.executable, "-m", "pip", "install", "--upgrade",
                    "torch", "torchaudio",
                    "--index-url", index_url
                ]
                logger.info(f"Instalando PyTorch com {cu_ver}...")
                res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                if res.returncode == 0:
                    test_cmd = [sys.executable, "-c", "import torch; assert torch.cuda.is_available(); torch.zeros(1, device='cuda')"]
                    if subprocess.run(test_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                        logger.info(f"PyTorch com {cu_ver} instalado e validado na GPU com sucesso!")
                        return True
            except Exception as e:
                logger.warning(f"Erro ao tentar instalar PyTorch {cu_ver}: {e}")
    return False

def get_hardware_info():
    """Detecta GPU (CUDA) vs CPU e retorna os parâmetros ideais de desempenho."""
    has_cuda = is_cuda_functional()
    if not has_cuda and has_nvidia_hardware():
        # Tenta ativar e verificar se o ambiente passa a dispor de CUDA
        check_and_auto_enable_cuda()
        has_cuda = is_cuda_functional()

    if has_cuda:
        try:
            device_name = torch.cuda.get_device_name(0)
        except Exception:
            device_name = "NVIDIA CUDA"

        return {
            "device": "cuda",
            "device_name": device_name,
            "model_name": "htdemucs",
            "shifts": 1,
            "description": f"Aceleração GPU Ativada ({device_name})"
        }
    else:
        return {
            "device": "cpu",
            "device_name": "CPU",
            "model_name": "htdemucs",
            "shifts": 0,
            "description": "Modo Economia de Recursos (CPU Otimizado)"
        }

def separate_vocals_lead_and_backing(vocals_data, sample_rate):
    """
    Separa a faixa de vocais em Voz Principal (Lead) e Backing Vocals (Harmonias/Laterais)
    utilizando decomposição Mid-Side (M/S) adaptativa e filtro de correlação estéreo.
    """
    if vocals_data.ndim == 1:
        # Áudio mono: voz principal é 100%, backing vocal atenuado
        lead = vocals_data.copy()
        backing = np.zeros_like(vocals_data)
        return lead, backing

    left = vocals_data[:, 0]
    right = vocals_data[:, 1]

    # Decomposição Mid-Side
    mid = (left + right) / 2.0   # Conteúdo central (predominantemente voz principal)
    side = (left - right) / 2.0  # Conteúdo lateral/estéreo (backing vocals, efeitos, harmonias)

    # Estimativa de energia de janela móvel para isolamento suave
    win_size = int(sample_rate * 0.05) # 50ms
    if win_size % 2 == 0:
        win_size += 1

    kernel = np.ones(win_size) / win_size
    mid_energy = np.convolve(mid**2, kernel, mode="same") + 1e-8
    side_energy = np.convolve(side**2, kernel, mode="same") + 1e-8

    # Razão de lateralidade (0 = centro perfeito / lead, 1 = lateral / backing)
    stereo_ratio = side_energy / (mid_energy + side_energy)
    stereo_ratio = np.clip(stereo_ratio, 0.0, 1.0)

    # Lead vocal privilegia o centro e atenua os flancos estéreo
    lead_left = mid * (1.0 - 0.7 * stereo_ratio)
    lead_right = mid * (1.0 - 0.7 * stereo_ratio)
    lead = np.column_stack([lead_left, lead_right])

    # Backing vocal preserva o Side com parcela suave do Mid para naturalidade harmônica
    backing_left = left - lead_left
    backing_right = right - lead_right
    backing = np.column_stack([backing_left, backing_right])

    # Normalização segura de picos
    max_lead = np.max(np.abs(lead)) + 1e-8
    if max_lead > 1.0:
        lead = lead / max_lead

    max_backing = np.max(np.abs(backing)) + 1e-8
    if max_backing > 1.0:
        backing = backing / max_backing

    return lead, backing

def process_audio_stems(input_audio_path, output_dir, progress_callback=None):
    """
    Processa o áudio de entrada separando em 3 faixas finais:
    1. instrumental.wav
    2. backing.wav
    3. lead_vocal.wav
    """
    ensure_ffmpeg()
    os.makedirs(output_dir, exist_ok=True)
    hw = get_hardware_info()

    if progress_callback:
        progress_callback(10, f"Iniciando separação com IA ({hw['description']})...")

    # Executa Demucs otimizado para 2 faixas (--two-stems vocals)
    # Corta o tempo de processamento pela metade mantendo fidelidade total
    temp_demucs_out = os.path.join(output_dir, "_demucs_raw")
    os.makedirs(temp_demucs_out, exist_ok=True)

    num_jobs = max(1, min(4, (os.cpu_count() or 2) - 1))
    cmd = [
        sys.executable, "-m", "demucs.separate",
        "-n", hw["model_name"],
        "-d", hw["device"],
        "--two-stems", "vocals",
        "--shifts", str(hw["shifts"]),
        "-j", str(num_jobs),
        "-o", temp_demucs_out,
        input_audio_path
    ]

    logger.info(f"Executando comando Demucs (two-stems): {' '.join(cmd)}")
    if progress_callback:
        progress_callback(25, "Executando modelo Demucs de alta velocidade (vocais vs instrumental)...")

    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        logger.error(f"Erro no Demucs: {proc.stderr}")
        raise RuntimeError(f"Falha na separação por IA: {proc.stderr[:300]}")

    if progress_callback:
        progress_callback(60, "Processando faixas: isolando instrumental e vocais...")

    # Localiza arquivos gerados
    base_name = os.path.splitext(os.path.basename(input_audio_path))[0]
    stems_dir = os.path.join(temp_demucs_out, hw["model_name"], base_name)

    vocals_path = os.path.join(stems_dir, "vocals.wav")
    no_vocals_path = os.path.join(stems_dir, "no_vocals.wav")

    if not os.path.exists(vocals_path):
        for root, dirs, files in os.walk(temp_demucs_out):
            if "vocals.wav" in files:
                vocals_path = os.path.join(root, "vocals.wav")
                no_vocals_path = os.path.join(root, "no_vocals.wav")
                stems_dir = root
                break

    if not os.path.exists(vocals_path):
        raise FileNotFoundError("Demucs não gerou os arquivos de stems esperados.")

    # 1. Cria Instrumental
    if os.path.exists(no_vocals_path):
        instrumental, sr = sf.read(no_vocals_path)
    else:
        # Fallback caso modelo tenha gerado os 4 stems individuais
        drums_path = os.path.join(stems_dir, "drums.wav")
        bass_path = os.path.join(stems_dir, "bass.wav")
        other_path = os.path.join(stems_dir, "other.wav")
        drums, sr = sf.read(drums_path)
        bass, _ = sf.read(bass_path)
        other, _ = sf.read(other_path)
        instrumental = drums + bass + other

    # Normalização de pico para evitar clipping
    max_inst = np.max(np.abs(instrumental)) + 1e-8
    if max_inst > 0.98:
        instrumental = instrumental * (0.95 / max_inst)

    inst_out_path = os.path.join(output_dir, "instrumental.wav")
    sf.write(inst_out_path, instrumental, sr)

    if progress_callback:
        progress_callback(75, "Separando voz principal de backing vocals...")

    # 2. Separa vocals em Lead Vocal e Backing Vocal
    vocals, sr_voc = sf.read(vocals_path)
    lead, backing = separate_vocals_lead_and_backing(vocals, sr_voc)

    lead_out_path = os.path.join(output_dir, "lead_vocal.wav")
    backing_out_path = os.path.join(output_dir, "backing.wav")

    sf.write(lead_out_path, lead, sr_voc)
    sf.write(backing_out_path, backing, sr_voc)

    # Limpeza dos arquivos intermediários brutos do Demucs
    try:
        shutil.rmtree(temp_demucs_out)
    except Exception as e:
        logger.warning(f"Aviso ao remover temporários brutos do Demucs: {e}")

    if progress_callback:
        progress_callback(90, "Faixas geradas com sucesso!")

    return {
        "instrumental": inst_out_path,
        "backing": backing_out_path,
        "lead_vocal": lead_out_path,
        "sample_rate": sr
    }
