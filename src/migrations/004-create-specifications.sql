CREATE TABLE specifications (
  specification_id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  subject TEXT NOT NULL REFERENCES subjects(subject),
  exam_board TEXT,
  level TEXT,
  active BOOLEAN DEFAULT true
);

CREATE TABLE specification_units (
  unit_id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  specification_id TEXT NOT NULL REFERENCES specifications(specification_id) ON DELETE CASCADE,
  number TEXT,
  title TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true
);

CREATE TABLE key_ideas (
  key_idea_id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id TEXT NOT NULL REFERENCES specification_units(unit_id) ON DELETE CASCADE,
  number TEXT,
  title TEXT NOT NULL,
  description TEXT,
  order_index INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true
);

CREATE TABLE sub_items (
  sub_item_id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  key_idea_id TEXT NOT NULL REFERENCES key_ideas(key_idea_id) ON DELETE CASCADE,
  number TEXT,
  title TEXT,
  order_index INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true
);

CREATE TABLE sub_item_points (
  point_id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_item_id TEXT NOT NULL REFERENCES sub_items(sub_item_id) ON DELETE CASCADE,
  label TEXT,
  content TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true
);
