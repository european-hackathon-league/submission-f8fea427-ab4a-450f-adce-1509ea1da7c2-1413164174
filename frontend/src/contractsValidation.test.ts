import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schemas from "../fixtures/schemas.json";
import scenarios from "../fixtures/scenarios.json";
import openapi from "../fixtures/openapi.json";
import fixtures from "../fixtures/frontend-synthetic.json";

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validate = (schema: object, value: unknown) => {
  const check = ajv.compile(schema);
  expect(check(value), ajv.errorsText(check.errors)).toBe(true);
};
const defs = JSON.parse(JSON.stringify(openapi.components.schemas).replaceAll("#/components/schemas/", "#/$defs/"));
function wire(name: string, value: unknown) { validate({ $ref: `#/$defs/${name}`, $defs: defs }, value); }

describe("pinned published contracts", () => {
  for (const [name, scenario] of Object.entries(scenarios)) {
    it(`${name}: every shared scenario payload validates without coercion`, () => {
      for (const [type, payload] of Object.entries(scenario.payloads)) validate(schemas[type as keyof typeof schemas], payload);
    });
  }
  it("frontend synthetic fixtures validate against actual published schemas", () => {
    fixtures.vehicles.forEach(value => wire("Vehicle", value));
    wire("FindingsPage", fixtures.findings);
    wire("Graph", fixtures.graph);
    wire("Proposals", fixtures.proposals);
    fixtures.evidence.forEach(value => wire("Evidence", value));
    fixtures.research.forEach(value => wire("Research", value));
  });
});
