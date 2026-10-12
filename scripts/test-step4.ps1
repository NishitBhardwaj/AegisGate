$ErrorActionPreference = "Stop"

Write-Host "--- Test 4: Create order through gateway ---"
$body = @{
    product_id = "1"
    quantity = 2
} | ConvertTo-Json

$order = Invoke-RestMethod `
    -Uri "http://127.0.0.1:8080/api/orders/orders" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body

Write-Output ($order | ConvertTo-Json)

Write-Host "`n--- Test 5: Retrieve the created order ---"
$retrieved = Invoke-RestMethod "http://127.0.0.1:8080/api/orders/orders/$($order.id)"
Write-Output ($retrieved | ConvertTo-Json)

Write-Host "`n--- Test 6: Input validation on invalid order ---"
$invalidBody = @{
    product_id = "1"
    quantity = -5
} | ConvertTo-Json

try {
    Invoke-WebRequest `
      -Uri "http://127.0.0.1:8080/api/orders/orders" `
      -Method Post `
      -ContentType "application/json" `
      -Body $invalidBody `
      -ErrorAction Stop
} catch {
    $statusCode = [int]$_.Exception.Response.StatusCode
    Write-Output "Status: $statusCode (Expected: 422 Unprocessable Entity)"
}
