-- Klippkort som gäller flera serier.
--
-- Ett kort kunde bara peka på EN serie (pass_series_id), så The Labs måndagar
-- och torsdagar krävde varsitt kort. pass_series_ids är nu sanningen: kortet
-- gäller varje serie i listan. pass_series_id skrivs vidare som första värdet
-- så en äldre utrullning som fortfarande läser kolumnen ser rätt serie.

alter table listings add column if not exists pass_series_ids uuid[];

update listings
set pass_series_ids = array[pass_series_id]
where pass_series_id is not null
  and pass_series_ids is null;

create index if not exists listings_pass_series_ids_idx
  on listings using gin (pass_series_ids);

comment on column listings.pass_series_ids is
  'Serierna ett klippkort gäller på. Sanningen; pass_series_id speglar första värdet för bakåtkompatibilitet.';
