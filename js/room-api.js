import { db, rtdb, ensureAnonAuth } from "./firebase.js";
import { makePin, normalizeName, firebaseKeySafe } from "./util.js";
import { QUESTIONS, DEFAULT_QUESTION_DURATION_S } from "./quiz-data.js";

function roomRoot(pin) {
  return rtdb.ref(db, `rooms/${pin}`);
}

export function joinUrlForPin(pin) {
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/\/[^/]*$/, "/player.html");
  url.searchParams.set("pin", pin);
  return url.toString();
}

export async function createRoom() {
  const user = await ensureAnonAuth();

  // Try a few times to avoid collisions (rare).
  for (let i = 0; i < 6; i++) {
    const pin = makePin();
    const root = roomRoot(pin);
    const metaRef = rtdb.ref(db, `rooms/${pin}/meta`);

    const metaSnap = await rtdb.get(metaRef);
    if (metaSnap.exists()) continue;

    const durationMs = DEFAULT_QUESTION_DURATION_S * 1000;

    await rtdb.set(root, {
      meta: {
        createdAt: rtdb.serverTimestamp(),
        hostUid: user.uid,
        status: "lobby",
        questionIndex: 0,
        questionTotal: QUESTIONS.length,
        questionDurationMs: durationMs,
        questionStartAt: null,
        questionEndAt: null,
      },
      // Keep a lightweight denormalized view to reduce host reads:
      public: {
        playerCount: 0,
      },
      agg: {},
      top5: {},
      players: {},
      answers: {},
      names: {},
    });

    return { pin, uid: user.uid };
  }

  throw new Error("Failed to allocate a unique PIN. Try again.");
}

export async function resetRoom(pin) {
  const user = await ensureAnonAuth();
  const metaRef = rtdb.ref(db, `rooms/${pin}/meta`);
  const meta = (await rtdb.get(metaRef)).val();
  if (!meta || meta.hostUid !== user.uid) throw new Error("Not host");

  // Fast reset: keep room, clear volatile paths.
  await rtdb.update(roomRoot(pin), {
    "meta/status": "lobby",
    "meta/questionIndex": 0,
    "meta/questionStartAt": null,
    "meta/questionEndAt": null,
    agg: {},
    answers: {},
    top5: {},
  });

  // Reset players scores in-place (no giant list on host: server-side update needs uid list).
  const playersSnap = await rtdb.get(rtdb.ref(db, `rooms/${pin}/players`));
  if (playersSnap.exists()) {
    const updates = {};
    playersSnap.forEach((child) => {
      updates[`rooms/${pin}/players/${child.key}/score`] = 0;
    });
    if (Object.keys(updates).length) await rtdb.update(rtdb.ref(db), updates);
  }
}

export async function startRoom(pin) {
  const user = await ensureAnonAuth();
  const metaRef = rtdb.ref(db, `rooms/${pin}/meta`);
  const meta = (await rtdb.get(metaRef)).val();
  if (!meta || meta.hostUid !== user.uid) throw new Error("Not host");

  const durationMs = meta.questionDurationMs ?? DEFAULT_QUESTION_DURATION_S * 1000;

  await rtdb.update(roomRoot(pin), {
    "meta/status": "running",
    // Use serverTimestamp to avoid relying on `.info/*` paths (some environments block it)
    "meta/questionStartAt": rtdb.serverTimestamp(),
    "meta/questionEndAt": null,
    "meta/questionDurationMs": durationMs,
  });
}

export async function nextQuestion(pin) {
  const user = await ensureAnonAuth();
  const metaRef = rtdb.ref(db, `rooms/${pin}/meta`);
  const meta = (await rtdb.get(metaRef)).val();
  if (!meta || meta.hostUid !== user.uid) throw new Error("Not host");

  const next = (meta.questionIndex ?? 0) + 1;
  const total = meta.questionTotal ?? QUESTIONS.length;

  if (next >= total) {
    await rtdb.update(roomRoot(pin), {
      "meta/status": "ended",
      "meta/questionIndex": next,
      "meta/questionStartAt": null,
      "meta/questionEndAt": null,
    });
    return;
  }

  const durationMs = meta.questionDurationMs ?? DEFAULT_QUESTION_DURATION_S * 1000;

  await rtdb.update(roomRoot(pin), {
    "meta/status": "running",
    "meta/questionIndex": next,
    "meta/questionStartAt": rtdb.serverTimestamp(),
    "meta/questionEndAt": null,
    "meta/questionDurationMs": durationMs,
  });
}

export async function revealAnswer(pin) {
  const user = await ensureAnonAuth();
  const metaRef = rtdb.ref(db, `rooms/${pin}/meta`);
  const meta = (await rtdb.get(metaRef)).val();
  if (!meta || meta.hostUid !== user.uid) throw new Error("Not host");

  await rtdb.update(roomRoot(pin), {
    "meta/status": "reveal",
  });
}

