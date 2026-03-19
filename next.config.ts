import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow large payloads (base64 images + DWG files in request bodies)
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
