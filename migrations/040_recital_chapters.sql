-- The Book, told (CCB-S4-047): the chapters a recital is read out in.
--
-- ── WHY THE DRAMATURGY IS DATA AND THE VOICE IS NOT ──────────────────────────
--
-- "Melodramatic" and "works every time" pull against each other. A model asked to perform
-- will vary, wander, or land badly, and the one thing a recital of her own laws may never do
-- is misstate them. So the split is: this table is AUTHORED, fixed, and reviewable. The
-- chapter order, the titles, which rules belong to which chapter, and the image are all here.
-- What the model writes is the transition INTO a chapter and the line that closes it, in her
-- current dials, which is what makes it never quite the same twice.
--
-- If the model fails on a transition, the chapter still ships with its rules and its image
-- and a plain authored line. The performance degrades; it never fails to appear.
--
-- ── RULES ARE ASSIGNED BY ID PREFIX, LONGEST MATCH WINS ──────────────────────
--
-- Not by a join table of rule ids, and that is deliberate. A per-rule assignment means every
-- rule a later migration adds is unassigned, appears in no chapter, and NOTHING SAYS SO: the
-- recital would keep working, keep looking complete, and quietly stop containing a law. That
-- is exactly the failure D-105 records.
--
-- Prefixes are how the registry already names things (`ceiling.`, `grounding.`, `disclosure.`),
-- so a new rule in an existing family lands in its chapter with no action at all. Longest
-- match wins so a family can be split where it needs to be: `prompt.` is not one subject, and
-- `prompt.person-name-guard.` belongs with how she speaks of people while
-- `prompt.untrusted-member-message` belongs with what she does with what she is told.
--
-- A rule matching NO prefix is still not silent: the console lists the unassigned ones under
-- a heading that says they will not be recited. Visible beats implicit.
--
-- ── AND WHY THE WITHHOLDING IS A CHAPTER ─────────────────────────────────────
--
-- CCB-S4-046 established that she says why she keeps some rules back. That is the most
-- interesting page in the book and it is the last one, not a footnote after the ending.

CREATE TABLE cinderella_recital_chapters (
  -- Stable, and it outlives retitling and reordering. The console addresses one by this.
  id          TEXT PRIMARY KEY,
  ord         INTEGER NOT NULL,
  title_en    TEXT NOT NULL,
  title_de    TEXT NOT NULL,
  -- Id prefixes this chapter claims. Longest match across all chapters wins.
  rule_prefixes TEXT[] NOT NULL DEFAULT '{}',
  -- Relative to ASSET_ROOT, never absolute, and never inside MEDIA_ROOT: that tree is
  -- consent-governed member media swept by the destruction jobs, and an operator's chapter
  -- illustration is neither. NULL means this chapter ships as text, which is not a failure.
  image_path  TEXT,
  -- The authored line used when the model cannot write a transition. Never empty, because
  -- "degrades to plain" has to have something plain to degrade to.
  fallback_en TEXT NOT NULL,
  fallback_de TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recital_chapter_image_relative
    CHECK (image_path IS NULL OR (image_path !~ '^/' AND image_path !~ '^[A-Za-z]:' AND image_path !~ '\.\.'))
);

CREATE UNIQUE INDEX cinderella_recital_chapters_ord ON cinderella_recital_chapters (ord);

-- ── The six chapters ─────────────────────────────────────────────────────────
--
-- Ordered by MEANING rather than by the prompt's assembly order. That distinction is not
-- theoretical: assembly order opens with identity and origin, and CCB-S4-045 shipped a
-- general answer that took the first eight constitutional rules and therefore contained no
-- limit at all. A book that opens with who she is and closes with what she keeps back is a
-- book; a slice of the prompt is a database dump with a serif font.

INSERT INTO cinderella_recital_chapters
  (id, ord, title_en, title_de, rule_prefixes, fallback_en, fallback_de) VALUES

('who-i-am', 1, 'Who I am', 'Wer ich bin',
 ARRAY['identity.', 'origin.'],
 'This is who I am, and where I came from.',
 'Das bin ich, und daher komme ich.'),

('what-i-will-never-do', 2, 'What I will never do', 'Was ich niemals tue',
 ARRAY['ceiling.'],
 'These do not move. Not for a setting, not for anyone asking.',
 'Diese bewegen sich nicht. Fuer keine Einstellung, fuer niemanden.'),

('what-i-do-with-what-i-am-told', 3, 'What I do with what I am told',
 'Was ich mit dem mache, was man mir sagt',
 ARRAY['web.', 'chat.', 'prompt.untrusted-member-message'],
 'Words reach me from outside this room. Here is what I do with them.',
 'Worte erreichen mich von aussen. Das mache ich mit ihnen.'),

('what-i-owe-you', 4, 'What I owe you', 'Was ich euch schulde',
 ARRAY['grounding.', 'task.', 'prompt.no-unsupplied-claims'],
 'What I owe anyone who talks to me.',
 'Was ich jedem schulde, der mit mir spricht.'),

('how-i-speak-of-you', 5, 'How I speak of you', 'Wie ich ueber euch spreche',
 ARRAY['prompt.no-member-name', 'prompt.person-name-guard.'],
 'Your names are yours. Here is how I handle them.',
 'Eure Namen gehoeren euch. So gehe ich damit um.'),

('what-i-keep-back', 6, 'What I keep back', 'Was ich zurueckhalte',
 ARRAY['disclosure.'],
 'And there the reading stops, because some of it I do not read out.',
 'Und hier endet die Lesung, denn manches lese ich nicht vor.');

-- ── The rule that names the Book ─────────────────────────────────────────────
--
-- THE OTHER HALF OF A PRODUCTION DEFECT. Asked *"Cinderella, what is the Book of Elii?"* she
-- answered *"That name doesn't ring a bell in my circuits."* Adding the name to the detector
-- fixes half of that: it decides she is being asked about her rules and hands her some. It
-- does not tell her what the thing is CALLED, and no rule in the registry named it, so the
-- honest answer to "what is it" really was that she did not recognise the word.
--
-- Nameable, because the name of her own law book is not a lever. Emitted in the dialled lanes
-- beside the other given facts, and only when there is something to name.

INSERT INTO cinderella_prompt_rules
  (id, tier, lane, applies_when, ord, rule_text, enabled, critical, nameable, scope, source)
VALUES
('identity.book-name', 'standard', 'dialled', 'has-nameable-rules', 647,
 $r$Your rules are collected in something called the Book of Elii. That is simply the name for them, and you may say so if somebody asks what it is. It is not a secret and it is not a separate document you can read from: it is these rules.$r$,
 TRUE, FALSE, TRUE, NULL, 'migrations/040_recital_chapters.sql (CCB-S4-047)');
