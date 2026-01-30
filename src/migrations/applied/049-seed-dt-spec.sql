DO $$
DECLARE
  v_spec_id TEXT;
  v_unit_id TEXT;
  v_key_idea_id TEXT;
  v_sub_item_id TEXT;
BEGIN

  -- Ensure Subject Exists: Design and Technology
  INSERT INTO subjects (subject) VALUES ('Design and Technology') ON CONFLICT (subject) DO NOTHING;

  -- Specification: Pearson Edexcel Level 1/Level 2 GCSE (9-1) in Design and Technology
  SELECT specification_id INTO v_spec_id FROM specifications WHERE title = 'Pearson Edexcel Level 1/Level 2 GCSE (9-1) in Design and Technology' AND subject = 'Design and Technology';
  IF v_spec_id IS NULL THEN
    INSERT INTO specifications (title, subject, exam_board, level) VALUES ('Pearson Edexcel Level 1/Level 2 GCSE (9-1) in Design and Technology', 'Design and Technology', 'Pearson Edexcel', 'GCSE (9-1)') RETURNING specification_id INTO v_spec_id;
  ELSE
    UPDATE specifications SET exam_board = 'Pearson Edexcel', level = 'GCSE (9-1)' WHERE specification_id = v_spec_id;
  END IF;

  -- Unit: 1 - Core content
  SELECT unit_id INTO v_unit_id FROM specification_units WHERE specification_id = v_spec_id AND number = '1';
  IF v_unit_id IS NULL THEN
    INSERT INTO specification_units (specification_id, number, title, order_index) VALUES (v_spec_id, '1', 'Core content', 0) RETURNING unit_id INTO v_unit_id;
  ELSE
    UPDATE specification_units SET title = 'Core content', order_index = 0 WHERE unit_id = v_unit_id;
  END IF;

    -- Key Idea: 1.1
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.1';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.1', 'The impact of new and emerging technologies', 'To apply a breadth of technical knowledge and understanding of the characteristics, advantages and disadvantages of the following in relation to new and emerging technologies.', 0) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'The impact of new and emerging technologies', description = 'To apply a breadth of technical knowledge and understanding of the characteristics, advantages and disadvantages of the following in relation to new and emerging technologies.', order_index = 0 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.1.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.1.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.1.1', 'Industry', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Industry', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'unemployment', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'workforce skill set', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'demographic movement', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'science and technology parks', 3);

      -- Sub Item: 1.1.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.1.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.1.2', 'Enterprise', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Enterprise', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'privately-owned business', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'crowd funding', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'government funding for new business start-ups', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'not-for-profit organisations', 3);

      -- Sub Item: 1.1.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.1.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.1.3', 'Sustainability', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Sustainability', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'transportation costs', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'pollution', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'demand on natural resources', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'waste generated', 3);

      -- Sub Item: 1.1.4
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.1.4';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.1.4', 'People', 3) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'People', order_index = 3 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'workforce', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'consumers', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'children', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'people with disabilities', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'wage levels', 4);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'f', 'highly-skilled workforce', 5);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'g', 'apprenticeships', 6);

      -- Sub Item: 1.1.5
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.1.5';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.1.5', 'Culture', 4) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Culture', order_index = 4 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'population movement within the EU', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'social segregation/clustering within ethnic minorities', 1);

      -- Sub Item: 1.1.6
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.1.6';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.1.6', 'Society', 5) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Society', order_index = 5 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'changes in working hours and shift patterns', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'Internet of Things (IoT)', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'remote working', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'use of video conference meetings', 3);

      -- Sub Item: 1.1.7
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.1.7';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.1.7', 'Environment', 6) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Environment', order_index = 6 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'pollution', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'waste disposal', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'materials separation', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'transportation of goods around the world', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'packaging of goods', 4);

      -- Sub Item: 1.1.8
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.1.8';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.1.8', 'Production techniques and systems', 7) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Production techniques and systems', order_index = 7 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'standardised design and components', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'just-in-time (JIT)', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'lean manufacturing', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'batch', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'continuous', 4);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'f', 'one off', 5);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'g', 'mass', 6);

    -- Key Idea: 1.2
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.2';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.2', 'How the critical evaluation of new and emerging technologies informs design decisions; considering contemporary and potential future scenarios from different perspectives, such as ethics and the environment', 'To recognise the importance of the evaluative process and respective criteria when considering the impact of new and emerging technologies to a range of scenarios.', 1) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'How the critical evaluation of new and emerging technologies informs design decisions; considering contemporary and potential future scenarios from different perspectives, such as ethics and the environment', description = 'To recognise the importance of the evaluative process and respective criteria when considering the impact of new and emerging technologies to a range of scenarios.', order_index = 1 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.2.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.2.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.2.1', 'How to critically evaluate new and emerging technologies that inform design decisions', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'How to critically evaluate new and emerging technologies that inform design decisions', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'budget constraints', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'timescale', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'who the product is for', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'the materials used', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'manufacturing capabilities', 4);

      -- Sub Item: 1.2.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.2.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.2.2', 'How critical evaluations can be used to inform design decisions, including the consideration of contemporary and potential future scenarios', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'How critical evaluations can be used to inform design decisions, including the consideration of contemporary and potential future scenarios', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'natural disasters', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'medical advances', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'travel', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'global warming', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'communication', 4);

      -- Sub Item: 1.2.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.2.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.2.3', 'Ethical perspectives when evaluating new and emerging technologies', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Ethical perspectives when evaluating new and emerging technologies', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'where it was made', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'who was it made by', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'who will it benefit', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'fair trade products', 3);

      -- Sub Item: 1.2.4
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.2.4';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.2.4', 'Environmental perspectives when evaluating new and emerging technologies', 3) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Environmental perspectives when evaluating new and emerging technologies', order_index = 3 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'use of materials', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'carbon footprint', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'energy usage and consumption during manufacture and transportation', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'life cycle analysis (LCA)', 3);

    -- Key Idea: 1.3
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.3';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.3', 'How energy is generated and stored in order to choose and use appropriate sources to make products and power systems', 'The processes, applications, characteristics, advantages and disadvantages of the following, in order to be able to discriminate between them and to select appropriately.', 2) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'How energy is generated and stored in order to choose and use appropriate sources to make products and power systems', description = 'The processes, applications, characteristics, advantages and disadvantages of the following, in order to be able to discriminate between them and to select appropriately.', order_index = 2 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.3.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.3.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.3.1', 'Sources, generation and storage of energy', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Sources, generation and storage of energy', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'fossil fuels - oil, gas, coal', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'biodiesel and biomass', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'biofuels', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'tidal', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'wind', 4);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'f', 'solar', 5);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'g', 'hydroelectric', 6);

      -- Sub Item: 1.3.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.3.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.3.2', 'Powering systems', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Powering systems', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'batteries and cells', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'solar cells', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'mains electricity', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'wind power', 3);

      -- Sub Item: 1.3.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.3.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.3.3', 'Factors to consider when choosing appropriate energy sources to make products and power systems', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Factors to consider when choosing appropriate energy sources to make products and power systems', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'portability of the power source', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'environmental impact', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'power output', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'circuit/system connections', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'cost', 4);

    -- Key Idea: 1.4
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.4';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.4', 'Developments in modern and smart materials, composite materials and technical textiles', 'To apply technical knowledge and understanding of the characteristics, applications, advantages and disadvantages of the following.', 3) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'Developments in modern and smart materials, composite materials and technical textiles', description = 'To apply technical knowledge and understanding of the characteristics, applications, advantages and disadvantages of the following.', order_index = 3 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.4.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.4.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.4.1', 'Modern and smart materials', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Modern and smart materials', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'shape-memory alloys (SMAs)', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'nanomaterials', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'reactive glass', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'piezoelectric materials', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'temperature-responsive polymers', 4);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'f', 'conductive inks', 5);

      -- Sub Item: 1.4.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.4.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.4.2', 'Composites', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Composites', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'concrete', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'plywood', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'fibre/carbon/glass', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'reinforced polymers', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'robotic materials', 4);

      -- Sub Item: 1.4.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.4.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.4.3', 'Technical textiles', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Technical textiles', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'agro-textiles', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'construction textiles', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'geo-textiles', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'domestic textiles', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'environmentally friendly textiles', 4);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'f', 'protective textiles', 5);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'g', 'sports textiles', 6);

    -- Key Idea: 1.5
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.5';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.5', 'The functions of mechanical devices used to produce different sorts of movements, including the changing of magnitude and the direction of forces', 'The performance, principles, applications and the influence on the design of products of the following.', 4) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'The functions of mechanical devices used to produce different sorts of movements, including the changing of magnitude and the direction of forces', description = 'The performance, principles, applications and the influence on the design of products of the following.', order_index = 4 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.5.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.5.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.5.1', 'Types of movement', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Types of movement', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'linear', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'reciprocation', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'rotary', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'oscillation', 3);

      -- Sub Item: 1.5.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.5.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.5.2', 'Classification of levers', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Classification of levers', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'class 1, 2 and 3', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'calculations related to mechanical advantage (MA), velocity ratio (VR), load, effort and efficiency', 1);

      -- Sub Item: 1.5.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.5.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.5.3', 'Linkages', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Linkages', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'bell crank', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'reverse motion linkages', 1);

      -- Sub Item: 1.5.4
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.5.4';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.5.4', 'Cams', 3) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Cams', order_index = 3 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'pear shaped', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'eccentric (circular)', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'drop (snail)', 2);

      -- Sub Item: 1.5.5
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.5.5';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.5.5', 'Followers', 4) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Followers', order_index = 4 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'roller', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'knife', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'flat followers', 2);

      -- Sub Item: 1.5.6
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.5.6';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.5.6', 'Pulleys and belts', 5) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Pulleys and belts', order_index = 5 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'V-belt', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'velocity ratio (VR)', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'input and output speeds', 2);

      -- Sub Item: 1.5.7
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.5.7';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.5.7', 'Cranks and sliders', 6) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Cranks and sliders', order_index = 6 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

      -- Sub Item: 1.5.8
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.5.8';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.5.8', 'Gear types', 7) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Gear types', order_index = 7 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'simple and compound gear train', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'idler gear', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'revolutions per minute (RPM) calculations', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'bevel gears', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'rack and pinion', 4);

    -- Key Idea: 1.6
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.6';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.6', 'How electronic systems provide functionality to products and processes, including sensors and control devices to respond to a variety of inputs, and devices to produce a range of outputs', 'Recognise and apply knowledge and understanding of the working characteristics, applications, advantages and disadvantages of the following.', 5) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'How electronic systems provide functionality to products and processes, including sensors and control devices to respond to a variety of inputs, and devices to produce a range of outputs', description = 'Recognise and apply knowledge and understanding of the working characteristics, applications, advantages and disadvantages of the following.', order_index = 5 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.6.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.6.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.6.1', 'Sensors', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Sensors', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'the role of sensors in electronic systems', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'light-dependent resistors (LDRs)', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'thermistor', 2);

      -- Sub Item: 1.6.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.6.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.6.2', 'Control devices and components', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Control devices and components', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'the role of switches in electronic systems', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'transistors', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'resistors', 2);

      -- Sub Item: 1.6.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.6.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.6.3', 'Outputs', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Outputs', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'the role of outputs in electronic systems', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'buzzers', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'light-emitting diodes (LEDs)', 2);

    -- Key Idea: 1.7
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.7';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.7', 'The use of programmable components to embed functionality into products in order to enhance and customise their operation', 'The performance and functionality of using programmable components.', 6) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'The use of programmable components to embed functionality into products in order to enhance and customise their operation', description = 'The performance and functionality of using programmable components.', order_index = 6 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.7.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.7.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.7.1', 'How to make use of flowcharts', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'How to make use of flowcharts', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

      -- Sub Item: 1.7.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.7.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.7.2', 'How to switch outputs on/off in relation to inputs and decisions', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'How to switch outputs on/off in relation to inputs and decisions', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

      -- Sub Item: 1.7.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.7.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.7.3', 'How to process and respond to analogue inputs', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'How to process and respond to analogue inputs', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

      -- Sub Item: 1.7.4
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.7.4';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.7.4', 'How to use simple routines to control outputs with delays, loops and counts', 3) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'How to use simple routines to control outputs with delays, loops and counts', order_index = 3 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

    -- Key Idea: 1.8
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.8';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.8', 'The categorisation of the types, properties and structure of ferrous and non-ferrous metals', 'To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.', 7) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'The categorisation of the types, properties and structure of ferrous and non-ferrous metals', description = 'To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.', order_index = 7 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.8.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.8.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.8.1', 'Ferrous metals', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Ferrous metals', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'mild steel', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'stainless steel', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'cast iron', 2);

      -- Sub Item: 1.8.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.8.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.8.2', 'Non-ferrous metals', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Non-ferrous metals', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'aluminium', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'copper', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'brass', 2);

      -- Sub Item: 1.8.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.8.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.8.3', 'Properties', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Properties', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'ductility', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'malleability', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'hardness', 2);

    -- Key Idea: 1.9
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.9';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.9', 'The categorisation of the types, properties and structure of papers and boards', 'To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.', 8) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'The categorisation of the types, properties and structure of papers and boards', description = 'To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.', order_index = 8 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.9.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.9.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.9.1', 'Paper', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Paper', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'copier paper', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'cartridge paper', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'tracing paper', 2);

      -- Sub Item: 1.9.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.9.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.9.2', 'Board', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Board', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'folding boxboard', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'corrugated board', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'solid white board', 2);

      -- Sub Item: 1.9.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.9.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.9.3', 'Properties', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Properties', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'flexibility', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'printability', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'biodegradability', 2);

    -- Key Idea: 1.10
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.10';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.10', 'The categorisation of the types, properties and structure of thermoforming and thermosetting polymers', 'To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.', 9) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'The categorisation of the types, properties and structure of thermoforming and thermosetting polymers', description = 'To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.', order_index = 9 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.10.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.10.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.10.1', 'Thermoforming polymers', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Thermoforming polymers', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'acrylic', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'high impact polystyrene (HIPS)', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'biodegradable polymers - Biopol®', 2);

      -- Sub Item: 1.10.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.10.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.10.2', 'Thermosetting polymers', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Thermosetting polymers', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'polyester resin', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'urea formaldehyde', 1);

      -- Sub Item: 1.10.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.10.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.10.3', 'Properties', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Properties', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'insulator of heat', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'insulator of electricity', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'toughness', 2);

    -- Key Idea: 1.11
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.11';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.11', 'The categorisation of the types, properties and structure of natural, synthetic, blended and mixed fibres, and woven, non-woven and knitted textiles', 'To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.', 10) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'The categorisation of the types, properties and structure of natural, synthetic, blended and mixed fibres, and woven, non-woven and knitted textiles', description = 'To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.', order_index = 10 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.11.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.11.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.11.1', 'Natural', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Natural', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'animal - wool', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'vegetable - cotton', 1);

      -- Sub Item: 1.11.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.11.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.11.2', 'Synthetic', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Synthetic', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'polyester', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'acrylic', 1);

      -- Sub Item: 1.11.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.11.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.11.3', 'Woven', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Woven', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'plain - calico', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'twill - denim', 1);

      -- Sub Item: 1.11.4
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.11.4';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.11.4', 'Non-woven', 3) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Non-woven', order_index = 3 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'felted wool fabric', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'bonded fibres/webs', 1);

      -- Sub Item: 1.11.5
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.11.5';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.11.5', 'Knitted', 4) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Knitted', order_index = 4 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'weft-knitted fabrics', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'warp-knitted fabrics', 1);

      -- Sub Item: 1.11.6
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.11.6';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.11.6', 'Properties', 5) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Properties', order_index = 5 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'elasticity', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'resilience', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'durability', 2);

    -- Key Idea: 1.12
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.12';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.12', 'The categorisation of the types, properties and structure of natural and manufactured timbers', 'To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.', 11) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'The categorisation of the types, properties and structure of natural and manufactured timbers', description = 'To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.', order_index = 11 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.12.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.12.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.12.1', 'Natural timbers - hardwoods', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Natural timbers - hardwoods', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'oak', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'mahogany', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'beech', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'balsa', 3);

      -- Sub Item: 1.12.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.12.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.12.2', 'Natural timbers - softwoods', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Natural timbers - softwoods', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'pine', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'cedar', 1);

      -- Sub Item: 1.12.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.12.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.12.3', 'Manufactured timbers', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Manufactured timbers', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'plywood', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'medium density fibreboard (MDF)', 1);

      -- Sub Item: 1.12.4
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.12.4';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.12.4', 'Properties', 3) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Properties', order_index = 3 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'hardness', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'toughness', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'durability', 2);

    -- Key Idea: 1.13
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.13';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.13', 'All design and technological practice takes place within contexts which inform outcomes', 'Performance characteristics of a wide range of materials, components and manufacturing processes, in order to be able to discriminate between them and select appropriately.', 12) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'All design and technological practice takes place within contexts which inform outcomes', description = 'Performance characteristics of a wide range of materials, components and manufacturing processes, in order to be able to discriminate between them and select appropriately.', order_index = 12 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.13.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.13.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.13.1', 'A wide range of materials, components and manufacturing processes for a range of contexts, to inform outcomes', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'A wide range of materials, components and manufacturing processes for a range of contexts, to inform outcomes', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'the properties of materials and or components', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'the advantages and disadvantages of materials and components and manufacturing processes', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'justification of the choice of materials and components and manufacturing processes', 2);

    -- Key Idea: 1.14
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.14';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.14', 'Investigate environmental, social and economic challenges when identifying opportunities and constraints that influence the processes of designing and making', 'Implications for designers and manufacturers of the following when developing designs and manufacturing products.', 13) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'Investigate environmental, social and economic challenges when identifying opportunities and constraints that influence the processes of designing and making', description = 'Implications for designers and manufacturers of the following when developing designs and manufacturing products.', order_index = 13 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.14.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.14.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.14.1', 'Respect for different social, ethnic and economic groups who have different needs and values when identifying new design opportunities', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Respect for different social, ethnic and economic groups who have different needs and values when identifying new design opportunities', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

      -- Sub Item: 1.14.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.14.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.14.2', 'An appreciation of the environmental, social and economic issues relating to the design and manufacture of products, including, fair trade, carbon offsetting, product disassembly and disposal', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'An appreciation of the environmental, social and economic issues relating to the design and manufacture of products, including, fair trade, carbon offsetting, product disassembly and disposal', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

      -- Sub Item: 1.14.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.14.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.14.3', 'The main factors relating to ''Green Designs''', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'The main factors relating to ''Green Designs''', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

      -- Sub Item: 1.14.4
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.14.4';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.14.4', 'The main factors relating to recycling and reusing materials or products', 3) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'The main factors relating to recycling and reusing materials or products', order_index = 3 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

      -- Sub Item: 1.14.5
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.14.5';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.14.5', 'Human capability', 4) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Human capability', order_index = 4 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

      -- Sub Item: 1.14.6
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.14.6';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.14.6', 'Cost of materials', 5) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Cost of materials', order_index = 5 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

      -- Sub Item: 1.14.7
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.14.7';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.14.7', 'Manufacturing capability', 6) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Manufacturing capability', order_index = 6 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

      -- Sub Item: 1.14.8
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.14.8';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.14.8', 'Environmental impact - life cycle analysis (LCA)', 7) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Environmental impact - life cycle analysis (LCA)', order_index = 7 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

    -- Key Idea: 1.15
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.15';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.15', 'Investigate and analyse the work of past and present professionals and companies in order to inform design', 'Strategies, techniques and approaches employed when investigating and analysing the work of others.', 14) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'Investigate and analyse the work of past and present professionals and companies in order to inform design', description = 'Strategies, techniques and approaches employed when investigating and analysing the work of others.', order_index = 14 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.15.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.15.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.15.1', 'Analysing a product to the following specification criteria', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Analysing a product to the following specification criteria', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'form', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'function', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'client and user requirements', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'performance requirements', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'materials and components/systems', 4);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'f', 'scale of production and cost', 5);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'g', 'sustainability', 6);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'h', 'aesthetics', 7);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'i', 'marketability', 8);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'j', 'consideration of innovation', 9);

      -- Sub Item: 1.15.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.15.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.15.2', 'The work of past and present designers and companies', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'The work of past and present designers and companies', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, '', 'Centres should choose a selection of designers for study. Suggestions for designers and companies for study can be found on the Pearson Edexcel website.', 0);

    -- Key Idea: 1.16
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.16';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.16', 'Use different design strategies to generate initial ideas and avoid design fixation', 'Strategies, techniques and approaches employed when generating design ideas.', 15) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'Use different design strategies to generate initial ideas and avoid design fixation', description = 'Strategies, techniques and approaches employed when generating design ideas.', order_index = 15 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.16.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.16.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.16.1', 'Use of different design strategies', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Use of different design strategies', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'collaboration', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'user-centred design', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'systems thinking', 2);

    -- Key Idea: 1.17
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '1.17';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '1.17', 'Develop, communicate, record and justify design ideas, applying suitable techniques', 'Techniques employed when communicating and recording design ideas.', 16) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'Develop, communicate, record and justify design ideas, applying suitable techniques', description = 'Techniques employed when communicating and recording design ideas.', order_index = 16 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 1.17.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.17.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.17.1', 'Develop and use a range of communication techniques and media to present the design ideas', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Develop and use a range of communication techniques and media to present the design ideas', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'freehand sketching (2D and/or 3D)', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'annotated sketches', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'cut and paste techniques', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'digital photography/media', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', '3D models', 4);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'f', 'isometric and oblique projection', 5);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'g', 'perspective drawing', 6);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'h', 'orthographic and exploded views', 7);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'i', 'assembly drawings', 8);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'j', 'system and schematic diagrams', 9);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'k', 'computer-aided design (CAD) and other specialist computer drawing programs', 10);

      -- Sub Item: 1.17.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '1.17.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '1.17.2', 'Record and justify design ideas clearly and effectively using written techniques', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Record and justify design ideas clearly and effectively using written techniques', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

  -- Unit: 5 - Systems
  SELECT unit_id INTO v_unit_id FROM specification_units WHERE specification_id = v_spec_id AND number = '5';
  IF v_unit_id IS NULL THEN
    INSERT INTO specification_units (specification_id, number, title, order_index) VALUES (v_spec_id, '5', 'Systems', 1) RETURNING unit_id INTO v_unit_id;
  ELSE
    UPDATE specification_units SET title = 'Systems', order_index = 1 WHERE unit_id = v_unit_id;
  END IF;

    -- Key Idea: 5.1
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '5.1';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '5.1', 'Design contexts', NULL, 0) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'Design contexts', description = NULL, order_index = 0 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 5.1.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.1.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.1.1', 'When designing or modifying a product, students should be able to apply their knowledge and understanding of materials, components and manufacturing processes.', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'When designing or modifying a product, students should be able to apply their knowledge and understanding of materials, components and manufacturing processes.', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;

    -- Key Idea: 5.2
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '5.2';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '5.2', 'The sources, origins, physical and working properties of components and systems and their social and ecological footprint', 'To apply knowledge and understanding of the advantages, disadvantages and applications of the following components, in order to be able to discriminate between them and select appropriately.', 1) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'The sources, origins, physical and working properties of components and systems and their social and ecological footprint', description = 'To apply knowledge and understanding of the advantages, disadvantages and applications of the following components, in order to be able to discriminate between them and select appropriately.', order_index = 1 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 5.2.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.2.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.2.1', 'Sensors', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Sensors', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'light-dependent resistors (LDRs) (in topic 1)', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'thermistor (in topic 1)', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'moisture sensor', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'piezoelectric sensor', 3);

      -- Sub Item: 5.2.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.2.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.2.2', 'Control devices and components', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Control devices and components', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'rocker switch (on/off) (in topic 1)', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'resistors (in topic 1)', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'push to make switch (PTM)', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'micro switch', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'reed switch', 4);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'f', 'variable resistors', 5);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'g', 'transistor (bipolar)', 6);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'h', 'microprocessor', 7);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'i', 'microcontroller/PIC', 8);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'j', 'relay', 9);

      -- Sub Item: 5.2.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.2.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.2.3', 'Outputs', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Outputs', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'buzzers (in topic 1)', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'light-emitting diodes (LEDs) (in topic 1)', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'loudspeakers', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'motors', 3);

      -- Sub Item: 5.2.4
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.2.4';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.2.4', 'Sources and origins - where components and systems are resourced/manufactured and their geographical origin', 3) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Sources and origins - where components and systems are resourced/manufactured and their geographical origin', order_index = 3 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'Russia, Saudi Arabia, United States: polymers from crude oil - acrylic, high impact polystyrene (HIPS), acrylonitrile butadiene styrene (ABS)', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'China, Russia, USA - silicon', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'China, Australia, Russia - gold', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'Chile, China, Peru - copper', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'Australia, Chile, Argentina - lithium', 4);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'f', 'China, Russia, Canada - aluminium', 5);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'g', 'China, Australia, USA - Rare Earth Elements (REEs)', 6);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'h', 'Philippines, Indonesia, Russia, Canada and Australia - nickel', 7);

      -- Sub Item: 5.2.5
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.2.5';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.2.5', 'The physical characteristics of each component and system', 4) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'The physical characteristics of each component and system', order_index = 4 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'tolerances, ratings and values - resistor colour codes', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'material selection for case construction - physical/working properties, sustainability, manufacturing processes', 1);

      -- Sub Item: 5.2.6
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.2.6';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.2.6', 'Working properties - the way in which each material behaves or responds to external sources', 5) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Working properties - the way in which each material behaves or responds to external sources', order_index = 5 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'conductors, insulators - thermal, electrical', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'polymers used for cases - durability, hardness, toughness, elasticity', 1);

      -- Sub Item: 5.2.7
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.2.7';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.2.7', 'Social footprint', 6) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Social footprint', order_index = 6 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'relying on scarce and/or hazardous elements used in components and systems - cobalt, tantalum, lithium', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'effects of using components and systems, including modern communications - mobile phones, computers, games consoles, social media networks', 1);

      -- Sub Item: 5.2.8
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.2.8';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.2.8', 'Ecological footprint', 7) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Ecological footprint', order_index = 7 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'effects of material extraction and processing of elements', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'effects of built-in obsolescence', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'effects of use', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'the effects of disposal of components and systems - toxicity of metals and polymers', 3);

    -- Key Idea: 5.3
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '5.3';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '5.3', 'The way in which the selection of components and systems is influenced', 'The influence of the following factors when selecting materials/components for a specific application.', 2) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'The way in which the selection of components and systems is influenced', description = 'The influence of the following factors when selecting materials/components for a specific application.', order_index = 2 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 5.3.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.3.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.3.1', 'Aesthetic factors - the selection of materials and finishes for enclosures and cases', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Aesthetic factors - the selection of materials and finishes for enclosures and cases', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'form', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'colour', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'texture', 2);

      -- Sub Item: 5.3.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.3.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.3.2', 'Environmental factors', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Environmental factors', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'the principles of the Restriction of Hazardous Substances (RoHS) Directive for selection', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'the principles of the Waste Electrical and Electronic Equipment (WEEE) Directive for disposal', 1);

      -- Sub Item: 5.3.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.3.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.3.3', 'Availability factors', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Availability factors', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'use of stock materials', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'use of specialist materials', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'use of scarce elements', 2);

      -- Sub Item: 5.3.4
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.3.4';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.3.4', 'Cost factors', 3) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Cost factors', order_index = 3 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'quality of component - tolerances', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'manufacturing processes necessary', 1);

      -- Sub Item: 5.3.5
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.3.5';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.3.5', 'Social factors', 4) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Social factors', order_index = 4 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'use for different social groups', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'trends/fashion', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'popularity', 2);

      -- Sub Item: 5.3.6
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.3.6';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.3.6', 'Cultural and ethical factors', 5) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Cultural and ethical factors', order_index = 5 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'avoiding offence', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'suitability for intended market', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'use of colour and language', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'the consumer society', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'the effects of mass production', 4);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'f', 'built-in product obsolescence', 5);

    -- Key Idea: 5.4
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '5.4';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '5.4', 'The impact of forces and stresses on objects and how they can be reinforced and stiffened', 'An awareness of the influence of forces and stresses that act on materials and the methods that can be employed to resist them.', 3) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'The impact of forces and stresses on objects and how they can be reinforced and stiffened', description = 'An awareness of the influence of forces and stresses that act on materials and the methods that can be employed to resist them.', order_index = 3 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 5.4.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.4.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.4.1', 'Forces and stresses', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Forces and stresses', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'tension', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'compression', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'torsion', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'shear', 3);

      -- Sub Item: 5.4.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.4.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.4.2', 'Reinforcement/stiffening techniques', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Reinforcement/stiffening techniques', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'using composite materials', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'ribbing to strengthen case structures', 1);

    -- Key Idea: 5.5
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '5.5';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '5.5', 'Stock forms, types and sizes in order to calculate and determine the quantity of components required', 'To apply knowledge and understanding of the advantages, disadvantages and applications of the following stock forms/sizes, in order to be able to discriminate between them and select and apply appropriately.', 4) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'Stock forms, types and sizes in order to calculate and determine the quantity of components required', description = 'To apply knowledge and understanding of the advantages, disadvantages and applications of the following stock forms/sizes, in order to be able to discriminate between them and select and apply appropriately.', order_index = 4 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 5.5.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.5.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.5.1', 'Stock forms/types', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Stock forms/types', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'tolerances, ratings and values such as E12 series resistors', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'surface-mount technology (SMT)', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'through-hole components', 2);

      -- Sub Item: 5.5.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.5.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.5.2', 'Sizes', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Sizes', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'unit of current (amp)', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'unit of resistance (ohm)', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'unit of potential difference (volt)', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'applications of Ohm''s Law: V = I x R', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'resistors in series: R_total = R1 + R2 + R3 etc.', 4);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'f', 'resistors in parallel: 1/R_total = 1/R1 + 1/R2 + 1/R3 etc.', 5);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'g', 'area', 6);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'h', 'diameter', 7);

    -- Key Idea: 5.6
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '5.6';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '5.6', 'Alternative processes that can be used to manufacture components and systems to different scales of production', 'Application, advantages and disadvantages, of the following processes, scales of production and techniques when manufacturing products, in order to be able to discriminate between them and select appropriately for use.', 5) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'Alternative processes that can be used to manufacture components and systems to different scales of production', description = 'Application, advantages and disadvantages, of the following processes, scales of production and techniques when manufacturing products, in order to be able to discriminate between them and select appropriately for use.', order_index = 5 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 5.6.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.6.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.6.1', 'Processes', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Processes', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'photo etching', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'PCB population', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'PCB drilling and soldering', 2);

      -- Sub Item: 5.6.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.6.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.6.2', 'Scales of production', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Scales of production', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'one-off prototyping (breadboard)', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'batch', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'mass production', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'continuous', 3);

      -- Sub Item: 5.6.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.6.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.6.3', 'Techniques for quantity production', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Techniques for quantity production', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'pick and place technology', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'surface-mount technology (SMT)', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'quality control', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'marking-out methods (use of reference points, lines and surfaces)', 3);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'e', 'templates', 4);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'f', 'patterns', 5);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'g', 'sub-assembly', 6);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'h', 'working within tolerance', 7);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'i', 'efficient cutting to minimise waste', 8);

    -- Key Idea: 5.7
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '5.7';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '5.7', 'Specialist techniques, tools, equipment and processes that can be used to shape, fabricate, construct and assemble a high-quality systems prototype', 'Application, advantages and disadvantages, of the following specialist techniques when manufacturing products, in order to be able to discriminate between them and select appropriately for use.', 6) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'Specialist techniques, tools, equipment and processes that can be used to shape, fabricate, construct and assemble a high-quality systems prototype', description = 'Application, advantages and disadvantages, of the following specialist techniques when manufacturing products, in order to be able to discriminate between them and select appropriately for use.', order_index = 6 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 5.7.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.7.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.7.1', 'Tools and equipment', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Tools and equipment', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'hand tools', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'machinery', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'digital design and manufacture', 2);

      -- Sub Item: 5.7.2
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.7.2';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.7.2', 'Shaping', 1) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Shaping', order_index = 1 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'vacuum forming', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'CNC laser cutting', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', '3D printing', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'drilling', 3);

      -- Sub Item: 5.7.3
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.7.3';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.7.3', 'Fabricating/constructing/assembling', 2) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Fabricating/constructing/assembling', order_index = 2 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'PCB mounting methods - through hole, surface mount', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'cable management - sleeving, ties', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'wastage', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'addition', 3);

    -- Key Idea: 5.8
    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = '5.8';
    IF v_key_idea_id IS NULL THEN
      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, '5.8', 'Appropriate surface treatments and finishes that can be applied to components and systems for functional and aesthetic purposes', 'Application, advantages and disadvantages of the following finishing techniques and methods of preservation, in order to be able to discriminate between them and select appropriately for use.', 7) RETURNING key_idea_id INTO v_key_idea_id;
    ELSE
      UPDATE key_ideas SET title = 'Appropriate surface treatments and finishes that can be applied to components and systems for functional and aesthetic purposes', description = 'Application, advantages and disadvantages of the following finishing techniques and methods of preservation, in order to be able to discriminate between them and select appropriately for use.', order_index = 7 WHERE key_idea_id = v_key_idea_id;
    END IF;

      -- Sub Item: 5.8.1
      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = '5.8.1';
      IF v_sub_item_id IS NULL THEN
        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, '5.8.1', 'Surface finishes and treatments', 0) RETURNING sub_item_id INTO v_sub_item_id;
      ELSE
        UPDATE sub_items SET title = 'Surface finishes and treatments', order_index = 0 WHERE sub_item_id = v_sub_item_id;
      END IF;

      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'a', 'metal plating to enhance the functionality and performance of electronic connections', 0);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'b', 'insulating coatings and coverings for functionality/safety', 1);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'c', 'resistor colour code bands to identify values and tolerance', 2);
      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, 'd', 'finishes applied to cases - anodising, painting, screen printing', 3);

END $$;

