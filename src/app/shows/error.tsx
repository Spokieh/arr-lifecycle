"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="p-8 text-slate-200">
      <p>Shows could not be loaded.</p>
      <button onClick={reset} className="mt-4 rounded border p-2">
        Try again
      </button>
    </div>
  );
}
