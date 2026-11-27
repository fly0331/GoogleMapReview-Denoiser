# Lumora for Google Maps — 隱私政策 / Privacy Policy

**Draft／草稿 · 2026-11-27**

- 營運者／Operator：［待確認 / To be confirmed］
- 隱私聯絡方式／Privacy contact：［待確認 / To be confirmed］
- 生效日期／Effective date：［發布前待確認 / To be confirmed before release］

## 繁體中文

### 用途與使用時機

Lumora 是 Chrome 側欄擴充功能，用於提供 Google Maps 商家的評論摘要、到訪資訊、推薦餐點與優缺點。只有當你主動開始或重新分析時，擴充功能才會擷取目前商家的評論並送出分析請求。側欄會讀取目前分頁來確認商家。程式未建立瀏覽歷史、精確定位、個人行為分析或廣告追蹤功能。

### 蒐集、使用及傳輸

- 擴充功能讀取目前商家的 Place ID、已驗證商家名稱，以及最多 50 則評論的 ID、星等、正文與相對發布時間。Chrome 內部的分頁及任務識別、進度與狀態用於確認分析歸屬及恢復結果。
- 後端收到 Place ID、擷取時間，以及每則評論的 ID、星等與正文。商家名稱和相對發布時間留在瀏覽器。擴充功能不另外蒐集評論者姓名、頭像、個人頁面或作者評論數。評論者仍可能在正文寫入姓名、聯絡資訊或其他個人內容。
- Production Build 設定使用 HTTPS 向 Render 上的後端網域送出請求。Render 提供服務運算及網路處理，正式服務區域、方案、日誌與磁碟設定［待確認］。在 Gemini 模式下，Google Gemini 會收到選中評論的 ID、星等、正文和分析指令，用於產生摘要。Mock 模式及快取命中不會發出 Gemini 分析請求。 [Render 資料處理條款](https://render.com/dpa) · [Gemini API 條款](https://aistudio.google.com/docs/terms)
- 本程式未實作廣告、出售資料、訂閱付費或 Analytics 追蹤。資料用於提供分析、呈現證據、維持服務及防止濫用。

### 留存與安全

- **Chrome**：分析結果、商家資料、任務狀態與可展開的優缺點證據存於 Chrome 的工作階段記憶體。關閉側欄後可重新開啟恢復結果。切換商家、關閉商家分頁、新分析覆寫，或 Chrome 清除擴充功能工作階段時，原紀錄會移除或取代。Lumora 不將評論複製至瀏覽器持久儲存。 [Chrome Storage 文件](https://developer.chrome.com/docs/extensions/reference/api/storage#session)
- **SQLite**：後端保存商家 ID、比對請求用的雜湊和分析結果。快取有效期為七天，過期列在服務啟動、寫入快取或讀到過期項目時清除。結果文字可能含評論摘錄或個人內容。完整輸入評論批次及完整模型 Prompt 沒有獨立存入快取。資料庫備份、快照及實際清除流程［待確認］。
- **Gemini**：單輪請求採用 `store: false`，退出預設 Interaction 狀態儲存。供應商可能另依帳戶方案、適用條款及安全／濫用監控留存資料。正式付費／免費分類、是否允許產品改善、實際留存期限、歷史資料及 ZDR 資格［待確認］。 [Gemini Interaction 儲存](https://aistudio.google.com/docs/interactions-overview#data-storage-retention) · [Gemini ZDR 文件](https://aistudio.google.com/docs/zdr)
- **服務安全與日誌**：連線來源 IP 用於 API 限流，限流計數留在後端程序記憶體。伺服器或託管服務可有連線及請求狀態日誌，瀏覽器也有本機診斷。正式存取權限、日誌欄位、留存及清除期限［待確認］。程式用 HTTPS、最小欄位傳輸及分析請求限制降低風險。 [Render 日誌文件](https://render.com/docs/logging)

### 刪除資料與聯絡

你可關閉對應商家分頁或重新啟動 Chrome，清除 Lumora 的瀏覽器工作階段結果。若要詢問後端資料或提出刪除請求，請使用上方的隱私聯絡方式。正式受理、身分確認、可刪除範圍、供應商處理及回覆期限［待確認］。清除瀏覽器結果不會同時清除後端、備份或供應商資料。

## English

### Purpose and when collection starts

Lumora is a Chrome side panel that summarizes reviews of a Google Maps business, including visit information, dishes, pros and cons. Review collection and transmission begin when you explicitly start or repeat an analysis. The side panel reads the active tab to identify the business. The application does not implement browsing history collection, precise location collection, behavioral analytics, or advertising tracking.

### Data we process and recipients

- The extension reads the current Place ID, a verified business name, and up to 50 review IDs, ratings, texts, and relative publication times. Browser tab and task identifiers, progress, and status keep results associated with the right business and support reopening the side panel.
- The backend receives the Place ID, collection timestamp, and review IDs, ratings, and texts. The business name and relative publication times stay in the browser. The extension does not separately collect reviewer names, avatars, profile pages, or author review counts. Review text may still contain names, contact details, or other personal information.
- The production build is configured to use an HTTPS backend on Render. Render provides hosting and network processing. The production region, plan, logging, and disk settings are **[to be confirmed]**. In Gemini mode, Google Gemini receives the selected review IDs, ratings, texts, and analysis instructions to produce the result. Mock analyses and cache hits skip Gemini. [Render Data Processing Addendum](https://render.com/dpa) · [Gemini API Terms](https://aistudio.google.com/docs/terms)
- The application has no advertising, sale of data, paid subscription, or analytics tracking feature. Data serves analysis, evidence display, operation, and abuse prevention.

### Retention and security

- **Chrome:** Results, business and task information, and review evidence that users can expand are kept in Chrome session memory. Closing the side panel alone allows those results to be reopened. Changing business, closing the relevant tab, replacing the analysis, or clearing the extension session removes or replaces the local result. Lumora does not copy reviews to persistent browser storage. [Chrome Storage reference](https://developer.chrome.com/docs/extensions/reference/api/storage#session)
- **SQLite:** The backend stores the Place ID, a request matching hash, and derived results. The cache is valid for seven days. Expired rows are deleted on startup, a cache write, or a lookup of the expired row. Result text may contain excerpts or personal information. The cache has no separate copy of the complete review batch or the complete model prompt. Deployed backups, snapshots, and deletion procedures are **[to be confirmed]**.
- **Gemini:** Single-turn requests set `store: false` to opt out of default Interaction state storage. Google may separately retain data for safety, abuse monitoring, or under the applicable account terms. The production account tier, product-improvement settings, actual retention, historical requests, and ZDR status are **[to be confirmed]**. [Interaction storage](https://aistudio.google.com/docs/interactions-overview#data-storage-retention) · [Gemini ZDR documentation](https://aistudio.google.com/docs/zdr)
- **Security and logs:** The API uses source IP addresses for rate limiting, with counters held in server process memory. Web server or hosting logs may contain connection and request status information. Browser diagnostics are local. Production access controls, log contents, and retention and deletion periods are **[to be confirmed]**. Production transport uses HTTPS. The application limits transmitted fields and analysis requests. [Render logging](https://render.com/docs/logging)

### Deletion and contact

You can remove the browser session result by closing the business tab or restarting Chrome. To ask about backend data or request deletion, use the privacy contact above. The intake method, identity verification, deletion scope, provider procedures, and response times are **[to be confirmed]**. Clearing a browser result does not also clear backend records, backups, or provider-held data.
