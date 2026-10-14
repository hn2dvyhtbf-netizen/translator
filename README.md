# 🌐 面對面雙向智慧翻譯機 — iPhone (iOS) 版

由 Android 版移植而來，功能與畫面相同：上半部顛倒顯示給對面的人看，下半部給您看，
透過 Gemini Live 即時語音互譯（英、泰、越、日、韓、西班牙文 ⇄ 繁體中文）。

## 與 Android 版的差異（為 iOS 所做的修改）

- 麥克風改用裝置原生取樣率錄音後，程式自行降為 16kHz（Safari 不支援指定取樣率與麥克風不同的 AudioContext）。
- 音訊環境與麥克風授權改在「按下按鈕」的當下建立，避免 iOS 因沒有使用者手勢而完全靜音。
- 要求 iOS 使用「播放＋錄音」模式，讓翻譯語音從喇叭輸出而非聽筒。
- 切回 App 時自動恢復被 iOS 暫停的音訊。
- 加入瀏海／動態島／Home 指示條的安全區域留白、輸入框 16px 防止自動放大。
- Capacitor 改為 iOS 平台；Service Worker 只在網頁 / 主畫面模式啟用。

## 📲 安裝到 iPhone 的兩種方式

### 方式一（最簡單，免 Mac、免 Apple 開發者帳號）：加入主畫面（PWA）

iOS 的麥克風功能必須在 **HTTPS** 網址下才能使用，所以需要把網頁放到網路上：

1. 把本資料夾（`Conversation_App`）上傳到一個 GitHub 儲存庫（repository）。
2. 到該儲存庫 **Settings → Pages → Source** 選擇 **GitHub Actions**。
3. 推送後 `deploy_pages.yml` 會自動部署，網址類似 `https://您的帳號.github.io/儲存庫名/`。
4. iPhone 用 **Safari** 開啟該網址 → 點下方「分享」→「**加入主畫面**」。
5. 從主畫面圖示開啟，即是全螢幕 App；之後您更新程式碼並推送，手機重新開啟就會是最新版。

### 方式二：安裝成原生 App（.ipa，Windows 也能做）

1. 同樣上傳到 GitHub 儲存庫。到 **Actions → Build iOS IPA (unsigned)** → **Run workflow**。
   GitHub 會在雲端 Mac 上編譯，完成後在該次執行頁面下載 `FaceToFace-Translator-iOS-IPA`，解壓得到 `FaceToFaceTranslator-unsigned.ipa`。
2. 在電腦安裝 **Sideloadly**（或 AltStore），用 USB 連接 iPhone。
   Windows 需要先安裝**從 Apple 官網下載**的 iTunes 與 iCloud。
3. 將 `.ipa` 拖入 Sideloadly，輸入您自己的 Apple ID 後按 Start，即可簽名並安裝。
4. iPhone：**設定 → 一般 → VPN 與裝置管理** → 信任您的 Apple ID。
   iOS 16 以上另需在 **設定 → 隱私權與安全性 → 開發者模式** 開啟。
5. 注意：免費 Apple ID 簽名的 App **每 7 天需要重新安裝/續簽一次**；
   若有付費 Apple Developer 帳號（US$99/年），可用 Xcode 簽名上架 TestFlight，不用每週續簽。

> 若您有 Mac：安裝 Node.js 與 Xcode 後執行
> `npm install` → `npm run build:web` → `npx cap add ios` → `npx cap sync ios` → `npx cap open ios`，
> 在 Xcode 的 Signing 設定選您的帳號，接上 iPhone 按 ▶ 即可。
> 另請在 `ios/App/App/Info.plist` 加入 `NSMicrophoneUsageDescription`（麥克風用途說明）。

## 🔑 首次使用

1. 點中間的 **⚙️ 設定**，貼上 **Gemini API Key**（[Google AI Studio](https://aistudio.google.com/app/apikey) 免費取得）。
2. 按「連線測試」→「儲存設定」。Key 只存在您手機本機。
3. 按 **開啟 Gemini Live 串流**，第一次會跳出麥克風授權，選「允許」。

## ⚠️ iOS 使用注意

- 螢幕需保持亮起、App 在前景；iOS 不允許背景持續錄音。
- 翻譯播放時為半雙工（不收音），避免喇叭聲被麥克風收進去；請等播放完再說話。
- 若沒聲音：確認手機未靜音（側邊靜音鍵 / 控制中心），並調高音量。
- 本版**無法在本環境實機測試**（需要 iPhone），第一次實機測試如有問題，請把畫面上的狀態訊息回報，我再協助修正。
