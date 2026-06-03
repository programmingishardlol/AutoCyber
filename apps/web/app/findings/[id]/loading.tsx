export default function FindingDetailLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-72 animate-pulse rounded-md bg-slate-200" />
        <div className="mt-3 h-4 w-full max-w-2xl animate-pulse rounded-md bg-slate-200" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[0.62fr_0.38fr]">
        <div className="space-y-6">
          {[0, 1, 2].map((item) => (
            <div key={item} className="rounded-lg border border-border bg-white p-6 shadow-surface">
              <div className="h-5 w-40 animate-pulse rounded-md bg-slate-200" />
              <div className="mt-4 h-20 animate-pulse rounded-md bg-slate-100" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-border bg-white p-6 shadow-surface">
          <div className="h-5 w-40 animate-pulse rounded-md bg-slate-200" />
          <div className="mt-4 h-32 animate-pulse rounded-md bg-slate-100" />
        </div>
      </div>
    </div>
  );
}
