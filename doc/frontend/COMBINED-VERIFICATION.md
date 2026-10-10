# Combined frontend verification

11 October 2026. Integration preserves the user's frontend base `97b71221ecb62385f5d43632c406165c6d1da690`, including onboarding, inline evidence, draft protections and mobile controls. No backend code was changed by this integration.

Packages merge into `frontend` in dependency order: F1 #4, F2 #5, F3 #6, F4 #7, F5 #8, F6 #9. Merge commits and final clean-checkout/browser evidence are appended after the final merge.

Integration gates: F1 94 tests; F2 157; F3 225; F4 350; F5 393. Every gate passed full frontend tests, typecheck and production build, with separate review. Protected API render assets and export downloads now fetch authoritative bytes with runtime authorization, bounded cancellation, retry, exact identity guards and revocable blob URLs. Public signed links remain direct. Pointer-opened New run dialogs close before restoring focus.

The previous backend-501 statements describe the earlier inspected ref. The current merged base includes implemented backend routes; shared DTO/scenario schemas remain compatible. No backend listener was reachable on port 8000 and no backend was started. HTTP harness evidence is synthetic frontend integration evidence, not deployed analysis, research or generation acceptance. Research dates, variant limits, historical research/count content, preservation validation and unsupported vehicle assets remain the ledger's explicit external dependencies.
