const promptEl = document.getElementById("prompt");
const sourceEl = document.getElementById("source");
const answerEl = document.getElementById("answer");
const feedbackEl = document.getElementById("feedback");
const confidenceEl = document.getElementById("confidence");
const confidenceDeltaEl = document.getElementById("confidence-delta");
const confidenceBarEl = document.getElementById("confidence-bar");
const streakEl = document.getElementById("streak");
const attemptsEl = document.getElementById("attempts");
const quizCardEl = document.getElementById("quiz-card");

const checkAnswerBtn = document.getElementById("check-answer");
const nextQuestionBtn = document.getElementById("next-question");
const reloadReferenceBtn = document.getElementById("reload-reference");

const STATE = {
  reference: "",
  segments: [],
  current: null,
  attempts: 0,
  totalScore: 0,
  confidence: 0,
  streak: 0,
};

const normalize = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const splitSegments = (text) => {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return [];
  }

  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const usable = sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 6);

  if (usable.length > 0) {
    return usable;
  }

  const words = cleaned.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += 12) {
    const chunk = words.slice(i, i + 12).join(" ");
    if (chunk.split(/\s+/).length >= 6) {
      chunks.push(chunk);
    }
  }
  return chunks.length > 0 ? chunks : [cleaned];
};

const buildQuestion = () => {
  const segment = STATE.segments[Math.floor(Math.random() * STATE.segments.length)];
  const words = segment.split(/\s+/);
  const maskCount = Math.min(3, Math.max(2, Math.floor(words.length / 5)));
  const start = Math.floor(Math.random() * (words.length - maskCount));
  const answerWords = words.slice(start, start + maskCount);
  const promptWords = [...words];

  for (let i = start; i < start + maskCount; i += 1) {
    promptWords[i] = "____";
  }

  return {
    segment,
    prompt: promptWords.join(" "),
    answer: answerWords.join(" "),
    answerWords,
  };
};

const updateStats = (score, expectedCount, previousConfidence) => {
  STATE.attempts += 1;
  STATE.totalScore += score;
  STATE.confidence = Math.round(STATE.totalScore / STATE.attempts);

  const delta = STATE.confidence - previousConfidence;
  const deltaLabel = `${delta >= 0 ? "+" : ""}${delta}%`;

  confidenceEl.textContent = `${STATE.confidence}%`;
  confidenceDeltaEl.textContent = deltaLabel;
  confidenceDeltaEl.classList.toggle("is-negative", delta < 0);
  confidenceBarEl.style.width = `${STATE.confidence}%`;

  if (score >= 80) {
    STATE.streak += 1;
  } else {
    STATE.streak = 0;
  }

  streakEl.textContent = String(STATE.streak);
  attemptsEl.textContent = `${STATE.attempts} ${STATE.attempts === 1 ? "try" : "tries"}`;

  feedbackEl.textContent = `Score ${score}% (${Math.min(
    expectedCount,
    Math.round((score / 100) * expectedCount)
  )}/${expectedCount} words).`;
};

const renderQuestion = () => {
  if (STATE.segments.length === 0) {
    STATE.current = null;
    promptEl.textContent = "Paste reference text in the main window.";
    sourceEl.textContent = "Waiting for content.";
    answerEl.value = "";
    feedbackEl.textContent = "";
    return;
  }

  STATE.current = buildQuestion();
  promptEl.textContent = STATE.current.prompt;
  sourceEl.textContent = `From: ${STATE.current.segment}`;
  answerEl.value = "";
  feedbackEl.textContent = "";

  quizCardEl.classList.remove("is-fresh");
  void quizCardEl.offsetWidth;
  quizCardEl.classList.add("is-fresh");
};

const checkAnswer = () => {
  if (!STATE.current) {
    return;
  }

  const expected = normalize(STATE.current.answer).split(/\s+/).filter(Boolean);
  const response = normalize(answerEl.value).split(/\s+/).filter(Boolean);

  if (response.length === 0) {
    feedbackEl.textContent = "Type your answer before checking.";
    return;
  }

  let correct = 0;
  const limit = Math.min(expected.length, response.length);
  for (let i = 0; i < limit; i += 1) {
    if (expected[i] === response[i]) {
      correct += 1;
    }
  }

  const score = expected.length > 0 ? Math.round((correct / expected.length) * 100) : 0;
  const previousConfidence = STATE.confidence;

  updateStats(score, expected.length, previousConfidence);

  feedbackEl.textContent = `Expected: "${STATE.current.answer}". Your score: ${score}%.`;
};

const reloadReference = () => {
  const stored = localStorage.getItem("recallcheck_reference") || "";
  STATE.reference = stored.trim();
  STATE.segments = splitSegments(STATE.reference);

  if (STATE.segments.length === 0) {
    STATE.current = null;
    promptEl.textContent = "Paste reference text in the main window.";
    sourceEl.textContent = "Waiting for content.";
  } else {
    renderQuestion();
  }
};

checkAnswerBtn.addEventListener("click", checkAnswer);
nextQuestionBtn.addEventListener("click", renderQuestion);
reloadReferenceBtn.addEventListener("click", reloadReference);

window.addEventListener("storage", (event) => {
  if (event.key === "recallcheck_reference") {
    reloadReference();
  }
});

reloadReference();
