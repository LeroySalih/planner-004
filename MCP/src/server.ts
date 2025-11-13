import express, { type Request } from 'express';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import { findCurriculumIdsByTitle, listCurriculumSummaries } from './services/curriculum.js';
import { verifySupabaseConnection } from './supabase.js';
//Hello
type ReadWorkspaceFileOptions = {
  byteLimit?: number;
};

type ReadWorkspaceFileResult = {
  absolutePath: string;
  relativePath: string;
  bytesRead: number;
  totalBytes: number;
  truncated: boolean;
  content: string;
};

const moduleDir = fileURLToPath(new URL('.', import.meta.url));
const mcpRoot = path.resolve(moduleDir, '..');
const workspaceRoot = path.resolve(mcpRoot, '..');
loadParentEnvFiles();
const workspacePrefix = workspaceRoot.endsWith(path.sep)
  ? workspaceRoot
  : `${workspaceRoot}${path.sep}`;

try {
  const { checkedAt, sampleCount } = await verifySupabaseConnection();
  const countLabel = typeof sampleCount === 'number' ? `${sampleCount} curricula detected` : 'count unavailable';
  console.log(`[MCP] Supabase connection verified at ${checkedAt} (${countLabel}).`);
} catch (error) {
  console.error('[MCP] Supabase connection failed during startup:', error);
  process.exit(1);
}

const DEFAULT_PORT = 4545;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_ROUTE = '/mcp';
const DEFAULT_FILE_BYTE_LIMIT = 32_768;
const MAX_FILE_BYTE_LIMIT = 131_072;
const configuredDefaultByteLimit = clampByteLimit(
  parseInteger(process.env.MCP_FILE_BYTE_LIMIT, DEFAULT_FILE_BYTE_LIMIT)
);
const RESOURCE_BYTE_LIMIT = Math.min(24_576, configuredDefaultByteLimit);

const DEFAULT_PINNED_FILES = [
  'AGENTS.md',
  'README.md',
  'todos.md',
  'src/types/index.ts',
  'src/lib/server-updates.ts'
];

const pinnedFiles = (parseCsvEnv(process.env.MCP_PINNED_FILES) ?? DEFAULT_PINNED_FILES)
  .map(entry => entry.trim())
  .filter(Boolean)
  .filter(relativePath => {
    try {
      return existsSync(resolveWorkspacePath(relativePath));
    } catch {
      return false;
    }
  });

const server = new McpServer(
  {
    name: packageJson.name ?? 'planner-mcp-server',
    version: packageJson.version ?? '0.1.0'
  },
  {
    capabilities: {
      resources: { listChanged: true },
      tools: { listChanged: true },
      prompts: { listChanged: true },
      logging: { levels: ['debug', 'info', 'warn', 'error', 'crit'] },
      roots: { listChanged: true }
    }
  }
);

registerResources();
registerTools();

const app = express();
app.use(express.json({ limit: '1mb' }));
const allowOrigin = process.env.MCP_ALLOW_ORIGIN ?? '*';
const HEADER_SERVICE_KEY = 'x-mcp-service-key';
const serviceKey = process.env.MCP_SERVICE_KEY;
const allowHeaders =
  process.env.MCP_ALLOW_HEADERS ??
  '*, Content-Type, Accept, MCP-Transport, MCP-Session-Id, x-Mcp-Service-Key';

app.use((req, res, next) => {
  if (!serviceKey) {
    return next();
  }
  const headerValue = req.headers[HEADER_SERVICE_KEY];
  console.log(
    `[MCP] Auth attempt from ${req.ip ?? 'unknown'} | header present=${typeof headerValue === 'string'}`
  );
  if (typeof headerValue !== 'string') {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Unauthorized: x-Mcp-Service-Key header required'
      },
      id: null
    });
  }
  if (headerValue.trim() !== serviceKey) {
    return res.status(403).json({
      jsonrpc: '2.0',
      error: {
        code: -32003,
        message: 'Forbidden: invalid service key'
      },
      id: null
    });
  }
  return next();
});
app.use((_, res, next) => {
  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Access-Control-Allow-Headers', allowHeaders);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Credentials', 'false');
    res.setHeader('Vary', 'Origin');
  }
  next();
});
app.use((req, res, next) => {
  const start = Date.now();
  const accept = req.headers.accept ?? '-';
  const contentType = req.headers['content-type'] ?? '-';
  const transport = req.headers['mcp-transport'] ?? '-';
  console.log(
    `[MCP] <-- ${req.method} ${req.url} | Accept=${accept} | Content-Type=${contentType} | Transport=${transport}`
  );
  res.on('finish', () => {
    console.log(
      `[MCP] --> ${req.method} ${req.url} | ${res.statusCode} ${res.statusMessage ?? ''}` +
        ` | ${Date.now() - start}ms`
    );
  });
  next();
});

