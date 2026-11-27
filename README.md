# Lumora for Google Maps

**A brighter way to choose.**

Lumora is a Chrome Extension that turns Google Maps reviews into a concise decision brief, practical visit information, recommended dishes, and aspect analysis with traceable review evidence.

**AI 消費決策助手｜讓每一次消費，都有更清晰的選擇。**

Lumora 將 Google Maps 評論整理為消費決策摘要、消費實用資訊、推薦餐點與可溯源的面向分析，方便在到訪前比較。

## Features | 核心功能

### 1. Consumer decision summary | 消費決策摘要

Summarizes what reviewers recommend and what visitors should consider before going.

### 2. Practical visit information | 消費實用資訊

Surfaces review-backed budget, wait times, reservations, parking, dining time limits, payment, and other useful details. Prices and policies may change.

### 3. Dishes and aspect analysis | 推薦餐點與面向分析

Displays recommended dishes, pros and cons linked to review evidence, and aspect scores. Gemini returns all four analysis areas in one Structured Output response.

### 4. Gemini / Mock Mode | AI 分析模式

- **Gemini Mode:** Uses the Gemini API for real AI analysis.
- **Mock Mode:** Derives deterministic mock results from the supplied reviews.
- Displays the current analysis mode in the Extension UI.

- **Gemini Mode：** 使用 Gemini API 進行實際 AI 分析。
- **Mock Mode：** 依輸入評論產生可重現的模擬結果，供本地開發與測試。
- Extension UI 會顯示目前使用的分析模式。



## Architecture | 系統架構

```mermaid
flowchart TD
    A[Google Maps] --> B[Chrome Extension]
    B --> C[Review Extraction]
    C --> D[FastAPI Backend]
    D --> E[SQLite Cache]
    E -->|Cache miss| F[Review Selection]
    F --> H[Gemini Structured Output]
    H --> I[Evidence Validation]
    I -->|Store response| E
    I --> J[Analysis Response]
    E -->|Cache hit| J
    J --> K[Chrome Side Panel]
    K --> L[Review Insights]
```




The backend selects up to 50 text-bearing reviews and 20,000 review-text characters. It deduplicates review IDs and applies a deterministic budget using review IDs. Concurrent misses with the same analysis key share one in-flight result and, when eligible, one Gemini call. Practical information is returned only when its source can be checked against the selected reviews.

## Tech Stack | 技術架構

| Layer | Technologies |
|---|---|
| Browser Extension | Chrome Manifest V3, Side Panel |
| Frontend | React 18, TypeScript |
| Build Tools | Vite, CRXJS |
| Styling | Tailwind CSS |
| Backend | Python 3.11+, FastAPI |
| Data Validation | Pydantic v2 |
| Database / Cache | SQLite |
| AI | Google Gemini API |
| Testing | pytest, httpx |



## Project Structure | 專案結構

```text
Review-Denoiser/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/               # API schemas and settings
│   │   ├── services/
│   │   │   ├── llm_absa.py
│   │   │   ├── review_selection.py
│   │   │   └── ...
│   │   ├── cache.py
│   │   └── main.py
│   ├── tests/
│   ├── pyproject.toml
│   └── requirements.txt
│
├── extension/
│   ├── src/
│   ├── public/
│   ├── tests/
│   ├── package.json
│   ├── package-lock.json
│   └── vite.config.ts
│
├── docs/                       # Data inventory, privacy draft and authorization review
├── AGENTS.md
└── README.md
```


## Getting Started | 安裝與啟動

### Prerequisites | 環境需求

- Python 3.11+（驗證版本為 3.12.4）
- Node.js and npm（驗證版本為 Node.js 20.11.0、npm 10.2.4）
- Google Chrome
- Gemini API Key (optional for Mock Mode)

### 1. Backend Setup | 後端設定

Install dependencies:

```powershell
cd backend
python -m pip install -r requirements.txt
```

Configure environment variables in PowerShell:

**Gemini Mode**

```powershell
$env:GEMINI_API_KEY="YOUR_API_KEY"
$env:GEMINI_MODEL="gemini-3.5-flash-lite"
$env:MOCK_LLM="false"
```

**Mock Mode**

```powershell
$env:MOCK_LLM="true"
```

Start the backend:

```powershell
python -m uvicorn app.main:app --reload --no-proxy-headers
```

Backend API:

- Health Check: `http://127.0.0.1:8000/health`
- API Endpoint: `POST http://127.0.0.1:8000/api/v1/analyze`


### 2. Extension Setup | 擴充功能設定

Install dependencies:

```powershell
cd extension
npm ci
```



Build the Extension:

```powershell
npm run typecheck
npm run build:local
```

Load the Extension in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/dist/` directory.


## Portfolio and release status | 展示與發布狀態

本專案供學習及作品集展示。公開發布前仍須完成 Google Maps 內容授權、正式環境與帳戶驗收，以及隱私政策和商店申報確認。 [資料使用規格](docs/GOOGLE_MAPS_DATA_USAGE_SPEC.md) · [隱私政策草稿](docs/PRIVACY_POLICY_DRAFT.md) · [公開發布門檻](docs/GOOGLE_MAPS_COMPLIANCE_REVIEW.md)
