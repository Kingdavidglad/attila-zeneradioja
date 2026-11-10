# Attila Zenerádiója – közvetlen kapcsolatfelvételi űrlappal

## Fájlok
- `index.html`
- `assets/hero-concert.webp`

## Telepítés GitHub Pages-re
A ZIP teljes tartalmát töltsd fel az új repository gyökérkönyvtárába. Az `index.html` a gyökérbe kerüljön, az `assets` mappa pedig maradjon mellette.

## Kapcsolatfelvétel
A kapcsolatfelvételi űrlap a FormSubmit AJAX végpontját használja, így a látogatónak nem kell megnyitnia a levelezőprogramját, és az oldalon marad az elküldés közben.
Célcím: `djattila112@gmail.com`.

### Egyszeri aktiválás közzététel után
1. A GitHub Pages-en közzétett oldalon küldj egy próbaüzenetet az űrlappal.
2. A FormSubmit aktiváló e-mailt küld a `djattila112@gmail.com` címre.
3. Nyisd meg ezt az e-mailt, és kattints a megerősítő/aktiváló hivatkozásra.
4. Ezután az űrlap beküldései közvetlenül az e-mail-címre érkeznek.

A FormSubmit első használatkor e-mailes címmegerősítést kér. A megerősítés előtt az éles üzenetkézbesítés nem tekinthető aktiváltnak.

A szolgáltatás dokumentációja: https://formsubmit.co/documentation
AJAX dokumentáció: https://formsubmit.co/ajax-documentation
Adatvédelmi tájékoztató: https://formsubmit.co/privacy.pdf

## Adatvédelem
Az űrlap a nevet, e-mail-címet, telefonszámot és üzenetet külső szolgáltatáson keresztül továbbítja. A FormSubmit a dokumentációja szerint a beküldéseket 30 napig őrzi meg. Az oldal tájékoztatást és hozzájáruló jelölőnégyzetet tartalmaz, de az üzemeltetőnek közzététel előtt ellenőriznie kell és ki kell egészítenie a teljes adatkezelési tájékoztatót a saját adatkezelési gyakorlatának megfelelően.

## Megjegyzés
A kapcsolatfelvételi e-mail-cím a korábban használt `djattila112@gmail.com`. Ha másik címre kell érkezniük az üzeneteknek, az `index.html` fájlban a `formsubmit.co` végpont mindkét előfordulását cserélni kell.
