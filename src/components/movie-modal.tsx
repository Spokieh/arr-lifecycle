"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/** Native dialog supplies focus trapping, background inertness and Escape support. */
export function MovieModal({
  children,
  label = "Movie details and delete preview",
  closeLabel = "Close movie details",
}: {
  children: ReactNode;
  label?: string;
  closeLabel?: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className="fixed inset-0 m-auto h-[100dvh] max-h-[100dvh] w-full max-w-none overflow-y-auto border border-slate-700 bg-slate-950 p-0 text-slate-100 shadow-2xl backdrop:bg-black/75 sm:h-auto sm:max-h-[90dvh] sm:max-w-5xl sm:rounded-2xl"
      onCancel={(event) => {
        event.preventDefault();
        router.back();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            router.back();
        }
      }}
    >
      <div className="sticky top-0 z-10 flex justify-end border-b border-slate-800 bg-slate-950 px-4 py-3">
        <button
          autoFocus
          onClick={() => router.back()}
          aria-label={closeLabel}
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-cyan-400"
        >
          Close ✕
        </button>
      </div>
      <div className="px-5 pb-8 sm:px-8">{children}</div>
    </dialog>
  );
}
