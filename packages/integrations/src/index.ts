export const integrationProviders = [
  "github",
  "vercel",
  "supabase",
  "clerk",
  "stripe",
  "firebase",
  "railway",
  "render",
  "openai",
  "anthropic"
] as const;

export type IntegrationProvider = (typeof integrationProviders)[number];
