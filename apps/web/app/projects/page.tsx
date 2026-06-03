import { mockProjects } from "@autocyber/core";
import { PageHeader } from "@/components/page-header";

export default function ProjectsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Projects" description="Customer products under security review, with stack context and risk posture." />
      <div className="grid gap-4 lg:grid-cols-2">
        {mockProjects.map((project) => (
          <article key={project.id} className="rounded-lg border border-border bg-white p-6 shadow-surface">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{project.name}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{project.description}</p>
              </div>
              <div className="rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white">{project.riskScore}</div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {project.stack.map((tag) => (
                <span key={tag} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                  {tag}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
