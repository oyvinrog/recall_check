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
const openQuizBtn = document.getElementById("open-quiz");
const referenceSourceEl = document.getElementById("reference-source");

const urlStatusEl = document.getElementById("url-status");
const urlCategoryEl = document.getElementById("url-category");
const loadRandomUrlBtn = document.getElementById("load-random-url");
const openSourceBtn = document.getElementById("open-source");
const urlInputEl = document.getElementById("url-input");
const addUrlBtn = document.getElementById("add-url");
const categoryInputEl = document.getElementById("category-input");
const addCategoryBtn = document.getElementById("add-category");
const urlListEl = document.getElementById("url-list");
const urlStatsEl = document.getElementById("url-stats");

const settingsToggle = document.getElementById("settings-toggle");
const settingsClose = document.getElementById("settings-close");
const settingsDrawer = document.getElementById("settings-drawer");
const apiKeyInput = document.getElementById("api-key");
const saveKeyBtn = document.getElementById("save-key");

const keyModal = document.getElementById("key-modal");
const apiKeyModalInput = document.getElementById("api-key-modal");
const saveKeyModalBtn = document.getElementById("save-key-modal");

const SESSION_SECONDS = 180;
const URL_LIBRARY_KEY = "recallcheck_url_library";
const URL_STATS_KEY = "recallcheck_url_stats";
const URL_SOURCE_KEY = "recallcheck_source";
const URL_CATEGORY_KEY = "recallcheck_selected_category";
let timerId = null;
let sessionStart = null;
let sessionEnded = false;
let recallPlainText = "";
let activeSource = null;
let isUpdatingReference = false;

const DEFAULT_LIBRARY = {
  categories: [
    { id: "dp-600-spark", name: "DP-600 Spark", urls: [] },
    { id: "dp-600-warehouses", name: "DP-600 Warehouses", urls: [] },
  ],
};

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const setStatus = (text) => {
  statusEl.textContent = text;
};

