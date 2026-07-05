const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const path = require('path');

const app = express();
const PORT = 3000;

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const ACCESS_CODE = 'scatter';          // ← смени на свой код
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_TEXT_LENGTH = 500;
const MAX_OBJECTS = 40;                 // при переполнении — удаляется самый старый
const LIBRETRANSLATE_URL = 'http://localhost:5000';

// ─── IN-MEMORY STORE ─────────────────────────────────────────────────────────
let objects = []; // { id, type, content, mimeType, x, y, w, h, createdAt }

// ─── MULTER (файлы в памяти) ──────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','image/webp','audio/mpeg','audio/ogg','audio/wav','audio/mp4'];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── CRON: чистка каждый час ──────────────────────────────────────────────────
cron.schedule('0 * * * *', () => {
  objects = [];
  console.log('[cron] все объекты удалены', new Date().toISOString());
});

// ─── ПЕРЕВОД (MyMemory — бесплатно, без ключа) ───────────────────────────────
async function translate(text, targetLang) {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.responseStatus === 200) return data.responseData.translatedText;
    return null;
  } catch { return null; }
}

// ─── API: проверка кода ───────────────────────────────────────────────────────
app.post('/api/auth', (req, res) => {
  const { code } = req.body;
  res.json({ ok: code === ACCESS_CODE });
});

// ─── API: получить все объекты (с переводом) ──────────────────────────────────
app.get('/api/objects', async (req, res) => {
  const lang = (req.query.lang || 'en').slice(0, 5);
  const result = await Promise.all(objects.map(async obj => {
    if (obj.type === 'text' && lang !== 'en') {
      const translated = await translate(obj.content, lang);
      return { ...obj, content: translated || obj.content };
    }
    return obj;
  }));
  res.json(result);
});

// ─── API: разместить координаты (от клиента) ─────────────────────────────────
function findFreeSpot(w, h, viewportW, viewportH) {
  const padding = 16;
  const ATTEMPTS = 80;

  for (let i = 0; i < ATTEMPTS; i++) {
    const x = padding + Math.random() * (viewportW - w - padding * 2);
    const y = padding + Math.random() * (viewportH - h - padding * 2);
    const overlaps = objects.some(o => {
      return !(x + w + padding < o.x ||
               x > o.x + o.w + padding ||
               y + h + padding < o.y ||
               y > o.y + o.h + padding);
    });
    if (!overlaps) return { x: Math.round(x), y: Math.round(y) };
  }
  return null; // нет места
}

// ─── API: добавить текст ──────────────────────────────────────────────────────
app.post('/api/post/text', async (req, res) => {
  const { text, vw, vh, lang: senderLang } = req.body;
  if (!text || text.length > MAX_TEXT_LENGTH) return res.status(400).json({ error: 'invalid text' });

  const w = Math.min(320, Math.max(160, text.length * 8));
  const h = Math.ceil(text.length / 30) * 24 + 32;
  const spot = findFreeSpot(w, h, vw || 1200, vh || 800);

  if (!spot) {
    if (objects.length >= MAX_OBJECTS) objects.shift(); // убираем старейший
    const fallback = { x: Math.random() * 800, y: Math.random() * 600 };
    spot || Object.assign(spot || {}, fallback);
  }

  const obj = {
    id: uuidv4(),
    type: 'text',
    content: text.trim(),
    sourceLang: (senderLang || 'en').slice(0, 2),
    x: spot ? spot.x : Math.random() * 600,
    y: spot ? spot.y : Math.random() * 400,
    w, h,
    createdAt: Date.now()
  };

  if (objects.length >= MAX_OBJECTS) objects.shift();
  objects.push(obj);
  res.json(obj);
});

// ─── API: добавить файл (изображение / аудио) ────────────────────────────────
app.post('/api/post/file', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });

  const isImage = req.file.mimetype.startsWith('image/');
  const isAudio = req.file.mimetype.startsWith('audio/');
  if (!isImage && !isAudio) return res.status(400).json({ error: 'unsupported type' });

  const vw = parseInt(req.body.vw) || 1200;
  const vh = parseInt(req.body.vh) || 800;
  const w = isImage ? 260 : 280;
  const h = isImage ? 200 : 60;

  const spot = findFreeSpot(w, h, vw, vh);
  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

  const obj = {
    id: uuidv4(),
    type: isImage ? 'image' : 'audio',
    content: dataUrl,
    mimeType: req.file.mimetype,
    x: spot ? spot.x : Math.random() * 600,
    y: spot ? spot.y : Math.random() * 400,
    w, h,
    createdAt: Date.now()
  };

  if (objects.length >= MAX_OBJECTS) objects.shift();
  objects.push(obj);
  res.json(obj);
});

// ─── API: статус ──────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ count: objects.length, max: MAX_OBJECTS });
});

app.listen(PORT, () => {
  console.log(`scatter running → http://localhost:${PORT}`);
  console.log(`access code: ${ACCESS_CODE}`);
});
