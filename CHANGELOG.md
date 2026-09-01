# Changelog

The release workflow reads these sections. A tag whose version has no section
here fails before it builds anything, which is the point: notes written after
the fact never get written.

## 0.1.5-beta.1

Row selection no longer indexes past the end of the list when the visible rows
change underneath it. Clicking a row, or arrow-keying through them, right after
a section switch or a search could read a row that was no longer there.

Everything else is repo plumbing: structure and formatting linting, on commit
and in CI.

## 0.1.4

The updater proved itself end to end on the 0.1.4 beta, so this went to stable.
Fixes a More menu that took the whole window down with it, and notarises the
disk image rather than only the app inside it, which is what Gatekeeper
actually judges on a fresh download.