const setUrlStatus = (text) => {
  if (urlStatusEl) {
    urlStatusEl.textContent = text;
  }
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

const loadUrlLibrary = () => {
  const stored = localStorage.getItem(URL_LIBRARY_KEY);
  if (!stored) {
    return DEFAULT_LIBRARY;
  }
  try {
    const parsed = JSON.parse(stored);
    if (!parsed.categories || !Array.isArray(parsed.categories)) {
      return DEFAULT_LIBRARY;
    }
    return parsed;
  } catch (error) {
    return DEFAULT_LIBRARY;
  }
};

const saveUrlLibrary = (library) => {
  localStorage.setItem(URL_LIBRARY_KEY, JSON.stringify(library));
};

const loadUrlStats = () => {
  const stored = localStorage.getItem(URL_STATS_KEY);
  if (!stored) {
    return {};
  }
  try {
    return JSON.parse(stored) || {};
  } catch (error) {
    return {};
  }
};

const saveUrlStats = (stats) => {
  localStorage.setItem(URL_STATS_KEY, JSON.stringify(stats));
};

const loadActiveSource = () => {
  const stored = localStorage.getItem(URL_SOURCE_KEY);
  if (!stored) {
    return null;
  }
  try {
    return JSON.parse(stored);
  } catch (error) {
    return null;
  }
};

const saveActiveSource = (source) => {
  if (!source) {
    localStorage.removeItem(URL_SOURCE_KEY);
    return;
  }
  localStorage.setItem(URL_SOURCE_KEY, JSON.stringify(source));
};

const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const gradeToScore = (grade) => {
  if (!grade) {
    return null;
  }
  const normalized = grade.trim().toUpperCase();
  const map = { A: 95, B: 85, C: 75, D: 65, F: 50 };
  return map[normalized] ?? null;
};

const scoreToGrade = (score) => {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
};

const updateReferenceSource = () => {
  if (!referenceSourceEl) {
    return;
  }
  if (!activeSource) {
    referenceSourceEl.textContent = "Source: Manual entry.";
    if (openSourceBtn) {
      openSourceBtn.disabled = true;
    }
    return;
  }
  const title = activeSource.title ? ` — ${activeSource.title}` : "";
  referenceSourceEl.textContent = `Source: ${activeSource.categoryName}${title}`;
  if (openSourceBtn) {
    openSourceBtn.disabled = false;
  }
};

const renderUrlStats = (library) => {
  if (!urlStatsEl) {
    return;
  }
  const stats = loadUrlStats();
  const entries = Object.entries(stats);
  if (entries.length === 0) {
    urlStatsEl.innerHTML = '<div class="stats__empty">No scores yet.</div>';
    return;
  }

  const sorted = entries.sort((a, b) => {
    const scoreA = a[1].avgScore ?? 0;
    const scoreB = b[1].avgScore ?? 0;
    return scoreA - scoreB;
  });

  const rows = sorted
    .map(([url, stat]) => {
      const avgGrade = scoreToGrade(stat.avgScore ?? 0);
      const category = stat.categoryName || "Uncategorized";
      return `
        <tr>
          <td class="stats__url">${escapeHtml(url)}</td>
          <td>${escapeHtml(category)}</td>
          <td>${avgGrade} (${stat.avgScore ?? 0}%)</td>
          <td>${stat.attempts ?? 0}</td>
        </tr>
      `;
    })
    .join("");

  urlStatsEl.innerHTML = `
    <table class="stats__table">
      <thead>
        <tr>
          <th>URL</th>
          <th>Category</th>
          <th>Avg</th>
          <th>Tries</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
};

const renderUrlList = (library, selectedCategoryId) => {
  if (!urlListEl) {
    return;
  }
  const category = library.categories.find((item) => item.id === selectedCategoryId);
  if (!category || category.urls.length === 0) {
    urlListEl.innerHTML = "<li>No URLs yet. Add one above.</li>";
    return;
  }

  urlListEl.innerHTML = category.urls
    .map(
      (url, index) => `
        <li>
          <span>${escapeHtml(url)}</span>
          <button data-index="${index}" type="button">Remove</button>
        </li>
      `
    )
    .join("");
};

const renderCategories = (library, selectedCategoryId) => {
  if (!urlCategoryEl) {
    return selectedCategoryId;
  }
  urlCategoryEl.innerHTML = "";
  library.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    urlCategoryEl.appendChild(option);
  });

  const fallbackId =
    selectedCategoryId || (library.categories[0] ? library.categories[0].id : null);
  if (fallbackId) {
    urlCategoryEl.value = fallbackId;
  }
  return fallbackId;
};

const setActiveSource = (source) => {
  activeSource = source;
  saveActiveSource(source);
  updateReferenceSource();
};

const clearActiveSource = () => {
  activeSource = null;
  saveActiveSource(null);
  updateReferenceSource();
};

const setReferenceText = (text, source) => {
  isUpdatingReference = true;
  referenceEl.value = text;
  localStorage.setItem("recallcheck_reference", referenceEl.value);
  isUpdatingReference = false;
  setActiveSource(source);
};

const loadUrlIntoReference = async (url, category) => {
  try {
    setUrlStatus("Fetching text...");
    const result = await invoke("fetch_url_text", { url });
    const text = result?.text?.trim();
    if (!text) {
      throw new Error("No text found at this URL.");
    }
    setReferenceText(text, {
      url,
      categoryId: category.id,
      categoryName: category.name,
      title: result.title || "",
    });
    setUrlStatus("Loaded from URL.");
  } catch (error) {
    setUrlStatus(error?.toString?.() || "Unable to fetch URL.");
  }
};

const initUrlLibrary = () => {
  if (!urlCategoryEl) {
    return;
  }
  const library = loadUrlLibrary();
  let selectedCategoryId = localStorage.getItem(URL_CATEGORY_KEY);
  selectedCategoryId = renderCategories(library, selectedCategoryId);
  if (selectedCategoryId) {
    localStorage.setItem(URL_CATEGORY_KEY, selectedCategoryId);
  }

  renderUrlList(library, selectedCategoryId);
  renderUrlStats(library);

  urlCategoryEl.addEventListener("change", () => {
    const nextId = urlCategoryEl.value;
    localStorage.setItem(URL_CATEGORY_KEY, nextId);
    renderUrlList(library, nextId);
  });

  addCategoryBtn?.addEventListener("click", () => {
    const name = categoryInputEl.value.trim();
    if (!name) {
      setUrlStatus("Category name is required.");
      return;
    }
    const baseId = slugify(name);
    if (!baseId) {
      setUrlStatus("Category name is invalid.");
      return;
    }
    let id = baseId;
    let suffix = 1;
    while (library.categories.some((item) => item.id === id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    library.categories.push({ id, name, urls: [] });
    saveUrlLibrary(library);
    categoryInputEl.value = "";
    selectedCategoryId = renderCategories(library, id);
    renderUrlList(library, selectedCategoryId);
    setUrlStatus("Category added.");
  });

  addUrlBtn?.addEventListener("click", () => {
    const rawUrl = urlInputEl.value.trim();
    if (!rawUrl) {
      setUrlStatus("Paste a URL to add.");
      return;
    }
    let parsedUrl = null;
    try {
      parsedUrl = new URL(rawUrl);
    } catch (error) {
      setUrlStatus("URL looks invalid.");
      return;
    }
    const category = library.categories.find((item) => item.id === selectedCategoryId);
    if (!category) {
      setUrlStatus("Select a category first.");
      return;
    }
    if (category.urls.includes(parsedUrl.toString())) {
      setUrlStatus("URL already exists.");
      return;
    }
    category.urls.push(parsedUrl.toString());
    saveUrlLibrary(library);
    urlInputEl.value = "";
    renderUrlList(library, selectedCategoryId);
    setUrlStatus("URL added.");
  });

  urlListEl?.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }
    const index = Number(button.dataset.index);
    if (Number.isNaN(index)) {
      return;
    }
    const category = library.categories.find((item) => item.id === selectedCategoryId);
    if (!category) {
      return;
    }
    category.urls.splice(index, 1);
    saveUrlLibrary(library);
    renderUrlList(library, selectedCategoryId);
    setUrlStatus("URL removed.");
  });

  loadRandomUrlBtn?.addEventListener("click", () => {
    const category = library.categories.find((item) => item.id === selectedCategoryId);
    if (!category || category.urls.length === 0) {
      setUrlStatus("No URLs in this category.");
      return;
    }
    const choice = category.urls[Math.floor(Math.random() * category.urls.length)];
    loadUrlIntoReference(choice, category);
  });

  openSourceBtn?.addEventListener("click", () => {
    if (!activeSource?.url) {
      setUrlStatus("No active URL.");
      return;
    }
    window.open(activeSource.url, "_blank");
  });
};

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
    if (activeSource && result.grade) {
      const score = gradeToScore(result.grade);
      if (score !== null) {
        const stats = loadUrlStats();
        const existing = stats[activeSource.url] || {
          attempts: 0,
          totalScore: 0,
          avgScore: 0,
          categoryName: activeSource.categoryName,
        };
        existing.attempts += 1;
        existing.totalScore += score;
        existing.avgScore = Math.round(existing.totalScore / existing.attempts);
        existing.lastGrade = result.grade;
        existing.lastWpm = wpm;
        existing.categoryName = activeSource.categoryName;
        existing.title = activeSource.title || "";
        existing.updatedAt = new Date().toISOString();
        stats[activeSource.url] = existing;
        saveUrlStats(stats);
        renderUrlStats(loadUrlLibrary());
      }
    }
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

referenceEl.addEventListener("input", () => {
  localStorage.setItem("recallcheck_reference", referenceEl.value);
  if (!isUpdatingReference) {
    clearActiveSource();
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

const openQuizWindow = () => {
  const referenceText = referenceEl.value.trim();
  localStorage.setItem("recallcheck_reference", referenceText);

  const tauriWindow = window.__TAURI__?.window;
  const WebviewWindow = tauriWindow?.WebviewWindow;
  if (WebviewWindow) {
    const existing = WebviewWindow.getByLabel ? WebviewWindow.getByLabel("quiz") : null;
    if (existing) {
      existing.setFocus();
      return;
    }
    // Separate quiz window for focused practice.
    new WebviewWindow("quiz", {
      title: "RecallCheck Quiz",
      url: "quiz.html",
      width: 760,
      height: 680,
      resizable: true,
    });
    return;
  }

  window.open("quiz.html", "RecallCheckQuiz", "width=760,height=680");
};

if (openQuizBtn) {
  openQuizBtn.addEventListener("click", openQuizWindow);
}

resetSession();
initKeyStatus();
const storedReference = localStorage.getItem("recallcheck_reference");
if (storedReference) {
  referenceEl.value = storedReference;
}
activeSource = loadActiveSource();
updateReferenceSource();
initUrlLibrary();
