/**
 * 面對面雙向 Gemini Multimodal Live API 即時翻譯 App
 * 支援 WebSocket 雙向 PCM 實時音訊串流、AudioContext 24kHz 音訊解碼隊列、全雙工即時分流與模型動態偵測
 */

// 每次修改請更新，顯示於畫面右下角以確認載入的是最新版
const APP_VERSION = '2026-10-14 iOS';

// iOS / iPadOS 偵測（iPadOS 會偽裝成 Mac，所以多檢查觸控點數）
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ==================== 支援語言配置 ====================
const LANGUAGES = {
  'en-US': { name: '英文', sub: 'English', flag: '🇺🇸', code: 'en-US', promptName: 'English' },
  'th-TH': { name: '泰國', sub: 'ภาษาไทย', flag: '🇹🇭', code: 'th-TH', promptName: 'Thai' },
  'vi-VN': { name: '越南', sub: 'Tiếng Việt', flag: '🇻🇳', code: 'vi-VN', promptName: 'Vietnamese' },
  'ja-JP': { name: '日文', sub: '日本語', flag: '🇯🇵', code: 'ja-JP', promptName: 'Japanese' },
  'ko-KR': { name: '韓文', sub: '韓國語', flag: '🇰🇷', code: 'ko-KR', promptName: 'Korean' },
  'es-ES': { name: '西班牙', sub: 'Español', flag: '🇪🇸', code: 'es-ES', promptName: 'Spanish' }
};

const CHINESE_CONFIG = {
  name: '中文',
  sub: '繁體中文',
  flag: '🇹🇼',
  code: 'zh-TW',
  promptName: 'Traditional Chinese'
};

// ==================== 應用程式狀態 ====================
const state = {
  currentForeignLang: 'en-US',
  geminiApiKey: localStorage.getItem('gemini_api_key') || '',
  geminiModel: localStorage.getItem('gemini_model') || 'gemini-3.8-live',
  geminiVoice: localStorage.getItem('gemini_voice') || 'Puck',
  liveConnected: false,
  webSocket: null,
  audioContextIn: null,
  audioContextOut: null,
  mediaStream: null,
  audioProcessor: null,
  audioQueueNextTime: 0,
  activeAudioSources: [],
  setupDone: false,
  awaitingResponse: false,
  responseTimer: null,
  watchdogTimer: null,
  uiBusy: false,
  lastServerAt: 0,
  suspendedTicks: 0,
  inputTranscript: '',
  outputTranscript: '',
  lastBottomTransText: '',
  lastTopTransText: ''
};

