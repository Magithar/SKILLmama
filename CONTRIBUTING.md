# Contributing to SKILLmama

Use Node.js 18.3 or newer and the npm version declared in the root
`package.json`:

```sh
npm ci
npm run hooks:install
```

The canonical agent implementation is `skillmama/SKILL.md`; changes to it
must keep the deterministic package behavior and conformance tests aligned.

Before opening a pull request, run:

```sh
npm run lint
npm run typecheck
npm test
npm run coverage
npm run pack:check
bash scripts/check-skill-untouched.sh
```

Include tests for new behavior and update `CHANGELOG.md` for user-visible
changes. Security reports should follow `SECURITY.md`.
