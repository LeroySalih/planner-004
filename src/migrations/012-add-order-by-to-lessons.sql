ALTER TABLE lessons ADD COLUMN order_by integer not null default 0;

UPDATE lessons SET order_by = 0;