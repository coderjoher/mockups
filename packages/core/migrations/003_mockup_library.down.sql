DROP INDEX IF EXISTS mockups_status_idx;
ALTER TABLE mockups DROP COLUMN IF EXISTS thumb_key;
ALTER TABLE mockups DROP COLUMN IF EXISTS orientation;
