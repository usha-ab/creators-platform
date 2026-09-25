-- Adminverktyget för partnerprogrammet får en egen delegerbar kapacitet.
alter table public.admin_capabilities drop constraint if exists admin_capabilities_known;
alter table public.admin_capabilities
  add constraint admin_capabilities_known check (capability in ('creators', 'promo', 'partners'));
