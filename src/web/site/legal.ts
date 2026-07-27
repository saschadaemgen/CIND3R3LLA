/**
 * The legal texts (CCB-S3-029).
 *
 * These are REAL operator data, not template copy, and they replace the bracketed
 * placeholders the site shipped with. A German site with a wrong or missing
 * Impressum is directly actionable, so the German text here is verbatim from the
 * briefing and must stay that way.
 *
 * WHY THESE LIVE IN CODE AND NOT IN `locales/`. The site carries 40 machine
 * translated locales. A legally binding Impressum cannot be machine translated,
 * and a privacy policy that drifts per language is worse than one language done
 * properly. So the German is authoritative, the English is an explicitly labelled
 * convenience translation, and every other locale falls back to English with the
 * same label. Nothing here is translated automatically.
 *
 * DELIBERATE OMISSIONS. There is no tax or economic identification number, in
 * either language: the operator has stated twice that it must not appear. If a
 * field is absent from the briefing it is absent here rather than filled with
 * something plausible.
 *
 * The Youth Protection Officer is a VOLUNTARY appointment and is worded as one.
 * Presenting it as a statutory obligation would misstate the operator's position.
 *
 * NOT LEGAL ADVICE. Prepared from the operator's supplied details and from what
 * the code actually does. It needs review by a lawyer before commercial launch,
 * particularly the privacy policy and anything touching preservation.
 */

/*
 * CORRECTIONS MADE AGAINST THE CODE (CCB-S3-029 Part D).
 *
 * Two claims in the drafted outline did not survive a read of the implementation,
 * and were changed rather than shipped:
 *
 *  1. A ten-year default retention period. NO archive retention period exists in
 *     this codebase. `retention` appears only for SimpleX contact-request and
 *     group-invitation hours (`src/profiles/bot-onboarding.ts`) and for capture
 *     event pruning; neither expires archived content. Publishing a retention
 *     promise the system cannot keep is the exact failure this policy is written
 *     to avoid, so the text now says there is no automatic expiry.
 *
 *  2. A theme preference in local storage. Dark is the only theme (operator
 *     decision, CCB-S3-001), so no such preference is stored. The one local
 *     storage entry is `cin-consent`, the visitor's answer to the cookie banner,
 *     which is now named for what it is.
 */

/** True for the one locale whose legal text is binding. */
export function isBindingLocale(locale: string): boolean {
  return locale === 'de';
}

export interface LegalSection {
  h: string;
  /** Paragraphs. A leading '-' marks a line that should not be wrapped in <p>. */
  body: string[];
}

/* ─────────────────────────── Impressum (binding) ─────────────────────────── */

