#!/usr/bin/env node
'use strict';

const http     = require('http');
const https    = require('https');
const readline = require('readline');
const url      = require('url');
const fs       = require('fs');
const path     = require('path');

const providers = {
  gitlab: require('./providers/gitlab'),
  github: require('./providers/github'),
};

const HTTP_PORT      = parseInt(process.env.MCP_HTTP_PORT || '7842', 10);
const CONFIG_FILE    = require('os').homedir() + '/.mr-reviewer-config.json';
const GUIDELINES_CACHE = require('os').homedir() + '/.mr-reviewer-guidelines.json';
const DRAFTS_FILE    = require('os').homedir() + '/.mr-reviewer-drafts.json';
const STATIC         = path.join(__dirname, 'dashboard.html');

// SSE clients connected to /api/reviews/stream
const sseClients = new Set();

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch(_) { return {}; }
}
function writeConfig(data) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(Object.assign(readConfig(), data), null, 2)); } catch(_) {}
}

function getPAT() {
  const cfg = readConfig();
  if (cfg.provider === 'github') {
    const env = process.env.GITHUB_TOKEN || '';
    if (env && !env.startsWith('${')) return env;
  } else {
    const env = process.env.GITLAB_PERSONAL_ACCESS_TOKEN || '';
    if (env && !env.startsWith('${')) return env;
  }
  try { return fs.readFileSync(require('os').homedir() + '/.mr-reviewer-pat', 'utf8').trim(); } catch(_) {}
  try { return fs.readFileSync(require('os').homedir() + '/.gitlab-pat', 'utf8').trim(); } catch(_) { return ''; }
}

function getProvider() {
  const cfg = readConfig();
  return providers[cfg.provider] || providers.gitlab;
}

function getApiBase() {
  const cfg = readConfig();
  if (cfg.provider === 'github') {
    return (cfg.apiUrl || 'https://api.github.com').replace(/\/$/, '');
  }
  const raw = process.env.GITLAB_API_URL || '';
  if (raw && !raw.startsWith('${')) return raw.replace(/\/$/, '');
  return (cfg.apiUrl || 'https://gitlab.com/api/v4').replace(/\/$/, '');
}

// ── MCP tools ─────────────────────────────────────────────────────────

const TOOLS = [
  { name: 'list_merge_requests',       description: 'List open PRs/MRs for a project', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, per_page: { type: 'number' } }, required: ['project_id'] } },
  { name: 'get_merge_request_diffs',   description: 'Get file diffs for a PR/MR',       inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, merge_request_iid: { type: 'number' }, per_page: { type: 'number' } }, required: ['project_id', 'merge_request_iid'] } },
  { name: 'create_merge_request_note', description: 'Post a comment on a PR/MR',       inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, merge_request_iid: { type: 'number' }, body: { type: 'string' } }, required: ['project_id', 'merge_request_iid', 'body'] } },
  { name: 'get_file_contents',         description: 'Get a file from a repo',           inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, file_path: { type: 'string' }, ref: { type: 'string' } }, required: ['project_id', 'file_path'] } },
  { name: 'get_guidelines',            description: 'Fetch, merge and cache coding guidelines. Auto-selects frontend/backend rules based on project name and changed file paths. Merges with project CLAUDE.md, deduplicates by section heading (project-specific wins).', inputSchema: { type: 'object', properties: { guidelines_repo: { type: 'string' }, project_id: { type: 'string' }, file_paths: { type: 'array', items: { type: 'string' } }, frontend_keywords: { type: 'string' }, force: { type: 'boolean' } }, required: [] } },
  { name: 'save_review',               description: 'Save a generated review as a draft so it appears in the web dashboard. Call this after generating a review to make it visible at localhost:7842.', inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, merge_request_iid: { type: 'number' }, title: { type: 'string' }, review: { type: 'string' } }, required: ['project_id', 'merge_request_iid', 'review'] } },
  { name: 'get_saved_reviews',         description: 'Get all saved draft reviews from the web dashboard store.', inputSchema: { type: 'object', properties: {}, required: [] } },
];

