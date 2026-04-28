export * from './llm-retry.util';
export * from './cost.util';

/**
 * Safely serializes an error object for logging, handling circular references
 * and non-enumerable properties
 *
 * @param error Any error object or value to serialize
 * @returns A serializable object with all error properties
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (!error) return { error: 'Unknown error (null or undefined)' };

  const errObj = error as Record<string, unknown>;

  const serialized: Record<string, unknown> = {
    name: errObj['name'],
    message: errObj['message'],
    stack: errObj['stack'],
  };

  for (const key in errObj) {
    if (Object.prototype.hasOwnProperty.call(errObj, key)) {
      try {
        if (['name', 'message', 'stack'].includes(key)) continue;
        serialized[key] = errObj[key];
      } catch {
        serialized[key] = 'Error: Could not serialize property';
      }
    }
  }

  if (errObj['response']) {
    try {
      if (typeof errObj['response'] === 'object') {
        const safeResponse = { ...errObj['response'] };
        serialized['response'] = safeResponse;
      } else {
        serialized['response'] = errObj['response'];
      }
    } catch {
      serialized['response'] = 'Error: Could not serialize response';
    }
  }

  return serialized;
}