export const IMPRESSUM_DE: { title: string; sections: LegalSection[] } = {
  title: 'Impressum',
  sections: [
    {
      h: 'Angaben gemäß § 5 DDG',
      body: [
        'Sascha Dämgen IT and More Systems\nInhaber: Sascha Dämgen\nAm Neumarkt 22\n45663 Recklinghausen\nDeutschland',
        'Rechtsform: Einzelunternehmen, eingetragen beim Gewerbeamt Recklinghausen.',
      ],
    },
    {
      h: 'Kontakt',
      body: [
        'Telefon: +49 2361 9702434\nE-Mail: info@it-and-more.systems\nFür CIND3R3LLA: info@cind3r3lla.com',
        'Erreichbarkeit: Montag bis Freitag, 9:00 bis 17:00 Uhr, ausgenommen gesetzliche Feiertage in Nordrhein-Westfalen. Außerhalb dieser Zeiten erreichen Sie uns per E-Mail.',
      ],
    },
    {
      h: 'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV',
      body: ['Sascha Dämgen, Anschrift wie oben.'],
    },
    {
      h: 'Jugendschutzbeauftragter',
      body: [
        'CIND3R3LLA hat freiwillig einen Jugendschutzbeauftragten benannt:',
        'Dipl.-Kaufmann Eike Keller\nMünsterstraße 34\n44145 Dortmund\ne.keller@simplego.dev',
      ],
    },
    {
      h: 'Aufsichtsbehörde',
      body: [
        'Für die hier angebotenen Software- und IT-Dienstleistungen besteht keine besondere Aufsichtsbehörde. Es gelten die allgemeinen gesetzlichen Bestimmungen.',
        'In datenschutzrechtlichen Angelegenheiten ist zuständig:',
        'Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen\nKavalleriestraße 2-4\n40213 Düsseldorf\nTelefon: +49 211 38424-0\nE-Mail: poststelle@ldi.nrw.de',
      ],
    },
    {
      h: 'Verbraucherstreitbeilegung',
      body: [
        'Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG).',
      ],
    },
    {
      h: 'Haftung für Inhalte',
      body: [
        'Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach den §§ 8 bis 10 DDG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.',
        'Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei Bekanntwerden entsprechender Rechtsverletzungen werden wir diese Inhalte umgehend entfernen.',
      ],
    },
    {
      h: 'Haftung für Links',
      body: [
        'Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich. Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße überprüft. Rechtswidrige Inhalte waren zum Zeitpunkt der Verlinkung nicht erkennbar.',
        'Eine permanente inhaltliche Kontrolle der verlinkten Seiten ist jedoch ohne konkrete Anhaltspunkte einer Rechtsverletzung nicht zumutbar. Bei Bekanntwerden von Rechtsverletzungen werden wir derartige Links umgehend entfernen.',
      ],
    },
    {
      h: 'Urheberrecht',
      body: [
        'Die durch den Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.',
        'Der Quellcode von CIND3R3LLA wird gesondert unter der GNU Affero General Public License v3.0 (AGPL-3.0) veröffentlicht. Für den Quellcode gilt diese Lizenz vorrangig vor den vorstehenden Bestimmungen.',
        'Soweit die über den Dienst bereitgestellten Inhalte nicht vom Betreiber erstellt wurden, insbesondere aus öffentlichen Gemeinschaften mit ausdrücklicher Einwilligung ihrer Verfasser archivierte Nachrichten, werden die Urheberrechte und Rechte der jeweiligen Verfasser beachtet. Sollten Sie auf eine Rechtsverletzung aufmerksam werden, bitten wir um einen Hinweis. Bei Bekanntwerden von Rechtsverletzungen werden wir derartige Inhalte umgehend entfernen.',
      ],
    },
    {
      h: 'Marken',
      body: [
        '"CIND3R3LLA" und weitere Produktbezeichnungen von Sascha Dämgen IT and More Systems sind Geschäftsbezeichnungen des Anbieters. Genannte Markennamen, Logos und geschützte Marken sind Eigentum ihrer jeweiligen Inhaber. CIND3R3LLA baut auf dem SimpleX-Netzwerk auf und steht in keiner Verbindung zu SimpleX Chat.',
        'Stand: 2026. Wir behalten uns vor, dieses Impressum bei Änderungen der Rechtslage oder unserer Unternehmensdaten anzupassen. Die jeweils aktuelle Fassung finden Sie stets auf dieser Seite.',
      ],
    },
  ],
};

