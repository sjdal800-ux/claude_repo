// Export helpers shared by the in-page sidebar and the popup. Everything
// happens locally in the browser — no server, no upload — the user just
// gets a file (or files) via the browser's normal download flow, which they
// can then put wherever they like (Drive, Notion, local disk, etc).
(function (root) {
  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function fmtTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }
  function safeFilename(name) {
    return (name || "video-notes").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  }
  function youtubeLink(videoId, seconds) {
    return `https://youtu.be/${videoId}?t=${Math.floor(seconds || 0)}`;
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function toMarkdown(video, notes) {
    const lines = [];
    lines.push(`# ${video.title || "Video Notes"}`);
    lines.push("");
    if (video.videoId) lines.push(`Source: https://www.youtube.com/watch?v=${video.videoId}`);
    lines.push(`Exported: ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("---");
    lines.push("");
    for (const note of notes) {
      const link = video.videoId ? youtubeLink(video.videoId, note.timestamp) : "#";
      lines.push(`### [${fmtTime(note.timestamp)}](${link})${note.source === "ai" ? " · AI" : ""}`);
      lines.push("");
      lines.push(note.text || "");
      if (note.screenshot) {
        lines.push("");
        lines.push(`![screenshot at ${fmtTime(note.timestamp)}](${note.screenshot})`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  function exportMarkdown(video, notes) {
    const md = toMarkdown(video, notes);
    downloadBlob(`${safeFilename(video.title)}.md`, new Blob([md], { type: "text/markdown" }));
  }

  function exportJson(video, notes) {
    const payload = { video, notes, exportedAt: new Date().toISOString() };
    downloadBlob(`${safeFilename(video.title)}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  }

  async function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async function exportPdf(video, notes) {
    if (!root.jspdf || !root.jspdf.jsPDF) {
      throw new Error("PDF library not loaded");
    }
    const { jsPDF } = root.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 40;
    const maxW = pageW - margin * 2;
    let y = margin;

    function ensureSpace(h) {
      if (y + h > pageH - margin) {
        doc.addPage();
        y = margin;
      }
    }

    doc.setFontSize(16);
    doc.setFont(undefined, "bold");
    const titleLines = doc.splitTextToSize(video.title || "Video Notes", maxW);
    doc.text(titleLines, margin, y);
    y += titleLines.length * 18 + 6;

    doc.setFontSize(9);
    doc.setFont(undefined, "normal");
    doc.setTextColor(120);
    if (video.videoId) {
      doc.text(`https://www.youtube.com/watch?v=${video.videoId}`, margin, y);
      y += 14;
    }
    doc.text(`Exported ${new Date().toLocaleString()}`, margin, y);
    y += 18;
    doc.setTextColor(0);

    for (const note of notes) {
      ensureSpace(30);
      doc.setFontSize(10);
      doc.setFont(undefined, "bold");
      doc.setTextColor(79, 70, 229);
      doc.text(`[${fmtTime(note.timestamp)}]${note.source === "ai" ? "  (AI)" : ""}`, margin, y);
      doc.setTextColor(0);
      y += 14;

      doc.setFontSize(11);
      doc.setFont(undefined, "normal");
      const bodyLines = doc.splitTextToSize(note.text || "", maxW);
      ensureSpace(bodyLines.length * 14);
      doc.text(bodyLines, margin, y);
      y += bodyLines.length * 14 + 6;

      if (note.screenshot) {
        try {
          const img = await loadImage(note.screenshot);
          const ratio = img.width / img.height;
          let w = Math.min(maxW, 320);
          let h = w / ratio;
          ensureSpace(h + 10);
          doc.addImage(note.screenshot, "JPEG", margin, y, w, h);
          y += h + 14;
        } catch (e) {
          /* skip broken image */
        }
      }
      y += 6;
    }

    doc.save(`${safeFilename(video.title)}.pdf`);
  }

  root.VNAI_EXPORT = { fmtTime, toMarkdown, exportMarkdown, exportJson, exportPdf, downloadBlob, safeFilename };
})(typeof window !== "undefined" ? window : globalThis);
