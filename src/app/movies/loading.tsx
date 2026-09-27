export default function Loading() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto max-w-7xl" role="status">
        <h1 className="text-3xl font-semibold">Loading movies…</h1>
        <p className="mt-3 text-slate-400">
          Fetching media and torrent information.
        </p>
        <div className="mt-8 h-48 animate-pulse rounded-2xl bg-slate-900" />
      </div>
    </main>
  );
}
