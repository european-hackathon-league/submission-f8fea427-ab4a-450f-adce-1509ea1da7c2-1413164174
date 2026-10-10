from concurrent.futures import ThreadPoolExecutor

from test_ingestion_cache import frozen_run

from app.artifacts import put_stage
from app.research import reserve_call


def test_shared_budget_is_reserved_atomically_for_concurrent_calls(client):
    from datetime import UTC, datetime

    run_id, generation, _, _ = frozen_run(client)
    put_stage(
        run_id,
        generation,
        "research_budget",
        {"deadline": datetime.now(UTC).timestamp() + 60},
    )
    from app.artifacts import get_stage

    policy = get_stage(run_id, generation, "configuration")
    assert policy is not None
    tokens = policy["research_max_tokens"]
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                lambda index: reserve_call(
                    run_id, generation, f"test-budget:{index}", tokens, search=True
                ),
                range(2),
            )
        )
    assert sorted(results) == [False, True]
    assert not reserve_call(run_id, generation, "test-budget:later", 1)
