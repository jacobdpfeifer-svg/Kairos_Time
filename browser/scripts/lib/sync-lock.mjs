// Purpose: blocks overlapping canvas sync runs
import fs from "node:fs";
import path from "node:path";

export function acquireSyncLock(userRoot, now = new Date()) {
  const dir = path.join(userRoot, "inbox", "canvas");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "sync.lock");
  try {
    const fd = fs.openSync(file, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, started_at: now.toISOString() }));
    fs.closeSync(fd);
  } catch {
    let owner = "another sync";
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (raw.pid) {
        try {
          process.kill(Number(raw.pid), 0);
          owner = `sync process ${raw.pid}`;
        } catch {
          fs.unlinkSync(file);
          return acquireSyncLock(userRoot, now);
        }
      }
    } catch { /* unreadable lock still blocks concurrent writes */ }
    const error = new Error(`${owner} is already running`);
    error.code = "sync_in_progress";
    throw error;
  }
  return () => {
    try { fs.unlinkSync(file); } catch { /* already released */ }
  };
}
