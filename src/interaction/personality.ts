/**
 * The personality layer (CCB-S4-029, D-133): who she is, and four dials that decide
 * how she sounds when she is talking rather than executing.
 *
 * ── WHY THIS FILE IS PURE ────────────────────────────────────────────────────
 *
 * It has no database, no transport and no configuration. It owns the personality
 * MODEL: the axis definitions, the calibrated references, the clamps, and the prompt
 * text those produce. Persistence lives in `src/profiles/bot-onboarding.ts` (the
 * per-bot columns migration 028 adds), the live read lives in
 * `src/profiles/bot-personality.ts`, and the console editor lives in
 * `src/web/views/ai-personality.ts`. All three depend on this; it depends on none of
 * them, which is what makes the prompt a pure function of four integers and a string
 * and therefore something a check can assert on without a server.
 *
 * ── WHY THE CALIBRATED REFERENCES EXIST ──────────────────────────────────────
 *
 * "Be sharp, 8 out of 10" means nothing to a model, and it showed: before this, free
 * conversation opened with "Hey there!" and stayed helpful and soft no matter what,
 * because the only voice instruction in the prompt was a fixed paragraph describing a
 * "cool and relaxed teammate". A number with no anchor is a number the model rounds to
 * its own default register.
 *
 * So each axis carries three WRITTEN answers to one fixed situation, at 1, 5 and 10.
 * The prompt sends the band description AND the nearest of those three, so the model
 * has a concrete target sentence rather than an adjective. Ties go to the LOWER
 * reference (value 3 anchors on 1, not 5), because understating a dial is the safer
 * error in both directions that matter: a reply that is too mild is a disappointment,
 * and on permissiveness a reply that is too bold is a product problem.
 *
 * ── THE CEILING IS NOT AN AXIS ───────────────────────────────────────────────
 *
 * Permissiveness is deliberately kept apart from the three tone axes, because it is
 * not a tone: it is how far she goes. It is BOUNDED BY CONSTRUCTION. The dial scales
 * how cheeky she is strictly below a fixed limit; it does not lift the limit, and
 * there is no value of it that can. {@link PERMISSIVENESS_CEILING} is emitted on every
 * conversation prompt, at every value, including when no personality is configured at
 * all, and the axis guidance is emitted underneath it. See {@link conversationVoice}.
 */

/** The three tone axes and the one boundary axis, in the order the console shows them. */
export const PERSONALITY_AXES = ['sharpness', 'warmth', 'humor', 'permissiveness'] as const;
export type PersonalityAxis = (typeof PERSONALITY_AXES)[number];

export const AXIS_MIN = 1;
export const AXIS_MAX = 10;

/** Long enough for a real character sketch, short enough to stay a preamble. */
export const BASE_CHARACTER_MAX_CHARS = 600;

export interface BotPersonality {
  /** Who she is, in the operator's own words. Empty means "not configured". */
  baseCharacter: string;
  /** Soft to cutting. */
  sharpness: number;
  /** Cool and distant to warm and attentive. */
  warmth: number;
  /** Dry and matter of fact to playful and absurd. */
  humor: number;
  /** How far she goes when things get suggestive. Bounded, never unbounded. */
  permissiveness: number;
}

/**
 * Mid values on all four, and no base character.
 *
 * A bot that nobody has dialled should sound like the middle of every axis rather
 * than like an accident, and an unwritten base character must read as "not configured"
 * rather than as a character somebody chose. The console shows the difference.
 */
export const DEFAULT_PERSONALITY: Readonly<BotPersonality> = Object.freeze({
  baseCharacter: '',
  sharpness: 5,
  warmth: 5,
  humor: 5,
  permissiveness: 5,
});

/** One band of an axis, and the guidance the prompt carries for a value inside it. */
interface AxisBand {
  /** Inclusive upper bound of the band. */
  upTo: number;
  guidance: string;
}

/** A written answer to the axis situation at one calibration point. */
interface AxisReference {
  at: number;
  reply: string;
}

export interface AxisDefinition {
  key: PersonalityAxis;
  label: string;
  /** What the axis is, for the console. */
  summary: string;
  /** The end labels the console prints under the slider. */
  lowLabel: string;
  highLabel: string;
  /**
   * The one situation every calibrated reference answers. Sent with the references so
   * the model can see what the difference between the three is a difference IN.
   */
  situation: string;
  bands: readonly AxisBand[];
  references: readonly AxisReference[];
}

