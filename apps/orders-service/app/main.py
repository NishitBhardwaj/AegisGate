import asyncio
import os
from typing import Literal
from uuid import uuid4
from fastapi import FastAPI, HTTPException, Query, status
from pydantic import BaseModel, Field

app = FastAPI(
    title="AegisGate Orders Service",
    version="1.0.0"
)

class OrderCreate(BaseModel):
    product_id: str = Field(min_length=1, max_length=100)
    quantity: int = Field(ge=1, le=100)

class Order(BaseModel):
    id: str
    product_id: str
    quantity: int
    status: Literal["created"] = "created"

# Development-only in-memory storage.
# Data resets whenever the process restarts.
orders: dict[str, Order] = {}

@app.get("/health/live")
async def health_check():
    return {
        "status": "ok",
        "service": "orders-service"
    }

@app.post("/orders", status_code=status.HTTP_201_CREATED, response_model=Order)
async def create_order(payload: OrderCreate):
    order_id = str(uuid4())
    order = Order(
        id=order_id,
        product_id=payload.product_id,
        quantity=payload.quantity,
        status="created"
    )
    orders[order_id] = order
    return order

@app.get("/orders", response_model=list[Order])
async def list_orders():
    return list(orders.values())

@app.get("/orders/{order_id}", response_model=Order)
async def get_order(order_id: str):
    order = orders.get(order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "ORDER_NOT_FOUND", "message": "Order not found"}
        )
    return order

@app.get("/__test__/delay")
async def simulated_delay(seconds: float = Query(default=1.0, ge=0.0)):
    if os.getenv("AEGIS_ENABLE_TEST_ROUTES", "").strip() != "1":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test routes are disabled"
        )
    await asyncio.sleep(seconds)
    return {
        "status": "delayed",
        "seconds": seconds
    }
