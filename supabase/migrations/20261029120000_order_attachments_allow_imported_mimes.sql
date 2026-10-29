-- Allow imported RoApp office/HEIC attachments in order-attachments storage.
-- Historical imports reference .doc/.docx/.xlsx/.heic/.zip that the original
-- photo/pdf allow-list rejected; keep size cap, drop MIME restriction.
update storage.buckets
set allowed_mime_types = null
where id = 'order-attachments';
