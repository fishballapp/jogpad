import type { APIRoute } from "astro";
import { fetchPublishedReleases, manifestRelease, manifestFor } from "../lib/releases";

export const prerender = true;

export const GET: APIRoute = async () => {
  const release = manifestRelease(await fetchPublishedReleases(), { stableOnly: false });
  // An empty body means Astro writes no file, so the endpoint 404s. The app
  // reads that as "no update available", which is the truth when no release on
  // this channel can supply a manifest.
  if (!release) return new Response(null, { status: 404 });

  return new Response(await manifestFor(release), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
