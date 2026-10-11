import { test, expect, type Page, type Locator } from "@playwright/test";
const runId = process.env.LIVE_REIMAGINE_RUN_ID;
const token = process.env.LIVE_REIMAGINE_TOKEN;
const workspace = process.env.LIVE_REIMAGINE_WORKSPACE;
async function connect(page: Page) {
  await page.getByLabel("Workspace ID", { exact: true }).fill(workspace!);
  await page.getByLabel("API access token", { exact: true }).fill(token!);
  await page.getByRole("button", { name: "Connect to API", exact: true }).click();
}
async function openComparison(page: Page, timeout = 180_000) {
  const details = page.locator(".render-model-preview").last();
  await expect(details).toBeVisible({ timeout });
  if (await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
  return page.getByRole("region", { name: "Editable vehicle model" }).last();
}
async function inspectFeedback(viewer: Locator) {
  await viewer.locator(".geometry-tools > summary").click();
  await viewer.getByRole("button", { name: "Inspect mapped parts", exact: true }).click();
  const feedback = viewer.locator(".geometry-feedback");
  if (await feedback.getAttribute("open") === null) await feedback.locator(":scope > summary").click();
}

test.afterEach(async ({ page }, info) => {
  if (page.isClosed()) return;
  const saved = await page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).filter(key => key.startsWith("vehicle-workspace:") || key.startsWith("vehicle-renders:")).map(key => [key, JSON.parse(sessionStorage.getItem(key)!)])));
  await info.attach("run-and-job", { body: JSON.stringify(saved), contentType: "application/json" });
  console.log("Saved run/job recovery metadata", JSON.stringify(saved));
});
test("save an explicit design assumption and mark earlier results stale", async ({ page }, info) => {
  test.skip(process.env.LIVE_REIMAGINE_ALLOW_EDIT !== "1" || !runId || !token || !workspace || !process.env.LIVE_REIMAGINE_RETRY_REQUEST_ID, "Explicit authorization to edit this saved proposal required; no provider job submitted.");
  const requestId = process.env.LIVE_REIMAGINE_RETRY_REQUEST_ID!;
  const response = await page.request.get(`/api/v1/runs/${runId}/renders/${requestId}`, { headers: { Authorization: `Bearer ${token}`, "X-Workspace-ID": workspace! } });
  expect(response.ok()).toBeTruthy(); const result = await response.json();
  await page.addInitScript(({ namespace, run, request, result }) => {
    const sessionKey = `vehicle-workspace:${namespace}`;
    if (!sessionStorage.getItem(sessionKey)) sessionStorage.setItem(sessionKey, JSON.stringify({ runId: run, tab: "Proposals", selectedFindingId: null, selectedComponent: "", view: "exterior", variantId: result.variant_ids[0], ideaDraft: "", proposalDrafts: [] }));
    const key = `vehicle-renders:${JSON.stringify([namespace, run])}`;
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify([{ localId: request, requestId: request, binding: { runId: run, proposalVersion: result.proposal_set_version, variantIds: result.variant_ids, baselineAssetId: result.baseline_asset_id, partCatalogVersion: result.part_catalog_version }, submission: null }]));
  }, { namespace: `/api/v1|${workspace}`, run: runId!, request: requestId, result });
  await page.goto("/#workspace"); await connect(page);
  await page.getByText("Edit suggestions & variants", { exact: true }).click();
  const interpretation = "Design assumption for visualization only: widen the mapped representative driver front seat by 10% along verified local width axis Y; retain length and height; this is not validated comfort or engineering improvement.";
  if (await page.getByText("Saved proposal version 2", { exact: true }).count()) {
    await expect(page.getByRole("textbox", { name: "Proposal text", exact: true })).toHaveValue(interpretation);
  } else {
    await expect(page.getByText("Saved proposal version 1", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Proposal text", exact: true }).fill(interpretation);
    await page.getByRole("combobox", { name: "More review views", exact: true }).selectOption("Renders");
    await expect(page.getByRole("button", { name: "Reimagine", exact: true })).toBeDisabled();
    await expect(page.getByText("Save or discard unsaved edits before Reimagine.", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("unsaved-guard.png"), fullPage: true });
    await page.getByRole("tab", { name: "Suggestions", exact: true }).click();
    await page.getByText("Edit suggestions & variants", { exact: true }).click();
    await page.getByRole("button", { name: "Save edit", exact: true }).click();
  }
  await expect(page.getByText("Saved proposal version 2", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("combobox", { name: "More review views", exact: true }).selectOption("Renders");
  await expect(page.getByRole("button", { name: "Reimagine", exact: true })).toBeEnabled();
  await expect(page.getByText(/Older render or earlier attempt: proposal version/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("stale-version-one.png"), fullPage: true });
});
test("retry one existing failed job, compare result, and recover", async ({ page }, info) => {
  const requestId = process.env.LIVE_REIMAGINE_RETRY_REQUEST_ID;
  test.skip(process.env.LIVE_REIMAGINE_ALLOW_SUBMIT !== "1" || !requestId || !runId || !token || !workspace, "Explicit bounded authorization and an existing failed job required; does not create new feedback or analysis.");
  test.setTimeout(300_000);
  const response = await page.request.get(`/api/v1/runs/${runId}/renders/${requestId}`, { headers: { Authorization: `Bearer ${token}`, "X-Workspace-ID": workspace! } });
  expect(response.ok()).toBeTruthy(); const result = await response.json();
  expect(result.status).toBe("failed");
  const namespace = `/api/v1|${workspace}`;
  await page.addInitScript(({ namespace, run, previous, result }) => {
    sessionStorage.setItem(`vehicle-workspace:${namespace}`, JSON.stringify({ runId: run, tab: "Renders", selectedFindingId: null, selectedComponent: "", view: "exterior", variantId: result.variant_ids[0], ideaDraft: "", proposalDrafts: [] }));
    const key = `vehicle-renders:${JSON.stringify([namespace, run])}`;
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify([{ localId: previous, requestId: previous, binding: { runId: run, proposalVersion: result.proposal_set_version, variantIds: result.variant_ids, baselineAssetId: result.baseline_asset_id, partCatalogVersion: result.part_catalog_version }, submission: null }]));
  }, { namespace, run: runId!, previous: requestId!, result });
  await page.goto("/#workspace"); await connect(page);
  await page.getByRole("button", { name: `Retry render ${requestId}`, exact: true }).click();
  const viewer = await openComparison(page);
  await expect(viewer.getByText("Reimagined model loaded.", { exact: true })).toBeVisible({ timeout: 180_000 });
  await inspectFeedback(viewer);
  await viewer.getByRole("group", { name: "Model feedback and change explanations" }).getByRole("button").first().click();
  await expect(viewer.locator(".geometry-tag").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Supporting proposal evidence", exact: true }).getByRole("button", { name: /^Open source / }).first()).toBeEnabled();
  await viewer.screenshot({ path: info.outputPath("reimagined-retry.png") });
  await viewer.getByRole("button", { name: "Original", exact: true }).click();
  await expect(viewer.getByText("Original model loaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await viewer.screenshot({ path: info.outputPath("original-matching-camera.png") });
  await viewer.getByRole("button", { name: "Reimagined", exact: true }).click();
  await expect(viewer.getByText("Reimagined model loaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.reload(); await connect(page);
  await expect((await openComparison(page)).getByText("Reimagined model loaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
});
test("Reimagine an existing saved design interpretation and recover", async ({ page }, info) => {
  const recoverId = process.env.LIVE_REIMAGINE_RESULT_REQUEST_ID;
  test.skip((!recoverId && (process.env.LIVE_REIMAGINE_EXISTING_SUBMIT !== "1" || process.env.LIVE_REIMAGINE_ALLOW_SUBMIT !== "1")) || !runId || !token || !workspace, "An existing result ID or explicit bounded new job authorization required; no new analysis.");
  test.setTimeout(720_000);
  if (recoverId) {
    const response = await page.request.get(`/api/v1/runs/${runId}/renders/${recoverId}`, { headers: { Authorization: `Bearer ${token}`, "X-Workspace-ID": workspace! } });
    expect(response.ok()).toBeTruthy(); const result = await response.json();
    await page.addInitScript(({ namespace, run, request, result }) => {
      const key = `vehicle-renders:${JSON.stringify([namespace, run])}`;
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify([{ localId: request, requestId: request, binding: { runId: run, proposalVersion: result.proposal_set_version, variantIds: result.variant_ids, baselineAssetId: result.baseline_asset_id, partCatalogVersion: result.part_catalog_version }, submission: null }]));
    }, { namespace: `/api/v1|${workspace}`, run: runId!, request: recoverId, result });
  }
  await page.addInitScript(({ namespace, run }) => sessionStorage.setItem(`vehicle-workspace:${namespace}`, JSON.stringify({ runId: run, tab: "Renders", selectedFindingId: null, selectedComponent: "", view: "exterior", variantId: "", ideaDraft: "", proposalDrafts: [] })), { namespace: `/api/v1|${workspace}`, run: runId! });
  await page.goto("/#workspace"); await connect(page);
  await expect(page.getByText("Saved proposal version 2", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "More review views", exact: true }).selectOption("Renders");
  const action = page.getByRole("button", { name: "Reimagine", exact: true });
  if (!recoverId) { await expect(action).toBeEnabled(); await action.click(); }
  await expect(page.getByRole("region", { name: "Visualization" }).getByRole("button", { name: "Reimagine", exact: true })).toBeDisabled();
  const viewer = await openComparison(page, 650_000);
  await expect(viewer.getByText("Reimagined model loaded.", { exact: true })).toBeVisible({ timeout: 650_000 });
  await inspectFeedback(viewer);
  await viewer.getByRole("group", { name: "Model feedback and change explanations" }).getByRole("button").first().click();
  await expect(viewer.locator(".geometry-tag").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Supporting proposal evidence", exact: true }).getByRole("button", { name: /^Open source / }).first()).toBeEnabled();
  await viewer.screenshot({ path: info.outputPath("reimagined.png") });
  await page.screenshot({ path: info.outputPath("result-with-evidence.png"), fullPage: true });
  await viewer.getByRole("button", { name: "Original", exact: true }).click();
  await expect(viewer.getByText("Original model loaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await viewer.screenshot({ path: info.outputPath("original-matching-camera.png") });
  await viewer.getByRole("button", { name: "Reimagined", exact: true }).click();
  await expect(viewer.getByText("Reimagined model loaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.reload(); await connect(page);
  await expect((await openComparison(page)).getByText("Reimagined model loaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
});
test("verified original GLB loads, rotates, and recovers after reconnect", async ({ page }, info) => {
  test.skip(!runId || !token || !workspace, "Opt-in existing run, workspace, and credential required; this test never submits analysis or provider jobs.");
  await page.addInitScript(({ key, id }) => {
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({ runId: id, tab: "Proposals", selectedFindingId: null, selectedComponent: "", view: "exterior", variantId: "", ideaDraft: "", proposalDrafts: [] }));
  }, { key: `vehicle-workspace:/api/v1|${workspace}`, id: runId! });
  await page.goto("/#workspace"); await connect(page);
  await expect(page.getByText(/Saved proposal version/)).toBeVisible({ timeout: 60_000 });
  const viewer = page.getByRole("region", { name: "Editable vehicle model" }).first();
  await expect(viewer.getByText("Original model loaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(viewer.locator("canvas")).toBeVisible();
  await viewer.screenshot({ path: info.outputPath("original.png") });
  await viewer.getByRole("button", { name: "Rotate left", exact: true }).click();
  await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
  await viewer.screenshot({ path: info.outputPath("rotated.png") });
  await inspectFeedback(viewer);
  await viewer.getByRole("group", { name: "Model feedback and change explanations" }).getByRole("button").first().click();
  await expect(viewer.locator(".geometry-tag").first()).toBeVisible();
  await viewer.screenshot({ path: info.outputPath("interior-tags.png") });
  await viewer.getByRole("button", { name: "Frame vehicle", exact: true }).click();
  const before = await viewer.locator(".geometry-lines line").first().getAttribute("x1");
  await viewer.getByRole("button", { name: "Rotate left", exact: true }).click();
  await expect.poll(() => viewer.locator(".geometry-lines line").first().getAttribute("x1")).not.toBe(before);
  await page.reload(); await connect(page);
  await expect(page.getByRole("region", { name: "Editable vehicle model" }).first().getByText("Original model loaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
});
test("unsupported request keeps the original and customer evidence available", async ({ page }, info) => {
  const requestId = process.env.LIVE_REIMAGINE_FAILURE_REQUEST_ID;
  test.skip(!requestId || !runId || !token || !workspace, "Read-only existing unsupported result required; no provider calls.");
  const response = await page.request.get(`/api/v1/runs/${runId}/renders/${requestId}`, { headers: { Authorization: `Bearer ${token}`, "X-Workspace-ID": workspace! } });
  expect(response.ok()).toBeTruthy(); const result = await response.json();
  expect(result.outcomes.some((outcome: { outcome: string }) => outcome.outcome === "unsupported")).toBeTruthy();
  await page.addInitScript(({ namespace, run, request, result }) => {
    sessionStorage.setItem(`vehicle-workspace:${namespace}`, JSON.stringify({ runId: run, tab: "Renders", selectedFindingId: null, selectedComponent: "", view: "exterior", variantId: result.variant_ids[0], ideaDraft: "", proposalDrafts: [] }));
    const key = `vehicle-renders:${JSON.stringify([namespace, run])}`;
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify([{ localId: request, requestId: request, binding: { runId: run, proposalVersion: result.proposal_set_version, variantIds: result.variant_ids, baselineAssetId: result.baseline_asset_id, partCatalogVersion: result.part_catalog_version }, submission: null }]));
  }, { namespace: `/api/v1|${workspace}`, run: runId!, request: requestId!, result });
  await page.goto("/#workspace"); await connect(page);
  const job = page.getByRole("region", { name: `Render job ${requestId}`, exact: true });
  await expect(job.getByText("unsupported", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Editable vehicle model" })).toHaveCount(1);
  await expect(page.getByText("Original model loaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await job.getByRole("button", { name: /^Explain change 1 / }).click();
  await expect(page.getByRole("region", { name: "Supporting proposal evidence", exact: true }).getByRole("button", { name: /^Open source / }).first()).toBeEnabled();
  await page.screenshot({ path: info.outputPath("unsupported-with-original-and-evidence.png"), fullPage: true });
});
test("upload feedback, Reimagine one saved proposal, compare and recover", async ({ page }, info) => {
  test.skip(process.env.LIVE_REIMAGINE_ALLOW_SUBMIT !== "1" || !token || !workspace || !process.env.LIVE_REIMAGINE_FEEDBACK, "Explicit bounded live provider authorization and feedback path required.");
  test.setTimeout(300_000);
  await page.goto("/#workspace"); await connect(page);
  await page.getByLabel("Upload files", { exact: true }).setInputFiles(process.env.LIVE_REIMAGINE_FEEDBACK!);
  await page.getByRole("button", { name: "Start analysis", exact: true }).click();
  await expect(page.getByText(/Saved proposal version/)).toBeVisible({ timeout: 120_000 });
  await page.getByRole("combobox", { name: "More review views", exact: true }).selectOption("Renders");
  const reimagine = page.getByRole("button", { name: "Reimagine", exact: true });
  await expect(reimagine).toBeEnabled({ timeout: 120_000 });
  const original = page.getByRole("region", { name: "Editable vehicle model" }).first();
  await expect(original.getByText("Original model loaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await inspectFeedback(original);
  await original.getByRole("group", { name: "Model feedback and change explanations" }).getByRole("button").first().click();
  await expect(page.getByRole("tabpanel", { name: "Evidence", exact: true })).toBeVisible();
  await original.screenshot({ path: info.outputPath("tagged-original.png") });
  await original.getByRole("button", { name: "Rotate left", exact: true }).click();
  await original.screenshot({ path: info.outputPath("tagged-rotated.png") });
  await page.getByRole("combobox", { name: "More review views", exact: true }).selectOption("Renders");
  await reimagine.click();
  await expect(page.getByRole("tabpanel", { name: "Renders", exact: true })).toBeVisible();
  const resultViewer = await openComparison(page);
  await expect(resultViewer.getByText("Reimagined model loaded.", { exact: true })).toBeVisible({ timeout: 180_000 });
  await inspectFeedback(resultViewer);
  await resultViewer.getByRole("group", { name: "Model feedback and change explanations" }).getByRole("button").first().click();
  await resultViewer.screenshot({ path: info.outputPath("reimagined.png") });
  await resultViewer.getByRole("button", { name: "Original", exact: true }).click();
  await expect(resultViewer.getByText("Original model loaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await resultViewer.getByRole("button", { name: "Reimagined", exact: true }).click();
  await expect(resultViewer.getByText("Reimagined model loaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.reload(); await connect(page);
  await expect((await openComparison(page)).getByText("Reimagined model loaded.", { exact: true })).toBeVisible({ timeout: 60_000 });
});
