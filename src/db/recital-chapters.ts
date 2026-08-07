/**
 * The recital's chapters, read and written (CCB-S4-047, D-149).
 *
 * The narrow data layer over `cinderella_recital_chapters`. Everything that decides anything
 * about a recital is in `interaction/recital.ts` and is pure; this only moves rows.
 */

import type { Queryable } from './pool.js';
import type { RecitalChapter } from '../interaction/recital.js';

interface ChapterRow {
  id: string;
  ord: number;
  title_en: string;
  title_de: string;
  rule_prefixes: string[];
  image_path: string | null;
  fallback_en: string;
  fallback_de: string;
  enabled: boolean;
}

function toChapter(row: ChapterRow): RecitalChapter {
  return {
    id: row.id,
    ord: row.ord,
    titleEn: row.title_en,
    titleDe: row.title_de,
    rulePrefixes: row.rule_prefixes,
    imagePath: row.image_path,
    fallbackEn: row.fallback_en,
    fallbackDe: row.fallback_de,
    enabled: row.enabled,
  };
}

/** Every chapter, enabled or not, in reading order. The console needs the disabled ones. */
export async function listRecitalChapters(db: Queryable): Promise<RecitalChapter[]> {
  const result = await db.query<ChapterRow>(
    `SELECT id, ord, title_en, title_de, rule_prefixes, image_path, fallback_en, fallback_de,
            enabled
       FROM cinderella_recital_chapters
      ORDER BY ord, id`,
  );
  return result.rows.map(toChapter);
}

export interface RecitalChapterEdit {
  titleEn: string;
  titleDe: string;
  rulePrefixes: string[];
  fallbackEn: string;
  fallbackDe: string;
  enabled: boolean;
}

/**
 * Saves a chapter's authored fields.
 *
 * The image is NOT here. It is set and cleared by its own calls, because an image arrives as
 * an upload rather than as a form field and a save of the text fields must not be able to
 * silently drop one.
 */
export async function updateRecitalChapter(
  db: Queryable,
  id: string,
  edit: RecitalChapterEdit,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE cinderella_recital_chapters
        SET title_en = $2, title_de = $3, rule_prefixes = $4, fallback_en = $5,
            fallback_de = $6, enabled = $7, updated_at = now()
      WHERE id = $1`,
    [
      id,
      edit.titleEn,
      edit.titleDe,
      edit.rulePrefixes,
      edit.fallbackEn,
      edit.fallbackDe,
      edit.enabled,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Points a chapter at an image, or clears it.
 *
 * `null` clears. A chapter with no image ships as text, which is a normal state and not a
 * failure: the briefing is explicit that a missing image never blocks a chapter.
 */
export async function setRecitalChapterImage(
  db: Queryable,
  id: string,
  imagePath: string | null,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE cinderella_recital_chapters
        SET image_path = $2, updated_at = now()
      WHERE id = $1`,
    [id, imagePath],
  );
  return (result.rowCount ?? 0) > 0;
}
