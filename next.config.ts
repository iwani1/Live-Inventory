import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the sandboxed live-preview host (and any other reverse-proxied origin)
  // to call server actions while running `next dev`.
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev"],
};

export default nextConfig;
