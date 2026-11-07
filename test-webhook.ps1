Start-Sleep -Seconds 2
$r = Invoke-WebRequest -Uri 'http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=dev_verify_token_123&hub.challenge=abc123' -UseBasicParsing
Write-Host ("status: " + $r.StatusCode)
Write-Host ("body: " + $r.Content)