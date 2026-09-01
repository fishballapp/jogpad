import type { APIRoute } from "astro";
import { fetchPublishedReleases, manifestRelease, manifestFor } from "../lib/releases";

export const prerender = true;

export const GET: APIRoute = async () => {
  const release = manifestRelease(await fetchPublishedReleases(), { stableOnly: true });
  // An empty body means Astro writes no file, so the endpoint 404s. The updater
  // treats any non-2XX as an error rather than "up to date", so this surfaces as
  // a failed check. That only happens before the first release on this channel
  // carries a manifest, and a failed check is better than a wrong one.
  if (!release) return new Response(null, { status: 404 });

  return new Response(await manifestFor(release), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
