import { db, rtdb, ensureAnonAuth } from "./firebase.js";
import { $, toast, formatPhase, createCooldown } from "./util.js";
import { QUESTIONS } from "./quiz-data.js";
import {
  createRoom,
  joinUrlForPin,
  startRoom,
  nextQuestion,
  resetRoom,
  revealAnswer,
  computeAndStoreTop5,
} from "./room-api.js";

const cooldown = createCooldown();

const els = {
  roomPin: $("roomPin"),
  playerCount: $("playerCount"),
  answersCount: $("answersCount"),
  qIndex: $("qIndex"),
  qTotal: $("qTotal"),
  phase: $("phase"),
  timeLeft: $("timeLeft"),
  questionText: $("questionText"),
  questionMeta: $("questionMeta"),
  btnCreate: $("btnCreate"),
  btnStart: $("btnStart"),
  btnNext: $("btnNext"),
  btnReset: $("btnReset"),
  top5Body: $("top5Body"),
  playersList: $("playersList"),
  roomPath: $("roomPath"),
  myUid: $("myUid"),
  joinUrl: $("joinUrl"),
  qrCanvas: $("qrCanvas"),
};

let pin = null;
let metaUnsub = null;
let pubUnsub = null;
let aggUnsub = null;
let topUnsub = null;
let playersUnsub = null;
let chart = null;
let lastMeta = null;

function setButtons({ created, canStart, canNext, canReset }) {
  els.btnCreate.disabled = created;
  els.btnStart.disabled = !canStart;
  els.btnNext.disabled = !canNext;
  els.btnReset.disabled = !canReset;
}

function setTop5(top5Obj) {
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const v = top5Obj?.[i];
    if (!v) break;
    rows.push(
      `<tr><td>${i + 1}</td><td>${escapeHtml(v.name)}</td><td>${v.score ?? 0}</td></tr>`,
    );
  }
  els.top5Body.innerHTML =
    rows.length ? rows.join("") : `<tr><td colspan="3" class="muted">—</td></tr>`;
}

function setPlayersList(playersObj) {
  const names = [];
  if (playersObj) {
    for (const [uid, v] of Object.entries(playersObj)) {
      if (!v?.name) continue;
      const badge = v.connected ? "" : " (offline)";
      names.push(`${v.name}${badge}`);
    }
  }
  names.sort((a, b) => a.localeCompare(b));
  els.playersList.textContent = names.length ? names.join(", ") : "—";
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

function initChart() {
  const ctx = document.getElementById("barChart");
  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["A", "B", "C", "D"],
      datasets: [
        {
          label: "Answers",
          data: [0, 0, 0, 0],
          backgroundColor: [
            "rgba(124,58,237,.75)",
            "rgba(59,130,246,.75)",
            "rgba(34,197,94,.75)",
            "rgba(245,158,11,.75)",
          ],
          borderColor: "rgba(255,255,255,.12)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false, // perf for realtime
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
      },
      scales: {
        x: { ticks: { color: "#cbd5e1" }, grid: { color: "rgba(255,255,255,.06)" } },
        y: { ticks: { color: "#cbd5e1", precision: 0 }, grid: { color: "rgba(255,255,255,.06)" }, beginAtZero: true },
      },
    },
  });
}

function updateChartFromAgg(agg) {
  if (!chart) return;
  const a = agg?.a ?? 0;
  const b = agg?.b ?? 0;
  const c = agg?.c ?? 0;
  const d = agg?.d ?? 0;
  chart.data.datasets[0].data = [a, b, c, d];
  chart.update("none");
}

function attachRoomListeners() {
  cleanupListeners();
  if (!pin) return;

  els.roomPath.textContent = `rooms/${pin}`;

  // Host uses only a few listeners:
  // - meta: small state (phase, qIndex, timer)
  // - public/playerCount: int
  // - agg/currentQuestion: small aggregate counts
  // - top5 (denormalized)
  // - players (names only) is optional; keep it, but can be removed for maximal scale.

  const metaRef = rtdb.ref(db, `rooms/${pin}/meta`);
  metaUnsub = rtdb.onValue(metaRef, (snap) => {
    const meta = snap.val();
    lastMeta = meta;
    renderMeta(meta);
    attachAggListener(meta?.questionIndex ?? 0);
    // best-effort: when reveal/end, compute top5 once
    if (meta?.status === "reveal" || meta?.status === "ended") {
      computeAndStoreTop5(pin).catch(() => {});
    }
  });

  const pubRef = rtdb.ref(db, `rooms/${pin}/public/playerCount`);
  pubUnsub = rtdb.onValue(pubRef, (snap) => {
    const n = snap.val();
    els.playerCount.textContent = typeof n === "number" ? String(n) : "0";
  });

  const topRef = rtdb.ref(db, `rooms/${pin}/top5`);
  topUnsub = rtdb.onValue(topRef, (snap) => setTop5(snap.val()));

  // Optional: show players list (name + connected). For maximal perf at 300+,
  // comment this out (host projector doesn't strictly need it).
  const playersRef = rtdb.ref(db, `rooms/${pin}/players`);
  playersUnsub = rtdb.onValue(playersRef, (snap) => setPlayersList(snap.val()));
}

