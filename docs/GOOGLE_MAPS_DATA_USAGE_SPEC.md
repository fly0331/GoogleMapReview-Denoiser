# Lumora for Google Maps — 資料使用規格

**狀態：Draft，供合規與發布驗收。**

**盤點日期：2026-11-27（臺灣時間）。範圍：QA 2.4 本機原始碼與測試。**

本文件記錄程式可查證的資料處理。正式部署、第三方帳戶設定、評論授權與法律適用性仍待核對。發布門檻見 [Google Maps 授權與 Chrome Web Store 查核](GOOGLE_MAPS_COMPLIANCE_REVIEW.md)。

## 資料流與本次差異

1. **Google Maps DOM → Content Script**。使用者按「開始消費分析」或「重新分析」後才擷取目前商家評論。擴充功能嘗試切換最新排序，無法切換時採用當前順序。擷取最多 50 則；展開原文後讀取評論 ID、星等、正文、相對時間。以前另讀取作者評論數，並送出固定為空的絕對日期欄位。QA 2.4 移除這兩項的現行擷取輸出。
2. **Content Script → Background → FastAPI**。商家名稱與工作識別用於本機驗證與顯示。以前後端收到作者評論數與日期；目前 HTTP body 為 `place_id`、`scraped_at`、每則評論的 `review_id`、`rating`、`text`。相對時間只有瀏覽器證據顯示需要。Content Script 以同一個投影函式量測實際序列化請求的 UTF-8 bytes。超過 512 KiB 時，以統一正文上限縮短各則評論，保留完整 ID 與原有順序。
3. **FastAPI → Gemini／SQLite**。API 在完整解析前檢查 body bytes，並驗證最多 50 則評論、欄位大小及時間格式。後端先查快取與 Single-flight，再從有內文評論選樣，最多 50 則及 20,000 個內文字元。Gemini 請求包含固定指令、選中的 ID／星等／正文、輸出 Schema 與 token 設定。以前未指定 Interaction 儲存選項；現在每次明確送出 `store: false`。相同分析共用既有 Single-flight，Mock、快取命中及無合格評論不呼叫 Gemini。SQLite 保存分析回應與索引，輸入原文與完整 Prompt 在應用層只於處理期間使用。
4. **Background → Chrome Session Storage → Side Panel**。進行中快照只含任務資料，不含評論陣列。成功前台原本保留整批評論；現在只寫入優點與缺點區塊可展開的證據原文、ID、星等及日期顯示需要的資料。推薦餐點和到訪資訊仍有結果與證據 ID，但現有 UI 沒有對應的原文展開入口，因此只被這些區塊引用的評論不保留原文。重新開啟側欄會恢復商家、分析結果及可展開證據，`analyzed_count` 使用後端原值。

## 完整資料盤點

「後端」指 Extension 的現行 HTTP 請求和 FastAPI 實際處理。Gemini 僅適用於 Gemini 模式的合格快取未命中。SQLite 清除、工作階段刪除與日誌保留的細節見下節。

