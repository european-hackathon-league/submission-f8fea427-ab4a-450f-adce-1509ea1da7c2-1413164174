The initial lock resolved on Windows x86_64 with uv 0.13.0 and Python 3.14.8.
Linux x86_64 frozen runtime installation, PostgreSQL connectivity, and local
Temporal SDK connectivity have passed using the pinned Docker images.

Pinned package versions follow backend_execution_plan.md. Docling is a locked
`pdf` extra because API and workflow workers do not need the ML parser loaded;
the parser image compatibility check installs that extra in BE-01. The verified
parser build imports Docling 2.137.0, Torch 2.14.1+cpu, and torchvision 0.29.1
on Linux x86_64. It does not verify corpus extraction quality or download model
artifacts during requests; those are ingestion gates.

Supplied-corpus upload preflight on 2026-10-10: all three option-list PDFs were
accepted (F70: 3.639 s; G60: 3.240 s; G70: 3.809 s). After setting the PDF child
budget to fifteen CPU seconds and thirty wall seconds, the 434-page annual report
was accepted in 9.955 s using the Linux runtime with the current application bind
mount. Both formats retain the 512 MiB address-space limit; XLSX retains five CPU
seconds and ten wall seconds. The PDF defaults remain 500 pages and 8 MiB per
decoded page content stream, with an explicit 256 MiB aggregate decoded-page
content limit. These checks verify upload preflight only, not Docling extraction,
table/locator fidelity, or interpretation accuracy. No private passages were
included in the check output.

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

Live OIDC identity, selected production S3, hosted Temporal, OTLP export, and the
frontend-owned renderer remain unconfigured gates. Local integration tests use
real PostgreSQL and the persisted Temporal development server; provider and S3
contract tests use deterministic fakes. These results do not establish production
readiness.

Dependency review on 2026-10-10: `pip-audit` scanned the actual Linux runtime
`.venv` and reported no known vulnerabilities. This result reflects the advisory
database at the time of the scan and is not a security guarantee. Reviewed package
metadata is predominantly MIT, BSD, or Apache; Psycopg 3.3.6 declares
`LGPL-3.0-only`, requiring distribution-notice review before redistribution.
This records metadata, not a legal conclusion.

Parser metadata declares MIT for Docling 2.137.0, docling-core 2.101.1,
docling-parse 7.22.2, and docling-ibm-models 4.0.3. Torch CPU carries a compound
license and torchvision declares BSD. Model-weight licenses remain an S2 gate;
package license metadata does not establish permission for every model artifact.
