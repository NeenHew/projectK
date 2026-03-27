export function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function nowMs() {
  return Date.now();
}

export function normalizeName(s) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 18);
}

export function firebaseKeySafe(s) {
  // RTDB keys cannot contain: . # $ [ ] /
  // Also avoid control chars. Keep it deterministic and short.
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[.#$\[\]\/]/g, "_")
    .slice(0, 64);
}

export function safePinFromString(s) {
  const digits = String(s ?? "").replace(/\D/g, "").slice(0, 6);
  return digits.length === 6 ? digits : digits;
}

export function makePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function toast(msg, ms = 2200) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => el.classList.remove("show"), ms);
}

// Prevent spam clicking: simple per-key cooldown
export function createCooldown() {
  const last = new Map();
  return function cooldown(key, ms) {
    const t = performance.now();
    const prev = last.get(key) ?? 0;
    if (t - prev < ms) return false;
    last.set(key, t);
    return true;
  };
}

export function formatPhase(phase) {
  if (!phase) return "—";
  return String(phase).toUpperCase();
}

export function computeSpeedBonus({ remainingMs, durationMs }) {
  // Optional: 0..50 bonus based on how early you answered.
  if (!durationMs || durationMs <= 0) return 0;
  const pct = clamp(remainingMs / durationMs, 0, 1);
  return Math.round(50 * pct);
}

