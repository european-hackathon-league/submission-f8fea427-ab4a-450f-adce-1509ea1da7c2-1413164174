import { describe, expect, it } from "vitest";
import * as mapping from "./modelMapping";
import { componentForNodeName, componentHeatColor } from "./modelMapping";
import sceneCatalog from "../../public/vehicles/scene-catalog-v1.json";

describe("vehicle model mapping", () => {
  it("leaves plausible but unverified mesh aliases unmapped", () => {
    expect(componentForNodeName("body")).toBeNull();
    expect(componentForNodeName("Body_Panels")).toBeNull();
    expect(componentForNodeName("Cockpit_Steering_Wheel")).toBeNull();
    expect(componentForNodeName("headlamps")).toBeNull();
    expect(componentForNodeName("unknown_mesh")).toBeNull();
  });
  it("uses supplied negative-volume intensity even when negative share is low", () => {
    expect(
      componentHeatColor({
        id: "body",
        counts: {
          negative_records: 100,
          total_records: 10000,
          negative_share: 1,
          intensity_value: 0.8,
          intensity_scale_id: "volume-v1",
          low_evidence: false,
          provisional: false,
        },
      }),
    ).toBe("color-mix(in srgb, #b62e3c 80%, #e9dfe0)");
    expect(componentHeatColor(undefined)).toBe("#8a909b");
  });
});

const validCatalog=():mapping.SceneCatalog=>({ ...sceneCatalog,baseline_asset:{...sceneCatalog.baseline_asset,type:"sketchfab"},interior_reference:{...sceneCatalog.interior_reference,type:"reference_photo"},contract_version:"1",part_catalog_version:"test-parts-v1",parts:[
  {part_id:"body",parent_part_id:null,mesh_refs:["verified-body-node"],anchor_ref:null,capabilities:["list_annotation","mesh_selection"]},
] });
function validate(value:unknown){
  expect(mapping.validateSceneCatalog).toBeTypeOf("function");
  return mapping.validateSceneCatalog(value);
}
describe("scene catalog validation",()=>{
  it("publishes a complete hierarchy and honest annotation-only mappings",()=>{
    expect(validate(sceneCatalog).part_catalog_version).toBe("g60-parts-v1");
    expect(sceneCatalog.parts.every(part=>part.mesh_refs.length===0&&part.anchor_ref===null)).toBe(true);
  });
  it("selects only exact declared mesh references and never coerces unknown semantic IDs",()=>{
    const catalog=validate(validCatalog());
    expect(componentForNodeName("verified-body-node",catalog)).toBe("body");
    expect(componentForNodeName("VERIFIED-BODY-NODE",catalog)).toBeNull();
    catalog.parts[0].part_id="part_seat";
    expect(componentForNodeName("verified-body-node",catalog)).toBeNull();
  });
  it.each([
    ["duplicate IDs",[{part_id:"body",parent_part_id:null},{part_id:"body",parent_part_id:null}]],
    ["missing parent",[{part_id:"body",parent_part_id:"absent"}]],
    ["parent cycle",[{part_id:"body",parent_part_id:"cabin"},{part_id:"cabin",parent_part_id:"body"}]],
    ["self cycle",[{part_id:"body",parent_part_id:"body"}]],
  ])("rejects %s before using mappings",(_name,parts)=>{
    const catalog=validCatalog();
    catalog.parts=parts.map(part=>({...part,mesh_refs:[],anchor_ref:null,capabilities:["list_annotation"]}));
    expect(()=>validate(catalog)).toThrow(/part|parent/i);
  });
  it("rejects ambiguous meshes and unsupported capability claims",()=>{
    const catalog=validCatalog();
    catalog.parts.push({...catalog.parts[0],part_id:"seats"});
    expect(()=>validate(catalog)).toThrow(/mesh/i);
    catalog.parts=[{...catalog.parts[0],mesh_refs:[]}];
    expect(()=>validate(catalog)).toThrow(/capabilit|mesh/i);
    catalog.parts=[{...catalog.parts[0],capabilities:["geometry_modification"]}];
    expect(()=>validate(catalog)).toThrow(/capabilit/i);
  });
  it("requires a bounded photo coordinate for photo annotation capability",()=>{
    const catalog=validCatalog();
    catalog.parts=[{...catalog.parts[0],mesh_refs:[],capabilities:["photo_annotation"]}];
    expect(()=>validate(catalog)).toThrow(/photo|anchor/i);
    const photo={...catalog.parts[0],reference_photo_anchor:[.5,1.1]};
    expect(()=>validate({...catalog,parts:[photo]})).toThrow(/photo|anchor/i);
    expect(validate({...catalog,parts:[{...photo,reference_photo_anchor:[.5,.7]}]}).parts[0].part_id).toBe("body");
  });
});
describe('catalog asset reference safety',()=>{
 it.each(['javascript:alert(1)','data:image/svg+xml,test','https://user:secret@example.test/asset','//foreign.example/asset','/\\foreign.example/asset'])('rejects unsafe asset reference %s',url=>{
  const catalog=validCatalog();catalog.baseline_asset.preview_url=url;expect(()=>mapping.validateSceneCatalog(catalog)).toThrow(/asset|reference/i);
  catalog.baseline_asset.preview_url=sceneCatalog.baseline_asset.preview_url;catalog.interior_reference.url=url;expect(()=>mapping.validateSceneCatalog(catalog)).toThrow(/asset|reference/i);
 });
 it('requires baseline and cabin references to have distinct asset identities',()=>{
  const catalog=validCatalog();catalog.interior_reference.asset_id=catalog.baseline_asset_id;expect(()=>mapping.validateSceneCatalog(catalog)).toThrow(/asset|reference/i);
 });
});
