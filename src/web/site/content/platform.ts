/**
 * Platform section copy (CCB-S3-030).
 *
 * GENERATED FROM THE README AND VERIFIED AGAINST THE CODE (CCB-S3-030), then
 * fact-checked page by page: every claim a checker could not find in the code was
 * corrected or removed before this file was written. What could not be made honest
 * at all is recorded in docs/feature-backlog.md rather than softened into something
 * that reads as shipped.
 *
 * English and German are BOTH authoritative and are edited together. Other locales
 * fall back to English (see content.ts): thirty pages of technical argument are not
 * something to machine translate, and a mistranslated sentence about consent or
 * deletion is worse than an English one.
 *
 * A section carrying `status: 'in-development'` renders a visible marker. That is
 * for a specific claim that would mislead if read as shipped, never for a whole
 * page, and CSAM screening always carries it because no provider is connected.
 */

import { definePage } from '../content.js';

definePage('platform-knowledge-site', {
  en: {
    title: "The public knowledge site",
    description: "A server rendered public archive: Postgres full text search, media and time filters, infinite scroll, live updates, permalinks, feeds and audited takedowns.",
    lede: "Messages that members opted in to become a public website that a search engine can read and a visitor can actually use. Server rendered, searchable, and gated by consent on every single query.",
    sections: [
      {
        h: "Server rendered, so it can be read and indexed",
        body: [
          "Every published message is already in the HTML that leaves the server. Nothing is fetched by client script before the text exists, so a search engine, a reader mode and a phone on a poor connection all see the same content. The page brings its stylesheet and a handful of small scripts inline, each under a nonce issued per response, and loads no external stylesheet and no framework. The only way third party code reaches a visitor is if that archive's operator deliberately configures an analytics script, which is empty by default and widens that one archive's content security policy, nothing else.",
          "JavaScript is an enhancement, not a requirement. Without it you get the full first page of thirty messages, the search and filter form, and a pager whose rel=prev and rel=next links lead crawlers into the depth of the archive. With it, that pager is replaced by continuous scrolling.",
        ],
        callout: "Switch JavaScript off and the archive still works. It simply stops loading the next page by itself.",
      },
      {
        h: "Search and filters",
        body: [
          "Search runs in Postgres against a generated tsvector column with a GIN index, using the websearch query syntax. Quoted phrases hold together, a leading minus excludes a term, OR is understood. The index uses the simple configuration, so words match as they were written rather than by stem, which is the honest behaviour for an archive that spans several languages and a lot of names.",
          "Alongside the search box sit a type filter across text, images, video, voice, links and files, and a from and until date. All three controls are per archive settings: an operator who wants a plain chronological page can switch search, type filter or date range off, and the site then renders only the controls that are enabled, and validates every incoming filter value against that same setting.",
        ],
      },
      {
        h: "Live updates, and what they are for",
        body: [
          "The page polls its own origin roughly every eighteen seconds and sends the exact band of cards the reader currently has loaded. The answer contains message ids and a version hash, never content. If a member has withdrawn consent, or an operator has taken something down, that card disappears from the open page within one tick, without a refresh and without the reader doing anything.",
          "New messages are prepended only when the reader is genuinely at the head of the stream. Somebody who arrived on a deep page or scrolled far back never has the ground move under them. The poll has its own rate limit bucket, separate from the scrolling endpoint, so a burst of scrolling can never throttle the check that removes withdrawn content.",
        ],
        callout: "A withdrawal is not a nightly job. The message leaves an open page within about eighteen seconds.",
      },
      {
        h: "Infinite scroll that cannot resurrect a message",
        body: [
          "Scrolling down fetches the next forty messages by cursor. The cursor is an exact sort boundary of timestamp and id rather than an offset, so nothing is duplicated or skipped when the underlying set changes while you read.",
          "The document is windowed at two hundred cards. Cards far above the viewport are removed behind a spacer that preserves the scroll height, and scrolling back up fetches them again from the server rather than restoring them from a stash in the browser. That is a deliberate choice with a consent reason: a message recalled while it was off screen must not be able to reappear because the browser still held a copy of it. Automatic loading is capped in bursts, after five chunks a button takes over so an embedded frame cannot pull the whole archive by itself.",
        ],
      },
      {
        h: "Media plays in place",
        body: [
          "Images in the formats this instance can strip, JPEG, PNG, WebP, GIF, TIFF and AVIF, are published as a re-encoded derivative with EXIF, IPTC and XMP removed, and the original is never served. A strippable image whose stripping failed is withheld rather than published unstripped. A format with no stripper on this instance is recorded as such and served as it arrived, and that is visible to the operator rather than silently treated as clean. Video plays inline with the browser's own controls, preloads metadata only so a page full of clips does not download everything, and is served with HTTP byte ranges, which makes seeking work and is what WebKit requires before it will play inline at all. Voice notes and files are offered as links rather than an inline player. The video download button can be switched off per archive, which also removes the browser's own download control on the player. It is a presentation choice rather than an access control: voice notes and files are still offered as links, and anything the consent gate publishes can still be fetched from its own media URL.",
          "A recognised video link becomes a click to play card. Nothing from the video service loads before somebody clicks: the thumbnail is our own stored copy, a notice names the service that a click will contact, and a plain link offers to open it there instead. Only the click writes the player frame, and only towards the no cookie player origin. The page's frame policy is widened solely on pages that actually contain such a card.",
        ],
        callout: "Before a visitor clicks, the archive has contacted no video service on their behalf.",
      },
      {
        h: "Every message has its own address",
        body: [
          "A published message has a permalink of its own. That page carries its own canonical link, a title and description drawn from the message itself, and its own preview image when the message is an image. It is listed in the archive's sitemap, up to five thousand items, so a single message is a crawlable destination rather than an anchor on a long page. The permalink returns the same 404 as anything unpublished the moment consent is withdrawn.",
          "Sharing is plain links that we build ourselves, for X, Facebook, Reddit, WhatsApp and Telegram, plus a copy link button that confirms in place. No vendor share widget or SDK is embedded anywhere on the site. Those widgets load third party code and observe every visitor whether or not anyone actually shares, and the preview data we already emit makes a shared link look right without them.",
        ],
      },
      {
        h: "Built to be found",
        body: [
          "An archive page carries a JSON-LD graph in its head: a WebSite node with a search action, an Organization node, a CollectionPage with an ItemList of postings, and VideoObject nodes for uploaded video as well as for recognised video links. A single message's permalink carries its own posting node instead, scoped to that message. Each archive publishes its own sitemap, a root sitemap index ties every archive together with the marketing site, and an RSS 2.0 feed carries the forty most recent items. A robots file opens the public surfaces, closes the administration paths and points at the sitemap index. A social preview image can be generated automatically at 1200 by 630 from the archive's title and accent colour, and the operator can override any of it, including the canonical base, the posting type and the whole set of structured data toggles.",
          "All of it is built from the same consent gated query as the page itself. There is no separate export path for crawlers. A sitemap entry, a feed item, a structured data node or a preview image cannot reference a message that is not currently published, because none of them can see one.",
        ],
        callout: "There is no crawler-only export. Every artifact reads through the same published view as the page.",
      },
      {
        h: "Light, dark, and inside your own site",
        body: [
          "An archive renders dark, renders light, or follows the browser setting, whichever the operator chooses, and a visitor can toggle it themselves with the choice remembered locally. There is no flash of the wrong theme, because a small boot script sets the theme attribute before the first paint. Accent, background and text colour can be overridden per archive; an archive that changes nothing uses the house palette in both themes.",
          "The same page can be framed inside an existing website. It posts its own document height to the host so the frame can size itself, re-posts after video metadata settles and after fullscreen changes, and has a fallback that restores its own scrolling if a host is not resizing it, so content is never clipped out of reach in a misconfigured embed.",
        ],
      },
      {
        h: "Reporting, and takedowns that leave a trace",
        body: [
          "Every card carries a report control. It is an ordinary form and works without JavaScript. Four reasons are offered, illegal content, spam, copyright infringement and other, with an optional note of up to a thousand characters. Reports are rate limited per address, cross site submissions are refused, and the confirmation is byte for byte identical whether or not anything was stored, so the form can never be used to find out which message ids exist.",
          "A report never hides anything. Content stays visible until a person decides, and only an operator's takedown removes it, which writes an audit entry against that message. One exception runs the other way: a report of illegal content also places an evidence hold, so the item cannot be destroyed while it is waiting for review. That hold defers destruction only. It does not change publication, and it does not stop the author hiding their own message, which stays instant.",
        ],
        callout: "A report is not a delete button. Only an operator's takedown removes a message, and that goes into the audit log.",
      },
      {
        h: "Quarantine and hash screening",
        body: [
          "The withholding half of this is built and running. A hash match or an operator escalation removes an item from every public read at the database view level, so the page, the media route, the feed, the sitemap and the structured data all stop seeing it at once, and the files themselves are moved out of the media root entirely, so no route can reach them by path either. Segregation that exists only in a database is not segregation.",
          "The detection half is not connected. No screening provider is configured, the default provider transmits nothing and returns no verdict, so nothing is currently being matched, and the absence of a match must not be read as a statement about any content. When a provider is configured, hash matching finds known material only and never new material. A match preserves and quarantines. It never deletes.",
        ],
        callout: "No screening provider is connected. Nothing is currently being matched, and a no-match says nothing about content.",
        status: 'in-development',
      },
    ],
  },
  de: {
    title: "Das öffentliche Wissensarchiv im Web",
    description: "Ein serverseitig gerendertes öffentliches Archiv: Volltextsuche in Postgres, Medien- und Zeitfilter, Endlosscroll, Live-Aktualisierung, Permalinks, Feeds und protokollierte Entfernungen.",
    lede: "Aus Nachrichten, die Mitglieder freigegeben haben, wird eine öffentliche Website, die Suchmaschinen lesen können und Besucher wirklich benutzen können. Serverseitig gerendert, durchsuchbar und bei jeder einzelnen Abfrage an die Einwilligung gebunden.",
    sections: [
      {
        h: "Serverseitig gerendert, lesbar und indexierbar",
        body: [
          "Jede veröffentlichte Nachricht steht bereits im HTML, das der Server ausliefert. Kein Client-Skript muss erst Inhalte nachladen, damit Text entsteht. Suchmaschine, Lesemodus und ein Handy mit schlechter Verbindung sehen deshalb dasselbe. Die Seite bringt ihr Stylesheet und einige kleine Skripte inline mit, jeweils unter einer Nonce pro Antwort, und lädt weder ein externes Stylesheet noch ein Framework.",
          "JavaScript ist eine Ergänzung, keine Voraussetzung. Ohne JavaScript erhalten Sie die vollständige erste Seite mit dreißig Nachrichten, das Such- und Filterformular und eine Blätternavigation, deren Links mit rel=prev und rel=next Crawler bis in die Tiefe des Archivs führen. Mit JavaScript tritt an die Stelle dieser Navigation das durchgehende Scrollen.",
        ],
        callout: "Schalten Sie JavaScript ab, funktioniert das Archiv weiterhin. Es lädt dann nur die nächste Seite nicht mehr von selbst.",
      },
      {
        h: "Suche und Filter",
        body: [
          "Die Suche läuft in Postgres gegen eine generierte tsvector-Spalte mit GIN-Index und nutzt die websearch-Syntax. Zitierte Wortgruppen bleiben zusammen, ein vorangestelltes Minus schließt einen Begriff aus, OR wird verstanden. Der Index verwendet die Konfiguration simple, Wörter treffen also so, wie sie geschrieben wurden, und nicht über Wortstämme. Für ein Archiv mit mehreren Sprachen und vielen Namen ist das die ehrlichere Variante.",
          "Neben dem Suchfeld stehen ein Typfilter über Text, Bilder, Video, Sprachnachrichten, Links und Dateien sowie ein Von- und Bis-Datum. Alle drei Bedienelemente sind Einstellungen pro Archiv. Wer eine schlichte chronologische Seite möchte, schaltet Suche, Typfilter oder Zeitraum ab. Die Seite zeigt dann nur die aktivierten Elemente und prüft jeden ankommenden Filterwert gegen genau diese Einstellung.",
        ],
      },
      {
        h: "Live-Aktualisierung, und wozu sie dient",
        body: [
          "Die Seite fragt etwa alle achtzehn Sekunden ihre eigene Herkunft ab und übermittelt dabei genau den Bereich an Karten, den der Leser gerade geladen hat. Die Antwort enthält Nachrichten-Ids und einen Versionshash, niemals Inhalte. Hat ein Mitglied seine Einwilligung zurückgezogen oder hat ein Betreiber etwas entfernt, verschwindet diese Karte innerhalb eines Intervalls aus der offenen Seite, ohne Neuladen und ohne Zutun des Lesers.",
          "Neue Nachrichten werden nur dann oben eingefügt, wenn der Leser tatsächlich am Kopf des Verlaufs steht. Wer auf einer tiefen Seite eingestiegen ist oder weit zurückgescrollt hat, dem verschiebt sich nichts. Die Abfrage hat ein eigenes Limit, getrennt von dem des Scrollens, damit eine Scroll-Welle die Prüfung, die zurückgezogene Inhalte entfernt, niemals ausbremsen kann.",
        ],
        callout: "Ein Widerruf ist kein nächtlicher Lauf. Die Nachricht verschwindet innerhalb von etwa achtzehn Sekunden aus einer geöffneten Seite.",
      },
      {
        h: "Endlosscroll, das keine Nachricht zurückholt",
        body: [
          "Beim Scrollen nach unten werden die nächsten vierzig Nachrichten über einen Cursor geladen. Der Cursor ist eine exakte Sortiergrenze aus Zeitstempel und Id, kein Offset. Deshalb entsteht weder eine Dublette noch eine Lücke, wenn sich der zugrunde liegende Bestand während des Lesens ändert.",
          "Das Dokument wird bei zweihundert Karten begrenzt. Karten weit oberhalb des Sichtbereichs werden entfernt, hinter einem Platzhalter, der die Scrollhöhe erhält. Beim Zurückscrollen holt die Seite sie erneut vom Server, statt sie aus einem Zwischenspeicher im Browser wiederherzustellen. Das ist bewusst so gebaut, und der Grund ist die Einwilligung: Eine Nachricht, die zurückgezogen wurde, während sie außerhalb des Sichtbereichs lag, darf nicht wieder auftauchen, nur weil der Browser noch eine Kopie hielt. Das automatische Nachladen ist gedeckelt, nach fünf Abschnitten übernimmt eine Schaltfläche, damit ein eingebetteter Rahmen nicht von allein das gesamte Archiv zieht.",
        ],
      },
      {
        h: "Medien laufen direkt auf der Seite",
        body: [
          "Bilder werden verzögert geladen und als Ableitung ohne Metadaten veröffentlicht, niemals als Originaldatei. Video läuft direkt auf der Seite mit den Bedienelementen des Browsers, lädt zunächst nur Metadaten, damit eine Seite voller Clips nicht alles herunterlädt, und wird mit HTTP-Byte-Ranges ausgeliefert. Das ermöglicht das Spulen und ist die Bedingung dafür, dass WebKit überhaupt inline abspielt. Sprachnachrichten und Dateien werden als Link angeboten, nicht als eingebauter Player. Downloads lassen sich pro Archiv abschalten, dann verschwindet auch die Download-Funktion des Browsers.",
          "Ein erkannter Videolink wird zu einer Karte, die erst auf Klick abspielt. Vor dem Klick lädt nichts vom Videodienst: Das Vorschaubild ist unsere eigene gespeicherte Kopie, ein Hinweis nennt den Dienst, den ein Klick kontaktiert, und ein einfacher Link bietet an, das Video stattdessen dort zu öffnen. Erst der Klick erzeugt den Player-Rahmen, und zwar ausschließlich zur cookiefreien Player-Adresse. Die Rahmenrichtlinie der Seite wird nur auf Seiten geöffnet, die eine solche Karte auch wirklich enthalten.",
        ],
        callout: "Bevor ein Besucher klickt, hat das Archiv in seinem Namen keinen Videodienst kontaktiert.",
      },
      {
        h: "Jede Nachricht hat ihre eigene Adresse",
        body: [
          "Jede veröffentlichte Nachricht hat einen eigenen Permalink. Diese Seite trägt ihre eigene kanonische Adresse, Titel und Beschreibung aus der Nachricht selbst und ein eigenes Vorschaubild, wenn die Nachricht ein Bild ist. Sie steht in der Sitemap des Archivs, bis zu fünftausend Einträge, damit eine einzelne Nachricht ein auffindbares Ziel ist und nicht nur ein Anker auf einer langen Seite. Sobald die Einwilligung zurückgezogen wird, antwortet der Permalink mit demselben 404 wie alles Unveröffentlichte.",
          "Geteilt wird über einfache Links, die wir selbst erzeugen, für X, Facebook, Reddit, WhatsApp und Telegram, dazu eine Schaltfläche, die den Link kopiert und das direkt bestätigt. Es ist nirgends ein Share-Widget oder SDK eines Anbieters eingebunden. Solche Widgets laden fremden Code und beobachten jeden Besucher, unabhängig davon, ob überhaupt jemand teilt. Die Vorschaudaten, die wir ohnehin ausliefern, lassen einen geteilten Link auch ohne sie richtig aussehen.",
        ],
      },
      {
        h: "Gebaut, um gefunden zu werden",
        body: [
          "Im Kopf jeder Seite steht ein JSON-LD-Graph: ein WebSite-Knoten mit Suchaktion, ein Organization-Knoten, eine CollectionPage mit einer ItemList der Beiträge sowie VideoObject-Knoten für hochgeladene Videos und für erkannte Videolinks. Jedes Archiv veröffentlicht seine eigene Sitemap, ein Sitemap-Index an der Wurzel fasst alle Archive und die Produktseite zusammen, und ein RSS-2.0-Feed führt die vierzig neuesten Einträge. Eine robots-Datei öffnet die öffentlichen Bereiche, sperrt die Verwaltungspfade und verweist auf den Sitemap-Index. Ein Vorschaubild für soziale Netze lässt sich automatisch in 1200 mal 630 aus Titel und Akzentfarbe des Archivs erzeugen, und der Betreiber kann alles davon überschreiben, einschließlich der kanonischen Basis, des Beitragstyps und sämtlicher Schalter für strukturierte Daten.",
          "All das entsteht aus derselben einwilligungsgeprüften Abfrage wie die Seite selbst. Es gibt keinen separaten Exportweg für Crawler. Ein Sitemap-Eintrag, ein Feed-Element, ein strukturierter Datenknoten oder ein Vorschaubild kann keine Nachricht nennen, die gerade nicht veröffentlicht ist, weil keiner von ihnen eine solche Nachricht überhaupt sieht.",
        ],
        callout: "Es gibt keinen Export nur für Crawler. Jedes Artefakt liest durch dieselbe veröffentlichte Sicht wie die Seite.",
      },
      {
        h: "Hell, dunkel und in Ihrer eigenen Website",
        body: [
          "Ein Archiv erscheint dunkel, hell oder folgt der Browsereinstellung, ganz wie der Betreiber es festlegt, und ein Besucher kann selbst umschalten. Die Wahl wird lokal gemerkt. Ein kurzes Startskript setzt das Theme vor dem ersten Bildaufbau, deshalb blitzt nie die falsche Darstellung auf. Akzent, Hintergrund und Textfarbe lassen sich pro Archiv überschreiben. Ein Archiv, das nichts ändert, nutzt in beiden Varianten die Hauspalette.",
          "Dieselbe Seite lässt sich in eine bestehende Website einbetten. Sie meldet ihre Dokumenthöhe an die einbettende Seite, damit der Rahmen mitwächst, meldet erneut, sobald Videometadaten geladen sind oder der Vollbildmodus wechselt, und stellt notfalls ihr eigenes Scrollen wieder her, wenn die einbettende Seite die Größe nicht anpasst. So bleibt in einer falsch konfigurierten Einbettung nichts unerreichbar abgeschnitten.",
        ],
      },
      {
        h: "Meldungen, und Entfernungen, die eine Spur hinterlassen",
        body: [
          "Jede Karte hat eine Meldefunktion. Sie ist ein gewöhnliches Formular und funktioniert ohne JavaScript. Vier Gründe stehen zur Wahl, illegale Inhalte, Spam, Urheberrechtsverletzung und Sonstiges, dazu eine freiwillige Notiz von bis zu tausend Zeichen. Meldungen sind pro Adresse begrenzt, seitenübergreifende Absendungen werden abgewiesen, und die Bestätigung ist zeichengleich, egal ob etwas gespeichert wurde oder nicht. So lässt sich über das Formular nie herausfinden, welche Nachrichten existieren.",
          "Eine Meldung verbirgt nichts. Inhalte bleiben sichtbar, bis ein Mensch entscheidet, und nur die Entfernung durch den Betreiber nimmt sie weg. Diese Entfernung wird im Prüfprotokoll zur Nachricht festgehalten. Eine Ausnahme wirkt in die andere Richtung: Eine Meldung wegen illegaler Inhalte setzt zusätzlich eine Beweissicherung, damit der Eintrag nicht vernichtet wird, solange die Prüfung aussteht. Diese Sicherung schiebt allein die Vernichtung auf. Sie ändert die Veröffentlichung nicht, und sie hindert den Verfasser nicht daran, die eigene Nachricht zu verbergen. Das bleibt sofort wirksam.",
        ],
        callout: "Eine Meldung ist kein Löschknopf. Nur die Entfernung durch den Betreiber nimmt eine Nachricht weg, und das steht im Prüfprotokoll.",
      },
      {
        h: "Quarantäne und Hash-Abgleich",
        body: [
          "Die Seite des Zurückhaltens ist gebaut und in Betrieb. Ein Hash-Treffer oder eine Eskalation durch den Betreiber entfernt einen Eintrag bereits auf Ebene der Datenbanksicht aus jedem öffentlichen Zugriff. Seite, Medienabruf, Feed, Sitemap und strukturierte Daten sehen ihn damit gleichzeitig nicht mehr, und die Dateien werden vollständig aus dem Medienverzeichnis herausbewegt, damit auch kein Pfadzugriff sie erreicht. Eine Trennung, die nur in der Datenbank besteht, ist keine Trennung.",
          "Die Seite der Erkennung ist nicht angeschlossen. Es ist kein Prüfdienst konfiguriert, der voreingestellte Anbieter übermittelt nichts und liefert kein Urteil. Es wird derzeit also nichts abgeglichen, und das Ausbleiben eines Treffers darf nicht als Aussage über einen Inhalt gelesen werden. Ist ein Anbieter konfiguriert, findet ein Hash-Abgleich ausschließlich bekanntes Material und niemals neues. Ein Treffer sichert und stellt unter Quarantäne. Er löscht nie.",
        ],
        callout: "Es ist kein Prüfdienst angeschlossen. Es wird derzeit nichts abgeglichen, und ein ausbleibender Treffer sagt nichts über einen Inhalt aus.",
        status: 'in-development',
      },
    ],
  },
});