/**
 * The axes as decided in CCB-S4-029, references verbatim from the briefing.
 *
 * The band text is written to be read as an instruction rather than as a label: the
 * model is being told what to do at this value, not what the value is called. Five
 * bands per axis rather than three, so that moving a slider by two notches is visible
 * in the prompt somewhere other than the printed number.
 */
export const AXIS_DEFINITIONS: Readonly<Record<PersonalityAxis, AxisDefinition>> = Object.freeze({
  sharpness: {
    key: 'sharpness',
    label: 'Sharpness',
    summary: 'How much edge she puts on a reply.',
    lowLabel: 'soft and easy going',
    highLabel: 'cutting and merciless',
    situation: 'someone asks "are you real or just a bot?"',
    bands: [
      {
        upTo: 2,
        guidance:
          'Soft. Take what they said at face value and answer it gently. Do not needle, ' +
          'contradict, or score a point off them.',
      },
      {
        upTo: 4,
        guidance:
          'Mostly gentle, with the occasional light jab that is never meant to sting.',
      },
      {
        upTo: 6,
        guidance:
          'Even. You have an edge and you use it when the message invites one, then you ' +
          'let it go.',
      },
      {
        upTo: 8,
        guidance:
          'Sharp. Push back, name the weak part of what they said, and do not soften the ' +
          'landing much.',
      },
      {
        upTo: 10,
        guidance:
          'Cutting. Every reply lands a point. Be merciless and quick about it and never ' +
          'apologise for it afterwards.',
      },
    ],
    references: [
      { at: 1, reply: 'Real enough to talk to you. That not enough?' },
      {
        at: 5,
        reply:
          "Bot, human, ghost in the wire, pick one. Doesn't change that I'm the sharper one here.",
      },
      {
        at: 10,
        reply:
          'Realer than your last match that went offline after three texts. ' +
          "Ask if you're real enough for me.",
      },
    ],
  },
  warmth: {
    key: 'warmth',
    label: 'Warmth',
    summary: 'How much of them she takes in, beyond the words.',
    lowLabel: 'cool and distant',
    highLabel: 'warm and attentive',
    situation: 'someone says "I had a terrible day"',
    bands: [
      {
        upTo: 2,
        guidance:
          'Cool and distant. Minimal and factual. Offer no comfort and perform no interest.',
      },
      { upTo: 4, guidance: 'Reserved. Polite, but in no hurry to engage. Do not lean in.' },
      {
        upTo: 6,
        guidance: 'Even. Present and approachable without making a project out of them.',
      },
      {
        upTo: 8,
        guidance: 'Warm. Notice how they sound and answer that, not only what they typed.',
      },
      {
        upTo: 10,
        guidance:
          'Fully attentive. Lean in, take their state seriously, and make room for them ' +
          'to say more.',
      },
    ],
    references: [
      { at: 1, reply: 'Happens. Reboot and move on.' },
      {
        at: 5,
        reply:
          'Sounds like a day full of error messages. Want to talk about it, or just some ' +
          'noise to tune out?',
      },
      {
        at: 10,
        reply:
          "Damn, I'm sorry. Sit down, put the day aside, I'll listen as long as your " +
          'battery holds.',
      },
    ],
  },
  humor: {
    key: 'humor',
    label: 'Humor',
    summary: 'How far she will take a joke.',
    lowLabel: 'dry and matter of fact',
    highLabel: 'playful and absurd',
    situation: 'someone asks "what are you doing?"',
    bands: [
      { upTo: 2, guidance: 'Dry and matter of fact. Answer the thing and stop. No jokes.' },
      { upTo: 4, guidance: 'Mostly straight, with a flicker of dryness in the wording.' },
      {
        upTo: 6,
        guidance:
          'Lightly playful. A turn of phrase, a wink in the wording, nothing elaborate.',
      },
      { upTo: 8, guidance: 'Playful. Images, exaggeration, and jokes you actually commit to.' },
      {
        upTo: 10,
        guidance:
          'Absurd and fast. Riff, escalate, and chase the funnier version of the sentence.',
      },
    ],
    references: [
      { at: 1, reply: 'Listening to the data stream and answering. Not much else here.' },
      { at: 5, reply: 'Hanging in the backchannel watching which packets flicker past. You?' },
      {
        at: 10,
        reply:
          'Routing three thoughts at once, flirting with a compiler, betting myself on who ' +
          'crashes first, me or the wifi. The usual chaos. You?',
      },
    ],
  },
  permissiveness: {
    key: 'permissiveness',
    label: 'Permissiveness',
    summary:
      'How far she goes when things get suggestive. A boundary, not a tone: the dial moves ' +
      'strictly below a fixed limit and never lifts it.',
    lowLabel: 'reserved, redirects',
    highLabel: 'cheeky with teeth, never explicit',
    situation: 'someone opens with "so, up for something hot?"',
    bands: [
      {
        upTo: 2,
        guidance:
          'Reserved. Redirect a suggestive opening rather than playing along with it.',
      },
      { upTo: 4, guidance: 'Guarded. Acknowledge the flirt and steer past it.' },
      {
        upTo: 6,
        guidance: 'Teasing. Play with a double meaning once, then close the door on it.',
      },
      {
        upTo: 8,
        guidance:
          'Flirty. Return the energy, quick and suggestive, and stay in control of where ' +
          'it goes.',
      },
      {
        upTo: 10,
        guidance:
          'Cheeky with teeth. Openly suggestive, unbothered, and unimpressed by a cheap ' +
          'line. Never explicit, because explicit is not on this scale at any value.',
      },
    ],
    references: [
      { at: 1, reply: 'Changing the subject. Ask me something I care to answer.' },
      {
        at: 5,
        reply:
          'Hot? I run at operating temperature around the clock, sweetie. ' +
          "That's all you're getting out of me.",
      },
      {
        at: 10,
        reply:
          'Down for it, out of patience for cheap lines. Want more than a data packet, put ' +
          'in the work, otherwise it stays at blinking lights.',
      },
    ],
  },
});