| 資料 | 來源與目的 | 傳至後端 | 傳至 Gemini | 儲存、留存及刪除 | 產品必要性 |
| --- | --- | --- | --- | --- | --- |
| 評論正文 `text` | Maps 評論卡展開正文。用於消費分析、引句驗證及原文回查。 | 是，單則最多 5,000 字元並受傳輸預算約束 | 是，僅選中的評論 | 工作記憶體持有擷取批次直到任務結束；Chrome 成功快照僅保留 Pros／Cons 證據正文；SQLite 無輸入正文欄位，但衍生文字可能含摘錄。供應商留存另見下節。 | 分析與證據所需。正文可能包含個人、敏感或可識別資訊。 |
| `review_id` | 評論卡 `data-review-id`，用於去重、歸屬與證據連結。 | 是，最多 256 字元 | 是，僅選中樣本 | Chrome 保存可展開證據與結果內證據 ID；SQLite 在衍生分析中保留證據 ID，按快取條件刪除。 | 必要。可連回評論，因此不宣稱匿名。 |
| `place_id` | 從目前 Maps 頁面 URL 解析。用於商家驗證及快取隔離。 | 是，最多 512 字元 | 不作為獨立欄位傳送 | Chrome 任務快照、SQLite 每個商家一筆的鍵值。除非開啟本機診斷，不寫入應用事件。 | 必要。可反映使用者選擇分析的地點。 |
| `verifiedTitle` | 由商家標題或已驗證的語意標籤確認。本機識別及顯示。 | 否 | 否 | Chrome 任務快照與執行時記憶體，依工作階段條件清除。 | 商家辨識與 UI 所需。 |
| `rating` | 評論卡的無障礙標籤。供模型理解及原文顯示。 | 是 | 是，僅選中樣本 | Chrome 只保留證據星等；SQLite 保留衍生的面向評分及摘要。 | 必要。 |
| `relative_time` | 評論卡的相對發布時間，最多 128 字元，用於原文顯示。 | 已停止。舊 API 呼叫仍可提供。 | 否 | 瀏覽器擷取記憶體，及成功快照中可展開證據。 | 僅本機證據顯示所需。 |
| `review_date` | 現行擷取不取得絕對日期。舊證據可能有此欄位，UI 仍可正確讀取。 | 現行 Extension 不送，API 保留相容欄位 | 否 | 若已有合法舊證據日期，只隨被引用證據留在工作階段。 | 現階段無須新收集。 |
| 作者評論數、姓名、頭像、個人頁面 | 正式流程只曾讀取作者評論數。這次移除該 DOM 讀取，且 Background 用欄位白名單防止非必要欄位送出。 | 現行 Extension 不送。後端的 `author_reviews_count` 留作舊客戶端／離線 Cleaner 相容。 | 否 | 現行快照與快取無獨立作者欄位。舊 API 相容值若由呼叫端提供，可能影響舊格式的請求指紋。 | 正式流程不需要。 |
| `scraped_at` | 擷取完成後產生的 UTC 時間，供現行 API 驗證。 | 是 | 否 | 請求處理期。SQLite 使用獨立產生的 `cached_at`，分析指紋也不含 `scraped_at`。 | 現行 API 合約所需。 |
| 目前頁面 URL、Tab ID、Request ID、階段、擷取數、排序結果與截止時間 | Chrome 當前分頁、工作執行與身分檢查。URL 僅用以解析頁面與商家，不收集瀏覽歷史。 | 否，POST 只送解析出的 Place ID | 否 | 原始頁面 URL 不寫入任務快照。Tab／Request ID、狀態與進度使用 Chrome Session；部分識別及診斷只在啟用除錯時出現在本機 console。 | 現有功能、避免跨商家錯配與結果恢復所需。 |
| 連線 IP 與限流時間戳 | ASGI 連線來源，可信代理明確設定後可解析轉送來源。用於防濫用。 | 隨網路連線可見，非 JSON 欄位 | 使用者 IP 不寫入模型請求。供應商可能觀察後端連線與自身服務中繼資料。 | 程序記憶體滑動窗預設 60 秒，受按鍵存取、週期性請求清理及程序退出影響。預設每 100 次檢查清理過期鍵，閒置時可能留到下次掃描。Uvicorn、Render 與前置代理日誌留存待查。 | 服務安全所需，不用於分析、追蹤或行銷。 |
| Request fingerprint／analysis key、write ID、Cache Version、`cached_at` | FastAPI 從商家 ID 和評論內容等產生 SHA-256 指紋，再加模式、模型、Prompt 雜湊、格式及預算組成分析 key。SQLite 另建立寫入識別及時間戳。 | 後端產生 | 否 | 程序內協調至任務完成。SQLite 隨快取列保存及清除。雜湊可以比對相同輸入，不能據此宣稱匿名。 | 快取隔離、去重及並行清除所需。 |
| 完整 Prompt、模型回應中的來源引句 | 後端固定指令加上模型樣本；Google 回應中的原文引句用於驗證。 | 後端組裝或接收 | Prompt 是，來源引句則由 Gemini 回傳 | 應用程式處理記憶體，不寫入完整 Prompt 或獨立引句欄位；供應商處理見下節。 | 分析與證據核對所需。 |
| LLM Output、`analyzed_count`、模式、Model ID、`cache_hit` | 模型、Mock 及後端產生。供消費摘要、實用資訊、餐點、優缺點、評分與分析狀態顯示。 | 後端組裝並回傳 | 模型回應來自 Gemini，後端後設欄位不回傳給 Gemini | SQLite 七天有效，按清理條件刪除。Chrome 結果則依工作階段清除。衍生摘要與推薦描述可能含原文摘錄或個人資訊。 | 產品核心結果。 |
| Error Logs、事件與除錯旗標 | 程式產生錯誤與診斷。FastAPI 記錄 cache／single-flight 事件與失敗碼。瀏覽器可透過本機 `sessionStorage` 旗標啟用額外診斷。 | 無獨立 client log 上傳 | 無 app error log 上傳 | 失敗訊息在 Chrome 任務快照。瀏覽器 console 可能有請求 ID、商家 ID、Tab ID、診斷或例外。正常程式事件不輸出整批評論或完整 Prompt。Web 伺服器、代理、Render 與錯誤追蹤的讀取權限、遮罩、留存及刪除仍待查。 | 最小維運診斷所需，擴充除錯可選。 |
| Gemini 每日額度 | UTC 日期及使用次數，供全站模型防護。 | 後端產生 | 否 | SQLite 的 `gemini_daily_quota` 表。程式以 UTC 日期切換，不套用快取清理；歷史列未配置自動刪除。 | 成本與併發防護，不含使用者或評論 ID。 |

