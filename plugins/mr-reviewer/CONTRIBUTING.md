# Contributing to mr-reviewer

## Development setup

1. Clone this repo
2. Edit files under `servers/`
3. Test by installing the plugin in Cowork (zip the directory as a `.plugin` file)

## Adding a new provider

1. Create `servers/providers/your-provider.js` implementing these exports:
   - `name` (string)
   - `prTerm` ('PR' or 'MR')
   - `listPRs(apiBase, pat, projectId, perPage)`
   - `getDiffs(apiBase, pat, projectId, prNumber, perPage)`
   - `getFile(apiBase, pat, projectId, filePath, ref)`
   - `postComment(apiBase, pat, projectId, prNumber, body)`
   - `normalisePR(rawPR)` → common shape
   - `normaliseDiff(rawDiff)` → `{ new_path, old_path, diff, new_file, deleted_file }`
2. Register in `servers/mcp-server.js`: `const providers = { ..., yourprovider: require('./providers/your-provider') };`
3. Add a tab to the dashboard setup screen

## Team guidelines

Point the plugin at a repo with these files:
- `AGENTS.frontend.md` — rules for frontend projects
- `AGENTS.backend.md` — rules for backend projects

The plugin auto-selects based on project name and changed file paths.

### Project-level overrides

Add `CLAUDE.md` to the root of any project. Sections with the same `##` heading as the shared guidelines will override them for that project. Unique sections are appended.

### Updating shared guidelines

Open a PR in your guidelines repo. Changes propagate to all reviews within 1 hour (cache TTL). To force refresh: say `refresh guidelines` in Cowork chat.

## Building a release

```bash
cd mr-reviewer
zip -r ../mr-reviewer-vX.Y.Z.plugin . --exclude "*.git*"
```

## License

MIT