export const IMPRESSUM_EN: { title: string; sections: LegalSection[] } = {
  title: 'Legal notice',
  sections: [
    {
      h: 'Information pursuant to § 5 DDG',
      body: [
        'Sascha Dämgen IT and More Systems\nOwner: Sascha Dämgen\nAm Neumarkt 22\n45663 Recklinghausen\nGermany',
        'Legal form: sole proprietorship, registered with the trade office (Gewerbeamt) of Recklinghausen.',
      ],
    },
    {
      h: 'Contact',
      body: [
        'Telephone: +49 2361 9702434\nEmail: info@it-and-more.systems\nFor CIND3R3LLA: info@cind3r3lla.com',
        'Availability: Monday to Friday, 9:00 to 17:00, excluding public holidays in North Rhine-Westphalia. Outside those hours, please contact us by email.',
      ],
    },
    {
      h: 'Responsible for content pursuant to § 18(2) MStV',
      body: ['Sascha Dämgen, address as above.'],
    },
    {
      h: 'Youth protection officer',
      body: [
        'CIND3R3LLA has appointed a youth protection officer voluntarily:',
        'Dipl.-Kaufmann Eike Keller\nMünsterstraße 34\n44145 Dortmund\ne.keller@simplego.dev',
      ],
    },
    {
      h: 'Supervisory authority',
      body: [
        'No special supervisory authority exists for the software and IT services offered here. The general statutory provisions apply.',
        'For data protection matters, the competent authority is:',
        'Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen\nKavalleriestraße 2-4\n40213 Düsseldorf\nTelephone: +49 211 38424-0\nEmail: poststelle@ldi.nrw.de',
      ],
    },
    {
      h: 'Consumer dispute resolution',
      body: [
        'We are neither willing nor obliged to participate in dispute resolution proceedings before a consumer arbitration board (§ 36 VSBG).',
      ],
    },
    {
      h: 'Liability for content',
      body: [
        'As a service provider we are responsible for our own content on these pages under the general laws, pursuant to § 7(1) DDG. Under §§ 8 to 10 DDG, however, we are not obliged as a service provider to monitor transmitted or stored third-party information, or to investigate circumstances that indicate unlawful activity.',
        'Obligations to remove or block the use of information under the general laws remain unaffected. Liability in this respect is only possible from the point at which a concrete infringement becomes known. On becoming aware of such infringements we will remove that content promptly.',
      ],
    },
    {
      h: 'Liability for links',
      body: [
        'Our offering contains links to external third-party websites over whose content we have no influence. We therefore cannot accept any responsibility for that third-party content. The respective provider or operator of the linked pages is always responsible for their content. The linked pages were checked for possible legal infringements at the time of linking. Unlawful content was not identifiable at that time.',
        'Permanent monitoring of the content of linked pages is not reasonable without concrete indications of an infringement. On becoming aware of infringements we will remove such links promptly.',
      ],
    },
    {
      h: 'Copyright',
      body: [
        'The content and works created by the site operator on these pages are subject to German copyright law. Reproduction, adaptation, distribution and any kind of exploitation outside the limits of copyright require the written consent of the respective author or creator.',
        'The source code of CIND3R3LLA is published separately under the GNU Affero General Public License v3.0 (AGPL-3.0). For the source code, that licence takes precedence over the provisions above.',
        'Where content provided through the service was not created by the operator, in particular messages archived from public communities with the express consent of their authors, the copyrights and rights of the respective authors are respected. If you become aware of an infringement, please let us know. On becoming aware of infringements we will remove such content promptly.',
      ],
    },
    {
      h: 'Trade marks',
      body: [
        '"CIND3R3LLA" and other product designations of Sascha Dämgen IT and More Systems are business designations of the provider. Brand names, logos and registered trade marks mentioned are the property of their respective owners. CIND3R3LLA builds on the SimpleX network and is not affiliated with SimpleX Chat.',
        'Version: 2026. We reserve the right to adapt this legal notice in the event of changes to the legal situation or to our company details. The current version is always available on this page.',
      ],
    },
  ],
};

/* ─────────────────────────── Privacy (binding: DE) ───────────────────────── */

/**
 * Drafted from the code rather than from a generator, because this product does
 * something a template does not anticipate: it publishes personal data to the open
 * web, deliberately, on the basis of consent.
 *
 * Every factual claim below is checked against the implementation. Where the code
 * and a comfortable wording disagreed, the code won.
 */