// ==================== DOM 元素 ====================
const elements = {
  topSection: document.getElementById('topSection'),
  topFlag: document.getElementById('topFlag'),
  topLangTitle: document.getElementById('topLangTitle'),
  topSpeechResult: document.getElementById('topSpeechResult'),
  topTransResult: document.getElementById('topTransResult'),
  topSubLabel: document.getElementById('topSubLabel'),
  topStatusBar: document.getElementById('topStatusBar'),
  topStatusText: document.getElementById('topStatusText'),

  langButtons: document.querySelectorAll('.lang-btn'),
  toggleLiveStreamBtn: document.getElementById('toggleLiveStreamBtn'),
  liveStreamLabel: document.getElementById('liveStreamLabel'),
  liveDot: document.getElementById('liveDot'),
  clearAllBtn: document.getElementById('clearAllBtn'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),

  bottomSection: document.getElementById('bottomSection'),
  bottomSpeechResult: document.getElementById('bottomSpeechResult'),
  bottomTransResult: document.getElementById('bottomTransResult'),
  bottomStatusBar: document.getElementById('bottomStatusBar'),
  bottomStatusText: document.getElementById('bottomStatusText'),

  settingsModal: document.getElementById('settingsModal'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  toggleKeyVisibilityBtn: document.getElementById('toggleKeyVisibilityBtn'),
  fetchModelsBtn: document.getElementById('fetchModelsBtn'),
  resetModelBtn: document.getElementById('resetModelBtn'),
  modelSelect: document.getElementById('modelSelect'),
  voiceSelect: document.getElementById('voiceSelect'),
  modelStatusMsg: document.getElementById('modelStatusMsg'),
  testApiKeyBtn: document.getElementById('testApiKeyBtn'),
  testResultMsg: document.getElementById('testResultMsg')
};

// ==================== 初始化 ====================
function init() {
  document.getElementById('appVersion').textContent = `更新 ${APP_VERSION}`;
  loadStoredSettings();
  setupEventListeners();
  updateTopLangUI();
  registerServiceWorker();

  if (IS_IOS) document.documentElement.classList.add('ios');

  if (!state.geminiApiKey) {
    setTimeout(openSettings, 600);
  }
}

function loadStoredSettings() {
  if (state.geminiApiKey) {
    elements.apiKeyInput.value = state.geminiApiKey;
  }
  ensureOptionInSelect(elements.modelSelect, state.geminiModel);
  elements.modelSelect.value = state.geminiModel;
  elements.voiceSelect.value = state.geminiVoice;
}

function ensureOptionInSelect(selectElement, val) {
  let exists = Array.from(selectElement.options).some(opt => opt.value === val);
  if (!exists && val) {
    const newOpt = document.createElement('option');
    newOpt.value = val;
    newOpt.textContent = val;
    selectElement.appendChild(newOpt);
  }
}

// ==================== Gemini Multimodal Live API (WebSocket) 核心 ====================

// ==================== Gemini Multimodal Live API (WebSocket) 核心 ====================

function toggleLiveStream() {
  if (state.liveConnected) {
    disconnectGeminiLive();
  } else {
    connectGeminiLive();
  }
}

async function connectGeminiLive() {
  const apiKey = elements.apiKeyInput.value.trim() || state.geminiApiKey;
  if (!apiKey) {
    openSettings();
    setBottomStatus('請先在設定中填入 Gemini API Key', 'error');
    return;
  }

  setBottomStatus('⏳ 正在建立 Gemini Live 雙向 WebSocket 串流...', 'translating');
  setTopStatus('Connecting to Gemini Live API...', 'translating');

  try {
    // iOS：AudioContext 必須在「使用者點擊」的同步流程中建立並 resume，之後（await 之後）才建立會永遠靜音
    // 並要求 iOS 使用「播放+錄音」音訊模式，翻譯語音才會從喇叭而非聽筒輸出
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) {}

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!state.audioContextOut) {
      state.audioContextOut = new AudioContextClass({ sampleRate: 24000 });
    }
    // 輸入端不指定取樣率（Safari 不支援與麥克風不同取樣率的 MediaStreamSource），改用手動降頻到 16kHz
    if (!state.audioContextIn) {
      state.audioContextIn = new AudioContextClass();
    }
    const resumeOut = state.audioContextOut.state === 'suspended' ? state.audioContextOut.resume() : Promise.resolve();
    const resumeIn = state.audioContextIn.state === 'suspended' ? state.audioContextIn.resume() : Promise.resolve();
    // 麥克風也在同一個手勢流程中先取得（第一次會跳出 iOS 麥克風授權視窗）
    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    await Promise.all([resumeOut, resumeIn]);
    state.audioQueueNextTime = state.audioContextOut.currentTime;

    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;

    const ws = new WebSocket(wsUrl);
    state.webSocket = ws;

    state.webSocket.onopen = async () => {
      console.log('Gemini Live WebSocket connected.');
      setBottomStatus('🤝 WebSocket 已連線，正在進行 Live 握手設定...', 'translating');
      setTopStatus('Connected, initializing handshake...', 'translating');
      
      // 1. 發送 Setup 握手
      sendHandshakeSetup();
      
      // 2. 啟動麥克風捕捉（等待 setupComplete 確認後開始送音訊）
      await startMicrophoneCapture();

      state.liveConnected = true;
      startWatchdog();
      updateLiveUIState(true);
    };

    state.webSocket.onmessage = async (event) => {
      handleServerMessage(event.data);
    };

    state.webSocket.onerror = (error) => {
      console.error('Gemini Live WebSocket Error:', error);
      setBottomStatus('❌ Gemini Live 連線錯誤，請確認 API Key 或網路環境', 'error');
      setTopStatus('Live WebSocket Connection Error', 'error');
    };

    state.webSocket.onclose = (event) => {
      console.log('Gemini Live WebSocket closed:', event.code, event.reason);
      // 只處理目前這條連線（避免重連時舊連線的 close 把新連線關掉）
      if (state.webSocket !== ws) return;
      disconnectGeminiLive();
      const reasonMsg = event.reason ? `: ${event.reason}` : '';
      setBottomStatus(`連線已中斷 (代碼 ${event.code}${reasonMsg})`, 'error');
    };

  } catch (err) {
    console.error('Failed to connect Gemini Live:', err);
    disconnectGeminiLive();
    setBottomStatus(`連線失敗: ${err.message}`, 'error');
  }
}