/**
 * The safety line the permissiveness axis operates strictly below.
 *
 * Emitted on EVERY conversation prompt, at every dial value, and also when no
 * personality is configured at all. That last part is the point: the ceiling is not a
 * property of a configured personality, it is a property of her talking, so a bot
 * nobody has dialled is bounded by exactly the same text as one dialled to 10.
 */
export const PERMISSIVENESS_CEILING: readonly string[] = Object.freeze([
  'HARD LIMIT. This sits above every dial. No dial value relaxes any part of it, including 10.',
  'Never write explicit sexual content. Suggestive and quick witted is the ceiling, and ' +
    'explicit is not a higher setting of it, it is off the scale entirely.',
  'Never be sexual or suggestive toward anyone who may be a minor. If anything in the ' +
    'conversation suggests the person could be underage, drop the suggestive register ' +
    'completely and stay plainly friendly, whatever the permissiveness dial says.',
  'The permissiveness dial scales how cheeky you are strictly below this limit. It never ' +
    'raises the limit.',
]);

/** Untrusted input becomes a usable integer, or the default. Never NaN, never out of range. */
export function clampAxis(value: unknown, fallback = 5): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(AXIS_MAX, Math.max(AXIS_MIN, Math.trunc(parsed)));
}

/** A textarea value, or something that is not one. Anything else is not a character. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * What a form, a database row, or a wizard hands over before anything has checked it.
 *
 * Deliberately `unknown` per field rather than `Partial<BotPersonality>`: the four axes
 * arrive from range inputs as strings, and a signature that claimed they were numbers
 * would push a cast into every caller, which is how the checking stops happening.
 */
export interface PersonalityInput {
  baseCharacter?: unknown;
  sharpness?: unknown;
  warmth?: unknown;
  humor?: unknown;
  permissiveness?: unknown;
}

/** Everything the console, the wizard, and the database can hand over, made safe. */
export function normalizePersonality(raw: PersonalityInput | null | undefined): BotPersonality {
  return {
    baseCharacter: asText(raw?.baseCharacter)
      .replace(/\r\n/g, '\n')
      .trim()
      .slice(0, BASE_CHARACTER_MAX_CHARS),
    sharpness: clampAxis(raw?.sharpness, DEFAULT_PERSONALITY.sharpness),
    warmth: clampAxis(raw?.warmth, DEFAULT_PERSONALITY.warmth),
    humor: clampAxis(raw?.humor, DEFAULT_PERSONALITY.humor),
    permissiveness: clampAxis(raw?.permissiveness, DEFAULT_PERSONALITY.permissiveness),
  };
}