export async function joinRoomAsPlayer(pin, nameRaw) {
  const user = await ensureAnonAuth();
  const name = normalizeName(nameRaw);
  if (!name) throw new Error("Enter a name");

  const metaRef = rtdb.ref(db, `rooms/${pin}/meta`);
  const metaSnap = await rtdb.get(metaRef);
  if (!metaSnap.exists()) throw new Error("Room not found");

  const nameKey = firebaseKeySafe(name);
  const nameRef = rtdb.ref(db, `rooms/${pin}/names/${nameKey}`);
  const existing = await rtdb.get(nameRef);
  if (existing.exists() && existing.val()?.uid !== user.uid) {
    throw new Error("Name already taken in this room");
  }

  const root = roomRoot(pin);
  const playerRef = rtdb.ref(db, `rooms/${pin}/players/${user.uid}`);

  // Multi-location update: name reservation + player record.
  await rtdb.update(rtdb.ref(db), {
    [`rooms/${pin}/names/${nameKey}`]: { uid: user.uid },
    [`rooms/${pin}/players/${user.uid}`]: {
      name,
      score: 0,
      joinedAt: rtdb.serverTimestamp(),
      connected: true,
    },
  });

  // Presence: mark disconnected on disconnect; only affects own node.
  const disc = rtdb.onDisconnect(playerRef);
  await disc.update({ connected: false });

  // Increment lightweight playerCount only once per device/player record.
  // (No perfect "exactly once" without server, but this avoids double-counting on rapid joins.)
  await rtdb.runTransaction(rtdb.ref(db, `rooms/${pin}/public/playerCount`), (n) => {
    if (typeof n !== "number") return 1;
    return n + 1;
  });

  return { uid: user.uid, name };
}

export async function submitAnswer({
  pin,
  questionIndex,
  choice,
  answeredAtMs,
  durationMs,
}) {
  const user = await ensureAnonAuth();
  if (![0, 1, 2, 3].includes(choice)) throw new Error("Invalid choice");

  const answerRef = rtdb.ref(db, `rooms/${pin}/answers/${questionIndex}/${user.uid}`);

  // Write-once: set will fail by rules if already exists.
  await rtdb.set(answerRef, {
    choice,
    answeredAt: answeredAtMs,
  });

  // Update aggregates with tiny transactions (host listens to /agg).
  const letters = ["a", "b", "c", "d"];
  const letter = letters[choice];
  const aggBase = `rooms/${pin}/agg/${questionIndex}`;

  // Keep transactions small & independent (improves contention vs one large transaction).
  await Promise.all([
    rtdb.runTransaction(rtdb.ref(db, `${aggBase}/submitted`), (n) => (typeof n === "number" ? n + 1 : 1)),
    rtdb.runTransaction(rtdb.ref(db, `${aggBase}/${letter}`), (n) => (typeof n === "number" ? n + 1 : 1)),
  ]);

  // Optional speed bonus calculated client-side; score update is transaction (safe under concurrency).
  const meta = (await rtdb.get(rtdb.ref(db, `rooms/${pin}/meta`))).val();
  if (!meta) return;

  const correct = QUESTIONS[questionIndex]?.correct;
  const isCorrect = correct === choice;
  if (!isCorrect) return;

  const startAt = meta.questionStartAt ?? 0;
  const endAt = startAt + durationMs;
  const remainingMs = Math.max(0, endAt - answeredAtMs);
  const bonus = Math.max(0, Math.min(50, Math.round((remainingMs / durationMs) * 50)));
  const delta = 100 + bonus;

  await rtdb.runTransaction(rtdb.ref(db, `rooms/${pin}/players/${user.uid}/score`), (n) => {
    const cur = typeof n === "number" ? n : 0;
    return cur + delta;
  });
}

export async function computeAndStoreTop5(pin) {
  // Host-only “best effort” denormalization to avoid each host client sorting huge lists repeatedly.
  const user = await ensureAnonAuth();
  const meta = (await rtdb.get(rtdb.ref(db, `rooms/${pin}/meta`))).val();
  if (!meta || meta.hostUid !== user.uid) return;

  const playersSnap = await rtdb.get(rtdb.ref(db, `rooms/${pin}/players`));
  const arr = [];
  playersSnap.forEach((c) => {
    const v = c.val();
    if (!v?.name) return;
    arr.push({ uid: c.key, name: v.name, score: v.score ?? 0 });
  });

  arr.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const top5 = arr.slice(0, 5);
  const obj = {};
  for (let i = 0; i < top5.length; i++) obj[i] = top5[i];

  await rtdb.set(rtdb.ref(db, `rooms/${pin}/top5`), obj);
}

