"use client";

import { useActionState } from "react";
import { refreshMovies } from "@/app/movies/actions";

export function RefreshMovies() {
  const [error, action, pending] = useActionState(async () => {
    try {
      await refreshMovies();
      return "";
    } catch {
      return "Refresh failed. Please try again.";
    }
  }, "");
  return (
    <form action={action} className="flex items-center gap-3">
      <button
        disabled={pending}
        className="rounded border border-slate-700 px-4 py-2 text-sm disabled:opacity-50"
      >
        {pending ? "Refreshing…" : "Refresh data"}
      </button>
      <span role="status" className="text-sm text-amber-300">
        {error}
      </span>
    </form>
  );
}