const route = process.env.MCP_ROUTE ?? DEFAULT_ROUTE;
app.options(route, (req, res) => {
  const requestedHeaders = req.headers['access-control-request-headers'];
  if (requestedHeaders) {
    console.log(`[MCP] Preflight requested headers: ${requestedHeaders}`);
  }
  res.sendStatus(204);
});
app.all(route, async (req, res) => {
  try {
    logRequestBody(req);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: (req.headers.accept ?? '').includes('application/json'),
      allowedHosts: parseCsvEnv(process.env.MCP_ALLOWED_HOSTS),
      allowedOrigins: parseCsvEnv(process.env.MCP_ALLOWED_ORIGINS),
      enableDnsRebindingProtection:
        (process.env.MCP_ENABLE_DNS_REBINDING_PROTECTION ?? 'false').toLowerCase() === 'true'
    });

    res.on('close', () => {
      transport.close().catch(error => {
        console.error('Failed to close MCP transport', error);
      });
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error'
        },
        id: null
      });
    }
  }
});

const port = parseInteger(process.env.MCP_PORT, DEFAULT_PORT);
const host = process.env.MCP_HOST ?? DEFAULT_HOST;

const serverInstance = app
  .listen(port, host, () => {
    console.log(
      `Planner MCP server listening on http://${host}:${port}${route} (workspace root: ${workspaceRoot})`
    );
    if (pinnedFiles.length) {
      console.log(`Pinned workspace files: ${pinnedFiles.join(', ')}`);
    } else {
      console.warn('No pinned files are currently configured or found on disk.');
    }
  })
  .on('error', error => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  });

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down MCP server...');
  serverInstance.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down MCP server...');
  serverInstance.close(() => process.exit(0));
});

function registerResources() {
  server.registerResource(
    'planner-playbook',
    'planner://playbook',
    {
      title: 'Planner Agents Playbook',
      description: 'Canonical implementation guide from AGENTS.md.',
      mimeType: 'text/markdown'
    },
    async uri => {
      const file = await readWorkspaceFile('AGENTS.md', { byteLimit: RESOURCE_BYTE_LIMIT });
      return makeReadResourceResult(uri.href, file.content, 'text/markdown', file.truncated);
    }
  );

  server.registerResource(
    'planner-todos',
    'planner://todos',
    {
      title: 'Planner TODOs',
      description: 'Project TODO list from todos.md.',
      mimeType: 'text/markdown'
    },
    async uri => {
      const file = await readWorkspaceFile('todos.md', { byteLimit: RESOURCE_BYTE_LIMIT });
      return makeReadResourceResult(uri.href, file.content, 'text/markdown', file.truncated);
    }
  );

  const workspaceFileTemplate = new ResourceTemplate('planner://file/{+path}', {
    list: async () => ({
      resources: pinnedFiles.map(relativePath => {
        const normalized = toPosixPath(relativePath);
        return {
          uri: `planner://file/${normalized}`,
          name: normalized,
          title: normalized,
          description: `Pinned workspace file at ${normalized}`,
          mimeType: getMimeType(relativePath)
        };
      })
    }),
    complete: {
      path: async value => {
        if (!value) {
          return pinnedFiles.map(toPosixPath);
        }
        const normalizedSearch = value.toLowerCase();
        return pinnedFiles
          .map(toPosixPath)
          .filter(entry => entry.toLowerCase().includes(normalizedSearch));
      }
    }
  });

  server.registerResource(
    'workspace-file',
    workspaceFileTemplate,
    {
      title: 'Workspace file reader',
      description: 'Read curated repo files via planner://file/{path}',
      mimeType: 'text/plain'
    },
    async (uri, variables) => {
      const resourcePathValue = Array.isArray(variables.path)
        ? variables.path[0]
        : variables.path;
      const resourcePath = resourcePathValue?.trim();
      if (!resourcePath) {
        throw new Error('Missing path variable for workspace resource request.');
      }
      const file = await readWorkspaceFile(resourcePath, { byteLimit: RESOURCE_BYTE_LIMIT });
      return makeReadResourceResult(uri.href, file.content, getMimeType(resourcePath), file.truncated);
    }
  );
}

