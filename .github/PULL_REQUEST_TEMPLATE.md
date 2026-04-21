## Summary
Briefly describe what this PR changes and why.

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Documentation only
- [ ] Build / CI / deploy tooling

## Areas touched
<!-- Tick all that apply -->
- [ ] Backend API (FastAPI routes / schemas / store)
- [ ] Backend infrastructure (auth, DB session, encryption, SSH)
- [ ] Frontend pages / components
- [ ] Frontend i18n strings
- [ ] Database schema (ORM model + migration SQL)
- [ ] Deploy scripts (`deploy/`)

## How to test
1. ...
2. ...

## Checklist
- [ ] Code comments and docstrings are in **English**.
- [ ] User-facing UI strings are added to BOTH `frontend/src/i18n/locales/en.json` and `it.json`.
- [ ] If the DB schema changed, a migration SQL was added under
      `deploy/migrations/` and `create_app_tables()` works on a fresh DB.
- [ ] No secrets, real IPs, or production hostnames in the diff.
- [ ] CI is green (backend import + frontend build).

## Contribution licence
By submitting this PR you confirm that:
- You wrote the code yourself (or received the right to submit it under
  the same terms).
- You agree that your contribution becomes part of ArkManiaGest under
  the [ArkManiaGest Source-Available License v1.0](../LICENSE) and that
  copyright is assigned to **Lomatek / ArkMania.it** for the purposes
  of relicensing or commercial use.
