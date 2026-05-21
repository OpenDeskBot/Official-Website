# -*- coding: utf-8 -*-
"""将开场白 WAV 复制到 assets/，供 GitHub Pages 静态部署（无需 Base64、无需本地服务）。"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tts_export_1779355029_9f61c778" / "01_audio" / "tts_export_1779355029_9f61c778.wav"
DST = ROOT / "assets" / "xiaowai-intro.wav"

def main():
    if not SRC.is_file():
        raise FileNotFoundError(f"源文件不存在: {SRC}")
    DST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SRC, DST)
    print(f"OK: {SRC.name} -> {DST} ({DST.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