function registerTools() {
  server.registerTool(
    'get_curriculum_id_from_title',
    {
      title: 'Find curriculum IDs by title',
      description:
        'Search curricula by title using wildcards (*, ?) or JavaScript-style /regex/ patterns.',
      inputSchema: {
        curriculum_title: z
          .string()
          .min(1)
          .describe('Title pattern, e.g. "Math*" or "/Math.+/" (case-insensitive).')
      },
      outputSchema: {
        matches: z.array(
          z.object({
            curriculum_id: z.string(),
            curriculum_title: z.string()
          })
        )
      }
    },
    async ({ curriculum_title }) => {
      const matches = await findCurriculumIdsByTitle(curriculum_title);
      const structuredContent = { matches };
      return {
        content: [
          {
            type: 'text',
            text:
              matches.length > 0
                ? matches.map(match => `${match.curriculum_id} • ${match.curriculum_title}`).join('\n')
                : 'No curricula matched the provided title.'
          }
        ],
        structuredContent
      };
    }
  );

  server.registerTool(
    'get_all_curriculum',
    {
      title: 'List curricula',
      description: 'Return all curriculum summaries (id, title, active).',
      outputSchema: {
        curricula: z.array(
          z.object({
            curriculum_id: z.string(),
            title: z.string(),
            is_active: z.boolean()
          })
        )
      }
    },
    async () => {
      const curricula = await listCurriculumSummaries();
      const structuredContent = { curricula };
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(curricula, null, 2)
          }
        ],
        structuredContent
      };
    }
  );

  server.registerTool(
    'read_workspace_file',
    {
      title: 'Read workspace file',
      description:
        'Read a UTF-8 file relative to the repo root. Intended for smaller files and code snippets.',
      inputSchema: {
        relativePath: z
          .string()
          .min(1)
          .describe('Path relative to the repo root, e.g. src/app/page.tsx'),
        byteLimit: z
          .number()
          .int()
          .min(512)
          .max(MAX_FILE_BYTE_LIMIT)
          .describe(
            `Optional byte ceiling for the response (defaults to ${DEFAULT_FILE_BYTE_LIMIT} bytes).`
          )
          .optional()
      },
      outputSchema: {
        relativePath: z.string(),
        absolutePath: z.string(),
        bytesRead: z.number().int(),
        totalBytes: z.number().int(),
        truncated: z.boolean(),
        content: z.string()
      }
    },
    async ({ relativePath, byteLimit }) => {
      const file = await readWorkspaceFile(relativePath, {
        byteLimit: Math.min(MAX_FILE_BYTE_LIMIT, byteLimit ?? configuredDefaultByteLimit)
      });

      const structuredContent = {
        relativePath: toPosixPath(file.relativePath),
        absolutePath: file.absolutePath,
        bytesRead: file.bytesRead,
        totalBytes: file.totalBytes,
        truncated: file.truncated,
        content: file.content
      };

      return {
        content: [
          {
            type: 'text',
            text: formatFileSnippet(structuredContent)
          }
        ],
        structuredContent
      };
    }
  );

  server.registerTool(
    'search_todos',
    {
      title: 'Search todos.md',
      description: 'Return lines from todos.md that match a case-insensitive query.',
      inputSchema: {
        query: z
          .string()
          .min(2)
          .describe('Case-insensitive substring to look for.'),
        includeCompleted: z
          .boolean()
          .default(false)
          .describe('Include lines that start with [x] (completed items).')
          .optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('Maximum number of matches to return.')
          .optional()
      },
      outputSchema: {
        query: z.string(),
        matches: z.array(
          z.object({
            line: z.number().int(),
            text: z.string()
          })
        )
      }
    },
    async ({ query, includeCompleted = false, limit = 10 }) => {
      const file = await readWorkspaceFile('todos.md', { byteLimit: 64_000 });
      const lines = file.content.split(/\r?\n/);
      const normalizedQuery = query.toLowerCase();
      const matches = [];

      for (let index = 0; index < lines.length; index += 1) {
        const text = lines[index];
        const trimmed = text.trim();
        if (!includeCompleted && trimmed.startsWith('[x]')) {
          continue;
        }
        if (text.toLowerCase().includes(normalizedQuery)) {
          matches.push({ line: index + 1, text });
        }
        if (matches.length >= limit) {
          break;
        }
      }

      const structuredContent = {
        query,
        matches
      };

      return {
        content: [
          {
            type: 'text',
            text:
              matches.length > 0
                ? `Found ${matches.length} match(es) in todos.md:\n${matches
                    .map(match => `L${match.line}: ${match.text}`)
                    .join('\n')}`
                : `No matches for "${query}" in todos.md.`
          }
        ],
        structuredContent
      };
    }
  );

  server.registerTool(
    'status',
    {
      title: 'Server status',
      description: 'Quick health probe that always returns "ok".'
    },
    async () => {
      const structuredContent = { status: 'ok', timestamp: new Date().toISOString() };
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent
      };
    }
  );
}

