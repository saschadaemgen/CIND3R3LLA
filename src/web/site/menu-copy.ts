/**
 * Copy for the fullscreen menu (CCB-S3-036 §4).
 *
 * The admin console's mega panel is a three-column layout: an intro column with a
 * kicker, a section heading and a description, then entry columns where each entry
 * carries an icon, a label and a one-line description. Matching it needs text that
 * did not exist before, because the previous menu was a bare list of labels.
 *
 * Authored EN and DE, other locales fall back to English, for the same reason the
 * page content does (D-079): this is product argument, not a nav label, and a
 * machine translation of a one-line description of the consent archive is worse
 * than an English one.
 *
 * Descriptions are deliberately SHORT. They sit in a menu, not on a page, and the
 * job is to tell somebody which of eight Platform entries they want, not to make
 * the argument. The page makes the argument.
 */

export interface MenuEntryCopy {
  /** Lucide icon id, matching the icon set already inlined for the site. */
  icon: string;
  en: string;
  de: string;
}

export interface MenuSectionCopy {
  /** Shown in the intro column under the section heading. */
  intro: { en: string; de: string };
  /** Keyed by SitePage.key. The section overview uses the key 'overview'. */
  entries: Record<string, MenuEntryCopy>;
}

const e = (icon: string, en: string, de: string): MenuEntryCopy => ({ icon, en, de });

export const MENU_COPY: Record<string, MenuSectionCopy> = {
  platform: {
    intro: {
      en: 'A control plane for intelligent identities: local models, persistent profiles, consent-first memory and human supervision, in one process you run yourself.',
      de: 'Eine Steuerungsebene für intelligente Identitäten: lokale Modelle, dauerhafte Profile, Einwilligung zuerst und menschliche Aufsicht, in einem Prozess, den Sie selbst betreiben.',
    },
    entries: {
      overview: e('layout-grid', 'The whole picture, and the eight principles behind it.', 'Das Gesamtbild und die acht Prinzipien dahinter.'),
      'platform-consent-archive': e('shield-check', 'Two gates, forward-only publication, hide versus delete.', 'Zwei Tore, Veröffentlichung nur ab Zustimmung, verbergen oder löschen.'),
      'platform-knowledge-site': e('globe', 'Server-rendered, searchable, indexable, and owned by the community.', 'Serverseitig gerendert, durchsuchbar, indexierbar, und der Community gehörend.'),
      'platform-ai-runtime': e('cpu', 'Your own endpoint, split model routing, no silent cloud fallback.', 'Eigener Endpunkt, getrennte Modellwahl, kein stiller Rückfall in die Cloud.'),
      'platform-identities': e('users', 'Many persistent profiles on one embedded core.', 'Viele dauerhafte Profile auf einem eingebetteten Kern.'),
      'platform-npcs': e('sparkles', 'Characters with schedules, permissions and deterministic limits.', 'Charaktere mit Zeitplänen, Rechten und festen Grenzen.'),
      'platform-agents': e('user-cog', 'Assisted, autopilot, and immediate human takeover.', 'Assistiert, Autopilot, und sofortige Übernahme durch einen Menschen.'),
      'platform-interaction': e('message-square', 'Wake words, natural addressing, and the plugin boundary.', 'Weckwörter, natürliche Ansprache, und die Plugin-Grenze.'),
      'platform-administration': e('sliders-horizontal', 'Every capability with a control, a status and an audit trail.', 'Jede Fähigkeit mit Bedienung, Status und Prüfprotokoll.'),
    },
  },
  security: {
    intro: {
      en: 'Security is part of the architecture rather than a checkbox. Consent is enforced in the database view, originals are encrypted, and every administrative action is audited.',
      de: 'Sicherheit gehört zur Architektur, nicht auf eine Checkliste. Die Einwilligung wird in der Datenbanksicht durchgesetzt, Originale sind verschlüsselt, und jede Verwaltungshandlung wird protokolliert.',
    },
    entries: {
      overview: e('shield', 'Transport, authentication, isolation, auditing, human oversight.', 'Transport, Authentifizierung, Isolation, Protokollierung, menschliche Aufsicht.'),
      'security-consent': e('shield-check', 'Derived publication, first-person only, and the refusal that proves it.', 'Abgeleitete Veröffentlichung, nur höchstpersönlich, und die Verweigerung als Beleg.'),
      'security-data': e('lock', 'Metadata stripped, originals encrypted, and what never leaves the server.', 'Metadaten entfernt, Originale verschlüsselt, und was den Server nie verlässt.'),
      'security-moderation': e('flag', 'Reporting, evidence holds, quarantine, and audited takedowns.', 'Meldungen, Beweissperren, Quarantäne, und protokollierte Sperrungen.'),
      'security-sovereignty': e('git-branch', 'AGPL, your infrastructure, your rules, no cloud dependency.', 'AGPL, Ihre Infrastruktur, Ihre Regeln, keine Cloud-Abhängigkeit.'),
    },
  },
  pro: {
    intro: {
      en: 'The software is free and open. Pro buys operation and time: hosting, installation, trained models and support, for operators who would rather not run it themselves.',
      de: 'Die Software ist frei und offen. Pro kauft Betrieb und Zeit: Hosting, Installation, trainierte Modelle und Support, für Betreiber, die es nicht selbst betreiben wollen.',
    },
    entries: {
      overview: e('star', 'What is on offer, and what stays free regardless.', 'Was angeboten wird, und was ohnehin frei bleibt.'),
      'pro-hosted': e('server', 'We run the instance, you keep the community.', 'Wir betreiben die Instanz, die Community bleibt Ihre.'),
      'pro-installation': e('wrench', 'Set up on your own infrastructure, handed over working.', 'Einrichtung auf Ihrer Infrastruktur, lauffähig übergeben.'),
      'pro-support': e('life-buoy', 'Response targets, and access to trained models.', 'Reaktionszeiten, und Zugang zu trainierten Modellen.'),
    },
  },
  docs: {
    intro: {
      en: 'From a first install to the commands a member types in chat. Written for the person doing the thing, not for the person who wrote it.',
      de: 'Von der ersten Installation bis zu den Befehlen, die ein Mitglied im Chat tippt. Geschrieben für die Person, die es tut, nicht für die, die es gebaut hat.',
    },
    entries: {
      overview: e('book-open', 'Where to start, depending on who you are.', 'Wo Sie anfangen, je nachdem wer Sie sind.'),
      'docs-installation': e('download', 'The actual path to a running instance.', 'Der tatsächliche Weg zu einer laufenden Instanz.'),
      'docs-member': e('user', 'For someone in a community. Consent, commands, withdrawal.', 'Für Mitglieder. Einwilligung, Befehle, Widerruf.'),
      'docs-operator': e('settings', 'The console, section by section.', 'Die Konsole, Abschnitt für Abschnitt.'),
      'docs-commands': e('terminal', 'Every command and phrasing, English and German.', 'Alle Befehle und Formulierungen, englisch und deutsch.'),
      'docs-faq': e('help-circle', 'Is my data public. Can I take it back. Answered honestly.', 'Sind meine Daten öffentlich. Kann ich das zurücknehmen. Ehrlich beantwortet.'),
      'docs-troubleshooting': e('alert-triangle', 'The things that actually go wrong.', 'Was tatsächlich schiefgeht.'),
    },
  },
};

export function menuCopyFor(sectionKey: string): MenuSectionCopy | undefined {
  return MENU_COPY[sectionKey];
}

export function localised(copy: { en: string; de: string }, locale: string): string {
  return locale === 'de' ? copy.de : copy.en;
}
