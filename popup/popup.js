(async function () {
  const DB = window.VNAI_DB;
  const EXPORT = window.VNAI_EXPORT;

  document.getElementById("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.getElementById("backupBtn").addEventListener("click", async () => {
    const payload = await DB.exportAllAsJson();
    EXPORT.downloadBlob(`video-notes-ai-backup-${Date.now()}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  });

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function videoIdFromUrl(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtube.com") && u.pathname === "/watch") return u.searchParams.get("v");
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  async function renderCurrent() {
    const tab = await getActiveTab();
    const videoId = tab && videoIdFromUrl(tab.url);
    const section = document.getElementById("currentVideo");
    if (!videoId) {
      section.classList.add("hidden");
      return;
    }
    const notes = await DB.getNotesForVideo(videoId);
    document.getElementById("currentTitle").textContent = tab.title.replace(/ - YouTube$/, "");
    document.getElementById("currentCount").textContent = `${notes.length} note${notes.length === 1 ? "" : "s"} saved`;
    section.classList.remove("hidden");

    document.getElementById("openPanelBtn").onclick = () => {
      chrome.tabs.sendMessage(tab.id, { type: "VNAI_OPEN_PANEL" }).catch(() => {});
      window.close();
    };
  }

  async function renderVideoList() {
    const list = document.getElementById("videoList");
    const videos = await DB.getAllVideos();
    list.innerHTML = "";
    if (!videos.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No notes yet. Open a YouTube video to get started.";
      list.appendChild(empty);
      return;
    }
    for (const video of videos) {
      const notes = await DB.getNotesForVideo(video.videoId);
      const row = document.createElement("div");
      row.className = "video-row";

      const img = document.createElement("img");
      img.src = video.thumbnail || "";
      row.appendChild(img);

      const info = document.createElement("div");
      info.className = "info";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = video.title || video.videoId;
      title.addEventListener("click", () => chrome.tabs.create({ url: video.url }));
      const count = document.createElement("div");
      count.className = "count";
      count.textContent = `${notes.length} note${notes.length === 1 ? "" : "s"}`;
      info.appendChild(title);
      info.appendChild(count);
      row.appendChild(info);

      const actions = document.createElement("div");
      actions.className = "actions";

      const mdBtn = document.createElement("button");
      mdBtn.title = "Export Markdown";
      mdBtn.textContent = "📝";
      mdBtn.addEventListener("click", () => EXPORT.exportMarkdown(video, notes));

      const pdfBtn = document.createElement("button");
      pdfBtn.title = "Export PDF";
      pdfBtn.textContent = "📄";
      pdfBtn.addEventListener("click", () => EXPORT.exportPdf(video, notes));

      actions.appendChild(mdBtn);
      actions.appendChild(pdfBtn);
      row.appendChild(actions);

      list.appendChild(row);
    }
  }

  renderCurrent();
  renderVideoList();
})();
