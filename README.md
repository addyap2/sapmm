# SAP MM — Trainer Track

Mobile-first course site (static, no build step) for learning SAP S/4HANA MM and turning it into a sellable training module.

- Syllabus: [SYLLABUS.md](SYLLABUS.md)
- Content: `content/course.json` + one JSON file per module
- Audio: `audio/mXX-lYY.mp3`, generated with Kokoro (falls back to the device voice if missing)
- Progress is saved on the device (localStorage)
- **MM Sandbox** (`/sandbox/`): simulated SAP GUI + Fiori-style launchpad covering the C_TS452 MM scope: master data (MM01–03, BP, ME11–13, ME01/ME03), purchasing (ME51N–ME5A, ME21N–ME2N, RFQ ME41–ME49, contracts ME31K–ME33K, scheduling agreements ME31L/ME38, ME56/ME57/ME59N), release strategies (ME28/ME29N/ME54N/ME55) and output (ME9F), inventory (MIGO with all main movement types, reservations MB21–MB25, physical inventory MI01–MI20, MMBE/MB51/MB52), invoice verification (MIRO/MIR7/MIR4/MIR6, MR8M, MRBR, MRRL, MRKO, F110, FBL1N), MRP (MD61/MD01/MD03/MD04), valuation (MR21, MB5L), special procurement (consignment, subcontracting), customizing (SPRO, OBYC, OMR6, OMJJ) and Fiori apps (/UI2/FLP). 20 guided trainer scenarios with automatic step checks. Data is fictional and stored on the device; reset/export/import from the Trainer panel. Code: `sandbox/sim.js` (core) + `sandbox/mm-*.js` modules
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
