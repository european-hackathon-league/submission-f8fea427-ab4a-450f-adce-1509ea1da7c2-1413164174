from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_shell_without_claiming_dependency_readiness():
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "alive", "contract_version": "1"}
    assert response.headers["X-Request-ID"]


def test_pending_operation_has_contract_and_explicit_failure():
    response = TestClient(app).get("/api/v1/runs/synthetic/proposals")
    assert response.status_code == 501
    assert response.json()["code"] == "not_implemented"
    schema = app.openapi()
    assert "/api/v1/runs/{run_id}/exports" in schema["paths"]
    assert "Idempotency-Key" in str(schema["paths"]["/api/v1/runs"]["post"])
