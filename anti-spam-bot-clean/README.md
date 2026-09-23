# Anti-Spam-Bot

Ein Discord-Bot für **einen Server pro Installation**. Er erkennt wiederholte Nachrichten und einfache Spam-Muster, löscht sie auf Wunsch, meldet Fälle in einem privaten Mod-Kanal und bietet Buttons für Timeout, Kick, Ban und Fehlalarm. Account-Alter erhöht das Risiko, ist allein aber kein Spam-Beweis. `free-test-123` wird erkannt; Wortteile wie `freedom` und `clickbait` lösen den Keyword-Filter nicht aus.

## Einrichtung

1. Node.js installieren und im Projektordner `npm ci` ausführen.
2. `.env.example` als `.env` kopieren und Token, Client-ID, Server-ID und die ID eines **privaten** Mod-Kanals eintragen. `.env` niemals veröffentlichen.
3. Im Discord Developer Portal **Server Members Intent** und **Message Content Intent** aktivieren. Presence Intent wird nicht benötigt.
4. Dem Bot auf dem Server die benötigten Rechte geben: Kanal ansehen, Nachrichtenverlauf anzeigen, Nachrichten senden, Nachrichten verwalten und Mitglieder moderieren. Für die entsprechenden Mod-Buttons zusätzlich Mitglieder kicken bzw. bannen. Seine Rolle muss über den Rollen der zu moderierenden Mitglieder stehen. Administrator ist nicht erforderlich.
5. `node deploy-commands.js` ausführen, danach `npm start` oder `run-bot.bat` starten. Nach Änderungen an Slash-Befehlen den Deploy-Befehl erneut ausführen.

Der Mod-Kanal darf für normale Mitglieder nicht sichtbar sein: Meldungen enthalten Ausschnitte verdächtiger Nachrichten. Button-Klicks prüfen zusätzlich die Rechte und Rollenhierarchie der klickenden Person. Der Bot verwendet Guild-Commands, die auf dem in `GUILD_ID` angegebenen Server registriert werden.

## Verhalten und Einstellungen

- `ML_SPAM_DETECTION=true` aktiviert die einfachen Keyword-Muster `free`, `click`, `discord.gg`, `bit.ly`. Dies ist eine Heuristik, kein trainiertes ML-Modell.
- `SIMILAR_MESSAGE_THRESHOLD=3` löst beim dritten gleichen Text eines Kontos innerhalb von `SIMILAR_MESSAGE_WINDOW` (Millisekunden, Standard 15 Minuten) aus. Wiederholte Alarme für denselben Text werden mit `ALERT_COOLDOWN_MS` gedrosselt (Standard zwei Minuten); erkannte Nachrichten können weiterhin gelöscht werden.
- `SPAM_DELETE=true` aktiviert das automatische Löschen. Auch bereits gesendete gleiche Nachrichten werden nach einem Wiederholungstreffer gesucht und entfernt.
- `NEW_ACCOUNT_AGE=4` markiert jüngere Konten als höheres Risiko. Ein junges Konto allein löst keine Maßnahme aus.
- `CAPTCHA_HIGH_RISK=true` sendet bei einem verdächtigen neuen Konto einen sechsstelligen Code per DM. Der Code gilt zehn Minuten und erlaubt drei Versuche. Während der Prüfung werden weitere Servernachrichten des Mitglieds entfernt. Nach Erfolg entfällt die erhöhte Altersbewertung für 24 Stunden. Der Code prüft den Zugriff auf die DM, nicht ob jemand tatsächlich ein Mensch ist.
- Ein einzelner Keyword-Treffer bei einem älteren Konto löst keinen automatischen Timeout aus. Bei Wiederholungen oder hohem Risiko kann ein älteres Servermitglied nach `AUTO_TIMEOUT_MEMBER_AGE_MS` automatisch 10 Minuten Timeout erhalten. Wiederholungen innerhalb von `REPEAT_OFFENDER_WINDOW_MS` verwenden `REPEAT_OFFENDER_TIMEOUT_MS`.
- `DELETE_MOD_MESSAGE_ON_FAILURE=true` entfernt eine Mod-Meldung auch nach einem fehlgeschlagenen Button-Klick. Standardmäßig bleibt sie zur Prüfung stehen.

