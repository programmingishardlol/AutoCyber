import { resolve } from "node:path";
import { FindingsDashboardClient } from "./findings-dashboard-client";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function FindingsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <FindingsDashboardClient
      defaultPath={resolve(process.cwd(), "../../packages/scanner/src/fixtures/insecure-startup-app")}
      initialParams={normalizeSearchParams(await searchParams)}
    />
  );
}

function normalizeSearchParams(params: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params)
      .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}
