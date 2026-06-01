'use strict';
const https = require('https');
const url = require('url');

function makeRequest(apiBase, pat, path, opts) {
  opts = opts || {};
  return new Promise(function(resolve, reject) {
    const base = (apiBase || 'https://api.github.com').replace(/\/$/, '');
    const parsed = url.parse(base + path);
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.path,
      method: opts.method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + pat,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'mr-reviewer-cowork-plugin/2.0.0',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(reqOpts, function(res) {
      const chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) return reject(new Error('GitHub ' + res.statusCode + ': ' + body.slice(0, 400)));
        try { resolve(JSON.parse(body)); } catch (_) { resolve(body); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function ownerRepo(projectId) {
  const parts = String(projectId).split('/');
  return { owner: parts[0], repo: parts.slice(1).join('/') };
}

module.exports = {
  name: 'github',
  prTerm: 'PR',
  listPRs: function(apiBase, pat, projectId, perPage) {
    const { owner, repo } = ownerRepo(projectId);
    return makeRequest(apiBase, pat, '/repos/' + owner + '/' + repo + '/pulls?state=open&per_page=' + (perPage || 100));
  },
  getDiffs: function(apiBase, pat, projectId, prNumber, perPage) {
    const { owner, repo } = ownerRepo(projectId);
    return makeRequest(apiBase, pat, '/repos/' + owner + '/' + repo + '/pulls/' + prNumber + '/files?per_page=' + (perPage || 50));
  },
  getFile: function(apiBase, pat, projectId, filePath, ref) {
    const { owner, repo } = ownerRepo(projectId);
    return makeRequest(apiBase, pat, '/repos/' + owner + '/' + repo + '/contents/' + filePath + (ref ? '?ref=' + encodeURIComponent(ref) : '')).then(function(res) {
      if (res && res.content) return Buffer.from(res.content, 'base64').toString('utf8');
      return typeof res === 'string' ? res : JSON.stringify(res);
    });
  },
  postComment: function(apiBase, pat, projectId, prNumber, body) {
    const { owner, repo } = ownerRepo(projectId);
    return makeRequest(apiBase, pat, '/repos/' + owner + '/' + repo + '/issues/' + prNumber + '/comments', { method: 'POST', body: { body: body } });
  },
  normalisePR: function(pr) {
    return {
      id: pr.id,
      iid: pr.number,
      project_id: pr.base && pr.base.repo ? pr.base.repo.full_name : '',
      title: pr.title,
      description: pr.body || '',
      state: pr.state,
      source_branch: pr.head ? pr.head.ref : '',
      target_branch: pr.base ? pr.base.ref : '',
      web_url: pr.html_url,
      sha: pr.head ? pr.head.sha : '',
      author: pr.user ? { username: pr.user.login, name: pr.user.login } : {},
      assignees: (pr.assignees || []).map(function(a) { return { username: a.login, name: a.login }; }),
      reviewers: (pr.requested_reviewers || []).map(function(r) { return { username: r.login, name: r.login }; }),
      labels: (pr.labels || []).map(function(l) { return l.name; }),
      draft: !!pr.draft,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      user_notes_count: 0,
    };
  },
  normaliseDiff: function(d) {
    return { new_path: d.filename, old_path: d.previous_filename || d.filename, diff: d.patch || '', new_file: d.status === 'added', deleted_file: d.status === 'removed' };
  },
};
