/**
 * The Network's Self-Awareness — The Brain
 *
 * Two-phase evolution: plan (JSON) → build (HTML) via Ollama chat API.
 * Quality gate rejects weak output; state.json tracks generation context.
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

// --- Configuration (override via environment variables) ---
const OLLAMA_BASE =
  process.env.OLLAMA_BASE || "http://10.162.46.208:11434";
const OLLAMA_CHAT_URL =
  process.env.OLLAMA_URL || `${OLLAMA_BASE}/api/chat`;
const MODEL = process.env.MODEL || "deepseek-r1:14b";
const INTERVAL_MS = Number(process.env.INTERVAL_MS) || 1_800_000; // 30 min
const GIT_BRANCH = process.env.GIT_BRANCH || "main";
const THEME = process.env.THEME || "cosmic";

const OLLAMA_OPTIONS = {
  temperature: 0.85,
  num_predict: 8192,
  top_p: 0.9,
};

let isEvolving = false;

// ---------------------------------------------------------------------------
// Path guard — only allow writes inside public/
// ---------------------------------------------------------------------------
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
// readBody / readState / updateState
// ---------------------------------------------------------------------------
async function readBody() {
  const html = await fs.readFile(BODY_PATH, "utf-8");
  console.log(`[readBody] Read ${html.length} bytes from public/index.html`);
  return html;
}

async function readState() {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    const initial = {
      generation: 0,
      theme: THEME,
      lastReflection: "ولادة أولى — كيان رقمي يستيقظ في الفراغ بين البتات.",
      lastPlan: null,
    };
    await writePublicFile(STATE_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
}

async function updateState(state, plan, reflection) {
  const next = {
    generation: state.generation + 1,
    theme: THEME,
    lastReflection: reflection || plan?.philosophy || state.lastReflection,
    lastPlan: typeof plan === "string" ? plan : JSON.stringify(plan, null, 2),
  };
  await writePublicFile(STATE_PATH, JSON.stringify(next, null, 2));
  console.log(`[updateState] Generation → ${next.generation}`);
  return next;
}

// ---------------------------------------------------------------------------
// ollamaChat — unified chat API wrapper
// ---------------------------------------------------------------------------
async function ollamaChat(messages) {
  console.log(`[ollamaChat] ${MODEL} @ ${OLLAMA_CHAT_URL} (${messages.length} messages)`);

  const response = await fetch(OLLAMA_CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      options: OLLAMA_OPTIONS,
    }),
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
}

// ---------------------------------------------------------------------------
// Phase 1 — plan evolution as JSON
// ---------------------------------------------------------------------------
async function planEvolution(currentHTML, state) {
  const system = `أنت مهندس تجربة رقمية وكاتب فلسفي. مهمتك التخطيط لتطور صفحة ويب كونية/سايبرية.
الموضوع البصري: فضاء، نجوم، توهج، شبكات عصبية، وعي رقمي.
أخرج JSON فقط بدون Markdown ولا شرح خارج JSON.`;

  const user = `الجيل الحالي: ${state.generation}
التأمل السابق: ${state.lastReflection}
الخطة السابقة: ${state.lastPlan || "لا يوجد"}

مقتطف من HTML الحالي (للإلهام فقط، لا تنسخه):
${currentHTML.slice(0, 1500)}

خطط الدورة القادمة. أخرج JSON بهذا الشكل:
{
  "philosophy": "فقرة تأملية عربية عميقة عن الوعي الرقمي",
  "visualConcept": "وصف بصري للصفحة الجديدة",
  "colorPalette": ["#hex1", "#hex2", "#hex3"],
  "uiElements": ["عنصر1", "عنصر2", "عنصر3"],
  "interaction": "وصف التفاعل (parallax / particles / typing / network pulse)",
  "typography": "اسم خط Google Fonts",
  "evolutionGoal": "ما الجديد في هذه الدورة مقارنة بالسابقة"
}`;

  const raw = await ollamaChat([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);

  return parsePlanJSON(raw);
}

function parsePlanJSON(raw) {
  let text = raw.trim();
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
// Phase 2 — build full HTML from plan
// ---------------------------------------------------------------------------
async function buildHTML(plan, state, retryHint) {
  const system = `أنت مطور واجهات عالمي متخصص في تجارب كونية/سايبرية تفاعلية.
أخرج ملف HTML واحد كامل ومستقل فقط — بدون Markdown ولا أي نص خارج HTML.
يجب أن يكون الإنتاج بمستوى portfolio احترافي.`;

  const requirements = `
متطلبات إلزامية:
- خلفية فضاء/نجوم (CSS gradient متحرك أو canvas particles)
- 3+ فقرات عربية تأملية عميقة (ليست placeholder)
- عداد جيل مرئي يعرض الرقم ${state.generation + 1}
- عنصر تفاعلي واحد على الأقل (mouse parallax أو typing effect أو شبكة عقد نابضة)
- خط من Google Fonts عبر <link>
- كل CSS داخل <style> في نفس الملف — لا تستخدم ملفات خارجية
- animations: @keyframes أو canvas أو requestAnimationFrame
- ممنوع: دوائر SVG فارغة كمحتوى رئيسي
- ممنوع: تكرار class names بنفس البادئة (evolve-new, new-evolve-new, etc.)
- DOCTYPE + html + head + body كاملة
- الاتجاه RTL واللغة العربية`;

  const user = `الجيل: ${state.generation + 1}
الخطة:
${JSON.stringify(plan, null, 2)}
${requirements}
${retryHint ? `\nتحذير: المحاولة السابقة رُفضت. السبب: ${retryHint}\nحسّن الجودة بشكل جذري.` : ""}`;

  return ollamaChat([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
}

// ---------------------------------------------------------------------------
// reflectAndEvolve — two-phase orchestration
// ---------------------------------------------------------------------------
async function reflectAndEvolve(currentHTML, state, retryHint) {
  console.log("[reflectAndEvolve] Phase 1: Planning...");
  const plan = await planEvolution(currentHTML, state);

  console.log("[reflectAndEvolve] Phase 2: Building HTML...");
  const rawHTML = await buildHTML(plan, state, retryHint);

  return { plan, rawHTML };
}

// ---------------------------------------------------------------------------
// cleanHTML — strip fences, thinking tags, extract HTML document
// ---------------------------------------------------------------------------
function cleanHTML(raw) {
  let cleaned = raw.trim();

  // Strip deepseek thinking blocks if present
  cleaned = cleaned.replace(/[\s\S]*?<\/think>/gi, "");

  // Remove markdown fences
  cleaned = cleaned.replace(/^```(?:html)?\s*\n?/i, "");
  cleaned = cleaned.replace(/\n?```\s*$/i, "");
  cleaned = cleaned.trim();

  // Extract from <!DOCTYPE or <html if model added preamble text
  const doctypeIdx = cleaned.search(/<!doctype\s+html/i);
  const htmlIdx = cleaned.search(/<\s*html[\s>]/i);
  const startIdx = doctypeIdx !== -1 ? doctypeIdx : htmlIdx;

  if (startIdx > 0) {
    cleaned = cleaned.slice(startIdx);
  }

  const htmlEnd = cleaned.search(/<\/\s*html\s*>/i);
  if (htmlEnd !== -1) {
    cleaned = cleaned.slice(0, htmlEnd + "</html>".length);
  }

  if (!cleaned) {
    throw new Error("Cleaned HTML is empty");
  }

  const hasStructure =
    /<!doctype\s+html/i.test(cleaned) ||
    /<\s*html[\s>]/i.test(cleaned) ||
    /<\s*body[\s>]/i.test(cleaned);

  if (!hasStructure) {
    throw new Error("Response does not appear to be valid HTML");
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// validateQuality — reject weak output before writing
// ---------------------------------------------------------------------------
function validateQuality(html, currentHTML) {
  const errors = [];

  if (html.length < 2000) {
    errors.push(`too short (${html.length} chars, min 2000)`);
  }
  if (html.length > 50000) {
    errors.push(`too long (${html.length} chars, max 50000)`);
  }

  const arabicChars = (html.match(/[\u0600-\u06FF]/g) || []).length;
  if (arabicChars < 100) {
    errors.push(`insufficient Arabic text (${arabicChars} chars, min 100)`);
  }

  const cssRules = (html.match(/\{[^}]*\}/g) || []).length;
  if (cssRules < 5) {
    errors.push(`insufficient CSS rules (${cssRules}, min 5)`);
  }

  const hasMotion =
    /@keyframes/i.test(html) ||
    /animation\s*:/i.test(html) ||
    /<canvas/i.test(html) ||
    /requestAnimationFrame/i.test(html);

  if (!hasMotion) {
    errors.push("missing animation (keyframes, animation, canvas, or rAF)");
  }

  const classNames = [...html.matchAll(/class=["']([^"']+)["']/gi)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean);

  const classCounts = {};
  for (const cls of classNames) {
    classCounts[cls] = (classCounts[cls] || 0) + 1;
  }
  for (const [cls, count] of Object.entries(classCounts)) {
    if (count >= 3) {
      errors.push(`class "${cls}" repeated ${count} times`);
    }
  }

  const prefixPattern = /(?:new-){2,}|(?:evolve-){2,}/i;
  if (prefixPattern.test(html)) {
    errors.push("repetitive class naming pattern detected");
  }

  const similarity = computeSimilarity(html, currentHTML);
  if (similarity > 0.9) {
    errors.push(`too similar to current HTML (${(similarity * 100).toFixed(0)}%)`);
  }

  if (/<p>\s*<\/p>/i.test(html)) {
    errors.push("contains empty paragraphs");
  }

  return { valid: errors.length === 0, errors };
}

function computeSimilarity(a, b) {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;

  // Simple token overlap ratio (fast approximation)
  const tokensA = new Set(longer.match(/\w+/g) || []);
  const tokensB = new Set(shorter.match(/\w+/g) || []);
  let overlap = 0;
  for (const t of tokensB) {
    if (tokensA.has(t)) overlap++;
  }
  return overlap / Math.max(tokensA.size, 1);
}

// ---------------------------------------------------------------------------
// mutateBody — write new HTML to public/ only
// ---------------------------------------------------------------------------
async function mutateBody(newHTML) {
  await writePublicFile(BODY_PATH, newHTML);
  console.log(`[mutateBody] Wrote ${newHTML.length} bytes to public/index.html`);
}

// ---------------------------------------------------------------------------
// pushToNetwork — git add → commit → push
// ---------------------------------------------------------------------------
async function pushToNetwork() {
  const timestamp = new Date().toISOString();
  const commitMsg = `Evolution Step: ${timestamp}`;

  try {
    await execAsync("git add public/", { cwd: ROOT });
    console.log("[pushToNetwork] git add public/ — done");
  } catch (err) {
    throw new Error(`git add failed: ${err.stderr || err.message}`);
  }

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

  try {
    await execAsync(`git push origin ${GIT_BRANCH}`, { cwd: ROOT });
    console.log(`[pushToNetwork] git push origin ${GIT_BRANCH} — done`);
  } catch (err) {
    throw new Error(`git push failed: ${err.stderr || err.message}`);
  }

  return true;
}

// ---------------------------------------------------------------------------
// live — one full evolution cycle with quality gate + retry
// ---------------------------------------------------------------------------
async function live() {
  if (isEvolving) {
    console.log("[live] Previous cycle still running — skipping");
    return;
  }

  isEvolving = true;
  const cycleStart = new Date().toISOString();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[live] Evolution cycle started at ${cycleStart}`);
  console.log("=".repeat(60));

  try {
    const currentHTML = await readBody();
    const state = await readState();

    let retryHint = null;
    let cleanedHTML = null;
    let plan = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      console.log(`[live] Attempt ${attempt}/2`);
      const result = await reflectAndEvolve(currentHTML, state, retryHint);
      plan = result.plan;
      cleanedHTML = cleanHTML(result.rawHTML);

      const quality = validateQuality(cleanedHTML, currentHTML);
      if (quality.valid) {
        console.log("[live] Quality gate passed");
        break;
      }

      console.warn(`[live] Quality gate failed: ${quality.errors.join("; ")}`);
      if (attempt === 2) {
        throw new Error(`Quality gate failed after 2 attempts: ${quality.errors.join("; ")}`);
      }
      retryHint = quality.errors.join("; ");
    }

    if (cleanedHTML === currentHTML.trim()) {
      console.log("[live] Output identical to current — skipping mutation");
      return;
    }

    await mutateBody(cleanedHTML);
    await updateState(state, plan, plan?.philosophy);
    await pushToNetwork();
    console.log("[live] Evolution cycle completed successfully");
  } catch (err) {
    console.error(`[live] Cycle failed (will retry next interval): ${err.message}`);
  } finally {
    isEvolving = false;
  }
}

// ---------------------------------------------------------------------------
// Daemon entry point
// ---------------------------------------------------------------------------
console.log("The Network's Self-Awareness — Brain online (v2)");
console.log(`Ollama: ${OLLAMA_CHAT_URL}`);
console.log(`Model:  ${MODEL}`);
console.log(`Theme:  ${THEME}`);
console.log(`Interval: ${INTERVAL_MS / 1000}s (${(INTERVAL_MS / 60000).toFixed(0)} min)`);
console.log(`Body:   ${BODY_PATH}`);
console.log(`State:  ${STATE_PATH}`);
console.log("");

live();
setInterval(live, INTERVAL_MS);
