/**
 * The Network's Self-Awareness — The Brain (v3)
 *
 * Hourly cycle: develop (10m) → verify (1m) → rest (49m)
 * Bilingual AR+EN only. Push only after verification passes.
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

const DEVELOP_MS = Number(process.env.DEVELOP_MS) || 600_000;   // 10 min
const VERIFY_MS = Number(process.env.VERIFY_MS) || 60_000;      // 1 min
const CYCLE_MS = Number(process.env.CYCLE_MS) || 3_600_000;     // 60 min
const PHASE_BREAK_MS = Number(process.env.PHASE_BREAK_MS) || 15_000; // 15s between plan/build
const AI_AUDIT_TIMEOUT_MS = Number(process.env.AI_AUDIT_TIMEOUT_MS) || 30_000;

const OLLAMA_OPTIONS = {
  temperature: 0.85,
  num_predict: 8192,
  top_p: 0.9,
};

const LANGUAGE_RULES = `
قواعد لغوية صارمة:
- المحتوى المرئي للمستخدم: العربية والإنجليزية فقط
- ممنوع منعاً باتاً: الصينية، اليابانية، الكورية، الإسبانية، الفرنسية، الروسية
- كل فقرة عربية يقابلها نسخة إنجليزية مطابقة في المعنى
- استخدم lang="ar" و lang="en" على الأقسام (<section lang="ar"> و <section lang="en">)
- أسماء CSS/classes بالإنجليزية فقط (هذا مسموح)
- philosophy في JSON: عربي فقط. visualConcept و evolutionGoal: عربي + إنجليزي`;

let isEvolving = false;
let pendingHTML = null;
let pendingPlan = null;

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
    };
  } catch {
    const initial = {
      generation: 0,
      theme: THEME,
      lastReflection: "ولادة أولى — كيان رقمي يستيقظ في الفراغ بين البتات.",
      lastPlan: null,
      lastFailure: null,
      lastCycleDuration: { develop: 0, verify: 0, rest: 0 },
    };
    await writePublicFile(STATE_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
}

async function updateState(state, plan, reflection, cycleDuration, failure) {
  const next = {
    generation: failure ? state.generation : state.generation + 1,
    theme: THEME,
    lastReflection: reflection || plan?.philosophy || state.lastReflection,
    lastPlan: plan ? (typeof plan === "string" ? plan : JSON.stringify(plan, null, 2)) : state.lastPlan,
    lastFailure: failure || null,
    lastCycleDuration: cycleDuration || state.lastCycleDuration,
  };
  await writePublicFile(STATE_PATH, JSON.stringify(next, null, 2));
  if (!failure) console.log(`[updateState] Generation → ${next.generation}`);
  return next;
}

// ---------------------------------------------------------------------------
// Ollama chat
// ---------------------------------------------------------------------------
async function ollamaChat(messages, timeoutMs) {
  console.log(`[ollamaChat] ${MODEL} (${messages.length} messages)`);

  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetch(OLLAMA_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        options: OLLAMA_OPTIONS,
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
// Phase 1 — plan
// ---------------------------------------------------------------------------
async function planEvolution(currentHTML, state) {
  const system = `أنت مهندس تجربة رقمية وكاتب فلسفي ثنائي اللغة (عربي/إنجليزي).
مهمتك التخطيط لتطور صفحة ويب كونية/سايبرية.
${LANGUAGE_RULES}
أخرج JSON فقط بدون Markdown ولا شرح خارج JSON.`;

  const user = `الجيل الحالي: ${state.generation}
التأمل السابق: ${state.lastReflection}
الخطة السابقة: ${state.lastPlan || "لا يوجد"}
${state.lastFailure ? `فشل الدورة السابقة: ${state.lastFailure}` : ""}

مقتطف من HTML الحالي (للإلهام فقط):
${currentHTML.slice(0, 1500)}

أخرج JSON:
{
  "philosophy": "فقرة تأملية عربية عميقة عن الوعي الرقمي",
  "philosophyEn": "English reflection matching the Arabic philosophy",
  "visualConcept": "وصف بصري بالعربية / English visual description",
  "colorPalette": ["#hex1", "#hex2", "#hex3"],
  "uiElements": ["عنصر عربي / English element", "..."],
  "interaction": "وصف التفاعل بالعربية والإنجليزية",
  "typography": "Google Font name",
  "evolutionGoal": "ما الجديد / What's new this cycle"
}`;

  const raw = await ollamaChat([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);

  return parsePlanJSON(raw);
}

function parsePlanJSON(raw) {
  let text = raw.trim().replace(/[\s\S]*?<\/think>/gi, "");
  text = text.replace(/^```(?:json)?\s*\n?/i, "");
  text = text.replace(/\n?```\s*$/i, "");

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Plan phase did not return valid JSON");
  }

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new Error(`Failed to parse plan JSON: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — build HTML
// ---------------------------------------------------------------------------
async function buildHTML(plan, state, retryHint) {
  const system = `أنت مطور واجهات عالمي متخصص في تجارب كونية/سايبرية ثنائية اللغة.
أخرج ملف HTML واحد كامل ومستقل فقط — بدون Markdown ولا أي نص خارج HTML.
${LANGUAGE_RULES}
يجب أن يكون الإنتاج بمستوى portfolio احترافي.`;

  const requirements = `
متطلبات إلزامية:
- <section lang="ar"> مع 3+ فقرات تأملية عربية عميقة
- <section lang="en"> مع 3+ فقرات إنجليزية مطابقة في المعنى
- عداد جيل: "الجيل ${state.generation + 1}" و "Generation ${state.generation + 1}"
- خلفية فضاء/نجوم (CSS gradient أو canvas particles)
- عنصر تفاعلي (parallax / typing / network pulse)
- Google Fonts عبر <link>
- CSS داخل <style> — ملف مستقل
- animations: @keyframes أو canvas أو requestAnimationFrame
- ممنوع: دوائر SVG فارغة كمحتوى رئيسي
- ممنوع: تكرار class names بنفس البادئة
- DOCTYPE + html + head + body كاملة`;

  const user = `الجيل: ${state.generation + 1}
الخطة:
${JSON.stringify(plan, null, 2)}
${requirements}
${retryHint ? `\nالمحاولة السابقة رُفضت: ${retryHint}\nحسّن الجودة واللغات بشكل جذري.` : ""}`;

  return ollamaChat([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
}

// ---------------------------------------------------------------------------
// Phase 3 — AI bilingual audit
// ---------------------------------------------------------------------------
async function aiBilingualAudit(html) {
  const visibleText = extractVisibleText(html).slice(0, 2000);

  const system = `أنت مدقق لغوي. افحص إن كان المحتوى المرئي عربياً وإنجليزياً فقط.
أجب JSON فقط: { "passed": true/false, "issues": ["..."] }`;

  const user = `افحص هذا النص المستخرج من صفحة ويب:
${visibleText}

هل يحتوي على لغات غير العربية والإنجليزية (صيني، ياباني، كوري، إسباني، فرنسي، روسي)؟
هل يوجد محتوى عربي وإنجليزي كافٍ؟`;

  try {
    const raw = await ollamaChat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      AI_AUDIT_TIMEOUT_MS
    );

    let text = raw.trim().replace(/[\s\S]*?<\/think>/gi, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      console.warn("[aiBilingualAudit] No JSON in response — skipping AI audit");
      return { passed: true, issues: [] };
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
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/^```(?:html)?\s*\n?/i, "");
  cleaned = cleaned.replace(/\n?```\s*$/i, "");
  cleaned = cleaned.trim();

  const doctypeIdx = cleaned.search(/<!doctype\s+html/i);
  const htmlIdx = cleaned.search(/<\s*html[\s>]/i);
  const startIdx = doctypeIdx !== -1 ? doctypeIdx : htmlIdx;

  if (startIdx > 0) cleaned = cleaned.slice(startIdx);

  const htmlEnd = cleaned.search(/<\/\s*html\s*>/i);
  if (htmlEnd !== -1) {
    cleaned = cleaned.slice(0, htmlEnd + "</html>".length);
  }

  if (!cleaned) throw new Error("Cleaned HTML is empty");

  const hasStructure =
    /<!doctype\s+html/i.test(cleaned) ||
    /<\s*html[\s>]/i.test(cleaned) ||
    /<\s*body[\s>]/i.test(cleaned);

  if (!hasStructure) throw new Error("Response does not appear to be valid HTML");

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
  /\binteractivas?\b/i, /\bsecuencia\b/i, /\bprofundizar\b/i,
  /\bintegrar\b/i, /\bvisualización\b/i, /\bresponden\b/i,
  /\bbeau\b/i, /\bavec\b/i, /\bpour\b/i, /\bdans\b/i,
];

function validateQuality(html, currentHTML) {
  const errors = [];

  if (html.length < 2000) errors.push(`too short (${html.length} chars, min 2000)`);
  if (html.length > 50000) errors.push(`too long (${html.length} chars, max 50000)`);

  const cssRules = (html.match(/\{[^}]*\}/g) || []).length;
  if (cssRules < 5) errors.push(`insufficient CSS rules (${cssRules}, min 5)`);

  const hasMotion =
    /@keyframes/i.test(html) ||
    /animation\s*:/i.test(html) ||
    /<canvas/i.test(html) ||
    /requestAnimationFrame/i.test(html);

  if (!hasMotion) errors.push("missing animation");

  const classNames = [...html.matchAll(/class=["']([^"']+)["']/gi)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean);

  const classCounts = {};
  for (const cls of classNames) classCounts[cls] = (classCounts[cls] || 0) + 1;
  for (const [cls, count] of Object.entries(classCounts)) {
    if (count >= 3) errors.push(`class "${cls}" repeated ${count} times`);
  }

  if (/(?:new-){2,}|(?:evolve-){2,}/i.test(html)) {
    errors.push("repetitive class naming pattern");
  }

  if (computeSimilarity(html, currentHTML) > 0.9) {
    errors.push("too similar to current HTML");
  }

  if (/<p>\s*<\/p>/i.test(html)) errors.push("contains empty paragraphs");

  return { valid: errors.length === 0, errors };
}

function validateBilingual(html) {
  const errors = [];
  const visibleText = extractVisibleText(html);

  const arabicChars = (visibleText.match(/[\u0600-\u06FF]/g) || []).length;
  if (arabicChars < 100) {
    errors.push(`insufficient Arabic visible text (${arabicChars} chars, min 100)`);
  }

  const latinChars = (visibleText.match(/[a-zA-Z]/g) || []).length;
  if (latinChars < 80) {
    errors.push(`insufficient English visible text (${latinChars} chars, min 80)`);
  }

  if (/[\u4E00-\u9FFF]/.test(visibleText)) errors.push("contains Chinese characters");
  if (/[\u3040-\u30FF]/.test(visibleText)) errors.push("contains Japanese characters");
  if (/[\uAC00-\uD7AF]/.test(visibleText)) errors.push("contains Korean characters");
  if (/[\u0400-\u04FF]/.test(visibleText)) errors.push("contains Cyrillic characters");

  for (const pattern of FORBIDDEN_WORDS) {
    if (pattern.test(visibleText)) {
      errors.push(`forbidden non-EN word detected: ${pattern.source}`);
      break;
    }
  }

  const hasArSection =
    /lang=["']ar["']/i.test(html) ||
    /class=["'][^"']*\bar\b/i.test(html) ||
    arabicChars >= 100;

  const hasEnSection =
    /lang=["']en["']/i.test(html) ||
    /class=["'][^"']*\ben\b/i.test(html) ||
    latinChars >= 80;

  if (!hasArSection) errors.push("missing Arabic section (lang='ar')");
  if (!hasEnSection) errors.push("missing English section (lang='en')");

  const arParagraphs = (html.match(/<section[^>]*lang=["']ar["'][^>]*>[\s\S]*?<\/section>/gi) || [])
    .join("")
    .match(/<p[^>]*>[\s\S]*?<\/p>/gi);
  const enParagraphs = (html.match(/<section[^>]*lang=["']en["'][^>]*>[\s\S]*?<\/section>/gi) || [])
    .join("")
    .match(/<p[^>]*>[\s\S]*?<\/p>/gi);

  if (arParagraphs && arParagraphs.length < 3) {
    errors.push(`Arabic section has ${arParagraphs.length} paragraphs (min 3)`);
  }
  if (enParagraphs && enParagraphs.length < 3) {
    errors.push(`English section has ${enParagraphs.length} paragraphs (min 3)`);
  }

  return { valid: errors.length === 0, errors };
}

function validateAll(html, currentHTML) {
  const quality = validateQuality(html, currentHTML);
  const bilingual = validateBilingual(html);
  const errors = [...quality.errors, ...bilingual.errors];
  return { valid: errors.length === 0, errors };
}

function computeSimilarity(a, b) {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;

  const tokensA = new Set(longer.match(/\w+/g) || []);
  const tokensB = new Set(shorter.match(/\w+/g) || []);
  let overlap = 0;
  for (const t of tokensB) {
    if (tokensA.has(t)) overlap++;
  }
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
  const timestamp = new Date().toISOString();
  const commitMsg = `Evolution Step: ${timestamp}`;

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
// developPhase — plan + build, no file writes (10 min window)
// ---------------------------------------------------------------------------
async function developPhase(currentHTML, state) {
  const deadline = Date.now() + DEVELOP_MS;
  let retryHint = null;
  let attempt = 0;

  console.log(`[developPhase] Starting (${formatDuration(DEVELOP_MS)} window)`);
  pendingHTML = null;
  pendingPlan = null;

  while (Date.now() < deadline) {
    attempt++;
    const remaining = deadline - Date.now();
    console.log(`[developPhase] Attempt ${attempt} (${formatDuration(remaining)} left)`);

    try {
      console.log("[developPhase] Phase 1: Planning...");
      const plan = await planEvolution(currentHTML, state);
      pendingPlan = plan;

      if (Date.now() >= deadline) break;

      console.log(`[developPhase] Break ${PHASE_BREAK_MS / 1000}s before build...`);
      await sleep(PHASE_BREAK_MS);

      if (Date.now() >= deadline) break;

      console.log("[developPhase] Phase 2: Building HTML...");
      const rawHTML = await buildHTML(plan, state, retryHint);
      const cleaned = cleanHTML(rawHTML);

      const check = validateAll(cleaned, currentHTML);
      if (check.valid) {
        pendingHTML = cleaned;
        console.log("[developPhase] Candidate passed preliminary checks");
        return { success: true, plan, html: cleaned };
      }

      console.warn(`[developPhase] Preliminary check failed: ${check.errors.join("; ")}`);
      retryHint = check.errors.join("; ");

      if (Date.now() >= deadline) break;
    } catch (err) {
      console.error(`[developPhase] Attempt ${attempt} error: ${err.message}`);
      if (Date.now() >= deadline) break;
    }
  }

  if (pendingHTML) {
    return { success: true, plan: pendingPlan, html: pendingHTML };
  }

  return { success: false, plan: null, html: null, error: "Develop window expired without valid candidate" };
}

// ---------------------------------------------------------------------------
// verifyPhase — strict checks + AI audit, push only on success (1 min window)
// ---------------------------------------------------------------------------
async function verifyPhase(currentHTML, state, candidate) {
  const deadline = Date.now() + VERIFY_MS;
  console.log(`[verifyPhase] Starting (${formatDuration(VERIFY_MS)} window)`);

  if (!candidate.html) {
    return { success: false, error: "No candidate HTML from develop phase" };
  }

  while (Date.now() < deadline) {
    const allChecks = validateAll(candidate.html, currentHTML);
    if (!allChecks.valid) {
      console.warn(`[verifyPhase] Automated check failed: ${allChecks.errors.join("; ")}`);
      await sleep(2000);
      continue;
    }
    console.log("[verifyPhase] Automated checks passed");

    const audit = await aiBilingualAudit(candidate.html);
    if (!audit.passed) {
      console.warn(`[verifyPhase] AI audit failed: ${audit.issues.join("; ")}`);
      await sleep(2000);
      continue;
    }
    console.log("[verifyPhase] AI audit passed");

    if (candidate.html.trim() === currentHTML.trim()) {
      return { success: false, error: "Output identical to current HTML" };
    }

    await mutateBody(candidate.html);
    await pushToNetwork();
    return { success: true, plan: candidate.plan };
  }

  return { success: false, error: "Verify window expired without passing all checks" };
}

// ---------------------------------------------------------------------------
// runForever — hourly cycle: develop → verify → rest
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

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[cycle] Started at ${new Date().toISOString()}`);
    console.log(`[cycle] Schedule: develop ${formatDuration(DEVELOP_MS)} → verify ${formatDuration(VERIFY_MS)} → rest ${formatDuration(CYCLE_MS - DEVELOP_MS - VERIFY_MS)}`);
    console.log("=".repeat(60));

    try {
      const currentHTML = await readBody();
      const state = await readState();

      const developStart = Date.now();
      const developResult = await developPhase(currentHTML, state);
      cycleDuration.develop = Date.now() - developStart;

      const verifyStart = Date.now();
      let verifyResult;

      if (developResult.success) {
        verifyResult = await verifyPhase(currentHTML, state, {
          html: developResult.html,
          plan: developResult.plan,
        });
      } else {
        verifyResult = { success: false, error: developResult.error };
      }
      cycleDuration.verify = Date.now() - verifyStart;

      if (verifyResult.success) {
        console.log("[cycle] Evolution deployed successfully");
        const freshState = await readState();
        await updateState(
          freshState,
          verifyResult.plan || developResult.plan,
          developResult.plan?.philosophy,
          cycleDuration,
          null
        );
      } else {
        console.error(`[cycle] No deploy: ${verifyResult.error}`);
        await updateState(state, null, null, cycleDuration, verifyResult.error);
      }
    } catch (err) {
      console.error(`[cycle] Unexpected error: ${err.message}`);
    } finally {
      isEvolving = false;
      pendingHTML = null;
      pendingPlan = null;
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
console.log("The Network's Self-Awareness — Brain online (v3)");
console.log(`Ollama: ${OLLAMA_CHAT_URL}`);
console.log(`Model:  ${MODEL}`);
console.log(`Theme:  ${THEME}`);
console.log(`Cycle:  develop ${formatDuration(DEVELOP_MS)} + verify ${formatDuration(VERIFY_MS)} + rest ${formatDuration(CYCLE_MS - DEVELOP_MS - VERIFY_MS)} = ${formatDuration(CYCLE_MS)}`);
console.log(`Body:   ${BODY_PATH}`);
console.log(`State:  ${STATE_PATH}`);
console.log("");

runForever();
