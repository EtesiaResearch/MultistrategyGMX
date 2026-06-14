/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the workspace shared package (TypeScript source, no build step).
  transpilePackages: ["@etesia/shared"],
};

export default nextConfig;
