---
name: Lumora for Google Maps
description: A brighter way to choose.
colors:
  action-violet: "#7C3AED"
  brand-violet: "#8B5CF6"
  lavender: "#C4B5FD"
  midnight-navy: "#0F172A"
  slate-secondary: "#64748B"
  cloud: "#F8FAFC"
  surface: "#FFFFFF"
  divider: "#E2E8F0"
typography:
  wordmark:
    fontFamily: "Georgia"
    fontWeight: 400
  section-title:
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.714
  label:
    fontSize: "0.75rem"
    lineHeight: 1.333
rounded:
  disclosure: "2px"
  control: "8px"
  section: "12px"
  pill: "9999px"
spacing:
  inline: "8px"
  cluster: "12px"
  section: "16px"
  panel-end: "24px"
components:
  button-primary:
    backgroundColor: "{colors.action-violet}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    width: "100%"
    height: "40px"
  result-section:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.section}"
    padding: "{spacing.section}"
---

## Overview

**Creative North Star: "先看結論，再追原文"**

以成熟商業 SaaS 的精準和節制呈現評論分析。清楚的標題、可預期的閱讀順序與精簡的分隔，讓使用者在狹窄側欄快速找到值得推薦、消費前須注意和到訪所需的資訊。

品牌採用 Editorial Intelligence 方向，結合精品生活指南的編輯感與清楚易讀的消費資訊。保留 Lumora 名稱與英文標語，將襯線字形集中於字標。實作來源為 `extension/src/App.tsx`、`extension/src/styles.css` 與 `extension/tailwind.config.js`。

## Colors

- **主色** 使用 Action Violet 標示品牌四芒星、主要操作、可展開的評論及鍵盤焦點。Lavender 用於低強度的背景或提示。
- **中性色** 使用 Midnight Navy 呈現品牌與主要文字，Slate Secondary 用於次要說明，Cloud 作為畫布，白色用於需要分組的內容。Divider 僅用於需要辨識邊界或長列表分項的位置。
- **語意色** 沿用現有綠、琥珀、紅的狀態語意。評分保留數值和圖例，Gemini／Mock 保留文字標示，失敗保留明確訊息。狀態即使去除色彩也應可理解。
- 正文、次要文字及互動文字在實際背景上以 4.5:1 對比為驗收目標，焦點指示與關鍵非文字圖形以 3:1 為目標。含透明度的組合須以合成後顏色計算。

## Typography

- 現有字體堆疊以 Inter 起首，由系統 sans-serif 提供回退。繁體中文沿用系統可用字型。
- Lumora 字標使用 Georgia Regular 的固定向量輪廓，字距以 −0.0175em 編排，並以共同基線對齊。使用 `extension/public/icons/lumora-wordmark.svg`，呈現寬度 120px、高度依比例縮放。字形由 SVG 路徑提供，介面仍使用 sans-serif。區塊標題與項目名稱使用半粗體，分析與評論正文沿用 14px，長文維持約 24px 行高。12px 用於標語、日期、模式、圖例等附屬資訊。
- 採繁體中文撰寫介面標題與操作提示。英文保留於標語、產品或模型名稱等有辨識用途的位置。評分與序號採等寬數字，商家名稱、品項、模型 ID 及原文可換行。

## Layout

- 280–480px 採單欄與垂直捲動。沿用 16px 側欄邊距，優先維持文字欄寬。現有 12px 同組間距與 16px 區塊間距作為基準，使用留白與對齊建立閱讀節奏。
- 結果先呈現消費決策摘要、實用資訊及推薦餐點，再呈現優點、缺點與原始評論，最後是可展開的各面向評分。分析模式與模型資訊保留為輔助資訊。
- 280px 時允許標題、長文、狀態文字和圖例換行。短評分數值可保持同一行，標籤分配剩餘寬度。480px 時延續單欄閱讀順序。
- 後續實作以 280、360、480px 檢查長中文評論、長模型 ID、展開證據及無資料狀態。驗收須涵蓋水平溢出、內容截斷、鍵盤焦點與所有既有結果是否可取得。

## Elevation & Depth

延續平面層次。以 Cloud、白底、間距與細分隔組織內容，評論原文可使用淡底與縮排附在對應觀察下。一般區塊以無投影為基準，避免多層白卡、重複描邊、亮面漸層、玻璃質感與發光陰影。

## Shapes

沿用小幅圓角的收合控制、8px 的按鈕與原文容器，以及 12px 的主要區塊。膠囊只用於短狀態與評論計數。列表優先共享一個容器，以間距或必要的細分隔區分資料列。

## Components

- **品牌列** 左側是 40 × 40px 的透明底 Violet 四芒星與白色圓心，右側是 Midnight Navy 字標及低視覺權重的英文標語。符號與文字組垂直置中，間距 10px，底部使用淡色分隔線。Chrome 工具列使用同一星形與圓心，搭配 Midnight Navy 圓角底板。圖示來源位於 `extension/public/icons/`。
- **分析操作** 「AI 消費分析」是全寬主要按鈕。保留 hover、清楚的鍵盤焦點及進行中停用狀態。沿用文字狀態與錯誤提示，分別透過 `role="status"` 與 `role="alert"` 傳達。載入轉動遵循 reduced-motion 偏好，階段資訊始終以文字提供。
- **決策摘要與實用資訊** 並列的語意以垂直段落呈現「值得推薦」和「消費前須注意」。實用資訊以類別與內文組成短列，保留價格及政策可能變動的說明。沿用無可驗證資料時省略整區的行為。
- **推薦餐點** 以序號、名稱和說明形成可快速掃讀的列表。無明確推薦時保留清楚的空狀態。
- **優缺點與證據** 同一項目呈現面向、摘要與評論數。原文以可用鍵盤操作的 `details`／`summary` 展開，保留星等、可用日期和完整內文，缺少對應評論時提供明確提示。評論數代表支撐該項分析的證據數。
- **各面向評分** 沿用整組可收合的模式、5 分制數值與圖例。長面向名稱可換行。進度條用於對照數值，文字與圖例傳達評分語意。

## Do's and Don'ts

- **Do** 讓摘要、可行動資訊、原文證據形成清楚的閱讀順序。
- **Do** 保留完整分析結果與既有狀態，以瀏覽器原生收合控制支援鍵盤操作。
- **Do** 用具體詞語表達證據與限制，例如「整理自評論」及「實際價格可能變動」。
- **Don't** 為每筆資料加卡片、陰影或徽章。省略重複標題、裝飾性分隔及無意義的 AI 圖案。
- **Don't** 用品牌色替代成功、失敗、評分或分析模式的可讀標示。
