const getInvoke = () => {
  const tauriGlobal = window.__TAURI__;
  if (tauriGlobal?.tauri?.invoke) {
    return tauriGlobal.tauri.invoke;
  }
  if (tauriGlobal?.core?.invoke) {
    return tauriGlobal.core.invoke;
  }
  return () => Promise.reject(new Error("Tauri not available"));
};

const invoke = getInvoke();

const timerEl = document.getElementById("timer");
const wpmEl = document.getElementById("wpm");
const gradeEl = document.getElementById("grade");
const gradeNoteEl = document.getElementById("grade-note");
const statusEl = document.getElementById("status");
const referenceEl = document.getElementById("reference");
const recallEl = document.getElementById("recall");
const missingEl = document.getElementById("missing");
const summaryEl = document.getElementById("summary");
const startOverBtn = document.getElementById("start-over");

const settingsToggle = document.getElementById("settings-toggle");
const settingsClose = document.getElementById("settings-close");
const settingsDrawer = document.getElementById("settings-drawer");
const apiKeyInput = document.getElementById("api-key");
const saveKeyBtn = document.getElementById("save-key");

const keyModal = document.getElementById("key-modal");
const apiKeyModalInput = document.getElementById("api-key-modal");
const saveKeyModalBtn = document.getElementById("save-key-modal");

const SESSION_SECONDS = 180;
let timerId = null;
let sessionStart = null;
let sessionEnded = false;
let recallPlainText = "";

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const setStatus = (text) => {
  statusEl.textContent = text;
};

const setTimer = (secondsLeft) => {
  timerEl.textContent = formatTime(secondsLeft);
};

const resetResults = () => {
  wpmEl.textContent = "—";
  gradeEl.textContent = "—";
  gradeNoteEl.textContent = "Awaiting recall";
  missingEl.innerHTML = "";
  summaryEl.textContent = "";
};

const resetSession = () => {
  if (timerId) {
    clearInterval(timerId);
  }
  timerId = null;
  sessionStart = null;
  sessionEnded = false;
  recallPlainText = "";
  recallEl.contentEditable = "true";
  recallEl.innerText = "";
  setTimer(SESSION_SECONDS);
  resetResults();
  setStatus("Waiting for input.");
};

const getWordCount = (text) => {
  const cleaned = text.trim();
  if (!cleaned) {
    return 0;
  }
  return cleaned.split(/\s+/).length;
};

const escapeHtml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const applyHighlights = (text, spans) => {
  if (!spans || spans.length === 0) {
    recallEl.innerText = text;
    return;
  }

  const ordered = [...spans]
    .filter((span) => span.start >= 0 && span.end <= text.length && span.end > span.start)
    .sort((a, b) => a.start - b.start);

  let cursor = 0;
  let html = "";

  for (const span of ordered) {
    if (span.start < cursor) {
      continue;
    }
    html += escapeHtml(text.slice(cursor, span.start));
    html += `<mark data-comment="${escapeHtml(span.comment)}">${escapeHtml(
      text.slice(span.start, span.end)
    )}</mark>`;
    cursor = span.end;
  }

  html += escapeHtml(text.slice(cursor));
  recallEl.innerHTML = html;
};

const renderMissing = (missing) => {
  if (!missing || missing.length === 0) {
    missingEl.innerHTML = "<li>No missing material. Nice work.</li>";
    return;
  }

  missingEl.innerHTML = missing.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
};

const finishSession = async () => {
  if (sessionEnded) {
    return;
  }
  sessionEnded = true;
  recallEl.contentEditable = "false";
  recallPlainText = recallEl.innerText;

  const words = getWordCount(recallPlainText);
  const wpm = Math.round(words / (SESSION_SECONDS / 60));
  wpmEl.textContent = String(wpm);

  setStatus("Scoring with OpenAI...");
  gradeNoteEl.textContent = "Grading in progress";

  try {
    if (!referenceEl.value.trim()) {
      throw new Error("Reference text is empty.");
    }

    const result = await invoke("evaluate_recall", {
      payload: {
        reference: referenceEl.value.trim(),
        recall: recallPlainText,
      },
    });

    gradeEl.textContent = result.grade || "—";
    gradeNoteEl.textContent = "Scored";
    applyHighlights(recallPlainText, result.incorrect_spans || []);
    renderMissing(result.missing || []);
    summaryEl.textContent = result.summary || "";
    setStatus("Session complete.");
  } catch (error) {
    const message = error?.toString?.() || "Unable to score.";
    gradeNoteEl.textContent = "Scoring failed";
    setStatus(message);
    if (message.includes("Missing API key")) {
      keyModal.classList.add("open");
      keyModal.setAttribute("aria-hidden", "false");
    }
  }
};

const startTimer = () => {
  if (timerId) {
    return;
  }
  sessionStart = Date.now();
  setStatus("Timer running.");

  timerId = setInterval(() => {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const remaining = Math.max(0, SESSION_SECONDS - elapsed);
    setTimer(remaining);

    if (remaining <= 0) {
      clearInterval(timerId);
      timerId = null;
      finishSession();
    }
  }, 250);
};

recallEl.addEventListener("input", () => {
  if (!sessionStart && recallEl.innerText.trim().length > 0) {
    startTimer();
  }
});

startOverBtn.addEventListener("click", resetSession);

settingsToggle.addEventListener("click", () => {
  settingsDrawer.classList.add("open");
  settingsDrawer.setAttribute("aria-hidden", "false");
});

settingsClose.addEventListener("click", () => {
  settingsDrawer.classList.remove("open");
  settingsDrawer.setAttribute("aria-hidden", "true");
});

const saveApiKey = async (value) => {
  if (!value || value.trim().length < 10) {
    setStatus("API key looks too short.");
    return;
  }
  await invoke("set_api_key", { key: value.trim() });
  apiKeyInput.value = "";
  apiKeyModalInput.value = "";
  setStatus("API key saved.");
  keyModal.classList.remove("open");
  keyModal.setAttribute("aria-hidden", "true");
};

saveKeyBtn.addEventListener("click", () => saveApiKey(apiKeyInput.value));
saveKeyModalBtn.addEventListener("click", () => saveApiKey(apiKeyModalInput.value));

const initKeyStatus = async () => {
  try {
    const status = await invoke("get_api_key_status");
    if (!status.exists) {
      keyModal.classList.add("open");
      keyModal.setAttribute("aria-hidden", "false");
    }
  } catch (error) {
    setStatus("Unable to read keyring.");
  }
};

resetSession();
initKeyStatus();
