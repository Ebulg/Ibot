import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { ensureDir, safeJsonParse } from './utils.js';

export class FileLogStore {
  constructor({ accountId, sessionPath, eventBus }) {
    this.accountId = accountId;
    this.sessionPath = sessionPath;
    this.eventBus = eventBus;
    this.logDir = path.join(sessionPath, 'logs');
    this.logFile = path.join(this.logDir, 'console.jsonl');
  }

  async init() {
    await ensureDir(this.logDir);
    await fs.promises.appendFile(this.logFile, '', 'utf8');
  }

  log(level, source, message, data = {}) {
    const entry = {
      ts: Date.now(),
      iso: new Date().toISOString(),
      accountId: this.accountId,
      level,
      source,
      message,
      data,
    };
    fs.promises.appendFile(this.logFile, `${JSON.stringify(entry)}\n`, 'utf8').catch(() => null);
    this.eventBus?.emit(`logs:${this.accountId}`, entry);
    const printer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    printer(`[${this.accountId}] [${level}] [${source}] ${message}`);
    return entry;
  }

  info(source, message, data) { return this.log('info', source, message, data); }
  warn(source, message, data) { return this.log('warn', source, message, data); }
  error(source, message, data) { return this.log('error', source, message, data); }
  debug(source, message, data) { return this.log('debug', source, message, data); }

  async read({ limit = 300, level, q } = {}) {
    await this.init();
    const max = Math.min(Math.max(Number(limit) || 300, 1), 2000);
    const rows = [];
    const rl = readline.createInterface({ input: fs.createReadStream(this.logFile), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const entry = safeJsonParse(line, null);
      if (!entry) continue;
      if (level && entry.level !== level) continue;
      if (q && !JSON.stringify(entry).toLowerCase().includes(String(q).toLowerCase())) continue;
      rows.push(entry);
      if (rows.length > max) rows.shift();
    }
    return rows.reverse();
  }

  async clear() {
    await ensureDir(this.logDir);
    await fs.promises.writeFile(this.logFile, '', 'utf8');
    this.eventBus?.emit(`logs:${this.accountId}`, { ts: Date.now(), level: 'info', source: 'logs', message: 'Logs limpiados' });
  }
}
