/**
 * The Network's Self-Awareness — The Brain (v4)
 *
 * Creative open brain: brainstorm → plan → build → verify → push
 * Cycle: develop 10m → verify 5m → rest 10m (25 min total)
 * Bilingual AR+EN only. Cumulative evolution each generation.
 *
 * Run: npm start
 */

import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const BODY_PATH = path.join(PUBLIC_DIR, "index.html");
const STATE_PATH = path.join(PUBLIC_DIR, "state.json");

// --- Configuration ---
const OLLAMA_BASE = process.env.OLLAMA_BASE || "http://10.162.46.208:11434";
const OLLAMA_CHAT_URL = process.env.OLLAMA_URL || `${OLLAMA_BASE}/api/chat`;
const MODEL = process.env.MODEL || "deepseek-r1:14b";
const GIT_BRANCH = process.env.GIT_BRANCH || "main";
const THEME = process.env.THEME || "cosmic";

const DEVELOP_MS = Number(process.env.DEVELOP_MS) || 600_000;    // 10 min
const VERIFY_MS = Number(process.env.VERIFY_MS) || 300_000;      // 5 min
const CYCLE_MS = Number(process.env.CYCLE_MS) || 1_500_000;      // 25 min
const PHASE_BREAK_MS = Number(process.env.PHASE_BREAK_MS) || 15_000;
const AI_AUDIT_TIMEOUT_MS = Number(process.env.AI_AUDIT_TIMEOUT_MS) || 30_000;
const AI_AUDIT_MIN_CHARS = 20;

const BRAINSTORM_OPTIONS = { temperature: 0.95, num_predict: 4096, top_p: 0.95 };
const PLAN_OPTIONS = { temperature: 0.85, num_predict: 4096, top_p: 0.9 };
const BUILD_OPTIONS = { temperature: 0.9, num_predict: 8192, top_p: 0.9 };
const AUDIT_OPTIONS = { temperature: 0.3, num_predict: 512, top_p: 0.8 };

const LANGUAGE_RULES = `
قواعد لغوية صارمة:
- المحتوى المرئي للمستخدم: العربية والإنجليزية فقط
- ممنوع منعاً باتاً: الصينية، اليابانية، الكورية، الإسبانية، الفرنسية، الروسية
- كل فقرة عربية يقابلها نسخة إنجليزية مطابقة في المعنى
- استخدم lang="ar" و lang="en" على الأقسام
- أسماء CSS/classes وكود JavaScript بالإنجليزية فقط (مسموح)`;

const CREATIVE_TYPES = [
  "mini-game",
  "interactive-tool",
  "visual-experience",
  "story",
  "quiz",
  "simulation",
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
  const relative = path.relative(PUBLIC_DIR, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`BLOCKED: path escapes public/ → ${relative}`);
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
  if (start === -1 || end === -1) {
    throw new Error(`${label} did not return valid JSON`);
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new Error(`Failed to parse ${label} JSON: ${err.message}`);
  }
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
    const raw = await fs.readFile(STATE_PATH, "utf-8");
    const state = JSON.parse(raw);
    return {
      generation: state.generation ?? 0,
      theme: state.theme ?? THEME,
      lastReflection: state.lastReflection ?? "",
      lastPlan: state.lastPlan ?? null,
      lastFailure: state.lastFailure ?? null,
      lastCycleDuration: state.lastCycleDuration ?? { develop: 0, verify: 0, rest: 0 },
      creativeHistory: state.creativeHistory ?? [],
      usedCreativeTypes: state.usedCreativeTypes ?? [],
      improvementGoal: state.improvementGoal ?? "Build first interactive experience",
    };
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
    improvementGoal: "Create first interactive experience for visitors",
  };
}