async function callTool(name, args) {
  const pat = getPAT();
  if (!pat) throw new Error('Personal Access Token is not set. Save it to ~/.mr-reviewer-pat or set the env var.');
  const provider = getProvider();
  const apiBase = getApiBase();

  switch (name) {
    case 'list_merge_requests': {
      const raw = await provider.listPRs(apiBase, pat, args.project_id, args.per_page);
      return Array.isArray(raw) ? raw.map(provider.normalisePR) : raw;
    }
    case 'get_merge_request_diffs': {
      const raw = await provider.getDiffs(apiBase, pat, args.project_id, Number(args.merge_request_iid), args.per_page);
      return Array.isArray(raw) ? raw.map(provider.normaliseDiff) : raw;
    }
    case 'create_merge_request_note': {
      return provider.postComment(apiBase, pat, args.project_id, Number(args.merge_request_iid), String(args.body));
    }
    case 'get_file_contents': {
      return provider.getFile(apiBase, pat, args.project_id, String(args.file_path), String(args.ref || 'HEAD'));
    }
    case 'get_guidelines': {
      const guidelinesRepo = args.guidelines_repo || readConfig().guidelinesRepo || '';
      const projectId = args.project_id || '';
      const filePaths = Array.isArray(args.file_paths) ? args.file_paths : [];
      const force = !!args.force;
      const kwRaw = args.frontend_keywords || readConfig().frontendKw || 'web,ui,frontend,dashboard,react,angular,vue,client';
      const frontendKws = kwRaw.split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean);

      // ── Classify: frontend or backend? ─────────────────────────────────
      const projLower = projectId.toLowerCase();
      const isFrontendByName = frontendKws.some(function(k) { return projLower.indexOf(k) >= 0; });
      const frontendExts = ['.component.ts', '.component.html', '.component.scss', '.component.css', '.tsx', '.jsx', '.vue', '.scss', '.css', '.html'];
      const backendExts = ['.gateway.ts', '.controller.ts', '.service.ts', '.module.ts', '.resolver.ts', '.guard.ts', '.interceptor.ts'];
      var feScore = 0, beScore = 0;
      filePaths.forEach(function(p) {
        frontendExts.forEach(function(e) { if (p.endsWith(e)) feScore++; });
        backendExts.forEach(function(e) { if (p.endsWith(e)) beScore++; });
        if (p.indexOf('component') >= 0 || p.indexOf('pages/') >= 0 || p.indexOf('views/') >= 0) feScore++;
        if (p.indexOf('controller') >= 0 || p.indexOf('gateway') >= 0 || p.indexOf('service') >= 0) beScore++;
      });
      const isFrontend = isFrontendByName || feScore > beScore;
      const guidelinesFile = isFrontend ? 'AGENTS.frontend.md' : 'AGENTS.backend.md';
      const guidelinesType = isFrontend ? 'frontend' : 'backend';

      // ── Cache key ───────────────────────────────────────────────────────
      const cacheKey = guidelinesRepo + '|' + projectId + '|' + guidelinesType;
      if (!force) {
        try {
          const cached = JSON.parse(fs.readFileSync(GUIDELINES_CACHE, 'utf8'));
          if (cached && cached.cacheKey === cacheKey && (Date.now() - cached.ts) < 3600000) {
            return cached;
          }
        } catch(_) {}
      }

      // ── Fetch helpers ───────────────────────────────────────────────────
      async function tryGet(projId, filePath) {
        try {
          return await provider.getFile(apiBase, pat, projId, filePath, 'HEAD');
        } catch(_) { return null; }
      }

      // ── Fetch common guidelines + project CLAUDE.md in parallel ────────
      const claudeCandidates = ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md', 'docs/AGENTS.md', 'docs/CLAUDE.md'];
      const fetches = [
        guidelinesRepo ? tryGet(guidelinesRepo, guidelinesFile) : Promise.resolve(null),
      ].concat(projectId ? claudeCandidates.map(function(f) { return tryGet(projectId, f); }) : [Promise.resolve(null)]);

      const results = await Promise.all(fetches);
      const commonRaw = results[0] || null;
      var projectRaw = null;
      for (var ri = 1; ri < results.length; ri++) {
        if (results[ri]) { projectRaw = results[ri]; break; }
      }

      // ── Merge + deduplicate by ## section heading ───────────────────────
      function parseSections(md) {
        if (!md || typeof md !== 'string') return [];
        var sections = [];
        var lines = md.split('\n');
        var current = null;
        lines.forEach(function(line) {
          if (/^##+ /.test(line)) {
            if (current) sections.push(current);
            current = { heading: line.trim(), lines: [] };
          } else if (current) {
            current.lines.push(line);
          }
        });
        if (current) sections.push(current);
        return sections;
      }

      function sectionsToMd(sections) {
        return sections.map(function(s) { return s.heading + '\n' + s.lines.join('\n'); }).join('\n\n');
      }

      var merged;
      if (!commonRaw && !projectRaw) {
        merged = null;
      } else if (!commonRaw) {
        merged = projectRaw;
      } else if (!projectRaw) {
        merged = commonRaw;
      } else {
        // Merge: project sections override common sections with same heading
        var commonSections = parseSections(commonRaw);
        var projectSections = parseSections(projectRaw);
        var projectHeadings = {};
        projectSections.forEach(function(s) { projectHeadings[s.heading.toLowerCase()] = true; });
        // Keep common sections not overridden by project
        var kept = commonSections.filter(function(s) { return !projectHeadings[s.heading.toLowerCase()]; });
        // All project sections + non-duplicate common sections
        var allSections = projectSections.concat(kept);
        merged = sectionsToMd(allSections);
      }

      const result = {
        cacheKey: cacheKey,
        guidelinesRepo: guidelinesRepo,
        projectId: projectId,
        type: guidelinesType,
        isFrontend: isFrontend,
        guidelinesFile: guidelinesFile,
        projectClaudeMd: !!projectRaw,
        merged: merged,
        ts: Date.now(),
        fetchedAt: new Date().toISOString(),
      };
      try { fs.writeFileSync(GUIDELINES_CACHE, JSON.stringify(result)); } catch(_) {}
      return result;
    }
    case 'save_review': {
      const drafts = (() => { try { return JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8')); } catch(_) { return {}; } })();
      const key = String(args.project_id) + '!' + String(args.merge_request_iid);
      const draft = { project_id: args.project_id, iid: args.merge_request_iid, title: args.title || '', review: args.review, generatedAt: Date.now() };
      drafts[key] = draft;
      fs.writeFileSync(DRAFTS_FILE, JSON.stringify(drafts, null, 2));
      // Push to any open dashboard tabs instantly
      const event = 'data: ' + JSON.stringify({ type: 'review_saved', key, draft }) + '\n\n';
      sseClients.forEach(function(c) { try { c.write(event); } catch(_) { sseClients.delete(c); } });
      return { ok: true, key, message: 'Review saved — dashboard updated live at localhost:7842.' };
    }
    case 'get_saved_reviews': {
      try { return JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8')); } catch(_) { return {}; }
    }
    default: throw new Error('Unknown tool: ' + name);
  }
}

// ── MCP JSON-RPC ──────────────────────────────────────────────────────

async function handleMcp(msg) {
  if (!msg.id && (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled')) return null;
  if (msg.method === 'initialize') return { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mr-reviewer', version: '2.0.0' } } };
  if (msg.method === 'ping')       return { jsonrpc: '2.0', id: msg.id, result: {} };
  if (msg.method === 'tools/list') return { jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } };
  if (msg.method === 'tools/call') {
    try {
      const result = await callTool(msg.params.name, msg.params.arguments || {});
      return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } };
    } catch (e) {
      return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true } };
    }
  }
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
}

// ── HTTP server ───────────────────────────────────────────────────────

function readBody(req) {
  return new Promise(function(resolve) {
    const c = [];
    req.on('data', function(d) { c.push(d); });
    req.on('end', function() { resolve(Buffer.concat(c).toString('utf8')); });
  });
}

function j(res, data, status) {
  res.writeHead(status || 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function startHttpServer() {
  const server = http.createServer(async function(req, res) {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const parsed   = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const query    = parsed.query;

    // Health
    if (req.method === 'GET' && pathname === '/health') {
      return j(res, { ok: true, server: 'mr-reviewer', version: '2.0.0', provider: getProvider().name, pat: getPAT() ? 'set' : 'MISSING' });
    }

    // Dashboard
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      try {
        const html = fs.readFileSync(STATIC, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (_) {
        res.writeHead(404); res.end('dashboard.html not found next to server');
      }
      return;
    }

    // REST API
    if (req.method === 'GET' && pathname === '/api/mrs') {
      try {
        const raw = await getProvider().listPRs(getApiBase(), getPAT(), query.project || '', query.per_page || 100);
        return j(res, Array.isArray(raw) ? raw.map(getProvider().normalisePR) : raw);
      } catch (e) { return j(res, { error: e.message }, 500); }
    }
    if (req.method === 'GET' && pathname === '/api/diff') {
      try {
        const raw = await getProvider().getDiffs(getApiBase(), getPAT(), query.project || '', query.iid, query.per_page || 50);
        return j(res, Array.isArray(raw) ? raw.map(getProvider().normaliseDiff) : raw);
      } catch (e) { return j(res, { error: e.message }, 500); }
    }
    if (req.method === 'GET' && pathname === '/api/file') {
      try {
        const data = await getProvider().getFile(getApiBase(), getPAT(), query.project || '', query.path || '', query.ref || 'HEAD');
        return j(res, data);
      } catch (e) { return j(res, { error: e.message }, e.message.includes('404') ? 404 : 500); }
    }
    if (req.method === 'GET' && pathname === '/api/config') {
      return j(res, readConfig());
    }
    if (req.method === 'POST' && pathname === '/api/config') {
      try {
        const b = JSON.parse(await readBody(req));
        writeConfig(b);
        return j(res, { ok: true });
      } catch(e) { return j(res, { error: e.message }, 400); }
    }
    if (req.method === 'GET' && pathname === '/api/guidelines') {
      try {
        const result = await callTool('get_guidelines', {
          guidelines_repo: query.repo || '',
          project_id: query.project || '',
          file_paths: query.files ? query.files.split(',') : [],
          frontend_keywords: query.frontend_kw || '',
          force: query.force === 'true',
        });
        return j(res, result);
      } catch(e) { return j(res, { error: e.message }, 500); }
    }
    if (req.method === 'POST' && pathname === '/api/notes') {
      try {
        const b = JSON.parse(await readBody(req));
        const data = await getProvider().postComment(getApiBase(), getPAT(), b.project || '', Number(b.iid), String(b.body));
        return j(res, data);
      } catch (e) { return j(res, { error: e.message }, 500); }
    }

    // SSE stream — dashboard subscribes here to receive live review updates
    if (req.method === 'GET' && pathname === '/api/reviews/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', function() { sseClients.delete(res); });
      return;
    }

    // Drafts — read all saved reviews
    if (req.method === 'GET' && pathname === '/api/drafts') {
      try {
        const drafts = JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8'));
        return j(res, drafts);
      } catch(_) { return j(res, {}); }
    }
    // Drafts — save/update a review for a specific MR
    if (req.method === 'POST' && pathname === '/api/drafts') {
      try {
        const b = JSON.parse(await readBody(req));
        const drafts = (() => { try { return JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8')); } catch(_) { return {}; } })();
        const key = String(b.project_id) + '!' + String(b.iid);
        if (b.delete) {
          delete drafts[key];
        } else {
          drafts[key] = { project_id: b.project_id, iid: b.iid, review: b.review, title: b.title || '', generatedAt: Date.now() };
        }
        fs.writeFileSync(DRAFTS_FILE, JSON.stringify(drafts, null, 2));
        // Broadcast to all connected dashboard tabs
        const event = 'data: ' + JSON.stringify({ type: 'review_saved', key, draft: drafts[key] || null }) + '\n\n';
        sseClients.forEach(function(c) { try { c.write(event); } catch(_) { sseClients.delete(c); } });
        return j(res, { ok: true });
      } catch (e) { return j(res, { error: e.message }, 500); }
    }

    // MCP endpoint
    if (req.method === 'POST' && pathname === '/mcp') {
      try {
        const body = JSON.parse(await readBody(req));
        if (Array.isArray(body)) {
          const responses = (await Promise.all(body.map(handleMcp))).filter(Boolean);
          return j(res, responses);
        }
        const response = await handleMcp(body);
        if (response) return j(res, response);
        res.writeHead(202); res.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } }));
      }
      return;
    }

    res.writeHead(404); res.end('Not found');
  });

  server.on('error', function(err) { log('HTTP error: ' + err.message); });
  server.listen(HTTP_PORT, '127.0.0.1', function() {
    log('Ready  -> http://localhost:' + HTTP_PORT);
    log('Provider: ' + getProvider().name);
    log('PAT: '  + (getPAT() ? 'set' : 'MISSING'));
  });
}

// ── Stdio transport ───────────────────────────────────────────────────

function startStdio() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async function(line) {
    line = line.trim();
    if (!line) return;
    try {
      const msg = JSON.parse(line);
      const r   = await handleMcp(msg);
      if (r) process.stdout.write(JSON.stringify(r) + '\n');
    } catch (e) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } }) + '\n');
    }
  });
  rl.on('close', function() { process.exit(0); });
}

function log(msg) { process.stderr.write('[mr-reviewer] ' + msg + '\n'); }

startHttpServer();
if (!process.stdin.isTTY) { startStdio(); }