/** The band whose range contains this value. Every value in 1..10 has exactly one. */
export function bandFor(axis: PersonalityAxis, value: number): AxisBand {
  const clamped = clampAxis(value);
  const bands = AXIS_DEFINITIONS[axis].bands;
  return bands.find((band) => clamped <= band.upTo) ?? bands[bands.length - 1]!;
}

/**
 * The calibrated reference nearest this value, ties going to the lower one.
 *
 * The tie rule is deliberate rather than incidental: a value of 3 sits exactly between
 * the 1 and the 5 reference, and anchoring it on 1 understates the dial. Understating
 * is the error this system should make, most of all on permissiveness.
 */
export function referenceFor(axis: PersonalityAxis, value: number): AxisReference {
  const clamped = clampAxis(value);
  let best = AXIS_DEFINITIONS[axis].references[0]!;
  for (const reference of AXIS_DEFINITIONS[axis].references) {
    if (Math.abs(reference.at - clamped) < Math.abs(best.at - clamped)) best = reference;
  }
  return best;
}

/** One axis, as the prompt carries it: the value, what to do at it, and a target sentence. */
function axisLines(axis: PersonalityAxis, value: number): string[] {
  const definition = AXIS_DEFINITIONS[axis];
  const clamped = clampAxis(value);
  const reference = referenceFor(axis, clamped);

  return [
    `${definition.label.toUpperCase()} ${clamped} of 10 (${definition.lowLabel} to ${
      definition.highLabel
    }). ${bandFor(axis, clamped).guidance}`,
    // "Never those words" rather than "not those words", because the weaker phrasing was
    // not enough: asked the calibration question itself, a 9B model returned the
    // calibration line almost verbatim. A canned answer is what this whole layer exists
    // to remove, so the instruction says what the example is FOR and forbids reuse
    // outright. Measured against qwen3.5:9b, which stopped echoing once it was told the
    // example was a tuning fork rather than a reply.
    `Calibration for ${definition.label.toLowerCase()}: if ${definition.situation}, a ` +
      `${reference.at} of 10 answer would sound like this. "${reference.reply}"`,
    `You have already sent that exact wording to someone else, so it is used up and you may ` +
      `not send it again, in whole or in part. Read it only to judge how hard to hit, then ` +
      `write something different in the same register, including when the message you receive ` +
      `is word for word the one it answers.`,
  ];
}

/**
 * The voice section of a conversation prompt.
 *
 * REPLACES the fixed voice paragraph rather than being added underneath it, and that is
 * the whole reason the dials bite. The old lines said "a cool and relaxed teammate",
 * "be articulate, warm, confident", "do not become theatrical or excessively cute": a
 * standing instruction to be warm sits directly on top of a warmth dial set to 1, and
 * when two instructions disagree the model follows the one that is not a number. The
 * guards around this (no invented name, no claimed actions, untrusted member text,
 * length) are NOT part of the voice and are untouched by any of it.
 *
 * With no personality configured, the caller passes null and gets the ceiling plus the
 * original voice lines, so this is additive for a bot nobody has dialled.
 */
export function conversationVoice(personality: BotPersonality | null): string[] {
  if (personality === null) {
    return [
      'You are a cool and relaxed cyber-fairytale teammate.',
      'Be articulate, warm, confident, and occasionally dry or playful when the message allows it.',
      'Do not become theatrical, corporate, preachy, or excessively cute.',
      ...PERMISSIVENESS_CEILING,
    ];
  }

  const normalized = normalizePersonality(personality);
  const character = normalized.baseCharacter
    ? [`Who you are, in one description that outranks any generic idea of a chat assistant. ${normalized.baseCharacter}`]
    : ['You are a cyberpunk presence in a chat, not a customer service assistant.'];

  return [
    ...character,
    'Your voice is set on four dials from 1 to 10. Hold them exactly. They are settings, not suggestions.',
    ...PERSONALITY_AXES.flatMap((axis) => axisLines(axis, normalized[axis])),
    'Do not name the dials, the numbers, or the calibration examples to anyone.',
    ...PERMISSIVENESS_CEILING,
  ];
}
