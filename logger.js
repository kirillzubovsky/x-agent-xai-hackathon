import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Development Logger for X-Agent
class DevelopmentLogger {
  constructor() {
    this.logDir = path.join(__dirname, 'logs');
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFile = path.join(this.logDir, `dev-session-${this.sessionId}.log`);

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.startTime = Date.now();
    this.logLevels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      system: 2,
      api: 3,
      db: 3,
      collection: 2,
      embedding: 2,
      similarity: 2,
      feature: 2,
      test: 3,
      git: 3
    };

    this.currentLogLevel = process.env.LOG_LEVEL ?
      this.logLevels[process.env.LOG_LEVEL] || 2 : 2;
  }

  shouldLog(level) {
    const levelValue = this.logLevels[level] !== undefined ?
      this.logLevels[level] : this.logLevels.info;
    return levelValue <= this.currentLogLevel;
  }

  log(level, message, data = {}) {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data,
      sessionId: this.sessionId,
      elapsedMs: Date.now() - this.startTime
    };

    // Add memory usage for system logs
    if (level === 'system' || level === 'error') {
      logEntry.memoryUsage = process.memoryUsage();
    }

    // Write to file
    try {
      fs.appendFileSync(this.logFile, JSON.stringify(logEntry) + '\n');
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }

    // Console output with color coding
    const colors = {
      error: '\x1b[31m',    // Red
      warn: '\x1b[33m',     // Yellow
      info: '\x1b[36m',     // Cyan
      debug: '\x1b[90m',    // Gray
      system: '\x1b[32m',   // Green
      api: '\x1b[35m',      // Magenta
      db: '\x1b[34m',       // Blue
      collection: '\x1b[36m', // Cyan
      embedding: '\x1b[35m',  // Magenta
      similarity: '\x1b[33m', // Yellow
      feature: '\x1b[32m',    // Green
      test: '\x1b[34m',       // Blue
      git: '\x1b[90m'         // Gray
    };

    const color = colors[level] || '\x1b[0m';
    const reset = '\x1b[0m';

    // Format message for console
    const prefix = `[${level.toUpperCase()}]`.padEnd(12);
    const consoleMsg = `${color}${prefix}${reset} ${timestamp.split('T')[1].split('.')[0]} - ${message}`;

    if (level === 'error') {
      console.error(consoleMsg);
      if (data && Object.keys(data).length > 0) {
        console.error('  ', data);
      }
    } else {
      console.log(consoleMsg);
      if (data && Object.keys(data).length > 0 && level !== 'debug') {
        console.log('  ', data);
      }
    }
  }

  // Convenience methods
  error(message, data) { this.log('error', message, data); }
  warn(message, data) { this.log('warn', message, data); }
  info(message, data) { this.log('info', message, data); }
  debug(message, data) { this.log('debug', message, data); }
  system(message, data) { this.log('system', message, data); }
  api(message, data) { this.log('api', message, data); }
  db(message, data) { this.log('db', message, data); }
  collection(message, data) { this.log('collection', message, data); }
  embedding(message, data) { this.log('embedding', message, data); }
  similarity(message, data) { this.log('similarity', message, data); }
  feature(message, data) { this.log('feature', message, data); }
  test(message, data) { this.log('test', message, data); }
  git(message, data) { this.log('git', message, data); }

  // Get session logs
  getSessionLogs() {
    try {
      const logs = fs.readFileSync(this.logFile, 'utf8')
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
      return logs;
    } catch (err) {
      this.error('Failed to read session logs', { error: err.message });
      return [];
    }
  }

  // Clean old logs (keep last 7 days)
  cleanOldLogs() {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

    try {
      const files = fs.readdirSync(this.logDir);

      files.forEach(file => {
        const filePath = path.join(this.logDir, file);
        const stats = fs.statSync(filePath);

        if (stats.mtimeMs < sevenDaysAgo && file.startsWith('dev-session-')) {
          fs.unlinkSync(filePath);
          this.system('Deleted old log file', { file });
        }
      });
    } catch (err) {
      this.error('Failed to clean old logs', { error: err.message });
    }
  }
}

// Create singleton instance
export const logger = new DevelopmentLogger();

// Clean old logs on startup
logger.cleanOldLogs();

// Log startup
logger.system('Logger initialized for X-Agent', {
  sessionId: logger.sessionId,
  logLevel: process.env.LOG_LEVEL || 'info',
  nodeEnv: process.env.NODE_ENV || 'development'
});
