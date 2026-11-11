"""Generate lesson audio with Kokoro TTS.

Usage (from the repo root):
    pip install kokoro soundfile
    python scripts/generate_audio.py            # only missing files
    python scripts/generate_audio.py --force    # regenerate everything
    python scripts/generate_audio.py --module 1 --voice bf_emma

MP3 needs ffmpeg on your PATH (brew install ffmpeg). Without it, WAV files are kept.
"""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
AUDIO = ROOT / "audio"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="bf_emma", help="Kokoro voice (British: bf_emma, bf_isabella, bm_george, bm_lewis)")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--module", type=int, help="Only this module number")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    AUDIO.mkdir(exist_ok=True)
    course = json.loads((CONTENT / "course.json").read_text(encoding="utf-8"))
    pipeline = KPipeline(lang_code="b")  # 'b' = British English
    has_ffmpeg = shutil.which("ffmpeg") is not None

    for m in course["modules"]:
        if not m["file"] or (args.module and m["id"] != args.module):
            continue
        mod = json.loads((CONTENT / m["file"]).read_text(encoding="utf-8"))
        for lesson in mod["lessons"]:
            stem = f"m{mod['id']:02d}-l{lesson['id']:02d}"
            mp3, wav = AUDIO / f"{stem}.mp3", AUDIO / f"{stem}.wav"
            if mp3.exists() and not args.force:
                print(f"skip {stem}")
                continue
            print(f"generating {stem}: {lesson['title']}")
            chunks = [audio for _, _, audio in pipeline(lesson["narration"], voice=args.voice, speed=args.speed, split_pattern=r"\n+")]
            sf.write(wav, np.concatenate(chunks), 24000)
            if has_ffmpeg:
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-ac", "1", "-b:a", "64k", str(mp3)], check=True)
                wav.unlink()
            else:
                print("  ffmpeg not found: kept WAV (the site expects .mp3)")
    print("done")


if __name__ == "__main__":
    main()
