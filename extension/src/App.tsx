export default function App() {
  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-900">
      <header className="border-b border-slate-200 pb-4">
        <p className="text-sm font-medium text-blue-700">Google Maps</p>
        <h1 className="mt-1 text-xl font-semibold">評論去噪器</h1>
      </header>
      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-medium">準備分析評論</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          開啟 Google Maps 商家頁面後，即可在這裡檢視近期評論分析。
        </p>
        <button
          className="mt-4 w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled
          type="button"
        >
          分析目前商家
        </button>
      </section>
    </main>
  );
}
