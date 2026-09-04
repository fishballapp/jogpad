//! Writing files back to disk atomically.

use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// Write through a temporary file in the same directory and rename over the
/// target. A plain write truncates first, so an interrupted one leaves the
/// target empty.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // Unique per write: two windows can write the same file at once, and a
    // shared temporary name would let one truncate the other's half-written
    // copy before the rename.
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let tmp = path.with_extension(format!(
        "{}.{}-{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or(""),
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writing_replaces_the_file_without_truncating_it_first() {
        let dir = std::env::temp_dir().join(format!("jogpad-write-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("notes.md");

        write_atomic(&path, b"first").unwrap();
        write_atomic(&path, b"second").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second");
        // The temporary file must not be left lying next to the real one.
        let leftovers = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|x| x == "tmp"))
            .count();
        assert_eq!(leftovers, 0);

        std::fs::remove_dir_all(&dir).ok();
    }
}