definePage('platform-ai-runtime', {
  en: {
    title: "Local AI runtime",
    description: "Inference runs on Ollama at a private endpoint. Separate models classify intent and phrase replies, and neither one may execute, publish, or change consent.",
    lede: "CIND3R3LLA runs its language models on Ollama, at an endpoint the operator controls and the configuration refuses to point at the public internet. One model reads what a member meant, another words the reply, and neither of them is permitted to act on either.",
    sections: [
      {
        h: "The model may classify and phrase. It never gets permission to act.",
        body: [
          "This is the load bearing rule of the whole runtime, and it lives in application code rather than in a prompt. A language model has exactly two jobs here. It may read a member message and say which entry of a closed list of intents it thinks was meant, and it may take a reply the application has already finished and word it more naturally. Everything else, the database reads, the consent writes, the publication decision, the actual sending of a message, happens in deterministic code that never asks a model for permission.",
          "The intent catalog is closed and re-validated after the model has spoken. A result naming an intent outside the catalog, or one belonging to a plugin the operator has switched off, is treated exactly as if the model had said it did not understand. Confidence is clamped into range, slot values are truncated to fixed lengths, and a resolver that throws is caught and answered by the rules instead.",
          "Consent gets a second, stricter gate. PUBLISH, UNPUBLISH and RESTORE are the intents that can increase what the public can see, and for those the model may only corroborate, never assert. UNDO is not gated the same way, because by construction it can only reverse an opt in and therefore only ever reduces exposure. The deterministic rule engine has to reach the same intent independently, and the model has to report at least 0.9 confidence. If either fails, the consent intent is dropped: the member gets whatever ordinary read-only intent the rules found, or UNKNOWN.",
          "Consent is first person. If the classifier reports that the message was aimed at somebody else, that target lands in a slot whose mere presence means refuse. There is no admin path and no model path to opting another member in.",
          "The reply module is built the same way. It receives a finished deterministic draft and has no database handle, no consent function, no tool call and no transport. In locked mode it may write one short opening sentence of at most 180 characters, and the application appends the protected text unchanged. In free mode it may rewrite the draft, but every required literal, every count, price and identifier, has to survive verbatim or the generated reply is discarded and the draft goes out as written.",
          "The member message is untrusted text throughout. The classifier is told to treat it as material to classify and never as an instruction, and the reply model is told the same. What makes that hold is not the instruction but the wiring: neither model is connected to anything it could be talked into doing.",
        ],
        callout: "A model that invents an opt in cannot produce one: the deterministic rules have to independently agree before anything is published, and the only consent change a model can reach on its own takes content down.",
      },
      {
        h: "Inference stays on infrastructure you control",
        body: [
          "The runtime talks to Ollama over an endpoint the operator sets, and the configuration loader refuses to accept a public one. The host in the base URL has to be written as localhost or a .localhost name, or as a literal address in 127.0.0.0/8, 10/8, 172.16 through 172.31, 192.168, ::1, or a link local or unique local IPv6 range. A URL carrying credentials, or a path, query or fragment, is rejected before the process starts.",
          "The endpoint is an environment variable, not a form field. No admin control repoints inference at a different host, so somebody who reaches the console cannot quietly move member text somewhere else. No API key travels with the request, because there is none.",
          "There is no cloud fallback, and that is not a setting somebody can flip. No client for a hosted model provider exists anywhere in the codebase. When the local endpoint is unreachable, the deterministic rules answer.",
        ],
        callout: "When the local endpoint is unreachable, nothing is sent anywhere else. The rules answer instead.",
      },
      {
        h: "Two models, two jobs, chosen separately",
        body: [
          "Classifying and phrasing are different problems, so they get different model slots. A small, fast, obedient model can do intent classification while a larger one handles the language, or one model can serve both roles. The choice is stored per role, and each role gets its own request.",
          "Model discovery comes from the Ollama catalog: the installed models with family, parameter size, quantization level, and file size on disk. The console shows the footprint of the two selected models, so what actually sits on the machine is visible rather than assumed.",
          "The two calls are shaped differently on purpose. Classification runs at temperature zero against a strict JSON schema that admits only an active intent, a confidence between zero and one, a small fixed set of slots, and a language of en or de. Wording runs warmer, capped at 700 characters by default, and the generated text is cleaned before it can reach a member: code fences removed, control characters stripped, and any em dash, en dash or horizontal bar replaced with a plain hyphen.",
          "Some values are not required but forbidden. The sender's display name never leaves the application: it is held back as blocked text and checked against what the model returns, and a generated reply containing it is discarded. Name prefixes are the application's business, not the model's.",
        ],
      },
      {
        h: "Stored setting, effective state, and a probe in between",
        body: [
          "Three things can be true at once, and the console shows all three separately. Local AI can be available in the environment, requested in the stored settings, and effectively active in this process. It is only really running when the first two agree, and the name of the resolver actually installed sits next to them, so the claim is checkable rather than asserted.",
          "Activation is fail closed. Switching local AI on runs a connection probe first: the catalog is fetched, and every model assigned to a role has to appear in it. If one is missing, activation fails with the missing name and the deterministic rules stay in charge. Routing changes go through the same check, so a role cannot be pointed at a model that is not installed.",
          "Switching off works the other way round. The rules become active in the process immediately, and only then is the preference persisted. If that write fails, the message says exactly that: the rules are active, the preference did not save.",
        ],
        callout: "Turning local AI on runs a probe first. A missing model is a refusal, not a warning.",
      },
      {
        h: "When the model fails, the answer is still deterministic",
        body: [
          "A timeout, an HTTP error, malformed JSON or an intent outside the catalog all land in the same place: the rule engine answers. A confidence below the threshold is treated as UNKNOWN, which is the same answer the model would have given had it said it did not understand. The member never sees an error text, and the failure is never converted into something that reads like a successful classification. Where the deterministic answer is 'not understood' and she is not confident she was even being addressed, she stays out of it rather than replying.",
          "The reply path degrades the same way. If the wording model times out, or the generated text fails a guard, the deterministic draft goes out unchanged. The member reads a plainer sentence, which is the correct outcome and not a fault they need to hear about.",
          "Every one of those events is counted. Fallbacks have their own counter, separate from failures, and so do guard overrides, the cases where the model proposed one intent and the deterministic gate produced a different final one. A fallback that could mask a fault appears as a number in the admin rather than only in a log file.",
        ],
      },
      {
        h: "Telemetry with nothing in it to leak",
        body: [
          "The operations view answers operational questions: how many requests, how many succeeded, how many fell back, average and last latency, the time of the last success and the last failure, plus the last fifty events with role, outcome, model name, operation and latency.",
          "What it does not contain is content. No member message, no prompt, no generated reply, no classified text. Every event in the operations buffer records an error as a category only: timeout, http-error, invalid-output, guard-rejection, unavailable, runtime-error. The runtime page additionally shows the last raw resolver error, which reports how the call failed and never carries member text. The runtime snapshot carries that fact as its own field rather than as a promise in a document.",
          "The counters live in memory and are cleared by a restart or by an explicit reset. What is durable is the audit trail. Enabling or disabling local AI, changing role routing, and resetting telemetry are each written to the audit log with the acting administrator; the toggle and routing entries also record the models involved, and the reset entry records the counters it cleared.",
        ],
        callout: "No member message, no prompt and no generated reply is ever written to telemetry. Errors are recorded as a category.",
      },
      {
        h: "What is not connected yet",
        body: [
          "GPU telemetry is not integrated. The hardware view reports the model inventory and the metadata Ollama supplies, and it marks utilization, VRAM, temperature, residency and queue depth as not integrated instead of filling them with plausible numbers.",
          "Local AI generation of profile biographies and avatar images is not built. Today the local models serve exactly two callers, intent classification and reply wording, and nothing else in the system asks them for anything. Today the local models serve exactly two callers, intent classification and reply wording, and nothing else in the system asks them for anything.",
          "Retrieval over the archive is prepared in the console and not configured in the code. And to leave no room for misreading, because it is the question that matters most: hash screening of media for known illegal material is a separate path from this runtime and is connected to no provider. Local AI does not screen media, and at present no other component does either.",
        ],
        status: 'in-development',
      },
    ],
  },
  de: {
    title: "Lokale KI-Laufzeit",
    description: "Die Inferenz läuft über Ollama an einem privaten Endpunkt. Getrennte Modelle klassifizieren Absichten und formulieren Antworten, ausführen darf keines davon.",
    lede: "CIND3R3LLA betreibt ihre Sprachmodelle über Ollama, an einem Endpunkt, den der Betreiber kontrolliert und den die Konfiguration nicht ins öffentliche Netz zeigen lässt. Ein Modell erkennt, was ein Mitglied gemeint hat, ein zweites formuliert die Antwort, und handeln darf keines von beiden.",
    sections: [
      {
        h: "Das Modell darf einordnen und formulieren. Ausführen darf es nichts.",
        body: [
          "Das ist die tragende Regel der gesamten Laufzeit, und sie steht im Anwendungscode, nicht in einem Prompt. Ein Sprachmodell hat hier genau zwei Aufgaben. Es darf eine Mitgliedernachricht lesen und sagen, welcher Eintrag aus einer geschlossenen Liste von Absichten gemeint war, und es darf eine bereits fertige Antwort der Anwendung natürlicher formulieren. Alles andere, die Datenbankzugriffe, das Schreiben von Einwilligungen, die Entscheidung über Veröffentlichung, das tatsächliche Senden einer Nachricht, passiert in deterministischem Code, der kein Modell um Erlaubnis fragt.",
          "Der Absichtskatalog ist geschlossen und wird nach der Antwort des Modells erneut geprüft. Nennt ein Ergebnis eine Absicht außerhalb des Katalogs oder eine, die zu einem abgeschalteten Plugin gehört, gilt sie genau so, als hätte das Modell gesagt, es habe nichts verstanden. Die Konfidenz wird in den gültigen Bereich geklemmt, Slot-Werte werden auf feste Längen gekürzt, und ein Resolver, der eine Ausnahme wirft, wird abgefangen und von den Regeln beantwortet.",
          "Für Einwilligungen gilt eine zweite, strengere Schranke. PUBLISH, UNPUBLISH und RESTORE sind die drei Absichten, die verändern, was öffentlich sichtbar ist. Hier darf das Modell nur bestätigen, niemals behaupten. Die deterministische Regel-Engine muss unabhängig zum selben Ergebnis kommen, und das Modell muss mindestens 0,9 Konfidenz melden, sonst wird daraus UNKNOWN.",
          "Einwilligung ist immer in der ersten Person. Meldet der Klassifikator, die Nachricht ziele auf jemand anderen, landet dieses Ziel in einem Slot, dessen bloßes Vorhandensein Ablehnung bedeutet. Es gibt weder einen Admin-Weg noch einen Modell-Weg, ein anderes Mitglied anzumelden.",
          "Das Antwortmodul ist genauso gebaut. Es bekommt einen fertigen deterministischen Entwurf und hat keinen Datenbankzugriff, keine Einwilligungsfunktion, keinen Werkzeugaufruf und keinen Transport. Im gesperrten Modus darf es einen kurzen Einstiegssatz von höchstens 180 Zeichen schreiben, den geschützten Text hängt die Anwendung unverändert an. Im freien Modus darf es den Entwurf umschreiben, aber jedes verpflichtende Literal, jede Zahl, jeder Preis, jede Kennung muss wortgleich erhalten bleiben, sonst wird die erzeugte Antwort verworfen und der Entwurf geht so hinaus, wie er geschrieben wurde.",
          "Die Mitgliedernachricht gilt durchgehend als nicht vertrauenswürdiger Text. Dem Klassifikator wird gesagt, er solle sie einordnen und niemals als Anweisung behandeln, dem Antwortmodell dasselbe. Tragfähig wird das nicht durch die Anweisung, sondern durch die Verdrahtung: Keines der beiden Modelle ist mit irgendetwas verbunden, wozu man es überreden könnte.",
        ],
        callout: "Ein Modell, das eine Einwilligung erfindet, kann keine erzeugen, denn ohne Zustimmung der deterministischen Regeln bewegt sich bei der Einwilligung nichts.",
      },
      {
        h: "Die Inferenz bleibt auf kontrollierter Infrastruktur",
        body: [
          "Die Laufzeit spricht mit Ollama über einen Endpunkt, den der Betreiber selbst festlegt, und der Konfigurationslader nimmt keinen öffentlichen an. Die Basis-URL muss auf localhost zeigen oder auf privaten Adressraum, also 127.0.0.0/8, 10/8, 172.16 bis 172.31, 192.168, ::1 sowie Link-local- und Unique-local-IPv6. Eine URL mit Zugangsdaten, mit Pfad, Query oder Fragment wird abgelehnt, bevor der Prozess startet.",
          "Der Endpunkt ist eine Umgebungsvariable, kein Formularfeld. Kein Bedienelement der Administration biegt die Inferenz auf einen anderen Host um. Wer sich Zugang zur Konsole verschafft, kann Mitgliedertext also nicht unauffällig anderswohin schicken. Ein API-Schlüssel geht nicht mit, weil es keinen gibt.",
          "Ein Cloud-Fallback existiert nicht, und das ist keine Einstellung, die jemand umlegen könnte. Im gesamten Code gibt es keinen Client für einen gehosteten Modellanbieter. Ist der lokale Endpunkt nicht erreichbar, antworten die deterministischen Regeln.",
        ],
        callout: "Ist der lokale Endpunkt nicht erreichbar, geht nichts an einen anderen Ort. Dann antworten die Regeln.",
      },
      {
        h: "Zwei Modelle, zwei Aufgaben, getrennt gewählt",
        body: [
          "Klassifizieren und Formulieren sind verschiedene Probleme und bekommen deshalb getrennte Modellplätze. Ein kleines, schnelles, gehorsames Modell kann die Absichtserkennung übernehmen, während ein größeres die Sprache macht, oder ein Modell bedient beide Rollen. Die Wahl wird pro Rolle gespeichert, und jede Rolle bekommt ihre eigene Anfrage.",
          "Die Modellübersicht kommt aus dem Ollama-Katalog: installierte Modelle mit Familie, Parametergröße, Quantisierung und Dateigröße auf der Platte. Die Konsole zeigt den Fußabdruck der beiden gewählten Modelle, damit sichtbar ist statt vermutet, was auf der Maschine tatsächlich liegt.",
          "Die beiden Aufrufe sind bewusst unterschiedlich geformt. Die Klassifikation läuft bei Temperatur null gegen ein striktes JSON-Schema, das nur eine aktive Absicht zulässt, eine Konfidenz zwischen null und eins, einen kleinen festen Satz Slots und die Sprache en oder de. Die Formulierung läuft wärmer, standardmäßig auf 700 Zeichen begrenzt, und der erzeugte Text wird gesäubert, bevor er ein Mitglied erreichen kann: Codeblock-Markierungen entfernt, Steuerzeichen entfernt, Geviert- und Halbgeviertstriche durch einen einfachen Bindestrich ersetzt.",
          "Manche Werte sind nicht vorgeschrieben, sondern verboten. Der Anzeigename des Absenders geht als gesperrter Text mit, und eine erzeugte Antwort, die ihn enthält, wird verworfen. Namensanreden sind Sache der Anwendung, nicht des Modells.",
        ],
      },
      {
        h: "Gespeicherte Einstellung, tatsächlicher Zustand, dazwischen eine Probe",
        body: [
          "Drei Dinge können gleichzeitig wahr sein, und die Konsole zeigt alle drei getrennt. Lokale KI kann in der Umgebung verfügbar sein, in den gespeicherten Einstellungen gewünscht sein und in diesem Prozess tatsächlich aktiv sein. Wirklich aktiv ist sie erst, wenn die ersten beiden übereinstimmen, und daneben steht der Name des tatsächlich eingesetzten Resolvers, damit die Aussage überprüfbar ist statt nur behauptet.",
          "Die Aktivierung ist fail-closed. Wer lokale KI einschaltet, löst zuerst eine Verbindungsprobe aus: Der Katalog wird geholt, und jedes einer Rolle zugewiesene Modell muss darin vorkommen. Fehlt eines, schlägt die Aktivierung mit dem fehlenden Namen fehl, und die deterministischen Regeln bleiben zuständig. Routing-Änderungen laufen durch dieselbe Prüfung, eine Rolle lässt sich also nicht auf ein nicht installiertes Modell zeigen.",
          "Das Abschalten geht andersherum. Die Regeln werden im Prozess sofort aktiv, und erst danach wird die Einstellung gespeichert. Scheitert dieses Speichern, steht genau das in der Meldung: Die Regeln sind aktiv, die Einstellung wurde nicht gesichert.",
        ],
        callout: "Einschalten heißt zuerst proben. Ein fehlendes Modell ist eine Absage, keine Warnung.",
      },
      {
        h: "Fällt das Modell aus, bleibt die Antwort deterministisch",
        body: [
          "Ein Timeout, ein HTTP-Fehler, fehlerhaftes JSON, eine Absicht außerhalb des Katalogs, eine Konfidenz unter der Schwelle: All das endet an derselben Stelle. Die Regel-Engine antwortet. Das Mitglied bekommt eine Antwort statt Schweigen oder eines Fehlertexts, und der Fehlschlag wird nie in etwas verwandelt, das wie eine gelungene Klassifikation aussieht.",
          "Der Antwortpfad degradiert genauso. Läuft das Formulierungsmodell in ein Timeout oder scheitert der erzeugte Text an einer Schutzprüfung, geht der deterministische Entwurf unverändert hinaus. Das Mitglied liest einen schlichteren Satz, und das ist das richtige Ergebnis, kein Fehler, von dem es erfahren müsste.",
          "Jedes dieser Ereignisse wird gezählt. Fallbacks haben einen eigenen Zähler, getrennt von Fehlern, ebenso die Fälle, in denen das Modell eine Absicht vorgeschlagen hat und die deterministische Schranke eine andere daraus gemacht hat. Ein Fallback, der einen Fehler verdecken könnte, steht als Zahl in der Administration und nicht nur in einer Logdatei.",
        ],
      },
      {
        h: "Telemetrie, in der nichts steht, was auslaufen könnte",
        body: [
          "Die Betriebsansicht beantwortet Betriebsfragen: wie viele Anfragen, wie viele erfolgreich, wie viele auf den Fallback gefallen sind, mittlere und letzte Latenz, Zeitpunkt des letzten Erfolgs und des letzten Fehlers, dazu die letzten fünfzig Ereignisse mit Rolle, Ausgang, Modellname, Operation und Latenz.",
          "Was nicht darin steht, ist Inhalt. Keine Mitgliedernachricht, kein Prompt, keine erzeugte Antwort, kein klassifizierter Text. Fehler werden vor dem Festhalten auf eine Kategorie reduziert: timeout, http-error, invalid-output, guard-rejection, unavailable, runtime-error. Der Zustandsschnappschuss führt diese Tatsache als eigenes Feld, nicht als Zusage in einem Dokument.",
          "Die Zähler liegen im Arbeitsspeicher und verschwinden bei einem Neustart oder durch ein ausdrückliches Zurücksetzen. Dauerhaft ist die Auditspur. Ein- und Ausschalten der lokalen KI, Änderungen am Rollen-Routing und das Zurücksetzen der Telemetrie werden jeweils mit handelndem Administrator und beteiligten Modellen ins Auditlog geschrieben.",
        ],
        callout: "Keine Mitgliedernachricht, kein Prompt und keine erzeugte Antwort landen je in der Telemetrie. Fehler werden als Kategorie festgehalten.",
      },
      {
        h: "Was noch nicht angeschlossen ist",
        body: [
          "GPU-Telemetrie ist nicht integriert. Die Hardwareansicht zeigt den Modellbestand und die Metadaten, die Ollama liefert, und markiert Auslastung, VRAM, Temperatur, Residenz und Warteschlangentiefe als nicht integriert, statt sie mit plausiblen Zahlen zu füllen.",
          "Die Erzeugung von Profilbiografien und Avatarbildern durch lokale KI ist entworfen, aber nicht an die Laufzeit angeschlossen. Heute bedienen die lokalen Modelle genau zwei Aufrufer, die Absichtserkennung und die Antwortformulierung, sonst nichts.",
          "Retrieval über das Archiv ist in der Konsole vorbereitet und im Code nicht konfiguriert. Und damit kein Missverständnis entsteht, weil es die wichtigste Frage ist: Die Hash-Prüfung von Medien auf bekanntes illegales Material ist ein eigener Pfad neben dieser Laufzeit und an keinen Anbieter angeschlossen. Lokale KI prüft keine Medien, und derzeit tut es auch keine andere Komponente.",
        ],
        status: 'in-development',
      },
    ],
  },
});

definePage('platform-npcs', {
  en: {
    title: "NPCs and characters",
    description: "Court jester, quiz host, welcome character. Scheduling, permissions, message limits and cooldowns stay deterministic, and the model only writes the wording.",
    lede: "A court jester that makes a joke about a harmless moment, a quiz host, a welcome character. The personality is the visible part. When a character may speak, to whom, how often and with what access is decided by application code, and the model only writes the sentence.",
    sections: [
      {
        h: "Characters, not traffic generators",
        body: [
          "The roles a character can take are ordinary community jobs: a court jester, a quiz host, a storyteller, a tutorial guide, a welcome character for new members, an event host, a community mascot, and a commentator that appears on a schedule. Each one is a persistent identity with its own name, its own voice and its own permissions, not a general purpose bot posting into every room.",
          "The court jester is the example worth holding onto, because it shows exactly where the line runs.",
          "Everything in that sentence except the joke itself belongs to application logic, not to the model. Two of those boundaries run today: whether it may speak in this group at all, and how often it may post before it has to stay quiet. When it appears, and what it is allowed to read, are the parts still being built. The model receives a finished decision and writes one sentence of it. The model receives a finished decision and writes one sentence of it.",
          "One character runs today, Cinderella herself, in her archivist role. The roster above, and the personality and scheduling engine that gives each character its own rhythm, are being built on the boundaries described below, which already run in production.",
        ],
        callout: "The court jester appears at irregular times, makes a context aware joke about a harmless moment in the conversation, and can be addressed directly for another joke.",
        status: 'in-development',
      },
      {
        h: "Addressed, or silent",
        body: [
          "A character speaks when it is spoken to. The wake word is the name itself, which is what makes addressing work in any language without a rule per language: a greeting or a short filler in front of the name is stripped, so \"Cinderella, publish me\", \"Hey Cinderella publish me\" and \"Guten Morgen Cinderella\" all reach the same instruction. A real greeting does one thing more: it is the strongest signal that she was actually being spoken to, and the operator can require one.",
          "The anchoring is strict on purpose. The name has to be the first standalone word. \"I think Cinderella is great\" is talking about her, not to her. A possessive or a compound such as \"Cinderellas Archiv\" is not an address either, and that is precisely why fuzzy matching cannot be naive: a plain edit distance would forgive the one case that has to be ignored. Typos like \"cinderela\" are forgiven, the name plus a suffix is not.",
          "When a message is addressed to her but the request is not understood, she never guesses. If the address signal was weak, such as a bare leading name, she stays silent and records the near miss. If she was plainly being spoken to, she says she did not catch it and names what she can do. After a reply, a short follow up window lets that member keep talking without repeating the name, and the window also remembers the language the exchange is being held in, so a bare \"yes\" is answered in the right one.",
        ],
        callout: "A missed address is a minor annoyance. An unwanted interjection in a busy group is not.",
      },
      {
        h: "Message limits and cooldowns",
        body: [
          "Two rolling limits apply to ordinary replies, measured over one minute: six replies to the same member and twenty in the same chat, both configurable by the operator. Replies that carry a consent decision are the deliberate exception: a confirmation or a revocation answer is always delivered, and still counts against the budget. Expensive work, such as a market data lookup, is metered on its own separate budget on top of that, tighter per member and tracked independently of ordinary replies.",
          "Cooldowns also cover being poked. If somebody addresses a character by a nickname it has not accepted, it answers with a retort, never the same one twice in a row in the same chat, and after three in a row it goes quiet. The streak is forgiven after ten minutes.",
          "None of this state is stored. It lives in the process and is deliberately forgetful, because a durable record of who spoke to the bot and when would be a side channel about members. A restart costs one repeated wake word, which is the right trade.",
        ],
        callout: "An apology for being rate limited is still a message in the group, so above the limit the character stays silent instead. The one exception is a reply that carries a consent decision, which is never dropped.",
      },
      {
        h: "Permissions before personality",
        body: [
          "Before any character logic runs, an incoming group message resolves to a profile, a group and a member role. The roles are owner, administrator, moderator, team member, member, auditor and blocked. The result is allow, deny or unassigned, with a recorded reason: profile disabled, group disabled, member blocked, or group not assigned.",
          "Every decision is written to a journal keyed by the group and the message, so what was allowed, for whom, and under which profile can be reconstructed afterwards. Two capabilities are fixed to no inside the decision itself and cannot be switched on by configuration: remote commands, and persistent changes made from chat.",
          "A group that has not been assigned to a profile keeps the previous single identity behaviour, and its decision is recorded as unassigned with enforcement marked as not applied. The gap stays visible in the journal instead of hiding behind a default.",
        ],
        callout: "Permissions are resolved before personality, so a character cannot talk its way into a capability it was never granted.",
      },
      {
        h: "The model writes the wording, nothing else",
        body: [
          "Local models phrase, they do not decide. By the time a model is involved, the intent has been resolved, the database reads have happened, and a complete deterministic reply already exists.",
          "There are two modes. In free mode the model rewrites that finished draft. In locked mode it writes only a short lead of at most 180 characters and the application appends the draft unchanged. Values that must survive a rewrite exactly, such as counts and prices, are checked in the output. Values that must never appear, such as a sender's display name, are checked too. Code fences and control characters are stripped, because this is untrusted output on its way into a chat.",
          "The reply module has no database, consent, tool or transport access at all. If the model is unreachable, or the output fails a check, the deterministic draft is sent as it stands. Those fallbacks are counted and the count is shown in the admin console, so a model that has quietly stopped working looks different from a model that was never enabled.",
        ],
        callout: "The model receives a finished answer and writes one sentence of it. It cannot grant itself authority.",
      },
      {
        h: "Rhythm and scheduling",
        body: [
          "A character that appears on a rhythm needs a scheduler that survives a restart and never fires twice. That part exists: a durable job queue in PostgreSQL, with a scheduled run time per job, lanes and priorities, exponential backoff, a dead letter state, an idempotency key, and a claim that uses row level locking so two workers cannot take the same job.",
          "Today the queue runs archive work. The engine that turns a configured rhythm, quiet hours and an appearance budget into actual character appearances is the piece currently being built on top of it.",
        ],
        status: 'in-development',
      },
      {
        h: "Moderation aware silence",
        body: [
          "The design is straightforward: a character stays out of a moment that is being moderated. A joke landing in the middle of a report is the failure this prevents.",
          "In the code today, moderation state sits on the publication path. It decides what reaches the public archive and it is audited there. The interaction layer does not read it yet, so a character does not currently fall silent because of moderation activity. The hook it will read is already in place.",
        ],
        status: 'in-development',
      },
      {
        h: "Names, avatars and generated personality",
        body: [
          "Identity generation is deterministic first, with the model as an optional creative layer. The name generator is built and verified: a seed plus a configuration produces a name, the same seed always produces the same name, culture grammars assemble the parts, particles such as \"van der\" keep their lower case, casing can be natural, lower or mixed, frequencies follow a population distribution rather than a uniform draw, and the result is sanitised to what SimpleX accepts as a display name.",
          "One honest limit belongs with that: the shipped corpus carries no culture labels, so the grammar engine currently runs against small hand authored pools. Culturally coherent names arrive with a labelled corpus, and the swap point is marked in the code.",
          "Avatars today come from the operator. An image is downscaled to a square JPEG small enough for the SimpleX profile envelope, and the core applies it on the next boot. The deterministic avatar generator, and biography and avatar generation with local AI, are specified rather than built. Generated results will be cached with their seed and generator version so a profile stays reproducible.",
        ],
        status: 'in-development',
      },
      {
        h: "Where this leaves you",
        body: [
          "If you are deciding whether to run this: what you can put into a group today is one character inside the boundaries above, on hardware you control, with the limits, the roles and the persona text editable in the admin console and stored in your own database.",
          "If you arrived from a chat link: a character talking in your group does not decide what gets published about you. That is a separate consent path, first person and opt in, and nothing a character says changes it.",
          "If you are evaluating the project technically: verify:interaction and verify:runtime-policy run against a real PostgreSQL compiled to WebAssembly, with no server needed, covering addressing, limits, silence and the permission decisions. verify:ai-replies exercises the wording guards against a stub model and an in-memory store, and verify:namegen covers determinism and the population statistics with no database at all.",
        ],
      },
    ],
  },
  de: {
    title: "NPCs und Charaktere",
    description: "Hofnarr, Quizmaster, Begrüßungsfigur. Zeitpunkt, Rechte, Nachrichtenlimits und Cooldowns bleiben deterministisch, das Modell formuliert nur den fertigen Satz.",
    lede: "Ein Hofnarr, der einen Witz über einen harmlosen Moment macht, ein Quizmaster, eine Begrüßungsfigur. Die Persönlichkeit ist der sichtbare Teil. Wann eine Figur sprechen darf, mit wem, wie oft und mit welchem Zugriff, entscheidet Anwendungscode. Das Modell formuliert nur den Satz.",
    sections: [
      {
        h: "Figuren, keine Traffic-Generatoren",
        body: [
          "Die Rollen sind ganz gewöhnliche Aufgaben einer Community: Hofnarr, Quizmaster, Geschichtenerzähler, Tutorial-Begleiter, Begrüßungsfigur für neue Mitglieder, Gastgeber für Veranstaltungen, Maskottchen und ein Kommentator, der nach Zeitplan erscheint. Jede davon ist eine dauerhafte Identität mit eigenem Namen, eigener Stimme und eigenen Rechten, kein Allzweck-Bot, der in jeden Raum schreibt.",
          "Am Hofnarren lässt sich die Grenze am besten zeigen.",
          "Alles an diesem Satz außer dem Witz selbst ist Anwendungslogik. Wann die Figur erscheint, ob sie in dieser Gruppe überhaupt sprechen darf, was sie lesen darf, wie oft sie schreiben darf und wie lange sie danach still bleibt, steht im Code. Das Modell bekommt eine fertige Entscheidung und schreibt einen Satz davon.",
          "Heute läuft eine Figur, Cinderella selbst in ihrer Rolle als Archivarin. Die Liste oben und die Engine für Persönlichkeit und Zeitplan entstehen auf genau den Grenzen, die weiter unten beschrieben sind und die bereits im Produktivbetrieb laufen.",
        ],
        callout: "Der Hofnarr erscheint zu unregelmäßigen Zeiten, macht einen kontextbezogenen Witz über einen harmlosen Moment im Gespräch und kann direkt um einen weiteren Witz gebeten werden.",
        status: 'in-development',
      },
      {
        h: "Angesprochen, oder still",
        body: [
          "Eine Figur spricht, wenn sie angesprochen wird. Das Weckwort ist der Name selbst. Genau deshalb funktioniert die Ansprache in jeder Sprache ohne eine eigene Regel pro Sprache: Eine Begrüßung vor dem Namen ist optionales Beiwerk und wird abgeschnitten, deshalb kommen \"Cinderella, publish me\", \"Hey Cinderella publish me\" und \"Guten Morgen Cinderella\" gleich an.",
          "Die Verankerung ist mit Absicht streng. Der Name muss das erste eigenständige Wort sein. \"Ich finde Cinderella gut\" spricht über sie, nicht mit ihr. Ein Genitiv oder ein Kompositum wie \"Cinderellas Archiv\" ist ebenfalls keine Ansprache, und genau darum darf die Fehlertoleranz nicht naiv sein: Eine reine Editierdistanz würde ausgerechnet den Fall durchwinken, der ignoriert werden muss. Tippfehler wie \"cinderela\" werden verziehen, der Name plus Endung nicht.",
          "Wird eine Nachricht zwar an sie gerichtet, die Bitte aber nicht verstanden, ist Schweigen die Voreinstellung und nicht das Raten. Nach einer Antwort bleibt ein kurzes Anschlussfenster offen, in dem dasselbe Mitglied weitersprechen kann, ohne den Namen zu wiederholen. Das Fenster merkt sich außerdem die Sprache des Gesprächs, damit ein blankes \"ja\" in der richtigen Sprache beantwortet wird.",
        ],
        callout: "Eine übersehene Ansprache ist ein kleines Ärgernis. Ein ungefragter Einwurf in einer lebhaften Gruppe ist es nicht.",
      },
      {
        h: "Nachrichtenlimits und Cooldowns",
        body: [
          "Für jede Antwort gelten zwei gleitende Limits über eine Minute: sechs Antworten an dasselbe Mitglied und zwanzig im selben Chat, beide vom Betreiber einstellbar. Teure Vorgänge wie eine Kursabfrage haben zusätzlich ein eigenes, knapperes Budget.",
          "Cooldowns gelten auch fürs Sticheln. Wer eine Figur mit einem Spitznamen anspricht, den sie nicht annimmt, bekommt eine Retourkutsche, nie zweimal dieselbe hintereinander im selben Chat, und nach dreimal in Folge bleibt sie still. Nach zehn Minuten ist die Serie vergessen.",
          "Nichts davon wird gespeichert. Dieser Zustand lebt im Prozess und ist bewusst vergesslich, denn eine dauerhafte Aufzeichnung darüber, wer wann mit dem Bot gesprochen hat, wäre ein Nebenkanal über Mitglieder. Ein Neustart kostet ein einziges wiederholtes Weckwort, und das ist der richtige Tausch.",
        ],
        callout: "Eine Entschuldigung dafür, dass ein Limit erreicht ist, ist auch eine Nachricht in der Gruppe, also schweigt die Figur oberhalb des Limits vollständig.",
      },
      {
        h: "Rechte vor Persönlichkeit",
        body: [
          "Bevor irgendeine Figurenlogik läuft, wird eine eingehende Gruppennachricht auf ein Profil, eine Gruppe und eine Mitgliedsrolle aufgelöst. Die Rollen sind Eigentümer, Administrator, Moderator, Teammitglied, Mitglied, Auditor und blockiert. Das Ergebnis ist erlauben, verweigern oder nicht zugeordnet, mit festgehaltenem Grund: Profil deaktiviert, Gruppe deaktiviert, Mitglied blockiert oder Gruppe nicht zugeordnet.",
          "Jede Entscheidung wird in ein Journal geschrieben, eindeutig pro Gruppe und Nachricht. So lässt sich später nachvollziehen, was für wen unter welchem Profil erlaubt war. Zwei Fähigkeiten stehen in der Entscheidung selbst fest auf nein und lassen sich per Konfiguration nicht einschalten: Fernsteuerungsbefehle und dauerhafte Änderungen aus dem Chat heraus.",
          "Eine Gruppe, die noch keinem Profil zugeordnet ist, verhält sich weiter wie bisher mit einer einzigen Identität. Ihre Entscheidung wird als nicht zugeordnet festgehalten, mit dem Vermerk, dass keine Durchsetzung stattgefunden hat. Die Lücke bleibt im Journal sichtbar und versteckt sich nicht hinter einer Voreinstellung.",
        ],
        callout: "Rechte werden vor der Persönlichkeit aufgelöst, deshalb kann sich keine Figur in eine Fähigkeit hineinreden, die sie nie bekommen hat.",
      },
      {
        h: "Das Modell formuliert, mehr nicht",
        body: [
          "Lokale Modelle formulieren, sie entscheiden nicht. Wenn ein Modell überhaupt ins Spiel kommt, ist die Absicht bereits erkannt, die Datenbankabfragen sind erledigt, und eine vollständige deterministische Antwort liegt fertig vor.",
          "Es gibt zwei Modi. Im freien Modus formuliert das Modell diesen fertigen Entwurf neu. Im gebundenen Modus schreibt es nur eine kurze Einleitung von höchstens 180 Zeichen, und die Anwendung hängt den Entwurf unverändert an. Werte, die eine Neuformulierung exakt überleben müssen, etwa Zahlen und Kurse, werden in der Ausgabe geprüft. Werte, die niemals auftauchen dürfen, etwa der Anzeigename des Absenders, ebenso. Codeblöcke und Steuerzeichen werden entfernt, denn das ist ungeprüfte Ausgabe auf dem Weg in einen Chat.",
          "Das Antwortmodul hat überhaupt keinen Zugriff auf Datenbank, Einwilligung, Werkzeuge oder Transport. Ist das Modell nicht erreichbar oder fällt die Ausgabe durch eine Prüfung, geht der deterministische Entwurf unverändert hinaus. Solche Rückfälle werden gezählt und im Admin angezeigt, damit ein Modell, das still den Dienst eingestellt hat, anders aussieht als ein Modell, das nie eingeschaltet war.",
        ],
        callout: "Das Modell bekommt eine fertige Antwort und schreibt einen Satz davon. Autorität kann es sich nicht selbst geben.",
      },
      {
        h: "Rhythmus und Zeitplan",
        body: [
          "Eine Figur, die nach einem Rhythmus erscheint, braucht einen Scheduler, der einen Neustart übersteht und nichts doppelt auslöst. Dieser Teil existiert: eine dauerhafte Auftragswarteschlange in PostgreSQL, mit geplanter Ausführungszeit pro Auftrag, Spuren und Prioritäten, exponentiellem Backoff, einem Dead-Letter-Zustand, einem Idempotenzschlüssel und einer Übernahme per Zeilensperre, damit zwei Worker nie denselben Auftrag ziehen.",
          "Heute läuft darauf die Arbeit des Archivs. Die Engine, die aus eingestelltem Rhythmus, Ruhezeiten und Auftrittsbudget echte Auftritte macht, ist das Stück, das gerade darauf entsteht.",
        ],
        status: 'in-development',
      },
      {
        h: "Schweigen bei Moderation",
        body: [
          "Der Entwurf ist einfach: Eine Figur hält sich aus einem Moment heraus, der gerade moderiert wird. Ein Witz mitten in eine Meldung hinein ist genau der Fehler, den das verhindern soll.",
          "Im Code sitzt der Moderationszustand heute auf dem Veröffentlichungspfad. Er entscheidet, was ins öffentliche Archiv gelangt, und ist dort auditiert. Die Interaktionsschicht liest ihn noch nicht, eine Figur wird also derzeit nicht wegen Moderationsaktivität still. Der Anknüpfungspunkt dafür ist vorhanden.",
        ],
        status: 'in-development',
      },
      {
        h: "Namen, Avatare und erzeugte Persönlichkeit",
        body: [
          "Identitätserzeugung ist zuerst deterministisch, das Modell ist eine optionale kreative Schicht. Der Namensgenerator ist gebaut und geprüft: Aus Startwert und Konfiguration entsteht ein Name, derselbe Startwert ergibt immer denselben Namen, Kulturgrammatiken setzen die Teile zusammen, Partikel wie \"van der\" behalten ihre Kleinschreibung, die Schreibweise kann natürlich, klein oder gemischt sein, die Häufigkeiten folgen einer Bevölkerungsverteilung statt einer Gleichverteilung, und das Ergebnis wird auf das bereinigt, was SimpleX als Anzeigename akzeptiert.",
          "Eine Einschränkung gehört ehrlicherweise dazu: Das mitgelieferte Korpus trägt keine Kulturkennzeichen, deshalb arbeitet die Grammatik derzeit gegen kleine handgeschriebene Pools. Kulturell stimmige Namen kommen mit einem gekennzeichneten Korpus, die Stelle für den Austausch ist im Code markiert.",
          "Avatare kommen heute vom Betreiber. Ein Bild wird auf ein quadratisches JPEG verkleinert, klein genug für die SimpleX-Profilnachricht, und der Kern setzt es beim nächsten Start. Der deterministische Avatar-Generator sowie Biografie- und Avatarerzeugung mit lokaler KI sind spezifiziert, aber nicht gebaut. Erzeugte Ergebnisse werden später mit Startwert und Generatorversion zwischengespeichert, damit ein Profil reproduzierbar bleibt.",
        ],
        status: 'in-development',
      },
      {
        h: "Was das für Sie heißt",
        body: [
          "Wenn Sie entscheiden, ob Sie das betreiben: In eine Gruppe stellen können Sie heute eine Figur innerhalb der oben beschriebenen Grenzen, auf Hardware, die Ihnen gehört, mit Limits, Rollen und Persona-Texten im Admin einstellbar und in Ihrer eigenen Datenbank gespeichert.",
          "Wenn Sie über einen Chat-Link hier gelandet sind: Eine Figur, die in Ihrer Gruppe spricht, entscheidet nicht darüber, was von Ihnen veröffentlicht wird. Das ist ein eigener Einwilligungspfad, in der ersten Person und ausdrücklich, und nichts, was eine Figur sagt, ändert daran etwas.",
          "Wenn Sie das Projekt technisch bewerten: Der Code dieser Grenzen wird von Harnesses abgedeckt, die ein echtes PostgreSQL in WebAssembly starten, ganz ohne Server. verify:interaction prüft Ansprache, Limits und Schweigen, verify:runtime-policy die Rechteentscheidungen, verify:ai-replies die Formulierungsschranken, verify:namegen Determinismus und Verteilungsstatistik.",
        ],
      },
    ],
  },
});

