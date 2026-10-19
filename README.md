# ⚡ Discord Quest Parallel Auto-Completer (Captcha-Safe Edition)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Discord%20Desktop%20%7C%20Vencord-5865F2)](https://discord.com)
[![Status](https://img.shields.io/badge/Status-Working%20(2026)-57F287.svg)]()
[![Captcha Safe](https://img.shields.io/badge/Captcha%20Safe-Manual%20UI%20Claim-57F287.svg)]()

> A universal, safe quest auto-completer for Discord. Automatically runs and tracks **all available Discord Quests in batches of 2** with strict anti-ban safeguards. Once a quest reaches 100%, you safely claim the reward & solve captcha in Discord's native UI, and the script **automatically detects the claim and starts the next 2 quests from the queue!**

---

## 🛡️ Captcha-Safe & Anti-Ban Architecture

Due to Discord's recent anti-bot updates, automated API reward claiming (`/claim-reward`) triggers hCaptcha / Cloudflare Turnstile verification. Calling the claim API automatically without solving the captcha leads to the *Inauthentic Engagement* flag (*Quest Access Suspended*).

### How this script solves it completely:
1. **Automated Emulation:** Runs at most **2 quests concurrently** (`MAX_CONCURRENT = 2`) with real-time 1x video playback and 20s game heartbeats.
2. **100% Completion Notification:** As soon as a quest hits 100%, the script plays an audio chime and shows an alert asking you to claim the reward in Discord's Gift Inventory / Quests tab.
3. **Legitimate Captcha Solving:** You solve the captcha normally in Discord's official interface.
4. **Auto-Advancing Queue:** The script listens for Discord's internal `QUESTS_CLAIM_REWARD_SUCCESS` event. The moment your claim is confirmed, the script **automatically pulls the next quest from the queue and starts it!**

---

## ✨ Features

- **📝 Auto-Discovery & Auto-Enroll:** Automatically detects and accepts all available quests without needing to click "Accept Quest" in Discord first.
- **🔄 Automatic Queue Batching (`MAX_CONCURRENT = 2`):** Processes quests 2 at a time for safety.
- **🛡️ Captcha-Safe Manual Claiming:** Zero risk of automated claim bot flags.
- **⏱️ Natural 1x Speed for Video Quests:** Real wall-clock elapsed time matching.
- **🎮 Universal Game Support:** Bypasses empty executable lists (`"executables": []`) in Discord's detectable database via `RunningGameStore`.
- **🎯 Universal Task Coverage:**
  - `PLAY_ON_DESKTOP` (Any desktop game)
  - `WATCH_VIDEO` / `WATCH_VIDEO_ON_MOBILE` (Real-time speed matching)
  - `STREAM_ON_DESKTOP` (Stream spoofing with active metadata)
  - `PLAY_ACTIVITY` (Gracefully handled voice call activities)

---

## 🚀 Quick Start

Choose either **Method 1 (Vencord 1-Click Button)** or **Method 2 (DevTools Console)**:

### Method 1: Vencord 1-Click Button Integration (Recommended)

1. Download or clone this folder.
2. Run the installer:
   ```bash
   python vencord_installer.py
   ```
3. In Discord, reload by pressing **`Ctrl + R`** (or click *Relaunch Discord*).
4. Open Discord Settings → **Vencord**.
5. Under **Quick Actions**, simply click:
   👉 **`⚡ Auto-Complete Quests`**

---

### Method 2: DevTools Console (Zero Installation)

1. Open your **Discord Desktop App**.
2. Open Developer Tools using **`Ctrl + Shift + I`** or **`F12`**.
   > *Note for AMD Radeon users:* If pressing `Ctrl + Shift + I` takes a screenshot instead, open AMD Software (`Alt + R`) → *Settings* → *Hotkeys* → delete the shortcut for *Take Screenshot*.
3. Click the **Console** tab.
4. If Discord shows a safety warning, type `allow pasting` and hit **Enter**.
5. Copy all code from [`quest_completer.js`](quest_completer.js), paste it into the console, and hit **Enter**.

---

## 🔄 The Workflow

```
[Start 2 Quests] ──► [Progress to 100%] ──► [🔔 Alert: "Claim Reward in Discord"]
                                                          │
                                         [You click Claim & solve captcha]
                                                          │
[Next Quest in Queue Starts Automtically] ◄── [Script Detects Claim]
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
