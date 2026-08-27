-- Optional demo data. Run AFTER at least one user has signed up.
-- It attaches a few sample posts to the FIRST profile in your database
-- so the feed isn't empty while you test.

with me as (select id from public.profiles order by created_at asc limit 1)
insert into public.posts (author_id, kind, title, category, location, event_date, spots, looking_for, description, boosted)
select me.id, v.kind, v.title, v.category, v.location, v.event_date::date, v.spots, v.looking_for, v.description, v.boosted
from me,
(values
  ('event','Inha Hackathon 2026','Hackathon','Inha University, Tashkent','2026-09-20',40,'Backend devs, designers','48-hour hackathon. Teams of 4. Prizes for top 3.',true),
  ('mun','TashMUN Autumn Session','MUN','Westminster University','2026-10-05',60,'Delegates, chairs','Model UN weekend. Committees: UNSC, WHO, ECOSOC.',false),
  ('internship','Frontend Intern — Fintech','Internship','Remote / Tashkent','2026-11-01',3,'React students','3-month paid internship. Portfolio required.',false),
  ('request','Looking for a UX mentor','Mentorship','Tashkent','2026-09-30',1,'Senior designer','2nd-year student seeking a mentor for weekly design reviews.',false)
) as v(kind,title,category,location,event_date,spots,looking_for,description,boosted);
