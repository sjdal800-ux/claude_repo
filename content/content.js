(function () {
  if (document.getElementById("vnai-toggle")) return; // already injected

  const DB = window.VNAI_DB;
  const EXPORT = window.VNAI_EXPORT;

  const state = {
    videoId: null,
    videoTitle: "",
    notes: [],
    transcriptCues: null, // null = unknown/unavailable, [] = fetched but empty
    lastAiCheckTime: 0,
    aiBusy: false,
    settings: { apiKey: "", model: "claude-sonnet-5", autoIntervalSeconds: 45, autoScreenshots: true, aiEnabled: true },
    panelOpen: false,
    canvas: document.createElement("canvas"),
  };

  // ---------------------------------------------------------------- UI ----

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") e.className = v;
        else if (k === "html") e.innerHTML = v;
        else e.setAttribute(k, v);
      }
    }
    (children || []).forEach((c) => c && e.appendChild(c));
    return e;
  }

  let refs = {};

  function buildUI() {
    const toggle = el("button", { id: "vnai-toggle", title: "Video Notes AI" }, []);
    toggle.textContent = "📝";
    toggle.addEventListener("click", () => setPanelOpen(!state.panelOpen));

    const brandIcon = el("img", { src: chrome.runtime.getURL("icons/icon32.png"), width: "18", height: "18" });
    const brand = el("div", { class: "vnai-brand" }, [brandIcon, document.createTextNode(" Video Notes AI")]);

    const videoTitleEl = el("div", { class: "vnai-video-title" }, []);

    const aiSwitchInput = el("input", { type: "checkbox" });
    aiSwitchInput.addEventListener("change", () => {
      state.settings.aiEnabled = aiSwitchInput.checked;
      persistSettings();
    });
    const aiSwitch = el("label", { class: "vnai-switch" }, [aiSwitchInput, document.createTextNode("Auto AI notes")]);

    const settingsBtn = el("button", { class: "vnai-icon-btn", title: "Settings" }, []);
    settingsBtn.textContent = "⚙";
    settingsBtn.addEventListener("click", () => {
      window.open(chrome.runtime.getURL("options/options.html"), "_blank");
    });

    const closeBtn = el("button", { class: "vnai-icon-btn", title: "Close" }, []);
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => setPanelOpen(false));

    const titleRow = el("div", { class: "vnai-title-row" }, [brand, el("div", {}, [aiSwitch]), settingsBtn, closeBtn]);
    const status = el("div", { id: "vnai-status" }, []);

    const header = el("div", { id: "vnai-header" }, [titleRow, videoTitleEl, status]);

    const notesList = el("div", { id: "vnai-notes" }, []);

    const addNoteBtn = el("button", { class: "vnai-btn vnai-primary" }, []);
    addNoteBtn.textContent = "+ Note";
    addNoteBtn.addEventListener("click", showQuickAddForm);

    const captureBtn = el("button", { class: "vnai-btn" }, []);
    captureBtn.textContent = "📸 Capture";
    captureBtn.addEventListener("click", quickCaptureScreenshot);

    const exportMdBtn = el("button", { class: "vnai-btn" }, []);
    exportMdBtn.textContent = "Export .md";
    exportMdBtn.addEventListener("click", () => doExport("md"));

    const exportPdfBtn = el("button", { class: "vnai-btn" }, []);
    exportPdfBtn.textContent = "Export .pdf";
    exportPdfBtn.addEventListener("click", () => doExport("pdf"));

    const exportJsonBtn = el("button", { class: "vnai-btn" }, []);
    exportJsonBtn.textContent = "Backup .json";
    exportJsonBtn.addEventListener("click", () => doExport("json"));

    const footer = el("div", { id: "vnai-footer" }, [addNoteBtn, captureBtn, exportMdBtn, exportPdfBtn, exportJsonBtn]);

    const panel = el("div", { id: "vnai-panel", class: "vnai-hidden" }, [header, notesList, footer]);

    const lightboxImg = el("img", {});
    const lightbox = el("div", { id: "vnai-lightbox", class: "vnai-hidden" }, [lightboxImg]);
    lightbox.addEventListener("click", () => lightbox.classList.add("vnai-hidden"));

    document.body.appendChild(toggle);
    document.body.appendChild(panel);
    document.body.appendChild(lightbox);

    refs = { toggle, panel, videoTitleEl, status, notesList, lightbox, lightboxImg, aiSwitchInput };
  }

  function setPanelOpen(open) {
    state.panelOpen = open;
    refs.panel.classList.toggle("vnai-hidden", !open);
  }

  function setStatus(text, isError) {
    refs.status.textContent = text || "";
    refs.status.classList.toggle("vnai-error", !!isError);
  }

  function renderHeader() {
    refs.videoTitleEl.textContent = state.videoTitle || "";
    refs.aiSwitchInput.checked = !!state.settings.aiEnabled;
  }

  function renderNotes() {
    refs.notesList.innerHTML = "";
    if (!state.notes.length) {
      const empty = el("div", { class: "vnai-empty" }, []);
      empty.textContent = "No notes yet. Turn on Auto AI notes (needs captions) or use + Note / Capture to add your own.";
      refs.notesList.appendChild(empty);
      return;
    }
    for (const note of state.notes) {
      refs.notesList.appendChild(renderNoteCard(note));
    }
  }

  function renderNoteCard(note) {
    const tsBtn = el("button", { class: "vnai-ts" }, []);
    tsBtn.textContent = EXPORT.fmtTime(note.timestamp);
    tsBtn.addEventListener("click", () => seekTo(note.timestamp));

    const tag = el("span", { class: "vnai-source-tag" }, []);
    tag.textContent = note.source === "ai" ? "AI" : "manual";

    const delBtn = el("button", { class: "vnai-icon-btn", title: "Delete" }, []);
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", async () => {
      await DB.deleteNote(note.id);
      state.notes = state.notes.filter((n) => n.id !== note.id);
      renderNotes();
    });

    const row = el("div", { class: "vnai-note-row" }, [tsBtn, tag, el("div", { class: "vnai-note-spacer" }), delBtn]);

    const text = el("div", { class: "vnai-note-text", contenteditable: "true" }, []);
    text.textContent = note.text || "";
    text.addEventListener("blur", async () => {
      const newText = text.textContent.trim();
      if (newText !== note.text) {
        note.text = newText;
        await DB.updateNote(note.id, { text: newText });
      }
    });

    const card = el("div", { class: "vnai-note" }, [row, text]);

    if (note.screenshot) {
      const img = el("img", { class: "vnai-note-shot", src: note.screenshot });
      img.addEventListener("click", () => {
        refs.lightboxImg.src = note.screenshot;
        refs.lightbox.classList.remove("vnai-hidden");
      });
      card.appendChild(img);
    }

    return card;
  }

  function showQuickAddForm() {
    const video = getVideoEl();
    const ts = video ? video.currentTime : 0;
    const wrap = el("div", { class: "vnai-note" }, []);
    const textarea = el("textarea", {
      style: "width:100%;min-height:50px;background:#0e0e12;color:#e7e7ea;border:1px solid #303038;border-radius:6px;padding:6px;font:inherit;",
      placeholder: `Note at ${EXPORT.fmtTime(ts)}...`,
    });
    const saveBtn = el("button", { class: "vnai-btn vnai-primary" }, []);
    saveBtn.textContent = "Save";
    const cancelBtn = el("button", { class: "vnai-btn" }, []);
    cancelBtn.textContent = "Cancel";
    const row = el("div", { class: "vnai-note-row", style: "margin-top:6px;" }, [saveBtn, cancelBtn]);
    wrap.appendChild(el("div", { class: "vnai-note-row" }, [document.createTextNode(EXPORT.fmtTime(ts))]));
    wrap.appendChild(textarea);
    wrap.appendChild(row);
    refs.notesList.prepend(wrap);
    textarea.focus();

    cancelBtn.addEventListener("click", () => wrap.remove());
    saveBtn.addEventListener("click", async () => {
      const text = textarea.value.trim();
      if (!text) return wrap.remove();
      await addNoteToDbAndUi({ timestamp: ts, text, source: "manual" });
      wrap.remove();
    });
  }

  async function quickCaptureScreenshot() {
    const video = getVideoEl();
    const ts = video ? video.currentTime : 0;
    const shot = captureFrame();
    await addNoteToDbAndUi({ timestamp: ts, text: "", source: "manual", screenshot: shot });
  }

  async function doExport(kind) {
    if (!state.videoId) return;
    const video = { videoId: state.videoId, title: state.videoTitle };
    try {
      if (kind === "md") EXPORT.exportMarkdown(video, state.notes);
      else if (kind === "json") EXPORT.exportJson(video, state.notes);
      else if (kind === "pdf") await EXPORT.exportPdf(video, state.notes);
    } catch (e) {
      setStatus(`Export failed: ${e.message || e}`, true);
    }
  }

  // ------------------------------------------------------------ Video ----

  function getVideoEl() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function seekTo(seconds) {
    const video = getVideoEl();
    if (video) video.currentTime = seconds;
  }

  function captureFrame() {
    const video = getVideoEl();
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    try {
      const w = Math.min(480, video.videoWidth);
      const h = Math.round(w * (video.videoHeight / video.videoWidth));
      state.canvas.width = w;
      state.canvas.height = h;
      const ctx = state.canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, w, h);
      return state.canvas.toDataURL("image/jpeg", 0.72);
    } catch (e) {
      return null;
    }
  }

  async function addNoteToDbAndUi(partial) {
    const record = await DB.addNote({
      videoId: state.videoId,
      videoTitle: state.videoTitle,
      ...partial,
    });
    state.notes.push(record);
    state.notes.sort((a, b) => a.timestamp - b.timestamp);
    renderNotes();
    return record;
  }

  // -------------------------------------------------------- Transcript ----

  function pickTrack(tracks) {
    if (!tracks || !tracks.length) return null;
    return tracks.find((t) => t.isDefault) || tracks.find((t) => (t.languageCode || "").startsWith("en")) || tracks[0];
  }

  async function fetchTranscript(tracks) {
    const track = pickTrack(tracks);
    if (!track) {
      state.transcriptCues = [];
      return;
    }
    try {
      const url = track.baseUrl + (track.baseUrl.includes("fmt=") ? "" : "&fmt=json3");
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const cues = [];
      for (const ev of data.events || []) {
        if (!ev.segs) continue;
        const text = ev.segs.map((s) => s.utf8 || "").join("").replace(/\n/g, " ").trim();
        if (!text) continue;
        cues.push({ start: (ev.tStartMs || 0) / 1000, dur: (ev.dDurationMs || 0) / 1000, text });
      }
      state.transcriptCues = cues;
    } catch (e) {
      state.transcriptCues = [];
    }
  }

  function transcriptChunkFor(rangeStart, rangeEnd) {
    if (!state.transcriptCues) return "";
    return state.transcriptCues
      .filter((c) => c.start + c.dur > rangeStart && c.start < rangeEnd)
      .map((c) => c.text)
      .join(" ")
      .trim();
  }

  // ---------------------------------------------------------------- AI ----

  async function processChunk(rangeStart, rangeEnd) {
    const text = transcriptChunkFor(rangeStart, rangeEnd);
    state.lastAiCheckTime = rangeEnd;
    if (text.length < 25) return;

    state.aiBusy = true;
    setStatus("Analyzing…");
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "VNAI_EXTRACT_NOTES",
        videoTitle: state.videoTitle,
        transcriptChunk: text,
        rangeStart,
        rangeEnd,
      });
      if (!resp || !resp.ok) {
        if (resp && resp.error === "NO_API_KEY") {
          setStatus("Add your Anthropic API key in Settings to enable AI notes.", true);
        } else {
          setStatus(`AI error: ${(resp && resp.error) || "unknown"}`, true);
        }
        return;
      }
      for (const n of resp.notes) {
        const ts = Math.min(Math.max(n.timestamp, rangeStart), rangeEnd);
        let shot = null;
        if (n.screenshot && state.settings.autoScreenshots) shot = captureFrame();
        await addNoteToDbAndUi({ timestamp: ts, text: n.text, source: "ai", screenshot: shot });
      }
      setStatus(`Synced up to ${EXPORT.fmtTime(rangeEnd)}`);
    } catch (e) {
      setStatus(`AI error: ${e.message || e}`, true);
    } finally {
      state.aiBusy = false;
    }
  }

  function tick() {
    if (!location.pathname.startsWith("/watch")) return;
    const video = getVideoEl();
    if (!video || video.paused || !state.videoId) return;
    if (!state.settings.aiEnabled || state.aiBusy) return;
    if (!state.transcriptCues || !state.transcriptCues.length) return;

    const ct = video.currentTime;
    const rangeStart = Math.max(state.lastAiCheckTime, ct - 180);
    if (ct - rangeStart >= state.settings.autoIntervalSeconds) {
      processChunk(rangeStart, ct);
    }
  }

  setInterval(tick, 4000);

  // ------------------------------------------------------------ Setup ----

  async function persistSettings() {
    await chrome.storage.local.set({ settings: state.settings });
  }

  async function loadSettings() {
    const resp = await chrome.runtime.sendMessage({ type: "VNAI_GET_SETTINGS" });
    if (resp && resp.ok) state.settings = resp.settings;
    renderHeader();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      state.settings = { ...state.settings, ...changes.settings.newValue };
      renderHeader();
    }
  });

  async function resetForVideo(detail) {
    state.videoId = detail.videoId;
    state.videoTitle = detail.title || "";
    state.transcriptCues = null;
    state.lastAiCheckTime = 0;
    state.notes = [];

    renderHeader();
    setStatus("Loading…");

    await DB.upsertVideo({
      videoId: state.videoId,
      title: state.videoTitle,
      url: `https://www.youtube.com/watch?v=${state.videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${state.videoId}/mqdefault.jpg`,
    });

    state.notes = await DB.getNotesForVideo(state.videoId);
    renderNotes();

    await fetchTranscript(detail.captionTracks);
    if (!state.transcriptCues.length) {
      setStatus("No captions found — AI auto-notes disabled. Manual notes & screenshots still work.");
    } else {
      setStatus("Ready.");
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "VNAI_OPEN_PANEL") setPanelOpen(true);
  });

  window.addEventListener("vnai:playerResponse", (e) => {
    const detail = e.detail;
    if (!detail || detail.videoId === state.videoId) return;
    resetForVideo(detail);
  });

  (async function init() {
    buildUI();
    await loadSettings();
  })();
})();
