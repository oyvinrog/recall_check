# RecallCheck

![Rust](https://img.shields.io/badge/Rust-1.70%2B-000000?logo=rust&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-desktop-444444)
![License](https://img.shields.io/badge/License-MIT-2E7D32)

RecallCheck is a Tauri + Rust desktop app for timed recall practice. You recite a subject in the editor, get WPM and a letter grade after three minutes, and see incorrect parts annotated with comments plus a list of missing ideas.

## Highlights
- 3-minute timed recall with WPM and A–F grading.
- OpenAI evaluation with incorrect span annotations and missing material list.
- Secure API key storage in the system keyring, editable in Settings.
- Designed, high-impact UI with a focused workspace.

## How It Works
1) Paste the reference text.
2) Start typing in the recall editor to begin the timer.
3) After 3 minutes, RecallCheck computes WPM and sends the recall + reference to OpenAI for grading.
4) Incorrect segments are marked in-line; missing concepts are listed below.

## Requirements
- Rust toolchain
- Tauri prerequisites for your OS
- Python 3 (used to serve the static UI in dev)

## Run (Dev)
```bash
cargo tauri dev
```

## Settings
- The OpenAI API key is stored in your OS keyring.
- On first run you’ll be prompted for a key; you can update it anytime in Settings.

## Structure
- `src-tauri/` — Rust backend (keyring + OpenAI evaluation).
- `ui/` — static UI (HTML/CSS/JS).

## Notes
- Grading uses the `gpt-4o-mini` model and expects strict JSON output.
- The UI is served at `http://127.0.0.1:1420` in dev mode.

## License
MIT
