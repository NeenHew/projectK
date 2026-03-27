import { db, rtdb, ensureAnonAuth } from "./firebase.js";
import { $, toast, safePinFromString, normalizeName, createCooldown, clamp, computeSpeedBonus } from "./util.js";
import { QUESTIONS } from "./quiz-data.js";
import { joinRoomAsPlayer, submitAnswer } from "./room-api.js";

const cooldown = createCooldown();

const els = {
  joinCard: $("joinCard"),
  gameCard: $("gameCard"),
  nameInput: $("nameInput"),
  pinInput: $("pinInput"),
  btnJoin: $("btnJoin"),

  roomPin: $("roomPin"),
  playerName: $("playerName"),
  score: $("score"),
  questionText: $("questionText"),
  timeLeft: $("timeLeft"),
  progressFill: $("progressFill"),
  statusText: $("statusText"),
  answersGrid: $("answersGrid"),

  revealCard: $("revealCard"),
  correctAnswer: $("correctAnswer"),
  resultText: $("resultText"),
};

let pin = null;
let uid = null;
let name = null;
let meta = null;
let myScore = 0;
let selectedChoice = null;
let answeredForQ = new Set(); // local guard

let metaUnsub = null;
let scoreUnsub = null;
let answerEchoUnsub = null;

function renderAnswers(qIndex) {
  const q = QUESTIONS[qIndex];
  els.answersGrid.innerHTML = "";
  if (!q) return;

  const letters = ["A", "B", "C", "D"];
  for (let i = 0; i < 4; i++) {
    const btn = document.createElement("button");
    btn.className = "answerBtn";
    btn.type = "button";
    btn.dataset.choice = String(i);
    btn.innerHTML = `<span class="letter">${letters[i]}</span>${escapeHtml(q.choices[i] ?? "—")}`;
    btn.addEventListener("click", () => handleAnswer(i, btn));
    els.answersGrid.appendChild(btn);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}

function setJoinMode() {
  els.joinCard.style.display = "";
  els.gameCard.style.display = "none";
}

function setGameMode() {
  els.joinCard.style.display = "none";
  els.gameCard.style.display = "";
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function setReveal({ show, correctIdx, isCorrect }) {
  els.revealCard.style.display = show ? "" : "none";
  if (!show) return;
  els.correctAnswer.textContent = correctIdx == null ? "—" : `Option ${"ABCD"[correctIdx]}`;
  els.resultText.textContent =
    isCorrect == null ? "—" : isCorrect ? "You got it!" : "Not this time.";
}

function disableAnswers(disabled) {
  const btns = els.answersGrid.querySelectorAll("button.answerBtn");
  for (const b of btns) b.disabled = disabled;
}

function markSelection(choice) {
  const btns = els.answersGrid.querySelectorAll("button.answerBtn");
  for (const b of btns) {
    const c = Number(b.dataset.choice);
    b.classList.toggle("selected", c === choice);
  }
}

function markReveal(qIndex) {
  const correct = QUESTIONS[qIndex]?.correct;
  const btns = els.answersGrid.querySelectorAll("button.answerBtn");
  for (const b of btns) {
    const c = Number(b.dataset.choice);
    b.classList.toggle("correct", c === correct);
    if (selectedChoice != null) b.classList.toggle("wrong", c === selectedChoice && c !== correct);
  }
}

async function handleAnswer(choice, btn) {
  if (!pin || !uid || !meta) return;
  const qIndex = meta.questionIndex ?? 0;

  // Prevent spam clicking locally (fast UX), plus DB rules enforce write-once.
  if (!cooldown("answer", 600)) return;
  if (meta.status !== "running") return;
  if (answeredForQ.has(qIndex)) return;
  const durationMs = meta.questionDurationMs ?? 15000;
  const endAt = (meta.questionStartAt ?? 0) + durationMs;
  if (Date.now() > endAt) return;

  selectedChoice = choice;
  markSelection(choice);
  disableAnswers(true);
  setStatus("Submitting…");

  const answeredAt = Date.now();

  try {
    await submitAnswer({
      pin,
      questionIndex: qIndex,
      choice,
      answeredAtMs: answeredAt,
      durationMs,
    });
    answeredForQ.add(qIndex);
    setStatus("Answer submitted.");
  } catch (e) {
    // If rules rejected due to already answered, treat as submitted.
    const msg = e?.message ?? String(e);
    if (msg.toLowerCase().includes("permission_denied")) {
      answeredForQ.add(qIndex);
      setStatus("Answer locked.");
      return;
    }
    toast(msg);
    setStatus("Could not submit. Try again.");
    disableAnswers(false);
  }
}

function attachRoomListeners() {
  cleanup();
  if (!pin || !uid) return;

  // Player listens to:
  // - meta (small)
  // - own score (tiny)
  // - own answer echo for current q (optional UX)
  const metaRef = rtdb.ref(db, `rooms/${pin}/meta`);
  metaUnsub = rtdb.onValue(metaRef, (snap) => {
    meta = snap.val();
    renderFromMeta();
  });

  const scoreRef = rtdb.ref(db, `rooms/${pin}/players/${uid}/score`);
  scoreUnsub = rtdb.onValue(scoreRef, (snap) => {
    const v = snap.val();
    myScore = typeof v === "number" ? v : 0;
    els.score.textContent = String(myScore);
  });
}

function attachAnswerEcho(qIndex) {
  if (!pin || !uid) return;
  if (answerEchoUnsub) {
    try {
      rtdb.off(rtdb.ref(db, `rooms/${pin}/answers/${qIndex}/${uid}`));
    } catch (_) {}
    answerEchoUnsub = null;
  }
  const aRef = rtdb.ref(db, `rooms/${pin}/answers/${qIndex}/${uid}`);
  answerEchoUnsub = rtdb.onValue(aRef, (snap) => {
    const v = snap.val();
    if (!v) return;
    answeredForQ.add(qIndex);
    selectedChoice = v.choice;
    markSelection(selectedChoice);
    disableAnswers(true);
  });
}

function cleanup() {
  if (!pin) return;
  try {
    rtdb.off(rtdb.ref(db, `rooms/${pin}/meta`));
    rtdb.off(rtdb.ref(db, `rooms/${pin}/players/${uid}/score`));
    if (meta?.questionIndex != null) rtdb.off(rtdb.ref(db, `rooms/${pin}/answers/${meta.questionIndex}/${uid}`));
  } catch (_) {}
  metaUnsub = scoreUnsub = answerEchoUnsub = null;
}

function renderFromMeta() {
  if (!meta) return;
  const qIndex = meta.questionIndex ?? 0;
  const q = QUESTIONS[qIndex];

  els.roomPin.textContent = pin;
  els.playerName.textContent = name ?? "—";

  if (!q) {
    els.questionText.textContent = meta.status === "ended" ? "Quiz ended." : "Waiting for host…";
    els.answersGrid.innerHTML = "";
    disableAnswers(true);
    setReveal({ show: false });
    setStatus("—");
    return;
  }

  // If new question, reset local UI state quickly (no extra DB reads).
  const qKey = qIndex;
  if (!answeredForQ.has(qKey) && meta.status === "running") {
    selectedChoice = null;
  }

  els.questionText.textContent = q.text;
  renderAnswers(qIndex);
  attachAnswerEcho(qIndex);

  if (meta.status === "lobby") {
    disableAnswers(true);
    setReveal({ show: false });
    setStatus("Waiting for host to start…");
    return;
  }

  if (meta.status === "running") {
    setReveal({ show: false });
    const already = answeredForQ.has(qIndex);
    const dur = meta.questionDurationMs ?? 15000;
    const endAt = (meta.questionStartAt ?? 0) + dur;
    disableAnswers(already || Date.now() > endAt);
    setStatus(already ? "Answer locked." : "Pick one option.");
    return;
  }

  if (meta.status === "reveal" || meta.status === "ended") {
    disableAnswers(true);
    const correct = QUESTIONS[qIndex]?.correct;
    const isCorrect = selectedChoice != null ? selectedChoice === correct : null;
    setReveal({ show: true, correctIdx: correct, isCorrect });
    markReveal(qIndex);
    setStatus(meta.status === "ended" ? "Final results." : "Answer revealed.");
  }
}

function startTicker() {
  setInterval(() => {
    if (!meta?.questionStartAt || meta.status === "lobby") {
      els.timeLeft.textContent = "--";
      els.progressFill.style.width = "0%";
      return;
    }
    const start = meta.questionStartAt ?? 0;
    const dur = Math.max(1, meta.questionDurationMs ?? 15000);
    const end = start + dur;
    const left = Math.max(0, end - Date.now());
    const pct = clamp((left / dur) * 100, 0, 100);
    els.timeLeft.textContent = String(Math.ceil(left / 1000));
    els.progressFill.style.width = `${pct}%`;

    // Once time is over, lock answers on client (rules also enforce).
    if (left === 0 && meta.status === "running") {
      disableAnswers(true);
    }
  }, 150);
}

function hydrateFromQuery() {
  const url = new URL(window.location.href);
  const qPin = url.searchParams.get("pin");
  if (qPin) els.pinInput.value = safePinFromString(qPin);
}

async function joinFlow() {
  const enteredName = normalizeName(els.nameInput.value);
  const enteredPin = safePinFromString(els.pinInput.value);
  if (!enteredName) return toast("Enter a name");
  if (enteredPin.length !== 6) return toast("Enter a 6-digit PIN");
  if (!cooldown("join", 900)) return;

  els.btnJoin.disabled = true;
  els.btnJoin.textContent = "Joining…";
  try {
    const u = await ensureAnonAuth();
    uid = u.uid;
    pin = enteredPin;
    name = enteredName;

    await joinRoomAsPlayer(pin, name);
    setGameMode();
    attachRoomListeners();
    toast("Joined!");
  } catch (e) {
    toast(e?.message ?? String(e));
  } finally {
    els.btnJoin.disabled = false;
    els.btnJoin.textContent = "Join";
  }
}

async function main() {
  hydrateFromQuery();
  setJoinMode();
  startTicker();

  els.pinInput.addEventListener("input", () => {
    els.pinInput.value = safePinFromString(els.pinInput.value);
  });

  els.btnJoin.addEventListener("click", joinFlow);
}

main().catch((e) => toast(e?.message ?? String(e)));

