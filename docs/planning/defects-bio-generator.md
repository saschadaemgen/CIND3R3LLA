# Bio generator: defect report from reading the output

Addendum to CCB-S4-006. Two hundred profiles read. The structural diagnostic passed on all of
them: 279 distinct patterns, most common at 4.6 percent, six varying mechanisms.

**The text is not usable.** Ten defect classes below, each with quoted output. Several are the
same bug the delivery reported as fixed, in its general form.

---

## 1. Interest repetition across clauses: the general case, not fixed

The delivery fixed `"languages und languages"`, a two-interest template given one interest.
The general case is different and is still present: **a bio composes one to three clauses, each
clause independently names an interest, and a profile with one interest gets it named in every
clause.**

```
ask me about synthesizers, trying to get better at synthesizers,
  i came for synthesizers and stayed for the arguments.

Here for vinyl | Trying to get better at vinyl |
  I came for vinyl and stayed for the arguments

Meine Abende gehen fast alle fuer Radfahren drauf. Ich mag Radfahren mehr
  als vernuenftig ist. Ich versuche, in Radfahren besser zu werden.

i like sailing more than is reasonable / sailing enthusiast, badly /
  i came for sailing and stayed for the arguments.

I have opinions about cooking and will share them | working on cooking

Ich baue gerade etwas rund um Synthesizer — Ueber Synthesizer rede ich jederzeit gern.

Happy to talk about photography with anyone, photography and linux.
```

And once inside a single list:

```
Slow mornings and cycling, cycling, chess, not much else
```

Nobody writes their own name for a hobby three times in one line. This is the most visible
defect in the set and it appears in roughly one bio in eight.

**The composition step needs to know that clauses draw from a shared slot pool**, so a second
clause either picks a different interest or picks a clause form that does not name one.

---

## 2. An internal value leaked into the text

```
my lurker opinions are load-bearing
```

`lurker` is our `activityTier` enum. It is an internal category and it is now in a profile
description. Whatever substitution produced that can produce the others.

---

## 3. ASCII substitution instead of umlauts

```
Ueber Sprachen rede ich jederzeit gern
meine abende gehen fast alle fuer gaertnern drauf
mehr als vernuenftig ist
zehn jahre logistik
```

`Ueber`, `fuer`, `gaertnern`, `vernuenftig`. German text uses `Ü`, `ü`, `ä`, `ö`, `ß`. The
name generator was built to handle Unicode throughout; the template set was not.

No German speaker writes this outside of a system that cannot represent the characters.

---

## 4. German capitalisation

German capitalises all nouns. The template set does not.

```
meine abende gehen fast alle fuer gaertnern drauf
zehn jahre logistik · ich arbeite im bereich druck
```

`Abende`, `Gärtnern`, `Jahre`, `Logistik`, `Bereich`, `Druck`. The lower-case habit is one of
the six variety mechanisms, and it was applied to a language where it is not a habit but an
error.

**A style mechanism authored for English was applied to German unchanged.** That is the same
class of mistake as translating the clauses literally.

---

## 5. Em-dashes are still in the separator pool

```
Ueber Sprachen rede ich jederzeit gern — Infrastruktur von Beruf.
Menace enjoyer — cycling apologist — My gremlin opinions are load-bearing.
Orbit // hiking — You will work it out
meine abende gehen fast alle fuer gaertnern drauf — wegen gaertnern hier
```

Separator variety is one of the six mechanisms and the pool contains an em-dash. Almost nobody
types one on a phone keyboard. Remove it from the pool; the other separators stay.

---

## 6. Language does not follow the name's culture

```
Sullivan Ridgeway      Irish-English name, German bio
Jagged The Steel Chaos English fantasy name, German bio
Haven Yelverton        English name, German bio
miguel ramírez castillo Spanish name, English bio
thijs jansen           Dutch name, English bio
A Bos                  Dutch name, English bio
```

Section 7 says language follows `originBlend`. The delivery reports 39.9 percent falling back
to English, which is the counted version of this. But the failure is worse than a fallback: an
Irish name writing German is not a missing language, it is the wrong one. Fallback should go to
the **name's** language where one is authored, and to English only where none is.

---

## 7. The clause pool contains things that are not self-descriptions

