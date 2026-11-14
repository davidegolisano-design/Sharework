begin;
alter table public.sw_annotations drop constraint sw_annotations_shape_check,
 add constraint sw_annotations_shape_check check(shape in (
  'circle','square','diamond','triangle','flame','warning','electric','tool',
  'welding','pipes','lifting','painting','inspection','ppe','cleaning','fire_watch',
  'mechanical','drilling','measurement','testing','scaffolding'
 ));
alter table public.sw_annotations add column custom_category text
 check(custom_category is null or (
  shape in ('circle','square','triangle','diamond') and char_length(btrim(custom_category)) between 1 and 60
 ));
grant update(custom_category) on public.sw_annotations to authenticated;
commit;
