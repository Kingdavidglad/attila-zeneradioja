# Attila Zenerádiója – két lejátszóval és napi névnapi sávval

A weboldal fájljai:
- `index.html`
- `assets/hero-concert.webp`

## Telepítés
A ZIP teljes tartalmát töltsd fel a webtárhelyre úgy, hogy az `index.html` mellett az `assets` mappa is megmaradjon.

## Rádiólejátszók
- Élő adás: `http://s02.diazol.hu:8130/live`
- AutoDJ: `http://s02.diazol.hu:8130/autodj`

A két lejátszó külön vezérelhető, de egyszerre csak az egyik szól: a másik automatikusan megáll, amikor elindítod az új csatornát.

## Automatikus indítás
Az oldal megnyitásakor a weboldal megpróbálja automatikusan elindítani a LIVE adást. A hanggal történő automatikus indítást a böngészők gyakran letiltják, amíg a látogató nem kattint vagy érint meg valamit. Ilyenkor egy jól látható indítósáv jelenik meg két választással: LIVE indítása vagy AutoDJ indítása. A weboldal ezt a böngészőkorlátozást nem tudja megkerülni.

## Napi névnapi sáv
- A felső, folyamatosan gördülő sáv a `https://www.nevinfo.hu/api/v1/ma` végpontról tölti be a napi magyar névnapokat.
- A dátumot `Europe/Budapest` időzónában ellenőrzi.
- A lekérdezett adatot a böngésző helyben eltárolja, és ugyanazon a napon nem kérdezi le újra feleslegesen.
- Ha az oldal nyitva marad éjfélkor, legfeljebb egy percen belül frissíti a névnapokat.
- Ha a névnap API átmenetileg nem elérhető, az aznapi, korábban mentett adatot használja.

## Fontos: HTTPS stream
Ha a weboldal HTTPS-címen fut, a böngészők a HTTP audio streamet HTTPS-re próbálják átállítani, és nem töltenek vissza HTTP-re, ha az SSL stream nem érhető el. Emiatt a tárhelyszolgáltatónál / stream szolgáltatónál ellenőrizni kell, hogy a két csatolási ponthoz elérhető-e HTTPS stream is. A konkrét stream lejátszását közzététel előtt böngészőben tesztelni kell.
