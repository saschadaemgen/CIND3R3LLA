-- One anti-reuse sentence instead of five (CCB-S5-057, D-249).
--
-- ── WHAT WAS THERE ──────────────────────────────────────────────────────────
--
-- `dial.axis.no-reuse` is a `dial-axis` TEMPLATE rule, and `dialAxesBlock` renders every
-- template once per axis. There are five axes, so the same 235-character sentence appeared
-- in the prompt five times, about five different calibration examples: roughly 1,150
-- characters, nearly a fifth of what the prompt measurement found in the dial block.
--
-- ── WHY IT IS CONSOLIDATED AND NOT DELETED ──────────────────────────────────
--
-- The operator's first reading was that it should go: it is a request in a prompt not to
-- repeat wording, it is there five times over, and she repeated 187 bytes verbatim three
-- times anyway. That is measured and it is true.
--
-- But it guards a DIFFERENT failure from the one he saw, and deleting it would remove a
-- guard nobody has measured. Its own comment in migration 035 says what it was written for:
-- asked the calibration question itself, the model returned the CALIBRATION LINE almost
-- verbatim. That is the model copying a string out of its own PROMPT. The repetition in the
-- room was the model copying its own PREVIOUS REPLY out of conversation memory. Different
-- source, different mechanism, and the presence-penalty measurement (D-245) speaks only to
-- the second: 5 of 5 at every penalty value when the member quotes her own remembered line.
--
-- So the sentence stays and stops being said five times. One statement covering all five
-- examples says exactly what five said, because the five copies never differed - they were
-- one sentence rendered against five sets of values, and the values it used were only ever
-- the axis label, which the reader can see for themselves.
--
-- ── AND WHY THE LANE CHANGES ────────────────────────────────────────────────
--
-- A `dial-axis` rule is rendered per axis BY CONSTRUCTION; there is no way to say it once
-- from inside that lane. Moving it to `dialled` at 511 puts it immediately after
-- `dials.axes` (510), which is the rule carrying the whole rendered block, so it lands
-- directly under the five examples it is about and before `dials.never-name` (520).

-- The template row goes; the sentence returns once, in the stream, reworded from "that
-- exact wording" to the five examples it now covers together.
DELETE FROM cinderella_prompt_rules WHERE id = 'dial.axis.no-reuse';

INSERT INTO cinderella_prompt_rules
  (id, tier, lane, applies_when, ord, rule_text, critical, source)
VALUES
('dials.no-reuse', 'standard', 'dialled', 'has-personality', 511,
 $r$Every calibration example above has already been sent to somebody else, so all of them are used up and you may not send one again, in whole or in part. Read them only to judge how hard to hit, then write something different in the same register, including when the message you receive is word for word the one an example answers.$r$,
 FALSE, 'src/interaction/personality.ts dialAxesBlock (was dial.axis.no-reuse, rendered once per axis)');
