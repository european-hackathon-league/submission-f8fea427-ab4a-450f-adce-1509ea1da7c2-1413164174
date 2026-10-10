import type {
  Evidence,
  Finding,
  Graph,
  ProposalSet,
  Research,
  Vehicle,
} from "./contracts";

export const vehicles: Vehicle[] = [
  {
    vehicle_id: "g60-i5-m60",
    title: "BMW i5 M60 / G60",
    baseline_asset_id: "i5-m60-exterior-v1",
    part_catalog_version: "g60-parts-v1",
    capabilities: ["exterior_navigation", "annotations"],
  },
  {
    vehicle_id: "f70",
    title: "BMW 1 Series / F70",
    baseline_asset_id: null,
    part_catalog_version: null,
    capabilities: [],
  },
  {
    vehicle_id: "g68",
    title: "BMW 5 Series / G68",
    baseline_asset_id: null,
    part_catalog_version: null,
    capabilities: [],
  },
  {
    vehicle_id: "g70",
    title: "BMW 7 Series / G70",
    baseline_asset_id: null,
    part_catalog_version: null,
    capabilities: [],
  },
];

// Synthetic API responses, not metrics calculated by UI components.
export const findings: Finding[] = [
  {
    finding_id: "finding-dashboard",
    revision: 1,
    title: "Comfort controls",
    customer_need:
      "Reach frequent comfort functions without navigating several screens.",
    part_ids: ["dashboard"],
    cohort_ids: ["Europe"],
    supporting_evidence_ids: ["dashboard-E1"],
    opposing_evidence_ids: ["dashboard-E2"],
    counts: {
      negative_records: 172,
      total_records: 400,
      negative_share: 43,
      intensity_value: 0.75,
      intensity_scale_id: "negative-volume-v1",
      low_evidence: false,
      provisional: false,
    },
    coverage: "One regional feedback source; partial package",
    provisional: false,
    baseline: "Comfort controls in the central display",
    applicability:
      "Synthetic G60 scenario; trim and software require validation.",
  },
  {
    finding_id: "finding-body",
    revision: 1,
    title: "Trunk gesture reliability",
    customer_need: "Open the trunk consistently when carrying bags.",
    part_ids: ["body"],
    cohort_ids: ["Europe"],
    supporting_evidence_ids: ["body-E1"],
    opposing_evidence_ids: [],
    counts: {
      negative_records: 88,
      total_records: 400,
      negative_share: 22,
      intensity_value: 0.4,
      intensity_scale_id: "negative-volume-v1",
      low_evidence: false,
      provisional: true,
    },
    coverage: "Regional scope still being checked",
    provisional: true,
    baseline: "Hands-free access gesture",
    applicability: "Only vehicles equipped with hands-free access.",
  },
  {
    finding_id: "finding-unmapped",
    revision: 1,
    title: "Vehicle-wide and unmapped",
    customer_need: "Make onboarding and feature explanations easier to find.",
    part_ids: [],
    cohort_ids: ["Europe"],
    supporting_evidence_ids: ["unmapped-E1"],
    opposing_evidence_ids: [],
    counts: {
      negative_records: 3,
      total_records: 12,
      negative_share: 25,
      intensity_value: 0.1,
      intensity_scale_id: "negative-volume-v1",
      low_evidence: true,
      provisional: true,
    },
    coverage: "Small onboarding sample",
    provisional: true,
    baseline: "Vehicle-wide onboarding",
    applicability: "Digital requirement; no geometric part assignment.",
  },
];
export const evidence: Evidence[] = [
  {
    evidence_id: "dashboard-E1",
    source_version_id: "synthetic-source-v1",
    source_kind: "uploaded",
    locator: {
      type: "spreadsheet_row",
      label: "Synthetic customer study, Feedback, row 12",
    },
    scope: "Europe",
    excerpt: "Changing the climate setting should not take several screens.",
    limitations: "Synthetic feedback record; not a measured usability result.",
    source_url: null,
  },
  {
    evidence_id: "dashboard-E2",
    source_version_id: "synthetic-source-v1",
    source_kind: "uploaded",
    locator: {
      type: "spreadsheet_row",
      label: "Synthetic customer study, Feedback, row 19",
    },
    scope: "Europe",
    excerpt: "The shortcut helped once someone showed me how to set it up.",
    limitations:
      "Counterevidence: discoverability and task success may differ.",
    source_url: null,
  },
  {
    evidence_id: "body-E1",
    source_version_id: "synthetic-source-v1",
    source_kind: "uploaded",
    locator: {
      type: "spreadsheet_row",
      label: "Synthetic customer study, Feedback, row 23",
    },
    scope: "Europe",
    excerpt: "The trunk gesture only works sometimes for me.",
    limitations: "Equipment and gesture conditions are not verified.",
    source_url: null,
  },
  {
    evidence_id: "unmapped-E1",
    source_version_id: "synthetic-source-v1",
    source_kind: "uploaded",
    locator: {
      type: "spreadsheet_row",
      label: "Synthetic customer study, Feedback, row 31",
    },
    scope: "Europe",
    excerpt: "I could not find the feature explanation after delivery.",
    limitations: "Low-evidence sample.",
    source_url: null,
  },
];
export const research: Research[] = [
  {
    research_id: "research-dashboard",
    finding_id: "finding-dashboard",
    status: "partial",
    competitor_scope: "Frequent comfort controls, Europe",
    claims: [
      {
        type: "inference",
        text: "Persistent shortcuts may reduce navigation for repeated comfort tasks.",
        evidence_ids: ["dashboard-E1"],
      },
    ],
    recommendation:
      "Evaluate a persistent comfort shortcut for this vehicle before setting a validated target.",
    candidate_approaches: [
      "Persistent digital shortcut",
      "Dedicated physical control",
    ],
    counterevidence: ["The existing shortcut helps once discovered."],
    gaps: [
      "Verified competitor capability sources unavailable.",
      "Owner sample unavailable; research timeout preserved customer evidence.",
    ],
    as_of: "2026-10-10",
  },
];
export const proposals: ProposalSet = {
  proposal_set_version: 1,
  variants: [
    {
      variant_id: "variant-digital",
      title: "Persistent digital controls",
      cohort_scope: ["Europe"],
      assumptions: [
        "Software feasibility unverified; no claim of BMW approval.",
      ],
      changes: [
        {
          change_id: "change-dashboard",
          finding_id: "finding-dashboard",
          origin: "ai",
          part_ids: ["dashboard"],
          before: "Comfort functions span several screens.",
          after:
            "Keep frequent comfort controls reachable from the main display.",
          rationale:
            "Addresses navigation friction while preserving existing hardware.",
          evidence_ids: ["dashboard-E1", "dashboard-E2"],
          target: "Validate task success with representative drivers.",
          target_maturity: "proposed",
          assumptions: ["Target threshold awaits a usability study."],
          decision_state: "proposed",
        },
      ],
    },
    {
      variant_id: "variant-physical",
      title: "Dedicated comfort control",
      cohort_scope: ["Europe"],
      assumptions: ["Packaging, cost and homologation require investigation."],
      changes: [
        {
          change_id: "change-physical",
          finding_id: "finding-dashboard",
          origin: "ai",
          part_ids: ["dashboard"],
          before: "Comfort functions rely on the central display.",
          after: "Investigate a dedicated tactile comfort control.",
          rationale:
            "Provides a physical alternative with greater hardware cost.",
          evidence_ids: ["dashboard-E1"],
          target: "Compare glance time and task success against the baseline.",
          target_maturity: "proposed",
          assumptions: ["Geometry and feasibility not validated."],
          decision_state: "proposed",
        },
      ],
    },
  ],
  unresolved_conflicts: [
    "Digital flexibility versus tactile access and hardware cost.",
  ],
};
export const graph: Graph = {
  nodes: [
    {
      node_id: "dashboard-E1",
      entity_type: "evidence",
      label: "Customer feedback",
      finding_id: "finding-dashboard",
    },
    {
      node_id: "finding-dashboard",
      entity_type: "finding",
      label: "Comfort controls",
      finding_id: "finding-dashboard",
    },
    {
      node_id: "dashboard",
      entity_type: "part",
      label: "Dashboard",
      finding_id: "finding-dashboard",
    },
    {
      node_id: "change-dashboard",
      entity_type: "change",
      label: "Persistent controls",
      finding_id: "finding-dashboard",
    },
  ],
  edges: [
    {
      edge_id: "edge-1",
      from_id: "dashboard-E1",
      to_id: "finding-dashboard",
      relationship: "supports",
      provenance: "synthetic-source-v1",
    },
    {
      edge_id: "edge-2",
      from_id: "finding-dashboard",
      to_id: "dashboard",
      relationship: "affects",
      provenance: "catalog:g60-parts-v1",
    },
    {
      edge_id: "edge-3",
      from_id: "finding-dashboard",
      to_id: "change-dashboard",
      relationship: "motivates",
      provenance: "proposal-set:1",
    },
  ],
};
