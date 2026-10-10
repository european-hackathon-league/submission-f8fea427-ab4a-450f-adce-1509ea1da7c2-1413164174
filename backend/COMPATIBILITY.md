The initial lock resolved on Windows x86_64 with uv 0.13.0 and Python 3.14.8.
Linux x86_64 frozen installation and service connectivity are mandatory S1 gates.

Pinned package versions follow backend_execution_plan.md. Docling is a locked
`pdf` extra because API and workflow workers do not need the ML parser loaded;
the parsing worker compatibility check must install that extra in BE-01.

Local host: Docker Engine 29.7.2, Docker Compose 5.5.1 (planned 5.6.0).
No host upgrade was performed. Persisted development Temporal uses CLI 1.9.1,
embedded Server 1.32.0, UI 2.54.1. The planned server 1.32.1 is not a CLI image
tag; the verified development CLI image is pinned by digest. This is a local
development service, not a production topology or managed-service verification.

Windows application control blocks the pytest executable and a compiled mypy
module. `uv run python -m pytest` works; run all readiness gates in the Linux
container to check the deployment platform and avoid that host restriction.

Bounded live AI connectivity: Responses request on 2026-10-10 completed using
gpt-6.1-sol, 21 input / 5 output tokens. No private data sent. This does not
verify structured extraction, web search or any other service's credentials.
