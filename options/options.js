(async function () {
  const DEFAULTS = { apiKey: "", model: "claude-sonnet-5", autoIntervalSeconds: 45, autoScreenshots: true, aiEnabled: true };

  const apiKeyInput = document.getElementById("apiKey");
  const modelSelect = document.getElementById("model");
  const aiEnabledInput = document.getElementById("aiEnabled");
  const autoScreenshotsInput = document.getElementById("autoScreenshots");
  const intervalSelect = document.getElementById("interval");
  const keyStatus = document.getElementById("keyStatus");
  const saveToast = document.getElementById("saveToast");

  async function load() {
    const { settings } = await chrome.storage.local.get("settings");
    const s = { ...DEFAULTS, ...(settings || {}) };
    apiKeyInput.value = s.apiKey;
    modelSelect.value = s.model;
    aiEnabledInput.checked = s.aiEnabled;
    autoScreenshotsInput.checked = s.autoScreenshots;
    intervalSelect.value = String(s.autoIntervalSeconds);
  }

  function currentSettings() {
    return {
      apiKey: apiKeyInput.value.trim(),
      model: modelSelect.value,
      aiEnabled: aiEnabledInput.checked,
      autoScreenshots: autoScreenshotsInput.checked,
      autoIntervalSeconds: Number(intervalSelect.value),
    };
  }

  async function save() {
    await chrome.storage.local.set({ settings: currentSettings() });
    saveToast.classList.remove("hidden");
    setTimeout(() => saveToast.classList.add("hidden"), 1500);
  }

  document.getElementById("saveBtn").addEventListener("click", save);
  [modelSelect, aiEnabledInput, autoScreenshotsInput, intervalSelect].forEach((elm) =>
    elm.addEventListener("change", save)
  );

  document.getElementById("testBtn").addEventListener("click", async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      keyStatus.textContent = "Enter a key first.";
      keyStatus.className = "status err";
      return;
    }
    keyStatus.textContent = "Testing…";
    keyStatus.className = "status";
    const resp = await chrome.runtime.sendMessage({ type: "VNAI_TEST_API_KEY", apiKey, model: modelSelect.value });
    if (resp && resp.ok) {
      keyStatus.textContent = "Key works.";
      keyStatus.className = "status ok";
    } else {
      keyStatus.textContent = `Failed: ${(resp && resp.error) || "unknown error"}`;
      keyStatus.className = "status err";
    }
  });

  await load();
})();
