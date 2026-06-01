'use strict';
const https = require('https');
const http = require('http');
const url = require('url');

function makeRequest(apiBase, pat, path, opts) {
  opts = opts || {};
  return new Promise(function(resolve, reject) {
    const parsed = url.parse(apiBase.replace(/\/$/, '') + path);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.path,
      method: opts.method || 'GET',
      headers: { 'PRIVATE-TOKEN': pat, 'Content-Type': 'application/json' },
    };
    const req = transport.request(reqOpts, function(res) {
      const chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) return reject(new Error('GitLab ' + res.statusCode + ': ' + body.slice(0, 400)));
        try { resolve(JSON.parse(body)); } catch (_) { resolve(body); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function enc(projectId) { return encodeURIComponent(String(projectId)); }

module.exports = {
  name: 'gitlab',
  prTerm: 'MR',
  listPRs: function(apiBase, pat, projectId, perPage) {
    return makeRequest(apiBase, pat, '/projects/' + enc(projectId) + '/merge_requests?state=opened&scope=all&per_page=' + (perPage || 100));
  },
  getDiffs: async function(apiBase, pat, projectId, prNumber, perPage) {
    const pid = enc(projectId);
    try {
      const d = await makeRequest(apiBase, pat, '/projects/' + pid + '/merge_requests/' + prNumber + '/diffs?per_page=' + (perPage || 50));
      if (Array.isArray(d) && d.length) return d;
      throw new Error('empty');
    } catch (_) {
      const d = await makeRequest(apiBase, pat, '/projects/' + pid + '/merge_requests/' + prNumber + '/changes');
      return Array.isArray(d) ? d : (d && d.changes ? d.changes : []);
    }
  },
  getFile: function(apiBase, pat, projectId, filePath, ref) {
    return makeRequest(apiBase, pat, '/projects/' + enc(projectId) + '/repository/files/' + encodeURIComponent(filePath) + '/raw?ref=' + encodeURIComponent(ref || 'HEAD'));
  },
  postComment: function(apiBase, pat, projectId, prNumber, body) {
    return makeRequest(apiBase, pat, '/projects/' + enc(projectId) + '/merge_requests/' + prNumber + '/notes', { method: 'POST', body: { body: body } });
  },
  normalisePR: function(mr) {
    return {
      id: mr.id, iid: mr.iid, project_id: mr.project_id,
      title: mr.title, description: mr.description, state: mr.state,
      source_branch: mr.source_branch, target_branch: mr.target_branch,
      web_url: mr.web_url, sha: mr.sha,
      author: mr.author || {}, assignees: mr.assignees || [], reviewers: mr.reviewers || [],
      labels: mr.labels || [], draft: !!(mr.work_in_progress || mr.draft),
      created_at: mr.created_at, updated_at: mr.updated_at,
      user_notes_count: mr.user_notes_count || 0,
    };
  },
  normaliseDiff: function(d) {
    return { new_path: d.new_path, old_path: d.old_path, diff: d.diff || '', new_file: !!d.new_file, deleted_file: !!d.deleted_file };
  },
};
