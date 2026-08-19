-- A new bot does not inherit her history (CCB-S5-045, D-230).
--
-- ── WHAT THIS CORRECTS, AND WHY THE CORRECTION IS NOT IN 031 ─────────────────
--
-- An applied migration is never edited (D-069), so 031's own header still describes the
-- world as it was and this header is the correction, the way 036 corrected 031's origin
-- default claim rather than rewriting it in place.
--
-- 031 used ONE `ADD COLUMN ... DEFAULT` statement to do TWO jobs, and said so outright:
-- backfill the one existing row, and pre-fill every row created afterwards. The backfill
-- half was correct and is spent - it ran once, on a column that was new, in a deployment
-- with a single bot whose history that prose actually is. The INSERT half was never
-- examined separately, and it is wrong.
--
-- ── THE FAILURE, WHICH IS AN IDENTITY FAILURE RATHER THAN A COSMETIC ONE ─────
--
-- Every bot created since arrives carrying prose that names Cinderella and Sascha Dämgen,
-- and is then told by `origin.preamble` (constitutional, critical) that it "is true, it is
-- yours, and it was given to you by the people who made you", and by `origin.do-not-extend`
-- that it is "the whole of what you have been told about your own past".
--
-- It does not recite it, which is what makes this quiet: `origin.answer-fresh` tells it to
-- answer "in two or three sentences of your own, worded fresh every time". So a second bot
-- asked who it is will tell a member, in its own voice and with complete confidence, that it
-- is Cinderella. No guard in this tree can see that, because every rule involved is doing
-- exactly what it was written to do.
--
-- ── THIS IS THE THIRD TIME THIS SHAPE HAS BEEN DECIDED, IN THIS TABLE ────────
--
-- The two neighbouring per-bot identity fields already went the other way. D-161 gave each
-- bot its own avatar and settled that "NULL is an answer rather than a gap", with no special
-- primary case. CCB-S5-009 gave each bot its own retorts, and `verify:new-bot-identity`
-- asserts that not one of a new bot's retorts is hers. `origin` is the same field with the
-- same argument and it was simply never asked, because the default arrived attached to a
-- backfill that needed doing.
--
-- ── WHAT THIS DOES NOT DO, STATED SO NOBODY EXPECTS IT ───────────────────────
--
-- It reaches NO EXISTING ROW. A column default applies to an insert and never to an update,
-- which is 031's own sentence and is still true here. Both of the operator's bots keep the
-- origins they hold today; blanking one is one edit on the Personality page and is his call.
-- An UPDATE keyed on the shipped text (the 036 pattern) was considered and REJECTED: it would
-- also blank the PRIMARY, the one bot the prose is actually true of, which is a silent
-- identity loss in the opposite direction and worse than the one being fixed.
--
-- It also does NOT close the inheritance question. `nicknames.words` still hands a new bot
-- ['cindy','cindi','cin','ella'] at creation, so a bot with no origin still answers to her pet
-- forms. That is the same shape and it is deliberately NOT fixed here, because fixing one and
-- reporting "inheritance is dealt with" would be false. It is on the backlog as its own item.
--
-- ── NO CODE CHANGE IS NEEDED FOR THE PROMPT TO COPE ──────────────────────────
--
-- `has-no-origin` is a fully seeded branch: a bot with no origin renders its prompt with no
-- throw, drops the seven `origin.*` rules, and takes the `without-origin` variants of the two
-- fences. That is a supported configuration today and `verify:prompt-identity` already pins it
-- as case `conversation.no-origin`.

ALTER TABLE cinderella_bot_profiles
  ALTER COLUMN origin DROP DEFAULT;

COMMENT ON COLUMN cinderella_bot_profiles.origin IS
  'What she is and where she came from, per bot (CCB-S4-034). NULL means this bot has no '
  'history to draw on and the prompt says nothing about its past. NOT defaulted: a new bot '
  'arrives with none rather than with another bot''s (CCB-S5-045, D-230). '
  'See originLines() in src/interaction/personality.ts.';
