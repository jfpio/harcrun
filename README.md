# HarcRun

Aplikacja: https://harcrun-zhr.web.app

Aplikacja do harcerskich biegów ze startu wspólnego: konta Google `@zhr.pl`, stały QR uczestnika, stoper, wiele skanerów, korekty koordynatora i publiczne wyniki. Interfejs korzysta ze stylistyki Atlasu kompetencji, ale projekt Firebase i dane są osobne.

## Uruchomienie

Wymagane: Node.js 22, npm, Firebase CLI; do emulatora Firestore także Java 21+.

```sh
npm ci
npm --prefix functions ci
cp .env.example .env.local
```

### Lokalnie, bez prawdziwego konta Google

W pierwszym terminalu:

```sh
npm run emulators
```

W drugim terminalu:

```sh
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed
npm run dev:emulators
```

Otwórz adres pokazany przez Vite. Konta testowe: `koordynator@zhr.pl` i `skaner@zhr.pl`, hasło `HarcRun-demo-2026!`. Są tworzone wyłącznie w lokalnym emulatorze; nie działają w produkcji. Każde konto przy pierwszym wejściu uzupełnia profil. Emulator UI: `http://127.0.0.1:4000`.

Na tym Macu Java jest zainstalowana przez Homebrew. Jeśli systemowe `java` nie znajduje środowiska, przed uruchomieniem emulatorów ustaw:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
```

Emulatory domyślnie nie zachowują danych po wyłączeniu. Możesz je uruchomić z `--export-on-exit` i później `--import`. Lokalny dziennik w przeglądarce pozostaje; po rozpoczęciu całkiem nowej próby utwórz nowy bieg. Flaga `VITE_USE_EMULATORS=true` zawsze wybiera projekt `demo-harcrun`, także gdy plik `.env.local` zawiera konfigurację produkcyjną.

### Z prawdziwym Firebase

Uzupełnij `.env.local` według `.env.example` i uruchom `npm run dev`. Konfiguracja web Firebase zawiera publiczne identyfikatory, a nie klucz administracyjny. Nie zapisuj w repozytorium kont serwisowych ani tokenów Firebase CLI.

## Obsługa biegu

1. Uczestnik loguje się przez Google `@zhr.pl`, potwierdza nazwisko i informację o publicznych wynikach. W panelu otrzymuje stały QR i wersję do wydruku. Nie musi wcześniej zapisywać się na konkretny bieg.
2. Koordynator tworzy bieg z datą i dystansem (domyślnie 5 km). Może uzupełnić nazwę później. Dodaje wolontariuszy po adresach już zarejestrowanych kont. Twórca domyślnie może obsługiwać obie funkcje.
3. Na `/tokeny` przygotowuje i drukuje do 500 wielorazowych tokenów. Format uczestnika: `HR1:P:<losowy identyfikator>`, format miejsca: `HR1:F:<1–500>`.
4. Przed utratą zasięgu każdy wolontariusz otwiera konkretny bieg na swoim telefonie, potwierdza zaufane urządzenie i wybiera „Przygotuj”. Jeden telefon jest przypisany do stopera; każdy skaner korzysta z osobnego konta wolontariusza. Tej samej sesji nie można równocześnie obsługiwać w dwóch kartach ani na dwóch urządzeniach.
5. Stoper uruchamia wspólny start. Przycisk „Zapisz metę” zapisuje kolejny czas; nie zatrzymuje licznika. Na mecie uczestnik dostaje token o tym samym numerze. Po ostatnim finiszu wolontariusz osobno kończy pomiar i zamyka sesję.
6. Skaner odczytuje uczestnika i token w dowolnej kolejności, sprawdza parę i ją zatwierdza. Może użyć tylnej kamery lub wpisać pełne kody ręcznie. Po ostatniej parze kończy sesję.
7. Każde urządzenie pozostaje otwarte po odzyskaniu internetu, aż pojawi się potwierdzenie zamknięcia przez serwer. Dziennik można dodatkowo wyeksportować do JSON. Eksport jest kopią awaryjną; pierwsza wersja nie ma automatycznego importu.
8. Koordynator wczytuje podgląd, rozwiązuje konflikty, uzupełnia nazwę i publikuje wyniki. Brak uczestnika przy poprawnym czasie daje „Nieznany uczestnik”. Nieznane kody, sprzeczne pary, ta sama osoba na wielu miejscach i skan bez czasu blokują publikację.
9. Korekta po publikacji tworzy nową wersję tego samego biegu. Historia i licznik startów korzystają z aktywnej wersji, więc nie naliczają udziału ponownie.

## Offline i pomiar

IndexedDB jest źródłem lokalnego dziennika. Każdy zapis otrzymuje ciągły numer w sesji. Cloud Functions przyjmują paczki do 100 operacji i potwierdzają numer ostatniej zapisanej operacji; ponowna wysyłka tej samej paczki jest bezpieczna. Potwierdzenie i dopisywanie nowych operacji nie nadpisują się.

Service worker powstaje podczas buildu i buforuje całą aplikację, wszystkie chunki skryptów, style oraz fonty. Pełny test ponownego otwarcia offline wykonuj na HTTPS lub localhost z produkcyjnym buildem (`VITE_USE_EMULATORS=true npm run build`, następnie `npm run preview`). Tryb `vite dev` zapisuje dane lokalnie, ale nie instaluje service workera. Przed wyjściem w teren sprawdź komunikat gotowości offline na każdym urządzeniu. Aktualizacja aplikacji czeka na zamknięcie starych kart.

Pomiar używa `performance.now()`, a czas kliknięcia mety jest pobierany przed zapisem. Punkt startowy i odczyty są zachowane w dzienniku. Po przeładowaniu strony działający pomiar wraca na podstawie czasu systemowego z flagą wymagającą kontroli koordynatora. Zmiana zegara jest również sygnalizowana. Uśpienie systemu, blokada ekranu i zamknięcie przeglądarki mogą zaburzać zegar lub zatrzymywać działanie aplikacji; ekran stopera powinien pozostać włączony, a aplikacja na pierwszym planie. Wake Lock jest używany, kiedy przeglądarka go udostępnia.

Przejęcie aktywnego stopera na innym urządzeniu i wznowienie zamkniętej sesji nie są obsługiwane. Nie czyść danych przeglądarki ani nie zmieniaj telefonu przed potwierdzeniem synchronizacji. Wylogowanie usuwa cache profilu i biegu, ale zachowuje dzienniki, żeby nie stracić niewysłanych danych.

## Architektura i uprawnienia

- `profiles/{uid}`: prywatny profil i stały identyfikator uczestnika. `participantCodes/{id}` jest prywatnym indeksem serwera, nie zawiera emaila w kodzie QR.
- `runs/{id}`: koordynator, członkowie, role, metadane robocze, rewizja, korekty i ostatni opublikowany zestaw wyników. Podkolekcje: `sessions`, `operations`, `audit`.
- `publicRuns/{id}`: publiczne metadane i wskaźnik aktywnej wersji. `versions/{versionId}` zawiera wyłącznie nazwiska, miejsca i czasy. Publikacja zapisuje kompletny zestaw i przełącza wskaźnik w jednej transakcji. Nieaktywne wersje nie są dostępne publicznie.
- Uczestnik czyta wyłącznie własny profil. Członkowie zespołu czytają przypisane biegi i sesje, a koordynator także historię korekt. Wszystkie zapisy klienta do Firestore są zablokowane.
- Każda Cloud Function sprawdza zweryfikowaną domenę `@zhr.pl` i odpowiednie uprawnienia. Parametr Google `hd` jedynie ułatwia wybór konta.
- Wywołania backendu: `saveProfile`, `createRun`, `updateRun`, `assignVolunteer`, `openSession`, `syncOperations`, `closeSession`, `previewResults`, `saveCorrections`, `publishResults`, `listHistory`.
- Korekty i publikacja wymagają aktualnej rewizji. Dodanie/usunięcie czasu przesuwa listę czasów; numery tokenów i przypisania pozostają na swoich miejscach. Interfejs wymaga sprawdzenia podglądu przed zapisaniem korekt. Poprzednia lista korekt zostaje w `audit`.
- Historia użytkownika jest odczytywana przez funkcję serwerową z ostatnich opublikowanych wyników, według stałego identyfikatora; nie korzysta z edytowalnego licznika.

## Testy

```sh
npm run check
npm run test:rules
npm run test:integration
# Test dostępności i odrzucenia anonimowych wywołań prawdziwego backendu:
npm run smoke:production
```

`check` buduje frontend i Functions, sprawdza kompletność zasobów offline oraz uruchamia 19 testów domeny, IndexedDB i service workera. Testy reguł sprawdzają publiczny odczyt, domenę, członkostwo, izolację profili i blokadę zapisów. Test integracyjny przechodzi przez role, synchronizację z powtórzeniami, zamknięcie sesji, publikację i korektę historii. Polecenia emulatorowe wymagają wolnych portów 8080, 9099 i 5001; wyłącz wcześniej uruchomione emulatory.

Przed prawdziwymi zawodami wykonaj próbę na Safari/iOS i Chrome/Android: aparat z wydrukowanymi tokenami, działający stoper przy wyłączeniu sieci, ponowne otwarcie offline, powrót połączenia i publikacja. Automatyczne testy nie zastępują sprawdzenia aparatu, wydruku ani zachowania systemowego uśpienia na telefonach.

## Firebase i wdrożenie

Projekt: **harcrun-zhr**. Aplikacja webowa: **HarcRun**. Docelowy region bazy i Functions: **europe-central2 (Warszawa)**. Baza `(default)` została odtworzona w Warszawie 26 listopada 2026 po potwierdzeniu pustego stanu bazy w USA i uzyskaniu zgody właściciela. `firebase.json` zawiera również docelową lokalizację dla kolejnych inicjalizacji. `.firebaserc` wskazuje wyłącznie ten projekt.

Baza, reguły, indeksy, Google Auth i wszystkie 11 funkcji są wdrożone. Endpointy callable są dostępne z przeglądarki, a każda funkcja weryfikuje konto `@zhr.pl` i uprawnienia. Stan wdrożenia i weryfikacji znajduje się w [DEPLOYMENT.md](DEPLOYMENT.md), a omówienie ryzyk w [SECURITY.md](SECURITY.md).

Dla kolejnych wdrożeń uzupełnij `.env.local`, ustaw `VITE_USE_EMULATORS=false` i `VITE_SERVICES_READY=true`, a następnie:

```sh
npm run check
firebase deploy --only firestore,functions,hosting --project harcrun-zhr
npm run smoke:production
```

`VITE_SERVICES_READY=false` pozwala opublikować podgląd interfejsu z wyłączonym logowaniem do czasu uruchomienia backendu. W emulatorach ta flaga jest ignorowana.

Hosting uruchamia dodatkową walidację konfiguracji: wdrożenie zostanie zablokowane przy aktywnych emulatorach, brakujących parametrach lub projekcie `demo-*`. `npm run dev:emulators` jest niezależny od konfiguracji produkcyjnej.

Google Auth ma dozwolone domeny `harcrun-zhr.web.app` i `harcrun-zhr.firebaseapp.com`. Lokalny development z prawdziwym Google wymaga także dodania `localhost` w Authorized domains. Plan Blaze jest aktywny; wygenerowane obrazy wdrożeniowe są sprzątane po 7 dniach.

Pierwsza wersja nie obejmuje maili, stałych lokalizacji, zapisów na bieg ani klasyfikacji wiekowych.
