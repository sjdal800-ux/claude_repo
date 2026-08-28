// Runs in the page's MAIN world (has access to YouTube's own player APIs).
// Its only job: watch for the current video's id/title/caption tracks and
// broadcast them to the isolated-world content script via a DOM event,
// since chrome.* APIs are not available here.
(function () {
  function readPlayerResponse() {
    const player = document.getElementById("movie_player");
    if (player && typeof player.getPlayerResponse === "function") {
      try {
        const pr = player.getPlayerResponse();
        if (pr && pr.videoDetails) return pr;
      } catch (e) {
        /* player not ready yet */
      }
    }
    if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.videoDetails) {
      return window.ytInitialPlayerResponse;
    }
    return null;
  }

  function tick() {
    const pr = readPlayerResponse();
    if (pr && pr.videoDetails) {
      const tracks =
        (pr.captions &&
          pr.captions.playerCaptionsTracklistRenderer &&
          pr.captions.playerCaptionsTracklistRenderer.captionTracks) ||
        [];
      window.dispatchEvent(
        new CustomEvent("vnai:playerResponse", {
          detail: {
            videoId: pr.videoDetails.videoId,
            title: pr.videoDetails.title,
            author: pr.videoDetails.author,
            lengthSeconds: Number(pr.videoDetails.lengthSeconds || 0),
            captionTracks: tracks.map((t) => ({
              baseUrl: t.baseUrl,
              languageCode: t.languageCode,
              kind: t.kind || "",
              isDefault: !!t.isDefault,
            })),
          },
        })
      );
    }
  }

  setInterval(tick, 1000);
  document.addEventListener("yt-navigate-finish", tick, true);
  tick();
})();