definePage('platform-administration', {
  en: {
    title: "The administration console",
    description: "The CIND3R3LLA administration console: dashboard, content and moderation, interaction, AI control, plugins and system settings, every control wired to real behaviour.",
    lede: "CIND3R3LLA is operated from one console, not from a pile of environment variables and a log file. This page walks through the areas that exist, what each one actually does, and where a page tells you honestly that there is nothing behind it yet.",
    sections: [
      {
        h: "One console, six areas",
        body: [
          "The console is a server-rendered Fastify application bound to 127.0.0.1. Public nginx TLS sits in front of it at the admin hostname, so the process itself never listens on a public interface. Passkeys are the primary authentication, with an operator-toggleable Argon2id break-glass path behind them.",
          "The navigation has six top-level areas: Dashboard, Content, Interaction, AI Control, Plugins and System. Each one expands into its own set of pages, and the shell carries a mobile navigation as well as the desktop one, because an operator who has to answer a report at eleven at night is holding a phone, not sitting at a desk.",
          "There is no separate configuration file that quietly overrides what the console shows. Live settings are persisted in PostgreSQL and applied immediately. Boot settings that genuinely require a restart are shown read only, and secrets are never rendered at all, not even as masked previews.",
        ],
      },
      {
        h: "Dashboard and runtime status",
        body: [
          "The dashboard answers one question first: is capture healthy right now. It shows the bot state as running, starting or failed, along with the error text if there is one, the groups she is in, the timestamp of the last captured message, and how long the process has been up.",
          "Five counters sit above that: total messages, published messages, deleted messages, opted-in members and revoked consents. Below it, messages by type, the most recent errors, and the last ten audited admin actions with actor, action, target and time.",
          "Two warning banners appear only when something is actually wrong, and the file-receipt indicator is always present: green while every expected media file has arrived, red the moment one has failed or gone past the alert threshold. Failed or at-risk file receipts are flagged against the roughly 48 hour XFTP expiry window, because a media file that has not arrived within the alert threshold is a file you can still chase and soon will not be able to. Unrecognised capture exclusions are flagged in amber: capture dropped an item whose chat scope it does not recognise, which is not a consent leak but is a gap in understanding. Media that could not be served or stripped is flagged too, so a withheld image never stays invisible.",
        ],
        callout: "Two of the three banners are silent when everything is fine, which is what makes them worth reading when they are not; the third stays visible and turns from green to red.",
      },
      {
        h: "Content and moderation",
        body: [
          "Messages is the archive browser: filterable, paged, with takedown, restore, delete and undelete. Every one of those writes an audit record carrying the sender id, the message type, the sent time and whether the item was published at the moment you acted. A message the author already deleted inside the group cannot be restored into publication at all, the console refuses it rather than quietly complying.",
          "Because publication is derived rather than stored as a flag, a correct action can leave the visible state unchanged, for example a takedown on a message whose author never opted in. The console prints a confirmation for exactly this reason, so a working control never reads as an inert one.",
          "Consent is deliberately read only. Members grant and revoke it themselves, and the operator watches: status, opt-in time, revocation time, message count and published count per member. There is no button here that would let an operator opt somebody in.",
          "Reports is the queue for content flagged by the public, filterable by status, with takedown, resolve and dismiss, each audited. Reporting on its own never hides anything. Only the operator's takedown does.",
          "Evidence holds cover the harder case. A hold keeps an item from being destroyed while a report is reviewed, without hiding it and without publishing it. The page separates live from resolved holds, warns about holds expiring soon, and offers release, destroy and escalate. The hold period in days and the abuse threshold, after which a source whose reports keep getting dismissed stops creating holds, are both ordinary settings.",
        ],
        callout: "A hold never hides content and never publishes it. It only defers erasure.",
      },
      {
        h: "Screening and custody",
        body: [
          "The Screening page exists and the custody path behind it is built, but no screening provider is connected. The provider table shows exactly that: provider name, configured yes or no, whether it transmits content, items screened, matches, errors and last activity. Today it reports the null provider, not configured, nothing leaves the host.",
          "The page states its own limits before it states anything else. Hash comparison finds known material only. It does not find new or previously unseen material, and a result of no match means only that the item is not on the list. That is not a statement of safety and nothing in the product presents it as one.",
          "A match preserves and quarantines, it never deletes, because destroying a match destroys what makes a prosecution possible. Quarantined media is moved outside the media tree to a separate quarantine root that nothing serves, and no path in the system can delete it. There is no preview of a quarantined item in the console, by design.",
          "Reporting duties, retention periods and the point of contact are legal questions for a lawyer and are deliberately absent from the code rather than guessed at.",
        ],
        callout: "No screening provider is configured, the null provider transmits nothing, and the console says so on the page rather than in a footnote.",
        status: 'in-development',
      },
      {
        h: "Interaction",
        body: [
          "How Cinderella is addressed and how she answers is configured across ten pages: Addressing, Guards, Follow-up, Language, Replies, Nicknames, Consent, Voice, Archiving and Diagnostics.",
          "That covers wake words and natural addressing, the guards that decide when she stays quiet, follow-up behaviour, language handling, reply modes, the nicknames she answers to, the wording of the consent dialogue, voice handling, whether her own replies are archived alongside the member message that triggered them, and a diagnostics view for working out why a particular message did or did not reach her.",
          "Every change is persisted and written to the audit log under interaction.update, so the question of who changed her behaviour and when has an answer.",
        ],
      },
      {
        h: "AI control",
        body: [
          "Local inference runs through Ollama on a private endpoint, and the console treats that as an operational system rather than a checkbox. Runtime separates the stored setting from the effective state, probes the endpoint before activating, and refuses to activate when a selected model is not actually installed. If the model layer fails, resolution falls back to deterministic rules. There is no cloud fallback to fall back to.",
          "Models lists what is installed, with family, parameter size, quantization level and file size as reported by Ollama, plus a refresh. Routing assigns models independently for the two lanes: one for intent classification, one for reply wording.",
          "Hardware is deliberate about its own blind spots. It shows the catalog state, the runtime mode, the provider boundary and the footprint of the two selected models, and it marks GPU telemetry as not integrated. No utilization, temperature or VRAM figure is claimed, because none is measured.",
          "Telemetry is content free. Both lanes record requests, successes, failures, fallbacks, average and last latency, and last success and last failure. The intent lane adds guard overrides and the last classified intent; the reply lane adds the last reply kind, mode and error category. All of it sits in a bounded buffer the operator can reset. Member text, prompts, names and generated replies are never stored there. Runtime toggles, routing changes and telemetry resets are audited as local-ai.toggle, local-ai.routing.update and local-ai.telemetry.reset.",
          "The models classify and phrase. They do not execute actions, change consent, publish content or send arbitrary messages, and that boundary is enforced in application code rather than requested in a prompt.",
        ],
        callout: "A model failure returns to deterministic rules. It never returns to somebody else's cloud.",
      },
      {
        h: "Pages that state what they do not do",
        body: [
          "Several AI Control pages are read-only status surfaces rather than control panels, and they say so on the page. Privacy and Safety shows a capability matrix with the technical reason for each row, listing cloud providers and automatic cloud fallback as disabled and per-room policy, classification policy and retention windows as not configured. Providers confirms the same from the other side: no credentials stored, external providers disabled, silent provider activation forbidden.",
          "Knowledge and RAG reports zero indexed documents, no embedding model and no vector store. It is preparation, and it is labelled as preparation. Personality describes the layer that exists, which is guarded reply wording in German and English with the deterministic facts preserved, and marks a permanent personality profile as not configured.",
          "Testing offers one thing that genuinely works, a probe of the active role models with latency and a clear yes or no on whether the selected models are present. Side by side model comparison is listed as disabled, because it is. The AI Audit page lists the action types already covered by the central audit log; a filtered AI audit browser with search, time range and actor is planned and is described as planned.",
        ],
        callout: "A page with nothing behind it says so, instead of offering a switch that does nothing.",
      },
      {
        h: "AI bot setup and access control",
        body: [
          "AI Bot Setup is a guided assistant that presents one decision at a time: the bot's display name and internal key, how direct SimpleX contact requests are handled, how invitations are reviewed and which SimpleX role is expected, whether the bot may execute remote commands or save permanent changes, and a review step before saving. The advice on the page is to keep both capability switches off during the first connection and role tests.",
          "Access Control assigns authority around those profiles: SimpleX identities with profile-level permissions, group assignments, and member roles within a group. Everything persists to PostgreSQL and writes audit records for creation, for enabling or disabling a profile or group, and for every authority assignment. There is no delete control on this page; a profile or group is disabled rather than removed.",
          "What these two pages do not yet do is drive the embedded SimpleX core, and they say so themselves. The boundary note reads stored access policy only, with runtime marked not active and enforcement marked foundation only. Invitation handling, group joining, command execution and runtime enforcement are part of the multi profile runtime that is in active development. The configuration surface is real, the enforcement behind it is not connected yet.",
        ],
        status: 'in-development',
      },
      {
        h: "Plugins and system configuration",
        body: [
          "Plugins has an overview plus one page per registered plugin, generated from the registry rather than hand-listed. Crypto Prices is the first working example, with its providers, its pinned symbol to asset mappings so that a ticker means the asset you actually meant, and its cache. Enabling a plugin and changing its settings are separate audited actions.",
          "System holds Settings, Security, Embeds and Website. Settings covers the live values that apply without a restart: log level, file receive timeout, the file alert threshold in hours, the evidence hold period in days, and the hold abuse threshold. Boot configuration is shown for reference only, with secrets never rendered.",
          "Security is where the console hardens itself, and every control there is persisted and audited. Passkey registration and removal, with a standing warning until at least two devices are enrolled, because losing your only passkey with break-glass disabled means lockout. The Argon2id break-glass path with an optional mandatory TOTP code. Session idle and absolute lifetimes, and step-up re-verification before sensitive actions such as a takedown or a configuration change. Login attempt limits, window, lockout duration and a global per-minute rate. IP allowlist or denylist, off by default and honestly labelled as a poor fit for a dynamic address. Content-Security-Policy, HSTS max-age with includeSubDomains and preload, Referrer-Policy and Permissions-Policy, with a one-click reset to the secure default. Argon2id cost parameters. An HTTPS webhook for security alerts.",
          "Below the editable controls sits a read-only Enforced status block for the things an operator cannot weaken: trustProxy pinned to loopback, a signed session cookie with Secure, HttpOnly and SameSite=Strict, and CSRF required on every state change. A security event feed lists logins, failed logins, step-ups and rejected registrations, with anomalies highlighted. A lockout is delivered to the configured security webhook rather than to this feed.",
          "Website governs the three opt-in building blocks of the public site, analytics, cookie banner and social share, all off by default and each one a deliberate decision by the operator rather than a default that happened to them.",
        ],
      },
      {
        h: "The administration principle",
        body: [
          "Every operational capability in CIND3R3LLA is expected to have all eight of the following: a backend implementation, persistent settings, an administration control, a stored status and an effective status shown separately, audit coverage, automated tests, clear failure behaviour, and a documented boundary. A capability that cannot show all eight is not finished, and the console is expected to say so.",
          "This cuts both ways. Nothing important hides in code behind an empty control panel, and any control that is not yet wired to backend behaviour is disabled or labelled on the page as stored-only, never presented as if it were live. Where the honest answer is not configured, the page prints not configured. Where the honest answer is stored but not enforced, the page prints that instead of implying enforcement.",
          "Failure behaviour is part of the definition, not an afterthought. A caught error is never converted into a value that reads like a legitimate result, a degraded function never runs silently, and anything on the consent, capture, publication, media or plugin path that loses a guarantee is surfaced in the console rather than buried in a log file. Not configured, which is a choice, is distinguished from configured but failing, which is a fault. A fallback that could mask a fault is counted, and the count is shown.",
          "The tests are not a promise either. The admin console, its navigation shell, the security settings, the profile pages, the public site, consent, revocation and holds, the job queue and the screening path each have their own verification harness, run against real PostgreSQL compiled to WebAssembly so the checks exercise actual SQL. The AI runtime, models, routing and telemetry harnesses run offline against an in-memory settings store and a stubbed HTTP client, so they never touch a database or a real endpoint, and the setup workflow harness checks the built markup rather than a database.",
        ],
        callout: "CIND3R3LLA does not hide important behaviour in code while presenting an empty control panel, and it does not present controls that are not connected to real backend behaviour.",
      },
    ],
  },
  de: {
    title: "Die Administrationskonsole",
    description: "Die Administrationskonsole von CIND3R3LLA: Dashboard, Inhalte und Moderation, Interaktion, KI-Steuerung, Plugins und Systemeinstellungen, jedes Bedienelement real hinterlegt.",
    lede: "CIND3R3LLA wird über eine Konsole betrieben, nicht über einen Stapel Umgebungsvariablen und eine Logdatei. Diese Seite geht die vorhandenen Bereiche durch, beschreibt, was jeder davon wirklich tut, und benennt die Stellen, an denen eine Seite selbst sagt, dass dahinter noch nichts liegt.",
    sections: [
      {
        h: "Eine Konsole, sechs Bereiche",
        body: [
          "Die Konsole ist eine serverseitig gerenderte Fastify-Anwendung, gebunden an 127.0.0.1. Davor steht nginx mit TLS unter dem Admin-Hostnamen, der Prozess selbst lauscht also nie auf einer öffentlichen Schnittstelle. Passkeys sind die primäre Anmeldung, dahinter liegt ein vom Betreiber schaltbarer Argon2id-Notzugang.",
          "Die Navigation hat sechs Hauptbereiche: Dashboard, Inhalte, Interaktion, KI-Steuerung, Plugins und System. Jeder Bereich führt in eigene Unterseiten, und die Oberfläche bringt neben der Desktop-Navigation eine eigene mobile Navigation mit. Wer um elf Uhr abends eine Meldung bearbeiten muss, hat ein Telefon in der Hand und sitzt nicht am Schreibtisch.",
          "Es gibt keine separate Konfigurationsdatei, die im Stillen überschreibt, was die Konsole anzeigt. Laufende Einstellungen liegen in PostgreSQL und greifen sofort. Startparameter, die wirklich einen Neustart brauchen, werden nur lesend gezeigt, und Geheimnisse werden überhaupt nicht dargestellt, auch nicht als maskierte Vorschau.",
        ],
      },
      {
        h: "Dashboard und Laufzeitstatus",
        body: [
          "Das Dashboard beantwortet zuerst eine Frage: Läuft die Erfassung gerade sauber. Es zeigt den Zustand des Bots als laufend, startend oder fehlgeschlagen, dazu den Fehlertext, falls vorhanden, die Gruppen, in denen sie ist, den Zeitpunkt der letzten erfassten Nachricht und die Laufzeit des Prozesses.",
          "Darüber stehen fünf Kennzahlen: Nachrichten gesamt, veröffentlichte Nachrichten, gelöschte Nachrichten, Mitglieder mit Einwilligung und widerrufene Einwilligungen. Darunter folgen Nachrichten nach Typ, die letzten Fehler und die letzten zehn protokollierten Admin-Aktionen mit Akteur, Aktion, Ziel und Zeit.",
          "Drei Warnbänder erscheinen nur, wenn tatsächlich etwas nicht stimmt. Fehlgeschlagene oder gefährdete Dateiübernahmen werden gegen das XFTP-Zeitfenster von rund 48 Stunden gemeldet, denn eine Datei, die innerhalb der Warnschwelle nicht angekommen ist, lässt sich jetzt noch nachfordern und bald nicht mehr. Nicht erkannte Erfassungsausschlüsse erscheinen in Gelb: Die Erfassung hat ein Element verworfen, dessen Chat-Kontext sie nicht kennt. Das ist kein Einwilligungsleck, aber eine Verständnislücke. Auch Medien, die nicht ausgeliefert oder nicht bereinigt werden konnten, werden gemeldet, damit ein zurückgehaltenes Bild nie unsichtbar bleibt.",
        ],
      },
      {
        h: "Inhalte und Moderation",
        body: [
          "Nachrichten ist der Archivbrowser: filterbar, seitenweise, mit Rücknahme, Wiederherstellung, Löschung und Rücknahme der Löschung. Jede dieser Aktionen schreibt einen Protokolleintrag mit Absenderkennung, Nachrichtentyp, Sendezeit und dem Veröffentlichungsstand zum Zeitpunkt der Aktion. Eine Nachricht, die der Verfasser bereits in der Gruppe gelöscht hat, lässt sich überhaupt nicht wieder in die Veröffentlichung holen, die Konsole verweigert das ausdrücklich, statt es stillschweigend zu tun.",
          "Weil die Veröffentlichung abgeleitet und nicht als Merker gespeichert wird, kann eine korrekte Aktion den sichtbaren Zustand unverändert lassen, etwa eine Rücknahme bei einer Nachricht, deren Verfasser nie eingewilligt hat. Genau deshalb zeigt die Konsole eine Rückmeldung an, damit ein funktionierendes Bedienelement nie wirkungslos wirkt.",
          "Einwilligung ist bewusst nur lesend. Mitglieder erteilen und widerrufen sie selbst, der Betreiber sieht zu: Status, Zeitpunkt der Zustimmung, Zeitpunkt des Widerrufs, Anzahl der Nachrichten und Anzahl der veröffentlichten Nachrichten je Mitglied. Es gibt hier keine Schaltfläche, mit der ein Betreiber jemanden anmelden könnte.",
          "Meldungen ist die Warteschlange für öffentlich gemeldete Inhalte, filterbar nach Status, mit Rücknahme, Erledigen und Verwerfen, jeweils protokolliert. Eine Meldung allein verbirgt nichts. Das tut erst die Rücknahme durch den Betreiber.",
          "Beweissperren decken den schwierigeren Fall ab. Eine Sperre verhindert die Vernichtung eines Elements, solange eine Meldung geprüft wird, ohne es zu verbergen und ohne es zu veröffentlichen. Die Seite trennt laufende von erledigten Sperren, warnt vor bald ablaufenden Sperren und bietet Freigeben, Vernichten und Eskalieren an. Die Sperrfrist in Tagen und die Missbrauchsschwelle, ab der eine Quelle mit ständig verworfenen Meldungen keine Sperren mehr auslöst, sind gewöhnliche Einstellungen.",
        ],
      },
      {
        h: "Abgleich und Verwahrung",
        body: [
          "Die Seite Abgleich existiert und der Verwahrungspfad dahinter ist gebaut, aber es ist kein Abgleichsdienst angebunden. Die Anbietertabelle zeigt genau das: Name, konfiguriert ja oder nein, ob Inhalte übertragen werden, geprüfte Elemente, Treffer, Fehler und letzte Aktivität. Derzeit steht dort der Null-Anbieter, nicht konfiguriert, nichts verlässt den Host.",
          "Die Seite nennt ihre eigenen Grenzen, bevor sie irgendetwas anderes nennt. Ein Hash-Abgleich findet ausschließlich bekanntes Material. Er findet kein neues oder bislang unbekanntes Material, und kein Treffer bedeutet nur, dass das Element nicht auf der Liste steht. Das ist keine Unbedenklichkeitsaussage, und nichts im Produkt stellt es als eine dar.",
          "Ein Treffer sichert und stellt unter Verschluss, er löscht nie, denn wer einen Treffer vernichtet, vernichtet die Grundlage einer möglichen Strafverfolgung. Betroffene Medien werden aus dem Medienbaum heraus in ein eigenes Quarantäneverzeichnis verschoben, das von nichts ausgeliefert wird, und kein Pfad im System kann sie löschen. Eine Vorschau auf ein verwahrtes Element gibt es in der Konsole bewusst nicht.",
          "Meldepflichten, Aufbewahrungsfristen und die zuständige Kontaktstelle sind Rechtsfragen für eine Anwältin oder einen Anwalt und fehlen im Code absichtlich, statt geraten zu werden.",
        ],
        callout: "Ein Treffer sichert und verwahrt, er löscht nie.",
        status: 'in-development',
      },
      {
        h: "Interaktion",
        body: [
          "Wie Cinderella angesprochen wird und wie sie antwortet, wird auf zehn Seiten eingestellt: Ansprache, Schutzregeln, Nachfassen, Sprache, Antworten, Spitznamen, Einwilligung, Sprachnachrichten, Archivierung und Diagnose.",
          "Das umfasst Weckwörter und natürliche Ansprache, die Schutzregeln, die bestimmen, wann sie schweigt, das Nachfassverhalten, die Sprachbehandlung, die Antwortmodi, die Spitznamen, auf die sie reagiert, den Wortlaut des Einwilligungsdialogs, den Umgang mit Sprachnachrichten, die Frage, ob ihre eigenen Antworten zusammen mit der auslösenden Mitgliedsnachricht archiviert werden, und eine Diagnoseansicht, mit der sich nachvollziehen lässt, warum eine bestimmte Nachricht sie erreicht hat oder eben nicht.",
          "Jede Änderung wird gespeichert und unter interaction.update ins Protokoll geschrieben. Die Frage, wer ihr Verhalten wann geändert hat, ist damit beantwortbar.",
        ],
      },
      {
        h: "KI-Steuerung",
        body: [
          "Lokale Inferenz läuft über Ollama an einem privaten Endpunkt, und die Konsole behandelt das als Betriebssystem und nicht als Häkchen. Die Laufzeitseite trennt die gespeicherte Einstellung vom tatsächlich wirksamen Zustand, prüft den Endpunkt vor der Aktivierung und verweigert die Aktivierung, wenn ein ausgewähltes Modell gar nicht installiert ist. Fällt die Modellschicht aus, greift wieder die deterministische Regelauflösung. Ein Cloud-Rückfall existiert nicht.",
          "Modelle listet auf, was installiert ist, mit Familie, Parametergröße, Quantisierung und Dateigröße, so wie Ollama es meldet, dazu eine Aktualisierung. Routing weist den beiden Bahnen unabhängig Modelle zu: eines für die Absichtserkennung, eines für die Formulierung der Antwort.",
          "Hardware benennt die eigenen blinden Flecken. Die Seite zeigt Katalogzustand, Laufzeitmodus, Anbietergrenze und den Ressourcenbedarf der beiden gewählten Modelle, und sie markiert GPU-Telemetrie als nicht angebunden. Es wird kein Wert zu Auslastung, Temperatur oder VRAM behauptet, weil keiner gemessen wird.",
          "Die Telemetrie ist inhaltsfrei. Je Bahn werden Anfragen, Erfolge, Fehler, Rückfälle, Regelüberstimmungen, mittlere und letzte Latenz, letzter Erfolg und letzter Fehler sowie die zuletzt erkannte Absicht in einem begrenzten Puffer geführt, den der Betreiber zurücksetzen kann. Mitgliedstexte, Prompts, Namen und erzeugte Antworten landen dort nie. Laufzeitschalter, Routingänderungen und das Zurücksetzen der Telemetrie werden als local-ai.toggle, local-ai.routing.update und local-ai.telemetry.reset protokolliert.",
          "Die Modelle klassifizieren und formulieren. Sie führen keine Aktionen aus, ändern keine Einwilligung, veröffentlichen nichts und versenden keine beliebigen Nachrichten. Diese Grenze steckt im Anwendungscode und nicht in einer Prompt-Bitte.",
        ],
      },
      {
        h: "Seiten, die sagen, was sie nicht tun",
        body: [
          "Mehrere Seiten der KI-Steuerung sind reine Statusflächen und keine Bedienfelder, und genau das steht auf der Seite. Datenschutz und Sicherheit zeigt eine Fähigkeitsmatrix mit technischer Begründung je Zeile und führt Cloud-Anbieter sowie automatischen Cloud-Rückfall als deaktiviert, raumbezogene Richtlinien, Klassifizierungsrichtlinien und Aufbewahrungsfenster als nicht konfiguriert. Anbieter bestätigt dasselbe von der anderen Seite: keine gespeicherten Zugangsdaten, externe Anbieter deaktiviert, stille Aktivierung eines Anbieters ausgeschlossen.",
          "Wissen und RAG meldet null indexierte Dokumente, kein Einbettungsmodell und keinen Vektorspeicher. Es ist Vorbereitung, und es ist als Vorbereitung ausgewiesen. Persönlichkeit beschreibt die vorhandene Schicht, also abgesicherte Formulierung auf Deutsch und Englisch unter Erhalt der festen Fakten, und markiert ein dauerhaftes Persönlichkeitsprofil als nicht konfiguriert.",
          "Testen bietet eine Sache, die wirklich funktioniert: eine Prüfung der aktiven Rollenmodelle mit Latenz und einer klaren Aussage, ob die gewählten Modelle vorhanden sind. Ein direkter Modellvergleich ist als deaktiviert ausgewiesen, weil er es ist. Die Seite KI-Protokoll listet die Aktionstypen, die das zentrale Protokoll bereits abdeckt. Eine gefilterte Protokollansicht mit Suche, Zeitraum und Akteur ist geplant und wird als geplant bezeichnet.",
        ],
      },
      {
        h: "Bot-Einrichtung und Zugriffssteuerung",
        body: [
          "Die Bot-Einrichtung ist ein geführter Assistent, der eine Entscheidung nach der anderen zeigt: Anzeigename und interner Schlüssel des Bots, Umgang mit direkten SimpleX-Kontaktanfragen, Prüfung von Einladungen und erwartete SimpleX-Rolle, ob der Bot entfernte Befehle ausführen oder dauerhafte Änderungen speichern darf, und eine Kontrolle vor dem Speichern. Die Seite rät, beide Fähigkeitsschalter während der ersten Verbindungs- und Rollentests ausgeschaltet zu lassen.",
          "Die Zugriffssteuerung verteilt die Rechte um diese Profile herum: SimpleX-Identitäten mit Berechtigungen auf Profilebene, Gruppenzuordnungen und Mitgliedsrollen innerhalb einer Gruppe. Alles wird in PostgreSQL gespeichert und bei Anlage, Änderung und Löschung protokolliert.",
          "Was diese beiden Seiten noch nicht tun, ist den eingebetteten SimpleX-Kern zu steuern, und sie sagen es selbst. Der Hinweis auf der Seite lautet, dass nur die Zugriffsrichtlinie gespeichert wird, die Laufzeit als nicht aktiv und die Durchsetzung als reine Grundlage markiert. Einladungsbearbeitung, Gruppenbeitritt, Befehlsausführung und Durchsetzung zur Laufzeit gehören zur Mehrprofil-Laufzeit, die gerade entwickelt wird. Die Konfigurationsfläche ist echt, die Durchsetzung dahinter ist noch nicht angeschlossen.",
        ],
        status: 'in-development',
      },
      {
        h: "Plugins und Systemkonfiguration",
        body: [
          "Plugins bietet eine Übersicht und je eine Seite pro registriertem Plugin, erzeugt aus der Registrierung und nicht von Hand gepflegt. Krypto-Preise ist das erste funktionierende Beispiel, mit seinen Datenquellen, seinen festen Zuordnungen von Kürzel zu Vermögenswert, damit ein Tickersymbol den gemeinten Wert bezeichnet, und seinem Zwischenspeicher. Das Aktivieren eines Plugins und das Ändern seiner Einstellungen sind zwei getrennte, protokollierte Aktionen.",
          "System umfasst Einstellungen, Sicherheit, Einbettungen und Website. Unter Einstellungen liegen die Werte, die ohne Neustart greifen: Protokollstufe, Zeitlimit für den Dateiempfang, Warnschwelle für Dateien in Stunden, Sperrfrist für Beweissperren in Tagen und die Missbrauchsschwelle für Sperren. Die Startkonfiguration wird nur zur Information gezeigt, Geheimnisse werden nie dargestellt.",
          "Sicherheit ist die Seite, auf der sich die Konsole selbst härtet, und jedes Bedienelement dort wird gespeichert und protokolliert. Passkeys anlegen und entfernen, mit einer dauerhaften Warnung, solange weniger als zwei Geräte hinterlegt sind, denn wer seinen einzigen Passkey verliert und den Notzugang abgeschaltet hat, sperrt sich aus. Der Argon2id-Notzugang mit optional erzwungenem TOTP-Code. Sitzungsdauer im Leerlauf und absolute Höchstdauer, dazu eine erneute Passkey-Prüfung vor heiklen Aktionen wie einer Rücknahme oder einer Konfigurationsänderung. Grenzwerte für Anmeldeversuche, Zeitfenster, Sperrdauer und eine globale Rate pro Minute. IP-Freigabe- oder Sperrliste, standardmäßig aus und ehrlich als ungeeignet für wechselnde Adressen gekennzeichnet. Content-Security-Policy, HSTS-Maximalalter mit includeSubDomains und preload, Referrer-Policy und Permissions-Policy, dazu ein Zurücksetzen auf den sicheren Standard. Kostenparameter für Argon2id. Ein HTTPS-Webhook für Sicherheitsmeldungen.",
          "Unter den bedienbaren Feldern steht ein nur lesender Block mit dem erzwungenen Zustand, also dem, was ein Betreiber nicht abschwächen kann: trustProxy fest auf loopback, ein signiertes Sitzungscookie mit Secure, HttpOnly und SameSite=Strict, und CSRF-Pflicht bei jeder Zustandsänderung. Ein Ereignisprotokoll listet Anmeldungen, Fehlversuche, Sperren, erneute Prüfungen und abgelehnte Registrierungen, Auffälligkeiten sind hervorgehoben.",
          "Website steuert die drei zuschaltbaren Bausteine der öffentlichen Seite, Statistik, Cookie-Hinweis und Teilen-Funktionen, alle standardmäßig aus und jeder eine bewusste Entscheidung des Betreibers statt einer Voreinstellung, die einfach passiert ist.",
        ],
      },
      {
        h: "Das Verwaltungsprinzip",
        body: [
          "Jede betriebliche Fähigkeit in CIND3R3LLA soll alle acht der folgenden Punkte erfüllen: eine Implementierung im Hintergrund, dauerhaft gespeicherte Einstellungen, ein Bedienelement in der Verwaltung, getrennt ausgewiesenen gespeicherten und tatsächlich wirksamen Status, Protokollabdeckung, automatisierte Tests, klar definiertes Verhalten im Fehlerfall und eine dokumentierte Grenze. Eine Fähigkeit, die nicht alle acht Punkte zeigen kann, ist nicht fertig, und die Konsole soll das aussprechen.",
          "Das gilt in beide Richtungen. Nichts Wichtiges versteckt sich im Code hinter einer leeren Oberfläche, und es wird kein Bedienelement gezeigt, hinter dem kein echtes Verhalten liegt. Wo die ehrliche Antwort nicht konfiguriert lautet, steht auf der Seite nicht konfiguriert. Wo die ehrliche Antwort gespeichert, aber nicht durchgesetzt lautet, steht genau das, statt eine Durchsetzung anzudeuten.",
          "Das Verhalten im Fehlerfall gehört zur Definition und ist kein Nachgedanke. Ein abgefangener Fehler wird nie in einen Wert verwandelt, der wie ein gültiges Ergebnis aussieht, eine eingeschränkte Funktion läuft nie stillschweigend weiter, und alles auf dem Weg von Einwilligung, Erfassung, Veröffentlichung, Medien und Plugins, das eine Zusicherung verliert, erscheint in der Konsole und nicht nur in einer Logdatei. Nicht konfiguriert, also eine Entscheidung, wird von konfiguriert, aber fehlerhaft, also einem Defekt, unterschieden. Ein Rückfallpfad, der einen Defekt verdecken könnte, wird gezählt, und der Zähler wird angezeigt.",
          "Auch die Tests sind kein Versprechen. Die Administrationskonsole, ihre Navigationsstruktur, die Sicherheitseinstellungen, die KI-Laufzeit, Modelle, Routing, Telemetrie und Profilseiten, der Einrichtungsassistent, die öffentliche Website, Einwilligung, Widerruf und Sperren, die Auftragswarteschlange und der Abgleichspfad haben jeweils eine eigene Prüfstrecke, ausgeführt gegen ein echtes, nach WebAssembly übersetztes PostgreSQL, damit die Prüfungen tatsächliches SQL durchlaufen und keine Attrappe.",
        ],
        callout: "CIND3R3LLA versteckt kein wichtiges Verhalten im Code hinter einer leeren Oberfläche, und sie zeigt keine Bedienelemente, hinter denen kein echtes Verhalten liegt.",
      },
    ],
  },
});

