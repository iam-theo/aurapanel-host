import winston from 'winston';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const isProd = process.env.NODE_ENV === 'production';

const consoleFormat = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} ${level}: ${message}${extra}`;
  })
);

const fileFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  defaultMeta: { service: 'server-panel-api' },
  transports: [
    new winston.transports.Console({
      format: isProd ? fileFormat : consoleFormat,
    }),
  ],
});

// Also log to file in production
if (isProd) {
  logger.add(new winston.transports.File({ filename: 'logs/error.log', level: 'error', format: fileFormat }));
  logger.add(new winston.transports.File({ filename: 'logs/combined.log', format: fileFormat }));
}

// Morgan-compatible stream
export const morganStream = {
  write: (msg) => logger.http(msg.trim()),
};

// Helper to mask secrets in logs
export function maskSecrets(obj) {
  const secretKeys = ['password', 'passwd', 'secret', 'token', 'SUDO_PASSWORD', 'jwt'];
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (secretKeys.some(s => k.toLowerCase().includes(s))) out[k] = '***';
  }
  return out;
}
