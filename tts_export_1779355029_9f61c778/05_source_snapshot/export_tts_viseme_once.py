# -*- coding: utf-8 -*-
"""
一次性导出：合成 WAV + 音素时间轴 + 与 phoneme_face.js 一致的 17 视位 key。

用法（在项目根目录 PaddleSpeech 下，且已安装 PaddleSpeech / Paddle）：
  python tts_web_demo/export_tts_viseme_once.py "你的文本"

输出目录：tts_web_demo/generated_audio/
  - tts_export_<时间戳>_<随机>.wav
  - tts_export_<时间戳>_<随机>.json（含 phoneme_segments 与 viseme_key）
"""

from __future__ import annotations

import json
import re
import sys
import time
import uuid
from pathlib import Path

# 必须先扩展路径，否则本地源码包 paddlespeech 无法优于 site-packages（若未 pip 安装）
MODULE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = MODULE_DIR.parent
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))
if str(MODULE_DIR) not in sys.path:
    sys.path.append(str(MODULE_DIR))

import paddle  # noqa: E402
from paddlespeech.cli.tts.infer import TTSExecutor  # noqa: E402

from tts_phoneme_helper import paddle_tts_infer_with_phoneme_segments  # noqa: E402


def pick_viseme_key(raw_phone: str) -> str:
    """
    与 static/phoneme_face.js 中 pickVisemeKey 规则对齐，便于下游播放器复用。
    """
    s = str(raw_phone or "").strip().lower()
    s = re.sub(r"[0-9]+$", "", s)
    if not s or re.match(r"^(sp|sil|eps|pad|unk|_|#|<.*>)", s):
        return "REST"
    if re.match(r"^iy$", s):
        return "EE"
    if re.match(r"^(ih|ey|ae|eh)$", s):
        return "EH"
    if re.match(r"^(ah|ax|er)$", s):
        return "AH"
    if re.match(r"^(aa|ao)$", s):
        return "AO"
    if re.match(r"^(aw|ay)$", s):
        return "AW"
    if re.match(r"^(ow|oy)$", s):
        return "OH"
    if re.match(r"^(uw|uh)$", s):
        return "OO"
    if re.match(r"^ou$", s):
        return "OU"
    if re.match(r"^(b|m|p)$", s):
        return "BMP"
    if re.match(r"^(ch|jh)$", s):
        return "CHJH"
    if re.match(r"^(f|v)$", s):
        return "FV"
    if re.match(r"^r$", s):
        return "R"
    if re.match(r"^l$", s):
        return "L"
    if re.match(r"^(n|ng)$", s):
        return "N"
    if re.match(r"^(k|g|hh|w|y)$", s):
        return "KG"
    if re.match(r"^(s|z|sh|zh|th|dh|t|d)$", s):
        return "S"
    if re.match(r"^(iou|iu|ui|uei)$", s):
        return "OU"
    if re.match(r"^(ong|eng|en|ang|an|in|ing|un|uen)$", s):
        return "N"
    if re.match(r"^(iong|iang|ian|uang|uan|ua|ue|üe|ve)$", s):
        return "AH"
    if re.match(r"^er$", s):
        return "R"
    if re.match(r"^(ai|ei)$", s):
        return "EH"
    if re.match(r"^(ao|ia)$", s):
        return "AO"
    if re.match(r"^(ou|uo)$", s):
        return "OH"
    if re.match(r"^(u|ü|v|uu)$", s):
        return "OO"
    if re.match(r"^o$", s):
        return "AO"
    if re.match(r"^i$", s):
        return "EE"
    if re.match(r"^(e|ê)$", s):
        return "EH"
    if re.match(r"^a$", s):
        return "AH"
    if re.match(r"^(zh|ch|sh)$", s):
        return "CHJH"
    if re.match(r"^(z|c|s|x|j|q)$", s):
        return "S"
    if re.match(r"^(b|p|m)$", s):
        return "BMP"
    if re.match(r"^(f|v)$", s):
        return "FV"
    if re.match(r"^(k|g|h)$", s):
        return "KG"
    if re.match(r"^l$", s):
        return "L"
    if re.match(r"^(n|ng)$", s):
        return "N"
    if re.match(r"^(d|t)$", s):
        return "S"
    if re.match(r"^r$", s):
        return "R"
    if re.match(r"^[aeiou]", s):
        return "AH"
    return "REST"


def main() -> int:
    text = (
        " ".join(sys.argv[1:]).strip()
        if len(sys.argv) > 1
        else ""
    )
    if not text:
        print("用法: python export_tts_viseme_once.py \"合成文本\"", file=sys.stderr)
        return 2

    am = "fastspeech2_csmsc"
    voc = "hifigan_csmsc"
    lang = "zh"
    device = "cpu"
    spk_id = 0

    audio_dir = MODULE_DIR / "generated_audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    stem = f"tts_export_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    wav_path = audio_dir / f"{stem}.wav"
    json_path = audio_dir / f"{stem}.json"

    paddle.set_device(device)
    executor = TTSExecutor()
    executor._init_from_path(
        am=am,
        am_config=None,
        am_ckpt=None,
        am_stat=None,
        phones_dict=None,
        tones_dict=None,
        speaker_dict=None,
        voc=voc,
        voc_config=None,
        voc_ckpt=None,
        voc_stat=None,
        lang=lang,
    )

    out_abs, segments, note, meta = paddle_tts_infer_with_phoneme_segments(
        executor,
        text=text,
        lang=lang,
        am=am,
        spk_id=spk_id,
        output_path=str(wav_path),
    )

    enriched = []
    for row in segments:
        r = dict(row)
        r["viseme_key"] = pick_viseme_key(row.get("phone", ""))
        enriched.append(r)

    payload = {
        "text": text,
        "request": {"am": am, "voc": voc, "lang": lang, "spk_id": spk_id, "device": device},
        "phoneme_meta": {"note": note, **meta},
        "wav_filename": wav_path.name,
        "wav_path": str(Path(out_abs).resolve()),
        "phoneme_segments": enriched,
        "viseme_catalog_note": (
            "viseme_key 与网页 static/phoneme_face.js 中 17 视位一致："
            "REST/EE/EH/AH/AO/AW/OH/OO/OU/BMP/CHJH/FV/R/L/N/KG/S"
        ),
    }
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(json.dumps({"ok": True, "wav": str(Path(out_abs).resolve()), "json": str(json_path.resolve())}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
