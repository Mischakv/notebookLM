/**
 * The evaluation corpus.
 *
 * Two synthetic documents, written so the answers sit in *different* paragraphs
 * from the words a question would obviously match. A corpus where every answer
 * is in paragraph one measures nothing.
 *
 * Each document is deliberately longer than the chunker's 800-token target. An
 * earlier version of this corpus was ~280 tokens per document, so `chunk()`
 * returned one chunk and every question trivially "retrieved" the whole text —
 * the harness reported a hit rate it had not actually earned. Length is what
 * makes chunk boundaries, and chunk boundaries are what this measures.
 *
 * Synthetic on purpose: a fixture drawn from a real customer page would put
 * third-party content in the repo and would drift when that page changes.
 */

import type { EvalDocument } from "@/lib/eval/retrieval";

const HANDBOOK = `# Onboarding-Handbuch

Willkommen im Team. Dieses Handbuch beschreibt die ersten Schritte für neue
Mitarbeitende und die wichtigsten internen Abläufe.

## Arbeitszeiten

Die Kernarbeitszeit liegt zwischen 10:00 und 15:00 Uhr. Ausserhalb dieser Zeiten
ist die Einteilung frei, solange die vereinbarte Wochenstundenzahl erreicht wird.
Überstunden werden im Zeiterfassungssystem erfasst und quartalsweise ausgeglichen.

## Urlaub

Der Jahresurlaub beträgt 30 Tage bei einer Fünf-Tage-Woche. Urlaubsanträge werden
spätestens vier Wochen im Voraus gestellt. Nicht genommener Urlaub verfällt am
31. März des Folgejahres.

## Ausstattung

Jede Person erhält einen Laptop und ein externes Display. Die Bestellung läuft
über das interne Ticketsystem und dauert in der Regel fünf Werktage. Defekte
Geräte werden innerhalb von 24 Stunden ersetzt.

## Weiterbildung

Für Konferenzen und Kurse steht ein jährliches Budget von 1500 Euro pro Person
zur Verfügung. Der Antrag geht an die Teamleitung und muss keinen direkten
Projektbezug haben.

## Kommunikation

Die interne Kommunikation läuft über den Team-Chat. E-Mail ist für den Kontakt
mit Kundinnen und Kunden reserviert. Auf Nachrichten im Chat wird innerhalb eines
Arbeitstages geantwortet, eine sofortige Reaktion wird ausdrücklich nicht
erwartet. Wer konzentriert arbeiten möchte, setzt den Status auf "fokussiert";
das ist ein akzeptierter Grund, nicht zu antworten.

## Besprechungen

Jede Besprechung hat eine Agenda und ein Ergebnisprotokoll. Ohne Agenda wird die
Besprechung abgesagt. Der wöchentliche Team-Termin dauert maximal 30 Minuten.
Längere Formate wie Retrospektiven finden alle vier Wochen statt und dauern
90 Minuten. Besprechungen ohne klare Entscheidungsfrage werden durch eine
schriftliche Notiz ersetzt.

## Homeoffice

Mobiles Arbeiten ist an bis zu drei Tagen pro Woche möglich. Die Anwesenheit an
den übrigen Tagen dient der Abstimmung im Team. Für die Ausstattung des
häuslichen Arbeitsplatzes steht ein einmaliger Zuschuss von 800 Euro zur
Verfügung. Der Zuschuss wird über die Personalabteilung abgerechnet.

## Probezeit

Die Probezeit beträgt sechs Monate. In dieser Zeit findet alle vier Wochen ein
strukturiertes Gespräch mit der Teamleitung statt. Ziel ist, Rückmeldung früh und
regelmässig zu geben, damit am Ende der Probezeit niemand überrascht wird.

## Reisekosten

Bahnfahrten werden in der zweiten Klasse abgerechnet, Flüge nur bei Strecken über
sechs Stunden Fahrzeit. Übernachtungen werden bis 150 Euro pro Nacht erstattet.
Belege werden innerhalb von 30 Tagen eingereicht, danach ist eine Erstattung
nicht mehr möglich.`;

