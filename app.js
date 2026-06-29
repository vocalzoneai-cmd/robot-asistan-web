// Backend adresini buraya yaz (yerelde test için localhost, yayında kendi domainin)
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : 'https://robot-asistan-server.onrender.com';

const eyeL = document.getElementById('eyeL');
const eyeR = document.getElementById('eyeR');
const browL = document.getElementById('browL');
const browR = document.getElementById('browR');
const statusEl = document.getElementById('status');
const chatLog = document.getElementById('chatLog');
const form = document.getElementById('form');
const input = document.getElementById('q');
const micBtn = document.getElementById('micBtn');
const cameraBtn = document.getElementById('cameraBtn');
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');
const appEl = document.querySelector('.app');
const assetContent = document.getElementById('assetContent');
const assetClose = document.getElementById('assetClose');
const captureCanvas = document.getElementById('captureCanvas');

let cameraStream = null;
let cameraVideoEl = null;

// Telefonun kamerasını açar, görüntüyü 2/4-2/4 panelde canlı gösterir
async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
  } catch (err) {
    addBubble('Kameraya erişilemedi. Tarayıcı izinlerini kontrol et.', 'assistant error');
    return;
  }

  appEl.classList.add('has-asset');
  assetContent.innerHTML = '';
  cameraVideoEl = document.createElement('video');
  cameraVideoEl.autoplay = true;
  cameraVideoEl.playsInline = true;
  cameraVideoEl.muted = true;
  cameraVideoEl.srcObject = cameraStream;
  assetContent.appendChild(cameraVideoEl);

  const hint = document.createElement('div');
  hint.className = 'camera-hint';
  hint.textContent = 'Kamera açık — bir şey sor, gördüğümü anlatayım';
  assetContent.appendChild(hint);

  cameraBtn.classList.add('active');
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  cameraVideoEl = null;
  cameraBtn.classList.remove('active');
}

// O anki kamera karesini base64 JPEG olarak yakalar (backend'e gönderilecek)
function captureFrame() {
  if (!cameraVideoEl || !cameraVideoEl.videoWidth) return null;
  captureCanvas.width = cameraVideoEl.videoWidth;
  captureCanvas.height = cameraVideoEl.videoHeight;
  const ctx = captureCanvas.getContext('2d');
  ctx.drawImage(cameraVideoEl, 0, 0);
  const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.7);
  return dataUrl.split(',')[1]; // "data:image/jpeg;base64," kısmını at
}

cameraBtn.addEventListener('click', () => {
  if (cameraStream) {
    stopCamera();
    hideAsset();
  } else {
    startCamera();
  }
});