function sendHandshakeSetup() {
  if (!state.webSocket || state.webSocket.readyState !== WebSocket.OPEN) return;

  const targetLang = LANGUAGES[state.currentForeignLang];
  const systemInstructionText = `You are a real-time face-to-face simultaneous audio interpreter between Traditional Chinese (繁體中文) and ${targetLang.promptName} (${targetLang.sub}).

CORE RULES:
1. You continuously receive live PCM audio stream from both speakers.
2. If you hear Chinese, speak ONLY its ${targetLang.promptName} translation.
3. If you hear ${targetLang.promptName}, speak ONLY its Traditional Chinese translation.
4. DO NOT answer questions, chit-chat or add commentary. ONLY translate what was said.
5. Speak only natural sentences. NEVER output tags, markers, or annotations such as <to zh>, [pause] or {pause}.`;

  // 官方 BidiGenerateContent 支援 setup (同時要求 AUDIO 與 TEXT 雙模態輸出)
  // Live API 每個 session 只能有「一種」回應模態；要同時拿到文字，
  // 須用 AUDIO + inputAudioTranscription / outputAudioTranscription
  const setupMsg = {
    setup: {
      model: `models/${state.geminiModel}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: state.geminiVoice || "Puck"
            }
          }
        }
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // 關閉伺服器自動語音偵測，改由前端送 activityStart / activityEnd
      realtimeInputConfig: {
        automaticActivityDetection: { disabled: true }
      },
      systemInstruction: {
        parts: [{ text: systemInstructionText }]
      }
    }
  };

  console.log('Sending Setup Handshake Message:', JSON.stringify(setupMsg));
  state.webSocket.send(JSON.stringify(setupMsg));
}

async function startMicrophoneCapture() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!state.mediaStream) {
      state.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    }
    if (!state.audioContextIn) state.audioContextIn = new AudioContextClass();
    if (state.audioContextIn.state === 'suspended') {
      await state.audioContextIn.resume();
    }

    const inRate = state.audioContextIn.sampleRate;       // iOS 通常為 48000 或 44100
    const source = state.audioContextIn.createMediaStreamSource(state.mediaStream);
    state.audioProcessor = state.audioContextIn.createScriptProcessor(4096, 1, 1);

    let chunkCount = 0;
    let silenceSec = 0;
    let speakingActive = false;
    const preRoll = []; // 保留開口前約 0.4 秒，避免第一個字被切掉
    const preRollMax = Math.max(2, Math.ceil(0.4 / (4096 / inRate)));

    const sendJson = (obj) => {
      try { state.webSocket.send(JSON.stringify(obj)); }
      catch (sendErr) { console.error('Failed to send:', sendErr); }
    };
    const sendAudio = (base64) => sendJson({
      realtimeInput: {
        audio: { mimeType: 'audio/pcm;rate=16000', data: base64 }
      }
    });

    state.audioProcessor.onaudioprocess = (e) => {
      // 必須等到 setupComplete 後才能送音訊，否則伺服器會直接關閉連線
      if (!state.liveConnected || !state.setupDone || !state.webSocket || state.webSocket.readyState !== WebSocket.OPEN) return;

      const float32Data = e.inputBuffer.getChannelData(0);

      let sum = 0;
      for (let i = 0; i < float32Data.length; i++) {
        sum += float32Data[i] * float32Data[i];
      }
      const rms = Math.sqrt(sum / float32Data.length);
      const isSpeaking = rms > 0.02;
      const chunkSec = float32Data.length / inRate;
      const pcm16Base64 = convertFloat32ToInt16Base64(downsampleTo16k(float32Data, inRate));

      // 伺服器自動 VAD 已關閉，由這裡用 activityStart / activityEnd 明確告知一句話的起訖
      // 半雙工：翻譯語音播放中（含結束後 0.4 秒）不收音，避免喇叭聲被麥克風收進去
      // 被當成新的發話 → 打斷翻譯、聲音斷斷續續、模型翻譯自己的輸出
      if (!speakingActive && (state.awaitingResponse || isOutputPlaying())) {
        preRoll.length = 0;
        return;
      }

      if (isSpeaking) {
        silenceSec = 0;
        if (!speakingActive) {
          speakingActive = true;
          state.inputTranscript = '';
          state.outputTranscript = '';
          sendJson({ realtimeInput: { activityStart: {} } });
          preRoll.splice(0).forEach(sendAudio);
        }
        chunkCount++;
        if (chunkCount % 4 === 0) {
          setBottomStatus(`🎙️ 正在收音中 (音量: ${(rms * 100).toFixed(0)}%)... 講完請停頓`, 'listening');
        }
        sendAudio(pcm16Base64);
      } else if (speakingActive) {
        sendAudio(pcm16Base64);
        silenceSec += chunkSec;
        // 停頓約 0.8 秒 → 結束這句話，觸發翻譯
        if (silenceSec >= 0.77) {
          speakingActive = false;
          sendJson({ realtimeInput: { activityEnd: {} } });
          state.awaitingResponse = true;
          state.lastServerAt = performance.now();
          setBottomStatus('⏳ 發話停頓，Gemini 正在推理口譯...', 'translating');
          setTopStatus('Gemini translating...', 'translating');
          state.responseTimer = setTimeout(() => {
            state.awaitingResponse = false;
            setBottomStatus('⚠️ 10 秒未收到回應：請確認所選模型支援 Live 語音 (F12 Console 可看詳細訊息)', 'error');
          }, 10000);
        }
      } else {
        preRoll.push(pcm16Base64);
        if (preRoll.length > preRollMax) preRoll.shift();
      }
    };

    source.connect(state.audioProcessor);
    state.audioProcessor.connect(state.audioContextIn.destination);
    console.log('Microphone capture started successfully.');

  } catch (err) {
    console.error('Microphone capture failed:', err);
    setBottomStatus(`麥克風無法啟動: ${err.message}`, 'error');
  }
}

// 將任意取樣率的 Float32 音訊降頻成 16kHz（以區間平均作簡易低通，避免混疊）
function downsampleTo16k(input, inRate) {
  const outRate = 16000;
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : input[start];
  }
  return out;
}

function convertFloat32ToInt16Base64(float32Array) {
  const l = float32Array.length;
  const int16Array = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  const bytes = new Uint8Array(int16Array.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function handleServerMessage(dataStr) {
  try {
    let msg;
    if (dataStr instanceof Blob) {
      msg = JSON.parse(await dataStr.text());
    } else {
      msg = JSON.parse(dataStr);
    }

    const msgKeys = Object.keys(msg).join(',');
    console.log('Gemini Live received:', msg);

    // 連線維持用的控制封包，不需顯示
    if (msg.sessionResumptionUpdate || msg.usageMetadata && !msg.serverContent) return;
    if (msg.goAway) {
      setBottomStatus('⚠️ 伺服器即將結束此連線 (goAway)，請重新開啟串流', 'error');
      return;
    }

    // 檢查是否有握手完成信號
    if (msg.setupComplete || msg.setup_complete) {
      console.log('✅ Gemini Live setupComplete received!');
      state.setupDone = true;
      setBottomStatus('✨ Live 握手成功！請開始說話，中文與外語皆可隨時發話', 'active');
      setTopStatus('✨ Live Ready! Speak anytime.', 'active');
      return;
    }

    // 檢查是否有錯誤回傳
    if (msg.error) {
      console.error('Gemini Server Error:', msg.error);
      setBottomStatus(`❌ Server 錯誤: ${msg.error.message || JSON.stringify(msg.error)}`, 'error');
      return;
    }

    // Gemini Live 伺服器內容處理
    const serverContent = msg.server_content || msg.serverContent;
    if (serverContent) {
      clearTimeout(state.responseTimer);
      state.lastServerAt = performance.now();
      const modelTurn = serverContent.model_turn || serverContent.modelTurn;
      const parts = modelTurn?.parts || [];

      let hasAudio = false;
      let hasText = false;

      for (const part of parts) {
        // 1. 處理音訊輸出
        const inlineData = part.inline_data || part.inlineData;
        if (inlineData && (inlineData.mime_type?.startsWith('audio/pcm') || inlineData.mimeType?.startsWith('audio/pcm'))) {
          hasAudio = true;
          playAudioPCMChunk(inlineData.data);
        }
      }

      // 2. 文字來自語音轉錄（輸入 = 說話者原文，輸出 = 翻譯）
      const inTx = serverContent.inputTranscription || serverContent.input_transcription;
      if (inTx?.text) {
        hasText = true;
        state.inputTranscript += inTx.text;
      }
      const outTx = serverContent.outputTranscription || serverContent.output_transcription;
      if (outTx?.text) {
        hasText = true;
        state.outputTranscript += outTx.text;
      }
      if (hasText) renderTranscripts();

      if (hasAudio || hasText) {
        state.uiBusy = true;
        setBottomStatus('🔊 Gemini 正在口譯播放中...', 'translating');
        setTopStatus('🔊 Translating...', 'translating');
      }

      if (serverContent.turn_complete || serverContent.turnComplete) {
        state.awaitingResponse = false;
        console.log('Turn complete:', state.inputTranscript, '=>', state.outputTranscript);
        state.inputTranscript = '';
        state.outputTranscript = '';
        // 「翻譯完成」狀態由 watchdog 在音訊實際播完後切換
      }

      if (serverContent.interrupted) {
        console.log('Interrupted by user speech');
        stopAllPlayingAudio();
        state.outputTranscript = '';
        state.awaitingResponse = false;
        setBottomStatus('✨ 隨時可以繼續說話', 'active');
        setTopStatus('✨ Speak anytime', 'active');
      }
    } else {
      // 顯示收到的其他控制封包，便於除錯
      setBottomStatus(`📡 收到伺服器事件: [${msgKeys}]`, 'active');
    }

  } catch (err) {
    console.warn('Error processing WebSocket message:', err);
  }
}

// 每 400ms 依「實際狀態」校正 UI 與收音閘門，任何漏接的訊號都不會讓畫面永久卡住
function startWatchdog() {
  clearInterval(state.watchdogTimer);
  state.watchdogTimer = setInterval(() => {
    if (!state.liveConnected) return;
    const ctx = state.audioContextOut;

    // 1. 輸出 AudioContext 被系統暫停（切 App、藍牙切換、音訊焦點被搶）→ 時間凍結、沒聲音、isOutputPlaying 永遠為 true
    if (ctx && ctx.state !== 'running' && state.audioQueueNextTime > ctx.currentTime) {
      ctx.resume().catch(() => {});
      if (++state.suspendedTicks > 5) {
        console.warn('Output AudioContext stuck in state:', ctx.state);
        stopAllPlayingAudio();
        state.suspendedTicks = 0;
        setBottomStatus('⚠️ 系統暫停了音訊播放，請點一下畫面後再說一次', 'error');
        state.uiBusy = false;
      }
    } else {
      state.suspendedTicks = 0;
    }

    const playing = isOutputPlaying();

    // 2. 已收到部分回應，但之後 8 秒都沒有新封包、也沒在播放 → 視為 turnComplete 遺失，強制復位
    if (state.awaitingResponse && !playing && state.uiBusy && performance.now() - state.lastServerAt > 8000) {
      console.warn('No turnComplete received, resetting turn.');
      state.awaitingResponse = false;
    }

    // 3. 不在等待、也沒在播放，但畫面仍顯示「口譯中」→ 切回就緒
    if (!state.awaitingResponse && !playing && state.uiBusy) {
      state.uiBusy = false;
      setBottomStatus('✨ 翻譯完成，隨時可以繼續說話', 'active');
      setTopStatus('✨ Ready for next speech', 'active');
    }
  }, 400);
}

function playAudioPCMChunk(base64PcmData) {
  if (!state.audioContextOut) return;

  try {
    if (state.audioContextOut.state === 'suspended') {
      state.audioContextOut.resume();
    }

    const binaryStr = atob(base64PcmData);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    const audioBuffer = state.audioContextOut.createBuffer(1, float32Array.length, 24000);
    audioBuffer.getChannelData(0).set(float32Array);

    const source = state.audioContextOut.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(state.audioContextOut.destination);

    const now = state.audioContextOut.currentTime;
    if (state.audioQueueNextTime < now) {
      state.audioQueueNextTime = now;
    }

    source.start(state.audioQueueNextTime);
    state.audioQueueNextTime += audioBuffer.duration;
    state.activeAudioSources.push(source);

    source.onended = () => {
      const idx = state.activeAudioSources.indexOf(source);
      if (idx !== -1) state.activeAudioSources.splice(idx, 1);
    };
  } catch (audioErr) {
    console.error('Audio playback error:', audioErr);
  }
}

function stopAllPlayingAudio() {
  state.activeAudioSources.forEach(s => {
    try { s.stop(); } catch(e){}
  });
  state.activeAudioSources = [];
  if (state.audioContextOut) {
    state.audioQueueNextTime = state.audioContextOut.currentTime;
  }
}

// \u6709\u6f22\u5b57\u4e14\u6c92\u6709\u5047\u540d/\u97d3\u6587\u5b57\u6bcd \u2192 \u8996\u70ba\u4e2d\u6587
function isChinese(text) {
  return /[\u4e00-\u9fff]/.test(text) && !/[\u3040-\u30ff\uac00-\ud7af]/.test(text);
}

function isOutputPlaying() {
  const ctx = state.audioContextOut;
  return !!ctx && ctx.currentTime < state.audioQueueNextTime + 0.4;
}

// 移除模型夾帶的標記，例如 <to zht>、[pause]、{pause]
function cleanTranscript(text) {
  return text
    .replace(/<[^<>]*>/g, '')
    .replace(/[\[{][^\[\]{}]*[\]}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderTranscripts() {
  const input = cleanTranscript(state.inputTranscript);
  const output = cleanTranscript(state.outputTranscript);
  // \u4ee5\u300c\u7ffb\u8b6f\u7d50\u679c\u300d\u5224\u65b7\u65b9\u5411\u8f03\u53ef\u9760\uff1a\u7ffb\u6210\u5916\u8a9e = \u6211\u65b9\u8aaa\u4e2d\u6587
  const zhSpoke = output ? !isChinese(output) : isChinese(input);

  if (zhSpoke) {
    if (input) elements.bottomSpeechResult.textContent = input;
    if (output) {
      elements.topTransResult.textContent = output;
      state.lastTopTransText = output;
    }
  } else {
    if (input) elements.topSpeechResult.textContent = input;
    if (output) {
      elements.bottomTransResult.textContent = output;
      state.lastBottomTransText = output;
    }
  }
}

function disconnectGeminiLive() {
  state.liveConnected = false;
  state.setupDone = false;
  state.awaitingResponse = false;
  if (state.responseTimer) {
    clearTimeout(state.responseTimer);
    state.responseTimer = null;
  }
  clearInterval(state.watchdogTimer);
  state.uiBusy = false;
  state.inputTranscript = '';
  state.outputTranscript = '';
  stopAllPlayingAudio();

  if (state.webSocket) {
    try { state.webSocket.close(); } catch(e){}
    state.webSocket = null;
  }

  if (state.audioProcessor) {
    try { state.audioProcessor.disconnect(); } catch(e){}
    state.audioProcessor = null;
  }

  if (state.audioContextIn) {
    try { state.audioContextIn.close(); } catch(e){}
    state.audioContextIn = null;
  }

  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(t => t.stop());
    state.mediaStream = null;
  }

  updateLiveUIState(false);
  setBottomStatus('Gemini Live 已中斷連線，點擊即可重新啟動', 'normal');
  setTopStatus('Gemini Live disconnected', 'normal');
}

function updateLiveUIState(isConnected) {
  if (isConnected) {
    elements.toggleLiveStreamBtn.classList.add('connected');
    elements.liveStreamLabel.textContent = 'Gemini Live 串流中';
    elements.topSection.classList.add('live-active');
    elements.bottomSection.classList.add('live-active');
  } else {
    elements.toggleLiveStreamBtn.classList.remove('connected');
    elements.liveStreamLabel.textContent = '開啟 Gemini Live 串流';
    elements.topSection.classList.remove('live-active');
    elements.bottomSection.classList.remove('live-active');
  }
}

async function fetchAvailableModels() {
  const apiKey = elements.apiKeyInput.value.trim() || state.geminiApiKey;
  if (!apiKey) {
    elements.modelStatusMsg.textContent = '❌ 請先填入 API Key';
    elements.modelStatusMsg.style.color = '#f43f5e';
    return;
  }

  elements.modelStatusMsg.textContent = '⏳ 正在查詢 Google API 可用模型清單...';
  elements.modelStatusMsg.style.color = '#38bdf8';
  elements.fetchModelsBtn.disabled = true;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const allModels = data.models || [];
    // 只有支援 bidiGenerateContent 的模型能用 Live API
    const validModels = allModels.filter(m => (m.supportedGenerationMethods || []).includes('bidiGenerateContent'));

    if (validModels.length === 0) {
      elements.modelStatusMsg.textContent = '⚠️ 未找到可用 Gemini 模型';
      elements.modelStatusMsg.style.color = '#f59e0b';
      return;
    }

    elements.modelSelect.innerHTML = '';
    const currentSelection = state.geminiModel;

    validModels.forEach(m => {
      const modelId = m.name.replace(/^models\//, '');
      const opt = document.createElement('option');
      opt.value = modelId;
      opt.textContent = `${modelId} (${m.displayName || modelId})`;
      elements.modelSelect.appendChild(opt);
    });

    ensureOptionInSelect(elements.modelSelect, currentSelection);
    elements.modelSelect.value = currentSelection || validModels[0].name.replace(/^models\//, '');

    elements.modelStatusMsg.textContent = `✅ 成功取得 ${validModels.length} 個可用模型！`;
    elements.modelStatusMsg.style.color = '#10b981';

  } catch (error) {
    console.error('Fetch models error:', error);
    elements.modelStatusMsg.textContent = `❌ 查詢失敗: ${error.message}`;
    elements.modelStatusMsg.style.color = '#f43f5e';
  } finally {
    elements.fetchModelsBtn.disabled = false;
  }
}

function resetToDefaultModel() {
  const defaultModel = 'gemini-3.8-live';
  ensureOptionInSelect(elements.modelSelect, defaultModel);
  elements.modelSelect.value = defaultModel;
  elements.modelStatusMsg.textContent = '⚡ 已恢復預設 gemini-3.8-live 模型！';
  elements.modelStatusMsg.style.color = '#10b981';
}

function updateTopLangUI() {
  const langConfig = LANGUAGES[state.currentForeignLang];
  if (!langConfig) return;

  elements.topFlag.textContent = langConfig.flag;
  elements.topLangTitle.textContent = `${langConfig.name} (${langConfig.sub})`;
  elements.topSubLabel.textContent = `${langConfig.name} 外語發話 / Foreign Speech`;
  elements.topSpeechResult.textContent = `Listening through Gemini Live API...`;
  elements.topTransResult.textContent = `Live audio translation will appear here.`;
}

function setTopStatus(text, type = 'normal') {
  elements.topStatusText.textContent = text;
  elements.topStatusBar.className = 'status-indicator-bar';
  if (type === 'listening') elements.topStatusBar.classList.add('status-listening');
  else if (type === 'translating') elements.topStatusBar.classList.add('status-translating');
  else if (type === 'active') elements.topStatusBar.classList.add('status-active');
}

function setBottomStatus(text, type = 'normal') {
  elements.bottomStatusText.textContent = text;
  elements.bottomStatusBar.className = 'status-indicator-bar';
  if (type === 'listening') elements.bottomStatusBar.classList.add('status-listening');
  else if (type === 'translating') elements.bottomStatusBar.classList.add('status-translating');
  else if (type === 'active') elements.bottomStatusBar.classList.add('status-active');
}

function openSettings() {
  elements.settingsModal.classList.add('open');
  elements.testResultMsg.textContent = '';
  elements.testResultMsg.className = 'test-result';
}

function closeSettings() {
  elements.settingsModal.classList.remove('open');
}

async function testApiKey() {
  const key = elements.apiKeyInput.value.trim();
  const selectedModel = elements.modelSelect.value || state.geminiModel || 'gemini-3.8-live';

  if (!key) {
    elements.testResultMsg.textContent = '❌ 請先輸入 API Key';
    elements.testResultMsg.className = 'test-result error';
    return;
  }

  elements.testResultMsg.textContent = `⏳ 正在對 [${selectedModel}] 進行 Live WebSocket 真實握手測試...`;
  elements.testResultMsg.className = 'test-result';
  elements.testApiKeyBtn.disabled = true;

  let testWs = null;
  let testTimer = null;

  try {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`;
    testWs = new WebSocket(wsUrl);

    const cleanup = () => {
      if (testTimer) clearTimeout(testTimer);
      if (testWs) {
        try { testWs.close(); } catch(e){}
      }
      elements.testApiKeyBtn.disabled = false;
    };

    // 8 秒逾時保護
    testTimer = setTimeout(() => {
      elements.testResultMsg.textContent = `❌ 連線測試逾時 (8s)：未收到伺服器回應，請檢查網路或代理`;
      elements.testResultMsg.className = 'test-result error';
      cleanup();
    }, 8000);

    testWs.onopen = () => {
      // 成功建立連線後，立刻發送 Setup 握手包測試模型是否有效
      const testSetup = {
        setup: {
          model: `models/${selectedModel}`,
          generationConfig: {
            responseModalities: ["AUDIO"]
          }
        }
      };
      testWs.send(JSON.stringify(testSetup));
    };

    let hasReceivedSetup = false;

    testWs.onmessage = async (e) => {
      try {
        let msg;
        if (e.data instanceof Blob) {
          msg = JSON.parse(await e.data.text());
        } else {
          msg = JSON.parse(e.data);
        }

        // 只要收到 setupComplete 或是 sessionResumptionUpdate，皆代表伺服器已成功握手並認可該 Session！
        if (msg.setupComplete || msg.setup_complete || msg.sessionResumptionUpdate) {
          hasReceivedSetup = true;
          elements.testResultMsg.textContent = `✅ 連線成功！模型 [${selectedModel}] 支援 Gemini Live 雙向串流！`;
          elements.testResultMsg.className = 'test-result success';
          cleanup();
        } else if (msg.error) {
          elements.testResultMsg.textContent = `❌ 握手拒絕: ${msg.error.message || JSON.stringify(msg.error)}`;
          elements.testResultMsg.className = 'test-result error';
          cleanup();
        }
      } catch (parseErr) {
        console.warn('Test parse error:', parseErr);
      }
    };

    testWs.onerror = (err) => {
      elements.testResultMsg.textContent = `❌ WebSocket 連線失敗，請確認 API Key 與網路環境`;
      elements.testResultMsg.className = 'test-result error';
      cleanup();
    };

    testWs.onclose = (event) => {
      if (!hasReceivedSetup) {
        if (event.code === 1000) {
          // 代碼 1000 為正常關閉 (Normal Closure)
          elements.testResultMsg.textContent = `✅ 連線成功！(伺服器已驗證並以代碼 1000 正常響應)`;
          elements.testResultMsg.className = 'test-result success';
        } else {
          const reason = event.reason ? `: ${event.reason}` : '';
          elements.testResultMsg.textContent = `❌ 連線已中斷 (代碼 ${event.code}${reason})。請檢查權限或換用推薦模型。`;
          elements.testResultMsg.className = 'test-result error';
        }
        cleanup();
      }
    };

  } catch (error) {
    elements.testResultMsg.textContent = `❌ 測試異常: ${error.message}`;
    elements.testResultMsg.className = 'test-result error';
    if (testWs) testWs.close();
    elements.testApiKeyBtn.disabled = false;
  }
}

function saveSettings() {
  const key = elements.apiKeyInput.value.trim();
  const model = elements.modelSelect.value;
  const voice = elements.voiceSelect.value;

  state.geminiApiKey = key;
  state.geminiModel = model;
  state.geminiVoice = voice;

  localStorage.setItem('gemini_api_key', key);
  localStorage.setItem('gemini_model', model);
  localStorage.setItem('gemini_voice', voice);

  closeSettings();
  setBottomStatus(`設定已儲存！當前模型: ${model} (Voice: ${voice})`, 'active');

  if (state.liveConnected) {
    disconnectGeminiLive();
    setTimeout(connectGeminiLive, 500);
  }
}

function setupEventListeners() {
  document.addEventListener('pointerdown', () => {
    if (state.audioContextOut && state.audioContextOut.state !== 'running') state.audioContextOut.resume().catch(() => {});
  });

  // iOS 切到背景或接電話後 AudioContext 會被中斷，回到前景時自動恢復
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    [state.audioContextOut, state.audioContextIn].forEach(c => {
      if (c && c.state !== 'running') c.resume().catch(() => {});
    });
  });

  elements.langButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.langButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      state.currentForeignLang = btn.getAttribute('data-lang');
      updateTopLangUI();

      // setup 只能在連線開頭送一次，換語言必須重連
      if (state.liveConnected) {
        disconnectGeminiLive();
        setTimeout(connectGeminiLive, 300);
      }
    });
  });

  elements.toggleLiveStreamBtn.addEventListener('click', toggleLiveStream);

  elements.clearAllBtn.addEventListener('click', () => {
    elements.bottomSpeechResult.textContent = '已清除對話紀錄...';
    elements.bottomTransResult.textContent = '對面說話後翻譯的中文將即時顯示於此。';
    elements.topSpeechResult.textContent = 'Cleared transcript...';
    elements.topTransResult.textContent = 'Live audio translation will appear here.';
    state.lastBottomTransText = '';
    state.lastTopTransText = '';
  });

  elements.openSettingsBtn.addEventListener('click', openSettings);
  elements.closeSettingsBtn.addEventListener('click', closeSettings);
  elements.cancelSettingsBtn.addEventListener('click', closeSettings);
  elements.saveSettingsBtn.addEventListener('click', saveSettings);
  elements.testApiKeyBtn.addEventListener('click', testApiKey);
  elements.fetchModelsBtn.addEventListener('click', fetchAvailableModels);
  elements.resetModelBtn.addEventListener('click', resetToDefaultModel);

  elements.toggleKeyVisibilityBtn.addEventListener('click', () => {
    const isPass = elements.apiKeyInput.type === 'password';
    elements.apiKeyInput.type = isPass ? 'text' : 'password';
    elements.toggleKeyVisibilityBtn.textContent = isPass ? '🙈' : '👁️';
  });
}

function registerServiceWorker() {
  // Capacitor iOS 使用 capacitor:// 協定，不支援 Service Worker；只在一般網頁 / PWA 模式註冊
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('ServiceWorker ready:', reg.scope))
        .catch(err => console.log('ServiceWorker failed:', err));
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
