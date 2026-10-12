$ErrorActionPreference = "Stop"

Set-Location "C:\Users\admin\Projects\AegisGate"

$baseUrl = "http://127.0.0.1:8080/admin/v1"
$gatewayUrl = "http://127.0.0.1:8080"

function Assert-HttpStatus {
    param(
        [scriptblock]$Action,
        [int]$Expected
    )

    $actual = $null

    try {
        $response = & $Action
        $actual = [int]$response.StatusCode
    }
    catch {
        if ($null -eq $_.Exception.Response) {
            throw
        }

        $actual = [int]$_.Exception.Response.StatusCode
    }

    if ($actual -ne $Expected) {
        throw "Expected HTTP $Expected but received $actual"
    }
}

# Generate a short-lived local administrator JWT.
$jwt = (& node ".\apps\gateway\dist\cli\issueAdminToken.js").Trim()

if ($jwt -notmatch '^eyJ') {
    throw "Could not generate administrator JWT"
}

$adminHeaders = @{
    Authorization = "Bearer $jwt"
}

Write-Host "`nTEST 1: Unauthenticated admin access"

Assert-HttpStatus {
    Invoke-WebRequest "$baseUrl/clients"
} 401

Write-Host "PASS: Unauthenticated access rejected"


Write-Host "`nTEST 2: Create API client"

$clientName = "AdminTest-$([guid]::NewGuid().ToString('N').Substring(0,8))"

$body = @{
    name = $clientName
} | ConvertTo-Json

$created = Invoke-RestMethod `
    -Uri "$baseUrl/clients" `
    -Method Post `
    -Headers $adminHeaders `
    -ContentType "application/json" `
    -Body $body

$clientId = $created.client.id

if (
    -not $clientId -or
    $created.client.status -ne "active"
) {
    throw "Client creation failed"
}

Write-Host "PASS: Client created - $clientId"


Write-Host "`nTEST 3: List registered clients"

$list = Invoke-RestMethod `
    -Uri "$baseUrl/clients?limit=100" `
    -Headers $adminHeaders

if (-not ($list.items.id -contains $clientId)) {
    throw "New client missing from listing"
}

Write-Host "PASS: Client visible in listing"


Write-Host "`nTEST 4: Issue API key"

$issued = Invoke-RestMethod `
    -Uri "$baseUrl/clients/$clientId/keys" `
    -Method Post `
    -Headers $adminHeaders

$keyId = $issued.id

if ($issued.apiKey -notmatch '^ag_dev_') {
    throw "Key issuance failed"
}

$apiHeaders = @{
    "X-API-Key" = $issued.apiKey
}

Write-Host "PASS: API key issued - $keyId"


Write-Host "`nTEST 5: Active client can access Catalog"

Assert-HttpStatus {
    Invoke-WebRequest `
        -Uri "$gatewayUrl/api/catalog/products" `
        -Headers $apiHeaders
} 200

Write-Host "PASS: Active client authenticated"


Write-Host "`nTEST 6: Suspend client"

$suspendBody = @{
    status = "suspended"
} | ConvertTo-Json

$suspended = Invoke-RestMethod `
    -Uri "$baseUrl/clients/$clientId/status" `
    -Method Patch `
    -Headers $adminHeaders `
    -ContentType "application/json" `
    -Body $suspendBody

if (
    $suspended.client.status -ne "suspended" -or
    $suspended.changed -ne $true
) {
    throw "Client suspension failed"
}

Assert-HttpStatus {
    Invoke-WebRequest `
        -Uri "$gatewayUrl/api/catalog/products" `
        -Headers $apiHeaders
} 403

Write-Host "PASS: Suspended client denied access"


Write-Host "`nTEST 7: Prevent issuing keys to suspended client"

Assert-HttpStatus {
    Invoke-WebRequest `
        -Uri "$baseUrl/clients/$clientId/keys" `
        -Method Post `
        -Headers $adminHeaders
} 403

Write-Host "PASS: Suspended client cannot receive new keys"


Write-Host "`nTEST 8: Reactivate client"

$activeBody = @{
    status = "active"
} | ConvertTo-Json

$reactivated = Invoke-RestMethod `
    -Uri "$baseUrl/clients/$clientId/status" `
    -Method Patch `
    -Headers $adminHeaders `
    -ContentType "application/json" `
    -Body $activeBody

if ($reactivated.client.status -ne "active") {
    throw "Client reactivation failed"
}

Assert-HttpStatus {
    Invoke-WebRequest `
        -Uri "$gatewayUrl/api/catalog/products" `
        -Headers $apiHeaders
} 200

Write-Host "PASS: Client reactivated successfully"


Write-Host "`nTEST 9: Revoke API key"

$revokeResult = Invoke-RestMethod `
    -Uri "$baseUrl/keys/$keyId" `
    -Method Delete `
    -Headers $adminHeaders

if ($revokeResult.revoked -ne $true) {
    throw "Key revocation failed"
}

Assert-HttpStatus {
    Invoke-WebRequest `
        -Uri "$gatewayUrl/api/catalog/products" `
        -Headers $apiHeaders
} 401

Write-Host "PASS: Revoked key rejected"


Write-Host "`nTEST 10: Repeated revocation"

Assert-HttpStatus {
    Invoke-WebRequest `
        -Uri "$baseUrl/keys/$keyId" `
        -Method Delete `
        -Headers $adminHeaders
} 404

Write-Host "PASS: Repeated revocation handled"


Write-Host "`nPASS: All 10 admin management checks completed" -ForegroundColor Green

Remove-Variable jwt, issued, apiHeaders -ErrorAction SilentlyContinue
