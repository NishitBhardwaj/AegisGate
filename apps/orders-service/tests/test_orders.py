from fastapi.testclient import TestClient
from app.main import app, orders

client = TestClient(app)

def setup_function():
    orders.clear()

def test_health():
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_create_and_get_order():
    response = client.post(
        "/orders", json={"product_id": "1", "quantity": 2}
    )
    assert response.status_code == 201
    order = response.json()
    result = client.get(f"/orders/{order['id']}")
    assert result.status_code == 200
    assert result.json()["quantity"] == 2

def test_invalid_quantity():
    response = client.post(
        "/orders", json={"product_id": "1", "quantity": -1}
    )
    assert response.status_code == 422

def test_missing_order():
    response = client.get("/orders/nonexistent")
    assert response.status_code == 404
