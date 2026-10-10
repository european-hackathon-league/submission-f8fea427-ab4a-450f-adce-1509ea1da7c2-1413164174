from app.research import relevant_excerpt


def test_research_keeps_relevant_body_and_opposition_after_navigation():
    navigation = "Home Products Company News Contact " * 40
    body = (
        "Seat comfort varies: some owners prefer firm seats, others prefer soft seats."
    )
    passage = navigation + body + " More company news." * 40
    excerpt = relevant_excerpt(passage, "Improve seat comfort on long journeys")
    assert body in excerpt
    assert excerpt in passage
    assert len(excerpt) <= 400


def test_research_without_matching_terms_keeps_existing_bounded_prefix():
    passage = "Company news and navigation. " * 40
    assert relevant_excerpt(passage, "seat comfort") == passage[:400]