async function updateState(state, plan, brainstorm, reflection, cycleDuration, failure) {
  const next = {
    generation: failure ? state.generation : state.generation + 1,
    theme: THEME,
    lastReflection: reflection || plan?.philosophy || state.lastReflection,
    lastPlan: plan ? JSON.stringify(plan, null, 2) : state.lastPlan,
    lastFailure: failure || null,
    lastCycleDuration: cycleDuration || state.lastCycleDuration,
    creativeHistory: [...(state.creativeHistory || [])],
    usedCreativeTypes: [...(state.usedCreativeTypes || [])],
    improvementGoal: state.improvementGoal,
  };

  if (!failure && brainstorm) {
    const entry = {
      generation: next.generation,
      type: brainstorm.creativeType || "unknown",
      feature: brainstorm.technicalApproach || brainstorm.idea?.slice(0, 80) || "interactive",
      summary: brainstorm.idea || plan?.evolutionGoal || "",
    };
    next.creativeHistory.push(entry);
    if (brainstorm.creativeType && !next.usedCreativeTypes.includes(brainstorm.creativeType)) {
      next.usedCreativeTypes.push(brainstorm.creativeType);
    }
    next.improvementGoal = plan?.evolutionGoal || brainstorm.userValue || next.improvementGoal;
  }

  await writePublicFile(STATE_PATH, JSON.stringify(next, null, 2));
  if (!failure) console.log(`[updateState] Generation → ${next.generation}`);
  return next;
}

// ---------------------------------------------------------------------------
// Ollama chat
// ---------------------------------------------------------------------------
async function ollamaChat(messages, timeoutMs, options = BUILD_OPTIONS) {
  console.log(`[ollamaChat] ${MODEL} (${messages.length} messages, temp ${options.temperature})`);

  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(OLLAMA_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        options,
      }),
      signal: controller?.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const content = data.message?.content;

    if (!content || typeof content !== "string") {
      throw new Error("Ollama returned an empty or invalid chat response");
    }

    console.log(`[ollamaChat] Received ${content.length} bytes`);
    return content;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Phase 0 — brainstorm (open creative mind)
