# Lumora for Google Maps — 隱私政策 / Privacy Policy

**Pre-release／發布前版本**

- 營運者／Operator：Vicky Yang
- 隱私聯絡方式／Privacy Contact：ap665539@gmail.com
- 最後更新／Last Updated：2026-11-28
- 生效日期／Effective Date：待正式發布時確認 / To be determined upon public release

---

# 繁體中文

## 1. 用途與使用時機

Lumora 是 Chrome 側欄擴充功能，旨在協助使用者了解 Google Maps 商家的評論摘要、到訪資訊、推薦餐點與優缺點。

只有當你主動開始或重新分析時，擴充功能才會擷取目前商家的評論並送出分析請求。側欄會讀取目前分頁以確認商家及分析結果的歸屬。

Lumora 未實作瀏覽歷史蒐集、精確定位蒐集、個人行為分析或廣告追蹤功能。

## 2. 蒐集的資料

擴充功能可能處理以下資料：

- 商家 Place ID。
- 已驗證的商家名稱。
- 評論 ID。
- 評論星等。
- 評論正文。
- 評論相對發布時間。
- 評論擷取時間。
- Chrome 分頁識別碼、分析任務識別碼、進度及狀態。

每次分析最多處理 50 則評論。

Lumora 不另外蒐集評論者姓名、頭像、個人頁面或作者評論數。然而，評論正文可能包含評論者自行提供的姓名、聯絡資訊或其他個人資訊。

## 3. 資料使用目的

資料僅用於以下應用目的：

- 提供評論分析與消費決策摘要。
- 彙整到訪前須知及推薦餐點。
- 呈現評論優缺點及原文佐證。
- 維持分析任務與商家的正確對應。
- 提供快取、服務維運及安全防護。
- 防止 API 濫用及過度使用服務資源。

Lumora 不出售使用者資料、不提供個人化廣告，亦未實作第三方 Analytics 追蹤或付費訂閱功能。

## 4. 資料傳輸與第三方服務

### 4.1 Backend API

正式版擴充功能透過 HTTPS 將分析所需資料傳輸至後端服務：

https://google-map-review-denoiser.onrender.com

傳輸至後端的資料包括：

- Place ID。
- 評論擷取時間。
- 評論 ID、星等及正文。

商家名稱及評論相對發布時間保留於瀏覽器端。

### 4.2 Render

Lumora 使用 Render 提供後端運算、網路處理及服務託管。

目前部署設定：

- 服務區域：Singapore（新加坡）。
- 服務方案：Free。
- 資料庫：SQLite。
- 持久磁碟：未使用。

Render 可能依其服務條款及隱私政策處理連線、請求及服務運作相關資料。

相關文件：

