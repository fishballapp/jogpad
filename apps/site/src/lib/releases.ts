import semver from "semver";

export type GitHubAsset = {
  name: string;
  browser_download_url: string;
};

export type GitHubRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: GitHubAsset[];
  html_url: string;
};

const REPO = "fishballapp/jogpad";
const MANIFEST_ASSET = "latest.json";

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "jogpad-site-builder",
  };
  // Only for the API. Sending it to the asset CDN would hand a token to a
  // redirect target that has no business seeing it.
  if (process.env.GITHUB_TOKEN) {
    h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return h;
}

/// Every release a user could actually download from. Drafts are dropped here
/// and nowhere else: their assets are not publicly reachable, so a draft that
/// reached a manifest would advertise an update nobody can install.
export async function fetchPublishedReleases(): Promise<GitHubRelease[]> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases?per_page=100`,
    { headers: headers() },
  );
  // Including 404: an empty repository answers 200 with [], so a 404 means the
  // repository moved or the token cannot see it. Serving no manifest because
  // of that would take updates away from everyone already installed.
  if (!res.ok) {
    throw new Error(`GitHub releases API returned ${res.status} ${res.statusText}`);
  }
  const releases = (await res.json()) as GitHubRelease[];
  return releases.filter((r) => !r.draft);
}

/// Highest by SemVer, which is the same order the updater compares in. A
/// release whose tag is not a version is ignored rather than fatal, so a
/// `docs-v2` style tag cannot take the site down.
export function highestRelease(
  releases: GitHubRelease[],
  { stableOnly }: { stableOnly: boolean },
): GitHubRelease | null {
  const ranked = releases
    .flatMap((release) => {
      const version = semver.parse(release.tag_name.replace(/^v/, ""));
      return version ? [{ release, version }] : [];
    })
    // GitHub's prerelease flag is a checkbox a human can untick, so the tag
    // decides what stable means. Trusting the flag alone would let an -rc tag
    // reach every stable client.
    .filter(({ version }) => !stableOnly || version.prerelease.length === 0)
    .sort((a, b) => semver.rcompare(a.version, b.version));
  return ranked[0]?.release ?? null;
}

/// The release whose manifest should be served, or null when there is nothing
/// to serve yet. Throws instead of quietly falling back to an older release: a
/// site that keeps advertising last week's version as the newest is the failure
/// nobody notices until an update never arrives.
export function manifestRelease(
  releases: GitHubRelease[],
  options: { stableOnly: boolean },
): GitHubRelease | null {
  const highest = highestRelease(releases, options);
  if (!highest) return null;
  if (highest.assets.some((a) => a.name === MANIFEST_ASSET)) return highest;
  // Releases cut before the updater existed legitimately carry no manifest, and
  // that is not an error, it just means no channel can be served yet.
  if (!releases.some((r) => r.assets.some((a) => a.name === MANIFEST_ASSET))) return null;
  throw new Error(
    `Release ${highest.tag_name} is the newest but has no ${MANIFEST_ASSET}, while older releases do`,
  );
}

/// The manifest `tauri-action` attached at build time, returned verbatim so the
/// inline minisign signatures stay intact. Never synthesised here.
export async function manifestFor(release: GitHubRelease): Promise<string> {
  const asset = release.assets.find((a) => a.name === MANIFEST_ASSET);
  // Loudly, rather than falling back to an older release: silently advertising
  // yesterday's version as the newest is the failure nobody would notice.
  if (!asset) {
    throw new Error(`Release ${release.tag_name} has no ${MANIFEST_ASSET} asset`);
  }

  const res = await fetch(asset.browser_download_url, {
    headers: { Accept: "application/octet-stream", "User-Agent": "jogpad-site-builder" },
  });
  if (!res.ok) {
    throw new Error(
      `Could not download ${MANIFEST_ASSET} for ${release.tag_name}: ${res.status} ${res.statusText}`,
    );
  }

  const body = await res.text();
  let manifest: { version?: unknown; platforms?: Record<string, { url?: unknown }> };
  try {
    manifest = JSON.parse(body);
  } catch (e) {
    throw new Error(`${MANIFEST_ASSET} for ${release.tag_name} is not JSON: ${e}`);
  }

  if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
    throw new Error(`${MANIFEST_ASSET} for ${release.tag_name} has no version`);
  }
  // Shape is not correspondence. A manifest that parses but describes an older
  // build would advertise yesterday's version as the newest, which is exactly
  // the silent staleness this file exists to prevent.
  const tagged = release.tag_name.replace(/^v/, "");
  if (!semver.eq(manifest.version, tagged)) {
    throw new Error(
      `${MANIFEST_ASSET} for ${release.tag_name} declares version ${manifest.version}`,
    );
  }
  const platforms = Object.entries(manifest.platforms ?? {});
  if (platforms.length === 0) {
    throw new Error(`${MANIFEST_ASSET} for ${release.tag_name} lists no platforms`);
  }
  for (const [platform, record] of platforms) {
    if (typeof record?.url !== "string" || !pinsToThisRelease(record.url, release.tag_name)) {
      throw new Error(
        `${MANIFEST_ASSET} for ${release.tag_name}: platform ${platform} has a url that is not pinned to this release (${record?.url})`,
      );
    }
  }

  return body;
}

/// The download must name one immutable asset. `tauri-action` writes an API
/// asset URL when it builds against a draft, since a draft has no public
/// download URL yet, and the updater sends `Accept: application/octet-stream`
/// which makes those return the archive rather than JSON. Both forms are fine.
/// What is not fine is `releases/latest/download`, which resolves to whatever
/// happens to be newest and would hand a beta client the wrong build.
function pinsToThisRelease(url: string, tag: string): boolean {
  if (url.includes("/releases/latest/download")) return false;
  return (
    url.includes(`https://github.com/${REPO}/releases/download/${tag}/`) ||
    new RegExp(`^https://api\\.github\\.com/repos/${REPO}/releases/assets/\\d+$`).test(url)
  );
}

export function dmgUrl(release: GitHubRelease | null): string | null {
  return release?.assets.find((a) => a.name.endsWith(".dmg"))?.browser_download_url ?? null;
}
