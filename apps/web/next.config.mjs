import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(currentDirectory, "../.."),
  transpilePackages: ["@autocyber/core"],
};

export default nextConfig;
