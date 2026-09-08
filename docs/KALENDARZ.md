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


## Wiele kont naraz

Konto rozpoznajemy po identyfikatorze `dostawca` albo `dostawca:nazwa`, na
przykład `google` i `google:firmowe`. Przy dodawaniu wpisz nazwę konta, jeśli
podłączasz drugie u tego samego dostawcy; puste pole znaczy konto domyślne.
Każde konto ma własne dane aplikacji i własne tokeny w sejfie, a blok założony
w panelu trafia do wszystkich połączonych kont.

## Planowanie zdaniem

Pole na górze kalendarza przyjmuje zapis, jakiego używa się w notatniku:

    dentysta środa 16
    spotkanie pon 14-15:30
    siłownia jutro rano
    przegląd auta w przyszły poniedziałek przed południem

Parser rozumie dni tygodnia, `dziś`, `jutro`, `pojutrze`, daty `12.09`
i `12 września`, godziny, zakresy oraz długości (`2h`, `45 min`, `1,5h`).
Gdy długości nie ma w tekście, pyta o nią model przez wywołanie narzędzia
i zapamiętuje odpowiedź, więc drugi „dentysta" nie kosztuje już nic.
Propozycja jest w pełni edytowalna: nazwa, początek i minuty.

## Kolizje i wolne okna

Przed zapisaniem panel czyta bloki, subskrypcje ICS i wszystkie połączone
konta. Nakładający się termin pokazuje wprost, z którego kalendarza pochodzi,
i wysyła powiadomienie na telefon. Przycisk **Znajdź wolny termin** zwraca
pierwsze okna wolne we wszystkich kalendarzach naraz, w godzinach 8-20,
z pominięciem weekendów i w kwadransowej siatce.

## Zasłona zajętości

Wydarzenie z jednego kalendarza może pojawić się w drugim jako sam blok czasu
o nazwie `Zajęte`, bez opisu i bez linku. Dzięki temu w firmowym kalendarzu
widać, że termin jest zajęty, ale nie widać czym. Panel odświeża zasłonę co
kwadrans, przesuwa odbicia razem z oryginałem, kasuje je po odwołaniu terminu
i ukrywa je w Twoim własnym widoku, żeby nie oglądać tego samego dwa razy.
Ręcznie uruchamia to przycisk **Zasłoń zajętość**.

## Spotkania online

Wydarzenia ze spotkaniem online mają w szczegółach przycisk **Dołącz do
spotkania**. Adres bierzemy z pól dostawcy (`onlineMeeting` w Graphie,
`hangoutLink` i `conferenceData` w Google), a dla subskrypcji ICS z opisu,
lokalizacji, `URL` i `X-GOOGLE-CONFERENCE`. Rozpoznawane są Teams, Meet, Zoom,
Whereby, Jitsi, Webex, Discord i huddle na Slacku.

## Gdy konsola Google jest zablokowana

Od 13 maja 2025 Google Cloud wymaga weryfikacji dwuetapowej na koncie. Bez niej
konsola odrzuca każdą podstronę i nie da się utworzyć klienta OAuth. Do czasu
włączenia 2FA zostaje etap pierwszy, czyli odczyt przez prywatny adres ICS.

## Widok na dłuższy okres

Nad siatką są przyciski zakresu: dzień, trzy dni, tydzień i dwa tygodnie.
Przy kilku dniach każda kolumna dostaje własny nagłówek z datą, dzisiejszy dzień
jest wyróżniony, a strzałki przeskakują o cały widoczny okres, nie o jeden
dzień. Na szerokim ekranie kalendarz zadokowany w kolumnie roboczej rozszerza
się razem z zakresem, a przy tygodniu i dłużej lista zadań chowa się, żeby
oddać miejsce siatce.

## Automatyczne układanie zadań

Przycisk **Ułóż plan** wstawia otwarte zadania w wolne okna. Reguły wzięte
z tego, jak plany psują się w praktyce:

- termin decyduje o kolejności, a zadanie po terminie idzie na początek,
- zadanie dłuższe niż 90 minut dzielimy na części,
- dzień ma limit czasu na zadania, reszta zostaje na spotkania i sprawy,
  których nikt nie planuje,
- między blokami zostaje przerwa,
- zadania zablokowane i zlecone komuś innemu pomijamy.

Każda propozycja mówi, skąd się wzięła (`3 dni po terminie`, `pilne`,
`część z 180 min`). Plan jest propozycją: pojedyncze pozycje można usunąć,
zanim zapiszesz całość.

## Ustawienia kont

Podłączanie Google i Microsoftu przeniosło się do **Ustawień** (⚙ w nagłówku
albo `Alt+,`), sekcja **Kalendarze**. Kalendarz pokazuje już tylko stan
połączenia, bo formularze wypełnia się raz, a na dzień patrzy się codziennie.
