import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import { findCurriculumIdsByTitle, getCurriculumSummary, listCurriculumSummaries } from './services/curriculum.js';
import { fetchCurriculumLosc } from './services/losc.js';
import { listLessonsForUnit } from './services/lessons.js';
import { findUnitsByTitle, listUnits } from './services/units.js';
import { verifySupabaseConnection } from './supabase.js';
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
}
catch (error) {
    console.error('[MCP] Supabase connection failed during startup:', error);
    process.exit(1);
}
const DEFAULT_PORT = 4545;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_ROUTE = '/mcp';
const DEFAULT_FILE_BYTE_LIMIT = 32_768;
const MAX_FILE_BYTE_LIMIT = 131_072;
const configuredDefaultByteLimit = clampByteLimit(parseInteger(process.env.MCP_FILE_BYTE_LIMIT, DEFAULT_FILE_BYTE_LIMIT));
const RESOURCE_BYTE_LIMIT = Math.min(24_576, configuredDefaultByteLimit);
const successCriterionSchema = z.object({
    success_criteria_id: z.string(),
    title: z.string(),
    active: z.boolean(),
    order_index: z.number()
});
const learningObjectiveSchema = z.object({
    learning_objective_id: z.string(),
    title: z.string(),
    active: z.boolean(),
    spec_ref: z.string().nullable(),
    order_index: z.number(),
    scs: z.array(successCriterionSchema)
});
const unitSchema = z.object({
    unit_id: z.string(),
    title: z.string(),
    is_active: z.boolean()
});
const lessonSchema = z.object({
    lesson_id: z.string(),
    unit_id: z.string(),
    title: z.string(),
    is_active: z.boolean(),
    order_index: z.number()
});
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
    }
    catch {
        return false;
    }
});
const server = new McpServer({
    name: packageJson.name ?? 'planner-mcp-server',
    version: packageJson.version ?? '0.1.0'
}, {
    capabilities: {
        resources: { listChanged: true },
        tools: { listChanged: true },
        prompts: { listChanged: true },
        logging: { levels: ['debug', 'info', 'warn', 'error', 'crit'] },
        roots: { listChanged: true }
    }
});
registerResources();
registerTools();
const app = express();
app.use(express.json({ limit: '1mb' }));
const allowOrigin = process.env.MCP_ALLOW_ORIGIN ?? '*';
const HEADER_SERVICE_KEY = 'x-mcp-service-key';
const serviceKey = process.env.MCP_SERVICE_KEY;
const allowHeaders = process.env.MCP_ALLOW_HEADERS ??
    '*, Content-Type, Accept, MCP-Transport, MCP-Session-Id, x-Mcp-Service-Key';
