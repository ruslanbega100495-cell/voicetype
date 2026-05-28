'use strict';

const $ = id => document.getElementById(id);

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  recording: false,
  mediaRecorder: null,
  chunks: [],
  timerInterval: null,
  timerSecs: 0,
  barsInterval: null,
  analyser: null,
  audioCtx: null,
  stream: null,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const recordBtn   = $('recordBtn');
const recordRing  = $('recordRing');
const statusPill  = $('statusPill');
const statusDot   = $('statusDot');
const statusText  = $('statusText');
const hintText    = $('hintText');
const timerEl     = $('timer');
const resultCard  = $('resultCard');
const resultText  = $('resultText');
const copyBtn     = $('copyBtn');
const barsEl      = $('barsContainer');
const bars        = [0,1,2,3,4,5,6].map(i => $('b' + i));
const settingsPanel  = $('settingsPanel');
const settingsToggle = $('settingsToggle');
const apiKeyInput    = $('apiKeyInput');
const langSelect     = $('langSelect');
const saveSettingsBtn = $('saveSettings');
const cancelSettingsBtn = $('cancelSettings');

// ── Status helpers ────────────────────────────────────────────────────────────

function setStatus(state_name, text) {
  statusPill.className = 'status-pill ' + state_name;
  statusText.textContent = text;
}

// ── Record logic ──────────────────────────────────────────────────────────────

async function startRecording() {
  if (state.recording) return;

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    setStatus('error', 'Нет доступа к микрофону');
    hintText.textContent = 'Разреши доступ к микрофону в браузере';
    return;
  }

  // Web Audio for visualisation
  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = state.audioCtx.createMediaStreamSource(state.stream);
  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 256;
  source.connect(state.analyser);

  // MediaRecorder — предпочитаем webm/opus, fallback на любой поддерживаемый
  const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  const mime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || '';
  state.mediaRecorder = new MediaRecorder(state.stream, mime ? { mimeType: mime } : {});
  state.chunks = [];
  state.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) state.chunks.push(e.data); };
  state.mediaRecorder.start(100);

  state.recording = true;
  recordBtn.classList.add('recording');
  recordRing.classList.add('recording');
  setStatus('recording', 'Запись…');
  hintText.textContent = 'Отпусти чтобы отправить';
  resultCard.style.display = 'none';
  barsEl.classList.add('active');

  // Timer
  state.timerSecs = 0;
  timerEl.textContent = '0:00';
  state.timerInterval = setInterval(() => {
    state.timerSecs++;
    const m = Math.floor(state.timerSecs / 60);
    const s = String(state.timerSecs % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  }, 1000);

  // Bars animation
  const data = new Uint8Array(state.analyser.frequencyBinCount);
  state.barsInterval = setInterval(() => {
    state.analyser.getByteFrequencyData(data);
    bars.forEach((bar, i) => {
      const idx = Math.floor(i * data.length / bars.length);
      const val = data[idx] / 255;
      const h = Math.max(4, Math.round(val * 28));
      bar.style.height = h + 'px';
    });
  }, 60);
}

async function stopRecording() {
  if (!state.recording) return;
  state.recording = false;

  clearInterval(state.timerInterval);
  clearInterval(state.barsInterval);
  timerEl.textContent = '';
  bars.forEach(b => b.style.height = '4px');
  barsEl.classList.remove('active');

  recordBtn.classList.remove('recording', 'pressed');
  recordRing.classList.remove('recording');
  setStatus('processing', 'Обработка…');
  hintText.textContent = 'Удерживай для записи';

  // Остановить запись и получить blob
  const blob = await new Promise(resolve => {
    state.mediaRecorder.onstop = () => {
      const type = state.mediaRecorder.mimeType || 'audio/webm';
      resolve(new Blob(state.chunks, { type }));
    };
    state.mediaRecorder.stop();
  });

  // Остановить поток
  state.stream.getTracks().forEach(t => t.stop());
  state.audioCtx.close();

  if (blob.size < 500) {
    setStatus('', 'Готов');
    return;
  }

  // Отправить на сервер
  try {
    const lang = langSelect.value || 'auto';
    const form = new FormData();
    form.append('audio', blob, 'audio.webm');
    form.append('language', lang);

    const res = await fetch('/api/transcribe', { method: 'POST', body: form });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || 'Ошибка сервера');
    }

    const text = data.text || '';
    if (text) {
      resultText.textContent = text;
      resultCard.style.display = 'block';
      setStatus('done', 'Готово ✓');

      // Копируем в буфер автоматически
      try { await navigator.clipboard.writeText(text); } catch (e) {}

      setTimeout(() => setStatus('', 'Готов'), 2500);
    } else {
      setStatus('', 'Готов');
    }
  } catch (err) {
    console.error(err);
    setStatus('error', 'Ошибка');
    hintText.textContent = err.message;
    setTimeout(() => {
      setStatus('', 'Готов');
      hintText.textContent = 'Удерживай для записи';
    }, 4000);
  }
}

// ── Button events (touch + mouse) ─────────────────────────────────────────────

recordBtn.addEventListener('mousedown', e => { e.preventDefault(); recordBtn.classList.add('pressed'); startRecording(); });
recordBtn.addEventListener('mouseup', e => { e.preventDefault(); stopRecording(); });
recordBtn.addEventListener('mouseleave', e => { if (state.recording) stopRecording(); });

recordBtn.addEventListener('touchstart', e => { e.preventDefault(); recordBtn.classList.add('pressed'); startRecording(); }, { passive: false });
recordBtn.addEventListener('touchend', e => { e.preventDefault(); stopRecording(); }, { passive: false });
recordBtn.addEventListener('touchcancel', e => { e.preventDefault(); stopRecording(); }, { passive: false });

// ── Copy button ───────────────────────────────────────────────────────────────

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(resultText.textContent);
    copyBtn.classList.add('copied');
    copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Скопировано`;
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Копировать`;
    }, 2000);
  } catch (e) {}
});

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.groq_api_key) apiKeyInput.value = data.groq_api_key;
    if (data.language) langSelect.value = data.language;
  } catch (e) {}
}

settingsToggle.addEventListener('click', () => {
  settingsPanel.style.display = 'flex';
});

cancelSettingsBtn.addEventListener('click', () => {
  settingsPanel.style.display = 'none';
});

settingsPanel.addEventListener('click', e => {
  if (e.target === settingsPanel) settingsPanel.style.display = 'none';
});

saveSettingsBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groq_api_key: apiKeyInput.value.trim(),
        language: langSelect.value,
      }),
    });
    settingsPanel.style.display = 'none';
    setStatus('done', 'Сохранено ✓');
    setTimeout(() => setStatus('', 'Готов'), 1500);
  } catch (e) {
    alert('Ошибка сохранения: ' + e.message);
  }
});

// ── PWA service worker ────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadSettings();
