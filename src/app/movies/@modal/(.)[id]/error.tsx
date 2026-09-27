"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="py-8 text-slate-200">
      <p>Movie details could not be loaded.</p>
      <button
        onClick={reset}
        className="mt-4 rounded border border-slate-600 px-4 py-2"
      >
        Try again
      </button>
    </div>
  );
}