async function readWorkspaceFile(
  relativePath: string,
  options?: ReadWorkspaceFileOptions
): Promise<ReadWorkspaceFileResult> {
  const sanitizedRelativePath = relativePath.replace(/^\/*/, '');
  const absolutePath = resolveWorkspacePath(sanitizedRelativePath);
  const byteLimit = Math.min(
    MAX_FILE_BYTE_LIMIT,
    Math.max(256, options?.byteLimit ?? configuredDefaultByteLimit)
  );
  const fileBuffer = await readFile(absolutePath);
  const truncated = fileBuffer.byteLength > byteLimit;
  const workingBuffer = truncated ? fileBuffer.subarray(0, byteLimit) : fileBuffer;
  const content = workingBuffer.toString('utf8');

  return {
    absolutePath,
    relativePath: sanitizedRelativePath,
    bytesRead: workingBuffer.byteLength,
    totalBytes: fileBuffer.byteLength,
    truncated,
    content
  };
}

function resolveWorkspacePath(relativePath: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  if (resolved === workspaceRoot) {
    throw new Error('A file path is required.');
  }
  if (!resolved.startsWith(workspacePrefix)) {
    throw new Error(`Path "${relativePath}" escapes the workspace root.`);
  }
  return resolved;
}

function makeReadResourceResult(
  uri: string,
  text: string,
  mimeType: string,
  truncated: boolean
) {
  return {
    contents: [
      {
        uri,
        mimeType,
        text: truncated ? `${text}\n\n---\n(Content truncated for transport.)` : text
      }
    ]
  };
}

function parseCsvEnv(value?: string | null): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const entries = value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
  return entries.length ? entries : undefined;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampByteLimit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_FILE_BYTE_LIMIT;
  }
  return Math.max(512, Math.min(MAX_FILE_BYTE_LIMIT, value));
}

function toPosixPath(input: string): string {
  return input.replaceAll(path.sep, '/');
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.md':
      return 'text/markdown';
    case '.json':
      return 'application/json';
    case '.ts':
    case '.tsx':
      return 'text/x.typescript';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'application/javascript';
    case '.css':
      return 'text/css';
    case '.sql':
      return 'application/sql';
    default:
      return 'text/plain';
  }
}

function formatFileSnippet(result: {
  relativePath: string;
  bytesRead: number;
  totalBytes: number;
  truncated: boolean;
  content: string;
}) {
  const header = `File: ${result.relativePath} (${result.bytesRead}/${result.totalBytes} bytes${
    result.truncated ? ', truncated' : ''
  })`;
  return `${header}\n\n\`\`\`\n${result.content}\n\`\`\``;
}

function logRequestBody(req: Request) {
  if (req.method !== 'POST') {
    return;
  }
  try {
    const body =
      typeof req.body === 'object' ? JSON.stringify(req.body).slice(0, 500) : String(req.body ?? '');
    console.log(`[MCP] Body ${body.length > 500 ? '(truncated)' : ''}: ${body}`);
  } catch (error) {
    console.warn('[MCP] Failed to log request body:', error);
  }
}

function loadParentEnvFiles() {
  const envFiles = ['.env', '.env.local'];
  for (const filename of envFiles) {
    const fullPath = path.join(workspaceRoot, filename);
    if (existsSync(fullPath)) {
      dotenv.config({ path: fullPath, override: true });
    }
  }
}
server.server.setRequestHandler(
  { shape: { method: { value: 'roots/list' } } } as any,
  async () => ({
    roots: [
      {
        uri: route,
        name: 'workspace-root',
        title: 'Workspace Root',
        description: `Root HTTP entry for planner MCP server (${route})`
      }
    ]
  })
);
