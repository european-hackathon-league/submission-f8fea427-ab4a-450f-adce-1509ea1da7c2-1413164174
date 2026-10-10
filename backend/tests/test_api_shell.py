from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_shell_without_claiming_dependency_readiness():
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "alive", "contract_version": "1"}
    assert response.headers["X-Request-ID"]


def test_proposal_operation_has_contract_and_rejects_missing_run(client):
    response = client.get("/api/v1/runs/synthetic/proposals")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    schema = app.openapi()
    assert "/api/v1/runs/{run_id}/exports" in schema["paths"]
    assert "Idempotency-Key" in str(schema["paths"]["/api/v1/runs"]["post"])


def test_api_requires_authentication_and_server_membership(client):
    assert TestClient(app).get("/api/v1/vehicles").status_code == 401
    response = client.get(
        "/api/v1/vehicles", headers={"X-Workspace-ID": "workspace_other"}
    )
    assert response.status_code == 403


def test_frontend_cors_permits_required_workspace_and_authentication_headers(client):
    response = client.options(
        "/api/v1/uploads",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization,X-Workspace-ID,Idempotency-Key",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
