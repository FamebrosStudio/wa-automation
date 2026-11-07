$payload = @{
  object = "whatsapp_business_account"
  entry = @(
    @{
      id = "123"
      changes = @(
        @{
          value = @{
            messaging_product = "whatsapp"
            metadata = @{ display_phone_number = "123"; phone_number_id = "123" }
            messages = @(
              @{
                from = "919999999999"
                id = "wamid.test1"
                timestamp = "1700000000"
                type = "text"
                text = @{ body = "hi" }
              }
            )
          }
          field = "messages"
        }
      )
    }
  )
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri 'http://localhost:3000/webhook' -Method Post -Body $payload -ContentType 'application/json' | Out-Null
Write-Host "posted"
Start-Sleep -Seconds 2
Write-Host "check server log"