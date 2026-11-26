# Bezpieczeństwo HarcRun

## Dostęp do API i danych

Adresy Cloud Functions są dostępne dla przeglądarek. Każda funkcja sprawdza Firebase Auth, potwierdzenie emaila oraz dokładną domenę `@zhr.pl`, a następnie rolę użytkownika w danym biegu. Kod QR uczestnika jest identyfikatorem, nie poświadczeniem logowania.

Klient nie może bezpośrednio zapisywać danych w Firestore. Prywatny profil jest dostępny tylko właścicielowi. Biegi i sesje są dostępne przypisanym członkom zespołu. Publicznie odczytywane są wyłącznie metadane i aktywna wersja opublikowanych wyników: nazwisko, miejsce i czas. Adresy email i identyfikatory kont nie są publikowane w tabeli wyników.

2FA kont Google zmniejsza ryzyko przejęcia konta. Nie zabezpiecza przed anonimowym ruchem do publicznych endpointów ani kopiowaniem publicznych wyników.

## Pozostałe ryzyka

- **Koszty i dostępność:** odrzucone żądanie może uruchomić funkcję, a odczyty publicznych wyników zużywają zasoby Firestore. Nie wdrożono App Check ani ograniczania częstotliwości żądań per użytkownik/IP. Ustawienie `maxInstances: 10` dotyczy każdej funkcji i nie jest limitem kwotowym kosztów całej aplikacji.
- **Budżet:** zwykły budżet z alertami nie zatrzymuje naliczania opłat. Google Cloud obsługuje także Spend cap dla wybranych usług; obejmuje on pojedynczą usługę w projekcie i nie gwarantuje odcięcia dokładnie przy wskazanej kwocie. Nie potwierdzono rodzaju ustawienia $1 na koncie właściciela i nie zmieniano jego ustawień finansowych.
- **Publiczne wyniki:** nazwiska i rezultaty mogą być kopiowane przez dowolną osobę. Ich publiczność jest świadomie wybranym zachowaniem produktu; informacja o niej jest pokazywana przy tworzeniu profilu.
- **Obsługa zawodów:** uśpienie telefonu, wyczyszczenie danych przeglądarki i brak końcowej synchronizacji mogą zaburzyć pomiar lub utrudnić odzyskanie wyników. Przed zawodami potrzebna jest próba terenowa. Lokalny dziennik i jego eksport JSON pomagają zachować dane.

Przed szerszym udostępnieniem warto rozważyć Firebase App Check i limity częstotliwości wywołań. App Check jest dodatkową ochroną przed nadużyciami i nie zastępuje logowania, uprawnień ani reguł bazy. Przy projektowaniu egzekwowania App Check trzeba zachować działanie lokalnego dziennika offline i późniejszej synchronizacji.

## Publiczne repozytorium

Pliki `.env.local`, logi debugowania, katalogi zależności, dane emulatorów i klucze administracyjne są wyłączone przez `.gitignore`. Przed pierwszą publikacją sprawdzono listę plików oraz wzorce kluczy prywatnych, tokenów GitHub, sekretów OAuth, kluczy AWS i plików administracyjnych Firebase. Commit używa adresu GitHub noreply zamiast prywatnego emaila autora.

Konfiguracja webowego SDK Firebase identyfikuje projekt i nie zastępuje kontroli dostępu. Nie dodawaj do repozytorium kluczy kont serwisowych, tokenów Firebase CLI, sekretów OAuth ani danych prawdziwych uczestników. Przykładowe hasło w instrukcji dotyczy wyłącznie kont lokalnego emulatora; skrypt inicjalizacyjny odmawia działania bez zmiennych emulatora.

## Weryfikacja

- `npm run check` — build, logika wyników, trwałość IndexedDB i powłoka offline.
- `npm run test:rules` — izolacja danych i blokada zapisów klienta.
- `npm run test:integration` — role i cały przepływ na emulatorach.
- `npm run smoke:production` — wszystkie 11 produkcyjnych endpointów musi odpowiedzieć JSON `PERMISSION_DENIED` na wywołanie bez logowania. Test nie zapisuje danych.

Źródła: [budżety i alerty](https://docs.cloud.google.com/docs/get-started/learn-about-billing), [Spend cap](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps), [App Check](https://firebase.google.com/docs/app-check), [klucze API Firebase](https://firebase.google.com/docs/projects/api-keys).
