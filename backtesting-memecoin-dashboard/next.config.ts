import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  // This maps the root URL to your ghost-protocol folder without changing the URL
  async rewrites() {
    return [
      {
        source: "/",
        destination: "/ghost-protocol",
      },
    ];
  },
};

export default nextConfig;