export const PRIVACY_EN: { title: string; sections: LegalSection[] } = {
  title: 'Privacy policy',
  sections: [
    {
      h: 'Controller',
      body: [
        'Sascha Dämgen IT and More Systems\nInhaber: Sascha Dämgen\nAm Neumarkt 22\n45663 Recklinghausen\nGermany\nEmail: info@it-and-more.systems\nFor CIND3R3LLA: info@cind3r3lla.com',
        'No data protection officer has been appointed. We are not required to appoint one, and we state this rather than leaving the question open.',
      ],
    },
    {
      h: 'The archive, and what it publishes',
      body: [
        'CIND3R3LLA archives messages from a public group chat and republishes them as a public web archive. The following are processed: message text, images, video, voice messages, files, links, the sender’s display name, and the time a message was sent.',
        'The legal basis is your consent, Art. 6(1)(a) GDPR. Consent is given individually by each member through an explicit opt-in, and it is always first-person: nobody can opt in on your behalf, and a request to publish somebody else is refused.',
        'Publication is FORWARD-ONLY. Nothing you sent before you opted in is ever published, and opting in again later does not reach back.',
        'Published content is on the OPEN WEB. It is publicly accessible, it is searchable, and it is indexed by search engines. This is the most consequential fact on this page, and it is the reason consent is asked for explicitly rather than assumed.',
      ],
    },
    {
      h: 'Withdrawing consent',
      body: [
        'You may withdraw your consent at any time, without giving reasons. Withdrawal takes effect immediately across every public surface: pages, media, feeds, the sitemap, structured data and search on our site.',
        'Publication is derived from your current consent on every read rather than stored as a flag, which is why withdrawal is immediate rather than a job that has to run.',
        'After withdrawing you choose what happens to the content already published. HIDE keeps it, out of public view, and you can bring it back yourself at any time. DELETE destroys it, and that cannot be undone. Until you choose, the content stays hidden.',
        'Content you sent while hidden is not republished if you later restore: restoring returns what was public before, not what you said while out of view.',
      ],
    },
    {
      h: 'Retention',
      body: [
        'Content remains for as long as your consent stands. There is NO automatic expiry: nothing is deleted after a fixed period, and we do not claim one, because the archive does not implement one. Storage ends when you withdraw, when the operator removes the content, or when the archive is discontinued.',
        'Withdrawal takes effect immediately. It is the only mechanism that ends storage on your initiative, which is why it is available at any time and needs no reason.',
      ],
    },
    {
      h: 'Media, and what we remove from it',
      body: [
        'Before an image is published, its metadata is stripped: EXIF, IPTC and XMP. This removes location coordinates, camera make, model and serial number, capture time, and any embedded owner or copyright name. Photographs from phones routinely carry the coordinates of where they were taken, and consenting to publish a picture is not consenting to publish your address.',
        'The published copy is a stripped derivative. The original is retained separately and is ENCRYPTED AT REST. Formats for which no stripper is available on this instance are recorded as such rather than assumed clean.',
      ],
    },
    {
      h: 'Automated screening for known abuse material',
      body: [
        'Received images are intended to be compared against hash databases of KNOWN child sexual abuse material. This runs independently of consent, because safety and publication are separate questions: a file that is never published is still a file we received.',
        'CURRENT STATUS: in development. No detection provider is connected, and no such screening runs today. We state this plainly rather than implying a protection that is not yet active.',
        'When it is active, no human and no general-purpose model examines your content. Only cryptographic fingerprints are compared. Hash matching detects known material only; it cannot detect new material, and a non-match is not a statement that anything is safe.',
      ],
    },
    {
      h: 'Deferred deletion, and why hiding is never deferred',
      body: [
        'Content reported to us as illegal is held back from destruction until we have reviewed the report. This prevents evidence being destroyed before it can be examined.',
        'HIDING IS NEVER DEFERRED. If you withdraw consent, your content leaves public view immediately, whether or not it is under review. Only physical erasure waits, and it runs automatically once the review concludes or the hold expires.',
      ],
    },
    {
      h: 'Preservation for legal obligations',
      body: [
        'Where material must be preserved for a legal obligation, it is segregated from ordinary storage, kept encrypted, withheld from every public path, and is not deletable by any route in the system, including by us.',
        'The reporting process, retention periods for preserved material and the designated point of contact are still being settled with legal counsel. This section will be extended once they are.',
      ],
    },
    {
      h: 'The limits of erasure, stated honestly',
      body: [
        'Deleting removes content from the live archive immediately, including the stored original, every derivative, and our own record of the message.',
        'Where backups exist, copies persist in them until those backups expire. Content already retrieved by third parties, including search engine caches, feed readers and anyone who copied it while it was public, is outside our control and cannot be recalled by us.',
        'We do not use the word "unrecoverable", because overwriting guarantees nothing on modern storage.',
      ],
    },
    {
      h: 'Processors and third parties',
      body: [
        'Hosting: IONOS SE, Germany. Servers are located in Germany.',
        'Cryptocurrency price providers are queried for market data only. No member content is transmitted to them, only the asset symbol being asked about.',
        'AI processing runs on the operator’s own hardware. No conversation content is sent to an external model provider.',
        'Video embeds load from a third party only after you click to play. Nothing is requested from the video provider before that click, and the preview image is served from our own domain.',
        'Analytics are switched off by default and require your consent before any script loads.',
      ],
    },
    {
      h: 'Website visitors',
      body: [
        'Technically necessary storage: one cookie holding your language choice. It carries no identifier and requires no consent.',
        'Consent-requiring storage: analytics, if the operator enables it. Nothing loads before you accept. Your answer to the banner, accepted or declined, is kept in your browser’s local storage so you are not asked again; declining leaves no analytics storage beyond that record of your refusal.',
        'Server logs at our hosting provider record access data for operational security. Reports submitted through the public report form store a keyed, non-reversible token derived from your IP address rather than the address itself.',
      ],
    },
    {
      h: 'Operators of the console',
      body: [
        'Administrative access uses passkeys (WebAuthn) as the primary method. Sessions are stored server-side and expire. Every administrative action that changes state is written to an audit log, which records the actor, the action and the target, but not the content acted upon.',
      ],
    },
    {
      h: 'Your rights',
      body: [
        'You have the right of access (Art. 15), rectification (Art. 16), erasure (Art. 17), restriction of processing (Art. 18), data portability (Art. 20) and objection (Art. 21), and the right to withdraw consent at any time (Art. 7(3)) without affecting the lawfulness of processing before withdrawal.',
        'You also have the right to complain to a supervisory authority:',
        'Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen\nKavalleriestraße 2-4\n40213 Düsseldorf\nTelephone: +49 211 38424-0\nEmail: poststelle@ldi.nrw.de',
      ],
    },
  ],
};

