export default function FindingsLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-40 animate-pulse rounded-md bg-slate-200" />
        <div className="mt-3 h-4 w-full max-w-2xl animate-pulse rounded-md bg-slate-200" />
      </div>
      <div className="rounded-lg border border-border bg-white p-6 shadow-surface">
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-20 animate-pulse rounded-md bg-slate-100" />
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-white shadow-surface">
        {[0, 1, 2].map((item) => (
          <div key={item} className="border-b border-border p-5 last:border-b-0">
            <div className="h-5 w-56 animate-pulse rounded-md bg-slate-200" />
            <div className="mt-3 h-4 w-full animate-pulse rounded-md bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
