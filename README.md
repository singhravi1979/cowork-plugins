# cowork-plugins

Open-source Cowork plugins. Install via the marketplace or download individual `.plugin` files.

## Install the Marketplace

In **Cowork → Settings → Plugins → Add Marketplace**, enter:

```
https://raw.githubusercontent.com/singhravi1979/cowork-plugins/main/marketplace.json
```

Team members will see all plugins listed in their Cowork plugin browser with one-click install and automatic update notifications.

---

## Plugins

### [mr-reviewer](./plugins/mr-reviewer)

AI-powered PR/MR review assistant for **GitLab and GitHub**. Generates structured code reviews against your team's `AGENTS.md` guidelines merged with each project's `CLAUDE.md`, posts reviews as GitLab/GitHub comments, and runs on a daily schedule.

**[Download latest →](./plugins/mr-reviewer/dist/mr-reviewer-v2.0.0.plugin)**

---

## Adding a New Plugin

1. Create `plugins/your-plugin-name/` with source files
2. Add the packaged `.plugin` file to `plugins/your-plugin-name/dist/`
3. Add an entry to `marketplace.json`
4. Submit a PR

## Releasing a New Version

1. Update plugin source under `plugins/your-plugin/`
2. Bump version in `.claude-plugin/plugin.json`
3. Build: `cd plugins/your-plugin && zip -r dist/your-plugin-vX.Y.Z.plugin . --exclude "dist/*"`
4. Update `marketplace.json` version + `downloadUrl`
5. Update `CHANGELOG.md`
6. Commit and push
