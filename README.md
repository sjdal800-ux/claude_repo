# Video Notes AI

A Chrome extension for real-time note-taking while watching YouTube videos: AI-generated key points with clickable timestamps, AI-flagged screenshots, and reliable local-first saving — with Markdown/PDF/JSON export.

This was built to fix the specific failure modes of similar "AI video notes" extensions: glitchy AI output and, worst of all, notes that silently disappear. The fixes here are architectural, not cosmetic:

- **Every note is written to storage the instant it's created.** Nothing is buffered only in memory and flushed later — there's no "batch save" step that can fail and lose a session's work.
- **Notes live in the extension's own storage bucket** (`chrome.storage.local`), not in YouTube's site data. Clearing YouTube cookies/site data does not touch your notes.
- **You can export anytime** as Markdown, PDF, or a full JSON backup — of one video or, from the popup, everything you've ever saved.

## Features

- Floating notes panel on any `youtube.com/watch` page.
- **Auto AI notes**: periodically sends the video's transcript (captions) to Gemini, which extracts concise key points with real timestamps — click a timestamp to seek the video.
- **Auto screenshots**: when the AI judges a moment is visual (diagram, code, chart, on-screen text), it flags it and the extension captures the current video frame automatically.
- **Manual notes & capture**: `+ Note` and `📸 Capture` always work, with or without an API key or captions — for videos without captions, or when you just want to jot something down yourself.
- Inline editing (click any note's text) and delete.
- Export a video's notes as **Markdown** (with embedded screenshots), **PDF**, or **JSON**.
- Popup shows every video you've taken notes on, with quick export and a one-click full backup.
- All processing is local; the only network call is your own request to the Gemini API using your own key.

## Why bring your own API key

There's no backend server here — that's what keeps this free and keeps your notes private. AI note-taking calls the Gemini API directly from your browser using an API key you provide (Settings → paste your key). This means:

- No subscription, no server costs to you beyond Google's own token pricing — Gemini's free tier is generally enough for regular note-taking, and Gemini 2.0 Flash is cheaper still if you outgrow it.
- Your key and your video transcripts never pass through any third party — the request goes straight from your browser to `generativelanguage.googleapis.com`.
- Manual note-taking and screenshot capture work with **no key at all**, so the extension is still useful for free even without AI.

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

## Install (unpacked, for now — not yet published to the Chrome Web Store)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open a YouTube video, click the floating 📝 button (bottom-right), then the ⚙ gear to add your Gemini API key.
5. Turn on "Auto AI notes" in the panel (on by default) — notes start appearing as the video plays, if it has captions.

Requires a Chromium-based browser recent enough to support MV3 `"world": "MAIN"` content scripts (Chrome 111+ / any current Chrome, Edge, Brave).

## How it works

- `content/inject.js` runs in the page's own JS context to read YouTube's player state (video id, title, caption tracks) and broadcasts it to the extension via a DOM event — this is necessary because YouTube doesn't expose this through the DOM directly.
- `content/content.js` builds the notes panel, fetches the caption track as a transcript, captures video frames to a canvas for screenshots, and on an interval sends the newest chunk of transcript to the background service worker for AI extraction.
- `background/background.js` is the only place that calls the Gemini API, using the key you saved in Settings.
- `lib/db.js` is a thin wrapper around `chrome.storage.local`, shared by the content script, popup, and options page.
- `lib/export.js` + the vendored `jsPDF` build handle Markdown/PDF/JSON export.

## Known limitations (MVP)

- AI auto-notes require the video to have captions (auto-generated captions work fine). No captions → the panel says so and falls back to manual notes/screenshots.
- The auto-captured screenshot is taken from the current frame when the AI response comes back, which lags the flagged moment by a few seconds (network round-trip). Use the manual `📸 Capture` button for a screenshot at an exact moment.
- Export destinations are "download to your machine" (Markdown/PDF/JSON) — from there, dragging into Notion/Drive/Obsidian/etc. is a normal file import, but there's no built-in cloud-sync integration yet.
- Single browser only: notes are stored locally per-browser-profile, not synced across devices.

## Privacy

- No analytics, no telemetry, no third-party server. The only outbound request AI notes make is your browser → `generativelanguage.googleapis.com`, authenticated with the key you provide.
- Your API key is stored only in `chrome.storage.local` on your machine.