Erkannte Fälle und Mod-Aktionen werden in `spam_logs.jsonl` protokolliert. Das Protokoll enthält Nutzer-IDs, Zeitpunkte und bis zu 200 Zeichen des Nachrichtentexts. Die Datei und `antispam-settings.json` sind lokal und per `.gitignore` von Git ausgeschlossen. Sichere beide Dateien bei Bedarf; das Löschen des Protokolls setzt die Statistik zurück. Zeiten und Tagesgrenzen richten sich nach der Zeitzone des Bot-Hosts.

## Slash-Befehle

| Befehl | Berechtigung | Funktion |
| --- | --- | --- |
| `/antispam` | Server verwalten | Modus, Konfiguration und heutige Fallzahl |
| `/antispamstats` | Administrator | Sieben-Tage-Verlauf, auffällige Konten, Auslöser und Maßnahmen |
| `/antispamfaelle` | Server verwalten | Letzte Fälle oder Details zu einer Fall-ID |
| `/antispamdiagnose` | Administrator | Prüft Mod-Kanal und lokale Schreibrechte; `testmeldung:true` sendet eine harmlose Testmeldung mit deaktiviertem Button |
| `/antispammodus` | Administrator | `active`: löschen, Captcha und Timeout; `observe`: nur protokollieren und melden |
| `/antispamausnahme` | Administrator | Nutzer, Rollen oder Kanäle für 1 bis 720 Stunden ausnehmen, entfernen oder auflisten |

Antworten der Anti-Spam-Befehle sind nur für die aufrufende Person sichtbar. Die Fallzahlen sind **Verdachtsfälle**, keine bestätigten Scammer. „Fehlalarm“ im Mod-Kanal markiert den Fall im Protokoll, nimmt das Konto aber nicht automatisch dauerhaft aus. Verwende dafür bei Bedarf `/antispamausnahme`.

## Öffentliche Weitergabe

Vor einem Push prüfen, dass `.env` und `node_modules` **nicht im Git-Index** liegen. Eine `.gitignore` entfernt bereits versionierte Dateien nicht automatisch. Wenn ein Bot-Token jemals in Git eingecheckt wurde, im Discord Developer Portal ein neues Token erzeugen. Das alte Token kann auch nach Entfernen der Datei aus der aktuellen Version im Git-Verlauf stehen.

Mit `npm test` laufen die lokalen Funktionstests. Für einen Testserver zuerst `/antispamdiagnose testmeldung:true` ausführen, danach eine einzelne Keyword-Nachricht und wiederholte gleiche Nachrichten testen. Beobachtungsmodus erlaubt einen Test ohne automatische Sanktionen.

## Guthaben-Anzeige

Der Bot veröffentlicht den aktuellen Guthabenstand jeden Tag zur Uhrzeit aus `GUTHABEN_UHRZEIT` (Standard `12:00`) als neue Nachricht im Kanal aus `GUTHABEN_CHANNEL_ID`. Die Rolle aus `GUTHABEN_PING_ROLE_ID` wird dabei standardmäßig nur montags und donnerstags erwähnt. Dadurch liegen zwischen den beiden wöchentlichen Pings abwechselnd drei und vier Tage.

Mit `GUTHABEN_PING_TAGE=1,4` lassen sich die beiden Ping-Tage als ISO-Wochentage einstellen (`1` = Montag bis `7` = Sonntag). Fehlen genau zwei gültige Tage, verwendet der Bot Montag und Donnerstag. Manuelle Änderungen über `/guthaben setzen` aktualisieren die jüngste Guthaben-Nachricht ohne Rollenping.

Am Tag aus `GUTHABEN_TAG` (Standard: der 8.) zieht der Bot das Monatsziel aus `GUTHABEN_ZIEL` (Standard: `54,70 €`) automatisch vom Guthaben ab. Reicht das Guthaben nicht aus, wird der negative Stand gespeichert und angezeigt. Ein gespeicherter Monatsmarker verhindert doppelte Abbuchungen nach einem Neustart. War der Bot über einen oder mehrere Stichtage offline, holt er die fehlenden Monatsabzüge beim nächsten Start nach.

Beim ersten Start mit dieser Funktion legt der Bot nur den Ausgangsmonat fest und führt keine rückwirkende Abbuchung aus. Die erste echte Abbuchung erfolgt am nächsten Stichtag.
