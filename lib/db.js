// Local-first storage backed by chrome.storage.local (NOT page-scoped
// IndexedDB). Two things this buys us, both aimed straight at the original
// complaint that notes would just vanish:
//   1. Every note is written the instant it's created, never buffered only
//      in memory, so a crashed tab or a reload can't lose it.
//   2. chrome.storage.local lives in the extension's own bucket, not
//      youtube.com's site data, so clearing YouTube cookies/site data (or
//      Chrome's own site-data cleanup) does not wipe it. It also means the
//      same notes are visible from the content script, the popup, and the
//      options page without cross-origin IndexedDB headaches.
(function (root) {
  const VIDEOS_KEY = "vnai_videos";
  const NOTES_KEY = "vnai_notes";

  function get(key, fallback) {
    return chrome.storage.local.get(key).then((r) => (r[key] === undefined ? fallback : r[key]));
  }
  function set(key, value) {
    return chrome.storage.local.set({ [key]: value });
  }

  function uid() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  async function upsertVideo(video) {
    const videos = await get(VIDEOS_KEY, {});
    const merged = { ...(videos[video.videoId] || {}), ...video, lastUpdated: Date.now() };
    videos[video.videoId] = merged;
    await set(VIDEOS_KEY, videos);
    return merged;
  }

  async function addNote(note) {
    const notes = await get(NOTES_KEY, []);
    const record = { id: uid(), createdAt: Date.now(), source: "manual", screenshot: null, ...note };
    notes.push(record);
    await set(NOTES_KEY, notes);
    return record;
  }

  async function updateNote(id, patch) {
    const notes = await get(NOTES_KEY, []);
    const idx = notes.findIndex((n) => n.id === id);
    if (idx === -1) return null;
    notes[idx] = { ...notes[idx], ...patch };
    await set(NOTES_KEY, notes);
    return notes[idx];
  }

  async function deleteNote(id) {
    const notes = await get(NOTES_KEY, []);
    await set(NOTES_KEY, notes.filter((n) => n.id !== id));
    return true;
  }

  async function getNotesForVideo(videoId) {
    const notes = await get(NOTES_KEY, []);
    return notes.filter((n) => n.videoId === videoId).sort((a, b) => a.timestamp - b.timestamp);
  }

  async function getAllVideos() {
    const videos = await get(VIDEOS_KEY, {});
    return Object.values(videos).sort((a, b) => b.lastUpdated - a.lastUpdated);
  }

  async function getAllNotes() {
    return get(NOTES_KEY, []);
  }

  async function exportAllAsJson() {
    const [videos, notes] = await Promise.all([getAllVideos(), getAllNotes()]);
    return { exportedAt: new Date().toISOString(), videos, notes };
  }

  root.VNAI_DB = {
    upsertVideo,
    addNote,
    updateNote,
    deleteNote,
    getNotesForVideo,
    getAllVideos,
    getAllNotes,
    exportAllAsJson,
  };
})(typeof window !== "undefined" ? window : globalThis);
