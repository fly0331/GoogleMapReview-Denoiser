# Google Maps Review De-noiser

分析 Google Maps 商家的近期評論，協助整理評論摘要與可能的異常趨勢。

## 技術架構

- `extension/`：Chrome Manifest V3 Side Panel，使用 Vite、CRXJS、React 18、嚴格模式 TypeScript、Tailwind CSS 與 Recharts。
- `backend/`：Python 3.11+、FastAPI、Pydantic v2、SQLite 與 pytest。

## Backend

```powershell
cd backend
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

健康檢查：`GET http://127.0.0.1:8000/health`。分析 API 為 `POST /api/v1/analyze`。

執行測試：

```powershell
cd backend
pytest
```

## Extension

```powershell
cd extension
npm install
npm run dev
```

建立可載入 Chrome 的 Extension：

```powershell
npm run typecheck
npm run build
```

在 Chrome 開啟 `chrome://extensions`，啟用開發人員模式並載入 `extension/dist/`。
