# mr-reviewer

> AI-powered PR/MR review assistant for Cowork. Supports GitLab and GitHub.

Generates structured code reviews against your team's coding guidelines, posts them as comments, and can run on a daily schedule so reviews are waiting for you each morning.

## Features

- **Multi-provider** — GitLab and GitHub (self-hosted supported)
- **Team guidelines** — point it at a repo with `AGENTS.frontend.md` / `AGENTS.backend.md` and it applies them automatically
- **Project overrides** — add `CLAUDE.md` to any project repo; it merges with your shared guidelines (project wins on conflicts)
- **Auto-classification** — detects frontend vs backend from file paths and applies the right ruleset
- **Browser dashboard** — full MR/PR dashboard at `http://localhost:7842`
- **Chat reviews** — ask Claude directly: `review !144 in myorg/my-repo`
- **Daily scheduling** — generates draft reviews every morning for you to approve and post

## Prerequisites

- [Cowork](https://claude.ai) desktop app
- A GitLab or GitHub Personal Access Token

## Setup

**1. Install the plugin**  
Download the latest `.plugin` file and install via Cowork → Plugins.

**2. Save your token**
```bash
echo "your-token-here" > ~/.mr-reviewer-pat
chmod 600 ~/.mr-reviewer-pat
```

**3. Restart Cowork**  
Fully quit and reopen.

**4. Open the dashboard**  
Go to `http://localhost:7842` in your browser and fill in the setup form.

## Usage

### In Cowork chat
```
review open PRs in myorg/my-repo
review #42 in myorg/my-repo
review !144 and post
post the review for !144
refresh guidelines
```

### Browser dashboard
Open `http://localhost:7842` — full dashboard with AI review generation and one-click posting.

## Team guidelines (optional)

Create a repo with `AGENTS.frontend.md` and/or `AGENTS.backend.md` defining your coding standards. Enter the repo path in the setup screen. The plugin fetches and applies these automatically on every review.

Any project can also have a `CLAUDE.md` at its root — project-specific rules are merged with your shared guidelines (project wins on section conflicts).

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to structure and update guidelines.

## Configuration

Config is stored at `~/.mr-reviewer-config.json`:

```json
{
  "provider": "gitlab",
  "apiUrl": "https://gitlab.com/api/v4",
  "projects": "your-org/your-repo, your-org/another-repo",
  "guidelinesRepo": "your-org/coding-standards",
  "frontendKw": "web,ui,frontend,react",
  "me": "your-username"
}
```

## Health check
```bash
curl http://localhost:7842/health
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
