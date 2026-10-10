import data from "../../fixtures/frontend-synthetic.json";
import type * as Wire from "./wire";
import * as normalize from "./normalize";
// Contract-valid, synthetic wire responses. Both transports use the same projection.
export const wireFixtures = data as unknown as {
  vehicles: Wire.Vehicle[];
  findings: Wire.FindingsPage;
  evidence: Wire.Evidence[];
  proposals: Wire.Proposals;
  research: Wire.Research[];
  graph: Wire.Graph;
};
export const vehicles = wireFixtures.vehicles.map(normalize.vehicle);
export const findings = wireFixtures.findings.items.map(normalize.finding);
export const evidence = wireFixtures.evidence.map(normalize.evidence);
export const research = wireFixtures.research.map(normalize.research);
export const proposals = normalize.proposals(wireFixtures.proposals);
export const graph = normalize.graph(wireFixtures.graph);
