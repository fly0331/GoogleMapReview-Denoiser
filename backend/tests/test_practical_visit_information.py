import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app import main
from app.core.schemas import AnalyzeRequest, LLMABSAOutput, ReviewInput
from app.services import llm_absa


@pytest.mark.parametrize("malformed_value", [None, {}, "invalid"])
def test_malformed_visit_field_does_not_discard_other_analysis(monkeypatch, malformed_value):
    monkeypatch.setenv("MOCK_LLM", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    create = Mock(return_value=SimpleNamespace(output_text=json.dumps({
        "decision_pros": "店員很親切。",
        "decision_cons": "",
        "aspect_scores": {"service": 4},
        "practical_visit_information": malformed_value,
    })))
    monkeypatch.setattr(llm_absa.genai, "Client", lambda **kwargs: SimpleNamespace(
        interactions=SimpleNamespace(create=create),
    ))

    result = llm_absa.analyze_reviews([ReviewInput(review_id="r1", rating=5, text="店員很親切")])

    create.assert_called_once()
    assert result.decision_pros == "店員很親切。"
    assert result.aspect_scores == {"service": 4}
    assert result.practical_visit_information == []


def test_single_gemini_call_returns_only_visit_information_with_verified_sources(monkeypatch):
    monkeypatch.setenv("MOCK_LLM", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    examples = [
        ("budget", "兩人共付 NT$900", "評論提到兩人共付 NT$900。"),
        ("wait_time", "假日中午等了30分鐘", "評論提到假日中午等了30分鐘。"),
        ("reservation", "我事先電話訂位", "評論提到曾事先電話訂位。"),
        ("parking", "我們停在隔壁的收費停車場", "評論提到停在隔壁的收費停車場。"),
        ("dining_time_limit", "晚餐那次限時90分鐘", "評論提到那次晚餐限時90分鐘。"),
        ("payment", "我用現金付款", "評論提到以現金付款。"),
        ("other", "入口有三階樓梯", "評論提到入口有三階樓梯。"),
    ]
    reviews = [
        ReviewInput(review_id=category, rating=4, text=f"店員服務親切。{quote}。")
        for category, quote, _ in examples
    ]
    visit_items = [
        {
            "category": category,
            "summary": summary,
            "sources": [
                {"review_id": "unselected", "quote": quote},
                {"review_id": category, "quote": quote},
                {"review_id": category, "quote": quote},
            ],
        }
        for category, quote, summary in examples
    ] + [
        {"category": "budget", "summary": "每人付 NT$300", "sources": [{"review_id": "budget", "quote": "兩人共付 NT$900"}]},
        {"category": "wait_time", "summary": "假日中午等了30小時", "sources": [{"review_id": "wait_time", "quote": "假日中午等了30分鐘"}]},
        {"category": "parking", "summary": "有免費停車場", "sources": [{"review_id": "parking", "quote": "免費停車場"}]},
        {"category": "payment", "summary": "可刷卡", "sources": [{"review_id": "unselected", "quote": "我刷卡付款"}]},
        {"category": "unknown", "summary": "無效分類", "sources": []},
        {"category": "other", "summary": "  ", "sources": [{"review_id": "other", "quote": "入口有三階樓梯"}]},
    ]
    create = Mock(return_value=SimpleNamespace(output_text=json.dumps({
        "decision_pros": "店員服務親切。",
        "decision_cons": "",
        "pros": [{
            "aspect": "服務",
            "sentiment": "positive",
            "summary": "店員服務親切。",
            "evidence_review_ids": ["budget", "unselected"],
        }],
        "practical_visit_information": visit_items,
    })))
    monkeypatch.setattr(llm_absa.genai, "Client", lambda **kwargs: SimpleNamespace(
        interactions=SimpleNamespace(create=create),
    ))

    result = llm_absa.analyze_reviews(reviews)

    create.assert_called_once()
    schema = create.call_args.kwargs["response_format"]["schema"]
    assert "practical_visit_information" in schema["required"]
    assert set(schema["$defs"]["VisitInformationSource"]["required"]) == {"review_id", "quote"}
    assert result.decision_pros == "店員服務親切。"
    assert result.pros[0].evidence_review_ids == ["budget"]
    assert [item.model_dump() for item in result.practical_visit_information] == [
        {"category": category, "summary": summary, "evidence_review_ids": [category]}
        for category, _, summary in examples
    ]


def test_mock_visit_information_uses_input_only_and_omits_conflicts(monkeypatch):
    monkeypatch.setenv("MOCK_LLM", "true")
    gemini = Mock(side_effect=AssertionError("Mock must not call Gemini"))
    monkeypatch.setattr(llm_absa.genai, "Client", gemini)
    review = ReviewInput(review_id="r1", rating=4, text="每人約400元。週六候位等了20分鐘。等了40分鐘才出餐。")
    assert [item.summary for item in llm_absa.analyze_reviews([review]).practical_visit_information] == [
        "每人約400元", "週六候位等了20分鐘",
    ]
    conflicting = ReviewInput(review_id="r2", rating=4, text="每人約700元。")
    assert [item.category for item in llm_absa.analyze_reviews([review, conflicting]).practical_visit_information] == [
        "wait_time",
    ]
    assert llm_absa.analyze_reviews([]).practical_visit_information == []
    assert llm_absa.analyze_reviews([review.model_copy(update={"text": "餐點美味"})]).practical_visit_information == []
    gemini.assert_not_called()


@pytest.mark.parametrize(("count", "length", "expected"), [(50, 300, 50), (6, 4900, 4)])
def test_api_passes_only_budgeted_unique_nonblank_reviews(client, monkeypatch, count, length, expected):
    analyze = Mock(return_value=LLMABSAOutput(decision_pros="", decision_cons=""))
    monkeypatch.setattr(main, "analyze_reviews", analyze)
    reviews = [
        ReviewInput(review_id=f"r{index}", rating=index % 5 + 1, text="五星送小菜".ljust(length, "文"))
        for index in range(count)
    ]
    if count < 50:
        reviews.extend([reviews[0], ReviewInput(review_id="blank", rating=5, text="  ")])
    request = AnalyzeRequest(
        place_id="budget-limit",
        scraped_at="2026-11-25T00:00:00Z",
        reviews=reviews,
    )

    result = main.analyze(request)

    analyze.assert_called_once()
    (selected,) = analyze.call_args.args
    assert len({review.review_id for review in selected}) == result.analyzed_count == expected
    assert all(review.text.strip() and review.text.startswith("五星送小菜") for review in selected)
    llm_absa.validate_gemini_input(selected)
    assert result.practical_visit_information == []
