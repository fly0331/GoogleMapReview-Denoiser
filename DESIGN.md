---
name: Lumora for Google Maps
description: A brighter way to choose.
colors:
  paper: "#FCFBF8"
  action: "#0D0D0D"
  ink: "#20201E"
  muted: "#686862"
  iris: "#6941A5"
  sage: "#526B54"
  ochre: "#94602D"
  error: "#913F39"
  border: "#E6E3DD"
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
  control: "9999px"
spacing:
  inline: "8px"
  cluster: "12px"
  section: "16px"
  panel-end: "24px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "#FFFFFF"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    width: "100%"
    height: "36px"
---

## Overview

**Creative North Star: "先看結論，再追原文"**

以成熟商業 SaaS 的精準和節制呈現評論分析。清楚的標題、可預期的閱讀順序與精簡的分隔，讓使用者在狹窄側欄快速找到值得推薦、消費前須注意和到訪所需的資訊。

側欄延續 Editorial Intelligence，以近紙色的畫布、低飽和色彩和編輯式分隔強化閱讀順序。襯線字形集中於 Lumora 字標。實作來源為 `extension/src/App.tsx`、`extension/src/styles.css` 與 `extension/tailwind.config.js`。

## Colors

- **品牌與操作** 側欄四芒星使用 Iris。主要操作採近黑底白字，Iris 也用於欄目提示、次要操作、原文連結、順位、進度及鍵盤焦點。
- **中性色** Paper 作為側欄畫布，Ink 用於正文和標題，Muted 用於後設資訊，Border 用於細分隔線。
- **語意色** Sage 用於推薦與成功，Ochre 用於注意事項及 Mock 模式，Error 用於失敗。分數、階段和模式均保留文字標示。
- 正文、次要文字及互動文字在實際背景上以 4.5:1 對比為驗收目標，焦點指示與關鍵非文字圖形以 3:1 為目標。含透明度的組合須以合成後顏色計算。

## Typography

- 現有字體堆疊以 Inter 起首，由系統 sans-serif 提供回退。繁體中文沿用系統可用字型。
- Lumora 字標使用 Georgia Regular 的固定向量輪廓，字距以 −0.0175em 編排。使用 `extension/public/icons/lumora-wordmark.svg`，呈現寬度 100px、高度依比例縮放。正文沿用 sans-serif。初始主標以 32–68px、1.27 倍行高呈現兩行；結果商家名稱為 24–25px，章節標題為 18px，正文為 14px，附屬資訊為 12px。
- 採繁體中文撰寫介面標題與操作提示。英文保留於標語、產品或模型名稱等有辨識用途的位置。評分與序號採等寬數字，商家名稱、品項、模型 ID 及原文可換行。

## Layout

- 280–480px 採單欄與垂直捲動。左右邊距為 16px，380px 起為 20px。品牌列、主文、分隔線與資料列共享左右對齊線。相關內容以 8–12px 間距組合，獨立結果章節以 24px 分隔。600px 起可使用參考圖的較寬鬆比例，仍維持單欄。
- 結果先呈現消費決策摘要、實用資訊及推薦餐點，再呈現優點、缺點與原始評論，最後是可展開的各面向評分。分析模式與模型資訊保留為輔助資訊。
- 280px 時允許標題、長文、狀態文字和圖例換行。短評分數值可保持同一行，標籤分配剩餘寬度。480px 時延續單欄閱讀順序。
- 後續實作以 280、320、380、480px 檢查長中文評論、長模型 ID、展開證據及無資料狀態。驗收須涵蓋水平溢出、內容截斷、鍵盤焦點與所有既有結果是否可取得。

## Elevation & Depth

以紙色、留白與暖灰細線組織內容。摘要內以 Sage 和 Ochre 的 2px 左線界定兩段內容。擷取與分析使用 3px 平直軌道，依實際階段提供數量或不定進度。

## Shapes

全寬主要操作使用膠囊形。收合控制保留清楚的鍵盤焦點。證據數及分析模式使用文字呈現。

## Components

- **品牌列** 30 × 30px 的既有四芒星與 100px Serif 字標靠左排列，「消費指南」以小字靠右，下方為一條暖灰細線。工具列維持現有品牌資產。
- **初始畫面與分析操作** 紙色上依序呈現欄目提示、兩行主標、說明、全寬 Google Maps 連結及單行功能索引。可分析時呈現主要分析按鈕，進行中用商家名稱、基線對齊的擷取數字與階段列表提供回饋。沿用 `role="status"`、`role="alert"` 與 reduced-motion。
- **決策摘要與到訪前須知** 「值得推薦」和「消費前須注意」使用連續的正文段落與短語意色標。實用資訊以定寬標籤和值組成平直短列，價格及政策可能變動的說明列在分析資訊。沿用無可驗證資料時省略整區的行為。
- **推薦餐點** 「值得一試」以兩位數 Iris 序號、名稱和說明形成可快速掃讀的列表。無明確推薦時保留清楚的空狀態。
- **優缺點與證據** 同一項目呈現面向、摘要與評論數。原文以可用鍵盤操作的 `details`／`summary` 展開，保留星等、可用日期和完整內文，缺少對應評論時提供明確提示。評論數代表支撐該項分析的證據數。
- **各面向評分** 沿用整組可收合的模式、5 分制數值與圖例。長面向名稱可換行。進度條用於對照數值，文字與圖例傳達評分語意。

## Do's and Don'ts

- **Do** 讓摘要、可行動資訊、原文證據形成清楚的閱讀順序。
- **Do** 保留完整分析結果與既有狀態，以瀏覽器原生收合控制支援鍵盤操作。
- **Do** 用具體詞語表達證據與限制，例如「整理自評論」及「實際價格可能變動」。
- **Don't** 為每筆資料加卡片、陰影或徽章。省略重複標題、裝飾性分隔及無意義的 AI 圖案。
- **Don't** 用品牌色替代成功、失敗、評分或分析模式的可讀標示。
