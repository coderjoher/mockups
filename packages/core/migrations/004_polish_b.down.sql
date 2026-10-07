DROP TABLE IF EXISTS favourites;
DROP TABLE IF EXISTS share_links;
DROP INDEX IF EXISTS captures_cache_idx;
ALTER TABLE captures DROP COLUMN IF EXISTS cache_key;
ALTER TABLE projects DROP COLUMN IF EXISTS brand_colors;
