# Wdrożenie HarcRun — 26 listopada 2026

Aplikacja: https://harcrun-zhr.web.app

## Środowisko

- Osobny projekt Firebase: `harcrun-zhr`.
- Baza Firestore `(default)` i wszystkie 11 Cloud Functions: **europe-central2 (Warszawa)**, Node.js 22.
- Plan Blaze aktywny. Obrazy wdrożeniowe Artifact Registry są sprzątane po 7 dniach.
- Reguły i indeksy Firestore wdrożone. Bezpośrednie zapisy klienta do bazy są zablokowane.
- Google Auth włączone. Dozwolone domeny: `harcrun-zhr.web.app` i `harcrun-zhr.firebaseapp.com`.
- Wszystkie endpointy callable są dostępne z przeglądarki. Każda funkcja wymaga zweryfikowanego konta `@zhr.pl` i sprawdza odpowiednie uprawnienia.
- Produkcyjny frontend jest opublikowany z `VITE_SERVICES_READY=true` i `VITE_USE_EMULATORS=false`.
- Lokalna konfiguracja SDK znajduje się w ignorowanym `.env.local`. Repozytorium nie zawiera tokenów administracyjnych ani kluczy kont serwisowych.

Pustą bazę w USA usunięto po potwierdzeniu jej pustego stanu i uzyskaniu zgody właściciela. Nową bazę w Warszawie utworzono 26 listopada 2026. Następnie wdrożono reguły i indeksy. Nie przenoszono danych uczestników.

Po zatwierdzeniu przez właściciela dostępu sieciowego API skonfigurowano rolę `roles/run.invoker` dla `allUsers` wyłącznie na 11 usługach Cloud Run odpowiadających funkcjom HarcRun. Pierwsze nieudane wdrożenia nie ustawiły części tych reguł; zostały uzupełnione z zachowaniem pozostałych zasad IAM. Samo powtórne wdrożenie funkcji nie wystarczyło do naprawienia tego stanu.

## Weryfikacja

- Build produkcyjny i komplet zasobów offline: poprawne.
- 19 testów domeny, IndexedDB i service workera: poprawne.
- 4 testy reguł Firestore i test integracyjny całego backendu: poprawne na emulatorach.
- `npm run smoke:production`: wszystkie 11 produkcyjnych funkcji odpowiada JSON `PERMISSION_DENIED` na żądania bez logowania. Test nie zapisał żadnych danych.
- W przeglądarce sprawdzono cały przepływ na emulatorach: konto → profil → bieg → stoper → para QR → publikacja → publiczna tabela.
- Interfejs sprawdzono przy szerokościach 390 i 1280 px, bez poziomego przepełnienia.
- Zakończenie logowania Google prawdziwym kontem oraz aparat i zachowanie uśpienia systemu wymagają próby użytkownika na docelowych telefonach.

## Następne wdrożenia

```sh
npm run check
firebase deploy --only firestore,functions,hosting --project harcrun-zhr
npm run smoke:production
```

W razie ponownego wystąpienia odpowiedzi HTML 403 zamiast JSON callable sprawdź reguły `roles/run.invoker` na konkretnej usłudze Cloud Run. Kontrola Firebase Auth jest wykonywana w kodzie funkcji; blokada całego ruchu przez IAM uniemożliwia korzystanie z aplikacji przeglądarkowej.

Przed prawdziwym biegiem wykonaj próbę na dwóch telefonach: przygotowanie online, pomiar i skanowanie bez zasięgu, ponowne otwarcie offline, synchronizacja i publikacja.

Stan ochrony przed nadużyciami i ograniczenia budżetu opisano w [SECURITY.md](SECURITY.md). Projekt Atlas kompetencji nie był modyfikowany.
