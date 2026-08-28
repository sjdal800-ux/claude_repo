// Service worker: the only place that talks to the Gemini API, so the
// API key never has to be duplicated into content-script code and stays
// out of the page context YouTube controls.

const GEMINI_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";

// Optional local override: background/config.js is git-ignored (see
// .gitignore) so a key placed there never gets committed. Copy
// background/config.example.js to background/config.js and fill in
// GEMINI_API_KEY to skip the Settings page entirely. Loaded dynamically
// (not a static import) so a missing file degrades gracefully instead of
// breaking the whole service worker.
let localConfigKeyPromise = null;
function getLocalConfigKey() {
  if (!localConfigKeyPromise) {
    localConfigKeyPromise = import("./config.js")
      .then((mod) => mod.GEMINI_API_KEY || "")
      .catch(() => "");
  }
  return localConfigKeyPromise;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const stored = settings || {};
  const localKey = await getLocalConfigKey();
  return {
    apiKey: (stored.apiKey && stored.apiKey.trim()) || localKey || "",
    model: stored.model || DEFAULT_MODEL,
    autoIntervalSeconds: stored.autoIntervalSeconds ?? 45,
    autoScreenshots: stored.autoScreenshots ?? true,
    aiEnabled: stored.aiEnabled ?? true,
  };
}

function buildPrompt(videoTitle, transcriptChunk, rangeStart, rangeEnd) {
  return `Video title: "${videoTitle}"
Transcript segment covering roughly ${Math.round(rangeStart)}s to ${Math.round(rangeEnd)}s:
"""
${transcriptChunk}
"""

Extract 0 to 2 concise, high-value study notes from this segment only. Skip filler, greetings, and anything not conceptually important. Only include a note if it teaches something worth remembering.

Respond with ONLY minified JSON, no prose, matching exactly:
{"notes":[{"timestamp":<number seconds within the segment range>,"text":"<concise note, max 160 chars>","screenshot":<true|false>}]}

Set "screenshot" true only when the moment is visual (diagram, code, chart, on-screen text/formula) and a captured frame would meaningfully help. If nothing is worth noting, return {"notes":[]}.`;
}

async function callGemini({ apiKey, model, prompt, maxOutputTokens }) {
  const url = `${GEMINI_URL_BASE}/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: maxOutputTokens || 512,
        temperature: 0.4,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const candidate = (data.candidates || [])[0];
  if (!candidate) {
    const reason = data.promptFeedback?.blockReason;
    throw new Error(reason ? `Gemini blocked the request: ${reason}` : "Gemini returned no candidates");
  }
  return (candidate.content?.parts || []).map((p) => p.text || "").join("").trim();
}

async function extractNotes({ apiKey, model, videoTitle, transcriptChunk, rangeStart, rangeEnd }) {
  const raw = await callGemini({
    apiKey,
    model,
    prompt: buildPrompt(videoTitle, transcriptChunk, rangeStart, rangeEnd),
    maxOutputTokens: 512,
  });

  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) throw new Error("AI response did not contain JSON");
  const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  if (!Array.isArray(parsed.notes)) return [];
  return parsed.notes
    .filter((n) => n && typeof n.text === "string" && n.text.trim())
    .map((n) => ({
      timestamp: typeof n.timestamp === "number" ? n.timestamp : rangeStart,
      text: n.text.trim().slice(0, 220),
      screenshot: !!n.screenshot,
    }));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "VNAI_EXTRACT_NOTES") {
    (async () => {
      try {
        const settings = await getSettings();
        if (!settings.apiKey) {
          sendResponse({ ok: false, error: "NO_API_KEY" });
          return;
        }
        const notes = await extractNotes({
          apiKey: settings.apiKey,
          model: settings.model || DEFAULT_MODEL,
          videoTitle: message.videoTitle,
          transcriptChunk: message.transcriptChunk,
          rangeStart: message.rangeStart,
          rangeEnd: message.rangeEnd,
        });
        sendResponse({ ok: true, notes });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    })();
    return true; // keep the message channel open for the async response
  }

  if (message?.type === "VNAI_GET_SETTINGS") {
    getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  if (message?.type === "VNAI_TEST_API_KEY") {
    (async () => {
      try {
        await callGemini({
          apiKey: message.apiKey,
          model: message.model || DEFAULT_MODEL,
          prompt: "Reply with the single word OK.",
          maxOutputTokens: 8,
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    })();
    return true;
  }
});
