"""Bounded Responses tool loop; no Python generation and no untrusted code execution."""

import base64
import json
from pathlib import Path
from typing import Any

from app.geometry import GeometryCatalog, validate_plan
from app.wire import GeometryOperation, RenderManifest


def images(paths: list[Path]) -> list[dict[str, str]]:
    result = []
    for path in paths[:6]:
        content = path.read_bytes()
        if len(content) > 2 * 1024 * 1024:
            raise ValueError("review image exceeds bound")
        result.append(
            {
                "type": "input_image",
                "image_url": "data:image/png;base64,"
                + base64.b64encode(content).decode(),
            }
        )
    return result


def plan_geometry(
    client: Any,
    model: str,
    manifest: RenderManifest,
    catalog: GeometryCatalog,
    views: list[Path],
    *,
    max_calls: int = 4,
    previous_review: dict[str, Any] | None = None,
) -> tuple[dict[str, GeometryOperation], list[dict[str, Any]]]:
    tools = [
        {
            "type": "function",
            "name": "inspect_part",
            "description": "Read verified part dimensions, allowed operations, and exact mesh identity in metres",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {"part_id": {"type": "string"}},
                "required": ["part_id"],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "propose_resize",
            "description": "Plan a bounded targeted resize. Explicitly state the design assumption; never resize the whole car",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {
                    "change_id": {"type": "string"},
                    "part_id": {"type": "string"},
                    "dimensions_m": {
                        "type": "array",
                        "items": {"type": "number"},
                        "minItems": 3,
                        "maxItems": 3,
                    },
                    "assumption": {"type": "string"},
                },
                "required": ["change_id", "part_id", "dimensions_m", "assumption"],
                "additionalProperties": False,
            },
        },
    ]
    content = [
        {
            "type": "input_text",
            "text": json.dumps(
                {
                    "selected_saved_changes": manifest.model_dump(mode="json"),
                    "verified_catalog": catalog.model_dump(mode="json"),
                    "previous_review": previous_review,
                }
            ),
        },
        *images(views),
    ]
    conversation: list[dict[str, Any]] = [{"role": "user", "content": content}]
    plan: dict[str, GeometryOperation] = {}
    audit: list[dict[str, Any]] = []
    for _ in range(min(max_calls, 6)):
        response = client.responses.create(
            model=model,
            input=list(conversation),
            tools=tools,
            store=False,
            max_output_tokens=1200,
            instructions="Plan all selected changes together using only the allowed tools. Inspect before resizing. Customer wording is evidence, dimensions are design assumptions. Preserve constraints. Do not pretend new shapes or unsupported operations are supported. Leave ambiguous/unachievable changes unplanned. Images show only visible adherence; use measurements for dimensions. Finish after proposing necessary operations.",
        )
        conversation.extend(
            item.model_dump(mode="json", by_alias=True, exclude_none=True)
            for item in response.output
        )
        calls = [item for item in response.output if item.type == "function_call"]
        if not calls:
            audit.append(
                {
                    "response_id": response.id,
                    "model": model,
                    "tool": None,
                    "usage": response.usage.model_dump() if response.usage else None,
                }
            )
            break
        for call in calls[:8]:
            try:
                arguments = json.loads(call.arguments)
                if call.name == "inspect_part" and set(arguments) == {"part_id"}:
                    part = next(
                        (
                            part
                            for part in catalog.parts
                            if part.part_id == arguments["part_id"]
                        ),
                        None,
                    )
                    if part is None:
                        raise ValueError("unknown part identity")
                    output = part.model_dump(mode="json")
                elif call.name == "propose_resize" and set(arguments) == {
                    "change_id",
                    "part_id",
                    "dimensions_m",
                    "assumption",
                }:
                    operation = GeometryOperation(
                        operation="resize_local",
                        part_id=arguments["part_id"],
                        dimensions_m=arguments["dimensions_m"],
                    )
                    proposed = {**plan, arguments["change_id"]: operation}
                    validate_plan(
                        manifest, catalog, proposed, validate_dependencies=False
                    )
                    plan = proposed
                    output = {
                        "accepted": True,
                        "geometry_produced": False,
                        "assumption": arguments["assumption"],
                    }
                else:
                    raise ValueError("unknown tool or invalid arguments")
            except ValueError, TypeError, KeyError:
                output = {
                    "accepted": False,
                    "reason": "Invalid identity, operation, dimensions, or interacting plan",
                }
            audit.append(
                {
                    "response_id": response.id,
                    "model": model,
                    "tool": call.name,
                    "arguments": call.arguments,
                    "result": output,
                    "usage": response.usage.model_dump() if response.usage else None,
                }
            )
            conversation.append(
                {
                    "type": "function_call_output",
                    "call_id": call.call_id,
                    "output": json.dumps(output),
                }
            )
    validate_plan(manifest, catalog, plan)
    return plan, audit


def review_geometry(
    client: Any,
    model: str,
    manifest: RenderManifest,
    measurements: dict[str, Any],
    views: list[Path],
) -> dict[str, Any]:
    schema = {
        "type": "object",
        "properties": {
            "changes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "change_id": {"type": "string"},
                        "passed": {"type": "boolean"},
                        "reason": {"type": "string"},
                    },
                    "required": ["change_id", "passed", "reason"],
                    "additionalProperties": False,
                },
            },
            "unaffected_parts_preserved_visually": {"type": "boolean"},
        },
        "required": ["changes", "unaffected_parts_preserved_visually"],
        "additionalProperties": False,
    }
    response = client.responses.create(
        model=model,
        store=False,
        max_output_tokens=1200,
        instructions="Compare matching original/candidate views in supplied order. Assess visible adherence for every requested change and unintended effects on nearby/unaffected parts. Labels map stable part IDs. Exact dimensions and identity come from measurements. Do not imply engineering or safety validity. Mark uncertainty false with a reason.",
        input=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": json.dumps(
                            {
                                "manifest": manifest.model_dump(mode="json"),
                                "measurements": measurements,
                                "view_order": [path.name for path in views],
                            }
                        ),
                    },
                    *images(views),
                ],
            }
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "geometry_review",
                "schema": schema,
                "strict": True,
            }
        },
    )
    result = json.loads(response.output_text)
    expected = {change.change_id for change in manifest.changes}
    ids = [change["change_id"] for change in result["changes"]]
    if set(ids) != expected or len(ids) != len(set(ids)):
        raise ValueError("vision review identity mismatch")
    return {
        **result,
        "model": model,
        "response_id": response.id,
        "usage": response.usage.model_dump() if response.usage else None,
    }
