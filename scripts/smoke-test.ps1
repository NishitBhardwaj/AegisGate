$ErrorActionPreference = "Stop"

if (-not $env:AEGIS_API_KEY) {
    throw "AEGIS_API_KEY must be configured before testing."
}

$authHeaders = @{
    "X-API-Key" = $env:AEGIS_API_KEY
}

$direct = Invoke-RestMethod "http://127.0.0.1:3001/products"
$proxied = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/catalog/products" -Headers $authHeaders
$filtered = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/catalog/products?category=books" -Headers $authHeaders
$product = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/catalog/products/1" -Headers $authHeaders
$health = Invoke-RestMethod "http://127.0.0.1:8080/health/live"

if ($direct.count -ne 3) {
    throw "Direct catalog test failed"
}

if ($proxied.count -ne $direct.count) {
    throw "Proxy product count mismatch"
}

if ($proxied.service -ne "catalog-service") {
    throw "Gateway did not return the upstream identity"
}

if ($filtered.count -ne 1 -or $filtered.products[0].category -ne "books") {
    throw "Query forwarding failed"
}

if ($product.product.id -ne "1") {
    throw "Product ID forwarding failed"
}

if ($health.status -ne "ok") {
    throw "Gateway health test failed"
}

Write-Output "PASS: All Step 3 smoke checks passed"
