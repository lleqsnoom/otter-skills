# Worked walkthrough

Two stages, a CI secret and an irreversible action. Generated output, not a template — copy the shape.

```bash
#!/usr/bin/env bash
set -euo pipefail
# ... the template library above the STAGES marker, unchanged ...

TOTAL_STAGES=2

stage "Create the deploy key in the vendor dashboard"
open_url "https://dashboard.vendor.com/settings/keys"
step "click New deploy key, name it otter-skills-staging"
step "copy the key the dashboard shows"
ask_secret "paste the deploy key" DEPLOY_KEY
set_secret ".env" VENDOR_DEPLOY_KEY "$DEPLOY_KEY"
summary "VENDOR_DEPLOY_KEY captured in .env"

stage "Rotate the CI secret"
open_url "https://github.com/<org>/<repo>/settings/secrets/actions"
step "open VENDOR_DEPLOY_KEY under Repository secrets and paste the same value"
pause
if confirm "Delete the old key shown on the vendor page? This is irreversible."; then
  step "delete it in the dashboard now"
  pause
else
  say "  Skipping rotation — the old key stays valid."
fi
summary "CI secret matches .env"
```

What makes it work:

- Every captured value traces: the key comes from the dashboard page the script opened, lands in `.env`
  **and** in the CI secret, and both names match the `secrets.*` references in the workflow.
- The irreversible action sits behind `confirm`, after the reversible steps, with an out.
- Each stage is one focused task; the screen never scrolls past the current step.