// Harita / resim / YouTube videosu gösterir, ekranı 2/4-2/4 düzenine geçirir
function showAsset(asset) {
  stopCamera(); // başka bir asset gösterilecekse kamera kapanır
  appEl.classList.add('has-asset');
  assetContent.innerHTML = '<div class="asset-loading">Yükleniyor…</div>';

  if (asset.type === 'map') {
    const src = `https://www.google.com/maps?q=${encodeURIComponent(asset.value)}&output=embed`;
    assetContent.innerHTML = `<iframe src="${src}" loading="lazy" allowfullscreen></iframe>`;
  } else if (asset.type === 'image') {
    // Higgsfield zaten tam bir görsel URL'i döner, Pollinations için prompt'tan URL kuruyoruz
    const src = asset.source === 'higgsfield'
      ? asset.value
      : `https://image.pollinations.ai/prompt/${encodeURIComponent(asset.value)}`;
    const img = new Image();
    img.onload = () => { assetContent.innerHTML = ''; assetContent.appendChild(img); };
    img.onerror = () => { assetContent.innerHTML = '<div class="asset-loading">Görsel üretilemedi.</div>'; };
    img.src = src;
    img.alt = asset.value;
  } else if (asset.type === 'youtube') {
    const src = `https://www.youtube.com/embed/${encodeURIComponent(asset.value)}?autoplay=1`;
    assetContent.innerHTML = `<iframe src="${src}" loading="lazy" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  }
}

function hideAsset() {
  appEl.classList.remove('has-asset');
  assetContent.innerHTML = '';
}

assetClose.addEventListener('click', () => { stopCamera(); hideAsset(); });

let state = 'idle';
let animTimer = null;
let blinkTimer = null;
let history = [];
let liveBubble = null; // konuşurken anlık güncellenen "deşifre" balonu

// Sohbet alanına yeni bir balon ekler, en alta kaydırır
function addBubble(text, role) {
  const div = document.createElement('div');
  div.className = `bubble ${role}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function updateLiveBubble(text, role) {
  if (!liveBubble) {
    liveBubble = addBubble(text, `${role} live`);
  } else {
    liveBubble.textContent = text;
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

function finalizeLiveBubble(finalText, role) {
  if (liveBubble) {
    liveBubble.textContent = finalText;
    liveBubble.className = `bubble ${role}`;
    liveBubble = null;
  } else {
    addBubble(finalText, role);
  }
}

function resetBrows() {
  browL.style.opacity = '0';
  browR.style.opacity = '0';
  browL.style.transform = '';
  browR.style.transform = '';
}

// Her duygu, "pozitiflik" (valence, -1..1) ve "yoğunluk" (arousal, -1..1)
// değeriyle tanımlanıyor. Göz şekli, rengi ve kaş açısı bu iki sayıdan
// otomatik hesaplanıyor — yani 50 farklı duygu, 50 farklı görsel sonuç verir.
const MOOD_TABLE = {
  mutlu:            [0.8, 0.5],
  kecoskun:         [1.0, 0.9],
  hosnut:           [0.6, -0.3],
  sakin:            [0.3, -0.6],
  rahat:            [0.4, -0.7],
  uykulu:           [0.0, -0.95],
  sikilmis:         [-0.3, -0.7],
  uzgun:            [-0.7, -0.4],
  kalbi_kirik:      [-0.9, -0.2],
  hayalkirikligi:   [-0.5, -0.3],
  kizgin:           [-0.7, 0.7],
  cok_kizgin:       [-0.95, 0.95],
  rahatsiz:         [-0.4, 0.3],
  sinirli:          [-0.6, 0.5],
  korkmus:          [-0.6, 0.8],
  kaygili:          [-0.5, 0.6],
  gergin:           [-0.3, 0.5],
  saskin:           [0.2, 0.9],
  sok:              [-0.2, 1.0],
  hayran:           [0.7, 0.8],
  merakli:          [0.3, 0.4],
  kafasi_karisik:   [-0.1, 0.3],
  sasirmis_hafif:   [-0.1, 0.2],
  supheli:          [-0.2, 0.1],
  kuskulu:          [-0.3, 0.2],
  gururlu:          [0.7, 0.4],
  kendinden_emin:   [0.6, 0.3],
  kararli:          [0.4, 0.6],
  heyecanli:        [0.8, 0.8],
  cok_heyecanli:    [0.95, 0.95],
  oyuncu:           [0.6, 0.6],
  sirin_yaramaz:    [0.4, 0.5],
  sevgi_dolu:       [0.9, 0.3],
  minnettar:        [0.7, 0.1],
  umutlu:           [0.5, 0.2],
  iyimser:          [0.6, 0.2],
  nostaljik:        [0.1, -0.3],
  hüzünlü:          [-0.4, -0.5],
  yalniz:           [-0.6, -0.4],
  mahcup:           [-0.3, 0.4],
  cekingen:         [-0.1, 0.1],
  suçlu:            [-0.5, 0.2],
  kiskanc:          [-0.5, 0.4],
  igrenmis:         [-0.7, 0.4],
  bunalmis:         [-0.4, 0.7],
  odaklanmis:       [0.2, 0.4],
  ciddi:            [0.0, 0.1],
  notr:             [0.0, 0.0],
  sempatik:         [0.4, -0.1],
  ilham_almis:      [0.7, 0.6],
  eglenmis:         [0.5, 0.5]
};

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

// valence (pozitiflik) ve arousal (yoğunluk) sayılarını gerçek bir göz
// stiline çeviriyor: boyut, renk, şekil ve kaş açısı.
function moodToStyle(valence, arousal) {
  const height = Math.round(clamp(38 + arousal * 26, 12, 68));
  const width = Math.round(clamp(40 + arousal * 14 + Math.max(0, valence) * 10, 28, 68));

  let radius = '50%';
  if (valence > 0.45) radius = '0 0 30px 30px';
  else if (valence < -0.45) radius = '30px 30px 0 0';
  else if (valence < -0.15 && arousal > 0.2) radius = '40% 40% 50% 50%';

  let color;
  if (valence > 0.5) color = arousal > 0.5 ? '#f0c75f' : '#6fb98f';
  else if (valence > 0.15) color = '#8fd0a8';
  else if (valence > -0.15) color = arousal > 0.4 ? '#7aa8d8' : '#b5b3ac';
  else if (valence > -0.55) color = arousal > 0.4 ? '#d8895f' : '#a98fd8';
  else color = arousal > 0.4 ? '#d9554f' : '#8b76b0';

  const browOn = Math.abs(valence) > 0.25 || Math.abs(arousal) > 0.35;
  const browAngle = clamp(-valence * 16 - (arousal > 0.5 ? 5 : 0), -22, 22);
  const browLift = arousal > 0.45 ? -7 : arousal < -0.5 ? 4 : 0;

  return { height, width, radius, color, browOn, browAngle, browLift };
}

// Cevabın duygu durumuna göre gözlere/kaşlara mimik veriyor
function applyMood(mood) {
  resetBrows();
  const pair = MOOD_TABLE[mood] || MOOD_TABLE.notr;
  const s = moodToStyle(pair[0], pair[1]);

  eyeL.style.height = `${s.height}px`;
  eyeR.style.height = `${s.height}px`;
  eyeL.style.width = `${s.width}px`;
  eyeR.style.width = `${s.width}px`;
  eyeL.style.borderRadius = s.radius;
  eyeR.style.borderRadius = s.radius;
  eyeL.style.background = s.color;
  eyeR.style.background = s.color;

  if (s.browOn) {
    browL.style.opacity = '1';
    browR.style.opacity = '1';
    browL.style.transform = `rotate(${-s.browAngle}deg) translateY(${s.browLift}px)`;
    browR.style.transform = `rotate(${s.browAngle}deg) translateY(${s.browLift}px)`;
  }
}

function setState(next) {
  state = next;
  clearInterval(animTimer);
  eyeL.style.transform = '';
  eyeR.style.transform = '';
  eyeL.style.borderRadius = '50%';
  eyeR.style.borderRadius = '50%';
  eyeL.style.height = '52px';
  eyeR.style.height = '52px';
  eyeL.style.width = '52px';
  eyeR.style.width = '52px';
  eyeL.style.background = '#d8895f';
  eyeR.style.background = '#d8895f';
  resetBrows();

  if (next === 'idle') {
    statusEl.textContent = 'Bekliyorum';
  }
  if (next === 'listening') {
    statusEl.textContent = 'Dinliyorum';
    eyeL.style.height = '60px';
    eyeR.style.height = '60px';
    eyeL.style.background = '#6fb98f';
    eyeR.style.background = '#6fb98f';
  }
  if (next === 'thinking') {
    statusEl.textContent = 'Düşünüyorum';
    eyeL.style.borderRadius = '8px';
    eyeR.style.borderRadius = '8px';
    let dir = 1;
    animTimer = setInterval(() => {
      eyeL.style.transform = `translateX(${dir * 7}px)`;
      eyeR.style.transform = `translateX(${dir * 7}px)`;
      dir *= -1;
    }, 380);
  }
  if (next === 'searching') {
    statusEl.textContent = 'Webde arıyorum';
    eyeL.style.borderRadius = '50%';
    eyeR.style.borderRadius = '50%';
    eyeL.style.background = '#7aa8d8';
    eyeR.style.background = '#7aa8d8';
    let angle = 0;
    animTimer = setInterval(() => {
      angle += 60;
      eyeL.style.transform = `rotate(${angle}deg)`;
      eyeR.style.transform = `rotate(${-angle}deg)`;
    }, 200);
  }
  if (next === 'talking') {
    statusEl.textContent = 'Cevaplıyorum';
    let up = true;
    animTimer = setInterval(() => {
      eyeL.style.height = up ? '36px' : '52px';
      eyeR.style.height = up ? '36px' : '52px';
      up = !up;
    }, 230);
  }
  if (next === 'error') {
    statusEl.textContent = 'Bir sorun oldu';
    eyeL.style.background = '#d9554f';
    eyeR.style.background = '#d9554f';
  }
}

function scheduleBlink() {
  clearTimeout(blinkTimer);
  blinkTimer = setTimeout(() => {
    if (state === 'idle') {
      eyeL.style.height = '4px';
      eyeR.style.height = '4px';
      setTimeout(() => {
        if (state === 'idle') {
          eyeL.style.height = '52px';
          eyeR.style.height = '52px';
        }
      }, 130);
    }
    scheduleBlink();
  }, 2200 + Math.random() * 2200);
}
scheduleBlink();
setState('idle');
addBubble('Bir soru yaz veya mikrofona dokun.', 'assistant');

async function checkConnection() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (res.ok) {
      connDot.className = 'dot ok';
      connText.textContent = 'Bağlı';
    } else {
      throw new Error();
    }
  } catch {
    connDot.className = 'dot err';
    connText.textContent = 'Sunucuya bağlanılamıyor';
  }
}
checkConnection();

async function askAssistant(question) {
  finalizeLiveBubble(question, 'user'); // kullanıcının söylediğinin deşifresi sabitlenir
  setState('thinking');

  // Kamera açıksa o anki kareyi yakalayıp soruyla birlikte gönderiyoruz
  const image = cameraStream ? captureFrame() : null;

  try {
    const res = await fetch(`${API_BASE}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, history, image })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hata');

    history.push({ role: 'user', content: question });
    history.push({ role: 'assistant', content: data.answer });
    if (history.length > 12) history = history.slice(-12);

    setState('talking');
    applyMood(data.mood || 'notr');
    const shown = data.usedSearch ? `🌐 ${data.answer}` : data.answer;
    speakWithTranscript(data.answer, shown);
    if (data.asset) {
      showAsset(data.asset);
    }
    setTimeout(() => { if (state === 'talking') setState('idle'); }, 2600);
  } catch (err) {
    setState('error');
    addBubble('Asistana ulaşamadım. Bağlantını kontrol et.', 'assistant error');
    setTimeout(() => setState('idle'), 2000);
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const question = input.value.trim();
  if (!question) return;
  input.value = '';

  const commandReply = handleVoiceCommand(question);
  if (commandReply) {
    addBubble(question, 'user');
    setState('talking');
    applyMood('oyuncu');
    addBubble(commandReply, 'assistant');
    speak(commandReply);
    setTimeout(() => { if (state === 'talking') setState('idle'); }, 2000);
    return;
  }

  askAssistant(question);
});

// Ses ayarları - sesli/yazılı komutla değiştirilebilir, cihazda saklanır
const VOICE_KEY = 'asistan_ses_ayarlari';
function loadVoiceSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOICE_KEY));
    if (saved) return saved;
  } catch (e) { /* yok say */ }
  return { rate: 1.02, pitch: 1.0, volume: 1.0, voiceName: null };
}
let voiceSettings = loadVoiceSettings();
function saveVoiceSettings() {
  try { localStorage.setItem(VOICE_KEY, JSON.stringify(voiceSettings)); } catch (e) { /* yok say */ }
}

// Sesli yanıt: Google'ın (resmi olmayan ama doğal) sesli okuma servisini
// kullanıyoruz. Başarısız olursa tarayıcının kendi sesine geri döner.
const ttsAudio = new Audio();
let ttsQueue = [];

function stopAudioPlayback() {
  ttsAudio.pause();
  ttsAudio.removeAttribute('src');
  ttsQueue = [];
}

function playNextInQueue() {
  if (!ttsQueue.length) return;
  ttsAudio.src = ttsQueue.shift();
  ttsAudio.play().catch(() => { /* otomatik oynatma engellenmiş olabilir, sessizce geç */ });
}
ttsAudio.addEventListener('ended', playNextInQueue);

async function fetchTtsUrls(text) {
  try {
    const res = await fetch(`${API_BASE}/api/tts?text=${encodeURIComponent(text)}&lang=tr`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.urls || !data.urls.length) return null;
    return data.urls.map((u) => `${API_BASE}${u}`);
  } catch (e) {
    return null;
  }
}

// Tarayıcının kendi sesi (yedek plan - Google TTS'e ulaşılamazsa kullanılır)
function speakBrowserFallback(text) {
  if (!('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'tr-TR';
  utter.rate = voiceSettings.rate;
  utter.pitch = voiceSettings.pitch;
  utter.volume = voiceSettings.volume;
  if (voiceSettings.voiceName) {
    const v = window.speechSynthesis.getVoices().find((x) => x.name === voiceSettings.voiceName);
    if (v) utter.voice = v;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

// Sesli yanıt + konuşurken metni sohbet alanında gösterir
function speakWithTranscript(spokenText, shownText) {
  addBubble(shownText, 'assistant'); // "konuşurken onun söylediklerinin deşifresi"
  stopAudioPlayback();
  window.speechSynthesis && window.speechSynthesis.cancel();

  fetchTtsUrls(spokenText).then((urls) => {
    if (urls) {
      ttsAudio.volume = voiceSettings.volume;
      ttsAudio.playbackRate = voiceSettings.rate; // bu motor "pitch" desteklemiyor, sadece hız uygulanır
      ttsQueue = urls;
      playNextInQueue();
    } else {
      speakBrowserFallback(spokenText); // Google'a ulaşılamadıysa tarayıcı sesine düş
    }
  });
}

function speak(text) {
  speakWithTranscript(text, text);
}

// "Sesini kalın yap" gibi komutları yakalayıp backend'e gitmeden yanıtlar.
// Komut değilse null döner, normal soru olarak backend'e gönderilir.
function handleVoiceCommand(text) {
  const t = text.toLocaleLowerCase('tr-TR');
  const isVoiceTalk = /\bses(i|imi|ini)?\b/.test(t) || /\bton(u|unu)?\b/.test(t) || /konuş/.test(t);
  if (!isVoiceTalk) return null;

  let changed = false;
  let reply = null;

  if (/kal[ıi]n/.test(t)) { voiceSettings.pitch = clamp(voiceSettings.pitch - 0.3, 0, 2); changed = true; reply = 'Sesimi kalınlaştırdım.'; }
  if (/ince/.test(t)) { voiceSettings.pitch = clamp(voiceSettings.pitch + 0.3, 0, 2); changed = true; reply = 'Sesimi inceltdim.'; }
  if (/h[ıi]zl[ıi]/.test(t)) { voiceSettings.rate = clamp(voiceSettings.rate + 0.25, 0.5, 2.5); changed = true; reply = 'Daha hızlı konuşacağım.'; }
  if (/yava[şs]/.test(t)) { voiceSettings.rate = clamp(voiceSettings.rate - 0.25, 0.5, 2.5); changed = true; reply = 'Daha yavaş konuşacağım.'; }
  if (/(aç|yükselt|artt[ıi]r).*ses|ses.*(aç|yükselt|artt[ıi]r)/.test(t)) { voiceSettings.volume = clamp(voiceSettings.volume + 0.2, 0.1, 1); changed = true; reply = 'Sesimi yükselttim.'; }
  if (/(k[ıi]s|alçalt).*ses|ses.*(k[ıi]s|alçalt)/.test(t)) { voiceSettings.volume = clamp(voiceSettings.volume - 0.2, 0.1, 1); changed = true; reply = 'Sesimi kıstım.'; }
  if (/normal|varsay[ıi]lan|s[ıi]f[ıi]rla|eski/.test(t)) {
    voiceSettings = { rate: 1.02, pitch: 1.0, volume: 1.0, voiceName: null };
    changed = true; reply = 'Sesimi varsayılana döndürdüm.';
  }
  if (/erkek/.test(t)) {
    const voices = window.speechSynthesis.getVoices();
    const male = voices.find((v) => /male|erkek/i.test(v.name) && v.lang.startsWith('tr'));
    if (male) { voiceSettings.voiceName = male.name; changed = true; reply = 'Erkek sese geçtim.'; }
    else { reply = 'Cihazında uygun bir erkek ses bulamadım.'; }
  }
  if (/kad[ıi]n/.test(t)) {
    const voices = window.speechSynthesis.getVoices();
    const female = voices.find((v) => /female|kadın/i.test(v.name) && v.lang.startsWith('tr'));
    if (female) { voiceSettings.voiceName = female.name; changed = true; reply = 'Kadın sese geçtim.'; }
    else { reply = 'Cihazında uygun bir kadın ses bulamadım.'; }
  }

  if (!changed && !reply) return null; // "ses" geçen ama anlaşılmayan bir komut değil, normal soru say
  if (changed) saveVoiceSettings();
  return reply;
}

// Sesli giriş (Web Speech API - Safari/iOS desteği kısıtlı olabilir)
let recognition = null;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'tr-TR';
  recognition.interimResults = true; // konuşurken anlık deşifre için
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    micBtn.classList.add('recording');
    liveBubble = null;
    setState('listening');
  };
  recognition.onend = () => {
    micBtn.classList.remove('recording');
    if (state === 'listening') setState('idle');
  };
  recognition.onerror = () => {
    micBtn.classList.remove('recording');
    setState('idle');
  };
  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += transcript;
      else interim += transcript;
    }

    if (interim) {
      input.value = interim;
      updateLiveBubble(interim, 'user'); // kullanıcı konuşurken anlık deşifre
    }

    if (final) {
      input.value = final;
      const commandReply = handleVoiceCommand(final);
      if (commandReply) {
        finalizeLiveBubble(final, 'user');
        setState('talking');
        applyMood('oyuncu');
        addBubble(commandReply, 'assistant');
        speak(commandReply);
        setTimeout(() => { if (state === 'talking') setState('idle'); }, 2000);
      } else {
        askAssistant(final);
      }
    }
  };

  micBtn.addEventListener('click', () => {
    if (micBtn.classList.contains('recording')) {
      recognition.stop();
    } else {
      try { recognition.start(); } catch (e) { /* zaten başlamışsa yut */ }
    }
  });
} else {
  micBtn.addEventListener('click', () => {
    addBubble('Bu cihazda sesli giriş desteklenmiyor, yazarak sorabilirsin.', 'assistant');
  });
}

// PWA: service worker kaydı
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
