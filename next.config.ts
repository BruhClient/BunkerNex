import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile in the home directory makes Next infer the wrong root.
  outputFileTracingRoot: __dirname,
  // The CSVs in data/ are read with fs at request time, so they must stay on
  // disk next to the server bundle rather than being traced away.
  //
  // EVERY route that reaches lib/csv.ts needs an entry here. A missing one is
  // invisible in dev — where the files are simply on disk — and only fails
  // under `next start`, so add the entry in the same change as the route.
  outputFileTracingIncludes: {
    "/api/prices/**": ["./data/**/*.csv"],
    "/api/hq/**": ["./data/**/*.csv"],
    "/hq": ["./data/**/*.csv"],
    "/": ["./data/**/*.csv"],
  },
};

export default nextConfig;
