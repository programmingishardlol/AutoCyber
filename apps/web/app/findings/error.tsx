"use client";

export default function FindingsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-6">
      <h1 className="font-semibold text-red-900">Findings could not load</h1>
      <p className="mt-2 text-sm leading-6 text-red-700">{error.message || "The scanner-backed findings dashboard failed to render."}</p>
      <button className="mt-4 rounded-md bg-red-900 px-4 py-2 text-sm font-semibold text-white" onClick={reset} type="button">
        Retry
      </button>
    </section>
  );
}
