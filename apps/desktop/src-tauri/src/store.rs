//! The markdown file is the source of truth. Sections are `## headings`,
//! items are task-list entries. Continuation lines are indented two spaces.

use serde::Serialize;
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
pub struct Section {
    pub name: String,
    pub items: Vec<Item>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Doc {
    pub sections: Vec<Section>,
}

pub const DEFAULT_SECTION: &str = "Inbox";

impl Doc {
    pub fn parse(md: &str) -> Doc {
        let mut sections: Vec<Section> = Vec::new();
        // Lines before the first heading still need somewhere to go.
        let mut pending_blanks = 0usize;

        for line in md.lines() {
            if let Some(name) = line.strip_prefix("## ") {
                sections.push(Section {
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
                if sections.is_empty() {
                    sections.push(Section {
                        name: DEFAULT_SECTION.to_string(),
                        items: Vec::new(),
                    });
                }
                sections.last_mut().unwrap().items.push(Item {
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
                if let Some(item) = sections.last_mut().and_then(|s| s.items.last_mut()) {
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

        if sections.is_empty() {
            sections.push(Section {
                name: DEFAULT_SECTION.to_string(),
                items: Vec::new(),
            });
        }
        Doc { sections }
    }

    pub fn to_markdown(&self) -> String {
        let mut out = String::new();
        for section in &self.sections {
            out.push_str("## ");
            out.push_str(&section.name);
            out.push_str("\n\n");
            for item in &section.items {
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

    pub fn load(path: &Path) -> Doc {
        match std::fs::read_to_string(path) {
            Ok(md) => Doc::parse(&md),
            Err(_) => Doc::parse(""),
        }
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(path, self.to_markdown())
    }

    pub fn section_mut(&mut self, name: &str) -> &mut Section {
        if let Some(i) = self.sections.iter().position(|s| s.name == name) {
            return &mut self.sections[i];
        }
        self.sections.push(Section {
            name: name.to_string(),
            items: Vec::new(),
        });
        self.sections.last_mut().unwrap()
    }

    pub fn item_mut(&mut self, id: u64) -> Option<&mut Item> {
        self.sections
            .iter_mut()
            .find_map(|s| s.items.iter_mut().find(|i| i.id == id))
    }

    /// Returns the removed items in document order.
    pub fn take_items(&mut self, ids: &[u64]) -> Vec<Item> {
        let mut taken = Vec::new();
        for section in &mut self.sections {
            let mut kept = Vec::with_capacity(section.items.len());
            for item in section.items.drain(..) {
                if ids.contains(&item.id) {
                    taken.push(item);
                } else {
                    kept.push(item);
                }
            }
            section.items = kept;
        }
        taken
    }

    pub fn items_in_order(&self, ids: &[u64]) -> Vec<&Item> {
        self.sections
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
        doc.sections
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
        assert_eq!(doc.sections.len(), 2);
        assert_eq!(doc.sections[0].items.len(), 3);
        assert_eq!(
            doc.sections[0].items[2].text,
            "multi\nsecond line\n\nafter a blank"
        );
        assert!(doc.sections[0].items[1].done);
        assert_eq!(md, doc.to_markdown());
        assert_eq!(strip_ids(&doc), strip_ids(&Doc::parse(&doc.to_markdown())));
    }

    #[test]
    fn headless_bullets_land_in_the_default_section() {
        let doc = Doc::parse("- loose note\n");
        assert_eq!(doc.sections[0].name, DEFAULT_SECTION);
        assert_eq!(doc.sections[0].items[0].text, "loose note");
    }

    #[test]
    fn empty_file_still_has_a_section() {
        assert_eq!(Doc::parse("").sections.len(), 1);
    }

    #[test]
    fn take_items_preserves_document_order() {
        let mut doc = Doc::parse("## A\n\n- [ ] one\n- [ ] two\n\n## B\n\n- [ ] three\n\n");
        let ids: Vec<u64> = vec![
            doc.sections[1].items[0].id,
            doc.sections[0].items[0].id,
        ];
        let taken = doc.take_items(&ids);
        assert_eq!(
            taken.iter().map(|i| i.text.as_str()).collect::<Vec<_>>(),
            vec!["one", "three"]
        );
        assert_eq!(doc.sections[0].items.len(), 1);
        assert!(doc.sections[1].items.is_empty());
    }
}
