-- Color of the doctor's column in the schedule (null: picked by position)
alter table public.doctors add column color text;
alter table public.doctors add constraint doctors_color_check check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