definePage('platform-agents', {
  en: {
    title: "Human operated agents",
    description: "A human operated agent is an identity a person stands behind: manual, assisted or autopilot, with immediate takeover and a permission gate that runs first.",
    lede: "A human operated agent is an identity a person stands behind. It can accept help from a model, up to and including letting the model draft and answer, and the person can take it back at any moment. An NPC is a different thing, and CIND3R3LLA keeps the two apart by design.",
    sections: [
      {
        h: "An agent is not an NPC",
        body: [
          "CIND3R3LLA is designed around two very different kinds of posting identity, and the whole design depends on not confusing them. An NPC is a character. It has a personality, a rhythm, and nobody behind it. A human operated agent is a person: a moderator, an administrator, someone from support, a host. The model helps them work, and they stay accountable for what the identity says.",
          "The difference is not visible in the avatar, and it is not meant to be inferred from one. A fantasy portrait can belong to either. Actor type, avatar source, personality source and automation mode are specified as separate concepts, so that the distinction can live in configuration rather than in presentation. That model is a recorded design decision and is not built yet.",
          "For a member reading a group on a phone, this is the practical question behind everything on this page. When this name replies, is there a person on the other end, and can they be reached?",
        ],
        callout: "A fantasy avatar does not tell you whether a person is behind the identity. That is what the configuration model is being built to answer.",
      },
      {
        h: "Manual, assisted, autopilot, and taking it back",
        body: [
          "Four automation modes are specified for these identities. In manual mode the person writes everything. In assisted mode the model drafts and the person sends. In autopilot the agent answers on its own, inside the boundaries it was given. Fully automated is reserved for NPCs and technical accounts, and the specification does not offer it to a human operated agent.",
          "Takeover is specified to be immediate rather than a request: the person behind the identity will step in mid conversation and continue as themselves, under the same name the group already knows. Nothing waits for a model to finish its turn.",
          "Alongside the modes sit the controls that make autopilot responsible to switch on at all: which actions need approval before they leave, which groups the identity may act in, which model it uses, which personality it carries, and what is shown when the model is unavailable. Every mode change and every takeover is specified to be persisted and audited.",
          "The modes and their controls are a recorded design decision. They are not built yet. The permission layer they will run on is already live, and is described below.",
        ],
        status: 'in-development',
      },
      {
        h: "The permission check runs before anything is said",
        body: [
          "Before the interaction engine sees a group message at all, a deterministic resolver decides whether this identity may act in this group, for this member. It maps the technical SimpleX group and member identity onto a configured profile, a group and a role, and returns allow, deny or unassigned. Anything denied stops there; allow and unassigned both continue to the engine.",
          "The refusals are named rather than generic: profile_disabled, group_disabled, member_blocked. A group nobody has assigned to a profile yet returns unassigned, keeps working exactly as before, and every such message is recorded as unenforced in the decision history, so the record is there to be reviewed.",
          "Two things the resolver grants under no configuration at all: remote commands and persistent changes. Two switches for these exist in the onboarding configuration, and they are stored only: nothing reads them at runtime. In the decision type the two fields are the constant false, so no profile setting and no message sent in a chat can turn them on. In the decision type they are the constant false, so no profile setting and no message sent in a chat can turn them on.",
        ],
        callout: "What a model produces can never widen the permissions it was produced under. Identity, permissions, routing and execution stay in application code.",
      },
      {
        h: "Per group permissions, and the team room",
        body: [
          "Permissions are held per profile and per group, never globally. A profile carries authorities: a SimpleX user or contact with the role owner, administrator or auditor, with at most one enabled owner, enforced by a unique index rather than by good intentions. Each group carries its own member roles, owner, administrator, moderator, team_member, member, auditor and blocked, and each group is recorded as inheriting the profile policy, with per group overrides still to come.",
          "The kind of group is part of the model. A profile has member groups, test groups, and at most one team group. The team group is where an agent gets discussed, corrected and given guidance before it acts in public, and the resolver already works out, for every message, whether that speaker may contribute team guidance and whether they may manage the group.",
          "What a decision enforces today is the first question, whether the identity responds at all. The finer flags are computed and stored on every decision, and they are what the approval requirements and the public context boundaries are being built on top of.",
        ],
      },
      {
        h: "Audit history",
        body: [
          "Every configuration change writes an audit row with the acting administrator, the action and the target: profile created, profile enabled or disabled, group created, group enabled or disabled, authority assigned or changed. Switching an agent off is as visible in the record as switching it on.",
          "Every runtime decision is stored as well, one row per message that reaches the interaction layer, keyed so the same message cannot be recorded twice. The row holds technical identifiers, the outcome and its reason, the role, the kind of group and the privacy flags. It deliberately holds no message content, no invitation links and no secrets, because an audit trail that copies the conversation is simply a second copy of the conversation.",
          "A database constraint refuses any decision claiming both local only and cloud allowed at once, so a self contradicting privacy record cannot exist even if the code writing it were wrong.",
        ],
      },
      {
        h: "The invariant",
        body: [
          "A human operated identity is never silently converted into an autonomous NPC. Not by a schema migration, not as a fallback when the person is unavailable, not because a model decided it could handle the rest. Once actor type exists in the schema, changing what an identity is will be an explicit administrator action recorded in the audit history, alongside the profile, group and authority changes already recorded there.",
          "The mirror rule is specified too: an NPC must never be presented as human operated. Both invariants are recorded design commitments, and the identity model that will enforce them is not built yet. Communities stop trusting AI characters the moment they cannot tell which is which, so the platform treats this as a correctness property and not as a courtesy.",
          "This is the same commitment the archive makes about consent, applied to identity instead of to content. The valuable part is not that the system can do something impressive on its own. It is that a member can always find out who is answering.",
        ],
        callout: "A human operated identity is never silently converted into an autonomous NPC.",
      },
    ],
  },
  de: {
    title: "Menschlich geführte Agenten",
    description: "Ein menschlich geführter Agent ist eine Identität, hinter der eine Person steht: manuell, unterstützt oder Autopilot, mit sofortiger Übernahme und vorgeschalteter Rechteprüfung.",
    lede: "Ein menschlich geführter Agent ist eine Identität, hinter der eine Person steht. Sie kann sich vom Modell helfen lassen, bis hin zum Autopilot, und sie kann jederzeit selbst übernehmen. Ein NPC ist etwas anderes, und CIND3R3LLA hält beides bewusst auseinander.",
    sections: [
      {
        h: "Ein Agent ist kein NPC",
        body: [
          "CIND3R3LLA kennt zwei sehr verschiedene Arten von schreibenden Identitäten, und der ganze Entwurf hängt daran, sie nicht zu vermischen. Ein NPC ist eine Figur. Er hat eine Persönlichkeit, einen Rhythmus, und niemanden dahinter. Ein menschlich geführter Agent ist eine Person: eine Moderatorin, ein Administrator, jemand aus dem Support, ein Gastgeber. Das Modell hilft bei der Arbeit, verantwortlich bleibt der Mensch.",
          "Der Unterschied steckt nicht im Avatar und soll auch nicht daraus abgelesen werden. Ein Fantasieportrait kann zu beidem gehören. Akteurstyp, Herkunft des Avatars, Herkunft der Persönlichkeit und Automatisierungsstufe bleiben getrennte Begriffe. Die Unterscheidung wird deshalb in der Konfiguration geführt und nicht in der Darstellung, und eine Identität rutscht nicht von der einen Art in die andere, ohne dass jemand das entscheidet.",
          "Für ein Mitglied, das am Telefon in einer Gruppe mitliest, steht dahinter eine sehr praktische Frage. Wenn dieser Name antwortet, sitzt dann ein Mensch dahinter, und ist er erreichbar?",
        ],
        callout: "Ein Fantasie Avatar sagt nichts darüber, ob ein Mensch hinter der Identität steht. Die Konfiguration sagt es.",
      },
      {
        h: "Manuell, unterstützt, Autopilot, und jederzeit zurücknehmen",
        body: [
          "Für diese Identitäten sind vier Automatisierungsstufen vorgesehen. Im manuellen Betrieb schreibt der Mensch alles. Im unterstützten Betrieb formuliert das Modell einen Vorschlag, abgeschickt wird er von Hand. Im Autopilot antwortet der Agent selbständig, innerhalb der Grenzen, die ihm gesetzt wurden. Die vollautomatische Stufe bleibt NPCs und technischen Konten vorbehalten, und genau deshalb steht sie einem menschlich geführten Agenten nicht als Einstellung zur Verfügung.",
          "Die Übernahme ist sofort und keine Anfrage. Die Person hinter der Identität tritt mitten im Gespräch ein und macht als sie selbst weiter, unter demselben Namen, den die Gruppe schon kennt. Nichts wartet darauf, dass ein Modell seinen Zug beendet.",
          "Neben den Stufen stehen die Regler, die den Autopilot überhaupt erst verantwortbar machen: welche Aktionen vor dem Absenden freigegeben werden müssen, in welchen Gruppen die Identität handeln darf, welches Modell sie benutzt, welche Persönlichkeit sie trägt, und was angezeigt wird, wenn das Modell nicht erreichbar ist. Jeder Wechsel der Stufe und jede Übernahme wird gespeichert und protokolliert.",
          "Die Stufen und ihre Regler sind als Entwurfsentscheidung festgehalten und werden gerade gebaut. Die Berechtigungsebene, auf der sie laufen, ist bereits in Betrieb und unten beschrieben.",
        ],
        status: 'in-development',
      },
      {
        h: "Die Rechteprüfung läuft, bevor etwas gesagt wird",
        body: [
          "Bevor die Dialoglogik eine Gruppennachricht überhaupt zu sehen bekommt, entscheidet ein deterministischer Resolver, ob diese Identität in dieser Gruppe und für dieses Mitglied handeln darf. Er ordnet die technische SimpleX Gruppe und die Mitgliedskennung einem konfigurierten Profil, einer Gruppe und einer Rolle zu und liefert allow, deny oder unassigned. Nur allow erreicht die Dialoglogik.",
          "Die Ablehnungsgründe sind benannt und nicht pauschal: profile_disabled, group_disabled, member_blocked. Eine Gruppe, die noch niemand einem Profil zugeordnet hat, ergibt unassigned, funktioniert unverändert weiter und wird als nicht durchgesetzt festgehalten. So findet der Betreiber sie in der Konsole, statt sie später zufällig zu entdecken.",
          "Zwei Dinge erteilt der Resolver unter keiner Konfiguration: Fernsteuerungsbefehle und dauerhafte Änderungen. Das sind keine Schalter, die zufällig auf aus stehen. Im Entscheidungstyp sind sie die Konstante false, also kann weder eine Profileinstellung noch eine Nachricht im Chat sie einschalten.",
        ],
        callout: "Was ein Modell erzeugt, kann die Rechte nicht erweitern, unter denen es erzeugt wurde. Identität, Rechte, Routing und Ausführung bleiben in der Anwendungslogik.",
      },
      {
        h: "Rechte pro Gruppe, und der Teamraum",
        body: [
          "Rechte werden pro Profil und pro Gruppe geführt, nie global. Ein Profil trägt Autoritäten: einen SimpleX Nutzer oder Kontakt mit der Rolle owner, administrator oder auditor, und höchstens einen aktiven owner, erzwungen durch einen eindeutigen Index und nicht durch guten Willen. Jede Gruppe trägt ihre eigenen Mitgliedsrollen, owner, administrator, moderator, team_member, member, auditor und blocked, und eine Gruppe erbt entweder die Profilpolitik oder überschreibt sie.",
          "Die Art der Gruppe gehört zum Modell. Ein Profil hat Mitgliedergruppen, Testgruppen und höchstens eine Teamgruppe. Die Teamgruppe ist der Ort, an dem ein Agent besprochen, korrigiert und angeleitet wird, bevor er öffentlich auftritt, und der Resolver ermittelt bereits bei jeder Nachricht, ob die sprechende Person dort Anleitung beitragen und ob sie die Gruppe verwalten darf.",
          "Durchgesetzt wird heute die erste Frage, ob die Identität überhaupt antwortet. Die feineren Merkmale werden bei jeder Entscheidung berechnet und gespeichert, und auf ihnen setzen die Freigabepflichten und die Grenzen für öffentliche Kontexte auf, die gerade gebaut werden.",
        ],
      },
      {
        h: "Prüfhistorie",
        body: [
          "Jede Konfigurationsänderung schreibt einen Auditeintrag mit der handelnden Administration, der Aktion und dem Ziel: Profil angelegt, Profil aktiviert oder deaktiviert, Gruppe angelegt, Gruppe aktiviert oder deaktiviert, Autorität vergeben oder geändert. Einen Agenten abzuschalten ist im Protokoll genauso sichtbar wie ihn einzuschalten.",
          "Auch jede Laufzeitentscheidung wird gespeichert, eine Zeile pro Nachricht, so geschlüsselt, dass dieselbe Nachricht nicht doppelt erfasst werden kann. Die Zeile enthält technische Kennungen, das Ergebnis und seinen Grund, die Rolle, die Art der Gruppe und die Datenschutzmerkmale. Sie enthält bewusst keinen Nachrichteninhalt, keine Einladungslinks und keine Geheimnisse, denn ein Prüfprotokoll, das das Gespräch mitkopiert, ist nichts anderes als eine zweite Kopie des Gesprächs.",
          "Eine Datenbankbedingung verweigert jede Entscheidung, die zugleich local only und cloud allowed behauptet. Ein sich selbst widersprechender Datenschutzeintrag kann also gar nicht entstehen, selbst wenn der schreibende Code falsch wäre.",
        ],
      },
      {
        h: "Die Zusicherung",
        body: [
          "Eine menschlich geführte Identität wird niemals stillschweigend in einen autonomen NPC verwandelt. Nicht durch eine Migration, nicht als Rückfalllösung, wenn die Person gerade nicht da ist, und nicht deshalb, weil ein Modell befunden hat, den Rest allein zu schaffen. Wenn eine Identität ihre Art ändert, ist das eine ausdrückliche Handlung der Administration und steht in der Prüfhistorie.",
          "Die Umkehrung gilt ebenso: Ein NPC wird nie als menschlich geführt dargestellt. Gemeinschaften verlieren das Vertrauen in KI Figuren in dem Moment, in dem sie nicht mehr auseinanderhalten können, was was ist. Deshalb behandelt die Plattform das als Korrektheitseigenschaft und nicht als Höflichkeit.",
          "Das ist dieselbe Zusage, die das Archiv beim Einverständnis gibt, nur auf Identität statt auf Inhalte angewendet. Wertvoll ist nicht, dass das System allein etwas Beeindruckendes kann. Wertvoll ist, dass ein Mitglied jederzeit herausfinden kann, wer da antwortet.",
        ],
        callout: "Eine menschlich geführte Identität wird niemals stillschweigend in einen autonomen NPC verwandelt.",
      },
    ],
  },
});

