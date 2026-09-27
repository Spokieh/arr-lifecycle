"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="min-h-screen bg-slate-950 p-12 text-slate-100">
      <h1 className="text-2xl">The page could not be loaded.</h1>
      <button
        onClick={reset}
        className="mt-4 rounded border border-slate-600 px-4 py-2"
      >
        Try again
      </button>
    </main>
  );
}