- [Render Privacy Policy](https://render.com/privacy)
- [Render Data Processing Addendum](https://render.com/dpa)
- [Render Free Services](https://render.com/docs/free)

### 4.3 Google Gemini API

Gemini 模式會將選中的評論 ID、星等、正文及分析指令傳輸至 Google Gemini API，以產生分析結果。

目前測試設定：

- 模型：Gemini 3.5 Flash Lite。
- API 方案：Free Tier。
- Interaction 狀態儲存：`store: false`。

Mock 模式及快取命中不會發出 Gemini 分析請求。

依 Google Gemini API 免費服務適用條款，Google 可能使用提交內容及生成結果改善產品與機器學習技術，並可能進行人工審查。免費服務亦限制提交個人、敏感或機密資訊。

`store: false` 僅代表停用預設 Interaction 狀態儲存，不代表 Google 不會基於其他目的處理或留存資料。

目前 Gemini Free Tier 僅作為合成評論測試用途，不對一般使用者正式開放真實評論的 Gemini 分析。

相關文件：

- [Gemini API Terms of Service](https://ai.google.dev/gemini-api/terms)
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Google Privacy Policy](https://policies.google.com/privacy)
- [Gemini Interaction Storage](https://ai.google.dev/gemini-api/docs/interactions)

## 5. 資料留存

### 5.1 Chrome 工作階段儲存

分析結果、商家資訊、分析任務狀態及可展開的優缺點評論證據，儲存於 Chrome 擴充功能工作階段記憶體。

關閉側欄後，使用者可以重新開啟側欄並恢復結果。

切換商家、關閉對應分頁、重新分析覆寫結果，或 Chrome 清除擴充功能工作階段時，原紀錄將移除或取代。

Lumora 不將評論複製至瀏覽器持久儲存空間。

[Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage#session)

### 5.2 後端 SQLite 快取

後端快取可能保存：

- 商家 Place ID。
- 用於比對請求的雜湊值。
- 分析結果。

快取有效期為七天。

過期快取會在服務啟動、快取寫入或查詢到過期項目時清除。因此，七天為快取使用期限，不代表所有過期資料必定於七天屆滿時立即實體刪除。

分析結果可能包含評論摘錄或評論正文中的個人資訊。Lumora 不另外將完整評論批次或完整模型 Prompt 儲存於快取。

目前 Render Free 方案使用非持久性檔案系統。重新部署、服務重新啟動或閒置休眠可能造成 SQLite 資料遺失。

供應商層級的備份、歷史資料及完整刪除能力仍須確認。

### 5.3 Gemini 資料留存

Google 可能依適用服務條款、帳戶方案、安全監控及濫用防護政策留存或處理資料。

Lumora 不承諾第三方服務具備零資料留存（Zero Data Retention），亦不保證能直接刪除 Google 已處理或留存的資料。

### 5.4 服務日誌

後端使用連線來源 IP 進行 API 限流，相關限流計數儲存於伺服器程序記憶體。

伺服器及託管平台可能產生連線資訊、請求狀態及錯誤診斷等服務日誌。

Render 日誌留存期限取決於工作區方案。實際日誌欄位、存取權限及刪除程序仍須於正式發布前確認。

[Render Logging Documentation](https://render.com/docs/logging)

## 6. 資料安全

Lumora 採用以下技術措施降低資料處理風險：

- HTTPS 加密傳輸。
- 最小化資料傳輸欄位。
- API 請求大小限制。
- API Rate Limiting。
- Gemini 每日呼叫額度限制。
- Gemini 並行請求限制。
- 重複分析請求合併及快取。
- Gemini API Key 僅配置於後端服務。

上述措施旨在降低未經授權存取、資源濫用及不必要資料傳輸的風險，但無法保證所有資料處理環境均不存在安全風險。

## 7. 資料刪除及使用者權利

使用者可以透過關閉對應商家分頁或重新啟動 Chrome，移除 Lumora 儲存於瀏覽器工作階段的分析結果。

如欲詢問資料處理情形，或依適用法律提出資料查詢、更正、限制處理及刪除請求，可透過以下電子郵件聯絡營運者：

**ap665539@gmail.com**

提出資料請求時，建議提供：

- 請求類型及相關說明。
- 相關商家 Place ID（如已知）。
- 大致分析時間（如適用）。

請勿於電子郵件中提供密碼、API Key 或不必要的敏感個人資訊。

營運者將以收到請求後 30 天內回覆為目標；如適用法律要求更短期限，將依該期限處理。

為避免未經授權的資料存取或刪除，營運者可能需要合理確認請求者身分及資料關聯性。

清除瀏覽器工作階段結果不會同時清除後端快取、服務日誌或第三方供應商已處理的資料。

後端資料的實際可刪除範圍及第三方供應商的處理能力仍須確認，因此目前不承諾所有資料均可立即或完整刪除。

## 8. 發布狀態與使用限制

Lumora 目前處於正式發布前的測試與驗收階段。

Google Maps 評論擷取、第三方傳輸、快取、分析及原文再展示的適用授權與使用條件仍待確認。

本隱私政策不代表 Lumora 已取得 Google Maps 評論資料的使用授權，亦不代表已完成所有適用法律、第三方服務條款及 Chrome Web Store 政策的合規驗證。

在相關發布條件確認前，正式 Gemini 分析服務不對一般使用者開放真實評論資料處理。

Lumora 為獨立開發的擴充功能，並非 Google 官方產品，亦不宣稱與 Google 存在官方合作、認證或背書關係。

## 9. 隱私政策更新

本隱私政策可能因產品功能、服務供應商、資料處理方式或適用規範變更而更新。

正式發布後，最新版本將透過公開隱私政策頁面提供。涉及重大資料處理變更時，將依適用規範提供必要通知，並在需要時取得使用者同意。

## 10. 聯絡方式

- 營運者：Vicky Yang
- 隱私聯絡 Email：ap665539@gmail.com

---

# English

## 1. Purpose and When Collection Begins

Lumora is a Chrome side-panel extension designed to help users understand Google Maps business reviews through decision summaries, practical visit information, dish recommendations, and review-based pros and cons.

Review collection and transmission begin when you explicitly start or repeat an analysis. The side panel reads the active browser tab to identify the business and associate results with the correct analysis task.

Lumora does not implement browsing history collection, precise location collection, behavioral analytics, or advertising tracking.

## 2. Data We Process

The extension may process the following information:

- Business Place ID.
- Verified business name.
- Review IDs.
- Review ratings.
- Review texts.
- Relative review publication times.
- Review collection timestamp.
- Browser tab identifiers, analysis task identifiers, progress, and status.

Each analysis processes up to 50 reviews.

Lumora does not separately collect reviewer names, avatars, profile pages, or author review counts. However, review texts may contain names, contact details, or other personal information voluntarily included by reviewers.

## 3. Purposes of Data Processing

Lumora processes data for the following application purposes:

- Generating review analyses and decision summaries.
- Providing practical visit information and dish recommendations.
- Presenting pros, cons, and supporting review evidence.
- Associating analysis tasks with the correct business.
- Providing caching, service operations, and security.
- Preventing API abuse and excessive resource consumption.

Lumora does not sell user data, provide personalized advertising, or implement third-party analytics tracking or paid subscription features.

## 4. Data Transmission and Third-Party Services

### 4.1 Backend API

The production extension is configured to transmit analysis data over HTTPS to:

https://google-map-review-denoiser.onrender.com

Data transmitted to the backend includes:

- Place ID.
- Review collection timestamp.
- Review IDs, ratings, and texts.

Business names and relative review publication times remain in the browser.

### 4.2 Render

Lumora uses Render for backend computing, networking, and service hosting.

Current deployment configuration:

- Service region: Singapore.
- Service plan: Free.
- Database: SQLite.
- Persistent disk: Not enabled.

Render may process connection, request, and operational information under its applicable service terms and privacy policies.

Related documentation:

- [Render Privacy Policy](https://render.com/privacy)
- [Render Data Processing Addendum](https://render.com/dpa)
- [Render Free Services](https://render.com/docs/free)

### 4.3 Google Gemini API

In Gemini mode, selected review IDs, ratings, texts, and analysis instructions are transmitted to the Google Gemini API to generate analysis results.

Current testing configuration:

- Model: Gemini 3.5 Flash Lite.
- API plan: Free Tier.
- Interaction state storage: `store: false`.

Mock analyses and cache hits do not send Gemini analysis requests.

Under the applicable terms for unpaid Gemini API services, Google may use submitted content and generated responses to improve its products and machine learning technologies. Such content may also be subject to human review. Unpaid services restrict the submission of personal, sensitive, or confidential information.

Setting `store: false` disables default Interaction state storage. It does not prevent all other processing or retention by Google.

Gemini Free Tier is currently used for synthetic-review testing only. Production Gemini analysis of real reviews is not publicly available.

Related documentation:

- [Gemini API Terms of Service](https://ai.google.dev/gemini-api/terms)
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Google Privacy Policy](https://policies.google.com/privacy)
- [Gemini Interaction Storage](https://ai.google.dev/gemini-api/docs/interactions)

## 5. Data Retention

### 5.1 Chrome Session Storage

Analysis results, business information, analysis task status, and expandable review evidence are stored in Chrome extension session memory.

Users may reopen the side panel and recover results after closing it.

Changing businesses, closing the relevant tab, replacing an analysis, or clearing the Chrome extension session removes or replaces the previous result.

Lumora does not copy reviews into persistent browser storage.

[Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage#session)

### 5.2 Backend SQLite Cache

The backend cache may store:

- Business Place ID.
- A request-matching hash.
- Derived analysis results.

The cache has a validity period of seven days.

Expired entries are removed on service startup, cache writes, or lookups that encounter expired entries. The seven-day validity period does not guarantee immediate physical deletion upon expiration.

Analysis results may contain review excerpts or personal information included in review texts. Lumora does not separately store complete review batches or complete model prompts in the cache.

The current Render Free plan uses an ephemeral filesystem. SQLite data may be lost during redeployment, service restarts, or idle spin-downs.

Provider-level backups, historical data, and complete deletion capabilities remain subject to confirmation.

### 5.3 Gemini Data Retention

Google may process or retain data according to applicable service terms, account plans, security monitoring, and abuse prevention policies.

Lumora does not guarantee Zero Data Retention by third-party providers or guarantee direct deletion of data already processed or retained by Google.

### 5.4 Service Logs

The backend uses connection source IP addresses for API rate limiting. Rate-limit counters are maintained in server process memory.

The server and hosting platform may generate logs containing connection information, request status, and error diagnostics.

Render log retention depends on the workspace plan. Actual logging fields, access controls, and deletion procedures remain subject to confirmation before public release.

[Render Logging Documentation](https://render.com/docs/logging)

## 6. Data Security

Lumora implements technical measures intended to reduce data processing risks, including:

- HTTPS-encrypted transmission.
- Data minimization.
- API request size limits.
- API rate limiting.
- Daily Gemini call limits.
- Gemini concurrency limits.
- Duplicate request coalescing and caching.
- Backend-only Gemini API key configuration.

These measures help reduce unauthorized access, resource abuse, and unnecessary data transmission. They do not guarantee that all data processing environments are free from security risks.

## 7. Data Deletion and User Rights

Users can remove Lumora's browser session results by closing the relevant business tab or restarting Chrome.

For questions about data processing or requests for access, correction, restriction, or deletion under applicable law, contact:

**ap665539@gmail.com**

When submitting a request, please consider including:

- The request type and relevant details.
- The relevant business Place ID, if known.
- The approximate analysis time, if applicable.

Do not include passwords, API keys, or unnecessary sensitive personal information in your email.

The operator aims to respond within 30 days of receiving a request, or within a shorter period where required by applicable law.

Reasonable identity and data association verification may be necessary to prevent unauthorized access or deletion.

Clearing browser session results does not automatically delete backend cache records, service logs, or data already processed by third-party providers.

The actual scope of backend deletion and third-party deletion capabilities remains subject to confirmation. Immediate or complete deletion of all data is not guaranteed.

## 8. Release Status and Usage Restrictions

Lumora is currently undergoing pre-release testing and validation.

Applicable authorization and usage conditions for Google Maps review collection, third-party transmission, caching, analysis, and redisplay remain subject to confirmation.

This privacy policy does not represent that Lumora has obtained authorization to use Google Maps review data or completed compliance verification against all applicable laws, third-party terms, and Chrome Web Store policies.

Until the relevant release conditions are satisfied, production Gemini analysis of real review data will not be made publicly available.

Lumora is an independently developed extension. It is not an official Google product and does not claim affiliation, certification, or endorsement by Google.

## 9. Changes to This Privacy Policy

This privacy policy may be updated to reflect changes in product functionality, service providers, data processing practices, or applicable requirements.

Following public release, the latest version will be available through a public privacy policy page. Material changes to data processing will be communicated as required, and user consent will be obtained where necessary.

## 10. Contact

- Operator: Vicky Yang
- Privacy Contact: ap665539@gmail.com