export const PRIVACY_DE: { title: string; sections: LegalSection[] } = {
  title: 'Datenschutzerklärung',
  sections: [
    {
      h: 'Verantwortlicher',
      body: [
        'Sascha Dämgen IT and More Systems\nInhaber: Sascha Dämgen\nAm Neumarkt 22\n45663 Recklinghausen\nDeutschland\nE-Mail: info@it-and-more.systems\nFür CIND3R3LLA: info@cind3r3lla.com',
        'Ein Datenschutzbeauftragter ist nicht bestellt. Wir sind dazu nicht verpflichtet und sagen dies ausdrücklich, anstatt die Frage offenzulassen.',
      ],
    },
    {
      h: 'Das Archiv und was veröffentlicht wird',
      body: [
        'CIND3R3LLA archiviert Nachrichten aus einer öffentlichen Gruppe und veröffentlicht sie als öffentliches Webarchiv. Verarbeitet werden: Nachrichtentext, Bilder, Videos, Sprachnachrichten, Dateien, Links, der Anzeigename des Absenders und der Zeitpunkt der Nachricht.',
        'Rechtsgrundlage ist Ihre Einwilligung, Art. 6 Abs. 1 lit. a DSGVO. Die Einwilligung wird von jedem Mitglied einzeln durch ausdrückliches Opt-in erteilt und ist stets höchstpersönlich: niemand kann sie für Sie erteilen, und die Aufforderung, eine andere Person zu veröffentlichen, wird abgelehnt.',
        'Die Veröffentlichung wirkt NUR IN DIE ZUKUNFT. Was Sie vor dem Opt-in gesendet haben, wird nie veröffentlicht, und ein späteres erneutes Opt-in wirkt nicht zurück.',
        'Veröffentlichte Inhalte stehen im OFFENEN WEB. Sie sind öffentlich zugänglich, durchsuchbar und werden von Suchmaschinen indexiert. Das ist die folgenreichste Aussage auf dieser Seite und der Grund, weshalb die Einwilligung ausdrücklich eingeholt und nicht vermutet wird.',
      ],
    },
    {
      h: 'Widerruf der Einwilligung',
      body: [
        'Sie können Ihre Einwilligung jederzeit und ohne Angabe von Gründen widerrufen. Der Widerruf wirkt sofort auf allen öffentlichen Oberflächen: Seiten, Medien, Feeds, Sitemap, strukturierte Daten und die Suche auf unserer Website.',
        'Die Veröffentlichung wird bei jedem Lesezugriff aus Ihrer aktuellen Einwilligung abgeleitet und nicht als Merkmal gespeichert. Deshalb wirkt der Widerruf sofort und nicht erst, wenn ein Prozess gelaufen ist.',
        'Nach dem Widerruf entscheiden Sie, was mit den bereits veröffentlichten Inhalten geschieht. VERBERGEN behält sie, außerhalb der Öffentlichkeit, und Sie können sie jederzeit selbst zurückholen. LÖSCHEN vernichtet sie, und das lässt sich nicht rückgängig machen. Bis Sie entscheiden, bleiben die Inhalte verborgen.',
        'Was Sie während des Verbergens gesendet haben, wird bei einer späteren Wiederherstellung nicht veröffentlicht: zurück kommt, was vorher öffentlich war, nicht das, was Sie außerhalb der Öffentlichkeit gesagt haben.',
      ],
    },
    {
      h: 'Speicherdauer',
      body: [
        'Inhalte bleiben gespeichert, solange Ihre Einwilligung besteht. Es gibt KEINE automatische Löschfrist: nichts wird nach einer festen Dauer entfernt, und wir behaupten das auch nicht, weil das Archiv keine solche Frist umsetzt. Die Speicherung endet mit Ihrem Widerruf, mit einer Entfernung durch den Betreiber oder mit der Einstellung des Archivs.',
        'Der Widerruf wirkt sofort. Er ist der einzige Weg, die Speicherung auf Ihre Initiative hin zu beenden, und ist deshalb jederzeit und ohne Angabe von Gründen möglich.',
      ],
    },
    {
      h: 'Medien und was daraus entfernt wird',
      body: [
        'Vor der Veröffentlichung eines Bildes werden dessen Metadaten entfernt: EXIF, IPTC und XMP. Damit entfallen Standortkoordinaten, Kamerahersteller, Modell und Seriennummer, Aufnahmezeitpunkt sowie eingebettete Urheber- oder Rechteangaben. Handyfotos enthalten regelmäßig die Koordinaten des Aufnahmeorts, und die Einwilligung in die Veröffentlichung eines Bildes ist keine Einwilligung in die Veröffentlichung Ihrer Adresse.',
        'Veröffentlicht wird eine bereinigte Kopie. Das Original wird gesondert aufbewahrt und ist VERSCHLÜSSELT GESPEICHERT. Formate, für die auf dieser Instanz kein Bereinigungsverfahren verfügbar ist, werden als solche gekennzeichnet und nicht als unbedenklich angenommen.',
      ],
    },
    {
      h: 'Automatisierter Abgleich mit bekanntem Missbrauchsmaterial',
      body: [
        'Empfangene Bilder sollen mit Hash-Datenbanken BEKANNTEN Materials über sexuellen Kindesmissbrauch abgeglichen werden. Dies erfolgt unabhängig von der Einwilligung, weil Sicherheit und Veröffentlichung getrennte Fragen sind: eine Datei, die nie veröffentlicht wird, haben wir dennoch empfangen.',
        'AKTUELLER STAND: in Entwicklung. Es ist kein Erkennungsdienst angebunden, und ein solcher Abgleich findet derzeit nicht statt. Wir sagen das ausdrücklich, statt einen Schutz nahezulegen, der noch nicht wirksam ist.',
        'Sobald der Abgleich aktiv ist, sieht weder ein Mensch noch ein allgemeines KI-Modell Ihre Inhalte an. Verglichen werden ausschließlich kryptografische Fingerabdrücke. Ein Hash-Abgleich erkennt nur bekanntes Material, nicht neues, und ein Nicht-Treffer ist keine Aussage darüber, dass etwas unbedenklich ist.',
      ],
    },
    {
      h: 'Aufgeschobene Löschung, und warum das Verbergen nie aufgeschoben wird',
      body: [
        'Inhalte, die uns als rechtswidrig gemeldet werden, werden bis zur Prüfung der Meldung von der Vernichtung zurückgehalten. Das verhindert, dass Beweismittel vernichtet werden, bevor sie geprüft werden können.',
        'DAS VERBERGEN WIRD NIE AUFGESCHOBEN. Wenn Sie Ihre Einwilligung widerrufen, verlassen Ihre Inhalte sofort die Öffentlichkeit, unabhängig von einer laufenden Prüfung. Nur die physische Löschung wartet, und sie läuft automatisch, sobald die Prüfung abgeschlossen ist oder die Frist endet.',
      ],
    },
    {
      h: 'Aufbewahrung aufgrund rechtlicher Pflichten',
      body: [
        'Soweit Material aufgrund einer rechtlichen Pflicht aufzubewahren ist, wird es von der übrigen Speicherung getrennt, verschlüsselt aufbewahrt, von allen öffentlichen Wegen ferngehalten und ist über keinen Weg im System löschbar, auch nicht durch uns.',
        'Das Meldeverfahren, die Aufbewahrungsfristen für aufbewahrtes Material und die benannte Kontaktstelle werden derzeit anwaltlich geklärt. Dieser Abschnitt wird anschließend ergänzt.',
      ],
    },
    {
      h: 'Grenzen der Löschung, ehrlich benannt',
      body: [
        'Das Löschen entfernt Inhalte sofort aus dem laufenden Archiv, einschließlich des gespeicherten Originals, aller abgeleiteten Kopien und unserer eigenen Aufzeichnung der Nachricht.',
        'Soweit Sicherungskopien bestehen, bleiben Kopien darin erhalten, bis diese Sicherungen auslaufen. Inhalte, die Dritte bereits abgerufen haben, einschließlich Suchmaschinen-Caches, Feedreadern und allen, die sie kopiert haben, solange sie öffentlich waren, entziehen sich unserer Kontrolle und können von uns nicht zurückgeholt werden.',
        'Wir verwenden das Wort "unwiederbringlich" nicht, weil Überschreiben auf heutigen Speichermedien nichts garantiert.',
      ],
    },
    {
      h: 'Auftragsverarbeiter und Dritte',
      body: [
        'Hosting: IONOS SE, Deutschland. Die Server stehen in Deutschland.',
        'Anbieter von Kryptowährungskursen werden ausschließlich für Marktdaten abgefragt. Es werden keine Mitgliederinhalte an sie übermittelt, sondern nur das abgefragte Kürzel.',
        'Die KI-Verarbeitung läuft auf eigener Hardware des Betreibers. Es werden keine Gesprächsinhalte an einen externen Modellanbieter gesendet.',
        'Videoeinbettungen laden erst nach Ihrem Klick von einem Dritten. Vor diesem Klick wird beim Videoanbieter nichts angefordert, und das Vorschaubild wird von unserer eigenen Domain ausgeliefert.',
        'Analysewerkzeuge sind standardmäßig ausgeschaltet und erfordern Ihre Einwilligung, bevor ein Skript geladen wird.',
      ],
    },
    {
      h: 'Besucherinnen und Besucher der Website',
      body: [
        'Technisch notwendige Speicherung: ein Cookie für Ihre Sprachwahl. Es enthält keine Kennung und bedarf keiner Einwilligung.',
        'Einwilligungspflichtige Speicherung: Analysewerkzeuge, sofern der Betreiber sie aktiviert. Vor Ihrer Zustimmung wird nichts geladen. Ihre Antwort auf den Hinweis, Zustimmung oder Ablehnung, wird im lokalen Speicher Ihres Browsers festgehalten, damit Sie nicht erneut gefragt werden; bei Ablehnung entsteht darüber hinaus keinerlei Analysespeicherung.',
        'Serverprotokolle beim Hoster erfassen Zugriffsdaten zur Betriebssicherheit. Über das öffentliche Meldeformular eingereichte Meldungen speichern statt Ihrer IP-Adresse einen daraus abgeleiteten, nicht umkehrbaren Token.',
      ],
    },
    {
      h: 'Betreiber der Konsole',
      body: [
        'Der administrative Zugang erfolgt vorrangig über Passkeys (WebAuthn). Sitzungen werden serverseitig gespeichert und laufen ab. Jede zustandsändernde Verwaltungshandlung wird in einem Prüfprotokoll festgehalten, das die handelnde Person, die Handlung und das Ziel erfasst, nicht jedoch den betroffenen Inhalt.',
      ],
    },
    {
      h: 'Ihre Rechte',
      body: [
        'Sie haben das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21) sowie das Recht, Ihre Einwilligung jederzeit zu widerrufen (Art. 7 Abs. 3), ohne dass die Rechtmäßigkeit der bis dahin erfolgten Verarbeitung berührt wird.',
        'Ihnen steht zudem ein Beschwerderecht bei einer Aufsichtsbehörde zu:',
        'Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen\nKavalleriestraße 2-4\n40213 Düsseldorf\nTelefon: +49 211 38424-0\nE-Mail: poststelle@ldi.nrw.de',
      ],
    },
  ],
};

/** Chooses the binding German text for `de`, the English convenience text otherwise. */
export function impressumFor(locale: string): { title: string; sections: LegalSection[] } {
  return isBindingLocale(locale) ? IMPRESSUM_DE : IMPRESSUM_EN;
}

export function privacyFor(locale: string): { title: string; sections: LegalSection[] } {
  return isBindingLocale(locale) ? PRIVACY_DE : PRIVACY_EN;
}