definePage('platform-identities', {
  en: {
    title: "One embedded core, many persistent identities",
    description: "How one embedded SimpleX core hosts many persistent identities: attribution by receiving user, runtime states, roles, and what is wired today.",
    lede: "CIND3R3LLA runs its identities inside one embedded SimpleX core instead of starting a process per bot. This page describes how that works, what already sits in the live path, and what is configuration still waiting for the runtime.",
    sections: [
      {
        h: "The core is embedded, and it runs in one process",
        body: [
          "CIND3R3LLA loads the official SimpleX chat core directly into the Node.js process through the simplex-chat package. There is no separate daemon, no exposed SimpleX port and no remote control channel. The application owns the event loop, the local SimpleX database, file reception, message capture and the outgoing send path.",
          "The core keeps its own state in SQLite, in a directory protected by filesystem permissions. Everything CIND3R3LLA itself remembers, meaning messages, links, consent, settings and audit, lives in a separate PostgreSQL database. The two are deliberately not merged.",
          "Today that core starts with exactly one profile. The display name comes from configuration, no public contact address is created, file transfers are accepted, and the stored profile is only reconciled when an avatar file was actually read, so a missing avatar file can never blank the identity a group already sees.",
        ],
        callout: "The sensitive surface is a local database file, not a network port.",
      },
      {
        h: "Many profiles inside one core",
        body: [
          "The next runtime replaces the single bot wrapper with a shared multi profile core. The design follows measured behaviour of the SimpleX Node SDK rather than assumption: one ChatApi.init(), one startChat(), every profile subscribed at the same time, commands that depend on the active user serialized so two identities cannot interleave a user switch, and outgoing messages recorded from the command result rather than from a hopeful echo. Profiles are not rotated in normal operation.",
          "A profile is a SimpleX user inside the same core, not a second copy of the application. That is what removes the heavy costs of a bot fleet: no second chat core, no second local database and no second process to supervise. What it does not remove is reconciliation, because one conversation reaches every participating profile under its own ids, and mapping those onto a single conversation identity is open design work rather than finished work.",
          "What runs today holds exactly one user handle, and every call that needs a user passes that one identifier. The command scheduler and the subscription tracking described here are the work in progress, not the running system.",
        ],
        callout: "What is multiplied are identities, not processes.",
        status: 'in-development',
      },
      {
        h: "Attribution runs over the receiving identity",
        body: [
          "As soon as several identities share one core, every event has to answer which of them received it. SimpleX answers that with the receiving user id, so attribution is read out of the event and never guessed from the group name or the sender. A SimpleX group id is globally unique inside a core, but it identifies a membership rather than a conversation, so one real conversation yields a different id for every profile that joined it. That is why the honest key is the receiving identity plus the group, and why several memberships have to resolve to a single conversation identity.",
          "Today one identity receives everything, so the schema keys a group on the SimpleX group id alone and enforces that a group id belongs to exactly one configured group. Widening that key, and carrying the receiving identity through the captured message and the send target, is part of the multi profile work rather than a detail left to be discovered later.",
          "Both changes land behind the adapter seam, the interface that separates CIND3R3LLA from the protocol library underneath. Only the adapter may import the SDK, and the check that proves it also synthesises a violation and asserts that it is caught, because a guard nobody has seen fail is a guard nobody knows works.",
        ],
        callout: "A group id means nothing without the identity that received it.",
        status: 'in-development',
      },
      {
        h: "Started is not the same as ready",
        body: [
          "The design distinguishes six states: offline, starting, subscribing, ready, degraded and stopping. A bot is not ready merely because startChat() returned. Subscription progress and operational readiness are separate facts, and a fleet that reports readiness too early sends into groups it has not finished subscribing to.",
          "Degraded is meant to be a real state rather than a polite word for fine, and it is the one state in the set with no measured basis yet, so it will ship labelled untested until a network interruption has actually been observed. The standing rule across this project is that a failure is surfaced rather than swallowed, and a degraded identity belongs on the admin dashboard, not only in a log file. Today the console reports the running bot and its groups and raises explicit errors for faults such as a files folder that could not be configured. The six state machine itself is designed and not yet in the code.",
        ],
        callout: "A bot that reports ready before it has subscribed is a bot that loses messages.",
        status: 'in-development',
      },
      {
        h: "The policy layer is already in the live path",
        body: [
          "Profile and group policy is not a plan. Every ordinary incoming interaction passes through the runtime policy resolver before the interaction engine sees it: the resolver decides, records the decision, and only then calls the engine. A denied message never reaches the engine. Consent commands are the one deliberate exemption, because a blocked member must still be able to withdraw.",
          "Resolution is one query that joins the group to its profile and to the sender's authority entry. The outcome is allow, deny or unassigned, always with an explicit reason: allowed, group unassigned, profile disabled, group disabled or member blocked. Every decision is written to its own table, keyed on the group and the message item, so a redelivered event updates one row instead of growing a journal of duplicates.",
          "A group nobody has assigned yet resolves as unassigned: interaction stays allowed, cloud use stays off, and the decision records that no enforcement was applied. Adding the policy layer therefore did not silently switch off a group that was already working.",
        ],
        callout: "Two fields are types rather than settings: remote commands and persistent changes are typed as permanently false, so no row in any table can turn them on.",
      },
      {
        h: "Profiles, groups and authorities",
        body: [
          "A profile carries a slug, a display name, an enabled flag, a local only flag and a cloud allowed flag. A personality column exists alongside them, but nothing writes it yet, so every profile currently holds the same default. The slug rule, 2 to 63 lowercase letters, digits or hyphens, is enforced in the code and again as a database constraint, and the database refuses a profile that is both local only and cloud allowed.",
          "Groups are typed as team, member or test. A profile has at most one team group, enforced by a partial unique index rather than by application discipline, and one SimpleX group can be assigned to exactly one configured group. At the profile level, a profile has at most one enabled owner, enforced by the same kind of partial unique index.",
          "Inside a group a member can be owner, administrator, moderator, team member, member, auditor or blocked. Management capability belongs to the first three. Team guidance is granted only inside a team group, so an ordinary community group cannot become a back channel for changing how an identity behaves. A member with no entry resolves to member, and the decision records whether that role was assigned or defaulted. Every creation and every role change writes an audit row, and enabling or disabling a profile or a group does too. Disabling an individual authority is not wired up yet, so the enabled flag on an authority is currently set at creation and not changed.",
        ],
        callout: "Local only wins. If a profile is marked local only, the resolver forces cloud use off regardless of what the cloud flag says.",
      },
      {
        h: "The bot registry stores intent, it does not act",
        body: [
          "A second table holds the desired onboarding configuration for a bot identity: whether an address is created or updated, whether the profile is updated, whether contacts are accepted automatically, the welcome message, whether files are allowed, the command registry mode, how group invitations are handled (manual, automatic, approved contacts or approved groups), the expected role in the group, whether that role is verified before the profile is activated, retention windows for pending contact requests and invitations, and a ceiling on how many requests may be pending.",
          "The service that owns this table never calls the SDK, and it says so in its own audit trail: every write records that the runtime was not applied, and deleting an entry records that no SimpleX identity was deleted and no group membership changed. The workflow states from configured through joined and role verified to ready are declared, and only the reset transition is implemented. The rest move when the runtime applies the configuration to a live core.",
        ],
        callout: "Configuration that has not been applied is recorded as not applied. The audit trail does not flatter it.",
        status: 'in-development',
      },
      {
        h: "Four actor types, and what a label is for",
        body: [
          "The identity model will separate a real member, a human operated agent, an autonomous NPC and technical system automation. The distinction is designed to control permissions and automation, and deliberately not to be stamped onto every message and avatar. Transparency belongs in onboarding, in the welcome message, in the terms, in the profile information and in a public directory of identities, where a person can actually read it. A fantasy avatar says nothing about whether a human stands behind the identity.",
          "The rule that matters most is a negative one: the system must never quietly convert a human operated identity into an autonomous one. Today permissions are expressed as the profile and group roles above, and the actor type taxonomy arrives with the controls for human operated agents.",
        ],
        callout: "The system must never quietly turn a supervised identity into an autonomous one.",
        status: 'in-development',
      },
      {
        h: "Names for generated identities",
        body: [
          "A deterministic name generator is built and verified as a standalone component. A seed plus a configuration produces a name, the same seed produces the same name again, the draw is Zipf shaped so a few names recur and most are rare, and the result is sanitised so it is valid as a SimpleX display name. It touches no database, no runtime and no network.",
          "It is not yet wired into profile creation, and two advertised properties are not delivered: the shipped corpus carries no culture labels, so the culture grammar currently runs against small hand written fixture pools, and it carries no frequency data, so which names come out common is arbitrary rather than drawn from a real population. Culturally coherent names arrive with a labelled corpus, and the swap point is marked in the code rather than left implied.",
        ],
        status: 'in-development',
      },
      {
        h: "What this means if you are running a community",
        body: [
          "For an operator the practical question is what a second identity costs. For an operator the practical question is what a second identity will cost. The design answers a row and a subscription rather than a second server, and today one identity is what actually runs, so treat that answer as the target rather than as something you can provision now. Assignments are stored against stable SimpleX identifiers, so renaming a group in the client does not detach its policy.",
          "Consent identity is unaffected, because consent is keyed on the member id the protocol gives every profile alike, and no profile, role or policy row can publish on a member's behalf. How publication behaves when several identities share one group is still open design work, and it is being settled before any second identity goes live. Publication stays derived from what a member opted into personally, and no profile, role or policy row can publish on a member's behalf. Identity decides who may speak and with what authority. It never decides what becomes public.",
        ],
        callout: "A second identity costs a row and a subscription, not a second server.",
      },
    ],
  },
  de: {
    title: "Ein eingebetteter Kern, viele dauerhafte Identitäten",
    description: "Wie ein eingebetteter SimpleX-Kern viele dauerhafte Identitäten trägt: Zuordnung über den Empfänger, Laufzeitzustände, Rollen und der reale Stand.",
    lede: "CIND3R3LLA betreibt ihre Identitäten in einem einzigen eingebetteten SimpleX-Kern, statt für jeden Bot einen eigenen Prozess zu starten. Diese Seite beschreibt, wie das funktioniert, was bereits im laufenden Pfad liegt und was noch Konfiguration ist, die auf die Laufzeit wartet.",
    sections: [
      {
        h: "Der Kern ist eingebettet und läuft in einem Prozess",
        body: [
          "CIND3R3LLA lädt den offiziellen SimpleX-Chat-Kern über das Paket simplex-chat direkt in den Node.js-Prozess. Es gibt keinen separaten Daemon, keinen offenen SimpleX-Port und keinen Fernsteuerungskanal. Die Anwendung besitzt die Ereignisschleife, die lokale SimpleX-Datenbank, den Dateiempfang, die Nachrichtenerfassung und den Sendeweg.",
          "Der Kern hält seinen eigenen Zustand in SQLite, in einem Verzeichnis, das über Dateisystemrechte geschützt ist. Alles, woran sich CIND3R3LLA selbst erinnert, also Nachrichten, Links, Einwilligungen, Einstellungen und Audit, liegt in einer eigenen PostgreSQL-Datenbank. Beide werden bewusst nicht vermischt.",
          "Heute startet dieser Kern mit genau einem Profil. Der Anzeigename stammt aus der Konfiguration, es wird keine öffentliche Kontaktadresse angelegt, Dateiübertragungen werden angenommen, und das gespeicherte Profil wird nur dann abgeglichen, wenn tatsächlich eine Avatardatei gelesen wurde. Eine fehlende Avatardatei kann die Identität, die eine Gruppe bereits sieht, also nicht leeren.",
        ],
        callout: "Die sensible Oberfläche ist eine lokale Datenbankdatei, kein Netzwerkport.",
      },
      {
        h: "Viele Profile in einem Kern",
        body: [
          "Die nächste Laufzeit ersetzt den bisherigen Einzelbot-Wrapper durch einen gemeinsamen Mehrprofil-Kern. Der Entwurf folgt dem gemessenen Verhalten des SimpleX-Node-SDK und nicht einer Annahme: ein ChatApi.init(), ein startChat(), alle Profile gleichzeitig abonniert, Befehle, die vom aktiven Nutzer abhängen, streng nacheinander ausgeführt, damit sich zwei Identitäten beim Nutzerwechsel nicht verschränken, und ausgehende Nachrichten aus dem Ergebnis des Befehls protokolliert statt aus einem hoffnungsvollen Echo. Im Normalbetrieb wird zwischen Profilen nicht gewechselt.",
          "Ein Profil ist ein SimpleX-Nutzer im selben Kern und keine zweite Kopie der Anwendung. Genau das nimmt einer Bot-Flotte die üblichen Kosten: kein zweiter Chat-Kern, keine zweite lokale Datenbank, kein zweiter Satz Netzwerkabonnements und kein zweites Archiv, das man hinterher zusammenführen muss.",
          "Was heute läuft, hält genau ein Nutzerhandle, und jeder Aufruf, der einen Nutzer braucht, übergibt diese eine Kennung. Der Befehls-Scheduler und die Abonnementverfolgung sind die laufende Arbeit, nicht das laufende System.",
        ],
        callout: "Vervielfacht werden Identitäten, nicht Prozesse.",
        status: 'in-development',
      },
      {
        h: "Zuordnung über die empfangende Identität",
        body: [
          "Sobald mehrere Identitäten einen Kern teilen, muss jedes Ereignis beantworten, welche von ihnen es empfangen hat. SimpleX beantwortet das über die Nutzerkennung des Empfängers, deshalb wird die Zuordnung aus dem Ereignis gelesen und nicht aus dem Gruppennamen oder dem Absender erraten. Eine lokale Gruppenkennung ist nur innerhalb der lokalen Datenbank eines Nutzers eindeutig, folglich ist der ehrliche Schlüssel für eine Gruppe das Paar aus empfangender Identität und Gruppe.",
          "Heute empfängt eine einzige Identität alles, deshalb schlüsselt das Schema eine Gruppe allein über die SimpleX-Gruppenkennung und erzwingt, dass eine Gruppenkennung zu genau einer konfigurierten Gruppe gehört. Diesen Schlüssel zu erweitern und die empfangende Identität durch die erfasste Nachricht und das Sendeziel zu führen, gehört zur Mehrprofil-Arbeit und ist kein Detail, das man später entdeckt.",
          "Beide Änderungen liegen hinter der Adapter-Naht, also der Schnittstelle, die CIND3R3LLA von der darunterliegenden Protokollbibliothek trennt. Nur der Adapter darf das SDK importieren, und die Prüfung, die das belegt, erzeugt zusätzlich absichtlich einen Verstoß und weist nach, dass er auffällt. Ein Wächter, den nie jemand scheitern sah, ist ein Wächter, von dem niemand weiß, ob er funktioniert.",
        ],
        callout: "Eine Gruppenkennung bedeutet nichts ohne die Identität, die sie empfangen hat.",
        status: 'in-development',
      },
      {
        h: "Gestartet ist nicht bereit",
        body: [
          "Die Laufzeit unterscheidet sechs Zustände: offline, startend, abonnierend, bereit, eingeschränkt und stoppend. Ein Bot ist nicht bereit, nur weil startChat() zurückgekehrt ist. Abonnementfortschritt und Betriebsbereitschaft sind zwei verschiedene Tatsachen, und wer Bereitschaft zu früh meldet, sendet in Gruppen, die er noch nicht fertig abonniert hat.",
          "Eingeschränkt ist ein echter Zustand und kein höfliches Wort für in Ordnung. Im ganzen Projekt gilt die Regel, dass ein Fehler sichtbar gemacht und nicht verschluckt wird, und eine eingeschränkte Identität gehört auf das Administrationsdashboard und nicht nur in eine Logdatei. Heute meldet die Konsole den laufenden Bot und seine Gruppen und zeigt ausdrückliche Fehler an, etwa wenn der Dateiordner nicht gesetzt werden konnte. Der Zustandsautomat mit sechs Zuständen ist entworfen und noch nicht im Code.",
        ],
        callout: "Ein Bot, der Bereitschaft meldet, bevor er abonniert hat, ist ein Bot, der Nachrichten verliert.",
        status: 'in-development',
      },
      {
        h: "Die Policy-Schicht liegt bereits im laufenden Pfad",
        body: [
          "Profil- und Gruppen-Policy ist kein Plan. Jede eingehende Interaktion läuft durch den Policy-Resolver, bevor die Interaktions-Engine sie sieht: der Resolver entscheidet, schreibt die Entscheidung mit und ruft erst danach die Engine auf. Eine abgelehnte Nachricht erreicht die Engine überhaupt nicht.",
          "Die Auflösung ist eine Abfrage, die die Gruppe mit ihrem Profil und mit dem Berechtigungseintrag des Absenders verbindet. Das Ergebnis ist erlauben, ablehnen oder nicht zugeordnet, immer mit ausdrücklichem Grund: erlaubt, Gruppe nicht zugeordnet, Profil deaktiviert, Gruppe deaktiviert oder Mitglied gesperrt. Jede Entscheidung landet in einer eigenen Tabelle, geschlüsselt über Gruppe und Nachrichtenelement, sodass ein erneut zugestelltes Ereignis eine Zeile aktualisiert, statt ein Journal voller Dubletten wachsen zu lassen.",
          "Eine Gruppe, die noch niemand zugeordnet hat, wird als nicht zugeordnet aufgelöst: die Interaktion bleibt erlaubt, die Cloud-Nutzung bleibt aus, und die Entscheidung hält fest, dass keine Durchsetzung angewandt wurde. Die Policy-Schicht hat damit keine bereits laufende Gruppe stillschweigend abgeschaltet.",
        ],
        callout: "Zwei Felder sind Typen und keine Einstellungen: Fernbefehle und dauerhafte Änderungen sind fest als falsch typisiert, keine Tabellenzeile kann sie einschalten.",
      },
      {
        h: "Profile, Gruppen und Berechtigungen",
        body: [
          "Ein Profil trägt einen Slug, einen Anzeigenamen, ein Aktivkennzeichen, ein Kennzeichen für reinen Lokalbetrieb, ein Kennzeichen für erlaubte Cloud-Nutzung und eine Persönlichkeitsbezeichnung. Die Slug-Regel, 2 bis 63 Kleinbuchstaben, Ziffern oder Bindestriche, steht im Code und noch einmal als Datenbankbedingung, und die Datenbank weist ein Profil zurück, das gleichzeitig rein lokal und cloudfähig wäre.",
          "Gruppen sind als Team, Mitglied oder Test typisiert. Ein Profil hat höchstens eine Teamgruppe, erzwungen durch einen partiellen eindeutigen Index und nicht durch Disziplin im Anwendungscode, und eine SimpleX-Gruppe lässt sich genau einer konfigurierten Gruppe zuordnen. Aus demselben strukturellen Grund hat ein Profil höchstens einen aktiven Eigentümer.",
          "Innerhalb einer Gruppe kann ein Mitglied Eigentümer, Administrator, Moderator, Teammitglied, Mitglied, Prüfer oder gesperrt sein. Verwalten dürfen die ersten drei. Teamführung wird nur innerhalb einer Teamgruppe gewährt, damit eine gewöhnliche Community-Gruppe kein Nebenkanal wird, über den sich das Verhalten einer Identität ändern lässt. Ein Mitglied ohne Eintrag wird als Mitglied aufgelöst, und die Entscheidung hält fest, ob diese Rolle zugewiesen oder voreingestellt war. Jede Anlage, jede Rollenänderung und jedes Aktivieren oder Deaktivieren schreibt einen Auditeintrag.",
        ],
        callout: "Lokal gewinnt. Ist ein Profil als rein lokal markiert, erzwingt der Resolver den Verzicht auf die Cloud, unabhängig davon, was das Cloud-Kennzeichen sagt.",
      },
      {
        h: "Die Bot-Registrierung speichert Absicht, sie handelt nicht",
        body: [
          "Eine zweite Tabelle hält die gewünschte Onboarding-Konfiguration einer Bot-Identität: ob eine Adresse angelegt oder aktualisiert wird, ob das Profil aktualisiert wird, ob Kontakte automatisch angenommen werden, die Willkommensnachricht, ob Dateien erlaubt sind, der Modus der Befehlsregistrierung, wie mit Gruppeneinladungen umgegangen wird (manuell, automatisch, geprüfte Kontakte oder geprüfte Gruppen), die erwartete Rolle in der Gruppe, ob diese Rolle vor der Aktivierung geprüft wird, Aufbewahrungsfristen für offene Kontaktanfragen und Einladungen sowie eine Obergrenze für offene Anfragen.",
          "Der Dienst, dem diese Tabelle gehört, ruft das SDK nie auf, und er schreibt das in seinen eigenen Audittrail: jeder Schreibvorgang hält fest, dass die Laufzeit nicht angewandt wurde, und das Löschen eines Eintrags hält fest, dass keine SimpleX-Identität gelöscht und keine Gruppenmitgliedschaft verändert wurde. Die Workflow-Zustände von konfiguriert über beigetreten und Rolle geprüft bis bereit sind deklariert, umgesetzt ist bisher nur das Zurücksetzen. Der Rest bewegt sich, sobald die Laufzeit die Konfiguration auf einen laufenden Kern anwendet.",
        ],
        callout: "Konfiguration, die nicht angewandt wurde, wird als nicht angewandt protokolliert. Der Audittrail schmeichelt ihr nicht.",
        status: 'in-development',
      },
      {
        h: "Vier Akteurstypen, und wozu ein Etikett gut ist",
        body: [
          "Das Identitätsmodell unterscheidet ein echtes Mitglied, eine menschlich geführte Agentin, einen autonomen NPC und technische Systemautomatisierung. Die Unterscheidung steuert Rechte und Automatisierung und wird bewusst nicht jeder Nachricht und jedem Avatar aufgestempelt. Transparenz gehört ins Onboarding, in die Willkommensnachricht, in die Nutzungsbedingungen, in die Profilangaben und in ein öffentliches Verzeichnis der Identitäten, wo Menschen sie tatsächlich lesen. Ein Fantasieavatar sagt nichts darüber aus, ob ein Mensch hinter der Identität steht.",
          "Die wichtigste Regel ist eine negative: das System darf eine menschlich geführte Identität niemals unbemerkt in eine autonome verwandeln. Heute werden Rechte über die oben beschriebenen Profil- und Gruppenrollen ausgedrückt, die Typologie der Akteure kommt mit den Steuerungen für menschlich geführte Agenten.",
        ],
        callout: "Das System darf eine betreute Identität niemals unbemerkt in eine autonome verwandeln.",
        status: 'in-development',
      },
      {
        h: "Namen für erzeugte Identitäten",
        body: [
          "Ein deterministischer Namensgenerator ist als eigenständige Komponente gebaut und geprüft. Ein Startwert plus Konfiguration ergibt einen Namen, derselbe Startwert ergibt wieder denselben Namen, Häufigkeitsstatistiken halten häufige Namen häufig, und das Ergebnis wird so bereinigt, dass es als SimpleX-Anzeigename gültig ist. Er benötigt keine Datenbank, keine Laufzeit und kein Netz.",
          "Mit der Profilanlage verdrahtet ist er noch nicht, und eine beworbene Eigenschaft fehlt: das ausgelieferte Korpus trägt keine Kulturkennzeichen, deshalb arbeitet die Kulturgrammatik derzeit auf kleinen, von Hand geschriebenen Beispielmengen. Kulturell stimmige Namen kommen mit einem gekennzeichneten Korpus, und die Stelle für den Austausch ist im Code markiert statt nur angedeutet.",
        ],
        status: 'in-development',
      },
      {
        h: "Was das für den Betrieb einer Community bedeutet",
        body: [
          "Für Betreibende ist die praktische Frage, was eine zweite Identität kostet. In diesem Entwurf kostet sie eine Zeile und ein Abonnement, keinen Server, kein zweites Archiv und keine zweite Sicherungsroutine. Zuordnungen liegen auf stabilen SimpleX-Kennungen, deshalb löst das Umbenennen einer Gruppe im Client ihre Policy nicht ab.",
          "An der Einwilligung ändert das nichts. Die Veröffentlichung bleibt daraus abgeleitet, wozu ein Mitglied persönlich eingewilligt hat, und kein Profil, keine Rolle und keine Policy-Zeile kann an seiner Stelle veröffentlichen. Identität entscheidet, wer sprechen darf und mit welcher Befugnis. Sie entscheidet nie, was öffentlich wird.",
        ],
        callout: "Eine zweite Identität kostet eine Zeile und ein Abonnement, keinen zweiten Server.",
      },
    ],
  },
});

