ALTER TABLE curricula ADD active boolean default true;

update curricula set active=true;