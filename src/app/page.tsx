import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <p className="mb-3 text-sm font-medium uppercase tracking-[0.25em] text-cyan-400">
          Internal media operations
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Arr Lifecycle
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-400">
          Manage media, torrents and cleanup across the *arr stack.
        </p>
        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {["Movies", "Shows"].map((section) => (
            <section
              key={section}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
            >
              <h2 className="text-xl font-medium">
                {section === "Movies" ? (
                  <Link href="/movies" prefetch={false}>
                    Movies →
                  </Link>
                ) : (
                  section
                )}
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                {section === "Movies"
                  ? "Browse Radarr movies and related torrents."
                  : "Not connected yet."}
              </p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
