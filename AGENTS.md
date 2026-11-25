# AGENTS.md — Google Maps Review De-noiser

## 1. 專案目標與架構
透過 Chrome Extension 擷取 Google Maps 商家近期評論，送至後端執行「去業配規則過濾 → 月份時間軸災情偵測 → LLM 面向情感分析（ABSA）與證據溯源」。
* `extension/`：Manifest V3、Vite + CRXJS、React 18、TypeScript（嚴格模式，禁止 `any`）、Tailwind CSS、Recharts。
* `backend/`：Python 3.11+、FastAPI、Pydantic v2、SQLite 快取（Key: `place_id`，TTL 7 天）、pytest。

## 2. Extension 開發規範 (`extension/`)
* **DOM 擷取**：禁止依賴混淆 CSS Class（如 `.jftiEf`），優先使用 `data-review-id`、`aria-label` 等語意屬性。
* **擷取流程**：先切換「最新（Newest）」排序 → 節流自動捲動（上限 120 則並防無窮迴圈）→ 展開「全文 / More」按鈕。
* **店家 ID**：從網址擷取 `!1s(0x[0-9a-f]+:0x[0-9a-f]+)` 作為 `place_id`。
* **權限最小化**：`manifest.json` 僅申請 `activeTab`、`sidePanel`、`storage` 與 Google Maps host permissions。

## 3. Backend 開發規範 (`backend/`)
* **核心端點**：`POST /api/v1/analyze`，前後端型別嚴格對齊。
* **去業配規則引擎 (`cleaner.py`)**：規則參數集中管理，總分 `>= 2` 標記為 suspicious：
  * 誘導關鍵字（`送小菜`, `打卡`, `五星`, `招待`, `抽獎`, `活動`, `贈送`, `老闆請`）：`+2`
  * 免洗帳號五星（`author_reviews_count <= 2` 且 `rating == 5` 且字數 `< 15`）：`+2`
  * 極短好評（`rating == 5` 且僅單詞如 `讚`, `好吃`, `推`）：`+1`
  * 支援繁中與英文相對時間（如「2 週前」、「2 weeks ago」）結合 `scraped_at` 換算為 `YYYY-MM`。
* **時間軸異常偵測 (`timeline.py`)**：僅用非 suspicious 評論按月分桶；近 60 天負評（1–3 星）佔比超過歷史平均 1.5 倍且樣本數 `>= 5` 時，觸發 `anomaly_alert`。
* **LLM 分析 (`llm_absa.py`)**：僅送過濾後有內文的評論，使用 Structured Output 輸出 `pros`/`cons` 與 `evidence_review_ids`（後端須二次校驗剔除幻覺 ID）。API Key 由環境變數讀取，並支援 `MOCK_LLM=true` 測試模式。

## 4. 驗證與禁止事項
* **每次修改必跑**：
  * Backend：`cd backend && pytest`
  * Extension：`cd extension && npm run typecheck && npm run build`
* **禁止事項**：跨前後端修改超過 5 個檔案前必須先輸出 Plan 待確認；禁止刪除或略過既有測試。