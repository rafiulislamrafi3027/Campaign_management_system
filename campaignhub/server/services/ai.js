// =========================================================
// Google Gemini API (Req 18–22)
//
// Uses the REST API directly with Node's built-in fetch — no extra package needed.
// Settings in .env:
//   GEMINI_API_KEY   your key from https://aistudio.google.com/apikey  (required)
//   GEMINI_MODEL     default "gemini-3.5-flash-lite" (fast Flash-Lite model)
//   GEMINI_FALLBACK_MODELS  optional, comma separated backups (default "gemini-3.1-flash-lite,gemini-3.5-flash")
//   AI_TIMEOUT_MS    default 20000 (20 seconds) — total time for all tries
//
// The API key is used only here on the server and is never sent to the browser (NFR 32).
// =========================================================

const BASE_URL = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";

class AiError extends Error {
  constructor(message, code = "ai_error") {
    super(message);
    this.code = code;
  }
}

function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Pulls the first JSON object/array out of the model's answer (it may add ```json fences)
function parseJson(text) {
  const clean = String(text || "").replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    const start = clean.search(/[[{]/);
    const end = Math.max(clean.lastIndexOf("}"), clean.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(clean.slice(start, end + 1));
      } catch (e2) {
        /* fall through */
      }
    }
    throw new AiError("The AI answer could not be understood. Please try again.", "bad_answer");
  }
}

// Errors worth trying again: Google is busy (500/503/504), a short rate limit (429),
// a slow answer, a dropped connection, or an empty/garbled answer.
const RETRYABLE = new Set(["busy", "quota", "timeout", "network", "empty", "bad_answer", "bad_model"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function modelList() {
  const main = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const backups = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.1-flash-lite,gemini-3.5-flash")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([main, ...backups])];
}

// One request to one model. Throws AiError with a code.
async function callOnce({ model, parts, maxOutputTokens, timeoutMs }) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        // Newer Gemini models do not accept temperature/top_p/top_k, so only these are sent
        generationConfig: { responseMimeType: "application/json", maxOutputTokens },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") throw new AiError("The AI took too long to answer.", "timeout");
    throw new AiError("Could not reach the AI service. Check the internet connection and try again.", "network");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (body.error && body.error.message) || "";
    console.warn(`  Gemini [${model}] error ${res.status}: ${detail.slice(0, 160)}`);
    if (res.status === 400 && /api key/i.test(detail)) throw new AiError("The Gemini API key is not valid. Check GEMINI_API_KEY in .env.", "bad_key");
    if (res.status === 401 || res.status === 403) throw new AiError("The Gemini API key is not allowed to use this model. Check the key in .env.", "bad_key");
    if (res.status === 404) throw new AiError(`The AI model "${model}" was not found. Check GEMINI_MODEL in .env.`, "bad_model");
    if (res.status === 429) throw new AiError("The free AI limit was reached for now. Please wait a minute and try again.", "quota");
    if (res.status >= 500) throw new AiError("The AI service is busy right now. Please try again in a moment.", "busy");
    throw new AiError("The AI service returned an error. Please try again later.", "api_error");
  }

  const cand = body.candidates && body.candidates[0];
  const text = cand && cand.content && (cand.content.parts || []).map((p) => p.text || "").join("");
  if (!text) {
    const reason = (cand && cand.finishReason) || (body.promptFeedback && body.promptFeedback.blockReason) || "empty";
    console.warn(`  Gemini [${model}] gave no answer (${reason})`);
    throw new AiError(`The AI did not return an answer (${reason}). Please try again.`, "empty");
  }
  return parseJson(text);
}

/**
 * Sends a prompt (and optional image) to Gemini and returns parsed JSON.
 * Reliability: if Google is busy or the answer is bad, it waits a moment and tries again,
 * then tries the backup models — all within the AI_TIMEOUT_MS time limit (NFR 30).
 * @param {Object} o
 * @param {string} o.prompt           instructions + data (text)
 * @param {Object} [o.image]          { mimeType, base64 }
 * @param {number} [o.maxOutputTokens]
 */
async function generateJSON({ prompt, image, maxOutputTokens = 4096 }) {
  if (!isConfigured()) {
    throw new AiError("AI is not set up on this server (GEMINI_API_KEY is missing in .env).", "not_configured");
  }

  const total = Number(process.env.AI_TIMEOUT_MS) || 20000;
  const deadline = Date.now() + total;
  const parts = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });

  // Plan: main model twice, then each backup model once
  const models = modelList();
  const plan = [models[0], models[0], ...models.slice(1)];

  let lastErr = null;
  for (let i = 0; i < plan.length; i++) {
    const model = plan[i];
    // A model that does not exist will not start working on a second try
    if (lastErr && lastErr.code === "bad_model" && lastErr.model === model) continue;

    const left = deadline - Date.now();
    if (left < 1500) break;
    // Leave room for one more attempt unless this is the last one
    const timeoutMs = i < plan.length - 1 ? Math.max(1500, Math.min(left, Math.round(total * 0.6))) : left;

    try {
      const out = await callOnce({ model, parts, maxOutputTokens, timeoutMs });
      if (i > 0) console.log(`  Gemini answered on attempt ${i + 1} (${model})`);
      return out;
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      err.model = model;
      lastErr = err;
      if (!RETRYABLE.has(err.code)) throw err; // wrong key etc. — trying again will not help
      // Short pause before the next try (longer after a rate limit)
      const pause = err.code === "quota" ? 1500 : err.code === "busy" ? 800 : 300;
      if (deadline - Date.now() > pause + 1500) await sleep(pause);
    }
  }

  if (!lastErr || lastErr.code === "timeout") {
    throw new AiError(`The AI took longer than ${Math.round(total / 1000)} seconds. Please try again or continue manually.`, "timeout");
  }
  throw lastErr;
}

module.exports = { generateJSON, isConfigured, AiError, parseJson };
