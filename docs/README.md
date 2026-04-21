# docs/

External specifications and reference material used while developing
ArkManiaGest.  These files are **not deployed to production** and are
not bundled with the backend or frontend — they exist only to help
contributors understand the external APIs ArkManiaGest talks to.

## Contents

### `ServerForge_OpenAPI_Spec.json`
Captured copy of the [ServerForge](https://serverforge.cx/) public API
OpenAPI 3 specification.  ArkManiaGest uses a small subset of these
endpoints to import pre-existing SSH machines and their containers
(see `backend/app/api/routes/serverforge.py`).

Keep this file around when updating the ServerForge integration —
re-downloading the up-to-date spec is easier than re-discovering the
response shapes from scratch.

### `ServerForge_API_Analysis.md`
Human-readable walkthrough of the ServerForge endpoints ArkManiaGest
actually calls, with example payloads, quirks encountered during
integration, and pointers to the concrete code paths that consume each
endpoint.  Useful when extending the ServerForge import or diagnosing
regressions after a ServerForge-side change.

## When to update

- ServerForge rolls out a new API version  → refresh the OpenAPI JSON
  and re-read the affected endpoints in the analysis doc.
- A new third-party API is added to the backend (e.g. a new cluster
  manager)  → add its spec + analysis here, not inline in the code.
- A spec/doc becomes irrelevant to the current integration  → delete
  it rather than let it rot.
