# Kalendarz: jak podłączyć Google i Outlooka

Dwa etapy. Pierwszy działa od razu i wymaga tylko wklejenia dwóch adresów.
Drugi daje zapis po stronie Google i Microsoftu, ale wymaga rejestracji
aplikacji w ich konsolach.

## Etap pierwszy: odczyt przez ICS (pięć minut)

### Google Calendar

1. Kalendarz w przeglądarce, najedź na nazwę kalendarza po lewej, trzy kropki,
   **Ustawienia i udostępnianie**.
2. Zjedź do **Integracja kalendarza**.
3. Skopiuj **Prywatny adres w formacie iCal** (kończy się na `basic.ics`).

### Outlook, konto firmowe M365

1. Outlook w przeglądarce, **Kalendarz**, koło zębate, **Kalendarz**,
   **Kalendarze udostępnione**.
2. W sekcji **Publikowanie kalendarza** wybierz kalendarz, uprawnienie
   **Może wyświetlać wszystkie szczegóły**, kliknij **Publikuj**.
3. Skopiuj link **ICS**, nie HTML.

Gdyby administrator tenantu zablokował publikowanie, włączysz to sam w centrum
administracyjnym Exchange: **Ustawienia organizacji**, **Udostępnianie kalendarza**.

### W panelu

Klawisz `Q`, przycisk **Źródła**, wklej nazwę i adres, **Dodaj**. Wydarzenia
pojawią się na siatce dnia, odświeżane co pięć minut.

Adres ICS jest jak hasło: kto go zna, ten widzi kalendarz. Trzymamy go lokalnie
w `~/.claude-session-manager/calendar.json`.

## W drugą stronę: bloki z panelu w Twoim kalendarzu

Panel wystawia własne bloki pod adresem `/api/calendar/export`.

- **Google**: Inne kalendarze, plus, **Utwórz na podstawie adresu URL**.
- **Outlook**: Dodaj kalendarz, **Subskrybuj z sieci Web**.

Warunek: oba serwisy muszą widzieć ten adres, a `localhost` widzi tylko Twój
komputer. Zadziała, gdy panel będzie osiągalny z zewnątrz przez tunel albo
własną domenę. Do tego czasu bloki żyją w panelu.

## Etap drugi: wymiana w obie strony (kod gotowy, czeka na dane)

Wszystko po stronie panelu jest napisane: logowanie, odświeżanie tokenów,
odczyt wydarzeń, tworzenie, zmiana i usuwanie bloków. Brakuje wyłącznie danych
aplikacji, których nie mogę wygenerować za Ciebie.

Po podłączeniu działa to tak: blok założony przeciągnięciem zadania trafia do
Google i Outlooka w ciągu sekundy, przesunięcie zmienia go po obu stronach,
usunięcie kasuje wszędzie. W drugą stronę wydarzenia z obu kalendarzy widać
na siatce razem z blokami, bez duplikatów.

Dane wpisujesz w panelu: `Q`, **Źródła**, sekcja **Konta z zapisem w obie
strony**. Trafiają do zaszyfrowanego sejfu, nie do plików konfiguracyjnych.

### Google Calendar API

1. <https://console.cloud.google.com>, nowy projekt.
2. **Interfejsy API i usługi**, włącz **Google Calendar API**.
3. **Ekran zgody OAuth**, typ zewnętrzny, dodaj siebie jako testera.
4. **Dane logowania**, identyfikator klienta OAuth, typ aplikacja internetowa,
   przekierowanie `http://localhost:4317/api/calendar/oauth/google`.
5. Skopiuj **identyfikator klienta** i **klucz tajny** i wklej je w panelu.

Zakres: `https://www.googleapis.com/auth/calendar.events`, czyli wydarzenia,
bez dostępu do reszty konta.

### Microsoft Graph

1. <https://entra.microsoft.com>, **Rejestracje aplikacji**, **Nowa rejestracja**.
2. Konta tylko w tej organizacji, przekierowanie typu **Sieć Web**:
   `http://localhost:4317/api/calendar/oauth/microsoft`.
3. **Certyfikaty i klucze tajne**, nowy klucz tajny klienta.
4. **Uprawnienia interfejsu API**, Microsoft Graph, delegowane:
   `Calendars.ReadWrite` oraz `offline_access`.
5. Skopiuj **identyfikator aplikacji**, **identyfikator katalogu** i **klucz
   tajny**, po czym wklej je w panelu.

Masz rolę administratora w tenancie, więc zgodę wyrazisz sam.

### Czego nie zrobię za Ciebie

Nie wpisuję Twoich danych logowania i nie klikam zgód w tych konsolach. Zapadają
tam decyzje o uprawnieniach do firmowego konta i to Twoja rola. Reszta jest już
zrobiona.

Po zapisaniu danych kliknij **połącz** przy dostawcy. Panel przekieruje Cię na
stronę zgody, a po powrocie napis zmieni się na „połączone, zapis działa”.

## Co działa bez żadnego z tych kroków

- Siatka dnia z wydarzeniami ze wszystkich podpiętych źródeł ICS
- Bloki czasu zakładane przeciągnięciem zadania na godzinę
- Długość bloku brana z szacunku zadania (zapis `~30m` w treści)
- Własny kalendarz ICS do zasubskrybowania
