//! The markdown file is the source of truth. Pages are `## headings`,
//! items are task-list entries. Continuation lines are indented two spaces.

use serde::Serialize;
use std::io::{self, ErrorKind, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

// ponytail: ids are in-memory only so the file stays clean. They die on reload,
// which is fine because nothing outside the running process holds one.
pub fn next_id() -> u64 {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Item {
    pub id: u64,
    pub text: String,
    pub done: bool,
}

impl Item {
    pub fn new(text: String) -> Item {
        Item {
            id: next_id(),
            text,
            done: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Page {
    pub name: String,
    pub items: Vec<Item>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Doc {
    pub pages: Vec<Page>,
}

pub const DEFAULT_PAGE: &str = "Inbox";

/// Page names are written straight into `## ` headings, so a name carrying
/// a newline would inject arbitrary lines into the file and parse back as
/// something else entirely. The composer is multiline, so this is reachable by
/// pasting rather than by anything exotic.
pub fn normalise_page_name(name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() || name.contains(['\n', '\r']) {
        return None;
    }
    Some(name.to_string())
}

/// Write through a temporary file in the same directory and rename over the
/// target. A plain write truncates first, so an interrupted one leaves the
/// only copy of someone's notes empty.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("")
    ));
    {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        // Rename is atomic, but only guarantees the new name points at
        // whatever made it to disk.
        file.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    // Syncing the directory is what makes the rename itself survive a crash.
    // Best effort: a filesystem that refuses this is not a reason to report
    // the write as failed when the data is already there.
    if let Some(dir) = path.parent() {
        if let Ok(handle) = std::fs::File::open(dir) {
            let _ = handle.sync_all();
        }
    }
    Ok(())
}

impl Doc {
    pub fn parse(md: &str) -> Doc {
        let mut pages: Vec<Page> = Vec::new();
        // Lines before the first heading still need somewhere to go.
        let mut pending_blanks = 0usize;

        for line in md.lines() {
            if let Some(name) = line.strip_prefix("## ") {
                pages.push(Page {
                    name: name.trim().to_string(),
                    items: Vec::new(),
                });
                pending_blanks = 0;
                continue;
            }

            let bullet = line
                .strip_prefix("- [ ] ")
                .map(|t| (false, t))
                .or_else(|| line.strip_prefix("- [x] ").map(|t| (true, t)))
                .or_else(|| line.strip_prefix("- [X] ").map(|t| (true, t)))
                .or_else(|| line.strip_prefix("- ").map(|t| (false, t)));

            if let Some((done, text)) = bullet {
                if pages.is_empty() {
                    pages.push(Page {
                        name: DEFAULT_PAGE.to_string(),
                        items: Vec::new(),
                    });
                }
                pages.last_mut().unwrap().items.push(Item {
                    id: next_id(),
                    text: text.to_string(),
                    done,
                });
                pending_blanks = 0;
                continue;
            }

            if line.trim().is_empty() {
                pending_blanks += 1;
                continue;
            }

            // Two-space indent continues the item above it.
            if let Some(rest) = line.strip_prefix("  ") {
                if let Some(item) = pages.last_mut().and_then(|s| s.items.last_mut()) {
                    for _ in 0..pending_blanks {
                        item.text.push('\n');
                    }
                    item.text.push('\n');
                    item.text.push_str(rest);
                    pending_blanks = 0;
                    continue;
                }
            }

            pending_blanks = 0;
        }

        if pages.is_empty() {
            pages.push(Page {
                name: DEFAULT_PAGE.to_string(),
                items: Vec::new(),
            });
        }
        Doc { pages }
    }

    pub fn to_markdown(&self) -> String {
        let mut out = String::new();
        for page in &self.pages {
            out.push_str("## ");
            out.push_str(&page.name);
            out.push_str("\n\n");
            for item in &page.items {
                out.push_str(if item.done { "- [x] " } else { "- [ ] " });
                let mut lines = item.text.split('\n');
                if let Some(first) = lines.next() {
                    out.push_str(first);
                }
                for line in lines {
                    out.push('\n');
                    if !line.is_empty() {
                        out.push_str("  ");
                        out.push_str(line);
                    }
                }
                out.push('\n');
            }
            out.push('\n');
        }
        out
    }

    /// A missing file is an empty document. Anything else is a real failure
    /// and must not be reported as "no notes", because the caller would then
    /// write that emptiness back over a file it simply could not read.
    pub fn load(path: &Path) -> io::Result<Doc> {
        match std::fs::read_to_string(path) {
            Ok(md) => Ok(Doc::parse(&md)),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(Doc::parse("")),
            Err(e) => Err(e),
        }
    }

    pub fn page_mut(&mut self, name: &str) -> &mut Page {
        if let Some(i) = self.pages.iter().position(|s| s.name == name) {
            return &mut self.pages[i];
        }
        self.pages.push(Page {
            name: name.to_string(),
            items: Vec::new(),
        });
        self.pages.last_mut().unwrap()
    }

    pub fn item_mut(&mut self, id: u64) -> Option<&mut Item> {
        self.pages
            .iter_mut()
            .find_map(|s| s.items.iter_mut().find(|i| i.id == id))
    }

    /// Returns the removed items in document order.
    pub fn take_items(&mut self, ids: &[u64]) -> Vec<Item> {
        let mut taken = Vec::new();
        for page in &mut self.pages {
            let mut kept = Vec::with_capacity(page.items.len());
            for item in page.items.drain(..) {
                if ids.contains(&item.id) {
                    taken.push(item);
                } else {
                    kept.push(item);
                }
            }
            page.items = kept;
        }
        taken
    }

    /// Pull items out (keeping their document order) and drop them back in
    /// front of `before`, or at the end of `page` when `before` is None or
    /// gone. Returns whether anything actually ended up somewhere new: the
    /// file order is only known here, so this is where a no-op drop is caught.
    pub fn move_items_before(&mut self, ids: &[u64], before: Option<u64>, page: &str) -> bool {
        let layout = |pages: &[Page]| -> Vec<Vec<u64>> {
            pages
                .iter()
                .map(|s| s.items.iter().map(|i| i.id).collect())
                .collect()
        };
        let original = layout(&self.pages);

        let taken = self.take_items(ids);
        if taken.is_empty() {
            return false;
        }
        // `before` wins over `page`: dropping onto a row means "in front of
        // that row", wherever it lives.
        let home = before.and_then(|b| {
            self.pages
                .iter()
                .position(|s| s.items.iter().any(|i| i.id == b))
        });
        let target = match home {
            Some(i) => &mut self.pages[i],
            None => self.page_mut(page),
        };
        let index = before
            .and_then(|b| target.items.iter().position(|i| i.id == b))
            .unwrap_or(target.items.len());
        target.items.splice(index..index, taken);

        layout(&self.pages) != original
    }

    pub fn items_in_order(&self, ids: &[u64]) -> Vec<&Item> {
        self.pages
            .iter()
            .flat_map(|s| s.items.iter())
            .filter(|i| ids.contains(&i.id))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strip_ids(doc: &Doc) -> Vec<(String, Vec<(String, bool)>)> {
        doc.pages
            .iter()
            .map(|s| {
                (
                    s.name.clone(),
                    s.items
                        .iter()
                        .map(|i| (i.text.clone(), i.done))
                        .collect::<Vec<_>>(),
                )
            })
            .collect()
    }

    #[test]
    fn round_trips() {
        let md = "## Inbox\n\n- [ ] plain\n- [x] done\n- [ ] multi\n  second line\n\n  after a blank\n\n## Refactor\n\n- [ ] only one\n\n";
        let doc = Doc::parse(md);
        assert_eq!(doc.pages.len(), 2);
        assert_eq!(doc.pages[0].items.len(), 3);
        assert_eq!(
            doc.pages[0].items[2].text,
            "multi\nsecond line\n\nafter a blank"
        );
        assert!(doc.pages[0].items[1].done);
        assert_eq!(md, doc.to_markdown());
        assert_eq!(strip_ids(&doc), strip_ids(&Doc::parse(&doc.to_markdown())));
    }

    #[test]
    fn headless_bullets_land_in_the_default_page() {
        let doc = Doc::parse("- loose note\n");
        assert_eq!(doc.pages[0].name, DEFAULT_PAGE);
        assert_eq!(doc.pages[0].items[0].text, "loose note");
    }

    #[test]
    fn empty_file_still_has_a_page() {
        assert_eq!(Doc::parse("").pages.len(), 1);
    }

    #[test]
    fn page_names_reject_anything_that_would_break_the_file() {
        assert_eq!(normalise_page_name("  Inbox  ").as_deref(), Some("Inbox"));
        assert_eq!(normalise_page_name(""), None);
        assert_eq!(normalise_page_name("   "), None);
        // A multiline composer makes this reachable by pasting.
        assert_eq!(normalise_page_name("Inbox\n## Injected"), None);
        assert_eq!(normalise_page_name("Inbox\rInjected"), None);
    }

    #[test]
    fn a_missing_file_is_empty_but_an_unreadable_one_is_an_error() {
        let dir = std::env::temp_dir().join(format!("jogpad-load-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let missing = dir.join("does-not-exist.md");
        assert!(Doc::load(&missing).is_ok());

        // A directory where a file is expected stands in for any read failure
        // that is not "not found".
        let unreadable = dir.join("notes.md");
        std::fs::create_dir_all(&unreadable).unwrap();
        assert!(Doc::load(&unreadable).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn writing_replaces_the_file_without_truncating_it_first() {
        let dir = std::env::temp_dir().join(format!("jogpad-write-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("notes.md");

        write_atomic(&path, b"first").unwrap();
        write_atomic(&path, b"second").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second");
        // The temporary file must not be left lying next to the real one.
        assert!(!dir.join("notes.md.tmp").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn move_items_before_reorders_within_and_across_pages() {
        let mut doc = Doc::parse("## A\n\n- [ ] one\n- [ ] two\n- [ ] three\n\n## B\n\n");
        let (one, three) = (doc.pages[0].items[0].id, doc.pages[0].items[2].id);

        // Within a page: "one" in front of "three".
        assert!(doc.move_items_before(&[one], Some(three), "A"));
        assert_eq!(
            doc.pages[0]
                .items
                .iter()
                .map(|i| i.text.as_str())
                .collect::<Vec<_>>(),
            vec!["two", "one", "three"]
        );

        // No `before`: lands at the end of the named page, even another one.
        assert!(doc.move_items_before(&[one], None, "B"));
        assert_eq!(doc.pages[1].items[0].text, "one");

        // A `before` that exists elsewhere wins over the named page.
        assert!(doc.move_items_before(&[three], Some(one), "A"));
        assert_eq!(doc.pages[1].items[0].text, "three");

        // A vanished item moves nothing.
        assert!(!doc.move_items_before(&[999], None, "A"));
    }

    #[test]
    fn moving_several_items_keeps_their_order_and_a_noop_reports_false() {
        let mut doc = Doc::parse("## A\n\n- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four\n\n");
        let ids: Vec<u64> = doc.pages[0].items.iter().map(|i| i.id).collect();

        // "one" and "three" in front of "four": document order wins over the
        // order the ids were passed in.
        assert!(doc.move_items_before(&[ids[2], ids[0]], Some(ids[3]), "A"));
        assert_eq!(
            doc.pages[0]
                .items
                .iter()
                .map(|i| i.text.as_str())
                .collect::<Vec<_>>(),
            vec!["two", "one", "three", "four"]
        );

        // Dropping them right back where they already sit changes nothing,
        // and says so, so the caller does not rewrite the file.
        assert!(!doc.move_items_before(&[ids[0], ids[2]], Some(ids[3]), "A"));
    }

    #[test]
    fn take_items_preserves_document_order() {
        let mut doc = Doc::parse("## A\n\n- [ ] one\n- [ ] two\n\n## B\n\n- [ ] three\n\n");
        let ids: Vec<u64> = vec![doc.pages[1].items[0].id, doc.pages[0].items[0].id];
        let taken = doc.take_items(&ids);
        assert_eq!(
            taken.iter().map(|i| i.text.as_str()).collect::<Vec<_>>(),
            vec!["one", "three"]
        );
        assert_eq!(doc.pages[0].items.len(), 1);
        assert!(doc.pages[1].items.is_empty());
    }
}
