# ForkLeaf Custom

Independent static Markdown workspace, inspired by the local-first, Git-backed workflow of ForkLeaf.

## Deployment
Static site with no build step or application server. Cloudflare Pages serves `index.html` from this directory.

## Data and security
- Local notes are stored in IndexedDB in the browser.
- GitHub API requests are made directly from the browser.
- A fine-grained GitHub personal access token is stored in sessionStorage for this tab only.
- Use a token limited to one repository with **Contents: Read and write**.
- Commits to `main` and `master` are blocked in the app. The default notes branch is `forkleaf-notes`.
- No analytics, external JavaScript libraries, or third-party scripts.

## Current scope
Markdown source editing, live preview, note/folder navigation, local autosave, wikilink autocomplete, backlinks, image insertion and GitHub branch commits.

This is an initial custom implementation. The upstream ForkLeaf project has a broader feature set.