const SECURITY = `# Sicherheitsrichtlinie

Diese Richtlinie gilt für alle Systeme, die Kundendaten verarbeiten.

## Zugangsdaten

Passwörter haben mindestens 16 Zeichen und werden ausschliesslich im
Passwortmanager gespeichert. Die Weitergabe von Zugangsdaten per E-Mail oder Chat
ist untersagt, auch intern.

## Zwei-Faktor-Authentifizierung

Zwei-Faktor-Authentifizierung ist für alle administrativen Zugänge verpflichtend.
Als zweiter Faktor sind Hardware-Token und TOTP-Apps zugelassen. SMS ist als
zweiter Faktor nicht zugelassen, da Rufnummern übernommen werden können.

## Datenaufbewahrung

Protokolldaten werden 90 Tage aufbewahrt und danach automatisch gelöscht.
Kundendaten werden nach Vertragsende innerhalb von 30 Tagen entfernt, sofern
keine gesetzliche Aufbewahrungspflicht besteht.

## Meldung von Vorfällen

Sicherheitsvorfälle werden unverzüglich an das Sicherheitsteam gemeldet, in
jedem Fall innerhalb von 24 Stunden nach Entdeckung. Die Meldung erfolgt über
die interne Notfalladresse, nicht über das reguläre Ticketsystem.

## Verschlüsselung

Daten werden im Transport mit TLS 1.3 geschützt. Ältere Protokollversionen sind
auf allen öffentlich erreichbaren Endpunkten deaktiviert. Ruhende Daten werden
mit AES-256 verschlüsselt. Die Schlüsselverwaltung liegt beim Cloud-Anbieter und
ist nicht Teil der Anwendung.

## Zugriffsrechte

Zugriffsrechte folgen dem Prinzip der geringsten Berechtigung. Neue Zugänge
werden von der Teamleitung genehmigt und quartalsweise überprüft. Zugänge von
Personen, die das Unternehmen verlassen, werden am letzten Arbeitstag entzogen,
nicht später.

## Endgeräte

Alle Arbeitsgeräte haben eine aktivierte Festplattenverschlüsselung und eine
automatische Bildschirmsperre nach fünf Minuten. Private Geräte werden nicht für
den Zugriff auf Kundendaten verwendet. Verlorene Geräte werden unverzüglich
gemeldet und aus der Ferne gesperrt.

## Software von Dritten

Neue Abhängigkeiten werden vor der Aufnahme geprüft: Herkunft, Pflegezustand und
Umfang der Berechtigungen. Bibliotheken ohne erkennbare Pflege werden nicht
aufgenommen. Sicherheitsupdates für eingesetzte Abhängigkeiten werden innerhalb
von sieben Tagen eingespielt.

## Sicherungskopien

Sicherungskopien werden täglich erstellt und 35 Tage aufbewahrt. Die
Wiederherstellung wird halbjährlich geprobt, weil eine Sicherung, die nie
zurückgespielt wurde, keine Sicherung ist.`;

export const EVAL_DOCUMENTS: EvalDocument[] = [
  {
    name: "onboarding-handbuch",
    text: HANDBOOK,
    cases: [
      {
        id: "handbook-urlaub-tage",
        question: "Wie viele Urlaubstage gibt es pro Jahr?",
        expectedContent: ["30 Tage"],
      },
      {
        id: "handbook-urlaub-verfall",
        question: "Wann verfällt nicht genommener Urlaub?",
        expectedContent: ["31. März"],
      },
      {
        id: "handbook-kernzeit",
        question: "Was ist die Kernarbeitszeit?",
        expectedContent: ["10:00", "15:00"],
      },
      {
        id: "handbook-weiterbildung-budget",
        question: "Wie hoch ist das Weiterbildungsbudget?",
        expectedContent: ["1500 Euro"],
      },
      {
        id: "handbook-laptop-lieferzeit",
        question: "Wie lange dauert die Bestellung eines Laptops?",
        expectedContent: ["fünf Werktage"],
      },
      {
        id: "handbook-homeoffice-zuschuss",
        question: "Wie hoch ist der Zuschuss für den häuslichen Arbeitsplatz?",
        expectedContent: ["800 Euro"],
      },
      {
        id: "handbook-probezeit",
        question: "Wie lange dauert die Probezeit?",
        expectedContent: ["sechs Monate"],
      },
      {
        id: "handbook-uebernachtung",
        question: "Bis zu welchem Betrag werden Übernachtungen erstattet?",
        expectedContent: ["150 Euro"],
      },
    ],
  },
  {
    name: "sicherheitsrichtlinie",
    text: SECURITY,
    cases: [
      {
        id: "security-passwortlaenge",
        question: "Wie lang muss ein Passwort mindestens sein?",
        expectedContent: ["16 Zeichen"],
      },
      {
        id: "security-sms-2fa",
        question: "Ist SMS als zweiter Faktor erlaubt?",
        expectedContent: ["SMS", "nicht zugelassen"],
      },
      {
        id: "security-protokoll-aufbewahrung",
        question: "Wie lange werden Protokolldaten aufbewahrt?",
        expectedContent: ["90 Tage"],
      },
      {
        id: "security-vorfall-frist",
        question: "Innerhalb welcher Frist muss ein Sicherheitsvorfall gemeldet werden?",
        expectedContent: ["24 Stunden"],
      },
      {
        id: "security-kundendaten-loeschung",
        question: "Wann werden Kundendaten nach Vertragsende gelöscht?",
        expectedContent: ["30 Tagen"],
      },
      {
        id: "security-tls-version",
        question: "Welche TLS-Version wird im Transport verwendet?",
        expectedContent: ["TLS 1.3"],
      },
      {
        id: "security-bildschirmsperre",
        question: "Nach welcher Zeit sperrt der Bildschirm automatisch?",
        expectedContent: ["fünf Minuten"],
      },
      {
        id: "security-backup-aufbewahrung",
        question: "Wie lange werden Sicherungskopien aufbewahrt?",
        expectedContent: ["35 Tage"],
      },
    ],
  },
];
