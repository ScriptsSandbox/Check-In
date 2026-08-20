# Google Apps Script recovery

This repository stores safe Clasp templates, not account credentials.

## Reconnect a local checkout

1. Sign in with the UCSD-owned deployment account using `clasp login`.
2. In the applicable Apps Script folder, copy `.clasp.json.example` to `.clasp.json`.
3. Replace the placeholder with the script ID recorded in the restricted UCSD deployment inventory.
4. Run `clasp status`, then pull or push only after verifying the target project name and deployment record.

The active `.clasp.json` files are intentionally ignored by Git. They contain project mappings rather than OAuth tokens, but keeping the real mapping in the restricted inventory makes accidental cross-project deployment less likely.

## Never copy or commit

- `~/.clasprc.json` or any other Clasp OAuth/session file
- Apps Script properties, including database IDs, DocuSign tokens, waiver template IDs, or FabMan API keys
- Pi environment files, API keys, card data, or local credential files

Do not back up OAuth session files. A successor should authenticate independently with the institutional account. Keep secret values in their managed production systems and record only their names, owners, and recovery locations in the restricted inventory.

## Production deployment rule

Use `clasp push` for source and create a numbered Apps Script version. Update the existing production web-app deployment through **Deploy → Manage deployments**. Do not create a replacement production deployment unless the existing deployment is unrecoverable; preserving the deployment keeps public URLs and integrations stable.
