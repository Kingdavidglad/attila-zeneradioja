# Attila Zenerádiója – Supabase kapcsolatfelvételi rendszer

Ez a csomag az adatbázis és az Edge Function előkészítését tartalmazza. A meglévő weboldalhoz tartozó végleges `index.html`-t csak a projekt URL, a publishable key és a weboldal pontos domainje ismeretében szabad összekötni.

## A csomag tartalma

- `01-create-contact-messages.sql` – biztonságos tábla létrehozása.
- `supabase/functions/contact-message/index.ts` – szerveroldali űrlapkezelő funkció.
- `02-front-end-connection-example.js` – böngészős kapcsolódási minta.

## 1. Adatbázistábla létrehozása

1. Nyisd meg a Supabase projektet.
2. Bal oldalt válaszd az **SQL Editor** menüpontot.
3. Kattints a **New query** gombra.
4. Nyisd meg a `01-create-contact-messages.sql` fájlt, másold be a teljes tartalmát.
5. Kattints a **Run** gombra.
6. A **Table Editor** részen ellenőrizd, hogy létrejött-e a `contact_messages` tábla.

A tábla RLS-t használ, és nem enged közvetlen, névtelen böngészős olvasást vagy írást. Az Edge Function a szerveroldali kulccsal ment.

## 2. Edge Function létrehozása

1. A Supabase projektben nyisd meg az **Edge Functions** részt.
2. Válaszd a **Deploy a new function** → **Via Editor** lehetőséget.
3. A funkció neve legyen: `contact-message`.
4. A szerkesztőben cseréld le a mintakódot a `supabase/functions/contact-message/index.ts` teljes tartalmára.
5. Deploy-old a funkciót.
6. A funkció adatlapján kapcsold ki az **Enforce JWT verification** ellenőrzést, mivel a látogatók bejelentkezés nélkül küldhetnek üzenetet. A kód külön ellenőrzi az engedélyezett weboldal-origin értéket, a mezőket, a honeypot mezőt és a beküldések gyakoriságát.

## 3. Edge Function titkos beállítások

A projekt **Edge Function Secrets** részén állítsd be:

- `ALLOWED_ORIGINS` = a weboldal teljes eredete, például `https://FELHASZNALONEV.github.io` (egyedi domain esetén azt is add hozzá vesszővel elválasztva).
- `CONTACT_EMAIL` = `djattila112@gmail.com`
- `RATE_LIMIT_SALT` = egy hosszú, véletlenszerű titok (legalább 32 karakter).
- `RESEND_API_KEY` = a Resend API-kulcs (e-mail értesítéshez).
- `RESEND_FROM_EMAIL` = a Resendben hitelesített feladó, például `Attila Zenerádiója <kapcsolat@SAJAT-DOMAIN>`.

A `SUPABASE_URL`, `SUPABASE_SECRET_KEYS` (és a régi projektekben a `SUPABASE_SERVICE_ROLE_KEY`) Supabase által biztosított szerveroldali változó. Ne másold a secret/service-role kulcsot a weboldalba vagy a GitHub repositoryba.

**Fontos:** a funkció már Resend-beállítás nélkül is adatbázisba menti az üzenetet. Az e-mail értesítés csak a Resend-fiók, API-kulcs és hitelesített feladói domain beállítása után működik.

## 4. Weboldal összekötése

A `02-front-end-connection-example.js` csak minta. A végleges weboldalba a következő két publikus adatot kell beírni:

- Project URL / Project ref
- Publishable key (régi projekteknél anon key)

Ezeket a Supabase **Project Settings → API Keys** részén találod. A publishable/anon kulcs megjelenhet a böngészőben RLS mellett. A secret/service-role kulcs soha nem.

Ezután a végleges `index.html` kapcsolatfelvételi űrlapját módosítani kell, hogy a fenti Edge Functiont hívja. A hozzájárulás szövegében is a Supabase adatkezelést kell feltüntetni, nem a FormSubmit szolgáltatást.

## 5. Tesztelés

- Küldj egy tesztüzenetet a weboldalról.
- Supabase → Table Editor → `contact_messages`: ellenőrizd, hogy megjelent-e.
- Ha a Resend beállítása kész, nézd meg a `djattila112@gmail.com` postafiókot és a Spam mappát is.
- Ha az üzenet bekerül az adatbázisba, de `emailSent: false`, akkor a Resend API-kulcsot vagy a hitelesített feladói címet kell javítani.

## Adatvédelem és biztonság

- Ne küldd el senkinek a database password, secret key, service-role key vagy Resend API key értékét.
- A böngészőben kizárólag publishable/anon kulcs szerepelhet.
- Az SQL-ben bekapcsolt RLS miatt az anonim látogatók nem tudják a beküldött üzeneteket olvasni.
- Az üzenetek törlési/megőrzési idejét és az adatkezelési tájékoztatót az üzemeltetőnek véglegesítenie kell.
