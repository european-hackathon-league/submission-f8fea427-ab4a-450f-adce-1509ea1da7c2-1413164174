from app.proposals import score
from app.wire import Factors


def test_scoring_is_deterministic_normalized_and_preserves_unknowns():
    factors = Factors(impact=5, breadth=5, gap=5, future_relevance=5, rationales={})
    assert score(factors) == 100
    factors.gap = None
    assert score(factors) is None
    assert (
        score(Factors(impact=1, breadth=2, gap=3, future_relevance=4, rationales={}))
        == 45
    )
