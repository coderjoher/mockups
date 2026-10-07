-- Phase 5: library filters and thumbnails.
ALTER TABLE mockups ADD COLUMN orientation text NOT NULL DEFAULT 'landscape' CHECK (orientation IN ('landscape', 'portrait', 'square'));
ALTER TABLE mockups ADD COLUMN thumb_key text;
CREATE INDEX mockups_status_idx ON mockups(status, device_type, scene, tone, orientation);
