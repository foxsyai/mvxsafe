// The Chrome profile of a capture run holds the wallets' sessions, so it is
// deleted when the run ends, however it ends (backlog of the audit of 21 Oct
// 2026), and only once Chrome has been closed: deleted under a running Chrome,
// a file it wrote meanwhile failed the delete, and Chrome, started detached,
// stayed open and logged in (review of PR #15).
import { rmSync } from 'node:fs';

export const deleteProfile = (dir) => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    console.log(`Deleted ${dir}, with the wallet sessions it held.`);
    return true;
  } catch (error) {
    console.error(`Could not delete ${dir} (${error.message}). Delete it by hand: it holds wallet sessions.`);
    return false;
  }
};

/**
 * Closes Chrome, then deletes its profile, on Ctrl+C, on SIGTERM and at the
 * end of the run (call the returned finish). Launch with handleSIGINT and
 * handleSIGTERM false, so the order is this one.
 *
 * However the run ends otherwise, the exit listener deletes what is still
 * there: a failed step, the main body failing on a page that closing Chrome
 * closed first (it then ends the process before finish can delete: second
 * review of PR #15), or a second Ctrl+C, which exits at once. Playwright's own
 * exit handler, registered at launch and so before this one, has killed Chrome
 * by then.
 */
export const guardProfile = (dir, context, { keep = false } = {}) => {
  let closing = false;
  let deleted = keep;
  const deleteOnce = () => {
    if (deleted) return;
    deleted = true;
    deleteProfile(dir);
  };
  const finish = async (code = 0) => {
    if (closing) process.exit(code);
    closing = true;
    await context.close().catch(() => {});
    deleteOnce();
    process.exit(code);
  };
  process.on('SIGINT', () => finish(130));
  process.on('SIGTERM', () => finish(143));
  process.on('exit', deleteOnce);
  return finish;
};
