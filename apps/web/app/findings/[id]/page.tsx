import { resolve } from "node:path";
import { FindingDetailClient } from "./finding-detail-client";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function FindingDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  return (
    <FindingDetailClient
      defaultPath={resolve(process.cwd(), "../../packages/scanner/src/fixtures/insecure-startup-app")}
      findingId={id}
      initialParams={normalizeSearchParams(query)}
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
