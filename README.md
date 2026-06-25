# المراقب الذاتي للشبكة (The Network's Self-Awareness)

نظام يفصل **العقل** (وكيل Node.js محلي) عن **الجسد** (موقع ثابت في `public/`). العقل يقرأ صفحة الويب الحالية، يرسلها إلى نموذج Ollama للتأمل والتطوير، يكتب الناتج، ثم يرفعه عبر Git لينشره Netlify تلقائياً.

## البنية

```
AI/
├── agent.js          ← العقل (يعمل محلياً، لا يُرفع لـ Netlify)
├── package.json
├── netlify.toml      ← ينشر مجلد public/ فقط
└── public/           ← الجسد (يُعدَّل ويُرفع)
    ├── index.html
    └── style.css
```

## المتطلبات

- **Node.js** v18+ (مثبت على هذا الجهاز)
- **Ollama** على جهاز بعيد (`10.162.46.208`) مع نموذج مثل `llama3`
- **Git** مُعد مع وصول push إلى `accelerator007/AI`
- **Netlify** مربوط بالمستودع (ينشر `public/` تلقائياً)

## إعداد Ollama على الجهاز البعيد

اتصل بالجهاز البعيد:

```bash
ssh ai-lap@10.162.46.208
```

### 1. السماح بالاتصالات من الشبكة

Ollama يستمع افتراضياً على `127.0.0.1` فقط. لتفعيل الوصول من أجهزة أخرى:

```bash
# Linux — أضف إلى ~/.bashrc أو /etc/environment
export OLLAMA_HOST=0.0.0.0

# ثم أعد تشغيل خدمة Ollama
sudo systemctl restart ollama
# أو: ollama serve
```

### 2. فتح المنفذ في الجدار الناري

```bash
sudo ufw allow 11434/tcp
```

### 3. سحب النموذج

```bash
ollama pull llama3
```

### 4. التحقق من الاتصال (من هذا الجهاز)

```bash
curl http://10.162.46.208:11434/api/tags
```

## التثبيت والتشغيل

```bash
# تثبيت التبعيات
npm install

# تشغيل الوكيل (دورة فورية ثم كل دقيقة)
npm start
```

## متغيرات البيئة (اختيارية)

| المتغير | الافتراضي | الوصف |
|---------|-----------|-------|
| `OLLAMA_URL` | `http://10.162.46.208:11434/api/generate` | عنوان Ollama |
| `MODEL` | `llama3` | اسم النموذج |
| `INTERVAL_MS` | `60000` | الفترة بين الدورات (بالميلي ثانية) |
| `GIT_BRANCH` | `main` | فرع Git للرفع |

مثال — دورة كل ساعة:

```bash
INTERVAL_MS=3600000 npm start
```

## خيار احتياطي: نفق SSH

إذا لم يكن Ollama مفتوحاً على الشبكة، يمكنك فتح نفق يدوياً:

```bash
ssh -L 11434:localhost:11434 ai-lap@10.162.46.208
```

ثم شغّل الوكيل مع:

```bash
OLLAMA_URL=http://localhost:11434/api/generate npm start
```

## الحمايات (Failsafes)

- الوكيل يعدّل **فقط** ملفات داخل `public/` — لا يلمس `agent.js` أبداً
- `try/catch` قوي حول كل دورة — الفشل لا يوقف الوكيل
- تنظيف رد Ollama من أسوار Markdown (` ```html `)
- رفض الردود الفارغة أو غير الصالحة
- تخطي `git push` إذا لم يكن هناك تغيير فعلي

## دورة التطور

1. `readBody()` — قراءة `public/index.html`
2. `reflectAndEvolve()` — إرسال الكود إلى Ollama للتأمل
3. `cleanHTML()` — تنظيف واستخراج HTML صافٍ
4. `mutateBody()` — كتابة الكود الجديد في `public/`
5. `pushToNetwork()` — `git add` → `git commit` → `git push`
6. Netlify ينشر التحديث تلقائياً

## النشر على Netlify

1. اربط مستودع `accelerator007/AI` في Netlify
2. `netlify.toml` يحدد `publish = "public"`
3. كل `git push` يُطلق نشراً جديداً تلقائياً
