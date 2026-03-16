import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow large image payloads (base64 images in request bodies)
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
