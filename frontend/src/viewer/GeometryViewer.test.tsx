import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import GeometryViewer from "./GeometryViewer";
it("withholds an unbound model and keeps evidence controls accessible", () => {
  render(<GeometryViewer api={{ mode: "real" } as never} url="/model.glb" catalog={null} markers={[{ id: "change-1", partId: "seats", label: "Wider seats", number: 1 }]} onMarker={() => {}} />);
  expect(screen.getByRole("alert")).toHaveTextContent("verified part catalog");
  expect(screen.getByRole("button", { name: "1. Wider seats" })).toBeEnabled();
});