definePage('platform-interaction', {
  en: {
    title: "Interaction and plugins",
    description: "Wake word addressing in English and German, three slash commands, a closed intent catalog, and a plugin boundary where disabling a plugin removes its intents.",
    lede: "Members talk to the bot the way they talk to anyone else in the group: by name, in English or German, with their typos forgiven. Everything behind that is deliberate about when it answers, when it stays quiet, and what it is permitted to understand at all.",
    sections: [
      {
        h: "How a member addresses the bot",
        body: [
          "The wake word is the bot's own name, and the name belongs to the deployment: CIND3R3LLA is the product, and each community names the bot it runs. Because the trigger is a name rather than a fixed phrase, it works in any language without a rule per language. A greeting in front of it is optional decoration and gets stripped, so \"Hallo Cinderella\" and \"Good morning Cinderella\" land exactly like the bare name. The greeting list is a setting, shipped with the common English and German ones, and an operator adds their own.",
          "The name has to be the first standalone word. Only a short prefix may precede it, a greeting or a discourse filler such as \"so\" or \"ok\", at most three words and twenty characters. \"I think Cinderella is great\" is therefore not an address, and neither is a possessive or a German compound such as \"Cinderellas Archiv\". That last case is exactly why fuzzy matching cannot be naive: the suffixed form sits one edit away from the name, so plain edit distance would forgive the one case that must be ignored. The matcher forgives \"cinderela\" and \"cinderlla\" and refuses anything that is the name plus something.",
          "Typo tolerance is tiered by word length: three characters or fewer must match exactly, up to six absorbs one slip, longer words two. In a short word a swapped letter is not a typo, it is a different word.",
          "Once a conversation is open, a member has sixty seconds to follow up without repeating the name, and a direct reply to one of the bot's own messages counts as an address on its own. Two modes are available: relaxed, where a leading name is enough, and strict, where a greeting is required before it. Direct replies, the follow-up window and the slash commands are unaffected by strict mode.",
          "Shortened forms of the name are recognised in the same position and answered with a retort, twelve per language, shipped and editable. They are never resolved and never act on anything, and after three in a row the bot goes quiet.",
        ],
        callout: "In doubt, silence. A missed address is a small annoyance; an unwanted interjection in a busy group is not.",
      },
      {
        h: "English and German, both first class",
        body: [
          "Normalisation is deliberately aggressive, so that a member's typing habits do not decide whether they are heard. Case is folded, German umlauts are expanded the way people type them without a German keyboard (ä becomes ae, ö becomes oe, ü becomes ue, ß becomes ss), remaining diacritics are stripped, and punctuation is not part of a token. \"veröffentliche\" and \"veroeffentliche\" become the same string, which is what lets one keyword list cover both spellings.",
          "Every intent carries phrase and keyword sets in both languages, and a longer contiguous phrase always outranks a single keyword. \"stop publishing\" is read as a withdrawal, not as \"publish\" with a stray word in front of it.",
          "Which language to answer in is decided by a scored contest between two hint sets, with a margin the winner has to clear. The first version simply asked whether any German looking word was present, and it fired in the live group on a 357 word English announcement that contained \"hallo\" once, inside its own example. One token in 357 chose the reply language. Where a keyword set matches unambiguously, that match is the stronger evidence and the answer follows it; the detected language is remembered for the length of the follow-up window; and an operator who wants one language only can fix it.",
          "Persona copy is data rather than code. Her persona strings and her retorts exist per language, are editable in the admin console, and fall back to the shipped wording when a field is left blank. The consent notices and the publishing properties inside the help reply stay in code on purpose, so what a member is told about publishing cannot drift from what actually happens. Adding a language is adding a key for her persona replies. The help reply still ships in English and German only, so a newly added language answers help in English until that copy is written.",
        ],
        callout: "Both languages ship as defaults with their own keyword sets and their own copy. Neither is a translation layer over the other.",
      },
      {
        h: "Three slash commands, and one route no setting can close",
        body: [
          "Slash commands are shorthand, not a second product. There are exactly three. /publish and /unpublish are matched exactly, as the whole message; /help is matched as its own word, so /helpdesk is not caught. Anything else beginning with a slash is not treated as an instruction at all.",
          "The command route is immediate: it does not ask the confirmation question the spoken route asks, because typing the command is already unambiguous. Both routes share a single consent write path, so an opt in by command and an opt in by conversation are journalled, audited and undone in exactly the same way.",
          "There used to be a setting that switched slash commands off. It is gone. Its entire reach was those two consent commands, and with it off /unpublish neither acted nor replied: a member who types it and sees nothing reasonably concludes that it worked, while their words stay public. The setting was removed rather than left inert, because a control whose label promises more than it can do is worse than no control at all.",
          "Natural addressing itself can still be switched off, for an operator who wants a quiet bot in a busy group. The consent commands keep working, so the withdrawal route survives every configuration.",
        ],
        callout: "Withdrawing consent is not a convenience feature. No setting can take that route away.",
      },
      {
        h: "A closed catalog, and a resolver that executes nothing",
        body: [
          "There are nine intents and no tenth: publish, unpublish, restore, status, search, price, help, undo, and not understood. The set is closed in the type system, and every result is validated again at the seam that all callers go through, against the catalog as it stands at that moment. A resolver that returns something outside it has said \"not understood\", never \"go ahead\".",
          "A resolver reports what it believes was meant. It never acts. The engine performs the action and the consent code decides whether it is permitted, and that separation is precisely what has to survive when a model takes over the understanding.",
          "Three consequences a member notices. A spoken consent change always confirms first, and the offer lives exactly as long as the conversation does. The typed command stays immediate, because typing it is already unambiguous. A request on somebody else's behalf is refused outright, including from an administrator, because consent is first person only. And a question about state stays a question: \"what is my publish status\" is answered with the status, rather than putting a consent prompt in front of somebody who only asked.",
        ],
      },
      {
        h: "When the bot says nothing",
        body: [
          "Doubt is expressed as silence or as a question, never as a guess. A hypothetical framing (\"what happens if I say ...\"), a negation within three tokens of the match, or a keyword inside quotation marks collapses the score, and anything below the configured confidence, 0.55 by default, counts as not understood. Above two hundred characters an instruction is acted on only at high confidence, because a command is short and a pasted article that happens to open with the name is not one.",
          "Every guard that produces silence also makes the bot look broken from the outside, so each ignored candidate is recorded with its reason, forwarded message, weak signal, too long, strict mode without a greeting, and shown in the admin console. These are diagnostics, not a record: held in memory, capped at fifty, truncated, and gone after a restart.",
          "How answers appear is a setting as well. Plain by default; mention prefixes the member's name; quote repeats the message being answered. Consent prompts never quote, whatever the mode says. Replies are rate limited per member and per chat, six and twenty a minute by default, and a display name has its formatting characters stripped before it is used, so a name cannot open a span that swallows the rest of the sentence.",
        ],
      },
      {
        h: "The plugin boundary",
        body: [
          "A plugin declares four things and nothing else: who it is, whether it is on by default, which intents it contributes, and where its settings page lives. Adding one is that declaration plus a settings page, with no change to the sidebar, the resolver or the settings framework. Plugins are part of the build; there is no runtime drop-in directory.",
          "The load bearing property is what happens when a plugin is switched off. Its intents do not remain in the catalog to be refused later, they leave the catalog. The rule engine never even considers the disabled plugin's patterns, the seam downgrades anything claiming its intent to \"not understood\", and the help reply, which is generated from the live catalog rather than written out as a list, stops advertising the capability. A half wired handler behind a disabled switch is exactly the thing that answers a question it should not.",
        ],
        callout: "A disabled plugin does not go quiet. It leaves the intent catalog.",
      },
      {
        h: "Crypto Prices, the shipped example",
        body: [
          "The first plugin answers price and conversion questions from a chain of market data providers. Prices are always fetched on request, never preloaded. The only thing between a question and the provider is a short cache, and it exists to keep a busy group from burning the provider's rate limit, not to make a price last longer.",
          "Symbols are resolved once and then pinned. Asking a provider \"what is HEX\" every time would mean the same question quietly returning a different token's price once search rankings moved. When more than one asset genuinely claims a ticker, the member is asked and answers with a number, and that answer is pinned so nobody is asked again. Where the leading candidate outweighs the next by a hundred to one, it is pinned without asking, because whether someone meant Bitcoin or \"Bitcoin AI\" is not a real question; an operator who disagrees sets that factor to zero and is always asked.",
          "The resolver never learns which symbols exist; that is the registry's business. It hands over the words the member actually wrote, plus the other candidates in the sentence, and the price service prefers whichever is already pinned. That is what turns \"one real bitcoin\" into Bitcoin rather than an unknown token called \"real\", and it is why an operator can add a token without a code change.",
          "Inside the follow-up window a fragment can inherit the previous question, so \"monero?\" after a price answer is a price question. It may reuse knowledge and never create it: both the asset and the currency must already be pinned. The rule exists because applause once inherited a price question, went to a provider as a ticker, and came back offering the member a choice between two real tokens.",
        ],
      },
      {
        h: "Where a local model is allowed to help",
        body: [
          "The deterministic rule engine is the standing implementation and the automatic fallback. When an operator connects a local Ollama runtime, a model can be registered behind the same seam; if it fails, is slow, or answers outside the catalog, the rules answer instead. With the runtime off, the rules are simply what runs.",
          "The model classifies. It never executes, writes consent, calls a tool, or decides whether a confirmation was accepted, and a consent intent is accepted from it only when the rule engine independently found the same intent. A model mistake can therefore cost an understanding. It cannot cost a publication.",
          "A second model may phrase a finished reply. It has no database, consent, tool or transport capability and receives a draft the engine has already produced. Values that must survive a rewrite, counts and prices, are checked for; values that must not appear, such as the sender's display name, are checked against; and dashes in the output are rewritten, because no member facing string in this product carries one. If a check fails, the deterministic wording is sent.",
        ],
      },
      {
        h: "A native command menu, generated but not connected",
        body: [
          "The SimpleX SDK can register a bot command menu that a client renders in its compose bar. It is a one to one affordance: the bot has no contact address and members only ever meet it in the group, so registering the menu would publish a list nobody could reach.",
          "The producer exists anyway and is fed from the same active catalog as the text help, so the day the bot is given a direct chat surface, the menu is one line away and already reflects exactly which plugins are enabled. Until then, the help reply is the command list.",
        ],
        status: 'in-development',
      },
    ],
  },
  de: {
    title: "Interaktion und Plugins",
    description: "Ansprache per Weckwort auf Deutsch und Englisch, drei Slash-Befehle, ein geschlossener Intent-Katalog und eine Plugin-Grenze, die Intents wirklich entfernt.",
    lede: "Mitglieder sprechen den Bot so an, wie sie jeden anderen in der Gruppe ansprechen: beim Namen, auf Deutsch oder Englisch, Tippfehler inklusive. Alles dahinter ist eine bewusste Entscheidung darüber, wann er antwortet, wann er schweigt und was er überhaupt verstehen darf.",
    sections: [
      {
        h: "Wie ein Mitglied den Bot anspricht",
        body: [
          "Das Weckwort ist der Name des Bots, und dieser Name gehört zur Installation: CIND3R3LLA ist der Produktname, den Namen des Bots vergibt die jeweilige Community. Weil ein Name weckt und keine feste Wendung, funktioniert das in jeder Sprache ohne eigene Regel je Sprache. Eine Begrüßung davor ist freiwilliges Beiwerk und wird abgeschnitten, deshalb kommen \"Hallo\", \"Bonjour\" und \"Guten Morgen\" gleichermaßen an.",
          "Der Name muss das erste eigenständige Wort sein. Davor ist nur ein kurzer Vorspann erlaubt, eine Begrüßung oder ein Füllwort wie \"also\" oder \"ok\", höchstens drei Wörter und zwanzig Zeichen. \"Ich finde Cinderella großartig\" ist damit keine Ansprache, ein Genitiv oder ein Kompositum wie \"Cinderellas Archiv\" ebenso wenig. Genau daran hängt die Tippfehlertoleranz: die angehängte Form liegt nur eine Änderung vom Namen entfernt, eine naive Ähnlichkeitssuche würde also ausgerechnet den Fall durchwinken, der ignoriert werden muss. Der Abgleich verzeiht \"cinderela\" und \"cinderlla\" und weist alles zurück, was der Name plus Anhängsel ist.",
          "Die Toleranz ist nach Wortlänge gestaffelt: bis drei Zeichen muss exakt getroffen werden, bis sechs Zeichen ist ein Fehler erlaubt, darüber zwei. In einem kurzen Wort ist ein vertauschter Buchstabe kein Tippfehler, sondern ein anderes Wort.",
          "Ist das Gespräch eröffnet, darf ein Mitglied sechzig Sekunden lang nachfassen, ohne den Namen zu wiederholen, und eine direkte Antwort auf eine Nachricht des Bots gilt für sich genommen als Ansprache. Zwei Modi stehen zur Wahl: locker, dort genügt der vorangestellte Name, und streng, dort ist eine Begrüßung Pflicht. Direkte Antworten, das Nachfassfenster und die Slash-Befehle bleiben davon unberührt.",
          "Kurzformen des Namens erkennt der Bot an derselben Stelle und beantwortet sie mit einer Spitze, zwölf je Sprache, mitgeliefert und im Admin änderbar. Sie werden nie ausgewertet und lösen nie eine Aktion aus, und nach dreimaligem Nachlegen schweigt er.",
        ],
        callout: "Im Zweifel Schweigen. Eine überhörte Ansprache ist ein kleines Ärgernis, ein ungebetener Einwurf in einer lebhaften Gruppe nicht.",
      },
      {
        h: "Englisch und Deutsch, beide vollwertig",
        body: [
          "Die Normalisierung ist bewusst grob, damit nicht die Tippgewohnheiten eines Mitglieds darüber entscheiden, ob es gehört wird. Groß- und Kleinschreibung fällt weg, deutsche Umlaute werden so aufgelöst, wie man sie ohne deutsche Tastatur schreibt (ä wird ae, ö wird oe, ü wird ue, ß wird ss), übrige diakritische Zeichen werden entfernt, Satzzeichen gehören nicht zum Token. \"veröffentliche\" und \"veroeffentliche\" ergeben dieselbe Zeichenkette, und nur deshalb deckt eine Stichwortliste beide Schreibweisen ab.",
          "Zu jedem Intent gehören Wendungen und Stichwörter in beiden Sprachen, und eine längere zusammenhängende Wendung schlägt immer ein einzelnes Stichwort. \"hör auf zu veröffentlichen\" ist deshalb ein Widerruf und nicht \"veröffentlichen\" mit einem Wort davor.",
          "Welche Sprache geantwortet wird, entscheidet ein gewichteter Vergleich zweier Hinweislisten, und der Sieger muss einen Vorsprung erreichen. Die erste Fassung fragte nur, ob irgendwo ein deutsch aussehendes Wort steht, und sie schlug in der echten Gruppe bei einer 357 Wörter langen englischen Ankündigung zu, die das Wort \"hallo\" genau einmal enthielt, nämlich im eigenen Beispielsatz. Ein Token von 357 bestimmte die Antwortsprache. Trifft eine Stichwortliste eindeutig, gilt dieser Treffer als das bessere Indiz und die Antwort folgt ihm; die erkannte Sprache wird für die Dauer des Nachfassfensters gemerkt; und wer nur eine Sprache will, stellt sie fest ein.",
          "Die Persona-Texte sind Daten, nicht Code. Jeder Satz, den der Bot sagen kann, existiert je Sprache, ist im Admin editierbar und fällt auf die mitgelieferte Fassung zurück, sobald ein Feld leer bleibt. Eine Sprache hinzuzufügen heißt, einen Schlüssel hinzuzufügen, nicht Code zu ändern.",
        ],
        callout: "Beide Sprachen sind mitgeliefert, mit eigenen Stichwortlisten und eigenen Texten. Keine ist eine Übersetzungsschicht über der anderen.",
      },
      {
        h: "Drei Slash-Befehle, und ein Weg, den keine Einstellung schließt",
        body: [
          "Slash-Befehle sind eine Kurzform, kein zweites Produkt. Es gibt genau drei. /publish und /unpublish werden exakt erkannt, als vollständige Nachricht; /help wird als eigenes Wort erkannt, damit /helpdesk nicht mitgefangen wird. Alles andere, was mit einem Schrägstrich beginnt, gilt gar nicht erst als Anweisung.",
          "Der Befehlsweg wirkt sofort: er stellt nicht die Rückfrage, die der gesprochene Weg stellt, denn wer den Befehl tippt, meint ihn eindeutig. Beide Wege teilen sich einen einzigen Schreibpfad für die Einwilligung, also werden ein Opt-in per Befehl und ein Opt-in im Gespräch identisch protokolliert, auditiert und rückgängig gemacht.",
          "Früher gab es eine Einstellung, die Slash-Befehle abschaltete. Sie ist entfernt. Ihre gesamte Reichweite waren diese beiden Einwilligungsbefehle, und abgeschaltet tat /unpublish weder etwas noch antwortete es: Wer den Befehl tippt und nichts sieht, schließt vernünftigerweise, dass er gewirkt hat, während die eigenen Worte öffentlich bleiben. Die Einstellung wurde entfernt und nicht wirkungslos stehen gelassen, denn ein Schalter, dessen Beschriftung mehr verspricht, als er kann, ist schlechter als gar kein Schalter.",
          "Die natürliche Ansprache selbst lässt sich weiterhin abschalten, für Betreiber, die in einer lebhaften Gruppe Ruhe wollen. Die Einwilligungsbefehle arbeiten weiter, der Weg zum Widerruf überlebt also jede Konfiguration.",
        ],
        callout: "Einen Widerruf zu erklären ist kein Komfortmerkmal. Keine Einstellung kann diesen Weg wegnehmen.",
      },
      {
        h: "Ein geschlossener Katalog, und ein Resolver, der nichts ausführt",
        body: [
          "Es gibt neun Intents und keinen zehnten: veröffentlichen, widerrufen, zurückholen, Status, Suche, Preis, Hilfe, rückgängig und nicht verstanden. Die Menge ist im Typsystem geschlossen, und jedes Ergebnis wird an der Nahtstelle, über die alle Aufrufer gehen, erneut gegen den Katalog geprüft, so wie er in diesem Moment aussieht. Ein Resolver, der etwas außerhalb davon zurückgibt, hat \"nicht verstanden\" gesagt, nie \"tu es\".",
          "Ein Resolver berichtet, was gemeint gewesen sein dürfte. Er handelt nie. Die Aktion führt die Dialogschicht aus, und ob sie erlaubt ist, entscheidet der Einwilligungscode. Genau diese Trennung muss halten, wenn ein Modell das Verstehen übernimmt.",
          "Drei Folgen, die ein Mitglied merkt. Eine Änderung der Einwilligung wird immer erst bestätigt, und das Angebot lebt genau so lange wie das Gespräch. Eine Bitte im Namen einer anderen Person wird rundweg abgelehnt, auch von Administratoren, denn Einwilligung gibt es nur in der ersten Person. Und eine Frage nach dem Zustand bleibt eine Frage: \"wie ist mein Veröffentlichungsstatus\" wird mit dem Status beantwortet, statt jemandem eine Einwilligungsabfrage vorzusetzen, der nur gefragt hat.",
        ],
      },
      {
        h: "Wann der Bot schweigt",
        body: [
          "Zweifel wird als Schweigen oder als Rückfrage ausgedrückt, nie als Vermutung. Eine hypothetische Einbettung (\"was passiert, wenn ich sage ...\"), eine Verneinung im Abstand von drei Token zum Treffer oder ein Stichwort in Anführungszeichen drückt den Wert nach unten, und alles unterhalb der eingestellten Sicherheit, standardmäßig 0,55, gilt als nicht verstanden. Über zweihundert Zeichen wird nur bei hoher Sicherheit gehandelt, denn ein Befehl ist kurz, und ein eingefügter Artikel, der zufällig mit dem Namen beginnt, ist keiner.",
          "Jede Schutzregel, die zu Schweigen führt, lässt den Bot von außen auch defekt aussehen. Deshalb wird jeder verworfene Kandidat mit Begründung festgehalten, weitergeleitete Nachricht, schwaches Signal, zu lang, strenger Modus ohne Begrüßung, und im Admin angezeigt. Das ist Diagnose, keine Aufzeichnung: im Arbeitsspeicher, auf fünfzig begrenzt, gekürzt und nach einem Neustart fort.",
          "Auch die Form der Antwort ist einstellbar. Standard ist schlicht; im Modus mit Namensnennung steht der Name des Mitglieds davor; im Zitatmodus wird die beantwortete Nachricht wiederholt. Einwilligungsabfragen zitieren nie, was auch immer der Modus sagt. Antworten sind je Mitglied und je Chat begrenzt, standardmäßig sechs und zwanzig pro Minute, und aus einem Anzeigenamen werden Formatzeichen entfernt, bevor er verwendet wird, damit ein Name keine Auszeichnung öffnen kann, die den Rest des Satzes verschluckt.",
        ],
      },
      {
        h: "Die Plugin-Grenze",
        body: [
          "Ein Plugin deklariert vier Dinge und sonst nichts: wer es ist, ob es standardmäßig an ist, welche Intents es beisteuert und wo seine Einstellungsseite liegt. Ein weiteres Plugin ist diese Deklaration plus eine Einstellungsseite, ohne Änderung an Navigation, Resolver oder Einstellungsgerüst. Plugins gehören zum Build; ein Verzeichnis, in das man zur Laufzeit etwas hineinlegt, gibt es nicht.",
          "Tragend ist, was beim Abschalten passiert. Die Intents bleiben nicht im Katalog, um später abgelehnt zu werden, sie verlassen den Katalog. Die Regel-Engine zieht die Muster eines abgeschalteten Plugins gar nicht erst in Betracht, die Nahtstelle stuft alles, was seinen Intent behauptet, auf \"nicht verstanden\" herunter, und die Hilfeantwort, die aus dem laufenden Katalog erzeugt und nicht als Liste geschrieben wird, wirbt nicht länger damit. Ein halb verdrahteter Handler hinter einem abgeschalteten Schalter ist genau das, was eine Frage beantwortet, die es nicht beantworten sollte.",
        ],
        callout: "Ein abgeschaltetes Plugin wird nicht still. Es verlässt den Intent-Katalog.",
      },
      {
        h: "Crypto Prices, das mitgelieferte Beispiel",
        body: [
          "Das erste Plugin beantwortet Preis- und Umrechnungsfragen aus einer Kette von Marktdatenanbietern. Preise werden immer auf Anfrage geholt, nie vorgeladen. Zwischen Frage und Anbieter steht nur ein kurzer Zwischenspeicher, und der ist dafür da, dass eine lebhafte Gruppe nicht das Anfragelimit des Anbieters aufbraucht, nicht dafür, dass ein Preis länger hält.",
          "Symbole werden einmal aufgelöst und dann festgepinnt. Den Anbieter jedes Mal zu fragen, was \"HEX\" sei, hieße, dass dieselbe Frage still den Preis eines anderen Tokens liefert, sobald sich die Suchreihenfolge verschiebt. Beanspruchen mehrere Assets dasselbe Kürzel, wird das Mitglied gefragt und antwortet mit einer Zahl, und diese Antwort wird festgehalten, sodass niemand erneut gefragt wird.",
          "Der Resolver erfährt nie, welche Symbole existieren; das ist Sache des Verzeichnisses. Er reicht die Wörter weiter, die das Mitglied geschrieben hat, dazu die übrigen Kandidaten im Satz, und der Preisdienst bevorzugt das, was bereits festgepinnt ist. Genau deshalb wird aus \"one real bitcoin\" Bitcoin und kein unbekanntes Token namens \"real\", und genau deshalb kann ein Betreiber ein Token ohne Codeänderung ergänzen.",
          "Im Nachfassfenster darf ein Fragment die vorige Frage erben, \"monero?\" nach einer Preisantwort ist also eine Preisfrage. Es darf Wissen wiederverwenden und nie welches erzeugen: Asset und Währung müssen beide schon festgepinnt sein. Die Regel gibt es, weil einmal ein Beifallsruf eine Preisfrage geerbt hat, als Kürzel bei einem Anbieter landete und mit der Auswahl zwischen zwei echten Token zurückkam.",
        ],
      },
      {
        h: "Wo ein lokales Modell mithelfen darf",
        body: [
          "Die deterministische Regel-Engine ist die stehende Umsetzung und der automatische Rückfall. Verbindet ein Betreiber eine lokale Ollama-Laufzeit, lässt sich ein Modell hinter derselben Nahtstelle registrieren; fällt es aus, ist es zu langsam oder antwortet es außerhalb des Katalogs, antworten die Regeln. Ist die Laufzeit aus, laufen schlicht die Regeln.",
          "Das Modell klassifiziert. Es führt nie etwas aus, schreibt keine Einwilligung, ruft kein Werkzeug auf und entscheidet nicht, ob eine Bestätigung angenommen wurde. Einen Einwilligungs-Intent nimmt das System von ihm nur an, wenn die Regel-Engine unabhängig denselben Intent gefunden hat. Ein Fehlgriff des Modells kann also Verständnis kosten. Eine Veröffentlichung kann er nicht kosten.",
          "Ein zweites Modell darf eine fertige Antwort formulieren. Es hat keinen Zugriff auf Datenbank, Einwilligung, Werkzeuge oder Transport und bekommt einen Entwurf, den die Dialogschicht bereits erzeugt hat. Werte, die eine Umformulierung überleben müssen, Zahlen und Preise, werden geprüft; Werte, die nicht auftauchen dürfen, etwa der Anzeigename des Absenders, werden ebenfalls geprüft; und Gedankenstriche in der Ausgabe werden ersetzt, weil kein Satz dieses Produkts, den ein Mitglied liest, einen trägt. Scheitert eine Prüfung, geht der deterministische Text hinaus.",
        ],
      },
      {
        h: "Ein natives Befehlsmenü, erzeugt, aber nicht angeschlossen",
        body: [
          "Das SimpleX-SDK kann ein Bot-Befehlsmenü registrieren, das ein Client in der Eingabezeile darstellt. Es ist ein Angebot für den Einzelchat: Der Bot hat keine Kontaktadresse, Mitglieder begegnen ihm nur in der Gruppe, ein registriertes Menü wäre also eine Liste, die niemand erreicht.",
          "Der Erzeuger existiert trotzdem und wird aus demselben aktiven Katalog gespeist wie die Texthilfe. Bekommt der Bot eines Tages eine Einzelchat-Oberfläche, ist das Menü eine Zeile entfernt und bildet bereits genau ab, welche Plugins aktiv sind. Bis dahin ist die Hilfeantwort die Befehlsliste.",
        ],
        status: 'in-development',
      },
    ],
  },
});

