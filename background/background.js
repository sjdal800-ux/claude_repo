// Service worker: the only place that talks to the Anthropic API, so the
// API key never has to be duplicated into content-script code and stays
// out of the page context YouTube controls.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return {
    apiKey: "",
    model: DEFAULT_MODEL,
    autoIntervalSeconds: 45,
    autoScreenshots: true,
    aiEnabled: true,
    ...(settings || {}),
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

async function callClaude({ apiKey, model, videoTitle, transcriptChunk, rangeStart, rangeEnd }) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      messages: [{ role: "user", content: buildPrompt(videoTitle, transcriptChunk, rangeStart, rangeEnd) }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = (data.content || []).map((b) => b.text || "").join("").trim();
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
        const notes = await callClaude({
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
        const res = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": message.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: message.model || DEFAULT_MODEL,
            max_tokens: 8,
            messages: [{ role: "user", content: "Reply with OK." }],
          }),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          sendResponse({ ok: false, error: `HTTP ${res.status}: ${t.slice(0, 200)}` });
          return;
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
});
