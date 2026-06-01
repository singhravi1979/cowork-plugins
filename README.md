# cowork-plugins

Open-source Cowork plugins for GitLab and GitHub code review, guidelines management, and more.

## Install the Marketplace

In Cowork, open a chat and run:

```
/plugin marketplace add singhravi1979/cowork-plugins
```

Then install any plugin from the marketplace:

```
/plugin install mr-reviewer@iluminr-plugins
```

Team members will see all plugins listed in their Cowork plugin browser with one-click install and automatic update notifications.

---

## Plugins

### [mr-reviewer](./plugins/mr-reviewer)

AI-powered PR/MR review assistant for **GitLab and GitHub**. Generates structured code reviews against your team's `AGENTS.md` guidelines merged with each project's `CLAUDE.md`, posts reviews as GitLab/GitHub comments, and runs on a daily schedule.

**Quick install:**
```
/plugin install mr-reviewer@iluminr-plugins
```

**Manual install:** Download [mr-reviewer-v2.0.0.plugin](./plugins/mr-reviewer/dist/mr-reviewer-v2.0.0.plugin) and double-click to install.

---

## Adding a New Plugin

1. Create `plugins/your-plugin-name/` with the plugin source files
2. Add a `.claude-plugin/plugin.json` manifest inside it
3. Add an entry to `.claude-plugin/marketplace.json` pointing to `"./plugins/your-plugin-name"`
4. Submit a PR

## Releasing a New Version

1. Update plugin source under `plugins/your-plugin/`
2. Bump `version` in `plugins/your-plugin/.claude-plugin/plugin.json`
3. Update `CHANGELOG.md`
4. Commit and push — Cowork picks up the new version automatically via the commit SHA

> **Note:** No need to rebuild a `.plugin` zip for marketplace releases. Cowork installs directly from this git repo. The `dist/` zip is only for users who prefer manual installation.