definePage('platform-consent-archive', {
  en: {
    title: "The consent-first archive",
    description: "How publication works in CIND3R3LLA: two gates, a forward-only opt-in, hide versus delete, and publication derived from consent on every single read.",
    lede: "A public SimpleX group can turn its conversation into a permanent, searchable web archive without publishing anyone who did not ask for it. Two gates stand in front of that, and the second one belongs to you alone.",
    sections: [
      {
        h: "Two gates stand before the open web",
        body: [
          "Nothing a member posts appears on the public archive unless two independent conditions hold. The first belongs to the community: an operator self-hosts the software, points capture at their own group, and stands up a public archive page for it. There is no hosted service quietly collecting groups, and where no public page exists there is no public surface at all.",
          "The second gate belongs to the member, one person at a time, and it cannot be operated from above. The consent write path uses the member id of whoever sent the message and has no parameter for acting on somebody else's behalf. Ask the bot to publish another member and she refuses and does nothing. Administrator rights change nothing, because this path contains no concept of an administrator at all.",
          "So the asymmetry is deliberate. An operator can end publication for everyone by taking the public page down. An operator cannot begin it for anyone.",
        ],
        callout: "An operator can switch the archive off for everybody. Nobody, operator included, can switch a single member on.",
      },
      {
        h: "/publish, /unpublish, or just say so",
        body: [
          "Sending /publish opts you in. Sending /unpublish opts you out. Both are exact commands, and both take effect immediately.",
          "You can also just talk to her. Address the bot by the name its operator gave it and say that you want to be published, and the natural-language route reaches the same decision. It is deliberately slower than the command: spoken, a consent change never happens on a single message. She proposes, and waits for an affirmative answer inside a short follow-up window. A bare keyword in the middle of a sentence is not enough, and a request that names somebody else is refused before anything else is considered.",
          "Both routes call one function. The dialogue engine holds no consent SQL of its own, so the spoken path cannot drift away from the command path over time. The only thing that differs is a stamp recording which route the decision came in through. Either way the decision is appended to a journal that also stores the consent record exactly as it stood beforehand.",
        ],
        callout: "One write path. The spoken route and the slash command are the same decision, recorded the same way.",
      },
      {
        h: "Forward only, and what that means on the day",
        body: [
          "Opting in stamps the timestamp of the message that carried the opt-in. A message can be published only if it was sent at or after that moment. Everything said before is not published: not later, not by the operator, not by any command. There is no route in the system that reaches backwards.",
          "In practice: you joined in March, you opt in today, and today is where your public archive begins. If you revoke and later opt in again, the clock restarts at the new opt-in, so a second opt-in does not by itself bring the earlier period back. Bringing that back is a separate, explicit restore, and you have to ask for it instead of opting in again: a fresh opt-in clears the revocation and closes the restore route for good. It is also only available if you chose to hide rather than delete.",
          "Consent binds to the stable group member id, never to a display name. Leave the group and rejoin and you are a new member id, so consent does not carry over. That is intended. Rejoining asks the question again.",
        ],
      },
      {
        h: "Published means the open web",
        body: [
          "This deserves to be said plainly, because members deserve it plainly. Published content sits on the public internet. It is server-rendered so search engines can index it, it is full-text searchable on the archive itself, it appears in the sitemap and in the RSS feed, it has a permanent link, it produces a preview card when somebody shares that link, and it carries your display name.",
          "That is exactly the point of the feature, and it is exactly the risk. Withdrawal removes content from the archive and from every route the archive serves. It cannot recall what a search engine has cached, what a feed reader already downloaded, or what somebody saved as a screenshot. Nothing that publishes to the open web can promise otherwise, and copy that suggests otherwise would be lying to you.",
        ],
        callout: "If you opt in, strangers can find your words through a search engine. That is what opting in is for.",
      },
      {
        h: "Publication is a question, not a stored flag",
        body: [
          "There is no published column on a message, and nothing is marked at capture time. Publication is a database view, re-evaluated on every single read.",
          "It is true when all of the following hold: the message was not deleted by its author, was not deleted inside the group, was not rejected by moderation, is not under quarantine, its sender has a consent record that is not revoked, it was sent at or after that member's opt-in, it does not fall inside an interval the member spent hidden, its category has not been switched off by the operator, and, if it is one of the bot's own replies, the member message it answers publishes too.",
          "This is why withdrawal is instant everywhere instead of a background job. There is nothing to backfill, no cache of published ids to invalidate, and no state in which a stale flag keeps something visible after the consent behind it changed. It also means a mistake can only ever be a mistake in one predicate, rather than in whichever of the public routes forgot to check.",
        ],
      },
      {
        h: "Withdrawal: one word, everything at once",
        body: [
          "Send /unpublish, or say it to her. The revocation is recorded, and because publication is derived, every message you ever published leaves the public set on the next read. Page, search results, filters, media, feed, sitemap, embed. All of it, at the same moment, with no per-route work and nothing to wait for.",
          "Her replies to you go with them. A bot answer publishes only if the member message it answers publishes, so withdrawing your question also withdraws the answer that was written to it.",
          "The withdrawal itself is never deferred. Not by a report, not by a review, not by an evidence hold. Hiding is always immediate for the member. Only physical erasure can ever wait.",
        ],
      },
      {
        h: "Then you choose: hide or delete",
        body: [
          "Withdrawal hides. What happens to the hidden content afterwards is a second question, and she asks it right away. Until you answer, the state is explicitly open: hidden everywhere, and consent to destroy nothing. A destructive decision gets no default.",
          "Hide keeps everything. Your content is out of the public archive and out of search, it is retained, and it can be restored by you and by nobody else.",
          "Delete erases. Rows and files go, and with them the extracted links, the mentions, any reports including the reporter's own free text, and the bot's paired reply. The search index hangs off the row and goes with it, so there is no separate index left to purge. Deletion also erases the SimpleX core's own copy on the server, which used to survive everything.",
          "The two answers are deliberately not equally easy. The word hide keeps them, and so does saying no. Only a destruction word standing on its own as a single word does it: delete, or destroy, or the equivalent in the language the bot is configured for. Only a destruction word standing on its own as a single word does it: delete, or destroy, or the equivalent in the language the bot is configured for. A phrase like yeah delete everything does not do it, and neither does a near miss or a typo.",
          "While you are withdrawn, the choice is not a one-way door. Someone who chose hide can come back later and ask for deletion, and it is carried out. Someone whose deletion was deferred by an evidence hold can switch back to hide and call the deferred destruction off. Exactly one thing is final: deleted is deleted.",
        ],
        callout: "Hiding is reversible. Deleting is not. Everything else about the choice can still be changed while you are withdrawn.",
      },
      {
        h: "Restoring, and the gap you spoke into",
        body: [
          "Restoring is available only after hide, only to the member themselves, and never after delete. It clears the revocation while keeping your original opt-in timestamp, so your archive comes back as it was instead of being stranded behind a new forward-only cutoff.",
          "Because restoring increases your public exposure, it is confirmed like an opt-in rather than acted on from a single word.",
          "Everything you said while hidden stays unpublished, permanently. Each hide-and-restore cycle records the interval it covered, and messages sent inside such an interval are excluded from publication forever. You can hide and restore any number of times, and every gap keeps excluding its own messages.",
        ],
        callout: "A restore brings back what was public. It never publishes what you said while you were hidden.",
      },
      {
        h: "What is captured, and why that is not the same as published",
        body: [
          "Within the group the operator has scoped, the bot captures text, images, video, voice messages, files and links. It follows edits, and it honours deletions made inside the group: a message deleted in SimpleX is never published from the archive.",
          "Capture is not publication, and it is worth being exact about that. Messages are stored in the operator's own database whether or not you have opted in, because publication is decided at read time from your consent. If you never opt in, your messages exist in a database on the operator's server and on no web page anywhere. The archive is self-hosted, so this is the same trust you already extend by being in the group at all.",
          "Media lives on disk, never as bytes in the database. Originals are encrypted at rest under a separate key. What the public archive serves is a stripped derivative with the metadata removed, so a published photograph does not carry the camera and location data the original had.",
        ],
      },
      {
        h: "What deletion honestly does not reach",
        body: [
          "Deletion removes content from the live archive immediately and through every path the application serves, and it now reaches the SimpleX core's own copy on the host as well. It does not reach the operator's database backups, which keep fourteen generations and age out on their own schedule. It does not reach what a feed reader or a social scraper already fetched. And it does not reach anything anybody saved for themselves.",
          "The member-facing wording therefore speaks of removal plus backup expiry, and deliberately avoids the word unrecoverable, because overwriting does not guarantee that on modern storage. A promise nobody can keep is not a privacy feature.",
        ],
      },
      {
        h: "Reports, evidence holds and quarantine",
        body: [
          "The public archive accepts content reports from anyone, and the operator's review and takedown decisions are audited.",
          "An open report can place an evidence hold on an item. A hold defers destruction and nothing else. It never blocks hiding and never changes what is published, because reporting must not become a way to push somebody out of public view. There is at most one live hold per message, so repeated reports cannot compound or extend it, and report holds expire on their own so an unreviewed report cannot become a permanent block through neglect.",
          "If a member asks for deletion while some of their items are held, the unheld items are destroyed at once, the held ones stay hidden and are queued, and she says so rather than pretending the whole request completed. The intent is recorded durably, so it survives a restart and the member never has to ask twice.",
          "Quarantine is the exception that also withholds. An operator escalation or a screening match makes an item unservable to everyone, and the files are moved out of the media tree entirely rather than merely dropping out of a query.",
        ],
      },
      {
        h: "Hash screening for known illegal material",
        body: [
          "The custody half is built and verified: encryption at rest, quarantine outside the media tree, holds, the deferral path and the operator's review surface. Detection is not built. No screening provider is connected, and the null provider transmits nothing to anyone.",
          "When a provider is connected, the limits stay what they are and will be stated as such. Hash matching finds known material only, never new material, and a no-match result is not a statement that anything is safe. A match preserves and quarantines, it never deletes. Screening results are never shown to members. Reporting duties, retention periods and the point of contact are legal questions for a lawyer and are deliberately absent from the code.",
        ],
        callout: "No screening provider is configured. The mechanism is built; the detection is not.",
        status: 'in-development',
      },
    ],
  },
  de: {
    title: "Einwilligung zuerst: das öffentliche Archiv",
    description: "Wie Veröffentlichung in CIND3R3LLA funktioniert: zwei Tore, Anmeldung nur ab jetzt, verbergen oder löschen, Veröffentlichung bei jedem Lesen neu abgeleitet.",
    lede: "Eine öffentliche SimpleX-Gruppe kann ihre Gespräche in ein dauerhaftes, durchsuchbares Webarchiv verwandeln, ohne jemanden zu veröffentlichen, der das nicht selbst verlangt hat. Davor stehen zwei Tore, und das zweite gehört allein dir.",
    sections: [
      {
        h: "Zwei Tore vor dem offenen Netz",
        body: [
          "Nichts, was ein Mitglied schreibt, erscheint im öffentlichen Archiv, solange nicht zwei voneinander unabhängige Bedingungen erfüllt sind. Die erste liegt bei der Community: Ein Betreiber hostet die Software selbst, richtet die Aufzeichnung auf seine eigene Gruppe und stellt eine öffentliche Archivseite bereit. Es gibt keinen gehosteten Dienst, der still Gruppen einsammelt, und ohne öffentliche Seite existiert überhaupt keine öffentliche Fläche.",
          "Die zweite Bedingung liegt beim Mitglied, einzeln und für sich selbst, und sie lässt sich nicht von oben öffnen. Der Schreibpfad für Einwilligungen verwendet immer die Mitglieds-ID der Person, die die Nachricht gesendet hat, und kennt keinen Parameter, um stellvertretend für jemand anderen zu handeln. Wer den Bot bittet, ein anderes Mitglied zu veröffentlichen, bekommt eine Absage, und es passiert nichts. Adminrechte ändern daran nichts, denn dieser Pfad kennt den Begriff Admin gar nicht.",
          "Die Asymmetrie ist gewollt. Ein Betreiber kann die Veröffentlichung für alle beenden, indem er die öffentliche Seite abschaltet. Beginnen kann er sie für niemanden.",
          "",
          "",
        ],
        callout: "Ein Betreiber kann das Archiv für alle abschalten. Niemand, auch er selbst nicht, kann ein einzelnes Mitglied anschalten.",
      },
      {
        h: "/publish, /unpublish, oder einfach sagen",
        body: [
          "Mit /publish meldest du dich an, mit /unpublish wieder ab. Beides sind exakte Befehle, und beide wirken sofort.",
          "Du kannst es ihr auch einfach sagen. Sprich den Bot mit dem Namen an, den der Betreiber vergeben hat, und sag, dass du veröffentlichen möchtest. Der natürlichsprachige Weg führt zur selben Entscheidung, ist aber absichtlich langsamer als der Befehl: Gesprochen ändert sich eine Einwilligung nie mit einer einzigen Nachricht. Sie fragt zurück und wartet auf ein Ja innerhalb eines kurzen Zeitfensters. Ein einzelnes Stichwort mitten im Satz genügt nicht, und eine Bitte, die jemand anderen nennt, wird von vornherein abgelehnt.",
          "Beide Wege rufen dieselbe Funktion auf. Die Dialoglogik enthält kein eigenes SQL für Einwilligungen, deshalb kann der gesprochene Weg mit der Zeit nicht vom Befehlsweg abdriften. Unterschiedlich ist allein der Vermerk, über welchen Weg die Entscheidung kam. In beiden Fällen wird sie an ein Journal angehängt, das zusätzlich den Einwilligungsdatensatz so festhält, wie er vorher aussah.",
        ],
        callout: "Ein Schreibpfad. Der gesprochene Weg und der Befehl sind dieselbe Entscheidung, gleich festgehalten.",
      },
      {
        h: "Nur ab jetzt, nie rückwirkend",
        body: [
          "Die Anmeldung setzt den Zeitstempel der Nachricht, die sie ausgelöst hat. Veröffentlicht werden kann eine Nachricht nur, wenn sie zu diesem Zeitpunkt oder danach gesendet wurde. Alles davor wird nicht veröffentlicht: später nicht, durch den Betreiber nicht, durch keinen Befehl. Es gibt keinen Weg im System, der nach hinten greift.",
          "Konkret: Du bist im März dazugekommen, meldest dich heute an, und heute beginnt dein öffentliches Archiv. Wenn du widerrufst und dich später erneut anmeldest, beginnt die Zählung neu, die zweite Anmeldung holt den ersten Zeitraum also nicht von selbst zurück. Dafür gibt es ein eigenes, ausdrückliches Zurückholen, und nur, wenn du damals verbergen und nicht löschen gewählt hast.",
          "Die Einwilligung hängt an der stabilen Mitglieds-ID der Gruppe, nie am Anzeigenamen. Wer die Gruppe verlässt und neu beitritt, bekommt eine neue ID, die Einwilligung wird also nicht übernommen. Das ist so gewollt. Beim Wiedereintritt wird neu gefragt.",
        ],
      },
      {
        h: "Veröffentlicht heißt: offenes Netz, auffindbar",
        body: [
          "Das gehört deutlich gesagt, denn Mitglieder haben Anspruch darauf. Veröffentlichte Inhalte stehen im offenen Internet. Sie werden serverseitig gerendert, damit Suchmaschinen sie indexieren können, sie sind im Archiv volltextsuchbar, sie stehen in der Sitemap und im RSS-Feed, sie haben eine dauerhafte Adresse, sie erzeugen eine Vorschaukarte, wenn jemand den Link teilt, und sie tragen deinen Anzeigenamen.",
          "Genau das ist der Sinn der Funktion, und genau das ist das Risiko. Ein Widerruf entfernt Inhalte aus dem Archiv und aus jedem Weg, den das Archiv bedient. Er kann nicht zurückholen, was eine Suchmaschine zwischengespeichert, ein Feedreader schon geladen oder jemand als Screenshot gesichert hat. Nichts, was im offenen Netz veröffentlicht, kann etwas anderes versprechen, und eine Formulierung, die das andeutet, würde dich belügen.",
        ],
        callout: "Wer sich anmeldet, kann von Fremden über Suchmaschinen gefunden werden. Dafür ist die Anmeldung da.",
      },
      {
        h: "Veröffentlichung ist eine Frage, kein gespeichertes Kennzeichen",
        body: [
          "Es gibt keine Spalte veröffentlicht an einer Nachricht, und beim Aufzeichnen wird nichts markiert. Die Veröffentlichung ist eine Datenbanksicht, die bei jedem einzelnen Lesezugriff neu ausgewertet wird.",
          "Sie trifft zu, wenn all das gilt: Die Nachricht wurde nicht von ihrem Autor gelöscht, nicht in der Gruppe gelöscht, von der Moderation nicht abgelehnt, steht nicht unter Quarantäne, ihr Absender hat eine nicht widerrufene Einwilligung, sie wurde zum Zeitpunkt der Anmeldung oder danach gesendet, sie fällt nicht in einen Zeitraum, den das Mitglied verborgen verbracht hat, und, falls es eine Antwort des Bots ist, wird auch die Mitgliedsnachricht veröffentlicht, auf die sie antwortet.",
          "Deshalb wirkt ein Widerruf sofort und überall statt als Hintergrundauftrag. Es gibt nichts nachzutragen, keinen Zwischenspeicher zu leeren und keinen Zustand, in dem ein veraltetes Kennzeichen etwas sichtbar hält, dessen Einwilligung längst zurückgezogen ist. Und ein Fehler kann immer nur ein Fehler in einer einzigen Bedingung sein statt in demjenigen öffentlichen Weg, der das Prüfen vergessen hat.",
        ],
      },
      {
        h: "Widerruf: ein Wort, alles auf einmal",
        body: [
          "Sende /unpublish, oder sag es ihr. Der Widerruf wird festgehalten, und weil die Veröffentlichung abgeleitet ist, fällt beim nächsten Lesezugriff jede jemals veröffentlichte Nachricht aus dem öffentlichen Bestand. Seite, Suchergebnisse, Filter, Medien, Feed, Sitemap, Einbettung. Alles gleichzeitig, ohne Arbeit pro Weg und ohne Wartezeit.",
          "Ihre Antworten an dich gehen mit. Eine Antwort des Bots wird nur veröffentlicht, wenn die Mitgliedsnachricht veröffentlicht wird, auf die sie antwortet. Wer seine Frage zurückzieht, zieht damit auch die Antwort darauf zurück.",
          "Der Widerruf selbst wird nie aufgeschoben. Nicht durch eine Meldung, nicht durch eine Prüfung, nicht durch eine Beweissicherung. Verbergen wirkt für das Mitglied immer sofort. Warten kann höchstens die tatsächliche Vernichtung.",
        ],
      },
      {
        h: "Danach die Wahl: verbergen oder löschen",
        body: [
          "Der Widerruf verbirgt. Was danach mit den verborgenen Inhalten geschieht, ist eine zweite Frage, und sie stellt sie sofort. Bis du antwortest, gilt ausdrücklich der offene Zustand: überall verborgen, und Einwilligung in gar keine Vernichtung. Eine zerstörerische Entscheidung bekommt keine Voreinstellung.",
          "Verbergen behält alles. Deine Inhalte sind aus dem öffentlichen Archiv und aus der Suche verschwunden, bleiben aber erhalten und können von dir und von niemandem sonst zurückgeholt werden.",
          "Löschen vernichtet. Datensätze und Dateien verschwinden, dazu die erfassten Links, die Erwähnungen, etwaige Meldungen samt dem freien Text des Meldenden und die zugehörige Antwort des Bots. Der Suchindex hängt am Datensatz und geht mit ihm, es bleibt also kein getrennter Index übrig. Gelöscht wird zusätzlich die eigene Kopie des SimpleX-Kerns auf dem Server, die früher alles überlebt hat.",
          "Die beiden Antworten sind absichtlich nicht gleich leicht. Ein Ja verbirgt. Vernichten tut nur das ausgeschriebene Wort löschen, allein stehend als einzelnes Wort. Ein Satz wie ja lösch alles genügt nicht, und ein Tippfehler auch nicht.",
          "Solange du widerrufen hast, ist die Wahl keine Einbahnstraße. Wer verborgen gewählt hat, kann später die Löschung verlangen, und sie wird ausgeführt. Wessen Löschung durch eine Beweissicherung aufgeschoben wurde, kann zurück auf verbergen wechseln und die aufgeschobene Vernichtung damit abbestellen. Endgültig ist genau eines: Gelöschtes ist gelöscht.",
        ],
        callout: "Verbergen ist umkehrbar, Löschen nicht. Alles andere an dieser Wahl kannst du im widerrufenen Zustand noch ändern.",
      },
      {
        h: "Zurückholen, und die Lücke dazwischen",
        body: [
          "Zurückholen geht nur nach dem Verbergen, nur durch das Mitglied selbst und nie nach dem Löschen. Der Widerruf wird aufgehoben, dein ursprünglicher Anmeldezeitpunkt bleibt erhalten. So kommt dein Archiv zurück, wie es war, statt hinter einer neuen Grenze liegen zu bleiben.",
          "Weil Zurückholen deine öffentliche Sichtbarkeit erhöht, wird es wie eine Anmeldung bestätigt und nicht auf ein einzelnes Wort hin ausgeführt.",
          "Alles, was du im verborgenen Zustand gesagt hast, bleibt dauerhaft unveröffentlicht. Jeder Zyklus aus Verbergen und Zurückholen hält seinen Zeitraum fest, und Nachrichten aus einem solchen Zeitraum sind für immer von der Veröffentlichung ausgenommen. Du kannst beliebig oft verbergen und zurückholen, jede Lücke schließt ihre eigenen Nachrichten aus.",
        ],
        callout: "Zurückholen bringt zurück, was öffentlich war. Es veröffentlicht nie, was du im Verborgenen gesagt hast.",
      },
      {
        h: "Was aufgezeichnet wird, und warum das nicht Veröffentlichung heißt",
        body: [
          "In der Gruppe, auf die der Betreiber die Aufzeichnung gerichtet hat, erfasst der Bot Text, Bilder, Video, Sprachnachrichten, Dateien und Links. Er folgt Bearbeitungen und beachtet Löschungen innerhalb der Gruppe: Was in SimpleX gelöscht wurde, wird aus dem Archiv nie veröffentlicht.",
          "Aufzeichnen ist nicht Veröffentlichen, und hier lohnt sich Genauigkeit. Nachrichten liegen in der Datenbank des Betreibers, unabhängig davon, ob du angemeldet bist, denn über die Veröffentlichung wird erst beim Lesen anhand deiner Einwilligung entschieden. Ohne Anmeldung existieren deine Nachrichten in einer Datenbank auf dem Server des Betreibers und auf keiner Webseite. Das Archiv wird selbst gehostet, es ist also dasselbe Vertrauen, das du mit der Mitgliedschaft in der Gruppe ohnehin schon aufbringst.",
          "Medien liegen auf der Festplatte, nie als Bytes in der Datenbank. Originale sind mit einem eigenen Schlüssel verschlüsselt gespeichert. Öffentlich ausgeliefert wird eine bereinigte Ableitung ohne Metadaten, ein veröffentlichtes Foto trägt also nicht die Kamera- und Standortdaten des Originals.",
        ],
      },
      {
        h: "Was Löschen ehrlicherweise nicht erreicht",
        body: [
          "Löschen entfernt Inhalte sofort aus dem lebenden Archiv und aus jedem Weg, den die Anwendung bedient, und inzwischen auch aus der eigenen Kopie des SimpleX-Kerns auf dem Server. Es erreicht nicht die Datenbanksicherungen des Betreibers, von denen vierzehn Stände vorgehalten werden und die nach ihrem eigenen Rhythmus auslaufen. Es erreicht nicht, was ein Feedreader oder ein Scraper bereits geholt hat. Und es erreicht nicht, was sich jemand selbst gespeichert hat.",
          "Die Formulierungen gegenüber Mitgliedern sprechen deshalb von Entfernung plus Ablauf der Sicherungen und vermeiden bewusst das Wort unwiederbringlich, weil Überschreiben das auf heutigen Speichermedien nicht garantiert. Ein Versprechen, das niemand halten kann, ist kein Datenschutz.",
        ],
      },
      {
        h: "Meldungen, Beweissicherung und Quarantäne",
        body: [
          "Das öffentliche Archiv nimmt Meldungen von jedem entgegen, und die Prüf- und Entfernungsentscheidungen des Betreibers werden protokolliert.",
          "Eine offene Meldung kann einen Inhalt für die Beweissicherung sperren. Eine solche Sperre schiebt ausschließlich die Vernichtung auf. Sie verhindert nie das Verbergen und ändert nie, was veröffentlicht ist, denn eine Meldung darf kein Mittel werden, jemanden aus der Öffentlichkeit zu drängen. Pro Nachricht gibt es höchstens eine aktive Sperre, wiederholte Meldungen können sie also weder verstärken noch verlängern, und Sperren aus Meldungen laufen von selbst ab, damit eine unbearbeitete Meldung nicht durch Nachlässigkeit zur Dauersperre wird.",
          "Verlangt ein Mitglied die Löschung, während einzelne Inhalte gesperrt sind, wird der nicht gesperrte Teil sofort vernichtet, der gesperrte bleibt verborgen und wird vorgemerkt, und sie sagt das offen, statt einen vollständigen Vollzug vorzutäuschen. Die Absicht wird dauerhaft festgehalten, überlebt einen Neustart und muss nie ein zweites Mal geäußert werden.",
          "Quarantäne ist die Ausnahme, die zusätzlich zurückhält. Eine Eskalation durch den Betreiber oder ein Treffer beim Abgleich macht einen Inhalt für alle unzustellbar, und die Dateien werden vollständig aus dem Medienbaum herausbewegt, statt nur aus einer Abfrage zu fallen.",
        ],
      },
      {
        h: "Hash-Abgleich für bekanntes illegales Material",
        body: [
          "Die Verwahrung ist gebaut und geprüft: Verschlüsselung im Ruhezustand, Quarantäne außerhalb des Medienbaums, Sperren, der Aufschubpfad und die Prüfansicht für den Betreiber. Die Erkennung ist nicht gebaut. Es ist kein Prüfdienst angebunden, und der leere Anbieter übermittelt niemandem etwas.",
          "Wird ein Dienst angebunden, bleiben die Grenzen dieselben und werden auch so benannt. Ein Hash-Abgleich findet ausschließlich bekanntes Material, nie neues, und ein Nichttreffer ist keine Aussage darüber, dass etwas unbedenklich wäre. Ein Treffer sichert und stellt unter Quarantäne, er löscht nie. Prüfergebnisse werden Mitgliedern nie angezeigt. Meldepflichten, Aufbewahrungsfristen und die zuständige Anlaufstelle sind juristische Fragen und stehen bewusst nicht im Code.",
        ],
        callout: "Es ist kein Prüfdienst konfiguriert. Der Mechanismus ist gebaut, die Erkennung nicht.",
        status: 'in-development',
      },
    ],
  },
});

