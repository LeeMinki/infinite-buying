const SENSITIVE_KEYS = /password|secret|token|appkey|app_key|authorization/i;

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(item)
      ])
    );
  }
  return value;
}

export const logger = {
  info(message, meta) {
    console.log(message, meta ? redact(meta) : '');
  },
  warn(message, meta) {
    console.warn(message, meta ? redact(meta) : '');
  },
  error(message, meta) {
    console.error(message, meta ? redact(meta) : '');
  }
};