function attachAggListener(qIndex) {
  if (!pin) return;
  if (aggUnsub) {
    rtdb.off(rtdb.ref(db, `rooms/${pin}/agg/${qIndex}`));
    aggUnsub = null;
  }
  const aggRef = rtdb.ref(db, `rooms/${pin}/agg/${qIndex}`);
  aggUnsub = rtdb.onValue(aggRef, (snap) => {
    const agg = snap.val() ?? {};
    els.answersCount.textContent = String(agg.submitted ?? 0);
    updateChartFromAgg(agg);
  });
}

function cleanupListeners() {
  if (!pin) return;
  try {
    rtdb.off(rtdb.ref(db, `rooms/${pin}/meta`));
    rtdb.off(rtdb.ref(db, `rooms/${pin}/public/playerCount`));
    rtdb.off(rtdb.ref(db, `rooms/${pin}/top5`));
    rtdb.off(rtdb.ref(db, `rooms/${pin}/players`));
  } catch (_) {}
  metaUnsub = pubUnsub = topUnsub = playersUnsub = null;
  aggUnsub = null;
}

function renderMeta(meta) {
  if (!meta) {
    els.phase.textContent = "—";
    return;
  }

  const qIndex = meta.questionIndex ?? 0;
  const total = meta.questionTotal ?? QUESTIONS.length;
  els.qIndex.textContent = String(Math.min(qIndex + 1, total));
  els.qTotal.textContent = String(total);
  els.phase.textContent = formatPhase(meta.status);

  const q = QUESTIONS[qIndex];
  if (q) {
    els.questionText.textContent = q.text;
    els.questionMeta.textContent = `Choices: A–D · Correct: ${
      meta.status === "reveal" || meta.status === "ended" ? "ABCD"[q.correct] : "hidden"
    }`;
  } else {
    els.questionText.textContent = meta.status === "ended" ? "Quiz ended" : "—";
    els.questionMeta.textContent = "—";
  }

  const created = Boolean(pin);
  const canStart = created && meta.status === "lobby";
  const canNext = created && (meta.status === "reveal" || meta.status === "running");
  const canReset = created;
  setButtons({ created, canStart, canNext, canReset });
}

function startTicker() {
  // Single UI timer tick (no extra Firebase reads)
  setInterval(() => {
    const meta = lastMeta;
    if (!meta?.questionStartAt || meta.status === "lobby") {
      els.timeLeft.textContent = "--";
      return;
    }
    const dur = meta.questionDurationMs ?? 15000;
    const endAt = meta.questionStartAt + dur;
    const msLeft = Math.max(0, endAt - Date.now());
    els.timeLeft.textContent = String(Math.ceil(msLeft / 1000));
    if (msLeft === 0 && meta.status === "running") {
      // Host auto-reveal once when timer hits 0 (cooldown to prevent spam writes)
      if (cooldown("autoReveal", 2500)) {
        revealAnswer(pin).catch(() => {});
      }
    }
  }, 200);
}

function renderQr(pin) {
  const url = joinUrlForPin(pin);
  els.joinUrl.textContent = url.replace(/^https?:\/\//, "");
  const qr = new QRious({ element: els.qrCanvas, value: url, size: 210, level: "M" });
  return qr;
}

async function main() {
  const u = await ensureAnonAuth();
  els.myUid.textContent = u.uid;
  initChart();
  startTicker();

  els.btnCreate.addEventListener("click", async () => {
    if (!cooldown("create", 1200)) return;
    try {
      const res = await createRoom();
      pin = res.pin;
      els.roomPin.textContent = pin;
      renderQr(pin);
      toast(`Room created: ${pin}`);
      attachRoomListeners();
    } catch (e) {
      toast(e?.message ?? String(e));
    }
  });

  els.btnStart.addEventListener("click", async () => {
    if (!pin) return;
    if (!cooldown("start", 900)) return;
    try {
      await startRoom(pin);
    } catch (e) {
      toast(e?.message ?? String(e));
    }
  });

  els.btnNext.addEventListener("click", async () => {
    if (!pin) return;
    if (!cooldown("next", 900)) return;
    try {
      // If currently running, force reveal first (optional)
      if (lastMeta?.status === "running") {
        await revealAnswer(pin);
        return;
      }
      await nextQuestion(pin);
    } catch (e) {
      toast(e?.message ?? String(e));
    }
  });

  els.btnReset.addEventListener("click", async () => {
    if (!pin) return;
    if (!cooldown("reset", 1500)) return;
    try {
      await resetRoom(pin);
      toast("Room reset");
    } catch (e) {
      toast(e?.message ?? String(e));
    }
  });
}

main().catch((e) => toast(e?.message ?? String(e)));

