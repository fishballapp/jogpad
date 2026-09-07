import type { APIRoute } from 'astro';
import {
  type Channel,
  fetchPublishedReleases,
  manifestFor,
  manifestRelease,
} from '../lib/releases.ts';

export const prerender = true;

/// One manifest per update channel. The stable one is `latest.json`, the
/// name Tauri's updater was first pointed at.
const CHANNELS: Record<string, Channel> = { latest: 'stable', beta: 'beta', dev: 'dev' };

export function getStaticPaths() {
  return Object.keys(CHANNELS).map(channel => ({ params: { channel } }));
}

export const GET: APIRoute = async ({ params }) => {
  // Nothing polls localhost for updates, so dev skips the fetch behind this.
  if (import.meta.env.DEV) return new Response(null, { status: 404 });
  const channel = CHANNELS[params.channel ?? ''];
  if (!channel) return new Response(null, { status: 404 });
  const release = manifestRelease(await fetchPublishedReleases(), channel);
  // An empty body means Astro writes no file, so the endpoint 404s. The updater
  // treats any non-2XX as an error rather than "up to date", so this surfaces as
  // a failed check. That only happens before the first release on this channel
  // carries a manifest, and a failed check is better than a wrong one.
  if (!release) return new Response(null, { status: 404 });

  return new Response(await manifestFor(release), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
