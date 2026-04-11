import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

/**
 * Single-request transport for Next.js Route Handlers.
 *
 * StreamableHTTPServerTransport (the standard MCP transport) requires Node.js
 * IncomingMessage / ServerResponse, which Next.js App Router Route Handlers
 * don't expose. This transport implements the Transport interface using
 * a promise-based request/response cycle compatible with the Fetch API.
 *
 * Concurrency note: the module-level McpServer singleton sets _transport per
 * request. Concurrent requests can cause _transport to point to the wrong
 * transport when the server calls send(). This is acceptable for a
 * single-user dev tool where concurrent MCP requests are extremely unlikely.
 */
export class SingleRequestTransport implements Transport {
  private readonly _responsePromise: Promise<JSONRPCMessage>
  private _resolveResponse!: (msg: JSONRPCMessage) => void
  private _rejectResponse!: (err: Error) => void

  onmessage?: (message: JSONRPCMessage) => void
  onclose?: () => void
  onerror?: (error: Error) => void

  constructor() {
    this._responsePromise = new Promise<JSONRPCMessage>((resolve, reject) => {
      this._resolveResponse = resolve
      this._rejectResponse = reject
    })
  }

  async start(): Promise<void> {
    // no-op: no connection setup needed
  }

  async close(): Promise<void> {
    this.onclose?.()
  }

  /** Called by McpServer to send a response back to the client. */
  async send(message: JSONRPCMessage): Promise<void> {
    this._resolveResponse(message)
  }

  /** Push an incoming JSON-RPC message from the HTTP request to the server. */
  dispatch(message: JSONRPCMessage): void {
    this.onmessage?.(message)
  }

  /** Resolves when the server calls send() with the response. */
  response(): Promise<JSONRPCMessage> {
    return this._responsePromise
  }
}
