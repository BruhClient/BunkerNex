import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile in the home directory makes Next infer the wrong root.
  outputFileTracingRoot: __dirname,
  // The CSVs in data/ are read with fs at request time, so they must stay on
  // disk next to the server bundle rather than being traced away.
  outputFileTracingIncludes: {
    "/api/prices/**": ["./data/**/*.csv"],
    "/": ["./data/**/*.csv"],
  },
};

export default nextConfig;
