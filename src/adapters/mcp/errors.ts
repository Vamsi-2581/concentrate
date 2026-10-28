// JSON-RPC protocol errors. Anything else a tool throws is an execution error
// and goes back to the client as an `isError` tool result instead.

export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;
export const PARSE_ERROR = -32700;
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

export class McpProtocolError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
  }
}