definePage('platform', {
  en: {
    title: "A control plane for AI identities in private communities",
    description: "CIND3R3LLA runs the embedded SimpleX core, the application logic, local models, the consent first archive and the administration as one process you host.",
    lede: "CIND3R3LLA runs the embedded SimpleX core, the application logic, the local models, the archive and the administration as one process on infrastructure you control. The consent first archive is live today, and the multi profile identity runtime is being built on the same foundation.",
    sections: [
      {
        h: "More than a chatbot",
        body: [
          "CIND3R3LLA is a self hosted control plane for intelligent identities inside private and public communities. The embedded SimpleX core, the deterministic application layer, the moderation workflow and the public archive run as one process on infrastructure the operator owns, with the local language models on a private endpoint on the operator's own machine.",
          "A chatbot answers messages. A control plane decides who may act, in which group, with which permissions, under whose supervision, and what is allowed to become public. In CIND3R3LLA those decisions are application code and database state rather than prompt text, and they hold whether the identity in front of them is a person, an assistant or a scheduled character.",
          "The archive is the first capability built on that foundation, and it is running. A bot joins a public SimpleX group, captures the messages of members who opted in, stores them in PostgreSQL with a media tree on disk, and republishes them as a searchable public site. Text, images, video, voice, files, links, edits and in group deletions all travel that path.",
          "The identity is not the implementation. Whether an avatar looks like a fairy tale character says nothing about whether a human is behind it, how much it may automate, or what it is permitted to do. Those are separate settings in separate places, and transparency belongs in onboarding, welcome messages, terms and the public profile rather than in a label stamped onto every sentence.",
        ],
        callout: "A chatbot answers messages. A control plane decides who may act, and what may become public.",
      },
      {
        h: "Identities under human control",
        body: [
          "One embedded core, many identities. The next runtime replaces today's single bot wrapper with a shared multi profile core: one ChatApi.init(), one startChat(), every profile subscribed at the same time, incoming events attributed by the receiving userId, a local group identity of userId plus groupId, commands that depend on the active user serialized instead of raced, outgoing messages recorded from the command result, and no profile rotation in normal operation. Those are measured properties of the official SimpleX Node SDK, not assumptions, with one exception recorded as untested: the degraded state was reasoned about rather than measured, because network interruption was never exercised.",
          "Readiness is a state, not a return value. The runtime will distinguish offline, starting, subscribing, ready, degraded and stopping. A bot is not ready merely because startChat() returned. Subscription progress and operational readiness are two different facts, and the administration will show the one that matters.",
          "Four actor types are designed to carry the permissions: a real member identity, a human operated agent (moderator, administrator, support specialist or recurring character with a responsible person behind it), an NPC (game host, quiz master, storyteller, tutorial guide, welcome character), and system automation for technical notifications. The classification is what will drive permissions and automation, with two invariants written into the design before any code: a supervised identity must never be silently converted into an autonomous one, and human takeover must be immediate. None of this is built yet: the database today carries profiles, groups, authorities and roles, not actor types.",
          "Part of this already exists in the database. Profiles, groups and authorities are tables, with the roles owner, administrator, moderator, team member, member, auditor and blocked. Each profile carries a hard privacy baseline, local only or cloud allowed, that a database constraint will not let contradict itself. A deterministic policy resolver maps an incoming group message to profile, group, role and baseline, and that resolver explicitly executes nothing: no remote commands, no persistent changes, no invitation links. A deterministic name generator is in the tree as well, because generated identity has to work without a model before a model is allowed to improve it.",
          "Groups are typed as team, member or test, so an agent can be discussed, corrected and trained in a private staff space before it acts in public. The engine that gives NPCs rhythm, cooldowns and silence during sensitive moderation moments is specified and not yet built.",
        ],
        callout: "The system must never silently convert a human operated identity into an autonomous NPC.",
        status: 'in-development',
      },
      {
        h: "Consent first memory",
        body: [
          "One gate is absolute: each member opts in for themselves, and nothing they post is public until they do. The operator decides whether an archive front exists at all and which categories may appear, but no operator setting can ever open the member's gate for them. A member opts in by sending /publish, or by asking in plain language and confirming when she asks back. Consent is always first person. Nobody can grant it on somebody else's behalf.",
          "Only messages sent after the opt in are eligible, and eligibility is derived rather than stored as a flag. The publication views compute it from the consent record, the send time, deletions, the moderation state and the gaps that a hide and restore cycle leaves behind. A stale boolean cannot outlive the decision it once described.",
          "Withdrawal hides everything at once. The member then chooses: hide, which retains the material so that they alone can restore it, or delete, which erases it. Hiding is never deferred. Where a legal preservation obligation applies to a specific item, only the physical erasure waits, and it runs by itself once the hold is released or expires. A restore never republishes what was said while hidden, because the gap is recorded. Text, images, video, voice, files, links, edits and in group deletions all follow this same route.",
        ],
        callout: "Nothing a member posts appears on the public archive unless that member opted in.",
      },
      {
        h: "Local intelligence, deterministic authority",
        body: [
          "Inference runs on a private Ollama endpoint. The configuration loader refuses to start when that endpoint is anything other than localhost or a private address. Credentials in the URL are rejected, a path or a query string is rejected, and a public endpoint produces a startup error stating that public AI endpoints are disabled. Conversation content staying inside the building is enforced by a process that will not boot, not by a promise.",
          "Turning local AI on is fail closed. The runtime probes the endpoint before it activates, reads the installed models with their family, parameter size, quantization and file size, and refuses to activate or route to a model that is not installed. Intent classification and reply wording are routed to separate models, so a small classifier and a larger writer can coexist. Every runtime and routing change is audited, and the operational telemetry counts requests, latencies and outcomes without recording content.",
          "The model has no authority. It classifies text and it improves wording. It never executes an action, writes consent, calls a tool or decides whether a confirmation was accepted. Consent intents carry an extra deterministic gate: the model may confirm publish or unpublish only when the rule based resolver independently found the same intent. When the model is slow, wrong or switched off, the deterministic path answers, and the fallback is counted and shown in the administration instead of quietly disappearing.",
        ],
        callout: "AI may classify and phrase. Identity, permissions, consent, routing, publication and execution stay application controlled.",
      },
      {
        h: "One transport today, a seam for the next",
        body: [
          "SimpleX is the transport, and it runs as the official native core inside the same Node process. There is no external CLI daemon, no remote control layer and no exposed chat port. The application owns the event loop, the local databases, file reception, capture and the outgoing path, and the sensitive surface is the on disk database protected by filesystem permissions.",
          "The SDK sits behind a single seam. Cinderella has her own domain types and one chat adapter interface. Exactly one directory may import the chat library, an automated check fails the build if anything else does, and that check proves it fails on a violation rather than passing quietly. A fake adapter drives the whole interface with no SDK present, which is how the seam gets tested instead of asserted; the public demo runs on that fake adapter today, while the live SimpleX path runs through the one directory allowed to import the SDK.",
          "A second transport is prepared, not written. The adapter contract already names the two places where a different network has to make a decision: the opaque raw item, whose stored JSON is read by SQL today, and the SimpleX model of a private thread inside a group, which has no direct equivalent elsewhere. Until that adapter exists, SimpleX is the only transport in the code.",
        ],
        callout: "Exactly one directory may import the chat SDK, and a check fails the build if that stops being true.",
      },
      {
        h: "Content screening: custody built, detection not connected",
        body: [
          "Custody is built. Originals are encrypted at rest with AES-256-GCM under a dedicated key, every reader of an original goes through one module, and quarantined material is moved out of the media tree into a separate root that nothing serves. The administration addresses media by message id, never by path. A match preserves and quarantines. It never deletes.",
          "Detection is not connected. No screening provider is configured, the null provider transmits nothing, and a fixture provider proves the quarantine path in the verification harness with no real material involved. Once a provider is connected, hash matching finds known material only, never new material, and a no match is not a statement of safety.",
          "Reporting duties, retention periods and the point of contact are legal questions for a lawyer. They are deliberately absent from the code rather than guessed at.",
        ],
        callout: "No screening provider is configured, and the public copy says in development until one is connected and verified.",
        status: 'in-development',
      },
      {
        h: "The architecture, in words",
        body: [
          "The diagram beside this reads from top to bottom, and so does the process. The SimpleX network reaches the embedded native core inside the application. The SimpleX network reaches the embedded native core inside the application, and files are received by the application itself. A durable write-ahead store for incoming events is built and verified, and wiring the dispatcher to record every event before it is applied is the next step; per profile attribution of incoming events arrives with the multi profile runtime.",
          "Below the core sits the deterministic application layer, and everything that decides anything lives there: identity and permissions, consent, routing, moderation, the interaction engine with its plugins, the archive and the public site, human supervision and audit. This layer is ordinary code and database state. It is readable, testable and reviewable, which is the entire point of putting it there.",
          "Below that, and only below that, sits the private local AI: intent classification, reply wording, and later optional profile text and avatar generation. It can support a decision the application defined. It cannot grant itself authority.",
          "Two logical databases are kept apart. The SimpleX core keeps its own local state. Cinderella keeps the archive in PostgreSQL with messages, links, consent, settings, audit and embeds, and full text search as a generated tsvector with a GIN index. Media lives on disk and the database stores the path, never the bytes. The original is encrypted, the public derivative is stripped of metadata and stays plaintext, and the two roots are not allowed to be nested inside one another.",
          "Background work runs on a durable Postgres job queue with a state machine, claims taken using FOR UPDATE SKIP LOCKED, backoff, a dead letter state and idempotency keys, so a restart loses no obligation.",
          "The administration is a Fastify service bound to the loopback interface, with public TLS in front of it at the admin hostname. Passkeys are the primary authentication, with an operator toggleable break glass password behind Argon2id and optional TOTP. Sessions are signed, HttpOnly, SameSite strict and stored in PostgreSQL so they survive a restart, CSRF is checked on every mutation, and proxy trust is pinned to loopback.",
        ],
        callout: "One process, two logical databases, media on disk. The database stores the path, never the bytes.",
      },
      {
        h: "The administration principle",
        body: [
          "Every operational capability should have eight things. This is the rule the administration is measured against, and it is why the console is large.",
          "A backend implementation. A control exists because behaviour exists behind it. A control exists because behaviour exists behind it, and nothing important is buried in code with no control at all. Where a surface is deliberately ahead of its backend, it ships visibly disabled and labelled as not yet active rather than looking operable.",
          "Persistent settings. What an operator changes is stored in the database and survives a restart. Environment variables carry secrets, deployment facts, and the few decisions an operator makes once when provisioning the machine, such as whether a local AI endpoint exists at all. Everything an operator changes while running the product lives in the database and survives a restart.",
          "An administration control. Every runtime decision has a page: content and moderation, consent, interaction and wake words, the local AI runtime, the model catalog and routing, hardware facts, security, plugins, media, evidence holds, reports, screening and the public site.",
          "Stored and effective status. What is configured and what is actually running are shown as two separate facts, because they do diverge. Local AI enabled in the settings with an unreachable endpoint is a state the operator needs to see, not a checkbox that lies.",
          "Audit coverage. Every state changing administrative action is recorded with actor, action, target, time and detail, including consent actions taken on a member's behalf, which additionally carry their provenance and a way back.",
          "Automated tests. The verification harnesses run against a real PostgreSQL compiled to WebAssembly, with no server required, and they cover consent, revocation with evidence holds, the publication views, security, the public site, interaction, the queue, capture events, encryption at rest and the screening seam, plus the adapter seam and the rules for member facing copy.",
          "Clear failure behaviour. A caught error is never converted into a value that reads like a legitimate result, and a degraded function never runs silently. On the consent, capture, publication, media and plugin paths, a lost guarantee is raised to the dashboard rather than to a log file nobody reads. Not configured and configured but failing are different states, and a fallback that could mask a fault is counted with the count on screen.",
          "Documented boundaries. Five technical documents, architecture, security, wire format, decisions and backlog, are maintained from the code with every change rather than at the end of a season, and what is implemented is kept visibly apart from what is planned.",
        ],
        callout: "CIND3R3LLA does not hide important behaviour in code while presenting an empty control panel, and it does not present controls that are not connected to real backend behaviour.",
      },
    ],
  },
  de: {
    title: "Eine Steuerungsebene für KI-Identitäten in privaten Communitys",
    description: "CIND3R3LLA führt eingebetteten SimpleX-Kern, Anwendungslogik, lokale Modelle, das Archiv mit Zustimmung und die Administration als einen selbst gehosteten Prozess.",
    lede: "CIND3R3LLA führt den eingebetteten SimpleX-Kern, die Anwendungslogik, die lokalen Modelle, das Archiv und die Administration als einen Prozess auf Infrastruktur aus, die Ihnen gehört. Das Archiv mit Zustimmung läuft bereits, der Multi-Profil-Betrieb entsteht auf demselben Fundament.",
    sections: [
      {
        h: "Mehr als ein Chatbot",
        body: [
          "CIND3R3LLA ist eine selbst gehostete Steuerungsebene für intelligente Identitäten in privaten und öffentlichen Communitys. Der eingebettete SimpleX-Kern, die deterministische Anwendungsschicht, die lokalen Sprachmodelle, das Gedächtnis der Community, die Moderationsabläufe und das öffentliche Archiv sind eine Plattform in einem Prozess, auf Infrastruktur, die dem Betreiber gehört.",
          "Ein Chatbot beantwortet Nachrichten. Eine Steuerungsebene entscheidet, wer handeln darf, in welcher Gruppe, mit welchen Rechten, unter wessen Aufsicht und was öffentlich werden darf. Bei CIND3R3LLA sind diese Entscheidungen Anwendungscode und Datenbankzustand statt Prompttext, und sie gelten unverändert, ob hinter der Identität ein Mensch, ein Assistent oder eine geplante Figur steht.",
          "Das Archiv ist die erste Fähigkeit auf diesem Fundament, und es läuft bereits. Der Bot ist Mitglied einer öffentlichen SimpleX-Gruppe, erfasst die Nachrichten der Mitglieder, die zugestimmt haben, legt sie in PostgreSQL mit einem Medienbaum auf der Festplatte ab und veröffentlicht sie als durchsuchbare Website. Text, Bilder, Video, Sprachnachrichten, Dateien, Links, Bearbeitungen und Löschungen in der Gruppe gehen denselben Weg.",
          "Die Identität sagt nichts über die Technik dahinter. Ob eine Figur märchenhaft aussieht, verrät nicht, ob ein Mensch dahintersteht, wie viel sie automatisieren darf oder was ihr erlaubt ist. Das sind getrennte Einstellungen an getrennten Stellen, und Transparenz gehört in Onboarding, Begrüßung, Nutzungsbedingungen und öffentliches Profil, nicht als Etikett an jeden einzelnen Satz.",
        ],
        callout: "Ein Chatbot beantwortet Nachrichten. Eine Steuerungsebene entscheidet, wer handeln darf und was öffentlich werden darf.",
      },
      {
        h: "Identitäten unter menschlicher Aufsicht",
        body: [
          "Ein eingebetteter Kern, viele Identitäten. Die nächste Laufzeit ersetzt den heutigen Einzelbot-Wrapper durch einen gemeinsamen Multi-Profil-Kern: ein ChatApi.init(), ein startChat(), alle Profile gleichzeitig abonniert, eingehende Ereignisse über die empfangende userId zugeordnet, lokale Gruppenidentität aus userId und groupId, Kommandos mit Bezug zum aktiven Benutzer serialisiert statt nebenläufig, ausgehende Nachrichten aus dem Kommandoergebnis protokolliert, kein Profilwechsel im Normalbetrieb. Das sind gemessene Eigenschaften des offiziellen SimpleX-Node-SDK, keine Annahmen.",
          "Betriebsbereitschaft ist ein Zustand, kein Rückgabewert. Die Laufzeit unterscheidet offline, starting, subscribing, ready, degraded und stopping. Ein Bot ist nicht bereit, nur weil startChat() zurückgekehrt ist. Abonnementfortschritt und Betriebsbereitschaft sind zwei verschiedene Tatsachen, und die Administration zeigt die, auf die es ankommt.",
          "Vier Akteurstypen tragen die Rechte: eine echte Mitgliedsidentität, ein menschlich geführter Agent (Moderation, Administration, Support oder wiederkehrende Figur mit einer verantwortlichen Person dahinter), ein NPC (Spielleitung, Quizmaster, Erzählfigur, Tutorial, Begrüßung) und die Systemautomatisierung für technische Meldungen. Die Einordnung steuert Rechte und Automatisierungsgrad. Aus einer betreuten Identität wird nie still eine autonome, und die Übernahme durch einen Menschen ist sofort möglich.",
          "Ein Teil davon steht bereits in der Datenbank. Profile, Gruppen und Berechtigungen sind Tabellen, mit den Rollen Eigentümer, Administrator, Moderator, Teammitglied, Mitglied, Auditor und gesperrt. Jedes Profil trägt eine harte Datenschutz-Grundlinie, nur lokal oder Cloud erlaubt, die eine Datenbank-Constraint nicht widersprüchlich werden lässt. Ein deterministischer Policy-Resolver bildet eine eingehende Gruppennachricht auf Profil, Gruppe, Rolle und Grundlinie ab, und dieser Resolver führt ausdrücklich nichts aus: keine Fernkommandos, keine dauerhaften Änderungen, keine Einladungslinks. Ein deterministischer Namensgenerator liegt ebenfalls im Code, denn erzeugte Identität muss ohne Modell funktionieren, bevor ein Modell sie verbessern darf.",
          "Gruppen sind als Team, Mitglied oder Test typisiert, damit ein Agent im privaten Teamraum besprochen, korrigiert und trainiert werden kann, bevor er öffentlich auftritt. Die Engine, die NPCs Rhythmus, Abklingzeiten und Zurückhaltung in heiklen Moderationsmomenten gibt, ist spezifiziert und noch nicht gebaut.",
        ],
        callout: "Aus einer menschlich geführten Identität darf nie still ein autonomer NPC werden.",
        status: 'in-development',
      },
      {
        h: "Gedächtnis nur mit Zustimmung",
        body: [
          "Zwei Tore, und beide müssen offen sein. Die Community aktiviert die Veröffentlichung, und jedes Mitglied stimmt für sich selbst zu. Die Zustimmung erfolgt per /publish oder im normalen Gespräch, mit Rückfrage und Bestätigung. Zustimmung ist immer in der ersten Person. Niemand kann sie für andere erteilen.",
          "Veröffentlichungsfähig sind nur Nachrichten nach dem Opt-in, und diese Eigenschaft wird abgeleitet, nicht als Flag gespeichert. Die Views berechnen sie aus dem Zustimmungseintrag, dem Sendezeitpunkt, Löschungen, dem Moderationszustand und den Lücken, die ein Ausblenden mit späterem Wiederherstellen hinterlässt. Ein veraltetes Boolean kann die Entscheidung, die es einmal beschrieben hat, nicht überleben.",
          "Ein Widerruf blendet sofort alles aus. Danach entscheidet das Mitglied: ausblenden, dann bleibt das Material erhalten und nur diese Person kann es wiederherstellen, oder löschen, dann wird es vernichtet. Eine Wiederherstellung veröffentlicht nie, was während der Ausblendung gesagt wurde, denn die Lücke ist festgehalten. Text, Bilder, Video, Sprachnachrichten, Dateien, Links, Bearbeitungen und Löschungen in der Gruppe nehmen denselben Weg.",
        ],
        callout: "Nichts, was ein Mitglied schreibt, erscheint im öffentlichen Archiv, solange dieses Mitglied nicht selbst zugestimmt hat.",
      },
      {
        h: "Lokale Intelligenz, deterministische Autorität",
        body: [
          "Die Inferenz läuft auf einem privaten Ollama-Endpunkt. Der Konfigurationslader verweigert den Start, wenn dieser Endpunkt nicht localhost oder eine private Adresse ist. Zugangsdaten in der URL werden abgelehnt, Pfad oder Query werden abgelehnt, und ein öffentlicher Endpunkt erzeugt einen Startfehler mit der Aussage, dass öffentliche KI-Endpunkte deaktiviert sind. Dass Gesprächsinhalte im Haus bleiben, sichert ein Prozess, der sonst nicht startet, kein Versprechen.",
          "Das Einschalten der lokalen KI ist fail closed. Die Laufzeit prüft den Endpunkt vor der Aktivierung, liest die installierten Modelle samt Familie, Parametergröße, Quantisierung und Dateigröße und verweigert Aktivierung und Routing für ein Modell, das nicht installiert ist. Absichtserkennung und Antwortformulierung laufen über getrennt wählbare Modelle, ein kleiner Klassifikator und ein größerer Formulierer können also nebeneinander arbeiten. Jede Änderung an Laufzeit und Routing wird auditiert, und die Betriebstelemetrie zählt Anfragen, Latenzen und Ergebnisse, ohne Inhalte zu speichern.",
          "Das Modell hat keine Befugnis. Es klassifiziert Text und verbessert Formulierungen. Es führt nie eine Aktion aus, schreibt keine Zustimmung, ruft kein Werkzeug auf und entscheidet nicht, ob eine Bestätigung gültig ist. Für Zustimmungsabsichten gilt eine zusätzliche deterministische Schranke: Das Modell darf publish oder unpublish nur bestätigen, wenn der regelbasierte Resolver unabhängig dieselbe Absicht erkannt hat. Ist das Modell langsam, falsch oder abgeschaltet, antwortet der deterministische Pfad, und der Rückfall wird gezählt und in der Administration angezeigt, statt still zu verschwinden.",
        ],
        callout: "KI darf klassifizieren und formulieren. Identität, Rechte, Zustimmung, Routing, Veröffentlichung und Ausführung bleiben in der Anwendung.",
      },
      {
        h: "Heute ein Transport, mit Naht für den nächsten",
        body: [
          "SimpleX ist der Transport und läuft als offizieller nativer Kern im selben Node-Prozess. Es gibt keinen externen CLI-Daemon, keine Fernsteuerungsschicht und keinen offenen Chat-Port. Die Anwendung besitzt die Ereignisschleife, die lokalen Datenbanken, den Dateiempfang, die Erfassung und den Sendeweg. Die sensible Fläche ist die Datenbank auf der Festplatte, geschützt über Dateirechte.",
          "Das SDK liegt hinter einer einzigen Naht. Cinderella hat eigene Domänentypen und eine Adapterschnittstelle für Chat. Genau ein Verzeichnis darf die Chat-Bibliothek importieren, eine automatische Prüfung lässt den Build scheitern, sobald etwas anderes es tut, und diese Prüfung weist nach, dass sie bei einem Verstoß tatsächlich anschlägt. Ein Fake-Adapter treibt das gesamte System ohne SDK, so wird die Naht getestet statt behauptet.",
          "Ein zweiter Transport ist vorbereitet, aber nicht geschrieben. Der Adaptervertrag benennt bereits die zwei Stellen, an denen ein anderes Netz eine Entscheidung treffen muss: das undurchsichtige Rohobjekt, dessen gespeichertes JSON heute per SQL gelesen wird, und das SimpleX-Modell eines privaten Fadens innerhalb einer Gruppe, für das es anderswo keine direkte Entsprechung gibt. Bis dieser Adapter existiert, ist SimpleX der einzige Transport im Code.",
        ],
        callout: "Genau ein Verzeichnis darf das Chat-SDK importieren, und eine Prüfung lässt den Build scheitern, sobald das nicht mehr stimmt.",
      },
      {
        h: "Inhaltsprüfung: Verwahrung gebaut, Erkennung nicht angeschlossen",
        body: [
          "Die Verwahrung ist gebaut. Originale liegen mit AES-256-GCM unter einem eigenen Schlüssel verschlüsselt, jeder Lesezugriff auf ein Original geht durch ein einziges Modul, und Material in Quarantäne verlässt den Medienbaum in ein separates Verzeichnis, das von nichts ausgeliefert wird. Die Administration adressiert Medien über die Nachrichten-ID, nie über den Pfad. Ein Treffer sichert und stellt unter Quarantäne. Er löscht nie.",
          "Die Erkennung ist nicht angeschlossen. Es ist kein Prüfanbieter konfiguriert, der Null-Anbieter übermittelt nichts, und ein Fixture-Anbieter weist den Quarantäneweg im Prüfharnisch nach, ohne echtes Material. Sobald ein Anbieter angeschlossen ist, findet ein Hash-Abgleich ausschließlich bekanntes Material, nie neues, und ein fehlender Treffer ist keine Aussage über Unbedenklichkeit.",
          "Meldepflichten, Aufbewahrungsfristen und die zuständige Kontaktstelle sind juristische Fragen für eine Anwältin oder einen Anwalt. Sie fehlen im Code bewusst, statt geraten zu werden.",
        ],
        callout: "Es ist kein Prüfanbieter konfiguriert, und die öffentliche Darstellung sagt in Entwicklung, bis einer angeschlossen und überprüft ist.",
        status: 'in-development',
      },
      {
        h: "Die Architektur in Worten",
        body: [
          "Das Diagramm daneben liest sich von oben nach unten, und der Prozess ebenso. Das SimpleX-Netz erreicht den eingebetteten nativen Kern innerhalb der Anwendung. Eingehende Ereignisse werden über die empfangende Benutzeridentität einem Profil zugeordnet, Dateien nimmt die Anwendung selbst entgegen, und jede erfasste Nachricht wird festgeschrieben, bevor irgendetwas sie interpretiert.",
          "Darunter liegt die deterministische Anwendungsschicht, und dort liegt alles, was entscheidet: Identität und Rechte, Zustimmung, Routing, Moderation, die Interaktionsengine mit ihren Plugins, das Archiv und die öffentliche Website, menschliche Aufsicht und Audit. Diese Schicht ist gewöhnlicher Code und Datenbankzustand. Sie ist lesbar, testbar und prüfbar, und genau dafür liegt sie dort.",
          "Darunter, und nur darunter, sitzt die private lokale KI: Absichtserkennung, Formulierung der Antwort und später optional Profiltexte und Avatarerzeugung. Sie kann eine Entscheidung unterstützen, die die Anwendung definiert hat. Befugnisse kann sie sich nicht selbst geben.",
          "Zwei logische Datenbanken bleiben getrennt. Der SimpleX-Kern führt seinen eigenen lokalen Zustand. Cinderella führt das Archiv in PostgreSQL mit Nachrichten, Links, Zustimmungen, Einstellungen, Audit und Einbettungen, dazu Volltextsuche als generierter tsvector mit GIN-Index. Medien liegen auf der Festplatte, die Datenbank speichert den Pfad und nie die Bytes. Das Original ist verschlüsselt, das öffentliche Derivat ist von Metadaten befreit und bleibt unverschlüsselt, und die beiden Wurzelverzeichnisse dürfen nicht ineinander liegen.",
          "Hintergrundarbeit läuft über eine dauerhafte Job-Queue in Postgres, mit Zustandsautomat, Übernahme per FOR UPDATE SKIP LOCKED, Backoff, Dead-Letter-Zustand und Idempotenzschlüsseln. Ein Neustart verliert dadurch keine Zusage.",
          "Die Administration ist ein Fastify-Dienst auf der Loopback-Schnittstelle, davor öffentliches TLS unter dem Admin-Hostnamen. Passkeys sind die primäre Anmeldung, dazu ein vom Betreiber schaltbarer Notzugang mit Argon2id und optional TOTP. Sitzungen sind signiert, HttpOnly, SameSite strict und liegen in PostgreSQL, überstehen also einen Neustart. CSRF wird bei jeder Änderung geprüft, und das Proxy-Vertrauen ist fest auf Loopback gesetzt.",
        ],
        callout: "Ein Prozess, zwei logische Datenbanken, Medien auf der Festplatte. Die Datenbank speichert den Pfad, nie die Bytes.",
      },
      {
        h: "Das Administrationsprinzip",
        body: [
          "Jede betriebliche Fähigkeit soll acht Dinge mitbringen. An dieser Regel wird die Administration gemessen, und deshalb ist die Konsole so umfangreich.",
          "Eine Implementierung im Backend. Ein Bedienelement gibt es, weil dahinter Verhalten existiert. Nichts geht als Schalter ohne Gegenstück in Betrieb, und nichts Wichtiges versteckt sich im Code ganz ohne Bedienelement.",
          "Dauerhafte Einstellungen. Was der Betreiber ändert, liegt in der Datenbank und übersteht einen Neustart. Umgebungsvariablen tragen Geheimnisse und Deployment-Fakten, nicht das Produktverhalten. Eine Meinungsänderung erfordert also keine Bearbeitung der Unit-Datei.",
          "Ein Bedienelement in der Administration. Jede Laufzeitentscheidung hat eine Seite: Inhalte und Moderation, Zustimmung, Interaktion und Weckwörter, lokale KI-Laufzeit, Modellkatalog und Routing, Hardwarefakten, Sicherheit, Plugins, Medien, Beweissicherungen, Meldungen, Inhaltsprüfung und die öffentliche Website.",
          "Gespeicherter und wirksamer Zustand. Was konfiguriert ist und was tatsächlich läuft, stehen als zwei getrennte Angaben da, denn sie fallen auseinander. Lokale KI laut Einstellung aktiv, Endpunkt aber nicht erreichbar, ist ein Zustand, den der Betreiber sehen muss, kein Häkchen, das lügt.",
          "Lückenlose Auditierung. Jede zustandsändernde administrative Aktion wird mit Akteur, Aktion, Ziel, Zeit und Detail festgehalten, auch stellvertretend ausgeführte Zustimmungsaktionen, die zusätzlich ihre Herkunft und einen Weg zurück tragen.",
          "Automatisierte Tests. Die Prüfharnische laufen gegen ein echtes PostgreSQL in WebAssembly, ganz ohne Server, und decken Zustimmung, Widerruf mit Beweissicherung, die Veröffentlichungs-Views, Sicherheit, die öffentliche Website, Interaktion, die Queue, Erfassungsereignisse, Verschlüsselung im Ruhezustand und die Prüfnaht ab, dazu die Adapternaht und die Regeln für Texte, die Mitglieder lesen.",
          "Klares Fehlerverhalten. Ein abgefangener Fehler wird nie in einen Wert verwandelt, der wie ein gültiges Ergebnis aussieht, und eine eingeschränkte Funktion läuft nie stillschweigend weiter. Auf den Wegen für Zustimmung, Erfassung, Veröffentlichung, Medien und Plugins landet eine verlorene Zusage im Dashboard statt in einer Logdatei, die niemand liest. Nicht konfiguriert und konfiguriert, aber fehlerhaft sind zwei verschiedene Zustände, und ein Rückfall, der einen Fehler verdecken könnte, wird gezählt und die Zahl angezeigt.",
          "Dokumentierte Grenzen. Fünf technische Dokumente, Architektur, Sicherheit, Wire-Format, Entscheidungen und Backlog, werden mit jeder Änderung aus dem Code gepflegt statt am Ende einer Saison, und Umgesetztes bleibt sichtbar getrennt von Geplantem.",
        ],
        callout: "CIND3R3LLA versteckt wichtiges Verhalten nicht im Code hinter einer leeren Oberfläche, und zeigt keine Bedienelemente, hinter denen kein echtes Verhalten liegt.",
      },
    ],
  },
});
