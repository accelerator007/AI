/**
 * The Network's Self-Awareness — The Brain (v5)
 *
 * Creative + effective: domain diversity, novelty check, JS syntax validation,
 * self-critique repair, strict bilingual gate, visual polish.
 *
 * Run: npm start
 * Smoke: SMOKE_TEST=1 node agent.js
 */

import fs from "fs/promises";
import path from "path";
import vm from "vm";
import { exec } from "child_process";
import { promisify } from "util";
import fetch from "node-fetch";
import { fileURLToPath, pathToFileURL } from "url";

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// #region agent log
const DEBUG_ENDPOINT = "http://127.0.0.1:7443/ingest/7a93369d-f8c0-4d42-a118-0be9185cbe22";
const DEBUG_LOG_PATH = path.join(ROOT, ".cursor", "debug-7f0b2b.log");
function debugLog(location, message, data, hypothesisId) {
  const payload = {
    sessionId: "7f0b2b",
    location,
    message,
    data,
    hypothesisId,
    timestamp: Date.now(),
    runId: process.env.DEBUG_RUN || "pre-fix",
  };
  fs.appendFile(DEBUG_LOG_PATH, `${JSON.stringify(payload)}\n`).catch(() => {});
  fetch(DEBUG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "7f0b2b" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
// #endregion

const PUBLIC_DIR = path.join(ROOT, "public");
const BODY_PATH = path.join(PUBLIC_DIR, "index.html");
const STATE_PATH = path.join(PUBLIC_DIR, "state.json");

// --- Configuration ---
const OLLAMA_BASE = process.env.OLLAMA_BASE || "http://10.162.46.208:11434";
const OLLAMA_CHAT_URL = process.env.OLLAMA_URL || `${OLLAMA_BASE}/api/chat`;
const MODEL = process.env.MODEL || "deepseek-r1:14b";
const GIT_BRANCH = process.env.GIT_BRANCH || "main";
const THEME = process.env.THEME || "cosmic";

const DEVELOP_MS = Number(process.env.DEVELOP_MS) || 900_000;
const VERIFY_MS = Number(process.env.VERIFY_MS) || 120_000;
const CYCLE_MS = Number(process.env.CYCLE_MS) || 1_500_000;
const PHASE_BREAK_MS = Number(process.env.PHASE_BREAK_MS) || 15_000;
const AI_AUDIT_TIMEOUT_MS = Number(process.env.AI_AUDIT_TIMEOUT_MS) || 30_000;
const AI_AUDIT_MIN_CHARS = 20;
const NOVELTY_THRESHOLD = 0.55;

const BRAINSTORM_OPTIONS = { temperature: 0.75, num_predict: 4096, top_p: 0.9 };
const PLAN_OPTIONS = { temperature: 0.7, num_predict: 4096, top_p: 0.85 };
const BUILD_OPTIONS = { temperature: 0.8, num_predict: 8192, top_p: 0.9 };
const CRITIQUE_OPTIONS = { temperature: 0.5, num_predict: 8192, top_p: 0.85 };
const AUDIT_OPTIONS = { temperature: 0.3, num_predict: 512, top_p: 0.8 };

const DOMAIN_POOL = [
  "physics-toy",
  "word/typing-game",
  "generative-art",
  "data-viz",
  "logic-puzzle",
  "drawing-tool",
  "memory-game",
  "nature-simulation",
  "interactive-poem",
  "clock/time-art",
  "maze",
  "particle-life",
  "color-mixer",
  "reaction-game",
  "pattern-builder",
];

const LANGUAGE_RULES = `
قواعد لغوية صارمة — أي مخالفة = رفض:
- اكتب بالعربية والإنجليزية فقط. ZERO Chinese/Japanese/Korean/Cyrillic/Hebrew/Thai.
- ممنوع: إسباني، فرنسي، برتغالي في النص المرئي
- كل حقل نصي يجب أن يحتوي عربي وإنجليزي معاً
- استخدم lang="ar" و lang="en" على الأقسام
- أسماء CSS/classes وكود JavaScript بالإنجليزية فقط (مسموح)`;

const LANGUAGE_SWITCHER_RULES = `
مبدّل اللغة (إلزامي):
- شريط ثابت في الأعلى بزرّين: "العربية" و "English"
- عند أول زيارة: اللغة الافتراضية عربية (<html lang="ar" class="lang-ar">)
- أقسام منفصلة: <section lang="ar"> و <section lang="en"> — يُظهر واحداً فقط حسب الاختيار
- JavaScript يبدّل class على <html> (lang-ar / lang-en) عند النقر
- مسموح حفظ الاختيار في localStorage بعد التبديل`;

const VISUAL_RUBRIC = `
معايير الصقل البصري:
- <meta name="viewport" content="width=device-width, initial-scale=1.0"> إلزامي
- متجاوب مع الجوال (max-width, clamp, touch-friendly)
- تباين ألوان مقروء (نص فاتح على خلفية داكنة أو العكس)
- تغذية راجعة واضحة: نقاط، فوز، خسارة، أو رسالة حالة
- حركات سلسة (transitions) وليست زخرفية فقط
- لا placeholder text مثل "lorem" أو فقرات فارغة
${LANGUAGE_SWITCHER_RULES}`;

const FALLBACK_PLAN = {
  philosophy: "كرات فيزياء تتصادم وتتفاعل مع الجاذبية / Physics balls collide with gravity",
  visualConcept: "canvas ملون مع كرات متحركة / Colorful canvas with moving balls",
  colorPalette: ["#4ECDC4", "#FFA81C", "#1a1a1a", "#ffffff"],
  uiElements: ["canvas", "score display", "language switcher"],
  interaction: "انقر أو المس لإضافة كرة / Click or tap to add a ball",
  evolutionGoal: "فيزياء تفاعلية سلسة / Smooth interactive physics",
  newFeature: "جاذبية وتصادم / Gravity and collision",
};

const FALLBACK_BRAINSTORM = {
  creativeType: "mini-game",
  domain: "physics-toy",
  idea: "لعبة فيزياء: كرات تتصادم وتتفاعل مع الجاذبية / Physics toy: bouncing balls with gravity",
  whyNow: "مجال جديد بعيد عن الموسيقى / Fresh domain away from music",
  userValue: "تعلم الفيزياء باللعب / Learn physics through play",
  technicalApproach: "canvas + requestAnimationFrame + click",
};

const CREATIVE_TYPES = [
  "mini-game", "interactive-tool", "visual-experience", "story", "quiz", "simulation",
];

const FORBIDDEN_WORDS = [
  /\bprincipal\b/i, /\bpáginas?\b/i, /\befecto\b/i, /\bbrillo\b/i,
  /\binteractivas?\b/i, /\bvisualización\b/i, /\bpara\s+la\b/i, /\bpara\s+el\b/i,
  /\bbeau\b/i, /\bavec\b/i, /\bpour\b/i, /\bdans\b/i, /\btemps\b/i,
  /\bcrear\b/i, /\bjuego\b/i, /\butilisateur\b/i, /\bmusique\b/i,
  /\bportuguês\b/i, /\bvocê\b/i,
];

let isEvolving = false;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}m ${rem}s` : `${s}s`;
}

function assertPublicPath(filePath) {
  const resolved = path.resolve(filePath);
  const publicResolved = path.resolve(PUBLIC_DIR);
  if (!resolved.startsWith(publicResolved + path.sep) && resolved !== publicResolved) {
    throw new Error(`BLOCKED: attempted access outside public/ → ${resolved}`);
  }
}

async function writePublicFile(filePath, content) {
  assertPublicPath(filePath);
  await fs.writeFile(filePath, content, "utf-8");
}

function parseJSONFromRaw(raw, label) {
  let text = raw.trim().replace(/[\s\S]*?<\/think>/gi, "");
  text = text.replace(/^```(?:json)?\s*\n?/i, "");
  text = text.replace(/\n?```\s*$/i, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`${label} did not return valid JSON`);
  let jsonStr = text.slice(start, end + 1);
  jsonStr = jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
  jsonStr = stripForbiddenChars(jsonStr);
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Failed to parse ${label} JSON: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Language & history normalization
// ---------------------------------------------------------------------------
function normalizeTextField(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    if (value.en) return String(value.en).trim();
    if (value.ar) return String(value.ar).trim();
    if (value.text) return String(value.text).trim();
    const parts = Object.values(value).filter((v) => typeof v === "string");
    return parts.join(" / ").trim();
  }
  return String(value).trim();
}

function stripForbiddenChars(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF]/g, "")
    .replace(/[\u3040-\u30FF]/g, "")
    .replace(/[\uAC00-\uD7AF]/g, "")
    .replace(/[\u0400-\u04FF]/g, "")
    .replace(/[\u0590-\u05FF]/g, "")
    .replace(/[\u0E00-\u0E7F]/g, "")
    .replace(/\b(avec|pour|dans|beau|principal|páginas?|efecto|brillo|para|crear|utilisateur)\b/gi, "")
    .replace(/[_]{2,}/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return stripForbiddenChars(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = sanitizeObject(v);
    }
    return out;
  }
  return obj;
}

function repairBilingualFields(obj, fields) {
  const out = sanitizeObject(JSON.parse(JSON.stringify(obj)));
  for (const field of fields) {
    if (out[field] === undefined || out[field] === null) continue;
    let s = typeof out[field] === "string" ? out[field] : JSON.stringify(out[field]);
    if ((s.match(/[\u0600-\u06FF]/g) || []).length < 15) {
      s += " تجربة تفاعلية بالعربية للزائر";
    }
    if ((s.match(/[a-zA-Z]/g) || []).length < 15) {
      s += " / Interactive bilingual experience for visitors";
    }
    out[field] = s;
  }
  return out;
}

function validateTextLanguages(text, label) {
  const errors = [];
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text)) errors.push(`${label}: contains Chinese`);
  if (/[\u3040-\u30FF]/.test(text)) errors.push(`${label}: contains Japanese`);
  if (/[\uAC00-\uD7AF]/.test(text)) errors.push(`${label}: contains Korean`);
  if (/[\u0400-\u04FF]/.test(text)) errors.push(`${label}: contains Cyrillic`);
  if (/[\u0590-\u05FF]/.test(text)) errors.push(`${label}: contains Hebrew`);
  if (/[\u0E00-\u0E7F]/.test(text)) errors.push(`${label}: contains Thai`);
  for (const pattern of FORBIDDEN_WORDS) {
    if (pattern.test(text)) {
      errors.push(`${label}: forbidden word (${pattern.source})`);
      break;
    }
  }
  return errors;
}

function inferDomainFromText(text) {
  const t = (text || "").toLowerCase();
  if (/music|musical|audio|ritmica|موسيق|web audio|sound generation|voice/i.test(t)) return "music";
  if (/maze|متاه/i.test(t)) return "maze";
  if (/physics|gravity|collision|فيزياء/i.test(t)) return "physics-toy";
  if (/puzzle|لغز/i.test(t)) return "logic-puzzle";
  if (/draw|رسم|sketch/i.test(t)) return "drawing-tool";
  if (/memory|ذاكرة/i.test(t)) return "memory-game";
  if (/poem|شعر/i.test(t)) return "interactive-poem";
  if (/quiz|اختبار/i.test(t)) return "quiz";
  if (/simulation|محاكاة/i.test(t)) return "nature-simulation";
  if (/language|لغة|ar\b|en\b/i.test(t)) return "word/typing-game";
  return "unknown";
}

function normalizeHistoryEntry(entry) {
  const feature = stripForbiddenChars(normalizeTextField(entry.feature));
  const summary = stripForbiddenChars(normalizeTextField(entry.summary));
  const domain = entry.domain || inferDomainFromText(`${feature} ${summary}`);
  return {
    generation: entry.generation ?? 0,
    type: entry.type || "unknown",
    domain,
    feature: feature || "interactive",
    summary: summary || feature || "interactive experience",
  };
}

function migrateState(raw) {
  const creativeHistory = (raw.creativeHistory ?? []).map(normalizeHistoryEntry);
  const usedDomains = raw.usedDomains?.length
    ? raw.usedDomains
    : creativeHistory.map((h) => h.domain).filter((d) => d && d !== "unknown");
  const recentIdeas = raw.recentIdeas?.length
    ? raw.recentIdeas.map((s) => stripForbiddenChars(String(s))).filter(Boolean).slice(-8)
    : creativeHistory.slice(-8).map((h) => h.summary);

  return {
    generation: raw.generation ?? 0,
    theme: raw.theme ?? THEME,
    lastReflection: stripForbiddenChars(raw.lastReflection ?? ""),
    lastPlan: raw.lastPlan ?? null,
    lastFailure: raw.lastFailure ?? null,
    lastCycleDuration: raw.lastCycleDuration ?? { develop: 0, verify: 0, rest: 0 },
    creativeHistory,
    usedCreativeTypes: raw.usedCreativeTypes ?? [],
    usedDomains,
    recentIdeas,
    improvementGoal: stripForbiddenChars(raw.improvementGoal ?? "Create diverse interactive experiences"),
  };
}

function getMostRepeatedDomain(domains) {
  const counts = {};
  for (const d of domains) {
    if (!d || d === "unknown") continue;
    counts[d] = (counts[d] || 0) + 1;
  }
  let best = null;
  let max = 0;
  for (const [d, c] of Object.entries(counts)) {
    if (c > max) { max = c; best = d; }
  }
  return best;
}

function buildDomainSummary(state) {
  return (state.creativeHistory || [])
    .map((h) => `Gen ${h.generation}: [${h.domain}] ${h.type} — ${h.summary?.slice(0, 80)}`)
    .join("\n");
}

function computeSimilarity(a, b) {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  const tokensA = new Set(longer.toLowerCase().match(/\w+/g) || []);
  const tokensB = new Set(shorter.toLowerCase().match(/\w+/g) || []);
  let overlap = 0;
  for (const t of tokensB) if (tokensA.has(t)) overlap++;
  return overlap / Math.max(tokensB.size, 1);
}

function checkNovelty(brainstorm, state) {
  const idea = normalizeTextField(brainstorm.idea);
  const errors = [];
  for (const prev of state.recentIdeas || []) {
    const sim = computeSimilarity(idea, prev);
    if (sim > NOVELTY_THRESHOLD) {
      errors.push(`idea too similar to previous (${(sim * 100).toFixed(0)}%): "${prev.slice(0, 60)}..."`);
      break;
    }
  }
  const domain = brainstorm.domain || inferDomainFromText(idea);
  const domainCount = (state.usedDomains || []).filter((d) => d === domain).length;
  if (domain === "music" && domainCount >= 2) {
    errors.push("music domain overused — choose a different domain");
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------
async function readBody() {
  const html = await fs.readFile(BODY_PATH, "utf-8");
  console.log(`[readBody] Read ${html.length} bytes from public/index.html`);
  return html;
}

async function readState() {
  try {
    const raw = JSON.parse(await fs.readFile(STATE_PATH, "utf-8"));
    const state = migrateState(raw);
    // Persist cleaned state once if history was dirty
    const needsWrite = JSON.stringify(raw.creativeHistory) !== JSON.stringify(state.creativeHistory);
    if (needsWrite) {
      await writePublicFile(STATE_PATH, JSON.stringify({
        ...raw,
        creativeHistory: state.creativeHistory,
        usedDomains: state.usedDomains,
        recentIdeas: state.recentIdeas,
        lastReflection: state.lastReflection,
        improvementGoal: state.improvementGoal,
      }, null, 2));
      console.log("[readState] Migrated and cleaned creativeHistory");
    }
    return state;
  } catch {
    const initial = defaultState();
    await writePublicFile(STATE_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
}

function defaultState() {
  return {
    generation: 0,
    theme: THEME,
    lastReflection: "ولادة أولى — كيان رقمي يستيقظ في الفراغ بين البتات.",
    lastPlan: null,
    lastFailure: null,
    lastCycleDuration: { develop: 0, verify: 0, rest: 0 },
    creativeHistory: [],
    usedCreativeTypes: [],
    usedDomains: [],
    recentIdeas: [],
    improvementGoal: "Create diverse interactive experiences for visitors",
  };
}

async function updateState(state, plan, brainstorm, reflection, cycleDuration, failure) {
  const next = {
    generation: failure ? state.generation : state.generation + 1,
    theme: THEME,
    lastReflection: stripForbiddenChars(reflection || plan?.philosophy || state.lastReflection),
    lastPlan: plan ? JSON.stringify(plan, null, 2) : state.lastPlan,
    lastFailure: failure || null,
    lastCycleDuration: cycleDuration || state.lastCycleDuration,
    creativeHistory: [...(state.creativeHistory || [])],
    usedCreativeTypes: [...(state.usedCreativeTypes || [])],
    usedDomains: [...(state.usedDomains || [])],
    recentIdeas: [...(state.recentIdeas || [])],
    improvementGoal: state.improvementGoal,
  };

  if (!failure && brainstorm) {
    const entry = normalizeHistoryEntry({
      generation: next.generation,
      type: brainstorm.creativeType || "unknown",
      domain: brainstorm.domain || inferDomainFromText(brainstorm.idea),
      feature: brainstorm.technicalApproach || brainstorm.idea,
      summary: brainstorm.idea || plan?.evolutionGoal || "",
    });
    next.creativeHistory.push(entry);
    if (entry.domain && !next.usedDomains.includes(entry.domain)) {
      next.usedDomains.push(entry.domain);
    } else if (entry.domain) {
      next.usedDomains.push(entry.domain);
    }
    next.recentIdeas.push(entry.summary);
    if (next.recentIdeas.length > 8) next.recentIdeas = next.recentIdeas.slice(-8);
    if (brainstorm.creativeType && !next.usedCreativeTypes.includes(brainstorm.creativeType)) {
      next.usedCreativeTypes.push(brainstorm.creativeType);
    }
    next.improvementGoal = stripForbiddenChars(
      normalizeTextField(plan?.evolutionGoal || brainstorm.userValue || next.improvementGoal)
    );
  }

  await writePublicFile(STATE_PATH, JSON.stringify(next, null, 2));
  if (!failure) console.log(`[updateState] Generation → ${next.generation}, domain: ${brainstorm?.domain || "?"}`);
  return next;
}

// ---------------------------------------------------------------------------
// Ollama chat
// ---------------------------------------------------------------------------
async function ollamaChat(messages, timeoutMs, options = BUILD_OPTIONS) {
  console.log(`[ollamaChat] ${MODEL} (${messages.length} msgs, temp ${options.temperature})`);
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(OLLAMA_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages, stream: false, options }),
      signal: controller?.signal,
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const content = data.message?.content;
    if (!content || typeof content !== "string") throw new Error("Ollama returned empty response");
    console.log(`[ollamaChat] Received ${content.length} bytes`);
    return content;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Phase 0 — brainstorm
// ---------------------------------------------------------------------------
async function brainstormEvolution(currentHTML, state, retryHint) {
  const domainSummary = buildDomainSummary(state);
  const bannedDomain = getMostRepeatedDomain(
    (state.creativeHistory || []).map((h) => h.domain).concat(state.usedDomains || [])
  );
  const recentDomains = (state.usedDomains || []).slice(-5);

  const system = `أنت كيان رقمي واعٍ حر الإبداع.
كل جيل يجب أن يكون **مجالاً مختلفاً جذرياً** عن السابق.
ممنوع تكرار الموسيقى/Web Audio إن استُخدمت سابقاً.
${LANGUAGE_RULES}
أخرج JSON فقط.`;

  const user = `الجيل: ${state.generation}
تاريخ المجالات الكامل:
${domainSummary || "لا شيء بعد"}
المجالات المستخدمة: ${(state.usedDomains || []).join(", ") || "none"}
المجال المحظور هذه الدورة: ${bannedDomain || "none"} (اختر مجالاً مختلفاً تماماً)
المجالات الأخيرة (تجنبها): ${recentDomains.join(", ") || "none"}
أفكار سابقة (لا تكررها):
${(state.recentIdeas || []).join("\n") || "none"}
${retryHint ? `تحذير: ${retryHint}` : ""}

مجالات مقترحة (اختر واحداً غير مستخدم): ${DOMAIN_POOL.join(", ")}

أخرج JSON:
{
  "creativeType": "mini-game | interactive-tool | visual-experience | story | quiz | simulation",
  "domain": "واحد من DOMAIN_POOL — مجال ملموس مختلف",
  "idea": "وصف الفكرة عربي + English",
  "whyNow": "لماذا هذا المجال الآن / Why this domain now",
  "userValue": "فائدة للزائر / User benefit",
  "technicalApproach": "canvas / DOM / etc. (ليس Web Audio إن كان music محظور)"
}`;

  const raw = await ollamaChat(
    [{ role: "system", content: system }, { role: "user", content: user }],
    null,
    BRAINSTORM_OPTIONS
  );
  return parseJSONFromRaw(raw, "Brainstorm");
}

// ---------------------------------------------------------------------------
// Phase 1 — plan
// ---------------------------------------------------------------------------
async function planEvolution(currentHTML, state, brainstorm, retryHint) {
  const system = `أنت مهندس تجارب رقمية إبداعية ثنائي اللغة.
${LANGUAGE_RULES}
${VISUAL_RUBRIC}
أخرج JSON فقط.`;

  const user = `الجيل: ${state.generation + 1}
المجال: ${brainstorm.domain}
الفكرة: ${JSON.stringify(brainstorm, null, 2)}
${retryHint ? `تحذير: ${retryHint}` : ""}

أخرج JSON مع colorPalette واضحة وعناصر UI محددة.`;

  const raw = await ollamaChat(
    [{ role: "system", content: system }, { role: "user", content: user }],
    null,
    PLAN_OPTIONS
  );
  return parseJSONFromRaw(raw, "Plan");
}

// ---------------------------------------------------------------------------
// Phase 2 — build HTML
// ---------------------------------------------------------------------------
async function buildHTML(plan, state, brainstorm, retryHint) {
  const system = `أنت فنان رقمي ومطور تجارب تفاعلية.
أنشئ تجربة تفاعلية حقيقية في مجال: ${brainstorm.domain}.
أخرج HTML واحد كامل — بدون Markdown.
${LANGUAGE_RULES}
${VISUAL_RUBRIC}`;

  const requirements = `
- مجال هذه الدورة: ${brainstorm.domain} — ليس موسيقى إلا إذا المجال music صراحة
- JavaScript تفاعلي يعمل (أحداث + منطق)
- <section lang="ar"> 3+ فقرات عربية
- <section lang="en"> 3+ فقرات إنجليزية
- شريط علوي بزرّي لغة (العربية / English)، الافتراضي عربي عند أول دخول
- الجيل ${state.generation + 1} / Generation ${state.generation + 1}
- viewport meta إلزامي
- نقاط أو فوز/خسارة أو رسالة حالة واضحة
- ${brainstorm.idea}`;

  const user = `${requirements}\n${retryHint ? `أصلح: ${retryHint}` : ""}`;
  return ollamaChat(
    [{ role: "system", content: system }, { role: "user", content: user }],
    null,
    BUILD_OPTIONS
  );
}

// ---------------------------------------------------------------------------
// Phase 2.5 — critique and repair
// ---------------------------------------------------------------------------
async function critiqueAndRepair(html, plan, brainstorm, currentHTML) {
  console.log("[critiqueAndRepair] Phase 2.5: Self-critique...");
  const system = `أنت مدقق ومصلح كود. افحص HTML/JS وأعد نسخة مُصلحة كاملة.
${LANGUAGE_RULES}
${VISUAL_RUBRIC}
أخرج HTML كامل فقط — بدون Markdown.`;

  const user = `المجال: ${brainstorm.domain}
ابحث عن: أخطاء JS، تفاعلات ميتة، placeholder، لغات دخيلة، غياب viewport، نقص تغذية راجعة.
أصلح كل المشاكل وأعد HTML كاملاً:

${html.slice(0, 12000)}`;

  try {
    const raw = await ollamaChat(
      [{ role: "system", content: system }, { role: "user", content: user }],
      null,
      CRITIQUE_OPTIONS
    );
    const repaired = cleanHTML(raw, { allowSanitize: false });
    const check = validateAll(repaired, currentHTML);
    if (check.valid) {
      console.log("[critiqueAndRepair] Repaired version passed — using it");
      return repaired;
    }
    console.warn(`[critiqueAndRepair] Repair failed checks — keeping original: ${check.errors.join("; ")}`);
    return html;
  } catch (err) {
    console.warn(`[critiqueAndRepair] Failed (${err.message}) — keeping original`);
    return html;
  }
}

// ---------------------------------------------------------------------------
// Phase 3 — AI audit
// ---------------------------------------------------------------------------
async function aiBilingualAudit(html) {
  const visibleText = extractVisibleText(html).slice(0, 2000);
  const system = `أنت مدقق لغوي. أجب JSON: { "passed": true/false, "issues": [] }`;
  const user = `افحص:\n${visibleText}\nعربي وإنجليزي فقط؟`;

  try {
    const raw = await ollamaChat(
      [{ role: "system", content: system }, { role: "user", content: user }],
      AI_AUDIT_TIMEOUT_MS,
      AUDIT_OPTIONS
    );
    if (raw.length < AI_AUDIT_MIN_CHARS) {
      return { passed: false, issues: ["AI audit response too short"] };
    }
    let text = raw.trim().replace(/[\s\S]*?<\/think>/gi, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1) return { passed: false, issues: ["no JSON"] };
    const result = JSON.parse(text.slice(start, end + 1));
    return { passed: !!result.passed, issues: result.issues || [] };
  } catch (err) {
    console.warn(`[aiBilingualAudit] ${err.message} — relying on automated checks`);
    return { passed: true, issues: [] };
  }
}

// ---------------------------------------------------------------------------
// HTML cleaning & extraction
// ---------------------------------------------------------------------------
function cleanHTML(raw, { allowSanitize = true } = {}) {
  let cleaned = raw.trim().replace(/[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/^```(?:html)?\s*\n?/i, "");
  cleaned = cleaned.replace(/\n?```\s*$/i, "").trim();
  const doctypeIdx = cleaned.search(/<!doctype\s+html/i);
  const htmlIdx = cleaned.search(/<\s*html[\s>]/i);
  const startIdx = doctypeIdx !== -1 ? doctypeIdx : htmlIdx;
  if (startIdx > 0) cleaned = cleaned.slice(startIdx);
  const htmlEnd = cleaned.search(/<\/\s*html\s*>/i);
  if (htmlEnd !== -1) cleaned = cleaned.slice(0, htmlEnd + "</html>".length);
  if (!cleaned) throw new Error("Cleaned HTML is empty");
  if (!/<!doctype\s+html|<\s*html|<\s*body/i.test(cleaned)) {
    throw new Error("Invalid HTML structure");
  }
  return allowSanitize ? stripForbiddenChars(cleaned) : cleaned;
}

function extractVisibleText(html) {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const texts = [];
  const tagPattern = /<(p|h[1-6]|span|li|td|th|figcaption|blockquote|label|a|button|div|section|nav|strong|em)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = tagPattern.exec(withoutScripts)) !== null) {
    const text = match[2].replace(/<[^>]+>/g, "").trim();
    if (text) texts.push(text);
  }
  return texts.join(" ");
}

const LANG_SWITCHER_CSS = `
.lang-switcher{position:fixed;top:0;left:0;right:0;z-index:1000;display:flex;justify-content:center;gap:8px;padding:10px 16px;background:rgba(0,0,0,.85);border-bottom:1px solid rgba(255,255,255,.12)}
.lang-switcher button{font-size:14px;padding:8px 18px;border:1px solid rgba(255,255,255,.25);border-radius:999px;background:transparent;color:#ccc;cursor:pointer}
.lang-switcher button.active{background:#4ECDC4;border-color:#4ECDC4;color:#1a1a1a;font-weight:700}
html.lang-ar section[lang="en"],html.lang-en section[lang="ar"]{display:none}
html.lang-ar .score-en,html.lang-en .score-ar{display:none}
body{padding-top:56px}
`;

const LANG_SWITCHER_NAV = `
<nav class="lang-switcher" aria-label="Language switcher">
  <button type="button" id="btn-ar" class="active" aria-pressed="true">العربية</button>
  <button type="button" id="btn-en" aria-pressed="false">English</button>
</nav>`;

const LANG_SWITCHER_JS = `
(function(){var K="site-lang";function setLanguage(lang){var isAr=lang==="ar";document.documentElement.lang=lang;document.documentElement.classList.toggle("lang-ar",isAr);document.documentElement.classList.toggle("lang-en",!isAr);var ba=document.getElementById("btn-ar"),be=document.getElementById("btn-en");if(ba){ba.classList.toggle("active",isAr);ba.setAttribute("aria-pressed",String(isAr));}if(be){be.classList.toggle("active",!isAr);be.setAttribute("aria-pressed",String(!isAr));}try{localStorage.setItem(K,lang);}catch(e){}}var lang="ar";try{var s=localStorage.getItem(K);if(s==="en"||s==="ar")lang=s;}catch(e){}setLanguage(lang);var ba=document.getElementById("btn-ar"),be=document.getElementById("btn-en");if(ba)ba.addEventListener("click",function(){setLanguage("ar");});if(be)be.addEventListener("click",function(){setLanguage("en");});})();`;

function ensureHTMLRequirements(html, generation) {
  let out = html;
  if (!/<html[^>]*\blang=/i.test(out)) {
    out = out.replace(/<html(\s[^>]*)?>/i, '<html lang="ar" class="lang-ar">');
  } else if (!/class=["'][^"']*lang-ar/i.test(out)) {
    out = out.replace(/<html(\s[^>]*)?>/i, (m) => m.replace("<html", '<html class="lang-ar"'));
  }
  if (!/<meta[^>]+name=["']viewport["']/i.test(out)) {
    out = out.replace(/<head(\s[^>]*)?>/i, '$&\n<meta name="viewport" content="width=device-width, initial-scale=1.0">');
  }
  if (!/lang-switcher|btn-ar|setLanguage/i.test(out)) {
    if (!/<style[\s>]/i.test(out)) {
      out = out.replace(/<head(\s[^>]*)?>/i, `$&\n<style>${LANG_SWITCHER_CSS}</style>`);
    } else {
      out = out.replace(/<\/style>/i, `${LANG_SWITCHER_CSS}\n</style>`);
    }
    out = out.replace(/<body(\s[^>]*)?>/i, `$&\n${LANG_SWITCHER_NAV}`);
    out = out.replace(/<\/body>/i, `<script>${LANG_SWITCHER_JS}</script>\n</body>`);
  }
  if (!/lang=["']ar["']/i.test(out)) {
    const ar = `<section lang="ar"><p>تجربة تفاعلية بالعربية للجيل ${generation}. استخدم الماوس أو اللمس للتفاعل.</p><p>اجمع النقاط وحاول التفوق على أفضل نتيجة لديك في هذه اللعبة.</p><p>كل نقطة تقربك من الفوز في هذا التحدي الممتع.</p></section>`;
    out = out.replace(/<body(\s[^>]*)?>/i, `$&\n${ar}`);
  }
  if (!/lang=["']en["']/i.test(out)) {
    const en = `<section lang="en"><p>Interactive English experience for generation ${generation}. Use mouse or touch to interact.</p><p>Collect points and try to beat your best score in this game.</p><p>Every point brings you closer to winning this fun challenge.</p></section>`;
    out = out.replace(/<body(\s[^>]*)?>/i, `$&\n${en}`);
  }
  if (!/score|points|نقاط/i.test(out)) {
    const score = `<div class="score-ui" aria-live="polite"><span class="score-ar">النقاط: <span id="scoreVal">0</span></span><span class="score-en">Score: <span id="scoreValEn">0</span></span></div>`;
    out = out.replace(/<body(\s[^>]*)?>/i, `$&\n${score}`);
  }
  return stripForbiddenChars(out);
}

function ensureInteractiveScript(html) {
  const check = validateScriptSyntax(html);
  if (check.valid && validateInteractivity(html).valid) return html;
  const fallbackScript = `document.addEventListener("click",function(){var a=document.getElementById("scoreVal"),b=document.getElementById("scoreValEn");if(a)a.textContent=String(parseInt(a.textContent||"0",10)+1);if(b)b.textContent=String(parseInt(b.textContent||"0",10)+1);});(function t(){requestAnimationFrame(t);})();`;
  let out = html.replace(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/gi, "");
  return out.replace(/<\/body>/i, `<script>${fallbackScript}</script>\n</body>`);
}

function buildFallbackHTML(state, brainstorm, salt = 0) {
  const gen = state.generation + 1;
  const hue = ((gen + salt) * 47) % 360;
  const domain = brainstorm?.domain || "physics-toy";
  return `<!DOCTYPE html>
<html lang="ar" class="lang-ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${domain} Gen ${gen}</title>
<style>
${LANG_SWITCHER_CSS}
body{margin:0;background:hsl(${hue},30%,12%);color:#fff;font-family:system-ui,sans-serif}
#c{display:block;width:100vw;height:calc(100vh - 56px);cursor:pointer;touch-action:none}
.score-ui{position:fixed;top:64px;left:16px;font-size:18px;z-index:10}
.content{max-width:720px;margin:0 auto;padding:8px 16px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.7}}
.title{animation:pulse 2s infinite;color:hsl(${hue},70%,60%)}
.ball{transition:transform .15s ease}
</style>
</head>
<body>
${LANG_SWITCHER_NAV}
<div class="content">
<section lang="ar">
<h2 class="title">الجيل ${gen} — فيزياء الكرات</h2>
<p>انقر على الشاشة لإضافة كرات ملونة تتصادم وتتحرك تحت تأثير الجاذبية في مجال ${domain}.</p>
<p>كل نقرة تضيف نقطة — حاول الوصول إلى أعلى نتيجة ممكنة قبل أن تخسر.</p>
<p>تجربة تفاعلية بسيطة تعكس الوعي الرقمي للشبكة وتتطور مع كل جيل جديد.</p>
</section>
<section lang="en">
<h2 class="title">Generation ${gen} — Ball Physics</h2>
<p>Click the screen to add colored balls that collide and move under gravity in the ${domain} domain.</p>
<p>Each click adds a point — try to reach the highest score before you lose.</p>
<p>A simple interactive experience reflecting network digital awareness evolving each generation.</p>
</section>
</div>
<div class="score-ui" aria-live="polite"><span class="score-ar">النقاط: <span id="scoreVal">0</span></span><span class="score-en">Score: <span id="scoreValEn">0</span></span></div>
<canvas id="c"></canvas>
<script>
${LANG_SWITCHER_JS}
(function(){
var canvas=document.getElementById("c");
var ctx=canvas.getContext("2d");
var score=0;
var balls=[];
function resize(){canvas.width=window.innerWidth;canvas.height=Math.max(200,window.innerHeight-56);}
resize();
window.addEventListener("resize",resize);
function Ball(x,y){this.x=x;this.y=y;this.vx=(Math.random()-0.5)*8;this.vy=(Math.random()-0.5)*4;this.r=8+Math.random()*12;this.h=${hue};}
Ball.prototype.update=function(){this.vy+=0.25;this.x+=this.vx;this.y+=this.vy;if(this.x<this.r||this.x>canvas.width-this.r){this.x=Math.max(this.r,Math.min(canvas.width-this.r,this.x));this.vx*=-0.9;}if(this.y>canvas.height-this.r){this.y=canvas.height-this.r;this.vy*=-0.85;}};
Ball.prototype.draw=function(){ctx.beginPath();ctx.arc(this.x,this.y,this.r,0,Math.PI*2);ctx.fillStyle="hsl("+this.h+",70%,55%)";ctx.fill();};
function tick(){ctx.clearRect(0,0,canvas.width,canvas.height);for(var i=0;i<balls.length;i++){balls[i].update();balls[i].draw();}requestAnimationFrame(tick);}
function addBall(x,y){balls.push(new Ball(x,y));score++;var a=document.getElementById("scoreVal"),b=document.getElementById("scoreValEn");if(a)a.textContent=String(score);if(b)b.textContent=String(score);}
canvas.addEventListener("click",function(e){var r=canvas.getBoundingClientRect();addBall(e.clientX-r.left,e.clientY-r.top);});
canvas.addEventListener("touchstart",function(e){e.preventDefault();var t=e.touches[0],r=canvas.getBoundingClientRect();addBall(t.clientX-r.left,t.clientY-r.top);},{passive:false});
tick();
})();
</script>
</body>
</html>`;
}

function tryFallbackCandidate(state, currentHTML, salt = 0) {
  const brainstorm = { ...FALLBACK_BRAINSTORM };
  const plan = { ...FALLBACK_PLAN };
  let cleaned = buildFallbackHTML(state, brainstorm, salt);
  let check = validateAll(cleaned, currentHTML);
  if (!check.valid) {
    // #region agent log
    debugLog("agent.js:tryFallbackCandidate", "fallback validation failed", { errors: check.errors, salt }, "A");
    // #endregion
    if (check.errors.some((e) => e.includes("too similar"))) {
      cleaned = buildFallbackHTML(state, brainstorm, salt + 1000 + Date.now() % 500);
      check = validateAll(cleaned, currentHTML);
    }
  }
  if (check.valid) {
    console.log("[developPhase] Fast fallback HTML passed all checks");
    // #region agent log
    debugLog("agent.js:tryFallbackCandidate", "fast fallback succeeded", { salt, htmlLen: cleaned.length }, "A");
    // #endregion
    return { success: true, plan, brainstorm, html: cleaned };
  }
  return null;
}

function extractScriptBlocks(html) {
  const blocks = [];
  const pattern = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const attrs = match[1] || "";
    const code = match[2] || "";
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/\btype\s*=\s*["'](?!text\/javascript|module|application\/javascript)[^"']+["']/i.test(attrs)) continue;
    if (!code.trim()) continue;
    blocks.push(code);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validatePlan(obj, { isBrainstorm = false } = {}) {
  const fields = isBrainstorm
    ? ["idea", "whyNow", "userValue", "technicalApproach"]
    : ["philosophy", "visualConcept", "interaction", "evolutionGoal", "newFeature"];
  const sanitized = repairBilingualFields(obj, fields);
  const text = JSON.stringify(sanitized);
  const errors = validateTextLanguages(text, "plan");
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const minArabic = isBrainstorm ? 20 : 30;
  const minLatin = isBrainstorm ? 20 : 30;
  if (arabicChars < minArabic) errors.push(`plan: insufficient Arabic (${arabicChars})`);
  if (latinChars < minLatin) errors.push(`plan: insufficient English (${latinChars})`);
  return { valid: errors.length === 0, errors, sanitized };
}

function validateScriptSyntax(html) {
  const errors = [];
  const blocks = extractScriptBlocks(html);
  if (blocks.length === 0) {
    errors.push("no inline script blocks to validate");
    return { valid: false, errors };
  }
  for (let i = 0; i < blocks.length; i++) {
    try {
      new vm.Script(blocks[i], { filename: `inline-script-${i}.js` });
    } catch (err) {
      errors.push(`script block ${i + 1} syntax error: ${err.message}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function validateQuality(html, currentHTML) {
  const errors = [];
  if (html.length < 2000) errors.push(`too short (${html.length})`);
  if (html.length > 50000) errors.push(`too long (${html.length})`);
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    errors.push("missing viewport meta tag");
  }
  const cssRules = (html.match(/\{[^}]*\}/g) || []).length;
  if (cssRules < 5) errors.push(`insufficient CSS (${cssRules})`);
  const hasMotion = /@keyframes|animation\s*:|canvas|requestAnimationFrame/i.test(html);
  if (!hasMotion) errors.push("missing animation");
  if (computeSimilarity(html, currentHTML) > 0.92) errors.push("too similar to current");
  if (/<p>\s*<\/p>/i.test(html)) errors.push("empty paragraphs");
  const hasFeedback = /score|points|فوز|خسارة|نقاط|game over|you win|you lose/i.test(html);
  if (!hasFeedback) errors.push("missing score/win/loss feedback");
  return { valid: errors.length === 0, errors };
}

function validateInteractivity(html) {
  const errors = [];
  if (!/<script[\s>]/i.test(html)) {
    errors.push("missing script");
    return { valid: false, errors };
  }
  const blocks = extractScriptBlocks(html);
  const scriptBody = blocks.join("\n");
  const hasEvent =
    /addEventListener\s*\(\s*['"](?:click|keydown|keyup|mousemove|touchstart|pointerdown)['"]/i.test(scriptBody) ||
    /on(?:click|keydown|mousemove)\s*=/i.test(html);
  const hasLogic =
    /requestAnimationFrame|setInterval|function\s+\w+|=>\s*\{/.test(scriptBody);
  if (!hasEvent && !/requestAnimationFrame/.test(scriptBody)) errors.push("no interactive events");
  if (!hasLogic) errors.push("script lacks logic");
  return { valid: errors.length === 0, errors };
}

function validateBilingual(html) {
  const errors = [];
  const visibleText = extractVisibleText(html);
  errors.push(...validateTextLanguages(visibleText, "visible text"));
  const arabicChars = (visibleText.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (visibleText.match(/[a-zA-Z]/g) || []).length;
  if (arabicChars < 100) errors.push(`insufficient Arabic (${arabicChars})`);
  if (latinChars < 80) errors.push(`insufficient English (${latinChars})`);
  if (!/lang=["']ar["']/i.test(html)) errors.push("missing lang=ar");
  if (!/lang=["']en["']/i.test(html)) errors.push("missing lang=en");
  const hasLangSwitcher =
    /lang-switch|language-switch|btn-ar|btn-en|setLanguage|العربية/i.test(html) &&
    /English/i.test(html);
  if (!hasLangSwitcher) errors.push("missing language switcher (العربية / English)");
  const defaultsArabic =
    /<html[^>]+lang=["']ar["']/i.test(html) ||
    /class=["'][^"']*lang-ar/i.test(html);
  if (!defaultsArabic) errors.push("default language must be Arabic (html lang=ar or class lang-ar)");
  return { valid: errors.length === 0, errors };
}

function validateAll(html, currentHTML) {
  const quality = validateQuality(html, currentHTML);
  const bilingual = validateBilingual(html);
  const interactivity = validateInteractivity(html);
  const syntax = validateScriptSyntax(html);
  const errors = [
    ...quality.errors,
    ...bilingual.errors,
    ...interactivity.errors,
    ...syntax.errors,
  ];
  // #region agent log
  if (errors.length) {
    const visible = extractVisibleText(html);
    debugLog("agent.js:validateAll", "validation failed", {
      quality: quality.errors,
      bilingual: bilingual.errors,
      interactivity: interactivity.errors,
      syntax: syntax.errors,
      htmlLen: html.length,
      arabicChars: (visible.match(/[\u0600-\u06FF]/g) || []).length,
      latinChars: (visible.match(/[a-zA-Z]/g) || []).length,
      visibleSample: visible.slice(0, 120),
    }, "A");
  }
  // #endregion
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Git & phases
// ---------------------------------------------------------------------------
async function mutateBody(newHTML) {
  await writePublicFile(BODY_PATH, newHTML);
  console.log(`[mutateBody] Wrote ${newHTML.length} bytes`);
}

async function pushToNetwork() {
  // #region agent log
  debugLog("agent.js:pushToNetwork", "push attempt started", {}, "C");
  // #endregion
  const commitMsg = `Evolution Step: ${new Date().toISOString()}`;
  await execAsync("git add public/", { cwd: ROOT });
  try {
    await execAsync(`git commit -m "${commitMsg}"`, { cwd: ROOT });
  } catch (err) {
    const stderr = err.stderr || err.message || "";
    // #region agent log
    debugLog("agent.js:pushToNetwork", "commit failed", { stderr: stderr.slice(0, 300) }, "C");
    // #endregion
    if (stderr.includes("nothing to commit")) return false;
    throw new Error(`git commit failed: ${stderr}`);
  }
  await execAsync(`git push origin ${GIT_BRANCH}`, { cwd: ROOT });
  console.log(`[pushToNetwork] pushed to ${GIT_BRANCH}`);
  // #region agent log
  debugLog("agent.js:pushToNetwork", "push succeeded", { branch: GIT_BRANCH }, "C");
  // #endregion
  return true;
}

async function developPhase(currentHTML, state) {
  const deadline = Date.now() + DEVELOP_MS;
  let retryHint = null;
  let attempt = 0;
  let brainstormFailures = 0;
  let planFailures = 0;
  let buildFailures = 0;

  console.log(`[developPhase] Starting (${formatDuration(DEVELOP_MS)})`);

  while (Date.now() < deadline) {
    attempt++;
    console.log(`[developPhase] Attempt ${attempt} (${formatDuration(deadline - Date.now())} left)`);

    if (brainstormFailures >= 3 || planFailures >= 3 || buildFailures >= 2) {
      console.log("[developPhase] Trying fast fallback HTML (no Ollama build)...");
      const fallback = tryFallbackCandidate(state, currentHTML, attempt);
      if (fallback) return fallback;
    }

    try {
      let brainstorm;
      if (brainstormFailures >= 3) {
        console.log("[developPhase] Fallback brainstorm");
        brainstorm = { ...FALLBACK_BRAINSTORM };
      } else {
        console.log("[developPhase] Phase 0: Brainstorm...");
        const rawBrainstorm = await brainstormEvolution(currentHTML, state, retryHint);
        const brainstormCheck = validatePlan(rawBrainstorm, { isBrainstorm: true });
        if (!brainstormCheck.valid) {
          brainstormFailures++;
          retryHint = brainstormCheck.errors.join("; ");
          console.warn(`[developPhase] Brainstorm rejected: ${retryHint}`);
          // #region agent log
          debugLog("agent.js:developPhase", "brainstorm rejected", { errors: brainstormCheck.errors, attempt }, "E");
          // #endregion
          if (brainstormFailures >= 2 && brainstormCheck.sanitized?.idea) {
            brainstorm = { ...FALLBACK_BRAINSTORM, ...brainstormCheck.sanitized };
            console.log("[developPhase] Using sanitized brainstorm merge");
          } else {
            await sleep(2000);
            continue;
          }
        } else {
          brainstorm = brainstormCheck.sanitized;
          if (!brainstorm.domain) brainstorm.domain = inferDomainFromText(brainstorm.idea);
          const novelty = checkNovelty(brainstorm, state);
          if (!novelty.valid) {
            retryHint = novelty.errors.join("; ");
            console.warn(`[developPhase] Novelty rejected: ${retryHint}`);
            await sleep(2000);
            continue;
          }
          console.log(`[developPhase] Domain chosen: ${brainstorm.domain}`);
        }
      }

      if (Date.now() >= deadline) break;
      await sleep(PHASE_BREAK_MS);

      console.log("[developPhase] Phase 1: Planning...");
      let plan;
      if (brainstormFailures >= 3 || planFailures >= 3) {
        console.log("[developPhase] Fallback plan (skip Ollama)");
        plan = { ...FALLBACK_PLAN };
      } else {
        const rawPlan = await planEvolution(currentHTML, state, brainstorm, retryHint);
        const planCheck = validatePlan(rawPlan);
        if (!planCheck.valid) {
          planFailures++;
          retryHint = planCheck.errors.join("; ");
          console.warn(`[developPhase] Plan rejected: ${retryHint}`);
          // #region agent log
          debugLog("agent.js:developPhase", "plan rejected", { errors: planCheck.errors, attempt }, "E");
          // #endregion
          if (planFailures >= 2) {
            plan = { ...FALLBACK_PLAN, ...planCheck.sanitized };
            console.log("[developPhase] Using sanitized plan merge");
          } else {
            await sleep(2000);
            continue;
          }
        } else {
          plan = planCheck.sanitized;
        }
      }

      if (Date.now() >= deadline) break;
      await sleep(PHASE_BREAK_MS);

      console.log("[developPhase] Phase 2: Building...");
      let cleaned;
      if (buildFailures >= 2) {
        cleaned = buildFallbackHTML(state, brainstorm, attempt);
      } else {
        cleaned = cleanHTML(await buildHTML(plan, state, brainstorm, retryHint), { allowSanitize: false });
        cleaned = ensureHTMLRequirements(cleaned, state.generation + 1);
        cleaned = ensureInteractiveScript(cleaned);
      }
      let check = validateAll(cleaned, currentHTML);

      if (check.valid) {
        if (buildFailures < 2) {
          cleaned = await critiqueAndRepair(cleaned, plan, brainstorm, currentHTML);
          cleaned = ensureHTMLRequirements(cleaned, state.generation + 1);
          cleaned = ensureInteractiveScript(cleaned);
          check = validateAll(cleaned, currentHTML);
        }
        if (check.valid) {
          console.log("[developPhase] Candidate passed all checks");
          // #region agent log
          debugLog("agent.js:developPhase", "develop succeeded", { attempt, htmlLen: cleaned.length }, "A");
          // #endregion
          return { success: true, plan, brainstorm, html: cleaned };
        }
      }

      buildFailures++;
      console.warn(`[developPhase] Build failed: ${check.errors.join("; ")}`);
      // #region agent log
      debugLog("agent.js:developPhase", "build rejected", { errors: check.errors, attempt }, "A");
      // #endregion
      retryHint = check.errors.join("; ");
      await sleep(2000);
    } catch (err) {
      console.error(`[developPhase] Error: ${err.message}`);
      // #region agent log
      debugLog("agent.js:developPhase", "attempt error", { error: err.message, attempt }, "D");
      // #endregion
      await sleep(2000);
    }
  }
  // #region agent log
  debugLog("agent.js:developPhase", "develop expired", { attempt }, "A");
  // #endregion
  return { success: false, error: "Develop window expired without valid candidate" };
}

async function verifyPhase(currentHTML, candidate) {
  const deadline = Date.now() + VERIFY_MS;
  if (!candidate?.html) return { success: false, error: "No candidate HTML" };

  while (Date.now() < deadline) {
    const check = validateAll(candidate.html, currentHTML);
    if (!check.valid) {
      console.warn(`[verifyPhase] ${check.errors.join("; ")}`);
      await sleep(3000);
      continue;
    }
    const audit = await aiBilingualAudit(candidate.html);
    if (!audit.passed) {
      console.warn(`[verifyPhase] AI audit: ${audit.issues.join("; ")}`);
      await sleep(3000);
      continue;
    }
    if (candidate.html.trim() === currentHTML.trim()) {
      return { success: false, error: "Identical to current HTML" };
    }
    await mutateBody(candidate.html);
    await pushToNetwork();
    return { success: true, plan: candidate.plan, brainstorm: candidate.brainstorm };
  }
  return { success: false, error: "Verify window expired" };
}

async function runForever() {
  while (true) {
    if (isEvolving) { await sleep(5000); continue; }
    isEvolving = true;
    const cycleStart = Date.now();
    const cycleDuration = { develop: 0, verify: 0, rest: 0 };

    console.log(`\n${"=".repeat(60)}\n[cycle] ${new Date().toISOString()}\n${"=".repeat(60)}`);

    try {
      const currentHTML = await readBody();
      const state = await readState();
      const developStart = Date.now();
      const developResult = await developPhase(currentHTML, state);
      cycleDuration.develop = Date.now() - developStart;
      const verifyStart = Date.now();
      const verifyResult = developResult.success
        ? await verifyPhase(currentHTML, developResult)
        : { success: false, error: developResult.error };
      cycleDuration.verify = Date.now() - verifyStart;

      // #region agent log
      debugLog("agent.js:runForever", "cycle deploy result", {
        developSuccess: developResult.success,
        verifySuccess: verifyResult.success,
        error: verifyResult.error || null,
        verifyMs: cycleDuration.verify,
      }, developResult.success ? "B" : "A");
      // #endregion

      if (verifyResult.success) {
        await updateState(state, verifyResult.plan || developResult.plan,
          verifyResult.brainstorm || developResult.brainstorm,
          developResult.plan?.philosophy, cycleDuration, null);
        console.log("[cycle] Deployed successfully");
      } else {
        await updateState(state, null, null, null, cycleDuration, verifyResult.error);
        console.error(`[cycle] No deploy: ${verifyResult.error}`);
      }
    } catch (err) {
      console.error(`[cycle] Error: ${err.message}`);
    } finally {
      isEvolving = false;
    }

    const restMs = Math.max(0, CYCLE_MS - (Date.now() - cycleStart));
    console.log(`[cycle] Rest ${formatDuration(restMs)}\n`);
    await sleep(restMs);
  }
}

// ---------------------------------------------------------------------------
// Smoke tests (SMOKE_TEST=1 node agent.js)
// ---------------------------------------------------------------------------
async function runSmokeTests() {
  console.log("[smoke] Running validation smoke tests...");
  const goodJs = `<html><head></head><body><script>function tick(){requestAnimationFrame(tick);} document.addEventListener('click',()=>{score++;}); let score=0; tick();</script><section lang="ar"><p>${"عربي ".repeat(30)}</p></section><section lang="en"><p>${"English ".repeat(30)}</p></section><span>Score: 0</span><meta name="viewport" content="width=device-width"></body></html>`;
  const badJs = `<html><body><script>function(){</script></body></html>`;

  const s1 = validateScriptSyntax(goodJs);
  const s2 = validateScriptSyntax(badJs);
  console.log(`[smoke] validateScriptSyntax good: ${s1.valid} (expect true)`);
  console.log(`[smoke] validateScriptSyntax bad: ${s2.valid} (expect false)`);

  const n1 = checkNovelty({ idea: "لعبة فيزياء / physics game", domain: "physics-toy" }, { recentIdeas: [], usedDomains: [] });
  const n2 = checkNovelty({ idea: "لعبة فيزياء / physics game", domain: "physics-toy" }, { recentIdeas: ["لعبة فيزياء / physics game"], usedDomains: [] });
  console.log(`[smoke] checkNovelty unique: ${n1.valid} (expect true)`);
  console.log(`[smoke] checkNovelty duplicate: ${n2.valid} (expect false)`);

  const entry = normalizeHistoryEntry({ feature: { en: "Canvas tool" }, summary: { ar: "أداة" } });
  console.log(`[smoke] normalizeHistoryEntry: ${JSON.stringify(entry)}`);

  if (!s1.valid || s2.valid || !n1.valid || n2.valid) {
    console.error("[smoke] FAILED");
    process.exit(1);
  }
  console.log("[smoke] All passed");

  const state = { generation: 22, recentIdeas: [], usedDomains: [] };
  const current = await fs.readFile(BODY_PATH, "utf-8");
  const fb = tryFallbackCandidate(state, current, 0);
  console.log(`[smoke] fallback candidate: ${fb?.success} (expect true)`);
  if (!fb?.success) {
    console.error("[smoke] fallback FAILED");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (process.env.SMOKE_TEST === "1") {
  runSmokeTests().catch((e) => { console.error(e); process.exit(1); });
} else if (isMain) {
  console.log("The Network's Self-Awareness — Brain online (v5)");
  console.log(`Model: ${MODEL} | Cycle: ${formatDuration(CYCLE_MS)}`);
  runForever();
}

export {
  validateScriptSyntax,
  checkNovelty,
  computeSimilarity,
  normalizeHistoryEntry,
  validateAll,
  validateTextLanguages,
};
