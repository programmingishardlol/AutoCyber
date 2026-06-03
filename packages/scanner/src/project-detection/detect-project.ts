import type { ProjectProfile, ScannedFile } from "../types";

export function detectProjectProfile(files: ScannedFile[]): ProjectProfile {
  const paths = new Set(files.map((file) => file.relativePath));
  const packageJson = readPackageJson(files);
  const packageText = packageJson ? JSON.stringify({ ...packageJson.dependencies, ...packageJson.devDependencies }) : "";
  const allContent = files.map((file) => file.content).join("\n");

  const frameworks = unique([
    hasAny(paths, ["next.config.js", "next.config.mjs", "next.config.ts"]) || packageText.includes('"next"') || hasPathPrefix(paths, "app/") || hasPathPrefix(paths, "pages/")
      ? "nextjs"
      : null
  ]);

  const languages = unique([
    files.some((file) => /\.(ts|tsx)$/.test(file.relativePath)) ? "typescript" : null,
    files.some((file) => /\.(js|jsx|mjs|cjs)$/.test(file.relativePath)) || packageJson ? "javascript" : null,
    hasAny(paths, ["requirements.txt", "pyproject.toml", "Pipfile"]) || files.some((file) => file.relativePath.endsWith(".py")) ? "python" : null
  ]).filter((language) => language !== "javascript" || !files.some((file) => /\.(ts|tsx)$/.test(file.relativePath)));

  const integrations = unique([
    packageText.includes("@anthropic-ai/sdk") || allContent.includes("ANTHROPIC_API_KEY") ? "anthropic" : null,
    packageText.includes("@clerk/nextjs") || /clerkMiddleware|auth\s*\(|currentUser\s*\(/.test(allContent) ? "clerk" : null,
    packageText.includes('"openai"') || allContent.includes("OPENAI_API_KEY") ? "openai" : null,
    packageText.includes('"stripe"') || /stripe/i.test(allContent) ? "stripe" : null,
    packageText.includes("@supabase/supabase-js") || hasPathPrefix(paths, "supabase/") || /SUPABASE_/i.test(allContent) ? "supabase" : null
  ]);

  const deploymentProviders = unique([
    paths.has("vercel.json") || frameworks.includes("nextjs") ? "vercel" : null,
    paths.has("railway.json") || paths.has("railway.toml") ? "railway" : null,
    paths.has("render.yaml") ? "render" : null,
    paths.has("firebase.json") ? "firebase" : null
  ]);

  const packageManagers = unique([
    paths.has("pnpm-lock.yaml") ? "pnpm" : null,
    paths.has("yarn.lock") ? "yarn" : null,
    paths.has("package-lock.json") || packageJson ? "npm" : null,
    paths.has("requirements.txt") ? "pip" : null,
    paths.has("pyproject.toml") ? "python-project" : null
  ]);

  return {
    frameworks,
    languages,
    integrations,
    deploymentProviders,
    packageManagers
  };
}

function readPackageJson(files: ScannedFile[]): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null {
  const packageFile = files.find((file) => file.relativePath === "package.json");
  if (!packageFile) return null;

  try {
    return JSON.parse(packageFile.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  } catch {
    return null;
  }
}

function hasAny(paths: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => paths.has(candidate));
}

function hasPathPrefix(paths: Set<string>, prefix: string): boolean {
  return [...paths].some((path) => path.startsWith(prefix));
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}
