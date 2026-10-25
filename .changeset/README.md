# Changesets

This repository uses [Changesets](https://github.com/changesets/changesets) for version management and automated changelogs.

## Adding a Changeset
Whenever you make changes to public APIs, run:
```bash
npx changeset
```
Follow the interactive prompt to specify the bump level (`patch`, `minor`, `major`) and enter a descriptive summary conforming to Conventional Commits.