```
Zurzeit keine Fragen.
Hallo | Das war es
You will work it out
Ask me about things
not much to say | hello
Da | Synthesizer.
reading · hello.
echo // vinyl. i am mostly here to read.
Orbit // hiking
ops, coffee.
```

`Zurzeit keine Fragen`, `Das war es`, `You will work it out` and `Ask later` are conversational
replies, not profile text. Nobody describes themselves as "no questions at the moment".

`Da`, `echo`, `Orbit`, `ops` appear to be fragments with no meaning at all.

**A bio says who someone is.** Roughly one in six of the written bios says nothing, and not in
the way a terse real bio says little.

---

## 8. The German templates are literal translations

```
Arbeite an Wandern
Buchbinden-Verteidiger
Infrastruktur von Beruf
wegen gaertnern hier
```

`Arbeite an Wandern` is "working on hiking" translated word for word. You work on a project, not
on a hobby. `Buchbinden-Verteidiger` is "bookbinding apologist" rendered as a compound that no
German speaker would form. `Infrastruktur von Beruf` inverts the normal phrasing.
`wegen gaertnern hier` is not a sentence.

**The German set needs to be authored in German, not translated from the English set.** The two
languages need different clause forms, not the same forms with substituted words.

---

## 9. The register is inconsistent within one language

```
Menace enjoyer — cycling apologist — My gremlin opinions are load-bearing
my lurker opinions are load-bearing
professional correspondent, amateur everything
here for the astronomy threads
Hello.
```

"Menace enjoyer", "gremlin opinions", "load-bearing" is a specific and very recent online
register. It sits next to plain declaratives from a different decade. These read as several
authors, not as several personalities.

Section 5 says style decides how a bio is written. If register varied with `tone` and `humor`
this would be personality showing through. It does not appear to: the same registers turn up
across unrelated profiles.

---

## 10. Name frequency is arbitrary, and it shows

`Josephine` appears seven times in two hundred profiles. `Monika` four, `Fernando` four,
`Eleanor` three, `Sarah` three, `Daniel` three.

Collisions were required deliberately, and a Zipfian distribution is correct. But the delivery
of CCB-S4-002 already named this limitation precisely:

> With an unlabelled, alphabetically sorted list there is no popularity signal, so I can produce
> a distribution that is Zipf-shaped and passes the test, but the names that come out "common"
> would be arbitrary rather than actually common.

Seven Josephines and no Marias is what that looks like from the outside. It is not a new defect
and it is not fixable before labelled corpora exist. Recording it here so the read is complete.

---

## 11. What this means for the diagnostic

**My structural diagnostic passed everything above.** 279 patterns, most common at 4.6 percent,
six varying mechanisms, all as specified in section 6.

The measure counts **structural** variety. Every defect above is **semantic**. A pool of
meaningless clauses combined by six mechanisms produces excellent structural variety and
unreadable text.

That is the second instance in two deliveries of the same lesson, and this time it was my
measure that passed. The requirement in CCB-S4-007 that a review be a recorded step rather than
an act of conscientiousness is the right response, and it should be in place before this set is
revised rather than after.

---

## 12. On the earlier tool

The observation that the earlier PowerShell generator produced better bios is worth taking
seriously rather than dismissing.

It was simpler and had fewer mechanisms, and that is precisely why. **Variety was optimised and
coherence was not measured at all.** Six independent mechanisms multiply the number of ways a
line can be wrong, and the diagnostic that governs them counts only how many distinct shapes
appear.

The fix is not fewer mechanisms. It is that the clause pool must consist of things a person
would actually write about themselves, in the language it is written in, and that the
composition step must not let two clauses collide.

---

## 13. Priority

| | Defect | Effort |
|---|---|---|
| 1 | Interest repetition across clauses (§1) | composition logic |
| 2 | Non-self-description clauses (§7) | pool authoring |
| 3 | German authored in German (§3, §4, §8) | pool authoring |
| 4 | Language follows the name's culture (§6) | mapping |
| 5 | Internal value leak (§2) | one substitution |
| 6 | Em-dash out of the separator pool (§5) | one data change |
| 7 | Register consistency (§9) | pool authoring, tie to `tone` and `humor` |

One, five and six are small. Two, three and seven are authoring work and are the bulk of it.
Four is a mapping decision.

Nothing here is a reason to change the architecture. The mechanisms are right and the material
they combine is not yet good enough.
