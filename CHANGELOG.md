# Changelog

The release workflow reads these sections. A tag whose version has no section
here fails before it builds anything, which is the point: notes written after
the fact never get written.

## 0.1.5-beta.4

Sections are now called pages, everywhere. The markdown file is unchanged:
they are still `##` headings, so nothing needed migrating.

Pages can be renamed and deleted from ⌘K. Hover a page for the pencil and the
trash. Deleting takes the page's items with it, so it asks twice, in place.

## 0.1.5-beta.3

Settings moved out of the panel into their own window, with a sidebar:
General holds the copy and grouping behaviours, Updates holds the channel
and a check-and-install flow. Both behaviours are now on by default.

The selection bar's toggle is now labelled Mark done / Unmark done.

## 0.1.5-beta.2

Items can be dragged to reorder, with the list animating out of the way, and
dragging a selected row brings the rest of the selection along.

A settings screen (in the ⋮ menu) holds the update channel and two new
behaviours: copying can tick items off as it goes, and done items can gather
under a divider at the bottom of the list. Both are off by default, and the
grouping is display-only, so notes.md keeps its real order.

The selection bar can also check or uncheck everything selected at once.

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
