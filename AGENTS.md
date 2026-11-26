# AGENTS.md — AI Consumer Decision Assistant

## 1. 專案目標與架構
透過 Chrome Extension 擷取 Google Maps 商家評論，送至後端選出有內文且符合預算的評論，以單次 Gemini 呼叫產出消費決策摘要、實用資訊、推薦餐點及面向情感分析。
* `extension/`：Manifest V3、Vite + CRXJS、React 18、TypeScript（嚴格模式，禁止 `any`）、Tailwind CSS。
* `backend/`：Python 3.11+、FastAPI、Pydantic v2、SQLite 快取（Key: `place_id`，TTL 7 天）、pytest。

## 2. Extension 開發規範 (`extension/`)
* **DOM 擷取**：禁止依賴混淆 CSS Class（如 `.jftiEf`），優先使用 `data-review-id`、`aria-label` 等語意屬性。
* **擷取流程**：先切換「最新（Newest）」排序 → 節流自動捲動（上限 120 則並防無窮迴圈）→ 展開「全文 / More」按鈕。
* **店家 ID**：從網址擷取 `!1s(0x[0-9a-f]+:0x[0-9a-f]+)` 作為 `place_id`。
* **權限最小化**：`manifest.json` 僅申請 `activeTab`、`sidePanel`、`storage` 與 Google Maps host permissions。

## 3. Backend 開發規範 (`backend/`)
* **核心端點**：`POST /api/v1/analyze`，前後端型別嚴格對齊。
* **評論選擇**：保留非空 ID 的第一筆評論，排除空白內文。依 ID 雜湊確定性地分配最多 50 則、20,000 個內文字元的預算。星等、短評、作者活動量、誘導訊號和文字相似度不影響正式選擇。
* **LLM 分析**：一次 Gemini Structured Output 產出摘要、實用資訊、推薦餐點、Pros / Cons 及面向評分。後端驗證證據 ID。實用資訊另查核引句是否出現在對應原文；個別無效項目略過，無資料回傳空陣列。支援 `MOCK_LLM=true`。
* **離線研究**：Legacy Cleaner、Timeline、特徵擷取與相似度模組只供保留基線和測試，正式 API 不呼叫。

## 4. 驗證與禁止事項
* **每次修改必跑**：
  * Backend：`cd backend && pytest`
  * Extension：`cd extension && npm run typecheck && npm run build`
* **禁止事項**：跨前後端修改超過 5 個檔案前必須先輸出 Plan 待確認；禁止刪除或略過既有測試。