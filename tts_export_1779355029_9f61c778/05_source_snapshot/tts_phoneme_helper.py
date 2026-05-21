# -*- coding: utf-8 -*-
"""
本模块在 TTS Web 体验中补充「音素级时间轴」能力。

说明：PaddleSpeech 的 TTSExecutor 默认只写出 wav，不返回音素时长。
对 FastSpeech2 系声学模型，可从 acoustic_model.inference 取得每音素预测帧数，
再结合配置中的 n_shift、fs 换算为秒级起止时间。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import paddle
import soundfile as sf
from paddlespeech.t2s.exps.syn_utils import run_frontend


def _load_id2phone(phones_dict_path: str) -> Dict[int, str]:
    """从 phones_dict 文件构建「音素 id → 符号」映射。"""
    id2phone: Dict[int, str] = {}
    with open(phones_dict_path, "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 2:
                phn, pid = parts[0], int(parts[1])
                id2phone[pid] = phn
    return id2phone


def _am_cfg_value(cfg: Any, name: str, default: int) -> int:
    """从 yacs CfgNode 或字典式配置中安全读取整型字段。"""
    if cfg is None:
        return default
    if hasattr(cfg, name):
        return int(getattr(cfg, name))
    try:
        return int(cfg[name])
    except Exception:
        return default


def _rows_from_fastspeech2_durations(
    part_phone_ids: paddle.Tensor,
    d_outs: paddle.Tensor,
    id2phone: Dict[int, str],
    hop_samples: int,
    sample_rate: int,
) -> List[Dict[str, Any]]:
    """
    将 FastSpeech2 预测的每音素帧数 d_outs 转为带起止秒数的一行一行数据。

    每帧对应 hop_samples / sample_rate 秒（与梅尔谱 hop 一致）。
    """
    sec_per_frame = hop_samples / float(sample_rate)
    pids = part_phone_ids.numpy().tolist()
    durs = d_outs.numpy().tolist()
    rows: List[Dict[str, Any]] = []
    t = 0.0
    for pid, dur in zip(pids, durs):
        dur_frames = max(0.0, float(dur))
        dur_sec = dur_frames * sec_per_frame
        ip = int(pid)
        sym = id2phone.get(ip, f"<id_{ip}>")
        row = {
            "phone": sym,
            "phone_id": ip,
            "duration_frames": int(round(dur_frames)),
            "start_sec": round(t, 5),
            "end_sec": round(t + dur_sec, 5),
            "duration_sec": round(dur_sec, 5),
        }
        rows.append(row)
        t += dur_sec
    return rows


def _flatten_sentence_segments(
    phoneme_sentences: List[List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    """多句拼接时，把各句局部时间轴平铺为全局时间（秒）。"""
    flat: List[Dict[str, Any]] = []
    offset = 0.0
    for si, rows in enumerate(phoneme_sentences):
        for row in rows:
            flat.append(
                {
                    "sentence_index": si,
                    "phone": row["phone"],
                    "phone_id": row["phone_id"],
                    "duration_frames": row["duration_frames"],
                    "start_sec": round(offset + row["start_sec"], 5),
                    "end_sec": round(offset + row["end_sec"], 5),
                    "duration_sec": row["duration_sec"],
                }
            )
        if rows:
            offset += rows[-1]["end_sec"]
    return flat


def paddle_tts_infer_with_phoneme_segments(
    executor: Any,
    text: str,
    lang: str,
    am: str,
    spk_id: int,
    output_path: str,
) -> Tuple[str, List[Dict[str, Any]], str, Dict[str, int]]:
    """
    在已完成 _init_from_path 的 TTSExecutor 上执行合成，并尽量附带音素时间轴。

    Returns:
        (wav 绝对路径, 平铺后的音素行列表, 人类可读说明字符串, 采样与 hop 元数据)
    """
    am_name = am[: am.rindex("_")]
    am_dataset = am[am.rindex("_") + 1 :]
    get_tone_ids = am_name == "speedyspeech"

    frontend_dict = run_frontend(
        frontend=executor.frontend,
        text=text,
        merge_sentences=False,
        get_tone_ids=get_tone_ids,
        lang=lang,
    )
    phone_ids = frontend_dict["phone_ids"]

    fs = _am_cfg_value(executor.am_config, "fs", 24000)
    hop = _am_cfg_value(executor.am_config, "n_shift", 300)

    phoneme_sentences: List[List[Dict[str, Any]]] = []
    phoneme_note = ""

    if am_name == "fastspeech2":
        id2phone = _load_id2phone(executor.phones_dict)
        phoneme_note = (
            "以下为 FastSpeech2 预测的每音素梅尔帧数换算得到的时间轴；"
            "与真实发音边界可能存在偏差，仅供对齐与调试参考。"
        )
    elif am_name == "speedyspeech":
        phoneme_note = (
            "当前声学模型为 SpeedySpeech：CLI 封装未导出逐音素时长，"
            "本页暂不展示时间戳。"
        )
    elif am_name == "tacotron2":
        phoneme_note = (
            "当前声学模型为 Tacotron2：自回归解码不暴露与 FastSpeech2 相同的帧级音素时长，"
            "本页暂不展示时间戳。"
        )
    else:
        phoneme_note = f"当前声学模型类型为 {am_name}，本页未实现音素时间轴导出。"

    wav_all = None
    flags = 0

    for i in range(len(phone_ids)):
        part_phone_ids = phone_ids[i]

        if am_name == "speedyspeech":
            part_tone_ids = frontend_dict["tone_ids"][i]
            mel = executor.am_inference(part_phone_ids, part_tone_ids)
        elif am_name == "fastspeech2":
            ac = executor.am_inference.acoustic_model
            norm = executor.am_inference.normalizer
            if am_dataset in {"aishell3", "vctk", "mix", "canton"}:
                normalized_mel, d_outs, _p, _e = ac.inference(
                    part_phone_ids, spk_id=paddle.to_tensor([spk_id])
                )
            else:
                normalized_mel, d_outs, _p, _e = ac.inference(part_phone_ids)
            mel = norm.inverse(normalized_mel)
            rows = _rows_from_fastspeech2_durations(
                part_phone_ids, d_outs, id2phone, hop, fs
            )
            phoneme_sentences.append(rows)
        else:
            if am_dataset in {"aishell3", "vctk", "mix", "canton"}:
                mel = executor.am_inference(
                    part_phone_ids, spk_id=paddle.to_tensor([spk_id])
                )
            else:
                mel = executor.am_inference(part_phone_ids)

        wav = executor.voc_inference(mel)
        if flags == 0:
            wav_all = wav
            flags = 1
        else:
            wav_all = paddle.concat([wav_all, wav])

    out_abs = output_path
    # 与 TTSExecutor.postprocess 一致，使用声学配置中的采样率写 wav。
    sf.write(out_abs, wav_all.numpy(), samplerate=fs)

    flat = _flatten_sentence_segments(phoneme_sentences) if phoneme_sentences else []
    meta = {"sample_rate": fs, "hop_samples": hop}
    return out_abs, flat, phoneme_note, meta
