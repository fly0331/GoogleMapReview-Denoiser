# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主要使用者是在 Google Maps 尋找商家、餐廳及消費資訊的一般消費者，希望在到訪前比較選擇。

## Product Purpose

Lumora 是 AI 消費決策助手。它將 Google Maps 評論整理為消費決策摘要、消費實用資訊、推薦餐點與可溯源的面向分析，減少閱讀大量評論的時間，讓使用者在到訪前取得可用於比較的資訊。

## Positioning

在使用者瀏覽 Google Maps 時，於 Chrome 側邊欄提供當前商家的決策資訊。實用資訊可回查對應的評論引句，優缺點也連結至評論證據。

## Operating Context

使用者在 Google Maps 開啟商家後，從 Lumora 側邊欄啟動分析。擴充功能從最新排序擷取最多 120 則評論。後端依評論 ID 去重並確定性地分配分析預算，最多採用 50 則具內文的評論及 20,000 個內文字元。

## Capabilities and Constraints

- Chrome 側邊欄須支援 280–480px 寬度，保留現有功能及全部分析結果。
- 本階段交付設計文件。後續依規範調整側欄時，沿用現有依賴、後端、API 合約、Content Script 及 Background Task Lifecycle。
- 實用資訊涵蓋預算、等候時間、訂位、停車、用餐限時及付款方式。個別項目須通過原文引句驗證，無可驗證資料時回傳空陣列。價格及商家政策可能隨時間改變。
- Gemini 以單次結構化輸出產生各分析區塊，後端驗證證據 ID。以商家 ID 為鍵的分析快取有效期為七天。
- 支援可重現的 Mock 分析供開發與測試，介面標示目前使用的分析模式。

## Brand Commitments

產品名稱為 Lumora for Google Maps，主要語言為繁體中文，英文標語為「A brighter way to choose.」。品牌符號與字標來源分別為 `extension/public/icons/lumora.svg` 與 `extension/public/icons/lumora-wordmark.svg`。

Editorial Intelligence 品牌個性為 Editorial、Elegant、Intelligent、Minimal、Premium、Consumer-oriented。文字以清楚的消費語彙、可核對的依據和具體的下一步體現這些特質。

## Evidence on Hand

`README.md` 說明功能及使用流程，`extension/src/App.tsx` 呈現側邊欄的實際用語及分析區塊。呈現商家資訊時，證據來自本次分析所採用的評論。

## Product Principles

- 依到訪前需要比較的資訊組織內容，讓使用者在 Google Maps 側邊欄快速掃讀。
- 讓可追溯的評論證據與對應分析一同呈現。
- 有可驗證的評論引句時才呈現對應的實用資訊。
