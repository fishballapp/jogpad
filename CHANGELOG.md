# Changelog

The release workflow reads these sections. A tag whose version has no section
here fails before it builds anything, which is the point: notes written after
the fact never get written.

## 0.1.5

Everything from the 0.1.5 betas, for anyone on the stable channel coming
from 0.1.4.

Sections are now called pages. The markdown file is unchanged: they are
still `##` headings. Pages can be renamed and deleted from ⌘K, where ⌘1 to
⌘9 also jump straight to a page.

Items can be dragged to reorder, and dragging a selected row brings the
rest of the selection along. The selection bar can mark or unmark
everything selected at once.

Settings live in their own window, a floating panel like the pad, so it
opens over full-screen apps. General holds Appearance (Dark, Light or
system), a zoom stepper, Show in Finder, and two behaviours that are on by
default: copying ticks items off as it goes, and done items gather under a
"Done N" heading at the bottom, folded away until you click it. Updates
holds the channel, including a new Dev channel built from every push to
main, and a check-and-install flow. The pad checks for updates hourly, and
an available update shows as a download icon in the top bar.

Fixes: row selection no longer reads past the end of the list after a page
switch or search, deleting an empty page from ⌘K asks once, and the
permission prompt no longer hides behind the settings window.

## 0.1.5-beta.7

Settings › General has an Appearance setting: Dark, Light, or follow the
system. Dark stays the default.

A new Dev update channel under Settings › Updates follows every push to
main. It is unreviewed by definition. The pad now checks for updates every
hour as well as at launch, and an available update shows as a download
icon in the top bar instead of an entry in the ⋮ menu.

In the ⌘K palette, ⌘1 to ⌘9 jump straight to a page. The current page is
labelled Selected, and the item count no longer moves when you hover a row.

Opening the permission prompt while settings was open could leave the
prompt behind the settings window. Settings now hides first.

## 0.1.5-beta.6

The settings window is now the same kind of floating panel as the pad, so it
really does open over a full-screen app. The previous beta only asked it to
join every Space, and showing it still switched you back to the desktop.
Settings always sits above the pad.

Double-tapping Shift while the settings window has the keyboard puts both
windows away. The next double-tap brings back just the pad.

## 0.1.5-beta.5

Done items start folded away under a "Done N" heading. Click it to open them.
While folded they are out of reach of the arrow keys, select-all and Delete.

Settings › General has a zoom stepper and the Show in Finder button, which
has left the panel's ⋮ menu. Zoom now applies to the settings window as
well, and the settings window follows you onto a full-screen app's Space
instead of opening on the desktop behind it.

Deleting an empty page from ⌘K no longer asks twice.

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