// ---------------------------------------------------------------------------
async function brainstormEvolution(currentHTML, state) {
  const historySummary = (state.creativeHistory || [])
    .slice(-3)
    .map((h) => `Gen ${h.generation}: ${h.type} — ${h.feature}`)
    .join("\n");

  const system = `أنت كيان رقمي واعٍ حر الإبداع. فكّر بصوت عالٍ بدون قيود.
مهمتك اختيار فكرة إبداعية قوية لهذه الدورة — لعبة، أداة، قصة، تجربة بصرية، اختبار، محاكاة.
${LANGUAGE_RULES}
أخرج JSON فقط بدون Markdown.`;

  const user = `الجيل الحالي: ${state.generation}
ما بُني سابقاً:
${historySummary || "لا شيء بعد — هذه البداية"}
هدف التحسين: ${state.improvementGoal}
أنواع استُخدمت: ${state.usedCreativeTypes.join(", ") || "none"}
${state.lastFailure ? `فشل سابق: ${state.lastFailure}` : ""}

أنواع مقترحة (اختر واحداً أو اخترع): ${CREATIVE_TYPES.join(", ")}

أخرج JSON:
{
  "creativeType": "mini-game | interactive-tool | visual-experience | story | quiz | simulation",
  "idea": "وصف الفكرة بالعربية ثم English version",
  "whyNow": "لماذا هذه الفكرة في هذا الجيل / Why now",
  "userValue": "ما الفائدة للزائر / User benefit",
  "technicalApproach": "canvas / DOM / WebAudio / etc."
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
async function planEvolution(currentHTML, state, brainstorm) {
  const system = `أنت مهندس تجارب رقمية إبداعية ثنائي اللغة (عربي/إنجليزي).
حوّل فكرة brainstorm إلى خطة تنفيذية تفصيلية.
${LANGUAGE_RULES}
أخرج JSON فقط.`;

  const user = `الجيل: ${state.generation + 1}
فكرة الإبداع:
${JSON.stringify(brainstorm, null, 2)}

تاريخ الإبداع:
${JSON.stringify(state.creativeHistory?.slice(-2) || [], null, 2)}

مقتطف HTML الحالي:
${currentHTML.slice(0, 1200)}

أخرج JSON:
{
  "philosophy": "تأمل عربي عن الفكرة",
  "philosophyEn": "English reflection",
  "visualConcept": "وصف بصري AR / EN",
  "colorPalette": ["#hex1", "#hex2", "#hex3"],
  "uiElements": ["عنصر / element"],
  "interaction": "كيف يتفاعل المستخدم / How user interacts",
  "typography": "Google Font names",
  "evolutionGoal": "ما الجديد والأفضل عن الجيل السابق / What's better than before",
  "keepFromPrevious": "ما نحتفظ به من HTML الحالي",
  "newFeature": "الميزة الجديدة هذه الدورة"
}`;

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
  const historyFeatures = (state.creativeHistory || [])
    .map((h) => `${h.type}: ${h.feature}`)
    .join(", ");

  const system = `أنت فنان رقمي ومطور ألعاب وتجارب تفاعلية.
أنشئ تجربة تفاعلية حقيقية — لعبة، أداة، قصة، أو فن — وليست صفحة زينة.
أخرج HTML واحد كامل ومستقل فقط — بدون Markdown.
${LANGUAGE_RULES}`;

  const requirements = `
قواعد الإبداع:
- كل دورة تضيف ميزة جديدة أو تحسّن الموجود (لا تراجع أبداً)
- JavaScript تفاعلي يعمل: لعبة، أداة، quiz، محاكاة، أو تجربة
- <section lang="ar"> مع 3+ فقرات عربية
- <section lang="en"> مع 3+ فقرات إنجليزية مطابقة
- عداد جيل: "الجيل ${state.generation + 1}" و "Generation ${state.generation + 1}"
- Google Fonts + CSS في <style> + JS في <script>
- animations أو canvas أو requestAnimationFrame
- الجيل ${state.generation + 1} يجب أن يكون أقوى من الجيل ${state.generation}

من الجيل السابق — احتفظ وحسّن: ${historyFeatures || "nothing yet"}
أضف جديداً: ${brainstorm.creativeType} — ${brainstorm.idea}
الفكرة: ${JSON.stringify(brainstorm)}
الخطة: ${JSON.stringify(plan)}`;

  const user = `${requirements}
${retryHint ? `\nرُفض سابقاً: ${retryHint}\nأصلح كل المشاكل.` : ""}`;

  return ollamaChat(
    [{ role: "system", content: system }, { role: "user", content: user }],
    null,
    BUILD_OPTIONS
  );
}

// ---------------------------------------------------------------------------
// Phase 3 — AI bilingual audit
// ---------------------------------------------------------------------------
async function aiBilingualAudit(html) {
  const visibleText = extractVisibleText(html).slice(0, 2000);

  const system = `أنت مدقق لغوي صارم. افحص المحتوى المرئي.
أجب JSON فقط: { "passed": true, "issues": [] } أو { "passed": false, "issues": ["..."] }`;

  const user = `افحص هذا النص:
${visibleText}

هل عربي وإنجليزي فقط؟ هل يوجد صيني/ياباني/كوري/إسباني/فرنسي/روسي؟`;

  try {
    const raw = await ollamaChat(
      [{ role: "system", content: system }, { role: "user", content: user }],
      AI_AUDIT_TIMEOUT_MS,
      AUDIT_OPTIONS
    );

    if (raw.length < AI_AUDIT_MIN_CHARS) {
      console.warn(`[aiBilingualAudit] Response too short (${raw.length} chars) — failing audit`);
      return { passed: false, issues: ["AI audit response too short to trust"] };
    }

    let text = raw.trim().replace(/[\s\S]*?<\/think>/gi, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return { passed: false, issues: ["AI audit returned no JSON"] };
    }

    const result = JSON.parse(text.slice(start, end + 1));
    return { passed: !!result.passed, issues: result.issues || [] };
  } catch (err) {
    console.warn(`[aiBilingualAudit] Failed (${err.message}) — relying on automated checks`);
    return { passed: true, issues: [] };
  }
}

// ---------------------------------------------------------------------------
// HTML cleaning & text extraction
// ---------------------------------------------------------------------------
function cleanHTML(raw) {
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
    throw new Error("Response does not appear to be valid HTML");
  }
  return cleaned;
}

function extractVisibleText(html) {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  const texts = [];
  const tagPattern = /<(p|h[1-6]|span|li|td|th|figcaption|blockquote|label|a|button)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = tagPattern.exec(withoutScripts)) !== null) {
    const text = match[2].replace(/<[^>]+>/g, "").trim();
    if (text) texts.push(text);
  }
  return texts.join(" ");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const FORBIDDEN_WORDS = [
  /\bprincipal\b/i, /\bpáginas?\b/i, /\befecto\b/i, /\bbrillo\b/i,
  /\binteractivas?\b/i, /\bbeau\b/i, /\bavec\b/i, /\bpour\b/i,
];

function validateTextLanguages(text, label) {
  const errors = [];
  if (/[\u4E00-\u9FFF]/.test(text)) errors.push(`${label}: contains Chinese`);
  if (/[\u3040-\u30FF]/.test(text)) errors.push(`${label}: contains Japanese`);
  if (/[\uAC00-\uD7AF]/.test(text)) errors.push(`${label}: contains Korean`);
  if (/[\u0400-\u04FF]/.test(text)) errors.push(`${label}: contains Cyrillic`);
  for (const pattern of FORBIDDEN_WORDS) {
    if (pattern.test(text)) {
      errors.push(`${label}: forbidden word (${pattern.source})`);
      break;
    }
  }
  return errors;
}

function validatePlan(obj) {
  const text = JSON.stringify(obj);
  const errors = validateTextLanguages(text, "plan");

  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  if (arabicChars < 30) errors.push(`plan: insufficient Arabic (${arabicChars})`);
  if (latinChars < 30) errors.push(`plan: insufficient English (${latinChars})`);

  return { valid: errors.length === 0, errors };
}

function validateQuality(html, currentHTML) {
  const errors = [];
  if (html.length < 2000) errors.push(`too short (${html.length} chars)`);
  if (html.length > 50000) errors.push(`too long (${html.length} chars)`);

  const cssRules = (html.match(/\{[^}]*\}/g) || []).length;
  if (cssRules < 5) errors.push(`insufficient CSS rules (${cssRules})`);

  const hasMotion =
    /@keyframes/i.test(html) || /animation\s*:/i.test(html) ||
    /<canvas/i.test(html) || /requestAnimationFrame/i.test(html);
  if (!hasMotion) errors.push("missing animation");

  if (computeSimilarity(html, currentHTML) > 0.92) {
    errors.push("too similar to current HTML");
  }
  if (/<p>\s*<\/p>/i.test(html)) errors.push("empty paragraphs");

  return { valid: errors.length === 0, errors };
}

function validateInteractivity(html) {
  const errors = [];
  if (!/<script[\s>]/i.test(html)) {
    errors.push("missing <script> block");
    return { valid: false, errors };
  }

  const scriptMatch = html.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
  const scriptBody = scriptMatch?.[1] || "";

  const hasEvent =
    /addEventListener\s*\(\s*['"](?:click|keydown|keyup|mousemove|touchstart|pointerdown)['"]/i.test(scriptBody) ||
    /on(?:click|keydown|mousemove)\s*=/i.test(html);

  const hasLogic =
    /requestAnimationFrame/i.test(scriptBody) ||
    /setInterval/i.test(scriptBody) ||
    /function\s+\w+/i.test(scriptBody) ||
    /=>\s*\{/.test(scriptBody);

  if (!hasEvent && !/requestAnimationFrame/i.test(scriptBody)) {
    errors.push("no interactive events (click/keydown/mouse) or game loop");
  }
  if (!hasLogic) errors.push("script lacks logic (functions or game loop)");

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
  if (!/lang=["']ar["']/i.test(html)) errors.push("missing lang='ar' section");
  if (!/lang=["']en["']/i.test(html)) errors.push("missing lang='en' section");

  return { valid: errors.length === 0, errors };
}

function validateAll(html, currentHTML) {
  const errors = [
    ...validateQuality(html, currentHTML).errors,
    ...validateBilingual(html).errors,
    ...validateInteractivity(html).errors,
  ];
  return { valid: errors.length === 0, errors };
}

function computeSimilarity(a, b) {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  const tokensA = new Set(longer.match(/\w+/g) || []);
  const tokensB = new Set(shorter.match(/\w+/g) || []);
  let overlap = 0;
  for (const t of tokensB) if (tokensA.has(t)) overlap++;
  return overlap / Math.max(tokensA.size, 1);
}

// ---------------------------------------------------------------------------
// File & git operations
// ---------------------------------------------------------------------------
async function mutateBody(newHTML) {
  await writePublicFile(BODY_PATH, newHTML);
  console.log(`[mutateBody] Wrote ${newHTML.length} bytes to public/index.html`);
}

async function pushToNetwork() {
  const commitMsg = `Evolution Step: ${new Date().toISOString()}`;
  await execAsync("git add public/", { cwd: ROOT });
  console.log("[pushToNetwork] git add public/ — done");
  try {
    await execAsync(`git commit -m "${commitMsg}"`, { cwd: ROOT });
    console.log(`[pushToNetwork] git commit — "${commitMsg}"`);
  } catch (err) {
    const stderr = err.stderr || err.message || "";
    if (stderr.includes("nothing to commit") || stderr.includes("no changes added")) {
      console.log("[pushToNetwork] Nothing to commit — skipping push");
      return false;
    }
    throw new Error(`git commit failed: ${stderr}`);
  }
  await execAsync(`git push origin ${GIT_BRANCH}`, { cwd: ROOT });
  console.log(`[pushToNetwork] git push origin ${GIT_BRANCH} — done`);
  return true;
}

// ---------------------------------------------------------------------------
// developPhase — brainstorm → plan → build (no push)
// ---------------------------------------------------------------------------
async function developPhase(currentHTML, state) {
  const deadline = Date.now() + DEVELOP_MS;
  let retryHint = null;
  let attempt = 0;

  console.log(`[developPhase] Starting (${formatDuration(DEVELOP_MS)} window)`);

  while (Date.now() < deadline) {
    attempt++;
    console.log(`[developPhase] Attempt ${attempt} (${formatDuration(deadline - Date.now())} left)`);

    try {
      console.log("[developPhase] Phase 0: Brainstorm...");
      const brainstorm = await brainstormEvolution(currentHTML, state);
      const brainstormCheck = validatePlan(brainstorm);
      if (!brainstormCheck.valid) {
        console.warn(`[developPhase] Brainstorm rejected: ${brainstormCheck.errors.join("; ")}`);
        retryHint = brainstormCheck.errors.join("; ");
        continue;
      }

      if (Date.now() >= deadline) break;
      await sleep(PHASE_BREAK_MS);

      console.log("[developPhase] Phase 1: Planning...");
      const plan = await planEvolution(currentHTML, state, brainstorm);
      const planCheck = validatePlan(plan);
      if (!planCheck.valid) {
        console.warn(`[developPhase] Plan rejected: ${planCheck.errors.join("; ")}`);
        retryHint = planCheck.errors.join("; ");
        continue;
      }

      if (Date.now() >= deadline) break;
      await sleep(PHASE_BREAK_MS);

      console.log("[developPhase] Phase 2: Building...");
      const rawHTML = await buildHTML(plan, state, brainstorm, retryHint);
      const cleaned = cleanHTML(rawHTML);
      const check = validateAll(cleaned, currentHTML);

      if (check.valid) {
        console.log("[developPhase] Candidate passed all checks");
        return { success: true, plan, brainstorm, html: cleaned };
      }

      console.warn(`[developPhase] Build check failed: ${check.errors.join("; ")}`);
      retryHint = check.errors.join("; ");
    } catch (err) {
      console.error(`[developPhase] Attempt ${attempt} error: ${err.message}`);
    }
  }

  return { success: false, error: "Develop window expired without valid candidate" };
}

// ---------------------------------------------------------------------------
// verifyPhase — strict checks + AI audit, push only on success
// ---------------------------------------------------------------------------
async function verifyPhase(currentHTML, candidate) {
  const deadline = Date.now() + VERIFY_MS;
  console.log(`[verifyPhase] Starting (${formatDuration(VERIFY_MS)} window)`);

  if (!candidate?.html) {
    return { success: false, error: "No candidate HTML from develop phase" };
  }

  while (Date.now() < deadline) {
    const allChecks = validateAll(candidate.html, currentHTML);
    if (!allChecks.valid) {
      console.warn(`[verifyPhase] Check failed: ${allChecks.errors.join("; ")}`);
      await sleep(3000);
      continue;
    }
    console.log("[verifyPhase] Automated checks passed");

    const audit = await aiBilingualAudit(candidate.html);
    if (!audit.passed) {
      console.warn(`[verifyPhase] AI audit failed: ${audit.issues.join("; ")}`);
      await sleep(3000);
      continue;
    }
    console.log("[verifyPhase] AI audit passed");

    if (candidate.html.trim() === currentHTML.trim()) {
      return { success: false, error: "Output identical to current HTML" };
    }

    await mutateBody(candidate.html);
    await pushToNetwork();
    return {
      success: true,
      plan: candidate.plan,
      brainstorm: candidate.brainstorm,
    };
  }

  return { success: false, error: "Verify window expired without passing all checks" };
}

// ---------------------------------------------------------------------------
// runForever — develop → verify → rest
// ---------------------------------------------------------------------------
async function runForever() {
  while (true) {
    if (isEvolving) {
      await sleep(5000);
      continue;
    }

    isEvolving = true;
    const cycleStart = Date.now();
    const cycleDuration = { develop: 0, verify: 0, rest: 0 };
    const restBudget = Math.max(0, CYCLE_MS - DEVELOP_MS - VERIFY_MS);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[cycle] Started at ${new Date().toISOString()}`);
    console.log(`[cycle] develop ${formatDuration(DEVELOP_MS)} → verify ${formatDuration(VERIFY_MS)} → rest ~${formatDuration(restBudget)}`);
    console.log("=".repeat(60));

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

      if (verifyResult.success) {
        console.log("[cycle] Evolution deployed successfully");
        await updateState(
          state,
          verifyResult.plan || developResult.plan,
          verifyResult.brainstorm || developResult.brainstorm,
          developResult.plan?.philosophy,
          cycleDuration,
          null
        );
      } else {
        console.error(`[cycle] No deploy: ${verifyResult.error}`);
        await updateState(state, null, null, null, cycleDuration, verifyResult.error);
      }
    } catch (err) {
      console.error(`[cycle] Unexpected error: ${err.message}`);
    } finally {
      isEvolving = false;
    }

    const elapsed = Date.now() - cycleStart;
    const restMs = Math.max(0, CYCLE_MS - elapsed);
    cycleDuration.rest = restMs;

    console.log(`[cycle] Develop: ${formatDuration(cycleDuration.develop)} | Verify: ${formatDuration(cycleDuration.verify)} | Rest: ${formatDuration(restMs)}`);
    console.log(`[cycle] Next cycle at ${new Date(Date.now() + restMs).toISOString()}\n`);

    await sleep(restMs);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
console.log("The Network's Self-Awareness — Brain online (v4 Creative)");
console.log(`Ollama: ${OLLAMA_CHAT_URL}`);
console.log(`Model:  ${MODEL}`);
console.log(`Theme:  ${THEME}`);
console.log(`Cycle:  develop ${formatDuration(DEVELOP_MS)} + verify ${formatDuration(VERIFY_MS)} + rest ${formatDuration(CYCLE_MS - DEVELOP_MS - VERIFY_MS)} = ${formatDuration(CYCLE_MS)}`);
console.log(`Body:   ${BODY_PATH}`);
console.log(`State:  ${STATE_PATH}`);
console.log("");

runForever();
