import type { IncomingMessage, ServerResponse } from 'node:http';
export function createVisualHandler(options?: {
  local?: boolean;
  typesafeKey?: string;
  allowedOrigins?: string[];
  now?: () => number;
  authorize?: (request: IncomingMessage, response: ServerResponse, establish?: boolean) => string | null;
}): (request: IncomingMessage, response: ServerResponse, next?: () => void) => Promise<void>;
