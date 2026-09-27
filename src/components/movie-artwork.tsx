"use client";

import Image from "next/image";
import { useState } from "react";

export function MovieArtwork({
  src,
  title,
  backdrop = false,
}: {
  src?: string;
  title: string;
  backdrop?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950">
      {src && !failed ? (
        <Image
          src={src}
          alt={backdrop ? "" : title}
          fill
          unoptimized
          sizes={backdrop ? "100vw" : "(max-width: 640px) 50vw, 220px"}
          className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full items-center justify-center p-6 text-center text-slate-400">
          <span
            className="text-4xl font-light"
            aria-label="No artwork available"
          >
            {title.slice(0, 1)}
          </span>
        </div>
      )}
    </div>
  );
}
