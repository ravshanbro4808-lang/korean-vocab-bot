# Koreys lug'at boti (Telegram Mini App + veb)
1. `cp .env.example .env` va to'ldiring: BOT_TOKEN, WEBAPP_URL (https), ADMIN_IDS/ADMIN_EMAILS (egasi), GOOGLE_CLIENT_ID, SECRET.
2. Google Cloud Console → OAuth Client ID (Web). "Authorized JavaScript origins" ga WEBAPP_URL ni qo'shing.
3. `npm install && node --env-file=.env server.js`
4. @BotFather → Web App URL = WEBAPP_URL.
5. Admin ⚙️: tariflar, to'lov usullari (Click/Payme/Karta), lug'at, import, adminlar va ularning huquqlari.
Kitob importi: .txt/.csv/.pdf. "koreys, tarjima" qatorlari to'g'ridan-to'g'ri olinadi, tarjimasiz so'zlar TRANSLATE_URL orqali tarjima qilinadi.
Sinash: DEV=1 va `/?dev=ID` (Telegram/Google'siz).
