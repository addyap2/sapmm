# SAP MM — Trainer Track

Mobile-first course site (static, no build step) for learning SAP S/4HANA MM and turning it into a sellable training module.

- Syllabus: [SYLLABUS.md](SYLLABUS.md)
- Content: `content/course.json` + one JSON file per module
- Audio: `audio/mXX-lYY.mp3`, generated with Kokoro (falls back to the device voice if missing)
- Progress is saved on the device (localStorage)
- **MM Sandbox** (`/sandbox/`): simulated SAP GUI for procure-to-pay practice: MM01/MM03, BP, ME11/ME13, ME51N/ME53N/ME5A, ME21N/ME23N, ME2N/ME2M, MIGO, MIRO/MIR4/MRBR, MMBE, MB52, MB51, MB5S, FB03. Six guided trainer scenarios with automatic step checks. Data is fictional and stored on the device; reset/export/import from the Trainer panel
- Installable on your phone: open the site → Share → Add to Home Screen

## Deploy on Vercel
Import the repo in Vercel → Framework preset: **Other** → no build command → deploy.

## Generate audio (Kokoro)
```bash
pip install kokoro soundfile
brew install ffmpeg            # for MP3 output
python scripts/generate_audio.py
git add audio && git commit -m "Add audio" && git push
```
Options: `--voice bm_george`, `--module 2`, `--speed 0.95`, `--force`.

## Add a module
1. Create `content/module-XX.json` (copy the structure of `module-01.json`)
2. Set `"file": "module-XX.json"` for that module in `content/course.json`
3. Generate audio, commit, push