app.use((req, res, next) => {
    if (!serviceKey) {
        return next();
    }
    const headerValue = req.headers[HEADER_SERVICE_KEY];
    console.log(`[MCP] Auth attempt from ${req.ip ?? 'unknown'} | header present=${typeof headerValue === 'string'}`);
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
    console.log(`[MCP] <-- ${req.method} ${req.url} | Accept=${accept} | Content-Type=${contentType} | Transport=${transport}`);
    res.on('finish', () => {
        console.log(`[MCP] --> ${req.method} ${req.url} | ${res.statusCode} ${res.statusMessage ?? ''}` +
            ` | ${Date.now() - start}ms`);
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
            enableDnsRebindingProtection: (process.env.MCP_ENABLE_DNS_REBINDING_PROTECTION ?? 'false').toLowerCase() === 'true'
        });
        res.on('close', () => {
            transport.close().catch(error => {
                console.error('Failed to close MCP transport', error);
            });
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }
    catch (error) {
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
    console.log(`Planner MCP server listening on http://${host}:${port}${route} (workspace root: ${workspaceRoot})`);
    if (pinnedFiles.length) {
        console.log(`Pinned workspace files: ${pinnedFiles.join(', ')}`);
    }
    else {
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
    // No static resources at this time.
}
function registerTools() {
    server.registerTool('get_curriculum', {
        title: 'Get curriculum summary',
        description: 'Return { curriculum_id, title, is_active } for a specific curriculum.',
        inputSchema: {
            curriculum_id: z.string().min(1).describe('Curriculum identifier.')
        },
        outputSchema: {
            curriculum: z
                .object({
                curriculum_id: z.string(),
                title: z.string(),
                is_active: z.boolean()
            })
                .nullable()
        }
    }, async ({ curriculum_id }) => {
        const curriculum = await getCurriculumSummary(curriculum_id);
        if (!curriculum) {
            const message = `Curriculum ${curriculum_id} was not found.`;
            return {
                content: [{ type: 'text', text: message }],
                structuredContent: { curriculum: null },
                isError: true
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `${curriculum.curriculum_id} • ${curriculum.title} (active=${curriculum.is_active})`
                }
            ],
            structuredContent: { curriculum }
        };
    });
    server.registerTool('get_curriculum_id_from_title', {
        title: 'Find curriculum IDs by title',
        description: 'Search curricula by title using wildcards (*, ?) or JavaScript-style /regex/ patterns.',
        inputSchema: {
            curriculum_title: z
                .string()
                .min(1)
                .describe('Title pattern, e.g. "Math*" or "/Math.+/" (case-insensitive).')
        },
        outputSchema: {
            matches: z.array(z.object({
                curriculum_id: z.string(),
                curriculum_title: z.string()
            }))
        }
    }, async ({ curriculum_title }) => {
        const matches = await findCurriculumIdsByTitle(curriculum_title);
        const structuredContent = { matches };
        console.log(`[MCP] get_curriculum_id_from_title(${curriculum_title}) response: ${JSON.stringify(structuredContent, null, 2)}`);
        return {
            content: [
                {
                    type: 'text',
                    text: matches.length > 0
                        ? matches.map(match => `${match.curriculum_id} • ${match.curriculum_title}`).join('\n')
                        : 'No curricula matched the provided title.'
                }
            ],
            structuredContent
        };
    });
    server.registerTool('get_all_los_and_scs_for_curriculum', {
        title: 'Learning objectives + success criteria',
        description: 'Return the LO/SC tree for a curriculum as defined in specs/mcp/general.md.',
        inputSchema: {
            curriculum_id: z
                .string()
                .min(1)
                .describe('ID of the curriculum to inspect.')
        },
        outputSchema: {
            learning_objectives: z.array(learningObjectiveSchema)
        }
    }, async ({ curriculum_id }) => {
        const curriculum = await fetchCurriculumLosc(curriculum_id);
        if (!curriculum) {
            const message = `No curriculum found for id ${curriculum_id}.`;
            return {
                content: [{ type: 'text', text: message }],
                structuredContent: { learning_objectives: [] },
                isError: true
            };
        }
        const summary = `Curriculum ${curriculum.title} (${curriculum.curriculum_id}) • ${curriculum.learning_objectives.length} learning objectives.`;
        return {
            content: [
                {
                    type: 'text',
                    text: `${summary}\n${JSON.stringify(curriculum, null, 2)}`
                }
            ],
            structuredContent: { learning_objectives: curriculum.learning_objectives }
        };
    });
    server.registerTool('get_all_curriculum', {
        title: 'List curricula',
        description: 'Return all curriculum summaries (id, title, active).',
        outputSchema: {
            curricula: z.array(z.object({
                curriculum_id: z.string(),
                title: z.string(),
                is_active: z.boolean()
            }))
        }
    }, async () => {
        const curricula = await listCurriculumSummaries();
        const structuredContent = { curricula };
        return {
            content: [
                {
                    type: 'text',
                    text: curricula.length > 0
                        ? curricula.map(entry => `${entry.curriculum_id} • ${entry.title}`).join('\n')
                        : 'No curricula available.'
                }
            ],
            structuredContent
        };
    });
    server.registerTool('get_all_units', {
        title: 'List units',
        description: 'Return all unit summaries (id, title, active).',
        outputSchema: {
            units: z.array(unitSchema)
        }
    }, async () => {
        const units = await listUnits();
        const structuredContent = { units };
        return {
            content: [
                {
                    type: 'text',
                    text: units.length > 0
                        ? units.map(entry => `${entry.unit_id} • ${entry.title}`).join('\n')
                        : 'No units available.'
                }
            ],
            structuredContent
        };
    });
    server.registerTool('get_unit_by_title', {
        title: 'Find units by title',
        description: 'Search units by title using wildcards (*, ?) or /regex/ patterns.',
        inputSchema: {
            unit_title: z
                .string()
                .min(1)
                .describe('Title pattern, e.g. "Design*" or "/Design.+/" (case-insensitive).')
        },
        outputSchema: {
            matches: z.array(z.object({
                unit_id: z.string(),
                unit_title: z.string()
            }))
        }
    }, async ({ unit_title }) => {
        const matches = await findUnitsByTitle(unit_title);
        const structuredContent = { matches };
        return {
            content: [
                {
                    type: 'text',
                    text: matches.length > 0
                        ? matches.map(match => `${match.unit_id} • ${match.unit_title}`).join('\n')
                        : 'No units matched the provided title.'
                }
            ],
            structuredContent
        };
    });
    server.registerTool('get_lessons_for_unit', {
        title: 'List lessons for a unit',
        description: 'Return the lessons associated with a given unit.',
        inputSchema: {
            unit_id: z.string().min(1).describe('Unit identifier.')
        },
        outputSchema: {
            lessons: z.array(lessonSchema)
        }
    }, async ({ unit_id }) => {
        const lessons = await listLessonsForUnit(unit_id);
        const structuredContent = { lessons };
        return {
            content: [
                {
                    type: 'text',
                    text: lessons.length > 0
                        ? lessons
                            .map(entry => `${entry.lesson_id} • ${entry.title} (order=${entry.order_index})`)
                            .join('\n')
                        : `No lessons found for unit ${unit_id}.`
                }
            ],
            structuredContent
        };
    });
    server.registerTool('status', {
        title: 'Server status',
        description: 'Quick health probe that always returns "ok".'
    }, async () => {
        const structuredContent = { status: 'ok', timestamp: new Date().toISOString() };
        return {
            content: [{ type: 'text', text: 'ok' }],
            structuredContent
        };
    });
}
async function readWorkspaceFile(relativePath, options) {
    const sanitizedRelativePath = relativePath.replace(/^\/*/, '');
    const absolutePath = resolveWorkspacePath(sanitizedRelativePath);
    const byteLimit = Math.min(MAX_FILE_BYTE_LIMIT, Math.max(256, options?.byteLimit ?? configuredDefaultByteLimit));
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
function resolveWorkspacePath(relativePath) {
    const resolved = path.resolve(workspaceRoot, relativePath);
    if (resolved === workspaceRoot) {
        throw new Error('A file path is required.');
    }
    if (!resolved.startsWith(workspacePrefix)) {
        throw new Error(`Path "${relativePath}" escapes the workspace root.`);
    }
    return resolved;
}
function makeReadResourceResult(uri, text, mimeType, truncated) {
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
function parseCsvEnv(value) {
    if (!value) {
        return undefined;
    }
    const entries = value
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);
    return entries.length ? entries : undefined;
}
function parseInteger(value, fallback) {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function clampByteLimit(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return DEFAULT_FILE_BYTE_LIMIT;
    }
    return Math.max(512, Math.min(MAX_FILE_BYTE_LIMIT, value));
}
function toPosixPath(input) {
    return input.replaceAll(path.sep, '/');
}
function getMimeType(filePath) {
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
function formatFileSnippet(result) {
    const header = `File: ${result.relativePath} (${result.bytesRead}/${result.totalBytes} bytes${result.truncated ? ', truncated' : ''})`;
    return `${header}\n\n\`\`\`\n${result.content}\n\`\`\``;
}
function logRequestBody(req) {
    if (req.method !== 'POST') {
        return;
    }
    try {
        const body = typeof req.body === 'object' ? JSON.stringify(req.body).slice(0, 500) : String(req.body ?? '');
        console.log(`[MCP] Body ${body.length > 500 ? '(truncated)' : ''}: ${body}`);
    }
    catch (error) {
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
server.server.setRequestHandler({ shape: { method: { value: 'roots/list' } } }, async () => ({
    roots: [
        {
            uri: route,
            name: 'workspace-root',
            title: 'Workspace Root',
            description: `Root HTTP entry for planner MCP server (${route})`
        }
    ]
}));
