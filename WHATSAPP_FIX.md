# WhatsApp API Configuration Issues

## Problem Identified
The phone number ID `793224513462395` is invalid. API returns:
```
"Object with ID '793224513462395' does not exist, cannot be loaded due to missing permissions"
```

## Steps to Fix

### 1. Get Correct Phone Number ID
1. Go to https://developers.facebook.com
2. Select your WhatsApp app
3. Navigate to **WhatsApp → API Setup**
4. Copy the **Phone Number ID** from there
5. Update `.env` file:
   ```
   WHATSAPP_PHONE_NUMBER_ID=YOUR_CORRECT_ID_HERE
   ```

### 2. Verify Access Token
1. In the same API Setup page, ensure your **Access Token** is valid
2. Check that the token has these permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`

### 3. Verify Phone Number Setup
1. Go to **WhatsApp → Phone Numbers**
2. Ensure your phone number shows **"Connected"** status
3. Make sure it's linked to your **WhatsApp Business Account (WABA)**

### 4. Test Configuration
After updating the phone number ID, restart the server:
```bash
npm run dev
```

Then test sending a message from the dashboard.

## Common Issues
- **Wrong Phone Number ID**: Copy from Meta console, not from memory
- **Expired Access Token**: Regenerate in Meta console
- **Phone Number Not Connected**: Complete the WhatsApp Business verification process
- **Missing Permissions**: Request additional permissions in Meta console

## Current Status
❌ **Outbound messages failing** due to invalid phone number ID
✅ **Inbound messages working** (webhook processing)
✅ **Server running** on http://localhost:8000
✅ **Ngrok tunnel active**

Once you get the correct phone number ID, outbound messages will work!