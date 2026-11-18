import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { usageLogPath, logUsageLine } from '../src/services/claude.js';

// The monthly file is rotation-by-filename: there is no rotation code, so the only thing that
// can break it is the date -> name derivation. Pin that, and pin that a line lands on disk.
describe('usage log', () => {
  const dirs: string[] = [];
  afterEach(() => {
    delete process.env.CLAUDE_USAGE_LOG_DIR;
    dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
    dirs.length = 0;
  });

  const tmp = (): string => {
    const d = mkdtempSync(path.join(tmpdir(), 'legacy-usage-'));
    dirs.push(d);
    return d;
  };

  it('names the file by local month, so a new month rotates on its own', () => {
    // Local-time constructor on purpose: the filename must follow the operator's calendar
    // (WIB), not UTC. A UTC-derived name would flip a month early for Jakarta.
    expect(path.basename(usageLogPath(new Date(2026, 7, 15, 11, 42), '/x')))
      .toBe('claude-usage-2026-08.log');
    expect(path.basename(usageLogPath(new Date(2026, 8, 1, 0, 5), '/x')))
      .toBe('claude-usage-2026-09.log');
  });

  it('appends a timestamped line and creates the folder if it is missing', () => {
    const dir = path.join(tmp(), 'nested', 'claude-usage'); // does not exist yet
    process.env.CLAUDE_USAGE_LOG_DIR = dir;

    logUsageLine('[claude] usage agent', { in: 35000, out: 120 });
    logUsageLine('[claude] ratelimit', { status: 'allowed', utilization: 0.42 });

    const files = readdirSync(dir);
    expect(files).toHaveLength(1); // both lines share the month's file
    const body = readFileSync(path.join(dir, files[0]), 'utf-8').trimEnd().split('\n');
    expect(body).toHaveLength(2);
    expect(body[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[claude\] usage agent \{"in":35000,"out":120\}$/);
    expect(body[1]).toContain('[claude] ratelimit');
  });

  it('never throws when the log cannot be written - a reply outranks its telemetry', () => {
    // A regular file where the log folder should be: mkdirSync cannot create a directory
    // underneath it, so the write path throws and must be swallowed.
    const blocker = path.join(tmp(), 'not-a-folder');
    writeFileSync(blocker, 'x');
    process.env.CLAUDE_USAGE_LOG_DIR = path.join(blocker, 'claude-usage');

    expect(() => logUsageLine('[claude] usage agent', { in: 1 })).not.toThrow();
  });
});
