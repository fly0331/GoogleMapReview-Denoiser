# Lumora — Google Maps 授權與發布查核

**狀態：Draft · 查核日期：2026-11-27（臺灣時間）**

**發布判定：阻塞。尚無證據證明現行評論擷取、轉送、儲存和展示組合已取得授權。**

此為官方條款與程式行為的對照，供權利與合規審查。Lumora 讀取使用者 Chrome 中的 Google Maps 網頁 DOM，現有流程未呼叫 Google Maps Platform 或 Places API。官方 API 條款在此列為另一條路徑的適用條件，不能轉作 DOM 擷取授權。資料欄位及留存詳見 [資料使用規格](GOOGLE_MAPS_DATA_USAGE_SPEC.md)。

## 授權及商店政策查核

| 項目與查核日期 | 官方來源與適用範圍 | 現行產品行為 | 未解決事項 |
| --- | --- | --- | --- |
| Maps 終端使用者條款 · 2026-11-27 | [Google Maps End User Additional Terms §1、§2](https://www.google.com/help/terms_maps/)。適用於終端使用 Google Maps，對基於 Maps 建立服務、複製、再散布及大量下載設有限制，部分例外取決於授權或適用法律。 | 使用者在 Maps 選商家後點擊分析，DOM 自動定位、展開並擷取至多 50 則。 | 需釐清此應用及擷取方式是否具明確許可，以及條款和任何例外對當前發布模式如何適用。 |
| Maps Platform API 條款 · 2026-11-27 | [Maps Platform Terms §3.2.3](https://cloud.google.com/maps-platform/terms) · [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)。對 Platform 客戶及服務取得的內容適用，限制擷取、快取與衍生使用，並按服務及計費地區適用例外。 | 現行來源是 Maps 網頁 DOM，未透過 Platform API 取得評論或 ID。 | 若後續考慮 Places API，須依契約、API 版本、帳單區域及資料欄位，確認分析、儲存及展示用途是否可行。API 的特定 ID 快取例外不可直接套用到 DOM 值或評論。 |
| DOM 評論擷取 · 2026-11-27 | [Maps End User Terms §2](https://www.google.com/help/terms_maps/) · [Google Geo Guidelines](https://about.google/brand-resource-center/products-and-services/geo-guidelines/)。需一併確認所用內容與使用目的是否受許可。 | 從目前商家畫面讀取既有評論正文、評分、ID、相對時間。 | 尚未有適用此使用方式的書面許可。須確認終端條款、評論權利與適用法律，並界定範圍、地區及流量。 |
| 評論轉送 Gemini · 2026-11-27 | [Google APIs Terms §5(b)](https://developers.google.com/terms#b_submission_of_content) · [Gemini API Additional Terms](https://aistudio.google.com/docs/terms)。Gemini API Client 提交內容時須具可授權的權利，且須遵守帳戶及資料使用條款。 | Render 後端在 Gemini 模式將入選評論 ID、正文與星等送給 Google Gemini 推論。 | 需明確確認可否將第三方評論送入此處理。公開可讀與使用者點擊分析，均不足以證明評論權利人已授權該傳輸。另須確認 Gemini 帳戶方案、條款、允許地區與服務受眾。 |
| 儲存評論與衍生摘要 · 2026-11-27 | [Maps End User Terms §2](https://www.google.com/help/terms_maps/) · [Maps Platform Terms §3.2.3](https://cloud.google.com/maps-platform/terms)（後者只為 API 路徑對照）。 | Chrome Session 保存可展開證據正文。SQLite 保存可包含摘錄的衍生結果及證據 ID，快取有效七天。Gemini 退出預設 Interaction 儲存。 | 需單獨確認原文與衍生內容的暫存、可接受期間、備份與刪除條件。技術留存縮短本身不證明使用權。 |
| 原文與衍生內容再展示 · 2026-11-27 | [Maps End User Terms §1、§2](https://www.google.com/help/terms_maps/) · [Google Geo Guidelines](https://about.google/brand-resource-center/products-and-services/geo-guidelines/) · [Places API Policies and attributions](https://developers.google.com/maps/documentation/places/web-service/policies)（最後一項適用於 API 所供應內容）。 | 側欄展示 Gemini／Mock 摘要及事實類衍生資料。優缺點可以展開證據正文、星等與日期。現行 UI 不顯示作者姓名、頭像或個人頁。 | 查核正文及衍生內容再展示權、來源標示及必要的作者署名。若改用 API，須另確認 API 的來源連結、作者署名及展示規則，再決定如何處理資料最小化。 |
| Chrome Web Store 隱私與 Limited Use · 2026-11-27 | [Developer Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies) · [Privacy 欄位指引](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)。適用於 Chrome Web Store 發布，涵蓋單一用途、最小權限、抓取及衍生資料、必要第三方傳送、隱私政策和揭露同意。 | 本階段有政策草稿，尚未實裝專門的揭露同意介面，未完成商店申報。 | 確認實際讀取、處理、第三方保留和人工存取均符合政策。完成安裝前揭露、知情同意、政策連結及 Dashboard 設定後才可提交。最近一次或任何未來的商店核准均不能證明 Maps 內容已授權。 |

## Gemini 帳戶與留存分層

下列項目在 **2026-11-27** 依官方來源查對。正式帳戶、Cloud Billing 與實際設定皆未查核。

| 層次 | 官方文件與程式行為 | 發布前需驗收 |
| --- | --- | --- |
| Interaction Storage | 現行請求明確送 `store: false`，未傳 `previous_interaction_id`、未設定背景或續跑。官方文件列出的預設儲存與方案期限適用於開啟 Interaction 儲存的情況。 [Interactions API 資料保存](https://aistudio.google.com/docs/interactions-overview#data-storage-retention) | 驗證部署版本仍送出設定。查核舊請求是否有已存的 Interaction，以及可能的處理期限和程序。 |
| 安全與濫用監控 | 官方付費條款說明供應商可能限期記錄輸入與輸出，用於安全、政策執行及依法揭露。此層與 Interaction 儲存分開。 [Gemini 付費資料條款](https://aistudio.google.com/docs/terms#data-use-paid) | 核對帳戶適用的監控條款、實際期間、人工存取及任何額外記錄。 |
| 模型改善、免費與付費 | 官方 Unpaid 條款允許利用輸入與回應改善產品，並要求避免提交個人、機密或敏感資訊。Paid 條款限制用輸入及回應改善產品。Gemini API 的付費分類與實際 Cloud Billing 關聯，部分地區另有特別規則。正文可能含個人內容。 [Gemini API Additional Terms](https://aistudio.google.com/docs/terms) | 查核專案的帳務分類、地區、資料分享及選擇加入設定。以正式帳戶確認符合要揭露的處理條件。 |
| ZDR | ZDR 須逐層確認，包括供應商濫用監控與所用功能。官方文件對需要保證 ZDR 的工作負載另指向 Vertex AI。Lumora 使用 Gemini Developer API，未確認專案 ZDR 資格，也未改用 Vertex AI。 [Gemini Developer API ZDR](https://aistudio.google.com/docs/zdr) | 取得所需帳戶條件或合約證據，再對外描述。不能從 `store: false` 推導 ZDR 保證。 |

## 發布前必須完成

1. 由營運者取得可核對的授權書、正式條款適用解釋或法律審查結論，覆蓋 DOM 擷取、Gemini 轉送、瀏覽器與伺服器保存、原文及衍生內容展示。未取得充分證據前保留 Release Blocker。免費、每次最多 50 則、由使用者發起及通過商店審核均不證明授權。
2. 核對 Gemini 正式專案的方案、地區、使用限制、開發者日誌與歷史 Interaction。另確認目標受眾符合 Gemini 的地區及年齡限制，目前消費者定位未完成此查核。 [Gemini 使用限制](https://aistudio.google.com/docs/terms#use-restrictions)
3. 核對 Render 的正式入口、處理區域、服務方案、日誌、持久磁碟、備份、存取及刪除流程，並確認負責人及聯絡地址。實測正式 Chrome 發行包的 HTTPS 分析及資料處理。 [Render DPA](https://render.com/dpa) · [Render 日誌](https://render.com/docs/logging) · [Render 持久磁碟](https://render.com/docs/disks)
4. 核准政策中英文本及同意流程，發布正式政策頁，並以正式部署行為完成 Chrome Web Store 申報。待聯絡與刪除流程可用後才將草稿標為生效。 [隱私政策草稿](PRIVACY_POLICY_DRAFT.md)

## 最小揭露與同意方案｜尚未實作

在允許分析前，以一段短文揭露目前商家的評論欄位將送往 Render，Gemini 模式將由 Google 處理選中評論，並說明瀏覽器證據與後端分析的留存方式。提供雙語政策連結與明確的同意／拒絕選擇。拒絕時不得送出分析。資料用途變更時重新揭露，並提供查閱政策及管理選擇的入口。另依商店要求完成安裝前資訊與知情同意的確認，分析按鈕本身不應當作完整同意。正式文案、放置位置及同意狀態規格需另行確認。本階段維持 Design Freeze。
