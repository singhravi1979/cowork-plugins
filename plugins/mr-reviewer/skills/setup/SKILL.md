---
name: setup
description: Set up the mr-reviewer plugin for GitLab or GitHub
---

Guide the user through setting up the mr-reviewer plugin.

## Step 1 — Create your Personal Access Token

**GitLab:** GitLab → User Settings → Access Tokens → create token with `api` scope.
**GitHub:** GitHub → Settings → Developer Settings → Personal Access Tokens → create token with `repo` scope.

## Step 2 — Save the token to a file

The token is stored securely in a local file — it never appears in the web dashboard.

```bash
echo "your-token-here" > ~/.mr-reviewer-pat
chmod 600 ~/.mr-reviewer-pat
```

## Step 3 — Restart Cowork

Fully quit and reopen Cowork so the plugin picks up the token.

## Step 4 — Open the dashboard

Open `http://localhost:7842` in your browser. Fill in:
- **Git Provider**: GitLab or GitHub
- **API URL**: Your instance URL (e.g. `https://gitlab.com` or `https://api.github.com`)
- **Your username** (optional): filters to MRs/PRs assigned to you
- **Projects to watch**: comma-separated paths (e.g. `myorg/my-repo`)
- **Guidelines Repo** (optional): repo with `AGENTS.frontend.md` / `AGENTS.backend.md`

Click **Connect & Load Reviews**. No token needed in the form — it's read from `~/.mr-reviewer-pat` automatically.

## Using in Cowork chat

```
review open PRs in myorg/my-repo
review !144 in myorg/my-repo
review !144 and post
refresh guidelines
```
