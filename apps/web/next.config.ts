import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  images: { remotePatterns: [{ protocol: "https", hostname: "image.tmdb.org" }] },
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default config;