## 留存與刪除

- **Chrome**。快照使用 `chrome.storage.session`，無固定分鐘 TTL。商家改變、Tab 關閉或新任務覆寫時清除／取代既有記錄。關閉側欄不清除結果，重新開啟及 Service Worker 單獨重啟可恢復。Chrome 也會在擴充功能停用、重新載入、更新或瀏覽器重啟時清空 Session 記錄。本程式沒有將評論寫入 `chrome.storage.local`、`chrome.storage.sync` 或其他瀏覽器持久儲存。 [Chrome Storage 文件](https://developer.chrome.com/docs/extensions/reference/api/storage#session)
- **SQLite**。分析快取預設七天後不再命中。初始化及成功寫入時以時間條件刪除過期資料；讀到某個已過期項目時也會條件式刪除。長時間閒置且沒有清理觸發時，過期列可能仍在檔案內。清理只處理 `cache` 表，維持 QA 2.3 的並行保護，不影響每日額度。SQL DELETE 為資料列層級清除。資料庫、WAL、備份、快照或第三方紀錄的物理清除和留存另需驗收。應用程式未配置 SQLite 自有加密。 [Render 持久磁碟文件](https://render.com/docs/disks)
- **Gemini**。單輪 Interactions 明確送 `store: false`，沒有 `previous_interaction_id`、遠端對話歷史、Grounding 或 Background 生成，也維持單次嘗試與停用自動續跑。此設定退出預設的 Interaction 狀態儲存，不會追溯清除既有請求，也不改變帳戶的安全／濫用監控、模型改善條款或其他供應商留存。免費與付費條款、AI Studio 項目留存、歷史請求及 ZDR 狀態均須在正式帳戶驗收。 [Interactions API](https://aistudio.google.com/docs/interactions-overview#data-storage-retention) · [Gemini API 條款](https://aistudio.google.com/docs/terms) · [Gemini ZDR 文件](https://aistudio.google.com/docs/zdr)

## 服務、權限與發布

Production Build 設定以 HTTPS 連線至 Render 的 API 網域。Local Build 設定以 HTTP 連線至 `127.0.0.1:8000`。Manifest 使用 `activeTab`、`sidePanel`、`storage`，以及相應的 Google Maps 和 API host 權限。應用程式沒有廣告、資料銷售、Analytics 或持續的瀏覽／定位蒐集流程。Render 服務區域、方案、日誌、持久磁碟及備份設定尚待確認。 [Render DPA](https://render.com/dpa) · [Render 日誌文件](https://render.com/docs/logging)

[隱私政策雙語草稿](PRIVACY_POLICY_DRAFT.md)和[授權查核與發布門檻](GOOGLE_MAPS_COMPLIANCE_REVIEW.md)仍需核對正式設定、聯絡方式、刪除流程及使用者揭露。程式測試只能確認本機程式及送出的 payload。
