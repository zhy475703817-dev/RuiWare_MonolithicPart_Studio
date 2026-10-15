# Local development and GitHub synchronization

- Work in this D-drive checkout and preserve existing files, databases and user changes.
- Personal work belongs on `en888-jpg`; never push to `master` or force-push.
- User requested synchronization of completed code changes and the eight component deliverables.
- After finishing a requested implementation, inspect the diff for secrets/unrelated changes, run relevant checks, then run `scripts/sync-github.ps1` to export/checksum component packages, commit and push. Do not upload incomplete or failed changes automatically. Report any push failure honestly.
- If unrelated edits are present, review and obtain direction before including them in a later automatic synchronization.
- Never commit credentials, material/platform databases, runtime environments, caches, logs, local backups or private conversation history.
- Do not add a background file watcher that publishes individual saves. Synchronization occurs after a verified work batch, or when the user explicitly runs `sync-github.bat`.
